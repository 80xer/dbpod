// AppError is our IPC error shape; boxing it everywhere isn't worth the noise.
#![allow(clippy::result_large_err)]

pub mod application;
pub mod commands;
pub mod domain;
pub mod error;
pub mod infrastructure;
pub mod state;

use tauri::Manager;

use infrastructure::persistence::profiles::ProfileStore;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let store = ProfileStore::load(dir).map_err(|e| e.to_string())?;
            app.manage(AppState::new(store));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_status,
            commands::connection_profile_list,
            commands::connection_profile_save,
            commands::connection_profile_delete,
            commands::connection_test,
            commands::connection_open,
            commands::connection_close,
            commands::query_session_open,
            commands::query_session_close,
            commands::query_execute,
            commands::query_ack_chunk,
            commands::query_cancel,
            commands::result_value_fetch,
            commands::result_release,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
