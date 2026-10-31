// 高亮器回归测试：token 文本必须与源文逐字符一致
//
// 运行：node --experimental-strip-types --test src/lib/highlight.test.ts
//
// 背景：编辑器用「高亮层 <pre> + 透明 <textarea>」叠加显示。
// 两者若不对齐，光标位置与实际内容就会错位。

import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, detectCsvDelimiter, splitCsvLine, mayCarryAcrossLines } from "./highlight.ts";

/** 把 token 拼回原文 */
function concat(tokens: { text: string }[]): string {
  return tokens.map((t) => t.text).join("");
}

test("所有语言的 token 拼接后与源文本完全一致", () => {
  const samples: Record<string, string> = {
    json: '{\n  "a": [1, 2, {"b": null}],\n  "c": "x\\"y"\n}',
    markdown: "# 标题\n\n- 列表 `code`\n- **粗体**\n\n> 引用\n\n```js\nlet x = 1;\n```",
    ini: "[section]\nkey = value ; comment\n; full comment",
    yaml: "key: value\nlist:\n  - a\n  - b\n# comment",
    toml: "[table]\nkey = \"value\"\nnum = 42",
    csv: 'a,b,c\n1,"x,y",true\n2,"he said ""hi""",3.5',
    xml: '<?xml version="1.0"?>\n<root attr="v"><child/></root>',
    html: '<!DOCTYPE html>\n<html><body class="x">text</body></html>',
    log: "2024-01-01 12:00:00 INFO [main] started\nERROR boom",
    javascript: "const x = `tpl ${y}`; // comment\nfunction f(a) { return a; }",
    python: "def f(x: int) -> str:\n    return f'{x}'  # comment",
    rust: "fn main() { let v: Vec<u8> = vec![]; }",
    text: "plain text\nsecond line",
  };
  for (const [lang, src] of Object.entries(samples)) {
    const out = concat(tokenize(src, lang as never));
    assert.equal(out, src, `语言 ${lang} 的 token 拼接后与源文本不一致`);
  }
});

test("CSV 高亮保留引号与分隔符（不破坏列对齐）", () => {
  const src = 'a,b\n1,"x,y"\n';
  const tokens = tokenize(src, "csv");
  assert.equal(concat(tokens), src);
});

test("CSV 分隔符自动识别：逗号", () => {
  assert.equal(detectCsvDelimiter("a,b,c\n1,2,3\n"), ",");
});

test("CSV 分隔符自动识别：分号（欧洲风格）", () => {
  assert.equal(detectCsvDelimiter("a;b;c\n1;2;3\n4;5;6\n"), ";");
});

test("CSV 分隔符自动识别：制表符", () => {
  assert.equal(detectCsvDelimiter("a\tb\tc\n1\t2\t3\n"), "\t");
});

test("CSV 分隔符自动识别：值内含逗号但用分号分隔", () => {
  assert.equal(detectCsvDelimiter('a;b\n"x,y";2\n"z,w";3\n'), ";");
});

test("CSV 分隔符自动识别：单列回退为逗号", () => {
  assert.equal(detectCsvDelimiter("only\none\ncolumn\n"), ",");
});

test("CSV 拆分保留引号内转义", () => {
  assert.deepEqual(splitCsvLine('"a""b",c'), ['a"b', "c"]);
});

test("跨行构造检测：不会跨行的语言恒为 false", () => {
  for (const lang of ["json", "ini", "yaml", "toml", "csv", "log", "text"] as const) {
    assert.equal(mayCarryAcrossLines("任意内容\n更多内容", lang), false, `${lang} 不应跨行`);
  }
});

test("跨行构造检测：Markdown 围栏", () => {
  assert.equal(mayCarryAcrossLines("普通文本\n没有围栏", "markdown"), false);
  assert.equal(mayCarryAcrossLines("```js\ncode\n```", "markdown"), true);
  assert.equal(mayCarryAcrossLines("~~~\ncode\n~~~", "markdown"), true);
});

test("跨行构造检测：XML / HTML 标签与注释", () => {
  assert.equal(mayCarryAcrossLines("<div>文本</div>", "xml"), false);
  // 标签跨行
  assert.equal(mayCarryAcrossLines("<div\n  class=\"x\">", "xml"), true);
  // 注释跨行
  assert.equal(mayCarryAcrossLines("<!-- 注释\n更多 -->", "html"), true);
});

test("跨行构造检测：代码的块注释与模板串", () => {
  assert.equal(mayCarryAcrossLines("const a = 1;", "javascript"), false);
  assert.equal(mayCarryAcrossLines("/* 注释 */", "javascript"), true);
  assert.equal(mayCarryAcrossLines("const t = `x`;", "javascript"), true);
  // Python 没有块注释，双引号串不跨行
  assert.equal(mayCarryAcrossLines("s = \"text\"", "python"), false);
});

test("跨行构造检测必须保守：宁可误判为可能跨行", () => {
  // 注释里出现 "<" 与换行：实际不会跨行，但检测结果允许为 true（保守）
  const src = "<!-- <\n -->";
  assert.equal(mayCarryAcrossLines(src, "html"), true);
});
