// 高亮器回归测试：token 文本必须与源文逐字符一致
//
// 运行：node --experimental-strip-types --test src/lib/highlight.test.ts
//
// 背景：编辑器用「高亮层 <pre> + 透明 <textarea>」叠加显示。
// 两者若不对齐，光标位置与实际内容就会错位。

import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, detectCsvDelimiter, splitCsvLine } from "./highlight.ts";

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
