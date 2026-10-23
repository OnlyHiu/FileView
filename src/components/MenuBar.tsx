// 顶部菜单栏（Notepad++ 风格）：文件 / 编辑 / 格式化 / 搜索 / 视图 / 设置 / 帮助

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./ui";
import type { Page } from "../stores/jsonStore";
import { viewsFor, type FileKind, type ViewMode } from "../lib/types";

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
  page: Page;
  view: ViewMode;
  fileKind: FileKind;
  theme: "light" | "dark";
  hasTab: boolean;
  isJson: boolean;
  onNewTab: () => void;
  onOpen: () => void;
  onSave: () => void;
  onCloseTab: () => void;
  onFormat: () => void;
  onMinify: () => void;
  onSort: () => void;
  onReparse: () => void;
  onCopyText: () => void;
  onCopyPath: () => void;
  onDetach: () => void;
  onQuit: () => void;
  onAbout: () => void;
  onPage: (p: Page) => void;
  onView: (v: ViewMode) => void;
  onToggleTheme: () => void;
}

export const MenuBar: React.FC<MenuBarProps> = (p) => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const menus = useMemo<Menu[]>(() => {
    const formatDisabled = !p.hasTab || !p.isJson;
    return [
      {
        label: "文件",
        entries: [
          { label: "新建标签", shortcut: "Ctrl+N", onClick: p.onNewTab },
          { label: "打开文件…", shortcut: "Ctrl+O", onClick: p.onOpen },
          { label: "保存", shortcut: "Ctrl+S", disabled: !p.hasTab, onClick: p.onSave },
          { label: "关闭当前标签", shortcut: "Ctrl+W", disabled: !p.hasTab, onClick: p.onCloseTab },
          "separator",
          { label: "将当前标签分离为独立窗口", disabled: !p.hasTab, onClick: p.onDetach },
          "separator",
          { label: "退出", onClick: p.onQuit },
        ],
      },
      {
        label: "编辑",
        entries: [
          { label: "重新解析", shortcut: "F5", disabled: !p.hasTab, onClick: p.onReparse },
          "separator",
          { label: "复制全部内容", disabled: !p.hasTab, onClick: p.onCopyText },
          { label: "复制文件路径", disabled: !p.hasTab, onClick: p.onCopyPath },
        ],
      },
      {
        label: "格式化",
        entries: [
          {
            label: "格式化 JSON",
            shortcut: "Ctrl+Shift+F",
            disabled: formatDisabled,
            onClick: p.onFormat,
          },
          { label: "压缩 JSON", disabled: formatDisabled, onClick: p.onMinify },
          { label: "键排序", disabled: formatDisabled, onClick: p.onSort },
        ],
      },
      {
        label: "搜索",
        entries: [
          { label: "查询与搜索…", shortcut: "Ctrl+F", checked: p.page === "query", onClick: () => p.onPage("query") },
        ],
      },
      {
        label: "视图",
        entries: [
          { label: "查看器", checked: p.page === "viewer", onClick: () => p.onPage("viewer") },
          { label: "编辑器", checked: p.page === "editor", onClick: () => p.onPage("editor") },
          "separator",
          ...viewsFor(p.fileKind).map((v) => ({
            label: v.label,
            checked: p.page === "viewer" && p.view === v.value,
            onClick: () => {
              p.onView(v.value);
              p.onPage("viewer");
            },
          })),
          "separator",
          {
            label: "深色模式",
            checked: p.theme === "dark",
            onClick: p.onToggleTheme,
          },
        ],
      },
      {
        label: "设置",
        entries: [
          { label: "设置…", checked: p.page === "settings", onClick: () => p.onPage("settings") },
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
      className="relative flex items-center gap-0.5 h-7 px-1 shrink-0 border-b border-stroke/60 text-[12px] select-none z-40"
    >
      {menus.map((menu, i) => (
        <div key={menu.label} className="relative">
          <button
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            onMouseEnter={() => {
              if (openIndex !== null) setOpenIndex(i);
            }}
            className={`px-2.5 h-6 rounded-sm transition-colors duration-100 ${
              openIndex === i
                ? "bg-smoke-bg-card-hover text-ink"
                : "text-ink-secondary hover:bg-smoke-bg-card-hover hover:text-ink"
            }`}
          >
            {menu.label}
          </button>
          {openIndex === i && (
            <div className="absolute left-0 top-full mt-0.5 z-50 min-w-[240px] py-1 bg-smoke-bg-layer border border-stroke rounded-md shadow-flyout animate-fade-in">
              {menu.entries.map((entry, j) =>
                entry === "separator" ? (
                  <div key={`sep-${j}`} className="my-1 h-px bg-stroke/70" />
                ) : (
                  <button
                    key={entry.label}
                    disabled={entry.disabled}
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
