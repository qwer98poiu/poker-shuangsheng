/**
 * Child-process worker pool shared by the general arena and the NT arena.
 *
 * worker_threads + tsx deadlock on Node 17.5 under concurrent work
 * (empirically confirmed across several import/message patterns), so each
 * worker is a child process: its own tsx main thread, loader fully reliable.
 * Tasks go in as JSON lines on stdin, results come back as JSON lines on
 * stdout; a `{type:'ready'}` line marks a worker as available.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ARENA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface WorkerMessage {
  type?: string;
  id: number;
  [key: string]: unknown;
}

export class ChildPool {
  /** Global registry: SIGINT kills everything, even workers still starting up. */
  private static all: ChildProcess[] = [];
  private idle: ChildProcess[] = [];
  private queue: { task: Record<string, unknown>; resolve: (m: WorkerMessage) => void }[] = [];
  private pending = new Map<number, (m: WorkerMessage) => void>();
  private nextId = 1;
  private onReady: (() => void) | null = null;
  private readyCount = 0;
  private closed = false;

  static killAll(): void {
    for (const c of ChildPool.all) c.kill();
  }

  /** Spawn `count` workers of the given script, each with the given argv. */
  static async create(count: number, script: string, args: string[]): Promise<ChildPool> {
    const pool = new ChildPool();
    for (let i = 0; i < count; i++) pool.spawnOne(script, args);
    await pool.waitAllReady(count);
    return pool;
  }

  private spawnOne(script: string, args: string[]): void {
    const child = spawn('npx', ['tsx', path.join(ARENA_ROOT, 'src', script), ...args], {
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
        let m: WorkerMessage;
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
      this.pending.set(q.task.id as number, q.resolve);
      c.stdin!.write(JSON.stringify(q.task) + '\n');
    }
  }

  /** Send one task; resolves with the worker's reply (id included). */
  submit(task: Record<string, unknown>): Promise<WorkerMessage> {
    const full = { ...task, id: this.nextId++ };
    return new Promise(resolve => {
      this.queue.push({ task: full, resolve });
      this.dispatch();
    });
  }

  close(): void {
    this.closed = true;
    ChildPool.killAll();
  }
}
