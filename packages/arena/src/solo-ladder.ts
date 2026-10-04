/**
 * 单副牌 A/B 竞技场的样本阶梯（主循环）。
 *
 * 与 CLI 分离：`solo-run.ts` 在模块加载时执行 `main()`，测试 import 它会直接跑 CLI；
 * 这里只放与进程/IO 无关的循环逻辑，批量跑牌、时钟、输出经 `deps` 注入，
 * 于是「目标被推算上调到上限后，检查点过线是否立即停」这类控制流可被单测覆盖。
 *
 * 每 `--step-deals` 副检查一次：**所有等级 × 4 项指标**都显著即停；达标未显著则按
 * 当前读数推算显著所需发牌数并上调目标（取各指标所需的最大值）。
 */
import { mergeSoloStats } from './solo-arena.js';
import type { PairedBucket, SoloStats } from './solo-arena.js';
import { requiredMatchesForSignificance, Z } from './significance.js';
import { formatDuration, estimateRemaining } from './progress.js';
import type { ProgressLines } from './progress.js';
import { activeIndicators, enumerateIndicators, indicatorLabel, pairedInterval } from './solo-report.js';
import type { Indicator } from './solo-report.js';

/** 进度行节奏（有效发牌数）。 */
export const BATCH_DEALS = 200;

export interface SoloLadderArgs {
  workers: number;
  minDeals: number;
  stepDeals: number;
  maxDeals: number;
  untilSignificant: boolean;
}

/** 阶梯的可变状态：CLI 的中断处理与结果输出在循环外读它。 */
export interface SoloLadderState {
  acc: SoloStats;
  /** 当前目标有效发牌数（达标未显著时被推算上调）。 */
  target: number;
  interrupted: boolean;
  /** 上一次检查时各指标的显著方（key → 'A'|'B'|null），用于「最新达到或改变」。 */
  prevSig: Map<string, 'A' | 'B' | null>;
}

export interface SoloLadderDeps {
  /** 跑 [dealStart, dealStart+dealCount) 副，返回该批统计（由循环 merge）。 */
  runBatch(dealStart: number, dealCount: number): Promise<SoloStats>;
  /** 自运行开始的毫秒数（测试注入假时钟）。 */
  elapsedMs(): number;
  /** 进度行与显著性行的输出端。 */
  lines: ProgressLines;
}

export function createSoloLadderState(acc: SoloStats): SoloLadderState {
  return { acc, target: 0, interrupted: false, prevSig: new Map() };
}

/**
 * 为拿到 needDeals 副**有效**发牌，需要尝试多少副（按当前过滤通过率外推）。
 *
 * 没有历史时的先验取 1.0（不假设有过滤器）：过滤器把通过率压到多低都不会欠采，
 * 只会多跑几批；反过来把先验压小就会**超采**——第一批就冲过 --max-deals，
 * 那是把「上限」这个唯一硬约束搞失效的方向。
 */
export function estimateAttempts(needDeals: number, acc: SoloStats): number {
  const passRate = acc.attemptedDeals > 0 ? acc.keptDeals / acc.attemptedDeals : 1;
  return Math.max(1, Math.ceil(needDeals / Math.max(0.05, passRate)));
}

/**
 * 全部**有样本**的指标都显著。等级被过滤器滤光时它的 4 项 n = 0，不参与判定
 * （否则那种等级会让运行一路跑到上限）；一个指标都没有时视为「未显著」，避免空跑即停。
 */
export function allSignificant(acc: SoloStats): boolean {
  const inds = activeIndicators(acc);
  return inds.length > 0 && inds.every(i => i.sigLeader !== null);
}

export function shouldStopAfterCheck(acc: SoloStats, minDeals: number): boolean {
  return acc.keptDeals >= minDeals && allSignificant(acc);
}

/** 分差口径所需 trial 数：|mean| − z·sd/√n > 0 ⟺ n > (z·sd/mean)²，向上取整到 step。 */
export function requiredNPaired(b: PairedBucket, z: number, step: number): number {
  const { mean, usable } = pairedInterval(b, z);
  if (!usable || mean === 0) return Infinity;
  const variance = Math.max(0, (b.sumD2 - b.n * mean * mean) / (b.n - 1));
  const sd = Math.sqrt(variance);
  const need = Math.ceil((z * sd / Math.abs(mean)) ** 2) + 1;
  return Math.ceil(need / step) * step;
}

export interface Projection {
  target: number;
  why: string;
}

/**
 * 按当前读数推算显著所需的有效发牌数：取各指标所需的最大值。
 * 某等级被过滤器滤掉一部分发牌时，按该等级的 trial 占比折算回总发牌数。
 * p̂ 未过半 / 分差均值为 0 ⇒ 该口径不可达，取上限。
 */
export function projectTarget(acc: SoloStats, stepDeals: number, maxDeals: number): Projection {
  let worst = 0;
  let unreachable = '';
  for (const [level, st] of acc.levels) {
    const trials = st.bankerTier.n;
    if (trials === 0) continue; // 空等级不参与推算（也没法推算）
    const share = acc.keptDeals > 0 ? trials / acc.keptDeals : 1;
    const toDeals = (reqTrials: number): number =>
      Number.isFinite(reqTrials) ? Math.ceil(reqTrials / Math.max(0.05, share)) : Infinity;

    for (const b of [st.bankerTier, st.attackerTier]) {
      const deals = toDeals(requiredMatchesForSignificance(b.a, b.b, b.draw, b.n, stepDeals, maxDeals));
      if (!Number.isFinite(deals)) unreachable ||= `等级 ${level} 的档位 p̂ 未过半`;
      worst = Math.max(worst, Number.isFinite(deals) ? deals : maxDeals + 1);
    }
    for (const b of [st.bankerPts, st.attackerPts]) {
      const deals = toDeals(requiredNPaired(b, Z, stepDeals));
      if (!Number.isFinite(deals)) unreachable ||= `等级 ${level} 的分差均值未偏出 0`;
      worst = Math.max(worst, Number.isFinite(deals) ? deals : maxDeals + 1);
    }
  }
  const rounded = Math.ceil(worst / stepDeals) * stepDeals;
  if (rounded > maxDeals) {
    return { target: maxDeals, why: `${unreachable || '按当前读数推算所需发牌数超过上限'}，按上限计` };
  }
  if (rounded <= acc.keptDeals) return { target: acc.keptDeals, why: '推算不再增长' };
  return { target: rounded, why: `按当前读数推算显著所需（向上取整到 ${stepDeals} 的倍数）` };
}

/**
 * 「最新达到或改变显著」的那项指标；与上次相比无变化时给出当前汇总。
 * 显著性可能因样本增加而改变（区间收窄），故两个方向都算变化。
 */
export function latestChange(inds: readonly Indicator[], state: SoloLadderState): string {
  // 第一次检查没有「上一次」可比 —— 空表直接铺底，否则每项都会被判成「改变」。
  const first = state.prevSig.size === 0;
  const changed = first
    ? []
    : inds.filter(i => i.n > 0 && state.prevSig.get(i.key) !== i.sigLeader);
  state.prevSig = new Map(inds.map(i => [i.key, i.sigLeader]));
  const active = inds.filter(i => i.n > 0);
  if (changed.length > 0) {
    const last = changed[changed.length - 1];
    return last.sigLeader === null
      ? `${indicatorLabel(last)} 转为不显著`
      : `${indicatorLabel(last)} 显著 ${last.sigLeader} 领先`;
  }
  const sig = active.filter(i => i.sigLeader !== null).length;
  return `尚无新变化（${sig}/${active.length} 项显著）`;
}

/**
 * 样本阶梯主循环：跑到目标 → 全显著即停 / 达标未显著则按当前读数推算并上调目标。
 * 每次显著性检查（每 stepDeals 副）都判停，不等跑满当前目标
 * （目标可能已被上调到上限，过线后仍会一路跑到上限）。
 */
export async function runSoloLadder(
  args: SoloLadderArgs,
  state: SoloLadderState,
  deps: SoloLadderDeps,
): Promise<void> {
  const { lines } = deps;
  let nextDeal = 0;
  let nextProgress = BATCH_DEALS;
  let nextSignificance = args.stepDeals;
  // --until-significant 无最小样本，进度基准先按第一次检查（stepDeals）计
  state.target = args.untilSignificant ? args.stepDeals : args.minDeals;

  for (;;) {
    while (state.acc.keptDeals < state.target && !state.interrupted) {
      // Aim for the next progress mark; a batch may overshoot slightly when the
      // filter/abort share differs from the estimate.
      const aim = Math.min(nextProgress, state.target);
      const attempts = estimateAttempts(Math.max(1, aim - state.acc.keptDeals), state.acc);
      const W = args.workers;
      const chunk = Math.ceil(attempts / W);
      const tasks: Promise<SoloStats>[] = [];
      for (let i = 0; i < W; i++) {
        const start = nextDeal + i * chunk;
        const count = Math.min(chunk, attempts - i * chunk);
        if (count <= 0) break;
        tasks.push(deps.runBatch(start, count));
      }
      const results = await Promise.all(tasks);
      for (const r of results) state.acc = mergeSoloStats(state.acc, r);
      nextDeal += attempts;
      // 让出一个宏任务：--workers 1 时整批是同步算完的（Promise 早已 resolve，await 只
      // 排空微任务），libuv 没有机会把 SIGINT/SIGTERM 投递给 JS 处理器——实测信号被
      // 默认动作直接杀掉，部分结果全丢。setImmediate 排到下一轮事件循环，信号才进得来。
      await new Promise<void>(resolve => setImmediate(resolve));

      if (state.acc.keptDeals < nextProgress) continue;
      nextProgress += BATCH_DEALS;

      const elapsedMs = deps.elapsedMs();
      const eta = formatDuration(estimateRemaining(elapsedMs, state.acc.keptDeals, state.target));
      const progress = `有效发牌 ${state.acc.keptDeals} 副 | 进度 ${((state.acc.keptDeals / state.target) * 100).toFixed(1)}% `
        + `| 已用 ${formatDuration(elapsedMs)} | 预计剩余 ${eta} | 目标 ${state.target} 副`;

      if (state.acc.keptDeals < nextSignificance) {
        lines.progress(progress); // 原地覆盖上一行
        continue;
      }
      nextSignificance += args.stepDeals;
      const inds = enumerateIndicators(state.acc);
      const active = inds.filter(i => i.n > 0);
      const sig = active.filter(i => i.sigLeader !== null).length;
      const status = active.length === 0
        ? '无有效指标'
        : sig === active.length
          ? (state.acc.keptDeals >= args.minDeals ? '★ 全部显著' : '★ 全部显著（未达最小样本，继续）')
          : `${sig}/${active.length} 项显著`;
      // 显著性行：覆盖当前进度行后保留，输出最新达到/改变显著的那项指标
      lines.sticky(`${progress} | ${status} | 最新: ${latestChange(inds, state)}`);
      // 全显著即停：目标可能已被推算上调到上限，不能等到跑满目标才检查
      if (shouldStopAfterCheck(state.acc, args.minDeals)) break;
    }

    if (state.interrupted) break;
    if (shouldStopAfterCheck(state.acc, args.minDeals)) break;
    if (state.target >= args.maxDeals) break;
    const proj = projectTarget(state.acc, args.stepDeals, args.maxDeals);
    if (proj.target <= state.target) break; // 推算不再增长，别空转
    const active = activeIndicators(state.acc);
    lines.sticky(`尚未全部显著（${active.filter(i => i.sigLeader !== null).length}/${active.length} 项）`
      + `，目标调整: ${state.target} → ${proj.target} 副（${proj.why}）`);
    state.target = proj.target;
    // Re-anchor the marks so the longer run keeps its own cadence.
    nextProgress = Math.max(nextProgress, (Math.floor(state.acc.keptDeals / BATCH_DEALS) + 1) * BATCH_DEALS);
    nextSignificance = Math.max(nextSignificance, (Math.floor(state.acc.keptDeals / args.stepDeals) + 1) * args.stepDeals);
  }
}
