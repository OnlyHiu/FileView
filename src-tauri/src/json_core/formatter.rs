//! JSON 格式化 / 压缩 / 键排序。

use super::parser::{to_value, ParseMode};
use serde_json::Value;

/// 缩进样式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Indent {
    Spaces(usize),
    Tab,
}

impl Indent {
    pub fn as_str(&self) -> String {
        match self {
            Indent::Spaces(n) => " ".repeat(*n),
            Indent::Tab => "\t".to_string(),
        }
    }
}

/// JSONL：逐行处理，行序保持不变
fn map_jsonl_lines(
    text: &str,
    f: impl Fn(&Value) -> Result<String, String>,
) -> Result<String, String> {
    let mut out: Vec<String> = Vec::new();
    for (idx, line) in text.lines().enumerate() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let v: Value = serde_json::from_str(t).map_err(|e| format!("第 {} 行解析失败: {}", idx + 1, e))?;
        out.push(f(&v)?);
    }
    Ok(out.join("\n"))
}

/// 解析并以自定义缩进美化输出（支持严格 / JSONC / JSONL）
pub fn format(text: &str, mode: ParseMode, indent: &Indent) -> Result<String, String> {
    if matches!(mode, ParseMode::Jsonl) {
        return map_jsonl_lines(text, |v| serialize_with_indent(v, indent));
    }
    let value = to_value(text, mode)?;
    serialize_with_indent(&value, indent)
}

/// 压缩为最小体积
pub fn minify(text: &str, mode: ParseMode) -> Result<String, String> {
    if matches!(mode, ParseMode::Jsonl) {
        return map_jsonl_lines(text, |v| {
            serde_json::to_string(v).map_err(|e| format!("序列化失败: {}", e))
        });
    }
    let value = to_value(text, mode)?;
    serde_json::to_string(&value).map_err(|e| format!("序列化失败: {}", e))
}

/// 递归按键排序（对象键字典序；数组保持原序）
pub fn sort_keys(text: &str, mode: ParseMode, indent: &Indent) -> Result<String, String> {
    if matches!(mode, ParseMode::Jsonl) {
        return map_jsonl_lines(text, |v| serialize_with_indent(&sort_value(v.clone()), indent));
    }
    let value = to_value(text, mode)?;
    let sorted = sort_value(value);
    serialize_with_indent(&sorted, indent)
}

fn sort_value(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> = map.into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            let mut out = serde_json::Map::new();
            for (k, v) in entries {
                out.insert(k, sort_value(v));
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.into_iter().map(sort_value).collect()),
        other => other,
    }
}

/// serde_json pretty 使用 2 空格；这里支持自定义缩进
fn serialize_with_indent(value: &Value, indent: &Indent) -> Result<String, String> {
    if let Indent::Spaces(2) = indent {
        return serde_json::to_string_pretty(value).map_err(|e| format!("序列化失败: {}", e));
    }
    let pretty = serde_json::to_string_pretty(value).map_err(|e| format!("序列化失败: {}", e))?;
    let unit = indent.as_str();
    let mut out = String::with_capacity(pretty.len());
    for line in pretty.lines() {
        let spaces = line.len() - line.trim_start().len();
        let level = spaces / 2;
        for _ in 0..level {
            out.push_str(&unit);
        }
        out.push_str(line.trim_start());
        out.push('\n');
    }
    out.pop();
    Ok(out)
}

/// 校验：仅返回诊断，不产生输出（支持严格 / JSONC / JSONL）
pub fn validate(text: &str, mode: ParseMode) -> Result<(), (usize, usize, String)> {
    match mode {
        ParseMode::Jsonl => {
            for (idx, line) in text.lines().enumerate() {
                let content = line; // lines() 已剥 '\r'
                if content.trim().is_empty() {
                    continue;
                }
                if let Err(e) = serde_json::from_str::<Value>(content) {
                    return Err((idx + 1, e.column(), e.to_string()));
                }
            }
            Ok(())
        }
        ParseMode::Jsonc => {
            let eff = super::parser::strip_jsonc(text);
            serde_json::from_str::<Value>(&eff)
                .map(|_| ())
                .map_err(|e| (e.line(), e.column(), e.to_string()))
        }
        ParseMode::Strict => serde_json::from_str::<Value>(text)
            .map(|_| ())
            .map_err(|e| (e.line(), e.column(), e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_minify() {
        assert_eq!(minify("{\n  \"a\": 1\n}", ParseMode::Strict).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn test_format_minify_preserve_key_order() {
        // 格式化/压缩必须保持文档键序，不得按字典序重排（仅 sort_keys 重排）
        let out = format("{\"b\":1,\"a\":2}", ParseMode::Strict, &Indent::Spaces(2)).unwrap();
        assert!(out.find("\"b\"").unwrap() < out.find("\"a\"").unwrap(), "{}", out);
        let min = minify("{\"z\":1,\"y\":2}", ParseMode::Strict).unwrap();
        assert_eq!(min, "{\"z\":1,\"y\":2}");
    }

    #[test]
    fn test_format_tabs() {
        let out = format("{\"a\":{\"b\":1}}", ParseMode::Strict, &Indent::Tab).unwrap();
        assert!(out.contains("\t\"b\": 1"));
    }

    #[test]
    fn test_sort_keys() {
        let out = sort_keys("{\"b\":1,\"a\":{\"z\":1,\"y\":2}}", ParseMode::Strict, &Indent::Spaces(2)).unwrap();
        assert!(out.find("\"a\"").unwrap() < out.find("\"b\"").unwrap());
        assert!(out.find("\"y\"").unwrap() < out.find("\"z\"").unwrap());
    }

    #[test]
    fn test_validate_error() {
        let err = validate("{\"a\": }", ParseMode::Strict).unwrap_err();
        assert_eq!(err.0, 1);
    }

    #[test]
    fn test_format_jsonc() {
        let out = format("{\n// 注释\n\"a\":1,\n}", ParseMode::Jsonc, &Indent::Spaces(2)).unwrap();
        assert!(out.contains("\"a\": 1"), "{}", out);
    }

    #[test]
    fn test_jsonl_minify_per_line() {
        let out = minify("{\"a\": 1}\n{\"b\": 2}\n", ParseMode::Jsonl).unwrap();
        assert_eq!(out, "{\"a\":1}\n{\"b\":2}");
    }

    #[test]
    fn test_jsonl_sort_keys() {
        let out = sort_keys("{\"b\":1,\"a\":2}\n{\"d\":1,\"c\":2}", ParseMode::Jsonl, &Indent::Spaces(2)).unwrap();
        assert!(out.find("\"a\"").unwrap() < out.find("\"b\"").unwrap());
        assert!(out.find("\"c\"").unwrap() < out.find("\"d\"").unwrap());
    }

    #[test]
    fn test_validate_jsonl_reports_line() {
        let err = validate("{\"a\":1}\n{\"b\": }", ParseMode::Jsonl).unwrap_err();
        assert_eq!(err.0, 2);
    }
}
