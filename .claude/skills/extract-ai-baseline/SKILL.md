---
name: extract-ai-baseline
description: 把某历史提交时刻的 AI 策略冻结为竞技场基线（ai-XXXX，如 ai-0808）——提取快照、注册引擎与竞技场、补合法性测试、更新 README；归档旧基线时同步移除 elo-matches.json 中该基线的全部记录。参照 45c22df（ai-0802）与 3e84b1c（ai-0808）的既有流程。
---

# 提取历史 AI 策略基线（ai-XXXX）

## 触发场景

当前 `ai/` 策略经过多次修复后，需要把某历史提交时刻的策略冻结为基线（`ai-0719`/`ai-0801`/`ai-0802`/`ai-0808` 模式），供竞技场 `--strategy-a/b` 对比。

## 命名

- 按来源提交的**日期**命名：`ai-MMDD`（如 133900d 是 08-08 → `ai-0808`）。
- 目录：`packages/engine/src/ai-XXXX/`；命名空间：`aiXXXX`；竞技场策略名：`ai-XXXX`。

## 操作步骤

1. **确认来源提交**（策略冻结点）与文件数：

   ```bash
   git ls-tree --name-only <commit> packages/engine/src/ai/
   git show -s --format="%h %ai %s" <commit>
   ```

2. **提取快照**（必须在仓库内执行，`/tmp` 下 git archive 需 `--output`；不能复制当前 ai/）：

   ```bash
   mkdir -p /tmp/ai-extract && git archive --output=/tmp/ai-XXXX.tar <commit> packages/engine/src/ai
   tar -xf /tmp/ai-XXXX.tar -C /tmp/ai-extract
   mv /tmp/ai-extract/packages/engine/src/ai packages/engine/src/ai-XXXX
   ```

3. **注册引擎命名空间导出**（`packages/engine/src/index.ts`，注释注明来源提交与语义）：

   ```ts
   export * as aiXXXX from './ai-XXXX/index.js'; // ai/ as of <commit> (YYYY-MM-DD), <语义>
   ```

4. **注册竞技场策略**（`packages/arena/src/strategies.ts`）：import 命名空间 + `aiXXXXStrategy`（四方法委托）+ `strategyByName` 分支 + 抛错信息可选列表。

5. **补合法性测试**（`packages/arena/src/__tests__/historical-strategies.test.ts`）：import 策略，加用例——`playMatch({ seed: 42, pairIndex: [N, N+1], strategies: [aiXXXXStrategy, engineStrategy], captureEvents: true })`，断言 `abortedHands === 0` 且所有事件 `errors === 0`。pair 号用未占用的（现有：0719=8,9；0801=4,5；0802=10,11；0808=12,13）。

6. **更新 README**（中英文同步）：
   - 基线列表（Historical baselines / 历史基线策略）：加 `ai-XXXX`（日期 + 语义说明）
   - Elo 表：**提取时刻的 Elo 归新基线行**；当前 `ai` 行标注 `—（待重测）`（如果 ai 之后有更新）
   - `--strategy-a NAME` 参数说明两处（英文表 + 中文表）

7. **类型检查**：`cd packages/engine && npx tsc --noEmit`。历史快照可能含旧代码的编译错误（如 ai-0808 的 helpers.ts TS2367 死代码比较）——**同步死代码清理**（注释注明"行为与 <commit> 快照一致，仅消除 TS2367"），不得做其他修改（基线必须保留历史行为）。

8. **验证与提交**：
   - `npm run test -w packages/engine` / `-w packages/arena`（arena 总数 +1）
   - 提交类型 `feat:`；提交信息含测试数行（`新增 1 项测试，引擎 X 项 + arena X 项 + CLI X 项 + client X 项 = X 项通过。`）
   - **Changelog 时间 = 提交时刻**（写 Changelog 前先 `date "+%Y-%m-%d %H:%M"`，或用提交后的 author date 对齐）

## 归档基线（与提取成对）

「归档」= **从代码库移除**（不是移进某个归档目录）。提取新基线后通常在同一次提交里归档最旧的一条，基线总数保持不变。

要动的六处：

1. 删除 `packages/engine/src/ai-XXXX/`。
2. `packages/engine/src/index.ts`：删命名空间导出，并把名字写进「archived & removed」注释（日期用当天）。
3. `packages/arena/src/strategies.ts`：删 import、`aiXXXXStrategy`、`strategyByName` 分支与抛错信息里的可选列表。
4. `packages/arena/src/__tests__/historical-strategies.test.ts`：删该基线的合法性用例。
5. **`packages/arena/scripts/elo-matches.json`：删掉所有 `a` 或 `b` 等于该基线名的行**——两个方向的边都要删，不能只删一侧。删完运行 `npx tsx packages/arena/scripts/elo-calc.ts`，确认剩余图仍连通、锚点仍能解出（矩阵奇异会直接报错）；若归档的恰好是 `ANCHOR`，先按 Elo 章节的决策流程换锚点，不能直接删。README 的 Elo 行可以保留展示（历史分数），但 JSON 里的测量记录不再保留。
6. README（中英同步）：从「历史基线策略」列表移入「已归档移除」（日期用当天），`--strategy-a` 可选列表去掉它。

Changelog 的「影响文件」必须列 `packages/arena/scripts/elo-matches.json`；不要再写「elo-matches.json 的边保留不动」——旧约定已废止。

## 注意事项

- 提取必须用 `git archive` 精确还原历史文件（含当时的 STRATEGY.md），不要复制当前 ai/ 目录。
- 基线代码只允许两类改动：编译错误清理（死代码，行为不变）与注释。任何行为修改都会污染基线对比。
- README 的 Elo 归属是易错点：提取时刻测量的是"当时的 ai"，提取后该分数归新基线名；当前 ai 若已有策略变更则标"待重测"，不要沿用旧分数。
- 竞技场测试的 pair 号避免与现有基线重复（可查测试文件）。
