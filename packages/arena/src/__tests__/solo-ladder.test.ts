import { describe, it, expect } from 'vitest';
import { createSoloStats } from '../solo-arena.js';
import type { SoloStats } from '../solo-arena.js';
import { ProgressLines } from '../progress.js';
import { Z } from '../significance.js';
import { enumerateIndicators } from '../solo-report.js';
import { allSignificant, latestChange, requiredNPaired, runSoloLadder } from '../solo-ladder.js';
import type { SoloLadderState } from '../solo-ladder.js';

/** 静默输出端：单测不打印进度行。 */
const silent = new ProgressLines(false, { write: () => {}, log: () => {} });

const LEVEL = 2;

function emptyState(): SoloLadderState {
  return { acc: createSoloStats([LEVEL]), target: 0, interrupted: false, prevSig: new Map() };
}

/** 一批发牌：档位全平、分差恒 0 —— 4 项都不显著。 */
function drawBatch(level: number, n: number): SoloStats {
  const s = createSoloStats([level]);
  const st = s.levels.get(level)!;
  st.bankerTier = { n, a: 0, b: 0, draw: n };
  st.attackerTier = { n, a: 0, b: 0, draw: n };
  st.bankerPts = { n, sumD: 0, sumD2: 0, pos: 0, neg: 0, zero: n };
  st.attackerPts = { n, sumD: 0, sumD2: 0, pos: 0, neg: 0, zero: n };
  s.keptDeals = n;
  s.attemptedDeals = n;
  s.handsPlayed = n * 3;
  return s;
}

/** 一批发牌：档位全 A 胜、分差每副 +2 —— 4 项都显著 A 领先。 */
function aWinBatch(level: number, n: number): SoloStats {
  const s = createSoloStats([level]);
  const st = s.levels.get(level)!;
  st.bankerTier = { n, a: n, b: 0, draw: 0 };
  st.attackerTier = { n, a: n, b: 0, draw: 0 };
  st.bankerPts = { n, sumD: 2 * n, sumD2: 6 * n, pos: n, neg: 0, zero: 0 };
  st.attackerPts = { n, sumD: 2 * n, sumD2: 6 * n, pos: n, neg: 0, zero: 0 };
  s.keptDeals = n;
  s.attemptedDeals = n;
  s.handsPlayed = n * 3;
  return s;
}

describe('requiredNPaired', () => {
  const b = { n: 100, sumD: 100, sumD2: 200, pos: 100, neg: 0, zero: 0 };

  it('按 (z·sd/mean)² 推算并向上取整到 step 的倍数', () => {
    // sd² = 100/99，z = 2.576 ⇒ (z·sd/1)² ≈ 6.7028 ⇒ ceil 7 ⇒ +1 = 8
    expect(requiredNPaired(b, Z, 1)).toBe(8);
    expect(requiredNPaired(b, Z, 10)).toBe(10);
  });

  it('均值为 0 或样本不足时不可达', () => {
    expect(requiredNPaired({ n: 100, sumD: 0, sumD2: 100, pos: 0, neg: 0, zero: 100 }, Z, 1)).toBe(Infinity);
    expect(requiredNPaired({ n: 1, sumD: 1, sumD2: 1, pos: 1, neg: 0, zero: 0 }, Z, 1)).toBe(Infinity);
  });
});

describe('全显著判定', () => {
  it('4 项都显著才为真；全平为假', () => {
    expect(allSignificant(aWinBatch(LEVEL, 100))).toBe(true);
    expect(allSignificant(drawBatch(LEVEL, 100))).toBe(false);
  });

  it('一个指标都没有样本时视为未显著（避免空跑即停）', () => {
    expect(allSignificant(createSoloStats([LEVEL]))).toBe(false);
  });

  it('四项里只有三项显著时为假', () => {
    const s = aWinBatch(LEVEL, 100);
    s.levels.get(LEVEL)!.attackerPts = { n: 100, sumD: 0, sumD2: 100, pos: 0, neg: 0, zero: 100 };
    expect(allSignificant(s)).toBe(false);
  });
});

describe('显著性行：最新达到或改变显著的指标', () => {
  it('无变化时给出汇总，出现新显著时点名该项', () => {
    const state = emptyState();
    expect(latestChange(enumerateIndicators(drawBatch(LEVEL, 100)), state))
      .toBe('尚无新变化（0/4 项显著）');
    expect(latestChange(enumerateIndicators(aWinBatch(LEVEL, 100)), state))
      .toBe('等级 2 闲家 分差 显著 A 领先');
    expect(latestChange(enumerateIndicators(aWinBatch(LEVEL, 100)), state))
      .toBe('尚无新变化（4/4 项显著）');
  });
});

describe('样本阶梯：检查点全显著即停', () => {
  it('回归（until-significant）：首个检查点未显著→目标上调到上限，之后过线须立即停而非跑满上限', async () => {
    // 首个检查点（200 副）全平未显著，推算不可达 → 目标计上限 1000；
    // 第 2 个检查点（累计 400 副，档位全 A 胜 + 分差 +1/副）已全显著 ——
    // 若不在此处判停，会一路跑到 1000 副。
    const state = emptyState();
    let call = 0;
    await runSoloLadder(
      { workers: 1, minDeals: 0, stepDeals: 200, maxDeals: 1000, untilSignificant: true },
      state,
      {
        runBatch: () => Promise.resolve(call++ === 0 ? drawBatch(LEVEL, 200) : aWinBatch(LEVEL, 200)),
        elapsedMs: () => 0,
        lines: silent,
      },
    );
    expect(state.acc.keptDeals).toBe(400);
    expect(state.target).toBe(1000);
    expect(allSignificant(state.acc)).toBe(true);
  });

  it('无过滤器时第一批就按 1:1 采，绝不越过 --max-deals', async () => {
    const state = emptyState();
    const sizes: number[] = [];
    await runSoloLadder(
      { workers: 1, minDeals: 0, stepDeals: 100, maxDeals: 100, untilSignificant: true },
      state,
      {
        runBatch: (_start, n) => { sizes.push(n); return Promise.resolve(drawBatch(LEVEL, n)); },
        elapsedMs: () => 0,
        lines: silent,
      },
    );
    expect(sizes).toEqual([100]);
    expect(state.acc.keptDeals).toBe(100);
  });

  it('有过滤器时按实测通过率补采，仍然不越过 --max-deals', async () => {
    const state = emptyState();
    const sizes: number[] = [];
    await runSoloLadder(
      { workers: 1, minDeals: 0, stepDeals: 100, maxDeals: 100, untilSignificant: true },
      state,
      {
        runBatch: (_start, n) => {
          sizes.push(n);
          // 只保留一半（模拟 --nt-only 一类的过滤器）：尝试 n 副、有效 ⌊n/2⌋ 副
          const b = drawBatch(LEVEL, Math.floor(n / 2));
          b.attemptedDeals = n;
          return Promise.resolve(b);
        },
        elapsedMs: () => 0,
        lines: silent,
      },
    );
    expect(sizes).toEqual([100, 100]);
    expect(state.acc.keptDeals).toBe(100);
    expect(state.acc.attemptedDeals).toBe(200);
  });

  it('每批之后让出一次事件循环（否则同步算完的批次里 SIGINT 处理器永远跑不到）', async () => {
    const state = emptyState();
    const order: string[] = [];
    let n = 0;
    await runSoloLadder(
      { workers: 1, minDeals: 0, stepDeals: 100, maxDeals: 300, untilSignificant: true },
      state,
      {
        runBatch: () => {
          order.push(`batch${n++}`);
          setImmediate(() => order.push('macro'));
          return Promise.resolve(drawBatch(LEVEL, 100));
        },
        elapsedMs: () => 0,
        lines: silent,
      },
    );
    // 若批与批之间不让出，排队的宏任务只会等到全部批跑完才执行
    expect(order.slice(0, 4)).toEqual(['batch0', 'macro', 'batch1', 'macro']);
  });

  it('默认最小样本：达最小样本且全显著即停', async () => {
    const state = emptyState();
    await runSoloLadder(
      { workers: 1, minDeals: 200, stepDeals: 200, maxDeals: 1000, untilSignificant: false },
      state,
      {
        runBatch: () => Promise.resolve(aWinBatch(LEVEL, 200)),
        elapsedMs: () => 0,
        lines: silent,
      },
    );
    expect(state.acc.keptDeals).toBe(200);
  });
});
