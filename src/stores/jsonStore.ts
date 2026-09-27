// JSON 文档状态：标签页、解析结果、视图、搜索/查询

import { create } from "zustand";
import * as api from "../lib/api";
import { useSettingsStore } from "./settingsStore";
import {
  kindFromPath,
  kindLabel,
  resolveView,
  type FileKind,
  type FlatNode,
  type ParseMode,
  type ParseResult,
  type Tab,
  type ViewMode,
} from "../lib/types";

export type { ViewMode };
export type Page = "editor" | "viewer" | "query" | "settings";

interface JsonState {
  tabs: Tab[];
  /** 当前活动标签；tabs 为空时为 null（允许删到一个页面都不剩） */
  activeTabId: number | null;
  page: Page;
  view: ViewMode;
  parseMode: ParseMode;
  /** 当前文件大类（由活动标签页路径推导） */
  fileKind: FileKind;
  result: ParseResult | null;
  parsing: boolean;
  expanded: Record<number, boolean>;
  selectedId: number | null;
  searchQuery: string;
  searchInKeys: boolean;
  searchInValues: boolean;
  searchHits: number[];
  queryExpr: string;
  queryHits: string[];
  queryError: string | null;
  statusMessage: string;

  // actions
  setPage: (p: Page) => void;
  setView: (v: ViewMode) => void;
  setParseMode: (m: ParseMode) => void;
  newTab: () => void;
  closeTab: (id: number) => void;
  switchTab: (id: number) => void;
  loadFile: (path: string, text: string) => void;
  reloadFromDisk: (path: string, text: string) => void;
  setEditorText: (text: string) => void;
  reparse: () => Promise<void>;
  saveFile: () => Promise<void>;
  toggleExpand: (id: number) => void;
  expandTo: (id: number) => void;
  select: (id: number | null) => void;
  setSearch: (q: string) => void;
  toggleSearchScope: (which: "keys" | "values") => void;
  runSearch: () => void;
  setQueryExpr: (e: string) => void;
  runQuery: () => Promise<void>;
  applyFormat: () => Promise<void>;
  applyMinify: () => Promise<void>;
  applySort: () => Promise<void>;
  setStatus: (msg: string) => void;
}

let tabSeq = 1;

/** reparse 竞态保护：单调递增序号，丢弃过期结果 */
let reparseSeq = 0;
/** 编辑防抖定时器 */
let reparseTimer: ReturnType<typeof setTimeout> | null = null;

/** 各文件最近一次从磁盘读入的文本（用于判断本地是否有未保存修改） */
const diskBaselines = new Map<string, string>();

export function getDiskBaseline(path: string): string | undefined {
  return diskBaselines.get(path);
}

/** 记录最近打开文件（最多 10 条，最近优先），持久化到设置 */
function recordRecent(path: string) {
  const st = useSettingsStore.getState();
  const recent = [path, ...st.settings.recentFiles.filter((p) => p !== path)].slice(0, 10);
  void st.patch({ recentFiles: recent });
}

const makeTab = (name = "未命名", text = ""): Tab => ({
  id: tabSeq++,
  name,
  path: null,
  text,
});

function countLines(text: string): number {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n += 1;
  return n;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** 活动标签页变化后：文件大类 + 与之匹配的视图（无效视图回落默认） */
function docStateFor(tab: Tab | undefined, currentView: ViewMode) {
  const kind = kindFromPath(tab?.path ?? null);
  return { fileKind: kind, view: resolveView(currentView, kind) } as const;
}

/** 标签页是否有未保存的更改 */
export function isTabDirty(t: Tab): boolean {
  if (t.path) return diskBaselines.get(t.path) !== t.text;
  return t.text.trim().length > 0;
}

/** 自动展开策略：根 + 前两层 */
function autoExpand(nodes: FlatNode[]): Record<number, boolean> {
  const expanded: Record<number, boolean> = {};
  for (const n of nodes) {
    if (n.depth <= 1 && n.has_children) expanded[n.id] = true;
  }
  return expanded;
}

export const useJsonStore = create<JsonState>((set, get) => ({
  tabs: [makeTab()],
  activeTabId: 1,
  page: "viewer",
  view: "tree",
  parseMode: "strict",
  fileKind: "json",
  result: null,
  parsing: false,
  expanded: {},
  selectedId: null,
  searchQuery: "",
  searchInKeys: true,
  searchInValues: true,
  searchHits: [],
  queryExpr: "$.",
  queryHits: [],
  queryError: null,
  statusMessage: "就绪",

  setPage: (p) => set({ page: p }),
  setView: (v) => set({ view: v }),
  setParseMode: (m) => {
    set({ parseMode: m });
    void get().reparse();
  },

  newTab: () => {
    const t = makeTab();
    set((s) => ({
      tabs: [...s.tabs, t],
      activeTabId: t.id,
      result: null,
      expanded: {},
      ...docStateFor(t, s.view),
    }));
    void get().reparse();
  },

  closeTab: (id) => {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      // 允许删到零个页面（包括最后一个空白页）
      const activeTabId =
        s.activeTabId === id ? (tabs.length ? tabs[tabs.length - 1].id : null) : s.activeTabId;
      return {
        tabs,
        activeTabId,
        result: tabs.length ? s.result : null,
        searchHits: tabs.length ? s.searchHits : [],
        selectedId: tabs.length ? s.selectedId : null,
        ...docStateFor(tabs.find((t) => t.id === activeTabId), s.view),
      };
    });
    void get().reparse();
  },

  switchTab: (id) => {
    set((s) => ({
      activeTabId: id,
      ...docStateFor(s.tabs.find((t) => t.id === id), s.view),
    }));
    void get().reparse();
  },

  loadFile: (path, text) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    diskBaselines.set(path, text);
    recordRecent(path);
    set((s) => {
      const existing = s.tabs.find((t) => t.path === path);
      if (existing) {
        return {
          activeTabId: existing.id,
          tabs: s.tabs.map((t) => (t.id === existing.id ? { ...t, text } : t)),
          expanded: {},
          selectedId: null,
          ...docStateFor(existing, s.view),
        };
      }
      const t: Tab = { id: tabSeq++, name, path, text };
      return {
        tabs: [...s.tabs, t],
        activeTabId: t.id,
        expanded: {},
        selectedId: null,
        ...docStateFor(t, s.view),
      };
    });
    void get().reparse();
  },

  // 磁盘文件变化后的自动重载：更新文本但保留展开/选中状态
  reloadFromDisk: (path, text) => {
    diskBaselines.set(path, text);
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, text } : t)),
    }));
    void get().reparse();
  },

  setEditorText: (text) => {
    set((s) => {
      // 零页面状态下直接输入：自动创建空白文档
      if (!s.tabs.some((t) => t.id === s.activeTabId)) {
        const t: Tab = { id: tabSeq++, name: "未命名", path: null, text };
        return { tabs: [...s.tabs, t], activeTabId: t.id, ...docStateFor(t, s.view) };
      }
      return {
        tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, text } : t)),
      };
    });
    // 防抖解析：连续输入时不逐键触发
    if (reparseTimer) clearTimeout(reparseTimer);
    reparseTimer = setTimeout(() => {
      reparseTimer = null;
      void get().reparse();
    }, 250);
  },

  reparse: async () => {
    const { activeTabId, tabs, parseMode } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    // 空白文档：不解析、不报错，展示空状态
    if (!tab.text.trim()) {
      set({
        result: null,
        parsing: false,
        searchHits: [],
        statusMessage: "空白文档 — 打开文件或粘贴内容",
      });
      return;
    }
    // 非 JSON 文本类文件：不做 JSON 解析（避免误报语法错误），只展示文本统计
    const kind = kindFromPath(tab.path);
    if (kind !== "json") {
      set({
        result: null,
        parsing: false,
        searchHits: [],
        statusMessage: `${kindLabel(kind)} · ${countLines(tab.text).toLocaleString()} 行 · ${formatBytes(tab.text.length)}`,
      });
      return;
    }
    const seq = ++reparseSeq;
    set({ parsing: true });
    try {
      const result = await api.parseJson(tab.text, parseMode);
      if (seq !== reparseSeq) return; // 已有更新的解析在途/完成，丢弃过期结果
      // 保留用户手动展开/折叠的状态；仅对新节点套用默认展开
      const prev = get().expanded;
      const merged = autoExpand(result.nodes);
      for (const n of result.nodes) {
        if (n.id in prev) merged[n.id] = prev[n.id];
      }
      set({
        result,
        parsing: false,
        expanded: merged,
        statusMessage: result.diagnostics.length
          ? `发现 ${result.diagnostics.length} 个问题`
          : `解析完成：${result.stats.total_nodes} 个节点 · ${result.stats.elapsed_ms}ms`,
      });
    } catch (e) {
      if (seq === reparseSeq) set({ parsing: false, statusMessage: `解析失败: ${e}` });
    }
  },

  toggleExpand: (id) =>
    set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),

  saveFile: async () => {
    const { activeTabId, tabs } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    try {
      if (tab.path) {
        await api.writeFileText(tab.path, tab.text);
        diskBaselines.set(tab.path, tab.text);
        set({ statusMessage: `已保存: ${tab.path}` });
        return;
      }
      // 未命名文档 → 另存为
      const path = await api.saveFileDialog(tab.name);
      if (!path) return;
      await api.writeFileText(path, tab.text);
      const name = path.split(/[\\/]/).pop() ?? path;
      diskBaselines.set(path, tab.text);
      recordRecent(path);
      const next: Tab = { ...tab, path, name };
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === activeTabId ? next : t)),
        statusMessage: `已保存: ${path}`,
        ...docStateFor(next, s.view),
      }));
      void get().reparse();
    } catch (e) {
      set({ statusMessage: `保存失败: ${e}` });
    }
  },

  expandTo: (id) => {
    const { result } = get();
    if (!result) return;
    const byId = new Map(result.nodes.map((n) => [n.id, n]));
    const expanded = { ...get().expanded };
    let cur = byId.get(id);
    while (cur && cur.parent !== null) {
      expanded[cur.parent] = true;
      cur = byId.get(cur.parent);
    }
    set({ expanded, selectedId: id, page: "viewer", view: "tree" });
  },

  select: (id) => set({ selectedId: id }),

  setSearch: (q) => set({ searchQuery: q }),

  toggleSearchScope: (which) =>
    set((s) =>
      which === "keys"
        ? { searchInKeys: !s.searchInKeys }
        : { searchInValues: !s.searchInValues }
    ),

  runSearch: () => {
    const { result, searchQuery, searchInKeys, searchInValues } = get();
    if (!result || !searchQuery.trim()) {
      set({ searchHits: [] });
      return;
    }
    const needle = searchQuery.trim().toLowerCase();
    const hits = result.nodes
      .filter((n) => {
        const keyHit =
          searchInKeys && (n.key ?? "").toLowerCase().includes(needle);
        const valueHit =
          searchInValues &&
          ["string", "number", "boolean", "null"].includes(n.kind) &&
          n.value.toLowerCase().includes(needle);
        return keyHit || valueHit;
      })
      .map((n) => n.id);
    set({ searchHits: hits, statusMessage: `搜索命中 ${hits.length} 处` });
  },

  setQueryExpr: (e) => set({ queryExpr: e }),

  runQuery: async () => {
    const { activeTabId, tabs, queryExpr, parseMode } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    try {
      const hits = await api.queryJson(tab.text, queryExpr, parseMode);
      set({ queryHits: hits, queryError: null, statusMessage: `查询命中 ${hits.length} 条路径` });
    } catch (e) {
      set({ queryHits: [], queryError: String(e) });
    }
  },

  applyFormat: async () => {
    const { activeTabId, tabs, parseMode } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    if (kindFromPath(tab.path) !== "json") {
      set({ statusMessage: "格式化仅支持 JSON 文件" });
      return;
    }
    try {
      const indent = await getIndent();
      const out = await api.formatJson(tab.text, indent, parseMode);
      get().setEditorText(out);
      set({ statusMessage: "已格式化" });
    } catch (e) {
      set({ statusMessage: `格式化失败: ${e}` });
    }
  },

  applyMinify: async () => {
    const { activeTabId, tabs, parseMode } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    if (kindFromPath(tab.path) !== "json") {
      set({ statusMessage: "压缩仅支持 JSON 文件" });
      return;
    }
    try {
      const out = await api.minifyJson(tab.text, parseMode);
      get().setEditorText(out);
      set({ statusMessage: "已压缩" });
    } catch (e) {
      set({ statusMessage: `压缩失败: ${e}` });
    }
  },

  applySort: async () => {
    const { activeTabId, tabs, parseMode } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    if (kindFromPath(tab.path) !== "json") {
      set({ statusMessage: "键排序仅支持 JSON 文件" });
      return;
    }
    try {
      const indent = await getIndent();
      const out = await api.sortKeysJson(tab.text, indent, parseMode);
      get().setEditorText(out);
      set({ statusMessage: "已按键排序" });
    } catch (e) {
      set({ statusMessage: `排序失败: ${e}` });
    }
  },

  setStatus: (msg) => set({ statusMessage: msg }),
}));

async function getIndent(): Promise<string> {
  try {
    const s = await api.getSettings();
    return s.indent;
  } catch {
    return "2";
  }
}
