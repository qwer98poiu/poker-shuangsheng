import { describe, it, expect } from 'vitest';
import { createSoloStats } from '../solo-arena.js';
import type { SoloLevelStats, SoloStats } from '../solo-arena.js';
import { Z } from '../significance.js';
import {
  activeIndicators, conclusionCounts, conclusionText, enumerateIndicators,
  indicatorRow, pairedInterval, renderColumns, wilsonInterval, SOLO_TABLE_HEADER,
} from '../solo-report.js';

function levelStats(over: Partial<SoloLevelStats>): SoloLevelStats {
  return {
    bankerTier: { n: 0, a: 0, b: 0, draw: 0 },
    bankerPts: { n: 0, sumD: 0, sumD2: 0, pos: 0, neg: 0, zero: 0 },
    attackerTier: { n: 0, a: 0, b: 0, draw: 0 },
    attackerPts: { n: 0, sumD: 0, sumD2: 0, pos: 0, neg: 0, zero: 0 },
    ...over,
  };
}

function statsWith(entries: Array<[number, SoloLevelStats]>): SoloStats {
  const s = createSoloStats(entries.map(([lv]) => lv));
  for (const [lv, st] of entries) s.levels.set(lv, st);
  return s;
}

/** 四个桶里给定值、其余留零，用于构造指定的显著性组合。 */
const A_WIN_TIER = { n: 100, a: 100, b: 0, draw: 0 };
const B_WIN_PTS = { n: 100, sumD: -100, sumD2: 200, pos: 0, neg: 100, zero: 0 };
const A_WIN_PTS = { n: 100, sumD: 100, sumD2: 200, pos: 100, neg: 0, zero: 0 };
const TIE_PTS = { n: 100, sumD: 0, sumD2: 100, pos: 0, neg: 0, zero: 100 };

describe('区间公式', () => {
  it('wilsonInterval 在 p̂ = 0.5 处左右对称', () => {
    const { lower, upper } = wilsonInterval(50, 100, Z);
    expect(lower).toBeCloseTo(0.375270, 5);
    expect(upper).toBeCloseTo(0.624730, 5);
  });

  it('pairedInterval 是均值的正态近似区间', () => {
    const r = pairedInterval({ n: 100, sumD: 100, sumD2: 200, pos: 100, neg: 0, zero: 0 }, Z);
    expect(r.mean).toBe(1);
    expect(r.lower).toBeCloseTo(0.741102, 5);
    expect(r.upper).toBeCloseTo(1.258898, 5);
    expect(r.usable).toBe(true);
  });

  it('pairedInterval 在 n < 2 时不可用', () => {
    const r = pairedInterval({ n: 1, sumD: 3, sumD2: 9, pos: 1, neg: 0, zero: 0 }, Z);
    expect(r.usable).toBe(false);
    expect(Number.isNaN(r.lower)).toBe(true);
    expect(Number.isNaN(r.upper)).toBe(true);
  });
});

describe('指标枚举', () => {
  it('每等级 4 项、按固定顺序、key 稳定', () => {
    const acc = statsWith([[2, levelStats({})], [5, levelStats({})]]);
    const inds = enumerateIndicators(acc);
    expect(inds.map(i => i.key)).toEqual([
      'L2/bankerTier', 'L2/bankerPts', 'L2/attackerTier', 'L2/attackerPts',
      'L5/bankerTier', 'L5/bankerPts', 'L5/attackerTier', 'L5/attackerPts',
    ]);
  });

  it('activeIndicators 排除样本为 0 的等级', () => {
    const n10 = { n: 10, a: 5, b: 5, draw: 0 };
    const p10 = { n: 10, sumD: 0, sumD2: 10, pos: 0, neg: 0, zero: 10 };
    const acc = statsWith([
      [2, levelStats({ bankerTier: n10, bankerPts: p10, attackerTier: n10, attackerPts: p10 })],
      [5, levelStats({})],
    ]);
    expect(enumerateIndicators(acc)).toHaveLength(8);
    expect(activeIndicators(acc).map(i => i.key)).toEqual([
      'L2/bankerTier', 'L2/bankerPts', 'L2/attackerTier', 'L2/attackerPts',
    ]);
  });
});

describe('表格行', () => {
  it('末三列按 A胜/B胜/平局 排列，表头与之对齐；数值列是 A 的胜率（不是领先方的）', () => {
    // A 胜 40、B 胜 50、平 10 → A 的胜率 = (40 + 5) / 100 = 0.45，领先方是 B
    const st = levelStats({ bankerTier: { n: 100, a: 40, b: 50, draw: 10 } });
    const ind = enumerateIndicators(statsWith([[2, st]])).find(i => i.key === 'L2/bankerTier')!;
    const row = indicatorRow(ind, st);
    expect(row.cells).toEqual([
      '庄家 档位', '0.4500', 'B', '0.5773', '0.4000 (40/100)', '0.5000 (50/100)', '0.1000 (10/100)',
    ]);
    expect(SOLO_TABLE_HEADER).toEqual([
      '指标', '数值', '领先方', '99%CI判定界', 'A胜', 'B胜', '平局',
    ]);
    expect(SOLO_TABLE_HEADER).toHaveLength(row.cells.length);
    expect(SOLO_TABLE_HEADER.slice(4)).toEqual(['A胜', 'B胜', '平局']);
    // B 领先但还没显著 → 领先方列不染色
    expect(ind.sigLeader).toBe(null);
    expect(row.tints).toEqual([null, null, null, null, null, null, null]);
  });

  it('A 不占优时 99%CI 列取 A 的上界（> 0.5 无从说起，< 0.5 即 B 显著）', () => {
    // A 胜率 0.45 的 Wilson 区间 ≈ [0.328970, 0.577253]
    const st = levelStats({ bankerTier: { n: 100, a: 40, b: 50, draw: 10 } });
    const ind = enumerateIndicators(statsWith([[2, st]])).find(i => i.key === 'L2/bankerTier')!;
    const { lower, upper } = wilsonInterval(45, 100, Z);
    expect(ind.ciBound).toBe(upper);
    expect(ind.ciBound).toBeCloseTo(0.577253, 5);
    expect(lower).toBeCloseTo(0.328970, 5);

    // A 占优时取的是下界
    const st2 = levelStats({ bankerTier: { n: 100, a: 60, b: 30, draw: 10 } });
    const ind2 = enumerateIndicators(statsWith([[2, st2]])).find(i => i.key === 'L2/bankerTier')!;
    expect(ind2.ciBound).toBeCloseTo(0.521318, 5);

    // 分差同理：均值为负时取上界
    const st3 = levelStats({ bankerPts: { n: 100, sumD: -234, sumD2: 1000, pos: 10, neg: 80, zero: 10 } });
    const ind3 = enumerateIndicators(statsWith([[2, st3]])).find(i => i.key === 'L2/bankerPts')!;
    expect(ind3.ciBound).toBeCloseTo(pairedInterval(st3.bankerPts, Z).upper, 10);
  });

  it('A 显著领先的档位行给领先方列染 A 色', () => {
    const st = levelStats({ bankerTier: { n: 100, a: 60, b: 30, draw: 10 } });
    const ind = enumerateIndicators(statsWith([[2, st]])).find(i => i.key === 'L2/bankerTier')!;
    const row = indicatorRow(ind, st);
    expect(row.cells[1]).toBe('0.6500');
    expect(row.cells[2]).toBe('A');
    expect(ind.sigLeader).toBe('A');
    expect(row.tints[2]).toBe('A');
  });

  it('B 显著领先时领先方列染 B 色；只是领先、未显著则不染色', () => {
    const sig = levelStats({ bankerTier: { n: 100, a: 30, b: 60, draw: 10 } });
    const indSig = enumerateIndicators(statsWith([[2, sig]])).find(i => i.key === 'L2/bankerTier')!;
    expect(indSig.leader).toBe('B');
    expect(indSig.sigLeader).toBe('B');
    expect(indicatorRow(indSig, sig).tints[2]).toBe('B');

    const notSig = levelStats({ bankerTier: { n: 10, a: 4, b: 5, draw: 1 } });
    const indNot = enumerateIndicators(statsWith([[2, notSig]])).find(i => i.key === 'L2/bankerTier')!;
    expect(indNot.leader).toBe('B');
    expect(indNot.sigLeader).toBe(null);
    expect(indicatorRow(indNot, notSig).tints[2]).toBe(null);
  });

  it('分差行的第一列是带符号的平均分差', () => {
    const st = levelStats({ bankerPts: { n: 100, sumD: -234, sumD2: 1000, pos: 10, neg: 80, zero: 10 } });
    const ind = enumerateIndicators(statsWith([[2, st]])).find(i => i.key === 'L2/bankerPts')!;
    const row = indicatorRow(ind, st);
    expect(row.cells[0]).toBe('庄家 分差');
    expect(row.cells[1]).toBe('-2.340');
    expect(row.cells[2]).toBe('B');
    expect(ind.sigLeader).toBe('B'); // 平局仅 10/100、均值 −2.34，B 显著
    expect(row.tints[2]).toBe('B');
  });

  it('样本为 0 时一律输出 —', () => {
    const st = levelStats({});
    const ind = enumerateIndicators(statsWith([[2, st]]))[0];
    expect(indicatorRow(ind, st).cells).toEqual([
      '庄家 档位', '—', '—', '—', '—', '—', '—',
    ]);
  });
});

describe('结论计数', () => {
  const mixed = (): SoloStats => statsWith([[2, levelStats({
    bankerTier: A_WIN_TIER, bankerPts: B_WIN_PTS, attackerTier: A_WIN_TIER, attackerPts: TIE_PTS,
  })]]);

  it('A / B / 不显著的项数', () => {
    expect(conclusionCounts(mixed())).toEqual({ a: 2, b: 1, none: 1, total: 4 });
  });

  it('z > 0 时才追加「另有 z 项指标不显著」', () => {
    expect(conclusionText(mixed(), 'ai', 'ai-0929'))
      .toBe('A（ai）2项指标显著领先，B（ai-0929）1项指标显著领先，另有1项指标不显著');

    const all = statsWith([[2, levelStats({
      bankerTier: A_WIN_TIER, bankerPts: A_WIN_PTS, attackerTier: A_WIN_TIER, attackerPts: A_WIN_PTS,
    })]]);
    expect(conclusionText(all, 'ai', 'ai-0929'))
      .toBe('A（ai）4项指标显著领先，B（ai-0929）0项指标显著领先');
  });

  it('多等级合并计数', () => {
    const two = statsWith([
      [2, levelStats({ bankerTier: A_WIN_TIER, bankerPts: A_WIN_PTS, attackerTier: A_WIN_TIER, attackerPts: A_WIN_PTS })],
      [5, levelStats({ bankerTier: A_WIN_TIER, bankerPts: B_WIN_PTS, attackerTier: A_WIN_TIER, attackerPts: TIE_PTS })],
    ]);
    expect(conclusionCounts(two)).toEqual({ a: 6, b: 1, none: 1, total: 8 });
  });
});

describe('宽表渲染', () => {
  const header = ['指标', '数值'];

  it('按显示宽度对齐（CJK 占 2 列）', () => {
    const out = renderColumns(header, [['庄家 档位', '0.4500']], [[null, null]], false);
    expect(out[0]).toBe('指标' + ' '.repeat(7) + '数值');
    expect(out[1]).toBe('庄家 档位  0.4500');
  });

  it('A 绿、B 红，未染色的格子保持原样；非 TTY 时不输出 ANSI', () => {
    const tints = [[null, 'A'] as const, [null, 'B'] as const, [null, null] as const];
    const rows = [['庄家 档位', 'A'], ['闲家 档位', 'B'], ['闲家 分差', '—']];
    const plain = renderColumns(['指标', '领先方'], rows, tints, false);
    expect(plain.slice(1)).toEqual(['庄家 档位  A', '闲家 档位  B', '闲家 分差  —']);
    const colored = renderColumns(['指标', '领先方'], rows, tints, true);
    expect(colored[1]).toBe('庄家 档位  \x1b[32mA\x1b[0m');
    expect(colored[2]).toBe('闲家 档位  \x1b[31mB\x1b[0m');
    expect(colored[3]).toBe('闲家 分差  —');
  });
});
