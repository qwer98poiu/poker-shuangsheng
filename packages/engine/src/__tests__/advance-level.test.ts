import { describe, it, expect } from 'vitest';
import { computeLevelChange } from '../scoring/index.js';
import { advanceLevel } from '../scoring/index.js';

/**
 * 闭式规格（与实现独立）：必打 K/A 升级规则。
 * 庄家赢（finalPts<80）: <13 → min(+d,13); 13 → 14; 14 → 胜出
 * 闲家上台（≥80）: N≤13 → min(N+M,13); 14 → 不变
 */
function expected(L: number, P: number) {
  const attackerSits = P >= 80;
  const changes = computeLevelChange(P);
  const change = attackerSits ? changes.attackerChange : changes.defenderChange;
  let newLevel: number;
  let matchOver: boolean;
  if (L <= 12) {
    newLevel = Math.min(L + change, 13);
    matchOver = false;
  } else if (L === 13) {
    newLevel = attackerSits ? 13 : 14;
    matchOver = false;
  } else {
    newLevel = 14;
    matchOver = !attackerSits;
  }
  return { newLevel, matchOver, attackerSits };
}

describe('advanceLevel 必打 K/A', () => {
  it('穷举 L∈2..14 × P∈[0,5,40,80,120,160,320] 与闭式规则一致', () => {
    for (let L = 2; L <= 14; L++) {
      for (const P of [0, 5, 40, 80, 120, 160, 320]) {
        const r = advanceLevel(L, P);
        const e = expected(L, P);
        expect(r.newLevel).toBe(e.newLevel);
        expect(r.matchOver).toBe(e.matchOver);
        expect(r.attackerSits).toBe(e.attackerSits);
      }
    }
  });

  it('用户示例：闲家 Q(12) 得分160 → 只能升到 K(13) 当庄', () => {
    const r = advanceLevel(12, 160);
    expect(r.attackerSits).toBe(true);
    expect(r.newLevel).toBe(13);
    expect(r.matchOver).toBe(false);
  });

  it('用户示例：庄家 K(13) 小光 → 升到 A(14) 继续当庄', () => {
    const r = advanceLevel(13, 20);
    expect(r.attackerSits).toBe(false);
    expect(r.newLevel).toBe(14);
    expect(r.matchOver).toBe(false);
  });

  it('用户示例：庄家 A(14) 打赢 → 胜出', () => {
    const r = advanceLevel(14, 40);
    expect(r.attackerSits).toBe(false);
    expect(r.newLevel).toBe(14);
    expect(r.matchOver).toBe(true);
  });

  it('用户修正：闲家 K(13) 上台 +2 → 停在 K(13) 当庄打 K', () => {
    const r = advanceLevel(13, 160);
    expect(r.attackerSits).toBe(true);
    expect(r.newLevel).toBe(13);
    expect(r.matchOver).toBe(false);
  });

  it('用户示例：闲家 A(14) 上台（120分+1级）→ 停在 A 打 A，不直接胜出', () => {
    const r = advanceLevel(14, 120);
    expect(r.attackerSits).toBe(true);
    expect(r.newLevel).toBe(14);
    expect(r.matchOver).toBe(false);
  });

  it('庄家 Q(12) 大光 → 停在 K(13) 打 K（不可跳过 K）', () => {
    const r = advanceLevel(12, 0);
    expect(r.attackerSits).toBe(false);
    expect(r.newLevel).toBe(13);
    expect(r.matchOver).toBe(false);
  });

  it('闲家 80-115 上台不升级（等级不变）', () => {
    const r = advanceLevel(9, 90);
    expect(r.attackerSits).toBe(true);
    expect(r.newLevel).toBe(9);
    expect(r.matchOver).toBe(false);
  });

  it('庄家 A(14) 保级 → 胜出（任何上台打赢都结束对局）', () => {
    const r = advanceLevel(14, 40);
    const r2 = advanceLevel(14, 0);
    expect(r.matchOver).toBe(true);
    expect(r2.matchOver).toBe(true);
  });
});
