/**
 * 无主竞技场的样本阶梯（主循环）。
 *
 * 与 CLI 分离：`nt-run.ts` 在模块加载时执行 `main()`，测试 import 它会直接跑 CLI；
 * 这里只放与进程/IO 无关的循环逻辑，批量跑牌、时钟、输出经 `deps` 注入，
 * 于是「目标被推算上调到上限后，检查点过线是否立即停」这类控制流可被单测覆盖。
 */
import { mergeNTStats } from './nt-arena.js';
import type { NTStats } from './nt-arena.js';
import { checkSignificance, requiredMatchesForSignificance } from './significance.js';
import type { SignificanceResult } from './significance.js';
import { formatDuration, estimateRemaining } from './progress.js';
import type { ProgressLines } from './progress.js';

/** 每批发牌数（进度行节奏）。 */
export const BATCH_DEALS = 25;

export interface NTLadderArgs {
  workers: number;
  minDeals: number;
  stepDeals: number;
  maxDeals: number;
  untilSignificant: boolean;
}

/** 阶梯的可变状态：CLI 的中断处理与结果输出在循环外读它。 */
export interface NTLadderState {
  acc: NTStats;
  outcome: SignificanceResult;
  /** 当前目标发牌数（达标未显著时被推算上调）。 */
  target: number;
  interrupted: boolean;
}

export interface NTLadderDeps {
  /** 跑 [dealStart, dealStart+dealCount) 副，返回该批统计（由循环 merge）。 */
  runBatch(dealStart: number, dealCount: number): Promise<NTStats>;
  /** 自运行开始的毫秒数（测试注入假时钟）。 */
  elapsedMs(): number;
  /** 进度行与显著性行的输出端。 */
  lines: ProgressLines;
}

/** How many deals to attempt to gain roughly `needDeals` kept ones. */
export function estimateAttempts(needDeals: number, acc: NTStats): number {
  const seen = acc.deals + acc.skippedDeals;
  const passRate = seen > 0 ? acc.deals / seen : 0.4;
  return Math.max(1, Math.ceil(needDeals / Math.max(0.05, passRate)));
}

/** 发牌数为单位的胜负（一副牌里 A 赢的小局多则算 A 胜）。 */
export function dealOutcome(acc: NTStats): SignificanceResult {
  const n = acc.dealsWonA + acc.dealsWonB + acc.dealsDrawn;
  return checkSignificance(acc.dealsWonA, acc.dealsWonB, acc.dealsDrawn, n);
}

export function verdictOf(acc: NTStats, nameA: string, nameB: string): string {
  const cmp = dealOutcome(acc);
  if (!cmp.leader) return '双方胜率持平';
  const who = cmp.leader === 'A' ? nameA : nameB;
  if (!cmp.significant) return `${cmp.leader}（${who}）领先但未达显著`;
  return `${cmp.leader}（${who}）显著优于对方`;
}

/**
 * 按当前胜率推算显著所需发牌数（动态目标，与整体竞技场同一函数同一口径）。
 * 返回新目标与说明；p̂ ≤ 0.5 或推算值超过上限时取上限。
 */
export function projectTarget(acc: NTStats, stepDeals: number, maxDeals: number): { target: number; why: string } {
  const n = acc.dealsWonA + acc.dealsWonB + acc.dealsDrawn;
  const required = requiredMatchesForSignificance(
    acc.dealsWonA, acc.dealsWonB, acc.dealsDrawn, n, stepDeals, maxDeals,
  );
  const p = dealOutcome(acc).pHat;
  if (!Number.isFinite(required)) {
    return { target: maxDeals, why: `当前 p̂=${p.toFixed(4)} 未过半，显著性不可达，按上限计` };
  }
  if (required > maxDeals) {
    return { target: maxDeals, why: `按当前 p̂=${p.toFixed(4)} 推算需 ${required} 副，超过上限，按上限计` };
  }
  return { target: required, why: `按当前 p̂=${p.toFixed(4)} 推算显著所需（向上取整到 ${stepDeals} 的倍数）` };
}

/**
 * 每次显著性检查后是否立即停止：已满最小样本且显著。
 *
 * 目标可能已被推算上调到上限（`--max-deals`），此时若只在外层「跑满目标」处
 * 判定，过线后仍会一路跑到上限。整体竞技场是单层循环、每个检查点都判停，
 * 这里取同一口径。
 */
export function shouldStopAfterCheck(outcome: SignificanceResult, deals: number, minDeals: number): boolean {
  return outcome.significant && deals >= minDeals;
}

/**
 * 样本阶梯主循环：跑到目标 → 显著即停 / 达标未显著则按当前胜率推算并上调目标。
 * 每次显著性检查（每 stepDeals 副）都判停，不等跑满当前目标。
 */
export async function runNTLadder(
  args: NTLadderArgs,
  state: NTLadderState,
  deps: NTLadderDeps,
): Promise<void> {
  const { lines } = deps;
  let nextDeal = 0;
  let nextProgress = BATCH_DEALS;
  let nextSignificance = args.stepDeals;
  // --until-significant 无最小样本，进度基准先按第一次检查（stepDeals）计
  state.target = args.untilSignificant ? args.stepDeals : args.minDeals;

  for (;;) {
    while (state.acc.deals < state.target && !state.interrupted) {
      // Aim for the next progress mark; the batch may overshoot slightly
      // because the joker-pair filter drops an unknown share of attempts.
      const aim = Math.min(nextProgress, state.target);
      const attempts = estimateAttempts(Math.max(1, aim - state.acc.deals), state.acc);
      const W = args.workers;
      const chunk = Math.ceil(attempts / W);
      const tasks: Promise<NTStats>[] = [];
      for (let i = 0; i < W; i++) {
        const start = nextDeal + i * chunk;
        const count = Math.min(chunk, attempts - i * chunk);
        if (count <= 0) break;
        tasks.push(deps.runBatch(start, count));
      }
      const results = await Promise.all(tasks);
      for (const r of results) state.acc = mergeNTStats(state.acc, r);
      nextDeal += attempts;

      if (state.acc.deals < nextProgress) continue;
      nextProgress += BATCH_DEALS;

      const elapsedMs = deps.elapsedMs();
      const eta = formatDuration(estimateRemaining(elapsedMs, state.acc.deals, state.target));
      const progress = `已完赛 ${state.acc.deals} 副 | 进度 ${((state.acc.deals / state.target) * 100).toFixed(1)}% `
        + `| 已用 ${formatDuration(elapsedMs)} | 预计剩余 ${eta} | 目标 ${state.target} 副`;

      if (state.acc.deals < nextSignificance) {
        lines.progress(progress); // 原地覆盖上一行
        continue;
      }
      nextSignificance += args.stepDeals;
      state.outcome = dealOutcome(state.acc);
      const status = state.outcome.significant
        ? (state.acc.deals >= args.minDeals ? '★ 显著' : '★ 显著（未达最小样本，继续）')
        : '未显著，继续';
      // 显著性行：覆盖当前进度行后保留，直到下一处显著性结果刷新
      lines.sticky(
        `${progress} | leader=${state.outcome.leader ?? '—'} p̂=${state.outcome.pHat.toFixed(4)} `
        + `| 99% CI 下界=${state.outcome.ciLower.toFixed(4)} | ${status}`,
      );
      // 显著即停：目标可能已被推算上调到上限，不能等到跑满目标才检查
      if (shouldStopAfterCheck(state.outcome, state.acc.deals, args.minDeals)) break;
    }

    // 到达当前目标：显著即停；否则按当前胜率推算显著所需并上调目标
    state.outcome = dealOutcome(state.acc);
    if (shouldStopAfterCheck(state.outcome, state.acc.deals, args.minDeals)) break;
    if (state.target >= args.maxDeals) break;
    const proj = projectTarget(state.acc, args.stepDeals, args.maxDeals);
    if (proj.target <= state.target) break; // 推算不再增长（理论上到不了），别空转
    lines.sticky(
      `总胜率尚未显著（p̂=${state.outcome.pHat.toFixed(4)}，99% CI 下界=${state.outcome.ciLower.toFixed(4)}）`
      + `，目标调整: ${state.target} → ${proj.target} 副（${proj.why}）`,
    );
    state.target = proj.target;
    // Re-anchor the marks so the longer run keeps its own cadence.
    nextProgress = Math.max(nextProgress, (Math.floor(state.acc.deals / BATCH_DEALS) + 1) * BATCH_DEALS);
    nextSignificance = Math.max(nextSignificance, (Math.floor(state.acc.deals / args.stepDeals) + 1) * args.stepDeals);
  }
}
