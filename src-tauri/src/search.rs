//! 文件夹搜索与批量替换（Notepad++ 式「在文件夹中搜索」）。
//!
//! 搜索为**字面量**匹配，可选区分大小写与整词匹配；
//! 递归扫描时跳过版本库与依赖目录，避免无意义的大规模扫描。

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// 单个文件的体积上限：超过则跳过（避免扫描超大文件卡死）
const MAX_FILE_SIZE: u64 = 8 * 1024 * 1024;
/// 递归深度上限
const MAX_DEPTH: usize = 16;
/// 命中数上限
const MAX_HITS: usize = 20000;
/// 参与扫描的文件数上限
const MAX_FILES: usize = 20000;
/// 搜索词长度上限（超长词没有实际意义，也避免极端开销）
const MAX_QUERY_LEN: usize = 256;

/// 扫描时跳过的目录名
const SKIP_DIRS: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    ".idea",
    ".vscode",
    "node_modules",
    "target",
    "dist",
    "build",
    "__pycache__",
    ".venv",
    "venv",
    ".cache",
    ".gradle",
    "vendor",
    ".next",
    ".nuxt",
];

/// 单条命中
#[derive(Serialize, Clone, Debug)]
pub struct SearchHit {
    /// 文件路径
    pub path: String,
    /// 行号（1 起）
    pub line: u32,
    /// 列号（1 起，按 UTF-16 码元计）
    pub column: u32,
    /// 命中起始偏移（整个文件，按 **UTF-16 码元**计）
    ///
    /// 前端用该偏移直接调用 `textarea.setSelectionRange`，
    /// 而 JS 字符串下标按 UTF-16 码元计——必须与前端口径一致，
    /// 否则文件里每出现一个星平面字符（emoji 等）定位就偏一个字符。
    pub offset: u64,
    /// 命中长度（UTF-16 码元）
    pub length: u64,
    /// 命中所在整行文本
    pub text: String,
}

/// 文件夹搜索结果
#[derive(Serialize, Clone, Debug, Default)]
pub struct FolderSearchResult {
    pub hits: Vec<SearchHit>,
    /// 实际扫描的文件数
    pub scanned_files: usize,
    /// 因体积过大 / 二进制 / 非 UTF-8 而跳过的文件数
    pub skipped_files: usize,
    /// 是否因命中数上限提前结束
    pub truncated: bool,
}

/// 批量替换结果
#[derive(Serialize, Clone, Debug, Default)]
pub struct ReplaceResult {
    /// 实际改写的文件数
    pub changed_files: usize,
    /// 替换的命中总数
    pub replaced: usize,
    /// 改写失败的文件（被占用 / 只读 / 无权限）
    ///
    /// 之前写失败被静默忽略，界面却报告「已替换 N 处」——
    /// 用户以为改成功了，文件其实没动。
    pub failed_files: Vec<String>,
}

/// 是否为单词字符（整词匹配判定）
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// 折叠大小写后的字符序列。
///
/// 元素为 (折叠后的字符, 该字符在原字符串中的字节起止)。
///
/// 注意：`char::to_lowercase` **不是** 1:1 的（如 'İ' U+0130 → 'i' + U+0307 两个字符），
/// 因此必须把「折叠出的字符」都指向**同一个原字符的字节区间**，
/// 否则命中区间会被算成空区间，替换时只插入不删除 → 文件内容被写坏。
fn fold_chars(s: &str, case_sensitive: bool) -> Vec<(char, usize, usize)> {
    let mut out = Vec::new();
    for (byte, ch) in s.char_indices() {
        let end = byte + ch.len_utf8();
        if case_sensitive {
            out.push((ch, byte, end));
        } else {
            for c in ch.to_lowercase() {
                out.push((c, byte, end));
            }
        }
    }
    out
}

/// 在一行内查找所有命中，返回其在原行中的字节区间
fn match_ranges(line: &str, query: &str, case_sensitive: bool) -> Vec<(usize, usize)> {
    if query.is_empty() {
        return Vec::new();
    }
    let needle = fold_chars(query, case_sensitive);
    let hay = fold_chars(line, case_sensitive);
    let n = needle.len();
    if n == 0 || hay.len() < n {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut i = 0;
    while i + n <= hay.len() {
        let mut ok = true;
        for k in 0..n {
            if hay[i + k].0 != needle[k].0 {
                ok = false;
                break;
            }
        }
        if ok {
            // 起点取第一个原字符的字节起点，终点取最后一个原字符的字节终点
            let start = hay[i].1;
            let end = hay[i + n - 1].2;
            out.push((start, end.max(start)));
            i += n;
        } else {
            i += 1;
        }
    }
    out
}

/// 命中是否满足整词要求（前后不紧邻单词字符）
fn whole_word_ok(line: &str, start: usize, end: usize) -> bool {
    let before = line[..start].chars().next_back();
    let after = line[end..].chars().next();
    !before.map(is_word_char).unwrap_or(false) && !after.map(is_word_char).unwrap_or(false)
}

/// 在文本中查找命中（按行扫描，返回 UTF-16 偏移与行列）
fn search_text(
    text: &str,
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    hits: &mut Vec<SearchHit>,
    path: &str,
) {
    let mut line_utf16_start = 0usize;
    for (i, line) in text.split('\n').enumerate() {
        let ranges = match_ranges(line, query, case_sensitive);
        for (start, end) in ranges {
            if whole_word && !whole_word_ok(line, start, end) {
                continue;
            }
            // 偏移口径与前端一致：UTF-16 码元
            let column = line[..start].encode_utf16().count();
            let length = line[start..end].encode_utf16().count();
            hits.push(SearchHit {
                path: path.to_string(),
                line: (i + 1) as u32,
                column: (column + 1) as u32,
                offset: (line_utf16_start + column) as u64,
                length: length as u64,
                text: line.trim_end_matches('\r').to_string(),
            });
            if hits.len() >= MAX_HITS {
                return;
            }
        }
        line_utf16_start += line.encode_utf16().count() + 1; // +1：换行符
    }
}

/// 读取文本文件；返回 None 表示应跳过（二进制 / 过大 / 非 UTF-8）
fn read_searchable(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > MAX_FILE_SIZE {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    // 前 8KB 内出现 NUL 视为二进制文件
    let probe = &bytes[..bytes.len().min(8192)];
    if probe.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

/// 递归收集目录下的文件
fn collect_files(root: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut items: Vec<_> = entries.flatten().collect();
    items.sort_by_key(|e| e.file_name());
    for entry in items {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if ft.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            collect_files(&path, out, depth + 1);
        } else if ft.is_file() {
            out.push(path);
            if out.len() >= MAX_FILES {
                return;
            }
        }
    }
}

/// 在文件夹中递归搜索
#[tauri::command]
pub fn search_in_folder(
    root: String,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
) -> Result<FolderSearchResult, String> {
    if query.is_empty() {
        return Ok(FolderSearchResult::default());
    }
    if query.chars().count() > MAX_QUERY_LEN {
        return Err("搜索词过长".to_string());
    }
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("目录不存在：{root}"));
    }
    let mut files: Vec<PathBuf> = Vec::new();
    collect_files(&root_path, &mut files, 0);

    let mut result = FolderSearchResult::default();
    for file in files {
        if result.hits.len() >= MAX_HITS {
            result.truncated = true;
            break;
        }
        match read_searchable(&file) {
            Some(text) => {
                result.scanned_files += 1;
                let path = file.to_string_lossy().to_string();
                search_text(
                    &text,
                    &query,
                    case_sensitive,
                    whole_word,
                    &mut result.hits,
                    &path,
                );
            }
            None => result.skipped_files += 1,
        }
    }
    Ok(result)
}

/// 文本内字面量替换（返回替换后的文本与替换次数）
fn replace_in_text(
    text: &str,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
) -> (String, usize) {
    if query.is_empty() {
        return (text.to_string(), 0);
    }
    let mut out = String::with_capacity(text.len());
    let mut count = 0usize;
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        let ranges = match_ranges(line, query, case_sensitive);
        if ranges.is_empty() {
            out.push_str(line);
            continue;
        }
        let mut pos = 0usize;
        for (start, end) in ranges {
            out.push_str(&line[pos..start]);
            out.push_str(replacement);
            pos = end;
            count += 1;
        }
        out.push_str(&line[pos..]);
    }
    (out, count)
}

/// 在给定文件中批量替换
#[tauri::command]
pub fn replace_in_files(
    paths: Vec<String>,
    query: String,
    replacement: String,
    case_sensitive: bool,
) -> Result<ReplaceResult, String> {
    if query.is_empty() {
        return Ok(ReplaceResult::default());
    }
    let mut result = ReplaceResult::default();
    for p in paths {
        let path = PathBuf::from(&p);
        let Some(text) = read_searchable(&path) else {
            // 跳过（二进制 / 过大 / 非 UTF-8）：也要让用户知道
            result.failed_files.push(format!("{p}（已跳过：不是可搜索的文本文件）"));
            continue;
        };
        let (new_text, count) = replace_in_text(&text, &query, &replacement, case_sensitive);
        if count == 0 {
            continue;
        }
        match fs::write(&path, new_text.as_bytes()) {
            Ok(()) => {
                result.changed_files += 1;
                result.replaced += count;
            }
            Err(e) => {
                // 写失败（被占用 / 只读 / 无权限）必须如实报告：
                // 之前被静默忽略，界面却显示「已替换 N 处」
                result.failed_files.push(format!("{p}（{e}）"));
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_literal_matches_with_line_and_column() {
        let text = "hello world\nfoo hello bar\n";
        let mut hits = Vec::new();
        search_text(text, "hello", false, false, &mut hits, "a.txt");
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].line, 1);
        assert_eq!(hits[0].column, 1);
        assert_eq!(hits[0].offset, 0);
        assert_eq!(hits[1].line, 2);
        assert_eq!(hits[1].column, 5);
        assert_eq!(hits[1].offset, 16);
    }

    #[test]
    fn case_sensitive_option_is_respected() {
        let text = "Hello hello";
        let mut hits = Vec::new();
        search_text(text, "hello", true, false, &mut hits, "a.txt");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].column, 7);
    }

    #[test]
    fn whole_word_option_filters_substrings() {
        let text = "cat concat cat";
        let mut hits = Vec::new();
        search_text(text, "cat", false, true, &mut hits, "a.txt");
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn replaces_all_occurrences() {
        let (out, count) = replace_in_text("a-b-a-b", "a", "X", true);
        assert_eq!(out, "X-b-X-b");
        assert_eq!(count, 2);
    }

    #[test]
    fn replace_is_case_insensitive_when_requested() {
        let (out, count) = replace_in_text("Aa aa", "aa", "X", false);
        assert_eq!(out, "X X");
        assert_eq!(count, 2);
    }

    #[test]
    fn searches_and_replaces_inside_a_folder() {
        let dir = std::env::temp_dir().join(format!("fileview-search-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.txt"), "hello\nworld hello\n").unwrap();
        fs::write(dir.join("b.txt"), "nothing here\n").unwrap();
        let root = dir.to_string_lossy().to_string();

        let result = search_in_folder(root.clone(), "hello".into(), true, false).unwrap();
        assert_eq!(result.hits.len(), 2);
        assert_eq!(result.scanned_files, 2);
        assert!(result.hits.iter().all(|h| h.path.ends_with("a.txt")));

        let res = replace_in_files(
            vec![dir.join("a.txt").to_string_lossy().to_string()],
            "hello".into(),
            "HI".into(),
            true,
        )
        .unwrap();
        assert_eq!(res.changed_files, 1);
        assert_eq!(res.replaced, 2);
        let text = fs::read_to_string(dir.join("a.txt")).unwrap();
        assert_eq!(text, "HI\nworld HI\n");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lowercase_expanding_char_does_not_produce_empty_range() {
        // 'İ' (U+0130) 小写后是 'i' + U+0307 两个字符。
        // 折叠时若都指向同一字节偏移，命中区间会算成空区间，
        // 替换时只插入不删除 → 文件内容被写坏。
        let ranges = match_ranges("İzz", "i", false);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0], (0, 2), "命中区间必须覆盖整个原字符");
        let (out, count) = replace_in_text("İzz", "i", "X", false);
        assert_eq!(count, 1);
        assert_eq!(out, "Xzz", "原字符必须被真正替换掉");
    }

    #[test]
    fn offsets_are_utf16_code_units() {
        // emoji 是星平面字符：UTF-16 占 2 个码元
        let text = "😀 hello world";
        let mut hits = Vec::new();
        search_text(text, "world", false, false, &mut hits, "a.txt");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].offset, 9, "偏移必须按 UTF-16 码元计");
        assert_eq!(hits[0].length, 5);
        // 用 UTF-16 偏移切 JS 风格的字符串应正好命中
        let utf16: Vec<u16> = text.encode_utf16().collect();
        let got = String::from_utf16(&utf16[9..14]).unwrap();
        assert_eq!(got, "world");
    }

    #[test]
    fn failed_writes_are_reported() {
        // 目标是不存在的目录：写入必然失败，必须如实报告
        let res = replace_in_files(
            vec!["Z:\\definitely\\not\\exists\\a.txt".to_string()],
            "x".into(),
            "y".into(),
            true,
        )
        .unwrap();
        assert_eq!(res.changed_files, 0);
        assert_eq!(res.replaced, 0);
        assert_eq!(res.failed_files.len(), 1, "写失败必须上报，不能静默吞掉");
    }
}
