// 与 Rust 后端 serde 结构镜像的共享类型

export type NodeKind = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface FlatNode {
  id: number;
  path: string;
  key: string | null;
  value: string;
  kind: NodeKind;
  depth: number;
  has_children: boolean;
  child_count: number;
  offset: number | null;
  parent: number | null;
}

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  offset: number;
  snippet: string | null;
}

export interface ParseStats {
  total_nodes: number;
  max_depth: number;
  object_count: number;
  array_count: number;
  string_count: number;
  number_count: number;
  bool_count: number;
  null_count: number;
  elapsed_ms: number;
  byte_size: number;
}

export interface ParseResult {
  nodes: FlatNode[];
  diagnostics: Diagnostic[];
  stats: ParseStats;
  table_candidate: boolean;
  line_values: [number, number][];
}

export type ParseMode = "strict" | "jsonc" | "jsonl";

/** 文件大类：决定可用视图与解析方式 */
export type FileKind = "json" | "markdown" | "ini" | "text";

/** 查看器视图（跨文件类型的并集） */
export type ViewMode = "tree" | "table" | "raw" | "preview" | "structure";

/** 高亮语言 */
export type Lang = "json" | "markdown" | "ini" | "log" | "text";

const EXT_KIND: Record<string, FileKind> = {
  json: "json",
  jsonc: "json",
  jsonl: "json",
  ndjson: "json",
  har: "json",
  geojson: "json",
  md: "markdown",
  markdown: "markdown",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  txt: "text",
  text: "text",
  log: "text",
};

/** 支持注册文件关联的扩展名（与 Rust 端 SUPPORTED_EXTS 一致） */
export const SUPPORTED_EXTS: string[] = [
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

function extOf(path: string | null): string | null {
  if (!path) return null;
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : null;
}

/** 按扩展名判定文件大类；未命名标签页按 JSON（粘贴解析是主场景），其余未知扩展名按纯文本 */
export function kindFromPath(path: string | null): FileKind {
  if (!path) return "json";
  const ext = extOf(path);
  return (ext && EXT_KIND[ext]) || "text";
}

/** 高亮语言（.log 在文本大类下单独高亮） */
export function langFromPath(path: string | null): Lang {
  if (!path) return "json";
  const ext = extOf(path);
  if (ext === "log") return "log";
  const kind = kindFromPath(path);
  return kind === "json" ? "json" : kind === "markdown" ? "markdown" : kind === "ini" ? "ini" : "text";
}

export function kindLabel(kind: FileKind): string {
  return kind === "json" ? "JSON" : kind === "markdown" ? "Markdown" : kind === "ini" ? "INI 配置" : "文本";
}

/** 每种文件大类可用的查看器标签页 */
export function viewsFor(kind: FileKind): { value: ViewMode; label: string; icon: string }[] {
  switch (kind) {
    case "json":
      return [
        { value: "tree", label: "树形", icon: "tree" },
        { value: "table", label: "表格", icon: "table" },
        { value: "raw", label: "原始", icon: "code" },
      ];
    case "markdown":
      return [
        { value: "preview", label: "预览", icon: "file" },
        { value: "raw", label: "源码", icon: "code" },
      ];
    case "ini":
      return [
        { value: "structure", label: "结构", icon: "folder" },
        { value: "raw", label: "源码", icon: "code" },
      ];
    default:
      return [{ value: "raw", label: "文本", icon: "code" }];
  }
}

/** 默认标签页：Markdown → 预览，INI → 结构，其余 → 源码/文本；JSON → 树形 */
export function defaultViewFor(kind: FileKind): ViewMode {
  switch (kind) {
    case "json":
      return "tree";
    case "markdown":
      return "preview";
    case "ini":
      return "structure";
    default:
      return "raw";
  }
}

/** 当前视图对某文件大类是否有效，无效则回落到默认 */
export function resolveView(view: ViewMode, kind: FileKind): ViewMode {
  return viewsFor(kind).some((v) => v.value === view) ? view : defaultViewFor(kind);
}

export interface Settings {
  theme: string; // light | dark | system
  indent: string; // 2 | 4 | tab
  fontSize: number;
  startup: string; // blank | last | recent
  watchFile: boolean;
  mica: boolean;
  contextMenuTargets: string[];
  associatedExtensions: string[];
  autostart: boolean;
  autostartMinimized: boolean;
  recentFiles: string[];
}

export interface IntegrationStatus {
  context_menu: [string, boolean][];
  file_assoc: [string, boolean][];
  autostart: boolean;
  managed_key_count: number;
}

export interface FilePayload {
  path: string;
  text: string;
  size: number;
  truncated: boolean;
}

export interface Tab {
  id: number;
  name: string;
  path: string | null;
  text: string;
}

export const MENU_TARGETS: { id: string; label: string; desc: string }[] = [
  { id: "all_files", label: "所有文件", desc: "任意文件的右键菜单" },
  { id: "json_files", label: "JSON 文件", desc: "*.json 文件" },
  { id: "jsonl_files", label: "JSONL 文件", desc: "*.jsonl / *.ndjson 文件" },
  { id: "folders", label: "文件夹", desc: "文件夹右键菜单" },
  { id: "directory_bg", label: "目录空白处", desc: "文件夹背景右键菜单" },
];
