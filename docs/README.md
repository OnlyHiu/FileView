# FileView 文档索引

`docs/` 下的文档按「**每个版本三件套 + 全局索引**」组织，
版本号与 `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` 严格一致。

## 全局索引

| 文件 | 作用 | 更新时机 |
|---|---|---|
| [`CHANGELOG.md`](./CHANGELOG.md) | 全部版本的变更汇总（版本控制的唯一索引）| 每次发版追加一节 |
| [`DESIGN-PLAN.md`](./DESIGN-PLAN.md) | 项目最初的设计计划（v1.0 愿景，仅作演进背景）| 极少更新 |
| `README.md`（本文件） | 文档导航与写作规范 | 文档结构变化时更新 |

## 版本三件套

| 版本 | 需求计划 | 发行说明 | 代码审核 |
|---|---|---|---|
| **v0.2.2** | [PLAN-v0.2.2.md](./PLAN-v0.2.2.md) | [RELEASE-v0.2.2.md](./RELEASE-v0.2.2.md) | [AUDIT-v0.2.2.md](./AUDIT-v0.2.2.md) |
| v0.2.1 | —（并入 v0.2.2 计划） | [RELEASE-v0.2.1.md](./RELEASE-v0.2.1.md) | — |
| v0.2.0 | [PLAN-v0.2.0.md](./PLAN-v0.2.0.md) | [RELEASE-v0.2.0.md](./RELEASE-v0.2.0.md) | [AUDIT-v0.2.0.md](./AUDIT-v0.2.0.md) |

> v0.2.1 的需求与审核记录分散在提交历史中，此处补齐发行说明作为索引。

## 写作规范

1. **文件名**：`{PLAN,RELEASE,AUDIT}-v{主}.{次}.{修订}.md`，版本号用三位（`v0.2.2`）。
2. **文档头**：标题写明「文件名 + 版本」，随后一行摘要 + 发布日期 / 上一版本。
3. **结论先行**：每份文档先给结论（做了什么 / 结论是什么），再展开细节。
4. **可验证**：所有「已修复」的缺陷都附**具体输入 → 期望 → 实际**的实测结论，
   并配套一条自动化测试（前端 `src/lib/*.test.ts`，后端 `cargo test`）。
5. **交叉引用**：文档之间用相对链接互链（`./xxx.md`），
   README 的「项目结构」一节必须同步更新。
6. **不夸大**：文档描述必须与实现一致；发现偏差时**先改文档或改实现**，
   再在「审核修正」一节记录取舍，不留「文档声称但未实现」的描述。

## 提交与发版流程

```bash
npm test                      # 前端纯逻辑测试
cd src-tauri && cargo test    # 后端测试
npm run build                 # 类型检查 + 前端构建
npm run tauri:build           # 打包 exe + MSI（WiX 官方工具链）
```

发版检查清单：

- [ ] `package.json` / `Cargo.toml` / `tauri.conf.json` / `Cargo.lock` 版本号一致
- [ ] `src/App.tsx` 的 `APP_VERSION` 与设置页「关于」一致
- [ ] README 下载链接指向新版本安装包
- [ ] `docs/` 下该版本的 PLAN / RELEASE / AUDIT 齐备
- [ ] `CHANGELOG.md` 追加新版本小节
- [ ] `docs/README.md` 的版本表格同步
