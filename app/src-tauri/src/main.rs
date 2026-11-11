// Evita que se abra una consola extra en Windows al ejecutar la versión final.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vydex_lib::run()
}
