// 确认 CSP 已嵌入编译产物（默认检查 release 二进制）
import { readFileSync } from "node:fs";

const target =
  process.argv[2] ??
  "src-tauri/target/release/fileview.exe";
const buf = readFileSync(target);
const text = buf.toString("latin1");
const i = text.indexOf("default-src 'self'");
if (i === -1) {
  console.log(`NOT FOUND in ${target}`);
  process.exit(1);
}
console.log(`CSP FOUND in ${target}:\n` + text.slice(i, i + 340).split("\0")[0]);
