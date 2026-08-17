import { describe, it, expect } from 'vitest';
import type { Reveal } from '@poker/engine';
import { successfulReveals, displayReveals, isCurrentReveal, revealDisplayCards } from '../components/game/CenterArea.js';
import { finalRevealChip } from '../components/game/PlayerSeat.js';

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

describe('displayReveals — 自保直接替换，其余被反保留', () => {
  it('空/单条 → 原样', () => {
    expect(displayReveals([])).toEqual([]);
    const r = rev(0, 'S', 1);
    expect(displayReveals([r])).toEqual([r]);
  });

  it('自保（单♠2 → 对♠2 同玩家同花色）→ 旧记录不显示，只留对子', () => {
    const single = rev(0, 'S', 1), pair = rev(0, 'S', 2);
    expect(displayReveals([single, pair])).toEqual([pair]);
  });

  it('反主（不同玩家不同花色）→ 两条都显示（旧记录置灰）', () => {
    const a = rev(0, 'S', 1), b = rev(2, 'H', 2);
    expect(displayReveals([a, b])).toEqual([a, b]);
  });

  it('同花色异玩家反主（P0 单♠2 → P2 对♠2）→ 非自保，单张保留置灰', () => {
    const a = rev(0, 'S', 1), b = rev(2, 'S', 2);
    expect(displayReveals([a, b])).toEqual([a, b]);
  });

  it('链：单♠2 自保成对 → 被 P2 反 → 只显示对♠2（灰）+ 当前主', () => {
    const single = rev(0, 'S', 1), pair = rev(0, 'S', 2), nt = rev(2, null, 4);
    expect(displayReveals([single, pair, nt])).toEqual([pair, nt]);
  });
});

describe('finalRevealChip — 最终亮主小牌（替代主牌指示器）', () => {
  it('有主单张：级牌+花色（2♠ 黑），1 张', () => {
    expect(finalRevealChip(rev(0, 'S', 1), 2)).toEqual({ label: '2♠', red: false, count: 1 });
  });

  it('有主对子：级牌+花色（5♥ 红），显示两张', () => {
    expect(finalRevealChip(rev(2, 'H', 2), 5)).toEqual({ label: '5♥', red: true, count: 2 });
  });

  it('无主对大王（strength 4）→ JO 红，两张', () => {
    expect(finalRevealChip(rev(1, null, 4), 2)).toEqual({ label: 'JO', red: true, count: 2 });
  });

  it('无主对小王（strength 3）→ jo 黑，两张', () => {
    expect(finalRevealChip(rev(3, null, 3), 2)).toEqual({ label: 'jo', red: false, count: 2 });
  });
});
