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
///
/// 安全约束：只删除**确实由本应用旧版本写入**的键。
/// 判定依据是键内记录的打开命令指向可执行文件名含 "JsonViewer"；
/// 否则可能误删同名但属于其它软件的注册表项。
pub fn migrate_legacy_brand() {
    use registry::{delete_key, open_key};
    // 旧「默认应用」登记：仅当其指向 JsonViewer 的 Capabilities 才删除
    if let Ok(ra) = open_key(r"Software\RegisteredApplications") {
        if let Ok(v) = ra.get_value::<String, _>("JSON Viewer") {
            if v.to_lowercase().contains("jsonviewer") {
                let _ = ra.delete_value("JSON Viewer");
            }
        }
    }
    // 旧 Capabilities 键：其 ApplicationDescription 是旧品牌专用文案，
    // 据此判定归属，避免删除同名但属于其它软件的键。
    let legacy_caps = r"Software\Classes\JsonViewer\Capabilities";
    if let Ok(caps) = open_key(legacy_caps) {
        let ours = caps
            .get_value::<String, _>("ApplicationDescription")
            .map(|d| d.contains("JSON Viewer") || d.contains("JsonViewer"))
            .unwrap_or(false);
        if ours {
            let _ = delete_key(legacy_caps);
        }
    }
    // 旧 ProgID 与扩展名对旧 ProgID 的引用
    for ext in file_assoc::SUPPORTED_EXTS {
        let old_pid = format!("JsonViewer.{}", ext);
        let old_path = format!(r"Software\Classes\{}", old_pid);
        // 仅删除确实由本应用旧版本创建的 ProgID
        if !registry::is_our_legacy_progid(&old_path) {
            continue;
        }
        let _ = delete_key(&old_path);
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
    // 旧右键菜单：仅当命令指向 JsonViewer 才删除
    for base in [
        r"Software\Classes\*\shell\JsonViewer",
        r"Software\Classes\.json\shell\JsonViewer",
        r"Software\Classes\.jsonl\shell\JsonViewer",
        r"Software\Classes\Folder\shell\JsonViewer",
        r"Software\Classes\Directory\Background\shell\JsonViewer",
    ] {
        if registry::is_our_legacy_shell_key(base) {
            let _ = delete_key(base);
        }
    }
    // 旧自启项（仅当指向 JsonViewer）与旧应用键（含 managed_keys 清单）
    if let Ok(run) = open_key(autostart::RUN_KEY) {
        if let Ok(v) = run.get_value::<String, _>("JsonViewer") {
            if v.to_lowercase().contains("jsonviewer") {
                let _ = run.delete_value("JsonViewer");
            }
        }
    }
    if registry::is_our_legacy_progid(r"Software\JsonViewer")
        || registry::key_exists(r"Software\JsonViewer\managed_keys")
    {
        let _ = delete_key(r"Software\JsonViewer");
    }
    registry::notify_shell_assoc_changed();
}

/// 一键清理：移除所有系统集成痕迹
pub fn cleanup_all() -> Result<IntegrationStatus, String> {
    context_menu::uninstall(&[])?;
    // 批量注销：只触发一次能力表刷新与一次 Shell 广播
    let registered: Vec<String> = file_assoc::status()
        .into_iter()
        .filter(|(_, on)| *on)
        .map(|(ext, _)| ext)
        .collect();
    if !registered.is_empty() {
        file_assoc::unregister_many(&registered)?;
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
