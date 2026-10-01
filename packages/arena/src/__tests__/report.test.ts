import { describe, it, expect } from 'vitest';
import { betterSide, displayWidth, renderTable } from '../report.js';
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
});
