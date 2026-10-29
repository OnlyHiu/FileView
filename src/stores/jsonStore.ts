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

/** 右侧工具面板：none = 全部收起，文档区独占 */
export type PanelKind = "none" | "viewer" | "query" | "settings";

interface JsonState {
  tabs: Tab[];
  /** 当前活动标签；tabs 为空时为 null（允许删到一个页面都不剩） */
  activeTabId: number | null;
  /** 右侧工具面板 */
  panel: PanelKind;
  view: ViewMode;
  parseMode: ParseMode;
  /** 当前文件大类（由活动标签页路径推导） */
  fileKind: FileKind;
  result: ParseResult | null;
  parsing: boolean;
  /**
   * 折叠状态：按**节点路径**（path）索引，而非节点 id。
   * 节点 id 是每次解析时按遍历顺序重新分配的，文档头部增删一个键就会整体错位；
   * 路径则在结构不变时保持稳定。
   */
  expanded: Record<string, boolean>;
  selectedId: number | null;
  searchQuery: string;
  searchInKeys: boolean;
  searchInValues: boolean;
  searchHits: number[];
  queryExpr: string;
  queryHits: string[];
  queryError: string | null;
  statusMessage: string;
  /** 文档内查找 */
  findQuery: string;
  findCaseSensitive: boolean;
  /** 命中位置（字符偏移），按出现顺序 */
  findMatches: number[];
  /** 当前命中的下标；-1 表示未选中 */
  findIndex: number;
  /** 查找栏是否展开 */
  findOpen: boolean;
  /**
   * 定位序号：仅在用户**显式**导航查找（下一个/上一个/改查询词）时递增，
   * 用于触发编辑器重新选中命中位置。文档编辑导致的重算不会递增，
   * 否则会在用户打字时反复把光标抢走。
   */
  findNonce: number;

  // actions
  setPanel: (p: PanelKind) => void;
  /** 切换面板：同面板再次点击则收起 */
  togglePanel: (p: PanelKind) => void;
  setView: (v: ViewMode) => void;
  setParseMode: (m: ParseMode) => void;
  newTab: () => void;
  closeTab: (id: number) => void;
  switchTab: (id: number) => void;
  loadFile: (path: string, text: string) => void;
  /** 从主窗口分离出来的标签：在新窗口建立独立文档（含未保存内容） */
  loadDetached: (name: string, path: string | null, text: string, dirty: boolean) => void;
  reloadFromDisk: (path: string, text: string) => void;
  setEditorText: (text: string) => void;
  undo: () => void;
  redo: () => void;
  reparse: () => Promise<void>;
  saveFile: () => Promise<void>;
  saveFileAs: () => Promise<void>;
  escapeString: () => void;
  unescapeString: () => void;
  toggleExpand: (path: string) => void;
  expandTo: (id: number) => void;
  select: (id: number | null) => void;
  setSearch: (q: string) => void;
  toggleSearchScope: (which: "keys" | "values") => void;
  runSearch: () => void;
  setQueryExpr: (e: string) => void;
  runQuery: () => Promise<void>;
  openFind: () => void;
  closeFind: () => void;
  setFindQuery: (q: string) => void;
  toggleFindCase: () => void;
  /** 文档内容或活动标签变化后重新计算查找命中（偏移量必须随文本变化） */
  syncFind: () => void;
  findNext: () => void;
  findPrev: () => void;
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

/** 每个标签的编辑历史（撤销 / 重做） */
interface TabHistory {
  undo: string[];
  redo: string[];
  /** 上次记录编辑的时间戳，用于合并连续输入 */
  lastEditAt: number;
}

const histories = new Map<number, TabHistory>();
/** 连续输入合并窗口（毫秒） */
const EDIT_COALESCE_MS = 600;
/** 历史栈上限 */
const HISTORY_LIMIT = 200;

function historyOf(tabId: number): TabHistory {
  let h = histories.get(tabId);
  if (!h) {
    h = { undo: [], redo: [], lastEditAt: 0 };
    histories.set(tabId, h);
  }
  return h;
}

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
function autoExpand(nodes: FlatNode[]): Record<string, boolean> {
  const expanded: Record<string, boolean> = {};
  for (const n of nodes) {
    if (n.depth <= 1 && n.has_children) expanded[n.path] = true;
  }
  return expanded;
}

export const useJsonStore = create<JsonState>((set, get) => ({
  tabs: [makeTab()],
  activeTabId: 1,
  panel: "none",
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
  findQuery: "",
  findCaseSensitive: false,
  findMatches: [],
  findIndex: -1,
  findOpen: false,
  findNonce: 0,

  setPanel: (p) => set({ panel: p }),

  togglePanel: (p) => set((s) => ({ panel: s.panel === p ? "none" : p })),
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
      // 关闭的是当前标签：解析结果/折叠/选中/命中都属于被关闭的文档，必须一并清空，
      // 否则新标签会短暂显示旧文档的 JSON 错误行
      const closedActive = s.activeTabId === id;
      return {
        tabs,
        activeTabId,
        result: closedActive ? null : s.result,
        expanded: closedActive ? {} : s.expanded,
        searchHits: closedActive ? [] : s.searchHits,
        selectedId: closedActive ? null : s.selectedId,
        ...docStateFor(tabs.find((t) => t.id === activeTabId), s.view),
      };
    });
    // 释放该标签的撤销历史，避免长期运行时无界增长
    histories.delete(id);
    get().syncFind();
    void get().reparse();
  },

  switchTab: (id) => {
    set((s) => ({
      activeTabId: id,
      // 切换标签：折叠/选中/命中均按文档维度，跨标签复用会导致展开错位与错误高亮
      expanded: {},
      selectedId: null,
      searchHits: [],
      result: null,
      ...docStateFor(s.tabs.find((t) => t.id === id), s.view),
    }));
    // 命中偏移是相对文本的：换文档后必须重算
    get().syncFind();
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
      // 打开文件时清掉从未编辑过的空白「未命名」标签，避免残留空标签页
      const blank = s.tabs.find((x) => !x.path && !isTabDirty(x) && x.text.trim() === "");
      const rest = blank ? s.tabs.filter((x) => x.id !== blank.id) : s.tabs;
      return {
        tabs: [...rest, t],
        activeTabId: t.id,
        expanded: {},
        selectedId: null,
        ...docStateFor(t, s.view),
      };
    });
    void get().reparse();
  },

  loadDetached: (name, path, text, dirty) => {
    // 未保存的文件内容：没有磁盘基线，保证脏标记与主窗口一致
    if (path && !dirty) diskBaselines.set(path, text);
    else if (path) diskBaselines.delete(path);
    if (path) recordRecent(path);
    set((s) => {
      const t: Tab = { id: tabSeq++, name, path, text };
      const blank = s.tabs.find(
        (x) => x.id === s.activeTabId && !x.path && x.text.trim() === ""
      );
      const rest = blank ? s.tabs.filter((x) => x.id !== blank.id) : s.tabs;
      return {
        tabs: [...rest, t],
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
    const before = get();
    const beforeTab = before.tabs.find((t) => t.id === before.activeTabId);
    const prevText = beforeTab?.text;
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
    // 记录撤销历史：连续输入在 600ms 内合并为一步
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab || prevText === undefined || prevText === text) return;
    const h = historyOf(tab.id);
    const now = Date.now();
    if (now - h.lastEditAt > EDIT_COALESCE_MS) {
      h.undo.push(prevText);
      if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
    }
    // 任何新编辑都必须作废重做栈——否则「撤销 → 继续输入 → 重做」会用旧内容
    // 覆盖用户刚输入的字符，造成静默丢字。
    h.redo.length = 0;
    h.lastEditAt = now;
    // 文本已变：查找命中偏移必须重算，否则会跳到错误位置
    get().syncFind();
    // 防抖解析：连续输入时不逐键触发
    if (reparseTimer) clearTimeout(reparseTimer);
    reparseTimer = setTimeout(() => {
      reparseTimer = null;
      void get().reparse();
    }, 250);
  },

  undo: () => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return;
    const h = historyOf(tab.id);
    const prev = h.undo.pop();
    if (prev === undefined) {
      set({ statusMessage: "没有可撤销的操作" });
      return;
    }
    h.redo.push(tab.text);
    h.lastEditAt = 0;
    set((st) => ({
      tabs: st.tabs.map((t) => (t.id === tab.id ? { ...t, text: prev } : t)),
      statusMessage: "已撤销",
    }));
    get().syncFind();
    void get().reparse();
  },

  redo: () => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return;
    const h = historyOf(tab.id);
    const next = h.redo.pop();
    if (next === undefined) {
      set({ statusMessage: "没有可重做的操作" });
      return;
    }
    h.undo.push(tab.text);
    h.lastEditAt = 0;
    set((st) => ({
      tabs: st.tabs.map((t) => (t.id === tab.id ? { ...t, text: next } : t)),
      statusMessage: "已重做",
    }));
    get().syncFind();
    void get().reparse();
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
      // 保留用户手动展开/折叠的状态；仅对新节点套用默认展开。
      // 按**路径**合并（而非节点 id）：id 会随文档头部增删整体错位。
      const prev = get().expanded;
      const merged = autoExpand(result.nodes);
      for (const n of result.nodes) {
        if (n.path in prev) merged[n.path] = prev[n.path];
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

  toggleExpand: (path) =>
    set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } })),

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

  saveFileAs: async () => {
    const { activeTabId, tabs } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    try {
      const path = await api.saveFileDialog(tab.name);
      if (!path) return;
      await api.writeFileText(path, tab.text);
      const name = path.split(/[\\/]/).pop() ?? path;
      diskBaselines.set(path, tab.text);
      recordRecent(path);
      const next: Tab = { ...tab, path, name };
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === activeTabId ? next : t)),
        statusMessage: `已另存为: ${path}`,
        ...docStateFor(next, s.view),
      }));
      void get().reparse();
    } catch (e) {
      set({ statusMessage: `另存为失败: ${e}` });
    }
  },

  escapeString: () => {
    const { activeTabId, tabs } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    get().setEditorText(JSON.stringify(tab.text));
    set({ statusMessage: "已转义为字符串字面量" });
  },

  unescapeString: () => {
    const { activeTabId, tabs } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    try {
      const v = JSON.parse(tab.text);
      if (typeof v !== "string") {
        set({ statusMessage: "当前内容不是字符串字面量" });
        return;
      }
      get().setEditorText(v);
      set({ statusMessage: "已反转义" });
    } catch (e) {
      set({ statusMessage: `反转义失败: ${e}` });
    }
  },

  expandTo: (id) => {
    const { result } = get();
    if (!result) return;
    const byId = new Map(result.nodes.map((n) => [n.id, n]));
    const expanded = { ...get().expanded };
    let cur = byId.get(id);
    // 展开命中节点的所有祖先（按路径索引）
    while (cur && cur.parent !== null) {
      const parent = byId.get(cur.parent);
      if (!parent) break;
      expanded[parent.path] = true;
      cur = parent;
    }
    set({ expanded, selectedId: id, panel: "viewer", view: "tree" });
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

  openFind: () => set({ findOpen: true }),

  closeFind: () => set({ findOpen: false, findQuery: "", findMatches: [], findIndex: -1 }),

  setFindQuery: (q) => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    const text = tab?.text ?? "";
    const matches = findAll(text, q, s.findCaseSensitive);
    set({
      findQuery: q,
      findMatches: matches,
      findIndex: matches.length ? 0 : -1,
      findNonce: s.findNonce + 1,
      statusMessage: q ? `查找命中 ${matches.length} 处` : "",
    });
  },

  // 文本或标签变化后重算命中：命中位置是字符偏移，
  // 文本一变旧偏移就指向错误位置（甚至越界）。
  // 注意：不递增 findNonce —— 用户正在打字时不能把光标抢到命中处。
  syncFind: () => {
    const s = get();
    if (!s.findOpen || !s.findQuery) {
      if (s.findMatches.length || s.findIndex !== -1) {
        set({ findMatches: [], findIndex: -1 });
      }
      return;
    }
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    const text = tab?.text ?? "";
    const matches = findAll(text, s.findQuery, s.findCaseSensitive);
    set({
      findMatches: matches,
      findIndex: matches.length ? Math.min(s.findIndex, matches.length - 1) : -1,
    });
  },

  toggleFindCase: () => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    const text = tab?.text ?? "";
    const caseSensitive = !s.findCaseSensitive;
    const matches = findAll(text, s.findQuery, caseSensitive);
    set({
      findCaseSensitive: caseSensitive,
      findMatches: matches,
      findIndex: matches.length ? 0 : -1,
      findNonce: s.findNonce + 1,
    });
  },

  findNext: () => {
    const s = get();
    if (!s.findMatches.length) return;
    const idx = s.findIndex < 0 ? 0 : (s.findIndex + 1) % s.findMatches.length;
    set({
      findIndex: idx,
      findNonce: s.findNonce + 1,
      statusMessage: `查找命中 ${s.findMatches.length} 处（第 ${idx + 1} 处）`,
    });
  },

  findPrev: () => {
    const s = get();
    if (!s.findMatches.length) return;
    const idx = s.findIndex <= 0 ? s.findMatches.length - 1 : s.findIndex - 1;
    set({
      findIndex: idx,
      findNonce: s.findNonce + 1,
      statusMessage: `查找命中 ${s.findMatches.length} 处（第 ${idx + 1} 处）`,
    });
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

/** 找出所有匹配位置（字符偏移） */
function findAll(text: string, query: string, caseSensitive: boolean): number[] {
  if (!query) return [];
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: number[] = [];
  let from = 0;
  while (out.length < 5000) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1) break;
    out.push(idx);
    from = idx + Math.max(1, needle.length);
  }
  return out;
}
