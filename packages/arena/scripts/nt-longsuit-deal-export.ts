/**
 * 导出「P0 当庄 且有长花色」的无主牌局（调试脚本，不提交）。
 *
 * 座位策略：P0/P2 用 ai（现策略），P1/P3 用 ai-0907。
 * 发牌筛选（与无主竞技场同一口径）：
 *   1. 没有任何玩家拿对王的发牌直接跳过（这种牌天然不会打无主）；
 *   2. 扣底之后 P0 按 computeLongSuit 判不出长花色的，也跳过——不是目标局面。
 *   两条跳过都不占 --deals 计数（一直往后扫发牌序号）。
 *
 * 出牌打到本局结束，随后用 GUI 调试「导出」用的同一个 formatGameExport 原样输出
 * （直接从 client 源文件导入，保证格式零漂移）。导出段落之后附带一行脚本附加信息
 * （含抠底的最终分/P0 的长花色），它不属于导出格式。
 *
 * 用法（在 packages/arena 下）:
 *   npx tsx scripts/nt-longsuit-deal-export.ts --seed 42 --deals 3
 *   npx tsx scripts/nt-longsuit-deal-export.ts --seed 42 --deals 3 --level 7 --out hands.txt
 */
import fs from 'node:fs';
import {
  createInitialState, finalizeReveal, tryReveal, playCards, buildAIContext, GamePhase,
  classify, bottomMultiplier, countBottomPoints, finalizeAttackerPoints, suitLabel, isPointRank, sortHand,
} from '@poker/engine';
import type { Card, GameState, PlayedCards, PlayerState, Suit, TrumpDeclaration } from '@poker/engine';
import { deckForHand, hashMix } from '../src/rng.js';
import { hasJokerPairDeal } from '../src/nt-arena.js';
import { strategyByName } from '../src/strategies.js';
import { computeLongSuit } from '../../engine/src/ai/suit-memory.js';
import { formatGameExport } from '../../client/src/components/game/export-game.js';

/** 显示名：与 GUI 里人坐 P0 时的导出完全一致。 */
const NAMES = ['玩家1', 'AI-2', 'AI-3', 'AI-4'] as const;
const HAND_COUNT = 25;

const STRAT_AI = strategyByName('ai');
const STRAT_0907 = strategyByName('ai-0907');
/** P0/P2 → ai；P1/P3 → ai-0907。 */
const seatStrategy = (i: number) => (i % 2 === 0 ? STRAT_AI : STRAT_0907);

function parseArgs(argv: string[]): { seed: number; deals: number; level: number | null; maxScan: number; out: string | null } {
  const args = { seed: 42, deals: 1, level: null as number | null, maxScan: 20000, out: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} 需要参数值`);
      i += 1;
      return v;
    };
    switch (a) {
      case '--seed': args.seed = parseInt(val(), 10) >>> 0; break;
      case '--deals': args.deals = parseInt(val(), 10); break;
      case '--level': args.level = parseInt(val(), 10); break;
      case '--max-scan': args.maxScan = parseInt(val(), 10); break;
      case '--out': args.out = val(); break;
      case '-h':
      case '--help':
        console.log(`用法: npx tsx scripts/nt-longsuit-deal-export.ts [选项]
  --seed N       随机种子（决定发牌与随机级牌），默认 42
  --deals N      导出多少局（只数通过筛选的局面），默认 1
  --level L      固定级牌 2..14；省略则按 seed+发牌序号确定性取随机级牌
  --max-scan N   最多扫描多少个发牌序号，默认 20000
  --out PATH     写入文件；省略则打到 stdout`);
        process.exit(0);
        break;
      default:
        throw new Error(`未知参数: ${a}`);
    }
  }
  if (args.deals < 1) throw new Error('--deals 必须 ≥ 1');
  if (args.level !== null && (args.level < 2 || args.level > 14)) throw new Error('--level 必须在 2..14');
  return args;
}

/** 发牌 → 亮主 → 强制 P0 无主当庄。流程对齐 src/match.ts:85-118。 */
function dealState(deck: Card[], level: number, isFirstHand: boolean): GameState {
  const players = [0, 1, 2, 3].map(i => ({
    hand: [] as Card[], isHuman: false, name: NAMES[i], index: i,
  })) as [PlayerState, PlayerState, PlayerState, PlayerState];

  let state = createInitialState(players, 0, level, false);
  const dealt: Card[][] = [[], [], [], []];
  for (let i = 0; i < 100; i++) {
    const pi = i % 4;
    dealt[pi].push(deck[i]);
    state = {
      ...state,
      dealtCards: dealt.map(a => [...a]) as unknown as Card[][],
      players: state.players.map((p, j) => ({ ...p, hand: [...dealt[j]] })) as unknown as typeof state.players,
    };
    // 亮主要照跑：ctx.reveals 参与 NT 策略（§6 的「对手有王对」判据）。
    for (let pj = 0; pj < 4; pj++) {
      const rev = seatStrategy(pj).tryReveal(
        state.players[pj].hand, dealt[pj], pj, level, state.currentReveal,
      );
      if (rev) state = tryReveal(state, pj, rev.suit);
    }
  }
  state = {
    ...state,
    bottomCards: deck.slice(100, 108),
    dealingComplete: true,
    phase: GamePhase.Revealing,
  };
  state = finalizeReveal(state, isFirstHand);
  return {
    ...state,
    declarerIndex: 0,
    trumpDeclaration: { declarerIndex: 0, trumpSuit: null, level },
  };
}

/** 扣底并进入出牌阶段，同时写入 GUI 用的 initialHands。对齐 match.ts:123-146 + gameStore:255-262。 */
function exchangeBottom(state: GameState, t: TrumpDeclaration): GameState {
  // 庄家先把底牌拿进手（33 张），再从中扣 8 张——与 arena/match.ts 同口径。
  const merged = [...state.players[0].hand, ...state.bottomCards];
  let { discard } = STRAT_AI.chooseBottom(merged, t);
  if (discard.length !== 8) {
    // 防御：与 arena/match.ts 一致（低分低张优先），正常不会走到。
    discard = [...merged]
      .sort((a, b) => (isPointRank(a.rank) ? 100 : 0) + a.rank - ((isPointRank(b.rank) ? 100 : 0) + b.rank))
      .slice(0, 8);
    console.error('⚠️ chooseBottom 未返回 8 张，已按低分低张回退');
  }
  const keep = new Set(discard.map(d => d.id));
  const newHand = merged.filter(c => !keep.has(c.id));
  const players = state.players.map((p, i) =>
    i === 0 ? { ...p, hand: newHand } : p,
  ) as unknown as typeof state.players;
  return {
    ...state,
    players,
    bottomCards: discard,
    phase: GamePhase.Playing,
    currentPlayerIndex: 0,
    leadPlayerIndex: 0,
    initialHands: players.map(p => p.hand),
  };
}

/** 打到本局结束。出牌循环对齐 src/match.ts:147-203（含验牌回退）。 */
function playOut(state: GameState): GameState {
  let s = state;
  while (s.tricksPlayed < HAND_COUNT) {
    if (s.players.every(p => p.hand.length === 0)) break;
    const cp = s.currentPlayerIndex;
    const player = s.players[cp];
    if (player.hand.length === 0) throw new Error(`P${cp} 未出完牌但手牌已空`);

    const isLeading = s.trickPlays.length === 0;
    const leadLen = isLeading ? 0 : s.trickPlays[0].cards.length;
    const ctx = buildAIContext(s, cp);
    if (!ctx) throw new Error('缺少亮主信息');
    const strat = seatStrategy(cp);

    let cards: Card[];
    if (isLeading) {
      cards = strat.lead(player.hand, ctx).cards;
    } else {
      const leadPlay = s.trickPlays[0];
      const leadSuit = leadPlay.leadSuit ?? leadPlay.cards[0]?.suit ?? null;
      cards = leadSuit ? strat.follow(player.hand, leadPlay.cards, leadSuit, ctx).cards : [player.hand[0]];
    }
    if (!cards || cards.length === 0 || cards.some(c => !c)) {
      cards = player.hand.slice(0, Math.max(1, leadLen));
    }
    if (!isLeading && cards.length !== leadLen) {
      const used = new Set(cards.filter(Boolean).map(c => c.id));
      const extra = player.hand.filter(c => !used.has(c.id));
      cards = [...cards.filter(Boolean), ...extra].slice(0, leadLen);
    }

    const res = playCards(s, cp, cards);
    if (res.forcedPlay) s = res.state;
    else if (res.error) {
      const want = isLeading ? 1 : (s.trickPlays[0]?.cards.length ?? 1);
      const fb = playCards(s, cp, player.hand.slice(0, want));
      if (fb.error) throw new Error(`P${cp} 出牌非法且回退失败: ${res.error}`);
      s = fb.state;
    } else s = res.state;
    if (s.phase === GamePhase.RoundEnd) break;
  }
  return s;
}

/**
 * 导出前排序（纯展示，不影响任何判定）：手牌、初始手牌、底牌、每墩各家的牌。
 * 用引擎的 sortHand——GUI 手牌也是用它渲染的（GameTable.tsx:274），读起来一致。
 * 一墩内**玩家的顺序保持出牌顺序**（领出者在最前），只排各家手里的牌。
 */
function sortForDisplay(state: GameState): GameState {
  const config = state.trumpDeclaration;
  // 泛型保留入参的元组类型：Trick.plays 是四元组、GameState.trickPlays 是数组，
  // 两者都要能原样传回（写成固定返回类型会让元组退化成数组，赋回 Trick 不通过）。
  const sortedPlays = <T extends readonly PlayedCards[]>(plays: T): T =>
    plays.map(p => ({ ...p, cards: sortHand(p.cards, config) })) as unknown as T;
  return {
    ...state,
    bottomCards: sortHand(state.bottomCards, config),
    initialHands: state.initialHands?.map(h => sortHand(h, config)),
    players: state.players.map(p => ({ ...p, hand: sortHand(p.hand, config) })) as unknown as GameState['players'],
    trickHistory: state.trickHistory.map(t => ({ ...t, plays: sortedPlays(t.plays) })),
    trickPlays: sortedPlays(state.trickPlays),
  };
}

/** 闲家最终分（含抠底）——与 arena/match.ts:206-215 同一口径。 */
function finalAttackerPoints(
  s: GameState, declarer: number,
): { finalPts: number; mult: number; bottomPts: number; attackerWonLast: boolean; kouDi: number } {
  const lastTrick = s.trickHistory[s.trickHistory.length - 1];
  const t = s.trumpDeclaration!;
  const mult = lastTrick ? bottomMultiplier(classify(lastTrick.plays[0].cards, t)) : 2;
  const bottomPts = countBottomPoints(s.bottomCards);
  const finalPts = Math.max(0, lastTrick
    ? finalizeAttackerPoints(s.attackerPoints, bottomPts, mult, lastTrick.winnerIndex, declarer)
    : s.attackerPoints);
  // 抠底只在闲家赢下最后一墩时成立；否则底分归庄家、不计入闲家分。
  const attackerWonLast = lastTrick !== undefined && lastTrick.winnerIndex % 2 !== declarer % 2;
  return { finalPts, mult, bottomPts, attackerWonLast, kouDi: attackerWonLast ? bottomPts * mult : 0 };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const blocks: string[] = [];
  let exported = 0;
  let scanned = 0;
  let skipNoJokerPair = 0;
  let skipNoLongSuit = 0;

  // 心跳全部走 stderr：stdout 只留导出正文，方便重定向。扫描是逐发牌序号做的，
  // 命中一局平均要扫三四十个序号，没有心跳时「正在跑」和「卡住了」看起来一样。
  console.error(
    `[deal-export] seed=${args.seed} deals=${args.deals} level=${args.level ?? '随机'} `
    + `→ 开始扫描发牌…`,
  );

  for (let dealIndex = 0; exported < args.deals && scanned < args.maxScan; dealIndex++) {
    scanned += 1;
    if (scanned % 100 === 0) {
      console.error(`[deal-export] 已扫描 ${scanned} 个发牌序号，命中 ${exported} 局…`);
    }
    const deck = deckForHand(args.seed, 0, dealIndex);
    if (!hasJokerPairDeal(deck)) {
      skipNoJokerPair += 1;
      continue;
    }
    const level = args.level ?? (2 + (hashMix(args.seed, 7, dealIndex) % 13));

    let state = dealState(deck, level, false);
    state = exchangeBottom(state, state.trumpDeclaration!);

    const ctx0 = buildAIContext(state, 0);
    const longSuit: Suit | null = ctx0 ? computeLongSuit(state.players[0].hand, ctx0) : null;
    if (longSuit === null) {
      skipNoLongSuit += 1;
      continue;
    }

    console.error(`[deal-export] 第 ${exported + 1} 局：发牌序号 ${dealIndex}（level ${level}）开始出牌…`);
    state = playOut(state);
    const { finalPts, mult, bottomPts, attackerWonLast, kouDi } = finalAttackerPoints(state, 0);
    const bankerWon = finalPts < 80;
    const kouDiNote = attackerWonLast
      ? ` + 抠底 底${bottomPts}×${mult}${bottomPts === 0 ? '（底里没有分）' : `=${kouDi}`}`
      : '，庄家拿下最后一墩';
    const extra = `[脚本附加] 闲家最终分 ${finalPts}（场分 ${state.attackerPoints}${kouDiNote}）`
      + ` → ${bankerWon ? '庄家保庄' : '闲家上台'} | P0 长花色: ${suitLabel(longSuit)}`
      + ` | 发牌序号 ${dealIndex} | 级牌 ${level}`;
    blocks.push(
      `=== 第 ${exported + 1} 局（发牌序号 ${dealIndex}，level ${level}，P0/P2=ai，P1/P3=ai-0907）===`,
      formatGameExport({ gameState: sortForDisplay(state), roundNumber: exported }),
      extra,
    );
    exported += 1;
  }

  const text = blocks.join('\n\n') + '\n';
  if (args.out) {
    fs.writeFileSync(args.out, text, 'utf-8');
    console.error(`已写入 ${args.out}（${exported} 局）`);
  } else {
    process.stdout.write(text);
  }
  console.error(
    `扫描发牌 ${scanned} 个序号：无对王跳过 ${skipNoJokerPair}，P0 无长花色跳过 ${skipNoLongSuit}，`
    + `导出 ${exported} 局（seed=${args.seed}）`,
  );
}

main();
