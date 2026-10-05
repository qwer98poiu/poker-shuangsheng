import { describe, it, expect } from 'vitest';
import { createNTStats } from '../nt-arena.js';
import { comparisonRows } from '../nt-report.js';
import { renderTable } from '../report.js';
import type { TableRow } from '../report.js';

function rowOf(rows: TableRow[], label: string): TableRow {
  const r = rows.find(x => x.label === label);
  expect(r, `缺行：${label}`).toBeDefined();
  return r!;
}

/** 一副 200 发的读数：A 胜 179 / B 胜 13 / 平 8。 */
function statsWithDeals() {
  const s = createNTStats();
  s.dealsWonA = 179;
  s.dealsWonB = 13;
  s.dealsDrawn = 8;
  return s;
}

describe('NT 对比表 — 平局率列', () => {
  it('胜率（发牌口径）：三格同分母 200、相加为 1，verdict 由 a/b 比大小', () => {
    const s = statsWithDeals();
    expect(rowOf(comparisonRows(s), '胜率（发牌口径）')).toEqual({
      label: '胜率（发牌口径）',
      a: '0.8950 (179/200)',
      b: '0.0650 (13/200)',
      verdict: 'a',
      draw: '0.0400 (8/200)',
    });
  });

  it('胜率（小局升级口径）：同理走配对三分类', () => {
    const s = createNTStats();
    s.pairWinsA = 100;
    s.pairWinsB = 40;
    s.pairsDrawn = 10;
    expect(rowOf(comparisonRows(s), '胜率（小局升级口径）')).toEqual({
      label: '胜率（小局升级口径）',
      a: '0.6667 (100/150)',
      b: '0.2667 (40/150)',
      verdict: 'a',
      draw: '0.0667 (10/150)',
    });
  });

  it('等级 block：有样本的等级三格齐备，无样本的等级三格都是 —', () => {
    const s = createNTStats();
    s.tierByLevel.set(7, { n: 12, a: 6, b: 4, draw: 2 });
    const rows = comparisonRows(s);
    expect(rowOf(rows, '等级 7 胜率')).toEqual({
      label: '等级 7 胜率',
      a: '0.5000 (6/12)',
      b: '0.3333 (4/12)',
      verdict: 'a',
      draw: '0.1667 (2/12)',
    });
    expect(rowOf(rows, '等级 8 胜率')).toEqual({
      label: '等级 8 胜率', a: '—', b: '—', verdict: 'none', draw: '—',
    });
  });

  it('80 口径的行没有「平」这一态：不给 draw，渲染成 —（不是 0.0000）', () => {
    const s = createNTStats();
    s.statsA.banker.hands = 10;
    s.statsA.banker.wins = 4;
    s.statsB.banker.hands = 10;
    s.statsB.banker.wins = 3;
    const rows = comparisonRows(s);
    const r = rowOf(rows, '台上胜率');
    expect(r.a).toBe('0.4000 (4/10)');
    expect(r.b).toBe('0.3000 (3/10)');
    expect(r.verdict).toBe('a');
    expect(r.draw).toBeUndefined();

    // 单行渲染，避免被其他行的标签宽度撑出填充
    const out = renderTable(['指标', 'A', 'B', '平局率'], [r], false);
    expect(out[1]).toBe('台上胜率  0.4000 (4/10)  0.3000 (3/10)  —');
  });

  it('全平（A == B 的镜像自检）：A/B 是 0.0000、平局率 1.0000，不是 0/0', () => {
    const s = createNTStats();
    s.dealsWonA = 0;
    s.dealsWonB = 0;
    s.dealsDrawn = 3;
    s.pairsDrawn = 156;
    s.tierByLevel.set(2, { n: 12, a: 0, b: 0, draw: 12 });
    const rows = comparisonRows(s);
    expect(rowOf(rows, '胜率（发牌口径）')).toEqual({
      label: '胜率（发牌口径）',
      a: '0.0000 (0/3)',
      b: '0.0000 (0/3)',
      verdict: 'tie',
      draw: '1.0000 (3/3)',
    });
    // 配对全平：小局升级口径与等级 block 同理
    expect(rowOf(rows, '胜率（小局升级口径）').draw).toBe('1.0000 (156/156)');
    expect(rowOf(rows, '等级 2 胜率')).toEqual({
      label: '等级 2 胜率',
      a: '0.0000 (0/12)',
      b: '0.0000 (0/12)',
      verdict: 'tie',
      draw: '1.0000 (12/12)',
    });
  });
});
