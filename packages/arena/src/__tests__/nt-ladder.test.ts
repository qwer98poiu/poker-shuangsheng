import { describe, it, expect } from 'vitest';
import { createNTStats } from '../nt-arena.js';
import type { NTStats } from '../nt-arena.js';
import { ProgressLines } from '../progress.js';
import { runNTLadder } from '../nt-ladder.js';
import type { NTLadderArgs, NTLadderState } from '../nt-ladder.js';

/** 静默输出端：单测不打印进度行。 */
const silent = new ProgressLines(false, { write: () => {}, log: () => {} });

/** 一批发牌：`deals` 副里 A 胜 `dealsWonA`、平 `dealsDrawn`，其余 B 胜。 */
function batch(deals: number, dealsWonA: number, dealsDrawn = 0): NTStats {
  const s = createNTStats();
  s.deals = deals;
  s.dealsWonA = dealsWonA;
  s.dealsDrawn = dealsDrawn;
  s.dealsWonB = deals - dealsWonA - dealsDrawn;
  return s;
}

function makeState(): NTLadderState {
  return { acc: createNTStats(), outcome: { significant: false, leader: null, pHat: 0.5, ciLower: 0.5, n: 0 }, target: 0, interrupted: false };
}

/** 按调用序号返回统计的假 runBatch；超出序列后重复最后一档。 */
function sequenceBatch(steps: NTStats[]): (dealStart: number, dealCount: number) => Promise<NTStats> {
  let i = 0;
  return () => Promise.resolve(steps[Math.min(i++, steps.length - 1)]);
}

const deps = (runBatch: (dealStart: number, dealCount: number) => Promise<NTStats>) => ({
  runBatch,
  elapsedMs: (): number => 0,
  lines: silent,
});

function args(over: Partial<NTLadderArgs>): NTLadderArgs {
  return { workers: 1, minDeals: 25, stepDeals: 25, maxDeals: 1000, ...over };
}

describe('NT 样本阶梯：检查点显著即停', () => {
  it('回归：达标未显著→目标上调到上限，之后过线须立即停而非跑满上限', () => {
    // 首个检查点（25 副）p̂=0.52 未显著，推算所需 1025 副 > 上限 1000 → 目标计为 1000；
    // 第 2 个检查点（50 副，累计 p̂=0.76）已显著——若不在此处判停会一路跑到 1000 副。
    const state = makeState();
    return runNTLadder(
      args({ maxDeals: 1000 }),
      state,
      deps(sequenceBatch([batch(25, 13), batch(25, 25)])),
    ).then(() => {
      expect(state.acc.deals).toBe(50);
      expect(state.target).toBe(1000);
      expect(state.outcome.significant).toBe(true);
      expect(state.outcome.leader).toBe('A');
    });
  });

  it('回归（不同上限）：目标上调到上限后过线同样立即停', () => {
    const state = makeState();
    return runNTLadder(
      args({ minDeals: 25, maxDeals: 500 }),
      state,
      deps(sequenceBatch([batch(25, 13), batch(25, 25)])),
    ).then(() => {
      expect(state.acc.deals).toBe(50);
      expect(state.target).toBe(500);
      expect(state.outcome.significant).toBe(true);
    });
  });

  it('首个检查点即显著：停在第一个检查点（stepDeals 副）', () => {
    const state = makeState();
    return runNTLadder(
      args({ stepDeals: 25, maxDeals: 1000 }),
      state,
      deps(sequenceBatch([batch(25, 20)])),
    ).then(() => {
      expect(state.acc.deals).toBe(25);
      expect(state.outcome.significant).toBe(true);
    });
  });

  it('未达最小样本时显著不提前停（继续跑到 minDeals）', () => {
    const state = makeState();
    return runNTLadder(
      args({ minDeals: 50, stepDeals: 25, maxDeals: 1000 }),
      state,
      deps(sequenceBatch([batch(25, 20)])),
    ).then(() => {
      expect(state.acc.deals).toBe(50);
      expect(state.outcome.significant).toBe(true);
    });
  });

  it('始终未过半：显著性不可达，跑到上限即停（不空转）', () => {
    const state = makeState();
    return runNTLadder(
      args({ stepDeals: 25, maxDeals: 100 }),
      state,
      deps(sequenceBatch([batch(25, 0, 25)])), // 全平：leader 为空，p̂=0.5
    ).then(() => {
      expect(state.acc.deals).toBe(100);
      expect(state.target).toBe(100);
      expect(state.outcome.significant).toBe(false);
    });
  });
});
