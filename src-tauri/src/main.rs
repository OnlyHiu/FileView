//! FileView — Tauri 应用入口与命令层。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod json_core;
mod settings;
mod sys;

use serde::Serialize;
use settings::{Settings, SettingsPatch};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// 解析文件读取结果
#[derive(Debug, Clone, Serialize)]
pub struct FilePayload {
    pub path: String,
    pub text: String,
    pub size: u64,
    pub truncated: bool,
}

/// 超过该大小只读取前 N 字节（防止内存爆炸）
const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;

struct AppState {
    settings: Mutex<Settings>,
    config_dir: std::path::PathBuf,
    /// 启动命令行中的文件参数（文件关联 / 拖到图标上时由系统传入）
    startup_file: Mutex<Option<String>>,
}

/// 从命令行参数中找出文件路径（跳过 --minimized 等开关）
fn first_file_arg<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().find(|a| {
        !a.starts_with('-') && std::path::Path::new(a).is_file()
    })
}

// ============ JSON 命令 ============

fn parse_mode_of(mode: &str) -> json_core::parser::ParseMode {
    match mode {
        "jsonc" => json_core::parser::ParseMode::Jsonc,
        "jsonl" => json_core::parser::ParseMode::Jsonl,
        _ => json_core::parser::ParseMode::Strict,
    }
}

#[tauri::command]
fn parse_json(text: String, mode: String) -> json_core::parser::ParseResult {
    json_core::parser::parse(&text, parse_mode_of(&mode))
}

#[tauri::command]
fn format_json(text: String, indent: String, mode: String) -> Result<String, String> {
    let ind = match indent.as_str() {
        "tab" => json_core::formatter::Indent::Tab,
        "4" => json_core::formatter::Indent::Spaces(4),
        _ => json_core::formatter::Indent::Spaces(2),
    };
    json_core::formatter::format(&text, parse_mode_of(&mode), &ind)
}

#[tauri::command]
fn minify_json(text: String, mode: String) -> Result<String, String> {
    json_core::formatter::minify(&text, parse_mode_of(&mode))
}

#[tauri::command]
fn sort_keys_json(text: String, indent: String, mode: String) -> Result<String, String> {
    let ind = match indent.as_str() {
        "tab" => json_core::formatter::Indent::Tab,
        "4" => json_core::formatter::Indent::Spaces(4),
        _ => json_core::formatter::Indent::Spaces(2),
    };
    json_core::formatter::sort_keys(&text, parse_mode_of(&mode), &ind)
}

#[tauri::command]
fn query_json(text: String, expr: String, mode: String) -> Result<Vec<String>, String> {
    json_core::query::query(&text, &expr, parse_mode_of(&mode))
}

#[tauri::command]
fn validate_json(text: String, mode: String) -> Result<(), (usize, usize, String)> {
    json_core::formatter::validate(&text, parse_mode_of(&mode))
}

// ============ 文件命令 ============

#[tauri::command]
fn read_file_text(path: String) -> Result<FilePayload, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("读取文件失败: {}", e))?;
    let size = meta.len();
    use std::io::Read;
    let file = std::fs::File::open(&path).map_err(|e| format!("打开文件失败: {}", e))?;
    // 至多读取 MAX_TEXT_BYTES 字节；不要求文件大小与 metadata 精确一致。
    // 多读 1 字节作为哨兵，精确判断是否真的发生了截断。
    let mut limited = file.take(MAX_TEXT_BYTES + 1);
    let mut buf = Vec::new();
    limited.read_to_end(&mut buf).map_err(|e| format!("读取失败: {}", e))?;
    let truncated = buf.len() as u64 > MAX_TEXT_BYTES;
    if truncated {
        buf.truncate(MAX_TEXT_BYTES as usize);
    }
    // 截断可能切在多字节字符中间：丢弃不完整的尾部，避免整段 lossy 替换
    let text = match String::from_utf8(buf) {
        Ok(s) => s,
        Err(e) => {
            let valid = e.utf8_error().valid_up_to();
            let mut v = e.into_bytes();
            v.truncate(valid);
            String::from_utf8_lossy(&v).to_string()
        }
    };
    // 去掉 UTF-8 BOM（否则严格模式解析失败）
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text).to_string();
    Ok(FilePayload {
        path,
        text,
        size,
        truncated,
    })
}

#[tauri::command]
fn write_file_text(path: String, text: String) -> Result<(), String> {
    std::fs::write(&path, text).map_err(|e| format!("保存失败: {}", e))
}

/// 文件修改时间（UNIX 秒）；文件不存在返回 None。供文件监视自动重载使用。
#[tauri::command]
fn get_file_mtime(path: String) -> Result<Option<u64>, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("读取文件信息失败: {}", e))?;
    Ok(meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs()))
}

/// 取出启动时命令行传入的文件（只返回一次）
#[tauri::command]
fn take_startup_file(state: tauri::State<AppState>) -> Option<String> {
    state.startup_file.lock().unwrap().take()
}

// ============ 设置命令 ============

#[tauri::command]
fn get_settings(state: tauri::State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn update_settings(
    state: tauri::State<AppState>,
    patch: SettingsPatch,
) -> Result<Settings, String> {
    let mut s = state.settings.lock().unwrap();
    settings::apply_patch(&mut s, patch);
    settings::save(&state.config_dir, &s)?;
    Ok(s.clone())
}

// ============ 系统集成命令 ============

#[tauri::command]
fn integration_status() -> sys::IntegrationStatus {
    sys::collect_status()
}

#[tauri::command]
fn install_context_menu(targets: Vec<String>) -> Result<Vec<String>, String> {
    let list: Vec<sys::context_menu::MenuTarget> = targets
        .iter()
        .filter_map(|t| sys::context_menu::MenuTarget::from_id(t))
        .collect();
    // 先移除不在列表中的目标
    let current = sys::context_menu::status();
    for (id, on) in current {
        if on && !targets.contains(&id) {
            if let Some(t) = sys::context_menu::MenuTarget::from_id(&id) {
                sys::context_menu::uninstall(&[t])?;
            }
        }
    }
    sys::context_menu::install(&list)
}

#[tauri::command]
fn uninstall_context_menu() -> Result<Vec<String>, String> {
    sys::context_menu::uninstall(&[])
}

#[tauri::command]
fn register_file_associations(exts: Vec<String>) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for e in exts {
        out.push(sys::file_assoc::register(&e)?);
    }
    Ok(out)
}

#[tauri::command]
fn unregister_file_associations(exts: Vec<String>) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for e in exts {
        out.push(sys::file_assoc::unregister(&e)?);
    }
    Ok(out)
}

#[tauri::command]
fn set_autostart(enabled: bool, minimized: bool) -> Result<(), String> {
    sys::autostart::set_autostart(enabled, minimized)
}

#[tauri::command]
fn open_default_apps_settings() -> Result<(), String> {
    sys::file_assoc::open_default_apps_settings()
}

#[tauri::command]
fn cleanup_system_integration() -> Result<sys::IntegrationStatus, String> {
    sys::cleanup_all()
}

#[tauri::command]
fn supported_extensions() -> Vec<String> {
    sys::file_assoc::SUPPORTED_EXTS.iter().map(|s| s.to_string()).collect()
}

// ============ 启动 ============

fn main() {
    tauri::Builder::default()
        // 已有实例运行时，把新启动的文件参数转发给主窗口，不再弹空白窗口
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = first_file_arg(argv.into_iter().skip(1)) {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.emit("open-file", path);
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            } else if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            // 旧品牌（com.jsonviewer.app）设置迁移，避免更名后丢配置
            if !config_dir.join("settings.json").exists() {
                if let Some(legacy) = config_dir.parent().map(|p| p.join("com.jsonviewer.app")) {
                    let legacy_settings = legacy.join("settings.json");
                    if legacy_settings.exists() {
                        let _ = std::fs::create_dir_all(&config_dir);
                        let _ = std::fs::copy(&legacy_settings, config_dir.join("settings.json"));
                    }
                }
            }
            // 清理旧 "JsonViewer" 注册表痕迹（更名迁移，幂等）
            sys::migrate_legacy_brand();
            let loaded = settings::load(&config_dir);
            // 按设置幂等注入系统集成：注册表被外部清理或设置被离线修改后，启动即恢复，
            // 保证设置页勾选的文件关联/右键菜单「设置了就生效」
            for ext in &loaded.associated_extensions {
                let _ = sys::file_assoc::register(ext);
            }
            if !loaded.context_menu_targets.is_empty() {
                let list: Vec<sys::context_menu::MenuTarget> = loaded
                    .context_menu_targets
                    .iter()
                    .filter_map(|t| sys::context_menu::MenuTarget::from_id(t))
                    .collect();
                let _ = sys::context_menu::install(&list);
            }
            if loaded.autostart {
                let _ = sys::autostart::set_autostart(true, loaded.autostart_minimized);
            }
            // 命令行文件参数（文件关联 "%1"、拖到图标等）
            let startup_file = first_file_arg(std::env::args().skip(1));
            let state = AppState {
                settings: Mutex::new(loaded),
                config_dir,
                startup_file: Mutex::new(startup_file),
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            parse_json,
            format_json,
            minify_json,
            sort_keys_json,
            query_json,
            validate_json,
            read_file_text,
            write_file_text,
            get_file_mtime,
            take_startup_file,
            get_settings,
            update_settings,
            integration_status,
            install_context_menu,
            uninstall_context_menu,
            register_file_associations,
            unregister_file_associations,
            set_autostart,
            open_default_apps_settings,
            cleanup_system_integration,
            supported_extensions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
