//! 开机自启（HKCU\...\Run 键，无需管理员权限）。

use super::registry;

pub const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
pub const RUN_VALUE_NAME: &str = "FileView";

/// 设置开机自启
pub fn set_autostart(enabled: bool, minimized: bool) -> Result<(), String> {
    let key = registry::create_key(RUN_KEY).map_err(|e| format!("创建 Run 键失败: {}", e))?;
    if enabled {
        let exe = super::context_menu::exe_path();
        let command = if minimized {
            format!("\"{}\" --minimized", exe)
        } else {
            format!("\"{}\"", exe)
        };
        registry::set_string(&key, RUN_VALUE_NAME, &command)
            .map_err(|e| format!("写入自启项失败: {}", e))?;
        registry::record_managed_key(RUN_KEY).map_err(|e| e.to_string())?;
    } else {
        let _ = key.delete_value(RUN_VALUE_NAME);
        let _ = registry::forget_managed_key(RUN_KEY);
    }
    Ok(())
}

/// 查询自启状态
pub fn status() -> bool {
    registry::open_key(RUN_KEY)
        .map(|k| k.get_value::<String, _>(RUN_VALUE_NAME).is_ok())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_autostart_toggle() {
        let _g = super::super::registry::test_support::lock();
        assert!(set_autostart(true, true).is_ok());
        assert!(status());
        assert!(set_autostart(false, false).is_ok());
        assert!(!status());
    }
}
