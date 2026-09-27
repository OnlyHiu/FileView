//! 右键菜单注入 / 移除。
//!
//! NSIS / 桌面版：写入 `HKCU\Software\Classes\*\shell\FileView` 等键，
//! 出现在资源管理器右键菜单（Windows 11 中位于「显示更多选项」经典菜单）。
//!
//! 每个目标：
//! - `all_files`   → `Software\Classes\*\shell\FileView`
//! - `json_files`  → `Software\Classes\.json\shell\FileView`
//! - `jsonl_files` → `Software\Classes\.jsonl\shell\FileView`
//! - `folders`     → `Software\Classes\Folder\shell\FileView`
//! - `directory_bg`→ `Software\Classes\Directory\Background\shell\FileView`

use super::registry;

/// 右键菜单注入目标
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuTarget {
    AllFiles,
    JsonFiles,
    JsonlFiles,
    Folders,
    DirectoryBackground,
}

impl MenuTarget {
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "all_files" => Some(MenuTarget::AllFiles),
            "json_files" => Some(MenuTarget::JsonFiles),
            "jsonl_files" => Some(MenuTarget::JsonlFiles),
            "folders" => Some(MenuTarget::Folders),
            "directory_bg" => Some(MenuTarget::DirectoryBackground),
            _ => None,
        }
    }

    pub fn id(&self) -> &'static str {
        match self {
            MenuTarget::AllFiles => "all_files",
            MenuTarget::JsonFiles => "json_files",
            MenuTarget::JsonlFiles => "jsonl_files",
            MenuTarget::Folders => "folders",
            MenuTarget::DirectoryBackground => "directory_bg",
        }
    }

    /// 注册表键路径（相对 HKCU）
    fn key_path(&self) -> String {
        let base = match self {
            MenuTarget::AllFiles => r"Software\Classes\*\shell".to_string(),
            MenuTarget::JsonFiles => r"Software\Classes\.json\shell".to_string(),
            MenuTarget::JsonlFiles => r"Software\Classes\.jsonl\shell".to_string(),
            MenuTarget::Folders => r"Software\Classes\Folder\shell".to_string(),
            MenuTarget::DirectoryBackground => {
                r"Software\Classes\Directory\Background\shell".to_string()
            }
        };
        format!(r"{}\{}", base, registry::MENU_KEY_NAME)
    }
}

/// 可执行文件路径（从当前进程推断）
pub fn exe_path() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "fileview.exe".to_string())
}

/// 菜单图标：默认用程序自身图标
fn icon_value() -> String {
    format!("{},0", exe_path())
}

/// 注入右键菜单（targets 为空表示移除该目标）
pub fn install(targets: &[MenuTarget]) -> Result<Vec<String>, String> {
    let mut installed = Vec::new();
    for target in targets {
        let key_path = target.key_path();
        let key = registry::create_key(&key_path).map_err(|e| format!("创建注册表键失败: {}", e))?;
        registry::set_string(&key, "MUIVerb", "用 FileView 打开")
            .map_err(|e| format!("写入菜单名称失败: {}", e))?;
        registry::set_string(&key, "Icon", &icon_value())
            .map_err(|e| format!("写入图标失败: {}", e))?;
        // SubCommands 留空表示无子菜单
        let cmd_key_path = format!(r"{}\command", key_path);
        let cmd_key =
            registry::create_key(&cmd_key_path).map_err(|e| format!("创建 command 键失败: {}", e))?;
        let command = format!("\"{}\" \"%1\"", exe_path());
        registry::set_string(&cmd_key, "", &command).map_err(|e| format!("写入命令失败: {}", e))?;
        registry::record_managed_key(&key_path).map_err(|e| format!("记录管理键失败: {}", e))?;
        installed.push(target.id().to_string());
    }
    registry::notify_shell_assoc_changed();
    Ok(installed)
}

/// 移除右键菜单（指定目标；空表示全部）
pub fn uninstall(targets: &[MenuTarget]) -> Result<Vec<String>, String> {
    let all = [
        MenuTarget::AllFiles,
        MenuTarget::JsonFiles,
        MenuTarget::JsonlFiles,
        MenuTarget::Folders,
        MenuTarget::DirectoryBackground,
    ];
    let list: Vec<MenuTarget> = if targets.is_empty() {
        all.to_vec()
    } else {
        targets.to_vec()
    };
    let mut removed = Vec::new();
    for target in list {
        let key_path = target.key_path();
        if registry::key_exists(&key_path) {
            registry::delete_key(&key_path).map_err(|e| format!("删除注册表键失败: {}", e))?;
            let _ = registry::forget_managed_key(&key_path);
            removed.push(target.id().to_string());
        }
    }
    registry::notify_shell_assoc_changed();
    Ok(removed)
}

/// 查询当前注入状态
pub fn status() -> Vec<(String, bool)> {
    [
        MenuTarget::AllFiles,
        MenuTarget::JsonFiles,
        MenuTarget::JsonlFiles,
        MenuTarget::Folders,
        MenuTarget::DirectoryBackground,
    ]
    .iter()
    .map(|t| (t.id().to_string(), registry::key_exists(&t.key_path())))
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_target_key_paths() {
        assert!(MenuTarget::AllFiles.key_path().contains(r"*\shell"));
        assert!(MenuTarget::JsonFiles.key_path().contains(r".json\shell"));
        assert!(MenuTarget::Folders.key_path().contains("Folder"));
    }

    #[test]
    fn test_roundtrip_install_uninstall() {
        let _g = super::super::registry::test_support::lock();
        // 注入再移除，保证最终状态干净
        let installed = install(&[MenuTarget::JsonFiles]).unwrap();
        assert_eq!(installed, vec!["json_files".to_string()]);
        let st = status();
        assert!(st.iter().any(|(id, on)| id == "json_files" && *on));
        uninstall(&[MenuTarget::JsonFiles]).unwrap();
        let st = status();
        assert!(st.iter().all(|(id, on)| !(id == "json_files" && *on)));
    }
}
