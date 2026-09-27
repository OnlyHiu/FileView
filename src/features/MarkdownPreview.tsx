// Markdown 预览：轻量本地渲染（标题/围栏代码/列表/引用/链接/粗斜体），不引第三方依赖

import React, { useMemo } from "react";
import { useJsonStore } from "../stores/jsonStore";
import { isTauri } from "../lib/api";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeUrl(url: string): string {
  return /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(url) ? url : "#";
}

/** 行内样式：输入需已 HTML 转义 */
function renderInline(escaped: string): string {
  let out = escaped;
  const codes: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(`<code class="md-code">${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
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
  return out;
}

function renderMarkdown(src: string): string {
  const lines = src.split("\n");
  const html: string[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${renderInline(escapeHtml(para.join(" ")))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? "ol" : "ul";
      html.push(
        `<${tag}>${list.items.map((it) => `<li>${renderInline(escapeHtml(it))}</li>`).join("")}</${tag}>`
      );
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      html.push(`<blockquote>${renderInline(escapeHtml(quote.join(" ")))}</blockquote>`);
      quote = [];
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    if (code) {
      if (/^\s*(```|~~~)/.test(raw)) {
        html.push(`<pre class="md-pre"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null;
      } else {
        code.push(raw);
      }
      continue;
    }
    if (/^\s*(```|~~~)/.test(raw)) {
      flushAll();
      code = [];
      continue;
    }
    if (/^\s*$/.test(raw)) {
      flushAll();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      flushAll();
      const lv = heading[1].length;
      html.push(`<h${lv}>${renderInline(escapeHtml(heading[2]))}</h${lv}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
      flushAll();
      html.push("<hr />");
      continue;
    }
    const quoteLine = /^\s*>\s?(.*)$/.exec(raw);
    if (quoteLine) {
      flushPara();
      flushList();
      quote.push(quoteLine[1]);
      continue;
    }
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
      continue;
    }
    flushList();
    flushQuote();
    para.push(raw.trim());
  }
  if (code) html.push(`<pre class="md-pre"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  flushAll();
  return html.join("\n");
}

export const MarkdownPreview: React.FC = () => {
  const tabs = useJsonStore((s) => s.tabs);
  const activeTabId = useJsonStore((s) => s.activeTabId);
  const text = tabs.find((t) => t.id === activeTabId)?.text ?? "";
  const html = useMemo(() => renderMarkdown(text), [text]);

  // 链接用系统浏览器打开，避免 webview 被导航走
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const url = a.getAttribute("href") ?? "";
    if (!url || url === "#") return;
    if (isTauri()) {
      void import("@tauri-apps/plugin-opener")
        .then((m) => m.openUrl(url))
        .catch(() => {});
    } else {
      window.open(url, "_blank", "noopener");
    }
  };

  return (
    <div
      className="h-full overflow-auto selectable"
      style={{ fontSize: "var(--json-font-size)" }}
      onClick={onClick}
    >
      <div className="markdown-body px-6 py-4" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
};
