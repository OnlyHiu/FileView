// Markdown 轻量渲染器：标题/围栏代码/列表/引用/表格(GFM)/链接/粗斜体 + 受限 HTML 直通
//
// 安全说明：Markdown 预览通过 `dangerouslySetInnerHTML` 注入到 Tauri webview，
// 而 webview 内存在 IPC 桥（可调用 read_file_text / write_file_text 等命令）。
// 因此 HTML 直通必须走**白名单**：只保留明确允许的标签与属性，
// 其余标签一律丢弃，危险元素（script/style/iframe/…）连同内容一起移除。
//
// 结构说明（v0.2.2 起）：
//   · 换行语义完整：硬换行（行尾两空格 / 反斜杠）、引用块内空行分段、
//     引用块内列表、缩进嵌套列表、任务列表、Setext 标题；
//   · 块级解析统一走 renderBlocks()，引用块内容递归解析，行与行不再被并成一行。

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

/** 形如 `scheme:` 的协议前缀（用于识别并拦截 javascript:/data: 等） */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * 校验 URL 是否安全（不做转义）。
 *
 * 放行：http(s)/mailto/tel/ftp、文档内锚点、以及**普通相对路径**
 * （`README.md`、`docs/START-HERE.md` 这类同目录文档链接）。
 * 拦截：javascript:/data:/vbscript:/file: 等协议，以及协议相对地址 `//host`。
 */
function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  // 拒绝控制字符与引号（防止属性逃逸）
  if (/[\s"'<>`\\]/.test(trimmed)) return false;
  // 协议相对地址会继承页面协议 → 拒绝
  if (trimmed.startsWith("//")) return false;
  if (SAFE_PROTOCOL_RE.test(trimmed)) return true;
  // 文档内锚点
  if (trimmed.startsWith("#")) return true;
  // 其它任何协议一律拒绝
  if (SCHEME_RE.test(trimmed)) return false;
  // 普通相对路径
  return true;
}

/**
 * 校验并规范化 URL（输入为**未转义**的原文，输出可直接放进属性值）。
 * 不安全或格式异常的 URL 一律退化为 `#`。
 */
function safeUrl(url: string): string {
  const trimmed = url.trim();
  return isSafeUrl(trimmed) ? escapeAttr(trimmed) : "#";
}

/**
 * 行内链接 / 图片的 URL。
 *
 * 行内文本此前已经过 escapeHtml，这里**不能再次转义**，
 * 否则 `&` 会被转成 `&amp;amp;`（链接地址被破坏）。
 */
function inlineUrl(url: string): string {
  const trimmed = url.trim();
  return isSafeUrl(trimmed) ? trimmed : "#";
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
  // 绝大多数行内文本不含 '<'，跳过这轮正则（性能）
  if (!text.includes("<")) return text;
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

/** 硬换行哨兵（行尾两空格 / 反斜杠） */
const HARD_BREAK = "\u0002";

/** 行内代码占位符前缀 */
const CODE_SLOT = "\u0000";
/** HTML 标签占位符前缀 */
const TAG_SLOT = "\u0001";
/** 反斜杠转义占位符前缀 */
const ESC_SLOT = "\u0003";

/**
 * 行内样式：输入原文（内部自行转义）；支持行内 HTML 直通（白名单）。
 *
 * 换行相关：
 *   · 段落中的硬换行以 HARD_BREAK 哨兵传入，此处转成 `<br />`；
 *   · 行尾的两个空格 / 反斜杠不会泄漏到 HTML 里。
 */
function renderInline(raw: string): string {
  const codes: string[] = [];
  const tags: string[] = [];
  const escaped: string[] = [];
  let out = raw;
  // 危险元素连同内容先整体移除
  out = stripDangerousContainers(out);
  // 反斜杠转义（\* \_ \[ …）：抽出保护，避免被强调/链接规则误伤
  out = out.replace(/\\([\\`*_{}[\]()#+\-.!>~|"'])/g, (_m, c) => {
    escaped.push(escapeHtml(c));
    return `${ESC_SLOT}${escaped.length - 1}${ESC_SLOT}`;
  });
  // 行内代码先抽出保护
  out = out.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(`<code class="md-code">${escapeHtml(c.replace(/\u0002/g, ""))}</code>`);
    return `${CODE_SLOT}${codes.length - 1}${CODE_SLOT}`;
  });
  // HTML 标签按白名单净化后保留（不允许的标签直接丢弃）
  out = out.replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*?)?\/?>/g, (m) => {
    const safe = sanitizeTag(m);
    if (!safe) return "";
    tags.push(safe);
    return `${TAG_SLOT}${tags.length - 1}${TAG_SLOT}`;
  });
  out = escapeHtml(out);
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_m, alt, url) => `<img src="${inlineUrl(url)}" alt="${alt}" class="md-img" />`
  );
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, t, url) => `<a class="md-link" href="${inlineUrl(url)}">${t}</a>`
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(new RegExp(`${CODE_SLOT}(\\d+)${CODE_SLOT}`, "g"), (_m, i) => codes[Number(i)]);
  out = out.replace(new RegExp(`${TAG_SLOT}(\\d+)${TAG_SLOT}`, "g"), (_m, i) => tags[Number(i)]);
  out = out.replace(new RegExp(`${ESC_SLOT}(\\d+)${ESC_SLOT}`, "g"), (_m, i) => escaped[Number(i)]);
  // 硬换行 → <br />
  out = out.split(HARD_BREAK).join("<br />");
  return out;
}

/** GFM 表格行拆分（支持 `\|` 转义竖线） */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      cur += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
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

/** 该行是否为「块起始行」（用于引用块的惰性续行判断） */
function isBlockStart(line: string): boolean {
  return (
    /^\s{0,3}#{1,6}(\s|$)/.test(line) ||
    /^\s{0,3}>/.test(line) ||
    /^\s{0,3}(?:[-*+]|\d+[.)])\s+/.test(line) ||
    /^\s{0,3}(?:```|~~~)/.test(line) ||
    /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    HTML_BLOCK_START.test(line)
  );
}

/** 列表项内容（prefix 为已渲染 HTML，text 为待渲染原文，extra 为嵌套列表 HTML） */
interface ListItem {
  prefix: string;
  text: string;
  extra: string;
}

/** 列表层级 */
interface ListFrame {
  ordered: boolean;
  /** 缩进宽度（Tab 展开为 4） */
  indent: number;
  items: ListItem[];
}

/** 计算缩进宽度：Tab 按 4 空格计 */
function indentWidth(ws: string): number {
  let w = 0;
  for (const ch of ws) {
    if (ch === "\t") w += 4 - (w % 4);
    else w += 1;
  }
  return w;
}

/**
 * 拆出硬换行：行尾两个以上空格（或反斜杠）表示强制换行。
 * 返回去掉行尾空白后的文本与是否硬换行。
 */
function splitHardBreak(line: string): { text: string; hard: boolean } {
  const m = /^(.*?)(?:[ \t]{2,}|\\)\s*$/.exec(line);
  if (!m) return { text: line.trim(), hard: false };
  return { text: m[1].replace(/\s+$/, ""), hard: true };
}

/**
 * 渲染一组行（块级）。
 *
 * 顶层与引用块内容共用本函数——引用块里的列表、段落、空行分段
 * 因此与正文完全一致，不会再被压成一整行。
 *
 * @param lines 行数组
 * @param opts.keepLineBreaks 保留源文件的换行（引用块内使用）：
 *   引用块常被当作「提示框」，一行一条说明；按 CommonMark 的软换行合并
 *   会让这些条目挤成一行，因此引用块内按源文件分行显示。
 */
function renderBlocks(lines: string[], opts?: { keepLineBreaks?: boolean }): string {
  const keepLineBreaks = opts?.keepLineBreaks ?? false;
  const out: string[] = [];
  /** 段落累积（原文） */
  let para: string[] = [];
  /** 每个段落行是否为硬换行 */
  let paraBreak: boolean[] = [];
  /** 列表层级栈 */
  const stack: ListFrame[] = [];
  /** 围栏代码内容 */
  let code: string[] | null = null;

  const flushPara = () => {
    if (!para.length) return;
    let text = "";
    for (let i = 0; i < para.length; i++) {
      if (i > 0) text += paraBreak[i - 1] || keepLineBreaks ? HARD_BREAK : " ";
      text += para[i];
    }
    out.push(`<p>${renderInline(text)}</p>`);
    para = [];
    paraBreak = [];
  };

  /** 弹出一层列表；若存在父级则并入父级最后一个条目 */
  const flushOne = () => {
    const frame = stack.pop();
    if (!frame) return;
    const tag = frame.ordered ? "ol" : "ul";
    const items = frame.items
      .map((it) => `<li>${it.prefix}${renderInline(it.text)}${it.extra}</li>`)
      .join("");
    const html = `<${tag} class="md-list">${items}</${tag}>`;
    const parent = stack[stack.length - 1];
    const last = parent?.items[parent.items.length - 1];
    if (last) last.extra += html;
    else out.push(html);
  };

  const flushLists = () => {
    while (stack.length) flushOne();
  };

  const flushAll = () => {
    flushPara();
    flushLists();
  };

  /** HTML 块：整段净化后输出 */
  const htmlBlockOut = (block: string[]) => {
    const html = sanitizeFragment(block.join("\n"));
    if (html) out.push(html);
  };

  let idx = 0;
  while (idx < lines.length) {
    const raw = lines[idx];

    // 围栏代码
    if (code) {
      if (/^\s{0,3}(```|~~~)/.test(raw)) {
        out.push(`<pre class="md-pre"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null;
      } else {
        code.push(raw);
      }
      idx += 1;
      continue;
    }
    if (/^\s{0,3}(```|~~~)/.test(raw)) {
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
      htmlBlockOut(block);
      continue;
    }

    // GFM 表格：本行含 | 且下一行为分隔行（列数需一致）
    if (
      raw.includes("|") &&
      idx + 1 < lines.length &&
      isTableSep(lines[idx + 1]) &&
      splitRow(raw).length === splitRow(lines[idx + 1]).length
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
      out.push(renderTable(rows, aligns));
      continue;
    }

    // Setext 标题：段落之后紧跟 `===` / `---`
    const setext = /^\s{0,3}(=+|-+)\s*$/.exec(raw);
    if (setext && para.length) {
      const level = setext[1][0] === "=" ? 1 : 2;
      const text = para[para.length - 1];
      para.pop();
      paraBreak.pop();
      flushPara();
      out.push(`<h${level}>${renderInline(text)}</h${level}>`);
      idx += 1;
      continue;
    }

    // ATX 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      flushAll();
      const lv = heading[1].length;
      out.push(`<h${lv}>${renderInline(heading[2].replace(/\s+#+\s*$/, ""))}</h${lv}>`);
      idx += 1;
      continue;
    }

    // 分隔线
    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
      flushAll();
      out.push("<hr />");
      idx += 1;
      continue;
    }

    // 引用块：整段递归解析（列表 / 段落 / 空行分段都保留）
    const quoteMatch = /^\s{0,3}>\s?(.*)$/.exec(raw);
    if (quoteMatch) {
      flushAll();
      const inner: string[] = [];
      let lastWasParagraph = quoteMatch[1].trim() !== "";
      while (idx < lines.length) {
        const m = /^\s{0,3}>\s?(.*)$/.exec(lines[idx]);
        if (!m) break;
        inner.push(m[1]);
        lastWasParagraph = m[1].trim() !== "";
        idx += 1;
      }
      // 惰性续行：紧跟引用块、没有 '>' 前缀的普通文本行仍属于引用块
      if (lastWasParagraph) {
        while (idx < lines.length) {
          const l = lines[idx];
          if (/^\s*$/.test(l) || isBlockStart(l)) break;
          inner.push(l);
          idx += 1;
        }
      }
      out.push(`<blockquote>${renderBlocks(inner, { keepLineBreaks: true })}</blockquote>`);
      continue;
    }

    // 列表（支持缩进嵌套）
    const listMatch = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (listMatch) {
      flushPara();
      const indent = indentWidth(listMatch[1]);
      const ordered = /\d/.test(listMatch[2]);
      let itemText = listMatch[3];
      // 缩进变浅：先收拢更深层级
      while (stack.length && stack[stack.length - 1].indent > indent) flushOne();
      // 同层但列表类型不同（ul ↔ ol）：另起一个列表
      if (
        stack.length &&
        stack[stack.length - 1].indent === indent &&
        stack[stack.length - 1].ordered !== ordered
      ) {
        flushOne();
      }
      // 缩进变深：新建子列表
      if (!stack.length || stack[stack.length - 1].indent < indent) {
        stack.push({ ordered, indent, items: [] });
      }
      // 任务列表
      let prefix = "";
      const task = /^\[([ xX])\]\s+(.*)$/.exec(itemText);
      if (task) {
        const checked = task[1] !== " ";
        prefix = `<span class="md-check${checked ? " md-check-on" : ""}" aria-hidden="true">${
          checked ? "☑" : "☐"
        }</span> `;
        itemText = task[2];
      }
      stack[stack.length - 1].items.push({ prefix, text: itemText, extra: "" });
      idx += 1;
      continue;
    }

    // 段落
    flushLists();
    const piece = splitHardBreak(raw);
    para.push(piece.text);
    paraBreak.push(piece.hard);
    idx += 1;
  }

  if (code) out.push(`<pre class="md-pre"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  flushAll();
  return out.join("\n");
}

/** 规范化源码：去掉 BOM，统一 CRLF / CR 为 LF */
function normalizeSource(src: string): string {
  return src.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

/**
 * 渲染 Markdown 为 HTML。
 *
 * @param src Markdown 原文
 * @returns 可直接注入 DOM 的 HTML（已做白名单净化）
 */
export function renderMarkdown(src: string): string {
  return renderBlocks(normalizeSource(src).split("\n"));
}
