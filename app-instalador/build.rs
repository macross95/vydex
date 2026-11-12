fn main() {
    // Windows: las DLL de las que depende el instalador se cargan solo desde System32, nunca
    // desde su propia carpeta (suele ser Descargas, donde alguien podría dejar una DLL falsa).
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-bins=/DEPENDENTLOADFLAG:0x800");
    }
    // La versión vive solo en app/package.json; la actualización silenciosa la necesita sin
    // abrir la ventana del instalador.
    let paquete = std::fs::read_to_string("../app/package.json").expect("falta app/package.json");
    let version = paquete
        .split("\"version\"")
        .nth(1)
        .and_then(|resto| resto.split('"').nth(1))
        .expect("app/package.json no tiene versión");
    println!("cargo:rustc-env=VYDEX_VERSION={version}");
    println!("cargo:rerun-if-changed=../app/package.json");
    tauri_build::build()
}
