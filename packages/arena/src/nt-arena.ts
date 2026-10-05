/**
 * NT-only arena — 无主竞技场.
 *
 * The general arena measures whole matches, where NT rounds are a minority
 * (whoever reveals a joker pair plays no-trump) and the signal from the NT
 * lead layer drowns in the rest. This arena isolates NT instead:
 *
 * - A deal is used only if SOME seat holds a joker pair, so the natural reveal
 *   is 无主 — otherwise NT would be forced onto a deal that would never play it.
 * - Each kept deal is swept over 4 declarer seats × 13 levels (2..A) = 52 小局,
 *   all from the same deck, and that sweep is played **twice**: once with A on
 *   seats 0&2 and once with the strategies swapped (A on 1&3). That is the
 *   mirror, same shape as the general arena's two matches: identical deals,
 *   swapped sides — so the positional asymmetry between 0&2 (1st/3rd to play
 *   each trick) and 1&3 (2nd/4th) cancels instead of favouring one side.
 *   104 小局 per kept deal; with A == B every 对 has equal tiers, so every deal
 *   is a 0-0 draw.
 * - 胜负按**配对升级**判：同一 (等级, 庄家座位) 的两场镜像配成一对，比两场闲家分的升级量
 *   （`tierOf`）——A 队当闲那场更高记 a、B 队当闲那场更高记 b、相同记平（等价于「A 当庄
 *   让闲家拿更少的分」）；一副牌里 a 对多则这副算 A 胜。用升级量而不用过 80 分：过 80 只在
 *   「一边过、一边没过」的少数配对上分得开 A/B，升级量档把所有「差一级」的配对都变成可判。
 *   ⚠️ 这是换被测物，不是同一件事测得更准：过 80 是游戏的胜负位（上台与否），升级量是
 *   「这局值几级」，新旧读数不可混着比。
 * - No match (整场) concept — every statistic is computed over 小局 alone.
 *
 * Stats reuse the general arena's `StrategyStats` / `addHandStats` wholesale
 * (台上/台下各行的 80 分口径不变); this arena adds the 配对升级 counters
 * (`pairWins*` / `tierByLevel`) and the 80 口径 north star (A = seats 0&2).
 */
import { Rank } from '@poker/engine';
import type { Card } from '@poker/engine';
import { deckForHand } from './rng.js';
import { playHand, dealtHands } from './match.js';
import type { HandEvent, Strategy } from './types.js';
import {
  createStats, addHandStats, mergeStats, toJSON, fromJSON,
} from './stats.js';
import type { StrategyStats } from './stats.js';
import { tierOf, emptyTier, addTier } from './tier.js';
import type { TierBucket } from './tier.js';

/** Levels swept for every (deal, declarer) pair: 2 through A. */
export const NT_LEVELS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** 小局 produced by one kept deal: 4 declarers × 13 levels × 2 seat assignments. */
export const HANDS_PER_DEAL = NT_LEVELS.length * 4 * 2; // 104

/** 策略 A 在一轮里的座位分配：0 = 坐 0/2 号位，1 = 坐 1/3 号位。 */
export const A_PARITIES: readonly (0 | 1)[] = [0, 1];

/** Does any seat hold both copies of a joker? (that seat then reveals 无主) */
export function hasJokerPairDeal(deck: Card[]): boolean {
  return dealtHands(deck).some(hand =>
    hand.filter(c => c.rank === Rank.BigJoker).length >= 2
    || hand.filter(c => c.rank === Rank.SmallJoker).length >= 2);
}

/** 一轮（座位分配固定）的 52 小局：4 个庄家 × 13 个等级。 */
export interface NTDealRun {
  /** 策略 A 在这一轮坐的奇偶（0 = 0/2 号位，1 = 1/3 号位）。 */
  aParity: 0 | 1;
  events: HandEvent[];
}

export interface NTDealResult {
  dealIndex: number;
  /** True when no seat held a joker pair — the deal produced no 小局. */
  skipped: boolean;
  /** 两轮镜像：aParity 0 与 1 各一轮，同一副牌、策略对调。 */
  runs: NTDealRun[];
}

/** Play one deal's 104 小局 (or none, when the deal is filtered out). */
export function runNTDeal(
  seed: number,
  dealIndex: number,
  strategies: [Strategy, Strategy],
): NTDealResult {
  const deck = deckForHand(seed, 0, dealIndex);
  if (!hasJokerPairDeal(deck)) return { dealIndex, skipped: true, runs: [] };

  const runs: NTDealRun[] = [];
  for (const aParity of A_PARITIES) {
    const placed: [Strategy, Strategy] = aParity === 0 ? strategies : [strategies[1], strategies[0]];
    const events: HandEvent[] = [];
    for (const level of NT_LEVELS) {
      for (let declarerIdx = 0; declarerIdx < 4; declarerIdx++) {
        events.push(playHand({
          deck,
          handIndex: level,
          declarerIdx,
          level,
          attackerLevel: level,
          isFirstHand: false,
          strategies: placed,
          forceDeclaration: { declarerIdx, level },
        }));
      }
    }
    runs.push({ aParity, events });
  }
  return { dealIndex, skipped: false, runs };
}

// ---- stats ----

export interface NTStats {
  /** Seats 0&2. */
  statsA: StrategyStats;
  /** Seats 1&3. */
  statsB: StrategyStats;
  /**
   * 小局 won by A / B **at the 80-point line** (aborted 小局 excluded).
   * 80 口径的北星，只有 JSON 载荷与测试的一致性断言在用它——报告里的
   * 「胜率（小局升级口径）」走 `pairWins*`，台上/台下各行走 `statsA`/`statsB`。
   */
  handWinsA: number;
  handWinsB: number;
  /**
   * 配对升级口径：同一 (等级, 庄家座位) 的两场镜像小局配成一对，比两场闲家分的升级量
   * （`tierOf`）——A 队当闲那场更高记 a、B 队当闲那场更高记 b、相同记平（等价于「A 当庄
   * 让闲家拿更少的分」，别把它读成「A 自己的分更低」）。一对里两条腿的庄家队相同，
   * A 坐 0/2 与 1/3 各一次 ⇒ **恰有一条腿 A 当庄、一条腿 A 当闲**，于是「A 当庄让闲家
   * 拿更少的分」与「A 当闲让自家拿更多的分」是同一个不等式：这套口径下台上/台下不可分。
   * 显著性仍以发牌为单位，这三个只是「胜率（小局升级口径）」那一行与等级 block 的分子。
   */
  pairWinsA: number;
  pairWinsB: number;
  pairsDrawn: number;
  /** 可比较的镜像对数（一对里任一条腿中止 → 整对作废，不计入）。 */
  pairs: number;
  /** 各等级（2..A）的配对三分类（a/b/平），供报告的「等级 X 胜率」block。只含有样本的等级。 */
  tierByLevel: Map<number, TierBucket>;
  /**
   * Deal-level outcome (发牌口径): 这副牌里 a 对 / b 对 / 平对的数量比大小，
   * 多者拿下这副牌。发牌是独立单位（同一副牌的 104 小局共用一副牌、彼此相关），
   * 所以显著性检验跑在这组计数上，而不是小局（或配对）计数上。
   */
  dealsWonA: number;
  dealsWonB: number;
  dealsDrawn: number;
  /** Kept deals (those that passed the joker-pair filter). */
  deals: number;
  /** Deals skipped by the filter. */
  skippedDeals: number;
}

export function createNTStats(): NTStats {
  return {
    statsA: createStats(),
    statsB: createStats(),
    handWinsA: 0,
    handWinsB: 0,
    pairWinsA: 0,
    pairWinsB: 0,
    pairsDrawn: 0,
    pairs: 0,
    tierByLevel: new Map(),
    dealsWonA: 0,
    dealsWonB: 0,
    dealsDrawn: 0,
    deals: 0,
    skippedDeals: 0,
  };
}

/** 小局 played so far (aborted ones excluded). */
export function ntHandsPlayed(s: NTStats): number {
  return s.statsA.handsPlayed;
}

/** Accumulate one deal's 小局. */
export function addNTDeal(acc: NTStats, res: NTDealResult): void {
  if (res.skipped) {
    acc.skippedDeals += 1;
    return;
  }
  acc.deals += 1;

  // 按 `等级:庄家座位` 收一对镜像的两条腿。一对里两条腿的庄家队相同，A 坐 0/2 与
  // 1/3 各一次 ⇒ 恰有一条腿 A 当庄（闲家是 B 队，闲家分记 x_B）、一条腿 A 当闲
  // （闲家是 A 队，闲家分记 x_A）。
  const pairs = new Map<string, { level: number; xA: number | null; xB: number | null; aborted: boolean }>();

  for (const run of res.runs) {
    for (const ev of run.events) {
      // addHandStats books aborted 小局 itself and keeps them out of every
      // denominator; the 80 口径 north star counts only completed 小局.
      addHandStats(acc.statsA, ev, run.aParity);
      addHandStats(acc.statsB, ev, run.aParity === 0 ? 1 : 0);

      const aIsBanker = ev.teamBanker === run.aParity;
      if (!ev.aborted) {
        const aWon = aIsBanker ? ev.bankerWon : !ev.bankerWon;
        if (aWon) acc.handWinsA += 1;
        else acc.handWinsB += 1;
      }

      const key = `${ev.level}:${ev.declarerIdx}`;
      let pair = pairs.get(key);
      if (!pair) {
        pair = { level: ev.level, xA: null, xB: null, aborted: false };
        pairs.set(key, pair);
      }
      if (ev.aborted) { pair.aborted = true; continue; }
      if (aIsBanker) pair.xB = ev.finalPts;
      else pair.xA = ev.finalPts;
    }
  }

  // 一对齐备才比升级量；任一条腿中止 ⇒ 整对作废（配不成对）。
  let wonA = 0;
  let wonB = 0;
  for (const pair of pairs.values()) {
    if (pair.aborted || pair.xA === null || pair.xB === null) continue;
    const tA = tierOf(pair.xA);
    const tB = tierOf(pair.xB);
    const outcome = tA > tB ? 'a' : tB > tA ? 'b' : 'draw';
    acc.pairs += 1;
    let bucket = acc.tierByLevel.get(pair.level);
    if (!bucket) { bucket = emptyTier(); acc.tierByLevel.set(pair.level, bucket); }
    addTier(bucket, outcome);
    if (outcome === 'a') { acc.pairWinsA += 1; wonA += 1; }
    else if (outcome === 'b') { acc.pairWinsB += 1; wonB += 1; }
    else acc.pairsDrawn += 1;
  }
  if (wonA > wonB) acc.dealsWonA += 1;
  else if (wonB > wonA) acc.dealsWonB += 1;
  else acc.dealsDrawn += 1;
}

/** Run a contiguous range of deals, merging into one accumulator. */
export function runNTDeals(
  seed: number,
  dealStart: number,
  dealCount: number,
  strategyA: Strategy,
  strategyB: Strategy,
): NTStats {
  const acc = createNTStats();
  for (let k = dealStart; k < dealStart + dealCount; k++) {
    addNTDeal(acc, runNTDeal(seed, k, [strategyA, strategyB]));
  }
  return acc;
}

function mergeTierLevels(a: Map<number, TierBucket>, b: Map<number, TierBucket>): Map<number, TierBucket> {
  const out = new Map<number, TierBucket>();
  for (const [lv, v] of a) out.set(lv, { ...v });
  for (const [lv, v] of b) {
    const cur = out.get(lv);
    if (!cur) { out.set(lv, { ...v }); continue; }
    cur.n += v.n;
    cur.a += v.a;
    cur.b += v.b;
    cur.draw += v.draw;
  }
  return out;
}

export function mergeNTStats(a: NTStats, b: NTStats): NTStats {
  return {
    statsA: mergeStats(a.statsA, b.statsA),
    statsB: mergeStats(a.statsB, b.statsB),
    handWinsA: a.handWinsA + b.handWinsA,
    handWinsB: a.handWinsB + b.handWinsB,
    pairWinsA: a.pairWinsA + b.pairWinsA,
    pairWinsB: a.pairWinsB + b.pairWinsB,
    pairsDrawn: a.pairsDrawn + b.pairsDrawn,
    pairs: a.pairs + b.pairs,
    tierByLevel: mergeTierLevels(a.tierByLevel, b.tierByLevel),
    dealsWonA: a.dealsWonA + b.dealsWonA,
    dealsWonB: a.dealsWonB + b.dealsWonB,
    dealsDrawn: a.dealsDrawn + b.dealsDrawn,
    deals: a.deals + b.deals,
    skippedDeals: a.skippedDeals + b.skippedDeals,
  };
}

export function ntStatsToJSON(s: NTStats): Record<string, unknown> {
  const tierByLevel: Record<string, TierBucket> = {};
  for (const [lv, v] of s.tierByLevel) tierByLevel[String(lv)] = v;
  return {
    statsA: toJSON(s.statsA),
    statsB: toJSON(s.statsB),
    handWinsA: s.handWinsA,
    handWinsB: s.handWinsB,
    pairWinsA: s.pairWinsA,
    pairWinsB: s.pairWinsB,
    pairsDrawn: s.pairsDrawn,
    pairs: s.pairs,
    tierByLevel,
    dealsWonA: s.dealsWonA,
    dealsWonB: s.dealsWonB,
    dealsDrawn: s.dealsDrawn,
    deals: s.deals,
    skippedDeals: s.skippedDeals,
  };
}

export function ntStatsFromJSON(j: Record<string, any>): NTStats {
  const tierByLevel = new Map<number, TierBucket>();
  for (const [k, v] of Object.entries((j.tierByLevel ?? {}) as Record<string, TierBucket>)) {
    tierByLevel.set(Number(k), { ...v });
  }
  return {
    statsA: fromJSON(j.statsA),
    statsB: fromJSON(j.statsB),
    handWinsA: j.handWinsA,
    handWinsB: j.handWinsB,
    pairWinsA: j.pairWinsA,
    pairWinsB: j.pairWinsB,
    pairsDrawn: j.pairsDrawn,
    pairs: j.pairs,
    tierByLevel,
    dealsWonA: j.dealsWonA,
    dealsWonB: j.dealsWonB,
    dealsDrawn: j.dealsDrawn,
    deals: j.deals,
    skippedDeals: j.skippedDeals,
  };
}
