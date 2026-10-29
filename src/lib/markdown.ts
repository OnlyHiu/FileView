// Markdown 轻量渲染器：标题/围栏代码/列表/引用/表格(GFM)/链接/粗斜体 + 受限 HTML 直通
//
// 安全说明：Markdown 预览通过 `dangerouslySetInnerHTML` 注入到 Tauri webview，
// 而 webview 内存在 IPC 桥（可调用 read_file_text / write_file_text 等命令）。
// 因此 HTML 直通必须走**白名单**：只保留明确允许的标签与属性，
// 其余标签一律丢弃，危险元素（script/style/iframe/…）连同内容一起移除。

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 属性值转义（用于属性上下文，比 escapeHtml 多处理单引号） */
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

/** 允许直通的标签（白名单） */
const ALLOWED_TAGS = new Set([
  "p", "div", "span", "br", "hr", "img", "details", "summary",
  "strong", "em", "b", "i", "u", "s", "del", "ins", "mark", "small",
  "abbr", "kbd", "sub", "sup", "code", "pre", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "figure", "figcaption", "section", "article", "aside", "header", "footer", "nav",
  "font", "tt", "var", "strike", "wbr", "picture", "source",
]);

/** 允许的通用属性 */
const ALLOWED_ATTRS = new Set([
  "class", "title", "alt", "width", "height", "dir", "lang",
  "colspan", "rowspan", "align", "valign", "start", "type", "span", "open",
]);

/** 各标签额外允许的属性 */
const TAG_ATTRS: Record<string, string[]> = {
  a: ["href", "target", "rel", "name"],
  img: ["src"],
  source: ["src", "srcset"],
  td: ["colspan", "rowspan", "headers", "abbr", "scope", "style"],
  th: ["colspan", "rowspan", "headers", "abbr", "scope", "style"],
  table: ["summary", "border", "cellpadding", "cellspacing", "style"],
  col: ["span", "style"],
  colgroup: ["span", "style"],
  ol: ["start", "type", "reversed"],
  details: ["open"],
  font: ["color", "face", "size"],
};

/** URL 类属性：值必须是安全协议 */
const URL_ATTRS = new Set(["href", "src", "srcset", "cite", "longdesc"]);

/** 这些标签即使在白名单里也要丢弃其 style 属性 */
const DROP_STYLE_TAGS = new Set(["a", "img", "source", "span", "div", "p"]);

/**
 * 需要连同内容一起移除的元素（可执行 / 可导航 / 可加载外部资源）。
 * 处理方式：从开标签一直跳到对应的闭标签。
 */
const DANGEROUS_CONTAINERS = new Set([
  "script", "style", "iframe", "object", "embed", "applet", "form",
  "svg", "math", "template", "noscript", "textarea", "title", "head",
  "html", "body", "frame", "frameset", "marquee", "xmp", "plaintext",
  "listing", "noembed", "noframes", "canvas", "audio", "video", "portal",
]);

/** 危险的自闭合 / 空元素：直接丢弃标签本身 */
const DANGEROUS_VOID = new Set(["base", "meta", "link", "param", "track", "input", "keygen"]);

/** HTML 空元素（无需闭合） */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** 允许的 URL 协议 */
const SAFE_PROTOCOL_RE = /^(?:https?:|mailto:|tel:|ftp:)/i;

/** 相对路径前缀（不含 `//`，避免协议相对地址） */
const SAFE_RELATIVE_RE = /^(?:#|\/(?!\/)|\.{1,2}\/)/;

/**
 * 校验并规范化 URL。
 * 不安全或格式异常的 URL 一律退化为 `#`。
 */
function safeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "#";
  // 拒绝控制字符与引号（防止属性逃逸）
  if (/[\s"'<>`\\]/.test(trimmed)) return "#";
  if (SAFE_PROTOCOL_RE.test(trimmed)) return escapeAttr(trimmed);
  if (SAFE_RELATIVE_RE.test(trimmed)) return escapeAttr(trimmed);
  return "#";
}

/** 解析属性串 */
interface Attr {
  name: string;
  value: string | null;
}

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(raw: string): Attr[] {
  const out: Attr[] = [];
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(raw))) {
    const value = m[2] ?? m[3] ?? m[4] ?? null;
    out.push({ name: m[1].toLowerCase(), value });
  }
  return out;
}

/** 单个标签是否允许，并输出净化后的标签文本 */
function sanitizeTag(tagText: string): string {
  const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)(\/?)>$/.exec(
    tagText
  );
  if (!m) return "";
  const closing = m[1] === "/";
  const name = m[2].toLowerCase();
  const rawAttrs = m[3] ?? "";
  const selfClosing = m[4] === "/";

  if (!ALLOWED_TAGS.has(name)) return "";

  // 闭合标签：直接输出（属性无意义）
  if (closing) return `</${name}>`;

  const extra = TAG_ATTRS[name] ?? [];
  const parts: string[] = [];
  for (const attr of parseAttrs(rawAttrs)) {
    // 事件处理器 / style 等一律不通过白名单
    if (attr.name.startsWith("on")) continue;
    if (attr.name === "style" && !extra.includes("style")) continue;
    if (attr.name === "style" && DROP_STYLE_TAGS.has(name)) continue;
    const allowed =
      ALLOWED_ATTRS.has(attr.name) || extra.includes(attr.name);
    if (!allowed) continue;
    let value = attr.value ?? "";
    if (URL_ATTRS.has(attr.name)) {
      value = safeUrl(value);
    } else {
      value = escapeAttr(value);
    }
    parts.push(`${attr.name}="${value}"`);
  }
  // 外链强制 rel=noopener，避免 opener 劫持
  if (name === "a") {
    const target = parts.find((p) => p.startsWith("target="));
    if (target && !parts.some((p) => p.startsWith("rel="))) {
      parts.push('rel="noopener noreferrer"');
    }
  }
  const attrText = parts.length ? ` ${parts.join(" ")}` : "";
  if (VOID_TAGS.has(name)) return `<${name}${attrText}>`;
  if (selfClosing) return `<${name}${attrText} />`;
  return `<${name}${attrText}>`;
}

/** 标签扫描：把文本与标签分开 */
const TAG_SCAN_RE = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*?)?\/?>|<!--[\s\S]*?-->/g;

/**
 * 片段级净化：HTML 块使用。
 * - 文本一律转义
 * - 危险元素连同内容移除
 * - 其余标签按白名单过滤
 */
function sanitizeFragment(html: string): string {
  // 先移除注释
  const noComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const out: string[] = [];
  let last = 0;
  // 危险容器跳过的深度计数（同名嵌套）
  let skipTag: string | null = null;
  let skipDepth = 0;

  TAG_SCAN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_SCAN_RE.exec(noComments))) {
    const text = noComments.slice(last, m.index);
    last = m.index + m[0].length;

    if (skipTag) {
      // 处于危险元素内部：只跟踪同名嵌套的结束
      const cm = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(m[0]);
      const tagName = cm ? cm[1].toLowerCase() : "";
      if (tagName === skipTag) {
        if (m[0].startsWith("</")) skipDepth -= 1;
        else if (!/\/>$/.test(m[0]) && !VOID_TAGS.has(tagName)) skipDepth += 1;
        if (skipDepth <= 0) {
          skipTag = null;
          skipDepth = 0;
        }
      }
      continue;
    }

    // 文本：转义
    if (text) out.push(escapeHtml(text));

    if (m[0].startsWith("<!--")) continue;

    const openMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(m[0]);
    const tagName = openMatch ? openMatch[1].toLowerCase() : "";
    const isClosing = m[0].startsWith("</");

    if (DANGEROUS_VOID.has(tagName)) continue;

    if (!isClosing && DANGEROUS_CONTAINERS.has(tagName)) {
      // 危险容器：跳到对应闭标签（自闭合则直接忽略）
      if (/\/>$/.test(m[0]) || VOID_TAGS.has(tagName)) continue;
      skipTag = tagName;
      skipDepth = 1;
      continue;
    }

    const safe = sanitizeTag(m[0]);
    if (safe) out.push(safe);
  }

  // 收尾文本
  if (!skipTag) {
    const tail = noComments.slice(last);
    if (tail) out.push(escapeHtml(tail));
  }
  return out.join("");
}

/**
 * 移除危险容器元素**连同其内容**。
 * 用于行内上下文：先整体删除，再做标签白名单过滤，
 * 避免 `<script>alert(1)</script>` 只丢标签却留下内容。
 */
function stripDangerousContainers(text: string): string {
  let out = text;
  for (const tag of DANGEROUS_CONTAINERS) {
    // 开标签 + 内容 + 闭标签（内容可跨行）
    const re = new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`,
      "gi"
    );
    out = out.replace(re, "");
    // 未闭合的开标签：连同其后内容一起丢弃（直到行尾，避免吞掉正常文本）
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>.*`, "gi"), "");
  }
  return out;
}

/** 行内样式：输入原文（内部自行转义）；支持行内 HTML 直通（白名单） */
function renderInline(raw: string): string {
  const codes: string[] = [];
  const tags: string[] = [];
  let out = raw;
  // 危险元素连同内容先整体移除
  out = stripDangerousContainers(out);
  // 行内代码先抽出保护
  out = out.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(`<code class="md-code">${escapeHtml(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // HTML 标签按白名单净化后保留（不允许的标签直接丢弃）
  out = out.replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*?)?\/?>/g, (m) => {
    const safe = sanitizeTag(m);
    if (!safe) return "";
    tags.push(safe);
    return `\u0001${tags.length - 1}\u0001`;
  });
  out = escapeHtml(out);
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_m, alt, url) => `<img src="${safeUrl(url)}" alt="${escapeAttr(alt)}" class="md-img" />`
  );
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, t, url) => `<a class="md-link" href="${safeUrl(url)}">${t}</a>`
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i) => codes[Number(i)]);
  out = out.replace(/\u0001(\d+)\u0001/g, (_m, i) => tags[Number(i)]);
  return out;
}

/** GFM 表格行拆分 */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const isTableSep = (l: string): boolean =>
  /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");

function alignAttr(align: string | undefined): string {
  return align ? ` style="text-align:${align}"` : "";
}

function renderTable(rows: string[][], aligns: (string | undefined)[]): string {
  const [head, ...body] = rows;
  const th = head
    .map((c, i) => `<th${alignAttr(aligns[i])}>${renderInline(c)}</th>`)
    .join("");
  const tbody = body
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) => `<td${alignAttr(aligns[i])}>${renderInline(c)}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<table class="md-table"><thead><tr>${th}</tr></thead><tbody>${tbody}</tbody></table>`;
}

const HTML_BLOCK_START =
  /^\s*<(p|div|table|thead|tbody|tr|td|th|img|br|hr|details|summary|span|a|center|sub|sup|strong|em|b|i|code|pre|blockquote|h[1-6]|ul|ol|li|figure|figcaption|picture|source|section|article|aside|header|footer|nav|font|u|s|del|ins|abbr|kbd|mark|small|strike|tt|var|wbr)\b/i;

export function renderMarkdown(src: string): string {
  const lines = src.split("\n");
  const html: string[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${renderInline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? "ol" : "ul";
      html.push(
        `<${tag}>${list.items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</${tag}>`
      );
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      html.push(`<blockquote>${renderInline(quote.join(" "))}</blockquote>`);
      quote = [];
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  let idx = 0;
  while (idx < lines.length) {
    const raw = lines[idx];

    // 围栏代码
    if (code) {
      if (/^\s*(```|~~~)/.test(raw)) {
        html.push(`<pre class="md-pre"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null;
      } else {
        code.push(raw);
      }
      idx += 1;
      continue;
    }
    if (/^\s*(```|~~~)/.test(raw)) {
      flushAll();
      code = [];
      idx += 1;
      continue;
    }

    // 空行
    if (/^\s*$/.test(raw)) {
      flushAll();
      idx += 1;
      continue;
    }

    // HTML 块：连续 HTML 行整段净化后输出
    if (HTML_BLOCK_START.test(raw)) {
      flushAll();
      const block: string[] = [];
      while (idx < lines.length && !/^\s*$/.test(lines[idx])) {
        block.push(lines[idx]);
        idx += 1;
      }
      html.push(sanitizeFragment(block.join("\n")));
      continue;
    }

    // GFM 表格：本行含 | 且下一行为分隔行
    if (
      raw.includes("|") &&
      idx + 1 < lines.length &&
      isTableSep(lines[idx + 1])
    ) {
      flushAll();
      const rows: string[][] = [splitRow(raw)];
      const aligns = splitRow(lines[idx + 1]).map((c) =>
        /^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : /^:-+$/.test(c) ? "left" : undefined
      );
      idx += 2;
      while (idx < lines.length && lines[idx].trim() !== "" && lines[idx].includes("|")) {
        rows.push(splitRow(lines[idx]));
        idx += 1;
      }
      html.push(renderTable(rows, aligns));
      continue;
    }

    // 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      flushAll();
      const lv = heading[1].length;
      html.push(`<h${lv}>${renderInline(heading[2])}</h${lv}>`);
      idx += 1;
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
      flushAll();
      html.push("<hr />");
      idx += 1;
      continue;
    }

    // 引用
    const quoteLine = /^\s*>\s?(.*)$/.exec(raw);
    if (quoteLine) {
      flushPara();
      flushList();
      quote.push(quoteLine[1]);
      idx += 1;
      continue;
    }

    // 列表
    const ul = /^\s*[-*+]\s+(.*)$/.exec(raw);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(raw);
    if (ul || ol) {
      flushPara();
      flushQuote();
      const ordered = !!ol;
      const item = (ul ?? ol)![1];
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item);
      idx += 1;
      continue;
    }

    flushList();
    flushQuote();
    para.push(raw.trim());
    idx += 1;
  }
  if (code) html.push(`<pre class="md-pre"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  flushAll();
  return html.join("\n");
}
