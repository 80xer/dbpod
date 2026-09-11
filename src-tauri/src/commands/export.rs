use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use ts_rs::TS;

use crate::error::AppError;

const MAX_EXPORT_BYTES: usize = 100 * 1024 * 1024;

/// Content is produced in the frontend from rows already in memory; the
/// native save dialog runs in Rust so no filesystem path or capability is
/// ever exposed to the webview.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ExportSaveRequest {
    pub suggested_name: String,
    pub content: String,
}

impl std::fmt::Debug for ExportSaveRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExportSaveRequest")
            .field("suggested_name", &self.suggested_name)
            .field("content_bytes", &self.content.len())
            .finish()
    }
}

#[tauri::command]
pub async fn export_save(app: AppHandle, request: ExportSaveRequest) -> Result<bool, AppError> {
    if request.content.len() > MAX_EXPORT_BYTES {
        return Err(AppError::invalid_request("export exceeds 100 MiB"));
    }
    let name = request
        .suggested_name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':'))
        .collect::<String>();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(&name)
            .blocking_save_file()
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?;

    let Some(path) = picked else {
        return Ok(false); // user cancelled
    };
    let path = path
        .into_path()
        .map_err(|e| AppError::internal(e.to_string()))?;
    std::fs::write(&path, request.content)
        .map_err(|e| AppError::internal(format!("export write failed: {e}")))?;
    Ok(true)
}
