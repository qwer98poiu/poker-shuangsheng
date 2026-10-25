# 双升 (Shēng Jí) · Tractor Card Game

<p align="center">
  <strong>English</strong> | <a href="#中文">中文</a>
</p>

A full-stack implementation of the Chinese trick-taking card game **双升 (Shēng Jí / Tractor)**, featuring a deterministic game engine, an NT-mode (无主) trump tracker, and a rule-based AI opponent.


## Game Rules

双升 is played with 4 players in two fixed partnerships (cross-seated), using **two standard 54-card decks** (108 cards total, including 4 jokers).

### Setup

- Each player is dealt 25 cards; **8 cards** go to the bottom (底牌) reserved for the declarer.
- In the **bidding phase**, players declare a trump suit and strength (single or pair of level cards, or joker pair for NT). The last (highest) bidder becomes the **declarer (庄家)** and claims the bottom cards.

### Trump

- The **level cards** of the current game level (e.g., all 2s when playing level 2) are trumps, plus all four jokers.
- The trump rank order (high to low): **Big Joker > Small Joker > level cards** (of the trump suit if suited, or all four suits in NT mode).
- In **NT (无主) mode**, there is no trump suit — only the 12 constant trump cards are trumps: 2 Big Jokers, 2 Small Jokers, and 2 level cards per suit.

### Play

- Tricks proceed counter-clockwise. Players must **follow suit** if possible.
- If void in the led suit, a player may **trump (毙牌)** with a trump card, or discard any off-suit card.
- The highest trump (or the highest card of the led suit if no trump is played) wins the trick.
- The trick winner leads the next trick.

### Patterns

Cards are played in patterns that must be **matched** by subsequent players:

| Pattern | Example | Follow Rule |
|---|---|---|
| Single | ♥K | Must match suit if possible |
| Pair | ♠5♠5 | Must play a pair of the same pattern |
| Tractor (拖拉机) | ♦10♦10♦J♦J | Two or more consecutive pairs of the same suit |

### Scoring

- **5s** are worth 5 points, **10s** and **Ks** are worth 10 points each.
- The declaring team aims to prevent the opposing team from collecting points.
- The opposing team's score at the end of a round determines whether the level advances or the deal passes (升级/下台).

### Advancement

| Opponent Score | Result |
|---|---|
| 0 | Declarer advances 3 levels (三级跳) |
| 5–35 | Declarer advances 2 levels (两级跳) |
| 40–75 | Declarer advances 1 level |
| 80–115 | Opponents become declarers (下台) |
| ≥120 | Opponents advance 1 level (升级) |
| ≥160 | Opponents advance 2 levels |

## Repository Overview

- **Engine** ([`packages/engine`](packages/engine/)) — Core game logic: card types, pattern classification, trick comparison, validation, AI strategies, and NT trump tracking (count-based deduction).
- **AI baselines** ([`packages/ai-baselines`](packages/ai-baselines/)) — Historical AI strategy snapshots behind one facade; legacy snapshots still live in `engine` during the transition, while newly extracted baselines land here verbatim.
- **CLI** ([`packages/cli`](packages/cli/)) — Terminal-based interactive play with full-color card display.
- **Client** ([`packages/client`](packages/client/)) — React + Vite web frontend with Zustand state management (playable: south-seat human vs 3 AIs, or 4-AI spectator).
- **Arena** ([`packages/arena`](packages/arena/)) — Headless strategy tournament: mirrored full matches (2→A, with 必打 K/A) and a per-deal arena (configurable declarer seats × three legs; fixed P0 by default), 99%-CI significance testing, and 17+ technical metrics.

### NT Trump Tracker

In NT (no-trump) mode, 12 constant trump cards (Big Joker × 2, Small Joker × 2, level cards × 8) are tracked via a count-based deduction system that infers possible holdings from played cards, reveals, and pair-failure deductions — without peeking at other players' hands.

## Strategy Arena

`packages/arena` pits two AI strategies against each other over full matches (2→A) to decide, at 99% confidence, whether one wins significantly more than the other.

- **Mirror pairs (对决)** — One 对决 = two matches: strategy A sits seats 0&2 in one, strategy B sits 0&2 in the other. Both matches share the same decks (hand i of both matches uses the same deal), so P0 holds identical 25 cards in both — different strategies still produce different trumps, upgrade pacing, and outcomes.
- **必打 K/A** — Levels K and A must be *won while banker* to pass: a 闲家 taking over at K stays at K; the banker winning at A ends the match. Takeover/advancement both use the attacker's final points including the bottom (抠底).
- **Significance** — p̂ = (wins + 0.5×draws)/n; the 99% Wilson lower bound must exceed 0.5. Checks begin at the minimum sample (2×pairs) and repeat every `stepMatches` matches; the run stops immediately once significant. A draw exists only at the **mirrored-pair** level: a pair whose two legs split 1-1 gives each side one win and one loss (0.5 wins per match). A single match always ends with a winner — the 200-hand cap's draw path has never fired (measured: 300 pairs / 600 matches, `drawn` = 0, 132 pairs split 1-1).
- **Dynamic progress target** — Before the minimum sample the progress denominator is fixed at 2×pairs; afterwards, if not yet significant, it projects the total matches needed under the current p̂ (rounded up to a `stepMatches` multiple), with the reason printed when it changes.
- **Progress & checkpoints** — A progress line every 100 matches (with ETA); every `stepMatches` matches the significance result is printed and `results/checkpoint.json` is written; Ctrl+C saves partial results and exits gracefully. No resume — every run starts from 0.
- **Upgrade log** — `--detail-pair N` prints the per-hand upgrade records of both mirrored matches side by side (same deck), showing banker side, both levels at hand start, attacker points, and the upgrade result.
- **Historical baselines** — `ai-0816` (2026-08-16, before the bottom-card strategy rewrite), `ai-0907` (2026-09-07, before the trump-kill single-card tier selection), `ai-0929` (2026-09-29, the NT pair-deduction fix — the Elo scale anchor), `ai-1005` (2026-10-05, the NT long-suit lead layer and the third-seat throw-add re-judge) and `ai-1018` (2026-10-18, before the team-split lead ladder rewrite; includes the 0a/0b loosening) were extracted from git history to PK against the current `ai`. They are imported through the `@poker/ai-baselines` facade; new baselines are added there, and each extraction archives the oldest legacy snapshot. (Archived: `ai-0707`, `ai-0712`, `ai-0726` — removed 2026-08-07; `ai-0801` and `ai-0719` — removed 2026-09-16; `ai-0808` — removed 2026-09-27; `ai-0809` — removed 2026-10-01; `ai-0802` — removed 2026-10-06; `ai-0927` and `ai-1002` — removed 2026-10-18. Elo scores below kept for reference.)
- **Strategy Elo ratings** — two scales, one per bottom-card convention (computed by `packages/arena/scripts/elo-calc.ts`; the anchor's score is set by `ANCHOR_ELO` in that script):
  - **Current scale** — measured after the 2026-09-16 fix; the declarer now decides the bottom from all 33 cards. Anchor: `ai-0929` = 1263.8 (shown rounded to integers). `ai-1005` is the 2026-10-05 state measured on 2026-10-09 (1271). `ai` diverged from it on 2026-10-12 (lead priority 0a) and 2026-10-18 09:12 (priority 0b) — preserved as `ai-1018` — and again on 2026-10-18 14:12 (the team-split lead ladder rewrite), on 2026-10-24 (declarer tier 4.5: lead trump tractors before generic 5; measured 1292 on seed 48), and again on 2026-10-24 20:33 (NT trump draw deferred to generic 9 when the level is not 5/10/K).

    | Strategy | Elo |
    |---|---|
    | `ai` (current) | 1297 |
    | `ai-1018` | 1279 |
    | `ai-1005` | 1271 |
    | `ai-1002` | 1267 |
    | `ai-0929` | 1264 |
    | `ai-0927` | 1252 |
    | `ai-0907` | 1231 |
    | `ai-0816` | 1145 |
    | `ai-0809` | 1123 |
    | `ai-0808` | 1102 |
    | `ai-0802` | 1083 |

    > **Note (2026-10-06):** `elo-calc.ts` no longer records the match count or weights by it.

  - **Legacy scale (bottom-card bug)** — ⚠️ every value below was measured while the AI declarer still chose its 8 discards from the **25 dealt cards**, before picking up the bottom. Those decisions were made on a strictly smaller option set, so these numbers are **not comparable** with the table above. The row named `ai-0802` is in fact `ai-0802-flawed`: the same code under the old convention, which the whole table was anchored to (= 1000).

    | Strategy | Elo |
    |---|---|
    | `ai-0802` | 1000.0 |
    | `ai-0801` | 992.2 |
    | `ai-0726` | 988.1 |
    | `ai-0719` | 895.3 |
    | `ai-0712` | 463.6 |
    | `ai-0707` | -528.5 |

## Quick Start

### Requirements

- **Node.js** ≥ 18
- **npm** ≥ 9

### Git hooks (pre-push)

`.githooks/pre-push` runs the gate before anything leaves your machine: the working-tree `npm run typecheck`, then `npm run test:all`, then the commit-series conformance check over the range being pushed. It installs itself — `npm install` runs `prepare`, which points `core.hooksPath` at `.githooks`. Bypass with `git push --no-verify`.

### CLI

```bash
npm install
npx tsx packages/cli/src/index.ts    # or: npm start -w packages/cli
```

The CLI is interactive: it prompts for the number of human players, debug mode, etc.

### GUI (client)

```bash
npm run dev                          # Vite dev server on http://localhost:3000
```

South-seat human vs 3 AIs, or toggle to 4-AI spectator mode on the setup panel. Dev shortcuts in the URL: `?seed=N` (deterministic deck), `?auto=1` (auto-start a 4-AI spectator match), `?speed=n` (divide animation delays by n).

Automated GUI verification (requires system Google Chrome; playwright-core connects to it):

```bash
npx tsx packages/client/scripts/ui-dump.ts --seed 42 --auto 1 --auto-tricks 3 --dump -   # text dump of DOM/layout/state
npx tsx packages/client/scripts/ui-smoke.ts --seed 42 --max-rounds 3                      # per-trick assertions + determinism fingerprint
```

> **Note:** Details are still being polished.

### Strategy Arena

```bash
npm run arena -w packages/arena -- --pairs 5000 --seed 42 --strategy-b ai-1018
# or from the repo root: npm run arena -- --pairs 5000 ...
```

| Flag | Default | Description |
|---|---|---|
| `--pairs N` | 5000 | Initial 对决 count (= 2N matches; the minimum sample) |
| `--until-significant` | — | Drop the minimum sample: stop at the first check that comes back significant (mutually exclusive with `--pairs`) |
| `--max-matches N` | 100000 | Match cap (must be ≥ 2×pairs) |
| `--step-matches N` | 1000 | Interval (in matches) for significance checks and checkpoints |
| `--seed N` | random | Random seed — same seed + flags reproduce identical results |
| `--workers W` | logical cores | Parallel child processes (1 = in-process) |
| `--strategy-a NAME` | `ai` | Strategy A (`ai` / `ai-1018` / `ai-1005` / `ai-0929` / `ai-0907` / `ai-0816`) |
| `--strategy-b NAME` | `ai-1018` | Strategy B |
| `--benchmark N` | — | Run N matches for speed measurement, then exit |
| `--detail-pair N` | — | Print the mirrored upgrade log of 对决 N, then exit |
| `--out PATH` | `results/arena-<ts>.json` | JSON report path |
| `--no-json` | — | Skip JSON export |

#### Deal arena

```bash
npm run arena:deal -w packages/arena -- --min-deals 2500 --seed 42
# or from the repo root: npm run arena:deal -- --min-deals 2500 ...
```

The unit is one **deal**. For every `(deal, level)`, each configured defender seat plays the same deck and level three times. The default is a **fixed P0 defender**; `--declarer-seats all` restores the four-seat rotation:

| Leg | Defender | Attacker | `finalPts` belongs to |
|---|---|---|---|
| `[A,B]` | A | B | B |
| `[B,A]` | B | A | A |
| `[B,B]` | B | B | B |

**Metrics**: two directions, both positive = A better. Upgrade uses `tier(x) = x === 0 ? -1 : ⌊x/40⌋`; points use the raw `finalPts`:

| Role | Upgrade | Points |
|---|---|---|
| Overall (AB vs BA) | `tier(pBA) − tier(pAB)` | `pBA − pAB` |
| Defender (AB vs BB) | `tier(pBB) − tier(pAB)` | `pBB − pAB` |
| Attacker (BA vs BB) | `tier(pBA) − tier(pBB)` | `pBA − pBB` |

Each metric is broken down by **scenario**: level (overall or one specific level) × trump (overall / suited / no-trump) × role (overall / defender / attacker). With level=overall, trump × role gives 9 rows. Multi-level runs add 3 trump rows per level (role=overall); a single-level run adds none (still 9 rows). Suited/no-trump eligibility checks the **two compared legs**: AB & BA for overall, AB & BB for defender, BA & BB for attacker. Mixed triples (e.g. AB suited, BB no-trump) only enter the "overall trump" row. A deal with no eligible triple is excluded from that scenario's denominator.

Each deal counts the signs of its eligible triples: more A → A wins the deal, more B → B, equal → draw. Upgrade significance is judged **per deal** (draws folded as 0.5). Point differences are averaged within each deal first, then paired across deals. Each configured defender seat contributes 1 mirror pair per level (3 小局): the default fixed P0 gives 6 pairs (18 小局) per deal with the default six levels, while `--declarer-seats all` gives 24 pairs (72 小局). With all four seats, a 13–11 split is an A win, not a draw, and 12–12 is a draw (the 6-pair default counterparts are 4–2 and 3–3). Fixed P0 is the default because the four seats' pair differences are essentially uncorrelated, while the deal-level majority test reaches a given precision with roughly one fifth of the hands; keep `all` as a position-effect diagnostic.

`--deal-filter long-suit` keeps a `(deal, level)` if any of the four players has an **off-suit** long suit (≥9 cards and ≥6 controls; a trump suit does not count). The candidate defender is evaluated with its 33-card pool (25 cards + 8 bottom) **before** the bottom exchange, so a long suit that disappears after the discard still keeps the deal. For each configured defender seat the filter uses that seat's `[B,B]` natural declaration; if any configured seat passes, the level is kept and those seats are played. This is a selection rule over the baseline declaration, not a guarantee that the A/B legs reveal the same trump. The predicate checks all four hands: the defender's hand is evaluated with the 33-card pool (25 + bottom), the other three at 25 cards. With the default fixed P0 only P0's pool includes the bottom, so the pass rate is lower than with `--declarer-seats all`.

The report has three tables. **净升级** lists A/B/draw proportions with integer numerators/denominators and a 99% deal-level significance column (`A` green, `B` red, otherwise `不显著`); its first row is `总体（核心）`. **得分差** lists the paired mean with `(numerator/denominator)` (numerator one decimal, denominator = deals contributing to that scenario) and a 99% significance column. **小局分析** is the old 80-point A/B table renamed, without the draw-rate column: only win-rate rows (overall, defender, attacker, and per-level win rates) get 99% significance; other rows show `—`. The progress line shows accepted deals and, only when non-zero, aborted hands; no triple count. The exported JSON stores the scenario aggregates; the internal per-deal win-rate buckets used for 小局分析 significance are not exported (they exist only in worker replies).

Aborted hands are **settled, not voided** (this applies to the general arena too): if the aborting player is on the attacker side, the hand settles at the points already won on completed tricks (no bottom); if on the defender side, the attackers are assumed to win the current and all remaining tricks — current-trick points + all four hands' points + bottom points × the best kou multiplier. The last trick cannot abort, so the current trick is never the last; the kou multiplier is taken from each attacker's remaining hand **separately** (the two hands are not merged, and their sizes may differ because the abort can happen mid-trick), with the higher multiplier winning. Equal multipliers add the same score, so no tie-break is needed. The report exposes `settledHands` by cause and per-strategy `abortCaused`.

| Flag | Default | Description |
|---|---|---|
| `--level LIST` | `2,5,10,Q,K,A` | Levels to play; `all` = 2..A |
| `--declarer-seats S` | `0` | Defender seats: `0` (fixed P0), `0,2`, or `all` (four-seat rotation) |
| `--deal-filter NAMES` | — | Built-in deal filters (`long-suit`) |
| `--min-deals N` | 2500 | Accepted deals required before the first significance check |
| `--until-significant` | — | Drop the minimum sample: stop at the first significant check (mutually exclusive with `--min-deals`) |
| `--step-deals N` | 250 | Significance-check interval and target rounding granularity |
| `--max-deals N` | 10000 | Accepted-deal cap |
| `--seed N` / `--workers W` / `--strategy-a NAME` / `--strategy-b NAME` / `--out PATH` / `--no-json` | as above | `--strategy-b` defaults to `ai-1018` |

As in the general arena, missing significance raises the target using the same `requiredMatchesForSignificance` projection, and Ctrl+C writes the partial report plus a `"partial": true` JSON before exiting. The old `arena:solo` / `arena:nt` commands have been removed.

Run tests:

```bash
npm run test -w packages/engine    # engine
npm run test -w packages/arena     # arena
npm run test -w packages/cli       # CLI
npm run test -w packages/client    # client
```

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.7 |
| Runtime | Node.js ≥ 18 |
| Engine | Pure logic, zero dependencies |
| CLI | tsx (TypeScript execute) |
| Client | React 18 + Vite + Zustand |
| Testing | Vitest 2.x |

## AI Strategy

The AI implements rule-based decision logic across all four play positions (lead, second, third, fourth), covering:

- **NT Second Position Seizing** — Seize control when partner's lead is weak and opponents can't beat bigger trump.
- **Point Dump Priority** — 10 > K > 5 when adding points, maximizing score potential.
- **Pair-Breaking Discipline** — Only break pairs when crossing a 40-point threshold (attackers); defenders never break pairs.
- **Follow-Offsuit Point Management** — Add points only when partner is winning; guard against opponent thresholds.

See [`packages/engine/src/ai/STRATEGY.md`](packages/engine/src/ai/STRATEGY.md) for the full strategy document (Chinese).

## License

MIT — see [LICENSE](LICENSE).

## AI-Generated Code Notice

> **This codebase is entirely generated by AI (Claude Code / DeepSeek) and reviewed by a human.** All logic, tests, and documentation are produced through iterative AI-assisted development with manual verification. Every commit has been inspected for correctness before merging.
>
> See [TOKENS.md](TOKENS.md) for cumulative token consumption.

---

<a id="中文"></a>

**双升（拖拉机）**纸牌游戏的完整实现：确定性游戏引擎、无主模式常主记牌器与规则驱动的 AI 对手。

## 游戏规则

双升是中国流行的四人两副牌升级类扑克游戏：**4 人**参与，对家固定组队，使用 **两副标准 54 张扑克牌**（共 108 张，含 4 张王牌）。

### 发牌与叫主

- 每人发 25 张，**8 张**留作底牌。
- 叫主阶段，玩家依次声明主牌花色和强度（单张级牌、级牌对子或王对无主）。最后叫牌者为**庄家**，获得底牌并换底。

### 主牌

- 当前打 **级牌**（如打 2 时所有 2）为主牌，外加全部 4 张王牌。
- 主牌大小：**大王 > 小王 > 级牌**（有主时主花级牌最大，无主时四花色级牌同级）。
- **无主模式**：没有主牌花色，仅 12 张常主为主——大王 × 2、小王 × 2、四花色级牌各 × 2。

### 出牌

- 逆时针出牌，必须**跟出**领出花色（有该花色时必须出）。
- 缺门时可**毙牌**（出主牌）或垫其他花色。
- 本轮最大主牌（或无主牌时领出花色最大者）赢得该墩，下一墩由其领出。

### 牌型

出牌需组成牌型，后续玩家必须**贴相同牌型**：

| 牌型 | 示例 | 要求 |
|---|---|---|
| 单张 | ♥K | 有同花色必须跟 |
| 对子 | ♠5♠5 | 必须出对子 |
| 拖拉机 | ♦10♦10♦J♦J | 同花色两组以上连续对子 |

### 计分

- **5** 计 5 分，**10** 和 **K** 各计 10 分。
- 庄家方阻止抓分方（闲家）得分。
- 闲家得分决定升降级。

### 升级规则

| 闲家得分 | 结果 |
|---|---|
| 0 | 庄家三级跳（升 3 级） |
| 5–35 | 庄家两级跳（升 2 级） |
| 40–75 | 庄家升 1 级 |
| 80–115 | 闲家上台（下台） |
| ≥120 | 闲家升 1 级 |
| ≥160 | 闲家升 2 级 |

## 仓库结构

- **[`packages/engine`](packages/engine/)** — 核心引擎：牌型分类、比较、验牌、AI 出牌策略、NT 记牌器（基于计数的常主追踪）。
- **[`packages/ai-baselines`](packages/ai-baselines/)** — 历史 AI 策略基线：统一 facade；过渡期存量快照仍在 `engine`，新提取的基线原样放入此包。
- **[`packages/cli`](packages/cli/)** — 终端交互版，支持全色彩牌面显示。
- **[`packages/client`](packages/client/)** — React 网页前端（可玩：南座人类 vs 3 AI，或 4 AI 观战）。
- **[`packages/arena`](packages/arena/)** — 策略竞技场：完整对局（2→A，含必打 K/A）镜像对决，以及按发牌统计、庄位可配置（默认固定 P0）的三腿竞技场；99% 置信度显著性判定，输出 17+ 项技术指标。

### NT 记牌器

无主模式下，12 张常主（大王 × 2、小王 × 2、级牌 × 8）通过基于计数的推理系统追踪可能分布。系统利用出牌记录、亮主信息和无对推断，在不查看其他玩家手牌的前提下推断常主归属。

## 策略竞技场

`packages/arena` 让两套 AI 策略在完整对局（2→A）中镜像对决，以 99% 置信度判定一方胜率是否显著优于另一方。

- **镜像对决（对决）**：每对决 = 两场对局——策略 A 坐 0/2 号位一场、策略 B 坐 0/2 号位一场；两场共享同一发牌序列（第 i 小局同副牌），P0 两场拿到相同的 25 张——不同策略仍会产生不同的主花色、升级节奏与结果。
- **必打 K/A**：K 和 A 必须**当庄打赢**才能越过——闲家在 K 上台只能停在 K；庄家在 A 打赢即胜出。上台判定与升级统一用含抠底的闲家最终分。
- **显著性判定**：p̂ = (胜 + 0.5×平)/n，99% Wilson 区间下界 > 0.5 即显著。最小样本（2×pairs）后每 `stepMatches` 场检查一次，显著立即停止；「平」只出现在**镜像对决**层面：一对的两条腿各赢一场（1-1）时两边各记一胜一负，折合每场 0.5 胜。单场必有胜负——200 小局封顶的平局分支从未触发（实测 300 对决 / 600 场，`drawn` 恒为 0，其中 132 对 1-1）。
- **动态进度基准**：最小样本前进度分母固定为 2×pairs；之后未显著时按当前胜率推算显著所需总场数（向上取整到 stepMatches 的倍数），基准变化时说明原因。
- **进度与检查点**：每 100 场一行进度（含 ETA）；每 `stepMatches` 场输出显著性并写 `results/checkpoint.json`；Ctrl+C 保存部分结果后优雅退出。不支持恢复，每次从 0 开始。
- **升级记录**：`--detail-pair N` 并排输出该对决镜像两场的逐手升级记录（同一副牌），含庄家方、双方等级、闲家得分与升级结果。
- **历史基线策略**：`ai-0816`（2026-08-16，扣底策略重构前）、`ai-0907`（2026-09-07，毙牌单张按档位选牌之前）、`ai-0929`（2026-09-29，NT 记牌器对子扣减修复——Elo 刻度锚点）、`ai-1005`（2026-10-05，无主长花色领出层与第三家甩牌加分改判）、`ai-1018`（2026-10-18，领出阶梯按庄/闲分档重写之前，含 0a/0b 放宽）从 git 历史提取，用于与当前策略 `ai` 对比；统一从 `@poker/ai-baselines` facade 导入，新基线加入该包，每次提取归档一条最旧的存量基线。（已归档移除：`ai-0707`、`ai-0712`、`ai-0726`，2026-08-07 删除；`ai-0801`、`ai-0719`，2026-09-16 删除；`ai-0808`，2026-09-27 删除；`ai-0809`，2026-10-01 删除；`ai-0802`，2026-10-06 删除；`ai-0927`、`ai-1002`，2026-10-18 删除。下方 Elo 分数仅保留展示。）
- **策略 Elo 评分**——两套刻度，对应扣底决策的两种口径（由 `packages/arena/scripts/elo-calc.ts` 计算；锚点分数由该脚本的 `ANCHOR_ELO` 给定）：
  - **现行刻度**——2026-09-16 修复后实测；庄家改为拿进底牌后按 33 张决策。锚点：`ai-0929` = 1263.8（表中取整）。`ai-1005` 是 2026-10-05 的状态、2026-10-09 实测 1271。`ai` 于 2026-10-12（领出 0a）与 2026-10-18 09:12（领出 0b）起与它分道——该状态已冻结为 `ai-1018`——又于 2026-10-18 14:12 按庄/闲重写领出阶梯，于 2026-10-24 新增庄4.5（主拖拉机先于通用 5 领出，同日 seed 48 实测 1292），再于 2026-10-24 20:33 改为无主非分等级吊主延后到通用 9。

    | 策略 | Elo |
    |---|---|
    | `ai`（当前） | 1297 |
    | `ai-1018` | 1279 |
    | `ai-1005` | 1271 |
    | `ai-1002` | 1267 |
    | `ai-0929` | 1264 |
    | `ai-0927` | 1252 |
    | `ai-0907` | 1231 |
    | `ai-0816` | 1145 |
    | `ai-0809` | 1123 |
    | `ai-0808` | 1102 |
    | `ai-0802` | 1083 |

    > **注（2026-10-06）**：`elo-calc.ts` 已不再记录对局数、也不再按它加权。

  - **旧刻度（带扣底 bug）**——⚠️ 以下分数均为 AI 庄家**只按发到的 25 张**选 8 张扣底（未拿底牌）时测得；当时每个庄家都在严格更小的可行集上做决策，故与上表**不可比**。表中名为 `ai-0802` 的一行实为 `ai-0802-flawed`（同一份代码 + 旧口径），整套分数即锚定在它 = 1000 上。

    | 策略 | Elo |
    |---|---|
    | `ai-0802` | 1000.0 |
    | `ai-0801` | 992.2 |
    | `ai-0726` | 988.1 |
    | `ai-0719` | 895.3 |
    | `ai-0712` | 463.6 |
    | `ai-0707` | -528.5 |

## 快速开始

### 环境要求

- **Node.js** ≥ 18
- **npm** ≥ 9

### Git 钩子（pre-push）

`.githooks/pre-push` 在代码离开本机前把关：先跑**工作区**的 `npm run typecheck`，再跑 `npm run test:all`，最后对本次推送范围跑一遍提交规范检查。钩子会自己装配——`npm install` 触发的 `prepare` 会把 `core.hooksPath` 指到 `.githooks`。需要绕过时用 `git push --no-verify`。

### 命令行（CLI）

```bash
npm install
npx tsx packages/cli/src/index.ts    # 或 npm start -w packages/cli
```

CLI 为交互式：启动后按提示输入玩家数、调试模式等。

### 图形界面（client）

```bash
npm run dev                          # Vite 开发服务器：http://localhost:3000
```

南座人类 vs 3 AI；设置面板可切换为 4 AI 观战模式。URL 开发参数：`?seed=N`（确定性发牌）、`?auto=1`（自动开始 4 AI 观战对局）、`?speed=n`（动画加速 n 倍）。

GUI 自动化验证（需系统安装 Google Chrome，playwright-core 直连）：

```bash
npx tsx packages/client/scripts/ui-dump.ts --seed 42 --auto 1 --auto-tricks 3 --dump -   # DOM/布局/状态文本 dump
npx tsx packages/client/scripts/ui-smoke.ts --seed 42 --max-rounds 3                      # 逐墩断言 + 确定性双跑指纹
```

> **注意：** 界面细节仍待打磨。

### 策略竞技场

```bash
npm run arena -w packages/arena -- --pairs 5000 --seed 42 --strategy-b ai-1018
# 仓库根目录也可直接：npm run arena -- --pairs 5000 ...
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--pairs N` | 5000 | 初始对决数（=2N 场对局，最小样本） |
| `--until-significant` | — | 不设最小样本：任一次检查显著即停（与 `--pairs` 互斥） |
| `--max-matches N` | 100000 | 对局上限（须 ≥ 2×pairs） |
| `--step-matches N` | 1000 | 显著性检查与检查点的间隔场数 |
| `--seed N` | 随机 | 随机种子——同 seed 同参数结果可完全复现 |
| `--workers W` | 逻辑核数 | 并行子进程数（1 = 进程内） |
| `--strategy-a NAME` | `ai` | 策略 A（`ai` / `ai-1018` / `ai-1005` / `ai-0929` / `ai-0907` / `ai-0816`） |
| `--strategy-b NAME` | `ai-1018` | 策略 B |
| `--benchmark N` | — | 跑 N 场测速后退出 |
| `--detail-pair N` | — | 输出第 N 个对决的镜像升级记录后退出 |
| `--out PATH` | `results/arena-<时间>.json` | JSON 报告导出路径 |
| `--no-json` | — | 不导出 JSON |

#### Deal（发牌）竞技场

```bash
npm run arena:deal -w packages/arena -- --min-deals 2500 --seed 42
# 仓库根目录也可直接：npm run arena:deal -- --min-deals 2500 ...
```

统计单位是**一副牌**。每个 `(副, 等级)` 按 `--declarer-seats` 指定的庄位坐庄；每个庄位用同一副牌、同一等级打三腿。默认是**固定 P0 坐庄**，`--declarer-seats all` 恢复四庄位轮转：

| 腿 | 庄家 | 闲家 | `finalPts` 归属 |
|---|---|---|---|
| `[A,B]` | A | B | B（闲家） |
| `[B,A]` | B | A | A（闲家） |
| `[B,B]` | B | B | B（闲家） |

**两项指标**，正数都表示 A 更好。升级用 `tier(x) = x === 0 ? −1 : ⌊x/40⌋`，分差直接用 `finalPts`：

| 角色 | 净升级 | 得分差 |
|---|---|---|
| 总体（AB 对 BA） | `tier(pBA) − tier(pAB)` | `pBA − pAB` |
| 庄家（AB 对 BB） | `tier(pBB) − tier(pAB)` | `pBB − pAB` |
| 闲家（BA 对 BB） | `tier(pBA) − tier(pBB)` | `pBA − pBB` |

每项指标按**场景**拆分：等级（总体或单等级）× 主牌（总体 / 有主 / 无主）× 角色（总体 / 庄家 / 闲家）。等级=总体时主牌×角色共 9 行；多等级时每个等级追加 3 个主牌行（角色=总体）；只传一个等级时不展开等级行（仍是 9 行）。有主/无主按**被比较的两条腿**判定：总体看 AB 与 BA，庄家看 AB 与 BB，闲家看 BA 与 BB；混合组合（如 AB 有主、BB 无主）只进「主牌=总体」行。没有合格三元组的发牌不计入该场景的分母。

每副牌把该场景内合格三元组的符号计数：A 多则这副算 A 胜，B 多算 B 胜，相等算平；净升级的显著性以**发牌**为单位（平局折 0.5）。分差先按副求合格三元组均值，再跨副做配对。每个配置庄位每等级贡献 1 对镜像（3 小局）：默认固定 P0、6 档时一副牌 6 对（18 小局）；`--declarer-seats all` 时一副牌 24 对（72 小局）。四庄位轮转下 **13–11 是 A 胜，不是平；12–12 才是平**（默认 6 对的对应值是 4–2 胜、3–3 平）。默认固定 P0 是因为四个庄位的镜像差基本不相关，而发牌级多数决在等手数下约只需 1/5 的手数就能达到同样精度；`all` 保留作位置差诊断。

`--deal-filter long-suit`：四家任一有**副牌**长套（≥9 张且控制张 ≥6；主牌门不算）即保留该 `(副, 等级)`；候选庄家按 **33 张池（25 手牌 + 8 底牌）**在扣底前判断，所以扣底后长套消失仍保留。对 `--declarer-seats` 中的每个配置庄位各用该庄位 `[B,B]` 的自然亮主判一次，任一通过就保留并只打这些配置庄位；这是对基准腿亮主的选择规则，不保证 A/B 腿亮出同一主牌。谓词检查四家手牌：庄家按 33 张池（25 + 底牌）判断，其余三家各 25 张。默认固定 P0 时只有 P0 的池含底牌，所以长套通过率比 `--declarer-seats all` 低。

报告分三张表：**净升级**列 A胜/B胜/平局比例（括号内整数分子/分母）与 99% 发牌级显著性（A 绿、B 红、否则「不显著」），首行是「总体（核心）」；**得分差**列配对均值与 `（分子/分母）`（分子 1 位小数，分母 = 参与该场景的发牌数）及 99% 显著性；**小局分析**由原 80 分 A/B 表更名而来，去掉平局率列，只有胜率类行（胜率、台上/台下/等级胜率）带 99% 显著性，其余行显示「—」。进度行只显示有效发牌数；有中止时追加「（已中止 x 小局）」，不再显示三元组。导出的 JSON 含场景聚合；小局分析显著性用的逐副胜率桶不写入最终文件（只存在于子进程回传中）。

中止小局**结算而非作废**（整体竞技场同样适用）：中止玩家在闲家方 → 按已完成墩的当前分结算（不加底牌）；在庄家方 → 假设闲家赢下当前墩和所有剩余墩，结算分 = 当前墩已出牌分 + 四家剩余手牌分 + 底牌分 × 最佳抠底倍率。**最后一墩不会中止**，所以当前墩一定不是最后一墩；抠底倍率只从两名闲家**各自**的未出手牌里取（不合并，且中止发生在墩进行中、两人手牌数可能不等），取较高倍率；倍率相同则加分相同，无需再按牌型/花色打破平局。报告披露 `settledHands`（庄因/闲因）与每方 `abortCaused`。

| 参数 | 默认 | 说明 |
|---|---|---|
| `--level LIST` | `2,5,10,Q,K,A` | 等级列表；`all` = 2..A |
| `--declarer-seats S` | `0` | 庄家座位：`0`（固定 P0）、`0,2`，或 `all`（四庄位轮转） |
| `--deal-filter NAMES` | — | 内置发牌过滤器（`long-suit`） |
| `--min-deals N` | 2500 | 首次显著性检查所需的有效发牌数 |
| `--until-significant` | — | 不设最小样本：任一次检查显著即停（与 `--min-deals` 互斥） |
| `--step-deals N` | 250 | 显著性检查的间隔，也是推算目标向上取整的粒度 |
| `--max-deals N` | 10000 | 有效发牌数上限 |
| `--seed N` / `--workers W` / `--strategy-a NAME` / `--strategy-b NAME` / `--out PATH` / `--no-json` | 同上 | `--strategy-b` 默认 `ai-1018` |

与整体竞技场同口径：未显著时按当前 p̂ 推算显著所需发牌数并上调目标（同一个 `requiredMatchesForSignificance`）；Ctrl+C 写出部分报告与 `"partial": true` 的 JSON 后退出。旧的 `arena:solo` / `arena:nt` 已移除。

测试：

```bash
npm run test -w packages/engine    # 引擎
npm run test -w packages/arena     # 竞技场
npm run test -w packages/cli       # CLI
npm run test -w packages/client    # client
```

## 技术栈

| 层 | 技术 |
|---|---|
| 语言 | TypeScript 5.7 |
| 运行时 | Node.js ≥ 18 |
| 引擎 | 纯逻辑，零依赖 |
| CLI | tsx（TypeScript 执行） |
| 客户端 | React 18 + Vite + Zustand |
| 测试 | Vitest 2.x |

## AI 策略

AI 采用规则驱动的出牌策略，覆盖四种出牌位置（领出、第二家、第三家、第四家），包括：

- **NT 第二家抢占**——队友领出偏弱且对手无法管住更大主牌时抢控。
- **加分优先级**——加分时按 10 > K > 5，最大化得分潜力。
- **拆对纪律**——攻方仅当跨过 40 分阈值时才拆对；守方绝不拆对。
- **缺门跟牌加分管理**——仅当队友已大时加分，并提防对手阈值。

详见 [`packages/engine/src/ai/STRATEGY.md`](packages/engine/src/ai/STRATEGY.md)。

## 开源协议

MIT — 详见 [LICENSE](LICENSE)。

## 关于 AI 生成

> **本项目所有代码均由 AI（Claude Code / DeepSeek）生成，经人工逐项审核后提交。** 所有逻辑、测试和文档均为 AI 辅助迭代开发的产物，提交前均已通过人工验证。
>
> Token 消耗详见 [TOKENS.md](TOKENS.md)。
