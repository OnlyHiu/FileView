// 应用主壳：标题栏 + 菜单栏 + 工具栏 + 标签栏 + 文档区（+ 可停靠工具面板）+ 状态栏

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useJsonStore } from "./stores/jsonStore";
import { useSettingsStore } from "./stores/settingsStore";
import { Icon, SegmentedControl, Tooltip, Dialog } from "./components/ui";
import { MenuBar } from "./components/MenuBar";
import { SidePanel } from "./components/SidePanel";
import { TreeView } from "./features/TreeView";
import { TableView } from "./features/TableView";
import { RawView } from "./features/RawView";
import { MarkdownPreview } from "./features/MarkdownPreview";
import { IniView } from "./features/IniView";
import { CsvView } from "./features/CsvView";
import { KeyValueView } from "./features/KeyValueView";
import { XmlView } from "./features/XmlView";
import { HtmlPreview } from "./features/HtmlPreview";
import { OutlineView } from "./features/OutlineView";
import { EmptyState } from "./features/EmptyState";
import { SourceEditor } from "./features/SourceEditor";
import { FindBar } from "./features/FindBar";
import { QueryPanel } from "./features/QueryPanel";
import { SettingsPage } from "./features/SettingsPage";
import {
  isTauri,
  openFilePicker,
  readFileText,
  getFileMtime,
  takeStartupFile,
  detachTabToWindow,
} from "./lib/api";
import { getDiskBaseline, isTabDirty } from "./stores/jsonStore";
import {
  viewsFor,
  kindLabel,
  langFromPath,
  type ParseMode,
  type Tab,
  type ViewMode,
} from "./lib/types";

/** 分离窗口只应消费一次负载（React StrictMode 下 effect 会执行两次） */
let detachPayloadHandled = false;

const APP_VERSION = "0.2.0";

export default function App() {
  const panel = useJsonStore((s) => s.panel);
  const setPanel = useJsonStore((s) => s.setPanel);
  const togglePanel = useJsonStore((s) => s.togglePanel);
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
  const escapeString = useJsonStore((s) => s.escapeString);
  const unescapeString = useJsonStore((s) => s.unescapeString);
  const undo = useJsonStore((s) => s.undo);
  const redo = useJsonStore((s) => s.redo);
  const saveFile = useJsonStore((s) => s.saveFile);
  const saveFileAs = useJsonStore((s) => s.saveFileAs);
  const result = useJsonStore((s) => s.result);
  const parsing = useJsonStore((s) => s.parsing);
  const statusMessage = useJsonStore((s) => s.statusMessage);
  const parseMode = useJsonStore((s) => s.parseMode);
  const setParseMode = useJsonStore((s) => s.setParseMode);
  const setEditorText = useJsonStore((s) => s.setEditorText);
  const fileKind = useJsonStore((s) => s.fileKind);
  const findOpen = useJsonStore((s) => s.findOpen);
  const openFind = useJsonStore((s) => s.openFind);
  const closeFind = useJsonStore((s) => s.closeFind);
  const findQuery = useJsonStore((s) => s.findQuery);
  const findMatches = useJsonStore((s) => s.findMatches);
  const findIndex = useJsonStore((s) => s.findIndex);
  const findNext = useJsonStore((s) => s.findNext);

  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);

  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(460);
  const [revealNonce, setRevealNonce] = useState(0);

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

        const params = new URLSearchParams(window.location.search);
        const isDetached = params.has("detach");
        const detachedFile = isDetached ? params.get("file") : null;

        if (isDetached) {
          // 分离窗口：只载入被拖出的标签，不恢复上次会话
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const { listen, emit } = await import("@tauri-apps/api/event");
          const label = getCurrentWindow().label;
          let payloadArrived: () => void = () => {};
          if (!detachedFile) {
            let resolved = false;
            const arrival = new Promise<void>((resolve) => {
              payloadArrived = () => {
                if (resolved) return;
                resolved = true;
                resolve();
              };
            });
            await listen<{
              name: string;
              path: string | null;
              text: string;
              dirty: boolean;
            }>("detach-payload", (e) => {
              if (detachPayloadHandled) return;
              detachPayloadHandled = true;
              const p = e.payload;
              useJsonStore.getState().loadDetached(p.name, p.path, p.text, p.dirty);
              payloadArrived();
            });
            // 通知主窗口就绪，再等待内存文本（未保存内容）
            await emit("detach-ready", { label });
            await Promise.race([
              arrival,
              new Promise<void>((resolve) => window.setTimeout(resolve, 4000)),
            ]);
          } else {
            try {
              const payload = await readFileText(detachedFile);
              loadFile(payload.path, payload.text);
              if (payload.truncated) {
                useJsonStore
                  .getState()
                  .setStatus(`文件超过 64MB，仅加载了前面部分，统计与视图不完整`);
              }
            } catch (e) {
              useJsonStore.getState().setStatus(`打开文件失败: ${e}`);
            }
            await emit("detach-ready", { label });
          }
        } else {
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
  const openPath = useCallback(
    async (path: string) => {
      try {
        const payload = await readFileText(path);
        loadFile(payload.path, payload.text);
        if (payload.truncated) {
          useJsonStore
            .getState()
            .setStatus(`文件超过 64MB，仅加载了前面部分，统计与视图不完整`);
        }
      } catch (e) {
        useJsonStore.getState().setStatus(`打开文件失败: ${e}`);
      }
    },
    [loadFile]
  );

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

  // ============ 标签页分离为独立窗口 ============
  const handleDetach = useCallback(
    async (t: Tab) => {
      const ok = await detachTabToWindow({
        name: t.name,
        path: t.path,
        text: t.text,
        dirty: isTabDirty(t),
      });
      if (ok) {
        closeTab(t.id);
        useJsonStore.getState().setStatus(`已将「${t.name}」分离为独立窗口`);
      } else {
        useJsonStore.getState().setStatus("分离为独立窗口失败");
      }
    },
    [closeTab]
  );

  const handleDetachActive = useCallback(() => {
    const st = useJsonStore.getState();
    const t = st.tabs.find((x) => x.id === st.activeTabId);
    if (t) void handleDetach(t);
  }, [handleDetach]);

  // ============ 编辑菜单动作 ============
  const copyAllText = useCallback(async () => {
    const st = useJsonStore.getState();
    const t = st.tabs.find((x) => x.id === st.activeTabId);
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t.text);
      st.setStatus("已复制全部内容");
    } catch (e) {
      st.setStatus(`复制失败: ${e}`);
    }
  }, []);

  const copyFilePath = useCallback(async () => {
    const st = useJsonStore.getState();
    const t = st.tabs.find((x) => x.id === st.activeTabId);
    if (!t?.path) {
      st.setStatus("当前标签尚未保存到磁盘，没有文件路径");
      return;
    }
    try {
      await navigator.clipboard.writeText(t.path);
      st.setStatus(`已复制路径: ${t.path}`);
    } catch (e) {
      st.setStatus(`复制失败: ${e}`);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    void useSettingsStore.getState().patch({ theme: next });
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, theme: next } }));
  }, [theme]);

  const zoomFont = useCallback((delta: number) => {
    const next = Math.min(20, Math.max(11, settings.fontSize + delta));
    void useSettingsStore.getState().patch({ fontSize: next });
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, fontSize: next } }));
  }, [settings.fontSize]);

  // 关闭面板：查找栏打开时优先关闭查找栏
  const closePanel = useCallback(() => {
    if (findOpen) closeFind();
    else setPanel("none");
  }, [findOpen, closeFind, setPanel]);

  // ============ 快捷键 ============
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && key === "o") {
        e.preventDefault();
        void handleOpen();
      } else if (ctrl && e.shiftKey && key === "s") {
        e.preventDefault();
        void saveFileAs();
      } else if (ctrl && key === "s") {
        e.preventDefault();
        void saveFile();
      } else if (ctrl && key === "n") {
        e.preventDefault();
        newTab();
      } else if (ctrl && key === "w") {
        e.preventDefault();
        const id = useJsonStore.getState().activeTabId;
        if (id !== null) closeTab(id);
      } else if (ctrl && e.shiftKey && key === "f") {
        e.preventDefault();
        void applyFormat();
      } else if (ctrl && key === "f") {
        e.preventDefault();
        openFind();
      } else if (ctrl && key === "g") {
        e.preventDefault();
        togglePanel("query");
      } else if (ctrl && key === "b") {
        e.preventDefault();
        togglePanel("viewer");
      } else if (ctrl && key === ",") {
        e.preventDefault();
        togglePanel("settings");
      } else if (ctrl && key === "z") {
        e.preventDefault();
        undo();
      } else if (ctrl && key === "y") {
        e.preventDefault();
        redo();
      } else if (ctrl && (key === "=" || key === "+")) {
        e.preventDefault();
        zoomFont(1);
      } else if (ctrl && key === "-") {
        e.preventDefault();
        zoomFont(-1);
      } else if (e.key === "F5") {
        e.preventDefault();
        void reparse();
      } else if (e.key === "F3") {
        e.preventDefault();
        findNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    handleOpen,
    reparse,
    applyFormat,
    saveFile,
    saveFileAs,
    newTab,
    closeTab,
    openFind,
    findNext,
    togglePanel,
    undo,
    redo,
    zoomFont,
  ]);

  // ============ 拖拽打开 ============
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      unlisten = await getCurrentWindow().onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          const path = event.payload.paths[0];
          if (path) void openPath(path);
        }
      });
    })();
    return () => unlisten?.();
  }, [openPath]);

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

  // JSON 诊断 → 出错行
  const errorLines = useMemo(() => {
    const map = new Map<number, string>();
    if (fileKind !== "json") return map;
    for (const d of result?.diagnostics ?? []) {
      if (d.severity === "error") map.set(d.line, d.message);
    }
    return map;
  }, [result, fileKind]);

  // 查找定位：命中下标变化时刷新定位序号
  useEffect(() => {
    if (!findOpen || findIndex < 0) return;
    setRevealNonce((n) => n + 1);
  }, [findOpen, findIndex, findQuery]);

  const revealTarget =
    findOpen && findIndex >= 0 && findMatches[findIndex] !== undefined
      ? {
          start: findMatches[findIndex],
          end: findMatches[findIndex] + findQuery.length,
          nonce: revealNonce,
        }
      : null;

  const isJson = fileKind === "json";

  // 面板内容
  const panelBody = (() => {
    if (panel === "query") return <QueryPanel />;
    if (panel === "settings") return <SettingsPage />;
    // viewer
    if (isDocEmpty) {
      return (
        <div className="h-full flex items-center justify-center text-[12px] text-ink-tertiary px-4 text-center">
          空白文档，打开文件后即可使用查看工具
        </div>
      );
    }
    if (parsing && !result) {
      return (
        <div className="h-full flex items-center justify-center text-ink-tertiary">解析中…</div>
      );
    }
    switch (fileKind) {
      case "json":
        if (view === "tree") return <TreeView />;
        if (view === "table") return <TableView />;
        return <RawView readOnly />;
      case "markdown":
        return view === "preview" ? <MarkdownPreview /> : <RawView readOnly />;
      case "ini":
        return view === "structure" ? <IniView /> : <RawView readOnly />;
      case "yaml":
      case "toml":
        return view === "structure" ? <KeyValueView /> : <RawView readOnly />;
      case "csv":
        return view === "table" ? <CsvView /> : <RawView readOnly />;
      case "xml":
        return view === "structure" ? <XmlView /> : <RawView readOnly />;
      case "html":
        return view === "preview" ? <HtmlPreview /> : <RawView readOnly />;
      case "code":
        return view === "structure" ? <OutlineView /> : <RawView readOnly />;
      default:
        return <RawView readOnly />;
    }
  })();

  const panelTitle =
    panel === "query" ? "JSONPath 查询" : panel === "settings" ? "设置" : "查看工具";

  return (
    <div className={`h-full flex flex-col ${settings.mica ? "mica-bg" : ""} text-ink`}>
      {/* ============ 标题栏 ============ */}
      <header
        data-tauri-drag-region
        className="h-8 flex items-center pl-3 pr-0 select-none shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0" data-tauri-drag-region>
          <span
            className="w-1.5 h-1.5 rounded-sm bg-accent shrink-0"
            data-tauri-drag-region
            title="FileView"
          />
          <span className="text-[12px] font-medium text-ink-secondary shrink-0" data-tauri-drag-region>
            FileView
          </span>
          {activeTab && (
            <span
              className="text-[11px] text-ink-tertiary truncate max-w-[520px]"
              data-tauri-drag-region
            >
              — {activeTab.path ?? activeTab.name}
            </span>
          )}
        </div>

        <div className="flex-1" data-tauri-drag-region />

        {/* 窗口控制 */}
        <div className="flex items-stretch h-8">
          <button
            onClick={() => void windowAction("minimize")}
            className="w-11 h-8 flex items-center justify-center text-ink-secondary hover:bg-smoke-bg-card-hover"
          >
            <Icon name="minimize" size={12} />
          </button>
          <button
            onClick={() => void windowAction("maximize")}
            className="w-11 h-8 flex items-center justify-center text-ink-secondary hover:bg-smoke-bg-card-hover"
          >
            <Icon name="maximize" size={11} />
          </button>
          <button
            onClick={() => void windowAction("close")}
            className="w-11 h-8 flex items-center justify-center text-ink-secondary hover:bg-danger hover:text-white"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      </header>

      {/* ============ 菜单栏 ============ */}
      <MenuBar
        hasTab={!!activeTab}
        isJson={isJson}
        theme={theme}
        panel={panel}
        view={view}
        fileKind={fileKind}
        parseMode={parseMode}
        recentFiles={settings.recentFiles ?? []}
        onNewTab={newTab}
        onOpen={() => void handleOpen()}
        onSave={() => void saveFile()}
        onSaveAs={() => void saveFileAs()}
        onCloseTab={() => activeTab && closeTab(activeTab.id)}
        onOpenRecent={(path) => void openPath(path)}
        onFormat={() => void applyFormat()}
        onMinify={() => void applyMinify()}
        onSort={() => void applySort()}
        onEscapeString={() => escapeString()}
        onUnescapeString={() => unescapeString()}
        onParseMode={(m: ParseMode) => setParseMode(m)}
        onReparse={() => void reparse()}
        onCopyText={() => void copyAllText()}
        onCopyPath={() => void copyFilePath()}
        onFind={openFind}
        onFindNext={findNext}
        onQueryPanel={() => togglePanel("query")}
        onDetach={handleDetachActive}
        onQuit={() => void windowAction("close")}
        onUndo={undo}
        onRedo={redo}
        onTogglePanel={togglePanel}
        onView={(v: ViewMode) => setView(v)}
        onToggleTheme={toggleTheme}
        onZoom={zoomFont}
        onAbout={() => setAboutOpen(true)}
      />

      {/* ============ 工具栏 ============ */}
      <div className="flex items-center gap-0.5 px-2 h-10 border-b border-stroke/60 shrink-0">
        <ToolButton icon="plus" title="新建标签 (Ctrl+N)" onClick={newTab} />
        <ToolButton icon="open" title="打开文件 (Ctrl+O)" onClick={() => void handleOpen()} />
        <ToolButton
          icon="save"
          title="保存 (Ctrl+S)"
          onClick={() => void saveFile()}
          disabled={!activeTab}
        />
        <ToolDivider />
        <ToolButton
          icon="search"
          title="查找 (Ctrl+F)"
          onClick={openFind}
          disabled={!activeTab}
        />
        <ToolButton icon="undo" title="撤销 (Ctrl+Z)" onClick={undo} disabled={!activeTab} />
        <ToolButton icon="redo" title="重做 (Ctrl+Y)" onClick={redo} disabled={!activeTab} />
        <ToolDivider />
        <ToolButton
          icon="tree"
          title="查看工具 (Ctrl+B)"
          onClick={() => togglePanel("viewer")}
          active={panel === "viewer"}
        />
        <ToolButton
          icon="external"
          title="将当前标签分离为独立窗口"
          onClick={handleDetachActive}
          disabled={!activeTab}
        />
        <div className="flex-1" />
        {isJson && activeTab && (
          <select
            value={parseMode}
            onChange={(e) => setParseMode(e.target.value as ParseMode)}
            className="h-7 rounded-sm border border-stroke-strong bg-smoke-bg-layer text-ink text-[12px] px-2"
            title="JSON 解析模式"
          >
            <option value="strict">严格 JSON</option>
            <option value="jsonc">JSONC（注释/尾逗号）</option>
            <option value="jsonl">JSONL（逐行）</option>
          </select>
        )}
        <ToolButton
          icon={theme === "dark" ? "sun" : "moon"}
          title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          onClick={toggleTheme}
        />
      </div>

      {/* ============ 标签栏 ============ */}
      <div className="flex items-end h-9 px-1 shrink-0 border-b border-stroke/60 bg-smoke-bg-subtle/40">
        <div className="flex items-end h-full overflow-x-auto min-w-0 flex-1">
          {tabs.map((t) => (
            <TabItem
              key={t.id}
              tab={t}
              active={t.id === activeTabId}
              onActivate={() => switchTab(t.id)}
              onClose={() => closeTab(t.id)}
              onDetach={() => void handleDetach(t)}
            />
          ))}
          <button
            onClick={newTab}
            title="新建标签 (Ctrl+N)"
            className="w-7 h-7 mb-0.5 ml-0.5 flex items-center justify-center rounded-sm text-ink-secondary hover:bg-smoke-bg-card-hover shrink-0"
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
      </div>

      {/* ============ 主区：文档区 + 工具面板 ============ */}
      <div className="flex-1 min-h-0 flex">
        <main className="relative flex-1 min-w-0 min-h-0 flex flex-col bg-smoke-bg-layer">
          {findOpen && <FindBar />}
          {activeTab ? (
            <SourceEditor
              text={activeText}
              lang={langFromPath(activeTab.path)}
              onChange={setEditorText}
              errorLines={errorLines}
              reveal={revealTarget}
              autoFocus={isDocEmpty}
            />
          ) : (
            <EmptyState onOpen={() => void handleOpen()} />
          )}
          {activeTab && isDocEmpty && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="text-center text-ink-tertiary text-[13px] leading-6">
                空白文档 · 按 Ctrl+O 打开文件，或直接粘贴内容
              </div>
            </div>
          )}
        </main>

        {panel !== "none" && (
          <SidePanel
            title={panelTitle}
            icon={panel === "settings" ? "settings" : panel === "query" ? "search" : "tree"}
            onClose={closePanel}
            width={panelWidth}
            onWidthChange={setPanelWidth}
            headerExtra={
              panel === "viewer" && !isDocEmpty ? (
                <div className="flex justify-end">
                  <SegmentedControl
                    value={view}
                    onChange={(v) => setView(v as ViewMode)}
                    options={viewsFor(fileKind)}
                  />
                </div>
              ) : null
            }
          >
            {panelBody}
          </SidePanel>
        )}
      </div>

      {/* ============ 状态栏 ============ */}
      <footer className="h-7 flex items-center gap-4 px-4 text-[11px] text-ink-secondary border-t border-stroke/60 shrink-0 bg-smoke-bg-subtle/50">
        <span className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isDocEmpty
                ? "bg-ink-tertiary"
                : isJson
                  ? result && result.diagnostics.length === 0
                    ? "bg-success"
                    : "bg-danger"
                  : "bg-success"
            }`}
          />
          {isDocEmpty
            ? "空白文档"
            : isJson
              ? result
                ? result.diagnostics.length === 0
                  ? "✓ JSON 合法"
                  : `✗ ${result.diagnostics.length} 个问题`
                : "未解析"
              : `✓ ${kindLabel(fileKind)}`}
        </span>
        {isJson && result ? (
          <>
            <span>{result.stats.total_nodes.toLocaleString()} 节点</span>
            <span>深度 {result.stats.max_depth}</span>
            <span>{formatBytes(result.stats.byte_size)}</span>
            <span>{result.stats.elapsed_ms} ms</span>
          </>
        ) : !isDocEmpty ? (
          <>
            <span>{textLines.toLocaleString()} 行</span>
            <span>{formatBytes(textBytes)}</span>
          </>
        ) : null}
        <span className="flex-1 text-center text-ink-tertiary truncate">{statusMessage}</span>
        <span className="shrink-0">UTF-8</span>
        <span className="shrink-0">{kindLabel(fileKind)}</span>
        <span className="truncate max-w-[240px]">{activeTab?.path ?? activeTab?.name}</span>
      </footer>

      {/* ============ 关于 ============ */}
      <Dialog
        open={aboutOpen}
        title="关于 FileView"
        onClose={() => setAboutOpen(false)}
        footer={
          <button
            onClick={() => setAboutOpen(false)}
            className="px-4 h-8 rounded-sm text-[13px] font-medium bg-accent text-ink-on-accent hover:bg-accent-hover"
          >
            确定
          </button>
        }
      >
        <div className="space-y-1.5">
          <div className="text-[13px] font-medium text-ink">FileView v{APP_VERSION}</div>
          <div>Windows 11 Fluent 风格的多格式文件查看器与编辑器。</div>
          <div>
            支持 JSON / JSONC / JSONL、Markdown、YAML、TOML、CSV、XML、HTML、INI、代码文件与日志。
          </div>
          <div className="text-ink-tertiary">
            提示：文档区默认显示文本；「查看工具」面板提供树形 / 表格 / 预览等视图；
            拖动标签页可分离为独立窗口。
          </div>
        </div>
      </Dialog>
    </div>
  );
}

const ToolButton: React.FC<{
  icon: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}> = ({ icon, title, onClick, disabled, active }) => (
  <Tooltip text={title}>
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors duration-100 disabled:opacity-35 disabled:pointer-events-none ${
        active
          ? "bg-accent-subtle text-accent-text"
          : "text-ink-secondary hover:bg-smoke-bg-card-hover hover:text-ink"
      }`}
    >
      <Icon name={icon} size={15} />
    </button>
  </Tooltip>
);

const ToolDivider: React.FC = () => <div className="w-px h-5 bg-stroke mx-1 shrink-0" />;

/** 按住不动多久后进入长按提示状态 */
const LONG_PRESS_MS = 420;
/** 长按后移动多远开始拖出 */
const DRAG_THRESHOLD = 14;
/** 未长按、直接按住拖动时，移动多远触发分离（避免误触） */
const DRAG_OUT_THRESHOLD = 28;

function TabItem({
  tab,
  active,
  onActivate,
  onClose,
  onDetach,
}: {
  tab: Tab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
  onDetach: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState<{ x: number; y: number } | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const press = useRef<{ x: number; y: number; timer: number; moved: boolean } | null>(null);
  const holdingRef = useRef(false);
  /** 最近一次长按/拖出的时间戳：用于吞掉紧随其后的 click */
  const suppressClickAt = useRef(0);

  const reset = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    holdingRef.current = false;
    setHolding(false);
    setDragging(false);
    setHint(null);
  };

  useEffect(() => {
    if (!menuAt) return;
    const close = () => setMenuAt(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuAt]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const timer = window.setTimeout(() => {
      holdingRef.current = true;
      setHolding(true);
      setHint({ x: e.clientX, y: e.clientY });
    }, LONG_PRESS_MS);
    press.current = { x: e.clientX, y: e.clientY, timer, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    // 长按后小幅移动即可拖出；直接拖动则需要更明显的位移
    const threshold = holdingRef.current ? DRAG_THRESHOLD : DRAG_OUT_THRESHOLD;
    if (dist > threshold) {
      if (!p.moved) {
        p.moved = true;
        window.clearTimeout(p.timer);
        setDragging(true);
      }
      setHint({ x: e.clientX, y: e.clientY });
    }
  };

  const onPointerUp = () => {
    const moved = press.current?.moved ?? false;
    const held = holdingRef.current;
    reset();
    if (held || moved) suppressClickAt.current = Date.now();
    if (moved) onDetach();
  };

  return (
    <>
      <div
        onClick={() => {
          if (Date.now() - suppressClickAt.current < 600) return;
          onActivate();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuAt({ x: e.clientX, y: e.clientY });
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={reset}
        title="按住拖动或长按拖出，可分离为独立窗口"
        className={`group relative flex items-center gap-1.5 px-3 h-8 mx-0.5 rounded-t-md text-[12px] max-w-[190px] select-none touch-none transition-shadow ${
          dragging
            ? "cursor-grabbing opacity-60"
            : holding
              ? "cursor-grab ring-2 ring-accent"
              : "cursor-default"
        } ${
          active
            ? "bg-smoke-bg-layer text-ink border-t border-x border-stroke"
            : "text-ink-secondary hover:bg-smoke-bg-card-hover"
        }`}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-2 right-2 top-0 h-0.5 rounded-b bg-accent"
          />
        )}
        <Icon name="file" size={12} className="shrink-0" />
        <span className="truncate">
          {tab.name}
          {isTabDirty(tab) && <span className="text-accent-text font-bold"> •</span>}
        </span>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="关闭标签页"
          className={`text-ink-tertiary hover:text-ink ${
            active ? "opacity-70" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <Icon name="close" size={10} />
        </button>
      </div>
      {(holding || dragging) && hint && (
        <div
          className="fixed z-[999] pointer-events-none rounded-md border border-stroke bg-smoke-bg-layer px-2 py-1 text-[11px] text-ink shadow-flyout"
          style={{ left: hint.x + 14, top: hint.y + 14 }}
        >
          {dragging ? "松开即可分离为独立窗口" : "拖动标签页，可分离为独立窗口"}
        </div>
      )}
      {menuAt && (
        <div
          className="fixed z-[999] min-w-[180px] py-1 rounded-md border border-stroke bg-smoke-bg-layer shadow-flyout text-[12px]"
          style={{ left: menuAt.x, top: menuAt.y }}
        >
          <button
            onMouseDown={(e) => {
              e.stopPropagation();
              setMenuAt(null);
              onClose();
            }}
            className="w-full flex items-center gap-2 px-2.5 h-7 text-left text-ink hover:bg-smoke-bg-card-hover"
          >
            <Icon name="close" size={11} />
            关闭标签页
          </button>
          <button
            onMouseDown={(e) => {
              e.stopPropagation();
              setMenuAt(null);
              onDetach();
            }}
            className="w-full flex items-center gap-2 px-2.5 h-7 text-left text-ink hover:bg-smoke-bg-card-hover"
          >
            <Icon name="external" size={11} />
            分离为独立窗口
          </button>
        </div>
      )}
    </>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
