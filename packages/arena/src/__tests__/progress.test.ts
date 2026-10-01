import { describe, it, expect } from 'vitest';
import { formatDuration, estimateRemaining, buildCheckpointDoc, ProgressLines, CLEAR_LINE } from '../progress.js';

/** 记录 write/log 调用的假输出端。 */
function recorder(): { calls: string[]; sink: { write(s: string): void; log(s: string): void } } {
  const calls: string[] = [];
  return {
    calls,
    sink: {
      write: (s: string): void => { calls.push(`w:${s}`); },
      log: (s: string): void => { calls.push(`l:${s}`); },
    },
  };
}

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
      untilSignificant: false,
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

describe('ProgressLines', () => {
  it('TTY：进度行原地覆盖上一行（清行、不带换行）', () => {
    const { calls, sink } = recorder();
    const lines = new ProgressLines(true, sink);
    lines.progress('a');
    lines.progress('b');
    expect(calls).toEqual([`w:${CLEAR_LINE}a`, `w:${CLEAR_LINE}b`]);
  });

  it('TTY：保留行覆盖进度行后换行，其后的进度另起一行', () => {
    const { calls, sink } = recorder();
    const lines = new ProgressLines(true, sink);
    lines.progress('p1');
    lines.sticky('sig');
    lines.progress('p2');
    expect(calls).toEqual([`w:${CLEAR_LINE}p1`, `w:${CLEAR_LINE}sig\n`, `w:${CLEAR_LINE}p2`]);
  });

  it('TTY：endLine 只补一次换行；无未闭合行时不输出', () => {
    const { calls, sink } = recorder();
    const lines = new ProgressLines(true, sink);
    lines.endLine();
    expect(calls).toEqual([]);
    lines.progress('p');
    lines.endLine();
    lines.endLine();
    expect(calls).toEqual([`w:${CLEAR_LINE}p`, 'w:\n']);
  });

  it('TTY：保留行已换行后 endLine 不再补', () => {
    const { calls, sink } = recorder();
    const lines = new ProgressLines(true, sink);
    lines.sticky('sig');
    lines.endLine();
    expect(calls).toEqual([`w:${CLEAR_LINE}sig\n`]);
  });

  it('非 TTY：进度行与保留行都按普通行打印，不出现 \\r', () => {
    const { calls, sink } = recorder();
    const lines = new ProgressLines(false, sink);
    lines.progress('p');
    lines.sticky('sig');
    lines.endLine();
    expect(calls).toEqual(['l:p', 'l:sig']);
  });
});
