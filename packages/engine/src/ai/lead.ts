/**
 * AI lead play strategies — tactics for choosing what to lead when
 * it's our turn to start a trick.
 */
import type { Card, ComboClass } from '../types.js';
import { Rank, Suit, isPointRank } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { findAllPairs, detectTractors, classify as classifyCombo } from '../pattern/index.js';
import type { AIContext } from './types.js';
import { canBeat, maxCardT, groupBySuit, suitLabelCn, getTopOffSuitRank } from './utils.js';
import { findThrowableOffSuitCombos } from './throw-detector.js';
import { shouldDrawTrumpInNT, pickNTTrumpLead } from './nt-trump.js';
import { tryNTLead } from './nt-lead.js';
import { rankLabelStr } from './reason.js';

// ---- Strategy 4: Throw off-suit ----

function tryLeadThrowOffSuit(
  hand: Card[],
  ctx: AIContext,
): { cards: Card[]; reason: string } | null {
  const result = findThrowableOffSuitCombos(hand, ctx);
  if (!result) return null;
  // If the throwable combo is a pure tractor (no extra singles/pairs),
  // label it as a tractor, not a throw. "甩牌" is for composite patterns.
  const combo = classifyCombo(result.cards, ctx);
  if (combo.type === 'tractor' && combo.length === result.cards.length) {
    const isTrumpT = result.cards.every(c => isTrump(c, ctx));
    const pairs = result.cards.length / 2;
    const reason = isTrumpT
      ? `出主拖拉机(${pairs}对)`
      : `出${suitLabelCn(result.cards[0].suit)}拖拉机(${pairs}对)`;
    return { cards: result.cards, reason };
  }
  return { cards: result.cards, reason: result.reason };
}

// ---- Strategy 1: Lead big off-suit A/K ----

function tryLeadBigCard(
  hand: Card[],
  ctx: AIContext,
): { cards: Card[]; reason: string } | null {
  const nonTrump = hand.filter(c => !isTrump(c, ctx));
  if (nonTrump.length === 0) return null;

  const bySuit = groupBySuit(nonTrump);

  for (const suitGroup of bySuit) {
    if (suitGroup.length === 0) continue;
    const suit = suitGroup[0].suit;
    const topRank = getTopOffSuitRank(suit as Suit, ctx);

    // Try pair of top-rank cards first
    const topPairs = findAllPairs(suitGroup).filter(
      p => p[0].rank === topRank,
    );
    if (topPairs.length > 0) {
      const suitStr = suitLabelCn(suit);
      return { cards: topPairs[0], reason: `出副牌${suitStr}${rankLabelStr(topRank)}对` };
    }

    // Try single top-rank card
    const topSingles = suitGroup.filter(c => c.rank === topRank);
    if (topSingles.length > 0) {
      const suitStr = suitLabelCn(suit);
      return { cards: [topSingles[0]], reason: `出副牌${suitStr}${rankLabelStr(topRank)}` };
    }
  }

  return null;
}

// ---- Strategy 3: Lead tractors ----

function tryLeadTractor(
  hand: Card[],
  ctx: AIContext,
  myHandCount: number,
): { cards: Card[]; reason: string } | null {
  const tractors = detectTractors(hand, ctx);
  if (tractors.length === 0) return null;

  // Filter based on declarer restrictions
  let eligible = tractors;
  if (ctx.isDeclarer && myHandCount >= 20) {
    // Don't lead trump tractors with cards above A
    eligible = tractors.filter(t => {
      if (!t.every(c => isTrump(c, ctx))) return true; // off-suit tractor is fine
      return t.every(c => getEffectiveRank(c, ctx) <= getEffectiveRank({ suit: ctx.trumpSuit ?? Suit.Spades, rank: Rank.Ace, isJoker: false, id: '' } as Card, ctx));
    });
  }
  if (ctx.isDeclarerPartner && ctx.myIndex >= 0) {
    // Never lead trump tractors
    eligible = eligible.filter(t => !t.every(c => isTrump(c, ctx)));
  }

  if (eligible.length === 0) return null;

  // Prefer off-suit tractors first, then smallest trump tractors
  eligible.sort((a, b) => {
    const aTrump = a.every(c => isTrump(c, ctx));
    const bTrump = b.every(c => isTrump(c, ctx));
    if (aTrump && !bTrump) return 1; // off-suit first
    if (!aTrump && bTrump) return -1;
    // Both same type: prefer longer, then smaller max rank
    if (a.length !== b.length) return b.length - a.length;
    return getEffectiveRank(maxCardT(a, ctx), ctx) - getEffectiveRank(maxCardT(b, ctx), ctx);
  });

  const chosen = eligible[0];
  const isTrumpTractor = chosen.every(c => isTrump(c, ctx));
  const pairs = chosen.length / 2;
  const reason = isTrumpTractor
    ? `出主拖拉机(${pairs}对)`
    : `出${suitLabelCn(chosen[0].suit)}拖拉机(${pairs}对)`;
  return { cards: chosen, reason };
}

// ---- Strategy 2: Lead pairs ----

function tryLeadPairs(
  hand: Card[],
  ctx: AIContext,
  myHandCount: number,
): { cards: Card[]; reason: string } | null {
  const allPairs = findAllPairs(hand);
  if (allPairs.length === 0) return null;

  // Apply declarer restrictions
  let eligible = allPairs;
  if (ctx.isDeclarer && myHandCount >= 20) {
    eligible = allPairs.filter(p => !p.every(c => isTrump(c, ctx)));
  }
  if (ctx.isDeclarerPartner && ctx.myIndex >= 0) {
    eligible = eligible.filter(p => !p.every(c => isTrump(c, ctx)));
  }

  if (eligible.length === 0) return null;

  // Sort: off-suit J+ first, then by effective rank
  eligible.sort((a, b) => {
    const aTrump = a.every(c => isTrump(c, ctx));
    const bTrump = b.every(c => isTrump(c, ctx));
    if (aTrump && !bTrump) return 1; // off-suit first
    if (!aTrump && bTrump) return -1;
    if (!aTrump && !bTrump) {
      // Off-suit pairs: J+ priority
      const aBig = a[0].rank >= Rank.Jack ? 0 : 1;
      const bBig = b[0].rank >= Rank.Jack ? 0 : 1;
      if (aBig !== bBig) return aBig - bBig;
    }
    // Non-point first, then smallest effective rank
    const aPts = isPointRank(a[0].rank) ? 100 : 0;
    const bPts = isPointRank(b[0].rank) ? 100 : 0;
    if (aPts !== bPts) return aPts - bPts;
    return getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx);
  });

  const chosen = eligible[0];
  const isTrumpPair = chosen.every(c => isTrump(c, ctx));
  const reason = isTrumpPair ? '出主对' : `出${suitLabelCn(chosen[0].suit)}对子`;
  return { cards: chosen, reason };
}

// ---- Strategy 5: Draw trump ----

function tryDrawTrump(
  hand: Card[],
  ctx: AIContext,
  _myHandCount: number,
): { cards: Card[]; reason: string } | null {
  if (ctx.trumpSuit === null) {
    // NT: check if we should draw trump (special rules)
    if (!shouldDrawTrumpInNT(ctx)) return null;
    const trumpCards = hand.filter(c => isTrump(c, ctx));
    if (trumpCards.length === 0) return null;
    return pickNTTrumpLead(hand, trumpCards, ctx);
  }

  // Suited: only draw if we have single trump smaller than A
  const trumpCards = hand.filter(c => isTrump(c, ctx));
  if (trumpCards.length === 0) return null;

  const hasSmallTrump = trumpCards.some(
    c => getEffectiveRank(c, ctx) < getEffectiveRank({ suit: ctx.trumpSuit ?? Suit.Spades, rank: Rank.Ace, isJoker: false, id: '' } as Card, ctx),
  );
  if (!hasSmallTrump) return null;

  trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
  return { cards: [trumpCards[0]], reason: '吊主' };
}

// ---- Strategy 6: Lead small off-suit single ----

function tryLeadSmall(
  hand: Card[],
  ctx: AIContext,
): { cards: Card[]; reason: string } | null {
  const nonTrump = hand.filter(c => !isTrump(c, ctx));
  if (nonTrump.length === 0) {
    // Only trump left - lead smallest trump
    const trumpCards = hand.filter(c => isTrump(c, ctx));
    trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    return { cards: [trumpCards[0]], reason: '出最小牌' };
  }

  // Pick the longest off-suit, lead smallest card from it
  const bySuit = groupBySuit(nonTrump);
  const longest = bySuit.reduce((best, cds) =>
    cds.length > best.length ? cds : best, bySuit[0] || [],
  );
  if (longest.length > 0) {
    longest.sort((a, b) => a.rank - b.rank);
    return { cards: [longest[0]], reason: `出${suitLabelCn(longest[0].suit)}小牌，长套引诱对手出分` };
  }

  return null;
}

// ---- Strategy 7: Last cards ----

function leadLastCards(
  hand: Card[],
  ctx: AIContext,
): { cards: Card[]; reason: string } {
  if (hand.length === 1) return { cards: hand, reason: '最后一张手牌，必出' };

  // Check for last pair or tractor
  const tractors = detectTractors(hand, ctx);
  if (tractors.length > 0 && tractors[0].length === hand.length) {
    return { cards: hand, reason: `出最后一个拖拉机(${hand.length / 2}对)` };
  }

  const pairs = findAllPairs(hand);
  if (pairs.length > 0 && pairs[0].length === hand.length) {
    return { cards: hand, reason: '出最后一对' };
  }

  return { cards: hand, reason: `最后${hand.length}张手牌，必出` };
}

// ---- Main lead orchestrator ----

export function _aiLeadPlay(
  hand: Card[],
  ctx: AIContext,
): { cards: Card[]; reason: string } {
  const myHandCount = ctx.myIndex >= 0 ? ctx.handCounts[ctx.myIndex] : hand.length;

  // NT long-suit layer: in no-trump rounds the long suit is played in phases
  // (control cards first, then the suit itself). Falls through when it has
  // nothing to say.
  const ntResult = tryNTLead(hand, ctx);
  if (ntResult) return ntResult;

  // Strategy 4: Throw off-suit (highest priority)
  const throwResult = tryLeadThrowOffSuit(hand, ctx);
  if (throwResult) return throwResult;

  // Strategy 1: Lead big off-suit A/K (single or pair)
  const bigResult = tryLeadBigCard(hand, ctx);
  if (bigResult) return bigResult;

  // Strategy 3: Lead tractors
  const tractorResult = tryLeadTractor(hand, ctx, myHandCount);
  if (tractorResult) return tractorResult;

  // Strategy 2: Lead pairs (off-suit J+ priority, declarer restrictions)
  const pairResult = tryLeadPairs(hand, ctx, myHandCount);
  if (pairResult) return pairResult;

  // Strategy 5: Draw trump (smallest trump, not applicable in NT generally)
  const drawResult = tryDrawTrump(hand, ctx, myHandCount);
  if (drawResult) return drawResult;

  // Strategy 6: Lead small off-suit single
  const smallResult = tryLeadSmall(hand, ctx);
  if (smallResult) return smallResult;

  // Strategy 7: Last card(s) - must play
  return leadLastCards(hand, ctx);
}
