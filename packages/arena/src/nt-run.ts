/**
 * 无主（NT）竞技场 CLI.
 *
 *   npm run arena:nt -w packages/arena -- --seed 42 --workers 4
 *
 * 只打无主小局：过滤掉四家都没有对王的发牌，每副牌按 4 个庄家 × 13 个等级
 * 打 52 小局，再**策略对调重打一遍**（A 一半小局坐 0/2 号位、一半坐 1/3 号位，
 * 同一副牌）——两轮合起来 104 小局即镜像：0/2 号位每墩第 1、3 个出牌，1/3 号位
 * 第 2、4 个，位置差在两轮里对消。没有整场概念，指标按小局统计。
 *
 * 显著性以「发牌」为单位检验：一副牌里 A 赢的小局多则这副算 A 胜，52-52 算平。
 * 同一副牌的 104 小局共用一副牌、彼此相关，所以独立单位是发牌而不是小局。
 *
 * 样本阶梯：跑到发牌数 ≥ --min-deals（默认 2000 副）后看总胜率的 99% 显著性，
 * 不显著就按当前胜率推算显著所需发牌数上调目标（--step-deals 为取整粒度），
 * 直到显著或触到 --max-deals（默认 10000 副）。
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { strategyByName } from './strategies.js';
import { ChildPool, ARENA_ROOT } from './child-pool.js';
import {
  createNTStats, mergeNTStats, runNTDeals,
  ntStatsToJSON, ntStatsFromJSON,
} from './nt-arena.js';
import type { NTStats } from './nt-arena.js';
import { checkSignificance, requiredMatchesForSignificance } from './significance.js';
import type { SignificanceResult } from './significance.js';
import { printNTReport } from './nt-report.js';
import { formatDuration, estimateRemaining, ProgressLines } from './progress.js';

const OUT_DIR = path.join(ARENA_ROOT, 'results');

/** 非 TTY（重定向到文件/管道）时进度行逐行打印、表格不染色。 */
const STDOUT_TTY = process.stdout.isTTY === true;

const lines = new ProgressLines(STDOUT_TTY, {
  write: (s): void => { process.stdout.write(s); },
  log: (s): void => { console.log(s); },
});

/** 每批发牌数（进度行节奏）。 */
const BATCH_DEALS = 25;

interface Args {
  seed: number;
  workers: number;
  strategyA: string;
  strategyB: string;
  minDeals: number;
  stepDeals: number;
  maxDeals: number;
  out?: string;
  noJson: boolean;
  untilSignificant: boolean;
}

function printUsage(): void {
  console.log(`
无主（NT）竞技场 —— 只打无主小局，按 4 庄家 × 13 等级 × 2 种座位分配镜像对打

用法: npm run arena:nt -- [选项]

选项:
  --seed N           随机种子（确定性），默认随机
  --workers N        子进程数，默认 min(8, CPU 核数)
  --strategy-a NAME  策略 A，默认 ai（当前策略）
  --strategy-b NAME  策略 B，默认 ai-0929
  --min-deals N      起跑发牌数下限（单位：副），默认 2000
  --until-significant 不设最小样本：任一次检查显著即停（与 --min-deals 互斥）
  --step-deals N     显著性检查的间隔与目标取整粒度（单位：副），默认 200
  --max-deals N      发牌数上限（单位：副），默认 10000
  --out PATH         结果 JSON 输出路径，默认 results/nt-arena-<时间>.json
  --no-json          不导出 JSON

每副牌产出 104 小局（4 庄家 × 13 等级 × 2 种座位分配，A 各坐一半）；无对王的
发牌被过滤，不计入发牌数。显著性以「发牌」为单位检验（一副牌里 A 赢的小局多
则算 A 胜）。
达标未显著时按当前胜率推算显著所需发牌数并上调目标（与整体竞技场同口径）；
Ctrl+C 保存部分结果后优雅退出。`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    seed: (Math.random() * 2 ** 31) >>> 0,
    workers: Math.max(1, Math.min(8, os.cpus().length)),
    strategyA: 'ai',
    strategyB: 'ai-0929',
    minDeals: 2000,
    stepDeals: 200,
    maxDeals: 10000,
    noJson: false,
    untilSignificant: false,
  };
  let minDealsGiven = false;
  const val = (i: number, name: string): string => {
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`${name} 需要一个参数`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--seed': args.seed = parseInt(val(i, a), 10) >>> 0; i++; break;
      case '--workers': args.workers = parseInt(val(i, a), 10); i++; break;
      case '--strategy-a': args.strategyA = val(i, a); i++; break;
      case '--strategy-b': args.strategyB = val(i, a); i++; break;
      case '--min-deals': args.minDeals = parseInt(val(i, a), 10); minDealsGiven = true; i++; break;
      case '--until-significant': args.untilSignificant = true; break;
      case '--step-deals': args.stepDeals = parseInt(val(i, a), 10); i++; break;
      case '--max-deals': args.maxDeals = parseInt(val(i, a), 10); i++; break;
      case '--out': args.out = val(i, a); i++; break;
      case '--no-json': args.noJson = true; break;
      case '-h': case '--help': printUsage(); process.exit(0); break;
      default: throw new Error(`未知参数: ${a}（--help 查看用法）`);
    }
  }
  if (args.workers < 1) throw new Error('--workers 必须 ≥ 1');
  if (args.untilSignificant) {
    if (minDealsGiven) throw new Error('--until-significant 不设最小样本，不能再给 --min-deals');
    args.minDeals = 0; // 最小样本 0：任一次检查显著即停
  } else if (args.minDeals < BATCH_DEALS) {
    throw new Error(`--min-deals 必须 ≥ ${BATCH_DEALS}`);
  }
  if (args.stepDeals < 1) throw new Error('--step-deals 必须 ≥ 1');
  if (args.maxDeals < args.minDeals) throw new Error('--max-deals 必须 ≥ --min-deals');
  return args;
}

/** How many deals to attempt to gain roughly `needDeals` kept ones. */
function estimateAttempts(needDeals: number, acc: NTStats): number {
  const seen = acc.deals + acc.skippedDeals;
  const passRate = seen > 0 ? acc.deals / seen : 0.4;
  return Math.max(1, Math.ceil(needDeals / Math.max(0.05, passRate)));
}

/** 发牌数为单位的胜负（一副牌里 A 赢的小局多则算 A 胜）。 */
function dealOutcome(acc: NTStats): SignificanceResult {
  const n = acc.dealsWonA + acc.dealsWonB + acc.dealsDrawn;
  return checkSignificance(acc.dealsWonA, acc.dealsWonB, acc.dealsDrawn, n);
}

function verdictOf(acc: NTStats, nameA: string, nameB: string): string {
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
function projectTarget(acc: NTStats, stepDeals: number, maxDeals: number): { target: number; why: string } {
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

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`❌ ${(e as Error).message}`);
    process.exit(1);
    return;
  }

  const stratA = strategyByName(args.strategyA);
  const stratB = strategyByName(args.strategyB);

  console.log(`无主（NT）竞技场  seed=${args.seed}`);
  console.log(`A: ${args.strategyA}  B: ${args.strategyB}  workers=${args.workers}`);
  console.log(args.untilSignificant
    ? `样本阶梯: 不设最小样本，任一次检查显著即停；上限 ${args.maxDeals} 副\n`
    : `样本阶梯: ${args.minDeals} 副起，之后按当前胜率推算显著所需，上限 ${args.maxDeals} 副\n`);

  const pool = args.workers > 1
    ? await ChildPool.create(
        args.workers, 'nt-child-run.ts',
        [String(args.seed), args.strategyA, args.strategyB],
        { describeTask: t => `发牌 ${t.dealStart}..${t.dealStart + t.dealCount - 1}` },
      )
    : null;

  const t0 = Date.now();
  let acc = createNTStats();
  // --until-significant 无最小样本，进度基准先按第一次检查（stepDeals）计
  let target = args.untilSignificant ? args.stepDeals : args.minDeals;
  let nextDeal = 0;
  let outcome = dealOutcome(acc);
  let verdict = verdictOf(acc, args.strategyA, args.strategyB);
  let nextProgress = BATCH_DEALS;
  let nextSignificance = args.stepDeals;
  let interrupted = false;

  /** 导出结果 JSON；partial=true 表示中断时的部分结果。 */
  const writeJson = (partial: boolean): void => {
    if (args.noJson) return;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outPath = args.out || path.join(OUT_DIR, `nt-arena-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
      meta: {
        seed: args.seed, strategyA: args.strategyA, strategyB: args.strategyB,
        workers: args.workers, minDeals: args.minDeals, targetDeals: target,
        untilSignificant: args.untilSignificant, elapsedMs: Date.now() - t0,
        createdAt: new Date().toISOString(), partial,
      },
      outcome: {
        verdict, leader: outcome.leader, significant: outcome.significant, pHat: outcome.pHat,
        ciLower: outcome.ciLower, n: outcome.n,
      },
      stats: ntStatsToJSON(acc),
    }, null, 2), 'utf-8');
    console.log(`\n📄 JSON 已导出: ${outPath}`);
  };

  // SIGINT 优雅退出：先写部分报告 + JSON，再退出，不丢数据（与整体竞技场同口径）
  const onInterrupt = (): void => {
    if (interrupted) return;
    interrupted = true;
    lines.endLine();
    console.log('⏹ 收到中断信号，保存部分结果…');
    outcome = dealOutcome(acc);
    verdict = '已中止（SIGINT，部分结果）';
    printNTReport({
      nameA: args.strategyA, nameB: args.strategyB,
      seed: args.seed, elapsedMs: Date.now() - t0, targetDeals: target,
      outcome, verdict, stats: acc, color: STDOUT_TTY,
    });
    writeJson(true);
    ChildPool.killAll();
    process.exit(130);
  };
  process.on('SIGINT', onInterrupt);

  try {
    for (;;) {
      while (acc.deals < target && !interrupted) {
        // Aim for the next progress mark; the batch may overshoot slightly
        // because the joker-pair filter drops an unknown share of attempts.
        const aim = Math.min(nextProgress, target);
        const attempts = estimateAttempts(Math.max(1, aim - acc.deals), acc);
        const W = pool ? args.workers : 1;
        const chunk = Math.ceil(attempts / W);
        const tasks: Promise<Record<string, any>>[] = [];
        for (let i = 0; i < W; i++) {
          const start = nextDeal + i * chunk;
          const count = Math.min(chunk, attempts - i * chunk);
          if (count <= 0) break;
          tasks.push(pool
            ? pool.submit({ dealStart: start, dealCount: count })
                .then(m => m.stats as Record<string, any>)
            : Promise.resolve(ntStatsToJSON(runNTDeals(args.seed, start, count, stratA, stratB))));
        }
        const results = await Promise.all(tasks);
        for (const r of results) acc = mergeNTStats(acc, ntStatsFromJSON(r));
        nextDeal += attempts;

        if (acc.deals < nextProgress) continue;
        nextProgress += BATCH_DEALS;

        const elapsedMs = Date.now() - t0;
        const eta = formatDuration(estimateRemaining(elapsedMs, acc.deals, target));
        const progress = `已完赛 ${acc.deals} 副 | 进度 ${((acc.deals / target) * 100).toFixed(1)}% `
          + `| 已用 ${formatDuration(elapsedMs)} | 预计剩余 ${eta} | 目标 ${target} 副`;

        if (acc.deals < nextSignificance) {
          lines.progress(progress); // 原地覆盖上一行
          continue;
        }
        nextSignificance += args.stepDeals;
        outcome = dealOutcome(acc);
        const status = outcome.significant
          ? (acc.deals >= args.minDeals ? '★ 显著' : '★ 显著（未达最小样本，继续）')
          : '未显著，继续';
        // 显著性行：覆盖当前进度行后保留，直到下一处显著性结果刷新
        lines.sticky(
          `${progress} | leader=${outcome.leader ?? '—'} p̂=${outcome.pHat.toFixed(4)} `
          + `| 99% CI 下界=${outcome.ciLower.toFixed(4)} | ${status}`,
        );
      }

      // 到达当前目标：显著即停；否则按当前胜率推算显著所需并上调目标
      outcome = dealOutcome(acc);
      if (outcome.significant && acc.deals >= args.minDeals) break;
      if (target >= args.maxDeals) break;
      const proj = projectTarget(acc, args.stepDeals, args.maxDeals);
      if (proj.target <= target) break; // 推算不再增长（理论上到不了），别空转
      lines.sticky(
        `总胜率尚未显著（p̂=${outcome.pHat.toFixed(4)}，99% CI 下界=${outcome.ciLower.toFixed(4)}）`
        + `，目标调整: ${target} → ${proj.target} 副（${proj.why}）`,
      );
      target = proj.target;
      // Re-anchor the marks so the longer run keeps its own cadence.
      nextProgress = Math.max(nextProgress, (Math.floor(acc.deals / BATCH_DEALS) + 1) * BATCH_DEALS);
      nextSignificance = Math.max(nextSignificance, (Math.floor(acc.deals / args.stepDeals) + 1) * args.stepDeals);
    }
  } finally {
    pool?.close();
  }

  const elapsedMs = Date.now() - t0;
  verdict = verdictOf(acc, args.strategyA, args.strategyB);
  lines.endLine(); // 先与原地进度行断开
  printNTReport({
    nameA: args.strategyA, nameB: args.strategyB,
    seed: args.seed, elapsedMs, targetDeals: target,
    outcome, verdict, stats: acc, color: STDOUT_TTY,
  });
  writeJson(false);
}

main().catch(e => { console.error(e); ChildPool.killAll(); process.exit(1); });
