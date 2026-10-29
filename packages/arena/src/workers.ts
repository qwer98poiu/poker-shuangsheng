/**
 * Worker 数默认值：按物理核而不是逻辑核。
 *
 * Node 不暴露物理核数。macOS 读 `sysctl -n hw.physicalcpu`；Linux 解析
 * `/proc/cpuinfo` 的 (physical id, core id) 去重；探测失败时退回逻辑核数
 * （宁可多用也不悄悄少用）。
 *
 * 超线程并不带来线性吞吐：本机 4 逻辑核 / 2 物理核实测，record 4,000 手
 * 4 worker 反而比 2 worker 慢（35s vs 30s）。CLI 的 `--workers` 仍可显式覆盖。
 */
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

export const MAX_DEFAULT_WORKERS = 8;

/** 解析 /proc/cpuinfo 的 (physical id, core id) 去重数；无这两项时返回 null。 */
export function parseLinuxCpuInfo(text: string): number | null {
  const pairs = new Set<string>();
  for (const block of text.split(/\n\s*\n/)) {
    const physical = /^physical id\s*:\s*(\d+)\s*$/m.exec(block);
    const core = /^core id\s*:\s*(\d+)\s*$/m.exec(block);
    if (physical && core) pairs.add(`${physical[1]}:${core[1]}`);
  }
  return pairs.size > 0 ? pairs.size : null;
}

function detectPhysicalCores(): number | null {
  if (process.platform === 'darwin') {
    const r = spawnSync('sysctl', ['-n', 'hw.physicalcpu'], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    const n = Number.parseInt(r.stdout.trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  if (process.platform === 'linux') {
    try {
      return parseLinuxCpuInfo(fs.readFileSync('/proc/cpuinfo', 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

/** 物理核数（探测不到时退回逻辑核数）。 */
export function physicalCoreCount(): number {
  return detectPhysicalCores() ?? Math.max(1, os.cpus().length);
}

/**
 * 默认 worker 数 = min(max, 物理核数)，至少 1。
 * `physical` 仅供测试注入。
 */
export function defaultWorkerCount(
  max = MAX_DEFAULT_WORKERS,
  physical = physicalCoreCount(),
): number {
  return Math.max(1, Math.min(max, physical));
}

export interface PairChunk {
  pairStart: number;
  pairCount: number;
}

/**
 * 把 [0, pairs) 切成大小尽量均匀的连续块，块数约为 workers 的 4 倍
 * （每个 worker 分到多块，长任务不至于让别的 worker 空等）。
 */
export function splitPairs(pairs: number, workers: number): PairChunk[] {
  if (pairs <= 0) return [];
  const chunkSize = Math.max(1, Math.ceil(pairs / (Math.max(1, workers) * 4)));
  const chunks: PairChunk[] = [];
  for (let start = 0; start < pairs; start += chunkSize) {
    chunks.push({ pairStart: start, pairCount: Math.min(chunkSize, pairs - start) });
  }
  return chunks;
}
