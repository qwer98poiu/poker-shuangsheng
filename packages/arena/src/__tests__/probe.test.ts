import { describe, it, expect } from 'vitest';
import { createCard } from '@poker/engine';
import type { Card, CardSuit } from '@poker/engine';
import type { AIContext } from '@poker/ai';
import type { Strategy } from '../types.js';
import {
  ProbeTracker, emptyProbeStats, emptyProbeCheckStats, loadProbeModule,
  mergeProbeStats, sameCards, wrapForCheck,
} from '../probe.js';
import type { ProbeModule } from '../probe.js';
import { createDealStats, dealStatsToJSON, dealStatsFromJSON, runDealDeals } from '../deal-arena.js';
import { runProbeCheck } from '../probe-check.js';
import { engineStrategy } from '../strategies.js';
import { normalizeSeed } from '../rng.js';

const cc = (s: CardSuit, r: number, i: number): Card => createCard(s, r, i);

function ctx(over: Partial<AIContext> = {}): AIContext {
  return {
    declarerIndex: 0, trumpSuit: 'S' as CardSuit, level: 2,
    myIndex: 1, isDeclarer: false, isDeclarerPartner: false, isAttacker: false,
    attackerPoints: 0, throwPenalties: [0, 0], handCounts: [25, 25, 25, 25],
    trickHistory: [], reveals: [], playCount: 1, leadPlayerIndex: 0,
    trickPlays: [], bestSoFar: null, ntState: null, bottomCards: [], debug: false,
    ...over,
  } as AIContext;
}

function fakeStrategy(name: string, leadCard: Card, followCard: Card): Strategy {
  return {
    name,
    tryReveal: () => null,
    chooseBottom: hand => ({ keep: hand, discard: [], reason: 'test' }),
    lead: () => ({ cards: [leadCard], reason: 'test' }),
    follow: () => ({ cards: [followCard], reason: 'test' }),
  };
}

const always: ProbeModule = { name: 'always', hit: () => true };
const never: ProbeModule = { name: 'never', hit: () => false };
const followOnly: ProbeModule = { name: 'follow', hit: d => d.kind === 'follow' };

describe('probe：A 侧 tracker', () => {
  it('只在命中时调用 B；命中且改牌才计 changed，takeChanged 读取后清零', () => {
    const a = fakeStrategy('a', cc('S', 5, 1), cc('S', 6, 2));
    const b = fakeStrategy('b', cc('S', 7, 3), cc('S', 8, 4));
    const stats = emptyProbeStats();
    const tracker = new ProbeTracker(followOnly, b, stats);
    const wrapped = tracker.wrap(a);
    const hand = [cc('S', 5, 1), cc('S', 9, 5)];

    wrapped.lead(hand, ctx());
    expect(stats.hits).toBe(0);

    wrapped.follow(hand, [cc('S', 4, 6)], 'S', ctx());
    expect(stats.hits).toBe(1);
    expect(stats.changedDecisions).toBe(1);
    expect(tracker.takeChanged()).toBe(true);
    expect(tracker.takeChanged()).toBe(false);
  });

  it('命中但 A/B 同牌不计 changed', () => {
    const s5 = cc('S', 5, 1);
    const s6 = cc('S', 6, 2);
    const a = fakeStrategy('a', s5, s6);
    const b = fakeStrategy('b', s5, s6);
    const stats = emptyProbeStats();
    const wrapped = new ProbeTracker(always, b, stats).wrap(a);
    wrapped.follow([s5], [cc('S', 4, 6)], 'S', ctx());
    expect(stats.hits).toBe(1);
    expect(stats.changedDecisions).toBe(0);
  });
});

describe('probe：条件自检计数', () => {
  it('改牌但未命中 = 假阴性，并记录可序列化的样例', () => {
    const a = fakeStrategy('a', cc('S', 5, 1), cc('S', 6, 2));
    const b = fakeStrategy('b', cc('S', 7, 3), cc('S', 8, 4));
    const stats = emptyProbeCheckStats();
    const w = wrapForCheck(a, b, never, stats, 7);
    w.follow([cc('S', 6, 2)], [cc('S', 4, 6)], 'S', ctx({ myIndex: 2, playCount: 2 }));
    expect(stats.falseNegative).toBe(1);
    expect(stats.truePositive).toBe(0);
    expect(stats.examples).toEqual([{
      dealIndex: 7, kind: 'follow', myIndex: 2, playCount: 2, level: 2,
      trumpSuit: 'S', lead: 'S4', hand: 'S6', actual: 'S6', alternative: 'S8', hit: false,
    }]);
  });

  it('四种组合分别计数', () => {
    const s5 = cc('S', 5, 1);
    const s6 = cc('S', 6, 2);
    const a = fakeStrategy('a', s5, s6);
    const b = fakeStrategy('b', cc('S', 7, 3), cc('S', 8, 4));
    const same = fakeStrategy('b', s5, s6);
    const hand = [s6];

    const tp = emptyProbeCheckStats();
    wrapForCheck(a, b, always, tp, 0).follow(hand, [cc('S', 4, 6)], 'S', ctx());
    expect(tp.truePositive).toBe(1);

    const tn = emptyProbeCheckStats();
    wrapForCheck(same, a, never, tn, 0).follow(hand, [cc('S', 4, 6)], 'S', ctx());
    expect(tn.trueNegative).toBe(1);

    const fp = emptyProbeCheckStats();
    wrapForCheck(same, a, always, fp, 0).follow(hand, [cc('S', 4, 6)], 'S', ctx());
    expect(fp.falsePositive).toBe(1);
  });
});

describe('probe：合并与 JSON', () => {
  it('sameCards 按 id 比较，不依赖顺序', () => {
    const a = [cc('S', 5, 1), cc('H', 3, 2)];
    const b = [a[1], a[0]];
    expect(sameCards(a, b)).toBe(true);
    expect(sameCards(a, [a[0]])).toBe(false);
    // 同花色同点数但 id 不同（两副牌里的另一张）不算同一张
    expect(sameCards(a, [cc('S', 5, 9), a[1]])).toBe(false);
  });

  it('mergeProbeStats 逐项相加；DealStats JSON 往返保留 probe', () => {
    const a = { ...emptyProbeStats(), hits: 2, affectedDeals: 1, dealA: 1 };
    const b = { ...emptyProbeStats(), hits: 3, affectedTriples: 2, tierSum: 0.5 };
    const merged = mergeProbeStats(a, b);
    expect(merged.hits).toBe(5);
    expect(merged.affectedDeals).toBe(1);
    expect(merged.affectedTriples).toBe(2);
    expect(merged.dealA).toBe(1);
    expect(merged.tierSum).toBe(0.5);

    const acc = createDealStats([2], [0]);
    acc.probe = merged;
    const back = dealStatsFromJSON(JSON.parse(JSON.stringify(dealStatsToJSON(acc))));
    expect(back.probe).toEqual(merged);
  });
});

const seed = normalizeSeed('0x0000000000000001');

describe('probe：deal 竞技场接线', () => {
  it('A==B 时命中增加、改牌为 0、受影响发牌为 0', () => {
    const acc = runDealDeals(seed, 0, 1, [2], engineStrategy, engineStrategy, [], [0], always);
    expect(acc.probe.hits).toBeGreaterThan(0);
    expect(acc.probe.changedDecisions).toBe(0);
    expect(acc.probe.affectedDeals).toBe(0);
    expect(acc.probe.affectedTriples).toBe(0);
  });

  it('自检 A==B：全部命中且同牌 → falsePositive = comparisons，假阴性为 0', () => {
    const check = runProbeCheck({
      seed, dealCount: 1, levels: [2], strategyA: engineStrategy, strategyB: engineStrategy,
      dealFilters: [], declarerSeats: [0], probe: always,
    });
    expect(check.comparisons).toBeGreaterThan(0);
    expect(check.falseNegative).toBe(0);
    expect(check.truePositive).toBe(0);
    expect(check.falsePositive).toBe(check.comparisons);
  });

  it('自检 never：全部未命中且同牌 → trueNegative = comparisons', () => {
    const check = runProbeCheck({
      seed, dealCount: 1, levels: [2], strategyA: engineStrategy, strategyB: engineStrategy,
      dealFilters: [], declarerSeats: [0], probe: never,
    });
    expect(check.falseNegative).toBe(0);
    expect(check.falsePositive).toBe(0);
    expect(check.trueNegative).toBe(check.comparisons);
  });
});

describe('probe：模块加载', () => {
  it('按路径加载模块并取 name/hit', async () => {
    const url = new URL('./fixtures/probe-fixture.mjs', import.meta.url);
    const mod = await loadProbeModule(url.pathname);
    expect(mod.name).toBe('fixture');
    expect(mod.hit({ kind: 'follow' } as never)).toBe(true);
    expect(mod.hit({ kind: 'lead' } as never)).toBe(false);
  });
});
