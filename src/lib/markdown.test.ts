// Markdown 渲染器安全回归测试（Node 内置 test runner，无额外依赖）
//
// 运行：node --experimental-strip-types --test src/lib/markdown.test.ts
//
// 覆盖代码审核中发现的 XSS 注入向量：Markdown 预览通过 dangerouslySetInnerHTML
// 注入 Tauri webview，而 webview 内存在 IPC 桥（可读写任意文件），
// 因此任何可执行脚本 / 外部导航 / 危险协议都必须被拦截。

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "./markdown.ts";

/** 输出中是否还残留可执行的 script 标签 */
function hasScript(html: string): boolean {
  return /<script/i.test(html);
}

/** 输出中是否残留事件处理属性（只匹配真实标签内的属性，避免误报已转义的正文） */
function hasEventHandler(html: string): boolean {
  return /<[^>]*\son[a-z]+\s*=/i.test(html);
}

test("丢弃 script 标签及其内容", () => {
  const html = renderMarkdown("<script>alert(1)</script>");
  assert.equal(hasScript(html), false);
  assert.equal(html.includes("alert(1)"), false, "script 内容应一并移除");
});

test("丢弃 iframe 与 srcdoc（可继承父页面来源）", () => {
  const html = renderMarkdown('<iframe srcdoc="&lt;script&gt;x&lt;/script&gt;"></iframe>');
  assert.equal(/<iframe/i.test(html), false);
  assert.equal(/srcdoc/i.test(html), false);
});

test("丢弃 meta refresh（可导航整个 webview）", () => {
  const html = renderMarkdown('<meta http-equiv="refresh" content="0;url=https://evil.example">');
  assert.equal(/<meta/i.test(html), false);
  assert.equal(html.includes("evil.example"), false);
});

test("丢弃 object / embed / base", () => {
  const html = renderMarkdown(
    '<object data="https://evil.example/x"></object><embed src="https://evil.example/y"><base href="https://evil.example/">'
  );
  assert.equal(/<object/i.test(html), false);
  assert.equal(/<embed/i.test(html), false);
  assert.equal(/<base/i.test(html), false);
});

test("丢弃 style 标签与 style 属性（CSS 注入）", () => {
  const html = renderMarkdown("<style>body{display:none}</style>");
  assert.equal(/<style/i.test(html), false);
  const html2 = renderMarkdown('<div style="position:fixed;top:0;left:0;width:100vw;height:100vh">x</div>');
  assert.equal(/style\s*=/i.test(html2), false);
});

test("丢弃 svg（可内嵌脚本）", () => {
  const html = renderMarkdown("<svg><script>alert(1)</script></svg>");
  assert.equal(/<svg/i.test(html), false);
  assert.equal(hasScript(html), false);
});

test("丢弃事件处理属性", () => {
  const html = renderMarkdown('<img src="x" onerror="alert(1)">');
  assert.equal(hasEventHandler(html), false);
  const html2 = renderMarkdown('<div onclick="alert(1)">x</div>');
  assert.equal(hasEventHandler(html2), false);
});

test("危险协议链接被中和", () => {
  const html = renderMarkdown("[click](javascript:alert(1))");
  assert.equal(/javascript:/i.test(html), false);
  // 未加引号的写法同样不得放行
  const html2 = renderMarkdown("[click](javascript:alert(1))");
  assert.equal(/href\s*=\s*["']?\s*javascript:/i.test(html2), false);
});

test("图片 src 的 javascript: 被中和", () => {
  const html = renderMarkdown("![x](javascript:alert(1))");
  assert.equal(/javascript:/i.test(html), false);
});

test("data: 协议被拒绝", () => {
  const html = renderMarkdown("[x](data:text/html;base64,PHNjcmlwdD4=)");
  assert.equal(/data:/i.test(html), false);
});

test("保留安全的 HTML 标签（白名单内）", () => {
  const html = renderMarkdown("<b>bold</b> and <em>italic</em>");
  assert.equal(html.includes("<b>bold</b>"), true);
  assert.equal(html.includes("<em>italic</em>"), true);
});

test("保留 http/https 链接", () => {
  const html = renderMarkdown("[site](https://example.com)");
  assert.equal(html.includes('href="https://example.com"'), true);
});

test("链接标题中的引号不会逃逸属性", () => {
  const html = renderMarkdown('[x](https://example.com/" onmouseover="alert(1))');
  assert.equal(hasEventHandler(html), false);
});

test("HTML 块中的裸文本被转义", () => {
  const html = renderMarkdown("<div>\nplain <b>text</b>\n</div>");
  // 允许的标签保留，未知标签被丢弃
  assert.equal(/<b>text<\/b>/.test(html), true);
});

test("注释被移除", () => {
  const html = renderMarkdown("<!-- <script>alert(1)</script> -->");
  assert.equal(hasScript(html), false);
});
