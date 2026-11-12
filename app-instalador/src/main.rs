// Instalador y desinstalador de Vydex, con la misma interfaz y diseño del programa.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod paquete;
mod sistema;

use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::window::Color;
use tauri::{AppHandle, Emitter, RunEvent, State, WebviewUrl, WebviewWindowBuilder};

struct Estado {
    desinstalar: bool,
    /// Carpeta indicada con --carpeta (el desinstalador relanzado desde la carpeta temporal).
    carpeta: Option<PathBuf>,
    /// Problema que impide seguir, detectado al abrir (por ejemplo, un instalador dañado).
    error: Option<String>,
    /// Carpeta recién instalada: "Abrir Vydex" usa esta, nunca una ruta enviada por la interfaz.
    instalado_en: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    modo: &'static str,
    version: String,
    carpeta: String,
    version_instalada: Option<String>,
    idioma_instalado: Option<String>,
    tamano: u64,
    vydex_abierto: bool,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progreso {
    hecho: u64,
    total: u64,
    archivo: String,
}

#[tauri::command]
async fn info(app: AppHandle, estado: State<'_, Estado>) -> Result<Info, String> {
    let desinstalar = estado.desinstalar;
    let preferida = estado.carpeta.clone();
    let error_inicial = estado.error.clone();
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let existente = sistema::instalacion_existente();
        let (carpeta, error) = if desinstalar {
            match sistema::carpeta_para_desinstalar(preferida.as_deref()) {
                Some(c) => (c, error_inicial),
                None => (
                    preferida.unwrap_or_default(),
                    error_inicial.or_else(|| Some("NO_ES_INSTALACION".into())),
                ),
            }
        } else {
            let carpeta = existente
                .as_ref()
                .map(|e| e.carpeta.clone())
                .unwrap_or_else(sistema::carpeta_predeterminada);
            (carpeta, error_inicial)
        };
        Info {
            modo: if desinstalar { "desinstalar" } else { "instalar" },
            version,
            carpeta: carpeta.display().to_string(),
            version_instalada: existente.as_ref().and_then(|e| e.version.clone()),
            idioma_instalado: existente.and_then(|e| e.idioma),
            tamano: if desinstalar || error.is_some() { 0 } else { paquete::tamano_total() },
            vydex_abierto: sistema::vydex_abierto(),
            error,
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn instalar(
    app: AppHandle,
    estado: State<'_, Estado>,
    carpeta: String,
    escritorio: bool,
    idioma: String,
) -> Result<(), String> {
    if estado.desinstalar {
        return Err("MODO_INVALIDO".into());
    }
    if let Some(error) = &estado.error {
        return Err(error.clone());
    }
    let carpeta = PathBuf::from(carpeta.trim());
    if !carpeta.is_absolute() {
        return Err("CARPETA_INVALIDA".into());
    }
    let idioma = if idioma == "en" { "en" } else { "es" }.to_string();
    let version = app.package_info().version.to_string();
    let destino = carpeta.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut ultimo = Instant::now() - Duration::from_secs(1);
        sistema::instalar(&destino, escritorio, &idioma, &version, |hecho, total, archivo| {
            if ultimo.elapsed() >= Duration::from_millis(80) || hecho >= total {
                ultimo = Instant::now();
                let _ = app.emit("instalador://progreso", Progreso { hecho, total, archivo: archivo.to_string() });
            }
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    if let Ok(mut instalado) = estado.instalado_en.lock() {
        *instalado = Some(carpeta);
    }
    Ok(())
}

#[tauri::command]
async fn desinstalar(estado: State<'_, Estado>, borrar_datos: bool) -> Result<(), String> {
    if !estado.desinstalar {
        return Err("MODO_INVALIDO".into());
    }
    let preferida = estado.carpeta.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let carpeta = sistema::carpeta_para_desinstalar(preferida.as_deref()).ok_or("NO_ES_INSTALACION")?;
        sistema::desinstalar(&carpeta, borrar_datos)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn abrir_vydex(estado: State<'_, Estado>) -> Result<(), String> {
    let carpeta = estado
        .instalado_en
        .lock()
        .ok()
        .and_then(|c| c.clone())
        .ok_or("NO_INSTALADO")?;
    sistema::abrir_vydex(&carpeta).map_err(|e| e.to_string())
}

#[tauri::command]
fn salir(app: AppHandle) {
    app.exit(0);
}

/// El desinstalador es este mismo programa copiado con el nombre "Desinstalar Vydex.exe".
fn es_el_desinstalador() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.file_name().map(|n| n.to_string_lossy().eq_ignore_ascii_case(sistema::DESINSTALADOR)))
        .unwrap_or(false)
}

fn main() {
    // Las DLL que se carguen después de arrancar (por ejemplo uxtheme.dll) se buscan solo en
    // System32, no en la carpeta del instalador. Las importaciones estáticas ya las cubre
    // /DEPENDENTLOADFLAG en build.rs.
    unsafe {
        use windows_sys::Win32::System::LibraryLoader::{LOAD_LIBRARY_SEARCH_SYSTEM32, SetDefaultDllDirectories};
        SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32);
    }
    let args: Vec<String> = std::env::args().collect();
    let tiene = |opcion: &str| args.iter().any(|a| a == opcion);

    // Para el empaquetado y la compilación en GitHub: revisa que el paquete pegado se lea
    // completo (también con el .exe firmado) y termina sin abrir ventanas.
    if tiene("--verificar-paquete") {
        std::process::exit(if paquete::verificar().is_ok() { 0 } else { 1 });
    }

    // Actualización desde Vydex: su actualizador ya verificó la firma de este instalador y lo
    // abre con "/P /UPDATE /R /ARGS …". Se instala sobre la instalación existente sin ventanas y
    // se vuelve a abrir Vydex (también si algo falla: la versión anterior queda intacta).
    if tiene("/UPDATE") {
        if let Some(existente) = sistema::instalacion_existente().filter(|e| sistema::es_instalacion(&e.carpeta)) {
            let idioma = existente.idioma.clone().filter(|i| i == "en").unwrap_or_else(|| "es".into());
            let escritorio = dirs::desktop_dir().is_some_and(|d| d.join("Vydex.lnk").exists());
            let resultado = paquete::verificar()
                .map_err(|e| e.to_string())
                .and_then(|_| sistema::instalar(&existente.carpeta, escritorio, &idioma, env!("VYDEX_VERSION"), |_, _, _| {}));
            let _ = sistema::abrir_vydex(&existente.carpeta);
            std::process::exit(if resultado.is_ok() { 0 } else { 1 });
        }
        // Sin instalación previa: sigue el instalador normal, con su ventana.
    }

    let temporal = tiene("--temporal");
    // Solo es desinstalador si se pide o si el archivo se llama así. Un instalador dañado o
    // incompleto ya no se abre como desinstalador: muestra el error y pide descargarlo de nuevo.
    let modo_desinstalar = tiene("--desinstalar") || es_el_desinstalador();

    if modo_desinstalar && !temporal && sistema::relanzar_desde_temporal().is_ok() {
        return;
    }
    if !sistema::webview2_disponible() {
        sistema::pedir_webview2();
        return;
    }

    let error = if modo_desinstalar {
        None
    } else {
        paquete::verificar().err().map(|e| e.to_string())
    };
    let carpeta = args.windows(2).find(|w| w[0] == "--carpeta").map(|w| PathBuf::from(&w[1]));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Estado {
            desinstalar: modo_desinstalar,
            carpeta,
            error,
            instalado_en: Mutex::new(None),
        })
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("instalador.html".into()))
                .title("Vydex")
                .inner_size(780.0, 540.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .shadow(true)
                .center()
                .background_color(Color(11, 11, 12, 255))
                // Los datos del visor web van a la carpeta temporal: el instalador no deja restos.
                .data_directory(std::env::temp_dir().join("vydex-instalador-webview"))
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![info, instalar, desinstalar, abrir_vydex, salir])
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar el instalador de Vydex")
        .run(move |_, evento| {
            if let RunEvent::Exit = evento {
                if temporal {
                    sistema::borrar_al_salir();
                }
            }
        });
}
