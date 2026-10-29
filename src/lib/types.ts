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

/** 文件大类：决定可用视图、解析方式与高亮 */
export type FileKind =
  | "json"
  | "markdown"
  | "ini"
  | "yaml"
  | "toml"
  | "csv"
  | "xml"
  | "html"
  | "code"
  | "text";

/** 通用代码家族（C 风格语法） */
export type CodeLang =
  | "javascript"
  | "typescript"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "csharp"
  | "cpp"
  | "kotlin"
  | "swift"
  | "php"
  | "ruby"
  | "shell"
  | "powershell"
  | "sql"
  | "lua"
  | "dart"
  | "css"
  | "perl"
  | "r"
  | "plain";

/** 高亮语言 */
export type Lang =
  | "json"
  | "markdown"
  | "ini"
  | "yaml"
  | "toml"
  | "csv"
  | "xml"
  | "html"
  | "log"
  | "text"
  | CodeLang;

/** 查看器视图（跨文件类型的并集） */
export type ViewMode = "tree" | "table" | "raw" | "preview" | "structure";

/** 扩展名 → 文件大类 */
const EXT_KIND: Record<string, FileKind> = {
  // JSON 家族
  json: "json",
  jsonc: "json",
  json5: "json",
  jsonl: "json",
  ndjson: "json",
  har: "json",
  geojson: "json",
  webmanifest: "json",
  // 文档
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  txt: "text",
  text: "text",
  log: "text",
  // 配置
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  config: "ini",
  properties: "ini",
  props: "ini",
  env: "ini",
  editorconfig: "ini",
  gitignore: "ini",
  npmrc: "ini",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  // 数据
  csv: "csv",
  tsv: "csv",
  // 标记
  xml: "xml",
  svg: "xml",
  html: "html",
  htm: "html",
  xhtml: "html",
  vue: "html",
  svelte: "html",
  // 代码
  css: "code",
  scss: "code",
  less: "code",
  js: "code",
  mjs: "code",
  cjs: "code",
  jsx: "code",
  ts: "code",
  tsx: "code",
  py: "code",
  rb: "code",
  php: "code",
  java: "code",
  kt: "code",
  kts: "code",
  swift: "code",
  rs: "code",
  go: "code",
  c: "code",
  h: "code",
  cpp: "code",
  cc: "code",
  cxx: "code",
  hpp: "code",
  cs: "code",
  lua: "code",
  pl: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  ps1: "code",
  bat: "code",
  cmd: "code",
  sql: "code",
  dart: "code",
  scala: "code",
  r: "code",
};

/** 扩展名 → 高亮语言（比大类更细） */
const EXT_LANG: Record<string, Lang> = {
  json: "json",
  jsonc: "json",
  json5: "json",
  jsonl: "json",
  ndjson: "json",
  har: "json",
  geojson: "json",
  webmanifest: "json",
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  config: "ini",
  properties: "ini",
  props: "ini",
  env: "ini",
  editorconfig: "ini",
  gitignore: "ini",
  npmrc: "ini",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  csv: "csv",
  tsv: "csv",
  xml: "xml",
  svg: "xml",
  html: "html",
  htm: "html",
  xhtml: "html",
  vue: "html",
  svelte: "html",
  log: "log",
  css: "css",
  scss: "css",
  less: "css",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  php: "php",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  rs: "rust",
  go: "go",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  lua: "lua",
  pl: "perl",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ps1: "powershell",
  bat: "shell",
  cmd: "shell",
  sql: "sql",
  dart: "dart",
  scala: "java",
  r: "r",
};

/** 支持注册文件关联的扩展名（与 Rust 端 SUPPORTED_EXTS 一致） */
export const SUPPORTED_EXTS: string[] = Object.keys(EXT_KIND);

/** 文件关联分组（设置页分组展示） */
export const EXT_GROUPS: { label: string; exts: string[] }[] = [
  {
    label: "JSON 家族",
    exts: ["json", "jsonc", "json5", "jsonl", "ndjson", "har", "geojson", "webmanifest"],
  },
  { label: "文档与文本", exts: ["md", "markdown", "mdown", "txt", "text", "log"] },
  {
    label: "配置",
    exts: [
      "ini",
      "cfg",
      "conf",
      "config",
      "properties",
      "props",
      "env",
      "editorconfig",
      "gitignore",
      "npmrc",
      "yaml",
      "yml",
      "toml",
    ],
  },
  { label: "数据", exts: ["csv", "tsv"] },
  { label: "标记语言", exts: ["xml", "svg", "html", "htm", "xhtml", "vue", "svelte"] },
  {
    label: "前端",
    exts: ["css", "scss", "less", "js", "mjs", "cjs", "jsx", "ts", "tsx"],
  },
  {
    label: "脚本与后端",
    exts: [
      "py",
      "rb",
      "php",
      "java",
      "kt",
      "kts",
      "swift",
      "rs",
      "go",
      "c",
      "h",
      "cpp",
      "cc",
      "cxx",
      "hpp",
      "cs",
      "lua",
      "pl",
      "dart",
      "scala",
      "r",
    ],
  },
  { label: "脚本与数据库", exts: ["sh", "bash", "zsh", "ps1", "bat", "cmd", "sql"] },
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

/** 高亮语言（按扩展名细分，未知扩展名按纯文本） */
export function langFromPath(path: string | null): Lang {
  if (!path) return "json";
  const ext = extOf(path);
  if (!ext) return "text";
  return EXT_LANG[ext] ?? "text";
}

export function kindLabel(kind: FileKind): string {
  switch (kind) {
    case "json":
      return "JSON";
    case "markdown":
      return "Markdown";
    case "ini":
      return "INI 配置";
    case "yaml":
      return "YAML";
    case "toml":
      return "TOML";
    case "csv":
      return "CSV 表格";
    case "xml":
      return "XML";
    case "html":
      return "HTML";
    case "code":
      return "源代码";
    default:
      return "文本";
  }
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
    case "yaml":
    case "toml":
      return [
        { value: "structure", label: "结构", icon: "folder" },
        { value: "raw", label: "源码", icon: "code" },
      ];
    case "csv":
      return [
        { value: "table", label: "表格", icon: "table" },
        { value: "raw", label: "源码", icon: "code" },
      ];
    case "xml":
      return [
        { value: "structure", label: "结构", icon: "folder" },
        { value: "raw", label: "源码", icon: "code" },
      ];
    case "html":
      return [
        { value: "preview", label: "预览", icon: "file" },
        { value: "raw", label: "源码", icon: "code" },
      ];
    case "code":
      return [
        { value: "structure", label: "大纲", icon: "tree" },
        { value: "raw", label: "源码", icon: "code" },
      ];
    default:
      return [{ value: "raw", label: "文本", icon: "code" }];
  }
}

/** 默认标签页：Markdown/HTML → 预览，配置类 → 结构，CSV → 表格，JSON → 树形，其余 → 源码 */
export function defaultViewFor(kind: FileKind): ViewMode {
  switch (kind) {
    case "json":
      return "tree";
    case "markdown":
    case "html":
      return "preview";
    case "ini":
    case "yaml":
    case "toml":
    case "xml":
      return "structure";
    case "csv":
      return "table";
    case "code":
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
