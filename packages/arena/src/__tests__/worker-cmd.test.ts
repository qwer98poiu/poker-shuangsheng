import { describe, it, expect } from 'vitest';
import { workerCommand } from '../worker-cmd.js';

describe('worker 启动命令', () => {
  it('用父进程同一个 node + tsx loader，参数原样透传', () => {
    const { cmd, args } = workerCommand('/arena/src/child-run.ts', 45, 'ai', 'ai-0802');
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([...process.execArgv, '/arena/src/child-run.ts', '45', 'ai', 'ai-0802']);
  });

  it('不经过 npx：npm 解析 tsx 要走 registry，4 个 worker 并发时会卡死（2026-09-30）', () => {
    const { cmd, args } = workerCommand('/arena/src/child-run.ts', 42, 'ai', 'ai-0927');
    expect(cmd).not.toContain('npx');
    expect(args.filter(a => a.includes('npx'))).toEqual([]);
  });
});
