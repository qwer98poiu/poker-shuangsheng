/**
 * AI lead play strategies — tactics for choosing what to lead when
 * it's our turn to start a trick.
 */
import type { Card, ComboClass } from '../types.js';
import { Rank, SpecialSuit, Suit, isPointRank } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { findAllPairs, detectTractors, classify as classifyCombo } from '../pattern/index.js';
import type { AIContext } from './types.js';
import { canBeat, maxCardT, groupBySuit, suitLabelCn, getTopOffSuitRank } from './utils.js';
import { findThrowableOffSuitCombos } from './throw-detector.js';
import { canFormJokerPair, opponentsHaveTrump } from './nt-tracking.js';
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

// ---- NT trump drawing ----

function shouldDrawTrumpInNT(ctx: AIContext): boolean {
  if (!ctx.ntState) return false;
  const s = ctx.ntState;

  // Rule 1: Opponents have no trump -> stop unless level is points + attacker leading + not yet 80
  if (!opponentsHaveTrump(s, ctx.myIndex)) {
    if (!isPointRank(ctx.level as Rank)) return false;
    if (!ctx.isAttacker || ctx.playCount > 0) return false;
    if (ctx.attackerPoints >= 80) return false;
    return true;
  }

  return true;
}

function pickNTTrumpLead(
  hand: Card[],
  trumpCards: Card[],
  ctx: AIContext,
): { cards: Card[]; reason: string } | null {
  const s = ctx.ntState!;
  const myTrumpPairs = findAllPairs(trumpCards);
  const levelPairs = myTrumpPairs.filter(p => p[0].suit !== SpecialSuit.Joker);
  const jokerPairs = myTrumpPairs.filter(p => p[0].suit === SpecialSuit.Joker);
  const smallJokerPair = jokerPairs.find(p => p[0].rank === Rank.SmallJoker);
  const opponents = [0, 1, 2, 3].filter(p => p % 2 !== ctx.myIndex % 2);
  const oppsHaveTrump = opponents.some(p => s.maxTrumpCounts[p] > 0);

  // Rule 5 (highest): SJ pair + level pair forms tractor -> lead if opponents can't beat
  if (smallJokerPair && levelPairs.length > 0) {
    for (const lp of levelPairs) {
      const tractorCandidate = [...smallJokerPair, ...lp];
      const tractors = detectTractors(tractorCandidate, ctx);
      if (tractors.length > 0 && tractors.some(t => t.length === 4)) {
        // SJ+level tractor can only be beaten by BJ+SJ tractor (BJ+SJ pair from 1 player)
        const canAnyBeat = opponents.some(p =>
          s.canFormPair[p] && s.canHaveBigJoker[p] && s.canHaveSmallJoker[p],
        );
        if (!canAnyBeat) {
          return { cards: tractorCandidate, reason: '吊主(小王对+级牌对拖拉机)' };
        }
      }
    }
  }

  // Rule 3: Level pair exists + no opponent joker pair -> lead level pair
  if (levelPairs.length > 0) {
    const noOpponentJokerPair = opponents.every(
      p => !canFormJokerPair(p, s),
    );
    if (noOpponentJokerPair && oppsHaveTrump) {
      levelPairs.sort((a, b) =>
        getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx),
      );
      return { cards: levelPairs[0], reason: '吊主(级牌对，对手无王对)' };
    }
  }

  // Rule 4: Single big joker or small joker (BJ on our side) -> draw single
  const myBigJokers = trumpCards.filter(c => c.rank === Rank.BigJoker);
  const mySmallJokers = trumpCards.filter(c => c.rank === Rank.SmallJoker);

  if (myBigJokers.length > 0 && oppsHaveTrump) {
    return { cards: [myBigJokers[0]], reason: '吊主(大王)' };
  }

  if (mySmallJokers.length > 0 && s.allUnseenBigJokersOnOurSide && oppsHaveTrump) {
    return { cards: [mySmallJokers[0]], reason: '吊主(小王，大王全在我方)' };
  }

  // Rule 2: All unseen jokers on our side -> draw level cards to clear
  if (s.allUnseenJokersOnOurSide) {
    const levelCards = trumpCards.filter(c => c.suit !== SpecialSuit.Joker);
    if (levelCards.length > 0) {
      levelCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      return { cards: [levelCards[0]], reason: '吊主(级牌)' };
    }
    if (trumpCards.length > 0) {
      trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      return { cards: [trumpCards[0]], reason: '吊主' };
    }
  }

  // Rule 6: Opponents can't form pairs -> drawing single is safe
  const allOpponentsNoPair = opponents.every(p => !s.canFormPair[p]);
  if (allOpponentsNoPair && trumpCards.length > 0) {
    trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    return { cards: [trumpCards[0]], reason: '吊主(对手无对)' };
  }

  return null; // Not advantageous to draw
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
