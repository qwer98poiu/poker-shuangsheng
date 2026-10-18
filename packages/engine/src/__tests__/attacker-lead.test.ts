/**
 * 闲家阶梯 1–3（`ai/attacker-lead.ts`）。
 *
 * 闲1：拖拉机/含拖拉机甩牌；纯拖拉机同对数优先能直接断门的副拖拉机。
 * 闲2：静态顶张单/对/不含拖拉机的甩牌。
 * 闲3：断门兜底；直接断门小单张不再入候选，由通用梯子兜底。
 */
import { describe, it, expect } from 'vitest';
import { createCard } from '../model.js';
import { Suit, Rank } from '../types.js';
import type { Card, CardSuit, TrumpDeclaration } from '../types.js';
import type { AIContext } from '../ai/types.js';
import { minimalContext } from '../ai/types.js';
import { tryAttackerTractor, tryAttackerTop, tryAttackerDrain } from '../ai/attacker-lead.js';
import { aiLeadPlay } from '../ai/index.js';

const SPADES: TrumpDeclaration = { trumpSuit: Suit.Spades, level: Rank.Two, declarerIndex: 0 };
const HEARTS: TrumpDeclaration = { trumpSuit: Suit.Hearts, level: Rank.Two, declarerIndex: 0 };

let idSeq = 0;
const c = (suit: CardSuit, rank: number): Card => createCard(suit, rank as Rank, idSeq++);
const H = Suit.Hearts;
const S = Suit.Spades;
const C = Suit.Clubs;
const D = Suit.Diamonds;
const show = (cards: Card[]): string => cards.map(x => `${x.suit}${x.rank}`).join(',');

function ctxOf(hand: Card[], cfg: TrumpDeclaration = SPADES): AIContext {
  return {
    ...minimalContext(cfg),
    myIndex: 1,
    isDeclarer: false,
    isDeclarerPartner: false,
    isAttacker: true,
    handCounts: [25, hand.length, 25, 25] as const,
  };
}

describe('闲1 — 拖拉机 / 含拖拉机甩牌', () => {
  it('纯拖拉机同对数：能直接断门的副拖拉机先于主拖拉机', () => {
    // ♥ 是主；♥4433 与 ♣4433 同对数。♣ 是整门（直接断门），应优先。
    const hand = [
      c(H, 4), c(H, 4), c(H, 3), c(H, 3),
      c(C, 4), c(C, 4), c(C, 3), c(C, 3),
      c(S, 7),
    ];
    const r = tryAttackerTractor(hand, ctxOf(hand, HEARTS), null)!;
    expect(show(r.cards)).toBe('C4,C4,C3,C3');
    expect(r.reason).toBe('出♣拖拉机(2对)');
  });

  it('含拖拉机甩牌：拖拉机成分放宽，顶张一起甩出', () => {
    // ♥A4433：严格判据只允许 ♥A，但闲1把 4433 拖拉机与顶张 A 一起甩出。
    const hand = [c(H, 14), c(H, 4), c(H, 4), c(H, 3), c(H, 3), c(C, 7), c(D, 8), c(S, 3)];
    const r = tryAttackerTractor(hand, ctxOf(hand), null)!;
    expect(show(r.cards)).toBe('H14,H4,H4,H3,H3');
    expect(r.reason).toBe('甩♥副牌(5张)');
  });

  it('接线：闲家优先走闲1，而不是庄1', () => {
    const hand = [c(H, 14), c(H, 4), c(H, 4), c(H, 3), c(H, 3), c(C, 7), c(D, 8), c(S, 3)];
    const r = aiLeadPlay(hand, ctxOf(hand));
    expect(show(r.cards)).toBe('H14,H4,H4,H3,H3');
  });
});

describe('闲2 — 静态顶张（不含拖拉机）', () => {
  it('顶张 + 单张组成的安全甩牌（最大集合）', () => {
    const hand = [c(H, 14), c(H, 14), c(H, 13), c(H, 8), c(C, 7), c(D, 8), c(S, 3)];
    const r = tryAttackerTop(hand, ctxOf(hand), null)!;
    expect(show(r.cards)).toBe('H14,H14,H13');
    expect(r.reason).toBe('甩♥副牌(3张)');
  });

  it('顶张在拖拉机里 → 闲2不拆，交给闲1', () => {
    const hand = [c(H, 14), c(H, 14), c(H, 13), c(H, 13), c(C, 7)];
    expect(tryAttackerTop(hand, ctxOf(hand), null)).toBeNull();
  });

  it('顶张对', () => {
    const hand = [c(H, 14), c(H, 14), c(H, 8), c(C, 7)];
    const r = tryAttackerTop(hand, ctxOf(hand), null)!;
    expect(show(r.cards)).toBe('H14,H14');
    expect(r.reason).toBe('出♥A对');
  });
});

describe('闲3 — 断门兜底（直接断门小单张不再入候选）', () => {
  it('3 类断门（含顶张）整门出', () => {
    const hand = [c(H, 14), c(H, 14), c(C, 7), c(D, 8), c(S, 3)];
    const r = tryAttackerDrain(hand, ctxOf(hand), null)!;
    expect(show(r.cards)).toBe('H14,H14');
    expect(r.reason).toBe('断门♥(2张)');
  });

  it('4 类断门（纯拖拉机）整门出', () => {
    const hand = [c(H, 4), c(H, 4), c(H, 3), c(H, 3), c(C, 7), c(D, 8), c(S, 3)];
    const r = tryAttackerDrain(hand, ctxOf(hand), null)!;
    expect(show(r.cards)).toBe('H4,H4,H3,H3');
    expect(r.reason).toBe('断门♥(4张)');
  });

  it('直接断门的孤立小单张不再入候选', () => {
    const hand = [c(H, 7), c(C, 7)];
    expect(tryAttackerDrain(hand, ctxOf(hand), null)).toBeNull();
  });

  it('直接断门小单张不再抢在通用 8 的低副对之前', () => {
    // C9 对不可安全甩出，旧闲3 会退回 ♥7 小单张；现在应交给通用 8 出 C9 对。
    const hand = [c(H, 7), c(C, 9), c(C, 9), c(C, 6)];
    expect(tryAttackerDrain(hand, ctxOf(hand), null)).toBeNull();
    const r = aiLeadPlay(hand, ctxOf(hand));
    expect(show(r.cards)).toBe('C9,C9');
  });
});
