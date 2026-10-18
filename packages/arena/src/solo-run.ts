/**
 * 单副牌 A/B 竞技场 CLI.
 *
 *   npm run arena:solo -w packages/arena -- --seed 42 --level 2,5,10,Q,K,A --workers 4
 *
 * 固定庄家 P0、按等级列表，每 **(副, 等级)** 打 3 局（同一副牌、同一等级）：
 *   L1 = [A, B]   P0/P2 = A  → 测 A 当庄
 *   L0 = [B, B]   四家都 B   → 两块共用的基准
 *   L2 = [B, A]   P1/P3 = A  → 测 A 当闲
 * 每条腿各跑自己的自然亮主；`--nt-only` 过滤掉四家都没有对王的发牌。
 *
 * 指标 = 庄家/闲家 × 档位/分差，逐等级独立统计；置信度固定 99%。
 * 跑到 --min-deals 副后每 --step-deals 副检查一次，所有指标全显著即停，
 * 否则按当前读数推算所需发牌数并上调目标，直到 --max-deals。
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { strategyByName } from './strategies.js';
import { ChildPool, ARENA_ROOT } from './child-pool.js';
import { createSoloStats, runSoloDeals, soloStatsToJSON, soloStatsFromJSON } from './solo-arena.js';
import type { SoloStats } from './solo-arena.js';
import { activeIndicators, conclusionText, printSoloReport } from './solo-report.js';
import { ProgressLines } from './progress.js';
import { BATCH_DEALS, createSoloLadderState, runSoloLadder } from './solo-ladder.js';
import type { SoloLadderState } from './solo-ladder.js';
import { DEFAULT_LEVELS, availableFilterNames, parseLevels, resolveDealFilters } from './solo-filter.js';

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
  levels: number[];
  ntOnly: boolean;
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
单副牌 A/B 竞技场 —— 固定庄家 P0、按等级列表，每（副, 等级）打 3 局

用法: npm run arena:solo -- [选项]

选项:
  --seed N             随机种子（确定性），默认随机
  --level LIST         等级（逗号分隔），默认 ${DEFAULT_LEVELS.join(',')}；all = 2..A（13 档）
  --nt-only            过滤掉四家都没有对王的发牌（自然亮主即无主），默认关
  --deal-filter NAMES  发牌过滤器（逗号分隔，仓库内置），默认无
                       可选: ${availableFilterNames().join(', ') || '（无）'}
                       long-suit = 任一座位在该副（该等级）的自然主牌下有长花色即保留
                       （庄家 P0 按 33 张池＝发到 25＋底牌 8，其余三家各 25 张）；
                       与 --nt-only 共用即「NT 长花色」（此时主牌恒为无主）
  --strategy-a NAME    策略 A，默认 ai
  --strategy-b NAME    策略 B，默认 ai-1018
  --min-deals N        起跑有效发牌数下限，默认 2000
  --until-significant  不设最小样本：所有等级 × 4 项指标全显著即停（与 --min-deals 互斥）
  --step-deals N       显著性检查间隔与目标取整粒度（单位：副），默认 1000
  --max-deals N        有效发牌数上限（单位：副），默认 200000
  --workers N          子进程数，默认 min(8, CPU 核数)；1 = 进程内
  --out PATH           结果 JSON 输出路径，默认 results/solo-arena-<时间>.json
  --no-json            不导出 JSON
  -h, --help           显示帮助

每（副, 等级）打 3 局：L1=[A,B]（P0/P2 = A，庄家测）、L0=[B,B]（公共基准）、
L2=[B,A]（P1/P3 = A，闲家测）；庄家固定 P0，各等级相互独立。两项口径 × 两方 =
4 项指标：档位（三分类胜率，Wilson）与分差（配对差均值）。置信度固定 99%（z=2.576）。
Ctrl+C 保存部分结果后退出。`);
}

function val(argv: string[], i: number, name: string): string {
  const v = argv[i + 1];
  if (v === undefined) throw new Error(`${name} 需要一个参数`);
  return v;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    seed: (Math.random() * 2 ** 31) >>> 0,
    workers: Math.max(1, Math.min(8, os.cpus().length)),
    strategyA: 'ai',
    strategyB: 'ai-1018',
    levels: [...DEFAULT_LEVELS],
    ntOnly: false,
    dealFilters: [],
    minDeals: 2000,
    stepDeals: 1000,
    maxDeals: 200000,
    noJson: false,
    untilSignificant: false,
  };
  let minDealsGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--seed': args.seed = parseInt(val(argv, i, a), 10) >>> 0; i++; break;
      case '--workers': args.workers = parseInt(val(argv, i, a), 10); i++; break;
      case '--strategy-a': args.strategyA = val(argv, i, a); i++; break;
      case '--strategy-b': args.strategyB = val(argv, i, a); i++; break;
      case '--level': args.levels = parseLevels(val(argv, i, a)); i++; break;
      case '--nt-only': args.ntOnly = true; break;
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
    args.minDeals = 0; // 最小样本 0：任一次检查全显著即停
  } else if (args.minDeals < BATCH_DEALS) {
    throw new Error(`--min-deals 必须 ≥ ${BATCH_DEALS}`);
  }
  if (args.stepDeals < 1) throw new Error('--step-deals 必须 ≥ 1');
  if (args.maxDeals < args.minDeals) throw new Error('--max-deals 必须 ≥ --min-deals');
  return args;
}

/** 结论行：全部显著的指标里 A/B 各领先几项。 */
function verdictOf(acc: SoloStats, nameA: string, nameB: string): string {
  const inds = activeIndicators(acc);
  if (inds.length === 0) return '无有效指标（全部发牌被过滤）';
  return conclusionText(acc, nameA, nameB);
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
  const filtersArg = args.dealFilters.join(',');

  console.log(`单副牌 A/B 竞技场  seed=${args.seed}`);
  console.log(`A: ${args.strategyA}  B: ${args.strategyB}  workers=${args.workers}`);
  console.log(`等级: ${levelsArg}    nt-only: ${args.ntOnly ? '是' : '否'}    发牌过滤器: ${filtersArg || '无'}`);
  console.log(args.untilSignificant
    ? `样本阶梯: 不设最小样本，全部指标显著即停；上限 ${args.maxDeals} 副\n`
    : `样本阶梯: ${args.minDeals} 副起，之后按当前读数推算显著所需，上限 ${args.maxDeals} 副\n`);

  const pool = args.workers > 1
    ? await ChildPool.create(
        args.workers, 'solo-child-run.ts',
        [String(args.seed), args.strategyA, args.strategyB, levelsArg, args.ntOnly ? '1' : '0', filtersArg],
        { describeTask: t => `发牌 ${t.dealStart}..${t.dealStart + t.dealCount - 1}` },
      )
    : null;

  const t0 = Date.now();
  const state: SoloLadderState = createSoloLadderState(createSoloStats(args.levels));
  let verdict = '';

  /** 导出结果 JSON；partial=true 表示中断时的部分结果。 */
  const writeJson = (partial: boolean): void => {
    if (args.noJson) return;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outPath = args.out || path.join(OUT_DIR, `solo-arena-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
      meta: {
        seed: args.seed, strategyA: args.strategyA, strategyB: args.strategyB,
        levels: args.levels, workers: args.workers, ntOnly: args.ntOnly,
        dealFilters: args.dealFilters, minDeals: args.minDeals, stepDeals: args.stepDeals,
        maxDeals: args.maxDeals, targetDeals: state.target,
        untilSignificant: args.untilSignificant, elapsedMs: Date.now() - t0,
        createdAt: new Date().toISOString(), partial,
      },
      stats: soloStatsToJSON(state.acc),
    }, null, 2), 'utf-8');
    console.log(`\n📄 JSON 已导出: ${outPath}`);
  };

  const printReport = (partial: boolean): void => {
    lines.endLine(); // 先与原地进度行断开
    printSoloReport({
      nameA: args.strategyA, nameB: args.strategyB, seed: args.seed,
      elapsedMs: Date.now() - t0, levels: args.levels, ntOnly: args.ntOnly,
      dealFilters: args.dealFilters, targetDeals: state.target, stats: state.acc,
      verdict: partial ? `已中止（SIGINT，部分结果）；${verdictOf(state.acc, args.strategyA, args.strategyB)}` : verdict,
      color: STDOUT_TTY,
    });
  };

  // SIGINT 优雅退出：先打印部分报告 + JSON，再退出，不丢数据（与另两个竞技场同口径）
  const onInterrupt = (): void => {
    if (state.interrupted) return;
    state.interrupted = true;
    lines.endLine();
    console.log('⏹ 收到中断信号，保存部分结果…');
    printReport(true);
    writeJson(true);
    ChildPool.killAll();
    process.exit(130);
  };
  process.on('SIGINT', onInterrupt);

  try {
    await runSoloLadder(args, state, {
      runBatch: (dealStart, dealCount) => pool
        ? pool.submit({ dealStart, dealCount })
            .then(m => soloStatsFromJSON(m.stats as Record<string, any>))
        : Promise.resolve(runSoloDeals(
            args.seed, dealStart, dealCount, args.levels, stratA, stratB, args.ntOnly, args.dealFilters,
          )),
      elapsedMs: () => Date.now() - t0,
      lines,
    });
  } finally {
    pool?.close();
  }

  verdict = verdictOf(state.acc, args.strategyA, args.strategyB);
  printReport(false);
  writeJson(false);
}

main().catch(e => { console.error(e); ChildPool.killAll(); process.exit(1); });
