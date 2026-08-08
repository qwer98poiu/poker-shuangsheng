import { describe, it, expect } from 'vitest';
import { createCard } from '../model.js';
import { Suit } from '../types.js';
import type { Card, CardSuit, Trick, TrumpDeclaration } from '../types.js';
import { computeRoundOutcome } from '../scoring/index.js';

const cfg5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 5 };

function c(s: CardSuit, r: number, i: number): Card {
  return createCard(s, r as any, i);
}

/** 构造一墩：winnerIdx 为赢家（declarer=0 时奇数=闲家）。lead 为领出牌。 */
function trick(winnerIdx: number, lead: Card[]): Trick {
  const play = (cards: Card[]) => ({
    cards,
    pattern: {} as any,
    leadSuit: cards[0].suit as CardSuit,
  });
  return {
    plays: [play(lead), play([c('S', 2, 1)]), play([c('S', 3, 1)]), play([c('S', 4, 1)])] as [any, any, any, any],
    leadPlayerIndex: 0,
    winnerIndex: winnerIdx,
    points: 0,
  };
}

const bottom10 = [c('S', 5, 0), c('S', 5, 1)]; // 10 分

describe('computeRoundOutcome — 上台判定统一用含抠底的闲家最终分', () => {
  it('修复点：原始分 75 < 80，闲家抠底 +10×2 → 最终 95 → 闲家上台（旧 gameLoop 会误判庄家保级）', () => {
    const r = computeRoundOutcome(75, bottom10, trick(1, [c('S', 14, 0)]), cfg5, 0);
    expect(r.finalPts).toBe(95);
    expect(r.attackerWonLast).toBe(true);
    expect(r.attackerSits).toBe(true);
    expect(r.changes).toEqual({ defenderChange: 0, attackerChange: 0 });
    expect(r.multiplier).toBe(2);
  });

  it('庄家赢最后墩 → 底分不计入，上台判定只看原始分', () => {
    const r = computeRoundOutcome(75, bottom10, trick(0, [c('S', 14, 0)]), cfg5, 0);
    expect(r.finalPts).toBe(75);
    expect(r.attackerWonLast).toBe(false);
    expect(r.attackerSits).toBe(false);
    expect(r.changes).toEqual({ defenderChange: 1, attackerChange: 0 }); // 75 分 → 保级
  });

  it('原始分 100 ≥ 80 → 无论谁赢最后墩都上台', () => {
    const r = computeRoundOutcome(100, bottom10, trick(0, [c('S', 14, 0)]), cfg5, 0);
    expect(r.finalPts).toBe(100);
    expect(r.attackerSits).toBe(true);
    expect(r.changes).toEqual({ defenderChange: 0, attackerChange: 0 });
  });

  it('罚分为负 → 最终分钳制为 0，庄家大光 +3', () => {
    const r = computeRoundOutcome(-10, [], trick(0, [c('S', 14, 0)]), cfg5, 0);
    expect(r.finalPts).toBe(0);
    expect(r.attackerSits).toBe(false);
    expect(r.changes).toEqual({ defenderChange: 3, attackerChange: 0 });
  });

  it('抠底倍数：最后一墩领出对子 → ×4', () => {
    const leadPair = [c('S', 14, 0), c('S', 14, 1)];
    const r = computeRoundOutcome(60, bottom10, trick(1, leadPair), cfg5, 0);
    expect(r.multiplier).toBe(4);
    expect(r.finalPts).toBe(100); // 60 + 10×4
    expect(r.attackerSits).toBe(true);
  });

  it('抠底倍数：最后一墩领出 2 连拖拉机（3对连？用对子×4 已覆盖，此处验证 2-pair 拖拉机 ×8）', () => {
    // 拖拉机用 pattern 直接构造不可行（classify 需真实牌），这里构造 S 级牌 A-K-Q 对拖拉机
    // S-A,S-A,S-K,S-K 是 2-pair 拖拉机 → 底牌 ×2^(2+1)=×8
    const leadTractor = [c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1)];
    const r = computeRoundOutcome(60, bottom10, trick(1, leadTractor), cfg5, 0);
    expect(r.multiplier).toBe(8);
    expect(r.finalPts).toBe(140); // 60 + 10×8
    expect(r.attackerSits).toBe(true);
  });

  it('用户示例：闲家得分 160 → attackerChange +2', () => {
    const r = computeRoundOutcome(160, [], trick(1, [c('S', 14, 0)]), cfg5, 0);
    expect(r.finalPts).toBe(160);
    expect(r.attackerSits).toBe(true);
    expect(r.changes).toEqual({ defenderChange: 0, attackerChange: 2 });
  });

  it('实际庄家为 team1（declarer=1）时，闲家=team0：winner 0 赢最后墩视为抠底', () => {
    const cfg1: TrumpDeclaration = { declarerIndex: 1, trumpSuit: Suit.Spades, level: 5 };
    const r = computeRoundOutcome(75, bottom10, trick(0, [c('S', 14, 0)]), cfg1, 1);
    expect(r.attackerWonLast).toBe(true);
    expect(r.finalPts).toBe(95);
    expect(r.attackerSits).toBe(true);
  });

  it('无最后墩（异常路径）→ 按 ×2、不抠底、finalPts=原始分', () => {
    const r = computeRoundOutcome(70, bottom10, null, cfg5, 0);
    expect(r.multiplier).toBe(2);
    expect(r.attackerWonLast).toBe(false);
    expect(r.finalPts).toBe(70);
    expect(r.attackerSits).toBe(false);
    expect(r.changes).toEqual({ defenderChange: 1, attackerChange: 0 });
  });
});
