//! 解析器回归测试：诊断信息的位置准确性与 JSONL 坏行保留。
//!
//! 这些用例对应代码审核中发现的缺陷：
//! 1. JSONL 部分行解析失败时，坏行诊断被整体丢弃（用户看不到出错行）；
//! 2. serde_json 的 column 是**字节列**，而旧实现按**字符**推进，多字节文本下偏移会错位；
//! 3. JSONC 剥离曾按字符替换注释、且直接删除尾逗号，导致剥离结果与原文不再逐字节对齐。

use crate::json_core::parser::{parse, strip_jsonc, ParseMode};

/// 取诊断 offset 处的字符
fn char_at(text: &str, offset: usize) -> Option<char> {
    text.get(offset..).and_then(|s| s.chars().next())
}

#[test]
fn test_jsonl_partial_failure_keeps_diagnostics() {
    // 一好一坏：坏行诊断必须保留，同时好行仍要产出节点
    let r = parse("{\"a\":1}\n{\"b\": }\n", ParseMode::Jsonl);
    assert_eq!(
        r.diagnostics.len(),
        1,
        "坏行诊断被丢弃：{:?}",
        r.diagnostics
    );
    assert_eq!(r.diagnostics[0].severity, crate::json_core::parser::Severity::Error);
    assert_eq!(r.diagnostics[0].line, 2);
    // 仍然解析出可用的节点（合成根数组里只有那 1 行合法数据）
    assert_eq!(r.nodes[0].kind, crate::json_core::parser::NodeKind::Array);
    assert_eq!(r.nodes[0].child_count, 1);
    assert_eq!(r.nodes[1].path, "root[0]");
    assert_eq!(r.nodes[2].path, "root[0].a");
    assert_eq!(r.nodes[2].key.as_deref(), Some("a"));
}

#[test]
fn test_jsonl_all_bad_lines_fails() {
    let r = parse("{\"b\": }\n{\"c\": }\n", ParseMode::Jsonl);
    assert_eq!(r.diagnostics.len(), 2);
    assert!(r.nodes.is_empty());
}

#[test]
fn test_strict_offset_points_at_error_char() {
    // 错误处为逗号：offset 必须精确指向它
    let text = "{\n  \"a\": ,\n}";
    let r = parse(text, ParseMode::Strict);
    assert!(!r.diagnostics.is_empty());
    assert_eq!(r.diagnostics[0].line, 2);
    assert_eq!(char_at(text, r.diagnostics[0].offset), Some(','));
}

#[test]
fn test_strict_offset_with_multibyte_before_error() {
    // 错误前有多字节键名：偏移必须按**字节**计算，不能按字符
    let text = "{\n  \"中文键\": ,\n}";
    let r = parse(text, ParseMode::Strict);
    assert!(!r.diagnostics.is_empty());
    assert_eq!(r.diagnostics[0].line, 2);
    assert_eq!(char_at(text, r.diagnostics[0].offset), Some(','));
}

#[test]
fn test_jsonc_offset_with_multibyte_comment() {
    // 多字节注释后有错误：注释按字节替换为空格，偏移仍应指向原文的错误字符
    let text = "{\"a\": 1, /* 中文注释 */ \"b\": ,}";
    let r = parse(text, ParseMode::Jsonc);
    assert!(!r.diagnostics.is_empty());
    assert_eq!(char_at(text, r.diagnostics[0].offset), Some(','));
}

#[test]
fn test_jsonc_offset_with_trailing_comma_removal() {
    // 值后尾逗号被替换为空白（而非删除），同行后续偏移不应前移
    let text = "{\"a\": [1,], \"b\": ,}";
    let r = parse(text, ParseMode::Jsonc);
    assert!(!r.diagnostics.is_empty());
    assert_eq!(char_at(text, r.diagnostics[0].offset), Some(','));
}

#[test]
fn test_strip_jsonc_preserves_byte_length() {
    // 剥离必须与原文逐字节对齐，行列号才可直接映射
    let cases = [
        "{\"a\": 1, /* 中文注释 */ \"b\": 2}",
        "{\n// 行注释\n\"a\": 1,\n}",
        "{\"a\": [1,], \"b\": 2,}",
        "{\"a\": 1 /* unterminated",
        "{/* 中文 */ \"a\": 1}",
    ];
    for case in cases {
        let stripped = strip_jsonc(case);
        assert_eq!(
            stripped.len(),
            case.len(),
            "字节长度不一致: {:?} -> {:?}",
            case,
            stripped
        );
        // 行数也必须一致
        assert_eq!(
            stripped.lines().count(),
            case.lines().count(),
            "行数不一致: {:?}",
            case
        );
    }
}

#[test]
fn test_jsonc_line_numbers_preserved() {
    // 多行块注释不改变行号
    let text = "{\n/* 第2行\n   第3行\n   第4行 */\n  \"a\": 1,\n  \"b\": ,\n}";
    let r = parse(text, ParseMode::Jsonc);
    assert!(!r.diagnostics.is_empty());
    assert_eq!(r.diagnostics[0].line, 6);
}

#[test]
fn test_jsonc_multiline_block_comment_offsets() {
    // 多行块注释（字节长度不变）后，错误偏移仍应精确
    let text = "{\n/* 中文\n   注释 */\n  \"a\": ,\n}";
    let r = parse(text, ParseMode::Jsonc);
    assert!(!r.diagnostics.is_empty());
    assert_eq!(r.diagnostics[0].line, 4);
    assert_eq!(char_at(text, r.diagnostics[0].offset), Some(','));
}
