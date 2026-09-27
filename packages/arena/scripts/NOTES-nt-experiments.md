# 无主（NT）长花色领出层——三份实验脚本的意图与接口约定

> 本文件与其描述的三份脚本**都不提交**（见 `.gitignore` 末三条）。用途：将来要做「NT 长花色
> 领出层」时据以重写，不必从 1108 行里反推当初的设计。
>
> - `nt-guarantee-ceiling.ts`（577 行）——保庄上限的理论分析
> - `nt-longsuit-deal-export.ts`（290 行）——导出目标局面供 GUI 调试
> - `nt-replay-trace.ts`（241 行）——单副复现 + 逐步打印 AI 决策与 NT 层内部量
>
> 三份**现在都跑不起来**：它们依赖的 `ai/suit-memory.ts`、`ai/nt-trump.ts` 等**不在 main 上**——
> 那一层的实现只存在于 **`backup/2caafc8`**（详见文末「缺失依赖清单」与「时代背景」）。不是坏了，
> 是那层没并进来。

## 共同前提

三者共用同一套「发牌 → 亮主 → 扣底 → 出牌到局末」的手搓管线，且都声称对齐 `arena/src/match.ts`
（:85-118 发牌亮主、:123-146 扣底、:147-203 出牌含验牌回退）。**重写时优先抽成一个共用 fixture，
别再抄第三遍**——这三份是同一套管线的三个拷贝。

- 座位策略固定：**P0/P2 = `ai`，P1/P3 = `ai-0907`**（`strategyByName`）。
- 全程 **NT**：`trumpDeclaration = { declarerIndex: 0, trumpSuit: null, level }`，强制 P0 当庄。
- 发牌源 `deckForHand(seed, 0, dealIndex)`（`arena/src/rng.js`）：100 张逐张发四家，末 8 张作底。
- **亮主要照跑**：`tryReveal` 的记录会进 `ctx.reveals`，NT 策略「对手有王对」那条判据（§6）要用。
- 扣底：庄家并入底牌成 33 张，再 `chooseBottom` 扣 8 张。

## 一、`nt-guarantee-ceiling.ts`——保庄上限

**要回答的问题**：若把「无主 ∧ AI 策略方当庄 ∧ 庄家有长花色」的小局全部**假设为保庄**
（闲家最终分记 40 ⇒ 庄家保庄并升 1 级），整个竞技场的对局胜率会变成多少？

**做法**（关键：不是事后重算）：
- 用 `Strategy` 包装器在庄家**本局第一次领出**时判定长花色
  （`ctx.trumpSuit === null && ctx.isDeclarer && ctx.trickHistory.length === 0`——此刻 ctx 就是
  33 张初始视角，且本局恒定、首墩必由庄家领出），结果存 `pending`。
- `playMatch({ …, onHand })` 的 `onHand(ev: HandEvent)` 在 `playHand` 返回后、`playMatch` 读
  `ev.bankerWon` / `ev.finalPts` **之前**被调用 → 直接改写事件，改写即参与升级判定与统计。
- 跑两趟同种子、同对决范围：`假设局`（改写）与 `对照局`（不改写），胜率直接相减。
- 报告还打印被改写小局**改写前的真实结果**（平均闲家分、实际保庄率）——即「这个假设值多少分」。
- 自检：`onHand` 钩子计出的 `ntBankerHands` 必须等于统计口径的 `statsA.banker.ntHands.d`；
  不等说明钩子收错了事件（文件里会打「脚本有 bug」）。

**接口契约**：
- `playMatch({ seed, pairIndex, strategies: [A, B], onHand })` → `{ winnerTeam, finalLevels, events }`；
  每对决跑 `[false, true]` 两盘互换座位。
- `HandEvent`：`aborted`、`trumpSuit`、`teamBanker`、`finalPts`、`bankerWon`。
- `Strategy.lead(hand, ctx)`；`ctx`：`trumpSuit`、`isDeclarer`、`trickHistory`。
- `computeLongSuit(hand, ctx): Suit | null`。
- `GUARANTEE_FINAL_PTS = 40` 的来历写在文件里：`computeLevelChange` 的 n=1 档是 40~79，<80 即保庄。
- `arena/src/` 的 `stats.js`（`createStats`/`addHandStats`/`addMatchOutcome`/`mergeStats`/`toJSON`/`fromJSON`）、
  `significance.js`（`checkSignificance(wonA, wonB, drawn, n)`、`Z`、`SignificanceResult`）、
  `progress.js`（`formatDuration`、`estimateRemaining`）。

**踩过的坑（务必保留）**：**不要复用 `src/child-pool.ts`**。4 个并发 `npm exec tsx` 会争 npm 缓存而
**卡死**——本机实测两次：只起来 2~3 个子进程，父进程在 `ChildPool.create` 上永久等待（0% CPU、无报错）。
改为 `spawn(process.execPath, [...process.execArgv, script, ...])` 直接拉起，绕开 npx。
另：worker 的 readline `crlfDelay` 必须是有界值，`Infinity` 在管道输入上不触发行事件。

## 二、`nt-longsuit-deal-export.ts`——导出目标局面

**要回答的问题**：把「P0 当庄且扣底后有长花色」的无主牌局导出成 **GUI 调试用的格式**，好在界面里复盘。

- 筛选：① 无人拿对王的发牌直接跳过（这种牌天然不会打无主，`hasJokerPairDeal`）；
  ② 扣底后 `computeLongSuit(P0 手牌, ctx)` 为 null 的跳过。**两条跳过都不占 `--deals` 计数**，一直往后扫。
- 打到局末，用 `formatGameExport` 输出——**直接从 `packages/client/src/components/game/export-game.ts` 导入**，
  保证与 GUI「导出」零格式漂移。
- 导出段落之后追加一行 `[脚本附加]`（闲家最终分 / 抠底明细 / P0 长花色 / 发牌序号 / 级牌），**不属于导出格式**。
- 展示前排序用引擎的 `sortHand`（GUI 手牌也用它渲染，读起来一致）；**一墩内保持出牌顺序**，只排各家手里的牌。
- 心跳全走 stderr，stdout 只留导出正文（方便重定向）。
- 抠底口径照抄 `arena/match.ts:206-215`：`bottomMultiplier(classify(最后一墩))`、`countBottomPoints`，
  且**只有闲家赢下最后一墩**才抠底，否则底分归庄家。

## 三、`nt-replay-trace.ts`——单副复现与 NT 层透视

**要回答的问题**：「AI 为什么这么出」。复现单副，逐墩打印决策与 reason，并在 NT 领出时把**整层内部量**摊开。

每墩打印 `第 N 墩 <谁> 领出/跟牌(<手牌数>) → <出的牌> ← <reason>`；牌名带 `★`（分牌）与 `T:`（主牌）标记。

NT 领出时额外打印（这些就是重写时要对齐的诊断面）：
- `[NT层]`：长花色、该门已领出次数、手牌该门张数、`mem.tier1`、`mem.playedCards` 张数、`mem.voidPlayers`、
  `mem.noPairPlayers`、我主牌张数、有人亮王对否、`ctx.ntState.maxTrumpCounts`、
  `allUnseenBigJokersOnOurSide`、`allUnseenJokersOnOurSide`、亮主记录。
- `pickNTTrumpLead(手牌, 主牌张数卡, ctx)` 的预选结果与 reason。
- `[§1]` / `[§1修正]`：非长花色门的控制张候选（`computeOffSuitControls`），并**对照打印**
  「按出牌顺序正确取牌」的版本（`initialHand(player.hand, ctx)` vs 手工按座位拼接已出的牌）——
  当初就是专门用它验证取牌顺序对不对的。
- `[闸门]`：复算 §6 之前的甩牌闸门——对 `extractComponents(mem.tier1)` 的每个对子/单张逐一提案
  `validateThrow(候选, 手牌, [worstCaseSuitHand(…)])`，看是否被砍。

## 缺失依赖清单：重写的第一步

三份脚本都卡在同一批**尚不存在**的 API 上。做这一层时按此清单先补，脚本就能跑：

| 模块 | 期望导出（签名按脚本用法反推） |
|---|---|
| `packages/engine/src/ai/suit-memory.ts` | `computeLongSuit(hand, ctx): Suit \| null`（**三份都依赖**；口径见下）<br>`computeLongSuitMemory(hand, ctx): { tier1: Card[]; playedCards: Card[]; voidPlayers: Set<number>; noPairPlayers: Set<number> } \| null`<br>`longSuitLeadCount(ctx, suit): number`<br>`initialHand(hand, ctx): Card[]`（按出牌顺序把已出的牌补回，还原该门初始形态）<br>`myPlayedCards(ctx): Card[]` |
| `packages/engine/src/ai/nt-trump.ts` | `pickNTTrumpLead(hand, trumpCards, ctx): { cards: Card[]; reason: string } \| null` |
| `packages/arena/src/nt-arena.ts` | `hasJokerPairDeal(deck): boolean` |
| `packages/engine/src/ai/throw-detector.ts`（补导出） | `worstCaseSuitHand(cards, suit, ctx, played): Card[]`（该文件现只导出 `findThrowableOffSuitCombos`、`findThrowableSuitCards`） |
| `packages/engine/src/ai/types.ts` 的 `NTTrumpState` | 补 `maxTrumpCounts: readonly [number, number, number, number]`（**现仅存在于冻结快照 `ai-0802/types.ts:50`**，当前 `ai/` 没有） |

**`computeLongSuit` 的判定口径**（写死在 `nt-guarantee-ceiling.ts` 头注释里，是这套设计的地基）：
初始手牌（庄家含底牌 → 33 张）按 `longShape`「**总张数 ≥ 9 且控制张 ≥ 6**」取**唯一一门**；有主局恒为 `null`。
注意别与同名概念混淆：`ai/bottom-strategy.ts:162` 也有一个 `longShape`，但那是**扣底**用的长花色（总 ≥9 且
控制 ≥6 的一门留作甩牌主力，本分支上真实存在），与领出层的 `computeLongSuit` 不是同一件东西。
后者的实现**只在 `backup/2caafc8` 上**（`packages/engine/src/ai/suit-memory.ts` 等），本分支没有——
所以重写的起点是**恢复/合并那条 backup**，不是从零写。

**已经存在、可直接用**（别重写）：`computeOffSuitControls`（`ai/bottom-controls.ts`）、
`extractComponents`（`comparing/index.ts`）、`validateThrow`（`leading/index.ts`）、
`deckForHand`（`arena/src/rng.ts`）、`formatGameExport`（`client/src/components/game/export-game.ts`）、
`ctx.ntState` 及其现有字段（`ai/types.ts:81`）。

## 时代背景

三份脚本都在为「**NT 长花色领出层**」做准备，而那层**从未并入 main**：它的实现（`ai/suit-memory.ts`、
`ai/nt-trump.ts` 等）连同它自己的 5 项测试都在 `backup/2caafc8` 这条支线上，顶端是 09-14 20:16 的
「fix: stop leaking the bottom cards into every seat's AIContext」——**main 拿到了同一个修复，却没拿那一层**，
两条线在那次改写里分开了。

所以这三份不是零散试验，而是同一件事的三块：**分析影响面 → 造复盘材料 → 透视决策过程**。

另注：README 的历史基线**不再**拿这一层给 `ai-0907` 当路标（main 上它不存在）。`ai-0907` 之后真正的
策略迭代是「毙牌单张按档位选牌」（09-26 09:43），中间的改动与策略无关——这也正是 README 里
`ai-0907` 那条注记现在的说法。
