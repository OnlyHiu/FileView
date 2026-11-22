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
  /** 文档替换（展开替换行） */
  onReplace: () => void;
  /** 在文件夹中搜索 */
  onSearchFolder: () => void;
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
  /**
   * 回调一律通过 ref 取最新值。
   *
   * 菜单结构只依赖少数几个「结构性」属性（是否有标签、文件类型、面板、视图…），
   * 因此 useMemo 的依赖列表可以只写这些原始值；但回调（如 onZoom）每次渲染
   * 都是新闭包，若随结构一起缓存就会调用到旧闭包（缩放步长用旧的字号）。
   */
  const cb = useRef(p);
  cb.current = p;

  const { hasTab, isJson, fileKind, panel, view, parseMode, theme, recentFiles } = p;

  const menus = useMemo<Menu[]>(() => {
    const q = cb.current;
    const jsonOnly = !q.hasTab || !q.isJson;
    const views = viewsFor(q.fileKind);
    return [
      {
        label: "文件",
        entries: [
          { label: "新建标签", shortcut: "Ctrl+N", onClick: q.onNewTab },
          { label: "打开文件…", shortcut: "Ctrl+O", onClick: q.onOpen },
          { label: "保存", shortcut: "Ctrl+S", disabled: !q.hasTab, onClick: q.onSave },
          { label: "另存为…", shortcut: "Ctrl+Shift+S", disabled: !q.hasTab, onClick: q.onSaveAs },
          { label: "关闭当前标签", shortcut: "Ctrl+W", disabled: !q.hasTab, onClick: q.onCloseTab },
          "separator",
          ...(q.recentFiles.length
            ? [
                { label: "最近文件", disabled: true } as Item,
                ...q.recentFiles.slice(0, 8).map((path) => ({
                  label: path,
                  onClick: () => q.onOpenRecent(path),
                })),
                "separator" as const,
              ]
            : []),
          { label: "将当前标签分离为独立窗口", disabled: !q.hasTab, onClick: q.onDetach },
          "separator",
          { label: "退出", onClick: q.onQuit },
        ],
      },
      {
        label: "编辑",
        entries: [
          { label: "撤销", shortcut: "Ctrl+Z", disabled: !q.hasTab, onClick: q.onUndo },
          { label: "重做", shortcut: "Ctrl+Y", disabled: !q.hasTab, onClick: q.onRedo },
          "separator",
          { label: "查找…", shortcut: "Ctrl+F", disabled: !q.hasTab, onClick: q.onFind },
          { label: "查找下一个", shortcut: "F3", disabled: !q.hasTab, onClick: q.onFindNext },
          "separator",
          { label: "重新解析", shortcut: "F5", disabled: !q.hasTab, onClick: q.onReparse },
          "separator",
          { label: "复制全部内容", disabled: !q.hasTab, onClick: q.onCopyText },
          { label: "复制文件路径", disabled: !q.hasTab, onClick: q.onCopyPath },
        ],
      },
      {
        label: "搜索",
        entries: [
          { label: "文档查找…", shortcut: "Ctrl+F", disabled: !q.hasTab, onClick: q.onFind },
          { label: "文档替换…", shortcut: "Ctrl+H", disabled: !q.hasTab, onClick: q.onReplace },
          {
            label: "在文件夹中搜索",
            shortcut: "Ctrl+Alt+F",
            disabled: !q.hasTab,
            onClick: q.onSearchFolder,
          },
          "separator",
          {
            label: "JSONPath 查询",
            shortcut: "Ctrl+G",
            checked: q.panel === "query",
            disabled: !q.isJson,
            onClick: q.onQueryPanel,
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
            onClick: q.onFormat,
          },
          { label: "压缩 JSON", disabled: jsonOnly, onClick: q.onMinify },
          { label: "键排序", disabled: jsonOnly, onClick: q.onSort },
          "separator",
          { label: "转义字符串", disabled: !q.hasTab, onClick: q.onEscapeString },
          { label: "反转义字符串", disabled: !q.hasTab, onClick: q.onUnescapeString },
          "separator",
          {
            label: "解析模式：严格 JSON",
            checked: q.parseMode === "strict",
            disabled: !q.hasTab,
            onClick: () => q.onParseMode("strict"),
          },
          {
            label: "解析模式：JSONC（注释 / 尾逗号）",
            checked: q.parseMode === "jsonc",
            disabled: !q.hasTab,
            onClick: () => q.onParseMode("jsonc"),
          },
          {
            label: "解析模式：JSONL（逐行）",
            checked: q.parseMode === "jsonl",
            disabled: !q.hasTab,
            onClick: () => q.onParseMode("jsonl"),
          },
        ],
      },
      {
        label: "视图",
        entries: [
          {
            label: "查看工具",
            shortcut: "Ctrl+B",
            checked: q.panel === "viewer",
            onClick: () => q.onTogglePanel("viewer"),
          },
          "separator",
          ...views.map((v) => ({
            label: `${v.label}视图`,
            checked: q.panel === "viewer" && q.view === v.value,
            onClick: () => {
              q.onView(v.value);
              q.onShowPanel("viewer");
            },
          })),
          "separator",
          {
            label: "JSONPath 查询面板",
            checked: q.panel === "query",
            onClick: () => q.onTogglePanel("query"),
          },
          {
            label: "设置面板",
            checked: q.panel === "settings",
            onClick: () => q.onTogglePanel("settings"),
          },
          "separator",
          { label: "深色模式", checked: q.theme === "dark", onClick: q.onToggleTheme },
          { label: "放大字号", shortcut: "Ctrl+=", onClick: () => q.onZoom(1) },
          { label: "缩小字号", shortcut: "Ctrl+-", onClick: () => q.onZoom(-1) },
        ],
      },
      {
        label: "设置",
        entries: [
          {
            label: "设置…",
            shortcut: "Ctrl+,",
            checked: q.panel === "settings",
            onClick: () => q.onTogglePanel("settings"),
          },
        ],
      },
      {
        label: "帮助",
        entries: [{ label: "关于 FileView", onClick: q.onAbout }],
      },
    ];
  }, [hasTab, isJson, fileKind, panel, view, parseMode, theme, recentFiles]);

  useEffect(() => {
    if (openIndex === null) return;
    const close = () => setOpenIndex(null);
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 捕获阶段处理并阻断传播：否则同一次 Esc 会连带把侧栏面板 / 查找栏也关掉
      e.stopPropagation();
      close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
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
