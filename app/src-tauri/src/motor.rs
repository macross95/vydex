//! Motores externos de Vydex: yt-dlp (extracción), Deno (lo exige yt-dlp para YouTube)
//! y FFmpeg (une video + audio y convierte audio). Funciona en Windows, Linux y macOS.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::process::Command;
use tokio::sync::Mutex;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Archivo junto a la copia local de yt-dlp con la huella del yt-dlp instalado del que salió.
const MARCA_ORIGEN: &str = "yt-dlp.origen";

/// Nombre del ejecutable en este sistema: "yt-dlp.exe" en Windows, "yt-dlp" en Linux y macOS.
pub fn exe(nombre: &str) -> String {
    if cfg!(windows) {
        format!("{nombre}.exe")
    } else {
        nombre.to_string()
    }
}

#[derive(Clone)]
pub struct Motores {
    /// Copia de yt-dlp en una carpeta con permiso de escritura, para que pueda actualizarse (-U)
    /// sin tocar los archivos instalados.
    pub ytdlp: PathBuf,
    /// yt-dlp que trae la instalación: repone o renueva la copia local.
    pub ytdlp_incluido: PathBuf,
    pub deno: PathBuf,
    /// Carpeta con ffmpeg y ffprobe (en Windows, también sus DLL).
    pub bin: PathBuf,
    pub cache: PathBuf,
    pub temporal: PathBuf,
    /// Registro completo (modo detallado) de cada descarga que falla.
    pub registros: PathBuf,
    /// Qué impidió dejar listos los motores. Vydex abre igual y lo informa al usarlos.
    pub problema: Option<String>,
    /// Evita que la renovación al iniciar y "Buscar actualización" reemplacen yt-dlp a la vez.
    pub cerrojo: Arc<Mutex<()>>,
}

impl Motores {
    /// Nunca falla: si algo no se puede preparar, queda anotado en `problema` y el programa
    /// abre de todos modos (antes, un error aquí cerraba Vydex sin ningún mensaje).
    pub fn preparar(app: &AppHandle) -> Self {
        let mut problemas: Vec<String> = Vec::new();
        let recursos = match app.path().resource_dir() {
            Ok(r) => r.join("bin"),
            Err(e) => {
                problemas.push(format!("carpeta del programa: {e}"));
                PathBuf::from("bin")
            }
        };
        let datos = match app.path().app_local_data_dir() {
            Ok(d) => d,
            Err(e) => {
                problemas.push(format!("carpeta de datos: {e}"));
                std::env::temp_dir().join("com.vydex.app")
            }
        };
        let bin_local = datos.join("bin");
        let cache = datos.join("cache");
        let temporal = datos.join("temporal");
        let registros = datos.join("registros");
        limpiar_registros_viejos(&registros);
        for carpeta in [&bin_local, &cache, &temporal, &registros] {
            if let Err(e) = std::fs::create_dir_all(carpeta) {
                problemas.push(format!("{}: {e}", carpeta.display()));
            }
        }

        let ytdlp_incluido = recursos.join(exe("yt-dlp"));
        let ytdlp = bin_local.join(exe("yt-dlp"));
        if !ytdlp.exists() {
            if let Err(e) = copiar_atomico(&ytdlp_incluido, &ytdlp) {
                problemas.push(format!("yt-dlp: {e}"));
            }
        }

        // En Windows, Deno y FFmpeg se usan desde la carpeta instalada.
        #[cfg(windows)]
        let (deno, bin) = (recursos.join(exe("deno")), recursos);

        // En Linux y macOS los archivos instalados pueden quedar sin permiso de ejecución o en
        // un volumen de solo lectura (AppImage, .dmg): se copian a la carpeta de datos.
        #[cfg(not(windows))]
        let (deno, bin) = {
            for nombre in ["deno", "ffmpeg", "ffprobe"] {
                if let Err(e) = copiar_si_cambio(&recursos.join(nombre), &bin_local.join(nombre)) {
                    problemas.push(e);
                }
            }
            preparar_ejecutables(&bin_local);
            (bin_local.join("deno"), bin_local.clone())
        };

        Self {
            ytdlp,
            ytdlp_incluido,
            deno,
            bin,
            cache,
            temporal,
            registros,
            problema: (!problemas.is_empty()).then(|| problemas.join(" · ")),
            cerrojo: Arc::default(),
        }
    }

    /// Error para la interfaz si los motores no quedaron listos al abrir Vydex.
    pub fn listos(&self) -> Result<(), String> {
        match &self.problema {
            Some(p) => Err(format!("MOTOR_NO_PREPARADO: {p}")),
            None => Ok(()),
        }
    }

    /// Argumentos comunes a todas las llamadas a yt-dlp.
    pub fn args_base(&self) -> Vec<String> {
        vec![
            // Ni archivos de configuración ni complementos ni código descargado al vuelo: yt-dlp
            // hace solo lo que Vydex le pide.
            "--ignore-config".into(),
            "--no-plugin-dirs".into(),
            "--no-remote-components".into(),
            "--js-runtimes".into(),
            format!("deno:{}", self.deno.display()),
            "--ffmpeg-location".into(),
            self.bin.display().to_string(),
            "--cache-dir".into(),
            self.cache.display().to_string(),
            "--encoding".into(),
            "utf-8".into(),
            "--no-playlist".into(),
        ]
    }
}

/// Copia `origen` sobre `destino` sin que otro proceso llegue a ver un archivo a medio escribir:
/// primero a un archivo aparte y luego se renombra (operación atómica en el mismo disco).
fn copiar_atomico(origen: &Path, destino: &Path) -> std::io::Result<()> {
    let nuevo = destino.with_extension("nuevo");
    std::fs::copy(origen, &nuevo)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&nuevo, std::fs::Permissions::from_mode(0o755))?;
    }
    std::fs::rename(&nuevo, destino).inspect_err(|_| {
        let _ = std::fs::remove_file(&nuevo);
    })
}

#[cfg(not(windows))]
fn copiar_si_cambio(origen: &Path, destino: &Path) -> Result<(), String> {
    let tam = |p: &Path| std::fs::metadata(p).map(|m| m.len()).ok();
    let original = tam(origen);
    if original.is_some() && original != tam(destino) {
        copiar_atomico(origen, destino).map_err(|e| format!("No se pudo preparar {}: {e}", origen.display()))?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn preparar_ejecutables(carpeta: &Path) {
    use std::os::unix::fs::PermissionsExt;
    for nombre in ["yt-dlp", "deno", "ffmpeg", "ffprobe"] {
        let _ = std::fs::set_permissions(carpeta.join(nombre), std::fs::Permissions::from_mode(0o755));
    }
    // macOS: sin la marca de cuarentena, Gatekeeper no bloquea los motores copiados.
    #[cfg(target_os = "macos")]
    {
        // Solo los cuatro motores, no todo lo que haya en la carpeta.
        let _ = std::process::Command::new("/usr/bin/xattr")
            .args(["-d", "com.apple.quarantine"])
            .args(["yt-dlp", "deno", "ffmpeg", "ffprobe"].map(|n| carpeta.join(n)))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

/// Borra los registros de errores con más de 7 días.
fn limpiar_registros_viejos(carpeta: &Path) {
    let limite = std::time::Duration::from_secs(7 * 24 * 3600);
    let Ok(entradas) = std::fs::read_dir(carpeta) else { return };
    for e in entradas.flatten() {
        let viejo = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|edad| edad > limite);
        if viejo {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// Tamaño y fecha del yt-dlp instalado: cambia cada vez que se instala otra versión de Vydex.
fn huella(archivo: &Path) -> Option<String> {
    let meta = std::fs::metadata(archivo).ok()?;
    let fecha = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    Some(format!("{}:{fecha}", meta.len()))
}

/// "2026.10.26" → [2026, 10, 26], para comparar versiones de yt-dlp como números.
fn version_numerica(version: &str) -> Vec<u64> {
    version.trim().split('.').map(|parte| parte.parse().unwrap_or(0)).collect()
}

async fn version_ytdlp(programa: &Path) -> Option<String> {
    primera_linea(programa, &["--ignore-config", "--version"]).await
}

/// Al abrir Vydex, en segundo plano: si la instalación trae un yt-dlp más nuevo que la copia
/// local (por ejemplo, después de actualizar Vydex) o la copia dejó de responder, la reemplaza.
/// Solo compara versiones cuando cambió el yt-dlp instalado, para no gastar tiempo en cada inicio.
pub async fn renovar_ytdlp(m: Motores) {
    if m.problema.is_some() {
        return;
    }
    let _guardia = m.cerrojo.lock().await;
    let marca = m.ytdlp.with_file_name(MARCA_ORIGEN);
    let Some(huella_actual) = huella(&m.ytdlp_incluido) else { return };
    if std::fs::read_to_string(&marca).ok().as_deref() == Some(huella_actual.as_str()) {
        return;
    }
    let (incluida, local) = tokio::join!(version_ytdlp(&m.ytdlp_incluido), version_ytdlp(&m.ytdlp));
    // Si el yt-dlp instalado no responde, no se toca la copia local.
    let Some(incluida) = incluida else { return };
    let renovar = local.is_none_or(|l| version_numerica(&incluida) > version_numerica(&l));
    if renovar {
        let (origen, destino) = (m.ytdlp_incluido.clone(), m.ytdlp.clone());
        let copia = tokio::task::spawn_blocking(move || copiar_atomico(&origen, &destino)).await;
        // Si está en uso (una descarga ya empezó), se vuelve a intentar al próximo inicio.
        if !matches!(copia, Ok(Ok(()))) {
            return;
        }
        #[cfg(not(windows))]
        {
            if let Some(carpeta) = m.ytdlp.parent() {
                preparar_ejecutables(carpeta);
            }
        }
    }
    let _ = std::fs::write(&marca, huella_actual);
}

/// Crea un proceso sin ventana de consola, sin entrada estándar y (en Linux y macOS) en un
/// grupo de procesos propio, para poder terminarlo junto con sus hijos.
pub fn comando(programa: &Path) -> Command {
    let mut c = std::process::Command::new(programa);
    c.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.process_group(0);
    }
    Command::from(c)
}

/// Termina un proceso y todos sus hijos (yt-dlp arranca su propio proceso y FFmpeg).
pub fn matar_arbol_ya(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Ruta completa: por nombre, Windows buscaría primero en la carpeta de Vydex.
        let sistema = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        let _ = std::process::Command::new(sistema.join("System32").join("taskkill.exe"))
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(unix)]
    {
        // El proceso es líder de su grupo (process_group(0)): se envía la señal al grupo.
        if let Ok(grupo) = i32::try_from(pid) {
            if grupo > 0 {
                unsafe {
                    libc::kill(-grupo, libc::SIGKILL);
                }
            }
        }
    }
}

pub async fn matar_arbol(pid: u32) {
    let _ = tokio::task::spawn_blocking(move || matar_arbol_ya(pid)).await;
}

/// Devuelve la última línea de error de yt-dlp, sin el prefijo "ERROR:".
pub fn ultimo_error(texto: &str) -> Option<String> {
    texto
        .lines()
        .rev()
        .find(|l| l.contains("ERROR:"))
        .map(|l| l.split_once("ERROR:").map(|x| x.1).unwrap_or(l).trim().to_string())
}

/// Solo se aceptan enlaces web razonables, para que nada llegue a yt-dlp como opción.
pub fn validar_url(url: &str) -> Result<(), String> {
    let u = url.trim();
    let web = u.starts_with("https://") || u.starts_with("http://");
    // También se rechazan los caracteres invisibles que invierten la dirección del texto: harían
    // que un enlace cualquiera se vea como de YouTube en el aviso del portapapeles.
    let invisible = |c: char| matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}');
    let limpio = !u.chars().any(|c| c.is_whitespace() || c.is_control() || invisible(c));
    if web && limpio && u.len() <= 4096 {
        Ok(())
    } else {
        Err("URL_INVALIDA".into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstadoMotor {
    pub ytdlp: Option<String>,
    pub deno: Option<String>,
    pub ffmpeg: Option<String>,
    pub problema: Option<String>,
}

async fn primera_linea(programa: &Path, args: &[&str]) -> Option<String> {
    let salida = comando(programa)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;
    if !salida.status.success() {
        return None;
    }
    String::from_utf8_lossy(&salida.stdout)
        .lines()
        .next()
        .map(|l| l.trim().to_string())
}

#[tauri::command]
pub async fn estado_motor(motores: State<'_, Motores>) -> Result<EstadoMotor, String> {
    let m = motores.inner().clone();
    // Si los motores no quedaron listos, sus rutas no son confiables: no se ejecuta nada.
    if m.problema.is_some() {
        return Ok(EstadoMotor { ytdlp: None, deno: None, ffmpeg: None, problema: m.problema.clone() });
    }
    let ffmpeg_exe = m.bin.join(exe("ffmpeg"));
    let (ytdlp, deno, ffmpeg) = tokio::join!(
        version_ytdlp(&m.ytdlp),
        primera_linea(&m.deno, &["--version"]),
        primera_linea(&ffmpeg_exe, &["-version"]),
    );
    let primera_palabra = |texto: String, prefijo: &str| {
        texto.replace(prefijo, "").split_whitespace().next().unwrap_or("").to_string()
    };
    Ok(EstadoMotor {
        ytdlp,
        deno: deno.map(|d| primera_palabra(d, "deno ")),
        ffmpeg: ffmpeg.map(|f| primera_palabra(f, "ffmpeg version ")),
        problema: m.problema.clone(),
    })
}

/// Actualiza yt-dlp al último lanzamiento estable y devuelve la versión resultante.
/// Antes se respalda la copia actual: si la nueva no responde, se restaura la anterior.
#[tauri::command]
pub async fn actualizar_motor(motores: State<'_, Motores>) -> Result<String, String> {
    let m = motores.inner().clone();
    m.listos()?;
    let _guardia = m.cerrojo.lock().await;
    let respaldo = m.ytdlp.with_extension("respaldo");
    std::fs::copy(&m.ytdlp, &respaldo).map_err(|e| format!("ACTUALIZACION_FALLIDA: {e}"))?;

    let salida = comando(&m.ytdlp)
        .args(["--ignore-config", "-U"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;
    let error = match salida {
        Ok(s) => ultimo_error(&format!(
            "{}\n{}",
            String::from_utf8_lossy(&s.stdout),
            String::from_utf8_lossy(&s.stderr)
        )),
        Err(e) => Some(e.to_string()),
    };

    match version_ytdlp(&m.ytdlp).await {
        Some(version) => {
            let _ = std::fs::remove_file(&respaldo);
            match error {
                Some(e) => Err(format!("ACTUALIZACION_FALLIDA: {e}")),
                None => Ok(version),
            }
        }
        None => {
            match copiar_atomico(&respaldo, &m.ytdlp) {
                Ok(()) => {
                    let _ = std::fs::remove_file(&respaldo);
                    Err("MOTOR_RESTAURADO".into())
                }
                // El respaldo se conserva: es la única copia que funciona.
                Err(e) => Err(format!("MOTOR_NO_RESPONDE: {e}")),
            }
        }
    }
}

/// Abre la carpeta con las licencias de los componentes de código abierto.
#[tauri::command]
pub fn abrir_licencias(app: AppHandle) -> Result<(), String> {
    let carpeta = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("licencias");
    if !carpeta.is_dir() {
        return Err("NO_EXISTE".into());
    }
    tauri_plugin_opener::open_path(carpeta.to_string_lossy().to_string(), None::<&str>).map_err(|e| e.to_string())
}

/// Idioma elegido en el instalador (archivo idioma.txt junto al programa), si existe.
#[tauri::command]
pub fn idioma_instalado(app: AppHandle) -> Option<String> {
    let carpeta = app.path().resource_dir().ok()?;
    let idioma = std::fs::read_to_string(carpeta.join("idioma.txt")).ok()?;
    let idioma = idioma.trim().to_string();
    (idioma == "es" || idioma == "en").then_some(idioma)
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn compara_versiones_como_numeros() {
        assert!(version_numerica("2026.10.26") > version_numerica("2026.9.30"));
        assert!(version_numerica("2026.10.26.123456") > version_numerica("2026.10.26"));
        assert!(version_numerica("2025.12.01") < version_numerica("2026.01.02"));
    }

    #[test]
    fn valida_enlaces() {
        assert!(validar_url("https://www.youtube.com/watch?v=abc").is_ok());
        assert!(validar_url("  https://vimeo.com/1  ").is_ok());
        assert!(validar_url("--exec calc").is_err());
        assert!(validar_url("file:///C:/Windows/win.ini").is_err());
        assert!(validar_url("https://a.com/\u{0}b").is_err());
        assert!(validar_url("https://a.com/ b").is_err());
        assert!(validar_url("https://evil.example/\u{202E}moc.ebutuoy").is_err());
        assert!(validar_url(&format!("https://a.com/{}", "x".repeat(5000))).is_err());
    }
}
