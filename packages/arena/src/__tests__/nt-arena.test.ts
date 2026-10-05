import { describe, it, expect } from 'vitest';
import { createFullDeck, Rank } from '@poker/engine';
import type { Card } from '@poker/engine';
import {
  hasJokerPairDeal, runNTDeal, runNTDeals, addNTDeal, createNTStats,
  mergeNTStats, ntHandsPlayed, ntStatsToJSON, ntStatsFromJSON, HANDS_PER_DEAL, NT_LEVELS,
  A_PARITIES,
} from '../nt-arena.js';
import type { NTDealResult, NTDealRun } from '../nt-arena.js';
import type { HandEvent } from '../types.js';
import type { TierBucket } from '../tier.js';
import { dealtHands } from '../match.js';
import { deckForHand } from '../rng.js';
import { handWinRate } from '../stats.js';
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

/** Minimal HandEvent for hand-constructed deals. */
function handEvent(partial: Partial<HandEvent>): HandEvent {
  return {
    handIndex: 0, level: 5, attackerLevel: 5, declarerIdx: 0, teamBanker: 0,
    trumpSuit: null, bottomPoints: 0, killSuitCount: 0,
    attackerWonLastTrick: false, kouDiAdd: 0, finalPts: 40, bankerWon: false,
    tricksPlayed: 13, tricksWonByTeam0: 7, cardsWonByTeam0: 13, leadsByTeam0: 7,
    leadCardsByTeam0: 13, leadCardsTotal: 26, errors: 0, aborted: false,
    ...partial,
  };
}

/**
 * 一副只含一个 (等级, 庄家座位) 镜像对的 NTDealResult（两轮 aParity 0/1 各一条腿）。
 * `xA` = A 当闲那条腿的闲家分，`xB` = A 当庄那条腿的闲家分（两条腿的闲家都是对方队）。
 * A 与庄家队同奇偶（`aParity === teamBanker`）的那条腿才是 A 当庄。
 */
function onePair(
  level: number,
  declarerIdx: number,
  xA: number,
  xB: number,
  abort: { a?: boolean; b?: boolean } = {},
): NTDealResult {
  const teamBanker = (declarerIdx % 2) as 0 | 1;
  const runs: NTDealRun[] = A_PARITIES.map(aParity => {
    const aIsBanker = aParity === teamBanker;
    const finalPts = aIsBanker ? xB : xA;
    const aborted = aIsBanker ? abort.b === true : abort.a === true;
    return {
      aParity,
      events: [handEvent({ level, attackerLevel: level, declarerIdx, teamBanker, finalPts, bankerWon: finalPts < 80, aborted })],
    };
  });
  return { dealIndex: 0, skipped: false, runs };
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

describe('NT arena — one deal = 104 NT 小局（两种座位分配各 52）', () => {
  it('skipped deals produce nothing', () => {
    // Find a deal the filter rejects, then confirm runNTDeal is a no-op.
    let skippedIndex = -1;
    for (let k = 0; k < 200 && skippedIndex < 0; k++) {
      if (!hasJokerPairDeal(deckForHand(7, 0, k))) skippedIndex = k;
    }
    expect(skippedIndex).toBeGreaterThanOrEqual(0);
    const res = runNTDeal(7, skippedIndex, [engineStrategy, ai0816Strategy]);
    expect(res.skipped).toBe(true);
    expect(res.runs).toEqual([]);
  });

  it('a kept deal yields 4 declarers × 13 levels × 2 座位分配, all NT', () => {
    // Use the engine strategies' own reveal path: filter first, then play.
    let played;
    for (let k = 0; k < 40; k++) {
      const probe = runNTDeal(7, k, [engineStrategy, engineStrategy]);
      if (!probe.skipped) { played = probe; break; }
    }
    expect(played).toBeDefined();
    expect(played!.runs.map(r => r.aParity)).toEqual([0, 1]);
    const events = played!.runs.flatMap(r => r.events);
    expect(events.length).toBe(HANDS_PER_DEAL);
    expect(HANDS_PER_DEAL).toBe(104);

    const levels = new Set(events.map(e => e.level));
    expect([...levels].sort((a, b) => a - b)).toEqual([...NT_LEVELS]);
    for (const ev of events) {
      expect(ev.trumpSuit).toBeNull();          // 只打无主
      expect(ev.aborted).toBe(false);
      expect(ev.errors).toBe(0);
    }

    // 每轮的 52 小局里，0/2 号位当庄 26 次（A 坐哪边，哪边就是 A 的当庄）。
    for (const run of played!.runs) {
      expect(run.events.filter(e => e.teamBanker === 0).length).toBe(run.events.length / 2);
    }
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
    // north-star 是 80 口径的独立计数，必须与 per-strategy 累加器导出的台上+台下胜局一致
    expect(handWinRate(acc.statsA)).toEqual({ n: acc.handWinsA, d: HANDS_PER_DEAL });
    expect(handWinRate(acc.statsB)).toEqual({ n: acc.handWinsB, d: HANDS_PER_DEAL });
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
    expect(acc.pairs).toBe(52);
    expect(acc.pairWinsA + acc.pairWinsB + acc.pairsDrawn).toBe(acc.pairs);
    // 发牌口径就是「这副牌里 a 对 / b 对的数量比大小」，单副时两者方向必然一致。
    if (acc.dealsWonA > 0) expect(acc.pairWinsA).toBeGreaterThan(acc.pairWinsB);
    if (acc.dealsWonB > 0) expect(acc.pairWinsB).toBeGreaterThan(acc.pairWinsA);
  });

  it('镜像不变量：A == B 时每对档位相同 ⇒ 每副牌 0-0 平', () => {
    // 两轮是同一副牌、策略对调：A==B 时两轮事件逐一相同，一对里两条腿的闲家分
    // 相同 ⇒ tierOf 相同 ⇒ 每一对都记平（不是「两边各赢 52 局」那种 52-52）。
    const acc = runNTDeals(11, 0, 3, engineStrategy, engineStrategy);
    expect(acc.deals).toBe(3);
    expect(acc.dealsDrawn).toBe(3);
    expect(acc.dealsWonA).toBe(0);
    expect(acc.dealsWonB).toBe(0);
    expect(acc.pairs).toBe(acc.deals * 52);
    expect(acc.pairsDrawn).toBe(acc.pairs);
    expect(acc.pairWinsA).toBe(0);
    expect(acc.pairWinsB).toBe(0);
    expect(acc.handWinsA).toBe(acc.deals * (HANDS_PER_DEAL / 2));
    expect(acc.handWinsB).toBe(acc.deals * (HANDS_PER_DEAL / 2));
  });

  it('配对档位四格穷举：a / b / 平 / 一边中止（两种庄家座位各跑一遍）', () => {
    const cases: {
      name: string; xA: number; xB: number; abortA?: boolean; abortB?: boolean;
      a: number; b: number; draw: number; pairs: number;
      dealsWonA: number; dealsWonB: number; dealsDrawn: number;
    }[] = [
      { name: 'A 档位更高 → a', xA: 120, xB: 40, a: 1, b: 0, draw: 0, pairs: 1, dealsWonA: 1, dealsWonB: 0, dealsDrawn: 0 },
      { name: 'B 档位更高 → b', xA: 40, xB: 120, a: 0, b: 1, draw: 0, pairs: 1, dealsWonA: 0, dealsWonB: 1, dealsDrawn: 0 },
      { name: '同档不同分 → 平', xA: 45, xB: 50, a: 0, b: 0, draw: 1, pairs: 1, dealsWonA: 0, dealsWonB: 0, dealsDrawn: 1 },
      { name: '大光(−1) vs 小光(0) → b（0 分单列一档）', xA: 0, xB: 5, a: 0, b: 1, draw: 0, pairs: 1, dealsWonA: 0, dealsWonB: 1, dealsDrawn: 0 },
      { name: 'A 当闲腿中止 → 整对作废', xA: 120, xB: 40, abortA: true, a: 0, b: 0, draw: 0, pairs: 0, dealsWonA: 0, dealsWonB: 0, dealsDrawn: 1 },
      { name: 'A 当庄腿中止 → 整对作废', xA: 40, xB: 120, abortB: true, a: 0, b: 0, draw: 0, pairs: 0, dealsWonA: 0, dealsWonB: 0, dealsDrawn: 1 },
    ];
    // 庄家座位取 0（队 0 当庄，A 当庄腿是 aParity=0）与 3（队 1 当庄，A 当庄腿是 aParity=1）
    // 各跑一遍，覆盖两条分支；等级取 9、其余等级该副没有对，故只查 9 这一档。
    for (const declarerIdx of [0, 3]) {
      for (const c of cases) {
        const label = `declarerIdx=${declarerIdx} ${c.name}`;
        const acc = createNTStats();
        addNTDeal(acc, onePair(9, declarerIdx, c.xA, c.xB, { a: c.abortA, b: c.abortB }));
        expect(acc.deals, label).toBe(1);
        expect(acc.pairs, label).toBe(c.pairs);
        expect(acc.pairWinsA, label).toBe(c.a);
        expect(acc.pairWinsB, label).toBe(c.b);
        expect(acc.pairsDrawn, label).toBe(c.draw);
        expect(acc.dealsWonA, label).toBe(c.dealsWonA);
        expect(acc.dealsWonB, label).toBe(c.dealsWonB);
        expect(acc.dealsDrawn, label).toBe(c.dealsDrawn);
        // 只有 9 这一档有配对，整副作废时该档不存在
        expect(acc.tierByLevel.get(9)?.n ?? 0, label).toBe(c.pairs);
        // 中止的腿不进任何分母
        expect(acc.statsA.abortedHands, label).toBe(c.abortA || c.abortB ? 1 : 0);
        expect(acc.statsA.handsPlayed, label).toBe(c.abortA || c.abortB ? 1 : 2);
      }
    }
  });

  it('不变式：一对镜像里两条腿庄家座位相同，且恰有一条腿 A 当庄', () => {
    let res: NTDealResult | undefined;
    for (let k = 0; k < 40 && res === undefined; k++) {
      const probe = runNTDeal(7, k, [engineStrategy, engineStrategy]);
      if (!probe.skipped) res = probe;
    }
    expect(res).toBeDefined();
    for (const declarerIdx of [0, 1, 2, 3]) {
      const legs = res!.runs.map(run => run.events.find(e => e.level === 5 && e.declarerIdx === declarerIdx)!);
      expect(legs).toHaveLength(2);
      // 庄家座位（= 庄家队）在两轮里相同 ⇒ 攻方（闲家）坐的是同一队座位
      expect(legs[0].teamBanker).toBe(legs[1].teamBanker);
      expect(legs[0].declarerIdx).toBe(legs[1].declarerIdx);
      // 恰有一条腿 A 当庄（A 坐的奇偶 == 庄家队），另一条 A 当闲
      const aBanker = res!.runs.map((run, i) => legs[i].teamBanker === run.aParity);
      expect(aBanker.filter(Boolean)).toHaveLength(1);
    }
  });

  it('真发牌对账：a + b + 平 === pairs，且 pairs === 52 − 中止对数', () => {
    let res: NTDealResult | undefined;
    for (let k = 0; k < 40 && res === undefined; k++) {
      const probe = runNTDeal(7, k, [engineStrategy, ai0816Strategy]);
      if (!probe.skipped) res = probe;
    }
    expect(res).toBeDefined();
    const acc = createNTStats();
    addNTDeal(acc, res!);
    expect(acc.pairWinsA + acc.pairWinsB + acc.pairsDrawn).toBe(acc.pairs);

    // 与事件表独立对账：作废的对 = 至少一条腿中止的 (等级, 庄家座位)
    const legs = res!.runs.flatMap(run => run.events);
    const keys = new Set(legs.map(e => `${e.level}:${e.declarerIdx}`));
    let voidedPairs = 0;
    for (const key of keys) {
      const two = legs.filter(e => `${e.level}:${e.declarerIdx}` === key);
      if (two.length !== 2 || two.some(e => e.aborted)) voidedPairs += 1;
    }
    expect(keys.size).toBe(52);
    expect(acc.pairs).toBe(52 - voidedPairs);

    // 等级分档的样本数之和 = 可比较对数（每等级 4 个庄家座位 × 1 个等级）
    let bucketTotal = 0;
    for (const b of acc.tierByLevel.values()) bucketTotal += b.n;
    expect(bucketTotal).toBe(acc.pairs);
    if (voidedPairs === 0) {
      for (const lv of NT_LEVELS) expect(acc.tierByLevel.get(lv)?.n).toBe(4);
    }
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
    addNTDeal(acc, { dealIndex: 0, skipped: true, runs: [] });
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
    expect(split.pairs).toBe(whole.pairs);
    expect(split.pairWinsA).toBe(whole.pairWinsA);
    expect(split.pairWinsB).toBe(whole.pairWinsB);
    expect(split.pairsDrawn).toBe(whole.pairsDrawn);
    expect(split.tierByLevel.get(5)).toEqual(whole.tierByLevel.get(5));
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
    expect(back.pairs).toBe(acc.pairs);
    expect(back.pairWinsA).toBe(acc.pairWinsA);
    expect(back.pairsDrawn).toBe(acc.pairsDrawn);
    const byLevel = (m: Map<number, TierBucket>): [number, TierBucket][] =>
      [...m.entries()].sort((x, y) => x[0] - y[0]);
    expect(byLevel(back.tierByLevel)).toEqual(byLevel(acc.tierByLevel));
    expect(back.statsA.banker.perLevel.get(7)).toEqual(acc.statsA.banker.perLevel.get(7));
    expect(back.statsB.tricks.leadCards).toEqual(acc.statsB.tricks.leadCards);
  });
});
