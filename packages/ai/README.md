# @poker/ai

历史 AI 策略基线的统一入口。过渡期设计（2026-10-25 起）：

- **存量基线**仍位于 `packages/engine/src/ai-XXXX/`；本包 `src/index.ts` 只做显式 re-export，engine 根导出保留作兼容。
- **新提取的基线**直接放入 `src/ai-XXXX/`，从 `git archive` 原样落地，不改写 import。
- `src/` 根下的 7 个 shim（`types.ts`、`model.ts`、`pattern/`、`comparing/`、`following/`、`leading/`、`revealing/`）把快照里的 `../xxx.js` 映射到 `@poker/engine` 的公开导出，保证快照文件逐字节保持原样。
- 消费方（arena）只从本包导入基线；**engine 不得反向依赖本包**。

每次提取新基线时归档一条最旧的存量基线；存量清零后本包成为唯一来源，届时删除 facade 行。

## 当前策略的前向导出（shim）

`src/ai-latest/index.ts` 是**前向兼容 shim**：它把当前策略的公开 API（`aiTryReveal`、`aiLeadPlay` 等，以及 `AIContext` 等类型）从 `@poker/engine` 转出，供 arena / cli / client 从 `@poker/ai` 导入。**真实策略代码仍在 `packages/engine/src/ai-latest/`，不要在这个 shim 或本包里改策略**。物理搬迁时，`src/ai-latest/` 由真实代码整体替换，包根 `index.ts` 无需改动；engine 新增 AI 导出时要同步补 shim 的清单。

> 拉取本包后先跑一次 `npm install`：`node_modules/@poker/ai` 的工作区链接由它建立，`check-commits` 的 worktree 垫片也依赖该链接。
