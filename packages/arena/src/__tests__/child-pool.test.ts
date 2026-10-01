import { describe, it, expect } from 'vitest';
import { ChildPool } from '../child-pool.js';
import type { Task } from '../child-pool.js';

/**
 * 假 worker：说与 child-run.ts 同一套 JSON 协议（先来一行 ready，随后每行一个任务
 * 结果），但不经过 tsx —— 直接 `node -e`，测试进程的 execArgv 里没有 loader 也能起。
 * pairStart 兼作模式开关：
 *   0 = 正常应答
 *   1 = 收到任务即崩溃（模拟引擎在某副特定牌上抛异常、或被 OOM killer 杀）
 *   2 = 应答后立刻退出（模拟空闲期死亡：任务已经交回来了，worker 才死）
 */
const FAKE_WORKER = `
const readline = require('readline');
process.stdout.write(JSON.stringify({ type: 'ready' }) + '\\n');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: 100 });
rl.on('line', line => {
  const t = JSON.parse(line);
  if (t.pairStart === 1) process.exit(7);
  const out = JSON.stringify({ id: t.id, statsA: { pairs: t.pairCount }, statsB: { pairs: t.pairCount } });
  if (t.pairStart === 2) process.stdout.write(out + '\\n', () => process.exit(9));
  else process.stdout.write(out + '\\n');
});
`;

const fakeSpawn = (): { cmd: string; args: string[] } => ({ cmd: process.execPath, args: ['-e', FAKE_WORKER] });

/** 与 run.ts 传入的描述器同形：worker 死亡时报出丢失的对决区间。 */
const describePair = (t: Task): string => `对决 ${t.pairStart}..${t.pairStart + t.pairCount - 1}`;

const createPool = (workers: number): Promise<ChildPool> =>
  ChildPool.create(workers, 'child-run.ts', ['42', 'ai', 'ai'], { spawnFn: fakeSpawn, describeTask: describePair });

describe('ChildPool 故障语义', () => {
  it('正常路径：结果按任务 id 返回', async () => {
    const pool = await createPool(2);
    const r = await pool.submit({ pairStart: 0, pairCount: 5 });
    expect(r.statsA).toEqual({ pairs: 5 });
    expect(r.statsB).toEqual({ pairs: 5 });
    pool.close();
  });

  it('worker 在途任务中死亡：任务 reject 并报出丢失的对决区间（不再永久挂起）', async () => {
    const pool = await createPool(1);
    const err = await pool.submit({ pairStart: 1, pairCount: 5 }).then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/^worker 子进程死亡 \(pid=\d+, code=7, signal=—\)/);
    expect(err!.message).toContain('对决 1..5 丢失');
    pool.close();
  });

  it('池判废后 submit 立即失败，不再排队等一个不会来的 worker', async () => {
    const pool = await createPool(1);
    await expect(pool.submit({ pairStart: 1, pairCount: 5 })).rejects.toThrow(/本轮已中止/);
    await expect(pool.submit({ pairStart: 0, pairCount: 5 })).rejects.toThrow(/本轮已中止/);
    pool.close();
  });

  it('空闲期死亡（任务已交回）：同样判废，后续 submit 不挂起', async () => {
    const pool = await createPool(1);
    expect((await pool.submit({ pairStart: 2, pairCount: 5 })).statsA).toEqual({ pairs: 5 });
    // 等子进程的 exit 事件落地，好断言确定的那条消息分支（否则可能撞上「派发任务失败」）
    await new Promise(r => setTimeout(r, 100));
    await expect(pool.submit({ pairStart: 0, pairCount: 5 })).rejects.toThrow(/空闲等待时死亡/);
    pool.close();
  });
});
