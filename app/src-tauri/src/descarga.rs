//! Analizar un enlace y descargarlo con yt-dlp, informando el progreso a la interfaz.

use crate::motor::{comando, matar_arbol, ultimo_error, validar_url, Motores};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::hash_map::RandomState;
use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

// ---------- Análisis ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Formato {
    id: String,
    ext: String,
    vcodec: Option<String>,
    acodec: Option<String>,
    alto: Option<u64>,
    ancho: Option<u64>,
    fps: Option<f64>,
    rango: Option<String>,
    bytes: Option<u64>,
    bytes_aprox: bool,
    tbr: Option<f64>,
    abr: Option<f64>,
    idioma: Option<String>,
    preferencia_idioma: Option<i64>,
    /// "https" (DASH), "m3u8_native" (HLS)…
    protocolo: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoVideo {
    id: String,
    titulo: String,
    autor: Option<String>,
    duracion: Option<f64>,
    miniatura: Option<String>,
    url: String,
    sitio: String,
    formatos: Vec<Formato>,
}

/// Texto de un campo de yt-dlp, sin vacíos ni el "none" que usa para "no tiene".
fn texto(v: &Value, clave: &str) -> Option<String> {
    v.get(clave)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && *s != "none")
        .map(str::to_string)
}

/// Los textos remotos se recortan: un título de varios MB llenaría el historial guardado.
fn recortar(texto: String, max: usize) -> String {
    if texto.chars().count() <= max { texto } else { texto.chars().take(max).collect::<String>() + "…" }
}

impl InfoVideo {
    fn desde(v: &Value, url_original: &str) -> Self {
        let duracion = v.get("duration").and_then(Value::as_f64);
        let formatos = v
            .get("formats")
            .and_then(Value::as_array)
            .map(|lista| {
                lista
                    .iter()
                    .filter(|f| {
                        let ext = f.get("ext").and_then(Value::as_str).unwrap_or("");
                        let nota = f.get("format_note").and_then(Value::as_str).unwrap_or("");
                        ext != "mhtml" && !nota.contains("storyboard")
                    })
                    .filter_map(|f| {
                        let vcodec = texto(f, "vcodec");
                        let acodec = texto(f, "acodec");
                        if vcodec.is_none() && acodec.is_none() {
                            return None;
                        }
                        let tbr = f.get("tbr").and_then(Value::as_f64);
                        let exacto = f.get("filesize").and_then(Value::as_u64);
                        let aprox = f.get("filesize_approx").and_then(Value::as_u64).or_else(|| {
                            // Sin tamaño declarado: bitrate (kbit/s) × duración.
                            Some((tbr? * duracion? * 125.0) as u64)
                        });
                        Some(Formato {
                            id: texto(f, "format_id")?,
                            ext: texto(f, "ext").unwrap_or_default(),
                            vcodec,
                            acodec,
                            alto: f.get("height").and_then(Value::as_u64),
                            ancho: f.get("width").and_then(Value::as_u64),
                            fps: f.get("fps").and_then(Value::as_f64),
                            rango: texto(f, "dynamic_range"),
                            bytes: exacto.or(aprox),
                            bytes_aprox: exacto.is_none(),
                            tbr,
                            abr: f.get("abr").and_then(Value::as_f64),
                            idioma: texto(f, "language"),
                            preferencia_idioma: f.get("language_preference").and_then(Value::as_i64),
                            protocolo: texto(f, "protocol"),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Self {
            id: texto(v, "id").unwrap_or_default(),
            titulo: recortar(texto(v, "title").unwrap_or_else(|| "Sin título".into()), 300),
            autor: texto(v, "uploader").or_else(|| texto(v, "channel")).map(|a| recortar(a, 200)),
            duracion,
            miniatura: texto(v, "thumbnail").filter(|u| u.starts_with("https://") && u.len() <= 2048),
            url: texto(v, "webpage_url").unwrap_or_else(|| url_original.to_string()),
            sitio: texto(v, "extractor_key").unwrap_or_default(),
            formatos,
        }
    }
}

#[tauri::command]
pub async fn analizar(url: String, motores: State<'_, Motores>) -> Result<InfoVideo, String> {
    validar_url(&url)?;
    let m = motores.inner().clone();
    m.listos()?;
    let mut args = m.args_base();
    // --flat-playlist: con una lista, yt-dlp responde al instante en vez de leer cada video
    // (con listas largas eso superaba el límite de 2 minutos).
    args.extend(["--flat-playlist".into(), "-J".into(), "--".into(), url.trim().to_string()]);

    let hijo = comando(&m.ytdlp)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("MOTOR_NO_INICIA: {e}"))?;
    let pid = hijo.id();

    let salida = match tokio::time::timeout(Duration::from_secs(120), hijo.wait_with_output()).await {
        Ok(resultado) => resultado.map_err(|e| e.to_string())?,
        Err(_) => {
            if let Some(pid) = pid {
                matar_arbol(pid).await;
            }
            return Err("TIEMPO_AGOTADO".into());
        }
    };

    if !salida.status.success() {
        let stderr = String::from_utf8_lossy(&salida.stderr);
        return Err(ultimo_error(&stderr).unwrap_or_else(|| "LECTURA_FALLIDA".into()));
    }
    let v: Value = serde_json::from_slice(&salida.stdout).map_err(|_| "LECTURA_FALLIDA".to_string())?;
    if v.get("_type").and_then(Value::as_str) == Some("playlist") {
        return Err("PLAYLIST".into());
    }
    // Una transmisión en vivo se grabaría sin fin y sin porcentaje: se descarga cuando termine.
    let en_vivo = v.get("is_live").and_then(Value::as_bool) == Some(true)
        || texto(&v, "live_status").as_deref() == Some("is_live");
    if en_vivo {
        return Err("EN_VIVO".into());
    }
    Ok(InfoVideo::desde(&v, &url))
}

// ---------- Descarga ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpcionesDescarga {
    id: String,
    url: String,
    /// "video" o "audio"
    modo: String,
    formato_video: Option<String>,
    formato_audio: Option<String>,
    /// "mp4" o "mkv"
    contenedor: Option<String>,
    /// "mp3", "m4a" u "opus"
    audio_formato: Option<String>,
    carpeta: String,
    subtitulos: bool,
    bytes_esperados: Option<u64>,
    /// Capítulos, metadatos, subtítulos y portada incrustados. Si FFmpeg falla al
    /// agregarlos, la interfaz reintenta con `extras: false`.
    extras: Option<bool>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progreso {
    id: String,
    fase: String,
    bytes: u64,
    total: Option<u64>,
    velocidad: Option<f64>,
    eta: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Final {
    id: String,
    /// "completada", "error", "cancelada" o "pausada"
    estado: String,
    ruta: Option<String>,
    error: Option<String>,
    /// Archivo con la salida completa de yt-dlp, solo cuando hubo error.
    registro: Option<String>,
}

struct Entrada {
    /// 0 mientras el proceso todavía no arranca.
    pid: u32,
    detener: Option<String>,
}

#[derive(Default)]
pub struct Procesos(Mutex<HashMap<String, Entrada>>);

impl Procesos {
    /// Al cerrar Vydex se terminan todas las descargas en curso (y sus procesos hijos).
    /// Sus archivos temporales se conservan: la cola se guarda y se retoman al volver a abrir.
    pub fn terminar_todos(&self) {
        let pids: Vec<u32> = self
            .0
            .lock()
            .map(|mapa| mapa.values().map(|e| e.pid).filter(|p| *p > 0).collect())
            .unwrap_or_default();
        for pid in pids {
            crate::motor::matar_arbol_ya(pid);
        }
    }
}

/// Valor impredecible para un sitio remoto (RandomState se siembra con azar del sistema).
fn marca_aleatoria() -> String {
    let mut h = RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    h.write_u32(std::process::id());
    format!("{:016x}", h.finish())
}

/// Ruta de un disco local. Rechaza rutas de red (\\servidor\…) y de dispositivo, que harían que
/// Windows se conecte a otro equipo con solo consultarlas.
fn ruta_local(camino: &Path) -> bool {
    use std::path::{Component, Prefix};
    match camino.components().next() {
        Some(Component::Prefix(p)) => matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)),
        Some(Component::RootDir) => !cfg!(windows),
        _ => false,
    }
}

fn id_valido(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn formato_seguro(f: &Option<String>) -> Option<String> {
    f.as_ref()
        .filter(|s| !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_".contains(c)))
        .cloned()
}

/// Borra los restos de una descarga: archivos a medio bajar y su registro.
async fn limpiar_restos(m: &Motores, id: &str) {
    let _ = tokio::fs::remove_dir_all(m.temporal.join(id)).await;
    let _ = tokio::fs::remove_file(m.registros.join(format!("{id}.log"))).await;
}

/// Prefijos de las líneas de control de una descarga. Llevan una marca secreta por descarga:
/// un texto remoto que yt-dlp vuelva a imprimir no puede hacerse pasar por progreso ni por la
/// ruta final porque no conoce la marca.
struct Prefijos {
    progreso: String,
    fase: String,
    archivo: String,
}

impl Prefijos {
    fn nuevos() -> Self {
        let marca = marca_aleatoria();
        Self { progreso: format!("VYDEX{marca}|"), fase: format!("VYDEXPP{marca}|"), archivo: format!("VYDEXFILE{marca}|") }
    }
}

fn construir_args(m: &Motores, o: &OpcionesDescarga, carpeta: &str, temporal: &Path, p: &Prefijos) -> Vec<String> {
    let mut a = m.args_base();
    a.push("--verbose".into());
    let audio = formato_seguro(&o.formato_audio);
    let extras = o.extras.unwrap_or(true);

    if o.modo == "audio" {
        let destino = match o.audio_formato.as_deref() {
            Some("m4a") => "m4a",
            Some("opus") => "opus",
            _ => "mp3",
        };
        let seleccion = match &audio {
            Some(id) => format!("{id}/ba/b"),
            None => "ba/b".into(),
        };
        a.extend(["-f".into(), seleccion, "-x".into(), "--audio-format".into(), destino.into()]);
        if destino == "mp3" {
            // VBR de máxima calidad (V0).
            a.extend(["--audio-quality".into(), "0".into()]);
        }
        if extras {
            a.extend(["--embed-thumbnail".into(), "--convert-thumbnails".into(), "jpg".into()]);
        }
        a.extend(["-o".into(), "%(title).180B.%(ext)s".into()]);
    } else {
        let contenedor = if o.contenedor.as_deref() == Some("mkv") { "mkv" } else { "mp4" };
        let video = formato_seguro(&o.formato_video);
        let seleccion = match (&video, &audio) {
            (Some(v), Some(a2)) => format!("{v}+{a2}/{v}+ba/bv*+ba/b"),
            (Some(v), None) => format!("{v}+ba/{v}/bv*+ba/b"),
            _ => "bv*+ba/b".into(),
        };
        a.extend([
            "-f".into(),
            seleccion,
            "--merge-output-format".into(),
            contenedor.into(),
            // Las pistas HLS llegan como MPEG-TS con paquetes sin marca de tiempo; MKV los
            // rechaza ("Can't write packet with unknown timestamp"). genpts los completa.
            "--postprocessor-args".into(),
            "Merger+ffmpeg_i:-fflags +genpts".into(),
            "-o".into(),
            "%(title).170B [%(height)sp].%(ext)s".into(),
        ]);
        if extras {
            a.push("--embed-chapters".into());
        }
        if o.subtitulos && extras {
            a.extend([
                "--write-subs".into(),
                "--sub-langs".into(),
                "es.*,en.*".into(),
                "--embed-subs".into(),
            ]);
        }
    }

    if extras {
        a.push("--embed-metadata".into());
    }
    a.extend([
        "--no-mtime".into(),
        "-N".into(),
        "4".into(),
        "-P".into(),
        carpeta.to_string(),
        "-P".into(),
        format!("temp:{}", temporal.display()),
        "--newline".into(),
        "--progress".into(),
        "--progress-template".into(),
        format!("download:{}%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s", p.progreso),
        "--progress-template".into(),
        format!("postprocess:{}%(progress.status)s|%(progress.postprocessor)s", p.fase),
        "--print".into(),
        format!("after_move:{}%(filepath)j", p.archivo),
        "--".into(),
        o.url.trim().to_string(),
    ]);
    a
}

fn numero(s: &str) -> Option<f64> {
    s.trim().parse::<f64>().ok().filter(|n| n.is_finite() && *n >= 0.0)
}

fn fase_de(postprocesador: &str) -> &'static str {
    match postprocesador {
        "Merger" => "uniendo",
        "FFmpegExtractAudio" => "convirtiendo",
        _ => "finalizando",
    }
}

/// Reenvía cada línea de una salida del proceso (stdout o stderr) al canal común.
fn reenviar_lineas<R: AsyncRead + Unpin + Send + 'static>(salida: R, tx: mpsc::UnboundedSender<String>) {
    tauri::async_runtime::spawn(async move {
        let mut lineas = BufReader::new(salida).lines();
        while let Ok(Some(l)) = lineas.next_line().await {
            let _ = tx.send(l);
        }
    });
}

#[tauri::command]
pub async fn descargar(
    app: AppHandle,
    opciones: OpcionesDescarga,
    motores: State<'_, Motores>,
    procesos: State<'_, Procesos>,
) -> Result<(), String> {
    if !id_valido(&opciones.id) {
        return Err("ID_INVALIDO".into());
    }
    validar_url(&opciones.url)?;
    // Ruta absoluta: además evita que yt-dlp la lea como "temp:…" u otro tipo de carpeta.
    let carpeta = opciones.carpeta.trim().to_string();
    if !Path::new(&carpeta).is_absolute() || !ruta_local(Path::new(&carpeta)) {
        return Err("SIN_CARPETA".into());
    }
    let m = motores.inner().clone();
    m.listos()?;

    // Se reserva el lugar antes de arrancar el proceso: una pausa que llegue en ese instante
    // queda anotada y se aplica apenas el proceso existe (antes se perdía).
    {
        let mut mapa = procesos.0.lock().map_err(|e| e.to_string())?;
        if mapa.contains_key(&opciones.id) {
            return Err("YA_EN_CURSO".into());
        }
        mapa.insert(opciones.id.clone(), Entrada { pid: 0, detener: None });
    }

    let temporal = m.temporal.join(&opciones.id);
    let prefijos = Prefijos::nuevos();
    let args = construir_args(&m, &opciones, &carpeta, &temporal, &prefijos);
    let mut hijo = match comando(&m.ytdlp).args(&args).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
        Ok(h) => h,
        Err(e) => {
            if let Ok(mut mapa) = procesos.0.lock() {
                mapa.remove(&opciones.id);
            }
            return Err(format!("MOTOR_NO_INICIA: {e}"));
        }
    };

    let pid = hijo.id().unwrap_or(0);
    let detener_pendiente = procesos
        .0
        .lock()
        .ok()
        .and_then(|mut mapa| {
            mapa.get_mut(&opciones.id).map(|e| {
                e.pid = pid;
                e.detener.is_some()
            })
        })
        .unwrap_or(false);
    if detener_pendiente && pid > 0 {
        matar_arbol(pid).await;
    }

    // Las dos salidas del proceso llegan a un mismo canal, línea por línea.
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    if let Some(out) = hijo.stdout.take() {
        reenviar_lineas(out, tx.clone());
    }
    if let Some(err) = hijo.stderr.take() {
        reenviar_lineas(err, tx.clone());
    }
    drop(tx);

    let id = opciones.id.clone();
    let esperados = opciones.bytes_esperados.filter(|b| *b > 0);
    let ruta_registro = m.registros.join(format!("{}.log", opciones.id));
    let encabezado = format!("==== Vydex · yt-dlp {}\n", args.join(" "));

    tauri::async_runtime::spawn(async move {
        let mut hecho: u64 = 0;
        let mut ruta: Option<String> = None;
        let mut error: Option<String> = None;
        let mut ultimo_envio = Instant::now() - Duration::from_secs(1);
        let mut registro = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&ruta_registro)
            .await
            .ok();
        if let Some(r) = registro.as_mut() {
            let _ = r.write_all(encabezado.as_bytes()).await;
        }

        while let Some(linea) = rx.recv().await {
            // El progreso no se guarda en el registro para que quede legible.
            if !linea.starts_with(&prefijos.progreso) {
                if let Some(r) = registro.as_mut() {
                    let _ = r.write_all(linea.as_bytes()).await;
                    let _ = r.write_all(b"\n").await;
                }
            }
            if let Some(resto) = linea.strip_prefix(prefijos.progreso.as_str()) {
                let p: Vec<&str> = resto.split('|').collect();
                if p.len() < 6 {
                    continue;
                }
                let bajado = numero(p[1]).unwrap_or(0.0) as u64;
                let total_actual = numero(p[2]).or_else(|| numero(p[3])).map(|t| t as u64);
                if p[0] == "finished" {
                    hecho += total_actual.unwrap_or(bajado).max(bajado);
                    continue;
                }
                if ultimo_envio.elapsed() < Duration::from_millis(200) {
                    continue;
                }
                ultimo_envio = Instant::now();
                let bytes = hecho + bajado;
                let total = match (esperados, total_actual) {
                    (Some(e), Some(t)) => Some(e.max(hecho + t)),
                    (Some(e), None) => Some(e.max(bytes)),
                    (None, Some(t)) => Some(hecho + t),
                    (None, None) => None,
                };
                let _ = app.emit(
                    "vydex://progreso",
                    Progreso {
                        id: id.clone(),
                        fase: "descargando".into(),
                        bytes,
                        total,
                        velocidad: numero(p[4]),
                        eta: numero(p[5]).map(|e| e as u64),
                    },
                );
            } else if let Some(resto) = linea.strip_prefix(prefijos.fase.as_str()) {
                let (estado, pp) = resto.split_once('|').unwrap_or((resto, ""));
                if estado == "started" && pp != "MoveFiles" {
                    let _ = app.emit(
                        "vydex://progreso",
                        Progreso {
                            id: id.clone(),
                            fase: fase_de(pp).into(),
                            bytes: hecho,
                            total: Some(hecho),
                            velocidad: None,
                            eta: None,
                        },
                    );
                }
            } else if let Some(resto) = linea.strip_prefix(prefijos.archivo.as_str()) {
                ruta = serde_json::from_str::<String>(resto).ok();
            } else if linea.contains("ERROR:") {
                error = ultimo_error(&linea);
            }
        }

        let exito = hijo.wait().await.map(|s| s.success()).unwrap_or(false);
        let procesos = app.state::<Procesos>();
        let motivo = procesos
            .0
            .lock()
            .ok()
            .and_then(|mut mapa| mapa.remove(&id))
            .and_then(|e| e.detener);

        let estado = match motivo.as_deref() {
            Some("pausar") => "pausada",
            Some(_) => "cancelada",
            // Además, el archivo final debe existir dentro de la carpeta elegida.
            None if exito && ruta.as_deref().is_some_and(|r| dentro_de(r, &carpeta)) => "completada",
            None => "error",
        };
        if let Some(mut r) = registro.take() {
            let _ = r.flush().await;
        }
        // Con error o en pausa se conservan los archivos temporales (reanudar no vuelve a
        // descargar) y, con error, el registro (para diagnosticar).
        if estado == "completada" || estado == "cancelada" {
            let m = app.state::<Motores>();
            limpiar_restos(&m, &id).await;
        }
        let con_error = estado == "error";
        let _ = app.emit(
            "vydex://final",
            Final {
                id,
                estado: estado.into(),
                ruta,
                error: if con_error {
                    Some(error.unwrap_or_else(|| "SIN_EXPLICACION".into()))
                } else {
                    None
                },
                registro: con_error.then(|| ruta_registro.display().to_string()),
            },
        );
    });

    Ok(())
}

/// true si `ruta` es un archivo que está dentro de `carpeta` (ya resueltos los enlaces).
fn dentro_de(ruta: &str, carpeta: &str) -> bool {
    match (std::fs::canonicalize(ruta), std::fs::canonicalize(carpeta)) {
        (Ok(r), Ok(c)) => r.is_file() && r.starts_with(c),
        _ => false,
    }
}

/// Pausa o cancela una descarga. Una descarga que no está corriendo solo borra sus restos al
/// cancelarse; si todavía está arrancando, la orden queda anotada y se cumple al arrancar.
#[tauri::command]
pub async fn detener(
    id: String,
    motivo: String,
    motores: State<'_, Motores>,
    procesos: State<'_, Procesos>,
) -> Result<(), String> {
    if !id_valido(&id) {
        return Err("ID_INVALIDO".into());
    }
    let pausar = motivo == "pausar";
    let pid = {
        let mut mapa = procesos.0.lock().map_err(|e| e.to_string())?;
        mapa.get_mut(&id).map(|e| {
            e.detener = Some(if pausar { "pausar".into() } else { "cancelar".into() });
            e.pid
        })
    };
    match pid {
        Some(pid) if pid > 0 => matar_arbol(pid).await,
        Some(_) => {} // arrancando: `descargar` lo detiene apenas tenga el proceso
        None if !pausar => limpiar_restos(&motores, &id).await,
        None => {}
    }
    Ok(())
}

/// Al abrir Vydex: borra los restos de descargas que ya no están en la cola guardada.
#[tauri::command]
pub async fn limpiar_temporales(conservar: Vec<String>, motores: State<'_, Motores>) -> Result<(), String> {
    let vivos: HashSet<String> = conservar.into_iter().filter(|id| id_valido(id)).collect();
    let m = motores.inner().clone();
    let Ok(mut entradas) = tokio::fs::read_dir(&m.temporal).await else { return Ok(()) };
    while let Ok(Some(e)) = entradas.next_entry().await {
        let nombre = e.file_name().to_string_lossy().to_string();
        if !vivos.contains(&nombre) {
            let ruta = e.path();
            if ruta.is_dir() {
                let _ = tokio::fs::remove_dir_all(&ruta).await;
            } else {
                let _ = tokio::fs::remove_file(&ruta).await;
            }
        }
    }
    Ok(())
}

/// Revisa que se pueda escribir en la carpeta de descargas elegida (y la crea si falta).
#[tauri::command]
pub async fn probar_carpeta(ruta: String) -> Result<(), String> {
    let carpeta = PathBuf::from(ruta.trim());
    if !carpeta.is_absolute() || !ruta_local(&carpeta) {
        return Err("SIN_CARPETA".into());
    }
    let sin_permiso = |e: std::io::Error| match e.kind() {
        std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::ReadOnlyFilesystem => "SIN_PERMISO".to_string(),
        _ => format!("SIN_PERMISO: {e}"),
    };
    tokio::fs::create_dir_all(&carpeta).await.map_err(sin_permiso)?;
    // Nombre impredecible y creación exclusiva: si ya existe algo con ese nombre (un enlace
    // dejado por otra cuenta), la prueba falla en vez de escribir a través de él.
    let prueba = carpeta.join(format!(".vydex-prueba-{}", marca_aleatoria()));
    let mut archivo = tokio::fs::OpenOptions::new().write(true).create_new(true).open(&prueba).await.map_err(sin_permiso)?;
    archivo.write_all(b"vydex").await.map_err(sin_permiso)?;
    drop(archivo);
    let _ = tokio::fs::remove_file(&prueba).await;
    Ok(())
}

/// Extensiones que Vydex puede abrir con el programa predeterminado: lo que descarga y sus
/// registros. Nunca ejecutables, accesos directos ni scripts.
const ABRIBLES: &[&str] = &[
    "mp4", "mkv", "webm", "mov", "m4v", "mp3", "m4a", "opus", "ogg", "oga", "aac", "flac", "wav", "log",
];

/// Abre un archivo descargado (o una carpeta) o lo muestra en su carpeta.
#[tauri::command]
pub async fn abrir(ruta: String, en_carpeta: bool) -> Result<(), String> {
    let camino = PathBuf::from(&ruta);
    if !camino.is_absolute() || !ruta_local(&camino) || !camino.exists() {
        return Err("NO_EXISTE".into());
    }
    if en_carpeta {
        return tauri_plugin_opener::reveal_item_in_dir(&camino).map_err(|e| e.to_string());
    }
    let extension = camino
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let carpeta_comun = camino.is_dir() && extension != "app";
    if carpeta_comun || (camino.is_file() && ABRIBLES.contains(&extension.as_str())) {
        tauri_plugin_opener::open_path(&ruta, None::<&str>).map_err(|e| e.to_string())
    } else {
        Err("NO_PERMITIDO".into())
    }
}

/// Indica qué archivos del historial siguen existiendo en disco.
#[tauri::command]
pub fn existen(rutas: Vec<String>) -> Vec<bool> {
    rutas.iter().take(5000).map(|r| { let p = PathBuf::from(r); ruta_local(&p) && p.exists() }).collect()
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn formatos_solo_con_caracteres_seguros() {
        assert_eq!(formato_seguro(&Some("399".into())), Some("399".into()));
        assert_eq!(formato_seguro(&Some("251-drc".into())), Some("251-drc".into()));
        assert_eq!(formato_seguro(&Some("1/--exec".into())), None);
        assert_eq!(formato_seguro(&Some("a+b".into())), None);
        assert_eq!(formato_seguro(&Some(String::new())), None);
    }

    #[test]
    #[cfg(windows)]
    fn solo_rutas_de_disco_local() {
        assert!(ruta_local(Path::new(r"C:\Users\ana\Videos\a.mp4")));
        assert!(ruta_local(Path::new(r"\\?\C:\Users\ana\a.mp4")));
        assert!(!ruta_local(Path::new(r"\\servidor\recurso\a.mp4")));
        assert!(!ruta_local(Path::new(r"\\?\UNC\servidor\recurso\a.mp4")));
        assert!(!ruta_local(Path::new(r"\\.\COM1")));
        assert!(!ruta_local(Path::new(r"relativa\a.mp4")));
    }

    #[test]
    fn marcas_distintas_en_cada_descarga() {
        assert_ne!(Prefijos::nuevos().archivo, Prefijos::nuevos().archivo);
    }

    #[test]
    fn ids_validos() {
        assert!(id_valido("lq3k2-ab12cd"));
        assert!(!id_valido("../../windows"));
        assert!(!id_valido(""));
        assert!(!id_valido(&"a".repeat(65)));
    }
}
