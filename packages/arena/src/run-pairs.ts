/**
 * 对决 runner: one 对决 = two mirrored matches sharing the same decks
 * (hand index i uses deckForHand(seed, pair, i) in BOTH matches).
 */
import { playMatch } from './match.js';
import { createStats, addHandStats, addMatchOutcome, mergeStats } from './stats.js';
import type { StrategyStats } from './stats.js';
import type { Strategy } from './types.js';

export interface PairStats {
  statsA: StrategyStats;
  statsB: StrategyStats;
}

/**
 * Run one 对决:
 * - match 1: strategy A on seats 0&2, B on seats 1&3
 * - match 2: swapped
 */
export function runPair(
  seed: number,
  pairIndex: number,
  strategyA: Strategy,
  strategyB: Strategy,
): PairStats {
  const statsA = createStats();
  const statsB = createStats();

  for (const swapped of [false, true]) {
    const strategies: [Strategy, Strategy] = swapped ? [strategyB, strategyA] : [strategyA, strategyB];
    const result = playMatch({ seed, pairIndex, strategies });
    addMatchOutcome(statsA, result.winnerTeam, swapped ? 1 : 0);
    addMatchOutcome(statsB, result.winnerTeam, swapped ? 0 : 1);
    for (const ev of result.events) {
      addHandStats(statsA, ev, swapped ? 1 : 0);
      addHandStats(statsB, ev, swapped ? 0 : 1);
    }
  }
  return { statsA, statsB };
}

/** Run a contiguous range of pairs, merging stats. */
export function runPairs(
  seed: number,
  pairStart: number,
  pairCount: number,
  strategyA: Strategy,
  strategyB: Strategy,
): PairStats {
  let accA = createStats();
  let accB = createStats();
  for (let k = pairStart; k < pairStart + pairCount; k++) {
    const { statsA, statsB } = runPair(seed, k, strategyA, strategyB);
    accA = mergeStats(accA, statsA);
    accB = mergeStats(accB, statsB);
  }
  return { statsA: accA, statsB: accB };
}
