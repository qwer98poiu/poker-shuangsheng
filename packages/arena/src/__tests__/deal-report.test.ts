import { describe, it, expect } from 'vitest';
import {
  createDealStats, addDealSweep, scenarioKey, tripleMetrics,
} from '../deal-arena.js';
import type { DealSweepResult, Triple } from '../deal-arena.js';
import type { HandEvent } from '../types.js';
import {
  comparisonRows, ptsScenarioRows, scenarioLabel, tierScenarioRows,
} from '../deal-report.js';

function handEvent(partial: Partial<HandEvent>): HandEvent {
  const finalPts = partial.finalPts ?? 40;
  return {
    handIndex: 0, level: 2, attackerLevel: 2, declarerIdx: 0, teamBanker: 0,
    trumpSuit: null, bottomPoints: 0, killSuitCount: 0,
    attackerWonLastTrick: false, kouDiAdd: 0, finalPts, bankerWon: finalPts < 80,
    tricksPlayed: 13, tricksWonByTeam0: 7, cardsWonByTeam0: 13, leadsByTeam0: 7,
    leadCardsByTeam0: 13, leadCardsTotal: 26, errors: 0,
    aborted: false, settled: false, abortCause: null, abortPlayerIdx: null,
    ...partial,
  };
}

function triple(
  declarerIdx: 0 | 1 | 2 | 3,
  ab: number,
  ba: number,
  bb: number,
  bankerWon: { ab?: boolean; ba?: boolean } = {},
): Triple {
  return {
    level: 2, declarerIdx, ab, ba, bb,
    eventAB: handEvent({
      declarerIdx, finalPts: ab,
      ...(bankerWon.ab === undefined ? {} : { bankerWon: bankerWon.ab }),
    }),
    eventBA: handEvent({
      declarerIdx, finalPts: ba,
      ...(bankerWon.ba === undefined ? {} : { bankerWon: bankerWon.ba }),
    }),
    eventBB: handEvent({ declarerIdx, finalPts: bb }),
    metrics: tripleMetrics(ab, ba, bb),
    settledHands: 0,
  };
}

function addDeal(acc: ReturnType<typeof createDealStats>, triples: Triple[], dealIndex = 0): void {
  const res: DealSweepResult = {
    dealIndex, skipReason: null, triples,
    handsPlayed: triples.length * 3, abortedHands: 0, settledHands: 0,
    settledByBanker: 0, settledByAttacker: 0, tricksPlayed: triples.length * 48,
  };
  addDealSweep(acc, res);
}

function oneDealStats(): ReturnType<typeof createDealStats> {
  const acc = createDealStats([2]);
  addDeal(acc, [
    triple(0, 120, 79, 40), // B
    triple(1, 40, 120, 120), // A
    triple(2, 40, 40, 40), // 平
    triple(3, 120, 79, 40), // B
  ]);
  return acc;
}

describe('场景标签与行', () => {
  it('单等级 9 行；多等级每级追加 3 行；得分差首行为总体', () => {
    const acc = createDealStats([2]);
    expect(tierScenarioRows(acc, [2]).map(r => r.cells[0])).toEqual([
      '总体（核心）', '庄家', '闲家',
      '有主', '有主·庄家', '有主·闲家',
      '无主', '无主·庄家', '无主·闲家',
    ]);
    expect(tierScenarioRows(acc, [2, 5])).toHaveLength(15);
    expect(tierScenarioRows(acc, [2, 5]).map(r => r.cells[0])).toContain('等级 2·有主');
    expect(tierScenarioRows(acc, [2, 5]).map(r => r.cells[0])).toContain('等级 5·无主');
    expect(ptsScenarioRows(acc, [2])[0].cells[0]).toBe('总体');
  });

  it('scenarioLabel 的等级显示 J/Q/K/A', () => {
    expect(scenarioLabel({ level: 11, suit: 'overall', role: 'overall' }, 'tier'))
      .toBe('等级 J');
    expect(scenarioLabel({ level: 14, suit: 'nt', role: 'overall' }, 'tier'))
      .toBe('等级 A·无主');
  });
});

describe('净升级表', () => {
  it('比例带整数分子/分母；平局同分母；显著列只显示 A/B/不显著', () => {
    const acc = createDealStats([2]);
    const key = scenarioKey({ level: null, suit: 'overall', role: 'overall' });
    acc.scenarios.get(key)!.tier = { n: 100, a: 95, b: 3, draw: 2 };
    const row = tierScenarioRows(acc, [2])[0];
    expect(row.cells).toEqual([
      '总体（核心）',
      '0.9500（95/100）',
      '0.0300（3/100）',
      '0.0200（2/100）',
      'A',
    ]);
    expect(row.tints[4]).toBe('A');
  });

  it('n=0 的场景全部显示 —', () => {
    const acc = createDealStats([2]);
    const row = tierScenarioRows(acc, [2])[0];
    expect(row.cells).toEqual(['总体（核心）', '—', '—', '—', '—']);
    expect(row.tints[4]).toBeNull();
  });

  it('不显著时显示“不显著”且不染色', () => {
    const acc = createDealStats([2]);
    const key = scenarioKey({ level: null, suit: 'overall', role: 'overall' });
    acc.scenarios.get(key)!.tier = { n: 10, a: 6, b: 4, draw: 0 };
    const row = tierScenarioRows(acc, [2])[0];
    expect(row.cells[4]).toBe('不显著');
    expect(row.tints[4]).toBeNull();
  });
});

describe('得分差表', () => {
  it('值 = 分子/分母；分子 1 位小数；显著列按配对区间', () => {
    const acc = createDealStats([2]);
    const key = scenarioKey({ level: null, suit: 'overall', role: 'overall' });
    acc.scenarios.get(key)!.pts = {
      n: 100, sumD: 123.4, sumD2: 160, pos: 100, neg: 0, zero: 0,
    };
    const row = ptsScenarioRows(acc, [2])[0];
    expect(row.cells).toEqual(['总体', '+1.234（+123.4/100）', 'A']);
    expect(row.tints[2]).toBe('A');
  });

  it('n<2 时显著性为 —；负值保留负号', () => {
    const acc = createDealStats([2]);
    const key = scenarioKey({ level: null, suit: 'overall', role: 'overall' });
    acc.scenarios.get(key)!.pts = {
      n: 1, sumD: -12.34, sumD2: 152.3, pos: 0, neg: 1, zero: 0,
    };
    const row = ptsScenarioRows(acc, [2])[0];
    expect(row.cells).toEqual(['总体', '-12.340（-12.3/1）', '—']);
  });
});

describe('小局分析表', () => {
  it('胜率行改名；只有胜率类指标带显著性，其余为 —', () => {
    const acc = createDealStats([2]);
    // 两副 A 通吃的小局，给逐副配对桶两个观测。
    addDeal(acc, [triple(0, 40, 120, 40, { ab: true, ba: false })], 0);
    addDeal(acc, [triple(0, 40, 120, 40, { ab: true, ba: false })], 1);
    const rows = comparisonRows(acc, [2]);
    const byLabel = new Map(rows.map(r => [r.label, r]));
    expect(byLabel.get('胜率')!.sig).toBe('A');
    expect(byLabel.get('胜率')!.sigTint).toBe('A');
    expect(byLabel.get('台上胜率')!.sig).toBe('A');
    expect(byLabel.get('台下胜率')!.sig).toBe('A');
    expect(byLabel.get('台上 2 胜率')!.sig).toBe('A');
    expect(byLabel.get('台上平均失分')!.sig).toBe('—');
    expect(byLabel.get('抠底频率')!.sig).toBe('—');
    expect(rows.some(r => r.label === '小局胜率（80 分口径，A/B 腿）')).toBe(false);
  });

  it('胜率行分母只含 AB/BA（2 × 三元组）', () => {
    const acc = oneDealStats();
    const rows = comparisonRows(acc, [2]);
    const first = rows.find(r => r.label === '胜率')!;
    expect(first.a).toContain('/8');
    expect(first.b).toContain('/8');
  });

  it('只展开请求的等级', () => {
    const acc = oneDealStats();
    const rows = comparisonRows(acc, [2, 5]);
    expect(rows.some(r => r.label === '台上 2 胜率')).toBe(true);
    expect(rows.some(r => r.label === '台上 5 胜率')).toBe(true);
    expect(rows.some(r => r.label === '台上 3 胜率')).toBe(false);
  });
});
