mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::check_prerequisites,
            commands::install_bun,
            commands::install_cli,
            commands::update_cli,
            commands::run_cli_command,
            commands::get_cli_version,
            commands::read_skill_directory,
            commands::read_skill_file,
            commands::write_skill_file,
            commands::create_file,
            commands::delete_file,
            commands::rename_file,
        ])
        .run(tauri::generate_context!())
        .expect("error whilst running tauri application");
}
