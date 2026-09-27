// Tauri invoke 封装；浏览器环境（vite dev 无 Tauri）自动降级为 JS 实现。

import { invoke } from "@tauri-apps/api/core";
import { SUPPORTED_EXTS } from "./types";
import type {
  FilePayload,
  IntegrationStatus,
  ParseMode,
  ParseResult,
  Settings,
  FlatNode,
  NodeKind,
} from "./types";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// ============ 浏览器降级实现 ============

function valueToNodes(
  value: unknown,
  path: string,
  key: string | null,
  depth: number,
  parent: number | null,
  nodes: FlatNode[],
  counter: { id: number }
): void {
  const kindOf = (v: unknown): NodeKind =>
    v === null
      ? "null"
      : Array.isArray(v)
        ? "array"
        : typeof v === "object"
          ? "object"
          : typeof v === "string"
            ? "string"
            : typeof v === "number"
              ? "number"
              : "boolean";

  const kind = kindOf(value);
  const id = counter.id++;
  const childCount =
    kind === "object"
      ? Object.keys(value as object).length
      : kind === "array"
        ? (value as unknown[]).length
        : 0;
  const display =
    kind === "object"
      ? childCount === 0
        ? "{}"
        : `{ ${Object.keys(value as object).slice(0, 3).join(", ")}${childCount > 3 ? ` … +${childCount - 3}` : ""} }`
      : kind === "array"
        ? childCount === 0
          ? "[]"
          : `[ ${childCount} 项 ]`
        : kind === "string"
          ? JSON.stringify(value)
          : String(value);
  nodes.push({
    id,
    path,
    key,
    value: display,
    kind,
    depth,
    has_children: childCount > 0,
    child_count: childCount,
    offset: null,
    parent,
  });
  if (kind === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // 与 Rust 端 escape_key 一致：非法标识符键用 ['...']，单引号转义
      const childPath = /^[A-Za-z_$][\w$]*$/.test(k)
        ? `${path}.${k}`
        : `${path}['${k.replace(/'/g, "\\'")}']`;
      valueToNodes(v, childPath, k, depth + 1, id, nodes, counter);
    }
  } else if (kind === "array") {
    (value as unknown[]).forEach((v, idx) => {
      valueToNodes(v, `${path}[${idx}]`, String(idx), depth + 1, id, nodes, counter);
    });
  }
}

/** 与 Rust 端 strip_jsonc 同构：注释替换为空格（保留换行/列位置）+ 移除尾逗号 */
function stripJsonc(text: string): string {
  const chars = Array.from(text);
  // 第一遍：注释 → 空格（换行保留）
  let out: string[] = [];
  let i = 0;
  let inString = false;
  let escaped = false;
  while (i < chars.length) {
    const c = chars[i];
    if (inString) {
      out.push(c);
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      out.push(c);
      i += 1;
    } else if (c === "/" && chars[i + 1] === "/") {
      while (i < chars.length && chars[i] !== "\n") {
        out.push(" ");
        i += 1;
      }
    } else if (c === "/" && chars[i + 1] === "*") {
      while (i < chars.length) {
        if (chars[i] === "*" && chars[i + 1] === "/") {
          out.push(" ", " ");
          i += 2;
          break;
        }
        out.push(chars[i] === "\n" ? "\n" : " ");
        i += 1;
      }
    } else {
      out.push(c);
      i += 1;
    }
  }
  // 第二遍：移除尾逗号
  const result: string[] = [];
  i = 0;
  inString = false;
  escaped = false;
  // 上一个非空白有效字符：只删除「值后尾逗号」，`"key": ,` 保持原样
  let lastSig: string | null = null;
  const isValueEnd = (c: string | null) =>
    c === '"' || c === "}" || c === "]" || c === "e" || c === "l" || (c !== null && /\d/.test(c));
  while (i < out.length) {
    const c = out[i];
    if (inString) {
      result.push(c);
      if (!/\s/.test(c)) lastSig = c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      result.push(c);
      lastSig = c;
      i += 1;
    } else if (c === ",") {
      result.push(c);
      i += 1;
      let j = i;
      while (j < out.length && /\s/.test(out[j])) j += 1;
      const after = j < out.length && (out[j] === "}" || out[j] === "]");
      if (after && isValueEnd(lastSig)) result.pop();
      else lastSig = ",";
    } else {
      result.push(c);
      if (!/\s/.test(c)) lastSig = c;
      i += 1;
    }
  }
  return result.join("");
}

function fallbackParse(text: string, mode: ParseMode): ParseResult {
  const started = performance.now();
  const nodes: FlatNode[] = [];
  const diagnostics: ParseResult["diagnostics"] = [];
  let parsed: unknown = null;
  // ok 区分「解析成功但值就是 null」与「解析失败」
  let ok = false;
  const effective = mode === "jsonc" ? stripJsonc(text) : text;

  if (mode === "jsonl") {
    const values: unknown[] = [];
    text.split(/\r?\n/).forEach((line, idx) => {
      const t = line.trim();
      if (!t) return;
      try {
        values.push(JSON.parse(t));
      } catch (e) {
        diagnostics.push({
          severity: "error",
          message: `第 ${idx + 1} 行解析失败: ${(e as Error).message}`,
          line: idx + 1,
          column: 1,
          offset: 0,
          snippet: t.slice(0, 120),
        });
      }
    });
    parsed = values;
    ok = true;
  } else {
    try {
      parsed = JSON.parse(effective);
      ok = true;
    } catch (e) {
      const msg = (e as Error).message;
      const posMatch = /at position (\d+)/.exec(msg);
      const pos = posMatch ? Number(posMatch[1]) : 0;
      const before = effective.slice(0, pos);
      const line = before.split("\n").length;
      const column = pos - before.lastIndexOf("\n");
      diagnostics.push({
        severity: "error",
        message: `JSON 解析错误: ${msg}`,
        line,
        column,
        offset: pos,
        snippet: effective.split("\n")[line - 1]?.slice(0, 160) ?? null,
      });
    }
  }

  if (ok) {
    if (mode === "jsonl") {
      // 与 Rust 端一致：JSONL 合成为根数组
      const values = (parsed as unknown[]) ?? [];
      nodes.push({
        id: 0,
        path: "root",
        key: null,
        value: `[ ${values.length} 项 ]`,
        kind: "array",
        depth: 0,
        has_children: values.length > 0,
        child_count: values.length,
        offset: null,
        parent: null,
      });
      values.forEach((v, idx) => {
        valueToNodes(v, `root[${idx}]`, String(idx), 1, 0, nodes, { id: nodes.length });
      });
    } else {
      valueToNodes(parsed, "root", null, 0, null, nodes, { id: 0 });
    }
  }

  const count = (kind: NodeKind) => nodes.filter((n) => n.kind === kind).length;
  return {
    nodes,
    diagnostics,
    stats: {
      total_nodes: nodes.length,
      max_depth: nodes.reduce((m, n) => Math.max(m, n.depth), 0),
      object_count: count("object"),
      array_count: count("array"),
      string_count: count("string"),
      number_count: count("number"),
      bool_count: count("boolean"),
      null_count: count("null"),
      elapsed_ms: Math.round(performance.now() - started),
      byte_size: new Blob([text]).size,
    },
    table_candidate:
      nodes.length > 0 &&
      nodes[0].kind === "array" &&
      nodes[0].child_count > 0 &&
      nodes.filter((n) => n.parent === 0).every((n) => n.kind === "object"),
    line_values: [],
  };
}

// ============ 命令封装 ============

export async function parseJson(text: string, mode: ParseMode): Promise<ParseResult> {
  if (!isTauri()) return fallbackParse(text, mode);
  return invoke<ParseResult>("parse_json", { text, mode });
}

export const formatJson = (text: string, indent: string, mode: ParseMode): Promise<string> =>
  isTauri() ? invoke("format_json", { text, indent, mode }) : Promise.resolve(text);

export const minifyJson = (text: string, mode: ParseMode): Promise<string> =>
  isTauri() ? invoke("minify_json", { text, mode }) : Promise.resolve(text);

export const sortKeysJson = (text: string, indent: string, mode: ParseMode): Promise<string> =>
  isTauri() ? invoke("sort_keys_json", { text, indent, mode }) : Promise.resolve(text);

export const queryJson = (text: string, expr: string, mode: ParseMode): Promise<string[]> =>
  isTauri() ? invoke("query_json", { text, expr, mode }) : Promise.resolve([]);

export const readFileText = (path: string): Promise<FilePayload> =>
  isTauri() ? invoke("read_file_text", { path }) : Promise.reject("仅桌面版支持");

export const writeFileText = (path: string, text: string): Promise<void> =>
  isTauri() ? invoke("write_file_text", { path, text }) : Promise.reject("仅桌面版支持");

/** 另存为对话框；取消返回 null */
export async function saveFileDialog(defaultName?: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: defaultName,
    filters: [
      { name: "支持的文件", extensions: [...SUPPORTED_EXTS] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  return typeof path === "string" ? path : null;
}

export const getSettings = (): Promise<Settings> =>
  isTauri() ? invoke("get_settings") : Promise.resolve({ ...browserSettings });

export const updateSettings = (patch: Partial<Settings>): Promise<Settings> => {
  if (isTauri()) return invoke("update_settings", { patch });
  // 浏览器降级：内存合并，保证 recentFiles 等本地状态可写
  Object.assign(browserSettings, patch);
  return Promise.resolve({ ...browserSettings });
};

export const getFileMtime = (path: string): Promise<number | null> =>
  isTauri() ? invoke("get_file_mtime", { path }) : Promise.resolve(null);

/** 取启动时命令行传入的文件路径（文件关联打开；只返回一次） */
export const takeStartupFile = (): Promise<string | null> =>
  isTauri() ? invoke("take_startup_file") : Promise.resolve(null);

export const integrationStatus = (): Promise<IntegrationStatus> =>
  isTauri()
    ? invoke("integration_status")
    : Promise.resolve({ context_menu: [], file_assoc: [], autostart: false, managed_key_count: 0 });

export const installContextMenu = (targets: string[]): Promise<string[]> =>
  invoke("install_context_menu", { targets });

export const uninstallContextMenu = (): Promise<string[]> =>
  invoke("uninstall_context_menu");

export const registerFileAssociations = (exts: string[]): Promise<string[]> =>
  invoke("register_file_associations", { exts });

export const unregisterFileAssociations = (exts: string[]): Promise<string[]> =>
  invoke("unregister_file_associations", { exts });

export const setAutostart = (enabled: boolean, minimized: boolean): Promise<void> =>
  invoke("set_autostart", { enabled, minimized });

export const openDefaultAppsSettings = (): Promise<void> =>
  invoke("open_default_apps_settings");

export const cleanupIntegration = (): Promise<IntegrationStatus> =>
  invoke("cleanup_system_integration");

export function defaultSettings(): Settings {
  return {
    theme: "system",
    indent: "2",
    fontSize: 14,
    startup: "blank",
    watchFile: true,
    mica: true,
    contextMenuTargets: ["json_files"],
    // 默认注册全部支持的扩展名（与 Rust 端默认值一致）
    associatedExtensions: [...SUPPORTED_EXTS],
    autostart: false,
    autostartMinimized: true,
    recentFiles: [],
  };
}

/** 浏览器降级用的内存设置（无持久化） */
const browserSettings: Settings = defaultSettings();

/** 打开文件选择器（Tauri 原生对话框 / 浏览器降级） */
export async function openFilePicker(): Promise<FilePayload | null> {
  const exts = [
    "json",
    "jsonc",
    "jsonl",
    "ndjson",
    "har",
    "geojson",
    "md",
    "markdown",
    "ini",
    "cfg",
    "conf",
    "txt",
    "log",
  ];
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      multiple: false,
      filters: [
        { name: "支持的文件", extensions: exts },
        { name: "JSON 文件", extensions: ["json", "jsonc", "jsonl", "ndjson", "har", "geojson"] },
        { name: "文本 / 配置 / 文档", extensions: ["md", "markdown", "ini", "cfg", "conf", "txt", "log"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (typeof path === "string") return readFileText(path);
    return null;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = exts.map((e) => `.${e}`).join(",");
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const text = await file.text();
      resolve({ path: file.name, text, size: file.size, truncated: false });
    };
    // 用户取消选择时也要结束 Promise，避免调用方永久挂起
    input.oncancel = () => resolve(null);
    input.click();
  });
}
