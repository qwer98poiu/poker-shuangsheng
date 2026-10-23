import { describe, it, expect } from 'vitest';
import { createDealStats } from '../deal-arena.js';
import type { DealStats } from '../deal-arena.js';
import { ProgressLines } from '../progress.js';
import {
  dealOutcome, estimateAttempts, projectTarget, runDealLadder,
  shouldStopAfterCheck,
} from '../deal-ladder.js';
import type { DealLadderState } from '../deal-ladder.js';

/** 构造一副只带发牌口径计数的统计。 */
function statsWith(wonA: number, wonB: number, drawn: number): DealStats {
  const s = createDealStats([2]);
  s.acceptedDeals = wonA + wonB + drawn;
  s.attemptedDeals = s.acceptedDeals;
  s.dealOutcome = { n: s.acceptedDeals, a: wonA, b: wonB, draw: drawn };
  s.overall.outcome = { n: wonA + wonB + drawn, a: wonA, b: wonB, draw: drawn };
  s.handsPlayed = 12 * s.acceptedDeals;
  return s;
}

function sink(): { lines: ProgressLines; out: string[] } {
  const out: string[] = [];
  return {
    lines: new ProgressLines(false, {
      write: (s): void => { out.push(s); },
      log: (s): void => { out.push(s); },
    }),
    out,
  };
}

describe('estimateAttempts', () => {
  it('无样本时用先验；有样本后用实测通过率', () => {
    const empty = createDealStats([2]);
    expect(estimateAttempts(10, empty, 1)).toBe(10);
    expect(estimateAttempts(10, empty, 0.4)).toBe(25);
    const acc = statsWith(4, 0, 0);
    acc.attemptedDeals = 10; // 通过率 0.4
    expect(estimateAttempts(10, acc, 1)).toBe(25);
  });
});

describe('发牌口径显著性', () => {
  it('平局折 0.5：3 胜 1 负 2 平 → p̂ = 4/6', () => {
    const r = dealOutcome(statsWith(3, 1, 2));
    expect(r.pHat).toBeCloseTo(4 / 6, 12);
    expect(r.n).toBe(6);
    expect(r.leader).toBe('A');
  });

  it('shouldStopAfterCheck：显著且达最小样本', () => {
    const acc = statsWith(100, 10, 0);
    const r = dealOutcome(acc);
    expect(r.significant).toBe(true);
    expect(shouldStopAfterCheck(r, acc, 110)).toBe(true);
    expect(shouldStopAfterCheck(r, acc, 111)).toBe(false);
  });
});

describe('projectTarget', () => {
  it('p̂ 未过半（全平）→ 上限', () => {
    const acc = statsWith(0, 0, 30);
    expect(projectTarget(acc, 10, 500)).toEqual({
      target: 500,
      why: expect.stringContaining('未过半'),
    });
  });

  it('按当前 p̂ 推算所需发牌数（向上取整到 step）', () => {
    const acc = statsWith(60, 40, 0);
    const p = projectTarget(acc, 100, 10000);
    expect(p.target % 100).toBe(0);
    expect(p.target).toBeGreaterThan(100);
  });
});

describe('样本阶梯控制流', () => {
  it('首次检查不显著 → 目标上调；随后显著 → 立即停，不跑满上限', async () => {
    const { lines } = sink();
    const acc = createDealStats([2]);
    const state: DealLadderState = { acc, outcome: dealOutcome(acc), target: 0, interrupted: false };
    let calls = 0;
    await runDealLadder(
      { workers: 1, minDeals: 20, stepDeals: 10, maxDeals: 1000, untilSignificant: false, priorPassRate: 1 },
      state,
      {
        runBatch: async (_start, count) => {
          calls += 1;
          // 第一批不显著；之后显著。
          return calls === 1 ? statsWith(0, 0, count) : statsWith(count * 9, count, 0);
        },
        elapsedMs: () => 0,
        lines,
      },
    );
    expect(state.acc.acceptedDeals).toBeLessThan(1000);
    expect(state.acc.acceptedDeals).toBeGreaterThanOrEqual(20);
    expect(dealOutcome(state.acc).significant).toBe(true);
  });

  it('全平局：不显著，跑到上限后停', async () => {
    const { lines } = sink();
    const acc = createDealStats([2]);
    const state: DealLadderState = { acc, outcome: dealOutcome(acc), target: 0, interrupted: false };
    await runDealLadder(
      { workers: 1, minDeals: 10, stepDeals: 5, maxDeals: 20, untilSignificant: false, priorPassRate: 1 },
      state,
      {
        runBatch: async (_start, count) => statsWith(0, 0, count),
        elapsedMs: () => 0,
        lines,
      },
    );
    expect(state.acc.acceptedDeals).toBe(20);
    expect(dealOutcome(state.acc).significant).toBe(false);
  });

  it('全部被过滤：达到尝试上限后停，不死循环', async () => {
    const { lines, out } = sink();
    const acc = createDealStats([2]);
    const state: DealLadderState = { acc, outcome: dealOutcome(acc), target: 0, interrupted: false };
    await runDealLadder(
      { workers: 1, minDeals: 0, stepDeals: 10, maxDeals: 10, untilSignificant: true, priorPassRate: 0.05 },
      state,
      {
        runBatch: async (_start, count) => {
          const s = createDealStats([2]);
          s.attemptedDeals = count;
          s.skippedDeals = count;
          s.filterSkippedDeals = count;
          return s;
        },
        elapsedMs: () => 0,
        lines,
      },
    );
    expect(state.acc.acceptedDeals).toBe(0);
    expect(out.join('\n')).toContain('尝试上限');
  });

  it('进度行：无中止不写已结算；有中止写（已中止 x 小局）；不写三元组', async () => {
    const run = async (abortedHands: number): Promise<string> => {
      const { lines, out } = sink();
      const acc = createDealStats([2]);
      const state: DealLadderState = { acc, outcome: dealOutcome(acc), target: 0, interrupted: false };
      await runDealLadder(
        { workers: 1, minDeals: 25, stepDeals: 25, maxDeals: 25, untilSignificant: false, priorPassRate: 1 },
        state,
        {
          runBatch: async (_start, count) => {
            const s = statsWith(0, 0, count);
            s.abortedHands = abortedHands;
            return s;
          },
          elapsedMs: () => 0,
          lines,
        },
      );
      return out.join('\n');
    };

    const clean = await run(0);
    expect(clean).not.toContain('已结算');
    expect(clean).not.toContain('已中止');
    expect(clean).not.toContain('三元组');

    const aborted = await run(3);
    expect(aborted).toContain('（已中止 3 小局）');
    expect(aborted).not.toContain('三元组');
  });
});
