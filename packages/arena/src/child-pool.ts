/**
 * 竞技场 worker 池：把一个区间的任务切片派发给 N 个常驻子进程。
 * 整体竞技场（对决区间）与无主竞技场（发牌区间）共用这一份实现。
 *
 * 用子进程而不是 worker_threads：tsx 的 loader 在 Node 17.5 的 worker 线程里
 * 并发工作会死锁（多种消息模式实测均如此）；子进程各有独立主线程，loader 可靠。
 *
 * 故障语义：**任何** worker 意外退出都判整池失败——在途任务与队列里的任务全部
 * reject，之后的 submit 立即失败。worker 死亡若不出声，等待它的 Promise 就再无人
 * resolve，调用方的 Promise.all 会永久挂起（启动期的同类挂死由 waitAllReady 的
 * 看门狗负责，这里是运行期的那一半，2026-10-01 补上）。
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { workerCommand } from './worker-cmd.js';

export const ARENA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 子进程启动（含 tsx 加载）常态 1~3s；60s 仍未全部就绪即判定池启动失败。 */
const STARTUP_TIMEOUT_MS = 60_000;

/** 任务与结果的公共形状：id 由池分配，其余字段由调用方定义（对决/发牌区间）。 */
export interface Task { id: number; [key: string]: any }
export interface WorkerResult { id: number; [key: string]: any }

/** 一个任务的 settle 回调；派发到 worker 前后都得留着，池判废时要主动 reject。 */
interface Settle {
  resolve: (m: WorkerResult) => void;
  reject: (e: Error) => void;
}

interface QueuedTask extends Settle { task: Task }

/** 生成 worker 启动命令。默认 workerCommand；测试注入假 worker 以摆脱 tsx 依赖。 */
export type SpawnFn = (script: string, args: string[]) => { cmd: string; args: string[] };

const defaultSpawn: SpawnFn = (script, args) =>
  workerCommand(path.join(ARENA_ROOT, 'src', script), args);

export interface PoolOptions {
  spawnFn?: SpawnFn;
  /** 在途任务的描述（worker 死亡时报出「丢了什么」），默认只报任务 id。 */
  describeTask?: (task: Task) => string;
}

export class ChildPool {
  /** 全局子进程注册表：SIGINT 时即使池尚未完成创建也能全部终止。 */
  private static all: ChildProcess[] = [];

  private idle: ChildProcess[] = [];
  private queue: QueuedTask[] = [];
  /** 已派发、等结果的任务：任务 id → settle 回调。 */
  private pending = new Map<number, Settle>();
  /** 在途任务的归属：worker → 任务。只用于报出「死时正在跑哪个对决区间」。 */
  private inFlight = new Map<ChildProcess, Task>();
  private nextId = 1;
  /** 池已判废：非 null 时 submit 直接失败，不再排队等一个不会来的 worker。 */
  private broken: Error | null = null;
  private closed = false;

  private readyCount = 0;
  /** 全部就绪 / 已失败，之后忽略 ready 与失败回调。 */
  private readySettled = false;
  private onReady: (() => void) | null = null;
  private failStartup: ((e: Error) => void) | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;

  static killAll(): void {
    for (const c of ChildPool.all) c.kill();
  }

  /**
   * 起 `count` 个常驻子进程，每个跑 `src/<script>` 并原样带上 `args`
   * （child-run.ts / nt-child-run.ts 都取 `<seed> <strategyA> <strategyB>`）。
   */
  static async create(
    count: number, script: string, args: string[], opts: PoolOptions = {},
  ): Promise<ChildPool> {
    const pool = new ChildPool(opts.spawnFn ?? defaultSpawn, opts.describeTask);
    for (let i = 0; i < count; i++) {
      pool.spawnOne(script, args);
    }
    await pool.waitAllReady(count);
    return pool;
  }

  private constructor(
    private readonly spawnFn: SpawnFn,
    private readonly describeTask?: (task: Task) => string,
  ) {}

  private spawnOne(script: string, args: string[]): void {
    const { cmd, args: argv } = this.spawnFn(script, args);
    const child = spawn(cmd, argv, {
      cwd: ARENA_ROOT,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    ChildPool.all.push(child);
    let ready = false;
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
        if (this.broken) continue; // 池已判废，迟到/残留的输出一律忽略
        if (m.type === 'ready') {
          ready = true;
          this.idle.push(child);
          this.onReady?.();
          continue;
        }
        const settle = this.pending.get(m.id);
        if (settle) {
          this.pending.delete(m.id);
          settle.resolve(m);
        } else {
          console.error(`子进程返回未知任务 id=${m.id}`);
        }
        this.inFlight.delete(child);
        this.idle.push(child);
        this.dispatch();
      }
    });
    child.on('error', (e: Error) => {
      console.error(`子进程错误: ${e.message}`);
      process.exitCode = 1;
    });
    // 向已死的 worker 写 stdin 会得到 EPIPE：不接住就是未处理的 'error' 事件，
    // 父进程直接崩掉——那比挂死好，但也不是我们要的「一条明确错误」。
    child.stdin!.on('error', (e: Error) => {
      if (this.closed) return;
      this.failPool(new Error(`向 worker (pid=${child.pid}) 派发任务失败: ${e.message}，本轮已中止`));
    });
    child.on('exit', (code, signal) => {
      if (this.closed) return;
      const at = this.idle.indexOf(child);
      if (at >= 0) this.idle.splice(at, 1); // 死掉的 worker 不能再被派发
      const task = this.inFlight.get(child);
      const where = task
        ? `${this.describeTask ? this.describeTask(task) : `任务 id=${task.id}`} 丢失`
        : '空闲等待时死亡';
      this.failPool(new Error(
        ready
          ? `worker 子进程死亡 (pid=${child.pid}, code=${code}, signal=${signal ?? '—'})，${where}，本轮已中止`
          // 未就绪就退出（code 0 也算）：ready 永远不会到来，立刻失败而不是永久等待
          : `子进程未就绪即退出 (code=${code}, pid=${child.pid})`,
      ));
    });
  }

  private waitAllReady(count: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const clear = (): void => {
        if (this.startupTimer) clearTimeout(this.startupTimer);
        this.startupTimer = null;
      };
      const fail = (e: Error): void => {
        if (this.readySettled) return;
        this.readySettled = true;
        clear();
        reject(e);
      };
      this.failStartup = fail;
      this.onReady = () => {
        if (this.readySettled) return;
        this.readyCount += 1;
        if (this.readyCount < count) return;
        this.readySettled = true;
        clear();
        resolve();
      };
      // 看门狗：子进程既不 ready 也不退出时（2026-09-30 的 npx 卡死即此形态），
      // 必须报错退出，而不是让 CLI 无任何输出地永久等待。
      this.startupTimer = setTimeout(
        () => fail(new Error(`${STARTUP_TIMEOUT_MS / 1000}s 内只有 ${this.readyCount}/${count} 个子进程就绪，无法启动 worker 池`)),
        STARTUP_TIMEOUT_MS,
      );
    });
  }

  private dispatch(): void {
    while (!this.broken && this.idle.length > 0 && this.queue.length > 0) {
      const c = this.idle.pop()!;
      const q = this.queue.shift()!;
      this.pending.set(q.task.id, { resolve: q.resolve, reject: q.reject });
      this.inFlight.set(c, q.task);
      c.stdin!.write(JSON.stringify(q.task) + '\n');
    }
  }

  /** 派发一个任务（id 由池分配）；结果原样带回 worker 的 JSON 行。 */
  submit(task: Record<string, any>): Promise<WorkerResult> {
    if (this.broken) return Promise.reject(this.broken);
    const full: Task = { ...task, id: this.nextId++ };
    return new Promise((resolve, reject) => {
      this.queue.push({ task: full, resolve, reject });
      this.dispatch();
    });
  }

  /**
   * 判废整池：worker 死亡后，在途的与仍在排队的任务都必须有归宿，否则它们的
   * Promise 永远不会 settle，调用方的 Promise.all 静默挂死。
   */
  private failPool(reason: Error): void {
    if (this.broken) return;
    this.broken = reason;
    this.failStartup?.(reason); // 启动期一并了结 waitAllReady（已 settle 时是 no-op）
    for (const s of this.pending.values()) s.reject(reason);
    this.pending.clear();
    this.inFlight.clear();
    for (const q of this.queue) q.reject(reason);
    this.queue.length = 0;
  }

  close(): void {
    this.closed = true;
    ChildPool.killAll();
  }
}
