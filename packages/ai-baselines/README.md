# @poker/ai-baselines

历史 AI 策略基线的统一入口。过渡期设计（2026-10-25 起）：

- **存量基线**仍位于 `packages/engine/src/ai-XXXX/`；本包 `src/index.ts` 只做显式 re-export，engine 根导出保留作兼容。
- **新提取的基线**直接放入 `src/ai-XXXX/`，从 `git archive` 原样落地，不改写 import。
- `src/` 根下的 6 个 shim（`types.ts`、`model.ts`、`pattern/`、`comparing/`、`following/`、`leading/`）把快照里的 `../xxx.js` 映射到 `@poker/engine` 的公开导出，保证快照文件逐字节保持原样。
- 消费方（arena）只从本包导入基线；**engine 不得反向依赖本包**。

每次提取新基线时归档一条最旧的存量基线；存量清零后本包成为唯一来源，届时删除 facade 行。

> 拉取本包后先跑一次 `npm install`：`node_modules/@poker/ai-baselines` 的工作区链接由它建立，`check-commits` 的 worktree 垫片也依赖该链接。
