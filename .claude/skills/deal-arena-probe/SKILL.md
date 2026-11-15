# Deal 竞技场 probe（先粗筛，再只统计实际改牌的发牌）

## 触发场景

- 任何策略/引擎改动要判断「是否更强」：先跑 2500 副全场景粗筛（第 0 节），再决定跑全场景确认还是 probe。
  **不要一上来就 probe。**
- 粗筛显示改动集中在窄分支（改判发牌占比小、但改判子集方向明确）时，用 probe 以远小于全量竞技场的样本判断。
- 需要确认「改动是否真的改牌」以及只在这批牌上算胜负。
- 策略类分析里的「该不该加分 / 为什么这么打」也可以先用 probe 定位命中面。

不要在以下场景用它：只看对局结果、不限定决策分支时，直接用 `arena` / `arena:deal`。

## 0. 粗筛与路由（先跑这个）

任何改动先花 2500 副全场景做一次粗筛。粗筛只用于分流，不是最终判据。

```bash
npm run arena:deal -- --min-deals 2500 --max-deals 2500 --seed <S1> \
  --strategy-a ai-latest --strategy-b <baseline> \
  --out /tmp/screen-<slug>.json
```

默认口径：6 个等级（2,5,10,Q,K,A）、固定 P0、无 filter。粗筛与后续正式 run 必须同口径；
改动涉及其他庄位或长套时，显式加 `--declarer-seats` / `--deal-filter`，并让后续步骤保持一致。

读数用 JSON 里的 `stats.dealOutcome`（**不要用 `outcome.pHat`**）：

- `n = outcome.n`，`a/b/draw = stats.dealOutcome`
- `pA = (a + 0.5*draw) / n`（A 的分数；`outcome.pHat` 是 leader 的分数）
- `d = (a + b) / n`（改判发牌占比）
- `n_sub = a + b`，`q = a / n_sub`
- `q_90LB = wilsonInterval(a, n_sub, 1.282).lower`（单侧 90%）

分流：

1. `leader === 'B'` 或 `pA <= 0.5` → 停，报告无收益/回归。
2. `n_sub < 50`：
   - 纯注释/类型/重构，或明确不会改变决策 → 停。
   - 否则跑小 pilot：1000 副、新 seed、6 级、P0、无 filter、`--probe-check 1000`。
     - `affectedDeals === 0` → inert，停。
     - `affectedDeals > 0` → 只报告 `affectedRate`、`p̂_aff`、受影响发牌 A/B/平；**不自动升级**，
       正式 probe 由用户手动授权。
3. `n_sub >= 50` 且 `q_90LB > 0.5`：
   - `d >= 0.10`（影响面宽）→ **全场景分支**：

     ```bash
     npm run arena:deal -- --min-deals 2500 --max-deals 20000 --seed <S2> \
       --strategy-a ai-latest --strategy-b <baseline> \
       --out packages/arena/results/deal-arena-<slug>-confirm.json
     ```

     显著即停；到 20000 仍未显著 → 报告 `pA`、`n_F`、所需样本，不自动 probe。这是正式运行。
   - `d < 0.10`（集中改动）→ **probe 分支**：
     1. probe pilot：2500 副、新 seed S2、6 级、P0、无 filter、宽条件、`--probe-check 600`。
        读 `probe.affectedDeals`、`affectedRate = affectedDeals / acceptedDeals`、`p̂_aff`。
        `p̂_aff <= 0.5` → 报告并停（子集内无方向性证据）。
        否则估算 `n_aff`、`total_est` 写进报告，继续第 2 步。
     2. 正式 probe：`--min-deals 10000 --max-deals 20000`、新 seed S3、同条件、`--probe-check 600`。
        达到 10000 副后，受影响发牌显著（99% Wilson 下界 > 0.5）即早停；到 20000 未显著 →
        报告并等手动授权，不扩大样本。这是正式运行。
4. `n_sub >= 50` 且 `q_90LB <= 0.5` → 停，报告「2500 副内改判子集无方向性证据，低于 2500 分辨率」，
   不 probe（宽而弱）。若 diff 明确指向稀有分支、2500 副没碰到，改走第 2 条的小 pilot。

估算公式（诊断用）：

- `n_F ≈ ceil((2.576*0.5/(pA-0.5))^2)`：全场景显著所需发牌。
- `p̂_aff = (dealA + 0.5*dealDraw) / affectedDeals`（A 的分数；`dealSignificance.pHat` 是 leader 的）。
- `n_aff ≈ ceil((2.576*0.5/(p̂_aff-0.5))^2)`；`total_est ≈ ceil(n_aff / affectedRate)`。

统计边界：

- q 的 90% 检验只做 triage：它条件在「结果已改变」上，可能高估分支效应；**不是项目 99% 判据，
  不能写进 Changelog 的显著性**。
- 固定 0.5030 已废弃：它只约等于 `d≈5.6%` 时的 90% 粗筛值，不是通用门槛。
- `d` 是「改判发牌占比」，不是 probe 的「实际改牌率」；两者不可混用。

Seeds 与记录：

- **每次新开竞技场都换 seed**；粗筛、pilot、正式 run 各不相同。
- **只有正式 run**（全场景确认或正式 probe）的结果写 Changelog；粗筛、a/b 初判、pilot 都不写。

## 能力

- `arena:deal --probe-module PATH`：A 侧包装器只在 `hit(decision)` 命中时再调用 B 并比较牌；
  只有「实际改牌」的发牌/三元组进入 probe 统计。
- 早停：达到 `--min-deals` 后，若受影响发牌的 99% Wilson 下界 > 0.5，样本阶梯提前停止。
  这是 leader 口径——B 领先也会停（有害改动无需继续），报告与采纳前必须检查 `leader === 'A'`
  或直接算 A 的分数。
- `--probe-check N`：正式跑前在前 N 副对**每个决策**同时查询 A/B，统计：
  - 真阳性：改牌且命中
  - **假阴性：改牌但未命中（必须为 0）**
  - 假阳性：命中但同牌（无害，只说明条件偏宽）
  - 真阴性
  假阴性 > 0 时 arena 打印样例并以非零码退出。
- probe 统计跨 worker 合并，最终写入结果 JSON 的 `probe` 字段，并在控制台打印：
  命中 / 实际改牌 / 受影响发牌与三元组 / A-B-平 / 发牌 p̂ 与 99% Wilson 下界 / 三元组胜率 / 均值 tier、pts。
  三元组的 99% Wilson 也会打印，但仅作诊断——三元组之间不独立，不是显著性单位。

条件模块是**一次性**的（每次改动的分支不同），放 `/tmp`，不提交。

## 口径（必须遵守）

1. **基线**：写进 Changelog 的数据必须用该提交在 main 上的**父提交**作 B；合成基线（A 去掉某处改动）
   只用于探索，Changelog 不写，或明确标注不可从 main 复现。
2. **覆盖**：一个提交里有多处行为改动时，条件必须覆盖全部改动的并集；窄条件会把真实改牌漏掉（假阴性）。
3. **只统计实际改牌**：A/B/平在受影响发牌/三元组上算；**显著性只对受影响发牌**（发牌是独立单位；三元组共享牌局，不独立）。全量 arena 的数字是另一个口径，别混用。
4. **固定预算**：正式 probe `--min-deals 10000 --max-deals 20000`，到上限即停；未显著但有趋势时
   报告趋势与样本，**不扩大样本**。严格固定预算时用 `--min-deals = --max-deals`（逐次检查的 99% 是名义值）。
   判据：99% Wilson 下界 > 0.5。
5. **A==B 冒烟**：先跑 `--strategy-a ai-latest --strategy-b ai-latest`，probe 的「实际改牌」必须为 0。

## 步骤

### 1. 锁定行为差异

```bash
git log --oneline <main 父提交>..HEAD
git diff <main 父提交>..HEAD --stat
git diff <main 父提交>..HEAD -- packages/engine/src/ai-latest
```

列出所有可能改牌的决策路径（领出/跟牌/对子/拖拉机/无主）。基线 = 该提交在 main 上的父提交，
用 `git merge-base --is-ancestor <sha> origin/main` 确认可达。

### 2. 准备基线策略

- 基线已是注册策略（`ai-XXXX`）→ 直接 `--strategy-b ai-XXXX`。
- 否则从提交解出临时快照并注册（**不提交**）：

```bash
rm -rf /tmp/base-ai && mkdir -p /tmp/base-ai
git archive <baseline-sha> packages/engine/src/ai-latest | tar -x -C /tmp/base-ai
rm -rf packages/engine/src/ai-probe-base
cp -R /tmp/base-ai/packages/engine/src/ai-latest packages/engine/src/ai-probe-base
```

在 `packages/arena/src/strategies.ts` 加一个临时 adapter 和 `strategyByName` 分支（名字如 `probe-base`）。
注意：arena 的 `rootDir` 不覆盖 `../../engine/src/...`，临时注册期间 `npm run typecheck` 会报 TS6059，
属预期；收口时撤销。

### 3. 粗筛与分流

按第 0 节跑 2500 副粗筛并计算 `pA / d / n_sub / q_90LB`。只有路由到 probe 分支才继续第 4 步；
路由到全场景或停止时，不要为了「顺手」再跑 probe。

### 4. 写临时条件模块

放到 `/tmp/poker-probe-<slug>.ts`（tsx 支持 TS 动态 import）。模板：

```ts
import { isTrump } from '/Users/jia/Documents/project/poker/packages/engine/src/model.ts';
import type { ProbeDecision } from '/Users/jia/Documents/project/poker/packages/arena/src/probe.ts';

export const name = 'second-seat-single-trump';
export function hit(d: ProbeDecision): boolean {
  if (d.kind !== 'follow') return false;
  if (d.config.playCount !== 1) return false;      // 第二家
  if (d.leadCards.length !== 1) return false;      // 单张领出
  const myTrump = d.hand.filter(c => isTrump(c, d.config));
  return myTrump.length >= 2;                       // 宁宽勿窄；fast path 单张主牌不受策略影响
}
```

要点：

- `d.kind` 为 `'lead'` 或 `'follow'`；`d.leadCards`、`d.leadSuit`、`d.config`（AIContext）都可用。
- 条件只负责圈定「可能改牌」的决策面；改牌与否由 arena 实际比较 A/B 的牌决定。
- **宁可宽**：假阳性无害（同牌不计入受影响样本）；窄条件会漏判（假阴性），统计直接失真。

### 5. 自检

```bash
npm run arena:deal -- --min-deals 250 --max-deals 250 --seed 0x... \
  --strategy-a ai-latest --strategy-b <baseline> \
  --probe-module /tmp/poker-probe-<slug>.ts --probe-check 600 --workers 4 --no-json
```

- 假阴性必须为 0；有样例会打印发牌号、墩、座位、手牌与 A/B 出牌。
- `--probe-check 600` 在 6 级下约 100 个牌组；小 pilot（1000 副）用 `--probe-check 1000`。
- 自检前缀没碰到稀有分支不代表覆盖：必要时加大 `--probe-check N`，或先看命中数。
- `--probe-check 0` 只用于调试，正式测量不要跳过。

### 6. 正式跑（10k–20k，允许早停）

```bash
npm run arena:deal -- --min-deals 10000 --max-deals 20000 --seed <S3> \
  --strategy-a ai-latest --strategy-b <baseline> \
  --probe-module /tmp/poker-probe-<slug>.ts --probe-check 600 \
  --workers 2 --out packages/arena/results/deal-arena-<slug>-probe.json
```

- 必须显式写 `--strategy-b`（默认值通常不是你要的基线）。
- 达到 `--min-deals` 后，受影响发牌显著即停；到 20000 未显著也停，不自行加样本。
- `--workers` 可用；probe 统计跨 worker 合并，注意 worker 数一般不超过开发机物理核数。
- 中断会写 `"partial": true` 的 JSON，probe 统计包含已跑部分；固定预算重跑用同一 seed。
- 正式 run 的 seed、等级、庄位、filter、样本量、发牌 p̂/CI 写 Changelog；三元组只写胜率，不写下界/显著性；pilot 不写。

### 7. 读结果

控制台：

```
Probe: /tmp/poker-probe-xxx.ts (name)
  命中 …, 实际改牌 …；受影响发牌 …/…，三元组 …
  发牌 A/B/平 …  p̂=…  99% 下界 …  显著/未显著
  三元组 A/B/平 …  胜率 …（控制台仍会打印 CI，仅诊断，不作结论）
  均值 tierNorthStar …  ptsNorthStar …
```

JSON 的 `probe` 字段同时含 `check`（自检计数与假阴性样例）与 `dealSignificance` / `tripleSignificance`。
`tripleSignificance` 仅作诊断：三元组不独立，不能用于结论或写进 Changelog；Changelog 只写三元组胜率。
`dealSignificance.pHat` 与 `ciLower` 是 **leader** 口径；要报告「A 是否更好」，用
`p̂_aff = (dealA + 0.5*dealDraw) / affectedDeals` 与 `leader` 一起判断。

### 8. 写 Changelog

```markdown
**验证（只统计实际改牌的发牌）**：发牌竞技场 A=改动后 ai-latest，B=main 上一提交（YYYY-MM-DD HH:MM 的…）的 ai-latest（临时副本，逐字节相同），seed `0x…`，6 个默认等级（2/5/10/Q/K/A），固定 P0，无 filter，N 副；条件命中 X 次，实际改牌发牌 Y 副（Z%）、受影响三元组 W 个。发牌多数决 A/B/平 = …，p̂=…，99% Wilson 下界 …，显著/未显著；受影响三元组 …，胜率 …（三元组不独立，仅报胜率）；均值 tierNorthStar …、ptsNorthStar …。
```

- 只写正式 run；粗筛、a/b 初判、probe pilot 的数字不进 Changelog。
- **不写提交哈希**（S11），用日期指代历史。
- 未显著但有趋势：写清预算、p̂、下界与已测样本，不扩大样本，不重测 Elo（若刻度行已是「待重测」）。

### 9. 收口清理

- 把本任务生成的 `/tmp/poker-probe-*.ts`、临时快照目录移到废纸篓（`~/.Trash/`），不直接 `rm`；
  任务开始前已存在的文件不动。
- 撤销 `packages/arena/src/strategies.ts` 的临时注册。
- `git status` 只剩原有未跟踪文件；重跑 `npm run typecheck` 与 `npm run test:all`。

## 注意事项（踩过的坑）

- **先粗筛再 probe**：2500 副全场景都看不出改判子集有方向性时，probe 通常也救不回来；
  宽而弱的改动应停下报告，而不是换更窄的条件重跑。
- **q 的 90% 检验只做 triage**：不是项目 99% 判据，不能写进 Changelog 显著性。
- **三元组不独立**：三元组共享牌局与决策，不能当独立样本做显著性；项目判据只对发牌。
  Changelog 只写三元组 A/B/平与胜率，不写下界或「显著/未显著」。
- **2500 副的单位是（牌组 × 等级）**：6 级约 417 个牌组，跨级之间相关；`n_F / q` 只作规划参考。
- **两种「受影响」不可混用**：probe 的受影响子集是决策级、在结果之前定义；a/b 的 q 是结果级、
  在结果之后，可能高估分支效应。
- **早停是逐次检查**：99% 是名义值；需要严格固定预算时用 `--min-deals = --max-deals`。
- **基线必须在 main 上**：历史重排后旧提交会失效；用父提交做对比，否则 Changelog 数字不可复现。
- **多改动提交**：例如同时含「能盖过才出最大」和「按结构选牌」时，条件要覆盖两者；
  只写「盖不过分支」会漏掉前者（假阴性）。
- **`--probe-check` 必要但不充分**：它只检查前 N 副；稀有分支可能没出现。看命中数，必要时加大 N。
- **临时注册会导致 typecheck 报 TS6059**：arena 的 `rootDir` 不覆盖 engine 源码；这是临时状态，别提交。
- **默认 `--strategy-b` 不是你的基线**：必须显式指定。
- **A==B 冒烟**：实际改牌必须为 0，否则说明条件/包装器有问题。
- **不要用多个 seed 挑显著的**：先定预算与 seed，到上限即停。
