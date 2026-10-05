import { describe, it, expect } from 'vitest';
import { betterSide, displayWidth, renderTable, rowsFrom, perLevelSpecs, trioShares } from '../report.js';
import { levelLabel } from '../level-label.js';

const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

describe('levelLabel', () => {
  it('2-10 保持数字', () => {
    expect(levelLabel(2)).toBe('2');
    expect(levelLabel(10)).toBe('10');
  });

  it('11-14 显示为 J/Q/K/A', () => {
    expect(levelLabel(11)).toBe('J');
    expect(levelLabel(12)).toBe('Q');
    expect(levelLabel(13)).toBe('K');
    expect(levelLabel(14)).toBe('A');
  });

  it('范围外原样输出', () => {
    expect(levelLabel(15)).toBe('15');
  });
});

describe('betterSide', () => {
  it('越大越好：比值大的一侧更优', () => {
    expect(betterSide({ n: 60, d: 100 }, { n: 40, d: 100 }, 'high')).toBe('a');
    expect(betterSide({ n: 40, d: 100 }, { n: 60, d: 100 }, 'high')).toBe('b');
  });

  it('越小越好：比值小的一侧更优', () => {
    expect(betterSide({ n: 40, d: 100 }, { n: 60, d: 100 }, 'low')).toBe('a');
    expect(betterSide({ n: 60, d: 100 }, { n: 40, d: 100 }, 'low')).toBe('b');
  });

  it('相等 → tie（异分母也按比值比较）', () => {
    expect(betterSide({ n: 1, d: 2 }, { n: 3, d: 6 }, 'high')).toBe('tie');
  });

  it('中性指标恒为 none', () => {
    expect(betterSide({ n: 60, d: 100 }, { n: 40, d: 100 }, 'neutral')).toBe('none');
  });

  it('任一侧无样本（d=0）→ none', () => {
    expect(betterSide({ n: 0, d: 0 }, { n: 40, d: 100 }, 'high')).toBe('none');
    expect(betterSide({ n: 60, d: 100 }, { n: 0, d: 0 }, 'high')).toBe('none');
  });
});

describe('displayWidth', () => {
  it('ASCII 每个字符 1 列', () => {
    expect(displayWidth('ai-0929')).toBe(7);
  });

  it('CJK 每个字符 2 列', () => {
    expect(displayWidth('指标')).toBe(4);
  });

  it('中英混排 + 全角括号', () => {
    // 策略(4) + A(1) + （(2) + ai(2) + ）(2)
    expect(displayWidth('策略A（ai）')).toBe(11);
  });

  it('破折号 — 记 1 列', () => {
    expect(displayWidth('—')).toBe(1);
  });
});

describe('renderTable', () => {
  it('按显示宽度对齐（中英混排标签列）', () => {
    const out = renderTable(['指标', 'A', 'B'], [
      { label: '台上 J 胜率', a: '1', b: '2', verdict: 'none' },
    ], false);
    expect(out[0]).toBe('指标' + ' '.repeat(7) + '  A  B');
    expect(out[1]).toBe('台上 J 胜率  1  2');
  });

  it('值列按最长值右填充', () => {
    const out = renderTable(['指标', 'A', 'B'], [
      { label: '胜率', a: '1.2345', b: '0.5', verdict: 'none' },
      { label: '平手', a: '0.5', b: '0.5', verdict: 'none' },
    ], false);
    expect(out[1]).toBe('胜率  1.2345  0.5');
    expect(out[2]).toBe('平手  0.5     0.5');
  });

  it('染色：更优一侧套绿，另一侧不套', () => {
    const out = renderTable(['指标', 'A', 'B'], [
      { label: '胜率', a: '0.6', b: '0.4', verdict: 'a' },
    ], true);
    expect(out[1]).toBe(`胜率  ${GREEN}0.6${RESET}  0.4`);
  });

  it('染色：verdict=b 时右侧套绿', () => {
    const out = renderTable(['指标', 'A', 'B'], [
      { label: '台上平均失分', a: '0.6', b: '0.4', verdict: 'b' },
    ], true);
    expect(out[1]).toBe(`台上平均失分  0.6  ${GREEN}0.4${RESET}`);
  });

  it('染色：tie 两侧都套绿', () => {
    const out = renderTable(['指标', 'A', 'B'], [
      { label: '胜率', a: '0.5', b: '0.5', verdict: 'tie' },
    ], true);
    expect(out[1]).toBe(`胜率  ${GREEN}0.5${RESET}  ${GREEN}0.5${RESET}`);
  });

  it('染色：none 不套色（含中性指标与无样本 —）', () => {
    const out = renderTable(['指标', 'A', 'B'], [
      { label: '当庄频率', a: '0.5', b: '0.6', verdict: 'none' },
      { label: '台上 L2 胜率', a: '—', b: '—', verdict: 'none' },
    ], true);
    expect(out[1]).toBe('当庄频率' + ' '.repeat(4) + '  0.5  0.6');
    expect(out[2]).toBe('台上 L2 胜率  —    —');
  });

  it('color=false 时完全不输出转义码', () => {
    const out = renderTable(['指标', 'A', 'B'], [
      { label: '胜率', a: '0.6', b: '0.4', verdict: 'a' },
    ], false);
    expect(out[1]).toBe('胜率  0.6  0.4');
  });

  it('填充按原文宽度算：染色不影响对齐', () => {
    const out = renderTable(['指标', 'A', 'B'], [
      { label: '胜率', a: '1.2345', b: '0.5', verdict: 'a' },
      { label: '平手', a: '0.5', b: '0.5', verdict: 'none' },
    ], true);
    expect(out[1]).toBe(`胜率  ${GREEN}1.2345${RESET}  0.5`);
    expect(out[2]).toBe('平手  0.5     0.5');
  });

  it('4 列（表头末列平局率）：有 draw 输出该值，缺省输出 —，末列不补尾随空格', () => {
    const out = renderTable(['指标', 'A', 'B', '平'], [
      { label: '胜率', a: '0.9', b: '0.1', verdict: 'a', draw: '0.0' },
      { label: '台上', a: '0.4', b: '0.3', verdict: 'a' },
    ], false);
    expect(out[0]).toBe('指标  A    B    平');
    expect(out[1]).toBe('胜率  0.9  0.1  0.0');
    expect(out[2]).toBe('台上  0.4  0.3  —');
  });

  it('4 列：平局格不参与染色（verdict=a 时只有 A 格套绿）', () => {
    const out = renderTable(['指标', 'A', 'B', '平'], [
      { label: '胜率', a: '0.9', b: '0.1', verdict: 'a', draw: '0.0' },
    ], true);
    expect(out[1]).toBe(`胜率  ${GREEN}0.9${RESET}  0.1  0.0`);
  });
});

describe('trioShares — 三分 → 三格', () => {
  it('三格共享同一分母（a + b + 平），相加恒为 1', () => {
    expect(trioShares({ a: 179, b: 13, draw: 8 })).toEqual({
      a: { n: 179, d: 200 }, b: { n: 13, d: 200 }, draw: { n: 8, d: 200 },
    });
  });

  it('全平时 A/B 是 0/N（渲染成 0.0000），不是 0/0（—）', () => {
    const t = trioShares({ a: 0, b: 0, draw: 5 });
    expect(t).toEqual({ a: { n: 0, d: 5 }, b: { n: 0, d: 5 }, draw: { n: 5, d: 5 } });
    const rows = rowsFrom([['胜率', t.a, t.b, 'high', t.draw]]);
    expect(rows[0].a).toBe('0.0000 (0/5)');
  });
});

describe('rowsFrom — 平局格', () => {
  it('没给 draw 的行不产出平局文本（渲染时补 —）', () => {
    const rows = rowsFrom([['胜率', { n: 1, d: 2 }, { n: 1, d: 2 }, 'high']]);
    expect(rows[0].draw).toBeUndefined();
  });

  it('给了 draw 的行按同一 ratioText 格式输出', () => {
    const rows = rowsFrom([['胜率', { n: 1, d: 2 }, { n: 1, d: 2 }, 'high', { n: 0, d: 4 }]]);
    expect(rows[0].draw).toBe('0.0000 (0/4)');
  });
});

describe('perLevelSpecs — 平局列', () => {
  it('带 draw map：每等级三格齐备；缺样本的等级三格都是 —', () => {
    const specs = perLevelSpecs(
      '等级',
      new Map([[2, { n: 3, d: 4 }]]),
      new Map([[2, { n: 1, d: 4 }]]),
      new Map([[2, { n: 0, d: 4 }]]),
    );
    expect(specs).toHaveLength(13);
    expect(specs[0]).toEqual([
      '等级 2 胜率', { n: 3, d: 4 }, { n: 1, d: 4 }, 'high', { n: 0, d: 4 },
    ]);
    expect(specs[1]).toEqual([
      '等级 3 胜率', { n: 0, d: 0 }, { n: 0, d: 0 }, 'high', { n: 0, d: 0 },
    ]);
  });

  it('不带 draw map：第 4 元是 undefined（保持 3 列口径）', () => {
    const specs = perLevelSpecs('台上', new Map([[2, { n: 1, d: 2 }]]), new Map());
    expect(specs[0][4]).toBeUndefined();
  });
});
