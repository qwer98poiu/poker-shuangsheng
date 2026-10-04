import { describe, it, expect } from 'vitest';
import { deckForHand } from '../rng.js';
import { playHand } from '../match.js';
import { hasJokerPairDeal } from '../nt-arena.js';
import { engineStrategy, ai0929Strategy } from '../strategies.js';
import {
  addSoloDeal, createSoloStats, mergeSoloStats, runSoloDeal, runSoloDeals,
  soloStatsFromJSON, soloStatsToJSON, tierOf, tierOutcome, trialFromPoints,
} from '../solo-arena.js';
import type { SoloDealResult, Trial } from '../solo-arena.js';

const LEVEL = 2;

/** 扫出第一副「某座位握有对王」的发牌（自然亮主即无主）。 */
function firstJokerPairDeal(seed: number): number {
  for (let k = 0; k < 200; k++) {
    if (hasJokerPairDeal(deckForHand(seed, 0, k))) return k;
  }
  throw new Error('200 副里没有找到对王发牌');
}

/** 扫出第一副「四家都没有对王」的发牌。 */
function firstPlainDeal(seed: number): number {
  for (let k = 0; k < 200; k++) {
    if (!hasJokerPairDeal(deckForHand(seed, 0, k))) return k;
  }
  throw new Error('200 副里没有找到无对王发牌');
}

const trial = (banker: Trial['banker'], attacker: Trial['attacker']): SoloDealResult => ({
  dealIndex: 0, skipped: false, perLevel: new Map([[LEVEL, { banker, attacker }]]),
  abortedHands: 0, handsPlayed: 3, tricksPlayed: 75,
});

describe('档位口径', () => {
  it('tierOf = 升级量档：0 分（大光）单列一档，其余 ⌊分/40⌋', () => {
    expect(tierOf(0)).toBe(-1);
    expect(tierOf(1)).toBe(0);
    expect(tierOf(39)).toBe(0);
    expect(tierOf(40)).toBe(1);
    expect(tierOf(79)).toBe(1);
    expect(tierOf(80)).toBe(2);
    expect(tierOf(119)).toBe(2);
    expect(tierOf(120)).toBe(3);
  });

  it('tierOutcome 庄家侧：A 希望分低', () => {
    expect(tierOutcome(79, 120, true)).toBe('a');   // 1 档 vs 3 档
    expect(tierOutcome(120, 79, true)).toBe('b');
    expect(tierOutcome(79, 79, true)).toBe('draw');
    expect(tierOutcome(39, 40, true)).toBe('a');    // 0 档 vs 1 档
    expect(tierOutcome(80, 79, true)).toBe('b');
    expect(tierOutcome(0, 20, true)).toBe('a');     // −1 档（大光）vs 0 档（小光）：不再判平
  });

  it('tierOutcome 闲家侧：A 希望分高', () => {
    expect(tierOutcome(120, 79, false)).toBe('a');
    expect(tierOutcome(79, 120, false)).toBe('b');
    expect(tierOutcome(80, 80, false)).toBe('draw');
    expect(tierOutcome(20, 0, false)).toBe('a');    // 0 档（小光）vs −1 档（大光）
    expect(tierOutcome(0, 0, false)).toBe('draw');
  });
});

describe('trialFromPoints 定向', () => {
  it('庄家测 d = p(L0) − p(L1)，闲家测 d = p(L2) − p(L0)，均以 A 更好为正', () => {
    const t = trialFromPoints(120, 79, 40); // p0 = 基准，p1 = A 当庄，p2 = A 当闲
    expect(t.banker.d).toBe(41);            // 120 − 79：A 当庄把闲家分压低 → A 更好
    expect(t.banker.outcome).toBe('a');     // ⌊79/40⌋=1 < ⌊120/40⌋=3
    expect(t.attacker.d).toBe(-80);         // 40 − 120：A 当闲把闲家分推低了 → A 更差
    expect(t.attacker.outcome).toBe('b');
  });

  it('A 分数胜出但档位平：d > 0 而 outcome = draw', () => {
    const t = trialFromPoints(100, 90, 100);
    expect(t.banker.d).toBe(10);
    expect(t.banker.outcome).toBe('draw');  // ⌊90/40⌋ = ⌊100/40⌋ = 2
  });
});

describe('累加器', () => {
  it('addSoloDeal 的桶算术精确', () => {
    const acc = createSoloStats([LEVEL]);
    addSoloDeal(acc, trial({ outcome: 'a', d: 10 }, { outcome: 'draw', d: -3 }));
    addSoloDeal(acc, trial({ outcome: 'b', d: -2 }, { outcome: 'a', d: 5 }));
    const st = acc.levels.get(LEVEL)!;
    expect(st.bankerTier).toEqual({ n: 2, a: 1, b: 1, draw: 0 });
    expect(st.bankerPts).toEqual({ n: 2, sumD: 8, sumD2: 104, pos: 1, neg: 1, zero: 0 });
    expect(st.attackerTier).toEqual({ n: 2, a: 1, b: 0, draw: 1 });
    expect(st.attackerPts).toEqual({ n: 2, sumD: 2, sumD2: 34, pos: 1, neg: 1, zero: 0 });
    expect(acc.attemptedDeals).toBe(2);
    expect(acc.keptDeals).toBe(2);
    expect(acc.skippedDeals).toBe(0);
    expect(acc.handsPlayed).toBe(6);
    expect(acc.tricksPlayed).toBe(150);
  });

  it('被过滤的发牌只计入 skippedDeals', () => {
    const acc = createSoloStats([LEVEL]);
    addSoloDeal(acc, { dealIndex: 1, skipped: true, perLevel: new Map(), abortedHands: 0, handsPlayed: 0, tricksPlayed: 0 });
    expect(acc.attemptedDeals).toBe(1);
    expect(acc.keptDeals).toBe(0);
    expect(acc.skippedDeals).toBe(1);
    expect(acc.handsPlayed).toBe(0);
  });

  it('mergeSoloStats 可加：分两段跑 == 一次跑', () => {
    const run = (start: number, count: number): ReturnType<typeof runSoloDeals> =>
      runSoloDeals(7, start, count, [LEVEL], engineStrategy, ai0929Strategy, false, []);
    const merged = mergeSoloStats(run(0, 1), run(1, 1));
    const whole = run(0, 2);
    expect(soloStatsToJSON(merged)).toEqual(soloStatsToJSON(whole));
  });

  it('JSON 往返保持等级与精确计数', () => {
    const acc = createSoloStats([2, 5]);
    addSoloDeal(acc, trial({ outcome: 'a', d: 10 }, { outcome: 'draw', d: -3 }));
    const back = soloStatsFromJSON(soloStatsToJSON(acc));
    expect([...back.levels.keys()]).toEqual([2, 5]);
    expect(back.levels.get(2)).toEqual(acc.levels.get(2));
    expect(back.keptDeals).toBe(1);
    expect(back.handsPlayed).toBe(3);
  });
});

describe('固定 P0 为庄家 / 每条腿自然亮主（引擎契约）', () => {
  const run = (seed: number, dealIndex: number) => playHand({
    deck: deckForHand(seed, 0, dealIndex),
    handIndex: LEVEL, declarerIdx: 0, level: LEVEL, attackerLevel: LEVEL, isFirstHand: false,
    strategies: [engineStrategy, engineStrategy],
  });

  it('declarerIdx=0 + isFirstHand=false → 庄家恒为 P0（teamBanker 恒 0）', () => {
    for (let k = 0; k < 5; k++) {
      const ev = run(7, k);
      expect(ev.aborted).toBe(false);
      expect(ev.declarerIdx).toBe(0);
      expect(ev.teamBanker).toBe(0);
      expect(ev.level).toBe(LEVEL);
    }
  });

  it('有对王的发牌：自然亮主落在无主', () => {
    const ev = run(7, firstJokerPairDeal(7));
    expect(ev.trumpSuit).toBe(null);
  });

  it('无对王的普通发牌：自然亮主是有主花色', () => {
    const idx = firstPlainDeal(7);
    expect(idx).toBe(1); // seed 7 的第 0 副恰有对王，第 1 副没有
    expect(hasJokerPairDeal(deckForHand(7, 0, idx))).toBe(false);
    expect(run(7, idx).trumpSuit).not.toBe(null);
  });
});

describe('runSoloDeal / runSoloDeals', () => {
  it('A === B 时三条腿逐张一致：d 恒 0、档位恒平', () => {
    for (const seed of [7, 11]) {
      for (let k = 0; k < 3; k++) {
        const r = runSoloDeal({
          seed, dealIndex: k, levels: [LEVEL],
          strategyA: engineStrategy, strategyB: engineStrategy,
          ntOnly: false, dealFilters: [],
        });
        expect(r.skipped).toBe(false);
        expect(r.handsPlayed).toBe(3);
        const t = r.perLevel.get(LEVEL)!;
        expect(t.banker.d).toBe(0);
        expect(t.attacker.d).toBe(0);
        expect(t.banker.outcome).toBe('draw');
        expect(t.attacker.outcome).toBe('draw');
      }
    }
  });

  it('多等级：每等级各出一份 trial，腿数是等级数 × 3', () => {
    const acc = runSoloDeals(7, 0, 2, [2, 5, 10], engineStrategy, ai0929Strategy, false, []);
    expect([...acc.levels.keys()]).toEqual([2, 5, 10]);
    expect(acc.attemptedDeals).toBe(2);
    expect(acc.keptDeals).toBe(2);
    for (const lv of [2, 5, 10]) {
      expect(acc.levels.get(lv)!.bankerTier.n).toBe(2);
    }
    expect(acc.handsPlayed).toBe(2 * 3 * 3);
    expect(acc.abortedHands).toBe(0);
  });

  it('--nt-only 过滤掉无对王的发牌', () => {
    const plain = runSoloDeal({
      seed: 7, dealIndex: firstPlainDeal(7), levels: [LEVEL],
      strategyA: engineStrategy, strategyB: engineStrategy,
      ntOnly: true, dealFilters: [],
    });
    expect(plain.skipped).toBe(true);
    expect(plain.perLevel.size).toBe(0);

    const pair = runSoloDeal({
      seed: 7, dealIndex: firstJokerPairDeal(7), levels: [LEVEL],
      strategyA: engineStrategy, strategyB: engineStrategy,
      ntOnly: true, dealFilters: [],
    });
    expect(pair.skipped).toBe(false);
    expect(pair.perLevel.size).toBe(1);

    // seed 7 的前 40 副里恰好 14 副有对王（发牌过滤是确定性的，故用精确值）
    const acc = runSoloDeals(7, 0, 40, [LEVEL], engineStrategy, engineStrategy, true, []);
    expect(acc.attemptedDeals).toBe(40);
    expect(acc.keptDeals).toBe(14);
    expect(acc.skippedDeals).toBe(26);
    expect(acc.handsPlayed).toBe(14 * 3);
  });
});
