import { describe, it, expect } from 'vitest';
import { parseLinuxCpuInfo, defaultWorkerCount, splitPairs } from '../workers.js';

describe('parseLinuxCpuInfo', () => {
  it('按 (physical id, core id) 去重：8 个逻辑核 / 4 个物理核', () => {
    const text = [
      'processor: 0\nphysical id: 0\ncore id: 0',
      'processor: 1\nphysical id: 0\ncore id: 1',
      'processor: 2\nphysical id: 0\ncore id: 0',
      'processor: 3\nphysical id: 0\ncore id: 1',
      'processor: 4\nphysical id: 1\ncore id: 0',
      'processor: 5\nphysical id: 1\ncore id: 1',
      'processor: 6\nphysical id: 1\ncore id: 0',
      'processor: 7\nphysical id: 1\ncore id: 1',
    ].join('\n\n');
    expect(parseLinuxCpuInfo(text)).toBe(4);
  });

  it('没有 physical id / core id（容器、部分 ARM）时返回 null', () => {
    const text = 'processor: 0\nmodel name: ARMv8\n\nprocessor: 1\nmodel name: ARMv8';
    expect(parseLinuxCpuInfo(text)).toBeNull();
  });
});

describe('defaultWorkerCount', () => {
  it('取 min(8, 物理核数)，至少 1', () => {
    expect(defaultWorkerCount(8, 2)).toBe(2);
    expect(defaultWorkerCount(8, 12)).toBe(8);
    expect(defaultWorkerCount(8, 0)).toBe(1);
  });
});

describe('splitPairs', () => {
  it('块数约为 workers 的 4 倍，连续覆盖且不重不漏', () => {
    const chunks = splitPairs(200, 4);
    expect(chunks.length).toBe(16);
    expect(chunks[0]).toEqual({ pairStart: 0, pairCount: 13 });
    expect(chunks[chunks.length - 1]).toEqual({ pairStart: 195, pairCount: 5 });
    let next = 0;
    let total = 0;
    for (const c of chunks) {
      expect(c.pairStart).toBe(next);
      expect(c.pairCount).toBeGreaterThan(0);
      next += c.pairCount;
      total += c.pairCount;
    }
    expect(total).toBe(200);
  });

  it('对决数少于 worker 数时仍产出单个块', () => {
    expect(splitPairs(1, 8)).toEqual([{ pairStart: 0, pairCount: 1 }]);
  });
});
