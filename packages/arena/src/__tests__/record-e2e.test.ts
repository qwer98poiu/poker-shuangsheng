import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readManifest, RecordDataset } from '../record-codec.js';
import { advanceRules, initialRulesState } from '../record-run.js';
import type { RulesState } from '../record-run.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../../');
const ARENA_ROOT = path.resolve(HERE, '../..');
const CLI = path.join(ARENA_ROOT, 'src', 'record.ts');
// 测试进程的 execArgv 没有 tsx loader，显式复用仓库内 tsx（子进程 fork 会继承）。
const TSX_PREFLIGHT = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'preflight.cjs');
const TSX_LOADER = pathToFileURL(path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;

interface CliResult { code: number; stdout: string; stderr: string }

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--require', TSX_PREFLIGHT, '--loader', TSX_LOADER, CLI, ...args,
    ], { cwd: ARENA_ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', code => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function tmpOut(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-e2e-'));
  return path.join(dir, 'run');
}

describe('record CLI e2e', () => {
  it('--hands 520 --workers 1 --context random：10 个完整块，每 cell 恰一次', async () => {
    const out = tmpOut();
    const result = await runCli([
      '--hands', '520', '--workers', '1', '--context', 'random', '--seed', '42', '--out', out,
    ]);
    expect(result.code).toBe(0);
    expect(result.stderr).not.toMatch(/出错停止/);

    const manifest = readManifest(out);
    expect(manifest.status).toBe('completed');
    expect(manifest.handsRequested).toBe(520);
    expect(manifest.handsCompleted).toBe(520);
    expect(manifest.contextMode).toBe('random');
    expect(manifest.seed.base).toBe('000000000000002a');
    expect(manifest.seed.source).toBe('cli');
    expect(manifest.chains).toHaveLength(1);
    expect(manifest.chains[0].status).toBe('completed');

    const dataset = RecordDataset.open(out);
    expect(dataset.chainHandCount(0)).toBe(520);
    const perBlock = new Map<number, Set<number>>();
    for (let i = 0; i < 520; i++) {
      const record = dataset.getHand(i);
      if (!record) throw new Error(`缺少第 ${i} 手`);
      expect(record.globalHandIndex).toBe(i);
      expect(record.chainHandIndex).toBe(i);
      const cells = perBlock.get(record.blockIndex) ?? new Set<number>();
      cells.add(record.cellIndex);
      perBlock.set(record.blockIndex, cells);
    }
    expect([...perBlock.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const cells of perBlock.values()) expect(cells.size).toBe(52);
    dataset.close();
  }, 180_000);

  it('--hands 1040 --workers 2：两链各 520，全局 index 跨链映射正确', async () => {
    const out = tmpOut();
    const result = await runCli([
      '--hands', '1040', '--workers', '2', '--context', 'random', '--seed', '7', '--out', out,
    ]);
    expect(result.code).toBe(0);

    const manifest = readManifest(out);
    expect(manifest.status).toBe('completed');
    expect(manifest.handsCompleted).toBe(1040);
    expect(manifest.chains.map(c => [c.globalStart, c.handsRequested, c.handsCompleted]))
      .toEqual([[0, 520, 520], [520, 520, 520]]);

    const dataset = RecordDataset.open(out);
    const first = dataset.getHand(0);
    const lastFirst = dataset.getHand(519);
    const firstSecond = dataset.getHand(520);
    const last = dataset.getHand(1039);
    expect(first?.chainHandIndex).toBe(0);
    expect(first?.globalHandIndex).toBe(0);
    expect(lastFirst?.chainHandIndex).toBe(519);
    expect(firstSecond?.globalHandIndex).toBe(520);
    expect(firstSecond?.chainHandIndex).toBe(0);
    expect(last?.globalHandIndex).toBe(1039);
    expect(last?.chainHandIndex).toBe(519);
    expect(dataset.getHand(1040)).toBeNull();
    expect(dataset.chainHandCount(0)).toBe(520);
    expect(dataset.chainHandCount(1)).toBe(520);
    dataset.close();
  }, 180_000);

  it('--hands 200 --workers 1 --context rules：首局 P0/2 级，等级循环与记录一致', async () => {
    const out = tmpOut();
    const result = await runCli([
      '--hands', '200', '--workers', '1', '--context', 'rules', '--seed', '42', '--out', out,
    ]);
    expect(result.code).toBe(0);
    expect(result.stderr).not.toMatch(/出错停止/);

    const manifest = readManifest(out);
    expect(manifest.status).toBe('completed');
    expect(manifest.contextMode).toBe('rules');
    expect(manifest.handsCompleted).toBe(200);

    const dataset = RecordDataset.open(out);
    const first = dataset.getChainHand(0, 0);
    if (!first) throw new Error('缺少首手');
    expect(first.declarer).toBe(0);
    expect(first.level).toBe(2);

    let state: RulesState = initialRulesState();
    for (let i = 0; i < 200; i++) {
      const record = dataset.getChainHand(0, i);
      if (!record) throw new Error(`缺少第 ${i} 手`);
      expect(record.declarer).toBe(state.declarerIdx);
      expect(record.level).toBe(state.levels[record.declarer % 2]);
      const adv = advanceRules(state, record.finalPts);
      expect(record.levelAfterA).toBe(adv.state.levels[0]);
      expect(record.levelAfterB).toBe(adv.state.levels[1]);
      expect(record.nextDeclarer).toBe(adv.nextDeclarer);
      state = adv.state;
    }
    dataset.close();
  }, 180_000);

  it('参数校验：hands 0 / 已存在的目录 / 未知策略都以非零码退出', async () => {
    const out = tmpOut();
    const zero = await runCli(['--hands', '0', '--out', out]);
    expect(zero.code).toBe(1);
    expect(zero.stderr).toMatch(/--hands/);

    fs.mkdirSync(out, { recursive: true });
    const exists = await runCli(['--hands', '1', '--out', out]);
    expect(exists.code).toBe(1);
    expect(exists.stderr).toMatch(/输出目录已存在/);

    const unknown = await runCli(['--hands', '1', '--strategy-a', 'nope', '--out', tmpOut()]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/未知策略/);
    expect(unknown.stderr).toMatch(/ai-1018/);
  }, 120_000);
});
