// 大文件分词性能对比：整文件分词 vs 窗口化分词
//
// 运行：node --experimental-strip-types scripts/bench-highlight.mjs
import { tokenize } from "../src/lib/highlight.ts";
import { WindowHighlighter } from "../src/lib/highlightWindow.ts";

const LINES = Number(process.argv[2] ?? 200000);
const src = Array.from({ length: LINES }, (_, i) => `{"key${i}": "value${i}", "n": ${i}}`).join("\n");
console.log(`文本规模：${(src.length / 1024 / 1024).toFixed(1)} MB / ${LINES} 行`);

// 旧实现：整文件分词
let t = performance.now();
const all = tokenize(src, "json");
const fullMs = performance.now() - t;
console.log(`整文件分词：${fullMs.toFixed(0)} ms，生成 ${all.length.toLocaleString()} 个 token`);

// 新实现：窗口化分词（只处理可见区域）
t = performance.now();
const h = new WindowHighlighter(src, "json");
const buildMs = performance.now() - t;
console.log(`行索引构建：${buildMs.toFixed(0)} ms（${h.lineCount.toLocaleString()} 行）`);

t = performance.now();
const visible = h.getLines(0, 60);
const firstMs = performance.now() - t;
console.log(`首屏 60 行分词：${firstMs.toFixed(1)} ms`);

// 滚动到中部
t = performance.now();
h.getLines(Math.floor(LINES / 2), Math.floor(LINES / 2) + 60);
const midMs = performance.now() - t;
console.log(`滚动到中部 60 行分词：${midMs.toFixed(1)} ms`);

console.log(
  `\n结论：整文件分词 ${fullMs.toFixed(0)} ms + ${all.length.toLocaleString()} 个 token；` +
    `窗口化首屏 ${(buildMs + firstMs).toFixed(0)} ms。`
);
