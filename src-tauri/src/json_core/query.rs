//! 迷你 JSONPath 查询引擎。
//!
//! 支持子集：`$` 根、`.key`、`['key']`、`[n]`、`[*]`、`..key`（递归下降）、
//! `.*`。返回所有命中的路径字符串（与 parser 的路径格式一致）。

use crate::json_core::parser::{to_value, ParseMode};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
enum Step {
    Child(String),
    Index(usize),
    Wildcard,
    Recursive(String),
}

/// 解析表达式为步骤序列
fn parse_expr(expr: &str) -> Result<Vec<Step>, String> {
    let chars: Vec<char> = expr.chars().collect();
    let mut i = 0usize;
    let mut steps = Vec::new();
    // 允许开头的 $
    if i < chars.len() && chars[i] == '$' {
        i += 1;
    }
    while i < chars.len() {
        match chars[i] {
            '.' => {
                if i + 1 < chars.len() && chars[i + 1] == '.' {
                    // 递归下降
                    i += 2;
                    if i < chars.len() && chars[i] == '[' {
                        return Err("暂不支持 ..[ 语法".into());
                    }
                    let start = i;
                    while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '$') {
                        i += 1;
                    }
                    if start == i {
                        if i < chars.len() && chars[i] == '*' {
                            i += 1;
                            steps.push(Step::Recursive("*".into()));
                        } else {
                            return Err("递归下降后缺少键名".into());
                        }
                    } else {
                        let key: String = chars[start..i].iter().collect();
                        steps.push(Step::Recursive(key));
                    }
                } else {
                    i += 1;
                    if i < chars.len() && chars[i] == '*' {
                        i += 1;
                        steps.push(Step::Wildcard);
                    } else {
                        let start = i;
                        while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '$') {
                            i += 1;
                        }
                        if start == i {
                            return Err("键名为空".into());
                        }
                        let key: String = chars[start..i].iter().collect();
                        steps.push(Step::Child(key));
                    }
                }
            }
            '[' => {
                i += 1;
                if i < chars.len() && chars[i] == '\'' {
                    i += 1;
                    let start = i;
                    while i < chars.len() && chars[i] != '\'' {
                        i += 1;
                    }
                    let key: String = chars[start..i].iter().collect();
                    if i < chars.len() {
                        i += 1; // skip '
                    }
                    if i < chars.len() && chars[i] == ']' {
                        i += 1;
                    }
                    steps.push(Step::Child(key));
                } else if i < chars.len() && chars[i] == '*' {
                    i += 1;
                    if i < chars.len() && chars[i] == ']' {
                        i += 1;
                    }
                    steps.push(Step::Wildcard);
                } else {
                    let start = i;
                    while i < chars.len() && chars[i] != ']' {
                        i += 1;
                    }
                    let num: String = chars[start..i].iter().collect();
                    if i < chars.len() {
                        i += 1; // skip ]
                    }
                    let idx: usize = num.trim().parse().map_err(|_| format!("无效索引: {}", num))?;
                    steps.push(Step::Index(idx));
                }
            }
            c if c.is_whitespace() => {
                i += 1;
            }
            c => return Err(format!("意外的字符: {}", c)),
        }
    }
    Ok(steps)
}

fn escape_key(k: &str) -> String {
    if k.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$') && !k.is_empty() {
        k.to_string()
    } else {
        format!("['{}']", k.replace('\'', "\\'"))
    }
}

/// 在值上执行路径匹配，收集命中的路径
fn collect(value: &Value, base: &str, steps: &[Step], out: &mut Vec<String>) {
    if steps.is_empty() {
        out.push(base.to_string());
        return;
    }
    match &steps[0] {
        Step::Child(key) => {
            if let Value::Object(map) = value {
                if let Some(v) = map.get(key) {
                    let path = if base == "root" {
                        format!("root.{}", escape_key(key))
                    } else {
                        format!("{}.{}", base, escape_key(key))
                    };
                    collect(v, &path, &steps[1..], out);
                }
            }
        }
        Step::Index(idx) => {
            if let Value::Array(arr) = value {
                if let Some(v) = arr.get(*idx) {
                    collect(v, &format!("{}[{}]", base, idx), &steps[1..], out);
                }
            }
        }
        Step::Wildcard => match value {
            Value::Object(map) => {
                for (k, v) in map {
                    let path = if base == "root" {
                        format!("root.{}", escape_key(k))
                    } else {
                        format!("{}.{}", base, escape_key(k))
                    };
                    collect(v, &path, &steps[1..], out);
                }
            }
            Value::Array(arr) => {
                for (i, v) in arr.iter().enumerate() {
                    collect(v, &format!("{}[{}]", base, i), &steps[1..], out);
                }
            }
            _ => {}
        },
        Step::Recursive(key) => {
            // 递归下降：任意深度查找键
            fn descend(
                value: &Value,
                base: &str,
                key: &str,
                rest: &[Step],
                out: &mut Vec<String>,
            ) {
                match value {
                    Value::Object(map) => {
                        for (k, v) in map {
                            let path = if base == "root" {
                                format!("root.{}", escape_key(k))
                            } else {
                                format!("{}.{}", base, escape_key(k))
                            };
                            if key == "*" || k == key {
                                collect(v, &path, rest, out);
                            }
                            descend(v, &path, key, rest, out);
                        }
                    }
                    Value::Array(arr) => {
                        for (i, v) in arr.iter().enumerate() {
                            let path = format!("{}[{}]", base, i);
                            descend(v, &path, key, rest, out);
                        }
                    }
                    _ => {}
                }
            }
            descend(value, base, key, &steps[1..], out);
        }
    }
}

/// 对外入口：查询并返回路径列表（支持严格 / JSONC / JSONL）
pub fn query(text: &str, expr: &str, mode: ParseMode) -> Result<Vec<String>, String> {
    let value = to_value(text, mode)?;
    let steps = parse_expr(expr)?;
    let mut out = Vec::new();
    collect(&value, "root", &steps, &mut out);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "store": {
            "book": [
                {"category": "ref", "price": 8.95, "title": "Sayings"},
                {"category": "fic", "price": 12.99, "title": "Sword"}
            ],
            "bicycle": {"color": "red", "price": 19.95}
        }
    }"#;

    #[test]
    fn test_child_query() {
        let r = query(SAMPLE, "$.store.bicycle.color", ParseMode::Strict).unwrap();
        assert_eq!(r, vec!["root.store.bicycle.color"]);
    }

    #[test]
    fn test_index_query() {
        let r = query(SAMPLE, "$.store.book[1].title", ParseMode::Strict).unwrap();
        assert_eq!(r, vec!["root.store.book[1].title"]);
    }

    #[test]
    fn test_wildcard() {
        let r = query(SAMPLE, "$.store.book[*].price", ParseMode::Strict).unwrap();
        assert_eq!(r.len(), 2);
    }

    #[test]
    fn test_recursive_descent() {
        let r = query(SAMPLE, "$..price", ParseMode::Strict).unwrap();
        assert_eq!(r.len(), 3);
    }

    #[test]
    fn test_bracket_key() {
        let r = query(SAMPLE, "$['store']['bicycle']['color']", ParseMode::Strict).unwrap();
        assert_eq!(r, vec!["root.store.bicycle.color"]);
    }

    #[test]
    fn test_query_jsonc() {
        let r = query("{\n// 注释\n\"a\": {\"b\": 1},\n}", "$.a.b", ParseMode::Jsonc).unwrap();
        assert_eq!(r, vec!["root.a.b"]);
    }

    #[test]
    fn test_query_jsonl() {
        let r = query("{\"a\":1}\n{\"a\":2}\n", "$[*].a", ParseMode::Jsonl).unwrap();
        assert_eq!(r, vec!["root[0].a", "root[1].a"]);
    }
}
