---
name: elo-measure
description: README Elo 表的失效判定与重测——改动波及哪一行或整张表，如何用 run-elo-matchups.ts 跑镜像对决、回填 elo-matches.json，再用 elo-calc.ts 拟合与填表。
---

# Elo 失效判定与重测

## 触发场景

- 改动了可能改变 AI 决策或牌局结算的代码，需要判断 README 中英「现行刻度」表哪些格改 `待重测`。
- 实际重测并回填分数。

## 失效范围

| 改了什么 | 失效范围 | 处理 |
|---|---|---|
| `packages/engine/src/ai-latest/` 策略代码 | 仅 `ai-latest` 一行 | 该格改 `待重测`；基线行与锚点不动 |
| 共享引擎代码——`model.ts`、`pattern/`、`comparing/`、`following/`、扣底/升级、发牌 | **整张表**（含锚点） | 全表重测；口径变了另开一表 |
| 冻结快照 `ai-XXXX/` | 该基线 | 不应改动——快照是 `git archive` 产物 |
| 策略接线（`packages/arena/src/strategies.ts`） | 被改接线的那些行 | 名字必须继续指同一份代码；换实现 = 换策略 |
| 测量口径（`run.ts`、镜像对局、平局按 0.5、n 局数） | `MATCHES` 全部 p̂ | 重跑对局、重填 `MATCHES` |
| `ANCHOR` / `ANCHOR_ELO` | 整张表（构造上） | 只在有意改刻度时动 |

判据是「行为是否可能改变 AI 决策或牌局结算」，不是「是否动了 engine 目录」：纯注释、纯类型、测试、无行为变更的重构、尚未接线的导出函数不必改标。**拿不准就改标**。

## 重测步骤

1. 编辑 `packages/arena/scripts/elo-matchups.json`（本地实验配置，不入库）：`{ "seed": <n>, "matchups": [["a", "b"], …] }`。
2. `npx tsx packages/arena/scripts/run-elo-matchups.ts`——逐组跑竞技场，把 a 对 b 的**含平局胜率**写回 `elo-matches.json`（同 `(a, b)` 覆盖，新对追加）。
3. `npx tsx packages/arena/scripts/elo-calc.ts`——输出各策略 Elo 与拟合残差。
4. 填表：新拟合值与表中原值**只差 1** 时保留原值；差 ≥2 才改。README 中英两处同步。
5. 提交：`elo-matches.json` 是数据文件，不写 Changelog；提交标题写明测量日期。

## 锚点

`ANCHOR`（锚点策略名）与 `ANCHOR_ELO`（其分数）是刻度唯一的自由参数，留在 `elo-calc.ts`。换锚点/重定刻度是**决策**，只在有意改刻度时动，且按代码提交；归档锚点策略前先换锚点，不能直接删（矩阵奇异会报错）。

## 不影响

CLI / GUI 改动不影响 Elo——竞技场在 Node 里直接跑引擎，不经前端。
