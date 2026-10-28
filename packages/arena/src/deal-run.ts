/**
 * Deal 竞技场 CLI.
 *
 *   npm run arena:deal -w packages/arena -- --seed 42 --level 2,5,10,Q,K,A --workers 4
 *
 * 统计单位 = 发牌。每（副, 等级）按 `--declarer-seats` 坐庄（默认固定 P0；
 * `all` = 四庄位轮转），每个庄位打三腿 [A,B] / [B,A] / [B,B]（同一副牌、同一等级、同一庄位）：
 *   净升级 = tier 口径的总体/庄家/闲家差；得分差 = finalPts 口径的同三种差。
 *   每项再按 等级 × 主牌 × 角色 场景拆分（见 deal-report.ts）。
 * 每副牌按配对升级符号多数决出 A/B/平；显著性以发牌为单位（平局折 0.5）。
 *
 * `--deal-filter long-suit`：四家任一有副牌长套即保留，配置庄家按 33 张池
 * （25 手牌 + 8 底牌）判断。无主不再强制，按自然亮主（对王）分类。
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { strategyByName } from './strategies.js';
import { normalizeSeed, randomSeed } from './rng.js';
import { ChildPool, ARENA_ROOT } from './child-pool.js';
import { createDealStats, runDealDeals, dealStatsToJSON, dealStatsFromJSON, parseDeclarerSeats, DEFAULT_DECLARER_SEATS } from './deal-arena.js';
import type { DeclarerIdx } from './deal-arena.js';
import { printDealReport } from './deal-report.js';
import { ProgressLines } from './progress.js';
import { levelLabel } from './level-label.js';
import {
  BATCH_DEALS, defaultPriorPassRate, dealOutcome, runDealLadder, verdictOf,
} from './deal-ladder.js';
import type { DealLadderState } from './deal-ladder.js';
import {
  DEFAULT_LEVELS, availableFilterNames, parseLevels, resolveDealFilters,
} from './deal-filter.js';

const OUT_DIR = path.join(ARENA_ROOT, 'results');

/** 非 TTY（重定向到文件/管道）时进度行逐行打印、表格不染色。 */
const STDOUT_TTY = process.stdout.isTTY === true;

const lines = new ProgressLines(STDOUT_TTY, {
  write: (s): void => { process.stdout.write(s); },
  log: (s): void => { console.log(s); },
});

interface Args {
  /** 64 位 base seed 的规范形式（0x + 16 位十六进制）。 */
  seed: string;
  workers: number;
  strategyA: string;
  strategyB: string;
  levels: number[];
  declarerSeats: DeclarerIdx[];
  dealFilters: string[];
  minDeals: number;
  stepDeals: number;
  maxDeals: number;
  out?: string;
  noJson: boolean;
  untilSignificant: boolean;
}

function printUsage(): void {
  console.log(`
Deal 竞技场 —— 以发牌为单位，按 --declarer-seats 坐庄；每（副, 等级, 庄位）打三腿
[A,B] / [B,A] / [B,B]

用法: npm run arena:deal -- [选项]

选项:
  --seed SEED          64 位随机种子（十进制或 0x 十六进制），默认随机
  --level LIST         等级（逗号分隔），默认 ${DEFAULT_LEVELS.map(levelLabel).join(',')}；all = 2..A（13 档）
  --declarer-seats S   庄家座位：0 / 0,2 / all（四庄位轮转），默认 0（固定 P0）
  --deal-filter NAMES  发牌过滤器（逗号分隔，仓库内置），默认无
                       可选: ${availableFilterNames().join(', ') || '（无）'}
                       long-suit = 任一座位在该副的候选主牌下有副牌长套即保留
                       （候选庄家按 33 张池＝25＋底牌 8；主牌门不算）
  --strategy-a NAME    策略 A，默认 ai
  --strategy-b NAME    策略 B，默认 ai-1018
  --min-deals N        起跑有效发牌数下限，默认 2500
  --until-significant  不设最小样本：任一次检查显著即停（与 --min-deals 互斥）
  --step-deals N       显著性检查间隔与目标取整粒度（单位：副），默认 250
  --max-deals N        有效发牌数上限（单位：副），默认 10000
  --workers N          子进程数，默认 min(8, CPU 核数)；1 = 进程内
  --out PATH           结果 JSON 输出路径，默认 results/deal-arena-<时间>.json
  --no-json            不导出 JSON
  -h, --help           显示帮助

每副牌：庄位数 × 等级数 = 镜像对数；每对打 3 腿 = 3 × 庄位数 小局/等级。
默认固定 P0（每副 6 对 / 18 小局）；--declarer-seats all 为四庄位轮转（24 对 / 72 小局）。
核心净升级 = tier([B,A]) − tier([A,B])；每副按符号多数决 A/B/平，显著性以发牌为单位。
报告另按 等级 × 主牌 × 角色 拆分净升级与得分差；完整口径见 README。
中止小局按肇事方结算（不再作废）：庄家中止 → 闲家赢下当前墩和所有剩余墩；
闲家中止 → 按已完成墩的当前分结算。Ctrl+C 保存部分结果后退出。`);
}

function val(argv: string[], i: number, name: string): string {
  const v = argv[i + 1];
  if (v === undefined) throw new Error(`${name} 需要一个参数`);
  return v;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    seed: randomSeed(),
    workers: Math.max(1, Math.min(8, os.cpus().length)),
    strategyA: 'ai',
    strategyB: 'ai-1018',
    levels: [...DEFAULT_LEVELS],
    declarerSeats: [...DEFAULT_DECLARER_SEATS],
    dealFilters: [],
    minDeals: 2500,
    stepDeals: 250,
    maxDeals: 10000,
    noJson: false,
    untilSignificant: false,
  };
  let minDealsGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--seed': args.seed = normalizeSeed(val(argv, i, a)); i++; break;
      case '--workers': args.workers = parseInt(val(argv, i, a), 10); i++; break;
      case '--strategy-a': args.strategyA = val(argv, i, a); i++; break;
      case '--strategy-b': args.strategyB = val(argv, i, a); i++; break;
      case '--level': args.levels = parseLevels(val(argv, i, a)); i++; break;
      case '--declarer-seats': args.declarerSeats = parseDeclarerSeats(val(argv, i, a)); i++; break;
      case '--deal-filter': {
        const raw = val(argv, i, a);
        args.dealFilters = resolveDealFilters(raw.split(',').map(s => s.trim()).filter(Boolean));
        i++; break;
      }
      case '--min-deals': args.minDeals = parseInt(val(argv, i, a), 10); minDealsGiven = true; i++; break;
      case '--until-significant': args.untilSignificant = true; break;
      case '--step-deals': args.stepDeals = parseInt(val(argv, i, a), 10); i++; break;
      case '--max-deals': args.maxDeals = parseInt(val(argv, i, a), 10); i++; break;
      case '--out': args.out = val(argv, i, a); i++; break;
      case '--no-json': args.noJson = true; break;
      case '-h': case '--help': printUsage(); process.exit(0); break;
      default: throw new Error(`未知参数: ${a}（--help 查看用法）`);
    }
  }
  if (args.workers < 1) throw new Error('--workers 必须 ≥ 1');
  if (args.untilSignificant) {
    if (minDealsGiven) throw new Error('--until-significant 不设最小样本，不能再给 --min-deals');
    args.minDeals = 0;
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
  const levelsArg = args.levels.join(',');
  const levelsLabel = args.levels.map(levelLabel).join(',');
  const filtersArg = args.dealFilters.join(',');
  const priorPassRate = defaultPriorPassRate(args.dealFilters);

  const seatsLabel = args.declarerSeats.length === 1
    ? `固定 P${args.declarerSeats[0]}`
    : `轮转 ${args.declarerSeats.map(s => `P${s}`).join(',')}`;
  console.log(`Deal 竞技场  seed=${args.seed}`);
  console.log(`A: ${args.strategyA}  B: ${args.strategyB}  workers=${args.workers}`);
  console.log(`等级: ${levelsLabel}    庄位: ${seatsLabel}    发牌过滤器: ${filtersArg || '无'}`);
  console.log(args.untilSignificant
    ? `样本阶梯: 不设最小样本，任一次检查显著即停；上限 ${args.maxDeals} 副\n`
    : `样本阶梯: ${args.minDeals} 副起，之后按当前胜率推算显著所需，上限 ${args.maxDeals} 副\n`);

  const pool = args.workers > 1
    ? await ChildPool.create(
        args.workers, 'deal-child-run.ts',
        [
          String(args.seed), args.strategyA, args.strategyB, levelsArg,
          filtersArg, args.declarerSeats.join(','),
        ],
        { describeTask: t => `发牌 ${t.dealStart}..${t.dealStart + t.dealCount - 1}` },
      )
    : null;

  const t0 = Date.now();
  const acc = createDealStats(args.levels, args.declarerSeats);
  const state: DealLadderState = {
    acc,
    outcome: dealOutcome(acc),
    target: 0,
    interrupted: false,
  };
  let verdict = verdictOf(state.acc, args.strategyA, args.strategyB);

  /** 导出结果 JSON；partial=true 表示中断时的部分结果。 */
  const writeJson = (partial: boolean): void => {
    if (args.noJson) return;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outPath = args.out || path.join(OUT_DIR, `deal-arena-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
      meta: {
        seed: args.seed, strategyA: args.strategyA, strategyB: args.strategyB,
        levels: args.levels, declarerSeats: args.declarerSeats,
        workers: args.workers,
        dealFilters: args.dealFilters, minDeals: args.minDeals, stepDeals: args.stepDeals,
        maxDeals: args.maxDeals, targetDeals: state.target, priorPassRate,
        untilSignificant: args.untilSignificant, elapsedMs: Date.now() - t0,
        createdAt: new Date().toISOString(), partial,
      },
      outcome: {
        verdict, leader: state.outcome.leader, significant: state.outcome.significant,
        pHat: state.outcome.pHat, ciLower: state.outcome.ciLower, n: state.outcome.n,
      },
      stats: dealStatsToJSON(state.acc),
    }, null, 2), 'utf-8');
    console.log(`\n📄 JSON 已导出: ${outPath}`);
  };

  const printReport = (partial: boolean): void => {
    lines.endLine();
    printDealReport({
      nameA: args.strategyA, nameB: args.strategyB, seed: args.seed,
      elapsedMs: Date.now() - t0, levels: args.levels, declarerSeats: args.declarerSeats,
      dealFilters: args.dealFilters, targetDeals: state.target,
      outcome: state.outcome, stats: state.acc,
      verdict: partial ? `已中止（SIGINT，部分结果）；${verdictOf(state.acc, args.strategyA, args.strategyB)}` : verdict,
      color: STDOUT_TTY,
    });
  };

  // SIGINT 优雅退出：先打印部分报告 + JSON，再退出，不丢数据。
  const onInterrupt = (): void => {
    if (state.interrupted) return;
    state.interrupted = true;
    lines.endLine();
    console.log('⏹ 收到中断信号，保存部分结果…');
    state.outcome = dealOutcome(state.acc);
    printReport(true);
    writeJson(true);
    ChildPool.killAll();
    process.exit(130);
  };
  process.on('SIGINT', onInterrupt);

  try {
    await runDealLadder({ ...args, priorPassRate }, state, {
      runBatch: (dealStart, dealCount) => pool
        ? pool.submit({ dealStart, dealCount })
            .then(m => dealStatsFromJSON(m.stats as Record<string, any>))
        : Promise.resolve(runDealDeals(
            args.seed, dealStart, dealCount, args.levels, stratA, stratB, args.dealFilters,
            args.declarerSeats,
          )),
      elapsedMs: () => Date.now() - t0,
      lines,
    });
  } finally {
    pool?.close();
  }

  verdict = verdictOf(state.acc, args.strategyA, args.strategyB);
  state.outcome = dealOutcome(state.acc);
  printReport(false);
  writeJson(false);
}

main().catch(e => { console.error(e); ChildPool.killAll(); process.exit(1); });
