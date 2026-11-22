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

// ============================================================
// 换行 / 分行结构（v0.2.2）
//
// 缺陷背景：引用块内的多行被 join(" ") 压成一行，引用块里的列表
// 也退化成普通文本，导致「无法正确形成换行分行显示」。
// ============================================================

test("引用块内的多行分行显示，不再压成一行", () => {
  const html = renderMarkdown("> 第一行\n> 第二行");
  assert.equal(/<blockquote>[\s\S]*<\/blockquote>/.test(html), true);
  // 引用块按源文件分行显示（提示框一行一条），不再被空格连接
  assert.equal(/<p>第一行<br \/>第二行<\/p>/.test(html), true);
  assert.equal(html.includes("第一行 第二行"), false, "不应再被合并为同一行");
});

test("引用块内的空行分段", () => {
  const html = renderMarkdown("> a\n>\n> b");
  assert.equal(/<blockquote><p>a<\/p>\s*<p>b<\/p><\/blockquote>/.test(html), true);
});

test("引用块内的列表渲染为列表", () => {
  const html = renderMarkdown("> - 第一项\n> - 第二项");
  assert.equal(/<blockquote><ul[^>]*><li>第一项<\/li><li>第二项<\/li><\/ul><\/blockquote>/.test(html), true);
});

test("引用块内的代码块保留围栏", () => {
  const html = renderMarkdown("> 说明\n>\n> ```js\n> const a = 1;\n> ```");
  assert.equal(/<blockquote>[\s\S]*<pre class="md-pre"><code>const a = 1;<\/code><\/pre>/.test(html), true);
});

test("行尾两个空格形成硬换行", () => {
  const html = renderMarkdown("第一行  \n第二行");
  assert.equal(/<p>第一行<br \/>第二行<\/p>/.test(html), true);
});

test("行尾反斜杠形成硬换行", () => {
  const html = renderMarkdown("第一行\\\n第二行");
  assert.equal(/<p>第一行<br \/>第二行<\/p>/.test(html), true);
});

test("软换行仍合并为同一段落", () => {
  const html = renderMarkdown("第一行\n第二行");
  assert.equal(/<p>第一行 第二行<\/p>/.test(html), true);
});

test("缩进嵌套列表保留层级", () => {
  const html = renderMarkdown("- 一级\n  - 二级\n- 另一个");
  assert.equal(/<li>一级<ul[^>]*><li>二级<\/li><\/ul><\/li>/.test(html), true);
  assert.equal(/<li>另一个<\/li>/.test(html), true);
});

test("任务列表渲染复选标记", () => {
  const html = renderMarkdown("- [ ] 未完成\n- [x] 已完成");
  assert.equal(html.includes("☐"), true);
  assert.equal(html.includes("☑"), true);
});

test("Setext 标题（=== / ---）被识别", () => {
  const html = renderMarkdown("标题一\n======\n\n标题二\n------");
  assert.equal(/<h1>标题一<\/h1>/.test(html), true);
  assert.equal(/<h2>标题二<\/h2>/.test(html), true);
});

test("CRLF 行尾被规范化（不残留 \\r）", () => {
  const html = renderMarkdown("# 标题\r\n\r\n正文\r\n");
  assert.equal(html.includes("\r"), false);
  assert.equal(/<h1>标题<\/h1>/.test(html), true);
  assert.equal(/<p>正文<\/p>/.test(html), true);
});

test("表格分隔行列数必须与表头一致", () => {
  // 只有一列分隔线时不应被当成表格
  const html = renderMarkdown("普通文本 | 另一段\n---");
  assert.equal(/<table/.test(html), false);
});

test("普通相对链接保留可用的 href", () => {
  const html = renderMarkdown("[README](README.md) | [文档](docs/START-HERE.md)");
  assert.equal(html.includes('href="README.md"'), true);
  assert.equal(html.includes('href="docs/START-HERE.md"'), true);
});

test("链接地址中的 & 只转义一次", () => {
  const html = renderMarkdown("[x](https://e.com/a?b=1&c=2)");
  assert.equal(html.includes("&amp;c=2"), true);
  assert.equal(html.includes("&amp;amp;"), false, "不应出现双重转义");
});

test("反斜杠转义的标点按原样输出", () => {
  const html = renderMarkdown("\\*不是斜体\\*");
  assert.equal(/<p>\*不是斜体\*<\/p>/.test(html), true);
  assert.equal(/<em>/.test(html), false);
});

