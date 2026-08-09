import { describe, it, expect } from 'vitest';
import { createCard, GamePhase, Suit } from '@poker/engine';
import type { Card, TrumpDeclaration } from '@poker/engine';
import { computePlayableIds } from './playable.js';

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
    const ids = computePlayableIds(hand, [play([c('H', 7, 9), c('H', 8, 10)], Suit.Hearts)], cfg, GamePhase.Playing);
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
    const ids = computePlayableIds(hand, [play([c('H', 7, 9), c('H', 8, 10)], Suit.Hearts)], cfg, GamePhase.Playing);
    expect(ids!.has('H-3-0')).toBe(true);
    expect(ids!.has('H-4-1')).toBe(true);
    expect(ids!.has('H-5-2')).toBe(true);
    expect(ids!.has('D-3-3')).toBe(false);
  });
});
