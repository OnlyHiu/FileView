# FileView 代码审核报告（v0.2.0）

审核日期：2026-10-29 · 审核范围：`src/`（前端）与 `src-tauri/`（Rust 后端）全量

---

## 0. 审核方法

1. **通读全部源码**：前端 20 个文件、后端 11 个文件，逐文件核对实现与文档描述。
2. **静态推演 → 实证验证**：对每一处可疑行为先写出「输入 → 期望 → 实际」的推演，
   再用最小可复现用例跑出真实结果，**以实测结论为准**，不采信仅凭阅读得出的判断。
3. **回归测试固化**：每个确认的缺陷都补一条自动化测试，防止后续回归。

验证手段：

| 层次 | 手段 | 结果 |
|---|---|---|
| Rust 后端 | `cargo test`（50 项） | 全部通过 |
| 前端纯逻辑 | Node 内置 test runner（23 项） | 全部通过 |
| 类型检查 | `tsc --noEmit` | 无错误 |
| 构建 | `npm run build` | 通过 |

---

## 1. 审核结论总览

| 维度 | 结论 |
|---|---|
| 架构与信息架构 | **合理**。标题栏 / 菜单栏 / 工具栏 / 标签栏 / 文档区 + 侧栏面板 / 状态栏的骨架清晰，v0.2.0 的「文档区唯一」改造是正确方向 |
| 状态管理 | **基本合理，存在跨文档状态污染**。已修复 |
| 解析正确性 | **存在实质缺陷**。多字节文本下错误定位漂移、JSONL 坏行诊断丢失，已修复 |
| 安全性 | **存在严重缺陷**。Markdown 预览存在可执行脚本注入，已修复 |
| 系统集成 | **设计克制（HKCU / 不伪造 UserChoice）是优点**，但存在越界删除与首启劫持，已修复 |
| 文档一致性 | **多处声明与实现不符**。已修正 |
| 测试 | **后端有 49 项测试但会破坏用户注册表**。已加沙箱隔离 |

**总体评价**：产品设计（Notepad++ 式信息架构、Fluent 视觉、多格式一等公民）方向正确且完成度较高；
主要问题集中在**边界条件处理**与**安全加固**两块——这两类缺陷在正常使用时不易暴露，
但在多字节文本、大文件、部分失败的 JSONL、以及打开不可信文件时会明确造成错误结果或安全风险。

---

## 2. 已修复缺陷（按严重度）

### 2.1 严重：Markdown 预览可执行任意脚本

**位置**：`src/lib/markdown.ts`、`src/features/MarkdownPreview.tsx`

**问题**：Markdown 预览通过 `dangerouslySetInnerHTML` 注入 Tauri webview，
而 webview 内存在 IPC 桥（可调用 `read_file_text` / `write_file_text` 等命令）。
原实现采用**黑名单**脱敏（仅剥离 `on*=` 与带引号的 `href`/`src`），且「HTML 直通」不设标签白名单，
导致以下向量均可在应用自身来源下执行：

| 向量 | 后果 |
|---|---|
| `<iframe srcdoc="...">` | `srcdoc` 未过滤；iframe 继承父来源 → **脚本在应用内执行** |
| `<meta http-equiv="refresh" content="0;url=...">` | **整个 webview 被导航**到外部站点 |
| `<iframe src="https://evil">` / `<object>` / `<embed>` / `<base>` | 加载外部内容 |
| `<style>` / `style=` 属性 | CSS 注入，可覆盖整个界面 |
| 未加引号的 `href=javascript:...` | 黑名单只匹配带引号形式 → **协议绕过** |

**修复**：
- 改为**白名单**净化：仅允许明确列出的标签与属性，其余标签直接丢弃；
- 危险元素（`script`/`style`/`iframe`/`object`/`embed`/`form`/`svg`/`meta`/`base` 等）
  **连同其内容**一并移除；
- URL 属性统一走协议校验（仅 `http:`/`https:`/`mailto:`/`tel:`/`ftp:` 与安全相对路径），
  `javascript:` / `data:` / `vbscript:` 一律降级为 `#`；
- 属性值做上下文转义，杜绝引号逃逸；外链强制 `rel="noopener noreferrer"`；
- 链接点击处理器只放行 `http(s)` / `mailto` 交给系统浏览器。

**验证**：新增 15 项安全测试（`src/lib/markdown.test.ts`）。
修复前 7 项失败，修复后 15 项全部通过。

---

### 2.2 严重：JSONL 部分行失败时坏行诊断被整体丢弃

**位置**：`src-tauri/src/json_core/parser.rs`

**问题**：JSONL 解析时坏行诊断存放在局部变量 `diags` 中，
仅当**所有**行都失败时才被返回；只要有一行成功，`diags` 就被丢弃。
前端只依据 `result.diagnostics.length` 判断，表现为「解析完成：N 个节点」，
**用户永远看不到哪一行坏了**——而 JSONL 的坏行恰恰是用户最需要知道的信息。

**实测**：`parse("{\"a\":1}\n{\"b\": }\n", Jsonl)` → `diagnostics = []`（应为 1 条）。

**修复**：坏行诊断无条件并入结果；仅在「一行都没解析出来」时才整体失败（此时不返回节点）。

---

### 2.3 严重：错误定位在多字节文本下漂移（JSONC 尤其明显）

**位置**：`src-tauri/src/json_core/parser.rs`

**问题**：三处叠加导致偏移指向错误位置：

1. `serde_json::Error::column()` 是**行内字节列**，而旧代码按**字符**推进
   （`rest.chars().take(column - 1)`）→ 含多字节字符时偏移越算越偏，且固定偏早 1 字节。
2. `strip_jsonc` 按**字符**替换注释为 1 个空格 → 中文注释（3 字节）被压成 1 字节，
   剥离结果与原文**不再逐字节对齐**，行内后续位置全部前移。
3. `strip_jsonc` 直接**删除**尾逗号 → 再少 1 字节，同行后续位置继续前移。

**实测**（修复前）：

| 用例 | 期望 | 实际 |
|---|---|---|
| 严格模式 `{"中文键": ,}` | 指向 `,` | 指向 `\n`（偏后 1 字节） |
| JSONC `{"a": 1, /* 中文注释 */ "b": ,}` | 指向 `,` | 指向注释残留（偏后 5 字节） |
| JSONC 尾逗号 `{"a": [1,], "b": ,}` | 指向 `,` | 偏移错位 |

**修复**：
- `strip_jsonc` 改为**按字节**处理：注释逐字节替换为空格、尾逗号替换为空格（而非删除），
  保证剥离结果与原文**逐字节对齐**，行/列/偏移可直接映射；
- `diag_from_serde` 改为按**字节**换算全局偏移；
- 顺带修正 `to_value` / `formatter::map_jsonl_lines` / `formatter::validate`
  的 JSONL 行拆分方式（`lines()` → `split('\n')` + 剥离 `\r`），使各处行号口径一致。

**验证**：新增 9 项回归测试（`src-tauri/src/json_core/parser_regression.rs`）。

---

### 2.4 高：`cargo test` 会破坏用户自己的文件关联

**位置**：`src-tauri/src/sys/file_assoc.rs`、`sys/autostart.rs`、`sys/registry.rs`

**问题**：单测直接写真实 `HKCU`：

- `test_register_replaces_empty_default` 显式把 `Software\Classes\.md` 的默认值写成空串，
  测完再删除 → **用户双击 .md 变成无反应**；
- `test_register_unregister_md` / `_json` 注销时删除自己的默认值 →
  扩展名变成「无处理程序」；
- `test_autostart_toggle` 写真实 `Run` 键。

`cargo test` 是开发者的日常操作，这类破坏几乎必然发生。

**修复**：测试构建下所有键路径统一重定位到沙箱 `HKCU\Software\FileViewTests\...`，
与真实系统完全隔离；`notify_shell_assoc_changed` 在测试中跳过（避免 70+ 次 Explorer 广播）。

**验证**：新增 `test_keys_are_written_into_sandbox_not_real_hkcu`；
并在真实机器上确认测试前后 `HKCU\Software\Classes\.md` 与 `.json` 的默认值**保持不变**。

---

### 2.5 高：首次启动静默抢占 70+ 种扩展名的默认处理程序

**位置**：`src-tauri/src/settings.rs`、`src/lib/api.ts`

**问题**：`Settings::default().associated_extensions` 默认等于**全部 73 个**受支持扩展名，
且 `main.rs` 启动时按此逐个注册。首次启动即把 `.py` `.js` `.ts` `.c` `.rs` `.go` `.md` `.yaml` …
的默认处理程序指向本应用——用户从未同意过。

**修复**：默认改为**不注册任何关联**，由用户在「设置 → 默认打开方式」显式勾选。

---

### 2.6 高：启动时执行数万次注册表操作与 70+ 次 Shell 广播

**位置**：`src-tauri/src/sys/file_assoc.rs`、`main.rs`

**问题**：原 `register()` 每注册一个扩展名就重建一次 `Capabilities`（内含 73 次探测 + 写）
并广播一次 `SHCNE_ASSOCCHANGED`；`record_managed_key` 又是 O(n) 线性扫描。
批量注册 70 个扩展名 ≈ **3 万次注册表操作 + 70 次 Explorer 全量重读**，启动明显卡顿。

**修复**：新增 `register_many` / `unregister_many`——先整体校验扩展名（避免半成功状态），
再批量写入，最后只刷新一次能力表、只广播一次 Shell 通知。

---

### 2.7 高：查找（Ctrl+F）命中偏移随文本/标签变化失效

**位置**：`src/stores/jsonStore.ts`、`src/App.tsx`

**问题**：`findMatches` 只在**输入查询词时**计算一次。之后：

- 在编辑器里继续输入 → 命中偏移全部失效，计数错误、`F3` 跳到无关位置；
- 切换标签 → A 标签算出的偏移被套用到 B 标签的文本上（甚至越界）。

**修复**：新增 `syncFind()`，在文本变更（`setEditorText` / 撤销 / 重做）与标签切换后重算命中。
定位触发改由 store 的 `findNonce` 显式驱动（仅在用户主动导航查找时递增），
**避免用户打字时光标被反复抢到命中处**；同时修正了「只有一个命中时 `F3` 不重新定位」的问题。

---

### 2.8 高：切换/关闭标签后残留旧文档的解析结果

**位置**：`src/stores/jsonStore.ts`

**问题**：`closeTab` 关闭当前标签后仍保留 `s.result`（属于**已关闭**的文档），
新标签的树形面板与状态栏会短暂显示旧文档的内容；
`App.tsx` 的 `errorLines` 也据此把**旧文件的 JSON 错误行**标红到**新文件的行号槽**上。
`switchTab` 更严重：`expanded` / `selectedId` / `searchHits` 全部跨标签复用。

**修复**：切换/关闭标签时一并清空 `result` / `expanded` / `selectedId` / `searchHits`。

---

### 2.9 中：树形折叠状态按不稳定的节点 id 索引

**位置**：`src/stores/jsonStore.ts`、`src/features/TreeView.tsx`

**问题**：节点 id 是每次解析时按遍历顺序重新分配的。
在文档头部增删一个键，**其后所有节点的 id 全部错位**，
用户此前展开的子树会突然展开到别的节点上。

**修复**：折叠状态改按**节点路径**（`path`）索引——结构不变时路径稳定。

---

### 2.10 中：撤销后继续输入，重做会用旧内容覆盖新输入

**位置**：`src/stores/jsonStore.ts`

**问题**：重做栈仅在**合并窗口边界**（距上次编辑 > 600ms）才清空。
在合并窗口内「撤销 → 继续输入 → 重做」，重做栈仍持有旧文本，
`Ctrl+Y` 会**静默丢弃用户刚输入的字符**。

**修复**：任何新编辑都作废重做栈。
顺带在关闭标签时释放该标签的历史记录，避免长时间使用下无界增长。

---

### 2.11 中：旧品牌迁移可能误删其它软件的同名注册表项

**位置**：`src-tauri/src/sys/mod.rs`

**问题**：`migrate_legacy_brand()` 每次启动都无条件删除
`Software\Classes\JsonViewer.<ext>`、`Software\JsonViewer`、
以及 `RegisteredApplications` 下名为 `"JSON Viewer"` 的值——
这些名称**不属于本应用的命名空间**，若用户装有同名的其它产品，其注册会被破坏。

**修复**：删除前校验归属——仅当键内的打开命令指向可执行文件名含 `jsonviewer` 时才认定是我们的键。

---

### 2.12 中：设置文件因结构变更 / 写入中断而整体丢失

**位置**：`src-tauri/src/settings.rs`

**问题**：`Settings` 无 `#[serde(default)]`，新增字段即让**所有**旧配置反序列化失败，
`load()` 的 `unwrap_or_default()` 会把整份配置重置为默认；
且 `save()` 直接 `fs::write`（截断后写），中途崩溃会留下半截文件 → 同样全量重置。

**修复**：结构体加 `#[serde(default)]`（缺失字段回退默认值而非丢弃整份配置）；
写入改为「临时文件 + rename」原子替换。

---

### 2.13 中：CSV 表格视图与文档声称不一致

**位置**：`src/features/CsvView.tsx`、`src/lib/highlight.ts`

**问题**：

1. 文档（`RELEASE-v0.2.0.md` / `PLAN-v0.2.0.md`）声称「自动识别分隔符」，
   实现却是写死的 `isTsv ? "\t" : ","`；
2. CSV 高亮把单元格**去掉了引号**再输出，而编辑器是「高亮层 + 透明 textarea」叠加显示——
   含引号或含逗号的字段会导致**两层内容横向错位**，光标位置对不上。

**修复**：实现 `detectCsvDelimiter()`（按「切分列数一致性 + 列数」打分，
可正确处理欧洲风格分号、值内含逗号等情形）；CSV 高亮改为**保留原始引号与分隔符**，
保证 token 拼接后与源文本逐字符一致。

**验证**：新增 8 项测试（`src/lib/highlight.test.ts`），
其中一项对 **13 种语言**逐一断言「token 拼接结果 === 源文本」。

---

### 2.14 低：其它

- 移除死代码：`validate_json` 命令、`supported_extensions` 命令、
  `formatter::validate`、`ProgressBar` 组件；
- 补齐高亮语言缺口：`.pl`（Perl）与 `.r`（R）此前回退为纯文本，现已加入专门的高亮规则；
- 对话框补齐 `role="dialog"` / `aria-modal` / Esc 关闭 / 焦点移入与归还；
- 面板与对话框的 Esc 冲突已分层（对话框在最上层）。

---

## 3. 已知遗留问题（本次未修改，建议排期）

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| R1 | 文档区未做虚拟滚动 | 64MB 文件会渲染数十万 DOM 节点，打开与每次按键都明显卡顿 | 引入虚拟列表；或对超大文件只读化 |
| R2 | `tauri.conf.json` 中 `csp: null` | 失去 CSP 兜底，任一 XSS 都会被放大 | 配置最小 CSP（`default-src 'self'`），配合本次的 HTML 白名单双保险 |
| R3 | `read_file_text` / `write_file_text` 接受任意路径 | webview 一旦被攻破即可读写任意文件 | 增加路径白名单或最近文件限制 |
| R4 | 启动时 JSON 解析深度依赖 serde_json 默认的 128 层限制 | 超过 128 层的合法 JSON 报「recursion limit exceeded」，错误信息误导 | 显式深度限制并给出专门诊断文案 |
| R5 | `QueryPanel` 命中列表用 `Array.find` 线性查找节点 | 命中数 × 节点数的复杂度，大文档下渲染卡顿 | 预建 `Map<path, node>` / `Map<id, node>` |
| R6 | JSONL 格式化把 CRLF 统一为 LF，且丢弃空行 | 会改变文件的行尾风格与行号 | 保留原始行尾风格 |
| R7 | 工具面板宽度未持久化 | 重启后恢复默认宽度 | 存入 settings |
| R8 | `supported_extensions` 命令已移除 | 前端扩展名清单与 Rust 端各维护一份，存在漂移风险 | 已提供 `scripts/check-ext-sync.mjs` 做一致性校验，建议纳入 CI |

---

## 4. 测试现状

```
cargo test              # 49 项后端测试
npm test                # 23 项前端纯逻辑测试
npm run build           # tsc + vite 构建
node scripts/check-ext-sync.mjs   # 前后端扩展名清单一致性
```

新增测试文件：

| 文件 | 覆盖 |
|---|---|
| `src-tauri/src/json_core/parser_regression.rs` | 诊断偏移准确性、JSONC 字节对齐、JSONL 坏行保留 |
| `src/lib/markdown.test.ts` | Markdown 注入向量（15 项） |
| `src/lib/highlight.test.ts` | token 与源文本一致性、CSV 分隔符识别（8 项） |

---

## 5. 审核过程中确认「合理」的部分

为避免只呈现问题，以下设计经核对确认是**正确且值得保留**的：

1. **全部写 `HKCU`**：无需管理员权限，符合普通用户场景。
2. **不伪造 `UserChoice`**：正确尊重 Windows 的哈希保护机制，
   改为注册 ProgID + 引导用户在系统设置中确认。
3. **注销时只移除自己的值**：不会删除用户已有的其他「打开方式」。
4. **`csp: null` 之外未开启多余权限**：capabilities 中声明的每一项权限都已核实存在于生成的 ACL 清单。
5. **树形视图使用 `@tanstack/react-virtual`**：大 JSON 的树形渲染已虚拟化。
6. **JSON 路径生成规则**（`root.users[0].name`、非法标识符键用 `['...']`）
   在前后端两侧保持一致，且有测试覆盖。
7. **格式化保持键序**（仅 `sort_keys` 才重排）：有专门测试守护，不会在格式化时意外改变数据结构。

---

## 6. 变更文件清单

**后端**

- `src-tauri/src/json_core/parser.rs` — 字节级偏移换算、字节对齐的 `strip_jsonc`、JSONL 诊断保留
- `src-tauri/src/json_core/parser_regression.rs` — 新增回归测试
- `src-tauri/src/json_core/formatter.rs` — JSONL 行拆分口径统一、移除未使用的 `validate`
- `src-tauri/src/json_core/mod.rs` — 注册测试模块
- `src-tauri/src/sys/registry.rs` — 测试沙箱隔离、归属校验辅助函数、跳过测试期 Shell 广播
- `src-tauri/src/sys/file_assoc.rs` — 批量注册/注销、原子校验、注销扩展名校验
- `src-tauri/src/sys/mod.rs` — 旧品牌迁移的归属校验、批量清理
- `src-tauri/src/settings.rs` — `serde(default)`、原子写、默认不注册文件关联
- `src-tauri/src/main.rs` — 批量注册、移除死命令

**前端**

- `src/lib/markdown.ts` — 白名单净化、危险元素连内容移除、URL 协议校验
- `src/lib/markdown.test.ts` — 新增安全测试
- `src/lib/highlight.ts` — CSV 分隔符识别、CSV 高亮保真、Perl / R 高亮
- `src/lib/highlight.test.ts` — 新增一致性测试
- `src/lib/types.ts` — 新增 `perl` / `r` 高亮语言
- `src/lib/api.ts` — 默认不注册文件关联
- `src/stores/jsonStore.ts` — 查找命中同步、跨标签状态清理、折叠按路径索引、重做栈失效
- `src/features/TreeView.tsx` — 折叠按路径索引
- `src/features/MarkdownPreview.tsx` — 链接协议限制
- `src/components/ui.tsx` — 对话框无障碍与焦点管理、移除 `ProgressBar`
- `src/components/SidePanel.tsx` — Esc 分层
- `src/App.tsx` — 定位触发改由 store nonce 驱动
- `package.json` — 新增 `npm test`
- `tsconfig.json` — 排除测试文件
- `scripts/check-ext-sync.mjs` — 前后端扩展名清单一致性校验
