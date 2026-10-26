// 顶部菜单栏（Notepad++ 风格）：文件 / 编辑 / 搜索 / 格式化 / 视图 / 设置 / 帮助

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./ui";
import type { PanelKind } from "../stores/jsonStore";
import { viewsFor, type FileKind, type ParseMode, type ViewMode } from "../lib/types";

interface Item {
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

type Entry = Item | "separator";

interface Menu {
  label: string;
  entries: Entry[];
}

export interface MenuBarProps {
  hasTab: boolean;
  isJson: boolean;
  theme: "light" | "dark";
  panel: PanelKind;
  view: ViewMode;
  fileKind: FileKind;
  parseMode: ParseMode;
  recentFiles: string[];
  onNewTab: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseTab: () => void;
  onOpenRecent: (path: string) => void;
  onDetach: () => void;
  onQuit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopyText: () => void;
  onCopyPath: () => void;
  onFind: () => void;
  onFindNext: () => void;
  onReparse: () => void;
  onQueryPanel: () => void;
  onFormat: () => void;
  onMinify: () => void;
  onSort: () => void;
  onEscapeString: () => void;
  onUnescapeString: () => void;
  onParseMode: (m: ParseMode) => void;
  onTogglePanel: (p: PanelKind) => void;
  /** 直接打开面板（不切换开合状态） */
  onShowPanel: (p: PanelKind) => void;
  onView: (v: ViewMode) => void;
  onToggleTheme: () => void;
  onZoom: (delta: number) => void;
  onAbout: () => void;
}

export const MenuBar: React.FC<MenuBarProps> = (p) => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const menus = useMemo<Menu[]>(() => {
    const jsonOnly = !p.hasTab || !p.isJson;
    const views = viewsFor(p.fileKind);
    return [
      {
        label: "文件",
        entries: [
          { label: "新建标签", shortcut: "Ctrl+N", onClick: p.onNewTab },
          { label: "打开文件…", shortcut: "Ctrl+O", onClick: p.onOpen },
          { label: "保存", shortcut: "Ctrl+S", disabled: !p.hasTab, onClick: p.onSave },
          { label: "另存为…", shortcut: "Ctrl+Shift+S", disabled: !p.hasTab, onClick: p.onSaveAs },
          { label: "关闭当前标签", shortcut: "Ctrl+W", disabled: !p.hasTab, onClick: p.onCloseTab },
          "separator",
          ...(p.recentFiles.length
            ? [
                { label: "最近文件", disabled: true } as Item,
                ...p.recentFiles.slice(0, 8).map((path) => ({
                  label: path,
                  onClick: () => p.onOpenRecent(path),
                })),
                "separator" as const,
              ]
            : []),
          { label: "将当前标签分离为独立窗口", disabled: !p.hasTab, onClick: p.onDetach },
          "separator",
          { label: "退出", onClick: p.onQuit },
        ],
      },
      {
        label: "编辑",
        entries: [
          { label: "撤销", shortcut: "Ctrl+Z", disabled: !p.hasTab, onClick: p.onUndo },
          { label: "重做", shortcut: "Ctrl+Y", disabled: !p.hasTab, onClick: p.onRedo },
          "separator",
          { label: "查找…", shortcut: "Ctrl+F", disabled: !p.hasTab, onClick: p.onFind },
          { label: "查找下一个", shortcut: "F3", disabled: !p.hasTab, onClick: p.onFindNext },
          "separator",
          { label: "重新解析", shortcut: "F5", disabled: !p.hasTab, onClick: p.onReparse },
          "separator",
          { label: "复制全部内容", disabled: !p.hasTab, onClick: p.onCopyText },
          { label: "复制文件路径", disabled: !p.hasTab, onClick: p.onCopyPath },
        ],
      },
      {
        label: "搜索",
        entries: [
          { label: "文档内查找…", shortcut: "Ctrl+F", disabled: !p.hasTab, onClick: p.onFind },
          {
            label: "JSONPath 查询",
            shortcut: "Ctrl+G",
            checked: p.panel === "query",
            disabled: !p.isJson,
            onClick: p.onQueryPanel,
          },
        ],
      },
      {
        label: "格式化",
        entries: [
          {
            label: "格式化 JSON",
            shortcut: "Ctrl+Shift+F",
            disabled: jsonOnly,
            onClick: p.onFormat,
          },
          { label: "压缩 JSON", disabled: jsonOnly, onClick: p.onMinify },
          { label: "键排序", disabled: jsonOnly, onClick: p.onSort },
          "separator",
          { label: "转义字符串", disabled: !p.hasTab, onClick: p.onEscapeString },
          { label: "反转义字符串", disabled: !p.hasTab, onClick: p.onUnescapeString },
          "separator",
          {
            label: "解析模式：严格 JSON",
            checked: p.parseMode === "strict",
            disabled: !p.hasTab,
            onClick: () => p.onParseMode("strict"),
          },
          {
            label: "解析模式：JSONC（注释 / 尾逗号）",
            checked: p.parseMode === "jsonc",
            disabled: !p.hasTab,
            onClick: () => p.onParseMode("jsonc"),
          },
          {
            label: "解析模式：JSONL（逐行）",
            checked: p.parseMode === "jsonl",
            disabled: !p.hasTab,
            onClick: () => p.onParseMode("jsonl"),
          },
        ],
      },
      {
        label: "视图",
        entries: [
          {
            label: "查看工具",
            shortcut: "Ctrl+B",
            checked: p.panel === "viewer",
            onClick: () => p.onTogglePanel("viewer"),
          },
          "separator",
          ...views.map((v) => ({
            label: `${v.label}视图`,
            checked: p.panel === "viewer" && p.view === v.value,
            onClick: () => {
              p.onView(v.value);
              p.onShowPanel("viewer");
            },
          })),
          "separator",
          {
            label: "JSONPath 查询面板",
            checked: p.panel === "query",
            onClick: () => p.onTogglePanel("query"),
          },
          {
            label: "设置面板",
            checked: p.panel === "settings",
            onClick: () => p.onTogglePanel("settings"),
          },
          "separator",
          { label: "深色模式", checked: p.theme === "dark", onClick: p.onToggleTheme },
          { label: "放大字号", shortcut: "Ctrl+=", onClick: () => p.onZoom(1) },
          { label: "缩小字号", shortcut: "Ctrl+-", onClick: () => p.onZoom(-1) },
        ],
      },
      {
        label: "设置",
        entries: [
          {
            label: "设置…",
            shortcut: "Ctrl+,",
            checked: p.panel === "settings",
            onClick: () => p.onTogglePanel("settings"),
          },
        ],
      },
      {
        label: "帮助",
        entries: [{ label: "关于 FileView", onClick: p.onAbout }],
      },
    ];
  }, [p]);

  useEffect(() => {
    if (openIndex === null) return;
    const close = () => setOpenIndex(null);
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openIndex]);

  return (
    <div
      ref={barRef}
      className="relative flex items-center h-8 px-1.5 shrink-0 border-b border-stroke/60 text-[12px] select-none z-40"
    >
      {menus.map((menu, i) => (
        <div key={menu.label} className="relative">
          <button
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            onMouseEnter={() => {
              if (openIndex !== null) setOpenIndex(i);
            }}
            className={`px-2.5 h-7 rounded-sm transition-colors duration-100 ${
              openIndex === i
                ? "bg-smoke-bg-card-hover text-ink"
                : "text-ink-secondary hover:bg-smoke-bg-card-hover hover:text-ink"
            }`}
          >
            {menu.label}
          </button>
          {openIndex === i && (
            <div className="absolute left-0 top-full mt-0.5 z-50 min-w-[248px] py-1 bg-smoke-bg-layer border border-stroke rounded-md shadow-flyout animate-fade-in">
              {menu.entries.map((entry, j) =>
                entry === "separator" ? (
                  <div key={`sep-${j}`} className="my-1 h-px bg-stroke/70" />
                ) : (
                  <button
                    key={entry.label}
                    disabled={entry.disabled}
                    title={entry.label}
                    onClick={() => {
                      setOpenIndex(null);
                      entry.onClick?.();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 h-7 text-left text-[12px] text-ink rounded-sm mx-0.5 disabled:opacity-40 disabled:pointer-events-none hover:bg-smoke-bg-card-hover"
                  >
                    <span className="w-3 shrink-0 text-accent-text">
                      {entry.checked && <Icon name="check" size={11} />}
                    </span>
                    <span className="flex-1 truncate">{entry.label}</span>
                    {entry.shortcut && (
                      <span className="text-[11px] text-ink-tertiary shrink-0">
                        {entry.shortcut}
                      </span>
                    )}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
      <div className="flex-1" />
    </div>
  );
};
