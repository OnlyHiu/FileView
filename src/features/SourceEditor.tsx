// 源码编辑器：行号 + 语法高亮 + 透明编辑层（供顶部编辑面板与"原始/源码"视图共用）

import React, { useEffect, useMemo, useRef } from "react";
import { tokenize } from "../lib/highlight";
import type { Lang } from "../lib/types";

export const SourceEditor: React.FC<{
  text: string;
  lang: Lang;
  onChange: (text: string) => void;
  /** 出错行（行号 1 起）→ 提示消息；仅 JSON 诊断使用 */
  errorLines?: Map<number, string>;
  /** 只读模式（查看器展示用，可选中复制不可编辑） */
  readOnly?: boolean;
}> = ({ text, lang, onChange, errorLines, readOnly = false }) => {
  const tokens = useMemo(() => tokenize(text, lang), [text, lang]);
  const lines = useMemo(() => text.split("\n"), [text]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  // 同步行号/高亮层滚动
  const syncScroll = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };

  useEffect(syncScroll, [text]);

  return (
    <div
      className="relative h-full overflow-hidden font-mono"
      style={{ fontSize: "var(--json-font-size)", lineHeight: "var(--json-line-height)" }}
    >
      {/* 行号 */}
      <div
        ref={gutterRef}
        className="absolute left-0 top-0 bottom-0 w-12 overflow-hidden bg-smoke-bg-subtle border-r border-stroke select-none z-20"
      >
        {lines.map((_, i) => (
          <div
            key={i}
            className={`px-2 text-right ${
              errorLines?.has(i + 1) ? "text-danger font-bold" : "text-ink-tertiary"
            }`}
            style={{ height: "var(--json-line-height)" }}
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* 高亮层 */}
      <pre
        ref={preRef}
        aria-hidden
        className="absolute left-12 top-0 right-0 bottom-0 overflow-hidden pointer-events-none whitespace-pre px-3 py-0"
      >
        {tokens.map((t, i) => (
          <span key={i} className={t.cls}>
            {t.text}
          </span>
        ))}
      </pre>

      {/* 透明文本编辑层（查看器中只读） */}
      <textarea
        ref={textareaRef}
        value={text}
        spellCheck={false}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        className="absolute left-12 top-0 right-0 bottom-0 w-[calc(100%-3rem)] h-full resize-none bg-transparent text-transparent caret-[var(--accent)] whitespace-pre overflow-auto outline-none px-3 py-0"
        style={{ tabSize: 2 }}
      />

      {/* 错误提示条 */}
      {errorLines && errorLines.size > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 bg-danger text-white text-[12px] px-4 py-2 rounded-md shadow-flyout max-w-[80%] truncate">
          {Array.from(errorLines.values())[0]}
        </div>
      )}
    </div>
  );
};
