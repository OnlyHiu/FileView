// 文档内查找栏：Ctrl+F 就地浮出，Enter 跳到下一处

import React, { useEffect, useRef } from "react";
import { useJsonStore } from "../stores/jsonStore";
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="flex items-center gap-2 h-9 px-2 shrink-0 border-b border-stroke/60 bg-smoke-bg-subtle animate-fade-in">
      <Icon name="search" size={13} className="text-ink-tertiary shrink-0" />
      <input
        ref={inputRef}
        value={findQuery}
        onChange={(e) => setFindQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) findPrev();
            else findNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            closeFind();
          }
        }}
        placeholder="查找内容"
        className="h-7 w-64 rounded-sm border border-stroke-strong bg-smoke-bg-layer text-ink text-[12px] px-2 fluent-focus outline-none placeholder:text-ink-tertiary"
      />
      <button
        onClick={toggleCase}
        title="区分大小写"
        className={`h-6 px-2 rounded-sm text-[11px] font-medium transition-colors duration-150 ${
          caseSensitive
            ? "bg-accent-subtle text-accent-text"
            : "text-ink-tertiary hover:bg-smoke-bg-card-hover hover:text-ink"
        }`}
      >
        Aa
      </button>
      <span className="text-[11px] text-ink-tertiary tabular-nums min-w-[52px] text-center">
        {matches.length ? `${index + 1}/${matches.length}` : findQuery ? "无匹配" : ""}
      </span>
      <button
        onClick={findPrev}
        title="上一个 (Shift+Enter)"
        disabled={!matches.length}
        className="w-6 h-6 rounded-sm flex items-center justify-center text-ink-secondary hover:bg-smoke-bg-card-hover disabled:opacity-30 disabled:pointer-events-none"
      >
        <Icon name="chevron" size={13} className="rotate-90" />
      </button>
      <button
        onClick={findNext}
        title="下一个 (Enter)"
        disabled={!matches.length}
        className="w-6 h-6 rounded-sm flex items-center justify-center text-ink-secondary hover:bg-smoke-bg-card-hover disabled:opacity-30 disabled:pointer-events-none"
      >
        <Icon name="chevron" size={13} className="-rotate-90" />
      </button>
      <div className="flex-1" />
      <button
        onClick={closeFind}
        title="关闭 (Esc)"
        className="w-6 h-6 rounded-sm flex items-center justify-center text-ink-tertiary hover:bg-smoke-bg-card-hover hover:text-ink"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
};
