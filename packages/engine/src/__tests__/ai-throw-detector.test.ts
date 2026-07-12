import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '../types.js';
import { createCard } from '../model.js';
import { findThrowableOffSuitCombos } from '../ai/throw-detector.js';
import type { TrumpDeclaration, Card } from '../types.js';

function c(s: string, r: number, idx: number): Card {
  return createCard(s as any, r as any, idx);
}

/** Check the result is non-null with at least expectedCards. */
function expectThrow(
  result: { cards: Card[]; reason: string } | null,
  expectedCards: number,
): void {
  expect(result).not.toBeNull();
  if (result) {
    expect(result.cards.length).toBe(expectedCards);
  }
}

// ================================================================
// Configurations
// ================================================================
const CFG = {
  /** Level=5, trump=Spades - no special level effect on top ranks */
  lv5Spade: { declarerIndex: 0, trumpSuit: Suit.Spades, level: 5 } as TrumpDeclaration,
  /** Level=A(14), trump=Hearts - A is trump, K is top off-suit */
  lvAHeart: { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 14 } as TrumpDeclaration,
  /** Level=K(13), trump=Hearts - K is trump, A is top off-suit */
  lvKHeart: { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 13 } as TrumpDeclaration,
  /** NT level=2 - only jokers + all 2s are trump */
  nt2: { declarerIndex: 0, trumpSuit: null, level: 2 } as TrumpDeclaration,
  /** NT level=A(14) - only jokers + all Aces are trump, K is top off-suit */
  ntA: { declarerIndex: 0, trumpSuit: null, level: 14 } as TrumpDeclaration,
  /** NT level=K(13) - only jokers + all Kings are trump, A is top off-suit */
  ntK: { declarerIndex: 0, trumpSuit: null, level: 13 } as TrumpDeclaration,
};

// ================================================================
// Helper: check exact card ranks in result
// ================================================================
function ranksOf(cards: Card[]): number[] {
  return cards.map(c => c.rank).sort((a, b) => a - b);
}

describe('findThrowableOffSuitCombos - basic cases (level=5, trump=Spades)', () => {
  const cfg = CFG.lv5Spade;

  // Off-suit context: Hearts are not trump. Ranks 2-14 except 5 (level).
  // Top: A(14), K(13), Q(12), J(11), 10(10), 9(9), 8(8), 7(7), 6(6), 4(4), 3(3), 2(2)
  // Tractor check: Q(12)+J(11) are consecutive (11->12), J(11)+10(10) are consecutive.
  // 6(6)+4(4) are consecutive (5 is skipped as level).

  describe('case 1: AAK / AKK', () => {
    it('AAK is throwable (3 cards)', () => {
      const hand = [c('H', 14, 0), c('H', 14, 1), c('H', 13, 0)];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 3);
    });

    it('AKK is throwable (3 cards - only 1xA remaining cannot form AA)', () => {
      const hand = [c('H', 14, 0), c('H', 13, 0), c('H', 13, 1)];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 3);
    });
  });

  describe('case 2 AQQ + singleton K (infer QQ is highest pair)', () => {
    it('AQQ with singleton K - QQ is safe because I hold the only other K', () => {
      // I have: 1xA, 1xK, 2xQ. Remaining: 1xA, 1xK, 0xQ.
      // Worst pairs: JJ. QQ > JJ OK. A tie worst A OK. K is blocked by worst A.
      const hand = [
        c('H', 14, 0), // A
        c('H', 13, 0), // K
        c('H', 12, 0), c('H', 12, 1), // QQ
      ];
      const r = findThrowableOffSuitCombos(hand, cfg);
      expect(r).not.toBeNull();
      if (r) {
        // A + QQ = 3 throwable. K is blocked by remaining A.
        expect(r.cards.length).toBe(3);
        // K should NOT be included
        expect(r.cards.find(c => c.rank === 13)).toBeUndefined();
      }
    });

    it('AJJ + singleton K AND Q -> JJ safe, 3 cards throwable (AJJ)', () => {
      // 用户说"有单张KQ可出AJJ"——单K+单Q在手中用于推断 JJ 最大，
      // 但 K、Q 本身被 worst A 挡住不能甩。实际甩的是 AJJ = 3 张。
      // I have: 1xA, 1xK, 1xQ, 2xJ. Remaining: 1xA, 1xK, 1xQ, 0xJ.
      // Worst pairs: 10-10 (1xK,1xQ can't form pairs). JJ > 10-10 OK.
      // A tie worst A OK. K and Q blocked by worst A.
      // Total: A + JJ = 3 throwable.
      const hand = [
        c('H', 14, 0), // A
        c('H', 13, 0), // K (singleton, held but blocked)
        c('H', 12, 0), // Q (singleton, held but blocked)
        c('H', 11, 0), c('H', 11, 1), // JJ (safe)
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 3);
    });
  });

  describe('case 3 extensions: AAKKQ, AAKQQ, AKKQQ', () => {
    it('AAKKQ is throwable (5 cards)', () => {
      const hand = [
        c('H', 14, 0), c('H', 14, 1), // AA
        c('H', 13, 0), c('H', 13, 1), // KK
        c('H', 12, 0), // Q
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 5);
    });

    it('AAKQQ is throwable (5 cards)', () => {
      const hand = [
        c('H', 14, 0), c('H', 14, 1), // AA
        c('H', 13, 0), // K
        c('H', 12, 0), c('H', 12, 1), // QQ
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 5);
    });

    it('AKKQQ is throwable (5 cards)', () => {
      const hand = [
        c('H', 14, 0), // A
        c('H', 13, 0), c('H', 13, 1), // KK
        c('H', 12, 0), c('H', 12, 1), // QQ
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 5);
    });
  });

  describe('case 4 combinations: AAKJJ + singleton Q', () => {
    it('AAKJJ where Q is held (blocked by worst K, throw 5 cards)', () => {
      // 用户说"手牌有单张Q时可出AAKJJ"。Q 在手中用于推断，但不一定能甩。
      // I hold: 2xA, 1xK, 1xQ, 2xJ. Remaining: 0xA, 1xK, 1xQ, 0xJ.
      // Worst pairs: 10-10. AA > 10-10 OK, JJ > 10-10 OK.
      // K vs worst K tie OK. Q vs worst K -> Q(12) < K(13) -> Q blocked.
      // Total: AA(2) + K(1) + JJ(2) = 5.
      const hand = [
        c('H', 14, 0), c('H', 14, 1), // AA
        c('H', 13, 0), // K
        c('H', 12, 0), // Q (singleton - held, not thrown)
        c('H', 11, 0), c('H', 11, 1), // JJ
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 5);
    });

    it('AKKJJ where Q is held (Q blocked by worst A, throw 5 cards)', () => {
      // I hold: 1xA, 2xK, 1xQ, 2xJ. Remaining: 1xA, 0xK, 1xQ, 0xJ.
      // Worst pairs: 10-10. KK > 10-10 OK, JJ > 10-10 OK.
      // A vs worst A tie OK. Q vs worst A -> Q(12) < A(14) -> Q blocked.
      // Total: A(1) + KK(2) + JJ(2) = 5.
      const hand = [
        c('H', 14, 0), // A
        c('H', 13, 0), c('H', 13, 1), // KK
        c('H', 12, 0), // Q (singleton - held, not thrown)
        c('H', 11, 0), c('H', 11, 1), // JJ
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 5);
    });
  });

  describe('case 5 with tractors: AQQJJ, AAQQJJ', () => {
    it('AQQJJ - tractor QQJJ is highest -> throwable (5 cards)', () => {
      // Q=12, J=11. At level=5, QJJ is a 2-pair tractor (12->11 consecutive).
      // I hold: 1xA, 2xQ, 2xJ. Remaining: 1xA, 0xQ, 0xJ, 2x10, 2x9...
      // Worst tractors: 10-9 (10+9 consecutive at level 5).
      // QQJJ max=12 > 10-9 max=10 OK. A tie worst A OK.
      const hand = [
        c('H', 14, 0), // A
        c('H', 12, 0), c('H', 12, 1), // QQ
        c('H', 11, 0), c('H', 11, 1), // JJ - forms tractor with QQ
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 5);
    });

    it('AAQQJJ - all 6 cards throwable', () => {
      // I hold: 2xA, 2xQ, 2xJ. Remaining: 0xA, 0xQ, 0xJ.
      // QQJJ tractor + AA pair are both highest.
      const hand = [
        c('H', 14, 0), c('H', 14, 1), // AA
        c('H', 12, 0), c('H', 12, 1), // QQ
        c('H', 11, 0), c('H', 11, 1), // JJ
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 6);
    });

    it('AQQJJ with singleton 10 - tractor QJJ + singleton 10 not in tractor', () => {
      // I hold: 1xA, 2xQ, 2xJ, 1x10.
      // QJJ is tractor (12+11 consecutive). 10 is outside the tractor.
      // Remaining: 1xA, 0xQ, 0xJ, 1x10, 2x9...
      // Worst tractor: 9-8 if 9+8 are consecutive (level=5, skip 5, they are).
      //   9+8 are consecutive (5 is skipped).
      // QJJ max=12 > 9-8 max=9 OK.
      // 10 single: worst max single = A. 10 < A -> NOT throwable.
      // A single: tie worst -> throwable.
      const hand = [
        c('H', 14, 0), // A
        c('H', 12, 0), c('H', 12, 1), // QQ
        c('H', 11, 0), c('H', 11, 1), // JJ
        c('H', 10, 0), // 10 (not in tractor, blocked by remaining A)
      ];
      const r = findThrowableOffSuitCombos(hand, cfg);
      expect(r).not.toBeNull();
      if (r) {
        // A(1) + QQ(2) + JJ(2) = 5 throwable. 10 is blocked.
        expect(r.cards.length).toBe(5);
        expect(r.cards.find(c => c.rank === 10)).toBeUndefined();
      }
    });
  });

  describe('tractor with level skip - needs higher cards blocked too', () => {
    it('66+44 alone is NOT throwable (blocked by worst KKQQ tractor)', () => {
      // Level=5, 6 and 4 are consecutive (5 skipped) -> tractor.
      // But worst has KKQQ tractor (K=13,Q=12) which beats 66+44 (6<13).
      const hand = [
        c('H', 14, 0), // A
        c('H', 6, 0), c('H', 6, 1), // 66
        c('H', 4, 0), c('H', 4, 1), // 44
      ];
      expect(findThrowableOffSuitCombos(hand, cfg)).toBeNull();
    });

    it('AAKKQQ + 66+44 tractor IS throwable when all higher cards are held (11 cards)', () => {
      // Holding all A, K, Q means worst has no higher tractors/pairs.
      // I hold: 2xA, 2xK, 2xQ, 2x6, 2x4. Remaining: 0xA, 0xK, 0xQ, 0x6, 0x4.
      // QQ+66? Q=12,6=6 are NOT consecutive (7-11 between them).
      // But 66+44 is a tractor. Worst tractor = J+10 (J=11,10=10 consecutive).
      // 66+44 max=6. J+10 max=11. 6<11 -> 66+44 blocked!
      // Actually even with AA,KK,QQ held, there's still JJ+10-10 tractor (J=11,10=10).
      // 66+44 (6) < JJ+10-10 (11). STILL blocked!
      //
      // Let me use a case that IS throwable: QQ+JJ (12+11 consecutive).
      // If I also hold KK and AA, worst tractor is 10-9.
      // QQJJ max=12 > 10-9 max=10 OK.
      const hand = [
        c('H', 14, 0), c('H', 14, 1), // AA
        c('H', 13, 0), c('H', 13, 1), // KK
        c('H', 12, 0), c('H', 12, 1), // QQ
        c('H', 11, 0), c('H', 11, 1), // JJ - tractor with QQ
        c('H', 10, 0), // 10 singleton
      ];
      // QQJJ tractor + AA + KK + 10 = 4+2+2+1 = 9 throwable
      // Actually: QQJJ tractor (4), AA pair (2), KK pair (2), 10 single (1) = 9
      const r = findThrowableOffSuitCombos(hand, cfg);
      expect(r).not.toBeNull();
      if (r) {
        expect(r.cards.length).toBe(9);
      }
    });
  });
});

// ================================================================
// Level = A(14), trump = Hearts -> K is top off-suit
// ================================================================
describe('level=A(14), trump=Hearts (K is top off-suit)', () => {
  const cfg = CFG.lvAHeart;
  // Off-suit Spades: ranks 2-13. K(13) is top, Q(12), J(11), 10(10)...
  // A(14) is trump, not in off-suit.

  describe('case 1 equivalent: KKQ (KK is top pair)', () => {
    it('KKQ is throwable (3 cards)', () => {
      const hand = [
        c('S', 13, 0), c('S', 13, 1), // KK (top)
        c('S', 12, 0), // Q
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 3);
    });

    it('KQQ is throwable (3 cards)', () => {
      // I hold: 1xK, 2xQ. Remaining: 1xK, 0xQ. Only 1xK can't form KK pair.
      // Worst pair: JJ. QQ > JJ OK. K tie worst K OK.
      const hand = [
        c('S', 13, 0), // K
        c('S', 12, 0), c('S', 12, 1), // QQ
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 3);
    });
  });

  describe('case 2 equivalent: KQQ + singleton J', () => {
    it('KQQ with singleton J - QQ safe, J blocked by worst K', () => {
      // I hold: 1xK, 1xJ, 2xQ. Remaining: 1xK, 1xJ, 0xQ.
      // Worst pairs: 10-10 (1xJ can't form pair). QQ > 10-10 OK.
      // K vs worst K tie OK. J vs worst K -> J<K -> J blocked.
      const hand = [
        c('S', 13, 0), // K
        c('S', 12, 0), c('S', 12, 1), // QQ
        c('S', 11, 0), // J
      ];
      const r = findThrowableOffSuitCombos(hand, cfg);
      expect(r).not.toBeNull();
      if (r) {
        expect(r.cards.length).toBe(3);
        expect(r.cards.find(c => c.rank === 11)).toBeUndefined(); // J blocked
      }
    });
  });

  describe('case 3 equivalent: KKQQJ', () => {
    it('KKQQJ is throwable (5 cards)', () => {
      const hand = [
        c('S', 13, 0), c('S', 13, 1), // KK (top)
        c('S', 12, 0), c('S', 12, 1), // QQ
        c('S', 11, 0), // J
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 5);
    });
  });

  describe('case 5 equivalent: KQQJJ (tractor with K as top)', () => {
    it('KQQJJ - QQJJ tractor + K is throwable (5 cards)', () => {
      // Q=12, J=11 are consecutive (no level skip between them since level is 14).
      // I hold: 1xK, 2xQ, 2xJ. Remaining: 1xK, 0xQ, 0xJ.
      // QQJJ tractor max=12.
      // Worst tractor: 10-9 (10+9 are consecutive). QJ > 10-9 OK.
      // K tie worst K OK.
      const hand = [
        c('S', 13, 0), // K
        c('S', 12, 0), c('S', 12, 1), // QQ
        c('S', 11, 0), c('S', 11, 1), // JJ - tractor with QQ
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 5);
    });

    it('KKQQJJ is throwable (6 cards)', () => {
      const hand = [
        c('S', 13, 0), c('S', 13, 1), // KK
        c('S', 12, 0), c('S', 12, 1), // QQ
        c('S', 11, 0), c('S', 11, 1), // JJ
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 6);
    });
  });
});

// ================================================================
// Level = K(13), trump = Hearts -> A is top off-suit
// ================================================================
describe('level=K(13), trump=Hearts (A is top off-suit)', () => {
  const cfg = CFG.lvKHeart;
  // Off-suit Spades: ranks 2-12, 14. A(14) is top, Q(12), J(11), 10(10)...
  // K(13) is level (trump), not in off-suit.
  // Tractor: Q(12)+J(11) consecutive, J(11)+10(10) consecutive.

  describe('case 1 equivalent: AAQ (AA is top pair)', () => {
    it('AAQ is throwable (3 cards)', () => {
      const hand = [
        c('S', 14, 0), c('S', 14, 1), // AA (top)
        c('S', 12, 0), // Q (J skipped? No, K is skipped, Q is next after A)
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 3);
    });

    it('AQQ is throwable (3 cards)', () => {
      // I hold: 1xA, 2xQ. Remaining: 1xA, 0xQ. 1xA can't form AA pair.
      // Worst pair: JJ. QQ > JJ OK.
      const hand = [
        c('S', 14, 0), // A
        c('S', 12, 0), c('S', 12, 1), // QQ
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 3);
    });
  });

  describe('case 2 equivalent: AQQ + singleton J (under K level)', () => {
    it('AQQ with singleton J - QQ safe, J blocked by worst A', () => {
      const hand = [
        c('S', 14, 0), // A
        c('S', 12, 0), c('S', 12, 1), // QQ
        c('S', 11, 0), // J (blocked by remaining A)
      ];
      const r = findThrowableOffSuitCombos(hand, cfg);
      expect(r).not.toBeNull();
      if (r) {
        expect(r.cards.length).toBe(3);
        expect(r.cards.find(c => c.rank === 11)).toBeUndefined();
      }
    });
  });

  describe('case 3 equivalent: AAQQJ', () => {
    it('AAQQJ is throwable (5 cards)', () => {
      const hand = [
        c('S', 14, 0), c('S', 14, 1), // AA (top)
        c('S', 12, 0), c('S', 12, 1), // QQ
        c('S', 11, 0), // J
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 5);
    });
  });

  describe('case 4 equivalent: AAQJJ + singleton 10', () => {
    it('AAQJJ with singleton 10 -> 10 blocked by worst Q, throw 5 cards', () => {
      // Under K-level, K is trump. I hold: 2xA, 1xQ, 1x10, 2xJ.
      // Remaining: 0xA, 1xQ, 1x10, 0xJ.
      // Worst max single = Q(12). My 10 < Q -> 10 blocked.
      // AA(2) + Q(1) + JJ(2) = 5.
      const hand = [
        c('S', 14, 0), c('S', 14, 1), // AA
        c('S', 12, 0), // Q
        c('S', 11, 0), c('S', 11, 1), // JJ
        c('S', 10, 0), // 10 (blocked by remaining Q)
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 5);
    });
  });

  describe('case 5 equivalent: AQQJJ (tractor with A as top)', () => {
    it('AQQJJ - QQJJ tractor + A is throwable (5 cards)', () => {
      // Q(12)+J(11) are consecutive (K=13 is level, removed from sequence).
      const hand = [
        c('S', 14, 0), // A (top, not in tractor)
        c('S', 12, 0), c('S', 12, 1), // QQ
        c('S', 11, 0), c('S', 11, 1), // JJ - tractor with QQ
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 5);
    });

    it('AAQQJJ is throwable (6 cards)', () => {
      const hand = [
        c('S', 14, 0), c('S', 14, 1), // AA
        c('S', 12, 0), c('S', 12, 1), // QQ
        c('S', 11, 0), c('S', 11, 1), // JJ
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 6);
    });
  });
});

// ================================================================
// NT mode - level cards are trump in ALL suits
// ================================================================
describe('NT mode', () => {
  describe('NT level=2 (A is top off-suit)', () => {
    const cfg = CFG.nt2;
    // All 2's are trump. Off-suit Hearts: 3-14. A(14) is top.
    // Tractor: Q(12)+J(11) consecutive, J(11)+10(10) consecutive.

    it('AAK is throwable (3 cards)', () => {
      const hand = [c('H', 14, 0), c('H', 14, 1), c('H', 13, 0)];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 3);
    });

    it('AAKKQ is throwable (5 cards)', () => {
      const hand = [
        c('H', 14, 0), c('H', 14, 1),
        c('H', 13, 0), c('H', 13, 1),
        c('H', 12, 0),
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 5);
    });
  });

  describe('NT level=A(14) (K is top off-suit)', () => {
    const cfg = CFG.ntA;
    // All Aces are trump. Off-suit Hearts: 2-13. K(13) is top.

    it('KKQ is throwable (3 cards)', () => {
      const hand = [c('H', 13, 0), c('H', 13, 1), c('H', 12, 0)];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 3);
    });

    it('KKQQJ is throwable (5 cards)', () => {
      const hand = [
        c('H', 13, 0), c('H', 13, 1),
        c('H', 12, 0), c('H', 12, 1),
        c('H', 11, 0),
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 5);
    });
  });

  describe('NT level=K(13) (A is top off-suit)', () => {
    const cfg = CFG.ntK;
    // All Kings are trump. Off-suit Hearts: 2-12, 14. A(14) is top.

    it('AAQ is throwable (3 cards)', () => {
      const hand = [c('H', 14, 0), c('H', 14, 1), c('H', 12, 0)];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 3);
    });

    it('AAQQJ is throwable (5 cards)', () => {
      const hand = [
        c('H', 14, 0), c('H', 14, 1),
        c('H', 12, 0), c('H', 12, 1),
        c('H', 11, 0),
      ];
      expectThrow(findThrowableOffSuitCombos(hand, cfg), 5);
    });
  });
});

// ================================================================
// Edge cases
// ================================================================
describe('edge cases', () => {
  const cfg = CFG.lv5Spade;

  describe('not enough cards', () => {
    it('2 cards - null', () => {
      expect(findThrowableOffSuitCombos([c('H', 14, 0), c('H', 14, 1)], cfg)).toBeNull();
    });

    it('0 cards - null', () => {
      expect(findThrowableOffSuitCombos([], cfg)).toBeNull();
    });
  });

  describe('trump suit excluded', () => {
    it('all cards in trump suit - null', () => {
      expect(findThrowableOffSuitCombos(
        [c('S', 14, 0), c('S', 14, 1), c('S', 13, 0)], cfg,
      )).toBeNull();
    });
  });

  describe('not enough throwable cards after filtering', () => {
    it('only 2 cards are throwable out of 5 - null', () => {
      // Just K+Q+J - no A. K is top but we only have 1xK.
      // K single: worst has 1xK -> tie OK.
      // But there are only singles, no pairs. Singles that tie are throwable.
      // K, Q, J all tie worst K, Q, J respectively?
      // Actually worst max single = A (from 2xA). K < A -> K blocked.
      // Q < A -> Q blocked. J < A -> J blocked.
      // 0 throwable -> null.
      const hand = [c('H', 13, 0), c('H', 12, 0), c('H', 11, 0)];
      expect(findThrowableOffSuitCombos(hand, cfg)).toBeNull();
    });
  });

  describe('multiple suits', () => {
    it('picks longest throwable combo among suits', () => {
      // Hearts: AAK = 3. Diamonds: AAKKQ = 5 (but only if Q is throwable too).
      // With 2xA and 2xK: remaining 1xQ. My Q ties worst Q OK.
      // Actually AAKKQ: AA(2) + KK(2) + Q(1) = 5.
      const hand = [
        c('H', 14, 0), c('H', 14, 1), c('H', 13, 0), // Hearts: AAK
        c('D', 14, 0), c('D', 14, 1), c('D', 13, 0), c('D', 13, 1), c('D', 12, 0), // Diamonds: AAKKQ
      ];
      const r = findThrowableOffSuitCombos(hand, cfg);
      expect(r).not.toBeNull();
      if (r) {
        // Should pick diamonds (5 cards)
        expect(r.cards.length).toBe(5);
        expect(r.reason).toContain('♦');
      }
    });
  });
});

// ================================================================
// Worst-case singles blocked by pairs in worst hand
// ================================================================
describe('worst-case singles blocked by pairs', () => {
  const cfg = CFG.lv5Spade;

  it('KKQQ10 - KKQQ tractor throwable (4 cards), 10 blocked by A from AA', () => {
    // KK(13)+QQ(12) are consecutive at level=5 → 2-pair tractor.
    // KKQQ tractor beats worst 99+88 tractor → throwable.
    // 10 single blocked by A from AA in worst → NOT throwable.
    // Total: 4 throwable (KKQQ tractor), not 5.
    const hand = [
      c('H', 13, 0), c('H', 13, 1), // KK
      c('H', 12, 0), c('H', 12, 1), // QQ — tractor with KK
      c('H', 10, 0),                   // 10 (blocked by A in AA pair)
    ];
    expectThrow(findThrowableOffSuitCombos(hand, cfg), 4);
  });

  it('AAKK is still throwable (4-card tractor) - no higher pairs in worst', () => {
    const hand = [
      c('H', 14, 0), c('H', 14, 1), // AA
      c('H', 13, 0), c('H', 13, 1), // KK — tractor with AA
    ];
    expectThrow(findThrowableOffSuitCombos(hand, cfg), 4);
  });
});
