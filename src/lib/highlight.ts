// 语法高亮分词器（供文档区文本视图使用）
// 支持：JSON / Markdown / INI / YAML / TOML / CSV / XML / HTML / 日志 / C 家族代码 / 纯文本

import type { CodeLang, Lang } from "./types";

export interface Token {
  cls: string;
  text: string;
}

// ============ JSON ============

const KEY_RE = /^"(?:[^"\\]|\\.)*"(?=\s*:)/;
const STRING_RE = /^"(?:[^"\\]|\\.)*"/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const WORD_RE = /^(?:true|false|null)\b/;

export function tokenizeJson(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  let pending = "";
  const flush = () => {
    if (pending) {
      tokens.push({ cls: "syn-punct", text: pending });
      pending = "";
    }
  };
  while (i < n) {
    const rest = src.slice(i);
    const ch = src[i];
    if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") {
      pending += ch;
      i += 1;
      continue;
    }
    // JSONC 注释（// 行注释 与 /* */ 块注释）；严格 JSON 中 '/' 不可能出现在字符串外
    if (ch === "/" && src[i + 1] === "/") {
      flush();
      let j = i;
      while (j < n && src[j] !== "\n") j += 1;
      tokens.push({ cls: "syn-comment", text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      flush();
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j += 1;
      j = Math.min(j + 2, n);
      tokens.push({ cls: "syn-comment", text: src.slice(i, j) });
      i = j;
      continue;
    }
    let m = KEY_RE.exec(rest);
    if (m) {
      flush();
      tokens.push({ cls: "syn-key", text: m[0] });
      i += m[0].length;
      continue;
    }
    m = STRING_RE.exec(rest);
    if (m) {
      flush();
      tokens.push({ cls: "syn-string", text: m[0] });
      i += m[0].length;
      continue;
    }
    m = NUMBER_RE.exec(rest);
    if (m && /[\d-]/.test(ch)) {
      flush();
      tokens.push({ cls: "syn-number", text: m[0] });
      i += m[0].length;
      continue;
    }
    m = WORD_RE.exec(rest);
    if (m) {
      flush();
      tokens.push({ cls: m[0] === "null" ? "syn-null" : "syn-bool", text: m[0] });
      i += m[0].length;
      continue;
    }
    pending += ch;
    i += 1;
  }
  flush();
  return tokens;
}

// ============ Markdown ============

/** Markdown：行级（标题/围栏代码/引用/列表）+ 行内（行内代码/粗体/斜体/链接） */
export function tokenizeMarkdown(src: string): Token[] {
  const tokens: Token[] = [];
  const lines = src.split("\n");
  let inFence = false;
  const inline = /(`[^`]*`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]*\]\([^)]*\))/;
  lines.forEach((line, idx) => {
    const nl = idx < lines.length - 1 ? "\n" : "";
    if (/^\s*(```|~~~)/.test(line)) {
      tokens.push({ cls: "syn-code", text: line + nl });
      inFence = !inFence;
      return;
    }
    if (inFence) {
      tokens.push({ cls: "syn-code", text: line + nl });
      return;
    }
    const heading = /^(#{1,6}\s.*)$/.exec(line);
    if (heading) {
      tokens.push({ cls: "syn-heading", text: line + nl });
      return;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      tokens.push({ cls: "syn-punct", text: line + nl });
      return;
    }
    const quote = /^\s*(>\s?.*)$/.exec(line);
    if (quote) {
      tokens.push({ cls: "syn-quote", text: quote[1] + nl });
      return;
    }
    // 行内拆分
    let rest = line;
    let m: RegExpExecArray | null;
    while ((m = inline.exec(rest))) {
      const before = rest.slice(0, m.index);
      if (before) tokens.push({ cls: "", text: before });
      const t = m[0];
      const cls = t.startsWith("`")
        ? "syn-code"
        : t.startsWith("**")
          ? "syn-strong"
          : t.startsWith("[")
            ? "syn-link"
            : "syn-em";
      tokens.push({ cls, text: t });
      rest = rest.slice(m.index + t.length);
    }
    tokens.push({ cls: "", text: rest + nl });
  });
  return tokens;
}

// ============ INI / properties ============

/** INI：[section] / key=value / ; # 注释 */
export function tokenizeIni(src: string): Token[] {
  const tokens: Token[] = [];
  const lines = src.split("\n");
  lines.forEach((line, idx) => {
    const nl = idx < lines.length - 1 ? "\n" : "";
    const comment = /^\s*[;#].*$/.exec(line);
    if (comment) {
      tokens.push({ cls: "syn-comment", text: line + nl });
      return;
    }
    const section = /^\s*(\[[^\]]*\])\s*$/.exec(line);
    if (section) {
      tokens.push({ cls: "syn-section", text: line + nl });
      return;
    }
    const kv = /^(\s*[^=;#]+?)(\s*=\s*)(.*)$/.exec(line);
    if (kv) {
      tokens.push({ cls: "syn-keyname", text: kv[1] });
      tokens.push({ cls: "syn-punct", text: kv[2] });
      tokens.push({ cls: "syn-string", text: kv[3] + nl });
      return;
    }
    tokens.push({ cls: "", text: line + nl });
  });
  return tokens;
}

// ============ YAML ============

/** YAML：key: value / 列表项 / 注释 / 锚点 */
export function tokenizeYaml(src: string): Token[] {
  const tokens: Token[] = [];
  const lines = src.split("\n");
  lines.forEach((line, idx) => {
    const nl = idx < lines.length - 1 ? "\n" : "";
    const comment = /^(\s*)(#.*)$/.exec(line);
    if (comment) {
      tokens.push({ cls: "", text: comment[1] });
      tokens.push({ cls: "syn-comment", text: comment[2] + nl });
      return;
    }
    const kv = /^(\s*(?:-\s+)?)([^:#\n][^:#]*?)(\s*:\s*)(.*)$/.exec(line);
    if (kv) {
      tokens.push({ cls: "", text: kv[1] });
      tokens.push({ cls: "syn-keyname", text: kv[2] });
      tokens.push({ cls: "syn-punct", text: kv[3] });
      tokens.push({ cls: yamlValueCls(kv[4]), text: kv[4] + nl });
      return;
    }
    tokens.push({ cls: "", text: line + nl });
  });
  return tokens;
}

function yamlValueCls(v: string): string {
  const t = v.trim();
  if (!t) return "";
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(t)) return "syn-bool";
  if (/^-?\d+(\.\d+)?$/.test(t)) return "syn-number";
  if (/^["'].*["']$/.test(t)) return "syn-string";
  return "syn-string";
}

// ============ TOML ============

/** TOML：[table] / key = value / 数组 / 字符串 / 数字 / 布尔 */
export function tokenizeToml(src: string): Token[] {
  const tokens: Token[] = [];
  const lines = src.split("\n");
  lines.forEach((line, idx) => {
    const nl = idx < lines.length - 1 ? "\n" : "";
    const comment = /^(\s*)(#.*)$/.exec(line);
    if (comment) {
      tokens.push({ cls: "", text: comment[1] });
      tokens.push({ cls: "syn-comment", text: comment[2] + nl });
      return;
    }
    const table = /^\s*(\[\[?[^\]]*\]\]?)\s*$/.exec(line);
    if (table) {
      tokens.push({ cls: "syn-section", text: table[1] + nl });
      return;
    }
    const kv = /^(\s*)([^=]+?)(\s*=\s*)(.*)$/.exec(line);
    if (kv) {
      tokens.push({ cls: "", text: kv[1] });
      tokens.push({ cls: "syn-keyname", text: kv[2] });
      tokens.push({ cls: "syn-punct", text: kv[3] });
      const v = kv[4];
      if (/^(true|false)$/.test(v.trim())) tokens.push({ cls: "syn-bool", text: v + nl });
      else if (/^-?\d/.test(v.trim())) tokens.push({ cls: "syn-number", text: v + nl });
      else if (/^["'].*["'],?$/.test(v.trim())) tokens.push({ cls: "syn-string", text: v + nl });
      else tokens.push({ cls: "syn-string", text: v + nl });
      return;
    }
    tokens.push({ cls: "", text: line + nl });
  });
  return tokens;
}

// ============ CSV ============

/**
 * CSV：表头行作为键名，其余为值
 *
 * 注意：token 的 text 必须与源文本**逐字符对应**——编辑器用高亮层与
 * 透明 textarea 叠加显示，两者错位会导致光标与内容对不上。
 * 因此这里按原样切分单元格（保留引号与分隔符），只把「类型着色」应用到值上。
 */
export function tokenizeCsv(src: string): Token[] {
  const tokens: Token[] = [];
  const lines = src.split("\n");
  const delimiter = detectCsvDelimiter(src);
  lines.forEach((line, idx) => {
    const nl = idx < lines.length - 1 ? "\n" : "";
    const cells = splitCsvLineRaw(line, delimiter);
    cells.forEach((c, i) => {
      // 分隔符片段
      if (c.separator) {
        tokens.push({ cls: "syn-punct", text: c.separator });
        return;
      }
      // 值片段（保留原始引号）
      const value = c.value;
      const inner = unquote(value);
      const t = inner.trim();
      const cls =
        idx === 0
          ? "syn-keyname"
          : !t
            ? ""
            : /^-?\d+(\.\d+)?$/.test(t)
              ? "syn-number"
              : /^(true|false|null)$/i.test(t)
                ? "syn-bool"
                : "syn-string";
      tokens.push({ cls, text: value });
    });
    tokens.push({ cls: "", text: nl });
  });
  return tokens;
}

/**
 * 按分隔符切分，保留原始片段。
 *
 * 返回的片段按「值 → 分隔符 → 值 → 分隔符 → …」顺序排列，
 * 拼接后与源行**完全一致**（引号与分隔符原样保留），
 * 保证高亮层与透明编辑层像素对齐。
 */
function splitCsvLineRaw(line: string, delimiter: string): { separator: string; value: string }[] {
  const out: { separator: string; value: string }[] = [];
  let start = 0;
  let inQuote = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        // "" 为转义的双引号，仍在引号内
        if (line[i + 1] === '"') i += 1;
        else inQuote = false;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (line.startsWith(delimiter, i)) {
      out.push({ separator: "", value: line.slice(start, i) });
      out.push({ separator: delimiter, value: "" });
      i += delimiter.length;
      start = i;
      continue;
    }
    i += 1;
  }
  out.push({ separator: "", value: line.slice(start) });
  return out;
}

/** 去掉单元格外层引号（仅用于类型判断） */
function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/""/g, '"');
  }
  return v;
}

/** 拆分一行 CSV（支持双引号包裹与转义双引号） */
export function splitCsvLine(line: string, delimiter = ","): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQuote = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** 候选分隔符（按常见度排序） */
const CSV_DELIMITERS = [",", "\t", ";", "|"] as const;

/**
 * 自动识别 CSV 分隔符。
 *
 * 策略：取前若干行做「一致性打分」——候选分隔符把每行切成的列数越一致、
 * 列数越多，就越可能是真正的分隔符。这样可正确处理「值里含逗号但用分号分隔」
 * 「欧洲风格分号 + 小数点逗号」等情况。
 */
export function detectCsvDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 20);
  if (!lines.length) return ",";

  let best = ",";
  let bestScore = -Infinity;
  for (const delim of CSV_DELIMITERS) {
    const counts = lines.map((l) => splitCsvLine(l, delim).length);
    const max = Math.max(...counts);
    if (max < 2) continue; // 该分隔符切不开任何列 → 不考虑
    // 一致性：所有行列数是否相同
    const consistent = counts.every((c) => c === max) ? 1 : 0;
    // 得分：一致的行越多、列数越多越好
    const score = consistent * 1000 + max;
    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }
  return best;
}

// ============ XML / HTML ============

/** XML / HTML：标签、属性、字符串、注释 */
export function tokenizeMarkup(src: string, isHtml: boolean): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  let pending = "";
  const flush = () => {
    if (pending) {
      tokens.push({ cls: "", text: pending });
      pending = "";
    }
  };
  while (i < n) {
    const ch = src[i];
    if (ch !== "<") {
      pending += ch;
      i += 1;
      continue;
    }
    // 注释
    if (src.startsWith("<!--", i)) {
      flush();
      const end = src.indexOf("-->", i);
      const j = end === -1 ? n : end + 3;
      tokens.push({ cls: "syn-comment", text: src.slice(i, j) });
      i = j;
      continue;
    }
    // 标签
    const tagEnd = src.indexOf(">", i);
    if (tagEnd === -1) {
      pending += ch;
      i += 1;
      continue;
    }
    flush();
    const raw = src.slice(i, tagEnd + 1);
    tokens.push(...splitTag(raw, isHtml));
    i = tagEnd + 1;
  }
  flush();
  return tokens;
}

function splitTag(raw: string, isHtml: boolean): Token[] {
  const tokens: Token[] = [];
  const m = /^(<\/?)([A-Za-z][\w:-]*)/.exec(raw);
  if (!m) return [{ cls: "syn-tag", text: raw }];
  tokens.push({ cls: "syn-punct", text: m[1] });
  tokens.push({ cls: "syn-tag", text: m[2] });
  let rest = raw.slice(m[0].length);
  const attrRe = /([\w:-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)?/g;
  let am: RegExpExecArray | null;
  while ((am = attrRe.exec(rest))) {
    if (am.index > 0) tokens.push({ cls: "", text: rest.slice(0, am.index) });
    tokens.push({ cls: "syn-attr", text: am[1] });
    if (am[2]) tokens.push({ cls: "syn-punct", text: am[2] });
    if (am[3]) {
      tokens.push({
        cls: /^["']/.test(am[3]) ? "syn-string" : "syn-number",
        text: am[3],
      });
    }
    rest = rest.slice(am.index + am[0].length);
  }
  if (rest) tokens.push({ cls: isHtml ? "syn-tag" : "syn-punct", text: rest });
  return tokens;
}

// ============ 日志 ============

const LOG_LEVEL_RE =
  /\b(TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|ERR|FATAL|CRITICAL|PANIC)\b/;
const LOG_TIME_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/;

export function tokenizeLog(src: string): Token[] {
  const tokens: Token[] = [];
  const lines = src.split("\n");
  lines.forEach((line, idx) => {
    const nl = idx < lines.length - 1 ? "\n" : "";
    const level = LOG_LEVEL_RE.exec(line);
    const time = LOG_TIME_RE.exec(line);
    if (!level && !time) {
      tokens.push({ cls: "", text: line + nl });
      return;
    }
    const marks: { start: number; end: number; cls: string }[] = [];
    if (time) marks.push({ start: time.index, end: time.index + time[0].length, cls: "syn-timestamp" });
    if (level) {
      const w = level[1].toUpperCase();
      const cls = /^(ERROR|ERR|FATAL|CRITICAL|PANIC)$/.test(w)
        ? "syn-log-error"
        : /^(WARN|WARNING)$/.test(w)
          ? "syn-log-warn"
          : /^(INFO|NOTICE)$/.test(w)
            ? "syn-log-info"
            : "syn-log-debug";
      marks.push({ start: level.index, end: level.index + level[0].length, cls });
    }
    marks.sort((a, b) => a.start - b.start);
    let pos = 0;
    for (const mk of marks) {
      if (mk.start < pos) continue;
      if (mk.start > pos) tokens.push({ cls: "", text: line.slice(pos, mk.start) });
      tokens.push({ cls: mk.cls, text: line.slice(mk.start, mk.end) });
      pos = mk.end;
    }
    tokens.push({ cls: "", text: line.slice(pos) + nl });
  });
  return tokens;
}

// ============ C 家族通用代码高亮 ============

interface CodeSpec {
  lineComment: string | null;
  blockComment: [string, string] | null;
  quotes: string[];
  keywords: Set<string>;
  constants: Set<string>;
  caseInsensitive?: boolean;
}

const COMMON_TYPES = new Set([
  "int", "long", "short", "float", "double", "void", "char", "bool", "boolean", "byte",
  "string", "str", "usize", "isize", "u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64",
  "f32", "f64", "number", "any", "unknown", "object", "var", "let", "const", "def", "fn",
  "func", "function", "class", "struct", "enum", "interface", "trait", "type", "impl",
  "public", "private", "protected", "static", "final", "abstract", "async", "await", "yield",
  "new", "delete", "sizeof", "template", "namespace", "using", "package", "import", "export",
  "from", "module", "extends", "implements", "override", "virtual", "operator", "this",
  "self", "super", "global", "local", "auto", "register", "volatile", "inline", "where",
]);

const COMMON_CONSTANTS = new Set([
  "true", "false", "null", "None", "nil", "undefined", "True", "False", "None", "TRUE",
  "FALSE", "NULL", "None", "self", "this", "nullptr", "NaN", "Infinity", "and", "or", "not",
  "&&", "||", "!",
]);

const CODE_SPECS: Record<CodeLang, CodeSpec> = {
  javascript: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    keywords: new Set([
      "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger",
      "default", "delete", "do", "else", "export", "extends", "finally", "for", "from",
      "function", "get", "if", "import", "in", "instanceof", "let", "new", "of", "return",
      "set", "static", "super", "switch", "this", "throw", "try", "typeof", "var", "void",
      "while", "with", "yield", "interface", "type", "enum", "implements", "package",
      "private", "protected", "public", "readonly", "abstract", "declare", "namespace",
    ]),
    constants: new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]),
  },
  typescript: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    keywords: new Set([
      "abstract", "any", "as", "async", "await", "boolean", "break", "case", "catch", "class",
      "const", "continue", "declare", "default", "delete", "do", "else", "enum", "export",
      "extends", "finally", "for", "from", "function", "get", "if", "implements", "import",
      "in", "instanceof", "interface", "keyof", "let", "namespace", "new", "of", "private",
      "protected", "public", "readonly", "return", "satisfies", "set", "static", "super",
      "switch", "this", "throw", "try", "type", "typeof", "unknown", "var", "void", "while",
      "yield", "number", "string", "symbol", "never", "object",
    ]),
    constants: new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]),
  },
  python: {
    lineComment: "#",
    blockComment: null,
    quotes: ['"', "'"],
    keywords: new Set([
      "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
      "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in",
      "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while",
      "with", "yield", "match", "case",
    ]),
    constants: new Set(["True", "False", "None", "self", "cls", "__name__"]),
  },
  rust: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: new Set([
      "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum",
      "extern", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move",
      "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait",
      "type", "unsafe", "use", "where", "while", "union", "macro_rules",
    ]),
    constants: new Set(["true", "false", "None", "Some", "Ok", "Err", "String", "Vec"]),
  },
  go: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
    quotes: ['"', "`", "'"],
    keywords: new Set([
      "break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough",
      "for", "func", "go", "goto", "if", "import", "interface", "map", "package", "range",
      "return", "select", "struct", "switch", "type", "var",
    ]),
    constants: new Set(["true", "false", "nil", "iota"]),
  },
  java: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: new Set([
      "abstract", "assert", "break", "case", "catch", "class", "const", "continue", "default",
      "do", "else", "enum", "extends", "final", "finally", "for", "if", "implements",
      "import", "instanceof", "interface", "native", "new", "package", "private", "protected",
      "public", "record", "return", "static", "super", "switch", "synchronized", "this",
      "throw", "throws", "transient", "try", "var", "volatile", "while", "yield",
    ]),
    constants: new Set(["true", "false", "null"]),
  },
  csharp: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: new Set([
      "abstract", "as", "async", "await", "base", "break", "case", "catch", "checked",
      "class", "const", "continue", "default", "delegate", "do", "else", "enum", "event",
      "explicit", "extern", "finally", "fixed", "for", "foreach", "get", "goto", "if",
      "implicit", "in", "interface", "internal", "is", "lock", "namespace", "new", "operator",
      "out", "override", "params", "private", "protected", "public", "readonly", "record",
      "ref", "return", "sealed", "set", "sizeof", "stackalloc", "static", "struct", "switch",
      "this", "throw", "try", "typeof", "unchecked", "unsafe", "using", "var", "virtual",
      "void", "volatile", "while", "yield",
    ]),
    constants: new Set(["true", "false", "null"]),
  },
  cpp: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: new Set([
      "alignas", "alignof", "auto", "break", "case", "catch", "class", "const", "constexpr",
      "continue", "decltype", "default", "delete", "do", "else", "enum", "explicit",
      "export", "extern", "for", "friend", "goto", "if", "inline", "mutable", "namespace",
      "new", "noexcept", "operator", "private", "protected", "public", "return", "sizeof",
      "static", "struct", "switch", "template", "this", "throw", "try", "typedef", "typename",
      "union", "using", "virtual", "volatile", "while",
    ]),
    constants: new Set(["true", "false", "nullptr", "NULL"]),
  },
  kotlin: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: new Set([
      "as", "break", "by", "catch", "class", "companion", "const", "constructor", "continue",
      "crossinline", "data", "do", "else", "enum", "external", "false", "final", "finally",
      "for", "fun", "if", "import", "in", "init", "inline", "interface", "internal", "is",
      "lateinit", "object", "open", "operator", "override", "package", "private", "protected",
      "public", "reified", "return", "sealed", "super", "suspend", "this", "throw", "try",
      "typealias", "val", "var", "vararg", "when", "while",
    ]),
    constants: new Set(["true", "false", "null", "Unit"]),
  },
  swift: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: new Set([
      "as", "associatedtype", "break", "case", "catch", "class", "continue", "default",
      "defer", "deinit", "do", "else", "enum", "extension", "fallthrough", "fileprivate",
      "final", "for", "func", "guard", "if", "import", "in", "init", "inout", "internal",
      "is", "lazy", "let", "mutating", "open", "operator", "private", "protocol", "public",
      "repeat", "rethrows", "return", "self", "static", "struct", "subscript", "super",
      "switch", "throw", "throws", "try", "typealias", "var", "where", "while",
    ]),
    constants: new Set(["true", "false", "nil"]),
  },
  php: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: new Set([
      "abstract", "and", "array", "as", "break", "callable", "case", "catch", "class",
      "clone", "const", "continue", "declare", "default", "do", "echo", "else", "elseif",
      "empty", "enddeclare", "endfor", "endforeach", "endif", "endswitch", "endwhile",
      "extends", "final", "finally", "fn", "for", "foreach", "function", "global", "goto",
      "if", "implements", "include", "include_once", "instanceof", "insteadof", "interface",
      "isset", "list", "match", "namespace", "new", "or", "print", "private", "protected",
      "public", "readonly", "require", "require_once", "return", "static", "switch", "throw",
      "trait", "try", "unset", "use", "var", "while", "xor", "yield",
    ]),
    constants: new Set(["true", "false", "null", "TRUE", "FALSE", "NULL"]),
  },
  ruby: {
    lineComment: "#",
    blockComment: null,
    quotes: ['"', "'"],
    keywords: new Set([
      "alias", "and", "begin", "break", "case", "class", "def", "defined?", "do", "else",
      "elsif", "end", "ensure", "for", "if", "in", "module", "next", "not", "or", "redo",
      "rescue", "retry", "return", "self", "super", "then", "undef", "unless", "until",
      "when", "while", "yield", "require", "attr_accessor", "attr_reader", "attr_writer",
      "include", "extend", "lambda", "proc",
    ]),
    constants: new Set(["true", "false", "nil"]),
  },
  shell: {
    lineComment: "#",
    blockComment: null,
    quotes: ['"', "'"],
    keywords: new Set([
      "if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case",
      "esac", "function", "in", "select", "time", "return", "break", "continue", "local",
      "export", "readonly", "declare", "source", "alias", "set", "unset", "shift", "trap",
      "exit",
    ]),
    constants: new Set(["true", "false"]),
  },
  powershell: {
    lineComment: "#",
    blockComment: null,
    quotes: ['"', "'"],
    keywords: new Set([
      "begin", "break", "catch", "continue", "data", "do", "dynamicparam", "else", "elseif",
      "end", "exit", "filter", "finally", "for", "foreach", "from", "function", "if", "in",
      "param", "process", "return", "switch", "throw", "trap", "try", "until", "while",
      "workflow", "class", "enum", "hidden", "static",
    ]),
    constants: new Set(["$true", "$false", "$null"]),
  },
  sql: {
    lineComment: "--",
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: new Set([
      "select", "from", "where", "insert", "into", "values", "update", "set", "delete",
      "create", "table", "alter", "drop", "index", "view", "join", "inner", "left", "right",
      "full", "outer", "on", "group", "by", "order", "having", "limit", "offset", "union",
      "all", "distinct", "as", "and", "or", "not", "null", "is", "in", "between", "like",
      "case", "when", "then", "else", "end", "primary", "key", "foreign", "references",
      "default", "constraint", "unique", "with", "returning",
    ]),
    constants: new Set(["true", "false", "null"]),
    caseInsensitive: true,
  },
  lua: {
    lineComment: "--",
    blockComment: ["--[[", "]]"],
    quotes: ['"', "'"],
    keywords: new Set([
      "and", "break", "do", "else", "elseif", "end", "for", "function", "goto", "if", "in",
      "local", "not", "or", "repeat", "return", "then", "until", "while",
    ]),
    constants: new Set(["true", "false", "nil", "self"]),
  },
  dart: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: new Set([
      "abstract", "as", "async", "await", "break", "case", "catch", "class", "const",
      "continue", "covariant", "default", "deferred", "do", "else", "enum", "export",
      "extends", "extension", "external", "factory", "final", "finally", "for", "get", "if",
      "implements", "import", "in", "is", "late", "library", "mixin", "new", "null", "on",
      "operator", "part", "required", "rethrow", "return", "set", "show", "static", "super",
      "switch", "sync", "this", "throw", "try", "typedef", "var", "void", "while", "with",
      "yield",
    ]),
    constants: new Set(["true", "false", "null"]),
  },
  css: {
    lineComment: null,
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: new Set([
      "important", "inherit", "initial", "unset", "none", "auto", "flex", "grid", "block",
      "inline", "inline-block", "absolute", "relative", "fixed", "sticky", "solid", "dashed",
      "dotted", "hidden", "visible", "center", "left", "right", "top", "bottom",
    ]),
    constants: new Set(["true", "false", "null", "initial", "inherit"]),
  },
  perl: {
    lineComment: "#",
    blockComment: null,
    quotes: ["'", '"'],
    keywords: new Set([
      "sub", "my", "our", "local", "package", "use", "no", "require", "return",
      "if", "elsif", "else", "unless", "while", "until", "for", "foreach", "do",
      "last", "next", "redo", "eval", "die", "warn", "print", "printf", "say",
      "push", "pop", "shift", "unshift", "splice", "join", "split", "map", "grep",
      "sort", "reverse", "scalar", "defined", "ref", "exists", "delete", "wantarray",
    ]),
    constants: new Set(["undef", "1", "0", "__PACKAGE__", "__FILE__", "__LINE__"]),
  },
  r: {
    lineComment: "#",
    blockComment: null,
    quotes: ['"', "'"],
    keywords: new Set([
      "function", "if", "else", "for", "while", "repeat", "in", "next", "break",
      "return", "library", "require", "source", "TRUE", "FALSE", "NULL", "NA",
      "Inf", "NaN", "list", "c", "vector", "matrix", "data.frame", "factor",
    ]),
    constants: new Set(["TRUE", "FALSE", "NULL", "NA", "NA_integer_", "NA_real_", "Inf", "NaN"]),
  },
  plain: {
    lineComment: null,
    blockComment: null,
    quotes: [],
    keywords: new Set(),
    constants: new Set(),
  },
};

const IDENT_START = /[A-Za-z_$]/;
const IDENT_CHAR = /[A-Za-z0-9_$]/;

/** C 家族通用高亮 */
export function tokenizeCode(src: string, lang: CodeLang): Token[] {
  const spec = CODE_SPECS[lang] ?? CODE_SPECS.plain;
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  let pending = "";
  const flush = () => {
    if (pending) {
      tokens.push({ cls: "", text: pending });
      pending = "";
    }
  };
  const kw = spec.caseInsensitive ? lowerSet(spec.keywords) : spec.keywords;
  const cst = spec.caseInsensitive ? lowerSet(spec.constants) : spec.constants;

  while (i < n) {
    const ch = src[i];
    const rest = src.slice(i);

    // 行注释
    if (spec.lineComment && rest.startsWith(spec.lineComment)) {
      flush();
      let j = i;
      while (j < n && src[j] !== "\n") j += 1;
      tokens.push({ cls: "syn-comment", text: src.slice(i, j) });
      i = j;
      continue;
    }
    // 块注释
    if (spec.blockComment && rest.startsWith(spec.blockComment[0])) {
      flush();
      const endMark = spec.blockComment[1];
      const end = src.indexOf(endMark, i + spec.blockComment[0].length);
      const j = end === -1 ? n : end + endMark.length;
      tokens.push({ cls: "syn-comment", text: src.slice(i, j) });
      i = j;
      continue;
    }
    // 字符串
    if (spec.quotes.includes(ch)) {
      flush();
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === ch) {
          j += 1;
          break;
        }
        if (src[j] === "\n" && ch !== "`") break;
        j += 1;
      }
      tokens.push({ cls: "syn-string", text: src.slice(i, Math.min(j, n)) });
      i = Math.min(j, n);
      continue;
    }
    // 数字
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:0[xXbBoO])?[0-9a-fA-F_]+(?:\.[0-9_]+)?(?:[eE][+-]?[0-9]+)?[a-zA-Z_]*/.exec(rest);
      if (m) {
        flush();
        tokens.push({ cls: "syn-number", text: m[0] });
        i += m[0].length;
        continue;
      }
    }
    // 标识符
    if (IDENT_START.test(ch)) {
      let j = i;
      while (j < n && IDENT_CHAR.test(src[j])) j += 1;
      const word = src.slice(i, j);
      const key = spec.caseInsensitive ? word.toLowerCase() : word;
      let cls = "";
      if (kw.has(key)) cls = "syn-keyword";
      else if (cst.has(key) || COMMON_CONSTANTS.has(word)) cls = "syn-bool";
      else if (COMMON_TYPES.has(word)) cls = "syn-type";
      else if (/^[A-Z]/.test(word)) cls = "syn-type";
      else {
        // 函数调用：标识符后紧跟 (
        let k = j;
        while (k < n && /\s/.test(src[k])) k += 1;
        if (src[k] === "(") cls = "syn-func";
      }
      flush();
      tokens.push({ cls, text: word });
      i = j;
      continue;
    }
    // 标点
    if (/[{}()[\];,.:+\-*/%=<>!&|^~?@#]/.test(ch)) {
      flush();
      tokens.push({ cls: "syn-punct", text: ch });
      i += 1;
      continue;
    }
    pending += ch;
    i += 1;
  }
  flush();
  return tokens;
}

function lowerSet(set: Set<string>): Set<string> {
  return new Set([...set].map((s) => s.toLowerCase()));
}

// ============ 统一入口 ============

export function tokenize(src: string, lang: Lang): Token[] {
  switch (lang) {
    case "json":
      return tokenizeJson(src);
    case "markdown":
      return tokenizeMarkdown(src);
    case "ini":
      return tokenizeIni(src);
    case "yaml":
      return tokenizeYaml(src);
    case "toml":
      return tokenizeToml(src);
    case "csv":
      return tokenizeCsv(src);
    case "xml":
      return tokenizeMarkup(src, false);
    case "html":
      return tokenizeMarkup(src, true);
    case "log":
      return tokenizeLog(src);
    case "text":
      return [{ cls: "", text: src }];
    default:
      return tokenizeCode(src, lang);
  }
}
