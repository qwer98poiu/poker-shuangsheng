import { describe, it, expect } from 'vitest';
import { createCard, GamePhase, Suit } from '@poker/engine';
import type { Card, TrumpDeclaration } from '@poker/engine';
import { computePlayableIds, computeFollowPlan, canSubmitPlay, bottomExchangeStatus } from '../components/game/playable.js';

const c = (s: string, r: number, i: number): Card => createCard(s as any, r as any, i);
const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
const play = (cards: Card[], leadSuit: Suit | null): any => ({ cards, pattern: {}, leadSuit });

describe('computePlayableIds — 不符合规则的牌灰色不可选', () => {
  it('领出或非 Playing 阶段 → 全可选（null）', () => {
    const hand = [c('S', 3, 0), c('H', 3, 1)];
    expect(computePlayableIds(hand, [], cfg, GamePhase.Playing)).toBeNull();
    expect(computePlayableIds(hand, [play([c('S', 5, 9)], Suit.Spades)], cfg, GamePhase.BottomExchange)).toBeNull();
  });

  it('领副牌：手牌有同花色（非主）→ 仅同花色可选', () => {
    const hand = [c('S', 3, 0), c('S', 4, 1), c('H', 3, 2)];
    // 黑桃主 level2：领出红桃（非主花色）
    const ids = computePlayableIds(hand, [play([c('H', 7, 9)], Suit.Hearts)], cfg, GamePhase.Playing);
    expect(ids).not.toBeNull();
    expect(ids!.has('H-3-2')).toBe(true);
    expect(ids!.has('S-3-0')).toBe(false);
    expect(ids!.has('S-4-1')).toBe(false);
  });

  it('领副牌缺门 → 全可选（可垫/毙）', () => {
    const hand = [c('S', 3, 0), c('H', 3, 1)];
    expect(computePlayableIds(hand, [play([c('D', 7, 9)], Suit.Diamonds)], cfg, GamePhase.Playing)).toBeNull();
  });

  it('吊主（leadSuit null）：有主必出主（级牌/王/主花色）', () => {
    const hand = [c('S', 3, 0), c('S', 2, 1), c('H', 2, 2), c('D', 3, 3)];
    // 黑桃主 level2：S3/S2(级牌)/H2(级牌) 是主，D3 非主
    const ids = computePlayableIds(hand, [play([c('S', 5, 9)], null)], cfg, GamePhase.Playing);
    expect(ids!.has('S-3-0')).toBe(true);
    expect(ids!.has('S-2-1')).toBe(true);
    expect(ids!.has('H-2-2')).toBe(true);
    expect(ids!.has('D-3-3')).toBe(false);
  });

  it('吊主但手牌无主 → 全可选（垫牌）', () => {
    const hand = [c('D', 3, 0), c('H', 3, 1)];
    expect(computePlayableIds(hand, [play([c('S', 5, 9)], null)], cfg, GamePhase.Playing)).toBeNull();
  });

  it('跟对子：手牌同花色牌数 < lead 张数 → 全可点 null（组牌必出 + 任意填）', () => {
    const hand = [c('H', 3, 0), c('D', 3, 1), c('D', 5, 2)];
    // lead 是红桃对子（2 张），手牌只有 1 张红桃 → 全可点（组牌必出由出牌校验）
    const ids = computePlayableIds(hand, [play([c('H', 7, 9), c('H', 7, 10)], Suit.Hearts)], cfg, GamePhase.Playing);
    expect(ids).toBeNull();
  });

  it('跟单张：手牌同花色数 == lead 张数 → 恰好出该组', () => {
    const hand = [c('H', 3, 0), c('H', 4, 1), c('D', 3, 2)];
    const ids = computePlayableIds(hand, [play([c('H', 7, 9)], Suit.Hearts)], cfg, GamePhase.Playing);
    expect(ids!.has('H-3-0')).toBe(true);
    expect(ids!.has('H-4-1')).toBe(true);
    expect(ids!.has('D-3-2')).toBe(false);
  });

  it('跟对子：手牌同花色数 > lead 张数 → 只能出该组', () => {
    const hand = [c('H', 3, 0), c('H', 4, 1), c('H', 5, 2), c('D', 3, 3)];
    const ids = computePlayableIds(hand, [play([c('H', 7, 9), c('H', 7, 10)], Suit.Hearts)], cfg, GamePhase.Playing);
    expect(ids!.has('H-3-0')).toBe(true);
    expect(ids!.has('H-4-1')).toBe(true);
    expect(ids!.has('H-5-2')).toBe(true);
    expect(ids!.has('D-3-3')).toBe(false);
  });

  it('部分必出：必出的 2 连对可点，独立对与单牌不可选', () => {
    const hand = [c('H', 10, 0), c('H', 10, 1), c('H', 9, 2), c('H', 9, 3), c('H', 7, 4), c('H', 7, 5), c('H', 3, 6)];
    // lead: 红桃 AAKK（2 连对），手牌 101099（2 连对）+ 77 + 单 3
    const lead = play([c('H', 14, 9), c('H', 14, 10), c('H', 13, 11), c('H', 13, 12)], Suit.Hearts);
    const ids = computePlayableIds(hand, [lead], cfg, GamePhase.Playing);
    expect(ids!.has('H-10-0')).toBe(true);  // 必出 2 连对
    expect(ids!.has('H-9-2')).toBe(true);
    expect(ids!.has('H-7-4')).toBe(false);  // 独立对不可选
    expect(ids!.has('H-3-6')).toBe(false);  // 单牌不可选
    const plan = computeFollowPlan(hand, [lead], cfg, GamePhase.Playing);
    expect(plan.lockedIds.slice().sort()).toEqual(['H-10-0', 'H-10-1', 'H-9-2', 'H-9-3']);
  });

  it('主牌甩牌部分必出：3 连对必出，对牌不可选（例 4）', () => {
    // lead: 对大王对小王对黑桃2（3 连对）+ 黑桃 QQJJ（2 连对），吊主 leadSuit null
    const lead = play([
      c('J', 16, 0), c('J', 16, 1), c('J', 15, 2), c('J', 15, 3), c('S', 2, 4), c('S', 2, 5),
      c('S', 12, 6), c('S', 12, 7), c('S', 11, 8), c('S', 11, 9),
    ], null);
    const hand = [
      c('H', 2, 0), c('H', 2, 1), c('S', 14, 2), c('S', 14, 3), c('S', 13, 4), c('S', 13, 5),
      c('S', 10, 6), c('S', 10, 7), c('S', 9, 8), c('S', 9, 9),
      c('S', 7, 10), c('S', 7, 11), c('S', 6, 12), c('S', 6, 13),
      c('S', 4, 14), c('S', 4, 15),
    ];
    const ids = computePlayableIds(hand, [lead], cfg, GamePhase.Playing);
    expect(ids!.has('H-2-0')).toBe(true);   // 3 连对必出
    expect(ids!.has('S-14-2')).toBe(true);
    expect(ids!.has('S-13-4')).toBe(true);
    expect(ids!.has('S-4-14')).toBe(false); // 对牌不可选
    const plan = computeFollowPlan(hand, [lead], cfg, GamePhase.Playing);
    expect(plan.lockedIds.slice().sort()).toEqual(['H-2-0', 'H-2-1', 'S-13-4', 'S-13-5', 'S-14-2', 'S-14-3']);
  });

  it('computeFollowPlan：领出或非 Playing → 无必出', () => {
    expect(computeFollowPlan([c('H', 3, 0)], [], cfg, GamePhase.Playing).lockedIds).toEqual([]);
    expect(computeFollowPlan([c('H', 3, 0)], [play([c('S', 5, 9)], Suit.Spades)], cfg, GamePhase.BottomExchange).lockedIds).toEqual([]);
  });
});

describe('canSubmitPlay — 出牌按钮灰色判定', () => {
  it('未选牌 → 不可提交（灰色）', () => {
    expect(canSubmitPlay([], [c('S', 3, 0)], [], cfg)).toBe(false);
  });

  it('领出单张 → 可提交', () => {
    expect(canSubmitPlay([c('S', 3, 0)], [c('S', 3, 0)], [], cfg)).toBe(true);
  });

  it('领出同花色多张 → 可提交', () => {
    expect(canSubmitPlay([c('H', 3, 0), c('H', 4, 1)], [c('H', 3, 0), c('H', 4, 1)], [], cfg)).toBe(true);
  });

  it('领出不同花色多张 → 不可提交', () => {
    expect(canSubmitPlay([c('H', 3, 0), c('D', 4, 1)], [c('H', 3, 0), c('D', 4, 1)], [], cfg)).toBe(false);
  });

  it('领出混主牌与非主 → 不可提交', () => {
    // 黑桃主 level2：H3 非主 + S2 级牌主 → 不同组
    expect(canSubmitPlay([c('H', 3, 0), c('S', 2, 1)], [c('H', 3, 0), c('S', 2, 1)], [], cfg)).toBe(false);
  });

  it('领出全主牌 → 可提交', () => {
    // S2（级牌主）+ J-16（大王主）→ 同组
    expect(canSubmitPlay([c('S', 2, 0), c('J', 16, 1)], [c('S', 2, 0), c('J', 16, 1)], [], cfg)).toBe(true);
  });

  it('跟牌张数与领出不符 → 不可提交', () => {
    const hand = [c('H', 3, 0), c('H', 4, 1), c('D', 3, 2)];
    const lead = play([c('H', 7, 9), c('H', 7, 10)], Suit.Hearts);
    expect(canSubmitPlay([c('H', 3, 0)], hand, [lead], cfg)).toBe(false);
    expect(canSubmitPlay([c('H', 3, 0), c('H', 4, 1), c('D', 3, 2)], hand, [lead], cfg)).toBe(false);
  });

  it('跟牌张数正确但牌型不符合（对子领出需跟对子）→ 不可提交', () => {
    const hand = [c('H', 3, 0), c('H', 4, 1), c('H', 5, 2)];
    const lead = play([c('H', 7, 9), c('H', 7, 10)], Suit.Hearts);
    // 手牌有对子（33），跟两张不同 rank 单牌 → validateFollow 拒绝
    expect(canSubmitPlay([c('H', 3, 0), c('H', 4, 2)], hand, [lead], cfg)).toBe(false);
  });

  it('跟牌张数与牌型都符合 → 可提交', () => {
    const hand = [c('H', 3, 0), c('H', 3, 1), c('H', 4, 2)];
    const lead = play([c('H', 7, 9), c('H', 7, 10)], Suit.Hearts);
    expect(canSubmitPlay([c('H', 3, 0), c('H', 3, 1)], hand, [lead], cfg)).toBe(true);
  });
});

describe('bottomExchangeStatus — 扣底主按键判定', () => {
  const eight = (trumps: number): Card[] => {
    // 8 张：前 trumps 张为主牌，其余为非主（红桃非级牌）
    const cards: Card[] = [];
    for (let i = 0; i < trumps; i++) cards.push(c('S', 3 + i, i)); // 黑桃主花色
    for (let i = trumps; i < 8; i++) cards.push(c('H', 3 + i, i)); // 红桃非级牌（level2）
    return cards;
  };

  it('选满 8 张且无主牌 → 可提交，无警告', () => {
    expect(bottomExchangeStatus(eight(0), cfg)).toEqual({ canSubmit: true, trumpCount: 0 });
  });

  it('选满 8 张但含主牌 → 可提交 + 主牌计数（扣底键变黄）', () => {
    expect(bottomExchangeStatus(eight(2), cfg)).toEqual({ canSubmit: true, trumpCount: 2 });
  });

  it('主牌含级牌（异花色 2）与小王 → 均计入', () => {
    const sel = [c('H', 2, 0), c('J', 15, 1), c('J', 16, 2), c('S', 3, 3),
                 c('H', 4, 4), c('H', 5, 5), c('H', 6, 6), c('H', 7, 7)];
    expect(bottomExchangeStatus(sel, cfg)).toEqual({ canSubmit: true, trumpCount: 4 });
  });

  it('不足 8 张（含主牌）→ 不可提交，仍计数', () => {
    expect(bottomExchangeStatus([c('S', 3, 0), c('H', 2, 1)], cfg)).toEqual({ canSubmit: false, trumpCount: 2 });
  });

  it('超过 8 张 → 不可提交（≠8 判定）', () => {
    const sel = [...eight(0), c('H', 11, 10)];
    expect(bottomExchangeStatus(sel, cfg)).toEqual({ canSubmit: false, trumpCount: 0 });
  });

  it('trumpDeclaration 为空 → 主牌数 0（防御）', () => {
    expect(bottomExchangeStatus([c('S', 3, 0)], null)).toEqual({ canSubmit: false, trumpCount: 0 });
  });
});
