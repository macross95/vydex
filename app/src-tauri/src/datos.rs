//! Ajustes, historial y cola de Vydex en un solo archivo: vydex.json en la carpeta de datos.
//!
//! Reemplaza al plugin "store", que escribía el archivo directamente (un corte de luz a mitad
//! de camino lo dejaba dañado) y, al encontrarlo dañado, partía de cero en silencio: el
//! historial se perdía. Aquí cada guardado escribe un archivo aparte y lo renombra (atómico),
//! y un archivo dañado se aparta con otro nombre en vez de sobrescribirse.

use serde::Serialize;
use serde_json::{Map, Value};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

const ARCHIVO: &str = "vydex.json";
/// El historial completo (1.000 entradas) pesa menos de 1 MB.
const TAMANO_MAXIMO: usize = 16 * 1024 * 1024;

/// Una sola lectura o escritura a la vez.
#[derive(Default)]
pub struct Datos(Arc<Mutex<()>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lectura {
    datos: Value,
    /// Si vydex.json estaba dañado: ruta de la copia apartada.
    copia_danada: Option<String>,
}

fn ruta(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join(ARCHIVO)).map_err(|e| e.to_string())
}

fn leer(ruta: &PathBuf) -> Result<Lectura, String> {
    let vacio = || Value::Object(Map::new());
    let bytes = match std::fs::read(ruta) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Lectura { datos: vacio(), copia_danada: None });
        }
        Err(e) => return Err(e.to_string()),
    };
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(v) if v.is_object() => Ok(Lectura { datos: v, copia_danada: None }),
        _ => {
            let segundos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let copia = ruta.with_file_name(format!("vydex.danado-{segundos}.json"));
            std::fs::rename(ruta, &copia).map_err(|e| e.to_string())?;
            Ok(Lectura { datos: vacio(), copia_danada: Some(copia.display().to_string()) })
        }
    }
}

fn guardar(ruta: &PathBuf, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(carpeta) = ruta.parent() {
        std::fs::create_dir_all(carpeta)?;
    }
    let temporal = ruta.with_extension("json.tmp");
    {
        let mut archivo = std::fs::File::create(&temporal)?;
        archivo.write_all(bytes)?;
        archivo.sync_all()?;
    }
    std::fs::rename(&temporal, ruta)
}

#[tauri::command]
pub async fn leer_datos(app: AppHandle, cerrojo: State<'_, Datos>) -> Result<Lectura, String> {
    let ruta = ruta(&app)?;
    let cerrojo = cerrojo.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guardia = cerrojo.lock().map_err(|e| e.to_string())?;
        leer(&ruta)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn guardar_datos(app: AppHandle, cerrojo: State<'_, Datos>, datos: Value) -> Result<(), String> {
    if !datos.is_object() {
        return Err("DATOS_INVALIDOS".into());
    }
    let bytes = serde_json::to_vec_pretty(&datos).map_err(|e| e.to_string())?;
    if bytes.len() > TAMANO_MAXIMO {
        return Err("DATOS_INVALIDOS".into());
    }
    let ruta = ruta(&app)?;
    let cerrojo = cerrojo.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guardia = cerrojo.lock().map_err(|e| e.to_string())?;
        guardar(&ruta, &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn carpeta_de_prueba(nombre: &str) -> PathBuf {
        let c = std::env::temp_dir().join(format!("vydex-prueba-datos-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&c);
        std::fs::create_dir_all(&c).unwrap();
        c
    }

    #[test]
    fn guarda_y_lee() {
        let ruta = carpeta_de_prueba("ok").join(ARCHIVO);
        guardar(&ruta, br#"{"historial":[1,2]}"#).unwrap();
        let l = leer(&ruta).unwrap();
        assert_eq!(l.datos["historial"][1], 2);
        assert!(l.copia_danada.is_none());
        assert!(!ruta.with_extension("json.tmp").exists());
    }

    #[test]
    fn sin_archivo_parte_vacio() {
        let ruta = carpeta_de_prueba("vacio").join(ARCHIVO);
        let l = leer(&ruta).unwrap();
        assert!(l.datos.as_object().unwrap().is_empty());
    }

    #[test]
    fn archivo_danado_se_aparta_y_no_se_pierde() {
        let carpeta = carpeta_de_prueba("danado");
        let ruta = carpeta.join(ARCHIVO);
        std::fs::write(&ruta, b"{\"historial\": [ {\"titulo\": \"corta").unwrap();
        let l = leer(&ruta).unwrap();
        let copia = PathBuf::from(l.copia_danada.expect("debe apartar la copia"));
        assert!(copia.exists() && !ruta.exists());
        assert!(std::fs::read_to_string(copia).unwrap().contains("corta"));
    }
}
