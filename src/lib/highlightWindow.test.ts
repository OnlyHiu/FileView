// 窗口化高亮回归测试
//
// 运行：node --experimental-strip-types --test src/lib/highlightWindow.test.ts
//
// 核心不变式：**按窗口分词的结果，必须与整文件分词的结果一致**。
// 否则大文件滚动时会出现高亮跳变。

import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, type Token } from "./highlight.ts";
import { WindowHighlighter, buildLineIndex, visibleLineRange } from "./highlightWindow.ts";

/** 整文件分词后按行拆分 */
function fullLines(src: string, lang: "json" | "markdown" | "xml" | "html" | "javascript" | "python"): Token[][] {
  const tokens = tokenize(src, lang);
  const lines: Token[][] = [];
  let cur: Token[] = [];
  for (const t of tokens) {
    if (!t.text.includes("\n")) {
      cur.push(t);
      continue;
    }
    const parts = t.text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        lines.push(cur);
        cur = [];
      }
      if (parts[i]) cur.push({ cls: t.cls, text: parts[i] });
    }
  }
  lines.push(cur);
  return lines;
}

/** 比较两组的 token 文本与样式 */
function sameTokens(a: Token[], b: Token[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].cls !== b[i].cls || a[i].text !== b[i].text) return false;
  }
  return true;
}

function assertSameAsFull(src: string, lang: "json" | "markdown" | "xml" | "html" | "javascript" | "python", label: string) {
  const expected = fullLines(src, lang);
  const h = new WindowHighlighter(src, lang);
  assert.equal(h.lineCount, expected.length, `${label}: 行数不一致`);
  const actual = h.getLines(0, h.lineCount);
  assert.equal(actual.length, expected.length, `${label}: 窗口返回行数不一致`);
  for (let i = 0; i < expected.length; i++) {
    assert.ok(
      sameTokens(actual[i], expected[i]),
      `${label}: 第 ${i + 1} 行不一致\n  期望 ${JSON.stringify(expected[i])}\n  实际 ${JSON.stringify(actual[i])}`
    );
  }
}

test("行索引：行数与起始偏移正确", () => {
  const idx = buildLineIndex("a\nbb\n\nccc");
  assert.equal(idx.count, 4);
  assert.deepEqual(idx.starts, [0, 2, 5, 6]);
});

test("行索引：结尾换行会产生一个空行", () => {
  const idx = buildLineIndex("a\n");
  assert.equal(idx.count, 2);
});

test("JSON：窗口分词与整文件分词一致", () => {
  const src = `{\n  "a": 1,\n  "b": [true, null],\n  "c": "x"\n}\n`;
  assertSameAsFull(src, "json", "json");
});

test("Markdown：跨块代码围栏保持一致", () => {
  // 围栏跨越第 256 行边界，窗口分词必须延续 inFence 状态
  const head = "# 标题\n\n说明文字\n\n```js\nconst x = 1;\n";
  const filler = Array.from({ length: 300 }, (_, i) => `行 ${i}`).join("\n");
  const src = `${head}${filler}\n\`\`\`\n尾部\n`;
  assertSameAsFull(src, "markdown", "markdown-fence");
});

test("Markdown：围栏在窗口边界处开始也一致", () => {
  const filler = Array.from({ length: 255 }, (_, i) => `行 ${i}`).join("\n");
  const src = `${filler}\n\`\`\`\nconst x = 1;\n\`\`\`\n`;
  assertSameAsFull(src, "markdown", "markdown-fence-boundary");
});

test("XML：跨块标签保持一致", () => {
  const filler = Array.from({ length: 255 }, (_, i) => `<item id="${i}">文本</item>`).join("\n");
  const src = `<?xml version="1.0"?>\n<root>\n${filler}\n</root>\n`;
  assertSameAsFull(src, "xml", "xml");
});

test("HTML：跨块注释保持一致", () => {
  const filler = Array.from({ length: 255 }, (_, i) => `<p>行 ${i}</p>`).join("\n");
  const src = `<html>\n<!-- 注释\n跨行注释\n-->\n${filler}\n</html>\n`;
  assertSameAsFull(src, "html", "html-comment");
});

test("JavaScript：跨块块注释保持一致", () => {
  const filler = Array.from({ length: 255 }, (_, i) => `const v${i} = ${i};`).join("\n");
  const src = `/* 块注释\n跨行\n结束 */\n${filler}\n`;
  assertSameAsFull(src, "javascript", "js-block-comment");
});

test("JavaScript：跨块模板字符串保持一致", () => {
  const filler = Array.from({ length: 255 }, (_, i) => `const v${i} = ${i};`).join("\n");
  const src = `const t = \`模板\n跨行\n字符串\`;\n${filler}\n`;
  assertSameAsFull(src, "javascript", "js-template");
});

test("Python：跨块字符串保持一致", () => {
  const filler = Array.from({ length: 255 }, (_, i) => `v${i} = ${i}`).join("\n");
  const src = `s = "字符串"\n${filler}\n`;
  assertSameAsFull(src, "python", "python");
});

test("只取部分窗口时，内容与整文件一致", () => {
  const src = Array.from({ length: 1000 }, (_, i) => `{"k${i}": ${i}}`).join("\n");
  const h = new WindowHighlighter(src, "json");
  const expected = fullLines(src, "json");
  // 取中间一段
  const part = h.getLines(400, 460);
  assert.equal(part.length, 60);
  for (let i = 0; i < part.length; i++) {
    assert.ok(sameTokens(part[i], expected[400 + i]), `第 ${400 + i + 1} 行不一致`);
  }
});

test("窗口越界被安全裁剪", () => {
  const h = new WindowHighlighter("a\nb\nc", "json");
  assert.equal(h.getLines(-5, 100).length, 3);
  assert.equal(h.getLines(2, 2).length, 0);
  assert.equal(h.getLines(5, 10).length, 0);
});

test("大文件：只分词可见区域，不生成全量 token", () => {
  // 5 万行：整文件分词会产生数十万 token，窗口模式只处理需要的块
  const src = Array.from({ length: 50000 }, (_, i) => `{"key${i}": "value${i}"}`).join("\n");
  const h = new WindowHighlighter(src, "json");
  assert.equal(h.lineCount, 50000);
  const lines = h.getLines(0, 40);
  assert.equal(lines.length, 40);
  // 与整文件分词的对应行一致
  const expected = fullLines(src, "json");
  for (let i = 0; i < lines.length; i++) {
    assert.ok(sameTokens(lines[i], expected[i]), `第 ${i + 1} 行不一致`);
  }
});

test("可见行范围：覆盖视口并留出缓冲", () => {
  const lineH = 20;
  const [first, last] = visibleLineRange(1000, 400, lineH, 1000, 20);
  // 视口覆盖第 50~70 行，缓冲后向前 20 行
  assert.equal(first, 30);
  assert.ok(last >= 90, `结束行应覆盖视口底部，实际 ${last}`);
  assert.ok(last <= 1000);
});

test("可见行范围：滚动到底部不越界", () => {
  const [first, last] = visibleLineRange(100000, 400, 20, 100, 20);
  assert.equal(last, 100);
  // 起点也必须夹在文档范围内（切换文档时旧滚动位置可能超出新文档行数）
  assert.ok(first >= 0 && first < 100, `起点应夹在 [0,100)，实际 ${first}`);
  // 越界时退回到文档末尾，而不是渲染出空白
  assert.ok(last > first, "至少应渲染一行");
});

test("可见行范围：行高为 0 时退化为全文", () => {
  assert.deepEqual(visibleLineRange(0, 400, 0, 50), [0, 50]);
});

test("端到端：滚动到任意位置，渲染内容与源文对应行一致", () => {
  const src = Array.from({ length: 5000 }, (_, i) => `  "key${i}": ${i},`).join("\n") + "\n}";
  const expected = fullLines(src, "json");
  const h = new WindowHighlighter(src, "json");
  const lineH = 20;
  for (const scrollTop of [0, 400, 5000, 40000, 99000]) {
    const [first, last] = visibleLineRange(scrollTop, 400, lineH, h.lineCount, 20);
    const rendered = h.getLines(first, last);
    assert.equal(rendered.length, last - first);
    for (let i = 0; i < rendered.length; i++) {
      assert.ok(
        sameTokens(rendered[i], expected[first + i]),
        `滚动到 ${scrollTop}px 时第 ${first + i + 1} 行不一致`
      );
    }
  }
});

test("端到端：渲染行拼接后等于源文对应行（忽略换行）", () => {
  const src = '{\n  "a": 1,\n  "b": [2, 3]\n}';
  const h = new WindowHighlighter(src, "json");
  const lines = h.getLines(0, h.lineCount);
  const srcLines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const rendered = lines[i].map((t) => t.text).join("");
    assert.equal(rendered, srcLines[i], `第 ${i + 1} 行文本不一致`);
  }
});
