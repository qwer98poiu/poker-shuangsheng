import { describe, it, expect } from 'vitest';
import { formatDuration, estimateRemaining, buildCheckpointDoc } from '../progress.js';

describe('formatDuration', () => {
  it('秒级：0s / 59s', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59_000)).toBe('59s');
  });

  it('分钟级：4m12s', () => {
    expect(formatDuration(4 * 60_000 + 12_000)).toBe('4m12s');
    expect(formatDuration(61_000)).toBe('1m01s');
  });

  it('小时级：2h05m / 1h00m', () => {
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000)).toBe('2h05m');
    expect(formatDuration(3_600_000)).toBe('1h00m');
  });

  it('负数钳制为 0s', () => {
    expect(formatDuration(-1000)).toBe('0s');
  });
});

describe('estimateRemaining', () => {
  it('按平均速率外推剩余时间', () => {
    // 60s 跑了 1000 场，总 10000 场 → 剩余 9000 场 ≈ 540s
    expect(estimateRemaining(60_000, 1000, 10_000)).toBe(540_000);
  });

  it('done<=0 或已跑完 → 0', () => {
    expect(estimateRemaining(60_000, 0, 10_000)).toBe(0);
    expect(estimateRemaining(60_000, 10_000, 10_000)).toBe(0);
    expect(estimateRemaining(60_000, 12_000, 10_000)).toBe(0);
  });
});

describe('buildCheckpointDoc', () => {
  it('检查点文档：元数据 + 已评估场数 + 双方统计', () => {
    const meta = {
      seed: 42,
      strategyA: 'ai',
      strategyB: 'ai-0801',
      minMatches: 10_000,
      maxMatches: 100_000,
      stepMatches: 1000,
      startedAt: '2026-08-02T02:00:00.000Z',
    };
    const doc = buildCheckpointDoc(meta, 1500, { handsPlayed: 100 }, { handsPlayed: 100 }, '2026-08-02T02:05:00.000Z') as any;
    expect(doc.meta).toEqual({ ...meta, checkpointAt: '2026-08-02T02:05:00.000Z' });
    expect(doc.evaluatedMatches).toBe(3000);
    expect(doc.pairsDone).toBe(1500);
    expect(doc.strategies.A).toEqual({ name: 'ai', handsPlayed: 100 });
    expect(doc.strategies.B).toEqual({ name: 'ai-0801', handsPlayed: 100 });
  });
});
