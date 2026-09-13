import { describe, it, expect } from 'vitest';
import { createFullDeck, Rank } from '@poker/engine';
import type { Card } from '@poker/engine';
import {
  dealtHands, hasJokerPairDeal, runNTDeal, runNTDeals, addNTDeal, createNTStats,
  mergeNTStats, ntHandsPlayed, ntStatsToJSON, ntStatsFromJSON, HANDS_PER_DEAL, NT_LEVELS,
} from '../nt-arena.js';
import { deckForHand } from '../rng.js';
import { compareRates, wilson } from '../nt-significance.js';
import { engineStrategy, ai0816Strategy } from '../strategies.js';

/** Deck with both jokers of `rank` forced into seat `seat`. */
function deckWithJokerPair(rank: Rank, seat: number): Card[] {
  const deck = createFullDeck();
  const idx = deck
    .map((c, i) => ({ c, i }))
    .filter(x => x.c.rank === rank)
    .map(x => x.i);
  expect(idx.length).toBe(2);
  // Seat of position i is i % 4 — swap the jokers into two slots of that seat.
  for (let k = 0; k < 2; k++) {
    const target = seat + 4 * k;
    const from = idx[k];
    const tmp = deck[target];
    deck[target] = deck[from];
    deck[from] = tmp;
  }
  return deck;
}

/** Deck where every joker sits in a different seat. */
function deckWithoutJokerPair(): Card[] {
  const deck = createFullDeck();
  const targets = [Rank.BigJoker, Rank.BigJoker, Rank.SmallJoker, Rank.SmallJoker];
  const slots = [0, 1, 2, 3]; // seats 0,1,2,3 — one copy each
  const used = new Set<number>();
  for (let k = 0; k < 4; k++) {
    const from = deck.findIndex((c, i) => c.rank === targets[k] && !used.has(i));
    used.add(from);
    const tmp = deck[slots[k]];
    deck[slots[k]] = deck[from];
    deck[from] = tmp;
  }
  return deck;
}

describe('NT arena — deal filter', () => {
  it('deals card i to seat i % 4', () => {
    const deck = createFullDeck();
    const hands = dealtHands(deck);
    expect(hands.map(h => h.length)).toEqual([25, 25, 25, 25]);
    expect(hands[0][0]).toBe(deck[0]);
    expect(hands[3][24]).toBe(deck[99]);
  });

  it('accepts a deal where one seat holds both copies of a joker', () => {
    expect(hasJokerPairDeal(deckWithJokerPair(Rank.BigJoker, 0))).toBe(true);
    expect(hasJokerPairDeal(deckWithJokerPair(Rank.SmallJoker, 3))).toBe(true);
  });

  it('rejects a deal where no seat holds a joker pair', () => {
    expect(hasJokerPairDeal(deckWithoutJokerPair())).toBe(false);
  });
});

describe('NT arena — one deal = 52 NT 小局', () => {
  it('skipped deals produce nothing', () => {
    // Find a deal the filter rejects, then confirm runNTDeal is a no-op.
    let skippedIndex = -1;
    for (let k = 0; k < 200 && skippedIndex < 0; k++) {
      if (!hasJokerPairDeal(deckForHand(7, 0, k))) skippedIndex = k;
    }
    expect(skippedIndex).toBeGreaterThanOrEqual(0);
    const res = runNTDeal(7, skippedIndex, [engineStrategy, ai0816Strategy]);
    expect(res.skipped).toBe(true);
    expect(res.events).toEqual([]);
  });

  it('a kept deal yields 4 declarers × 13 levels, all NT', () => {
    // Use the engine strategies' own reveal path: filter first, then play.
    let played;
    for (let k = 0; k < 40; k++) {
      const probe = runNTDeal(7, k, [engineStrategy, engineStrategy]);
      if (!probe.skipped) { played = probe; break; }
    }
    expect(played).toBeDefined();
    expect(played!.events.length).toBe(HANDS_PER_DEAL);
    expect(HANDS_PER_DEAL).toBe(52);

    const levels = new Set(played!.events.map(e => e.level));
    expect([...levels].sort((a, b) => a - b)).toEqual([...NT_LEVELS]);
    for (const ev of played!.events) {
      expect(ev.trumpSuit).toBeNull();          // 只打无主
      expect(ev.aborted).toBe(false);
      expect(ev.errors).toBe(0);
    }

    // Mirror: each side is 台上 for exactly half the 小局.
    const aBanker = played!.events.filter(e => e.teamBanker === 0).length;
    expect(aBanker).toBe(HANDS_PER_DEAL / 2);
  });
});

describe('NT arena — stats accumulation', () => {
  it('books north-star wins only for completed 小局', () => {
    let res;
    for (let k = 0; k < 40; k++) {
      const probe = runNTDeal(7, k, [engineStrategy, ai0816Strategy]);
      if (!probe.skipped) { res = probe; break; }
    }
    const acc = createNTStats();
    addNTDeal(acc, res!);
    expect(ntHandsPlayed(acc)).toBe(HANDS_PER_DEAL);
    expect(acc.handWinsA + acc.handWinsB).toBe(HANDS_PER_DEAL);
    expect(acc.deals).toBe(1);
    expect(acc.skippedDeals).toBe(0);
    // Every 小局 is banked by exactly one side.
    expect(acc.statsA.banker.hands + acc.statsA.attacker.hands).toBe(HANDS_PER_DEAL);
    expect(acc.statsB.banker.hands + acc.statsB.attacker.hands).toBe(HANDS_PER_DEAL);
  });

  it('books one deal-level outcome per kept deal (发牌口径的显著性单位)', () => {
    let res;
    for (let k = 0; k < 40; k++) {
      const probe = runNTDeal(7, k, [engineStrategy, ai0816Strategy]);
      if (!probe.skipped) { res = probe; break; }
    }
    const acc = createNTStats();
    addNTDeal(acc, res!);
    expect(acc.dealsWonA + acc.dealsWonB + acc.dealsDrawn).toBe(acc.deals);
    expect(acc.deals).toBe(1);
    // 每副牌 52 小局、双方各当庄 26 次，所以「A 赢的小局多」与 handWins 一致。
    if (acc.dealsWonA > 0) expect(acc.handWinsA).toBeGreaterThan(acc.handWinsB);
    if (acc.dealsWonB > 0) expect(acc.handWinsB).toBeGreaterThan(acc.handWinsA);
  });

  it('平均每局赢得张数：每局一个样本，且双方之和等于全部领出张数', () => {
    const acc = runNTDeals(11, 0, 1, engineStrategy, ai0816Strategy);
    if (acc.deals === 0) return; // 该种子下首副被过滤，跳过
    const a = acc.statsA.tricks;
    const b = acc.statsB.tricks;

    expect(a.cardsWon.d).toBe(acc.statsA.handsPlayed); // 分母 = 小局数
    expect(b.cardsWon.d).toBe(acc.statsB.handsPlayed);
    expect(a.cardsWon.n).toBeGreaterThan(0);
    expect(b.cardsWon.n).toBeGreaterThan(0);
    // 每一墩都被某一方赢下，故赢得张数之和 == 全部墩的领出张数之和
    expect(a.cardsWon.n + b.cardsWon.n).toBe(a.leadCards.n + b.leadCards.n);
  });

  it('counts skipped deals without touching the 小局 totals', () => {
    const acc = createNTStats();
    addNTDeal(acc, { dealIndex: 0, skipped: true, events: [] });
    expect(acc.skippedDeals).toBe(1);
    expect(acc.deals).toBe(0);
    expect(ntHandsPlayed(acc)).toBe(0);
  });

  it('merging ranges equals running them in one go', () => {
    const split = mergeNTStats(
      runNTDeals(11, 0, 1, engineStrategy, ai0816Strategy),
      runNTDeals(11, 1, 1, engineStrategy, ai0816Strategy),
    );
    const whole = runNTDeals(11, 0, 2, engineStrategy, ai0816Strategy);
    expect(split.deals).toBe(whole.deals);
    expect(split.skippedDeals).toBe(whole.skippedDeals);
    expect(split.handWinsA).toBe(whole.handWinsA);
    expect(split.handWinsB).toBe(whole.handWinsB);
    expect(split.statsA.handsPlayed).toBe(whole.statsA.handsPlayed);
    expect(split.statsA.banker.wins).toBe(whole.statsA.banker.wins);
    expect(split.statsB.attacker.kouDiFreq).toEqual(whole.statsB.attacker.kouDiFreq);
  });

  it('survives a JSON round trip (worker aggregation)', () => {
    const acc = runNTDeals(11, 0, 2, engineStrategy, ai0816Strategy);
    const back = ntStatsFromJSON(ntStatsToJSON(acc));
    expect(back.handWinsA).toBe(acc.handWinsA);
    expect(back.deals).toBe(acc.deals);
    expect(back.skippedDeals).toBe(acc.skippedDeals);
    expect(back.statsA.banker.perLevel.get(7)).toEqual(acc.statsA.banker.perLevel.get(7));
    expect(back.statsB.tricks.leadCards).toEqual(acc.statsB.tricks.leadCards);
  });
});

describe('NT arena — rate significance', () => {
  it('a big gap on a decent sample is significant', () => {
    const cmp = compareRates(600, 1000, 400, 1000);
    expect(cmp.significant).toBe(true);
    expect(cmp.leader).toBe('A');
    expect(cmp.diffCi.lower).toBeGreaterThan(0);
  });

  it('identical rates are never significant', () => {
    const cmp = compareRates(500, 1000, 500, 1000);
    expect(cmp.significant).toBe(false);
    expect(cmp.leader).toBeNull();
  });

  it('an empty denominator yields no verdict', () => {
    const cmp = compareRates(0, 0, 5, 10);
    expect(cmp.significant).toBe(false);
    expect(cmp.leader).toBeNull();
    expect(cmp.ciA).toEqual({ lower: 0, upper: 1 });
  });

  it('wilson stays inside [0,1] at the extremes', () => {
    // float residue at the boundary, hence the tolerance rather than toBe(0)
    expect(wilson(0, 10).lower).toBeLessThan(1e-12);
    expect(wilson(10, 10).upper).toBeGreaterThan(1 - 1e-12);
  });
});
