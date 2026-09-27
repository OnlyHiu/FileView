//! Windows 注册表封装（全部走 HKCU，无需管理员权限）。
//!
//! 「写入清单」机制：所有本应用写入的键都会记录到
//! `HKCU\Software\FileView\managed_keys`，保证卸载/清理时精准回滚。

use winreg::enums::*;
use winreg::RegKey;

pub const APP_KEY: &str = r"Software\FileView";
pub const PROG_ID_PREFIX: &str = "FileView";
pub const MENU_KEY_NAME: &str = "FileView";

/// 记录受管理的注册表键路径（幂等：重复记录同一键不会使计数虚高）
pub fn record_managed_key(key_path: &str) -> std::io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (managed, _) = hkcu.create_subkey(format!(r"{}\managed_keys", APP_KEY))?;
    let count: u32 = managed.get_value("count").unwrap_or(0);
    for i in 0..count {
        if let Ok(existing) = managed.get_value::<String, _>(format!("key{}", i)) {
            if existing == key_path {
                return Ok(());
            }
        }
    }
    let name = format!("key{}", count);
    managed.set_value(&name, &key_path)?;
    managed.set_value("count", &(count + 1))?;
    Ok(())
}

/// 从受管理清单中移除记录（卸载对应注册表键后调用，保证计数准确）
pub fn forget_managed_key(key_path: &str) -> std::io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (managed, _) = hkcu.create_subkey(format!(r"{}\managed_keys", APP_KEY))?;
    let count: u32 = managed.get_value("count").unwrap_or(0);
    let mut kept: Vec<String> = Vec::new();
    for i in 0..count {
        if let Ok(existing) = managed.get_value::<String, _>(format!("key{}", i)) {
            if existing != key_path {
                kept.push(existing);
            }
        }
    }
    for i in 0..count {
        let _ = managed.delete_value(format!("key{}", i));
    }
    for (i, path) in kept.iter().enumerate() {
        managed.set_value(&format!("key{}", i), path)?;
    }
    managed.set_value("count", &(kept.len() as u32))?;
    Ok(())
}

/// 查询当前受管理清单计数
pub fn managed_key_count() -> u32 {
    open_key(format!(r"{}\managed_keys", APP_KEY))
        .and_then(|k| k.get_value::<u32, _>("count").map_err(|e| e.into()))
        .unwrap_or(0)
}

/// 清空受管理键记录
pub fn clear_managed_keys() -> std::io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if hkcu.open_subkey(format!(r"{}\managed_keys", APP_KEY)).is_ok() {
        hkcu.delete_subkey_all(format!(r"{}\managed_keys", APP_KEY))?;
    }
    Ok(())
}

/// 删除 HKCU 下的任意子键（递归）
pub fn delete_key(path: impl AsRef<str>) -> std::io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.delete_subkey_all(path.as_ref())
}

/// 创建子键
pub fn create_key(path: impl AsRef<str>) -> std::io::Result<RegKey> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(path.as_ref())?;
    Ok(key)
}

/// 打开子键（只读）
pub fn open_key(path: impl AsRef<str>) -> std::io::Result<RegKey> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.open_subkey(path.as_ref())
}

/// 写字符串值
pub fn set_string(key: &RegKey, name: &str, value: &str) -> std::io::Result<()> {
    key.set_value(name, &value)
}

/// 写 REG_NONE 空值（OpenWithProgids 规范要求的值类型）
pub fn set_none(key: &RegKey, name: &str) -> std::io::Result<()> {
    key.set_raw_value(name, &winreg::RegValue { bytes: Vec::new(), vtype: REG_NONE })
}

/// 判断键是否存在
pub fn key_exists(path: impl AsRef<str>) -> bool {
    open_key(path).is_ok()
}

/// 通知 Shell：文件关联已更改（右键菜单/图标即时刷新）
pub fn notify_shell_assoc_changed() {
    unsafe {
        windows_sys::Win32::UI::Shell::SHChangeNotify(
            windows_sys::Win32::UI::Shell::SHCNE_ASSOCCHANGED as i32,
            windows_sys::Win32::UI::Shell::SHCNF_IDLIST,
            std::ptr::null(),
            std::ptr::null(),
        );
    }
}

#[cfg(test)]
pub mod test_support {
    use std::sync::{Mutex, MutexGuard, OnceLock};

    /// 串行化所有会触碰 HKCU（尤其 managed_keys 清单）的测试，避免并行互踩。
    pub fn lock() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_managed_keys_roundtrip() {
        let _g = test_support::lock();
        let path = format!(r"{}\test_managed", APP_KEY);
        let _ = delete_key(&path);
        assert!(record_managed_key(&path).is_ok());
        assert!(clear_managed_keys().is_ok());
    }

    #[test]
    fn test_record_managed_key_dedup_and_forget() {
        let _g = test_support::lock();
        clear_managed_keys().unwrap();
        let a = format!(r"{}\test_managed_a", APP_KEY);
        let b = format!(r"{}\test_managed_b", APP_KEY);
        record_managed_key(&a).unwrap();
        record_managed_key(&a).unwrap(); // 重复记录不应增加计数
        record_managed_key(&b).unwrap();
        assert_eq!(managed_key_count(), 2);
        forget_managed_key(&a).unwrap();
        assert_eq!(managed_key_count(), 1);
        forget_managed_key(&b).unwrap();
        assert_eq!(managed_key_count(), 0);
        clear_managed_keys().unwrap();
    }
}
