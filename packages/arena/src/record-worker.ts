/**
 * 录制子进程：一条链一个进程，由 record.ts 用 `fork` 启动（argv[2] 是 JSON spec）。
 *
 * 协议（process.send，JSON）：
 *   child → parent  ready | progress(每 1000 手) | done
 *   parent → child  { type: "stop" }
 *
 * 停止语义：收到 stop / SIGINT / SIGTERM / 父进程断开时，只置标志——当前手打完、
 * 写缓冲 flush、footer 写完、文件关闭之后才退出。所以 Ctrl+C 不会丢已完成的整手。
 * 硬杀最多丢最后 flushHands 手，`.idx` 不完整时 reader 可由 `.bin` 重建。
 */
import { runChain, writeErrorReport } from './record-run.js';
import type { ChainErrorInfo, ChainRunResult } from './record-run.js';
import { ChainWriter } from './record-writer.js';
import { strategyByName } from './strategies.js';
import type { Strategy } from './types.js';
import type { RecordWorkerMessage, RecordWorkerSpec } from './record-types.js';

function send(msg: RecordWorkerMessage): void {
  if (!process.send) return;
  try {
    process.send(msg);
  } catch {
    // 父进程已消失：停止上报，让 shouldStop/disconnect 路径收尾
  }
}

function sendAndExit(msg: RecordWorkerMessage, code: number): void {
  if (!process.send) {
    process.exitCode = code;
    return;
  }
  try {
    process.send(msg, undefined, undefined, () => process.exit(code));
  } catch {
    process.exit(code);
  }
}

function fail(chainId: number, kind: string, message: string, completed = 0): void {
  sendAndExit({
    type: 'done',
    chainId,
    status: 'error',
    completed,
    shards: [],
    error: { kind, message, reportPath: null },
  }, 1);
}

async function main(): Promise<void> {
  const rawSpec = process.argv[2];
  if (!rawSpec) {
    fail(0, 'exception', 'record-worker 缺少 JSON 参数');
    return;
  }
  const spec = JSON.parse(rawSpec) as RecordWorkerSpec;
  let strategies: [Strategy, Strategy];
  try {
    strategies = [strategyByName(spec.strategyA), strategyByName(spec.strategyB)];
  } catch (err) {
    fail(spec.chainId, 'exception', err instanceof Error ? err.message : String(err));
    return;
  }

  let stopping = false;
  process.on('message', (message: unknown) => {
    if (typeof message === 'object' && message !== null
      && (message as { type?: unknown }).type === 'stop') {
      stopping = true;
    }
  });
  // 父进程消失（崩溃/被硬杀）时不要留下继续写盘的孤儿进程
  process.on('disconnect', () => { stopping = true; });
  // Ctrl+C 会发给整个前台进程组：子进程也会直接收到 SIGINT
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });

  let writer: ChainWriter;
  try {
    writer = new ChainWriter({
      runDir: spec.runDir,
      chainId: spec.chainId,
      chainSeedHex: spec.seedHex,
      shardHands: spec.shardHands,
      flushHands: spec.flushHands,
    });
  } catch (err) {
    fail(spec.chainId, 'io', err instanceof Error ? err.message : String(err));
    return;
  }

  send({ type: 'ready', chainId: spec.chainId });

  let result: ChainRunResult;
  try {
    result = await runChain({
      chainId: spec.chainId,
      globalStart: spec.globalStart,
      seedHex: spec.seedHex,
      mode: spec.mode,
      handsRequested: spec.handsRequested,
      strategies,
      onRecord: (record, deckHash) => { writer.write(record, deckHash); },
      onProgress: (completed) => {
        send({ type: 'progress', chainId: spec.chainId, completed });
      },
      shouldStop: () => stopping,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack : null;
    const info: ChainErrorInfo = {
      kind: 'exception',
      chainId: spec.chainId,
      globalHandIndex: spec.globalStart,
      chainHandIndex: writer.handsWritten,
      seed: spec.seedHex,
      strategies: { A: spec.strategyA, B: spec.strategyB },
      context: {
        mode: spec.mode, blockIndex: 0, cellIndex: 0, level: 0, declarer: 0,
        attackerLevel: 0, hasAttackerLevel: false, lapA: 0, lapB: 0,
      },
      deck: [],
      event: null,
      state: null,
      message,
      stack,
    };
    result = { status: 'error', handsCompleted: writer.handsWritten, error: info };
  }

  let closeError: string | null = null;
  try {
    writer.close();
  } catch (err) {
    closeError = err instanceof Error ? err.message : String(err);
  }

  let errorPayload: { kind: string; message: string; reportPath: string | null } | undefined;
  if (result.error) {
    let reportPath: string | null = null;
    try {
      reportPath = writeErrorReport(spec.runDir, result.error);
    } catch {
      reportPath = null;
    }
    errorPayload = {
      kind: result.error.kind,
      message: result.error.message,
      reportPath,
    };
  } else if (closeError) {
    errorPayload = { kind: 'io', message: closeError, reportPath: null };
  }

  const status = result.status === 'error' || closeError ? 'error' : result.status;
  sendAndExit({
    type: 'done',
    chainId: spec.chainId,
    status,
    completed: result.handsCompleted,
    shards: writer.shards,
    error: errorPayload,
  }, status === 'error' ? 1 : 0);
}

main().catch(err => {
  fail(0, 'exception', err instanceof Error ? err.message : String(err));
});
