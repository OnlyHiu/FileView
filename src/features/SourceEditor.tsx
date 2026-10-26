// 文档区源码编辑器：行号 + 语法高亮 + 透明编辑层
// 被文档区（默认视图）与「查看工具 → 原始」共用

import React, { useEffect, useMemo, useRef, useState } from "react";
import { tokenize } from "../lib/highlight";
import { useSettingsStore } from "../stores/settingsStore";
import type { Lang } from "../lib/types";

export interface RevealTarget {
  /** 起始字符偏移 */
  start: number;
  /** 结束字符偏移 */
  end: number;
  /** 递增序号，用于同位置重复触发 */
  nonce: number;
}

export const SourceEditor: React.FC<{
  text: string;
  lang: Lang;
  onChange?: (text: string) => void;
  /** 出错行（行号 1 起）→ 提示消息；仅 JSON 诊断使用 */
  errorLines?: Map<number, string>;
  /** 只读模式（查看工具展示用，可选中复制不可编辑） */
  readOnly?: boolean;
  /** 外部请求定位并选中一段文本（查找跳转） */
  reveal?: RevealTarget | null;
  /** 文档为空时自动聚焦，便于直接粘贴内容 */
  autoFocus?: boolean;
}> = ({ text, lang, onChange, errorLines, readOnly = false, reveal = null, autoFocus = false }) => {
  const tokens = useMemo(() => tokenize(text, lang), [text, lang]);
  const lines = useMemo(() => text.split("\n"), [text]);
  /** 行高（像素）：与 CSS 变量 --json-line-height 保持一致 */
  const fontSize = useSettingsStore((s) => s.settings.fontSize);
  const lineHeightPx = Math.round(fontSize * 1.6);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  /** 光标所在行（1 起） */
  const [cursorLine, setCursorLine] = useState(1);

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

  // 空白文档自动聚焦，便于直接粘贴
  useEffect(() => {
    if (autoFocus && !readOnly) textareaRef.current?.focus();
  }, [autoFocus, readOnly]);

  // 光标行高亮
  const updateCursorLine = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const upto = ta.value.slice(0, ta.selectionStart);
    const line = upto.split("\n").length;
    setCursorLine(line);
  };

  // 查找跳转：选中并滚动到目标位置
  useEffect(() => {
    if (!reveal) return;
    const ta = textareaRef.current;
    if (!ta) return;
    try {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(reveal.start, reveal.end);
      const lineHeight =
        parseFloat(getComputedStyle(ta).lineHeight || "20") || 20;
      const lineIndex = text.slice(0, reveal.start).split("\n").length - 1;
      const top = Math.max(0, lineIndex * lineHeight - ta.clientHeight / 3);
      ta.scrollTop = top;
      syncScroll();
      updateCursorLine();
    } catch {
      // 定位失败时保持现状
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.nonce]);

  // Tab 键插入缩进空格（编辑器体验对齐 Notepad++）
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || readOnly || !onChange) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = `${text.slice(0, start)}  ${text.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      ta.setSelectionRange(start + 2, start + 2);
    });
  };

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
            className={`px-2 text-right transition-colors duration-100 ${
              errorLines?.has(i + 1)
                ? "text-danger font-bold"
                : i + 1 === cursorLine
                  ? "text-accent-text font-medium"
                  : "text-ink-tertiary"
            }`}
            style={{ height: "var(--json-line-height)" }}
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* 当前行高亮 */}
      <div
        aria-hidden
        className="absolute left-12 right-0 pointer-events-none bg-accent/[0.06] z-[5]"
        style={{
          top: (cursorLine - 1) * lineHeightPx,
          height: lineHeightPx,
        }}
      />

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

      {/* 透明文本编辑层 */}
      <textarea
        ref={textareaRef}
        value={text}
        spellCheck={false}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
        onKeyUp={updateCursorLine}
        onClick={updateCursorLine}
        onSelect={updateCursorLine}
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
