import { describe, it, expect } from 'vitest';
import type { Reveal } from '@poker/engine';
import { successfulReveals, isCurrentReveal, revealDisplayCards } from '../components/game/CenterArea.js';

const rev = (playerIndex: number, suit: string | null, strength: number): Reveal =>
  ({ playerIndex, suit: suit as any, strength });

describe('successfulReveals — 只保留成功的亮/反主（失败尝试过滤）', () => {
  it('空历史 → 空', () => {
    expect(successfulReveals([])).toEqual([]);
  });

  it('单次亮主 → 保留', () => {
    const r = rev(0, 'S', 1);
    expect(successfulReveals([r])).toEqual([r]);
  });

  it('连续反主链 → 全部保留（单张♠2 → 对♥2 → 对大王无主）', () => {
    const a = rev(0, 'S', 1), b = rev(2, 'H', 2), c = rev(3, null, 4);
    expect(successfulReveals([a, b, c])).toEqual([a, b, c]);
  });

  it('失败尝试（同力量/反后再亮弱牌）被过滤', () => {
    const a = rev(0, 'S', 1);
    const weak = rev(1, 'H', 1);   // 同力量不能反
    const pair = rev(2, 'H', 2);
    const weak2 = rev(3, 'C', 1);  // 反主后再亮弱牌失败
    const nope = rev(0, 'D', 2);   // 力量相等不覆盖
    expect(successfulReveals([a, weak, pair, weak2, nope])).toEqual([a, pair]);
  });
});

describe('isCurrentReveal — 当前主判定（未被反）', () => {
  const cur = rev(2, 'H', 2);
  it('同玩家同牌 → 当前', () => {
    expect(isCurrentReveal(rev(2, 'H', 2), cur)).toBe(true);
  });
  it('玩家/花色/力量任一不同 → 非当前', () => {
    expect(isCurrentReveal(rev(0, 'H', 2), cur)).toBe(false);
    expect(isCurrentReveal(rev(2, 'S', 2), cur)).toBe(false);
    expect(isCurrentReveal(rev(2, 'H', 1), cur)).toBe(false);
  });
  it('current 为空 → false', () => {
    expect(isCurrentReveal(rev(2, 'H', 2), null)).toBe(false);
  });
});

describe('revealDisplayCards — 亮主展示牌（单张 1 张、对牌 2 张）', () => {
  it('单张级牌 → 1 张（rank = 级数）', () => {
    const cards = revealDisplayCards(rev(0, 'S', 1), 2);
    expect(cards).toHaveLength(1);
    expect(cards[0].suit).toBe('S');
    expect(cards[0].rank).toBe(2);
    expect(cards[0].isJoker).toBe(false);
  });

  it('对级牌 → 2 张同花色同级数，id 唯一', () => {
    const cards = revealDisplayCards(rev(2, 'H', 2), 5);
    expect(cards).toHaveLength(2);
    expect(cards.every(c => c.suit === 'H' && c.rank === 5 && !c.isJoker)).toBe(true);
    expect(cards[0].id).not.toBe(cards[1].id);
  });

  it('对小王无主（strength 3）→ 2 张小王', () => {
    const cards = revealDisplayCards(rev(3, null, 3), 2);
    expect(cards).toHaveLength(2);
    expect(cards.every(c => c.isJoker && c.rank === 15)).toBe(true);
  });

  it('对大王无主（strength 4）→ 2 张大王', () => {
    const cards = revealDisplayCards(rev(1, null, 4), 2);
    expect(cards).toHaveLength(2);
    expect(cards.every(c => c.isJoker && c.rank === 16)).toBe(true);
  });
});
