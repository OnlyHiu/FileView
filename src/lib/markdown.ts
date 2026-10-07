// Markdown 轻量渲染器：标题/围栏代码/列表/引用/表格(GFM)/链接/粗斜体 + HTML 直通（脱敏）

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML 直通前脱敏：去掉事件属性、危险协议链接 */
function sanitizeHtml(html: string): string {
  return html
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*(["'])(.*?)\2/gi, (m, attr: string, q: string, v: string) =>
      /^\s*(javascript|vbscript|data):/i.test(v) ? ` ${attr}="#"` : m
    );
}

function safeUrl(url: string): string {
  return /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(url) ? url : "#";
}

/** 行内样式：输入原文（内部自行转义）；支持行内 HTML 直通 */
export function renderInline(raw: string): string {
  const codes: string[] = [];
  const tags: string[] = [];
  let out = raw;
  // 行内代码先抽出保护
  out = out.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(`<code class="md-code">${escapeHtml(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // HTML 标签脱敏后原样保留
  out = out.replace(/<\/?[A-Za-z][A-Za-z0-9]*(\s+[^<>]*?)?\/?>/g, (m) => {
    tags.push(sanitizeHtml(m));
    return `\u0001${tags.length - 1}\u0001`;
  });
  out = escapeHtml(out);
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_m, alt, url) => `<img src="${safeUrl(url)}" alt="${alt}" class="md-img" />`
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

    // HTML 块：连续 HTML 行原样输出（脱敏）
    if (HTML_BLOCK_START.test(raw)) {
      flushAll();
      const block: string[] = [];
      while (idx < lines.length && !/^\s*$/.test(lines[idx])) {
        block.push(lines[idx]);
        idx += 1;
      }
      html.push(sanitizeHtml(block.join("\n")));
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
