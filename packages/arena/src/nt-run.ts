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
 * 胜负按**配对升级**：同一 (等级, 庄家座位) 的两场镜像配成一对，比两场闲家分的升级量
 * （`tierOf`）——A 队当闲那场更高记 a、B 队当闲那场更高记 b、相同记平。显著性以「发牌」
 * 为单位检验：一副牌里 a 对多则这副算 A 胜，a 与 b 相等算平。同一副牌的 104 小局共用
 * 一副牌、彼此相关，所以独立单位是发牌而不是小局。
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
import { createNTStats, runNTDeals, ntStatsToJSON, ntStatsFromJSON } from './nt-arena.js';
import { printNTReport } from './nt-report.js';
import { ProgressLines } from './progress.js';
import { BATCH_DEALS, dealOutcome, runNTLadder, verdictOf } from './nt-ladder.js';
import type { NTLadderState } from './nt-ladder.js';

const OUT_DIR = path.join(ARENA_ROOT, 'results');

/** 非 TTY（重定向到文件/管道）时进度行逐行打印、表格不染色。 */
const STDOUT_TTY = process.stdout.isTTY === true;

const lines = new ProgressLines(STDOUT_TTY, {
  write: (s): void => { process.stdout.write(s); },
  log: (s): void => { console.log(s); },
});

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
发牌被过滤，不计入发牌数。胜负按配对升级：同一 (等级, 庄家座位) 的两场镜像配
成一对，比两场闲家分的升级量高低（A 队当闲那场更高 = A 更好）。显著性以「发牌」
为单位检验（一副牌里 A 队当闲那场升级量更高的配对多则算 A 胜）。
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
  const acc = createNTStats();
  const state: NTLadderState = {
    acc,
    outcome: dealOutcome(acc),
    target: 0, // runNTLadder 按 args 设定
    interrupted: false,
  };
  let verdict = verdictOf(state.acc, args.strategyA, args.strategyB);

  /** 导出结果 JSON；partial=true 表示中断时的部分结果。 */
  const writeJson = (partial: boolean): void => {
    if (args.noJson) return;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outPath = args.out || path.join(OUT_DIR, `nt-arena-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
      meta: {
        seed: args.seed, strategyA: args.strategyA, strategyB: args.strategyB,
        workers: args.workers, minDeals: args.minDeals, targetDeals: state.target,
        untilSignificant: args.untilSignificant, elapsedMs: Date.now() - t0,
        createdAt: new Date().toISOString(), partial,
      },
      outcome: {
        verdict, leader: state.outcome.leader, significant: state.outcome.significant,
        pHat: state.outcome.pHat, ciLower: state.outcome.ciLower, n: state.outcome.n,
      },
      stats: ntStatsToJSON(state.acc),
    }, null, 2), 'utf-8');
    console.log(`\n📄 JSON 已导出: ${outPath}`);
  };

  // SIGINT 优雅退出：先写部分报告 + JSON，再退出，不丢数据（与整体竞技场同口径）
  const onInterrupt = (): void => {
    if (state.interrupted) return;
    state.interrupted = true;
    lines.endLine();
    console.log('⏹ 收到中断信号，保存部分结果…');
    state.outcome = dealOutcome(state.acc);
    verdict = '已中止（SIGINT，部分结果）';
    printNTReport({
      nameA: args.strategyA, nameB: args.strategyB,
      seed: args.seed, elapsedMs: Date.now() - t0, targetDeals: state.target,
      outcome: state.outcome, verdict, stats: state.acc, color: STDOUT_TTY,
    });
    writeJson(true);
    ChildPool.killAll();
    process.exit(130);
  };
  process.on('SIGINT', onInterrupt);

  try {
    await runNTLadder(args, state, {
      runBatch: (dealStart, dealCount) => pool
        ? pool.submit({ dealStart, dealCount })
            .then(m => ntStatsFromJSON(m.stats as Record<string, any>))
        : Promise.resolve(runNTDeals(args.seed, dealStart, dealCount, stratA, stratB)),
      elapsedMs: () => Date.now() - t0,
      lines,
    });
  } finally {
    pool?.close();
  }

  const elapsedMs = Date.now() - t0;
  verdict = verdictOf(state.acc, args.strategyA, args.strategyB);
  lines.endLine(); // 先与原地进度行断开
  printNTReport({
    nameA: args.strategyA, nameB: args.strategyB,
    seed: args.seed, elapsedMs, targetDeals: state.target,
    outcome: state.outcome, verdict, stats: state.acc, color: STDOUT_TTY,
  });
  writeJson(false);
}

main().catch(e => { console.error(e); ChildPool.killAll(); process.exit(1); });
