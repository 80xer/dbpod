// AppError is our IPC error shape; boxing it everywhere isn't worth the noise.
#![allow(clippy::result_large_err)]

pub mod application;
pub mod commands;
pub mod domain;
pub mod error;
pub mod infrastructure;
pub mod state;

#[cfg(target_os = "macos")]
use tauri::menu::MenuItemKind;
use tauri::{menu::Menu, Manager};

use infrastructure::persistence::profiles::ProfileStore;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(|app| {
            let menu = Menu::default(app)?;
            #[cfg(target_os = "macos")]
            for item in menu.items()? {
                if let MenuItemKind::Submenu(submenu) = item {
                    for child in submenu.items()? {
                        if let MenuItemKind::Predefined(predefined) = child {
                            if predefined.text()?.replace('&', "") == "Close Window" {
                                submenu.remove(&predefined)?;
                            }
                        }
                    }
                }
            }
            Ok(menu)
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let store = ProfileStore::load(dir.clone()).map_err(|e| e.to_string())?;
            app.manage(AppState::new(dir, store));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_status,
            commands::ai_chat,
            commands::ai_chat_cancel,
            commands::connection_profile_list,
            commands::connection_profile_reorder,
            commands::connection_profile_save,
            commands::connection_profile_delete,
            commands::connection_test,
            commands::connection_open,
            commands::connection_switch_database,
            commands::metadata_list_databases,
            commands::connection_close,
            commands::query_session_open,
            commands::query_session_close,
            commands::query_execute,
            commands::query_ack_chunk,
            commands::query_cancel,
            commands::result_value_fetch,
            commands::result_rows_fetch,
            commands::result_release,
            commands::metadata_list_schemas,
            commands::metadata_list_objects,
            commands::metadata_drop_object,
            commands::metadata_get_table,
            commands::metadata_get_routine_definition,
            commands::table_data_execute,
            commands::workspace_snapshot_load,
            commands::workspace_snapshot_save,
            commands::changes_preview,
            commands::changes_commit,
            commands::changes_discard,
            commands::export::export_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
