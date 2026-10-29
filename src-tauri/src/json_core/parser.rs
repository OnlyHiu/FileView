//! JSON 核心解析模块：解析 + 节点扁平化 + 诊断信息。
//!
//! 解析结果被扁平化为节点表，供树形/表格/原始视图与搜索共用。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 解析模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ParseMode {
    /// 严格 JSON
    Strict,
    /// JSONC：允许 // 与 /* */ 注释、尾逗号
    Jsonc,
    /// JSONL / NDJSON：逐行一个 JSON 值
    Jsonl,
}

impl Default for ParseMode {
    fn default() -> Self {
        ParseMode::Strict
    }
}

/// 节点类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Object,
    Array,
    String,
    Number,
    Boolean,
    Null,
}

/// 扁平化节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlatNode {
    /// 稳定 id（深度优先序号）
    pub id: usize,
    /// 显示路径，如 root.users[2].name
    pub path: String,
    /// 键名（数组元素为 None）
    pub key: Option<String>,
    /// 值的短显示文本（字符串带引号；对象/数组为摘要）
    pub value: String,
    pub kind: NodeKind,
    pub depth: usize,
    pub has_children: bool,
    /// 子节点数量（对象=键数，数组=长度，标量=0）
    pub child_count: usize,
    /// 在原始文本中的近似位置（用于编辑器联动；严格模式下填充）
    pub offset: Option<usize>,
    /// 父节点 id（根为 None）
    pub parent: Option<usize>,
}

/// 诊断信息（错误/警告）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub severity: Severity,
    pub message: String,
    pub line: usize,
    pub column: usize,
    pub offset: usize,
    /// 出错行片段
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// 解析统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ParseStats {
    pub total_nodes: usize,
    pub max_depth: usize,
    pub object_count: usize,
    pub array_count: usize,
    pub string_count: usize,
    pub number_count: usize,
    pub bool_count: usize,
    pub null_count: usize,
    pub elapsed_ms: u64,
    pub byte_size: usize,
}

/// 解析结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResult {
    pub nodes: Vec<FlatNode>,
    pub diagnostics: Vec<Diagnostic>,
    pub stats: ParseStats,
    /// 表格视图候选：根是否为「对象数组」
    pub table_candidate: bool,
    /// JSONL 模式下每个顶层值的范围
    pub line_values: Vec<(usize, usize)>,
}

/// serde_json 错误（含行列） -> Diagnostic
///
/// serde_json 的 `column()` 是**行内字节偏移**（1 起），不是字符数；
/// 因此换算为全局偏移时必须按**字节**推进，否则遇到多字节字符会算偏。
fn diag_from_serde(text: &str, err: &serde_json::Error) -> Diagnostic {
    let line = err.line().max(1);
    let column = err.column().max(1);
    // 行首字节偏移
    let mut line_start = 0usize;
    for (i, seg) in text.split('\n').enumerate() {
        if i + 1 == line {
            break;
        }
        line_start += seg.len() + 1; // +1 = '\n'
    }
    // 列 → 行内字节偏移（serde 的列为 1 起，故减 1）
    let line_text = text.split('\n').nth(line - 1).unwrap_or("");
    let col_bytes = (column - 1).min(line_text.len());
    let off = (line_start + col_bytes).min(text.len());
    let snippet = line_text.trim_end().to_string();
    Diagnostic {
        severity: Severity::Error,
        message: format!("JSON 解析错误: {}", err),
        line,
        column,
        offset: off,
        snippet: if snippet.is_empty() { None } else { Some(snippet) },
    }
}

/// 剥离 JSONC 注释与尾逗号（严格模式不调用）。
///
/// **字节长度保持不变**：注释的每个字节替换为一个空格（换行保留），
/// 尾逗号同样替换为空格而非删除。因此剥离结果与原文**逐字节对齐**，
/// serde_json 报出的行/列（字节列）可以直接映射回原文，行列号与偏移都不会漂移。
///
/// 两遍处理：
/// 1. 注释 → 等量空格（按字节，换行保留）；
/// 2. 尾逗号 → 空格（此时注释已变为空白，look-ahead 只需跳过空白，
///    「逗号 + 注释 + 闭合括号」也能正确识别）。
pub fn strip_jsonc(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());

    // ---- 第一遍：注释 → 空格（按字节，保留换行） ----
    let mut i = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    while i < bytes.len() {
        let c = bytes[i];
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == b'\\' {
                escaped = true;
            } else if c == b'"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        match c {
            b'"' => {
                in_string = true;
                out.push(c);
                i += 1;
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                // 行注释：整行替换为空格（换行保留）
                while i < bytes.len() && bytes[i] != b'\n' {
                    out.push(b' ');
                    i += 1;
                }
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                // 块注释：逐字节替换（换行保留），避免多行注释导致行号漂移
                while i < bytes.len() {
                    if bytes[i] == b'*' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
                        out.push(b' ');
                        out.push(b' ');
                        i += 2;
                        break;
                    }
                    if bytes[i] == b'\n' {
                        out.push(b'\n');
                    } else {
                        out.push(b' ');
                    }
                    i += 1;
                }
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }

    // ---- 第二遍：尾逗号 → 空格（保持字节长度） ----
    let mut out2 = Vec::with_capacity(out.len());
    let mut i = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    // 上一个非空白有效字符：用于区分「值后尾逗号」与 `"key": ,` 这类真正的语法错误
    let mut last_sig: Option<u8> = None;
    while i < out.len() {
        let c = out[i];
        if in_string {
            out2.push(c);
            if !c.is_ascii_whitespace() {
                last_sig = Some(c);
            }
            if escaped {
                escaped = false;
            } else if c == b'\\' {
                escaped = true;
            } else if c == b'"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        match c {
            b'"' => {
                in_string = true;
                out2.push(c);
                last_sig = Some(c);
                i += 1;
            }
            b',' => {
                i += 1;
                // 可能是尾逗号：跳过空白后是否为 } 或 ]，且逗号紧跟在值之后
                let mut j = i;
                while j < out.len() && out[j].is_ascii_whitespace() {
                    j += 1;
                }
                let after = j < out.len() && (out[j] == b'}' || out[j] == b']');
                // 值的结尾字符：字符串 '"'、对象 '}'、数组 ']'、数字 0-9、
                // true/false 的 'e'、null 的 'l'
                let after_value = matches!(last_sig, Some(b'"') | Some(b'}') | Some(b']') | Some(b'e') | Some(b'l'))
                    || matches!(last_sig, Some(d) if d.is_ascii_digit());
                if after && after_value {
                    // 用空格替换逗号（而不是删除），保持与原文的字节对齐
                    out2.push(b' ');
                } else {
                    out2.push(b',');
                    last_sig = Some(b',');
                }
            }
            _ => {
                out2.push(c);
                if !c.is_ascii_whitespace() {
                    last_sig = Some(c);
                }
                i += 1;
            }
        }
    }
    // 安全兜底：长度不一致时退回原始文本（不应发生）
    if out2.len() == bytes.len() {
        // 重新按 UTF-8 组装
        String::from_utf8(out2).unwrap_or_else(|_| text.to_string())
    } else {
        text.to_string()
    }
}

struct Flattener {
    nodes: Vec<FlatNode>,
    stats: ParseStats,
    next_id: usize,
}

impl Flattener {
    fn new() -> Self {
        Flattener {
            nodes: Vec::new(),
            stats: ParseStats::default(),
            next_id: 0,
        }
    }

    fn push(
        &mut self,
        path: String,
        key: Option<String>,
        value: String,
        kind: NodeKind,
        depth: usize,
        has_children: bool,
        child_count: usize,
        parent: Option<usize>,
    ) -> usize {
        let id = self.next_id;
        self.next_id += 1;
        self.nodes.push(FlatNode {
            id,
            path,
            key,
            value,
            kind,
            depth,
            has_children,
            child_count,
            offset: None,
            parent,
        });
        match kind {
            NodeKind::Object => self.stats.object_count += 1,
            NodeKind::Array => self.stats.array_count += 1,
            NodeKind::String => self.stats.string_count += 1,
            NodeKind::Number => self.stats.number_count += 1,
            NodeKind::Boolean => self.stats.bool_count += 1,
            NodeKind::Null => self.stats.null_count += 1,
        }
        self.stats.max_depth = self.stats.max_depth.max(depth);
        id
    }

    fn walk(&mut self, value: &Value, path: String, key: Option<String>, depth: usize, parent: Option<usize>) {
        match value {
            Value::Object(map) => {
                let id = self.push(
                    path.clone(),
                    key,
                    summarize_object(map),
                    NodeKind::Object,
                    depth,
                    !map.is_empty(),
                    map.len(),
                    parent,
                );
                for (k, v) in map {
                    let child_path = if path == "root" {
                        format!("root.{}", escape_key(k))
                    } else {
                        format!("{}.{}", path, escape_key(k))
                    };
                    self.walk(v, child_path, Some(k.clone()), depth + 1, Some(id));
                }
            }
            Value::Array(arr) => {
                let id = self.push(
                    path.clone(),
                    key,
                    summarize_array(arr),
                    NodeKind::Array,
                    depth,
                    !arr.is_empty(),
                    arr.len(),
                    parent,
                );
                for (idx, v) in arr.iter().enumerate() {
                    let child_path = format!("{}[{}]", path, idx);
                    self.walk(v, child_path, Some(idx.to_string()), depth + 1, Some(id));
                }
            }
            Value::String(s) => {
                // 与前端 JSON.stringify 一致：转义后加引号
                let display = serde_json::to_string(s).unwrap_or_else(|_| format!("{:?}", s));
                self.push(path, key, display, NodeKind::String, depth, false, 0, parent);
            }
            Value::Number(n) => {
                self.push(path, key, n.to_string(), NodeKind::Number, depth, false, 0, parent);
            }
            Value::Bool(b) => {
                self.push(path, key, b.to_string(), NodeKind::Boolean, depth, false, 0, parent);
            }
            Value::Null => {
                self.push(path, key, "null".to_string(), NodeKind::Null, depth, false, 0, parent);
            }
        }
    }
}

fn escape_key(k: &str) -> String {
    if k.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$') && !k.is_empty() {
        k.to_string()
    } else {
        format!("['{}']", k.replace('\'', "\\'"))
    }
}

fn summarize_object(map: &serde_json::Map<String, Value>) -> String {
    if map.is_empty() {
        "{}".to_string()
    } else {
        let keys: Vec<String> = map.keys().take(3).cloned().collect();
        let more = map.len().saturating_sub(3);
        if more > 0 {
            format!("{{ {} … +{} }}", keys.join(", "), more)
        } else {
            format!("{{ {} }}", keys.join(", "))
        }
    }
}

fn summarize_array(arr: &[Value]) -> String {
    if arr.is_empty() {
        "[]".to_string()
    } else {
        format!("[ {} 项 ]", arr.len())
    }
}

/// 主解析入口
pub fn parse(text: &str, mode: ParseMode) -> ParseResult {
    let start = std::time::Instant::now();
    let mut diagnostics = Vec::new();
    let mut line_values = Vec::new();

    let effective: String = match mode {
        ParseMode::Jsonc => strip_jsonc(text),
        _ => text.to_string(),
    };

    let parsed: Result<Vec<Value>, Vec<Diagnostic>> = match mode {
        ParseMode::Jsonl => {
            let mut values = Vec::new();
            let mut diags = Vec::new();
            let mut pos = 0usize;
            // 用 split('\n') 而非 lines()，以便对 CRLF 精确记账（lines() 会把 '\r' 一并剥掉）
            for (idx, seg) in effective.split('\n').enumerate() {
                let content = seg.strip_suffix('\r').unwrap_or(seg);
                if content.trim().is_empty() {
                    pos += seg.len() + 1;
                    continue;
                }
                match serde_json::from_str::<Value>(content) {
                    Ok(v) => {
                        line_values.push((pos, pos + content.len()));
                        values.push(v);
                    }
                    Err(e) => {
                        // 传入未 trim 的行内容，列号/偏移与原文一致
                        let mut d = diag_from_serde(content, &e);
                        d.line = idx + 1;
                        d.offset += pos;
                        diags.push(d);
                    }
                }
                pos += seg.len() + 1;
            }
            // 坏行诊断必须保留：即使部分行解析成功，也要让用户看到出错行。
            // 只有在「一行都没解析出来」时才整体失败（此时不返回任何节点）。
            if values.is_empty() && !diags.is_empty() {
                Err(diags)
            } else {
                // 保留诊断，但不影响已解析的节点
                diagnostics.extend(diags);
                Ok(values)
            }
        }
        _ => match serde_json::from_str::<Value>(&effective) {
            Ok(v) => Ok(vec![v]),
            Err(e) => Err(vec![diag_from_serde(text, &e)]),
        },
    };

    let values = match parsed {
        Ok(v) => v,
        Err(diags) => {
            diagnostics.extend(diags);
            return ParseResult {
                nodes: Vec::new(),
                diagnostics,
                stats: ParseStats {
                    byte_size: text.len(),
                    elapsed_ms: start.elapsed().as_millis() as u64,
                    ..Default::default()
                },
                table_candidate: false,
                line_values,
            };
        }
    };

    // 宽容模式下对不支持的重复键等产生警告
    if matches!(mode, ParseMode::Jsonc) && effective.len() != text.len() {
        // 提示注释/尾逗号已忽略（信息性）
    }

    let mut flattener = Flattener::new();
    // JSONL 恒为合成根数组（即使只有一行），保证 root[idx] 路径与查询引擎一致
    if values.len() == 1 && !matches!(mode, ParseMode::Jsonl) {
        flattener.walk(&values[0], "root".to_string(), None, 0, None);
    } else {
        // JSONL：合成根数组
        let root_id = flattener.push(
            "root".to_string(),
            None,
            format!("[ {} 项 ]", values.len()),
            NodeKind::Array,
            0,
            !values.is_empty(),
            values.len(),
            None,
        );
        for (idx, v) in values.iter().enumerate() {
            flattener.walk(v, format!("root[{}]", idx), Some(idx.to_string()), 1, Some(root_id));
        }
    }

    flattener.stats.total_nodes = flattener.nodes.len();
    flattener.stats.byte_size = text.len();
    flattener.stats.elapsed_ms = start.elapsed().as_millis() as u64;

    let table_candidate = flattener
        .nodes
        .first()
        .map(|n| {
            n.kind == NodeKind::Array
                && n.child_count > 0
                && flattener
                    .nodes
                    .iter()
                    .filter(|c| c.parent == Some(n.id))
                    .all(|c| c.kind == NodeKind::Object)
        })
        .unwrap_or(false);

    ParseResult {
        nodes: flattener.nodes,
        diagnostics,
        stats: flattener.stats,
        table_candidate,
        line_values,
    }
}

/// 将任意模式的文本转换为严格 JSON 值（JSONL 合成为数组）。
/// 供格式化 / 压缩 / 排序 / 查询 / 校验等命令层复用。
pub fn to_value(text: &str, mode: ParseMode) -> Result<Value, String> {
    match mode {
        ParseMode::Jsonc => serde_json::from_str(&strip_jsonc(text)).map_err(|e| format!("解析失败: {}", e)),
        ParseMode::Jsonl => {
            let mut values = Vec::new();
            // 与 parse() 保持一致：用 split('\n') 而非 lines()，以便 CRLF 精确记账
            for (idx, seg) in text.split('\n').enumerate() {
                let content = seg.strip_suffix('\r').unwrap_or(seg);
                let t = content.trim();
                if t.is_empty() {
                    continue;
                }
                let v: Value = serde_json::from_str(t)
                    .map_err(|e| format!("第 {} 行解析失败: {}", idx + 1, e))?;
                values.push(v);
            }
            Ok(Value::Array(values))
        }
        ParseMode::Strict => serde_json::from_str(text).map_err(|e| format!("解析失败: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_object() {
        let r = parse(r#"{"a": 1, "b": [true, null], "c": "x"}"#, ParseMode::Strict);
        assert!(r.diagnostics.is_empty());
        assert_eq!(r.stats.object_count, 1);
        assert_eq!(r.stats.array_count, 1);
        assert_eq!(r.stats.total_nodes, 6);
        assert_eq!(r.nodes[0].path, "root");
        assert_eq!(r.nodes[1].key.as_deref(), Some("a"));
    }

    #[test]
    fn test_parse_error_line_col() {
        let r = parse("{\n  \"a\": 1,\n  \"b\": ,\n}", ParseMode::Strict);
        assert!(!r.diagnostics.is_empty());
        assert_eq!(r.diagnostics[0].line, 3);
    }

    #[test]
    fn test_jsonc_comments_stripped() {
        let r = parse("{\n// comment\n\"a\": 1,\n/* block */\n\"b\": 2,\n}", ParseMode::Jsonc);
        assert!(r.diagnostics.is_empty(), "{:?}", r.diagnostics);
        assert_eq!(r.stats.object_count, 1);
    }

    #[test]
    fn test_jsonl() {
        let r = parse("{\"a\":1}\n{\"b\":2}\n", ParseMode::Jsonl);
        assert!(r.diagnostics.is_empty());
        assert_eq!(r.nodes[0].child_count, 2);
    }

    #[test]
    fn test_table_candidate() {
        let r = parse(r#"[{"a":1,"b":2},{"a":3,"b":4}]"#, ParseMode::Strict);
        assert!(r.table_candidate);
    }

    #[test]
    fn test_paths() {
        let r = parse(r#"{"users":[{"name":"Alice"}]}"#, ParseMode::Strict);
        let names: Vec<&str> = r.nodes.iter().map(|n| n.path.as_str()).collect();
        assert!(names.contains(&"root.users[0].name"));
    }

    #[test]
    fn test_jsonc_trailing_comma_with_comment() {
        // 尾逗号 + 注释：两者的组合都要被接受
        let r = parse("{\n  \"a\": 1, // 尾逗号前注释\n}", ParseMode::Jsonc);
        assert!(r.diagnostics.is_empty(), "{:?}", r.diagnostics);
        let r2 = parse("{\"a\": 1, /* 注释 */ }", ParseMode::Jsonc);
        assert!(r2.diagnostics.is_empty(), "{:?}", r2.diagnostics);
    }

    #[test]
    fn test_jsonc_block_comment_keeps_line_numbers() {
        // 多行块注释不改变行号：错误在原文第 6 行就应报第 6 行
        let text = "{\n/* 第2行\n   第3行\n   第4行 */\n  \"a\": 1,\n  \"b\": ,\n}";
        let r = parse(text, ParseMode::Jsonc);
        assert!(!r.diagnostics.is_empty());
        assert_eq!(r.diagnostics[0].line, 6, "{:?}", r.diagnostics);
    }

    #[test]
    fn test_jsonl_single_line_paths() {
        // JSONL 即使只有一行也合成根数组，路径与查询引擎一致
        let r = parse("{\"a\":1}", ParseMode::Jsonl);
        assert!(r.diagnostics.is_empty());
        assert_eq!(r.nodes[0].path, "root");
        assert_eq!(r.nodes[0].child_count, 1);
        assert_eq!(r.nodes[1].path, "root[0]");
        assert_eq!(r.nodes[2].path, "root[0].a");
    }

    #[test]
    fn test_jsonl_crlf_line_values() {
        let r = parse("{\"a\":1}\r\n{\"b\":2}\r\n", ParseMode::Jsonl);
        assert!(r.diagnostics.is_empty());
        assert_eq!(r.line_values, vec![(0, 7), (9, 16)]);
    }

    #[test]
    fn test_diag_offset_points_into_line() {
        // offset 应指向出错列，而非行首
        let r = parse("{\n  \"a\": ,\n}", ParseMode::Strict);
        assert!(!r.diagnostics.is_empty());
        assert_eq!(r.diagnostics[0].line, 2);
        // 行首为 2；出错位置在 "  \"a\": ," 的冒号后，offset 应大于行首
        assert!(r.diagnostics[0].offset > 2, "{:?}", r.diagnostics[0]);
    }

    #[test]
    fn test_string_value_escaped() {
        let r = parse(r#"{"s": "a\"b\nc"}"#, ParseMode::Strict);
        let s = r.nodes.iter().find(|n| n.key.as_deref() == Some("s")).unwrap();
        assert_eq!(s.value, "\"a\\\"b\\nc\"");
    }
}
