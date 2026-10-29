//! 文件关联（默认打开方式）注册。
//!
//! 策略：
//! 1. 注册 ProgID：`HKCU\Software\Classes\FileView.json`（DefaultIcon + open command）
//! 2. 将 ProgID 写入扩展名的 `OpenWithProgids`
//! 3. **不伪造 UserChoice**（Windows 由哈希保护，程序写入无效）；
//!    提供 `open_default_apps_settings()` 引导用户在系统设置中一键确认默认应用。

use super::registry;

/// 支持的扩展名（JSON 家族 + 文档 + 配置 + 数据 + 标记语言 + 源码）
pub const SUPPORTED_EXTS: &[&str] = &[
    // JSON 家族
    "json", "jsonc", "json5", "jsonl", "ndjson", "har", "geojson", "webmanifest",
    // 文档与文本
    "md", "markdown", "mdown", "txt", "text", "log",
    // 配置
    "ini", "cfg", "conf", "config", "properties", "props", "env", "editorconfig",
    "gitignore", "npmrc", "yaml", "yml", "toml",
    // 数据
    "csv", "tsv",
    // 标记语言
    "xml", "svg", "html", "htm", "xhtml", "vue", "svelte",
    // 前端
    "css", "scss", "less", "js", "mjs", "cjs", "jsx", "ts", "tsx",
    // 脚本与后端
    "py", "rb", "php", "java", "kt", "kts", "swift", "rs", "go", "c", "h", "cpp", "cc",
    "cxx", "hpp", "cs", "lua", "pl", "dart", "scala", "r",
    // 脚本与数据库
    "sh", "bash", "zsh", "ps1", "bat", "cmd", "sql",
];

const APP_DISPLAY_NAME: &str = "FileView";

fn prog_id(ext: &str) -> String {
    format!("{}.{}", registry::PROG_ID_PREFIX, ext)
}

/// 刷新 Windows「默认应用」所需的 Capabilities / RegisteredApplications。
/// 缺少这组键时，系统「默认应用」设置里根本列不出本应用，用户设置了也无效。
fn refresh_capabilities() -> Result<(), String> {
    let caps_path = format!(r"Software\Classes\{}\Capabilities", registry::PROG_ID_PREFIX);
    let key = registry::create_key(&caps_path).map_err(|e| format!("创建 Capabilities 失败: {}", e))?;
    registry::set_string(&key, "ApplicationName", APP_DISPLAY_NAME)
        .map_err(|e| format!("写 ApplicationName 失败: {}", e))?;
    registry::set_string(&key, "ApplicationDescription", "JSON / Markdown / YAML / TOML / CSV / XML / 代码 / 文本查看器")
        .map_err(|e| format!("写 ApplicationDescription 失败: {}", e))?;    let fa = registry::create_key(format!(r"{}\FileAssociations", caps_path))
        .map_err(|e| format!("创建 FileAssociations 失败: {}", e))?;
    for ext in SUPPORTED_EXTS {
        let name = format!(".{}", ext);
        if registry::key_exists(&format!(r"Software\Classes\{}", prog_id(ext))) {
            registry::set_string(&fa, &name, &prog_id(ext))
                .map_err(|e| format!("写 FileAssociations 失败: {}", e))?;
        } else {
            let _ = fa.delete_value(&name);
        }
    }
    let ra = registry::create_key(r"Software\RegisteredApplications")
        .map_err(|e| format!("创建 RegisteredApplications 失败: {}", e))?;
    registry::set_string(&ra, APP_DISPLAY_NAME, &caps_path)
        .map_err(|e| format!("写 RegisteredApplications 失败: {}", e))?;
    registry::record_managed_key(&caps_path).map_err(|e| e.to_string())?;
    Ok(())
}

/// 移除 Capabilities / RegisteredApplications（一键清理用）
pub fn clear_capabilities() {
    let _ = registry::delete_key(format!(r"Software\Classes\{}\Capabilities", registry::PROG_ID_PREFIX));
    if let Ok(ra) = registry::open_key(r"Software\RegisteredApplications") {
        let _ = ra.delete_value(APP_DISPLAY_NAME);
    }
}

/// 批量注册：只刷新一次 Capabilities、只广播一次 Shell 通知。
///
/// 逐个调用 register() 会导致每个扩展名都触发一次能力表重建与
/// `SHCNE_ASSOCCHANGED` 广播（70+ 次 Explorer 全量重读），启动明显卡顿。
pub fn register_many(exts: &[String]) -> Result<Vec<String>, String> {
    // 先整体校验：任何一个扩展名不支持就整体放弃，
    // 避免出现「一半注册成功、一半失败」的中间状态。
    let mut normalized = Vec::with_capacity(exts.len());
    for ext in exts {
        let e = ext.trim_start_matches('.');
        if !SUPPORTED_EXTS.contains(&e) {
            return Err(format!("不支持的扩展名: {}", ext));
        }
        normalized.push(e.to_string());
    }
    let mut done = Vec::new();
    for ext in &normalized {
        register_internal(ext)?;
        done.push(ext.clone());
    }
    if !done.is_empty() {
        let _ = refresh_capabilities();
        registry::notify_shell_assoc_changed();
    }
    Ok(done)
}

/// 注册单个扩展名（不含能力表刷新与 Shell 广播）
fn register_internal(ext: &str) -> Result<(), String> {
    let ext = ext.trim_start_matches('.');
    if !SUPPORTED_EXTS.contains(&ext) {
        return Err(format!("不支持的扩展名: {}", ext));
    }
    let pid = prog_id(ext);
    let exe = super::context_menu::exe_path();

    // ProgID 键
    let pid_path = format!(r"Software\Classes\{}", pid);
    let key = registry::create_key(&pid_path).map_err(|e| format!("创建 ProgID 失败: {}", e))?;
    registry::set_string(&key, "", &format!("FileView 文件 (.{})", ext))
        .map_err(|e| format!("写 ProgID 描述失败: {}", e))?;
    registry::set_string(&key, "FriendlyTypeName", "FileView")
        .map_err(|e| format!("写 FriendlyTypeName 失败: {}", e))?;

    // DefaultIcon
    let icon_key = registry::create_key(format!(r"{}\DefaultIcon", pid_path))
        .map_err(|e| format!("创建 DefaultIcon 失败: {}", e))?;
    registry::set_string(&icon_key, "", &format!("{},0", exe))
        .map_err(|e| format!("写图标失败: {}", e))?;

    // shell\open\command
    let cmd_key = registry::create_key(format!(r"{}\shell\open\command", pid_path))
        .map_err(|e| format!("创建 open command 失败: {}", e))?;
    let command = format!("\"{}\" \"%1\"", exe);
    registry::set_string(&cmd_key, "", &command).map_err(|e| format!("写命令失败: {}", e))?;

    // 扩展名 -> OpenWithProgids 子键（让用户可在“打开方式”中选择）。
    // 注意：规范要求写入 `.ext\OpenWithProgids` 子键下的 REG_NONE 值，
    // 而不是扩展名键根部的普通值。
    let ext_path = format!(r"Software\Classes\.{}", ext);
    let ext_key = registry::create_key(&ext_path).map_err(|e| format!("创建扩展名键失败: {}", e))?;
    // 默认值仅在未设置或为空串时指向我们的 ProgID（不覆盖用户已有的默认）。
    // 注意：空串默认值意味着没有处理程序（双击无响应），必须视为未设置。
    let has_default = ext_key
        .get_value::<String, _>("")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);
    if !has_default {
        registry::set_string(&ext_key, "", &pid).map_err(|e| format!("写扩展名默认值失败: {}", e))?;
    }
    let ow_key = registry::create_key(format!(r"{}\OpenWithProgids", ext_path))
        .map_err(|e| format!("创建 OpenWithProgids 失败: {}", e))?;
    registry::set_none(&ow_key, &pid).map_err(|e| format!("写 OpenWithProgids 失败: {}", e))?;

    registry::record_managed_key(&pid_path).map_err(|e| e.to_string())?;
    registry::record_managed_key(&ext_path).map_err(|e| e.to_string())?;
    Ok(())
}

/// 批量注销：只刷新一次能力表、只广播一次 Shell 通知。
pub fn unregister_many(exts: &[String]) -> Result<Vec<String>, String> {
    // 同样先整体校验，保证批量操作的一致性
    let mut normalized = Vec::with_capacity(exts.len());
    for ext in exts {
        let e = ext.trim_start_matches('.');
        if !SUPPORTED_EXTS.contains(&e) {
            return Err(format!("不支持的扩展名: {}", ext));
        }
        normalized.push(e.to_string());
    }
    let mut done = Vec::new();
    for ext in &normalized {
        unregister_internal(ext)?;
        done.push(ext.clone());
    }
    if !done.is_empty() {
        let _ = refresh_capabilities();
        registry::notify_shell_assoc_changed();
    }
    Ok(done)
}

/// 注销单个扩展名（不含能力表刷新与 Shell 广播）
fn unregister_internal(ext: &str) -> Result<(), String> {
    let ext = ext.trim_start_matches('.');
    // 与 register 对称：只允许处理受支持的扩展名，
    // 避免 settings.json 被手工改成任意字符串后误删同名键。
    if !SUPPORTED_EXTS.contains(&ext) {
        return Err(format!("不支持的扩展名: {}", ext));
    }
    let pid = prog_id(ext);
    let pid_path = format!(r"Software\Classes\{}", pid);
    if registry::key_exists(&pid_path) {
        registry::delete_key(&pid_path).map_err(|e| format!("删除 ProgID 失败: {}", e))?;
    }
    let ext_path = format!(r"Software\Classes\.{}", ext);
    if let Ok(ext_key) = registry::open_key(&ext_path) {
        // 只移除我们的 OpenWithProgids 项与默认值引用，不删除用户其他打开方式
        if let Ok(ow_key) = ext_key.open_subkey("OpenWithProgids") {
            let _ = ow_key.delete_value(&pid);
        }
        if let Ok(default) = ext_key.get_value::<String, _>("") {
            if default == pid {
                let _ = ext_key.delete_value("");
            }
        }
    }
    // 注入已移除，同步清理受管理清单记录，避免计数虚高
    let _ = registry::forget_managed_key(&pid_path);
    let _ = registry::forget_managed_key(&ext_path);
    Ok(())
}

/// 查询各扩展名的注册状态
pub fn status() -> Vec<(String, bool)> {
    SUPPORTED_EXTS
        .iter()
        .map(|ext| {
            (
                ext.to_string(),
                registry::key_exists(&format!(r"Software\Classes\{}", prog_id(ext))),
            )
        })
        .collect()
}

/// 打开 Windows「默认应用」设置页（UserChoice 由用户确认，符合系统策略）
pub fn open_default_apps_settings() -> Result<(), String> {
    // 优先跳到本应用的「按文件类型设默认」页（需 Capabilities 注册）
    let candidates = [
        "ms-settings:defaultapps?registeredAppUser=FileView",
        "ms-settings:defaultapps",
    ];
    for uri in candidates {
        let status = std::process::Command::new("cmd")
            .args(["/C", "start", "", uri])
            .status();
        if matches!(status, Ok(s) if s.success()) {
            return Ok(());
        }
    }
    Err("无法打开系统设置".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 注册单个扩展名（测试辅助）
    fn register(ext: &str) -> Result<String, String> {
        register_many(&[ext.to_string()])
            .map(|v| v.into_iter().next().unwrap_or_default())
    }

    /// 注销单个扩展名（测试辅助）
    fn unregister(ext: &str) -> Result<String, String> {
        unregister_many(&[ext.to_string()])
            .map(|v| v.into_iter().next().unwrap_or_default())
    }

    #[test]
    fn test_register_unregister_json() {
        let _g = super::super::registry::test_support::lock();
        assert!(register("json").is_ok());
        assert!(status().iter().any(|(e, on)| e == "json" && *on));
        assert!(unregister("json").is_ok());
        assert!(status().iter().all(|(e, on)| !(e == "json" && *on)));
    }

    #[test]
    fn test_reject_unknown_ext() {
        assert!(register("xyz").is_err());
        // 注销同样必须校验扩展名（对称性）
        assert!(unregister("xyz").is_err());
    }

    #[test]
    fn test_register_unregister_md() {
        let _g = super::super::registry::test_support::lock();
        assert!(register("md").is_ok());
        let pid_path = format!(r"Software\Classes\{}", prog_id("md"));
        assert!(registry::key_exists(&format!(r"{}\shell\open\command", pid_path)));
        assert!(registry::open_key(r"Software\Classes\.md\OpenWithProgids").is_ok());
        // Windows「默认应用」入口：RegisteredApplications + Capabilities
        let ra = registry::open_key(r"Software\RegisteredApplications").unwrap();
        assert!(ra.get_value::<String, _>(APP_DISPLAY_NAME).is_ok());
        assert!(registry::key_exists(&format!(
            r"Software\Classes\{}\Capabilities\FileAssociations",
            registry::PROG_ID_PREFIX
        )));
        assert!(status().iter().any(|(e, on)| e == "md" && *on));
        assert!(unregister("md").is_ok());
    }

    #[test]
    fn test_register_replaces_empty_default() {
        // 扩展名默认值为空串（无处理程序）时必须写入我们的 ProgID，否则双击无响应
        let _g = super::super::registry::test_support::lock();
        let ext_key = registry::create_key(r"Software\Classes\.md").unwrap();
        registry::set_string(&ext_key, "", "").unwrap();
        assert!(register("md").is_ok());
        let v: String = ext_key.get_value("").unwrap();
        assert_eq!(v, prog_id("md"));
        assert!(unregister("md").is_ok());
    }

    #[test]
    fn test_register_many_is_atomic_on_unsupported_ext() {
        // 批量注册遇到不支持的扩展名必须报错，而不是部分成功
        let _g = super::super::registry::test_support::lock();
        let res = register_many(&["json".to_string(), "xyz".to_string()]);
        assert!(res.is_err());
    }
}
