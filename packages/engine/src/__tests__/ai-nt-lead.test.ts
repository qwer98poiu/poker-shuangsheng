import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '../types.js';
import type { Card, CardSuit, Trick, TrumpDeclaration } from '../types.js';
import { createCard, isTrump } from '../model.js';
import { classify } from '../pattern/index.js';
import { extractComponents } from '../comparing/index.js';
import { validateLead, validateThrow } from '../leading/index.js';
import { tryNTLead } from '../ai/nt-lead.js';
import { worstCaseSuitHand } from '../ai/throw-detector.js';
import { computeLongSuit } from '../ai/suit-memory.js';
import { aiLeadPlay } from '../ai/index.js';
import { minimalContext } from '../ai/types.js';
import type { AIContext } from '../ai/types.js';

function c(s: CardSuit, r: number, idx: number): Card {
  return createCard(s, r, idx);
}

const cfgNT: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 2 };

function ctxOf(over: Partial<AIContext> = {}): AIContext {
  return { ...minimalContext(cfgNT), ...over };
}

/**
 * Build a trick from four **seat-ordered** plays, emitting `Trick.plays` the
 * way the engine does: in play order starting from the leader, with every
 * follow carrying the lead's `leadSuit` (see `playLead`/`playFollow`).
 */
function trick(plays: Card[][], leadIdx: number, winnerIndex = leadIdx): Trick {
  const lead = plays[leadIdx];
  const leadSuit = lead.every(x => isTrump(x, cfgNT)) ? null : (lead[0].suit as CardSuit);
  const ordered = plays.map((_, i) => plays[(leadIdx + i) % 4]);
  return {
    plays: ordered.map(cards => ({
      cards,
      pattern: classify(cards, cfgNT),
      leadSuit,
    })) as unknown as Trick['plays'],
    leadPlayerIndex: leadIdx,
    winnerIndex,
    points: 0,
  };
}

/** Card ranks of a play, sorted, for readable assertions. */
const ranks = (cards: Card[]): number[] => cards.map(x => x.rank).sort((a, b) => a - b);

/** Every card is in hand and the group is uniform. */
function checkLead(play: Card[], hand: Card[]): void {
  expect(validateLead(play, hand, cfgNT).valid).toBe(true);
}

/**
 * Invariant: every pair and single inside a proposed throw must survive the
 * worst-case hand (tractors are exempt by design) — that is what keeps the
 * lead clear of the ±10 throw penalty.
 */
function checkNoPenalty(play: Card[], hand: Card[], ctx: AIContext): void {
  if (classify(play, cfgNT).type !== 'throw') return;
  const suit = play[0].suit as Suit;
  const ofSuit = (cards: readonly Card[]) =>
    cards.filter(x => x.suit === suit && !isTrump(x, cfgNT));
  const window = ctx.isDeclarer
    ? ctx.trickHistory
    : ctx.trickHistory.slice(-1);
  const exclude = ofSuit(window.flatMap(t => t.plays.flatMap(p => p.cards)));
  const worst = worstCaseSuitHand(ofSuit(hand), suit, cfgNT, exclude);

  const comps = extractComponents(play, cfgNT);
  for (const pair of comps.pairs) {
    expect(validateThrow(pair, hand, [worst], cfgNT).valid).toBe(true);
  }
  for (const single of comps.singles) {
    expect(validateThrow([single], hand, [worst], cfgNT).valid).toBe(true);
  }
}

// ---- Shared fixtures ----

/** Long suit ♠ (9 cards, 7 controls) plus ♥AA and ♦A as short-suit controls. */
const mixedHand = [
  c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1),
  c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 10, 0), c('S', 9, 0),
  c('H', 14, 0), c('H', 14, 1),
  c('D', 14, 0),
];

const declarer = (over: Partial<AIContext> = {}): AIContext => ctxOf({
  myIndex: 0, isDeclarer: true, isDeclarerPartner: false, isAttacker: false,
  declarerIndex: 0, ...over,
});

// A trick where I led ♠AAKK and the whole table followed off-suit.
const spadeTractorTrick = trick([
  [c('S', 14, 0), c('S', 14, 1), c('S', 13, 2), c('S', 13, 3)],
  [c('H', 3, 0), c('H', 3, 1), c('H', 4, 0), c('H', 4, 1)],
  [c('C', 3, 0), c('C', 3, 1), c('C', 4, 0), c('C', 4, 1)],
  [c('D', 3, 0), c('D', 3, 1), c('D', 4, 0), c('D', 4, 1)],
], 0);
const spadePairTrick = trick([
  [c('S', 12, 0), c('S', 12, 1)], [c('H', 5, 0), c('H', 5, 1)],
  [c('C', 5, 0), c('C', 5, 1)], [c('D', 5, 0), c('D', 5, 1)],
], 0);

describe('NT lead layer — §1 control cards of the non-long suits', () => {
  it('leads the whole control group of the suit that has the fewest', () => {
    // ♥ has AA (2 controls), ♦ has A (1) -> ♦A goes first.
    const r = tryNTLead(mixedHand, declarer({ handCounts: [12, 25, 25, 25] as const }));
    checkLead(r!.cards, mixedHand);
    expect(ranks(r!.cards)).toEqual([Rank.Ace]);
    expect(r!.cards[0].suit).toBe(Suit.Diamonds);
    expect(r!.reason).toBe('出♦控制张(1张)');
  });

  it('prefers a suit that is emptied by the play when the counts tie', () => {
    // ♥AA (2) vs ♦AA (2): ♥ is gone afterwards, ♦ still holds K.
    const hand = [
      c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1),
      c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 10, 0), c('S', 9, 0),
      c('H', 14, 0), c('H', 14, 1),
      c('D', 14, 0), c('D', 14, 1), c('D', 13, 0),
    ];
    const r = tryNTLead(hand, declarer({ handCounts: [14, 25, 25, 25] as const }));
    checkLead(r!.cards, hand);
    expect(r!.cards.every(x => x.suit === Suit.Hearts)).toBe(true);
    expect(ranks(r!.cards)).toEqual([Rank.Ace, Rank.Ace]);
  });

  it('leaves the long suit alone and never plays it as a short suit', () => {
    const r = tryNTLead(mixedHand, declarer({ handCounts: [12, 25, 25, 25] as const }));
    expect(r!.cards.every(x => x.suit !== Suit.Spades)).toBe(true);
  });
});

describe('NT lead layer — §3 first long-suit lead: tractors only', () => {
  it('plays the tractor and leaves the pair and the single at home', () => {
    // ♠ AA K 6655: T1 = AA + 5566 tractor + K. The lead is the tractor alone.
    const hand = [
      c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 12, 0), c('S', 11, 0),
      c('S', 6, 0), c('S', 6, 1), c('S', 5, 0), c('S', 5, 1),
      c('H', 3, 0),
    ];
    const ctx = declarer({ handCounts: [10, 25, 25, 25] as const });
    const r = tryNTLead(hand, ctx);
    checkLead(r!.cards, hand);
    checkNoPenalty(r!.cards, hand, ctx);
    expect(r!.cards.every(x => x.suit === Suit.Spades)).toBe(true);
    expect(r!.cards.length).toBe(4);
    expect(ranks(r!.cards)).toEqual([5, 5, 6, 6]);
    expect(r!.reason).toBe('长花色拖拉机(2对)');
  });

  it('takes a three-pair tractor whole rather than splitting two pairs off', () => {
    const hand = [
      c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1),
      c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 10, 0), c('S', 9, 0),
    ];
    const r = tryNTLead(hand, declarer({ handCounts: [9, 25, 25, 25] as const }));
    checkLead(r!.cards, hand);
    expect(ranks(r!.cards)).toEqual([12, 12, 13, 13, 14, 14]);
    expect(r!.reason).toBe('长花色拖拉机(3对)');
  });

  it('plays the single top card and its tractor together (§3.3 special case)', () => {
    // ♠ A + 6655 + padding: T1 is exactly "one top single + one tractor".
    const hand = [
      c('S', 14, 0),
      c('S', 6, 0), c('S', 6, 1), c('S', 5, 0), c('S', 5, 1),
      c('S', 8, 0), c('S', 8, 1),
      c('S', 9, 0), c('S', 7, 0), c('S', 4, 0),
      c('H', 3, 0),
    ];
    const ctx = declarer({ handCounts: [11, 25, 25, 25] as const });
    const r = tryNTLead(hand, ctx);
    checkLead(r!.cards, hand);
    checkNoPenalty(r!.cards, hand, ctx);
    expect(r!.cards.length).toBe(5);
    expect(ranks(r!.cards)).toEqual([5, 5, 6, 6, 14]);
    expect(r!.reason).toBe('长花色顶张+拖拉机(5张)');
  });
});

describe('NT lead layer — §5 / §7 later long-suit leads', () => {
  it('second lead: cashes what is left of T1', () => {
    const hand = [c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 10, 0), c('S', 9, 0)];
    const ctx = declarer({
      handCounts: [5, 21, 21, 21] as const, trickHistory: [spadeTractorTrick],
    });
    const r = tryNTLead(hand, ctx);
    checkLead(r!.cards, hand);
    checkNoPenalty(r!.cards, hand, ctx);
    expect(ranks(r!.cards)).toEqual([11, 12, 12]);
    expect(r!.reason).toBe('长花色控制张(3张)');
  });

  it('third lead: only pairs go out', () => {
    const hand = [c('S', 11, 0), c('S', 11, 1), c('S', 10, 0), c('S', 10, 1), c('S', 9, 0)];
    const ctx = declarer({
      handCounts: [5, 17, 17, 17] as const,
      trickHistory: [spadeTractorTrick, spadePairTrick],
    });
    const r = tryNTLead(hand, ctx);
    checkLead(r!.cards, hand);
    checkNoPenalty(r!.cards, hand, ctx);
    expect(ranks(r!.cards)).toEqual([10, 10, 11, 11]);
    expect(r!.reason).toBe('长花色只出对牌(4张)');
  });

  it('third lead with no pair left: feeds the smallest single to a void teammate', () => {
    const hand = [c('S', 11, 0), c('S', 10, 0), c('S', 9, 0), c('S', 8, 0), c('S', 7, 0)];
    const r = tryNTLead(hand, declarer({
      handCounts: [5, 17, 17, 17] as const,
      trickHistory: [spadeTractorTrick, spadePairTrick],
    }));
    checkLead(r!.cards, hand);
    expect(r!.cards.length).toBe(1);
    expect(r!.cards[0].rank).toBe(Rank.Seven);
    expect(r!.reason).toBe('长花色最小单张，让队友毙');
  });

  it('third lead once the suit is exhausted: everything goes out', () => {
    const hand = [
      c('S', 11, 0), c('S', 11, 1), c('S', 10, 0), c('S', 10, 1),
      c('S', 9, 0), c('S', 9, 1), c('S', 8, 0), c('S', 8, 1),
    ];
    const bottom = [
      c('S', 7, 0), c('S', 7, 1), c('S', 6, 0), c('S', 6, 1),
      c('S', 5, 0), c('S', 5, 1), c('S', 4, 0), c('S', 4, 1),
    ];
    // played(6) + bottom(8) + hand(8) = 22 … add the last two to the played set.
    const extra = trick([
      [c('S', 12, 0), c('S', 12, 1)], [c('S', 3, 0), c('S', 3, 1)],
      [c('C', 5, 0), c('C', 5, 1)], [c('D', 5, 0), c('D', 5, 1)],
    ], 0);
    const r = tryNTLead(hand, declarer({
      handCounts: [8, 15, 15, 15] as const,
      trickHistory: [spadeTractorTrick, spadePairTrick, extra],
      bottomCards: bottom,
    }));
    checkLead(r!.cards, hand);
    expect(r!.cards.length).toBe(8);
    expect(r!.reason).toContain('已绝');
  });
});

describe('NT lead layer — §9 non-declarer', () => {
  const nonDeclarer = (over: Partial<AIContext> = {}): AIContext => ctxOf({
    myIndex: 1, isDeclarer: false, isDeclarerPartner: false, isAttacker: true,
    declarerIndex: 0, ...over,
  });

  it('first long-suit lead: all control cards at once', () => {
    const hand = mixedHand.filter(x => x.suit === Suit.Spades);
    const ctx = nonDeclarer({ handCounts: [25, 9, 25, 25] as const });
    const r = tryNTLead(hand, ctx);
    checkLead(r!.cards, hand);
    checkNoPenalty(r!.cards, hand, ctx);
    expect(ranks(r!.cards)).toEqual([11, 12, 12, 13, 13, 14, 14]);
    expect(r!.reason).toBe('长花色控制张(7张)');
  });

  it('leaves the suit alone once a lone control card is all that is left', () => {
    // One control card only -> §5 global exception, nothing to lead here.
    const hand = [c('S', 11, 0), c('S', 10, 0), c('S', 9, 0), c('S', 8, 0), c('S', 7, 0)];
    const r = tryNTLead(hand, nonDeclarer({
      handCounts: [25, 5, 25, 25] as const, trickHistory: [spadeTractorTrick],
    }));
    expect(r).toBeNull();
  });
});

describe('NT lead layer — §6 trump risk', () => {
  it('draws trumps safely first when opponents could trump the lead', () => {
    const hand = [
      ...mixedHand.filter(x => x.suit === Suit.Spades),
      c('J', 16, 0),
      c('H', 2, 0), c('D', 2, 0),
    ];
    const ntState = {
      knownTrumpsPerPlayer: [[], [], [], []] as readonly (readonly Card[])[],
      playersWithNoTrump: new Set<number>(),
      totalTrumps: 12 as const,
      opponentTrumpCount: 0,
      remainingBigJokers: 1, remainingSmallJokers: 2,
      allUnseenJokersOnOurSide: true, allUnseenBigJokersOnOurSide: true,
      possibleTrumps: [null, {}, {}, {}] as any,
      isFullyDetermined: false,
      canFormPair: [false, false, false, false],
      canHaveJoker: [false, false, false, false],
      canHaveBigJoker: [false, false, false, false],
      canHaveSmallJoker: [false, false, false, false],
      minTrumpCounts: [0, 3, 3, 2] as const,
      maxTrumpCounts: [0, 12, 12, 12] as const,
    };
    const r = tryNTLead(hand, declarer({
      handCounts: [hand.length, 20, 20, 20] as const,
      trickHistory: [spadeTractorTrick], ntState: ntState as any,
    }));
    checkLead(r!.cards, hand);
    expect(r!.cards.length).toBe(1);
    expect(r!.cards[0].rank).toBe(Rank.BigJoker);
    expect(r!.reason).toBe('吊主(大王)');
  });
});

describe('NT lead layer — scope and safety', () => {
  it('does nothing outside NT', () => {
    const suited: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
    const ctx: AIContext = { ...minimalContext(suited), myIndex: 0, isDeclarer: true };
    expect(tryNTLead(mixedHand, ctx)).toBeNull();
  });

  it('does nothing without a seat index', () => {
    expect(tryNTLead(mixedHand, ctxOf({ myIndex: -1 }))).toBeNull();
  });

  it('the general ladder still runs when the layer abstains', () => {
    const suited: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
    const r = aiLeadPlay(mixedHand, suited);
    expect(validateLead(r.cards, mixedHand, suited).valid).toBe(true);
  });

  it('abstains once my cards in the long suit are all gone', () => {
    // The long suit is fixed from the initial hand, so it can outlive my cards
    // in it. Nothing must be produced (and nothing must crash) in that state.
    const t1 = trick([
      [c('S', 14, 0), c('S', 14, 1), c('S', 13, 2), c('S', 13, 3)],
      [c('H', 3, 0), c('H', 3, 1), c('H', 4, 0), c('H', 4, 1)],
      [c('C', 3, 0), c('C', 3, 1), c('C', 4, 0), c('C', 4, 1)],
      [c('D', 3, 0), c('D', 3, 1), c('D', 4, 0), c('D', 4, 1)],
    ], 0);
    const t2 = trick([
      [c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 10, 0), c('S', 9, 0)],
      [c('H', 6, 0), c('H', 6, 1), c('H', 7, 0), c('H', 7, 1), c('H', 8, 0)],
      [c('C', 6, 0), c('C', 6, 1), c('C', 7, 0), c('C', 7, 1), c('C', 8, 0)],
      [c('D', 6, 0), c('D', 6, 1), c('D', 7, 0), c('D', 7, 1), c('D', 8, 0)],
    ], 0);
    const hand = [c('H', 3, 0), c('C', 4, 0)];
    const ctx = declarer({
      handCounts: [2, 10, 10, 10] as const, trickHistory: [t1, t2],
    });
    // The suit was 9 cards long when it was designated, all of them now played.
    expect(computeLongSuit([...hand, ...t1.plays[0].cards, ...t2.plays[0].cards], ctx))
      .toBe(Suit.Spades);
    expect(tryNTLead(hand, ctx)).toBeNull();
    const r = aiLeadPlay(hand, ctx);
    expect(validateLead(r.cards, hand, cfgNT).valid).toBe(true);
  });

  it('keeps the long suit after it has been trumped', () => {
    const hand = mixedHand.filter(x => x.suit === Suit.Spades);
    // Trick 1: I led spades and got trumped; the lead moved on.
    const trumped = trick([
      [c('S', 4, 0)], [c('J', 15, 1)], [c('C', 3, 2)], [c('C', 4, 3)],
    ], 0, 1);
    const ctx = declarer({ handCounts: [9, 20, 20, 20] as const, trickHistory: [trumped] });
    expect(computeLongSuit(hand, ctx)).toBe(Suit.Spades);
    const r = tryNTLead(hand, ctx);
    checkLead(r!.cards, hand);
    checkNoPenalty(r!.cards, hand, ctx);
    expect(r!.cards.every(x => x.suit === Suit.Spades)).toBe(true);
  });

  it('a trick led by someone else never turns their cards into my controls', () => {
    // 用户场景（种子 41 / 发牌序号 28 第 10 墩）：第 3 墩由 AI-2 领出 ♥A♥A♥K。
    // 修复前 myPlayedCards 把这三张记成"我出的"，♥ 的两张 A 从最坏手里消失，
    // 我手上的 ♥K 被提升成 ♥ 的控制张，§1 就把这张单张 K 领出去（随后被对手
    // 最后一张主毙掉，白送 25 分）。修复后 ♥ 没有控制张，长花色接管。
    const hand = [
      c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1),
      c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 10, 0), c('S', 9, 0),
      c('H', 13, 0), c('H', 5, 0), c('D', 3, 0),
    ];
    const ledByP1 = trick([
      [c('C', 3, 0), c('C', 4, 0), c('C', 5, 0)],        // 座位序：我（P0）垫三张 ♣
      [c('H', 14, 0), c('H', 14, 1), c('H', 13, 1)],     // P1 领出 ♥AAK
      [c('D', 4, 0), c('D', 5, 0), c('D', 6, 0)],
      [c('D', 7, 0), c('D', 8, 0), c('D', 9, 0)],
    ], 1);
    const ctx = declarer({ handCounts: [12, 22, 22, 22] as const, trickHistory: [ledByP1] });
    const r = tryNTLead(hand, ctx);
    checkLead(r!.cards, hand);
    expect(r!.cards.every(x => x.suit === Suit.Spades)).toBe(true);
  });
});
