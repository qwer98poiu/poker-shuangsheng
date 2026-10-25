import { describe, it, expect } from 'vitest';
import * as engine from '@poker/engine';
import * as baselines from '@poker/ai-baselines';

/**
 * 过渡期不变量：engine 仍导出的每个 aiXXXX 快照，都必须在
 * `@poker/ai-baselines` 以同一对象身份可达。归档存量基线时同步更新
 * 下面的期望集合；新基线进入 ai-baselines 后不会出现在 engine 中。
 */
describe('baseline facade', () => {
  it('engine 的每个 aiXXXX 命名空间都由 @poker/ai-baselines 同身份导出', () => {
    const engineBaselines = Object.keys(engine)
      .filter((name) => /^ai\d{4}$/.test(name))
      .sort();
    expect(engineBaselines).toEqual(['ai0816', 'ai0907', 'ai0929', 'ai1005', 'ai1018']);

    const facade = baselines as Record<string, unknown>;
    const exported = engine as Record<string, unknown>;
    for (const name of engineBaselines) {
      expect(facade[name]).toBe(exported[name]);
    }
  });
});
