# JSON Viewer — 设计计划（Rust + React + Vite + Tailwind CSS / Windows 11 风格）

> 目标：一款 Windows 11 原生风格的桌面 JSON 解析与查看器。
> 技术栈：**Tauri 2（Rust 后端）+ React 18 + Vite + Tailwind CSS**，设置页包含
> **Windows 右键菜单注入、默认文件关联（默认打开方式）** 等系统集成功能。

---

## 1. 产品定位与核心功能

| 类别 | 功能 |
|---|---|
| 查看 | 三种视图：**树形视图**（可折叠）/ **表格视图**（数组 of objects 自动转表）/ **原始文本**（语法高亮） |
| 解析 | 严格 JSON 校验 + 错误定位（行列号、错误摘要、出错片段高亮）；支持 JSONC / JSON5 / JSONL(NDJSON) 可选宽容模式 |
| 查询 | 全文搜索（键/值/路径）、JSONPath 过滤、类型筛选（仅显示 string/number/…）、路径面包屑 |
| 编辑 | 文本编辑（高亮 + 行号 + 括号匹配）、格式化（缩进 2/4/Tab）、压缩 minify、键排序、注释剥离 |
| 转换 | 导出 CSV / YAML / TOML / XML；复制为 JS/Python 字面量；JSON ↔ 字符串转义 |
| 文件 | 拖拽打开、多标签页、最近文件、监视文件变化自动重载、大文件支持（≥100MB 流式解析） |
| 系统集成 | 右键菜单「用 JSON Viewer 打开」、默认打开方式（.json 等）、开机自启、跳转列表（最近文件） |

---

## 2. 技术选型与总体架构

```
┌────────────────────────────────────────────────────────┐
│  前端 WebView2 (React 18 + Vite + Tailwind CSS)         │
│  - Fluent/WinUI 3 风格组件层（自研 + tailwindcss-fluent）│
│  - 虚拟滚动 (react-window / @tanstack/virtual)           │
│  - 状态: Zustand；编辑器: CodeMirror 6                   │
└──────────────▲─────────────────────────┬───────────────┘
        Tauri Commands (invoke)     events (emit/listen)
┌──────────────┴─────────────────────────▼───────────────┐
│  Rust 后端 (Tauri 2)                                    │
│  - json_core: 解析/格式化/查询/流式读取                  │
│  - sys_integration: 注册表、文件关联、右键菜单、自启      │
│  - settings: 配置持久化 (tauri-plugin-store)             │
└────────────────────────────────────────────────────────┘
                          │
              Windows API / winreg / windows crate
```

**关键决策**

1. **Tauri 2 而非 Electron**：安装包 ~5MB、内存占用低、Rust 直接调 Windows API 做注册表/右键菜单注入，无需额外原生模块。
2. **MSIX（sparse package）+ NSIS 双分发**：MSIX 获得 Windows 11 新版右键菜单（顶级菜单）与干净卸载；NSIS 版用注册表注入进「显示更多选项」经典菜单。
3. **大文件策略**：Rust 侧流式/分块解析 + 前端虚拟滚动，JSON 文本永不整段进 DOM。

### 主要 crate / 依赖

| 层 | 依赖 |
|---|---|
| Rust | `tauri 2`, `serde`, `serde_json`, `serde_json_path`（JSONPath）, `jsonc-parser`（宽容模式）, `winreg`, `windows`（注册表/文件关联/IExplorerCommand）, `tauri-plugin-store`, `tauri-plugin-dialog`, `tauri-plugin-opener`, `rayon`（并行格式化/排序） |
| 前端 | `react 18`, `vite 5`, `tailwindcss 3/4`, `zustand`, `@tanstack/react-virtual`, `codemirror 6`, `prismjs`/`shiki`（高亮）, `clsx` |

---

## 3. 目录结构

```
json-viewer/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs / lib.rs
│   │   ├── commands/           # Tauri 命令层
│   │   │   ├── json.rs         # parse / format / minify / query / validate
│   │   │   ├── file.rs         # 打开、分块读取、监视、最近文件
│   │   │   └── settings.rs     # 读写设置、系统集成开关
│   │   ├── core/               # 纯 Rust 业务（可单测）
│   │   │   ├── parser.rs       # 解析 + 错误诊断结构
│   │   │   ├── formatter.rs
│   │   │   ├── query.rs        # JSONPath、搜索
│   │   │   └── convert.rs      # CSV/YAML/XML 导出
│   │   ├── sys/                # 系统集成（本计划重点）
│   │   │   ├── registry.rs     # winreg 封装
│   │   │   ├── context_menu.rs # 右键菜单注入/移除
│   │   │   ├── file_assoc.rs   # 默认打开方式/ProgID
│   │   │   └── autostart.rs
│   │   └── error.rs
│   ├── tauri.conf.json
│   ├── capabilities/           # Tauri 2 权限声明
│   └── icons/
├── src/                        # 前端
│   ├── app/                    # 布局、路由（仅 主界面/设置 两页）
│   ├── features/
│   │   ├── viewer/             # TreeView / TableView / RawView
│   │   ├── editor/
│   │   ├── search/
│   │   └── settings/           # 设置页（第 5 节）
│   ├── components/ui/          # WinUI 风格基础组件
│   │   ├── NavView.tsx  Card.tsx  ToggleSwitch.tsx
│   │   ├── ComboBox.tsx Slider.tsx  Button.tsx  Breadcrumb.tsx
│   │   └── TitleBar.tsx        # 自定义标题栏 + Mica
│   ├── stores/                 # zustand: tabsStore, jsonStore, settingsStore
│   └── styles/                 # tailwind 入口、fluent 变量、主题
├── docs/DESIGN-PLAN.md
└── package.json / vite.config.ts / tailwind.config.ts
```

---

## 4. 核心功能设计要点

### 4.1 解析与错误诊断
- Rust `serde_json` 严格解析失败时返回结构化错误：`{ line, column, offset, message, snippet }`；前端在 Raw 视图标注红色波浪线 + 底部错误面板，点击跳转。
- 宽容模式（JSONC/JSON5/JSONL）：先剥离注释 / 按行解析，逐行给出错误而不整体失败。
- 解析结果生成**扁平节点表** `(path, key, value, type, depth, childIndex)`，树/表/搜索共用一份数据，O(1) 路径定位。

### 4.2 大文件与性能
- 前端只持有虚拟 DOM 行；`@tanstack/react-virtual` 渲染树节点（折叠子树不进入列表）。
- >20MB 文件：Rust 分块读取 + 后台解析，`emit` 进度事件，UI 显示进度条并禁用编辑。
- JSONPath 查询在 Rust 侧执行（`serde_json_path`），只回传命中的节点路径，前端高亮而非复制数据。

### 4.3 编辑器
- CodeMirror 6：行号、折叠、括号匹配、JSON 语法高亮、`Ctrl+Shift+F` 格式化、`Ctrl+S` 保存（写盘走 Rust，绕过 WebView 文件权限）。
- 树视图联动：选中树节点 ↔ 编辑器滚动并选中对应文本区间（用节点 offset 映射）。

---

## 5. UI/UX — Windows 11 (Fluent) 设计规范

### 5.1 视觉语言
- **材质**：窗口背景 `Mica`（`SetWindowCompositionAttribute` / `DwmSetWindowAttribute` 的 `DWMWA_SYSTEMBACKDROP_TYPE`），侧栏 `Acrylic`；Tailwind 用 CSS 变量映射 Fluent 颜色 token（`--smokeBackgroundPrimary` 等）。
- **字体**：`Segoe UI Variable`（正文 14px / 标题 20px / Caption 12px），JSON 代码用 `Cascadia Code`。
- **形状**：控件圆角 4px、卡片 8px、窗口 8px；8px 间距网格；1px 描边 + 极浅阴影。
- **动效**：200ms cubic-bezier(0.33,0,0.67,1)；导航选中指示条滑动；卡片 hover 抬升。
- **深浅色**：跟随系统 / 手动切换，全部颜色走 CSS 变量（`class` 策略 + `prefers-color-scheme`）。

### 5.2 主界面布局

```
┌──────────────────────────────────────────────────────────┐
│ ≡  JSON Viewer        [tab1.json][tab2.json][+]     ─ □ ✕ │  ← 自定义标题栏(Mica)
├───────────┬──────────────────────────────────────────────┤
│ 导航      │  路径: root › users[2] › name        🔍搜索   │
│  📂 文件   │  ┌────────────────────────────────────────┐  │
│  🌲 树形   │  │ ▼ root {…}                            │  │
│  📊 表格   │  │   ▼ users [3]                         │  │
│  {} 原始  │  │     ▼ 2 {…}                           │  │
│  🔎 查询   │  │         "name": "Alice"   ←选中高亮   │  │
│           │  └────────────────────────────────────────┘  │
│  ⚙ 设置   │  状态: ✓ 合法 · 12,480 节点 · 1.2MB · 35ms    │
└───────────┴──────────────────────────────────────────────┘
```

- 左侧 `NavigationView`（图标 + 文字，选中项 Fluent 涟漪 + 指示条）。
- 顶部分栏：视图切换（分段控件 SegmentedControl）、JSONPath 输入框、复制/格式化按钮组。
- 底部状态栏：解析状态、节点数、文件大小、解析耗时、光标 JSON 路径。

### 5.3 WinUI 风格组件清单（`components/ui/`）
`TitleBar` `NavigationView` `Card/SettingsCard` `ToggleSwitch` `ComboBox` `Slider` `Button`(accent/standard/subtle) `Breadcrumb` `Dialog/ContentDialog` `InfoBar` `ProgressBar` `Tooltip` `Tabs` `SegmentedControl`。
全部按 WinUI 3 视觉规范实现，Tailwind 类 + CSS 变量主题化。

---

## 6. 设置页设计（重点：系统集成）

### 6.1 信息架构（左侧二级导航或分组卡片流）

```
⚙ 设置
├── 外观        主题(浅/深/跟随系统) · 强调色 · 字号 · Mica/Acrylic 开关
├── 编辑器      默认缩进(2/4/Tab) · 自动格式化 · 保存时校验 · 等宽字体
├── 文件        启动时打开(空白/最近/上次会话) · 文件监视自动重载 · 大文件阈值
├── 系统集成 ★  ① 右键菜单注入  ② 默认打开方式  ③ 开机自启  ④ 跳转列表
├── 语言        简体中文 / English（i18next）
└── 关于        版本 · 更新 · 开源许可 · 重置所有设置
```

### 6.2 系统集成设置卡片（`settings/integration/`）

| 卡片 | UI 形态 | 后端行为（Rust `sys/`） |
|---|---|---|
| **右键菜单注入** | `ToggleSwitch`「在文件右键菜单中显示"用 JSON Viewer 打开"」+ 子项多选：所有文件 / *.json / *.jsonl / 文件夹 + 说明 `InfoBar`（Win11 新菜单需 MSIX 版） | 写 `HKCU\Software\Classes\*\shell\JsonViewer`：`MUIVerb`、`Icon`、`command` = `"app.exe" "%1"`；子项多选映射 `*\shell`、`Directory\shell`、`.json\shell`。注销时整键删除 |
| **默认打开方式** | 卡片列出 `.json .jsonl .ndjson .har .geojson .tsv?` 各自 `ToggleSwitch` + 当前默认程序徽标 + 按钮「在系统设置中选择默认应用」 | 1) 注册 ProgID：`HKCU\Software\Classes\JsonViewer.json`（含 `DefaultIcon`、`shell\open\command`）；2) `OpenWithProgids` 写入扩展名；3) **不伪造 UserChoice**（Windows 哈希保护，程序写入无效）——改为调起 `ms-settings:defaultapps` 或 `IApplicationAssociationRegistration` 让用户一键确认；MSIX 版由清单 `uap:FileTypeAssociation` 交系统处理 |
| **开机自启** | `ToggleSwitch` + 「最小化到托盘启动」子选项 | 写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` = `"JsonViewer" = "app.exe" --minimized`（免管理员） |
| **跳转列表/最近文件** | `ToggleSwitch`「在任务栏跳转列表显示最近文件」 | Tauri 集成 + 维护最近文件列表（store 持久化） |
| **右键菜单目标** | 复选：所有文件 / JSON 文件 / 文件夹 / 目录背景 | 控制注入的 `HKCR` 路径集合（见上） |
| **一键清理** | 按钮「移除全部系统集成」 | 统一调用 `sys::uninstall_all()`，删除本应用写入的全部注册表项 |

### 6.3 注册表操作设计（`sys/registry.rs`）

- **全部优先写 `HKCU`**（无需管理员/UAC）；仅当用户显式选择「为所有用户安装」才走 `HKLM/HKCR`（此时用 `requireAdministrator` 提权的辅助进程 `JsonViewer.Setup.exe` 完成，主进程不提权）。
- 每次注入前记录「写入清单」（键路径列表）存入 `HKCU\Software\JsonViewer\managed_keys`，保证移除/卸载时精准清理，不误删用户其他键。
- 读写用 `winreg` + `windows` crate；所有操作返回 `Result<T, SysError>`，前端以 `InfoBar` 呈现成功/失败/需要重启资源管理器。
- **即时生效**：注册/注销后调用 `SHChangeNotify(SHCNE_ASSOCCHANGED)` 刷新 Shell。

### 6.4 右键菜单在 Windows 11 的差异（关键风险点）

| 分发形态 | 右键菜单位置 | 实现 |
|---|---|---|
| NSIS/绿色版 | 「显示更多选项」经典菜单（Shift+F10） | 注册表 `*\shell\JsonViewer`（上文） |
| MSIX / sparse package | **新版紧凑右键菜单（顶级）** | 打包身份 + `IExplorerCommand` COM 类（Rust `windows` crate 实现），清单声明 `com:Extension` + `uap3:Extension`，激活走 COM 注册 |

设置页的 InfoBar 动态提示当前版本可注入的位置；MSIX 版提供「显示于：新版菜单/经典菜单/两者」单选。

### 6.5 设置持久化
- `tauri-plugin-store` → `%APPDATA%/com.jsonviewer.app/settings.json`；每次变更即时写盘；「重置」恢复默认并回滚系统集成。

---

## 7. Tauri Command 接口（前端 ↔ Rust 契约摘要）

```rust
// json.rs
parse_json(text, mode) -> ParseResult { nodes, errors, stats }
format_json(text, indent) -> String
minify_json(text) -> String
query_json_path(text, expr) -> Vec<NodePath>
validate(text, mode) -> Vec<Diagnostic>

// file.rs
open_file(path) -> FileInfo          // 大文件走 chunk 事件流
read_chunk(path, offset, len) -> String
watch_file(path) -> ()               // 变更 emit "file-changed"

// settings.rs / sys.rs
get_settings() -> Settings
set_settings(patch) -> ()
install_context_menu(targets: Vec<MenuTarget>) -> Result<()>
uninstall_context_menu() -> Result<()>
register_file_associations(exts: Vec<String>) -> Result<()>
set_autostart(enabled, args) -> Result<()>
open_default_apps_settings() -> ()   // ms-settings:defaultapps
```

---

## 8. 打包与分发

1. **NSIS 安装器**（Tauri bundler）：安装/卸载时调用 `sys::install_all()` / `uninstall_all()`，写右键菜单与 ProgID。
2. **MSIX 稀疏包**：签名（代码签名证书）后获得 Win11 顶级右键菜单 + 干净卸载 + 自动更新（或配 `tauri-plugin-updater`）。
3. CI：GitHub Actions `windows-latest` 矩阵构建 + 签名 + 生成安装包；MSIX 走 `MakeAppx` + `SignTool`。

---

## 9. 里程碑

| 里程碑 | 内容 | 产出 |
|---|---|---|
| **M1 脚手架**（1 周） | Tauri 2 + Vite + React + Tailwind 初始化；Fluent 主题 token、TitleBar/Mica、NavigationView、深浅色 | 可运行空壳 |
| **M2 核心查看**（2 周） | 解析/诊断、树/表/原始三视图、虚拟滚动、搜索、路径面包屑、拖拽/多标签 | 核心查看闭环 |
| **M3 编辑与转换**（1.5 周） | CodeMirror 编辑、格式化/压缩/排序、CSV/YAML 导出、文件监视 | 编辑闭环 |
| **M4 系统集成**（1.5 周） | 设置页全套；右键菜单注入/移除、文件关联与默认打开方式、开机自启、清理工具 | 设置页完成 |
| **M5 打磨发布**（1 周） | 大文件压测（≥100MB）、无障碍/键盘导航、i18n、NSIS/MSIX 打包、签名、更新通道 | v1.0 发布 |

---

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| Win11 新版右键菜单需打包身份（COM `IExplorerCommand`） | 双分发：NSIS 走经典菜单，MSIX 走顶级菜单；设置页如实提示 |
| Windows 禁止程序直接设置默认应用（UserChoice 哈希） | 只注册 ProgID + 引导系统设置页一键确认，不伪造 UserChoice |
| 注册表残留/误删 | 「写入清单」记录 managed keys；卸载与「一键清理」精准回滚 |
| 大文件撑爆 WebView 内存 | Rust 流式解析 + 虚拟滚动 + 超阈值只读模式 |
| Mica/Acrylic 在旧版 Win11 表现不一 | 降级为纯色 `SolidBackground`，设置里可关材质 |
| HKLM 操作触发 UAC | 默认仅 HKCU；全用户安装走独立提权辅助进程 |

---

## 11. 验收标准（v1.0）

1. 打开 100MB JSON 在 3s 内出首屏，滚动 60fps。
2. 三种视图 + 搜索 + JSONPath 全部可用，错误定位精确到行列。
3. 设置页可一键注入/移除右键菜单，资源管理器即时生效；移除后注册表无残留。
4. 可注册 .json/.jsonl 等关联，用户在系统「默认应用」中可一键设为默认。
5. 深浅色跟随系统，全键盘可达（Tab 焦点环为 Fluent 风格）。
