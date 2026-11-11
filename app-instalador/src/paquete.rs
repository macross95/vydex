//! Paquete con los archivos de Vydex, pegado al final del ejecutable del instalador:
//!
//!   [instalador.exe] [paquete.zip] [largo del zip: u64 little-endian] [b"VYDEXPKG"] [firma]
//!
//! [firma] es la firma digital de Windows (Authenticode) si el .exe final está firmado: signtool
//! la agrega al final del archivo (alineada a 8 bytes con ceros), así que el pie del paquete se
//! busca justo antes de ella. Así el instalador sigue siendo un solo archivo aunque se firme.

use std::fs::{File, OpenOptions};
use std::io::{self, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};

const MAGIA: &[u8; 8] = b"VYDEXPKG";
const PIE: u64 = 16;
/// Ceros que signtool puede agregar antes de la firma para alinearla a 8 bytes.
const RELLENO_MAXIMO: usize = 7;

#[derive(Debug, PartialEq)]
pub struct Ubicacion {
    pub inicio: u64,
    pub largo: u64,
}

/// Posición, dentro del archivo, de la entrada de la tabla de certificados (la firma
/// Authenticode) en la cabecera PE. `None` si el archivo no es un ejecutable PE.
fn entrada_de_firma<R: Read + Seek>(r: &mut R) -> io::Result<Option<u64>> {
    let mut b4 = [0u8; 4];
    let mut b2 = [0u8; 2];
    r.seek(SeekFrom::Start(0x3C))?;
    r.read_exact(&mut b4)?;
    let pe = u64::from(u32::from_le_bytes(b4));
    r.seek(SeekFrom::Start(pe))?;
    r.read_exact(&mut b4)?;
    if &b4 != b"PE\0\0" {
        return Ok(None);
    }
    // Cabecera opcional: después de la firma "PE\0\0" (4 bytes) y la cabecera COFF (20 bytes).
    let opcional = pe + 24;
    r.seek(SeekFrom::Start(opcional))?;
    r.read_exact(&mut b2)?;
    // (posición de NumberOfRvaAndSizes, posición del primer directorio)
    let (cantidad, directorios) = match u16::from_le_bytes(b2) {
        0x10b => (opcional + 92, opcional + 96),   // PE32
        0x20b => (opcional + 108, opcional + 112), // PE32+ (64 bits)
        _ => return Ok(None),
    };
    r.seek(SeekFrom::Start(cantidad))?;
    r.read_exact(&mut b4)?;
    if u32::from_le_bytes(b4) < 5 {
        return Ok(None);
    }
    // El directorio 4 (IMAGE_DIRECTORY_ENTRY_SECURITY) mide 8 bytes: posición y tamaño.
    Ok(Some(directorios + 4 * 8))
}

/// Posición y tamaño de la firma, según la cabecera PE.
fn firma<R: Read + Seek>(r: &mut R) -> io::Result<Option<(u64, u64, u64)>> {
    let Some(entrada) = entrada_de_firma(r)? else { return Ok(None) };
    let mut d = [0u8; 8];
    r.seek(SeekFrom::Start(entrada))?;
    r.read_exact(&mut d)?;
    let pos = u64::from(u32::from_le_bytes([d[0], d[1], d[2], d[3]]));
    let largo = u64::from(u32::from_le_bytes([d[4], d[5], d[6], d[7]]));
    Ok((pos > 0 && largo > 0).then_some((entrada, pos, largo)))
}

/// Busca el pie del paquete justo antes de `fin`, saltando el relleno de ceros de signtool.
fn pie_antes_de<R: Read + Seek>(r: &mut R, fin: u64) -> io::Result<Option<Ubicacion>> {
    let ventana = (PIE as usize + RELLENO_MAXIMO).min(usize::try_from(fin).unwrap_or(usize::MAX));
    if ventana < PIE as usize {
        return Ok(None);
    }
    let desde = fin - ventana as u64;
    let mut buf = vec![0u8; ventana];
    r.seek(SeekFrom::Start(desde))?;
    r.read_exact(&mut buf)?;
    let mut corte = buf.len();
    while corte > PIE as usize && buf.len() - corte < RELLENO_MAXIMO && buf[corte - 1] == 0 {
        corte -= 1;
    }
    let pie = &buf[corte - PIE as usize..corte];
    if &pie[8..16] != MAGIA {
        return Ok(None);
    }
    let largo = u64::from_le_bytes(pie[0..8].try_into().expect("8 bytes"));
    let fin_pie = desde + corte as u64;
    if largo.checked_add(PIE).is_none_or(|n| n > fin_pie) {
        return Err(io::Error::other("PAQUETE_DANADO"));
    }
    Ok(Some(Ubicacion { inicio: fin_pie - PIE - largo, largo }))
}

/// Dónde está el paquete en un ejecutable de `total` bytes: antes de la firma (si la tiene y
/// está al final) o al final del archivo.
fn ubicar_en<R: Read + Seek>(r: &mut R, total: u64) -> io::Result<Ubicacion> {
    let mut fines = Vec::with_capacity(2);
    if let Ok(Some((_, pos, largo))) = firma(r) {
        if pos.checked_add(largo) == Some(total) {
            fines.push(pos);
        }
    }
    fines.push(total);
    for fin in fines {
        if let Some(u) = pie_antes_de(r, fin)? {
            return Ok(u);
        }
    }
    Err(io::Error::other("PAQUETE_FALTA"))
}

/// Dónde está el paquete dentro del ejecutable actual.
pub fn ubicar() -> io::Result<Ubicacion> {
    let mut archivo = File::open(std::env::current_exe()?)?;
    let total = archivo.metadata()?.len();
    ubicar_en(&mut archivo, total)
}

/// Lector limitado a un tramo del archivo: el zip ve solo su parte.
struct Tramo {
    archivo: File,
    inicio: u64,
    largo: u64,
    pos: u64,
}

impl Read for Tramo {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let resto = self.largo.saturating_sub(self.pos);
        if resto == 0 || buf.is_empty() {
            return Ok(0);
        }
        let n = buf.len().min(usize::try_from(resto).unwrap_or(usize::MAX));
        self.archivo.seek(SeekFrom::Start(self.inicio + self.pos))?;
        let leido = self.archivo.read(&mut buf[..n])?;
        self.pos += leido as u64;
        Ok(leido)
    }
}

impl Seek for Tramo {
    fn seek(&mut self, desde: SeekFrom) -> io::Result<u64> {
        let nueva = match desde {
            SeekFrom::Start(n) => i128::from(n),
            SeekFrom::End(n) => i128::from(self.largo) + i128::from(n),
            SeekFrom::Current(n) => i128::from(self.pos) + i128::from(n),
        };
        if nueva < 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "posición negativa"));
        }
        self.pos = u64::try_from(nueva).map_err(io::Error::other)?;
        Ok(self.pos)
    }
}

fn abrir_zip() -> io::Result<zip::ZipArchive<BufReader<Tramo>>> {
    let u = ubicar()?;
    let archivo = File::open(std::env::current_exe()?)?;
    let tramo = Tramo { archivo, inicio: u.inicio, largo: u.largo, pos: 0 };
    zip::ZipArchive::new(BufReader::with_capacity(1 << 20, tramo)).map_err(|_| io::Error::other("PAQUETE_DANADO"))
}

/// Revisa que el paquete se pueda leer completo (lo usan `--verificar-paquete` y la interfaz).
pub fn verificar() -> io::Result<usize> {
    let zip = abrir_zip()?;
    if zip.is_empty() || zip.index_for_name("vydex.exe").is_none() {
        return Err(io::Error::other("PAQUETE_DANADO"));
    }
    Ok(zip.len())
}

/// Tamaño de Vydex ya instalado (suma de los archivos sin comprimir).
pub fn tamano_total() -> u64 {
    let Ok(mut zip) = abrir_zip() else { return 0 };
    (0..zip.len())
        .filter_map(|i| zip.by_index_raw(i).ok().map(|f| f.size()))
        .sum()
}

/// Extrae todos los archivos en `destino` y devuelve sus rutas relativas.
/// Solo se aceptan rutas dentro de `destino` (sin "..", sin unidades ni raíces).
pub fn extraer(destino: &Path, mut progreso: impl FnMut(u64, u64, &str)) -> io::Result<Vec<PathBuf>> {
    let mut zip = abrir_zip()?;
    let total: u64 = (0..zip.len())
        .filter_map(|i| zip.by_index_raw(i).ok().map(|f| f.size()))
        .sum();
    let mut hecho = 0u64;
    let mut archivos = Vec::new();
    let mut buf = vec![0u8; 256 * 1024];

    for i in 0..zip.len() {
        let mut entrada = zip.by_index(i).map_err(|_| io::Error::other("PAQUETE_DANADO"))?;
        let Some(nombre) = entrada.enclosed_name() else { continue };
        let relativa: PathBuf = nombre
            .components()
            .filter(|c| matches!(c, Component::Normal(_)))
            .collect();
        if relativa.as_os_str().is_empty() {
            continue;
        }
        let ruta = destino.join(&relativa);
        if entrada.is_dir() {
            std::fs::create_dir_all(&ruta)?;
            continue;
        }
        if let Some(padre) = ruta.parent() {
            std::fs::create_dir_all(padre)?;
        }
        let texto = relativa.to_string_lossy().to_string();
        let mut salida = BufWriter::new(File::create(&ruta)?);
        loop {
            let n = entrada.read(&mut buf)?;
            if n == 0 {
                break;
            }
            salida.write_all(&buf[..n])?;
            hecho += n as u64;
            progreso(hecho, total, &texto);
        }
        salida.flush()?;
        archivos.push(relativa);
    }
    Ok(archivos)
}

/// Copia este mismo programa sin el paquete: así queda el desinstalador (unos pocos MB).
pub fn copiar_desinstalador(destino: &Path) -> io::Result<()> {
    let exe = std::env::current_exe()?;
    let largo = match ubicar() {
        Ok(u) => u.inicio,
        Err(_) => std::fs::metadata(&exe)?.len(),
    };
    {
        let mut origen = File::open(&exe)?.take(largo);
        let mut salida = BufWriter::new(File::create(destino)?);
        io::copy(&mut origen, &mut salida)?;
        salida.flush()?;
    }
    // Si el instalador estaba firmado, la cabecera de la copia apunta a una firma que quedó
    // fuera de ella: se borra esa referencia para que sea un ejecutable válido (sin firma).
    let mut copia = OpenOptions::new().read(true).write(true).open(destino)?;
    let total = copia.metadata()?.len();
    if let Ok(Some((entrada, pos, tam))) = firma(&mut copia) {
        if pos.checked_add(tam).is_none_or(|fin| fin > total) {
            copia.seek(SeekFrom::Start(entrada))?;
            copia.write_all(&[0u8; 8])?;
        }
    }
    copia.flush()
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use std::io::Cursor;

    /// Ejecutable PE32+ mínimo: lo justo para que `entrada_de_firma` lo reconozca.
    fn ejecutable_minimo() -> Vec<u8> {
        let mut pe = vec![0u8; 0x200];
        pe[0..2].copy_from_slice(b"MZ");
        pe[0x3C..0x40].copy_from_slice(&0x80u32.to_le_bytes());
        pe[0x80..0x84].copy_from_slice(b"PE\0\0");
        let opcional = 0x80 + 24;
        pe[opcional..opcional + 2].copy_from_slice(&0x20bu16.to_le_bytes());
        pe[opcional + 108..opcional + 112].copy_from_slice(&16u32.to_le_bytes());
        pe
    }

    fn con_paquete(mut exe: Vec<u8>, zip: &[u8]) -> (Vec<u8>, Ubicacion) {
        let inicio = exe.len() as u64;
        exe.extend_from_slice(zip);
        exe.extend_from_slice(&(zip.len() as u64).to_le_bytes());
        exe.extend_from_slice(MAGIA);
        (exe, Ubicacion { inicio, largo: zip.len() as u64 })
    }

    /// Imita a signtool: alinea a 8 bytes con ceros, agrega la firma y anota su posición.
    fn firmar(mut exe: Vec<u8>, tam_firma: usize) -> Vec<u8> {
        while exe.len() % 8 != 0 {
            exe.push(0);
        }
        let pos = exe.len() as u32;
        exe.extend(std::iter::repeat_n(0xAB, tam_firma));
        let entrada = 0x80 + 24 + 112 + 4 * 8;
        exe[entrada..entrada + 4].copy_from_slice(&pos.to_le_bytes());
        exe[entrada + 4..entrada + 8].copy_from_slice(&(tam_firma as u32).to_le_bytes());
        exe
    }

    fn ubicar_bytes(datos: &[u8]) -> io::Result<Ubicacion> {
        ubicar_en(&mut Cursor::new(datos), datos.len() as u64)
    }

    #[test]
    fn encuentra_el_paquete_sin_firma() {
        let (exe, esperado) = con_paquete(ejecutable_minimo(), b"PK-contenido-del-zip");
        assert_eq!(ubicar_bytes(&exe).unwrap(), esperado);
    }

    #[test]
    fn encuentra_el_paquete_con_firma_y_relleno() {
        // 21 bytes de zip: el total no es múltiplo de 8, así que "signtool" agrega relleno.
        let (exe, esperado) = con_paquete(ejecutable_minimo(), b"PK-zip-de-21-bytes!!!");
        assert_ne!(exe.len() % 8, 0);
        let firmado = firmar(exe, 2_000);
        assert_eq!(ubicar_bytes(&firmado).unwrap(), esperado);
    }

    #[test]
    fn sin_paquete_es_error_y_no_desinstalador() {
        let e = ubicar_bytes(&ejecutable_minimo()).unwrap_err();
        assert_eq!(e.to_string(), "PAQUETE_FALTA");
        let e = ubicar_bytes(&firmar(ejecutable_minimo(), 512)).unwrap_err();
        assert_eq!(e.to_string(), "PAQUETE_FALTA");
    }

    #[test]
    fn largo_imposible_es_paquete_danado() {
        let mut exe = ejecutable_minimo();
        exe.extend_from_slice(&u64::MAX.to_le_bytes());
        exe.extend_from_slice(MAGIA);
        assert_eq!(ubicar_bytes(&exe).unwrap_err().to_string(), "PAQUETE_DANADO");
    }
}
