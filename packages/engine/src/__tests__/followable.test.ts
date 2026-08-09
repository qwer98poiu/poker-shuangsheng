import { describe, it, expect } from 'vitest';
import { Suit } from '../types.js';
import { createCard } from '../model.js';
import { computeFollowableCards } from '../following/index.js';
import type { TrumpDeclaration, Card } from '../types.js';

const cfg5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
// trump = all Jokers, all Hearts, all 5s (any suit)

function c(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }
function ids(cards: Card[] | null): string[] | null {
  return cards === null ? null : cards.map(c => c.id).sort();
}

describe('computeFollowableCards — 可出现在某合法跟牌组合中的牌（UI 灰色判定）', () => {
  it('领出（lead 空）→ null（全可选）', () => {
    const hand = [c('S', 3, 0), c('H', 3, 1)];
    expect(computeFollowableCards(hand, [], cfg5)).toBeNull();
  });

  it('缺门（手牌无 lead 组牌）→ null（可垫/毙任意）', () => {
    const hand = [c('S', 3, 0), c('C', 3, 1)];
    expect(computeFollowableCards(hand, [c('D', 7, 9)], cfg5)).toBeNull();
  });

  it('组牌数 < lead 张数 → null（组牌必出 + 任意填）', () => {
    const hand = [c('D', 3, 0), c('S', 3, 1), c('S', 4, 2)];
    // lead 是方片对子（2 张），手牌只有 1 张方片
    expect(computeFollowableCards(hand, [c('D', 8, 9), c('D', 8, 10)], cfg5)).toBeNull();
  });

  it('组牌数 == lead 张数 → 恰好组牌（唯一可出）', () => {
    const hand = [c('D', 3, 0), c('D', 4, 1), c('S', 3, 2)];
    const got = computeFollowableCards(hand, [c('D', 8, 9), c('D', 8, 10)], cfg5);
    expect(ids(got)).toEqual(['D-3-0', 'D-4-1']);
  });

  it('single lead + 组牌多 → 组牌全可点', () => {
    const hand = [c('D', 3, 0), c('D', 4, 1), c('D', 6, 2), c('S', 3, 3)];
    const got = computeFollowableCards(hand, [c('D', 7, 9)], cfg5);
    expect(ids(got)).toEqual(['D-3-0', 'D-4-1', 'D-6-2']);
  });

  it('pair lead + 手牌有对子 → 只对子牌可点（非对牌灰色）', () => {
    const hand = [c('D', 3, 0), c('D', 3, 1), c('D', 4, 2), c('D', 6, 3), c('S', 3, 4)];
    const got = computeFollowableCards(hand, [c('D', 8, 9), c('D', 8, 10)], cfg5);
    expect(ids(got)).toEqual(['D-3-0', 'D-3-1']); // 只有一对
  });

  it('pair lead + 多个对子 → 所有对子牌可点', () => {
    const hand = [c('D', 3, 0), c('D', 3, 1), c('D', 4, 2), c('D', 4, 3), c('D', 6, 4)];
    const got = computeFollowableCards(hand, [c('D', 8, 9), c('D', 8, 10)], cfg5);
    expect(ids(got)).toEqual(['D-3-0', 'D-3-1', 'D-4-2', 'D-4-3']);
  });

  it('pair lead + 无对子 → 组牌任意（单张组合合法）', () => {
    const hand = [c('D', 3, 0), c('D', 4, 1), c('D', 7, 2), c('D', 6, 3)];
    const got = computeFollowableCards(hand, [c('D', 8, 9), c('D', 8, 10)], cfg5);
    expect(ids(got)).toEqual(['D-3-0', 'D-4-1', 'D-6-3', 'D-7-2']);
  });

  it('tractor lead + 手牌有拖拉机 → 拖拉机牌可点', () => {
    const hand = [c('D', 3, 0), c('D', 3, 1), c('D', 4, 2), c('D', 4, 3), c('D', 6, 4), c('D', 7, 5)];
    // lead 是 3-4 拖拉机（4 张）
    const got = computeFollowableCards(hand, [c('D', 8, 9), c('D', 8, 10), c('D', 9, 11), c('D', 9, 12)], cfg5);
    expect(ids(got)).toEqual(['D-3-0', 'D-3-1', 'D-4-2', 'D-4-3']);
  });

  it('throw lead 含单张（lead 非全对）→ 组牌全可点（fill 空间）', () => {
    const hand = [c('D', 3, 0), c('D', 4, 1), c('D', 7, 2), c('D', 6, 3)];
    // lead = 对子 8 + 单张 9（3 张，含单张）
    const got = computeFollowableCards(hand, [c('D', 8, 9), c('D', 8, 10), c('D', 9, 11)], cfg5);
    expect(ids(got)).toEqual(['D-3-0', 'D-4-1', 'D-6-3', 'D-7-2']);
  });

  it('throw lead 全对（2 对）+ 手牌对子不足 → 组牌全可点（可垫近似组合）', () => {
    const hand = [c('D', 3, 0), c('D', 3, 1), c('D', 4, 2), c('D', 6, 3), c('D', 7, 4)];
    // lead = 方片对子 + 黑桃对子（2 对甩牌，均非主），手牌方片组只有 1 对 → 无法匹配 → 全可点
    const got = computeFollowableCards(hand, [c('D', 7, 9), c('D', 7, 10), c('S', 8, 11), c('S', 8, 12)], cfg5);
    expect(ids(got)).toEqual(['D-3-0', 'D-3-1', 'D-4-2', 'D-6-3', 'D-7-4']);
  });

  it('throw lead 全对（2 对）+ 手牌对子足够 → 只对子牌可点', () => {
    const hand = [c('D', 3, 0), c('D', 3, 1), c('D', 4, 2), c('D', 4, 3), c('D', 6, 4)];
    // 手牌 2 对方片 → 可匹配 2 对 → 只对子牌
    const got = computeFollowableCards(hand, [c('D', 7, 9), c('D', 7, 10), c('S', 8, 11), c('S', 8, 12)], cfg5);
    expect(ids(got)).toEqual(['D-3-0', 'D-3-1', 'D-4-2', 'D-4-3']);
  });

  it('吊主（lead 是主牌组）→ 主牌组判定正确', () => {
    const hand = [c('H', 3, 0), c('H', 4, 1), c('H', 3, 2), c('H', 4, 3), c('D', 3, 4)];
    // 红桃主（cfg5）：lead 红桃对子，手牌有红桃对子
    const got = computeFollowableCards(hand, [c('H', 7, 9), c('H', 7, 10)], cfg5);
    expect(ids(got)).toEqual(['H-3-0', 'H-3-2', 'H-4-1', 'H-4-3']);
    expect(got!.some(card => card.suit === Suit.Diamonds)).toBe(false); // 非主不可点
  });

  it('吊主缺门（无主牌）→ null', () => {
    const hand = [c('D', 3, 0), c('S', 3, 1), c('C', 4, 2)];
    expect(computeFollowableCards(hand, [c('H', 7, 9)], cfg5)).toBeNull();
  });
});
