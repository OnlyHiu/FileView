// 扩展名清单一致性检查：Rust SUPPORTED_EXTS ↔ 前端 EXT_KIND / EXT_GROUPS
import { readFileSync } from "node:fs";
import { SUPPORTED_EXTS, EXT_GROUPS, kindFromPath, langFromPath } from "../src/lib/types.ts";

const rust = readFileSync(new URL("../src-tauri/src/sys/file_assoc.rs", import.meta.url), "utf8");
const block = /SUPPORTED_EXTS[^=]*=\s*&\[([\s\S]*?)\];/.exec(rust);
const rustExts = [...block[1].matchAll(/"([a-z0-9]+)"/g)].map((x) => x[1]);

const diff = (a, b) => a.filter((x) => !b.includes(x));

console.log("rust:", rustExts.length, "ts:", SUPPORTED_EXTS.length);
console.log("in rust not ts:", diff(rustExts, SUPPORTED_EXTS));
console.log("in ts not rust:", diff(SUPPORTED_EXTS, rustExts));

const grouped = EXT_GROUPS.flatMap((g) => g.exts);
console.log("ts exts missing from EXT_GROUPS:", diff(SUPPORTED_EXTS, grouped));
console.log("group exts missing from SUPPORTED_EXTS:", diff(grouped, SUPPORTED_EXTS));
console.log("duplicates in EXT_GROUPS:", grouped.filter((e, i) => grouped.indexOf(e) !== i));

// 高亮语言映射缺口：每个扩展名都应能解析出语言
const noLang = SUPPORTED_EXTS.filter((e) => langFromPath("x." + e) === "text" && e !== "txt" && e !== "text");
console.log("exts falling back to plain text highlight:", noLang);
