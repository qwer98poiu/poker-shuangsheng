/**
 * 牌局录制 CLI（生成数据分析用的小局数据集，只记录不分析）。
 *
 * 用法:
 *   npm run record -- --context random --hands 1000000 --workers 8
 *   npm run record -w packages/arena -- --hands 1000 --context rules --seed 42
 *
 * 流程：按 worker 数把总手数均分成独立链（各自 seed / 输出分片），fork 子进程
 * 各跑一条；父进程汇总进度、原子写 manifest.json，SIGINT/SIGTERM 时让子进程
 * 打完当前手、flush、写 footer 后再退出。格式与保证见 src/record-format.md。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { strategyByName } from './strategies.js';
import type { Strategy } from './types.js';
import { ChainWriter } from './record-writer.js';
import { runChain, writeErrorReport } from './record-run.js';
import type { ChainErrorInfo, ChainRunResult } from './record-run.js';
import { FORMAT_VERSION, RULES_VERSION } from './record-types.js';
import type {
  ContextMode, Manifest, ManifestChain, ManifestError, ManifestShard,
  RecordWorkerMessage, RecordWorkerSpec,
} from './record-types.js';
import { deriveChainSeed, normalizeSeedHex, randomBaseSeedHex } from './record-rng.js';
import { writeManifestAtomic } from './record-codec.js';
import { ProgressLines, estimateRemaining, formatDuration } from './progress.js';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const ARENA_ROOT = path.resolve(SRC_DIR, '..');
const WORKER_ENTRY = path.join(SRC_DIR, 'record-worker.ts');

interface RecordArgs {
  context: ContextMode;
  hands: number;
  workers: number | null;
  seedHex: string | null;
  strategyA: string;
  strategyB: string;
  out: string | null;
  shardHands: number;
  flushHands: number;
}

interface ChainSpec {
  chainId: number;
  globalStart: number;
  handsRequested: number;
  seedHex: string;
}

type ParseResult = { kind: 'help' } | { kind: 'args'; args: RecordArgs };

function printUsage(): void {
  console.log(`用法: npm run record -- [选项]

  --context MODE     发牌/局面来源：random（默认，52 手分层块）| rules（2..A 循环）
  --hands N          手数总数，默认 1000000
  --workers W        独立链数，默认 min(8, cpus, hands)；1 = 进程内
  --seed SEED        base seed（十进制或 0x 十六进制），默认时间戳+随机派生
  --strategy-a NAME  座位 0/2 的策略，默认 ai（可选: ai, ai-0816, ai-0907, ai-0929, ai-1005, ai-1018）
  --strategy-b NAME  座位 1/3 的策略，默认 ai
  --out PATH         输出目录（必须不存在），默认 packages/arena/results/recordings/<runId>
  --shard-hands N    每个 .bin 的手数，默认 50000
  --flush-hands N    写缓冲 flush 间隔，默认 1000
  -h, --help         显示帮助

Ctrl+C 完成当前手并落盘后退出；第二次 Ctrl+C 强制结束。不 resume、不覆盖已有目录。`);
}

function parsePositiveInt(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} 必须是 ≥ 1 的整数: ${raw}`);
  return n;
}

function parseArgs(argv: string[]): ParseResult {
  const args: RecordArgs = {
    context: 'random',
    hands: 1000000,
    workers: null,
    seedHex: null,
    strategyA: 'ai',
    strategyB: 'ai',
    out: null,
    shardHands: 50000,
    flushHands: 1000,
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
      case '-h':
      case '--help':
        return { kind: 'help' };
      case '--context': {
        const v = val();
        if (v !== 'random' && v !== 'rules') throw new Error(`--context 只能是 random 或 rules: ${v}`);
        args.context = v;
        break;
      }
      case '--hands': args.hands = parsePositiveInt('--hands', val()); break;
      case '--workers': args.workers = parsePositiveInt('--workers', val()); break;
      case '--seed': args.seedHex = normalizeSeedHex(val()); break;
      case '--strategy-a': args.strategyA = val(); break;
      case '--strategy-b': args.strategyB = val(); break;
      case '--out': args.out = val(); break;
      case '--shard-hands': args.shardHands = parsePositiveInt('--shard-hands', val()); break;
      case '--flush-hands': args.flushHands = parsePositiveInt('--flush-hands', val()); break;
      default:
        throw new Error(`未知选项: ${a}（--help 查看用法）`);
    }
  }
  return { kind: 'args', args };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stackOf(err: unknown): string | null {
  return err instanceof Error && err.stack ? err.stack : null;
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function gitInfo(): { revision: string | null; dirty: boolean } {
  const rev = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ARENA_ROOT, encoding: 'utf8' });
  if (rev.status !== 0) return { revision: null, dirty: false };
  const st = spawnSync('git', ['status', '--porcelain'], { cwd: ARENA_ROOT, encoding: 'utf8' });
  return {
    revision: rev.stdout.trim() || null,
    dirty: st.status === 0 && st.stdout.trim().length > 0,
  };
}

function buildRunId(baseSeedHex: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${ts}-${baseSeedHex.slice(0, 8)}`;
}

function allocateChains(hands: number, workers: number, baseSeedHex: string): ChainSpec[] {
  const base = Math.floor(hands / workers);
  const rem = hands % workers;
  const specs: ChainSpec[] = [];
  let globalStart = 0;
  for (let chainId = 0; chainId < workers; chainId++) {
    const handsRequested = base + (chainId < rem ? 1 : 0);
    specs.push({
      chainId,
      globalStart,
      handsRequested,
      seedHex: deriveChainSeed(baseSeedHex, chainId),
    });
    globalStart += handsRequested;
  }
  return specs;
}

function syntheticChainError(
  spec: ChainSpec, mode: ContextMode, names: { A: string; B: string },
  message: string, stack: string | null, handIndex: number,
): ChainErrorInfo {
  return {
    kind: 'exception',
    chainId: spec.chainId,
    globalHandIndex: spec.globalStart + handIndex,
    chainHandIndex: handIndex,
    seed: spec.seedHex,
    strategies: names,
    context: {
      mode, blockIndex: 0, cellIndex: 0, level: 0, declarer: 0,
      attackerLevel: 0, hasAttackerLevel: false, lapA: 0, lapB: 0,
    },
    deck: [],
    event: null,
    state: null,
    message,
    stack,
  };
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ParseResult;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(`[record] ${messageOf(err)}`);
    return 1;
  }
  if (parsed.kind === 'help') {
    printUsage();
    return 0;
  }
  const args = parsed.args;

  let strategyA: Strategy;
  let strategyB: Strategy;
  try {
    strategyA = strategyByName(args.strategyA);
    strategyB = strategyByName(args.strategyB);
  } catch (err) {
    console.error(`[record] ${messageOf(err)}`);
    return 1;
  }
  const names = { A: strategyA.name, B: strategyB.name };

  const baseSeedHex = args.seedHex ?? randomBaseSeedHex();
  const seedSource: 'cli' | 'timestamp+random' = args.seedHex ? 'cli' : 'timestamp+random';
  const runId = buildRunId(baseSeedHex);
  const outDir = path.resolve(args.out ?? path.join(ARENA_ROOT, 'results', 'recordings', runId));

  if (fs.existsSync(outDir)) {
    console.error(`[record] 输出目录已存在（不覆盖）: ${outDir}`);
    return 1;
  }

  if (args.hands > 0xffffffff) {
    console.error(`[record] --hands 超过 u32 上限: ${args.hands}`);
    return 1;
  }
  const workers = Math.min(
    args.workers ?? Math.min(8, os.cpus().length, args.hands),
    args.hands,
  );
  if (workers > 0xffff) {
    console.error('[record] 链数超过 65535（chainId 是 u16），请减少 --workers');
    return 1;
  }
  if (args.workers !== null && args.workers > args.hands) {
    console.error(`[record] --workers ${args.workers} 超过 --hands ${args.hands}，按 ${workers} 条链运行`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const specs = allocateChains(args.hands, workers, baseSeedHex);
  const git = gitInfo();
  const createdAt = new Date().toISOString();

  const manifest: Manifest = {
    formatVersion: FORMAT_VERSION,
    rulesVersion: RULES_VERSION,
    status: 'running',
    contextMode: args.context,
    seed: { base: baseSeedHex, source: seedSource, algorithm: 'sha256-64-v1' },
    strategies: names,
    handsRequested: args.hands,
    handsCompleted: 0,
    workers,
    shardHands: args.shardHands,
    flushHands: args.flushHands,
    createdAt,
    completedAt: null,
    revision: git.revision,
    dirty: git.dirty,
    node: process.version,
    command: process.argv.slice(),
    chains: specs.map(spec => ({
      chainId: spec.chainId,
      seed: spec.seedHex,
      globalStart: spec.globalStart,
      handsRequested: spec.handsRequested,
      handsCompleted: 0,
      status: 'running' as const,
      shards: [] as ManifestShard[],
    })),
    error: null,
  };
  writeManifestAtomic(outDir, manifest);

  const tty = process.stdout.isTTY === true;
  const lines = new ProgressLines(tty, {
    write: (s): void => { process.stdout.write(s); },
    log: (s): void => { console.log(s); },
  });
  const startedAt = Date.now();

  const findChain = (chainId: number): ManifestChain => {
    const chain = manifest.chains.find(c => c.chainId === chainId);
    if (!chain) throw new Error(`manifest 缺少链 ${chainId}`);
    return chain;
  };
  const refreshTotals = (): void => {
    manifest.handsCompleted = manifest.chains.reduce((sum, c) => sum + c.handsCompleted, 0);
  };
  const progressLine = (): string => {
    const done = manifest.handsCompleted;
    const total = manifest.handsRequested;
    const pct = total > 0 ? ((done / total) * 100).toFixed(1) : '0.0';
    const elapsed = Date.now() - startedAt;
    const eta = done > 0 ? formatDuration(estimateRemaining(elapsed, done, total)) : '—';
    return `录制 ${fmtInt(done)}/${fmtInt(total)} (${pct}%) | 已用 ${formatDuration(elapsed)} | 剩余约 ${eta}`;
  };
  const saveManifest = (): void => {
    writeManifestAtomic(outDir, manifest);
  };

  console.log(`[record] runId ${runId}`);
  console.log(`[record] 模式 ${args.context} | ${fmtInt(args.hands)} 手 | ${workers} 条链 | seed ${baseSeedHex} (${seedSource})`);
  console.log(`[record] 策略 A=${names.A} B=${names.B} | shard ${fmtInt(args.shardHands)} 手 | flush ${fmtInt(args.flushHands)} 手`);
  console.log(`[record] 输出 ${outDir}`);

  const runtime = {
    stopping: false,
    requestStop: (): void => { /* 由具体运行方式安装 */ },
    killAll: (): void => { /* 由 worker 模式安装 */ },
  };

  const onSignal = (sig: NodeJS.Signals): void => {
    if (runtime.stopping) {
      lines.endLine();
      console.error(`[record] 收到第二次 ${sig}，强制结束（未落盘缓冲会丢失）`);
      runtime.killAll();
      process.exit(130);
    }
    runtime.stopping = true;
    lines.endLine();
    console.error(`[record] 收到 ${sig}，完成当前手、落盘后停止…`);
    runtime.requestStop();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let failure: ManifestError | null = null;

  try {
    if (workers === 1) {
      // ---- 进程内单链 ----
      runtime.requestStop = (): void => { /* stopping 标志已由 onSignal 置位 */ };
      const spec = specs[0];
      const chain = findChain(spec.chainId);
      let writer: ChainWriter | null = null;
      let result: ChainRunResult;
      try {
        writer = new ChainWriter({
          runDir: outDir,
          chainId: spec.chainId,
          chainSeedHex: spec.seedHex,
          shardHands: args.shardHands,
          flushHands: args.flushHands,
        });
        const activeWriter = writer;
        result = await runChain({
          chainId: spec.chainId,
          globalStart: spec.globalStart,
          seedHex: spec.seedHex,
          mode: args.context,
          handsRequested: spec.handsRequested,
          strategies: [strategyA, strategyB],
          onRecord: (record, deckHash) => { activeWriter.write(record, deckHash); },
          onProgress: (completed) => {
            chain.handsCompleted = completed;
            refreshTotals();
            saveManifest();
            lines.progress(progressLine());
          },
          shouldStop: () => runtime.stopping,
        });
      } catch (err) {
        result = {
          status: 'error',
          handsCompleted: writer ? writer.handsWritten : 0,
          error: syntheticChainError(
            spec, args.context, names, messageOf(err), stackOf(err), writer ? writer.handsWritten : 0,
          ),
        };
      }

      let closeError: string | null = null;
      if (writer) {
        try { writer.close(); } catch (err) { closeError = messageOf(err); }
      }

      chain.handsCompleted = result.handsCompleted;
      chain.shards = writer ? writer.shards : [];
      chain.status = result.status === 'completed'
        ? 'completed'
        : result.status === 'stopped' ? 'stopped' : 'error';

      if (result.error) {
        let reportPath: string | null = null;
        try { reportPath = writeErrorReport(outDir, result.error); } catch { reportPath = null; }
        failure = {
          chainId: result.error.chainId,
          handIndex: result.error.chainHandIndex,
          kind: result.error.kind,
          message: result.error.message,
          reportPath,
        };
      }
      if (closeError) {
        chain.status = 'error';
        if (!failure) {
          failure = {
            chainId: spec.chainId,
            handIndex: chain.handsCompleted,
            kind: 'io',
            message: closeError,
            reportPath: null,
          };
        }
      }
      refreshTotals();
    } else {
      // ---- fork 多链 ----
      const children = new Map<number, ChildProcess>();
      runtime.killAll = (): void => {
        for (const child of children.values()) child.kill('SIGKILL');
      };
      runtime.requestStop = (): void => {
        for (const child of children.values()) {
          if (child.connected) {
            try { child.send({ type: 'stop' }); } catch { /* 子进程已退出 */ }
          }
        }
      };

      const reportFailure = (f: ManifestError): void => {
        if (failure) return;
        failure = f;
        manifest.error = f;
        console.error(`\n[record] 链 ${f.chainId} 出错: ${f.message}`
          + (f.reportPath ? `（见 ${f.reportPath}）` : ''));
        runtime.requestStop();
      };

      await Promise.all(specs.map(spec => new Promise<void>(resolve => {
        const workerSpec: RecordWorkerSpec = {
          chainId: spec.chainId,
          globalStart: spec.globalStart,
          handsRequested: spec.handsRequested,
          seedHex: spec.seedHex,
          mode: args.context,
          strategyA: names.A,
          strategyB: names.B,
          runDir: outDir,
          shardHands: args.shardHands,
          flushHands: args.flushHands,
        };
        let child: ChildProcess;
        try {
          child = fork(WORKER_ENTRY, [JSON.stringify(workerSpec)], {
            stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
          });
        } catch (err) {
          findChain(spec.chainId).status = 'error';
          reportFailure({
            chainId: spec.chainId,
            handIndex: findChain(spec.chainId).handsCompleted,
            kind: 'exception',
            message: `fork 子进程失败: ${messageOf(err)}`,
            reportPath: null,
          });
          resolve();
          return;
        }
        children.set(spec.chainId, child);
        let sawDone = false;

        child.on('message', (raw: unknown) => {
          if (typeof raw !== 'object' || raw === null || !('type' in raw)) return;
          const msg = raw as RecordWorkerMessage;
          if (msg.type === 'ready') return;
          if (msg.type === 'progress') {
            const chain = findChain(msg.chainId);
            chain.handsCompleted = msg.completed;
            refreshTotals();
            try { saveManifest(); } catch { /* 进度上报尽力而为 */ }
            lines.progress(progressLine());
            return;
          }
          if (msg.type !== 'done') return;
          sawDone = true;
          const chain = findChain(msg.chainId);
          chain.handsCompleted = msg.completed;
          chain.shards = msg.shards;
          chain.status = msg.status === 'completed'
            ? 'completed'
            : msg.status === 'stopped' ? 'stopped' : 'error';
          if (msg.status === 'error') {
            reportFailure({
              chainId: msg.chainId,
              handIndex: chain.handsCompleted,
              kind: msg.error?.kind ?? 'exception',
              message: msg.error?.message ?? '子进程报告错误',
              reportPath: msg.error?.reportPath ?? null,
            });
          }
          refreshTotals();
          try { saveManifest(); } catch { /* 最终 manifest 在收尾时再写 */ }
          lines.progress(progressLine());
        });

        child.on('error', (err: Error) => {
          if (sawDone) return;
          reportFailure({
            chainId: spec.chainId,
            handIndex: findChain(spec.chainId).handsCompleted,
            kind: 'exception',
            message: `子进程启动/通信失败: ${err.message}`,
            reportPath: null,
          });
        });

        child.on('exit', (code, signal) => {
          if (!sawDone) {
            reportFailure({
              chainId: spec.chainId,
              handIndex: findChain(spec.chainId).handsCompleted,
              kind: 'exception',
              message: `子进程异常退出（code=${code ?? '—'}, signal=${signal ?? '—'}）`,
              reportPath: null,
            });
            findChain(spec.chainId).status = 'error';
          }
          resolve();
        });
      })));
    }
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }

  refreshTotals();
  const allCompleted = manifest.chains.every(c => c.status === 'completed');
  manifest.status = failure ? 'error' : allCompleted ? 'completed' : 'interrupted';
  manifest.completedAt = new Date().toISOString();
  manifest.error = failure;
  saveManifest();

  lines.endLine();
  const elapsed = Date.now() - startedAt;
  const totalCompleted = manifest.handsCompleted;
  console.log(`[record] ${failure ? '出错停止' : manifest.status === 'completed' ? '完成' : '已中断'}：`
    + `${fmtInt(totalCompleted)}/${fmtInt(manifest.handsRequested)} 手`
    + ` | 用时 ${formatDuration(elapsed)}`);
  if (failure) console.error(`[record] ${failure.kind}: ${failure.message}`);
  console.log(`[record] 输出 ${outDir}`);

  return failure ? 1 : 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath !== null && invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    code => { process.exitCode = code; },
    err => {
      console.error(`[record] ${messageOf(err)}`);
      if (err instanceof Error && err.stack) console.error(err.stack);
      process.exitCode = 1;
    },
  );
}
