#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    // Iniciado pelo navegador como host de Native Messaging: sem janela.
    let args: Vec<String> = std::env::args().collect();
    if qypher_desktop::native_host::launched_by_browser(&args) {
        qypher_desktop::native_host::run();
        return;
    }
    qypher_desktop::run()
}
