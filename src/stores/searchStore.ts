// 搜索扩展状态：查找/替换历史、文件夹搜索、底部搜索结果面板

import { create } from "zustand";
import { pickFolder, replaceInFiles, searchInFolder } from "../lib/api";
import { useJsonStore } from "./jsonStore";
import type { SearchHit } from "../lib/types";

const FIND_HISTORY_KEY = "fileview.find.history";
const REPLACE_HISTORY_KEY = "fileview.replace.history";
/** 历史保留条数 */
const MAX_HISTORY = 30;
/** 底部结果面板默认高度 */
export const RESULTS_PANEL_HEIGHT = 220;

function loadHistory(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function saveHistory(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // 存储不可用（隐私模式 / 配额满）：忽略，不影响搜索功能
  }
}

/** 记录一条历史：去重、最新的在前 */
function pushHistory(list: string[], value: string): string[] {
  if (!value.trim()) return list;
  const next = [value, ...list.filter((x) => x !== value)].slice(0, MAX_HISTORY);
  return next;
}

interface SearchState {
  /** 查找历史（最新在前） */
  findHistory: string[];
  /** 替换历史（最新在前） */
  replaceHistory: string[];
  pushFindHistory: (q: string) => void;
  pushReplaceHistory: (q: string) => void;
  clearFindHistory: () => void;

  /** 文件夹搜索的根目录 */
  folderRoot: string | null;
  /** 文件夹搜索使用的查询词 */
  folderQuery: string;
  /** 是否正在扫描 */
  folderSearching: boolean;
  /** 命中的文件列表 */
  folderHits: SearchHit[];
  /** 已扫描文件数 */
  folderScanned: number;
  /** 被跳过的文件数 */
  folderSkipped: number;
  /** 是否因命中上限提前结束 */
  folderTruncated: boolean;
  /** 错误信息 */
  folderError: string | null;
  /** 在文件夹中搜索（不传 root 时弹出目录选择框） */
  searchFolder: (root?: string) => Promise<void>;
  /** 清空文件夹搜索结果 */
  clearFolderSearch: () => void;
  /** 对搜索命中的文件批量替换 */
  replaceInSearchedFiles: (replacement: string) => Promise<number>;

  /** 底部结果面板是否展开 */
  resultsOpen: boolean;
  /** 底部结果面板高度 */
  resultsHeight: number;
  setResultsOpen: (open: boolean) => void;
  setResultsHeight: (h: number) => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  findHistory: loadHistory(FIND_HISTORY_KEY),
  replaceHistory: loadHistory(REPLACE_HISTORY_KEY),

  pushFindHistory: (q) => {
    const next = pushHistory(get().findHistory, q);
    saveHistory(FIND_HISTORY_KEY, next);
    set({ findHistory: next });
  },

  pushReplaceHistory: (q) => {
    const next = pushHistory(get().replaceHistory, q);
    saveHistory(REPLACE_HISTORY_KEY, next);
    set({ replaceHistory: next });
  },

  clearFindHistory: () => {
    saveHistory(FIND_HISTORY_KEY, []);
    set({ findHistory: [] });
  },

  folderRoot: null,
  folderQuery: "",
  folderSearching: false,
  folderHits: [],
  folderScanned: 0,
  folderSkipped: 0,
  folderTruncated: false,
  folderError: null,

  searchFolder: async (root) => {
    const target = root ?? (await pickFolder());
    if (!target) return;
    const { findQuery, findCaseSensitive } = useJsonStore.getState();
    if (!findQuery.trim()) {
      set({ folderError: "请先输入查找内容", folderSearching: false });
      useJsonStore.getState().setStatus("在文件夹中搜索前请先输入查找内容");
      return;
    }
    set({
      folderRoot: target,
      folderQuery: findQuery,
      folderSearching: true,
      folderError: null,
      folderHits: [],
    });
    try {
      const result = await searchInFolder(target, findQuery, findCaseSensitive, false);
      set({
        folderHits: result.hits,
        folderScanned: result.scanned_files,
        folderSkipped: result.skipped_files,
        folderTruncated: result.truncated,
        folderSearching: false,
        resultsOpen: true,
      });
      useJsonStore
        .getState()
        .setStatus(
          `在 ${target} 中找到 ${result.hits.length} 处（扫描 ${result.scanned_files} 个文件）`
        );
    } catch (e) {
      set({ folderSearching: false, folderError: String(e) });
    }
  },

  clearFolderSearch: () =>
    set({
      folderRoot: null,
      folderQuery: "",
      folderHits: [],
      folderScanned: 0,
      folderSkipped: 0,
      folderTruncated: false,
      folderError: null,
    }),

  replaceInSearchedFiles: async (replacement) => {
    const { folderHits, folderQuery } = get();
    if (!folderQuery) return 0;
    const paths = [...new Set(folderHits.map((h) => h.path))];
    if (!paths.length) return 0;
    const { findCaseSensitive } = useJsonStore.getState();
    const result = await replaceInFiles(paths, folderQuery, replacement, findCaseSensitive);
    useJsonStore
      .getState()
      .setStatus(`已替换 ${result.replaced} 处（${result.changed_files} 个文件）`);
    // 重新扫描，结果面板刷新
    if (get().folderRoot) await get().searchFolder(get().folderRoot ?? undefined);
    return result.replaced;
  },

  resultsOpen: false,
  resultsHeight: RESULTS_PANEL_HEIGHT,

  setResultsOpen: (open) => set({ resultsOpen: open }),
  setResultsHeight: (h) => set({ resultsHeight: Math.max(120, Math.min(720, h)) }),
}));
