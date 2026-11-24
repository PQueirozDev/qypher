use scanner_core::*;
use scanner_http::ScanCancellation;
use scanner_storage::Store;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
mod lab_commands;
pub mod native_host;
mod source_commands;

/// URL vinda da extensão (`--scan-url`), consumida uma vez pela interface.
static PENDING_SCAN_URL: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
fn take_scan_url() -> Option<String> {
    PENDING_SCAN_URL.lock().ok().and_then(|mut v| v.take())
}

#[tauri::command]
fn browser_integration_status() -> native_host::IntegrationStatus {
    native_host::status()
}

#[tauri::command]
fn set_browser_integration(enabled: bool) -> Result<native_host::IntegrationStatus, String> {
    if enabled {
        native_host::enable()
    } else {
        native_host::disable()
    }
}

// Static milestones help diagnose desktop startup without recording target data or paths.
#[cfg(debug_assertions)]
fn startup(step: &str) {
    eprintln!("[Qypher startup] {step}");
}
#[cfg(not(debug_assertions))]
fn startup(_: &str) {}

struct Active {
    id: String,
    cancel: ScanCancellation,
}
struct AppState {
    db: PathBuf,
    active: Mutex<Option<Active>>,
    mutations: tokio::sync::Mutex<()>,
    source_target: Mutex<Option<(String, PathBuf)>>,
    exit_after_cancel: AtomicBool,
}

#[tauri::command]
fn window_action(action: String, window: tauri::Window) -> Result<(), String> {
    match action.as_str() {
        "minimize" => window.minimize(),
        "maximize" => {
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" => window.close(),
        _ => return Err("Ação de janela desconhecida.".into()),
    }
    .map_err(|e| e.to_string())
}

async fn with_store<T: Send + 'static>(
    path: PathBuf,
    f: impl FnOnce(Store) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(Store::open(path)?))
        .await
        .map_err(|_| "Falha na tarefa de armazenamento.".to_string())?
}
#[tauri::command]
async fn snapshot(state: State<'_, AppState>) -> Result<Snapshot, String> {
    let result = with_store(state.db.clone(), |s| s.snapshot()).await;
    if result.is_ok() {
        startup("snapshot_ready");
    }
    result
}
#[tauri::command]
async fn create_project(
    name: String,
    url: String,
    state: State<'_, AppState>,
) -> Result<Project, String> {
    with_store(state.db.clone(), move |s| s.create_project(&name, &url)).await
}
#[tauri::command]
async fn start_scan(
    mut config: ScanConfig,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let _guard = state.mutations.lock().await;
    let url = config.validate().map_err(|e| e.to_string())?;
    config.url = url.to_string();
    let projects = with_store(state.db.clone(), |s| Ok(s.snapshot()?.projects)).await?;
    let project = projects
        .iter()
        .find(|p| p.id == config.project_id)
        .ok_or("Projeto não encontrado.")?;
    if parse_target(&project.url)
        .map_err(|e| e.to_string())?
        .origin()
        != url.origin()
    {
        return Err("A origem do alvo deve coincidir com a do projeto.".into());
    }
    let scan = Scan::new(config);
    let id = scan.id.clone();
    let cancel = ScanCancellation::new();
    {
        let mut active = state
            .active
            .lock()
            .map_err(|_| "Falha no controle de execução.")?;
        if active.is_some() {
            return Err("Já existe uma auditoria em execução.".into());
        }
        *active = Some(Active {
            id: id.clone(),
            cancel: cancel.clone(),
        });
    }
    let initial = scan.clone();
    if let Err(e) = with_store(state.db.clone(), move |s| s.save_scan(&initial)).await {
        *state
            .active
            .lock()
            .map_err(|_| "Falha no controle de execução.")? = None;
        return Err(e);
    }
    let db = state.db.clone();
    tauri::async_runtime::spawn(async move {
        let _ = app.emit("scan-progress", &scan);
        let scan = scanner_http::run(scan, cancel, |progress| {
            if progress.status == ScanStatus::Running {
                let _ = app.emit("scan-progress", progress);
            }
        })
        .await;
        let save_scan = scan.clone();
        let saved = with_store(db, move |s| s.save_scan(&save_scan)).await;
        // Unlock before final event so a new scan can start from the completion view.
        if let Ok(mut active) = app.state::<AppState>().active.lock() {
            *active = None;
        }
        if let Err(error) = saved {
            let _ = app.emit(
                "storage-error",
                format!("Não foi possível salvar o resultado: {error}"),
            );
        }
        let _ = app.emit("scan-finished", &scan);
        if app
            .state::<AppState>()
            .exit_after_cancel
            .load(Ordering::Acquire)
        {
            app.exit(0);
        }
    });
    Ok(id)
}
#[tauri::command]
fn cancel_scan(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "Falha no controle de execução.")?;
    if let Some(a) = active.as_ref().filter(|a| a.id == id) {
        a.cancel.cancel();
        Ok(())
    } else {
        Err("Nenhuma execução ativa com este ID.".into())
    }
}
#[tauri::command]
async fn purge_samples(id: String, state: State<'_, AppState>) -> Result<usize, String> {
    let _guard = state.mutations.lock().await;
    with_store(state.db.clone(), move |s| s.purge_samples(&id)).await
}
#[tauri::command]
async fn delete_scan(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let _guard = state.mutations.lock().await;
    if state
        .active
        .lock()
        .map_err(|_| "Falha no controle de execução.")?
        .is_some()
    {
        return Err("Aguarde o encerramento da auditoria antes de excluir dados.".into());
    }
    with_store(state.db.clone(), move |s| s.delete_scan(&id)).await
}
#[tauri::command]
async fn delete_project(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let _guard = state.mutations.lock().await;
    if state
        .active
        .lock()
        .map_err(|_| "Falha no controle de execução.")?
        .is_some()
    {
        return Err("Aguarde o encerramento da auditoria antes de excluir dados.".into());
    }
    with_store(state.db.clone(), move |s| s.delete_project(&id)).await
}
#[tauri::command]
async fn compare_scans(
    before: String,
    after: String,
    state: State<'_, AppState>,
) -> Result<Comparison, String> {
    with_store(state.db.clone(), move |s| {
        compare(&s.scan(&before)?, &s.scan(&after)?)
    })
    .await
}
#[tauri::command]
async fn export_scan(
    id: String,
    format: String,
    redact: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    if !matches!(format.as_str(), "json" | "html" | "pdf") {
        return Err("Formato inválido.".into());
    }
    let report = with_store(state.db.clone(), move |s| {
        let scan = s.scan(&id)?;
        if scan.status == ScanStatus::Running {
            return Err("Finalize a auditoria antes de exportar.".into());
        }
        let p = s
            .snapshot()?
            .projects
            .into_iter()
            .find(|p| p.id == scan.config.project_id)
            .ok_or("Projeto não encontrado.")?;
        Ok(scanner_report::build(&p, &scan, redact))
    })
    .await?;
    tauri::async_runtime::spawn_blocking(move || {
        let destination = app
            .dialog()
            .file()
            .add_filter("Qypher report", &[format.as_str()])
            .set_file_name(format!("qypher-{}.{}", &report.scan.id[..8], format))
            .blocking_save_file();
        let Some(destination) = destination else {
            return Ok(None);
        };
        let path = destination
            .into_path()
            .map_err(|_| "Destino não é um caminho local.".to_string())?;
        let bytes = match format.as_str() {
            "json" => scanner_report::json(&report)?,
            "html" => scanner_report::html(&report),
            _ => scanner_report::pdf(&report)?,
        };
        std::fs::write(&path, bytes)
            .map_err(|_| "Não foi possível escrever no destino selecionado.".to_string())?;
        Ok(Some(path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|_| "Falha ao exportar relatório.".to_string())?
}

pub fn run() {
    startup("runtime_build");
    if let Some(url) = native_host::scan_url_from_args(&std::env::args().collect::<Vec<_>>()) {
        if let Ok(mut pending) = PENDING_SCAN_URL.lock() {
            *pending = Some(url);
        }
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if let Some(url) = native_host::scan_url_from_args(&args) {
                if let Ok(mut pending) = PENDING_SCAN_URL.lock() {
                    *pending = Some(url.clone());
                }
                let _ = app.emit("scan-url", url);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_page_load(|_, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                startup("frontend_navigation_finished");
            }
        })
        .setup(|app| {
            startup("setup_entered");
            #[cfg(debug_assertions)]
            let data = if let Some(directory) = std::env::var_os("QYPHER_PREVIEW_DATA_DIR") {
                let path = PathBuf::from(directory);
                if !path.is_absolute() {
                    return Err(std::io::Error::other(
                        "O perfil de prévia precisa de um caminho absoluto.",
                    )
                    .into());
                }
                path
            } else {
                app.path().app_data_dir()?
            };
            #[cfg(not(debug_assertions))]
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let db = data.join("qypher.db");
            Store::open(&db)
                .and_then(|s| s.interrupt_abandoned())
                .map_err(std::io::Error::other)?;
            app.manage(AppState {
                db,
                active: Mutex::new(None),
                mutations: tokio::sync::Mutex::new(()),
                source_target: Mutex::new(None),
                exit_after_cancel: AtomicBool::new(false),
            });
            startup("store_ready");
            // Atualização automática: verifica as releases assinadas e instala em segundo plano.
            #[cfg(not(debug_assertions))]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    use tauri_plugin_updater::UpdaterExt;
                    if let Ok(updater) = handle.updater() {
                        if let Ok(Some(update)) = updater.check().await {
                            if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                                handle.restart();
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_scan_url,
            browser_integration_status,
            set_browser_integration,
            snapshot,
            create_project,
            start_scan,
            cancel_scan,
            delete_scan,
            purge_samples,
            delete_project,
            compare_scans,
            export_scan,
            window_action,
            source_commands::pick_repository,
            source_commands::source_history,
            source_commands::start_source,
            source_commands::delete_source,
            source_commands::export_source,
            source_commands::antivirus_status,
            source_commands::source_reviews,
            source_commands::review_source,
            source_commands::source_predeploy,
            lab_commands::start_lab,
            lab_commands::lab_history,
            lab_commands::delete_lab,
            lab_commands::export_lab
        ])
        .build(tauri::generate_context!())
        .expect("Não foi possível iniciar Qypher");
    startup("runtime_built");
    app.run(|app, event| {
        if let tauri::RunEvent::Ready = event {
            startup("event_loop_ready");
        }
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if let Ok(active) = app.state::<AppState>().active.lock() {
                if let Some(a) = active.as_ref() {
                    api.prevent_exit();
                    app.state::<AppState>()
                        .exit_after_cancel
                        .store(true, Ordering::Release);
                    a.cancel.cancel();
                }
            }
        }
    });
}
