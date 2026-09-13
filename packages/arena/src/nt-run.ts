/**
 * 无主（NT）竞技场 CLI.
 *
 *   npm run arena:nt -w packages/arena -- --seed 42 --workers 4
 *
 * 只打无主小局：过滤掉四家都没有对王的发牌，每副牌按 4 个庄家 × 13 个等级
 * 打 52 小局（A 坐 0/2 号位、B 坐 1/3 号位，四个庄家轮转即镜像）。没有整场
 * 概念，指标按小局统计。
 *
 * 显著性以「发牌」为单位检验：一副牌里 A 赢的小局多则这副算 A 胜，26-26 算平。
 * 同一副牌的 52 小局共用一副牌、彼此相关，所以独立单位是发牌而不是小局。
 *
 * 样本阶梯：跑到发牌数 ≥ --min-deals（默认 2500 副）后看总胜率的 99% 显著性，
 * 不显著就按 --step-deals（默认 250 副）加码，直到显著或触到 --max-deals（默认 10000 副）。
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
import { checkSignificance } from './significance.js';
import type { SignificanceResult } from './significance.js';
import { formatNTReport } from './nt-report.js';
import { formatDuration, estimateRemaining } from './progress.js';

const OUT_DIR = path.join(ARENA_ROOT, 'results');

/** 每批发牌数（进度行节奏）。 */
const BATCH_DEALS = 25;
/** 每这么多副额外打印一次带胜率与显著性的进度行。 */
const SIGNIFICANCE_DEALS = 250;

interface Args {
  seed: number;
  workers: number;
  strategyA: string;
  strategyB: string;
  minDeals: number;
  stepDeals: number;
  maxDeals: number;
  out?: string;
}

function printUsage(): void {
  console.log(`
无主（NT）竞技场 —— 只打无主小局，按 4 庄家 × 13 等级镜像对打

用法: npm run arena:nt -- [选项]

选项:
  --seed N           随机种子（确定性），默认随机
  --workers N        子进程数，默认 min(8, CPU 核数)
  --strategy-a NAME  策略 A（坐 0/2 号位），默认 ai（当前策略）
  --strategy-b NAME  策略 B（坐 1/3 号位），默认 ai-0816
  --min-deals N      起跑发牌数下限（单位：副），默认 2500
  --step-deals N     不显著时每次加码的发牌数（单位：副），默认 250
  --max-deals N      发牌数上限（单位：副），默认 10000
  --out PATH         结果 JSON 输出路径，默认 results/nt-arena-<时间>.json

每副牌产出 52 小局（4 庄家 × 13 等级）；无对王的发牌被过滤，不计入发牌数。
显著性以「发牌」为单位检验（一副牌里 A 赢的小局多则算 A 胜）。
`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    seed: (Math.random() * 2 ** 31) >>> 0,
    workers: Math.max(1, Math.min(8, os.cpus().length)),
    strategyA: 'ai',
    strategyB: 'ai-0816',
    minDeals: 2500,
    stepDeals: 250,
    maxDeals: 10000,
  };
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
      case '--min-deals': args.minDeals = parseInt(val(i, a), 10); i++; break;
      case '--step-deals': args.stepDeals = parseInt(val(i, a), 10); i++; break;
      case '--max-deals': args.maxDeals = parseInt(val(i, a), 10); i++; break;
      case '--out': args.out = val(i, a); i++; break;
      case '-h': case '--help': printUsage(); process.exit(0); break;
      default: throw new Error(`未知参数: ${a}（--help 查看用法）`);
    }
  }
  if (args.workers < 1) throw new Error('--workers 必须 ≥ 1');
  if (args.minDeals < BATCH_DEALS) throw new Error(`--min-deals 必须 ≥ ${BATCH_DEALS}`);
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

  process.on('SIGINT', () => { ChildPool.killAll(); process.exit(130); });

  console.log(`无主（NT）竞技场  seed=${args.seed}`);
  console.log(`A: ${args.strategyA}（0/2 号位）  B: ${args.strategyB}（1/3 号位）  workers=${args.workers}`);
  console.log(`样本阶梯: ${args.minDeals} → ${args.maxDeals} 副（发牌数），不显著每次 +${args.stepDeals}\n`);

  const pool = args.workers > 1
    ? await ChildPool.create(args.workers, 'nt-child-run.ts', [String(args.seed), args.strategyA, args.strategyB])
    : null;

  const t0 = Date.now();
  let acc = createNTStats();
  let target = args.minDeals;
  let nextDeal = 0;
  let outcome = dealOutcome(acc);
  let nextProgress = BATCH_DEALS;
  let nextSignificance = SIGNIFICANCE_DEALS;

  try {
    for (;;) {
      while (acc.deals < target) {
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
          console.log(progress);
          continue;
        }
        nextSignificance += SIGNIFICANCE_DEALS;
        outcome = dealOutcome(acc);
        const reachedMin = acc.deals >= args.minDeals;
        const status = outcome.significant
          ? (reachedMin ? '★ 显著' : '★ 显著（未达最小样本，继续）')
          : '未显著，继续';
        console.log(
          `${progress} | leader=${outcome.leader ?? '—'} p̂=${outcome.pHat.toFixed(4)} `
          + `| 99% CI 下界=${outcome.ciLower.toFixed(4)} | ${status}`,
        );
      }

      outcome = dealOutcome(acc);
      if (outcome.significant || target >= args.maxDeals) break;
      const next = Math.min(target + args.stepDeals, args.maxDeals);
      console.log(`总胜率尚未显著（p̂=${outcome.pHat.toFixed(4)}，99% CI 下界=${outcome.ciLower.toFixed(4)}），目标上调 ${target} → ${next} 副`);
      target = next;
      // Re-anchor the marks so the longer run keeps its own cadence.
      nextProgress = Math.max(nextProgress, (Math.floor(acc.deals / BATCH_DEALS) + 1) * BATCH_DEALS);
      nextSignificance = Math.max(nextSignificance, (Math.floor(acc.deals / SIGNIFICANCE_DEALS) + 1) * SIGNIFICANCE_DEALS);
    }
  } finally {
    pool?.close();
  }

  const elapsedMs = Date.now() - t0;
  const verdict = verdictOf(acc, args.strategyA, args.strategyB);
  console.log(formatNTReport({
    nameA: args.strategyA, nameB: args.strategyB,
    seed: args.seed, elapsedMs, targetDeals: target,
    outcome, verdict, stats: acc,
  }));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = args.out ?? path.join(OUT_DIR, `nt-arena-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    meta: {
      seed: args.seed, strategyA: args.strategyA, strategyB: args.strategyB,
      workers: args.workers, targetDeals: target, elapsedMs,
      createdAt: new Date().toISOString(),
    },
    outcome: {
      leader: outcome.leader, significant: outcome.significant, pHat: outcome.pHat,
      ciLower: outcome.ciLower, n: outcome.n,
    },
    stats: ntStatsToJSON(acc),
  }, null, 2), 'utf-8');
  console.log(`\n📄 JSON 已导出: ${outPath}`);
}

main().catch(e => { console.error(e); ChildPool.killAll(); process.exit(1); });
