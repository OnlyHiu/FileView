// 相对链接解析测试（Node 内置 test runner，无额外依赖）
//
// 运行：node --experimental-strip-types --test src/lib/paths.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRelativePath } from "./paths.ts";

test("同目录的相对链接", () => {
  assert.equal(resolveRelativePath("C:\\docs\\note.md", "README.md"), "C:\\docs\\README.md");
});

test("上级目录的相对链接", () => {
  assert.equal(resolveRelativePath("C:\\docs\\sub\\note.md", "..\\README.md"), "C:\\docs\\README.md");
  assert.equal(resolveRelativePath("C:\\docs\\sub\\note.md", "../../README.md"), "C:\\README.md");
});

test("下级目录的相对链接", () => {
  assert.equal(
    resolveRelativePath("C:\\docs\\note.md", "docs/START-HERE.md"),
    "C:\\docs\\docs\\START-HERE.md"
  );
});

test("URL 编码的路径会被解码", () => {
  assert.equal(
    resolveRelativePath("C:\\docs\\note.md", "my%20file.md"),
    "C:\\docs\\my file.md"
  );
});

test("绝对路径原样返回", () => {
  assert.equal(resolveRelativePath("C:\\docs\\note.md", "D:\\other\\x.md"), "D:\\other\\x.md");
});

test("空链接返回 null", () => {
  assert.equal(resolveRelativePath("C:\\docs\\note.md", ""), null);
  assert.equal(resolveRelativePath("C:\\docs\\note.md", "   "), null);
});

test("没有目录的文件名按当前目录解析", () => {
  assert.equal(resolveRelativePath("note.md", "README.md"), "README.md");
});
