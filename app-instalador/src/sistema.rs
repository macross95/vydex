//! Tareas de sistema del instalador en Windows: carpeta, accesos directos, registro de
//! "Aplicaciones instaladas", cierre de Vydex y requisitos (WebView2).

use crate::paquete;
use std::io;
use std::os::windows::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use winreg::RegKey;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

const SIN_VENTANA: u32 = 0x0800_0000;
const CLAVE_DESINSTALAR: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Vydex";
const CLAVE_PROPIA: &str = r"Software\MacrosS\Vydex";
pub const DESINSTALADOR: &str = "Desinstalar Vydex.exe";
const MANIFIESTO: &str = "instalacion.txt";
/// Subcarpeta donde se extrae la versión nueva antes de reemplazar la anterior.
const CARPETA_NUEVA: &str = ".instalacion-nueva";
const LINKEDIN: &str = "https://www.linkedin.com/in/felipelucero/";

pub fn carpeta_predeterminada() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("Vydex")
}

/// Una carpeta es una instalación de Vydex si tiene su manifiesto o su programa. Desinstalar y
/// limpiar solo actúan sobre carpetas así: nunca sobre una carpeta cualquiera.
pub fn es_instalacion(carpeta: &Path) -> bool {
    carpeta.join(MANIFIESTO).is_file() || carpeta.join("vydex.exe").is_file()
}

pub struct Existente {
    pub carpeta: PathBuf,
    pub version: Option<String>,
    pub idioma: Option<String>,
}

/// Ruta del programa en un comando del registro: "C:\x\y.exe" --opcion → C:\x\y.exe
fn ruta_de_comando(comando: &str) -> PathBuf {
    let c = comando.trim();
    let ruta = match c.strip_prefix('"') {
        Some(resto) => resto.split('"').next().unwrap_or(resto),
        None => c.split(" --").next().unwrap_or(c),
    };
    PathBuf::from(ruta)
}

/// Instalación previa de Vydex (de este instalador o del instalador clásico).
pub fn instalacion_existente() -> Option<Existente> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let clave = hkcu.open_subkey(CLAVE_DESINSTALAR).ok()?;
    let propia = hkcu.open_subkey(CLAVE_PROPIA).ok();
    let carpeta = clave
        .get_value::<String, _>("InstallLocation")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| propia.as_ref().and_then(|k| k.get_value::<String, _>("").ok()).map(PathBuf::from))
        .or_else(|| {
            clave
                .get_value::<String, _>("UninstallString")
                .ok()
                .and_then(|u| ruta_de_comando(&u).parent().map(Path::to_path_buf))
        })?;
    Some(Existente {
        carpeta,
        version: clave.get_value("DisplayVersion").ok(),
        idioma: propia.and_then(|k| k.get_value("Idioma").ok()),
    })
}

/// Carpeta a desinstalar: la del desinstalador si es una instalación; si no, la registrada en
/// Windows si es una instalación. `None` si no hay ninguna (no se toca nada).
pub fn carpeta_para_desinstalar(preferida: Option<&Path>) -> Option<PathBuf> {
    preferida
        .filter(|c| es_instalacion(c))
        .map(Path::to_path_buf)
        .or_else(|| instalacion_existente().map(|e| e.carpeta).filter(|c| es_instalacion(c)))
}

/// Carpeta de Windows o System32 según el sistema (nunca la carpeta del instalador).
fn carpeta_de_windows(system32: bool) -> PathBuf {
    use windows_sys::Win32::System::SystemInformation::{GetSystemDirectoryW, GetWindowsDirectoryW};
    let mut buf = [0u16; 260];
    let n = unsafe {
        if system32 { GetSystemDirectoryW(buf.as_mut_ptr(), buf.len() as u32) } else { GetWindowsDirectoryW(buf.as_mut_ptr(), buf.len() as u32) }
    } as usize;
    if n > 0 && n < buf.len() {
        PathBuf::from(String::from_utf16_lossy(&buf[..n]))
    } else if system32 {
        PathBuf::from(r"C:\Windows\System32")
    } else {
        PathBuf::from(r"C:\Windows")
    }
}

/// Programa de System32 por su ruta completa. Por nombre, Windows lo buscaría primero en la
/// carpeta del instalador (normalmente Descargas), donde alguien podría dejar uno falso.
fn de_system32(programa: &str) -> PathBuf {
    carpeta_de_windows(true).join(programa)
}

fn comando(programa: &str) -> Command {
    let mut c = Command::new(de_system32(programa));
    c.creation_flags(SIN_VENTANA).stdin(Stdio::null()).stderr(Stdio::null());
    c
}

pub fn vydex_abierto() -> bool {
    comando("tasklist.exe")
        .args(["/FI", "IMAGENAME eq vydex.exe", "/NH", "/FO", "CSV"])
        .output()
        .map(|s| String::from_utf8_lossy(&s.stdout).to_lowercase().contains("\"vydex.exe\""))
        .unwrap_or(false)
}

/// Cierra Vydex y sus descargas en curso (yt-dlp y FFmpeg son procesos hijos).
pub fn cerrar_vydex() {
    let _ = comando("taskkill.exe").args(["/IM", "vydex.exe", "/F", "/T"]).stdout(Stdio::null()).status();
    std::thread::sleep(Duration::from_millis(700));
}

pub fn abrir_vydex(carpeta: &Path) -> io::Result<()> {
    Command::new(carpeta.join("vydex.exe")).current_dir(carpeta).spawn().map(|_| ())
}

fn error_legible(e: io::Error) -> String {
    match e.kind() {
        io::ErrorKind::PermissionDenied => "SIN_PERMISO".into(),
        io::ErrorKind::StorageFull => "SIN_ESPACIO".into(),
        _ => e.to_string(),
    }
}

/// Ruta relativa segura (sin "..", unidades ni raíces), o `None`.
fn relativa_segura(texto: &str) -> Option<&Path> {
    let rel = Path::new(texto.trim());
    let segura = !rel.as_os_str().is_empty() && rel.components().all(|c| matches!(c, Component::Normal(_)));
    segura.then_some(rel)
}

/// Quita las subcarpetas vacías (de adentro hacia afuera). No toca la carpeta raíz.
fn quitar_vacias(carpeta: &Path) {
    let Ok(entradas) = std::fs::read_dir(carpeta) else { return };
    for e in entradas.flatten() {
        let ruta = e.path();
        if ruta.is_dir() {
            quitar_vacias(&ruta);
            let _ = std::fs::remove_dir(&ruta);
        }
    }
}

/// Quita los archivos de una instalación anterior. Con manifiesto, solo lo que se instaló;
/// sin él (instalador clásico), sus archivos conocidos. Nunca borra archivos ajenos.
/// Devuelve los archivos que no se pudieron borrar (por ejemplo, porque están en uso).
fn limpiar_instalacion(carpeta: &Path) -> Vec<PathBuf> {
    if !es_instalacion(carpeta) {
        return Vec::new();
    }
    let mut pendientes = Vec::new();
    let mut borrar = |ruta: PathBuf| {
        if ruta.is_file() && std::fs::remove_file(&ruta).is_err() {
            pendientes.push(ruta);
        }
    };
    match std::fs::read_to_string(carpeta.join(MANIFIESTO)) {
        Ok(texto) => texto
            .lines()
            .filter_map(relativa_segura)
            .for_each(|rel| borrar(carpeta.join(rel))),
        Err(_) => {
            for nombre in ["vydex.exe", "uninstall.exe", "idioma.txt", DESINSTALADOR] {
                borrar(carpeta.join(nombre));
            }
            for sub in ["bin", "licencias"] {
                let _ = std::fs::remove_dir_all(carpeta.join(sub));
            }
        }
    }
    quitar_vacias(carpeta);
    pendientes
}

fn menu_inicio() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(r"Microsoft\Windows\Start Menu\Programs"))
}

fn crear_acceso(exe: &Path, carpeta: &Path, destino: &Path) -> Result<(), String> {
    let mut acceso = mslnk::ShellLink::new(exe).map_err(|e| e.to_string())?;
    acceso.set_working_dir(Some(carpeta.display().to_string()));
    acceso.set_icon_location(Some(exe.display().to_string()));
    acceso.create_lnk(destino).map_err(|e| e.to_string())
}

fn accesos_directos(carpeta: &Path, escritorio: bool) -> Result<(), String> {
    let exe = carpeta.join("vydex.exe");
    if let Some(menu) = menu_inicio() {
        let _ = std::fs::create_dir_all(&menu);
        crear_acceso(&exe, carpeta, &menu.join("Vydex.lnk"))?;
    }
    if let Some(esc) = dirs::desktop_dir() {
        let acceso = esc.join("Vydex.lnk");
        if escritorio {
            crear_acceso(&exe, carpeta, &acceso)?;
        } else {
            let _ = std::fs::remove_file(acceso);
        }
    }
    Ok(())
}

/// Registro en "Aplicaciones instaladas" de Windows (por usuario, sin permisos de administrador).
fn registrar(carpeta: &Path, idioma: &str, version: &str, tamano: u64) -> io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (k, _) = hkcu.create_subkey(CLAVE_DESINSTALAR)?;
    let exe = carpeta.join("vydex.exe");
    let desinstalador = carpeta.join(DESINSTALADOR);
    k.set_value("DisplayName", &"Vydex")?;
    k.set_value("DisplayVersion", &version)?;
    k.set_value("Publisher", &"MacrosS")?;
    k.set_value("DisplayIcon", &format!("{},0", exe.display()))?;
    k.set_value("InstallLocation", &carpeta.display().to_string())?;
    k.set_value("UninstallString", &format!("\"{}\" --desinstalar", desinstalador.display()))?;
    k.set_value("URLInfoAbout", &LINKEDIN)?;
    k.set_value("NoModify", &1u32)?;
    k.set_value("NoRepair", &1u32)?;
    k.set_value("EstimatedSize", &u32::try_from(tamano / 1024).unwrap_or(u32::MAX))?;
    // Restos del instalador clásico
    let _ = k.delete_value("QuietUninstallString");

    let (propia, _) = hkcu.create_subkey(CLAVE_PROPIA)?;
    propia.set_value("", &carpeta.display().to_string())?;
    propia.set_value("Idioma", &idioma)?;
    Ok(())
}

/// Mueve un archivo dentro del mismo disco, creando su carpeta y reemplazando el anterior.
fn mover(origen: &Path, destino: &Path) -> io::Result<()> {
    if let Some(padre) = destino.parent() {
        std::fs::create_dir_all(padre)?;
    }
    std::fs::rename(origen, destino)
}

/// SID de la cuenta actual ("S-1-5-21-…"), según whoami.
fn sid_actual() -> Option<String> {
    let salida = comando("whoami.exe").args(["/user", "/fo", "csv", "/nh"]).output().ok()?;
    let texto = String::from_utf8_lossy(&salida.stdout);
    let sid = texto.trim().rsplit(',').next()?.trim().trim_matches('"').to_string();
    (sid.starts_with("S-1-") && sid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).then_some(sid)
}

/// Una carpeta creada fuera del perfil (por ejemplo C:\Vydex) suele heredar permiso de escritura
/// para todas las cuentas del equipo, que podrían cambiar los programas que Vydex ejecuta. Se
/// cortan los permisos heredados y quedan solo la cuenta actual, SYSTEM y Administradores.
fn proteger_carpeta(carpeta: &Path) -> Result<(), String> {
    let sid = sid_actual().ok_or("NO_SE_PROTEGIO")?;
    let estado = comando("icacls.exe")
        .arg(carpeta)
        .args(["/inheritance:r", "/grant:r"])
        .arg(format!("*{sid}:(OI)(CI)F"))
        .args(["*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "/q"])
        .stdout(Stdio::null())
        .status()
        .map_err(|_| "NO_SE_PROTEGIO".to_string())?;
    if estado.success() { Ok(()) } else { Err("NO_SE_PROTEGIO".into()) }
}

/// Instala o actualiza Vydex en `carpeta`. La versión nueva se extrae primero en una carpeta
/// aparte: si algo falla (sin espacio, sin permiso, paquete dañado), la anterior queda intacta.
pub fn instalar(
    carpeta: &Path,
    escritorio: bool,
    idioma: &str,
    version: &str,
    progreso: impl FnMut(u64, u64, &str),
) -> Result<(), String> {
    // Fuera de la carpeta predeterminada (que es privada del usuario), solo se acepta una carpeta
    // nueva, vacía o que ya sea de Vydex: así no se mezcla con archivos ajenos.
    let personalizada = !carpeta.starts_with(dirs::data_local_dir().unwrap_or_default());
    if personalizada && carpeta.exists() && !es_instalacion(carpeta) {
        let vacia = std::fs::read_dir(carpeta).map(|mut d| d.next().is_none()).unwrap_or(false);
        if !vacia {
            return Err("CARPETA_OCUPADA".into());
        }
    }
    if vydex_abierto() {
        cerrar_vydex();
    }
    std::fs::create_dir_all(carpeta).map_err(error_legible)?;
    if personalizada {
        proteger_carpeta(carpeta)?;
    }
    let nueva = carpeta.join(CARPETA_NUEVA);
    let _ = std::fs::remove_dir_all(&nueva);

    // 1. Extraer la versión nueva aparte.
    let extraido = (|| -> io::Result<Vec<PathBuf>> {
        let mut archivos = paquete::extraer(&nueva, progreso)?;
        paquete::copiar_desinstalador(&nueva.join(DESINSTALADOR))?;
        std::fs::write(nueva.join("idioma.txt"), idioma)?;
        archivos.extend([DESINSTALADOR, "idioma.txt"].map(PathBuf::from));
        Ok(archivos)
    })();
    let archivos = match extraido {
        Ok(a) => a,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&nueva);
            return Err(error_legible(e));
        }
    };

    // 2. Reemplazar la anterior: se quita lo que instaló y se mueven los archivos nuevos.
    let _ = limpiar_instalacion(carpeta);
    for rel in &archivos {
        // En el mismo disco, mover solo falla si un archivo anterior sigue en uso.
        mover(&nueva.join(rel), &carpeta.join(rel)).map_err(|_| "ARCHIVOS_EN_USO".to_string())?;
    }
    let _ = std::fs::remove_dir_all(&nueva);

    let mut manifiesto: String = archivos.iter().map(|p| format!("{}\n", p.display())).collect();
    manifiesto.push_str(MANIFIESTO);
    manifiesto.push('\n');
    std::fs::write(carpeta.join(MANIFIESTO), manifiesto).map_err(error_legible)?;

    registrar(carpeta, idioma, version, paquete::tamano_total()).map_err(error_legible)?;
    // Los accesos directos no detienen la instalación: Vydex ya quedó instalado y registrado.
    let _ = accesos_directos(carpeta, escritorio);
    Ok(())
}

/// Desinstala Vydex de `carpeta`, que debe ser una instalación. Si algún archivo no se puede
/// borrar, se avisa y no se quita el registro (así se puede volver a intentar).
pub fn desinstalar(carpeta: &Path, borrar_datos: bool) -> Result<(), String> {
    if !es_instalacion(carpeta) {
        return Err("NO_ES_INSTALACION".into());
    }
    if vydex_abierto() {
        cerrar_vydex();
    }
    if !limpiar_instalacion(carpeta).is_empty() {
        return Err("ARCHIVOS_EN_USO".into());
    }
    let _ = std::fs::remove_dir(carpeta); // solo si quedó vacía

    if let Some(menu) = menu_inicio() {
        let _ = std::fs::remove_file(menu.join("Vydex.lnk"));
    }
    if let Some(esc) = dirs::desktop_dir() {
        let _ = std::fs::remove_file(esc.join("Vydex.lnk"));
    }

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let _ = hkcu.delete_subkey_all(CLAVE_DESINSTALAR);
    let _ = hkcu.delete_subkey_all(CLAVE_PROPIA);
    let _ = hkcu.delete_subkey(r"Software\MacrosS"); // solo si quedó vacía

    if borrar_datos {
        for base in [dirs::data_dir(), dirs::data_local_dir()].into_iter().flatten() {
            let _ = std::fs::remove_dir_all(base.join("com.vydex.app"));
        }
    }
    Ok(())
}

/// El desinstalador se copia a la carpeta temporal y se relanza desde ahí, para poder
/// borrar la carpeta de Vydex (Windows no deja borrar un programa en ejecución).
pub fn relanzar_desde_temporal() -> io::Result<()> {
    let exe = std::env::current_exe()?;
    let carpeta = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    let copia = std::env::temp_dir().join(format!("vydex-desinstalar-{}.exe", std::process::id()));
    std::fs::copy(&exe, &copia)?;
    Command::new(&copia)
        .arg("--desinstalar")
        .arg("--temporal")
        .arg("--carpeta")
        .arg(&carpeta)
        .spawn()
        .map(|_| ())
}

/// Al cerrar el desinstalador temporal, se borra a sí mismo unos segundos después.
/// La ruta va en una variable de entorno: cmd la usa tal cual, sin interpretar % ni &.
pub fn borrar_al_salir() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = Command::new(de_system32("cmd.exe"))
            .creation_flags(SIN_VENTANA)
            .env("VYDEX_BORRAR", &exe)
            .raw_arg("/C ping 127.0.0.1 -n 3 > nul & del /f /q \"%VYDEX_BORRAR%\"")
            .spawn();
    }
}

/// WebView2 (el motor de la interfaz) viene con Windows 11 y casi todos los Windows 10.
pub fn webview2_disponible() -> bool {
    const ID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    let rutas = [
        (HKEY_LOCAL_MACHINE, format!(r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{ID}")),
        (HKEY_LOCAL_MACHINE, format!(r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{ID}")),
        (HKEY_CURRENT_USER, format!(r"Software\Microsoft\EdgeUpdate\Clients\{ID}")),
    ];
    rutas.iter().any(|(raiz, ruta)| {
        RegKey::predef(*raiz)
            .open_subkey(ruta)
            .and_then(|k| k.get_value::<String, _>("pv"))
            .map(|v| !v.is_empty() && v != "0.0.0.0")
            .unwrap_or(false)
    })
}

pub fn pedir_webview2() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONINFORMATION, MB_OK, MessageBoxW};
    let ancho = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let texto = ancho(
        "Vydex necesita Microsoft Edge WebView2, un componente gratuito de Microsoft.\n\
         Se abrirá la página de descarga: instálalo y vuelve a abrir este instalador.\n\n\
         Vydex needs Microsoft Edge WebView2, a free Microsoft component.\n\
         The download page will open: install it and run this installer again.",
    );
    let titulo = ancho("Vydex");
    unsafe {
        MessageBoxW(std::ptr::null_mut(), texto.as_ptr(), titulo.as_ptr(), MB_OK | MB_ICONINFORMATION);
    }
    let _ = Command::new(carpeta_de_windows(false).join("explorer.exe")).arg("https://go.microsoft.com/fwlink/p/?LinkId=2124703").spawn();
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn carpeta_de_prueba(nombre: &str) -> PathBuf {
        let c = std::env::temp_dir().join(format!("vydex-prueba-inst-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&c);
        std::fs::create_dir_all(&c).unwrap();
        c
    }

    #[test]
    fn no_limpia_una_carpeta_que_no_es_instalacion() {
        // Imita la carpeta Descargas: tiene "bin" y "licencias" ajenas y ningún vydex.exe.
        let c = carpeta_de_prueba("ajena");
        std::fs::create_dir_all(c.join("bin")).unwrap();
        std::fs::write(c.join("bin").join("mio.txt"), "no borrar").unwrap();
        std::fs::create_dir_all(c.join("licencias")).unwrap();
        std::fs::create_dir_all(c.join("vacia")).unwrap();
        assert!(!es_instalacion(&c));
        assert!(limpiar_instalacion(&c).is_empty());
        assert!(c.join("bin").join("mio.txt").exists());
        assert!(c.join("licencias").exists() && c.join("vacia").exists());
        assert_eq!(desinstalar(&c, false).unwrap_err(), "NO_ES_INSTALACION");
        assert!(carpeta_para_desinstalar(Some(&c)).is_none_or(|otra| otra != c));
    }

    #[test]
    fn el_manifiesto_no_sale_de_la_carpeta() {
        let c = carpeta_de_prueba("manifiesto");
        let afuera = c.parent().unwrap().join(format!("vydex-prueba-afuera-{}.txt", std::process::id()));
        std::fs::write(&afuera, "no borrar").unwrap();
        std::fs::write(c.join("vydex.exe"), "x").unwrap();
        let rel_afuera = format!("..\\{}", afuera.file_name().unwrap().to_string_lossy());
        // Ni relativa hacia afuera ni absoluta: el archivo de afuera debe sobrevivir.
        std::fs::write(c.join(MANIFIESTO), format!("vydex.exe\n{rel_afuera}\n{}\n", afuera.display())).unwrap();
        assert!(limpiar_instalacion(&c).is_empty());
        assert!(!c.join("vydex.exe").exists());
        assert!(afuera.exists());
        let _ = std::fs::remove_file(afuera);
    }

    #[test]
    fn rutas_relativas_seguras() {
        assert!(relativa_segura("bin\\ffmpeg.exe").is_some());
        assert!(relativa_segura("..\\otro").is_none());
        assert!(relativa_segura("C:\\Windows").is_none());
        assert!(relativa_segura("\\raiz").is_none());
        assert!(relativa_segura("").is_none());
    }
}
