// 语法高亮分词器（供源码/原始视图使用）：JSON / Markdown / INI / 日志 / 纯文本

import type { Lang } from "./types";

export interface Token {
  cls: string;
  text: string;
}

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
      tokens.push({ cls: "syn-quote", text: line + nl });
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

/** 日志：时间戳 + 级别着色 */
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

/** 统一入口：按语言分发 */
export function tokenize(src: string, lang: Lang): Token[] {
  switch (lang) {
    case "json":
      return tokenizeJson(src);
    case "markdown":
      return tokenizeMarkdown(src);
    case "ini":
      return tokenizeIni(src);
    case "log":
      return tokenizeLog(src);
    default:
      return [{ cls: "", text: src }];
  }
}
