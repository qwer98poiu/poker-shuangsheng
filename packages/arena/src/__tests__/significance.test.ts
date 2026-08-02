import { describe, it, expect } from 'vitest';
import { checkSignificance, requiredMatchesForSignificance, Z } from '../significance.js';

describe('checkSignificance (99% Wilson 下界)', () => {
  it('p̂=0.52, n=10000 → 显著，leader=A', () => {
    const r = checkSignificance(5200, 4800, 0, 10000);
    expect(r.significant).toBe(true);
    expect(r.leader).toBe('A');
    expect(r.pHat).toBe(0.52);
    expect(r.ciLower).toBeCloseTo(0.5071213064332735, 10);
  });

  it('p̂=1, n=1 → 不显著（Wilson 正确处理极端值）', () => {
    const r = checkSignificance(1, 0, 0, 1);
    expect(r.significant).toBe(false);
    expect(r.pHat).toBe(1);
    expect(r.ciLower).toBeCloseTo(0.13096245882540286, 10);
  });

  it('p̂=1, n=10000 → 显著', () => {
    const r = checkSignificance(10000, 0, 0, 10000);
    expect(r.significant).toBe(true);
    expect(r.leader).toBe('A');
    expect(r.ciLower).toBeCloseTo(0.9993368624432285, 10);
  });

  it('平局按 0.5 胜计入：100/90/10 → p̂=0.525 但不显著', () => {
    const r = checkSignificance(100, 90, 10, 200);
    expect(r.significant).toBe(false);
    expect(r.leader).toBe('A');
    expect(r.pHat).toBe(0.525);
    expect(r.ciLower).toBeCloseTo(0.43470458410012824, 10);
  });

  it('完全平局 → leader=null 不显著', () => {
    const r = checkSignificance(5, 5, 0, 10);
    expect(r.significant).toBe(false);
    expect(r.leader).toBeNull();
    expect(r.pHat).toBe(0.5);
  });

  it('leader 为 B 时检验 B 的胜率', () => {
    const r = checkSignificance(4, 6, 0, 10);
    expect(r.leader).toBe('B');
    expect(r.pHat).toBe(0.6);
    expect(r.significant).toBe(false);
  });

  it('自定义 z（如 95% 水平）生效', () => {
    // z=1.96：p̂=0.6, n=50 的 95% Wilson 下界约 0.462 → 不显著
    const r = checkSignificance(30, 20, 0, 50, 1.96);
    expect(r.leader).toBe('A');
    expect(r.pHat).toBe(0.6);
    expect(r.significant).toBe(false);
  });

  it('Z 常量为 2.576（99%）', () => {
    expect(Z).toBe(2.576);
  });
});

describe('requiredMatchesForSignificance（动态进度基准）', () => {
  it('p̂=0.51（5100/10000）→ 推算显著所需 17000 场（1000 的整数倍）', () => {
    const required = requiredMatchesForSignificance(5100, 4900, 0, 10000, 1000, 100000);
    expect(required).toBe(17000);
    expect(required % 1000).toBe(0);
  });

  it('p̂=0.5032（5032/10000）→ 推算需约 16 万场，超过上限时返回第一个越过上限的倍数', () => {
    const required = requiredMatchesForSignificance(5032, 4968, 0, 10000, 1000, 100000);
    expect(required).toBe(101000);
  });

  it('p̂=0.5 → Infinity（显著性不可达）', () => {
    expect(requiredMatchesForSignificance(5000, 5000, 0, 10000, 1000, 100000)).toBe(Infinity);
  });

  it('当前已显著 → 返回当前场数', () => {
    // p̂=0.52, n=10000 已显著（ciLower≈0.5071 > 0.5）
    expect(requiredMatchesForSignificance(5200, 4800, 0, 10000, 1000, 100000)).toBe(10000);
  });

  it('平局按 0.5 胜计入：p̂ 相同的结果一致', () => {
    // 100 胜 + 10 平 → scoreA = 105 / 200 场 = p̂ 0.525
    const a = requiredMatchesForSignificance(100, 90, 10, 200, 100, 100000);
    // 1000 胜 + 100 平 → scoreA = 1050 / 2000 场 = p̂ 同样 0.525
    const b = requiredMatchesForSignificance(1000, 900, 100, 2000, 100, 100000);
    expect(a).toBe(b);
    expect(a).toBe(2700);
  });
});
