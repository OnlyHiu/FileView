// 文档区源码编辑器：行号 + 语法高亮 + 透明编辑层
//
// 采用**虚拟滚动**：只渲染可见区域，行号与高亮层都按窗口生成。
// 大文件（数十 MB）因此也能流畅打开与滚动——此前的实现会为每一行
// 生成一个 DOM 节点、并对全文分词，打开即卡死。
//
// 被文档区（默认视图）与「查看工具 → 原始」共用。

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { WindowHighlighter, visibleLineRange } from "../lib/highlightWindow";
import type { Lang } from "../lib/types";

export interface RevealTarget {
  /** 起始字符偏移 */
  start: number;
  /** 结束字符偏移 */
  end: number;
  /** 递增序号，用于同位置重复触发 */
  nonce: number;
}

/** 视口外额外渲染的行数，避免快速滚动时露出空白 */
const OVERSCAN = 20;

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
  const fontSize = useSettingsStore((s) => s.settings.fontSize);
  const indent = useSettingsStore((s) => s.settings.indent);
  /** 行高（像素）：与 CSS 变量 --json-line-height 保持一致 */
  const lineHeightPx = Math.max(1, Math.round(fontSize * 1.6));

  // 窗口化高亮：只为可见区域生成 token
  const highlighter = useMemo(() => new WindowHighlighter(text, lang), [text, lang]);
  const lineCount = highlighter.lineCount;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** 高亮内容层（跟随双向滚动） */
  const contentRef = useRef<HTMLDivElement>(null);
  /** 行号层（仅跟随纵向滚动） */
  const gutterRef = useRef<HTMLDivElement>(null);

  /** 光标所在行（1 起） */
  const [cursorLine, setCursorLine] = useState(1);
  /**
   * 实际滚动位置。
   *
   * 用 ref 而非 state 记录：滚动事件里先同步写入 ref（命令式更新 transform），
   * 再触发一次渲染；渲染时读取 ref 得到的永远是**最新**滚动位置，
   * 不会出现「状态落后一帧 → 渲染的行区间覆盖不到可见区域 → 露出空白」。
   */
  const scrollRef = useRef({ top: 0, height: 400 });
  /** 滚动计数：仅用于触发重新渲染 */
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  // 视口尺寸变化时重新测量
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const measure = () => {
      const h = ta.clientHeight;
      if (scrollRef.current.height !== h) {
        scrollRef.current = { ...scrollRef.current, height: h };
        forceRender();
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ta);
    return () => ro.disconnect();
  }, []);

  /**
   * 同步滚动：内容层用 transform 跟随（命令式，无渲染延迟），
   * 行号层只跟随纵向。
   */
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { scrollTop, scrollLeft, clientHeight } = ta;
    if (contentRef.current) {
      contentRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
    }
    if (gutterRef.current) {
      gutterRef.current.style.transform = `translateY(${-scrollTop}px)`;
    }
    scrollRef.current = { top: scrollTop, height: clientHeight };
    forceRender();
  }, []);

  // 空白文档自动聚焦，便于直接粘贴
  useEffect(() => {
    if (autoFocus && !readOnly) textareaRef.current?.focus();
  }, [autoFocus, readOnly]);

  // 内容变化后重新同步滚动位置（切换标签时 textarea 的 scrollTop 可能被重置）
  useEffect(() => {
    syncScroll();
  }, [text, syncScroll]);

  // 光标行高亮（用行索引二分查找，避免每次移动光标都扫描全文）
  const updateCursorLine = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    setCursorLine(highlighter.lineOf(ta.selectionStart) + 1);
  }, [highlighter]);

  // 查找跳转：选中并滚动到目标位置
  useEffect(() => {
    if (!reveal) return;
    const ta = textareaRef.current;
    if (!ta) return;
    try {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(reveal.start, reveal.end);
      const lineIndex = highlighter.lineOf(reveal.start);
      const top = Math.max(0, lineIndex * lineHeightPx - ta.clientHeight / 3);
      ta.scrollTop = top;
      syncScroll();
      updateCursorLine();
    } catch {
      // 定位失败时保持现状
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.nonce]);

  // Tab 键插入缩进（按用户设置的缩进宽度）
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || readOnly || !onChange) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const unit = indent === "tab" ? "\t" : " ".repeat(Number(indent) || 2);
    const next = `${text.slice(0, start)}${unit}${text.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      ta.setSelectionRange(start + unit.length, start + unit.length);
    });
  };

  // 可见行范围（含视口外缓冲）
  const scrollTop = scrollRef.current.top;
  const viewportH = scrollRef.current.height;
  const [firstLine, lastLine] = visibleLineRange(
    scrollTop,
    viewportH,
    lineHeightPx,
    lineCount,
    OVERSCAN
  );
  const visibleLines = useMemo(
    () => highlighter.getLines(firstLine, lastLine),
    [highlighter, firstLine, lastLine]
  );

  return (
    <div
      className="relative h-full overflow-hidden font-mono"
      style={{ fontSize: "var(--json-font-size)", lineHeight: "var(--json-line-height)" }}
    >
      {/* 行号层 */}
      <div className="absolute left-0 top-0 bottom-0 w-12 overflow-hidden bg-smoke-bg-subtle border-r border-stroke select-none z-20">
        <div ref={gutterRef} className="absolute top-0 left-0 right-0">
          {visibleLines.map((_, i) => {
            const lineNo = firstLine + i + 1;
            return (
              <div
                key={lineNo}
                className={`absolute left-0 right-0 px-2 text-right transition-colors duration-100 ${
                  errorLines?.has(lineNo)
                    ? "text-danger font-bold"
                    : lineNo === cursorLine
                      ? "text-accent-text font-medium"
                      : "text-ink-tertiary"
                }`}
                style={{ top: (lineNo - 1) * lineHeightPx, height: lineHeightPx }}
              >
                {lineNo}
              </div>
            );
          })}
        </div>
      </div>

      {/* 当前行高亮（跟随纵向滚动，不随横向滚动） */}
      <div
        aria-hidden
        className="absolute left-12 right-0 pointer-events-none bg-accent/[0.06] z-[5]"
        style={{
          top: (cursorLine - 1) * lineHeightPx - scrollTop,
          height: lineHeightPx,
        }}
      />

      {/* 高亮层（跟随双向滚动） */}
      <div
        aria-hidden
        className="absolute left-12 top-0 right-0 bottom-0 overflow-hidden pointer-events-none"
      >
        <div ref={contentRef} className="absolute top-0 left-0 right-0">
          {visibleLines.map((tokens, i) => {
            const lineNo = firstLine + i + 1;
            return (
              <div
                key={lineNo}
                className="absolute left-0 pl-3 whitespace-pre"
                style={{ top: (lineNo - 1) * lineHeightPx, height: lineHeightPx }}
              >
                {tokens.map((t, j) => (
                  <span key={j} className={t.cls}>
                    {t.text}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </div>

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
