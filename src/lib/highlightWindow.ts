// 窗口化高亮：只对**可见区域**分词，避免大文件一次性生成海量 token。
//
// 原理：
// 1. 行索引：一次扫描记录每行的起始偏移（O(n) 内存极小，只存数字）；
// 2. 分块：把文件按固定行数切成块，每块起点保存一个「跨行状态」（carry）；
// 3. 按需分词：滚动到哪一块才分词那一块，块结果进 LRU 缓存；
// 4. 续接：块内未闭合的块注释 / 模板串 / 标签 / 代码围栏，状态记入 carry
//    传给下一块，保证跨块的高亮与整文件分词一致。

import {
  EMPTY_CARRY,
  mayCarryAcrossLines,
  splitTokensByLine,
  tokenizeWithCarry,
  type Carry,
  type Token,
} from "./highlight.ts";
import type { Lang } from "./types";

/** 每个检查点覆盖的行数 */
const BLOCK_LINES = 256;
/** 缓存的分块数量上限（超出按 LRU 淘汰） */
const MAX_CACHED_BLOCKS = 24;

export interface LineIndex {
  /** 每行起始字符偏移 */
  starts: number[];
  /** 行数 */
  count: number;
}

/** 扫描文本，建立行索引 */
export function buildLineIndex(text: string): LineIndex {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return { starts, count: starts.length };
}

/**
 * 可见行范围（含视口外缓冲）。
 *
 * @returns [起始行, 结束行) —— 均为 0 起的行号
 */
export function visibleLineRange(
  scrollTop: number,
  viewportH: number,
  lineHeightPx: number,
  lineCount: number,
  overscan = 20
): [number, number] {
  if (lineHeightPx <= 0) return [0, lineCount];
  // 起点必须夹在文档范围内：从长文件切到短文件时，
  // 旧的滚动位置可能超出新文档的行数（此时若不夹紧会渲染出空内容）。
  // 越界时退回到文档末尾，而不是什么都不渲染。
  const maxFirst = Math.max(0, lineCount - 1);
  const first = Math.min(
    maxFirst,
    Math.max(0, Math.floor(scrollTop / lineHeightPx) - overscan)
  );
  const last = Math.max(
    first + 1,
    Math.min(lineCount, Math.ceil((scrollTop + viewportH) / lineHeightPx) + overscan)
  );
  return [first, last];
}

export class WindowHighlighter {
  private text: string;
  private readonly lang: Lang;
  private index: LineIndex;
  /**
   * 全文是否可能存在跨行构造。
   * 不存在时，每块的起始状态必然是初始状态 → 可直接跳到任意块，
   * 无需顺序处理途经的块（大文件跳转到远处时省下的正是这部分开销）。
   */
  private readonly needsCarry: boolean;
  /** 每块**结束**时的跨行状态（用于续接下一块） */
  private endCarries = new Map<number, Carry>();
  /** 已分词的块（LRU：Map 保持插入顺序，最早插入的先淘汰） */
  private blocks = new Map<number, Token[][]>();

  constructor(text: string, lang: Lang) {
    this.text = text;
    this.lang = lang;
    this.index = buildLineIndex(text);
    this.needsCarry = mayCarryAcrossLines(text, lang);
  }

  get lineCount(): number {
    return this.index.count;
  }

  /** 字符偏移 → 行号（0 起）；二分查找 */
  lineOf(offset: number): number {
    const starts = this.index.starts;
    let lo = 0;
    let hi = this.index.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * 取 [from, to) 行的 token（每行一个数组）。
   * 行号超出范围会被裁剪。
   */
  getLines(from: number, to: number): Token[][] {
    const lo = Math.max(0, Math.min(from, this.index.count));
    const hi = Math.max(lo, Math.min(to, this.index.count));
    const out: Token[][] = [];
    let line = lo;
    while (line < hi) {
      const blockIndex = Math.floor(line / BLOCK_LINES);
      const block = this.ensureBlock(blockIndex);
      const blockStart = blockIndex * BLOCK_LINES;
      let offset = line - blockStart;
      while (offset < block.length && line < hi) {
        out.push(block[offset]);
        line += 1;
        offset += 1;
      }
    }
    return out;
  }

  /** 确保某块已分词；返回该块的各行 token */
  private ensureBlock(blockIndex: number): Token[][] {
    const cached = this.blocks.get(blockIndex);
    if (cached) {
      // LRU：重新插入到队尾
      this.blocks.delete(blockIndex);
      this.blocks.set(blockIndex, cached);
      return cached;
    }
    const lines = this.tokenizeBlock(blockIndex, this.carryAtBlockStart(blockIndex));
    this.blocks.set(blockIndex, lines);
    while (this.blocks.size > MAX_CACHED_BLOCKS) {
      const oldest = this.blocks.keys().next().value;
      if (oldest === undefined) break;
      this.blocks.delete(oldest);
    }
    return lines;
  }

  /** 某块**起点**处的跨行状态 */
  private carryAtBlockStart(blockIndex: number): Carry {
    // 全文没有跨行构造 → 每块都从初始状态开始，可直接跳到目标块
    if (!this.needsCarry) return EMPTY_CARRY;
    if (blockIndex === 0) return EMPTY_CARRY;
    const prev = blockIndex - 1;
    const known = this.endCarries.get(prev);
    if (known) return known;
    // 上一块尚未分词：先分词它（其结束状态即为当前块起点状态）
    this.ensureBlock(prev);
    return this.endCarries.get(prev) ?? EMPTY_CARRY;
  }

  /** 分词一个块；结果按行拆分，并记录块结束时的跨行状态 */
  private tokenizeBlock(blockIndex: number, carry: Carry): Token[][] {
    const from = blockIndex * BLOCK_LINES;
    const to = Math.min(from + BLOCK_LINES, this.index.count);
    const startOff = this.index.starts[from];
    // 末块取到文本结尾；否则取到下一行起点（含上一行末尾的换行）
    const endOff = to < this.index.count ? this.index.starts[to] : this.text.length;
    const slice = this.text.slice(startOff, endOff);
    const { tokens, carry: next } = tokenizeWithCarry(slice, this.lang, carry);
    // 末块末尾可能多出一个空行（切片以换行结尾），按实际行数裁剪
    const lines = splitTokensByLine(tokens).slice(0, to - from);
    this.endCarries.set(blockIndex, next);
    return lines;
  }
}
