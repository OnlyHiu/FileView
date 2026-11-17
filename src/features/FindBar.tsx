// 文档内查找栏：Notepad++ 式逻辑
//   · 查找 / 替换两行（Ctrl+H 展开替换行）
//   · 查找词与替换词各自保留历史（localStorage），可下拉回选
//   · 命中在文档中高亮，Enter / F3 逐处跳转

import React, { useEffect, useRef, useState } from "react";
import { useJsonStore } from "../stores/jsonStore";
import { useSearchStore } from "../stores/searchStore";
import { Icon } from "../components/ui";

export const FindBar: React.FC = () => {
  const findQuery = useJsonStore((s) => s.findQuery);
  const setFindQuery = useJsonStore((s) => s.setFindQuery);
  const caseSensitive = useJsonStore((s) => s.findCaseSensitive);
  const toggleCase = useJsonStore((s) => s.toggleFindCase);
  const findNext = useJsonStore((s) => s.findNext);
  const findPrev = useJsonStore((s) => s.findPrev);
  const matches = useJsonStore((s) => s.findMatches);
  const index = useJsonStore((s) => s.findIndex);
  const closeFind = useJsonStore((s) => s.closeFind);
  const replaceQuery = useJsonStore((s) => s.replaceQuery);
  const setReplaceQuery = useJsonStore((s) => s.setReplaceQuery);
  const replaceOpen = useJsonStore((s) => s.replaceOpen);
  const toggleReplace = useJsonStore((s) => s.toggleReplace);
  const replaceCurrent = useJsonStore((s) => s.replaceCurrent);
  const replaceAll = useJsonStore((s) => s.replaceAll);

  const findHistory = useSearchStore((s) => s.findHistory);
  const pushFindHistory = useSearchStore((s) => s.pushFindHistory);
  const replaceHistory = useSearchStore((s) => s.replaceHistory);
  const pushReplaceHistory = useSearchStore((s) => s.pushReplaceHistory);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [replaceHistoryOpen, setReplaceHistoryOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // 展开替换行时把焦点交给替换框
  useEffect(() => {
    if (replaceOpen) replaceRef.current?.focus();
  }, [replaceOpen]);

  const commitHistory = () => {
    if (findQuery.trim()) pushFindHistory(findQuery);
  };

  const inputClass =
    "h-7 rounded-sm border border-stroke-strong bg-smoke-bg-layer text-ink text-[12px] px-2 fluent-focus outline-none placeholder:text-ink-tertiary";

  return (
    <div className="shrink-0 border-b border-stroke/60 bg-smoke-bg-subtle animate-fade-in">
      {/* 查找行 */}
      <div className="flex items-center gap-2 h-9 px-2">
        <Icon name="search" size={13} className="text-ink-tertiary shrink-0" />
        <div className="relative">
          <input
            ref={inputRef}
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitHistory();
                if (e.shiftKey) findPrev();
                else findNext();
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeFind();
              }
            }}
            onBlur={() => setHistoryOpen(false)}
            placeholder="查找内容"
            className={`${inputClass} w-64`}
          />
          {historyOpen && findHistory.length > 0 && (
            <HistoryList
              items={findHistory}
              onPick={(v) => {
                setFindQuery(v);
                setHistoryOpen(false);
                inputRef.current?.focus();
              }}
            />
          )}
        </div>
        <button
          onClick={toggleCase}
          title="区分大小写"
          className={`h-6 px-2 rounded-sm text-[11px] font-medium transition-colors duration-150 shrink-0 ${
            caseSensitive
              ? "bg-accent-subtle text-accent-text"
              : "text-ink-tertiary hover:bg-smoke-bg-card-hover hover:text-ink"
          }`}
        >
          Aa
        </button>
        <button
          onClick={() => {
            setHistoryOpen((v) => !v);
            setReplaceHistoryOpen(false);
          }}
          title="查找历史"
          className="w-6 h-6 rounded-sm flex items-center justify-center text-ink-secondary hover:bg-smoke-bg-card-hover shrink-0"
        >
          <Icon name="history" size={13} />
        </button>
        <button
          onClick={findPrev}
          title="上一个 (Shift+Enter)"
          disabled={!matches.length}
          className="w-6 h-6 rounded-sm flex items-center justify-center text-ink-secondary hover:bg-smoke-bg-card-hover disabled:opacity-30 disabled:pointer-events-none shrink-0"
        >
          <Icon name="chevron" size={13} className="rotate-90" />
        </button>
        <button
          onClick={findNext}
          title="下一个 (Enter)"
          disabled={!matches.length}
          className="w-6 h-6 rounded-sm flex items-center justify-center text-ink-secondary hover:bg-smoke-bg-card-hover disabled:opacity-30 disabled:pointer-events-none shrink-0"
        >
          <Icon name="chevron" size={13} className="-rotate-90" />
        </button>
        <span className="text-[11px] text-ink-tertiary tabular-nums min-w-[52px] text-center shrink-0">
          {matches.length
            ? `${index >= 0 ? index + 1 : 1}/${matches.length}`
            : findQuery
              ? "无匹配"
              : ""}
        </span>
        <div className="flex-1" />
        <button
          onClick={toggleReplace}
          title="替换 (Ctrl+H)"
          className={`h-6 px-2 rounded-sm text-[11px] transition-colors duration-150 shrink-0 ${
            replaceOpen
              ? "bg-accent-subtle text-accent-text"
              : "text-ink-tertiary hover:bg-smoke-bg-card-hover hover:text-ink"
          }`}
        >
          替换
        </button>
        <button
          onClick={closeFind}
          title="关闭 (Esc)"
          className="w-6 h-6 rounded-sm flex items-center justify-center text-ink-tertiary hover:bg-smoke-bg-card-hover hover:text-ink shrink-0"
        >
          <Icon name="close" size={12} />
        </button>
      </div>

      {/* 替换行 */}
      {replaceOpen && (
        <div className="flex items-center gap-2 h-9 px-2 border-t border-stroke/40">
          <Icon name="replace" size={13} className="text-ink-tertiary shrink-0" />
          <div className="relative">
            <input
              ref={replaceRef}
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (replaceQuery) pushReplaceHistory(replaceQuery);
                  replaceCurrent();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  closeFind();
                }
              }}
              onBlur={() => setReplaceHistoryOpen(false)}
              placeholder="替换为"
              className={`${inputClass} w-64`}
            />
            {replaceHistoryOpen && replaceHistory.length > 0 && (
              <HistoryList
                items={replaceHistory}
                onPick={(v) => {
                  setReplaceQuery(v);
                  setReplaceHistoryOpen(false);
                  replaceRef.current?.focus();
                }}
              />
            )}
          </div>
          <button
            onClick={() => {
              setReplaceHistoryOpen((v) => !v);
              setHistoryOpen(false);
            }}
            title="替换历史"
            className="w-6 h-6 rounded-sm flex items-center justify-center text-ink-secondary hover:bg-smoke-bg-card-hover shrink-0"
          >
            <Icon name="history" size={13} />
          </button>
          <button
            onClick={() => {
              if (replaceQuery) pushReplaceHistory(replaceQuery);
              replaceCurrent();
            }}
            title="替换当前命中 (Enter)"
            disabled={!matches.length}
            className="h-6 px-2 rounded-sm text-[11px] text-ink-secondary hover:bg-smoke-bg-card-hover disabled:opacity-40 disabled:pointer-events-none shrink-0"
          >
            替换
          </button>
          <button
            onClick={() => {
              if (replaceQuery) pushReplaceHistory(replaceQuery);
              replaceAll();
            }}
            title="替换全部命中"
            disabled={!matches.length}
            className="h-6 px-2 rounded-sm text-[11px] text-ink-secondary hover:bg-smoke-bg-card-hover disabled:opacity-40 disabled:pointer-events-none shrink-0"
          >
            全部替换
          </button>
        </div>
      )}
    </div>
  );
};

/** 历史下拉列表 */
const HistoryList: React.FC<{
  items: string[];
  onPick: (value: string) => void;
}> = ({ items, onPick }) => (
  <div className="absolute left-0 top-full mt-1 z-50 min-w-[256px] max-h-[240px] overflow-auto rounded-sm border border-stroke bg-smoke-bg-layer shadow-flyout py-1">
    {items.map((v) => (
      <button
        key={v}
        onMouseDown={(e) => {
          e.preventDefault();
          onPick(v);
        }}
        className="w-full text-left px-2.5 h-6 text-[12px] text-ink hover:bg-smoke-bg-card-hover truncate"
      >
        {v}
      </button>
    ))}
  </div>
);
