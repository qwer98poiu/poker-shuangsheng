# 双升 (Shēng Jí) · Tractor Card Game

<p align="center">
  <strong>English</strong> | <a href="#中文">中文</a>
</p>

A full-stack implementation of the Chinese trick-taking card game **双升 (Shēng Jí / Tractor)**, featuring a deterministic game engine, an NT-mode (无主) trump tracker, and a rule-based AI opponent.

> **Note:** The graphical client (`packages/client`) is currently under development and not yet playable. All gameplay is conducted via the CLI.

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

## Overview

- **Engine** ([`packages/engine`](packages/engine/)) — Core game logic: card types, pattern classification, trick comparison, validation, AI strategies, and NT trump tracking (count-based deduction).
- **CLI** ([`packages/cli`](packages/cli/)) — Terminal-based interactive play with full-color card display.
- **Client** ([`packages/client`](packages/client/)) — React + Vite web frontend with Zustand state management (work in progress, not yet playable).
- **Arena** ([`packages/arena`](packages/arena/)) — Headless strategy tournament: mirrored full matches (2→A, with 必打 K/A) between two AI strategies, 99%-CI win-rate significance testing, and 17+ technical metrics.

### NT Trump Tracker

In NT (no-trump) mode, 12 constant trump cards (Big Joker × 2, Small Joker × 2, level cards × 8) are tracked via a count-based deduction system that infers possible holdings from played cards, reveals, and pair-failure deductions — without peeking at other players' hands.

## Strategy Arena

`packages/arena` pits two AI strategies against each other over full matches (2→A) to decide, at 99% confidence, whether one wins significantly more than the other.

- **Mirror pairs (对决)** — One 对决 = two matches: strategy A sits seats 0&2 in one, strategy B sits 0&2 in the other. Both matches share the same decks (hand i of both matches uses the same deal), so P0 holds identical 25 cards in both — different strategies still produce different trumps, upgrade pacing, and outcomes.
- **必打 K/A** — Levels K and A must be *won while banker* to pass: a 闲家 taking over at K stays at K; the banker winning at A ends the match. Takeover/advancement both use the attacker's final points including the bottom (抠底).
- **Significance** — p̂ = (wins + 0.5×draws)/n; the 99% Wilson lower bound must exceed 0.5. Checks begin at the minimum sample (2×pairs) and repeat every `stepMatches` matches; the run stops immediately once significant. A draw (match capped at 200 hands) counts as 0.5 wins each.
- **Dynamic progress target** — Before the minimum sample the progress denominator is fixed at 2×pairs; afterwards, if not yet significant, it projects the total matches needed under the current p̂ (rounded up to a `stepMatches` multiple), with the reason printed when it changes.
- **Progress & checkpoints** — A progress line every 100 matches (with ETA); every `stepMatches` matches the significance result is printed and `results/checkpoint.json` is written; Ctrl+C saves partial results and exits gracefully. No resume — every run starts from 0.
- **Upgrade log** — `--detail-pair N` prints the per-hand upgrade records of both mirrored matches side by side (same deck), showing banker side, both levels at hand start, attacker points, and the upgrade result.
- **Historical baselines** — `ai-0719` (2026-07-19), `ai-0801` (2026-08-01, pre-refactor) and `ai-0802` (2026-08-02, position-based follow refactor) were extracted from git history to PK against the current `ai`. (Archived: `ai-0707`, `ai-0712`, `ai-0726` — removed 2026-08-07; Elo scores below kept for reference.)
- **Strategy Elo ratings** (baseline `ai-0802` = 1000; current `ai` measured 1012):

  | Strategy | Elo |
  |---|---|
  | `ai` (current) | 1012 |
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

### CLI

```bash
npm install
npx tsx packages/cli/src/index.ts    # or: npm start -w packages/cli
```

The CLI is interactive: it prompts for the number of human players, debug mode, etc.

### Strategy Arena

```bash
npm run arena -w packages/arena -- --pairs 5000 --seed 42 --strategy-b ai-0801
# or from the repo root: npm run arena -- --pairs 5000 ...
```

| Flag | Default | Description |
|---|---|---|
| `--pairs N` | 5000 | Initial 对决 count (= 2N matches; the minimum sample) |
| `--max-matches N` | 100000 | Match cap (must be ≥ 2×pairs) |
| `--step-matches N` | 1000 | Interval (in matches) for significance checks and checkpoints |
| `--seed N` | random | Random seed — same seed + flags reproduce identical results |
| `--workers W` | logical cores | Parallel child processes (1 = in-process) |
| `--strategy-a NAME` | `ai` | Strategy A (`ai` / `ai-0801` / `ai-0802` / `ai-0719`) |
| `--strategy-b NAME` | `ai-0801` | Strategy B |
| `--benchmark N` | — | Run N matches for speed measurement, then exit |
| `--detail-pair N` | — | Print the mirrored upgrade log of 对决 N, then exit |
| `--out PATH` | `results/arena-<ts>.json` | JSON report path |
| `--no-json` | — | Skip JSON export |

Run tests:

```bash
npm run test -w packages/engine    # engine
npm run test -w packages/arena     # arena
npm run test -w packages/cli       # CLI
```

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.7 |
| Runtime | Node.js ≥ 18 |
| Engine | Pure logic, zero dependencies |
| CLI | tsx (TypeScript execute) |
| Client | React 18 + Vite + Zustand |
| Testing | Vitest 2.x (616 tests) |

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

## <a id="中文">中文</a>

### 项目简介

**双升（拖拉机）**是中国流行的四人两副牌升级类扑克游戏。本项目包含三个子包：

> **注意：** 图形界面（`packages/client`）仍在开发中，暂不可用。所有对局均通过命令行进行。

- **[`packages/engine`](packages/engine/)** — 核心引擎：牌型分类、比较、验牌、AI 出牌策略、NT 记牌器（基于计数的常主追踪）。
- **[`packages/cli`](packages/cli/)** — 终端交互版，支持全色彩牌面显示。
- **[`packages/client`](packages/client/)** — React 网页前端（开发中，暂不可用）。
- **[`packages/arena`](packages/arena/)** — 策略竞技场：两套 AI 策略在完整对局（2→A，含必打 K/A）中镜像对决，99% 置信度显著性判定，输出 17+ 项技术指标。

### 游戏规则

双升由 **4 人** 参与，对家固定组队，使用 **两副标准 54 张扑克牌**（共 108 张，含 4 张王牌）。

#### 发牌与叫主

- 每人发 25 张，**8 张**留作底牌。
- 叫主阶段，玩家依次声明主牌花色和强度（单张级牌、级牌对子或王对无主）。最后叫牌者为**庄家**，获得底牌并换底。

#### 主牌

- 当前打 **级牌**（如打 2 时所有 2）为主牌，外加全部 4 张王牌。
- 主牌大小：**大王 > 小王 > 级牌**（有主时主花级牌最大，无主时四花色级牌同级）。
- **无主模式**：没有主牌花色，仅 12 张常主为主——大王 × 2、小王 × 2、四花色级牌各 × 2。

#### 出牌

- 逆时针出牌，必须**跟出**领出花色（有该花色时必须出）。
- 缺门时可**毙牌**（出主牌）或垫其他花色。
- 本轮最大主牌（或无主牌时领出花色最大者）赢得该墩，下一墩由其领出。

#### 牌型

出牌需组成牌型，后续玩家必须**贴相同牌型**：

| 牌型 | 示例 | 要求 |
|---|---|---|
| 单张 | ♥K | 有同花色必须跟 |
| 对子 | ♠5♠5 | 必须出对子 |
| 拖拉机 | ♦10♦10♦J♦J | 同花色两组以上连续对子 |

#### 计分

- **5** 计 5 分，**10** 和 **K** 各计 10 分。
- 庄家方阻止抓分方（闲家）得分。
- 闲家得分决定升降级。

#### 升级规则

| 闲家得分 | 结果 |
|---|---|
| 0 | 庄家三级跳（升 3 级） |
| 5–35 | 庄家两级跳（升 2 级） |
| 40–75 | 庄家升 1 级 |
| 80–115 | 闲家上台（下台） |
| ≥120 | 闲家升 1 级 |
| ≥160 | 闲家升 2 级 |

### NT 记牌器

无主模式下，12 张常主（大王 × 2、小王 × 2、级牌 × 8）通过基于计数的推理系统追踪可能分布。系统利用出牌记录、亮主信息和无对推断，在不查看其他玩家手牌的前提下推断常主归属。

### 策略竞技场

`packages/arena` 让两套 AI 策略在完整对局（2→A）中镜像对决，以 99% 置信度判定一方胜率是否显著优于另一方。

- **镜像对决（对决）**：每对决 = 两场对局——策略 A 坐 0/2 号位一场、策略 B 坐 0/2 号位一场；两场共享同一发牌序列（第 i 小局同副牌），P0 两场拿到相同的 25 张——不同策略仍会产生不同的主花色、升级节奏与结果。
- **必打 K/A**：K 和 A 必须**当庄打赢**才能越过——闲家在 K 上台只能停在 K；庄家在 A 打赢即胜出。上台判定与升级统一用含抠底的闲家最终分。
- **显著性判定**：p̂ = (胜 + 0.5×平)/n，99% Wilson 区间下界 > 0.5 即显著。最小样本（2×pairs）后每 `stepMatches` 场检查一次，显著立即停止；单场 200 小局封顶判平局（各记 0.5 胜）。
- **动态进度基准**：最小样本前进度分母固定为 2×pairs；之后未显著时按当前胜率推算显著所需总场数（向上取整到 stepMatches 的倍数），基准变化时说明原因。
- **进度与检查点**：每 100 场一行进度（含 ETA）；每 `stepMatches` 场输出显著性并写 `results/checkpoint.json`；Ctrl+C 保存部分结果后优雅退出。不支持恢复，每次从 0 开始。
- **升级记录**：`--detail-pair N` 并排输出该对决镜像两场的逐手升级记录（同一副牌），含庄家方、双方等级、闲家得分与升级结果。
- **历史基线策略**：`ai-0719`（2026-07-19）、`ai-0801`（2026-08-01，重构前）、`ai-0802`（2026-08-02，分位置跟牌重构）从 git 历史提取，用于与当前策略 `ai` 对比。（已归档移除：`ai-0707`、`ai-0712`、`ai-0726`，2026-08-07 删除；下方 Elo 分数仅保留展示。）
- **策略 Elo 评分**（基准 `ai-0802` = 1000；当前 `ai` 实测 1012）：

  | 策略 | Elo |
  |---|---|
  | `ai`（当前） | 1012 |
  | `ai-0802` | 1000.0 |
  | `ai-0801` | 992.2 |
  | `ai-0726` | 988.1 |
  | `ai-0719` | 895.3 |
  | `ai-0712` | 463.6 |
  | `ai-0707` | -528.5 |

### 快速开始

#### 环境要求

- **Node.js** ≥ 18
- **npm** ≥ 9

#### 命令行（CLI）

```bash
npm install
npx tsx packages/cli/src/index.ts    # 或 npm start -w packages/cli
```

CLI 为交互式：启动后按提示输入玩家数、调试模式等。

#### 策略竞技场

```bash
npm run arena -w packages/arena -- --pairs 5000 --seed 42 --strategy-b ai-0801
# 仓库根目录也可直接：npm run arena -- --pairs 5000 ...
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--pairs N` | 5000 | 初始对决数（=2N 场对局，最小样本） |
| `--max-matches N` | 100000 | 对局上限（须 ≥ 2×pairs） |
| `--step-matches N` | 1000 | 显著性检查与检查点的间隔场数 |
| `--seed N` | 随机 | 随机种子——同 seed 同参数结果可完全复现 |
| `--workers W` | 逻辑核数 | 并行子进程数（1 = 进程内） |
| `--strategy-a NAME` | `ai` | 策略 A（`ai` / `ai-0801` / `ai-0802` / `ai-0719`） |
| `--strategy-b NAME` | `ai-0801` | 策略 B |
| `--benchmark N` | — | 跑 N 场测速后退出 |
| `--detail-pair N` | — | 输出第 N 个对决的镜像升级记录后退出 |
| `--out PATH` | `results/arena-<时间>.json` | JSON 报告导出路径 |
| `--no-json` | — | 不导出 JSON |

测试：

```bash
npm run test -w packages/engine    # 引擎
npm run test -w packages/arena     # 竞技场
npm run test -w packages/cli       # CLI
```

### AI 策略

AI 采用规则驱动的出牌策略，覆盖四种出牌位置（领出、第二家、第三家、第四家），详见 [`packages/engine/src/ai/STRATEGY.md`](packages/engine/src/ai/STRATEGY.md)。

### 开源协议

MIT — 详见 [LICENSE](LICENSE)。

### 关于 AI 生成

> **本项目所有代码均由 AI（Claude Code / DeepSeek）生成，经人工逐项审核后提交。** 所有逻辑、测试和文档均为 AI 辅助迭代开发的产物，提交前均已通过人工验证。
>
> Token 消耗详见 [TOKENS.md](TOKENS.md)。
