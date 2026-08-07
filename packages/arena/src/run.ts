/**
 * 策略竞技场 CLI.
 *
 * 用法:
 *   npm run arena -w packages/arena -- --pairs 5000 --seed 42 --workers 4
 *   npm run arena -w packages/arena -- --benchmark 200
 *
 * 流程：至少跑 --pairs 对决（=2×pairs 场对局），随后每追加 --step-matches
 * 场检查一次 99% 显著性；显著即停，否则继续直到 --max-matches 上限（无法判定）。
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { runPairs } from './run-pairs.js';
import { strategyByName } from './strategies.js';
import { createStats, mergeStats, fromJSON, toJSON } from './stats.js';
import type { StrategyStats } from './stats.js';
import { checkSignificance, requiredMatchesForSignificance, Z } from './significance.js';
import type { SignificanceResult } from './significance.js';
import { formatDuration, estimateRemaining, buildCheckpointDoc } from './progress.js';
import { upgradeLinesForMatch, formatUpgrade } from './upgrade-log.js';
import type { UpgradeLine } from './upgrade-log.js';
import { playMatch } from './match.js';
import type { MatchResult } from './types.js';

const ARENA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ARENA_ROOT, 'results');

interface Args {
  pairs: number;        // 初始对决数（最小样本）
  maxMatches: number;   // 对局上限
  stepMatches: number;  // 每次追加的对局数
  seed: number;
  workers: number;
  benchmark: number;    // 0 = 关闭
  detailPair: number | null; // 非空时只输出该对决的升级记录后退出
  strategyA: string;
  strategyB: string;
  out: string | null;   // null = 默认路径; '' = 不导出
}

function printUsage(): void {
  console.log(`用法: npm run arena -w packages/arena -- [选项]
  --pairs N          初始对决数（=2N 场对局），默认 5000
  --max-matches N    对局上限，默认 100000（须 ≥ 2×pairs）
  --step-matches N   显著性检查与检查点的间隔场数，默认 1000
  --seed N           随机种子（确定性），默认随机
  --workers W        worker 线程数，默认 4（1 = 进程内）
  --benchmark N      跑 N 场对局测速后退出
  --detail-pair N    输出第 N 个对决的镜像两场升级记录后退出
  --strategy-a NAME  策略 A，默认 ai
  --strategy-b NAME  策略 B，默认 ai-0801
  --out PATH         JSON 导出路径，默认 results/arena-<时间>.json
  --no-json          不导出 JSON
  -h, --help         显示帮助

进度: 每 100 场更新一行（含预估剩余时间）；每 stepMatches 场（默认 1000）
      输出显著性结果（leader/p̂/99% CI）并写入 results/checkpoint.json；
      达到最小样本（默认 10000 场）且显著即停止；Ctrl+C 保存部分结果后优雅退出。`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    pairs: 5000,
    maxMatches: 100000,
    stepMatches: 1000,
    seed: (Math.random() * 2 ** 31) >>> 0,
    workers: Math.min(8, os.cpus().length),
    benchmark: 0,
    detailPair: null,
    strategyA: 'ai',
    strategyB: 'ai-0801',
    out: null,
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
      case '--detail-pair': args.detailPair = parseInt(val(), 10); break;
      case '--strategy-a': args.strategyA = val(); break;
      case '--strategy-b': args.strategyB = val(); break;
      case '--out': args.out = val(); break;
      case '--no-json': args.out = ''; break;
      case '-h':
      case '--help':
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`未知参数: ${a}`);
    }
  }
  if (args.pairs < 1) throw new Error('--pairs 必须 ≥ 1');
  if (args.maxMatches < 2 * args.pairs) throw new Error(`--max-matches (${args.maxMatches}) 必须 ≥ 2×pairs (${2 * args.pairs})`);
  if (args.workers < 1) throw new Error('--workers 必须 ≥ 1');
  if (args.stepMatches < 2) throw new Error('--step-matches 必须 ≥ 2（镜像对决按对计数）');
  return args;
}

// ---- child-process pool ----
// worker_threads + tsx 在 Node 17.5 下多种消息模式都会死锁（实测），
// 改用子进程：每个子进程是独立的 tsx 主线程，loader 完全可靠。

interface WorkerResult { id: number; statsA: Record<string, any>; statsB: Record<string, any> }

interface Task { id: number; pairStart: number; pairCount: number }

class ChildPool {
  /** 全局子进程注册表：SIGINT 时即使池尚未完成创建也能全部终止。 */
  private static all: ChildProcess[] = [];
  private idle: ChildProcess[] = [];
  private queue: { task: Task; resolve: (m: WorkerResult) => void }[] = [];
  /** 在途任务（已派发、等待响应）：id → resolve。 */
  private pending = new Map<number, (m: WorkerResult) => void>();
  private nextId = 1;

  static killAll(): void {
    for (const c of ChildPool.all) c.kill();
  }

  static async create(count: number, seed: number, strategyA: string, strategyB: string): Promise<ChildPool> {
    const pool = new ChildPool();
    for (let i = 0; i < count; i++) {
      pool.spawnOne(seed, strategyA, strategyB);
    }
    await pool.waitAllReady(count);
    return pool;
  }

  private spawnOne(seed: number, strategyA: string, strategyB: string): void {
    const child = spawn('npx', ['tsx', path.join(ARENA_ROOT, 'src/child-run.ts'), String(seed), strategyA, strategyB], {
      cwd: ARENA_ROOT,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    ChildPool.all.push(child);
    let buffer = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let m: WorkerResult & { type?: string };
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
        const resolve = this.pending.get(m.id);
        if (resolve) {
          this.pending.delete(m.id);
          resolve(m);
        } else {
          console.error(`子进程返回未知任务 id=${m.id}`);
        }
        this.idle.push(child);
        this.dispatch();
      }
    });
    child.on('error', (e: Error) => {
      console.error(`子进程错误: ${e.message}`);
      process.exitCode = 1;
    });
    child.on('exit', code => {
      if (code !== 0 && !this.closed) {
        console.error(`子进程异常退出: code=${code}`);
        process.exitCode = 1;
      }
    });
  }

  private onReady: (() => void) | null = null;
  private readyCount = 0;

  private waitAllReady(count: number): Promise<void> {
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
      this.pending.set(q.task.id, q.resolve);
      c.stdin!.write(JSON.stringify(q.task) + '\n');
    }
  }

  submit(pairStart: number, pairCount: number): Promise<WorkerResult> {
    const task: Task = { id: this.nextId++, pairStart, pairCount };
    return new Promise(resolve => {
      this.queue.push({ task, resolve });
      this.dispatch();
    });
  }

  private closed = false;

  close(): void {
    this.closed = true;
    ChildPool.killAll();
  }
}

// ---- reporting ----

function ratio(p: { n: number; d: number }): string {
  if (p.d === 0) return '—';
  return `${(p.n / p.d).toFixed(4)} (${p.n}/${p.d})`;
}

function printUpgradeTable(
  m1: MatchResult, m2: MatchResult,
  nameA: string, nameB: string, seed: number, pairIndex: number,
): void {
  const l1 = upgradeLinesForMatch(m1.events, 0); // 对局1: A 坐 0/2 号位
  const l2 = upgradeLinesForMatch(m2.events, 1); // 对局2: A 坐 1/3 号位
  const maxHands = Math.max(l1.length, l2.length);
  const fmt = (l: UpgradeLine | undefined): string => l
    ? `${l.banker}   ${String(l.levelA).padStart(2)}  ${String(l.levelB).padStart(2)}  ${String(l.finalPts).padStart(3)}  ${formatUpgrade(l)}`
    : '—';
  console.log(`\n对决 ${pairIndex}（seed=${seed}）| A=${nameA}  B=${nameB}（同一副牌的两场镜像）`);
  console.log('手 | 对局1: 庄家 A级 B级 得分 升级            | 对局2: 庄家 A级 B级 得分 升级');
  for (let i = 0; i < maxHands; i++) {
    console.log(`${String(i).padStart(2)} | ${fmt(l1[i])} | ${fmt(l2[i])}`);
  }
  console.log(`中止小局: 对局1=${m1.abortedHands}  对局2=${m2.abortedHands}`);
}

function perLevelTable(title: string, m: Map<number, { n: number; d: number }>): string {
  const lines: string[] = [];
  for (let lv = 2; lv <= 14; lv++) {
    const p = m.get(lv);
    lines.push(`    L${lv}: ${p ? ratio(p) : '—'}`);
  }
  return `${title}:\n${lines.join('\n')}`;
}

function printReport(
  nameA: string, nameB: string, seed: number, matches: number, pairs: number,
  elapsedMs: number, outcome: SignificanceResult | null, verdict: string,
  accA: StrategyStats, accB: StrategyStats,
): void {
  const globalHands = accA.handsPlayed;
  const globalTricks = accA.tricks.won.d;
  console.log('\n' + '='.repeat(64));
  console.log('策略竞技场报告');
  console.log('='.repeat(64));
  console.log(`A: ${nameA}    B: ${nameB}    seed=${seed}`);
  console.log(`对局数: ${matches} 场（${pairs} 对决）  耗时 ${(elapsedMs / 1000).toFixed(0)}s`);
  console.log(`结论: ${verdict}`);
  if (outcome && outcome.n > 0) {
    console.log(`  leader=${outcome.leader}  p̂=${outcome.pHat.toFixed(4)}  99% CI 下界=${outcome.ciLower.toFixed(4)}  (n=${outcome.n})`);
  }
  console.log('\n全局指标:');
  console.log(`  平均小局数/场: ${ratio({ n: globalHands, d: matches })}`);
  console.log(`  每局平均墩数: ${ratio({ n: globalTricks, d: globalHands })}`);
  console.log(`  平局(封顶)场次: ${accA.matches.drawn}   中止小局: ${accA.abortedHands}`);

  for (const [label, s] of [['A', accA], ['B', accB]] as const) {
    const name = label === 'A' ? nameA : nameB;
    const winRate = { n: s.matches.won + 0.5 * s.matches.drawn, d: s.matches.played };
    console.log(`\n策略 ${label} (${name}):`);
    console.log(`  胜率: ${winRate.d === 0 ? '—' : `${(winRate.n / winRate.d).toFixed(4)} (${winRate.n}/${winRate.d})`}`);
    console.log(`  胜出时对方平均等级: ${ratio(s.matches.oppLevel)}`);
    console.log(`  当庄频率: ${ratio({ n: s.banker.hands, d: globalHands })}`);
    console.log(`  台上胜率: ${ratio({ n: s.banker.wins, d: s.banker.hands })}`);
    console.log(perLevelTable('  台上各等级胜率', s.banker.perLevel));
    console.log(`  台上打有主胜率: ${ratio(s.banker.trumpHands)}`);
    console.log(`  台上打NT胜率: ${ratio(s.banker.ntHands)}`);
    console.log(`  台上平均失分: ${ratio(s.banker.avgLoss)}`);
    console.log(`  台上扣底平均分数: ${ratio(s.banker.avgBottomPts)}`);
    console.log(`  台上扣绝一门频率: ${ratio(s.banker.killSuitFreq)}`);
    console.log(`  庄家保底频率: ${ratio(s.banker.keepBottom)}`);
    console.log(`  台下胜率: ${ratio({ n: s.attacker.wins, d: s.attacker.hands })}`);
    console.log(perLevelTable('  台下各等级胜率', s.attacker.perLevel));
    console.log(`  台下打有主胜率: ${ratio(s.attacker.trumpHands)}`);
    console.log(`  台下打NT胜率: ${ratio(s.attacker.ntHands)}`);
    console.log(`  抠底频率: ${ratio(s.attacker.kouDiFreq)}`);
    console.log(`  抠底成功频率: ${ratio(s.attacker.kouDiSuccess)}`);
    console.log(`  闲家抠底平均加分: ${ratio(s.attacker.avgKouDi)}`);
    console.log(`  每墩胜率: ${ratio(s.tricks.won)}`);
    console.log(`  每局平均领出次数: ${ratio({ n: s.tricks.leads.n, d: globalHands })}`);
    console.log(`  每局平均每墩领出张数: ${ratio(s.tricks.leadCards)}`);
  }
  console.log('='.repeat(64));
}

// ---- main ----

async function runBenchmark(args: Args, stratA: ReturnType<typeof strategyByName>, stratB: ReturnType<typeof strategyByName>): Promise<void> {
  const pairs = Math.max(1, Math.ceil(args.benchmark / 2));
  const t0 = Date.now();
  const { statsA } = runPairs(args.seed, 0, pairs, stratA, stratB);
  const ms = Date.now() - t0;
  const matches = pairs * 2;
  console.log(
    `基准: ${matches} 场对局 / ${statsA.handsPlayed} 小局, ${ms}ms → ` +
    `${(ms / matches).toFixed(1)} ms/场, ${(statsA.handsPlayed / matches).toFixed(1)} 小局/场, ` +
    `${(ms / Math.max(1, statsA.handsPlayed)).toFixed(2)} ms/小局`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const stratA = strategyByName(args.strategyA);
  const stratB = strategyByName(args.strategyB);

  if (args.benchmark > 0) {
    await runBenchmark(args, stratA, stratB);
    return;
  }

  if (args.detailPair !== null) {
    const m1 = playMatch({ seed: args.seed, pairIndex: args.detailPair, strategies: [stratA, stratB], captureEvents: true });
    const m2 = playMatch({ seed: args.seed, pairIndex: args.detailPair, strategies: [stratB, stratA], captureEvents: true });
    printUpgradeTable(m1, m2, args.strategyA, args.strategyB, args.seed, args.detailPair);
    return;
  }

  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const maxPairs = Math.floor(args.maxMatches / 2);
  // 三档粒度（用户约定）：
  // - 进度条每 100 场更新一次（含预估剩余时间）
  // - 每 stepMatches 场（默认 1000）输出显著性结果（leader/p̂/99% CI）并写入检查点
  // - 停止判定：达到最小样本（2×pairs，默认 10000 场）且显著时才停止
  // - 进度基准 targetMatches：2×pairs 前固定为最小样本；之后未显著时按当前
  //   胜率推算显著所需总场数（动态调整，变化时说明原因）
  const PROGRESS_MATCHES = 100;
  const CHECKPOINT_MATCHES = args.stepMatches;
  let targetMatches = 2 * args.pairs;
  let accA = createStats();
  let accB = createStats();
  let pairsDone = 0;
  let outcome: SignificanceResult | null = null;
  let verdict = '无法判定（达到上限仍未显著）';
  let interrupted = false;

  let pool: ChildPool | null = null;

  const writeCheckpoint = (): void => {
    const doc = buildCheckpointDoc(
      {
        seed: args.seed,
        strategyA: args.strategyA,
        strategyB: args.strategyB,
        minMatches: 2 * args.pairs,
        maxMatches: args.maxMatches,
        stepMatches: args.stepMatches,
        startedAt,
      },
      pairsDone,
      toJSON(accA) as Record<string, unknown>,
      toJSON(accB) as Record<string, unknown>,
      new Date().toISOString(),
    );
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'checkpoint.json'), JSON.stringify(doc, null, 2), 'utf-8');
  };

  const writeJsonReport = (partial: boolean): void => {
    if (args.out === '') return;
    const outPath = args.out ?? path.join(OUT_DIR, `arena-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const doc = {
      meta: {
        seed: args.seed,
        strategyA: args.strategyA,
        strategyB: args.strategyB,
        minMatches: 2 * args.pairs,
        maxMatches: args.maxMatches,
        stepMatches: args.stepMatches,
        createdAt: startedAt,
        partial,
      },
      outcome: outcome
        ? { verdict, significant: outcome.significant, leader: outcome.leader, n: outcome.n, pHat: outcome.pHat, ciLower: outcome.ciLower, z: Z, pairsEvaluated: pairsDone }
        : null,
      global: {
        handsPerMatch: { n: accA.handsPlayed, d: pairsDone * 2 },
        tricksPerHand: { n: accA.tricks.won.d, d: accA.handsPlayed },
        draws: accA.matches.drawn,
        cappedMatches: accA.matches.drawn,
        abortedHands: accA.abortedHands,
      },
      strategies: {
        A: { name: args.strategyA, ...toJSON(accA) },
        B: { name: args.strategyB, ...toJSON(accB) },
      },
    };
    fs.writeFileSync(outPath, JSON.stringify(doc, null, 2), 'utf-8');
    console.log(`\n📄 JSON 已导出: ${outPath}`);
  };

  // SIGINT 优雅退出：先写检查点 + 部分报告，再退出，不丢数据
  const onInterrupt = (): void => {
    if (interrupted) return;
    interrupted = true;
    console.log('\n⏹ 收到中断信号，保存部分结果…');
    outcome = checkSignificance(accA.matches.won, accB.matches.won, accA.matches.drawn, accA.matches.played);
    verdict = '已中止（SIGINT，部分结果）';
    writeCheckpoint();
    writeJsonReport(true);
    printReport(args.strategyA, args.strategyB, args.seed, pairsDone * 2, pairsDone, Date.now() - t0, outcome, verdict, accA, accB);
    ChildPool.killAll();
    process.exit(130);
  };
  process.on('SIGINT', onInterrupt);

  pool = args.workers > 1
    ? await ChildPool.create(args.workers, args.seed, args.strategyA, args.strategyB)
    : null;

  while (pairsDone < maxPairs && !interrupted) {
    const batch = Math.min(PROGRESS_MATCHES / 2, maxPairs - pairsDone);
    const W = args.workers;
    const chunkLen = Math.ceil(batch / W);
    const tasks: Promise<WorkerResult>[] = [];
    for (let i = 0; i < W; i++) {
      const start = pairsDone + i * chunkLen;
      const count = Math.min(chunkLen, batch - i * chunkLen);
      if (count <= 0) break;
      if (pool) {
        tasks.push(pool.submit(start, count));
      } else {
        const { statsA, statsB } = runPairs(args.seed, start, count, stratA, stratB);
        tasks.push(Promise.resolve({ id: 0, statsA: toJSON(statsA) as Record<string, any>, statsB: toJSON(statsB) as Record<string, any> }));
      }
    }
    const results = await Promise.all(tasks);
    for (const r of results) {
      accA = mergeStats(accA, fromJSON(r.statsA));
      accB = mergeStats(accB, fromJSON(r.statsB));
    }
    pairsDone += batch;
    const matches = pairsDone * 2;
    const elapsedMs = Date.now() - t0;
    const eta = formatDuration(estimateRemaining(elapsedMs, matches, targetMatches));

    if (matches % CHECKPOINT_MATCHES !== 0 && pairsDone < maxPairs) {
      // 普通进度行（每 100 场）：进度/ETA 以动态基准 targetMatches 计算
      console.log(
        `已完赛 ${matches} 场（${pairsDone} 对决）| 进度 ${((matches / targetMatches) * 100).toFixed(1)}% ` +
        `| 已用 ${formatDuration(elapsedMs)} | 预计剩余 ${eta} | 目标 ${targetMatches} 场`,
      );
      continue;
    }

    // 每 stepMatches 场（默认 1000）或运行结束：输出显著性结果 + 写入检查点
    outcome = checkSignificance(accA.matches.won, accB.matches.won, accA.matches.drawn, accA.matches.played);
    const leader = outcome.leader ?? '—';
    const reachedMin = matches >= 2 * args.pairs;
    const status = outcome.significant
      ? (reachedMin ? '★ 显著' : '★ 显著（未达最小样本，继续）')
      : '未显著，继续';

    // 动态进度基准：达到最小样本且未显著时，按当前胜率推算显著所需总场数
    let targetNote = '';
    if (reachedMin && !outcome.significant) {
      const required = requiredMatchesForSignificance(
        accA.matches.won, accB.matches.won, accA.matches.drawn, matches,
        CHECKPOINT_MATCHES, args.maxMatches,
      );
      const newTarget = Math.min(required, args.maxMatches);
      if (newTarget !== targetMatches) {
        const p = outcome.pHat;
        const why = !Number.isFinite(required)
          ? `当前 p̂=${p.toFixed(4)} 未过半，显著性不可达，按上限计`
          : required > args.maxMatches
            ? `按当前 p̂=${p.toFixed(4)} 推算需 ${required} 场，超过上限，按上限计`
            : `按当前 p̂=${p.toFixed(4)} 推算显著所需（向上取整到 ${CHECKPOINT_MATCHES} 的倍数）`;
        targetNote = `目标调整: ${targetMatches} → ${newTarget} 场（${why}）`;
        targetMatches = newTarget;
      }
    }

    console.log(
      `已完赛 ${matches} 场（${pairsDone} 对决）| 进度 ${((matches / targetMatches) * 100).toFixed(1)}% ` +
      `| 已用 ${formatDuration(elapsedMs)} | 预计剩余 ${eta} | 目标 ${targetMatches} 场 ` +
      `| leader=${leader} p̂=${outcome.pHat.toFixed(4)} | 99% CI 下界=${outcome.ciLower.toFixed(4)} | ${status}` +
      (targetNote ? ` | ${targetNote}` : ''),
    );
    writeCheckpoint();

    // 停止判定：达到最小样本（默认 10000 场）且显著
    if (outcome.significant && reachedMin) {
      verdict = `${outcome.leader}（${outcome.leader === 'A' ? args.strategyA : args.strategyB}）显著优于对方`;
      break;
    }
  }
  pool?.close();

  const elapsedMs = Date.now() - t0;
  if (!interrupted) {
    printReport(args.strategyA, args.strategyB, args.seed, pairsDone * 2, pairsDone, elapsedMs, outcome, verdict, accA, accB);
    writeJsonReport(false);
  }
}

main().catch(e => {
  console.error(`❌ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
