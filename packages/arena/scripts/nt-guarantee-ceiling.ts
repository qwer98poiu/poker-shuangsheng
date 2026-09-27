/**
 * 理论分析脚本（临时，不提交）：无主长花色领出层的「保庄上限」。
 *
 * 问题：如果无主局中「AI 策略方当庄 且 庄家有长花色」的那些小局都假设台上
 * 能保庄（闲家最终分记 40 分 ⇒ 庄家保庄并升一级），整个竞技场的对局胜率是多少？
 *
 * 口径：
 * - 只有「无主 ∧ AI 策略方当庄 ∧ 庄家有长花色」的小局被改写，其余小局照常打，
 *   改写直接作用于 HandEvent：finalPts=40、bankerWon=true。
 * - 这两个字段同时驱动 playMatch 的升级/上台判定与统计口径，所以对局进程与
 *   胜率统计都和真实对局一致，不是事后重算。
 * - 「有长花色」沿用引擎口径 computeLongSuit：初始手牌（庄家含底牌 → 33 张）
 *   按 longShape（总张数 ≥9 且控制张 ≥6）取唯一一门；有主局恒为 null。
 * - 判定发生在庄家本局第一次领出时（此刻 ctx 就是 33 张初始视角；该判定
 *   在小局内恒定，首墩领出必然由庄家打出）。
 *
 * 用法（在 packages/arena 下）：
 *   npx tsx scripts/nt-guarantee-ceiling.ts --pairs 5000 --seed 42
 *   npx tsx scripts/nt-guarantee-ceiling.ts --benchmark 20   # 先测速再决定跑多大
 * 选项与竞技场同名同义；另加 --no-baseline（跳过同种子对照局）。
 */
import os from 'node:os';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { playMatch } from '../src/match.js';
import {
  createStats, addHandStats, addMatchOutcome, mergeStats, toJSON, fromJSON,
} from '../src/stats.js';
import type { StrategyStats } from '../src/stats.js';
import { strategyByName } from '../src/strategies.js';
import { checkSignificance, Z } from '../src/significance.js';
import type { SignificanceResult } from '../src/significance.js';
import { formatDuration, estimateRemaining } from '../src/progress.js';
import type { HandEvent, Strategy } from '../src/types.js';
import { computeLongSuit } from '../../engine/src/ai/suit-memory.js';

type Mode = 'guarantee' | 'baseline';

/**
 * 闲家最终分 40：<80 ⇒ 庄家保庄；40 落在 computeLevelChange 的 n=1 档，
 * 即庄家保庄并升一级（0 分升 3 级、<40 升 2 级、40~79 升 1 级）。
 */
const GUARANTEE_FINAL_PTS = 40;
const PROGRESS_MATCHES = 100;

interface Batch {
  statsA: StrategyStats;
  statsB: StrategyStats;
  /** 被改写成「保庄」的小局数（仅 AI 当庄的无主长花色局）。 */
  guaranteed: number;
  /** AI 策略方当庄的无主小局数（改写比例的分母）。 */
  ntBankerHands: number;
  /** 被改写小局「改写前」的闲家最终分之和（看这个假设值多少分）。 */
  actualPtsSum: number;
  /** 被改写小局「改写前」实际保庄的局数。 */
  actualBankerWins: number;
}

/** 子进程返回的 JSON 形式统计（与 child-run.ts 同一协议，多两个计数器）。 */
interface ChildReply {
  statsA: Record<string, unknown>;
  statsB: Record<string, unknown>;
  guaranteed: number;
  ntBankerHands: number;
  actualPtsSum: number;
  actualBankerWins: number;
}

function emptyBatch(): Batch {
  return {
    statsA: createStats(), statsB: createStats(),
    guaranteed: 0, ntBankerHands: 0, actualPtsSum: 0, actualBankerWins: 0,
  };
}

function mergeBatch(a: Batch, b: Batch): Batch {
  return {
    statsA: mergeStats(a.statsA, b.statsA),
    statsB: mergeStats(a.statsB, b.statsB),
    guaranteed: a.guaranteed + b.guaranteed,
    ntBankerHands: a.ntBankerHands + b.ntBankerHands,
    actualPtsSum: a.actualPtsSum + b.actualPtsSum,
    actualBankerWins: a.actualBankerWins + b.actualBankerWins,
  };
}

/**
 * 一局的「假设保庄」改写器。
 *
 * lead 包装只在庄家本局第一次领出时探测一次长花色（trickHistory 为空 ⇒
 * 这是本局第一墩，领出者必为庄家）；onHand 在 playHand 返回后立刻改写事件，
 * 此时 playMatch 还没读 ev.bankerWon/finalPts，改写会正常参与升级判定。
 */
class Guarantee {
  private pending = false;
  private guaranteed = 0;
  private ntBankerHands = 0;
  private actualPtsSum = 0;
  private actualBankerWins = 0;

  constructor(private readonly active: boolean, private readonly ourParity: 0 | 1) {}

  wrap(s: Strategy): Strategy {
    if (!this.active) return s;
    return {
      ...s,
      lead: (hand, ctx) => {
        if (ctx.trumpSuit === null && ctx.isDeclarer && ctx.trickHistory.length === 0) {
          this.pending = computeLongSuit(hand, ctx) !== null;
        }
        return s.lead(hand, ctx);
      },
    };
  }

  onHand = (ev: HandEvent): void => {
    const guarantee = this.active && this.pending;
    this.pending = false;
    if (ev.aborted) return;
    if (ev.trumpSuit === null && ev.teamBanker === this.ourParity) this.ntBankerHands += 1;
    if (!guarantee) return;
    this.actualPtsSum += ev.finalPts;
    if (ev.bankerWon) this.actualBankerWins += 1;
    this.guaranteed += 1;
    ev.finalPts = GUARANTEE_FINAL_PTS;
    ev.bankerWon = true;
  };

  counters(): Omit<Batch, 'statsA' | 'statsB'> {
    return {
      guaranteed: this.guaranteed,
      ntBankerHands: this.ntBankerHands,
      actualPtsSum: this.actualPtsSum,
      actualBankerWins: this.actualBankerWins,
    };
  }
}

/** run-pairs.ts 的 runPair + onHand 钩子（改写必须发生在 playMatch 读事件之前）。 */
function runPair(
  seed: number, pairIndex: number, stratA: Strategy, stratB: Strategy, mode: Mode,
): Batch {
  const statsA = createStats();
  const statsB = createStats();
  const counters = { guaranteed: 0, ntBankerHands: 0, actualPtsSum: 0, actualBankerWins: 0 };

  for (const swapped of [false, true]) {
    const ourParity: 0 | 1 = swapped ? 1 : 0;
    const g = new Guarantee(mode === 'guarantee', ourParity);
    const strategies: [Strategy, Strategy] = swapped
      ? [stratB, g.wrap(stratA)]
      : [g.wrap(stratA), stratB];
    const result = playMatch({ seed, pairIndex, strategies, onHand: g.onHand });
    const c = g.counters();
    counters.guaranteed += c.guaranteed;
    counters.ntBankerHands += c.ntBankerHands;
    counters.actualPtsSum += c.actualPtsSum;
    counters.actualBankerWins += c.actualBankerWins;

    addMatchOutcome(statsA, result.winnerTeam, ourParity, result.finalLevels);
    addMatchOutcome(statsB, result.winnerTeam, ourParity === 0 ? 1 : 0, result.finalLevels);
    for (const ev of result.events) {
      addHandStats(statsA, ev, ourParity);
      addHandStats(statsB, ev, ourParity === 0 ? 1 : 0);
    }
  }
  return { statsA, statsB, ...counters };
}

function runRange(
  seed: number, pairStart: number, pairCount: number,
  stratA: Strategy, stratB: Strategy, mode: Mode,
): Batch {
  let acc = emptyBatch();
  for (let k = pairStart; k < pairStart + pairCount; k++) {
    acc = mergeBatch(acc, runPair(seed, k, stratA, stratB, mode));
  }
  return acc;
}

// ---- child worker ----

function runChild(seed: number, nameA: string, nameB: string): void {
  const stratA = strategyByName(nameA);
  const stratB = strategyByName(nameB);
  process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');
  // crlfDelay 必须是有界值：Infinity 在管道输入上（流不关闭时）行事件不触发。
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: 100 });
  rl.on('line', (line: string) => {
    const task = JSON.parse(line) as { id: number; pairStart: number; pairCount: number; mode: Mode };
    const b = runRange(seed, task.pairStart, task.pairCount, stratA, stratB, task.mode);
    process.stdout.write(JSON.stringify({
      id: task.id,
      statsA: toJSON(b.statsA),
      statsB: toJSON(b.statsB),
      guaranteed: b.guaranteed,
      ntBankerHands: b.ntBankerHands,
      actualPtsSum: b.actualPtsSum,
      actualBankerWins: b.actualBankerWins,
    }) + '\n');
  });
}

// ---- worker pool ----
// 自建而非复用 src/child-pool.ts：这里用 process.execPath + process.execArgv
// 直接拉起子进程（tsx 的 --require/--loader 就在 execArgv 里），绕开 npx。
// 4 个并发 `npm exec tsx` 会争 npm 缓存而卡死——本机实测两次：4 个子进程只起来
// 2~3 个，父进程在 ChildPool.create 上永久等待（0% CPU，无报错）。
class WorkerPool {
  private static procs: ChildProcess[] = [];
  private idle: ChildProcess[] = [];
  private queue: { task: Record<string, unknown>; resolve: (m: ChildReply) => void }[] = [];
  private pending = new Map<number, (m: ChildReply) => void>();
  private nextId = 1;
  private readyCount = 0;
  private closed = false;
  private onReady: (() => void) | null = null;

  static killAll(): void {
    for (const p of WorkerPool.procs) p.kill();
  }

  static async create(count: number, args: string[]): Promise<WorkerPool> {
    const pool = new WorkerPool();
    for (let i = 0; i < count; i++) pool.spawnOne(args);
    await pool.waitReady(count);
    return pool;
  }

  private spawnOne(args: string[]): void {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...args], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    WorkerPool.procs.push(child);
    let buffer = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let m: ChildReply & { type?: string; id?: number };
        try {
          m = JSON.parse(line);
        } catch {
          console.error(`子进程输出异常: ${line}`);
          continue;
        }
        if (m.type === 'ready') {
          this.idle.push(child);
          this.onReady?.();
          continue;
        }
        const resolve = this.pending.get(m.id!);
        if (resolve) {
          this.pending.delete(m.id!);
          resolve(m);
        } else {
          console.error(`子进程返回未知任务 id=${m.id}`);
        }
        this.idle.push(child);
        this.dispatch();
      }
    });
    child.on('error', e => {
      console.error(`子进程错误: ${e.message}`);
      process.exitCode = 1;
    });
    // 子进程带着在途任务死掉会让父进程永远等待——宁可直接失败也不要挂住长跑。
    child.on('exit', code => {
      if (code !== 0 && !this.closed) {
        console.error(`子进程异常退出: code=${code}（有任务在途，直接退出）`);
        process.exit(1);
      }
    });
  }

  private waitReady(count: number): Promise<void> {
    return new Promise(resolve => {
      this.onReady = () => {
        this.readyCount += 1;
        if (this.readyCount >= count) resolve();
      };
    });
  }

  private dispatch(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const c = this.idle.pop()!;
      const q = this.queue.shift()!;
      this.pending.set(q.task.id as number, q.resolve);
      c.stdin!.write(JSON.stringify(q.task) + '\n');
    }
  }

  submit(task: Record<string, unknown>): Promise<ChildReply> {
    const full = { ...task, id: this.nextId++ };
    return new Promise(resolve => {
      this.queue.push({ task: full, resolve });
      this.dispatch();
    });
  }

  close(): void {
    this.closed = true;
    WorkerPool.killAll();
  }
}

// ---- args ----

interface Args {
  pairs: number;
  maxMatches: number;
  stepMatches: number;
  seed: number;
  workers: number;
  benchmark: number;
  strategyA: string;
  strategyB: string;
  baseline: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    pairs: 5000,
    maxMatches: 100000,
    stepMatches: 1000,
    seed: 42,
    workers: Math.min(8, os.cpus().length),
    benchmark: 0,
    strategyA: 'ai',
    strategyB: 'ai-0907',
    baseline: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} 需要参数值`);
      i += 1;
      return v;
    };
    switch (a) {
      case '--pairs': args.pairs = parseInt(val(), 10); break;
      case '--max-matches': args.maxMatches = parseInt(val(), 10); break;
      case '--step-matches': args.stepMatches = parseInt(val(), 10); break;
      case '--seed': args.seed = parseInt(val(), 10) >>> 0; break;
      case '--workers': args.workers = parseInt(val(), 10); break;
      case '--benchmark': args.benchmark = parseInt(val(), 10); break;
      case '--strategy-a': args.strategyA = val(); break;
      case '--strategy-b': args.strategyB = val(); break;
      case '--no-baseline': args.baseline = false; break;
      case '-h':
      case '--help':
        console.log(`用法: npx tsx scripts/nt-guarantee-ceiling.ts [选项]
  --pairs N          初始对决数（=2N 场对局），默认 5000
  --max-matches N    对局上限，默认 100000
  --step-matches N   显著性检查间隔场数，默认 1000
  --seed N           随机种子，默认 42（两档对照共用，可比）
  --workers W        worker 进程数，默认 min(8, CPU 数)
  --benchmark N      跑 N 场对局测速后退出
  --strategy-a NAME  策略 A，默认 ai
  --strategy-b NAME  策略 B，默认 ai-0907
  --no-baseline      不跑同种子、同对决范围的对照局`);
        process.exit(0);
        break;
      default:
        throw new Error(`未知参数: ${a}`);
    }
  }
  if (args.pairs < 1) throw new Error('--pairs 必须 ≥ 1');
  if (args.baseline && args.maxMatches < 2 * args.pairs) {
    throw new Error(`--max-matches (${args.maxMatches}) 必须 ≥ 2×pairs (${2 * args.pairs})`);
  }
  return args;
}

// ---- reporting ----

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${(n / d).toFixed(4)} (${n}/${d})`;
}

interface PassResult {
  label: string;
  mode: Mode;
  batch: Batch;
  pairsDone: number;
  matches: number;
  elapsedMs: number;
  outcome: SignificanceResult;
}

function printPass(r: PassResult, nameA: string, nameB: string): void {
  const { batch } = r;
  const mA = batch.statsA.matches;
  const mB = batch.statsB.matches;
  const winsA = mA.won + 0.5 * mA.drawn;
  const winsB = mB.won + 0.5 * mB.drawn;
  console.log(`\n【${r.label}】${r.matches} 场（${r.pairsDone} 对决）  耗时 ${formatDuration(r.elapsedMs)}`);
  console.log(`  A (${nameA}) 胜率: ${pct(winsA, mA.played)}   [胜 ${mA.won} / 平 ${mA.drawn} / 负 ${mA.played - mA.won - mA.drawn}]`);
  console.log(`  B (${nameB}) 胜率: ${pct(winsB, mB.played)}`);
  console.log(
    `  显著性: leader=${r.outcome.leader ?? '—'}  p̂=${r.outcome.pHat.toFixed(4)}  ` +
    `99% CI 下界=${r.outcome.ciLower.toFixed(4)}  n=${r.outcome.n}  ` +
    `(${r.outcome.significant ? '显著' : '不显著'})`,
  );
  const ntHands = batch.statsA.banker.ntHands.d;
  console.log(`  A 当庄的无主小局: ${ntHands} / ${batch.statsA.handsPlayed} 小局`);
  // 自检：onHand 钩子的计数必须与统计口径完全一致，不一致说明钩子收错了事件。
  if (ntHands !== batch.ntBankerHands) {
    console.log(`  ⚠️ 计数不一致：onHand=${batch.ntBankerHands} 统计=${ntHands}（脚本有 bug）`);
  }
  if (r.mode === 'guarantee' && batch.guaranteed > 0) {
    console.log(
      `  其中判定「有长花色」按保庄计: ${pct(batch.guaranteed, ntHands)}（占 A 当庄无主小局）`,
    );
    console.log(
      `  被改写小局的实际结果（改写前）: 平均闲家分 ${(batch.actualPtsSum / batch.guaranteed).toFixed(1)}，` +
      `实际保庄 ${pct(batch.actualBankerWins, batch.guaranteed)}`,
    );
  }
}

// ---- main ----

async function runPass(opts: {
  label: string; mode: Mode; seed: number; pairs: number; maxMatches: number;
  stepMatches: number; stratA: Strategy; stratB: Strategy; nameA: string; nameB: string;
  pool: WorkerPool | null; workers: number; pairLimit: number;
}): Promise<PassResult> {
  const { label, mode, seed, stratA, stratB, pool, workers, pairLimit } = opts;
  const t0 = Date.now();
  let acc = emptyBatch();
  let pairsDone = 0;
  let outcome: SignificanceResult = checkSignificance(0, 0, 0, 0);

  while (pairsDone < pairLimit) {
    const batch = Math.min(PROGRESS_MATCHES / 2, pairLimit - pairsDone);
    const chunkLen = Math.ceil(batch / workers);
    const tasks: Promise<ChildReply>[] = [];
    for (let i = 0; i < workers; i++) {
      const start = pairsDone + i * chunkLen;
      const count = Math.min(chunkLen, batch - i * chunkLen);
      if (count <= 0) break;
      if (pool) {
        tasks.push(pool.submit({ pairStart: start, pairCount: count, mode }));
      } else {
        const b = runRange(seed, start, count, stratA, stratB, mode);
        tasks.push(Promise.resolve({
          statsA: toJSON(b.statsA), statsB: toJSON(b.statsB),
          guaranteed: b.guaranteed, ntBankerHands: b.ntBankerHands,
          actualPtsSum: b.actualPtsSum, actualBankerWins: b.actualBankerWins,
        }));
      }
    }
    for (const r of await Promise.all(tasks)) {
      acc = mergeBatch(acc, {
        statsA: fromJSON(r.statsA),
        statsB: fromJSON(r.statsB),
        guaranteed: r.guaranteed,
        ntBankerHands: r.ntBankerHands,
        actualPtsSum: r.actualPtsSum,
        actualBankerWins: r.actualBankerWins,
      });
    }
    pairsDone += batch;

    const matches = pairsDone * 2;
    const elapsedMs = Date.now() - t0;
    if (matches % opts.stepMatches !== 0 && pairsDone < pairLimit) {
      const target = Math.max(2 * opts.pairs, matches);
      console.log(
        `[${label}] 已完赛 ${matches} 场（${pairsDone} 对决）| 已用 ${formatDuration(elapsedMs)} ` +
        `| 预计剩余 ${formatDuration(estimateRemaining(elapsedMs, matches, target))} | 目标 ${target} 场`,
      );
      continue;
    }

    outcome = checkSignificance(acc.statsA.matches.won, acc.statsB.matches.won, acc.statsA.matches.drawn, matches);
    const reachedMin = matches >= 2 * opts.pairs;
    const status = outcome.significant
      ? (reachedMin ? '★ 显著' : '★ 显著（未达最小样本，继续）')
      : '未显著，继续';
    console.log(
      `[${label}] 已完赛 ${matches} 场（${pairsDone} 对决）| 已用 ${formatDuration(elapsedMs)} ` +
      `| leader=${outcome.leader ?? '—'} p̂=${outcome.pHat.toFixed(4)} | 99% CI 下界=${outcome.ciLower.toFixed(4)} | ${status}`,
    );
    if (outcome.significant && reachedMin) break;
  }

  return {
    label, mode, batch: acc, pairsDone, matches: pairsDone * 2,
    elapsedMs: Date.now() - t0, outcome,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const stratA = strategyByName(args.strategyA);
  const stratB = strategyByName(args.strategyB);

  if (args.benchmark > 0) {
    const pairs = Math.max(1, Math.ceil(args.benchmark / 2));
    const t0 = Date.now();
    const b = runRange(args.seed, 0, pairs, stratA, stratB, 'guarantee');
    const ms = Date.now() - t0;
    const matches = pairs * 2;
    console.log(
      `基准: ${matches} 场对局 / ${b.statsA.handsPlayed} 小局, ${ms}ms → ` +
      `${(ms / matches).toFixed(1)} ms/场, ${(ms / Math.max(1, b.statsA.handsPlayed)).toFixed(2)} ms/小局, ` +
      `保庄改写 ${b.guaranteed} 局`,
    );
    return;
  }

  const maxPairs = Math.floor(args.maxMatches / 2);
  const pool = args.workers > 1
    ? await WorkerPool.create(args.workers, ['--child', String(args.seed), args.strategyA, args.strategyB])
    : null;
  const onInterrupt = (): void => {
    console.log('\n⏹ 中断');
    WorkerPool.killAll();
    process.exit(130);
  };
  process.on('SIGINT', onInterrupt);

  try {
    const assumed = await runPass({
      label: '假设局', mode: 'guarantee', seed: args.seed,
      pairs: args.pairs, maxMatches: args.maxMatches, stepMatches: args.stepMatches,
      stratA, stratB, nameA: args.strategyA, nameB: args.strategyB,
      pool, workers: args.workers, pairLimit: maxPairs,
    });

    // 对照局跑「假设局实际跑完的那么多对决」，同种子同牌，两档可直接相减。
    let base: PassResult | null = null;
    if (args.baseline) {
      base = await runPass({
        label: '对照局', mode: 'baseline', seed: args.seed,
        pairs: args.pairs, maxMatches: args.maxMatches, stepMatches: args.stepMatches,
        stratA, stratB, nameA: args.strategyA, nameB: args.strategyB,
        pool, workers: args.workers, pairLimit: assumed.pairsDone,
      });
    }

    console.log('\n' + '='.repeat(64));
    console.log('无主长花色「假设保庄」上限分析');
    console.log('='.repeat(64));
    console.log(`A: ${args.strategyA}    B: ${args.strategyB}    seed=${args.seed}    z=${Z}`);
    if (base) printPass(base, args.strategyA, args.strategyB);
    printPass(assumed, args.strategyA, args.strategyB);
    if (base) {
      const w = (r: PassResult): number =>
        (r.batch.statsA.matches.won + 0.5 * r.batch.statsA.matches.drawn) / Math.max(1, r.batch.statsA.matches.played);
      const delta = w(assumed) - w(base);
      console.log(`\n假设带来的 A 胜率变化: ${delta >= 0 ? '+' : ''}${delta.toFixed(4)}` +
        `  （同种子、同 ${assumed.pairsDone} 对决）`);
    }
    console.log('='.repeat(64));
  } finally {
    pool?.close();
  }
}

if (process.argv.includes('--child')) {
  // argv: [node, script, --child, seed, strategyA, strategyB]
  runChild(Number(process.argv[3]), process.argv[4], process.argv[5]);
} else {
  main().catch(e => {
    console.error(`❌ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
