/**
 * 当前领出主线：庄家方 庄1 → 通用2（不出纯主拖）→ 通用3 →
 * 庄3.5（主拖）→ 通用4 → 通用5+；闲家 通用2/3/4。
 *
 * 庄3.5 限制：庄家 ≥20 禁 A 以上主拖，对家 ≥15 禁 0 分主拖；
 * 无主局不出庄3.5，主拖落回通用6。
 */
import { describe, it, expect } from 'vitest';
import { createCard } from '../model.js';
import { Rank, SpecialSuit, Suit } from '../types.js';
import type { Card, CardSuit, TrumpDeclaration } from '../types.js';
import type { AIContext } from '../ai-latest/types.js';
import { minimalContext } from '../ai-latest/types.js';
import { aiLeadPlay } from '../ai-latest/index.js';
import {
  forbidsDeclarerSideMainTractor, hasWorthLeadCards,
} from '../ai-latest/lead.js';

const CFG: TrumpDeclaration = { trumpSuit: Suit.Hearts, level: Rank.Two, declarerIndex: 0 };
const NT: TrumpDeclaration = { ...CFG, trumpSuit: null };

let idSeq = 0;
const c = (suit: CardSuit, rank: number): Card => createCard(suit, rank as Rank, idSeq++);
const joker = (rank: Rank): Card => createCard(SpecialSuit.Joker, rank, idSeq++);
const show = (cards: readonly Card[]): string => cards.map(x => `${x.suit}${x.rank}`).join(',');

const H = Suit.Hearts;
const C = Suit.Clubs;
const S = Suit.Spades;

function ctxOf(
  role: 'declarer' | 'partner' | 'attacker',
  handCount = 25,
  cfg: TrumpDeclaration = CFG,
): AIContext {
  const idx = role === 'declarer' ? 0 : role === 'partner' ? 2 : 1;
  return {
    ...minimalContext(cfg),
    myIndex: idx,
    isDeclarer: role === 'declarer',
    isDeclarerPartner: role === 'partner',
    isAttacker: role === 'attacker',
    handCounts: [handCount, handCount, handCount, handCount] as const,
  };
}

/** 0 分低张主拖 ♥4433 + 副牌填充。 */
const lowTT = (): Card[] => [c(H, 4), c(H, 4), c(H, 3), c(H, 3), c(S, 7), c(S, 8)];
/** 0 分 A 以上主拖：小王对 + 级牌对。 */
const highTT = (): Card[] => [
  joker(Rank.SmallJoker), joker(Rank.SmallJoker), c(H, 2), c(H, 2), c(S, 7), c(S, 8),
];
/** 含分主拖 ♥5544（5 是分牌）。 */
const pointsTT = (): Card[] => [c(H, 5), c(H, 5), c(H, 4), c(H, 4), c(S, 7), c(S, 8)];
/** 副拖拉机 ♣4433 + 填充。 */
const offTractor = (): Card[] => [c(C, 4), c(C, 4), c(C, 3), c(C, 3), c(C, 7), c(S, 8)];
/** 副牌顶张 ♣A。 */
const topOnly = (): Card[] => [c(C, 14), c(C, 7), c(S, 8), c(H, 8)];
/** 庄1 的前置控制张 + 主拖。 */
const drainPlusTT = (): Card[] => [
  c(H, 4), c(H, 4), c(H, 3), c(H, 3), c(C, 14), c(C, 14), c(C, 13), c(C, 13), c(S, 8),
];

describe('领出主线 — 接线与档位', () => {
  it('庄家方：庄1 先于通用2', () => {
    for (const role of ['declarer', 'partner'] as const) {
      const r = aiLeadPlay(drainPlusTT(), ctxOf(role, 20));
      expect(r.tier).toBe('庄1');
      expect(show(r.cards)).toBe('C14,C14,C13,C13');
    }
  });

  it('庄家方：副拖拉机走通用2', () => {
    const r = aiLeadPlay(offTractor(), ctxOf('declarer', 9));
    expect(r.tier).toBe('通用2');
    expect(show(r.cards)).toBe('C4,C4,C3,C3');
  });

  it('庄家方：副牌顶张走通用3', () => {
    const r = aiLeadPlay(topOnly(), ctxOf('declarer', 9));
    expect(r.tier).toBe('通用3');
    expect(show(r.cards)).toBe('C14');
  });

  it('庄家方：通用2 不出纯主拖，主拖后置到庄3.5', () => {
    for (const role of ['declarer', 'partner'] as const) {
      const r = aiLeadPlay(lowTT(), ctxOf(role, 9));
      expect(r.tier).toBe('庄3.5');
      expect(show(r.cards)).toBe('H4,H4,H3,H3');
    }
  });

  it('庄3.5 在通用4 之前', () => {
    // ♣99 是直接断门副对（通用4 候选），主拖应先出。
    const hand = [c(H, 4), c(H, 4), c(H, 3), c(H, 3), c(C, 9), c(C, 9), c(S, 7)];
    const r = aiLeadPlay(hand, ctxOf('declarer', 9));
    expect(r.tier).toBe('庄3.5');
    expect(show(r.cards)).toBe('H4,H4,H3,H3');
  });

  it('闲家：通用2 仍含纯主拖，没有庄3.5', () => {
    const r = aiLeadPlay(lowTT(), ctxOf('attacker', 20));
    expect(r.tier).toBe('通用2');
    expect(show(r.cards)).toBe('H4,H4,H3,H3');
  });
});

describe('庄3.5 — 座位与张数限制', () => {
  it('庄家 ≥20 禁 A 以上主拖，<20 不限', () => {
    const high20 = aiLeadPlay(highTT(), ctxOf('declarer', 20));
    expect(high20.tier).toBe('通用');
    const high19 = aiLeadPlay(highTT(), ctxOf('declarer', 19));
    expect(high19.tier).toBe('庄3.5');
    expect(show(high19.cards)).toBe('J15,J15,H2,H2');
  });

  it('庄家 ≥20 允许 0 分低张主拖', () => {
    const r = aiLeadPlay(lowTT(), ctxOf('declarer', 20));
    expect(r.tier).toBe('庄3.5');
    expect(show(r.cards)).toBe('H4,H4,H3,H3');
  });

  it('对家 ≥15 禁 0 分主拖，<15 不限', () => {
    const low20 = aiLeadPlay(lowTT(), ctxOf('partner', 20));
    expect(low20.tier).toBe('通用');
    const low14 = aiLeadPlay(lowTT(), ctxOf('partner', 14));
    expect(low14.tier).toBe('庄3.5');
    expect(show(low14.cards)).toBe('H4,H4,H3,H3');
  });

  it('对家 ≥15 仍允许含分主拖', () => {
    const r = aiLeadPlay(pointsTT(), ctxOf('partner', 20));
    expect(r.tier).toBe('庄3.5');
    expect(show(r.cards)).toBe('H5,H5,H4,H4');
  });

  it('无主局不出庄3.5，主拖落回通用档', () => {
    const hand = [
      joker(Rank.SmallJoker), joker(Rank.SmallJoker), c(H, 2), c(H, 2), c(S, 7), c(S, 8),
    ];
    const r = aiLeadPlay(hand, ctxOf('declarer', 14, NT));
    expect(r.tier).toBe('通用');
  });

  it('判据函数：按座位与阈值', () => {
    const d = ctxOf('declarer', 20);
    const p = ctxOf('partner', 20);
    const a = ctxOf('attacker', 20);
    const high = highTT().slice(0, 4);
    const low = lowTT().slice(0, 4);
    const points = pointsTT().slice(0, 4);
    expect(forbidsDeclarerSideMainTractor(high, d, 20)).toBe(true);
    expect(forbidsDeclarerSideMainTractor(high, d, 19)).toBe(false);
    expect(forbidsDeclarerSideMainTractor(low, d, 20)).toBe(false);
    expect(forbidsDeclarerSideMainTractor(points, d, 20)).toBe(false);
    expect(forbidsDeclarerSideMainTractor(low, p, 15)).toBe(true);
    expect(forbidsDeclarerSideMainTractor(low, p, 14)).toBe(false);
    expect(forbidsDeclarerSideMainTractor(points, p, 20)).toBe(false);
    expect(forbidsDeclarerSideMainTractor(low, a, 20)).toBe(false);
  });
});

describe('第四家探针 — 与领出同口径', () => {
  it('纯主拖不算“值得出的牌”', () => {
    for (const hand of [lowTT(), highTT()]) {
      for (const role of ['declarer', 'partner', 'attacker'] as const) {
        for (const hc of [9, 20]) {
          expect(hasWorthLeadCards(hand, ctxOf(role, hc))).toBe(false);
        }
      }
    }
  });

  it('副拖与副牌顶张让探针为 true', () => {
    for (const hand of [offTractor(), topOnly()]) {
      for (const role of ['declarer', 'partner', 'attacker'] as const) {
        for (const hc of [9, 20]) {
          expect(hasWorthLeadCards(hand, ctxOf(role, hc))).toBe(true);
        }
      }
    }
  });
});
