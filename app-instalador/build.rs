fn main() {
    // Windows: las DLL de las que depende el instalador se cargan solo desde System32, nunca
    // desde su propia carpeta (suele ser Descargas, donde alguien podría dejar una DLL falsa).
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-bins=/DEPENDENTLOADFLAG:0x800");
    }
    tauri_build::build()
}
