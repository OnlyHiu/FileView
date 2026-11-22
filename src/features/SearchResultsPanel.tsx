// 底部搜索结果面板（Notepad++ 式「搜索结果」窗口）
//   · 列出当前文档的全部命中，以及「在文件夹中搜索」的跨文件命中
//   · 点击命中即可跳转定位；面板高度可拖拽调整

import React, { useCallback, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useJsonStore } from "../stores/jsonStore";
import { useSearchStore } from "../stores/searchStore";
import { readFileText } from "../lib/api";
import { Icon } from "../components/ui";
import type { SearchHit } from "../lib/types";

const ROW_HEIGHT = 22;

/** 结果条目：当前文档命中与跨文件命中统一成同一种结构 */
interface ResultEntry {
  path: string;
  /** 是否来自当前文档（未保存文档的 path 为 null，用标签名做标识） */
  current: boolean;
  line: number;
  column: number;
  offset: number;
  length: number;
  text: string;
}

/** 二分查找：偏移所在的行号（行号从 1 起） */
function lineOfOffset(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

export const SearchResultsPanel: React.FC = () => {
  const tabs = useJsonStore((s) => s.tabs);
  const activeTabId = useJsonStore((s) => s.activeTabId);
  const findQuery = useJsonStore((s) => s.findQuery);
  const findMatches = useJsonStore((s) => s.findMatches);
  const findIndex = useJsonStore((s) => s.findIndex);
  const setFindQuery = useJsonStore((s) => s.setFindQuery);
  const revealAt = useJsonStore((s) => s.revealAt);
  const setStatus = useJsonStore((s) => s.setStatus);

  const folderRoot = useSearchStore((s) => s.folderRoot);
  const folderQuery = useSearchStore((s) => s.folderQuery);
  const folderHits = useSearchStore((s) => s.folderHits);
  const folderScanned = useSearchStore((s) => s.folderScanned);
  const folderSearching = useSearchStore((s) => s.folderSearching);
  const folderTruncated = useSearchStore((s) => s.folderTruncated);
  const folderError = useSearchStore((s) => s.folderError);
  const searchFolder = useSearchStore((s) => s.searchFolder);
  const replaceInSearchedFiles = useSearchStore((s) => s.replaceInSearchedFiles);
  const resultsOpen = useSearchStore((s) => s.resultsOpen);
  const resultsHeight = useSearchStore((s) => s.resultsHeight);
  const setResultsOpen = useSearchStore((s) => s.setResultsOpen);
  const setResultsHeight = useSearchStore((s) => s.setResultsHeight);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  /** 当前文档标识：有磁盘路径用路径，未保存文档用标签名（两者都不能为空） */
  const activePath = activeTab ? (activeTab.path ?? activeTab.name) : null;

  /** 行首偏移表：命中数多时避免逐个匹配做 O(n) 切片（会卡住界面） */
  const lineStarts = useMemo(() => {
    const text = activeTab?.text ?? "";
    const arr = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) arr.push(i + 1);
    }
    return arr;
  }, [activeTab?.text]);

  // 当前文档的命中
  const docEntries = useMemo<ResultEntry[]>(() => {
    if (!activeTab || !findQuery || findMatches.length === 0) return [];
    const text = activeTab.text;
    return findMatches.map((offset) => {
      const lineNo = lineOfOffset(lineStarts, offset);
      const lineStart = lineStarts[lineNo - 1];
      const lineEnd = lineNo < lineStarts.length ? lineStarts[lineNo] : text.length;
      return {
        path: activeTab.path ?? activeTab.name,
        current: true,
        line: lineNo,
        column: offset - lineStart + 1,
        offset,
        length: findQuery.length,
        text: text.slice(lineStart, lineEnd).trimEnd(),
      };
    });
  }, [activeTab, findQuery, findMatches, lineStarts]);

  // 文件夹搜索的命中
  const folderEntries = useMemo<ResultEntry[]>(
    () =>
      folderHits.map((h: SearchHit) => ({
        path: h.path,
        current: false,
        line: h.line,
        column: h.column,
        offset: h.offset,
        length: h.length,
        text: h.text,
      })),
    [folderHits]
  );

  const entries = useMemo(() => {
    const seen = new Set<string>();
    const out: ResultEntry[] = [];
    for (const e of [...docEntries, ...folderEntries]) {
      const key = `${e.path}:${e.offset}:${e.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    return out;
  }, [docEntries, folderEntries]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  /** 跳转到命中位置：跨文件时先打开文件 */
  const goto = useCallback(
    async (e: ResultEntry) => {
      // 跨文件：打开文件后再定位（当前文档的命中直接定位，不做任何 IO）
      if (!e.current) {
        try {
          const payload = await readFileText(e.path);
          useJsonStore.getState().loadFile(payload.path, payload.text);
        } catch (err) {
          setStatus(`打开文件失败：${err}`);
          return;
        }
      }
      // 用对应的搜索词在新文档里继续高亮（跨文件命中用文件夹搜索的词）
      const query = e.current ? findQuery : folderQuery || findQuery;
      if (query) setFindQuery(query);
      revealAt(e.path, e.offset, e.length);
    },
    [findQuery, folderQuery, revealAt, setFindQuery, setStatus]
  );

  // 面板高度拖拽
  const draggingRef = useRef(false);
  const onPointerDown = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      ev.preventDefault();
      draggingRef.current = true;
      const move = (e: PointerEvent) => {
        if (!draggingRef.current) return;
        setResultsHeight(window.innerHeight - e.clientY - 26);
      };
      const up = () => {
        draggingRef.current = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        // 指针在窗口外松开 / 触摸被取消时同样要清理，否则监听器会一直留着
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [setResultsHeight]
  );

  if (!resultsOpen) return null;

  const statusText = folderSearching
    ? "正在扫描…"
    : folderError
      ? folderError
      : folderRoot
        ? `${folderRoot} · 找到 ${folderHits.length} 处 · 扫描 ${folderScanned} 个文件${
            folderTruncated ? " · 已达上限" : ""
          }`
        : `当前文档 ${docEntries.length} 处`;

  return (
    <div
      className="shrink-0 flex flex-col border-t border-stroke bg-smoke-bg-layer"
      style={{ height: resultsHeight }}
    >
      {/* 拖拽把手 */}
      <div
        onPointerDown={onPointerDown}
        title="拖动调整面板高度"
        className="h-1 shrink-0 cursor-row-resize hover:bg-accent/40 transition-colors duration-150"
      />

      {/* 标题栏 */}
      <div className="flex items-center gap-2 h-8 px-3 shrink-0 border-b border-stroke/60">
        <Icon name="search" size={13} className="text-accent-text shrink-0" />
        <span className="text-[12px] font-semibold text-ink shrink-0">搜索结果</span>
        <span className="text-[11px] text-ink-tertiary truncate">{statusText}</span>
        <div className="flex-1" />
        <button
          onClick={() => void searchFolder()}
          title="在文件夹中搜索 (Ctrl+Alt+F)"
          className="h-6 px-2 rounded-sm text-[11px] text-ink-secondary hover:bg-smoke-bg-card-hover shrink-0"
        >
          在文件夹中搜索
        </button>
        <button
          onClick={() => {
            const replacement = window.prompt("替换为：", "");
            if (replacement === null) return;
            void replaceInSearchedFiles(replacement);
          }}
          title="替换搜索到的全部命中"
          disabled={!folderHits.length}
          className="h-6 px-2 rounded-sm text-[11px] text-ink-secondary hover:bg-smoke-bg-card-hover disabled:opacity-40 disabled:pointer-events-none shrink-0"
        >
          全部替换
        </button>
        <button
          onClick={() => setResultsOpen(false)}
          title="关闭面板"
          className="w-6 h-6 rounded-sm flex items-center justify-center text-ink-tertiary hover:bg-smoke-bg-card-hover hover:text-ink shrink-0"
        >
          <Icon name="close" size={12} />
        </button>
      </div>

      {/* 命中列表 */}
      <div ref={parentRef} className="flex-1 min-h-0 overflow-auto">
        {entries.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[12px] text-ink-tertiary">
            {findQuery ? "没有找到匹配项" : "输入查找内容后在此列出全部命中"}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const e = entries[vi.index];
              const isCurrent = e.current;
              const isActive =
                isCurrent && findMatches[findIndex] === e.offset;
              return (
                <div
                  key={`${e.path}:${e.offset}:${vi.index}`}
                  onClick={() => void goto(e)}
                  className={`absolute left-0 top-0 flex items-center gap-2 px-3 cursor-default fluent-item ${
                    isActive ? "bg-accent-subtle" : ""
                  }`}
                  style={{
                    height: ROW_HEIGHT,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                  title={`${e.path}:${e.line}:${e.column}`}
                >
                  <span className="text-[11px] text-ink-tertiary tabular-nums shrink-0 w-16 text-right">
                    {e.line}:{e.column}
                  </span>
                  <span className="text-[11px] text-accent-text truncate shrink-0 max-w-[280px]">
                    {e.path}
                  </span>
                  <span className="text-[12px] text-ink-secondary truncate">{e.text.trim()}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
