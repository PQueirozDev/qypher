use super::{with_store, Active, AppState};
use scanner_core::{parse_target, ScanStatus};
use scanner_http::{
    lab::{self, LabRequest, LabRun},
    ScanCancellation,
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn lab_history(state: State<'_, AppState>) -> Result<Vec<LabRun>, String> {
    with_store(state.db.clone(), |store| store.lab_history()).await
}

#[tauri::command]
pub async fn start_lab(
    request: LabRequest,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    request.validate()?;
    let _guard = state.mutations.lock().await;
    let target = parse_target(&request.url).map_err(|e| e.to_string())?;
    let projects = with_store(state.db.clone(), |store| Ok(store.snapshot()?.projects)).await?;
    let project = projects
        .iter()
        .find(|project| project.id == request.project_id)
        .ok_or("Projeto não encontrado.")?;
    let project_url = parse_target(&project.url).map_err(|e| e.to_string())?;
    if project_url.origin() != target.origin() {
        return Err("A origem do Lab deve coincidir com a origem autorizada do projeto.".into());
    }
    let project_prefix = project_url.path().trim_end_matches('/');
    if !project_prefix.is_empty()
        && request.path_prefix != project_prefix
        && !request
            .path_prefix
            .starts_with(&format!("{project_prefix}/"))
    {
        return Err("O prefixo do Lab não pode ampliar o caminho cadastrado no projeto. Cadastre a raiz autorizada como projeto se precisar de outro escopo.".into());
    }
    let initial = LabRun::new(&request);
    let id = initial.id.clone();
    let cancel = ScanCancellation::new();
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
    let saved = initial.clone();
    if let Err(error) = with_store(state.db.clone(), move |store| store.save_lab(&saved)).await {
        *state
            .active
            .lock()
            .map_err(|_| "Falha no controle de execução.")? = None;
        return Err(error);
    }
    let db = state.db.clone();
    tauri::async_runtime::spawn(async move {
        let _ = app.emit("lab-progress", &initial);
        let result = lab::run(initial, request, cancel, |run| {
            let _ = app.emit("lab-progress", run);
        })
        .await;
        let saved = result.clone();
        if let Err(error) = with_store(db, move |store| store.save_lab(&saved)).await {
            let _ = app.emit(
                "storage-error",
                format!("Não foi possível salvar o resultado do Lab: {error}"),
            );
        }
        if let Ok(mut active) = app.state::<AppState>().active.lock() {
            *active = None;
        }
        let _ = app.emit("lab-finished", &result);
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
pub async fn delete_lab(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let _guard = state.mutations.lock().await;
    if state
        .active
        .lock()
        .map_err(|_| "Falha no controle de execução.")?
        .is_some()
    {
        return Err("Aguarde a análise terminar antes de excluir dados.".into());
    }
    with_store(state.db.clone(), move |store| store.delete_lab(&id)).await
}

#[tauri::command]
pub async fn export_lab(
    id: String,
    redact_paths: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let mut run = with_store(state.db.clone(), move |store| store.lab(&id)).await?;
    if run.status == ScanStatus::Running {
        return Err("Finalize o cenário antes de exportar.".into());
    }
    if redact_paths {
        run.url = "[URL ocultada]".into();
        run.path_prefix = "[caminho ocultado]".into();
        for observation in &mut run.requests {
            observation.url = "[URL ocultada]".into();
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let suffix: String = run
            .id
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .take(8)
            .collect();
        let destination = app
            .dialog()
            .file()
            .add_filter("Qypher Lab report", &["json"])
            .set_file_name(format!("qypher-lab-{suffix}.json"))
            .blocking_save_file();
        let Some(destination) = destination else {
            return Ok(None);
        };
        let path = destination
            .into_path()
            .map_err(|_| "Destino não é um arquivo local.")?;
        let bytes = serde_json::to_vec_pretty(&run)
            .map_err(|_| "Falha ao serializar o relatório do Lab.")?;
        std::fs::write(&path, bytes).map_err(|_| "Falha ao salvar o relatório do Lab.")?;
        Ok(Some(path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|_| "Falha na exportação do Lab.")?
}
