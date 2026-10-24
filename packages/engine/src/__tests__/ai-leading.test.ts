import { describe, it, expect } from 'vitest';
import { Rank, SpecialSuit, Suit } from '../types.js';
import { createCard, isTrump } from '../model.js';
import { validateLead } from '../leading/index.js';
import { aiLeadPlay } from '../ai/index.js';
import { minimalContext } from '../ai/types.js';
import type { AIContext } from '../ai/types.js';
import type { Card, CardSuit, TrumpDeclaration } from '../types.js';

function c(s: CardSuit, r: number, idx: number): Card {
  return createCard(s, r, idx);
}

/** Build a minimal AIContext from a plain TrumpDeclaration. */
function ctx(config: TrumpDeclaration, overrides?: Partial<AIContext>): AIContext {
  return { ...minimalContext(config), ...overrides };
}

/** 完整队伍标记的 ctx（真实对局里 buildAIContext 总是给出）。 */
function teamCtx(config: TrumpDeclaration, role: 'declarer' | 'attacker'): AIContext {
  return ctx(config, role === 'declarer'
    ? { myIndex: 0, isDeclarer: true, isDeclarerPartner: false, isAttacker: false }
    : { myIndex: 1, isDeclarer: false, isDeclarerPartner: false, isAttacker: true });
}

function checkLead(play: Card[], hand: Card[], config: TrumpDeclaration): void {
  const vr = validateLead(play, hand, config);
  expect(vr.valid).toBe(true);
}

describe('AI leading play', () => {
  const cfg5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
  const cfgNT: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 2 };

  describe('strategy 3: lead tractors', () => {
    it('leads a tractor when one exists', () => {
      // S-QQ + S-JJ = 2-pair tractor (level=5, no skip between Q=12 and J=11)
      const hand = [
        c('S', 12, 0), c('S', 12, 1),
        c('S', 11, 0), c('S', 11, 1),
        c('H', 2, 0),
      ];
      const result = aiLeadPlay(hand, teamCtx(cfg5, 'attacker'));
      checkLead(result.cards, hand, cfg5);
      expect(result.cards.length).toBe(4); // 2-pair tractor = 4 cards
      expect(result.reason).toContain('拖拉机');
    });

    it('leads off-suit tractor before trump tractor', () => {
      // Off-suit tractor: S-QQJJ, Trump tractor: H-3344 (level=5)
      const hand = [
        c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 11, 1),
        c('H', 3, 0), c('H', 3, 1), c('H', 4, 0), c('H', 4, 1),
      ];
      const result = aiLeadPlay(hand, teamCtx(cfg5, 'attacker'));
      checkLead(result.cards, hand, cfg5);
      // Should prefer off-suit tractor (trump is Hearts, lead S first)
      expect(result.reason).toContain('♠');
    });

    it('pure tractor throwable via throw detector: labeled as tractor not throw', () => {
      // Reproduce: NT level=2, AI-2 leads ♠J♠J♠10♠10 (2-pair tractor).
      // The throw detector finds it throwable, but it's a pure tractor —
      // should be labeled 出♠拖拉机(2对), not 甩♠副牌(4张).
      const hand = [
        c('S', 11, 0), c('S', 11, 1),
        c('S', 10, 0), c('S', 10, 1),
        c('H', 3, 0),
      ];
      const result = aiLeadPlay(hand, teamCtx(cfgNT, 'attacker'));
      checkLead(result.cards, hand, cfgNT);
      expect(result.cards.length).toBe(4);
      expect(result.reason).toContain('拖拉机');
      expect(result.reason).not.toContain('甩');
    });
  });

  describe('strategy 1: lead big off-suit card', () => {
    it('leads off-suit A pair', () => {
      const hand = [
        c('S', 14, 0), c('S', 14, 1),
        c('H', 2, 0),
      ];
      const result = aiLeadPlay(hand, teamCtx(cfg5, 'attacker'));
      checkLead(result.cards, hand, cfg5);
      expect(result.cards.length).toBe(2);
      expect(result.reason).toContain('♠');
      expect(result.reason).toContain('A');
    });

    it('leads off-suit A single if no pair', () => {
      const hand = [
        c('S', 14, 0),
        c('H', 2, 0), c('H', 3, 0),
      ];
      const result = aiLeadPlay(hand, teamCtx(cfg5, 'attacker'));
      checkLead(result.cards, hand, cfg5);
      expect(result.cards.length).toBe(1);
      expect(result.reason).toContain('♠');
      expect(result.reason).toContain('A');
    });

    it('leads K when A is level', () => {
      const cfgAHeart: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 14 };
      // A is level (trump). K is top off-suit.
      const hand = [
        c('S', 13, 0), c('S', 13, 1), // KK
        c('H', 2, 0),
      ];
      const result = aiLeadPlay(hand, teamCtx(cfgAHeart, 'attacker'));
      checkLead(result.cards, hand, cfgAHeart);
      expect(result.reason).toContain('K');
    });
  });

  describe('strategy 2: lead pairs', () => {
    it('leads any pair when no tractor', () => {
      const hand = [
        c('S', 10, 0), c('S', 10, 1),
        c('H', 2, 0),
      ];
      const result = aiLeadPlay(hand, cfg5);
      checkLead(result.cards, hand, cfg5);
      expect(result.cards.length).toBe(2);
    });

    it('有主：主对先于小主单张（通用 7 先于 9）', () => {
      const hand = [
        c('H', 10, 0), c('H', 10, 1), // trump pair
        c('S', 2, 0),
      ];
      const result = aiLeadPlay(hand, cfg5);
      checkLead(result.cards, hand, cfg5);
      expect(result.cards.length).toBe(2);
      expect(result.reason).toBe('出主对');
    });
  });

  describe('last card detection', () => {
    it('returns 最后一张手牌 when only one card left', () => {
      const hand = [c('S', 14, 0)];
      const result = aiLeadPlay(hand, cfg5);
      expect(result.reason).toBe('最后一张手牌，必出');
    });

    it('plays single card when hand has multiple non-pair cards', () => {
      const hand = [c('S', 14, 0), c('S', 12, 0)];
      const result = aiLeadPlay(hand, cfg5);
      checkLead(result.cards, hand, cfg5);
      // Leads the bigger card (A) as per strategy 1
      expect(result.cards.length).toBe(1);
    });

    it('returns 出最后一对 for last pair', () => {
      const hand = [c('S', 14, 0), c('S', 14, 1)];
      const result = aiLeadPlay(hand, cfg5);
      expect(result.reason).toContain('最后一对');
    });
  });

  describe('strategy 5: draw trump', () => {
    it('draws trump when having many trump and no better options', () => {
      // No tractors, no big off-suit A/K, have trump singles
      const hand = [
        c('H', 3, 0), c('H', 4, 0), c('H', 6, 0), c('H', 7, 0),
        c('H', 8, 0), c('H', 9, 0), c('H', 10, 0),
        c('S', 2, 0), c('S', 3, 0),
      ];
      const result = aiLeadPlay(hand, cfg5);
      checkLead(result.cards, hand, cfg5);
      expect(result.cards.length).toBe(1);
    });
  });

  describe('declarer restrictions', () => {
    it('declarer with 20+ cards does not lead trump pairs', () => {
      const hand: Card[] = [
        c('H', 5, 0), c('H', 5, 1), // level trump pair（A 以上，受庄家限制）
        c('H', 3, 0),               // 小主单张，作为受限后的兜底
        c('S', 2, 0), c('S', 3, 0), c('S', 4, 0),
        c('S', 6, 0), c('S', 7, 0), c('S', 8, 0),
        c('S', 9, 0), c('S', 10, 0),
        c('C', 2, 0), c('C', 3, 0), c('C', 4, 0),
        c('C', 6, 0), c('C', 7, 0), c('C', 8, 0),
        c('D', 2, 0), c('D', 3, 0), c('D', 4, 0),
      ];
      const ctxD = ctx(cfg5, {
        myIndex: 0, isDeclarer: true, isDeclarerPartner: false,
        handCounts: [20, 25, 25, 25] as const,
      });
      const result = aiLeadPlay(hand, ctxD);
      checkLead(result.cards, hand, cfg5);
      // STRATEGY.md 优先级 3/4 的庄家限制：手牌 ≥20 张时不出 A 以上主牌对子。
      // H5 是级牌（A 以上）——通用 7 放弃这对，通用 9 改出小主 H3，
      // 故断言「恰好一张、且是主牌」。
      expect(result.cards.length).toBe(1);
      expect(isTrump(result.cards[0], cfg5)).toBe(true);
      expect(result.cards[0].rank).toBe(Rank.Three);
      expect(result.reason).toBe('吊主');
    });

    it('declarer partner never leads trump pairs', () => {
      const hand: Card[] = [
        c('H', 3, 0), c('H', 3, 1), // trump pair
        c('S', 2, 0), c('S', 3, 0),
      ];
      const ctxDP = ctx(cfg5, {
        myIndex: 2, isDeclarer: false, isDeclarerPartner: true,
        handCounts: [25, 3, 4, 25] as const,
      });
      const result = aiLeadPlay(hand, ctxDP);
      checkLead(result.cards, hand, cfg5);
      // 对家同样不得领出主牌对子（STRATEGY.md 优先级 3/4 的对家限制）；
      // 本副唯一的对子也是 H-33，同样断言「恰好一张主牌」。
      expect(result.cards.length).toBe(1);
      expect(isTrump(result.cards[0], cfg5)).toBe(true);
      expect(result.cards[0].rank).toBe(Rank.Three);
      expect(result.reason).toBe('吊主');
    });
  });

  describe('庄4.5: lead trump tractor', () => {
    const declarerCtx = (n: number): AIContext => ctx(cfg5, {
      myIndex: 0, isDeclarer: true, isDeclarerPartner: false,
      handCounts: [n, 25, 25, 25] as const,
    });
    const names = (cards: Card[]): string[] => cards.map(x => `${x.suit}${x.rank}`);

    it('leads a trump tractor before generic 5 off-suit pairs', () => {
      // 主拖拉机 ♥4433；♠10 对是 J 以上、通用 5 的候选，但庄4.5 更靠前。
      const hand = [
        c('H', 4, 0), c('H', 4, 1), c('H', 3, 0), c('H', 3, 1),
        c('S', 10, 0), c('S', 10, 1), c('S', 3, 0), c('C', 6, 0),
      ];
      const result = aiLeadPlay(hand, declarerCtx(hand.length));
      checkLead(result.cards, hand, cfg5);
      expect(names(result.cards).sort()).toEqual(['H3', 'H3', 'H4', 'H4']);
      expect(result.reason).toBe('出主拖拉机(2对)');
    });

    it('stays behind 庄4: an off-suit top is led first', () => {
      const hand = [
        c('S', 14, 0), c('S', 3, 0),
        c('H', 4, 0), c('H', 4, 1), c('H', 3, 0), c('H', 3, 1),
        c('C', 6, 0),
      ];
      const result = aiLeadPlay(hand, declarerCtx(hand.length));
      checkLead(result.cards, hand, cfg5);
      expect(names(result.cards)).toEqual(['S14']);
    });

    it('declarer with 20+ cards skips a trump tractor containing a joker', () => {
      const hand: Card[] = [
        c(SpecialSuit.Joker, 15, 0), c(SpecialSuit.Joker, 15, 1),
        c(SpecialSuit.Joker, 16, 0), c(SpecialSuit.Joker, 16, 1),
        c('S', 2, 0), c('S', 3, 0), c('S', 4, 0), c('S', 6, 0),
        c('S', 7, 0), c('S', 8, 0), c('S', 9, 0), c('S', 10, 0),
        c('S', 11, 0), c('S', 12, 0), c('S', 13, 0),
        c('C', 2, 0), c('C', 3, 0), c('C', 4, 0), c('C', 6, 0), c('C', 7, 0),
      ];
      const result = aiLeadPlay(hand, declarerCtx(hand.length));
      checkLead(result.cards, hand, cfg5);
      // 小型王牌对 + 大王牌对构成主拖拉机，但含 A 以上（王）→ 庄4.5 放弃；
      // 后续档位出 ♠K 单张。
      expect(names(result.cards)).toEqual(['S13']);
      expect(result.reason).toBe('出♠K');
    });

    it('declarer partner never leads a trump tractor', () => {
      const hand = [
        c('H', 4, 0), c('H', 4, 1), c('H', 3, 0), c('H', 3, 1),
        c('S', 3, 0), c('C', 6, 0),
      ];
      const ctxDP = ctx(cfg5, {
        myIndex: 2, isDeclarer: false, isDeclarerPartner: true,
        handCounts: [25, 25, hand.length, 25] as const,
      });
      const result = aiLeadPlay(hand, ctxDP);
      checkLead(result.cards, hand, cfg5);
      expect(names(result.cards)).toEqual(['H3']);
      expect(result.reason).toBe('吊主');
    });

    it('two same-length trump tractors: the one with the smaller top goes first', () => {
      const hand = [
        c('H', 10, 0), c('H', 10, 1), c('H', 9, 0), c('H', 9, 1),
        c('H', 4, 0), c('H', 4, 1), c('H', 3, 0), c('H', 3, 1),
        c('S', 3, 0),
      ];
      const result = aiLeadPlay(hand, declarerCtx(hand.length));
      checkLead(result.cards, hand, cfg5);
      expect(names(result.cards).sort()).toEqual(['H3', 'H3', 'H4', 'H4']);
      expect(result.reason).toBe('出主拖拉机(2对)');
    });

    it('the longer trump tractor goes first', () => {
      const hand = [
        c('H', 4, 0), c('H', 4, 1), c('H', 3, 0), c('H', 3, 1),
        c('H', 2, 0), c('H', 2, 1),
        c('H', 10, 0), c('H', 10, 1), c('H', 9, 0), c('H', 9, 1),
        c('S', 3, 0),
      ];
      const result = aiLeadPlay(hand, declarerCtx(hand.length));
      checkLead(result.cards, hand, cfg5);
      expect(names(result.cards).sort()).toEqual(['H2', 'H2', 'H3', 'H3', 'H4', 'H4']);
      expect(result.reason).toBe('出主拖拉机(3对)');
    });
  });

  describe('NT mode', () => {
    it('draws trump in NT when no better option', () => {
      // Level=2, NT. All 2s are trump. No tractors, no big off-suit cards.
      const hand = [
        c('S', 2, 0), // level trump
        c('H', 3, 0), c('H', 4, 0),
      ];
      const ctxNT = ctx(cfgNT);
      const result = aiLeadPlay(hand, ctxNT);
      checkLead(result.cards, hand, cfgNT);
      expect(result.cards.length).toBe(1);
    });
  });
});


// ================================================================
// Item 4: leadLastCards is dead code (优先级7永不执行)
// ================================================================
// tryLeadSmall returns non-null for any non-empty hand, so leadLastCards
// (Strategy 7) is never reached. The "last card" behavior is actually
// handled by maybeAppendFinal, which overrides the reason correctly.
// This test verifies that the behavior is currently correct via
// maybeAppendFinal, and documents that leadLastCards is dead.
describe('last card detection (via maybeAppendFinal, not leadLastCards)', () => {
  const cfg5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };

  it('single trump card: tryLeadSmall returns it, maybeAppendFinal overrides reason', () => {
    // Hand is a single trump card (H-A). tryLeadSmall returns it with
    // "出最小牌", but maybeAppendFinal overrides to "最后一张手牌，必出".
    const hand = [c('H', 14, 0)];
    const result = aiLeadPlay(hand, cfg5);
    checkLead(result.cards, hand, cfg5);
    expect(result.cards.length).toBe(1);
    expect(result.reason).toBe('最后一张手牌，必出');
  });

  it('single off-suit card: same override via maybeAppendFinal', () => {
    // Hand is a single off-suit card (S-A). tryLeadSmall returns
    // "出♠小牌，长套引诱对手出分", maybeAppendFinal overrides.
    const hand = [c('S', 14, 0)];
    const result = aiLeadPlay(hand, cfg5);
    checkLead(result.cards, hand, cfg5);
    expect(result.cards.length).toBe(1);
    expect(result.reason).toBe('最后一张手牌，必出');
  });

  it('last two cards (pair): reason still correct via maybeAppendFinal', () => {
    // Hand: S-A,S-A pair. Strategy 1 leads AA pair ("出副牌♠A对").
    // maybeAppendFinal detects full hand and pair → "出最后一对".
    const hand = [c('S', 14, 0), c('S', 14, 1)];
    const result = aiLeadPlay(hand, cfg5);
    checkLead(result.cards, hand, cfg5);
    expect(result.cards.length).toBe(2);
    expect(result.reason).toBe('出最后一对');
  });
});
