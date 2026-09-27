//! 应用设置持久化：`{app_config_dir}/settings.json`。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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
            // 默认注册全部支持的扩展名（JSON 家族 + md/ini/txt/log 等）
            associated_extensions: crate::sys::file_assoc::SUPPORTED_EXTS
                .iter()
                .map(|s| s.to_string())
                .collect(),
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

/// 保存设置
pub fn save(app_config_dir: &PathBuf, settings: &Settings) -> Result<(), String> {
    std::fs::create_dir_all(app_config_dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    let path = settings_path(app_config_dir);
    let text = serde_json::to_string_pretty(settings).map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(&path, text).map_err(|e| format!("写入设置失败: {}", e))
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
}
