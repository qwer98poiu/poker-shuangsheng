import { describe, it, expect } from 'vitest';
import { createCard, Rank, SpecialSuit, Suit } from '@poker/engine';
import type { Card } from '@poker/engine';
import { deckForHand } from '../rng.js';
import { playHand, dealtHands, naturalDeclaration } from '../match.js';
import { engineStrategy, ai0929Strategy, ai1018Strategy } from '../strategies.js';
import type { HandEvent, Strategy } from '../types.js';
import {
  addDealSweep, createDealStats, dealStatsFromJSON, dealStatsToJSON,
  levelPassesDealFilters, mergeDealStats,
  runDealDeals, runDealSweep, scenarioKey, scenariosForLevels,
  strategiesForLeg, tripleInScenario, tripleMetrics,
  ALL_DECLARER_SEATS, parseDeclarerSeats,
} from '../deal-arena.js';
import type { DealSweepResult, Scenario, Triple } from '../deal-arena.js';
import { longSuitDealFilter } from '../deal-filters.js';
import { tierOf } from '../tier.js';

const LEVEL = 2;

function handEvent(partial: Partial<HandEvent>): HandEvent {
  const finalPts = partial.finalPts ?? 40;
  return {
    handIndex: 0, level: LEVEL, attackerLevel: LEVEL, declarerIdx: 0, teamBanker: 0,
    trumpSuit: null, bottomPoints: 0, killSuitCount: 0,
    attackerWonLastTrick: false, kouDiAdd: 0, finalPts, bankerWon: finalPts < 80,
    tricksPlayed: 13, tricksWonByTeam0: 7, cardsWonByTeam0: 13, leadsByTeam0: 7,
    leadCardsByTeam0: 13, leadCardsTotal: 26, errors: 0,
    aborted: false, settled: false, abortCause: null, abortPlayerIdx: null,
    ...partial,
  };
}

interface SuitSpec {
  ab?: Suit | null;
  ba?: Suit | null;
  bb?: Suit | null;
}

function syntheticTriple(
  declarerIdx: 0 | 1 | 2 | 3,
  ab: number,
  ba: number,
  bb: number,
  suits: SuitSpec = {},
  bankerWon: { ab?: boolean; ba?: boolean; bb?: boolean } = {},
): Triple {
  const teamBanker = (declarerIdx % 2) as 0 | 1;
  const eventAB = handEvent({
    declarerIdx, teamBanker, finalPts: ab, trumpSuit: suits.ab ?? null,
    ...(bankerWon.ab === undefined ? {} : { bankerWon: bankerWon.ab }),
  });
  const eventBA = handEvent({
    declarerIdx, teamBanker, finalPts: ba, trumpSuit: suits.ba ?? null,
    ...(bankerWon.ba === undefined ? {} : { bankerWon: bankerWon.ba }),
  });
  const eventBB = handEvent({
    declarerIdx, teamBanker, finalPts: bb, trumpSuit: suits.bb ?? null,
    ...(bankerWon.bb === undefined ? {} : { bankerWon: bankerWon.bb }),
  });
  return {
    level: LEVEL, declarerIdx, ab, ba, bb, eventAB, eventBA, eventBB,
    metrics: tripleMetrics(ab, ba, bb), settledHands: 0,
  };
}

function sweepOf(dealIndex: number, triples: Triple[]): DealSweepResult {
  return {
    dealIndex, skipReason: null, triples,
    handsPlayed: triples.length * 3, abortedHands: 0, settledHands: 0,
    settledByBanker: 0, settledByAttacker: 0, tricksPlayed: triples.length * 48,
  };
}

describe('升级指标', () => {
  it('tierOf 边界：0 分单列 −1，其余 ⌊分/40⌋', () => {
    expect([tierOf(0), tierOf(1), tierOf(39), tierOf(40), tierOf(79), tierOf(80), tierOf(119), tierOf(120)])
      .toEqual([-1, 0, 0, 1, 1, 2, 2, 3]);
  });

  it('tripleMetrics 方向与恒等式', () => {
    const m = tripleMetrics(120, 79, 40);
    expect(m.tierNorthStar).toBe(-2);       // tier(79)=1 − tier(120)=3
    expect(m.tierDeclarerGain).toBe(-2);    // tier(40)=1 − 3
    expect(m.tierDefenderGain).toBe(0);     // 1 − 1
    expect(m.ptsNorthStar).toBe(-41);
    expect(m.ptsDeclarerGain).toBe(-80);
    expect(m.ptsDefenderGain).toBe(39);
    expect(m.outcome).toBe('b');
    expect(m.tierNorthStar).toBe(m.tierDeclarerGain + m.tierDefenderGain);
    expect(m.ptsNorthStar).toBe(m.ptsDeclarerGain + m.ptsDefenderGain);
  });

  it('大光(−1 档)与小光(0 档)不再判平：分解恒等式仍成立', () => {
    const m = tripleMetrics(5, 5, 0);
    expect(m.outcome).toBe('draw');
    expect(m.tierDeclarerGain).toBe(-1);
    expect(m.tierDefenderGain).toBe(1);
    expect(m.tierNorthStar).toBe(0);
  });
});

describe('策略落位', () => {
  const A = { name: 'A' } as unknown as Strategy;
  const B = { name: 'B' } as unknown as Strategy;

  it('全部 12 种 (庄位, 腿) 组合：庄家策略落在庄家队', () => {
    for (const seat of ALL_DECLARER_SEATS) {
      for (const leg of ['AB', 'BA', 'BB'] as const) {
        const tuple = strategiesForLeg(seat, leg, A, B);
        const declarerStrategy = leg === 'AB' ? 'A' : 'B';
        const defenderStrategy = leg === 'BA' ? 'A' : 'B';
        expect(tuple[seat % 2].name).toBe(declarerStrategy);
        expect(tuple[1 - (seat % 2)].name).toBe(defenderStrategy);
      }
    }
  });
});

describe('runDealSweep 契约', () => {
  it('四个庄位 × 等级数 个三元组；A==B 时全部差值为 0、全平', () => {
    const res = runDealSweep({
      seed: 7, dealIndex: 0, levels: [LEVEL],
      strategyA: engineStrategy, strategyB: engineStrategy, dealFilters: [],
      declarerSeats: ALL_DECLARER_SEATS,
    });
    expect(res.skipReason).toBeNull();
    expect(res.triples).toHaveLength(4);
    expect(res.handsPlayed).toBe(12);
    expect(res.abortedHands).toBe(0);
    for (const t of res.triples) {
      expect(t.level).toBe(LEVEL);
      expect(t.metrics).toEqual({
        tierNorthStar: 0, tierDeclarerGain: 0, tierDefenderGain: 0,
        ptsNorthStar: 0, ptsDeclarerGain: 0, ptsDefenderGain: 0, outcome: 'draw',
      });
      for (const ev of [t.eventAB, t.eventBA, t.eventBB]) {
        expect(ev.level).toBe(LEVEL);
        expect(ev.declarerIdx).toBe(t.declarerIdx);
        expect(ev.teamBanker).toBe(t.declarerIdx % 2);
        expect(ev.aborted).toBe(false);
      }
    }
  });

  it('长花色过滤器：四家任一有副牌长套即保留（候选庄家 33 张池）', () => {
    // 找一副在该等级下、某个候选庄位通过 long-suit 的发牌。
    let found: { deck: ReturnType<typeof deckForHand>; seat: number } | null = null;
    outer: for (let k = 0; k < 200; k++) {
      const deck = deckForHand(11, 0, k);
      const hands = dealtHands(deck);
      for (const seat of ALL_DECLARER_SEATS) {
        const decl = naturalDeclaration(deck, seat, LEVEL, false, [ai1018Strategy, ai1018Strategy]);
        if (longSuitDealFilter({ hands, deck, level: LEVEL, decl })) {
          found = { deck, seat };
          break outer;
        }
      }
    }
    expect(found).not.toBeNull();
    const { deck } = found!;
    const hands = dealtHands(deck);
    expect(levelPassesDealFilters(
      deck, hands, LEVEL, ['long-suit'], ai1018Strategy, ALL_DECLARER_SEATS,
    )).toBe(true);
    expect(levelPassesDealFilters(
      deck, hands, LEVEL, [], ai1018Strategy, ALL_DECLARER_SEATS,
    )).toBe(true);
  });
});

describe('declarerSeats', () => {
  it('parseDeclarerSeats：默认 0、all、子集与非法输入', () => {
    expect(parseDeclarerSeats('0')).toEqual([0]);
    expect(parseDeclarerSeats('all')).toEqual([0, 1, 2, 3]);
    expect(parseDeclarerSeats('ALL')).toEqual([0, 1, 2, 3]);
    expect(parseDeclarerSeats('2,0,2')).toEqual([0, 2]);
    expect(() => parseDeclarerSeats('')).toThrow('不能为空');
    expect(() => parseDeclarerSeats('1,,2')).toThrow('空项');
    expect(() => parseDeclarerSeats('4')).toThrow('非法庄位');
    expect(() => parseDeclarerSeats('-1')).toThrow('非法庄位');
  });

  it('默认固定 P0：每等级 1 个三元组、3 小局', () => {
    const res = runDealSweep({
      seed: 7, dealIndex: 0, levels: [LEVEL],
      strategyA: engineStrategy, strategyB: engineStrategy, dealFilters: [],
    });
    expect(res.triples).toHaveLength(1);
    expect(res.triples[0].declarerIdx).toBe(0);
    expect(res.handsPlayed).toBe(3);
    expect(createDealStats([LEVEL]).seats.size).toBe(1);
  });

  it('子集 0,2：每等级 2 个三元组、6 小局', () => {
    const res = runDealSweep({
      seed: 7, dealIndex: 0, levels: [LEVEL],
      strategyA: engineStrategy, strategyB: engineStrategy, dealFilters: [],
      declarerSeats: [0, 2],
    });
    expect(res.triples.map(t => t.declarerIdx)).toEqual([0, 2]);
    expect(res.handsPlayed).toBe(6);
  });

  it('长花色过滤器只检查配置庄位：底牌补长套只对 P1 生效', () => {
    // 手牌：P1 有 8 张黑桃（3..6 各一对）；P0/P2/P3 各有 4 张黑桃（9,10 各一对）；
    // 底牌 4 张黑桃（7,8 各一对）+ 4 张王。只有 P1 的 33 张池构成 12 张连续长套。
    const deck: Card[] = [];
    let id = 0;
    const spade = (rank: Rank): Card => createCard(Suit.Spades, rank, id++);
    const filler = (seat: number, count: number): Card[] => {
      const suits = [Suit.Hearts, Suit.Clubs, Suit.Diamonds];
      return Array.from({ length: count }, (_, i) =>
        createCard(suits[i % 3], (3 + Math.floor(i / 3)) as Rank, id++ + seat * 1000));
    };
    const hands: Card[][] = [
      [spade(Rank.Nine), spade(Rank.Nine), spade(Rank.Ten), spade(Rank.Ten), ...filler(0, 21)],
      [spade(Rank.Three), spade(Rank.Three), spade(Rank.Four), spade(Rank.Four),
        spade(Rank.Five), spade(Rank.Five), spade(Rank.Six), spade(Rank.Six),
        // 一对红桃 2（等级牌）：让自然亮主选红桃，黑桃成为副牌长套。
        createCard(Suit.Hearts, 2, id++), createCard(Suit.Hearts, 2, id++),
        ...filler(1, 15)],
      [spade(Rank.Nine), spade(Rank.Nine), spade(Rank.Ten), spade(Rank.Ten), ...filler(2, 21)],
      [spade(Rank.Nine), spade(Rank.Nine), spade(Rank.Ten), spade(Rank.Ten), ...filler(3, 21)],
    ];
    for (let i = 0; i < 100; i++) deck.push(hands[i % 4][Math.floor(i / 4)]);
    deck.push(
      spade(Rank.Seven), spade(Rank.Seven), spade(Rank.Eight), spade(Rank.Eight),
      createCard(SpecialSuit.Joker, Rank.SmallJoker, id++),
      createCard(SpecialSuit.Joker, Rank.SmallJoker, id++),
      createCard(SpecialSuit.Joker, Rank.BigJoker, id++),
      createCard(SpecialSuit.Joker, Rank.BigJoker, id++),
    );
    const dealt = dealtHands(deck);
    expect(levelPassesDealFilters(deck, dealt, LEVEL, ['long-suit'], engineStrategy, [0])).toBe(false);
    expect(levelPassesDealFilters(deck, dealt, LEVEL, ['long-suit'], engineStrategy, [1])).toBe(true);
    expect(levelPassesDealFilters(deck, dealt, LEVEL, ['long-suit'], engineStrategy, [0, 1])).toBe(true);
  });
});

describe('场景矩阵', () => {
  it('单等级 9 场景；多等级 = 9 + 3 × 等级数', () => {
    expect(scenariosForLevels([LEVEL])).toHaveLength(9);
    expect(scenariosForLevels([2, 5, 10])).toHaveLength(18);
    expect(scenariosForLevels([2, 5, 10]).map(s => s.level)).toEqual([
      null, null, null, null, null, null, null, null, null,
      2, 2, 2, 5, 5, 5, 10, 10, 10,
    ]);
  });

  it('有主/无主按被比较的两条腿判定，混合组合只进主牌=总体', () => {
    // AB 有主、BA 有主、BB 无主。
    const t = syntheticTriple(0, 40, 40, 40, {
      ab: Suit.Hearts, ba: Suit.Clubs, bb: null,
    });
    const s = (suit: Scenario['suit'], role: Scenario['role']): Scenario =>
      ({ level: null, suit, role });
    expect(tripleInScenario(t, s('overall', 'overall'))).toBe(true);
    expect(tripleInScenario(t, s('suited', 'overall'))).toBe(true);
    expect(tripleInScenario(t, s('nt', 'overall'))).toBe(false);
    expect(tripleInScenario(t, s('suited', 'declarer'))).toBe(false); // AB 有主、BB 无主
    expect(tripleInScenario(t, s('nt', 'declarer'))).toBe(false);
    expect(tripleInScenario(t, s('suited', 'defender'))).toBe(false); // BA 有主、BB 无主
    expect(tripleInScenario(t, s('nt', 'defender'))).toBe(false);

    // AB 有主、BA 无主、BB 有主：庄家腿同类，总体腿不同类。
    const u = syntheticTriple(0, 40, 40, 40, {
      ab: Suit.Hearts, ba: null, bb: Suit.Spades,
    });
    expect(tripleInScenario(u, s('suited', 'overall'))).toBe(false);
    expect(tripleInScenario(u, s('nt', 'overall'))).toBe(false);
    expect(tripleInScenario(u, s('suited', 'declarer'))).toBe(true);
    expect(tripleInScenario(u, s('nt', 'declarer'))).toBe(false);
    expect(tripleInScenario(u, s('suited', 'defender'))).toBe(false);
  });

  it('等级行只收本等级三元组', () => {
    const t = syntheticTriple(0, 40, 40, 40);
    expect(tripleInScenario(t, { level: LEVEL, suit: 'overall', role: 'overall' })).toBe(true);
    expect(tripleInScenario(t, { level: 5, suit: 'overall', role: 'overall' })).toBe(false);
  });

  it('净升级按发牌多数决；核心场景与 dealOutcome 一致', () => {
    const acc = createDealStats([LEVEL]);
    // 5 个全等级三元组：A、A、A、B、平 → 发牌 A 胜。
    const triples = [
      syntheticTriple(0, 40, 120, 40),
      syntheticTriple(1, 40, 120, 40),
      syntheticTriple(2, 40, 120, 40),
      syntheticTriple(3, 120, 40, 40),
      syntheticTriple(0, 40, 40, 40),
    ];
    addDealSweep(acc, sweepOf(0, triples));
    const core = acc.scenarios.get(scenarioKey({ level: null, suit: 'overall', role: 'overall' }))!;
    expect(core.tier).toEqual({ n: 1, a: 1, b: 0, draw: 0 });
    expect(acc.dealOutcome).toEqual({ n: 1, a: 1, b: 0, draw: 0 });
  });

  it('没有合格三元组的场景不计入分母', () => {
    const acc = createDealStats([LEVEL]);
    // 三条腿都有主 → 无主场景没有任何合格三元组。
    const triples = [syntheticTriple(0, 40, 120, 40, {
      ab: Suit.Hearts, ba: Suit.Clubs, bb: Suit.Spades,
    })];
    addDealSweep(acc, sweepOf(0, triples));
    const nt = acc.scenarios.get(scenarioKey({ level: null, suit: 'nt', role: 'overall' }))!;
    expect(nt.tier.n).toBe(0);
    expect(nt.pts.n).toBe(0);
    const suited = acc.scenarios.get(scenarioKey({ level: null, suit: 'suited', role: 'overall' }))!;
    expect(suited.tier.n).toBe(1);
    expect(suited.pts.n).toBe(1);
  });

  it('分差场景：每副取合格三元组均值，n 单位为发牌', () => {
    const acc = createDealStats([LEVEL]);
    // 两个有主三元组：BA−AB = 80、−40；一副均值 = 20。
    const triples = [
      syntheticTriple(0, 40, 120, 40, { ab: Suit.Hearts, ba: Suit.Clubs, bb: Suit.Spades }),
      syntheticTriple(1, 120, 80, 40, { ab: Suit.Hearts, ba: Suit.Clubs, bb: Suit.Spades }),
    ];
    addDealSweep(acc, sweepOf(0, triples));
    const suited = acc.scenarios.get(scenarioKey({ level: null, suit: 'suited', role: 'overall' }))!;
    expect(suited.pts.n).toBe(1);
    expect(suited.pts.sumD).toBeCloseTo(20, 12);
  });
});

describe('小局分析胜率配对桶', () => {
  it('每副只加一次 A−B 胜率差（整体/台上/台下与逐等级）', () => {
    const acc = createDealStats([LEVEL]);
    // 两条三元组都是 A 通吃：AB 庄家赢、BA 庄家输（A 当闲赢）。
    const triples = [
      syntheticTriple(0, 40, 120, 40, {}, { ab: true, ba: false }),
      syntheticTriple(1, 40, 120, 40, {}, { ab: true, ba: false }),
    ];
    addDealSweep(acc, sweepOf(0, triples));
    expect(acc.winRates.overall.n).toBe(1);
    expect(acc.winRates.overall.sumD).toBeCloseTo(1, 12);
    expect(acc.winRates.banker.n).toBe(1);
    expect(acc.winRates.banker.sumD).toBeCloseTo(1, 12);
    expect(acc.winRates.attacker.n).toBe(1);
    expect(acc.winRates.attacker.sumD).toBeCloseTo(1, 12);
    expect(acc.winRates.bankerByLevel.get(LEVEL)!.n).toBe(1);
    expect(acc.winRates.attackerByLevel.get(LEVEL)!.sumD).toBeCloseTo(1, 12);
  });
});

describe('累加器', () => {
  it('三元组/发牌三分类、多数决与六项按副均值桶', () => {
    const acc = createDealStats([LEVEL]);
    const triples = [
      syntheticTriple(0, 120, 79, 40),  // B
      syntheticTriple(1, 40, 120, 120), // A
      syntheticTriple(2, 40, 40, 40),   // 平
      syntheticTriple(3, 120, 79, 40),  // B
    ];
    addDealSweep(acc, sweepOf(0, triples));
    expect(acc.attemptedDeals).toBe(1);
    expect(acc.acceptedDeals).toBe(1);
    expect(acc.handsPlayed).toBe(12);
    expect(acc.overall.outcome).toEqual({ n: 4, a: 1, b: 2, draw: 1 });
    expect(acc.dealOutcome).toEqual({ n: 1, a: 0, b: 1, draw: 0 });
    expect(acc.levels.get(LEVEL)!.outcome).toEqual({ n: 4, a: 1, b: 2, draw: 1 });
    expect(acc.seats.get(0)!.outcome).toEqual({ n: 1, a: 0, b: 1, draw: 0 });
    expect(acc.levelSeats.get(`${LEVEL}:1`)!.outcome).toEqual({ n: 1, a: 1, b: 0, draw: 0 });
    // n 的单位是发牌：每副只有一次观测。
    expect(acc.overall.tierNorthStar.n).toBe(1);
    expect(acc.overall.tierNorthStar.sumD).toBeCloseTo((-2 + 2 + 0 - 2) / 4, 12);
    // 80 分口径只含 AB/BA：2 × triples。
    expect(acc.statsA.handsPlayed).toBe(8);
    expect(acc.statsB.handsPlayed).toBe(8);
    expect(acc.handWinsA + acc.handWinsB).toBe(8);
  });

  it('过滤器跳过：只计入 skippedDeals 与条件过滤计数', () => {
    const acc = createDealStats([LEVEL]);
    for (const dealIndex of [0, 1]) {
      addDealSweep(acc, {
        dealIndex, skipReason: 'deal-filter', triples: [],
        handsPlayed: 0, abortedHands: 0, settledHands: 0,
        settledByBanker: 0, settledByAttacker: 0, tricksPlayed: 0,
      });
    }
    expect(acc.attemptedDeals).toBe(2);
    expect(acc.skippedDeals).toBe(2);
    expect(acc.filterSkippedDeals).toBe(2);
    expect(acc.acceptedDeals).toBe(0);
  });
});

describe('确定性、merge 与 JSON', () => {
  it('同 seed 同参数两次运行 JSON 完全一致', () => {
    const run = (): Record<string, unknown> => dealStatsToJSON(runDealDeals(
      7, 0, 1, [LEVEL], engineStrategy, ai1018Strategy, [],
    ));
    expect(run()).toEqual(run());
  });

  it('分段跑 == 一次跑：整数计数精确，均值桶用 toBeCloseTo', () => {
    const run = (start: number, count: number): ReturnType<typeof runDealDeals> =>
      runDealDeals(7, start, count, [LEVEL], engineStrategy, ai1018Strategy, []);
    const merged = mergeDealStats(run(0, 1), run(1, 1));
    const whole = run(0, 2);
    expect(merged.acceptedDeals).toBe(whole.acceptedDeals);
    expect(merged.overall.outcome).toEqual(whole.overall.outcome);
    expect(merged.dealOutcome).toEqual(whole.dealOutcome);
    expect(merged.overall.tierNorthStar.n).toBe(whole.overall.tierNorthStar.n);
    expect(merged.overall.tierNorthStar.sumD).toBeCloseTo(whole.overall.tierNorthStar.sumD, 12);
    expect(merged.overall.ptsNorthStar.sumD2).toBeCloseTo(whole.overall.ptsNorthStar.sumD2, 12);
    for (const key of whole.scenarios.keys()) {
      expect(merged.scenarios.get(key)!.tier).toEqual(whole.scenarios.get(key)!.tier);
    }
    expect(merged.winRates.overall.n).toBe(whole.winRates.overall.n);
    expect(merged.winRates.overall.sumD).toBeCloseTo(whole.winRates.overall.sumD, 12);
  });

  it('JSON 往返保持场景、胜率配对桶与精确计数', () => {
    const acc = runDealDeals(
      7, 0, 1, [LEVEL], engineStrategy, ai1018Strategy, [], ALL_DECLARER_SEATS,
    );
    const back = dealStatsFromJSON(dealStatsToJSON(acc, { includeInternal: true }));
    expect([...back.levels.keys()]).toEqual([LEVEL]);
    expect([...back.seats.keys()]).toEqual([0, 1, 2, 3]);
    expect([...back.levelSeats.keys()].sort()).toEqual(
      [...acc.levelSeats.keys()].sort(),
    );
    expect(back.overall.outcome).toEqual(acc.overall.outcome);
    expect(back.dealOutcome).toEqual(acc.dealOutcome);
    expect(back.statsA.handsPlayed).toBe(acc.statsA.handsPlayed);
    expect([...back.scenarios.keys()].sort()).toEqual([...acc.scenarios.keys()].sort());
    expect(back.winRates.overall).toEqual(acc.winRates.overall);
  });

  it('最终导出 JSON 不含内部 winRates 字段', () => {
    const acc = runDealDeals(
      7, 0, 1, [LEVEL], engineStrategy, ai1018Strategy, [],
    );
    const exported = dealStatsToJSON(acc);
    expect(exported).not.toHaveProperty('winRates');
    expect(exported).toHaveProperty('scenarios');
  });
});

describe('旧 solo 四项指标的复现（庄位 0）', () => {
  it('levelSeats 的庄家/闲家升级与分差桶与直接三腿一致', () => {
    const seed = 7;
    const dealIndex = 0;
    const deck = deckForHand(seed, 0, dealIndex);
    const direct = (strategies: [Strategy, Strategy]): HandEvent => playHand({
      deck, handIndex: LEVEL, declarerIdx: 0, level: LEVEL, attackerLevel: LEVEL,
      isFirstHand: false, strategies,
    });
    const ab = direct([engineStrategy, ai0929Strategy]);
    const ba = direct([ai0929Strategy, engineStrategy]);
    const bb = direct([ai0929Strategy, ai0929Strategy]);

    const acc = createDealStats([LEVEL]);
    addDealSweep(acc, runDealSweep({
      seed, dealIndex, levels: [LEVEL],
      strategyA: engineStrategy, strategyB: ai0929Strategy, dealFilters: [],
    }));
    const split = acc.levelSeats.get(`${LEVEL}:0`)!;
    const m = tripleMetrics(ab.finalPts, ba.finalPts, bb.finalPts);
    expect(split.outcome.n).toBe(1);
    expect(split.tierDeclarer.n).toBe(1);
    expect(split.tierDefender.n).toBe(1);
    expect(split.tierDeclarer.a + split.tierDeclarer.b + split.tierDeclarer.draw).toBe(1);
    expect(split.ptsDeclarerGain.sumD).toBe(m.ptsDeclarerGain);
    expect(split.ptsDefenderGain.sumD).toBe(m.ptsDefenderGain);
  });
});
