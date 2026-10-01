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
 *   104 小局 per kept deal; with A == B every deal is a 52-52 draw.
 * - No match (整场) concept — every statistic is computed over 小局 alone.
 *
 * Stats reuse the general arena's `StrategyStats` / `addHandStats` wholesale;
 * the only thing added here is the north-star win count (A = seats 0&2).
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
  /** 小局 won by A / B (aborted 小局 excluded) — the north-star numerator. */
  handWinsA: number;
  handWinsB: number;
  /**
   * Deal-level outcome: a deal is A's when A takes more 小局 of it than B,
   * B's when it takes more, drawn on a 52-52 split. 发牌 is the independent
   * unit (the 104 小局 of one deal share the same cards), so the significance
   * test runs on these counts rather than on the 小局 counts.
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
  let wonA = 0;
  let wonB = 0;
  for (const run of res.runs) {
    for (const ev of run.events) {
      // addHandStats books aborted 小局 itself and keeps them out of every
      // denominator; the north star counts only completed 小局.
      addHandStats(acc.statsA, ev, run.aParity);
      addHandStats(acc.statsB, ev, run.aParity === 0 ? 1 : 0);
      if (ev.aborted) continue;
      const aIsBanker = ev.teamBanker === run.aParity;
      const aWon = aIsBanker ? ev.bankerWon : !ev.bankerWon;
      if (aWon) { acc.handWinsA += 1; wonA += 1; }
      else { acc.handWinsB += 1; wonB += 1; }
    }
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

export function mergeNTStats(a: NTStats, b: NTStats): NTStats {
  return {
    statsA: mergeStats(a.statsA, b.statsA),
    statsB: mergeStats(a.statsB, b.statsB),
    handWinsA: a.handWinsA + b.handWinsA,
    handWinsB: a.handWinsB + b.handWinsB,
    dealsWonA: a.dealsWonA + b.dealsWonA,
    dealsWonB: a.dealsWonB + b.dealsWonB,
    dealsDrawn: a.dealsDrawn + b.dealsDrawn,
    deals: a.deals + b.deals,
    skippedDeals: a.skippedDeals + b.skippedDeals,
  };
}

export function ntStatsToJSON(s: NTStats): Record<string, unknown> {
  return {
    statsA: toJSON(s.statsA),
    statsB: toJSON(s.statsB),
    handWinsA: s.handWinsA,
    handWinsB: s.handWinsB,
    dealsWonA: s.dealsWonA,
    dealsWonB: s.dealsWonB,
    dealsDrawn: s.dealsDrawn,
    deals: s.deals,
    skippedDeals: s.skippedDeals,
  };
}

export function ntStatsFromJSON(j: Record<string, any>): NTStats {
  return {
    statsA: fromJSON(j.statsA),
    statsB: fromJSON(j.statsB),
    handWinsA: j.handWinsA,
    handWinsB: j.handWinsB,
    dealsWonA: j.dealsWonA,
    dealsWonB: j.dealsWonB,
    dealsDrawn: j.dealsDrawn,
    deals: j.deals,
    skippedDeals: j.skippedDeals,
  };
}
