# FileView 代码审核报告（v0.2.2）

审核日期：2026-11-22 · 审核范围：`src/`（前端 20 个文件）与 `src-tauri/src/`（Rust 后端 11 个文件）全量

---

## 0. 审核方法

1. **通读全部源码**：前端 20 个文件、后端 11 个文件，逐文件核对实现与注释 / 文档描述。
2. **静态推演 → 实证验证**：对每一处可疑行为先写出「输入 → 期望 → 实际」的推演，
   再用最小可复现用例跑出真实结果，**以实测结论为准**。
3. **回归测试固化**：每个确认的缺陷都补一条自动化测试，防止后续回归。

验证手段：

| 层次 | 手段 | 结果 |
|---|---|---|
| Rust 后端 | `cargo test` | **64 项全部通过**（审核前 49 项）|
| 前端纯逻辑 | `npm test` | **68 项全部通过**（审核前 46 项）|
| 类型检查 | `tsc --noEmit` | 无错误 |
| 构建 | `npm run build` | 通过 |
| 一致性校验 | `scripts/check-ext-sync.mjs` | 前后端 73 个扩展名一致 |
| 安全策略 | `scripts/check-csp.mjs` | CSP 已嵌入编译产物 |

---

## 1. 审核结论总览

| 维度 | 结论 |
|---|---|
| 架构与信息架构 | **合理**。文档区唯一 + 右侧可停靠面板的骨架清晰，本轮未发现架构级问题 |
| Markdown 渲染 | **存在实质缺陷**。引用块被压成一行、硬换行失效、相对链接失效、链接地址双重转义。已修复 |
| 编辑器 | **存在重影缺陷**。透明编辑层与高亮层的选中渲染、制表位未对齐。已修复 |
| 数据安全 | **存在 4 项数据丢失路径**。分离标签、格式化跨标签、大文档批量替换、重新打开未保存文件。已修复 |
| 状态管理 | **存在跨文档 / 跨标签污染**。解析结果串档、搜索命中错位、查询结果残留。已修复 |
| 后端正确性 | **存在文件损坏级缺陷**。大小写折叠产生空区间 → 批量替换只插不删；JSONL 一行坏就整体不可格式化。已修复 |
| 系统集成 | **存在恢复能力缺口**。单个非法扩展名导致全部关联注册不上；能力表被外部清理后无法自愈。已修复 |
| 安全性 | 白名单净化与最小化 CSP 经复核有效，未发现新的可执行注入路径 |

**总体评价**：本轮缺陷集中在**边界条件**与**并发/时序**两类——
正常使用时不易暴露，但在多字节文本、脏文件、大文件、
切换标签的时机、以及打开被外部改动的注册表时会明确造成错误结果或数据丢失。
这类问题必须靠「推演 + 实测」发现，光读代码很容易漏掉。

---

## 2. 已修复缺陷（按严重度）

### 2.1 严重：分离标签时未保存的修改被丢弃（数据丢失）

**位置**：`src/lib/api.ts`

**问题**：分离窗口的 URL 按 `payload.path` 构造，而内存文本只在下���条件时才传：

```ts
const url = payload.path ? `...&file=${path}` : "...";   // 有路径就带 file=
...
if (!payload.path || payload.dirty) emitTo(label, "detach-payload", payload);
```

新窗口按 URL 里的 `file` 参数决定「自行读盘」还是「等内存文本」。
于是**有磁盘路径 + 有未保存修改**的标签：新窗口读到磁盘上的旧内容，
内存文本事件因无人监听被丢弃；主窗口随后又关闭了原标签——修改无处可寻。

**修复**：URL 与传输通道保持一致——只有「有路径且无未保存修改」才让新窗口读盘，
否则一律走内存文本通道。

---

### 2.2 严重：格式化 / 压缩 / 键排序会写进别的标签（数据丢失）

**位置**：`src/stores/jsonStore.ts`

**问题**：`applyFormat` / `applyMinify` / `applySort` 先取出当前标签文本，
经过两次 `await`（设置 IPC + 格式化 IPC）后调用 `setEditorText(out)`，
而 `setEditorText` 作用于**调用时刻**的活动标签。

**实测**：打开 `a.json` 与 `b.json` → 在 `a.json` 上点「格式化」→
格式化 IPC 在途时切到 `b.json` → `b.json` 的内容被 `a.json` 的格式化结果覆盖。

**修复**：写回前校验活动标签是否仍是原标签，否则取消并提示。

---

### 2.3 严重：大文档「全部替换」会用旧命中位置改文档（文件损坏）

**位置**：`src/stores/jsonStore.ts`

**问题**：大文档（> 200KB）的查找命中采用 200ms 防抖。
在防抖窗口内 `findQuery` 已更新，但 `findMatches` 仍是**旧查询词**的偏移。
`replaceAll` 用新查询词的长度去改旧偏移 → 文档内容被写坏。

**修复**：查询词或大小写敏感度变化且扫描被延迟时，
立即清空 `findMatches` / `findIndex`（旧命中对新词没有意义），
替换逻辑因此会正确地提示「没有可替换的命中」。

---

### 2.4 严重：重新打开已有未保存修改的文件会覆盖内存文本（数据丢失）

**位置**：`src/stores/jsonStore.ts`

**问题**：文件监视器会避开脏标签，但所有**显式**打开路径
（最近文件、拖拽打开、单实例事件、`Ctrl+O`）都无条件调用 `loadFile`，
用磁盘内容覆盖标签文本，并同步更新基线（脏标记被抹掉）。

**修复**：`loadFile` 检测到同路径标签存在未保存修改时，
保留内存内容并提示用户，而不是静默丢弃。

---

### 2.5 高：Markdown 引用块被压成一行、硬换行失效

**位置**：`src/lib/markdown.ts`

**问题**：见 [RELEASE-v0.2.2.md](./RELEASE-v0.2.2.md) 的「修复」一节。
根因是引用行用 `join(" ")` 拼成单个段落，且块内不递归解析。

**修复**：块级解析统一收敛到 `renderBlocks()`，引用块内容递归处理；
补齐硬换行、嵌套列表、任务列表、Setext 标题、反斜杠转义、CRLF 归一化。

**验证**：新增 15 项回归测试（`src/lib/markdown.test.ts`），全部通过。

---

### 2.6 高：选中文字出现虚影重叠

**位置**：`src/styles/index.css`、`src/features/SourceEditor.tsx`

**问题**：透明 textarea 被选中时，浏览器按系统 `::selection`
用不透明前景色重绘选中文字 → 文字变成两层。

**修复**：`.editor-surface::selection` 强制选中文字透明，只留半透明底色。
顺带统一高亮层与编辑层的 `tab-size`（此前写死 2 / 默认 8 不一致，含 Tab 的文件横向错位）。

---

### 2.7 高：解析结果串档（上一份文档的树写进当前文档）

**位置**：`src/stores/jsonStore.ts`

**问题**：`reparseSeq` 只在 JSON 分支递增。切到空白 / 非 JSON 文档时提前 return，
**没有作废在途的解析**；旧解析回来时 `seq === reparseSeq` 依然成立 →
把上一个文档的树写进当前文档（状态栏还会报「解析完成：N 个节点」）。

**修复**：序号在所有分支之前递增；空文档 / 非 JSON 分支同时清空
`selectedId` / `searchHits`。

---

### 2.8 高：搜索命中与选中项在重新解析后错位

**位置**：`src/stores/jsonStore.ts`

**问题**：节点 id 每次解析按遍历顺序重排（该事实已被 store 自己的注释记录）。
`expanded` 已按**路径**重映射，但 `searchHits`（节点 id 数组）与 `selectedId` 没有。
文档头部增删一个键后，树视图高亮、选中、查询面板跳转都会落到别的节点上。

**修复**：重新解析时按路径把旧的命中 / 选中 id 重映射到新 id。

---

### 2.9 高：未保存文档里点搜索结果会尝试打开名为「未命名」的文件

**位置**：`src/features/SearchResultsPanel.tsx`、`src/App.tsx`

**问题**：当前文档的命中用 `activeTab.name` 当作伪路径，
但 `goto` 与 `revealTarget` 都拿它和 `activeTab.path` 比较。
未保存文档的 `path` 是 `null` → 两者永远不相等 → 走「跨文件」分支，
`read_file_text("未命名")` 失败；定位请求也因路径不匹配被丢弃。

**修复**：引入统一的「文档标识」（有路径用路径，否则用标签名），
命中条目直接带 `current` 标记，不再靠路径比较。

---

### 2.10 高：大小写折叠产生空区间 → 批量替换只插不删（文件损坏）

**位置**：`src-tauri/src/search.rs`

**问题**：`fold_chars` 把一个原字符折叠出的多个字符都指向**同一个字节偏移**。
`char::to_lowercase` 不是 1:1 的（`'İ'` U+0130 → `'i'` + U+0307），
于是命中区间被算成 `(0, 0)`：替换时只插入不删除，原字符还在，文件越写越长。

**实测**：搜索 `i` 命中 `İ` → 区间 `(0,0)`；把 `i` 替换成 `X` → `Xİzz`（原字符没被删）。

**修复**：折叠元素同时记录原字符的字节**起止**，命中区间取
「首字符起点 → 末字符终点」；坏行 / 写失败如实上报。

**验证**：新增 3 项回归测试（`src-tauri/src/search.rs`）。

---

### 2.11 高：搜索命中偏移口径与前端不一致（定位偏字符）

**位置**：`src-tauri/src/search.rs`、`src/lib/types.ts`

**问题**：Rust 按 **Unicode 标量**计数输出 `offset` / `length`，
前端却当作 JS 字符串下标（**UTF-16 码元**）直接喂给 `setSelectionRange`。
文件里每出现一个星平面字符（emoji、CJK 扩展 B）定位就偏一个字符。

**修复**：Rust 侧改用 `encode_utf16().count()`，与前端口径统一；
类型注释同步更新。

---

### 2.12 高：批量替换静默吞掉写失败

**位置**：`src-tauri/src/search.rs`、`src/stores/searchStore.ts`

**问题**：`fs::write` 失败（文件被占用 / 只读 / 无权限）被 `is_ok()` 吞掉，
界面却报告「已替换 N 处」——用户以为改成功了，文件其实没动。

**修复**：`ReplaceResult` 增加 `failed_files`，前端如实列出失败文件。

---

### 2.13 高：注册表「写入清单」并发写坏

**位置**：`src-tauri/src/sys/registry.rs`

**问题**：清单更新是「读 count → 写 keyN → 写 count」三步。
Tauri 的命令处理函数跑在异步线程池上，两条命令并发时会读到同一个 count，
互相覆盖 → 清单出现空洞、计数虚高。

**修复**：整个读改写过程用进程级互斥锁串行化
（生产代码此前只有测试代码有锁）。

---

### 2.14 高：单个非法扩展名导致**所有**文件关联注册不上

**位置**：`src-tauri/src/sys/file_assoc.rs`、`src-tauri/src/main.rs`

**问题**：`register_many` 为保证原子性会**先整体校验**，一个不支持的扩展名就让整批失败。
而设置文件里的清单**不校验**就持久化，启动时又把错误丢掉（`let _ =`）。
结果：设置文件里混入一个坏值 → 从此所有关联都注册不上，且没有任何提示。

**修复**：新增 `filter_supported()`，在持久化与启动注入前过滤；
设置写入时也做归一化（去点、转小写）。

---

### 2.15 高：能力表被外部清理后无法自愈

**位置**：`src-tauri/src/sys/file_assoc.rs`

**问题**：`refresh_capabilities()` 的错误被 `let _ =` 吞掉；
且只在「本次真的改了注册表」时才调用。
若 `Capabilities` 键被清理工具删掉而 ProgID 还在，
`changed == false` → 能力表永不刷新 → 本应用永远不出现在 Windows「默认应用」列表里，
但设置页仍显示「已注册」。

**修复**：能力表**无条件**刷新，且失败如实上报。

---

### 2.16 中：JSONL 一行坏就整体不可格式化 / 查询

**位置**：`src-tauri/src/json_core/parser.rs`、`json_core/formatter.rs`

**问题**：`parse()` 能保留好行并给出坏行诊断，
但 `to_value()` / `map_jsonl_lines()` 遇到第一行坏行就整体 `Err`。
用户看得见树、却无法格式化、压缩、排序、查询自己的文件。

**修复**：坏行跳过（`to_value`）或原样保留（格式化输出），好行照常处理。

---

### 2.17 中：含单引号的键，其路径无法回放

**位置**：`src-tauri/src/json_core/parser.rs`、`json_core/query.rs`

**问题**：解析器给键 `a'b` 生成路径 `root['a\'b']`，
而查询引擎的 `['...']` 分支扫描到**下一个**引号就停（不认反斜杠转义），
于是路径被解析成键 `a\` → 查不到、也不报错。
此外路径拼接处会写成 `root.['a\'b']`（多一个点），与前端生成的路径不一致。

**修复**：查询引擎支持反斜杠转义与双引号；
路径拼接统一到 `parser::join_key()`（方括号写法不加点），与前端一致。

---

### 2.18 中：设置文件单个字段类型错误 → 整份配置被重置

**位置**：`src-tauri/src/settings.rs`

**问题**：`#[serde(default)]` 只覆盖「字段缺失」。
某个字段**类型**不对（如 `fontSize` 写成字符串）会让整份反序列化失败，
`unwrap_or_default()` 于是把主题、文件关联、自启、最近文件全部清空——
而启动注入正是按这些设置恢复的，用户会突然发现关联全没了。

**修复**：整体解析失败时逐字段回退，保住能读出来的部分；
并补上字段校验（主题 / 缩进 / 启动行为白名单，字号夹到 8..72）。

---

### 2.19 中：设置页勾选连点会丢一次勾选

**位置**：`src/features/SettingsPage.tsx`、`src/stores/settingsStore.ts`

**问题**：`settings.associated_extensions` 要等 IPC 回来才更新，
连点两下时第二次基于旧集合计算 → 丢一次勾选；
同时 `applyFileAssoc` 的注销清单取自注册表快照，与请求清单可能不一致。

**修复**：本地维护待提交状态，勾选框在 `busy` 期间禁用。

---

### 2.20 中：批量替换的大小写口径与查询词来源不一致

**位置**：`src/stores/searchStore.ts`

**问题**：搜索时用的查询词与大小写敏感度，与替换时读取的**当前**查找栏值可能不同
（用户在两次操作之间改了查询词或切换了「Aa」），
导致替换掉列表里没显示的其它变体；替换后的重新扫描还会用当前查找栏的词覆盖结果。

**修复**：搜索时记录 `folderCaseSensitive`，替换沿用它；
重新扫描用同一个查询词；整体加 try/catch，不再产生未处理的 Promise 拒绝。

---

### 2.21 中：Esc 同时关闭菜单与面板

**位置**：`src/components/MenuBar.tsx`、`src/components/SidePanel.tsx`

**问题**：两个 `window` 冒泡阶段的 Esc 监听器，
面板的先注册 → 菜单打开时按 Esc 会**连带把面板 / 查找栏也关掉**。

**修复**：菜单的 Esc 处理改为捕获阶段并 `stopPropagation()`。

---

### 2.22 中：搜索结果面板逐个命中算行号导致界面卡死

**位置**：`src/features/SearchResultsPanel.tsx`

**问题**：每个命中都执行一次 `text.slice(0, offset).split("\n")`。
5000 个命中 ≈ 数十万次字符串切片与数组分配，**每次按键**都重算一遍。

**修复**：预先算好行首偏移表，二分定位行号。

---

### 2.23 低：其余

- **Markdown 列表标记丢失**：Tailwind 的 preflight 会把 `ul` / `ol` 重置为
  `list-style: none`，Markdown 预览里的列表项因此没有任何标记。
  已显式恢复 `disc` / `decimal`；
- **Markdown 相对链接可点击**：相对路径链接此前只是死链接，
  现按当前文档所在目录解析后在应用内打开（`../` `./` 与 URL 编码均支持）；
- `write_file_text` 改为**原子写**（临时文件 + 改名），与设置文件保存一致；
  此前直接 `fs::write` 会先截断目标，崩溃 / 磁盘满会留下半截文件；
- `install_context_menu` 批量卸载右键菜单目标：此前逐个卸载 →
  每个目标各触发一次 `SHCNE_ASSOCCHANGED` 广播（桌面图标闪烁）；
- 旧品牌迁移改为**一次性**（`migrated_legacy` 标记）：
  此前每次启动都要遍历 70+ 扩展名做归属判定（约 150 次注册表读）；
- `F3` 在查找栏关闭时也能逐处跳转（此前只更新计数，光标不动）；
- 替换当前命中后自动定位到下一处（此前停在原地）；
- 大小写不敏感查找改用**长度保持**的小写化：
  `toLowerCase()` 对 `'İ'` 会改变长度，导致命中偏移相对原文位移；
- `switchTab` 同时清空 `queryHits` / `queryError`（此前查询面板残留上一个文档的路径）；
- `runQuery` 增加序号守卫（此前切标签 / 改表达式后仍写入旧结果）；
- `QueryPanel` 用 `Map` 建节点索引（此前每渲染一行线性扫描整棵节点表）；
- `MenuBar` 的菜单数组真正 memo 化（此前依赖整个 props 对象，等于没缓存，
  且有调用到旧闭包的风险）；
- 面板 / 结果窗口的指针监听器补 `pointercancel` 清理（此前窗口外松手会永久泄漏）；
- 删除死代码：`RESULTS_PANEL_HEIGHT` 的多余导出、`clearFindHistory`、
  `jsonStore` 的 `ViewMode` 再导出；
- 修正「在文件夹中搜索」的快捷键提示（`Ctrl+Shift+F` → `Ctrl+Alt+F`）。

---

## 3. 遗留问题（建议排期）

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| R1 | `read_file_text` / `write_file_text` 接受任意路径 | webview 一旦被攻破即可读写任意文件 | 增加「已打开文件」白名单或路径校验（CSP 只能缓解） |
| R2 | 启动时 JSON 解析深度依赖 serde_json 默认的 128 层限制 | 超过 128 层的合法 JSON 报「recursion limit exceeded」，错误信息误导 | 显式深度限制并给出专门诊断文案 |
| R3 | `QueryPanel` 命中列表仍用 `Array.find` 查节点 | 大文档下渲染卡顿 | 本轮已改 `Map`；后续可把搜索命中也改为按路径存储 |
| R4 | JSONL 格式化把 CRLF 统一为 LF，且丢弃空行 | 会改变文件的行尾风格与行号 | 保留原始行尾风格 |
| R5 | 工具面板宽度未持久化 | 重启后恢复默认宽度 | 存入 settings |
| R6 | 前后端扩展名清单各维护一份 | 存在漂移风险 | 已有 `scripts/check-ext-sync.mjs`，建议纳入 CI |
| R7 | 超大文件仍会逐键重建行索引 | 64MB 文件每次按键约数十毫秒 | 行索引增量更新（按编辑位置平移） |
| R8 | `migrate_legacy_brand` 的标记写在 `Software\FileView` 下，「一键清理」会连同删除 | 下次启动会重跑一次迁移（幂等，无害） | 可接受 |

---

## 4. 测试现状

```
npm test                # 68 项前端纯逻辑测试
cd src-tauri && cargo test   # 64 项后端测试
npm run build           # tsc + vite 构建
node scripts/check-ext-sync.mjs   # 前后端扩展名清单一致性
node scripts/check-csp.mjs        # 确认 CSP 已嵌入编译产物
node scripts/bench-highlight.mjs  # 大文件分词性能基准
```

本轮新增测试文件 / 用例：

| 文件 | 覆盖 |
|---|---|
| `src/lib/markdown.test.ts` | 引用块分行、硬换行、嵌套列表、任务列表、Setext 标题、CRLF、相对链接、`&` 单次转义、反斜杠转义（新增 15 项）|
| `src/lib/paths.test.ts` | 相对链接解析：上级 / 下级 / URL 编码 / 绝对路径 / 无目录（新增 7 项）|
| `src-tauri/src/search.rs` | 大小写扩展字符的空区间、UTF-16 偏移口径、写失败上报（新增 3 项）|
| `src-tauri/src/settings.rs` | 单字段类型错误容错、字段校验与归一化（新增 2 项）|
| `src-tauri/src/json_core/formatter.rs` | JSONL 坏行不阻塞格式化、`to_value` 跳过坏行（新增 2 项）|
| `src-tauri/src/json_core/query.rs` | 含转义引号的键名可回放、双引号键名（新增 2 项）|

---

## 5. 审核过程中确认「合理」的部分

为避免只呈现问题，以下设计经核对确认是**正确且值得保留**的：

1. **全部写 `HKCU`**：无需管理员权限，符合普通用户场景。
2. **不伪造 `UserChoice`**：正确尊重 Windows 的哈希保护机制。
3. **注销时只移除自己的值**：不会删除用户已有的其它「打开方式」。
4. **`strip_jsonc` 的字节对齐**：注释按字节替换为空格、尾逗号替换为空格，
   保证剥离结果与原文逐字节对齐，行列号可直接映射（v0.2.0 已修，本轮复核无误）。
5. **`diag_from_serde` 的字节偏移换算**：serde_json 的 `column()` 确为字节列，
   换算正确。
6. **JSONL 的 CRLF 记账**：用 `split('\n')` + 单独剥离 `\r`，行号口径一致。
7. **UTF-8 边界安全**：`search.rs` 中所有 `&str` 切片都源自 `char_indices()`，
   不会在非字符边界切片（本次修复的是区间**正确性**，不是切片 panic）。
8. **`serde_json` 启用 `preserve_order`**：格式化 / 压缩保持文档键序，
   仅 `sort_keys` 才重排。
9. **注册表 RAII**：每个 `RegKey` 都被确定性 drop，无句柄泄漏；
   `read_file_text` 用 `take()` 消费文件，无 fd 泄漏。
10. **最小化 CSP**：`script-src 'self'`、`object-src/base-uri/form-action` 为 `none`，
    `connect-src` 含 `http://ipc.localhost`（Windows WebView2 的实际 IPC 通道）。
11. **Markdown 白名单净化**：标签 / 属性白名单 + 危险元素连内容移除 +
    URL 协议校验，v0.2.0 修复后本轮复核未发现新的可执行注入路径。

---

## 6. 变更文件清单

**后端**

- `src-tauri/src/search.rs` — 折叠区间修正、UTF-16 偏移、写失败上报、3 项回归测试
- `src-tauri/src/json_core/parser.rs` — `to_value` 跳过 JSONL 坏行、`escape_key` / `join_key` 统一、删除死分支、修正文档
- `src-tauri/src/json_core/query.rs` — 带引号键名支持转义、路径拼接统一、2 项回归测试
- `src-tauri/src/json_core/formatter.rs` — JSONL 坏行不阻塞格式化、2 项回归测试
- `src-tauri/src/settings.rs` — 逐字段容错读取、字段校验与归一化、2 项回归测试
- `src-tauri/src/sys/registry.rs` — 写入清单串行化
- `src-tauri/src/sys/file_assoc.rs` — `filter_supported`、能力表无条件刷新且不再吞错
- `src-tauri/src/sys/mod.rs` — 旧品牌迁移改为一次性
- `src-tauri/src/main.rs` — 文档保存改为原子写、右键菜单批量卸载、启动注入过滤扩展名
- `src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` — 版本号 0.2.2

**前端**

- `src/lib/markdown.ts` — 块级解析重构（引用块 / 硬换行 / 嵌套列表 / 任务列表 / Setext / 转义 / CRLF）、链接 URL 判定与转义分离
- `src/lib/markdown.test.ts` — 新增 15 项结构与转义回归测试
- `src/lib/types.ts` — `SearchHit` 偏移口径注释、`ReplaceResult.failed_files`
- `src/lib/api.ts` — 分离窗口的 URL 与传输通道保持一致
- `src/lib/paths.ts` — 新增：相对链接解析（纯逻辑，可单元测试）
- `src/lib/paths.test.ts` — 新增：相对链接解析测试（7 项）
- `src/stores/jsonStore.ts` — 解析序号守卫、命中按路径重映射、格式化跨标签保护、
  脏文件不覆盖、批量替换防抖清空、最近文件累加器、替换后定位下一处、
  大小写长度保持折叠、`switchTab` 清理查询结果、删除死导出
- `src/stores/settingsStore.ts` — 设置读写错误不再产生未处理的 Promise 拒绝
- `src/stores/searchStore.ts` — 批量替换沿用搜索时的大小写与查询词、失败文件上报
- `src/features/SourceEditor.tsx` — 选中样式类名、制表位与高亮层对齐
- `src/features/MarkdownPreview.tsx` — 相对链接可点击（解析到当前文档目录后在应用内打开）
- `src/features/SearchResultsPanel.tsx` — 文档标识统一、行号二分、指针监听器清理、快捷键提示修正
- `src/features/QueryPanel.tsx` — 节点索引改为 `Map`
- `src/features/SettingsPage.tsx` — 待提交勾选状态、`busy` 期间禁用勾选
- `src/components/MenuBar.tsx` — Esc 捕获阶段阻断、菜单数组真正 memo 化
- `src/components/SidePanel.tsx` — 指针监听器补 `pointercancel`
- `src/App.tsx` — 定位目标的文档标识统一、查找栏关闭时 F3 仍可跳转、版本号 0.2.2
- `src/styles/index.css` — 选中文字不再重影、Markdown 列表与任务列表样式
- `package.json` — 版本号 0.2.2

**文档**

- `docs/CHANGELOG.md` — 新增：全部版本的变更汇总
- `docs/README.md` — 新增：文档索引、写作规范、发版检查清单
- `docs/PLAN-v0.2.2.md` — 新增：需求计划
- `docs/RELEASE-v0.2.1.md` — 新增：补齐 v0.2.1 发行说明
- `docs/RELEASE-v0.2.2.md` — 新增：发行说明
- `docs/AUDIT-v0.2.2.md` — 新增：本报告
- `docs/DESIGN-PLAN.md` — 更新状态说明，指向最新文档
- `README.md` — 版本号、下载链接、项目结构、功能表
