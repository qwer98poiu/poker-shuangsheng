/**
 * probe 条件自检：前 N 副对**每个决策**同时查询 A/B，统计条件假阴性。
 *
 * 正式跑之前必须做这一步：条件漏判（A/B 实际改牌但 hit=false）会让受影响样本
 * 偏小、结论失真。所以默认在 deal-run 里强制执行，假阴性 > 0 直接中止。
 */
import { deckForHand } from './rng.js';
import type { ArenaSeed } from './rng.js';
import { runDealSweep } from './deal-arena.js';
import type { DeclarerIdx } from './deal-arena.js';
import { emptyProbeCheckStats, wrapForCheck } from './probe.js';
import type { ProbeCheckStats, ProbeModule } from './probe.js';
import type { Strategy } from './types.js';

export interface ProbeCheckOptions {
  seed: ArenaSeed;
  /** 检查前多少副（按发牌序号从 0 开始）。 */
  dealCount: number;
  levels: readonly number[];
  strategyA: Strategy;
  strategyB: Strategy;
  dealFilters: readonly string[];
  declarerSeats: readonly DeclarerIdx[];
  probe: ProbeModule;
}

export function runProbeCheck(o: ProbeCheckOptions): ProbeCheckStats {
  const stats = emptyProbeCheckStats();
  for (let k = 0; k < o.dealCount; k++) {
    const deck = deckForHand(o.seed, 0, k);
    const a = wrapForCheck(o.strategyA, o.strategyB, o.probe, stats, k);
    const b = wrapForCheck(o.strategyB, o.strategyA, o.probe, stats, k);
    runDealSweep({
      seed: o.seed, dealIndex: k, deck, levels: o.levels,
      strategyA: a, strategyB: b,
      dealFilters: o.dealFilters, declarerSeats: o.declarerSeats,
    });
  }
  return stats;
}
