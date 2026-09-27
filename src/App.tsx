// 应用主壳：自定义标题栏 + 导航 + 内容区 + 状态栏

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useJsonStore, type Page, type ViewMode } from "./stores/jsonStore";
import { useSettingsStore } from "./stores/settingsStore";
import { Icon, SegmentedControl, Button, Tooltip } from "./components/ui";
import { TreeView } from "./features/TreeView";
import { TableView } from "./features/TableView";
import { RawView } from "./features/RawView";
import { MarkdownPreview } from "./features/MarkdownPreview";
import { IniView } from "./features/IniView";
import { EmptyState } from "./features/EmptyState";
import { EditorPage } from "./features/EditorPage";
import { QueryPanel } from "./features/QueryPanel";
import { SettingsPage } from "./features/SettingsPage";
import { isTauri, openFilePicker, readFileText, getFileMtime, takeStartupFile } from "./lib/api";
import { getDiskBaseline, isTabDirty } from "./stores/jsonStore";
import { viewsFor, kindLabel } from "./lib/types";

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: "viewer", label: "查看器", icon: "tree" },
  { id: "editor", label: "编辑器", icon: "code" },
  { id: "query", label: "查询", icon: "search" },
  { id: "settings", label: "设置", icon: "settings" },
];

export default function App() {
  const page = useJsonStore((s) => s.page);
  const setPage = useJsonStore((s) => s.setPage);
  const view = useJsonStore((s) => s.view);
  const setView = useJsonStore((s) => s.setView);
  const tabs = useJsonStore((s) => s.tabs);
  const activeTabId = useJsonStore((s) => s.activeTabId);
  const newTab = useJsonStore((s) => s.newTab);
  const closeTab = useJsonStore((s) => s.closeTab);
  const switchTab = useJsonStore((s) => s.switchTab);
  const loadFile = useJsonStore((s) => s.loadFile);
  const reparse = useJsonStore((s) => s.reparse);
  const applyFormat = useJsonStore((s) => s.applyFormat);
  const applyMinify = useJsonStore((s) => s.applyMinify);
  const applySort = useJsonStore((s) => s.applySort);
  const result = useJsonStore((s) => s.result);
  const parsing = useJsonStore((s) => s.parsing);
  const statusMessage = useJsonStore((s) => s.statusMessage);
  const parseMode = useJsonStore((s) => s.parseMode);
  const setParseMode = useJsonStore((s) => s.setParseMode);
  const fileKind = useJsonStore((s) => s.fileKind);
  const saveFile = useJsonStore((s) => s.saveFile);

  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);

  const [theme, setTheme] = useState<"light" | "dark">("light");

  // ============ 启动：主题 → 载入文档 → 显示窗口（避免启动白闪） ============
  const revealedRef = useRef(false);
  const revealWindow = useCallback(async (t?: "light" | "dark") => {
    if (!isTauri() || revealedRef.current) return;
    revealedRef.current = true;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      if (t) await w.setTheme(t);
      await w.show();
      await w.setFocus();
    } catch {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().show();
      } catch {
        // 忽略：无法显示窗口时保持现状
      }
    }
  }, []);

  useEffect(() => {
    void (async () => {
      let t: "light" | "dark" = "light";
      try {
        await loadSettings();
        const s = useSettingsStore.getState().settings;
        // 先落地主题，避免窗口显示后发生跳变
        const prefersDark =
          typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-color-scheme: dark)").matches;
        t = (s.theme === "system" ? (prefersDark ? "dark" : "light") : s.theme) as
          | "light"
          | "dark";
        document.documentElement.setAttribute("data-theme", t);
        document.documentElement.classList.toggle("dark", t === "dark");
        setTheme(t);

        // 命令行参数传入的文件（文件关联 / 拖到图标）优先加载
        const startup = await takeStartupFile();
        if (startup) {
          const payload = await readFileText(startup);
          loadFile(payload.path, payload.text);
          if (payload.truncated) {
            useJsonStore
              .getState()
              .setStatus(`文件超过 64MB，仅加载了前面部分，统计与视图不完整`);
          }
        } else if (s.startup !== "blank") {
          // 启动行为：按设置恢复上次会话 / 最近文件
          // last 严格恢复上次打开的文件；recent 依次尝试最近列表中仍可用的文件
          const candidates = s.startup === "last" ? s.recentFiles.slice(0, 1) : s.recentFiles;
          let restored = false;
          for (const path of candidates) {
            try {
              const payload = await readFileText(path);
              loadFile(payload.path, payload.text);
              useJsonStore
                .getState()
                .setStatus(`已恢复${s.startup === "last" ? "上次会话" : "最近"}的文件: ${path}`);
              restored = true;
              break;
            } catch {
              // 文件已不可用，尝试下一个
            }
          }
          if (!restored && candidates.length > 0) {
            useJsonStore.getState().setStatus("启动恢复失败：最近的文件已不可用");
          }
        }
        // 等解析完成后显示窗口：呈现时内容已就绪，无空白帧
        await useJsonStore.getState().reparse();
      } catch (e) {
        useJsonStore.getState().setStatus(`启动加载失败: ${e}`);
      } finally {
        await revealWindow(t);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const apply = () => {
      const prefersDark =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      const mode =
        settings.theme === "system" ? (prefersDark ? "dark" : "light") : settings.theme;
      const t = mode as "light" | "dark";
      document.documentElement.setAttribute("data-theme", t);
      document.documentElement.classList.toggle("dark", t === "dark");
      setTheme(t);
      // 窗口级主题跟随应用主题（影响阴影/系统绘制部分）
      if (isTauri()) {
        void import("@tauri-apps/api/window")
          .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(t === "dark" ? "dark" : "light"))
          .catch(() => {});
      }
    };
    apply();
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener("change", apply);
    return () => mq?.removeEventListener("change", apply);
  }, [settings.theme]);

  // 字号设置 → 内容视图 CSS 变量
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--json-font-size", `${settings.fontSize}px`);
    root.style.setProperty("--json-line-height", `${Math.round(settings.fontSize * 1.6)}px`);
  }, [settings.fontSize]);

  // ============ 文件监视自动重载 ============
  const activePath = tabs.find((t) => t.id === activeTabId)?.path ?? null;
  const watchFile = settings.watchFile;
  useEffect(() => {
    if (!isTauri() || !watchFile || !activePath) return;
    let stopped = false;
    let lastMtime: number | null | undefined = undefined;
    let warned = false;
    const tick = async () => {
      try {
        const m = await getFileMtime(activePath);
        if (stopped) return;
        if (lastMtime === undefined) {
          lastMtime = m;
          return;
        }
        if (m === lastMtime) return;
        lastMtime = m;
        const payload = await readFileText(activePath);
        if (stopped) return;
        const tab = useJsonStore.getState().tabs.find((t) => t.path === activePath);
        if (!tab) return;
        if (tab.text === getDiskBaseline(activePath)) {
          // 无本地修改：安全重载，保留展开/选中状态
          useJsonStore.getState().reloadFromDisk(activePath, payload.text);
          useJsonStore.getState().setStatus("文件已在磁盘上更改，已自动重新加载");
        } else if (!warned) {
          warned = true;
          useJsonStore
            .getState()
            .setStatus("文件已在磁盘上更改，但本地有未保存修改，未自动重载");
        }
      } catch {
        // 文件暂不可读（被占用/删除），忽略本次轮询
      }
    };
    const timer = window.setInterval(() => void tick(), 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [watchFile, activePath]);

  // ============ 已有实例接收新打开的文件（single-instance 转发） ============
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<string>("open-file", (e) => {
        void readFileText(e.payload)
          .then((p) => {
            loadFile(p.path, p.text);
            if (p.truncated) {
              useJsonStore
                .getState()
                .setStatus(`文件超过 64MB，仅加载了前面部分，统计与视图不完整`);
            }
          })
          .catch((err) => useJsonStore.getState().setStatus(`打开文件失败: ${err}`));
      });
    })();
    return () => unlisten?.();
  }, [loadFile]);

  // ============ 文件打开 ============
  const handleOpen = useCallback(async () => {
    try {
      const payload = await openFilePicker();
      if (payload) {
        loadFile(payload.path, payload.text);
        if (payload.truncated) {
          useJsonStore
            .getState()
            .setStatus(`文件超过 64MB，仅加载了前面部分，统计与视图不完整`);
        }
      }
    } catch (e) {
      useJsonStore.getState().setStatus(`打开文件失败: ${e}`);
    }
  }, [loadFile]);

  // ============ 快捷键 ============
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "o") {
        e.preventDefault();
        void handleOpen();
      } else if (e.ctrlKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveFile();
      } else if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        setPage("query");
      } else if (e.key === "F5") {
        e.preventDefault();
        void reparse();
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        void applyFormat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleOpen, setPage, reparse, applyFormat, saveFile]);

  // ============ 拖拽打开 ============
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      unlisten = await getCurrentWindow().onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          const path = event.payload.paths[0];
          if (path) {
            void readFileText(path)
              .then((p) => {
                loadFile(p.path, p.text);
                if (p.truncated) {
                  useJsonStore
                    .getState()
                    .setStatus(`文件超过 64MB，仅加载了前面部分，统计与视图不完整`);
                }
              })
              .catch((e) => useJsonStore.getState().setStatus(`打开文件失败: ${e}`));
          }
        }
      });
    })();
    return () => unlisten?.();
  }, [loadFile]);

  // ============ 窗口控制 ============
  const windowAction = async (action: "minimize" | "maximize" | "close") => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    if (action === "minimize") await w.minimize();
    else if (action === "maximize") await w.toggleMaximize();
    else await w.close();
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeText = activeTab?.text ?? "";
  const textStats = useMemo(() => {
    let lines = activeText ? 1 : 0;
    for (let i = 0; i < activeText.length; i++) if (activeText.charCodeAt(i) === 10) lines += 1;
    return { lines, bytes: activeText.length };
  }, [activeText]);
  const textLines = textStats.lines;
  const textBytes = textStats.bytes;
  const isDocEmpty = activeText.trim() === "";

  return (
    <div className={`h-full flex flex-col ${settings.mica ? "mica-bg" : ""} text-ink`}>
      {/* ============ 标题栏 ============ */}
      <header
        data-tauri-drag-region
        className="h-10 flex items-center pl-3 pr-0 select-none shrink-0 border-b border-stroke/60"
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <img
            src={isTauri() ? "icon.png" : undefined}
            alt=""
            className="w-4 h-4"
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
          <span className="text-[12px] font-medium text-ink-secondary" data-tauri-drag-region>
            FileView
          </span>
        </div>

        {/* 标签页 */}
        <div className="flex items-end ml-4 h-full overflow-x-auto" data-tauri-drag-region>
          {tabs.map((t) => (
            <div
              key={t.id}
              onClick={() => switchTab(t.id)}
              className={`group flex items-center gap-1.5 px-3 h-8 mx-0.5 rounded-t-md cursor-default text-[12px] max-w-[180px] ${
                t.id === activeTabId
                  ? "bg-smoke-bg-card text-ink border-t border-x border-stroke"
                  : "text-ink-secondary hover:bg-smoke-bg-card-hover"
              }`}
            >
              <Icon name="file" size={12} className="shrink-0" />
              <span className="truncate">
                {t.name}
                {isTabDirty(t) && <span className="text-accent-text font-bold"> •</span>}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                title="关闭标签页"
                className="opacity-0 group-hover:opacity-100 text-ink-tertiary hover:text-ink"
              >
                <Icon name="close" size={10} />
              </button>
            </div>
          ))}
          <button
            onClick={newTab}
            className="w-7 h-7 flex items-center justify-center rounded-sm text-ink-secondary hover:bg-smoke-bg-card-hover shrink-0"
          >
            <Icon name="plus" size={13} />
          </button>
        </div>

        <div className="flex-1" data-tauri-drag-region />

        {/* 窗口控制 */}
        <div className="flex items-stretch h-10">
          <button
            onClick={() => void windowAction("minimize")}
            className="w-11 h-10 flex items-center justify-center text-ink-secondary hover:bg-smoke-bg-card-hover"
          >
            <Icon name="minimize" size={12} />
          </button>
          <button
            onClick={() => void windowAction("maximize")}
            className="w-11 h-10 flex items-center justify-center text-ink-secondary hover:bg-smoke-bg-card-hover"
          >
            <Icon name="maximize" size={11} />
          </button>
          <button
            onClick={() => void windowAction("close")}
            className="w-11 h-10 flex items-center justify-center text-ink-secondary hover:bg-danger hover:text-white"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      </header>

      {/* ============ 主体 ============ */}
      <div className="flex-1 flex min-h-0">
        {/* 左侧导航 */}
        <nav className="w-44 shrink-0 border-r border-stroke/60 py-2 px-1.5 flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={`relative flex items-center gap-2.5 px-2.5 h-9 rounded-md text-[13px] transition-colors duration-150 ${
                page === item.id
                  ? "bg-smoke-bg-card text-ink font-medium"
                  : "text-ink-secondary hover:bg-smoke-bg-card-hover"
              }`}
            >
              {page === item.id && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-accent" />
              )}
              <Icon name={item.icon} size={16} />
              {item.label}
            </button>
          ))}

          <div className="flex-1" />

          {/* 主题切换 */}
          <button
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              void useSettingsStore.getState().patch({ theme: next });
              useSettingsStore.setState((s) => ({ settings: { ...s.settings, theme: next } }));
            }}
            className="flex items-center gap-2.5 px-2.5 h-9 rounded-md text-[13px] text-ink-secondary hover:bg-smoke-bg-card-hover"
          >
            <Icon name={theme === "dark" ? "moon" : "sun"} size={16} />
            {theme === "dark" ? "深色模式" : "浅色模式"}
          </button>
        </nav>

        {/* 内容区 */}
        <main className="flex-1 min-w-0 flex flex-col">
          {page === "editor" && <EditorPage onOpen={() => void handleOpen()} />}

          {page === "viewer" && (
            <>
              {/* 工具条（查看器只读展示；空白文档时隐藏，只留打开入口） */}
              {!isDocEmpty && (
                <div className="flex items-center gap-2 px-3 py-2 border-b border-stroke/60 shrink-0">
                  <SegmentedControl
                    value={view}
                    onChange={(v) => setView(v as ViewMode)}
                    options={viewsFor(fileKind)}
                  />
                  <div className="w-px h-5 bg-stroke" />
                  <Button icon="open" onClick={() => void handleOpen()}>
                    打开文件
                  </Button>
                  <Tooltip text="保存 (Ctrl+S)">
                    <Button icon="save" variant="accent" onClick={() => void saveFile()}>
                      保存
                    </Button>
                  </Tooltip>
                  <div className="flex-1" />
                  {fileKind === "json" && (
                    <>
                      <select
                        value={parseMode}
                        onChange={(e) => setParseMode(e.target.value as typeof parseMode)}
                        className="h-8 rounded-sm border border-stroke-strong bg-smoke-bg-layer text-ink text-[12px] px-2"
                      >
                        <option value="strict">严格 JSON</option>
                        <option value="jsonc">JSONC（注释/尾逗号）</option>
                        <option value="jsonl">JSONL（逐行）</option>
                      </select>
                      <Button icon="refresh" onClick={() => void reparse()}>
                        重新解析
                      </Button>
                    </>
                  )}
                </div>
              )}

              {/* 视图（只读；空白文档只显示打开入口；按文件类型展示对应标签页） */}
              <div className="flex-1 min-h-0">
                {isDocEmpty ? (
                  <EmptyState onOpen={() => void handleOpen()} />
                ) : parsing && !result ? (
                  <div className="flex items-center justify-center h-full text-ink-tertiary">
                    解析中…
                  </div>
                ) : fileKind === "json" ? (
                  view === "tree" ? (
                    <TreeView />
                  ) : view === "table" ? (
                    <TableView />
                  ) : (
                    <RawView />
                  )
                ) : fileKind === "markdown" ? (
                  view === "preview" ? (
                    <MarkdownPreview />
                  ) : (
                    <RawView />
                  )
                ) : fileKind === "ini" ? (
                  view === "structure" ? (
                    <IniView />
                  ) : (
                    <RawView />
                  )
                ) : (
                  <RawView />
                )}
              </div>
            </>
          )}

          {page === "query" && <QueryPanel />}
          {page === "settings" && <SettingsPage />}
        </main>
      </div>

      {/* ============ 状态栏 ============ */}
      <footer className="h-7 flex items-center gap-4 px-4 text-[11px] text-ink-secondary border-t border-stroke/60 shrink-0">
        <span className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isDocEmpty
                ? "bg-ink-tertiary"
                : fileKind === "json"
                  ? result && result.diagnostics.length === 0
                    ? "bg-success"
                    : "bg-danger"
                  : "bg-success"
            }`}
          />
          {isDocEmpty
            ? "空白文档"
            : fileKind === "json"
              ? result
                ? result.diagnostics.length === 0
                  ? "✓ JSON 合法"
                  : `✗ ${result.diagnostics.length} 个问题`
                : "未解析"
              : `✓ ${kindLabel(fileKind)}`}
        </span>
        {fileKind === "json" && result ? (
          <>
            <span>{result.stats.total_nodes.toLocaleString()} 节点</span>
            <span>深度 {result.stats.max_depth}</span>
            <span>{formatBytes(result.stats.byte_size)}</span>
            <span>{result.stats.elapsed_ms} ms</span>
          </>
        ) : fileKind !== "json" && !isDocEmpty ? (
          <>
            <span>{textLines.toLocaleString()} 行</span>
            <span>{formatBytes(textBytes)}</span>
          </>
        ) : null}
        <span className="flex-1 text-center text-ink-tertiary truncate">{statusMessage}</span>
        <span className="truncate max-w-[260px]">{activeTab?.path ?? activeTab?.name}</span>
      </footer>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
