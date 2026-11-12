mod datos;
mod descarga;
mod motor;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let constructor = tauri::Builder::default();
    // Debe ir primero: si Vydex ya está abierto, la segunda instancia se cierra al instante y la
    // ventana existente vuelve al frente. En macOS no se usa: el sistema ya reutiliza la app
    // abierta, y el plugin usa allí un canal fijo en /tmp que otra cuenta podría ocupar para
    // impedir que Vydex abra.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let constructor = constructor.plugin(tauri_plugin_single_instance::init(|app, _args, _carpeta| {
        if let Some(ventana) = app.get_webview_window("main") {
            let _ = ventana.unminimize();
            let _ = ventana.show();
            let _ = ventana.set_focus();
        }
    }));
    // Actualizaciones: el actualizador verifica la firma de cada versión con la clave pública de
    // tauri.conf.json antes de instalarla.
    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    let constructor = constructor
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    constructor
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(descarga::Procesos::default())
        .manage(datos::Datos::default())
        .setup(|app| {
            // Preparar los motores nunca detiene el arranque: si algo falla, la interfaz lo
            // informa al intentar analizar o descargar.
            let motores = motor::Motores::preparar(app.handle());
            tauri::async_runtime::spawn(motor::renovar_ytdlp(motores.clone()));
            app.manage(motores);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            datos::leer_datos,
            datos::guardar_datos,
            descarga::analizar,
            descarga::descargar,
            descarga::detener,
            descarga::limpiar_temporales,
            descarga::probar_carpeta,
            descarga::abrir,
            descarga::existen,
            motor::estado_motor,
            motor::actualizar_motor,
            motor::idioma_instalado,
            motor::abrir_licencias,
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar Vydex")
        .run(|app, evento| {
            if let tauri::RunEvent::Exit = evento {
                app.state::<descarga::Procesos>().terminar_todos();
            }
        });
}
