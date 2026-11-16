use super::{with_store, Active, AppState};
use scanner_core::ScanStatus;
use scanner_source::report::{self, SourceReportFormat};
use scanner_source::{SourceConfig, SourceScan};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceTarget {
    pub token: String,
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub async fn pick_repository(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<SourceTarget>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Selecione uma cópia local autorizada do repositório")
            .blocking_pick_folder()
    })
    .await
    .map_err(|_| "Falha no diálogo de pasta.")?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "A pasta deve estar no disco local.")?;
    let path = scanner_source::engine::validate_root(&path)?;
    let name = path
        .file_name()
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_else(|| "repositório".into());
    let token = uuid::Uuid::new_v4().to_string();
    let target = SourceTarget {
        token: token.clone(),
        name,
        path: path.to_string_lossy().to_string(),
    };
    *state
        .source_target
        .lock()
        .map_err(|_| "Falha no escopo local.")? = Some((token, path));
    Ok(Some(target))
}
#[tauri::command]
pub async fn source_history(state: State<'_, AppState>) -> Result<Vec<SourceScan>, String> {
    with_store(state.db.clone(), |s| s.source_scans()).await
}

#[tauri::command]
pub async fn source_reviews(
    id: String,
    state: State<'_, AppState>,
) -> Result<Vec<scanner_storage::SourceReview>, String> {
    with_store(state.db.clone(), move |store| store.source_reviews(&id)).await
}

#[tauri::command]
pub async fn review_source(
    id: String,
    finding_id: String,
    false_positive: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let _guard = state.mutations.lock().await;
    with_store(state.db.clone(), move |store| {
        store.review_source(&id, &finding_id, false_positive)
    })
    .await
}

#[tauri::command]
pub async fn source_predeploy(
    id: String,
    baseline_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<scanner_source::predeploy::PredeploySummary, String> {
    with_store(state.db.clone(), move |store| {
        let scan = store.source(&id)?;
        let baseline = baseline_id.map(|id| store.source(&id)).transpose()?;
        let dismissed = store
            .source_reviews(&id)?
            .into_iter()
            .map(|review| review.finding_id)
            .collect();
        scanner_source::predeploy::evaluate(&scan, baseline.as_ref(), &dismissed)
    })
    .await
}
#[tauri::command]
pub fn antivirus_status() -> scanner_source::antivirus::AntivirusStatus {
    scanner_source::antivirus::status()
}

#[tauri::command]
pub async fn start_source(
    token: String,
    config: SourceConfig,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    config.validate()?;
    let _guard = state.mutations.lock().await;
    let root: PathBuf = state
        .source_target
        .lock()
        .map_err(|_| "Falha no escopo local.")?
        .as_ref()
        .filter(|(id, _)| id == &token)
        .map(|(_, p)| p.clone())
        .ok_or("Selecione novamente a pasta pelo diálogo nativo.")?;
    let root = scanner_source::engine::validate_root(&root)?;
    let name = root
        .file_name()
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_else(|| "repositório".into());
    let scan = SourceScan::new(name, config);
    let id = scan.id.clone();
    let cancel = scanner_http::ScanCancellation::new();
    {
        let mut active = state
            .active
            .lock()
            .map_err(|_| "Falha no controle de execução.")?;
        if active.is_some() {
            return Err("Já existe uma análise em execução.".into());
        }
        *active = Some(Active {
            id: id.clone(),
            cancel: cancel.clone(),
        });
    }
    let initial = scan.clone();
    if let Err(e) = with_store(state.db.clone(), move |s| s.save_source(&initial)).await {
        *state
            .active
            .lock()
            .map_err(|_| "Falha no controle de execução.")? = None;
        return Err(e);
    }
    let db = state.db.clone();
    tauri::async_runtime::spawn(async move {
        let _ = app.emit("source-progress", &scan);
        let worker_app = app.clone();
        let worker_cancel = cancel.clone();
        let worker_root = root.clone();
        let fallback = scan.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let mut scan = scan;
            let last_emit = std::cell::Cell::new(std::time::Instant::now());
            let outcome = scanner_source::engine::inspect(
                &worker_root,
                &mut scan,
                &|| worker_cancel.is_cancelled(),
                &|s| {
                    if last_emit.get().elapsed() >= std::time::Duration::from_millis(250) {
                        last_emit.set(std::time::Instant::now());
                        let _ = worker_app.emit("source-progress", s);
                    }
                },
            );
            (scan, outcome)
        })
        .await;
        let (mut scan, mut outcome) = match result {
            Ok(v) => v,
            Err(_) => (fallback, Err("Falha no worker de análise local.".into())),
        };
        if outcome.is_ok() {
            outcome = scanner_source::advisories::run(&mut scan, &cancel).await;
            let _ = app.emit("source-progress", &scan);
        }
        if outcome.is_ok() {
            outcome = scanner_source::antivirus::run(&mut scan, &root, &cancel).await;
        }
        scanner_source::engine::finish(&mut scan, outcome);
        let saved_scan = scan.clone();
        if let Err(error) = with_store(db, move |s| s.save_source(&saved_scan)).await {
            let _ = app.emit(
                "storage-error",
                format!("Não foi possível persistir a análise de código: {error}"),
            );
        }
        if let Ok(mut active) = app.state::<AppState>().active.lock() {
            *active = None;
        }
        let _ = app.emit("source-finished", &scan);
        if app
            .state::<AppState>()
            .exit_after_cancel
            .load(std::sync::atomic::Ordering::Acquire)
        {
            app.exit(0);
        }
    });
    Ok(id)
}
#[tauri::command]
pub async fn delete_source(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let _guard = state.mutations.lock().await;
    if state
        .active
        .lock()
        .map_err(|_| "Falha no controle de execução.")?
        .is_some()
    {
        return Err("Aguarde a análise terminar antes de excluir dados.".into());
    }
    with_store(state.db.clone(), move |s| s.delete_source(&id)).await
}
#[tauri::command]
pub async fn export_source(
    id: String,
    redact_paths: bool,
    format: Option<SourceReportFormat>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let (scan, reviews) = with_store(state.db.clone(), move |store| {
        Ok((store.source(&id)?, store.source_reviews(&id)?))
    })
    .await?;
    if scan.status == ScanStatus::Running {
        return Err("Finalize a análise antes de exportar.".into());
    }
    let format = format.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let rendered = report::render(&scan, format, redact_paths)?;
        let mut value: serde_json::Value = serde_json::from_slice(&rendered)
            .map_err(|_| "Falha ao preparar a revisão do relatório.")?;
        match format {
            SourceReportFormat::Json => {
                value["reviews"] =
                    serde_json::to_value(&reviews).map_err(|_| "Falha ao exportar revisões.")?;
            }
            SourceReportFormat::Sarif => {
                for (index, finding) in scan.findings.iter().enumerate() {
                    if reviews.iter().any(|review| review.finding_id == finding.id) {
                        value["runs"][0]["results"][index]["properties"]["reviewStatus"] =
                            serde_json::json!("false_positive");
                    }
                }
            }
        }
        let data =
            serde_json::to_vec_pretty(&value).map_err(|_| "Falha ao serializar revisões.")?;
        let suffix: String = scan
            .id
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .take(8)
            .collect();
        let selected = app
            .dialog()
            .file()
            .add_filter("Qypher source report", &[format.extension()])
            .set_file_name(format!("qypher-source-{suffix}.{}", format.extension()))
            .blocking_save_file();
        let Some(file) = selected else {
            return Ok(None);
        };
        let path = file
            .into_path()
            .map_err(|_| "Destino não é um arquivo local.")?;
        std::fs::write(&path, data).map_err(|_| "Falha ao salvar relatório de código.")?;
        Ok(Some(path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|_| "Falha na exportação de código.")?
}
