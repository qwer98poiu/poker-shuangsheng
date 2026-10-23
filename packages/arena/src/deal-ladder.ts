/**
 * Deal 竞技场的样本阶梯（主循环）。
 *
 * 与 CLI 分离：`deal-run.ts` 在模块加载时执行 `main()`，测试 import 它会直接跑 CLI；
 * 这里只放与进程/IO 无关的循环逻辑，批量跑牌、时钟、输出经 `deps` 注入。
 *
 * 统计单位 = 发牌。每 `--step-deals` 副（有效发牌）检查一次发牌口径的显著性；
 * 显著且达到最小样本即停；未显著则按当前 p̂ 推算所需发牌数并上调目标。
 */
import { mergeDealStats } from './deal-arena.js';
import type { DealStats } from './deal-arena.js';
import { checkSignificance, requiredMatchesForSignificance } from './significance.js';
import type { SignificanceResult } from './significance.js';
import { formatDuration, estimateRemaining } from './progress.js';
import type { ProgressLines } from './progress.js';

/** 进度行节奏（有效发牌数）。 */
export const BATCH_DEALS = 25;

export interface DealLadderArgs {
  workers: number;
  minDeals: number;
  stepDeals: number;
  maxDeals: number;
  untilSignificant: boolean;
  /** 过滤器通过率先验；只在还没有样本时用。 */
  priorPassRate: number;
}

/** 阶梯的可变状态：CLI 的中断处理与结果输出在循环外读它。 */
export interface DealLadderState {
  acc: DealStats;
  outcome: SignificanceResult;
  /** 当前目标有效发牌数（达标未显著时被推算上调）。 */
  target: number;
  interrupted: boolean;
}

export interface DealLadderDeps {
  /** 跑 [dealStart, dealStart+dealCount) 副，返回该批统计（由循环 merge）。 */
  runBatch(dealStart: number, dealCount: number): Promise<DealStats>;
  /** 自运行开始的毫秒数（测试注入假时钟）。 */
  elapsedMs(): number;
  /** 进度行与显著性行的输出端。 */
  lines: ProgressLines;
}

/** 过滤器通过率先验：无过滤器 100%，长花色约 50%。 */
export function defaultPriorPassRate(dealFilters: readonly string[]): number {
  return dealFilters.length > 0 ? 0.5 : 1;
}

/** 为拿到 needAccepted 副有效发牌，需要尝试多少副（按当前通过率外推）。 */
export function estimateAttempts(needAccepted: number, acc: DealStats, priorPassRate: number): number {
  const observed = acc.attemptedDeals > 0 ? acc.acceptedDeals / acc.attemptedDeals : priorPassRate;
  return Math.max(1, Math.ceil(needAccepted / Math.max(0.05, observed)));
}

/** 发牌口径显著性：A 对多则 A 胜，B 对多则 B 胜，相等算平（平局折 0.5）。 */
export function dealOutcome(acc: DealStats): SignificanceResult {
  const b = acc.dealOutcome;
  return checkSignificance(b.a, b.b, b.draw, b.n);
}

export function verdictOf(acc: DealStats, nameA: string, nameB: string): string {
  const cmp = dealOutcome(acc);
  if (!cmp.leader) return '双方胜率持平';
  const who = cmp.leader === 'A' ? nameA : nameB;
  if (!cmp.significant) return `${cmp.leader}（${who}）领先但未达显著`;
  return `${cmp.leader}（${who}）显著优于对方`;
}

/**
 * 按当前胜率推算显著所需有效发牌数（动态目标，与整体竞技场同一函数同一口径）。
 * 中止局已结算，不再有「作废」折算；p̂ ≤ 0.5 或推算值超过上限时取上限。
 */
export function projectTarget(
  acc: DealStats,
  stepDeals: number,
  maxDeals: number,
): { target: number; why: string } {
  const n = acc.dealOutcome.n;
  if (n === 0) return { target: maxDeals, why: '尚无有效发牌，按上限计' };
  const required = requiredMatchesForSignificance(
    acc.dealOutcome.a, acc.dealOutcome.b, acc.dealOutcome.draw, n, stepDeals, maxDeals,
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

/** 每次显著性检查后是否立即停止：已满最小样本且显著。 */
export function shouldStopAfterCheck(
  outcome: SignificanceResult,
  acc: DealStats,
  minDeals: number,
): boolean {
  return outcome.significant && acc.acceptedDeals >= minDeals;
}

/** 安全上限：即使通过率低到 5%，也不让尝试数无限增长。 */
function attemptCap(maxDeals: number): number {
  return Math.ceil(maxDeals / 0.05);
}

/**
 * 样本阶梯主循环：跑到目标 → 显著即停 / 达标未显著则按当前胜率推算并上调目标。
 * 每次显著性检查（每 stepDeals 副）都判停，不等跑满当前目标。
 */
export async function runDealLadder(
  args: DealLadderArgs,
  state: DealLadderState,
  deps: DealLadderDeps,
): Promise<void> {
  const { lines } = deps;
  let nextDeal = 0;
  let nextProgress = BATCH_DEALS;
  let nextSignificance = args.stepDeals;
  const cap = attemptCap(args.maxDeals);
  // --until-significant 无最小样本，进度基准先按第一次检查（stepDeals）计
  state.target = args.untilSignificant ? args.stepDeals : args.minDeals;

  for (;;) {
    while (state.acc.acceptedDeals < state.target && !state.interrupted) {
      if (nextDeal >= cap) {
        lines.sticky(`有效发牌 ${state.acc.acceptedDeals} 副后停止：已尝试 ${nextDeal} 副，达到尝试上限 ${cap}（过滤器通过率过低）`);
        return;
      }
      const aim = Math.min(nextProgress, state.target);
      const attempts = estimateAttempts(
        Math.max(1, aim - state.acc.acceptedDeals), state.acc, args.priorPassRate,
      );
      const W = args.workers;
      const chunk = Math.ceil(attempts / W);
      const tasks: Promise<DealStats>[] = [];
      for (let i = 0; i < W; i++) {
        const start = nextDeal + i * chunk;
        const count = Math.min(chunk, attempts - i * chunk);
        if (count <= 0) break;
        tasks.push(deps.runBatch(start, count));
      }
      const results = await Promise.all(tasks);
      for (const r of results) state.acc = mergeDealStats(state.acc, r);
      nextDeal += attempts;
      // 让出一个宏任务，让 --workers 1 时也能收到 SIGINT。
      await new Promise<void>(resolve => setImmediate(resolve));

      if (state.acc.acceptedDeals < nextProgress) continue;
      nextProgress += BATCH_DEALS;

      const elapsedMs = deps.elapsedMs();
      const eta = formatDuration(estimateRemaining(elapsedMs, state.acc.acceptedDeals, state.target));
      const abortNote = state.acc.abortedHands > 0
        ? `（已中止 ${state.acc.abortedHands} 小局）`
        : '';
      const progress = `有效发牌 ${state.acc.acceptedDeals} 副${abortNote}`
        + ` | 进度 ${((state.acc.acceptedDeals / state.target) * 100).toFixed(1)}%`
        + ` | 已用 ${formatDuration(elapsedMs)} | 预计剩余 ${eta} | 目标 ${state.target} 副`;

      if (state.acc.acceptedDeals < nextSignificance) {
        lines.progress(progress);
        continue;
      }
      nextSignificance += args.stepDeals;
      state.outcome = dealOutcome(state.acc);
      const status = state.outcome.significant
        ? (state.acc.acceptedDeals >= args.minDeals ? '★ 显著' : '★ 显著（未达最小样本，继续）')
        : '未显著，继续';
      lines.sticky(
        `${progress} | leader=${state.outcome.leader ?? '—'} p̂=${state.outcome.pHat.toFixed(4)} `
        + `| 99% CI 下界=${state.outcome.ciLower.toFixed(4)} | ${status}`,
      );
      if (shouldStopAfterCheck(state.outcome, state.acc, args.minDeals)) break;
    }

    if (state.interrupted) break;
    state.outcome = dealOutcome(state.acc);
    if (shouldStopAfterCheck(state.outcome, state.acc, args.minDeals)) break;
    if (state.target >= args.maxDeals) break;
    const proj = projectTarget(state.acc, args.stepDeals, args.maxDeals);
    if (proj.target <= state.target) break; // 推算不再增长，别空转
    lines.sticky(
      `总胜率尚未显著（p̂=${state.outcome.pHat.toFixed(4)}，99% CI 下界=${state.outcome.ciLower.toFixed(4)}）`
      + `，目标调整: ${state.target} → ${proj.target} 副（${proj.why}）`,
    );
    state.target = proj.target;
    nextProgress = Math.max(nextProgress, (Math.floor(state.acc.acceptedDeals / BATCH_DEALS) + 1) * BATCH_DEALS);
    nextSignificance = Math.max(nextSignificance, (Math.floor(state.acc.acceptedDeals / args.stepDeals) + 1) * args.stepDeals);
  }
}
