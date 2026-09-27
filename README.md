# JSON Viewer

Windows 11 Fluent 风格的 JSON 解析与查看器。
技术栈：**Tauri 2 (Rust) + React 18 + Vite + Tailwind CSS**。

## 功能

- **三视图**：树形（折叠/展开、虚拟滚动）、表格（对象数组自动转表）、原始（语法高亮 + 行号 + 错误标注）
- **解析诊断**：行列级错误定位、错误行高亮；支持严格 JSON / JSONC（注释、尾逗号）/ JSONL（逐行）
- **查询**：JSONPath（`$.a.b[0]`、`[*]`、`..key`、`['key']`）+ 全文搜索（键/值、不区分大小写），点击结果跳转树节点
- **编辑**：格式化（2/4 空格/Tab）、压缩 minify、键排序、多标签页、拖拽打开、保存
- **系统集成（设置页）**：
  - Windows 右键菜单注入「用 JSON Viewer 打开」（所有文件 / JSON / JSONL / 文件夹 / 目录背景）
  - 文件关联（.json/.jsonl/.ndjson/.har/.geojson/.jsonc）+ 引导系统「默认应用」设置
  - 开机自启（HKCU Run 键，可最小化启动）
  - 一键清理全部系统集成（managed keys 机制保证注册表无残留）

## 开发

```bash
npm install          # 安装前端依赖
npm run tauri:dev    # 开发模式（启动 Vite + Tauri 窗口）
npm run tauri:dev    # 也可分别运行: npm run dev / npx tauri dev
```

浏览器预览 UI（无后端，使用 JS 降级解析）：

```bash
npm run dev          # http://localhost:5173
```

## 测试

```bash
cd src-tauri && cargo test   # Rust 单元测试（解析/格式化/JSONPath/注册表）
```

## 打包（Windows）

```bash
npm run tauri:build
```

产物：

| 文件 | 位置 |
|---|---|
| 免安装可执行程序 | `src-tauri/target/release/json-viewer.exe` |
| NSIS 安装器 | `src-tauri/target/release/bundle/nsis/JSON Viewer_x.x.x_x64-setup.exe` |

> 依赖：Node 18+、Rust stable-msvc、VS Build Tools 2022（C++ 工作负载）、WebView2 运行时（Win11 自带）。
> 应用图标由 `node scripts/gen-icon.mjs` 程序化生成（`src-tauri/icons/`）。

## 系统集成实现说明

- 全部注册表写入走 **HKCU**（无需管理员）；写入键路径记录于
  `HKCU\Software\JsonViewer\managed_keys`，卸载/「一键清理」按清单精准回滚。
- 右键菜单：`HKCU\Software\Classes\*\shell\JsonViewer` 等（NSIS 版出现在
  Windows 11「显示更多选项」经典菜单；MSIX 打包版可进入新版紧凑右键菜单顶层）。
- 文件关联：注册 ProgID（`HKCU\Software\Classes\JsonViewer.json`）+ `OpenWithProgids`；
  **不伪造 UserChoice**（Windows 哈希保护），通过 `ms-settings:defaultapps` 引导用户确认默认应用。
- 开机自启：`HKCU\...\CurrentVersion\Run`。
- 所有变更后调用 `SHChangeNotify(SHCNE_ASSOCCHANGED)` 即时刷新资源管理器。

## 目录结构

```
├── src/                    # 前端（React + Tailwind）
│   ├── components/ui.tsx   # WinUI 3 风格组件库
│   ├── features/           # 树/表/原始视图、查询、设置页
│   ├── stores/             # zustand 状态
│   └── lib/                # Tauri invoke 封装、类型、高亮
├── src-tauri/              # Rust 后端
│   ├── src/json_core/      # 解析 / 格式化 / JSONPath
│   ├── src/sys/            # 注册表、右键菜单、文件关联、自启
│   └── src/main.rs         # Tauri 命令层
├── scripts/gen-icon.mjs    # 程序化生成应用图标
└── docs/DESIGN-PLAN.md     # 设计计划
```
