pub mod autostart;
pub mod context_menu;
pub mod file_assoc;
pub mod registry;

use serde::Serialize;

/// 系统集成总状态（设置页展示）
#[derive(Debug, Clone, Serialize)]
pub struct IntegrationStatus {
    /// 右键菜单各目标的注入状态
    pub context_menu: Vec<(String, bool)>,
    /// 文件关联各扩展名的注册状态
    pub file_assoc: Vec<(String, bool)>,
    /// 开机自启
    pub autostart: bool,
    /// 管理键数量（用于验证清理完整性）
    pub managed_key_count: u32,
}

pub fn collect_status() -> IntegrationStatus {
    let managed_key_count = registry::managed_key_count();
    IntegrationStatus {
        context_menu: context_menu::status(),
        file_assoc: file_assoc::status(),
        autostart: autostart::status(),
        managed_key_count,
    }
}

/// 清理旧品牌 "JsonViewer" 的注册表痕迹（更名 FileView 的一次性迁移，幂等）。
/// 旧 ProgID / 菜单 / 自启项 / 默认应用登记一律移除，随后启动注入会按设置重建新品牌的键。
pub fn migrate_legacy_brand() {
    use registry::{delete_key, open_key};
    // 旧「默认应用」登记
    if let Ok(ra) = open_key(r"Software\RegisteredApplications") {
        let _ = ra.delete_value("JSON Viewer");
    }
    let _ = delete_key(r"Software\Classes\JsonViewer\Capabilities");
    // 旧 ProgID 与扩展名对旧 ProgID 的引用
    for ext in file_assoc::SUPPORTED_EXTS {
        let old_pid = format!("JsonViewer.{}", ext);
        let _ = delete_key(format!(r"Software\Classes\{}", old_pid));
        if let Ok(ext_key) = open_key(format!(r"Software\Classes\.{}", ext)) {
            if let Ok(v) = ext_key.get_value::<String, _>("") {
                if v == old_pid {
                    let _ = ext_key.delete_value("");
                }
            }
            if let Ok(ow) = ext_key.open_subkey("OpenWithProgids") {
                let _ = ow.delete_value(&old_pid);
            }
        }
    }
    // 旧右键菜单
    for base in [
        r"Software\Classes\*\shell\JsonViewer",
        r"Software\Classes\.json\shell\JsonViewer",
        r"Software\Classes\.jsonl\shell\JsonViewer",
        r"Software\Classes\Folder\shell\JsonViewer",
        r"Software\Classes\Directory\Background\shell\JsonViewer",
    ] {
        let _ = delete_key(base);
    }
    // 旧自启项与旧应用键（含 managed_keys 清单）
    if let Ok(run) = open_key(autostart::RUN_KEY) {
        let _ = run.delete_value("JsonViewer");
    }
    let _ = delete_key(r"Software\JsonViewer");
    registry::notify_shell_assoc_changed();
}

/// 一键清理：移除所有系统集成痕迹
pub fn cleanup_all() -> Result<IntegrationStatus, String> {
    context_menu::uninstall(&[])?;
    for (ext, on) in file_assoc::status() {
        if on {
            file_assoc::unregister(&ext)?;
        }
    }
    file_assoc::clear_capabilities();
    autostart::set_autostart(false, false)?;
    // 清理 app 自身键（保留 managed_keys 清理顺序：先清记录再删主键）
    let _ = registry::delete_key(format!(r"{}\recent", registry::APP_KEY));
    registry::clear_managed_keys().map_err(|e| e.to_string())?;
    let _ = registry::delete_key(registry::APP_KEY);
    registry::notify_shell_assoc_changed();
    Ok(collect_status())
}
