//! 应用设置持久化：`{app_config_dir}/settings.json`。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 应用设置
///
/// 结构体带 `#[serde(default)]`：新增字段时旧配置文件仍可正常读取，
/// 缺失的字段回退到默认值，而不是让整份配置因反序列化失败被丢弃。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// 主题：light | dark | system
    pub theme: String,
    /// 默认缩进：2 | 4 | tab
    pub indent: String,
    /// 字号
    pub font_size: u32,
    /// 启动行为：blank | last | recent
    pub startup: String,
    /// 文件监视自动重载
    pub watch_file: bool,
    /// 启用 Mica 材质
    pub mica: bool,
    /// 右键菜单注入目标 id 列表
    pub context_menu_targets: Vec<String>,
    /// 已注册文件关联扩展名
    pub associated_extensions: Vec<String>,
    /// 开机自启
    pub autostart: bool,
    /// 自启时最小化
    pub autostart_minimized: bool,
    /// 最近文件
    pub recent_files: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: "system".into(),
            indent: "2".into(),
            font_size: 14,
            startup: "blank".into(),
            watch_file: true,
            mica: true,
            context_menu_targets: vec!["json_files".into()],
            // 默认**不**注册任何文件关联。
            // 理由：首次启动就抢占 70+ 种扩展名（含 .py/.js/.ts/.c 等源码类型）
            // 的默认处理程序属于静默劫持用户环境；文件关联应由用户在
            // 「设置 → 默认打开方式」中显式勾选后注册。
            associated_extensions: vec![],
            autostart: false,
            autostart_minimized: true,
            recent_files: vec![],
        }
    }
}

fn settings_path(app_config_dir: &PathBuf) -> PathBuf {
    app_config_dir.join("settings.json")
}

/// 读取设置（不存在或损坏时回退默认值）
pub fn load(app_config_dir: &PathBuf) -> Settings {
    let path = settings_path(app_config_dir);
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

/// 保存设置（原子写：先写临时文件再改名，避免中途崩溃留下半截文件）
pub fn save(app_config_dir: &PathBuf, settings: &Settings) -> Result<(), String> {
    std::fs::create_dir_all(app_config_dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    let path = settings_path(app_config_dir);
    let text = serde_json::to_string_pretty(settings).map_err(|e| format!("序列化失败: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("写入设置失败: {}", e))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("保存设置失败: {}", e))?;
    Ok(())
}

/// 局部更新（None 字段保持不变）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub theme: Option<String>,
    pub indent: Option<String>,
    pub font_size: Option<u32>,
    pub startup: Option<String>,
    pub watch_file: Option<bool>,
    pub mica: Option<bool>,
    pub context_menu_targets: Option<Vec<String>>,
    pub associated_extensions: Option<Vec<String>>,
    pub autostart: Option<bool>,
    pub autostart_minimized: Option<bool>,
    pub recent_files: Option<Vec<String>>,
}

pub fn apply_patch(settings: &mut Settings, patch: SettingsPatch) {
    if let Some(v) = patch.theme {
        settings.theme = v;
    }
    if let Some(v) = patch.indent {
        settings.indent = v;
    }
    if let Some(v) = patch.font_size {
        settings.font_size = v;
    }
    if let Some(v) = patch.startup {
        settings.startup = v;
    }
    if let Some(v) = patch.watch_file {
        settings.watch_file = v;
    }
    if let Some(v) = patch.mica {
        settings.mica = v;
    }
    if let Some(v) = patch.context_menu_targets {
        settings.context_menu_targets = v;
    }
    if let Some(v) = patch.associated_extensions {
        settings.associated_extensions = v;
    }
    if let Some(v) = patch.autostart {
        settings.autostart = v;
    }
    if let Some(v) = patch.autostart_minimized {
        settings.autostart_minimized = v;
    }
    if let Some(v) = patch.recent_files {
        settings.recent_files = v;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_patch_and_persistence() {
        let dir = std::env::temp_dir().join("json-viewer-test-settings");
        let _ = std::fs::remove_dir_all(&dir);
        let mut s = Settings::default();
        let mut patch = SettingsPatch::default();
        patch.theme = Some("dark".into());
        patch.font_size = Some(16);
        apply_patch(&mut s, patch);
        save(&dir, &s).unwrap();
        let loaded = load(&dir);
        assert_eq!(loaded.theme, "dark");
        assert_eq!(loaded.font_size, 16);
        assert_eq!(loaded.indent, "2");
    }

    #[test]
    fn test_load_tolerates_missing_fields() {
        // 旧版本配置文件（缺少新字段）不应导致整份设置被丢弃
        let dir = std::env::temp_dir().join("json-viewer-test-settings-partial");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"theme":"dark","fontSize":18}"#,
        )
        .unwrap();
        let loaded = load(&dir);
        assert_eq!(loaded.theme, "dark");
        assert_eq!(loaded.font_size, 18);
        // 缺失字段回退默认值
        assert_eq!(loaded.indent, "2");
        assert!(loaded.watch_file);
    }

    #[test]
    fn test_default_registers_no_file_associations() {
        // 首次启动不应静默抢占 70+ 种扩展名的默认处理程序
        assert!(Settings::default().associated_extensions.is_empty());
    }
}
