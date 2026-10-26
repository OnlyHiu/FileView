// 右侧停靠面板：独立不透明背景 + 可拖拽调整宽度 + 标题栏关闭按钮
// 文档区与面板并存，互不遮挡（修复「设置页覆盖文本区」问题）

import React, { useCallback, useEffect, useRef } from "react";
import { Icon } from "./ui";

export const PANEL_MIN_WIDTH = 340;

export const SidePanel: React.FC<{
  title: string;
  icon?: string;
  onClose: () => void;
  /** 标题栏右侧的附加控件（视图切换等） */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  width: number;
  onWidthChange: (w: number) => void;
}> = ({ title, icon, onClose, headerExtra, children, width, onWidthChange }) => {
  const draggingRef = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      draggingRef.current = true;
      const move = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        const next = window.innerWidth - ev.clientX;
        const max = Math.max(PANEL_MIN_WIDTH, Math.round(window.innerWidth * 0.72));
        onWidthChange(Math.max(PANEL_MIN_WIDTH, Math.min(max, next)));
      };
      const up = () => {
        draggingRef.current = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onWidthChange]
  );

  // 面板打开时按 Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      className="relative flex flex-col shrink-0 bg-smoke-bg-layer border-l border-stroke shadow-flyout"
      style={{ width }}
    >
      {/* 左侧拖拽把手 */}
      <div
        onPointerDown={onPointerDown}
        title="拖动调整面板宽度"
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/40 transition-colors duration-150 z-10"
      />

      {/* 面板标题栏 */}
      <div className="flex items-center gap-2 h-9 px-3 shrink-0 border-b border-stroke/60">
        {icon && <Icon name={icon} size={14} className="text-accent-text shrink-0" />}
        <span className="text-[12px] font-semibold text-ink truncate">{title}</span>
        <div className="flex-1 min-w-0">{headerExtra}</div>
        <button
          onClick={onClose}
          title="关闭面板 (Esc)"
          className="w-6 h-6 rounded-sm flex items-center justify-center text-ink-tertiary hover:bg-smoke-bg-card-hover hover:text-ink shrink-0"
        >
          <Icon name="close" size={12} />
        </button>
      </div>

      {/* 面板内容 */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{children}</div>
    </aside>
  );
};
