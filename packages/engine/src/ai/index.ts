/**
 * AI module - leading, following, revealing, bottom exchange strategies.
 *
 * All exported functions accept either AIContext (full game state) or
 * plain TrumpDeclaration (for backward compatibility).
 */
import type { Card, CardSuit, ComboClass } from '../types.js';
import { Rank, SpecialSuit, Suit, SUIT_ORDER, isPointRank } from '../types.js';
import type { TrumpDeclaration } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { findAllPairs, detectTractors, classify as classifyCombo } from '../pattern/index.js';
import { compareTwo } from '../comparing/index.js';
import type { AIContext } from './types.js';
import {
  getPositionInTrick, isTeammateWinning, canBeat, maxCardT, teammateWins,
  isBigOffSuitCard, isPointCard, pairSortAsc, discardSort, fillerSort,
  groupBySuit, suitLabelCn, cardName, getTopOffSuitRank,
} from './utils.js';
import { findThrowableOffSuitCombos } from './throw-detector.js';
import { aiChooseBottomCards as aiChooseBottomImpl } from './bottom-strategy.js';
import {
  canFormJokerPair, opponentsHaveTrump, canAnyOpponentBeatSingle, canAnyOpponentBeatPair,
} from './nt-tracking.js';

// ---- Public API ----

export interface AIResult<T> {
  decision: T;
  reason: string;
}

export { groupBySuit };
export { buildAIContext, computeBestSoFar } from './context.js';
export type { AIContext, NTTrumpState, PlayPosition } from './types.js';
export { findThrowableOffSuitCombos } from './throw-detector.js';

/** try to reveal trump during dealing */
export function aiTryReveal(
  hand: Card[],
  _dealtCards: Card[],
  _playerIndex: number,
  level: number,
  currentReveal: { suit: Suit | null; strength: number } | null,
): { suit: Suit | null; reason: string } | null {
  const allCards = hand;

  const bigJokers = allCards.filter(c => c.rank === Rank.BigJoker);
  const smallJokers = allCards.filter(c => c.rank === Rank.SmallJoker);
  if (bigJokers.length >= 2 || smallJokers.length >= 2) {
    if (!currentReveal || currentReveal.strength < 3) {
      return { suit: null, reason: '有对王，亮无主' };
    }
  }

  for (const suit of SUIT_ORDER) {
    const levelCards = allCards.filter(c => c.suit === suit && c.rank === level);
    if (levelCards.length >= 2) {
      if (!currentReveal || currentReveal.strength < 2) {
        return { suit, reason: `有${suitLabelCn(suit)}级牌对，亮主` };
      }
    }
  }

  for (const suit of SUIT_ORDER) {
    const levelCards = allCards.filter(c => c.suit === suit && c.rank === level);
    if (levelCards.length >= 1) {
      if (!currentReveal) {
        return { suit, reason: `有${suitLabelCn(suit)}级牌单张，亮主` };
      }
    }
  }

  return null;
}

/** Bottom exchange - delegates to bottom-strategy module. */
export function aiChooseBottomCards(
  hand: Card[],
  config: AIContext | TrumpDeclaration,
): { keep: Card[]; discard: Card[]; reason: string } {
  return aiChooseBottomImpl(hand, config);
}

// ---- Leading strategy ----

/** decide what to lead */
export function aiLeadPlay(
  hand: Card[],
  config: AIContext | TrumpDeclaration,
): { cards: Card[]; reason: string } {
  const ctx = ensureContext(config);
  const result = _aiLeadPlay(hand, ctx);
  return { cards: result.cards, reason: maybeAppendFinal(result.cards, hand, result.reason, ctx) };
}

function _aiLeadPlay(
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

// ---- Strategy 4: Throw off-suit ----

function tryLeadThrowOffSuit(
  hand: Card[],
  ctx: AIContext,
): { cards: Card[]; reason: string } | null {
  const result = findThrowableOffSuitCombos(hand, ctx);
  if (!result) return null;
  return { cards: result.cards, reason: result.reason };
}

// ---- Strategy 1: Lead big off-suit A/K ----

function tryLeadBigCard(
  hand: Card[],
  ctx: AIContext,
): { cards: Card[]; reason: string } | null {
  const nonTrump = hand.filter(c => !isTrump(c, ctx));
  if (nonTrump.length === 0) return null;

  // Group by suit
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
      // Trump tractor: only allow if all cards <= A (effective rank)
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

  if (eligible.length === 0) {
    // If restricted but must play something, skip this strategy
    return null;
  }

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
  myHandCount: number,
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

  // Otherwise, pickNTTrumpLead decides the specific play.
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

  return null; // Rule 6: not advantageous to draw
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

// ---- Following strategy ----

/** decide what to follow */
export function aiFollowPlay(
  hand: Card[],
  leadCards: Card[],
  leadSuit: CardSuit,
  config: AIContext | TrumpDeclaration,
  bestSoFar?: { cards: Card[]; playerIdx: number } | null,
  myIdx?: number,
): { cards: Card[]; reason: string } {
  const ctx = ensureContext(config, bestSoFar, myIdx);
  const result = _aiFollowPlay(hand, leadCards, leadSuit, ctx);
  return { cards: result.cards, reason: maybeAppendFinal(result.cards, hand, result.reason, ctx) };
}

function _aiFollowPlay(
  hand: Card[],
  leadCards: Card[],
  leadSuit: CardSuit,
  ctx: AIContext,
): { cards: Card[]; reason: string } {
  const leadLen = leadCards.length;
  const leadIsTrump = leadCards.every(c => isTrump(c, ctx));
  const leadCombo = classifyCombo(leadCards, ctx);
  const position = ctx.myIndex >= 0 ? getPositionInTrick(ctx) : 'lead';
  const tmWin = isTeammateWinning(ctx);

  // ---- Trump/Joker lead ----
  if (!leadSuit || leadSuit === SpecialSuit.Joker || leadIsTrump) {
    return followTrumpLead(hand, leadCards, leadCombo, ctx, position, tmWin);
  }

  // ---- Off-suit lead ----
  const leadSuitCards = hand.filter(
    c => c.suit === leadSuit && !isTrump(c, ctx),
  );
  const trumpCards = hand.filter(c => isTrump(c, ctx));

  // ---- Throw lead (甩牌) ----
  if (leadCombo.type === 'throw') {
    if (leadIsTrump) {
      return followTrumpThrow(hand, leadLen, ctx, position, tmWin);
    }
    return followOffSuitThrow(hand, leadCards, leadSuitCards, trumpCards, leadLen, ctx, position, tmWin);
  }

  // ---- Standard off-suit follow ----

  // Have enough lead-suit cards
  if (leadSuitCards.length >= leadLen) {
    return followOffSuit(leadSuitCards, leadCards, leadLen, leadCombo, ctx, position, tmWin, trumpCards);
  }

  // Short-suited - must play all lead-suit cards
  if (leadSuitCards.length > 0) {
    const other = hand.filter(c => !leadSuitCards.includes(c));
    other.sort(fillerSort(!!tmWin, ctx));
    const fill = other.slice(0, leadLen - leadSuitCards.length);
    const cards = [...leadSuitCards, ...fill];
    const baseReason = fill.some(c => isTrump(c, ctx))
      ? '同花色不够，垫主牌'
      : fill.some(c => c.suit !== leadSuitCards[0].suit)
        ? '同花色不够，垫其他花色'
        : '垫同花色';
    const shouldAvoid = (position === 'fourth' && !tmWin)
      || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx));
    const intent = shouldAvoid ? 'avoid' : 'none';
    const reason = annotateReason(baseReason, cards, leadSuitCards, trumpCards,
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Void in lead suit - try to trump
  if (trumpCards.length >= leadLen) {
    return trumpKill(trumpCards, hand, leadCards, leadCombo, leadLen, ctx, position, tmWin);
  }

  // Can't fully trump - discard
  return discardNonTrump(hand, leadLen, ctx, position, tmWin);
}

// ---- Follow trump lead ----

function followTrumpLead(
  hand: Card[],
  leadCards: Card[],
  leadCombo: ComboClass,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  const leadLen = leadCards.length;
  const myTrump = hand.filter(c => isTrump(c, ctx));

  // NT special handling for trump follow
  if (ctx.trumpSuit === null && ctx.ntState) {
    return followNTTrumpLead(hand, leadCards, leadLen, leadCombo, ctx, position, tmWin);
  }

  // Use bestSoFar's max rank (not leadMax) — someone may have already beaten the lead.
  const bs = ctx.bestSoFar;
  const currentMax = bs && bs.cards.length > 0
    ? Math.max(...bs.cards.map(c => getEffectiveRank(c, ctx)))
    : Math.max(...leadCards.map(c => getEffectiveRank(c, ctx)));

  if (leadLen === 1) {
    // Single trump lead
    if (myTrump.length > 0) {
      const canBeatCards = myTrump.filter(c => getEffectiveRank(c, ctx) > currentMax);
      if (canBeatCards.length > 0) {
        // Position 2: generally play small unless have tractor/throw to seize lead
        if (position === 'second') {
          myTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
          return { cards: [myTrump[0]], reason: '同花色出小' };
        }
        canBeatCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
        const cards = [canBeatCards[0]];
        const fourthBeat = position === 'fourth' && !tmWin;
        const intent = (tmWin && canAddPoints(tmWin, position, leadCombo, ctx)) ? 'add'
          : fourthBeat ? 'beat_points' : 'none';
        const reason = annotateReason('同花色出大', cards, [], myTrump,
          leadCombo, 1, ctx, position, tmWin, false, intent);
        return { cards, reason };
      }
      myTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      const cards = [myTrump[0]];
      const intent = 'none';
      const reason = annotateReason('同花色出小', cards, [], myTrump,
        leadCombo, 1, ctx, position, tmWin, false, intent);
      return { cards, reason };
    }
    // No trump - discard
    const nonTrump = hand.filter(c => !isTrump(c, ctx));
    nonTrump.sort(discardSort(!!tmWin, ctx));
    return { cards: [nonTrump[0] || hand[0]], reason: '垫牌' };
  }

  // Multi-card trump lead - match pattern
  if (myTrump.length >= leadLen) {
    return matchTrumpPattern(myTrump, leadCards, leadCombo, leadLen, ctx, position, tmWin);
  }

  // Not enough trump - pad with discards
  return padWithDiscards(hand, myTrump, leadLen, ctx, tmWin);
}

function matchTrumpPattern(
  myTrump: Card[],
  leadCards: Card[],
  leadCombo: ComboClass,
  leadLen: number,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  // Already fully covered: try to use smallest matching pattern
  if (leadCombo.hasTractor) {
    const myTractors = detectTractors(myTrump, ctx);
    if (myTractors.length > 0) {
      myTractors.sort((a, b) => {
        const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
        const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
        return aMax - bMax;
      });
      let picked = tryMatchTractorSlots(leadCombo, myTractors, myTrump, leadLen, ctx);
      if (picked && !canBeat(picked, ctx.bestSoFar, ctx)) {
        // Sort biggest-first to try finding a beating tractor
        myTractors.sort((a, b) => {
          const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
          const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
          return bMax - aMax;
        });
        const alt = tryMatchTractorSlots(leadCombo, myTractors, myTrump, leadLen, ctx);
        if (alt && canBeat(alt, ctx.bestSoFar, ctx)) picked = alt;
      }
      if (picked) {
        const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
        const intent = addPoints ? 'add' : 'none';
        const beating = canBeat(picked, ctx.bestSoFar, ctx);
        const baseReason = beating ? '同花色出大' : '同花色出小';
        const reason = annotateReason(baseReason, picked, [], myTrump,
          leadCombo, leadLen, ctx, position, tmWin, false, intent);
        return { cards: picked, reason };
      }
    }
    // No tractor - fill with smallest pairs then singles
    const pairs = findAllPairs(myTrump);
    pairKillSort(pairs, myTrump, ctx);
    const chosen = pairs.flat();
    const used = new Set(chosen.map(c => c.id));
    const rest = myTrump.filter(c => !used.has(c.id));
    const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
    rest.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    const cards = [...chosen, ...rest].slice(0, leadLen);
    const intent = addPoints ? 'add' : 'none';
    const reason = annotateReason('垫同花色', cards, [], myTrump,
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  if (leadCombo.pairCount > 0) {
    const myPairs = findAllPairs(myTrump); pairKillSort(myPairs, myTrump, ctx);
    let chosen = myPairs.slice(0, leadCombo.pairCount).flat();
    // If smallest pair(s) cannot beat, try finding a pair that can.
    // For fourth position that can beat, prefer point-card pairs.
    const pairBeating = canBeat(chosen, ctx.bestSoFar, ctx);
    if (!pairBeating) {
      const beatingPairs = myPairs.filter(p => canBeat(p, ctx.bestSoFar, ctx));
      if (beatingPairs.length >= leadCombo.pairCount) {
        const isFourth = position === 'fourth';
        beatingPairs.sort((a, b) => {
          if (isFourth) {
            const aPts = isPointRank(a[0].rank) ? 0 : 100;
            const bPts = isPointRank(b[0].rank) ? 0 : 100;
            if (aPts !== bPts) return aPts - bPts;
          }
          return getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx);
        });
        chosen = beatingPairs.slice(0, leadCombo.pairCount).flat();
      }
    } else if (position === 'fourth') {
      // Fourth can beat — prefer point cards
      const pointBeating = myPairs.filter(p =>
        isPointRank(p[0].rank) && canBeat(p, ctx.bestSoFar, ctx));
      if (pointBeating.length >= leadCombo.pairCount) {
        pointBeating.sort((a, b) =>
          getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx));
        chosen = pointBeating.slice(0, leadCombo.pairCount).flat();
      }
    }
    if (chosen.length < leadLen) {
      const used = new Set(chosen.map(c => c.id));
      const rest = myTrump.filter(c => !used.has(c.id));
      rest.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      chosen.push(...rest.slice(0, leadLen - chosen.length));
    }
    const cards = chosen.slice(0, leadLen);
    const beating = canBeat(cards, ctx.bestSoFar, ctx);
    const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
    const baseReason = beating ? '同花色出大' : '同花色出小';
    const intent = addPoints ? 'add' : 'none';
    const reason = annotateReason(baseReason, cards, [], myTrump,
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Pure singles: play smallest trump
  const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
  if (addPoints) {
    myTrump.sort(discardSort(true, ctx));
  } else {
    myTrump.sort(discardSort(false, ctx));
  }
  const cards2 = myTrump.slice(0, leadLen);
  const intent2 = addPoints ? 'add' : 'none';
  const reason2 = annotateReason('垫同花色', cards2, [], myTrump,
    leadCombo, leadLen, ctx, position, tmWin, false, intent2);
  return { cards: cards2, reason: reason2 };
}

// ---- Follow off-suit lead ----

function followOffSuit(
  leadSuitCards: Card[],
  leadCards: Card[],
  leadLen: number,
  leadCombo: ComboClass,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
  trumpCards: Card[],
): { cards: Card[]; reason: string } {
  if (leadLen === 1) {
    return followOffSuitSingle(leadSuitCards, leadCombo, ctx, position, tmWin, trumpCards);
  }
  return followOffSuitMulti(leadSuitCards, leadCards, leadLen, leadCombo, ctx, position, tmWin);
}

function followOffSuitSingle(
  leadSuitCards: Card[],
  leadCombo: ComboClass,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
  trumpCards: Card[],
): { cards: Card[]; reason: string } {
  leadSuitCards.sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));

  if (canAddPoints(tmWin, position, leadCombo, ctx)) {
    leadSuitCards.sort(discardSort(true, ctx));
    const cards = [leadSuitCards[0]];
    const reason = annotateReason('同花色出小', cards, leadSuitCards, trumpCards,
      leadCombo, 1, ctx, position, tmWin, false, 'add');
    return { cards, reason };
  }

  if (tmWin) {
    leadSuitCards.sort(discardSort(false, ctx));
    const cards = [leadSuitCards[0]];
    const intent = 'none';
    const reason = annotateReason('同花色出小', cards, leadSuitCards, trumpCards,
      leadCombo, 1, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Can't beat opponent - play smallest
  if (!canBeat([leadSuitCards[0]], ctx.bestSoFar, ctx)) {
    leadSuitCards.sort(discardSort(false, ctx));
    const cards = [leadSuitCards[0]];
    const shouldAvoid = (position === 'fourth' && !tmWin)
      || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx));
    const intent = shouldAvoid ? 'avoid' : 'none';
    const reason = annotateReason('同花色出小', cards, leadSuitCards, trumpCards,
      leadCombo, 1, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Can beat opponent - play smallest that beats
  if (ctx.bestSoFar && ctx.bestSoFar.cards.length > 0) {
    const bestRank = Math.max(...ctx.bestSoFar.cards.map(c => getEffectiveRank(c, ctx)));
    const beaters = leadSuitCards.filter(c => getEffectiveRank(c, ctx) > bestRank);
    if (beaters.length > 0) {
      beaters.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      const cards = [beaters[0]];
      // Fourth position beating opponent: try to use point cards
      const fourthBeat = position === 'fourth' && !tmWin;
      const intent = fourthBeat ? 'beat_points' : 'none';
      const reason = annotateReason('同花色出大', cards, leadSuitCards, trumpCards,
        leadCombo, 1, ctx, position, tmWin, false, intent);
      return { cards, reason };
    }
  }

  return { cards: [leadSuitCards[0]], reason: '同花色出大' };
}

function followOffSuitMulti(
  leadSuitCards: Card[],
  leadCards: Card[],
  leadLen: number,
  leadCombo: ComboClass,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  const myPairs = findAllPairs(leadSuitCards);

  // Tractor lead - try to match with tractor
  if (leadCombo.hasTractor) {
    const myTractors = detectTractors(leadSuitCards, ctx);
    if (myTractors.length > 0) {
      myTractors.sort((a, b) => b.length - a.length);
      let picked = tryMatchTractorSlots(leadCombo, myTractors, leadSuitCards, leadLen, ctx);
      if (picked && !canBeat(picked, ctx.bestSoFar, ctx)) {
        // Sort by max rank descending to try finding a beating tractor
        myTractors.sort((a, b) => {
          const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
          const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
          return bMax - aMax;
        });
        const alt = tryMatchTractorSlots(leadCombo, myTractors, leadSuitCards, leadLen, ctx);
        if (alt && canBeat(alt, ctx.bestSoFar, ctx)) picked = alt;
      }
      if (picked) {
        const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
        const intent = addPoints ? 'add' : 'none';
        const beating = canBeat(picked, ctx.bestSoFar, ctx);
        const baseReason = beating ? '同花色出大' : '同花色出小';
        const reason = annotateReason(baseReason, picked, leadSuitCards, [],
          leadCombo, leadLen, ctx, position, tmWin, false, intent);
        return { cards: picked, reason };
      }
    }
    // No tractor - fill with pairs then singles
    if (myPairs.length > 0) {
      pairKillSort(myPairs, leadSuitCards, ctx);
      const chosen = myPairs.flat();
      const used = new Set(chosen.map(c => c.id));
      const rest = leadSuitCards.filter(c => !used.has(c.id));
      const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
      const shouldAvoid = !addPoints
        && ((position === 'fourth' && !tmWin)
          || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx)));
      if (addPoints) {
        rest.sort(discardSort(true, ctx));
      } else if (shouldAvoid) {
        rest.sort(discardSort(false, ctx));
      } else {
        rest.sort((a, b) => a.rank - b.rank);
      }
      const cards = [...chosen, ...rest].slice(0, leadLen);
      const intent = addPoints ? 'add' : (shouldAvoid ? 'avoid' : 'none');
      const reason = annotateReason('垫同花色', cards, leadSuitCards, [],
        leadCombo, leadLen, ctx, position, tmWin, false, intent);
      return { cards, reason };
    }
  }

  // Pair lead - match with pairs
  if (leadCombo.pairCount > 0 && myPairs.length >= leadCombo.pairCount) {
    pairKillSort(myPairs, leadSuitCards, ctx);
    let chosen = myPairs.slice(0, leadCombo.pairCount).flat();
    // If smallest pair(s) cannot beat, try finding a pair that can.
    // For fourth position that can beat, prefer point-card pairs.
    const pairBeats = canBeat(chosen, ctx.bestSoFar, ctx);
    if (!pairBeats) {
      const beatingPairs = myPairs.filter(p => canBeat(p, ctx.bestSoFar, ctx));
      if (beatingPairs.length >= leadCombo.pairCount) {
        const isFourth = position === 'fourth';
        beatingPairs.sort((a, b) => {
          if (isFourth) {
            const aPts = isPointRank(a[0].rank) ? 0 : 100;
            const bPts = isPointRank(b[0].rank) ? 0 : 100;
            if (aPts !== bPts) return aPts - bPts;
          }
          return getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx);
        });
        chosen = beatingPairs.slice(0, leadCombo.pairCount).flat();
      }
    } else if (position === 'fourth') {
      // Fourth can beat — prefer point cards (用分牌盖)
      const pointBeating = myPairs.filter(p =>
        isPointRank(p[0].rank) && canBeat(p, ctx.bestSoFar, ctx));
      if (pointBeating.length >= leadCombo.pairCount) {
        pointBeating.sort((a, b) =>
          getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx));
        chosen = pointBeating.slice(0, leadCombo.pairCount).flat();
      }
    }
    const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
    if (chosen.length < leadLen) {
      const used = new Set(chosen.map(c => c.id));
      const rest = leadSuitCards.filter(c => !used.has(c.id));
      if (addPoints) {
        rest.sort(discardSort(true, ctx));
      } else {
        rest.sort((a, b) => a.rank - b.rank);
      }
      chosen.push(...rest.slice(0, leadLen - chosen.length));
    }
    const cards = chosen.slice(0, leadLen);
    const beating = canBeat(cards, ctx.bestSoFar, ctx);
    const baseReason = beating ? '同花色出大' : '同花色出小';
    const intent = addPoints ? 'add' : 'none';
    const reason = annotateReason(baseReason, cards, leadSuitCards, [],
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Can't match pattern - play smallest
  if (canAddPoints(tmWin, position, leadCombo, ctx)) {
    leadSuitCards.sort(discardSort(true, ctx));
    const cards = leadSuitCards.slice(0, leadLen);
    const reason = annotateReason('垫同花色', cards, leadSuitCards, [],
      leadCombo, leadLen, ctx, position, tmWin, false, 'add');
    return { cards, reason };
  }

  leadSuitCards.sort(discardSort(false, ctx));
  const cards = leadSuitCards.slice(0, leadLen);
  // Third+tmWin avoids. Second/fourth+max pattern+!tmWin also avoids.
  const fourthAvoid = position === 'fourth' && !tmWin;
  const secondAvoid = position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx);
  const intent = (fourthAvoid || secondAvoid) ? 'avoid' : 'none';
  const reason = annotateReason('垫同花色', cards, leadSuitCards, [],
    leadCombo, leadLen, ctx, position, tmWin, false, intent);
  return { cards, reason };
}

// ---- Trump kill ----

/** Check whether our trump kill actually beats the current best play.
 *  Uses the engine's compareTwo for authoritative comparison. */
function canTrumpKillBeat(killCards: Card[], leadCards: Card[], ctx: AIContext): boolean {
  const bs = ctx.bestSoFar;
  if (!bs || bs.cards.length === 0) return true;
  // If no-one has played trump yet, any trump beats off-suit
  if (!bs.cards.some(c => isTrump(c, ctx))) return true;
  // Both have trump — use engine comparison
  return compareTwo(bs.cards, killCards, leadCards, ctx) === 'second';
}

/** Whether someone before us has already killed with trump — we must overkill. */
function isOverkill(ctx: AIContext): boolean {
  const bs = ctx.bestSoFar;
  return !!(bs && bs.cards.length > 0 && bs.cards.some(c => isTrump(c, ctx)));
}

function trumpKill(
  trumpCards: Card[],
  hand: Card[],
  leadCards: Card[],
  leadCombo: ComboClass,
  leadLen: number,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  const nonTrump = hand.filter(c => !isTrump(c, ctx));

  // Determine if the trick has points
  const hasPoints = leadCards.some(c => isPointRank(c.rank))
    || (ctx.bestSoFar && ctx.bestSoFar.cards.some(c => isPointRank(c.rank)));

  if (leadLen === 1) {
    return trumpKillSingle(trumpCards, nonTrump, ctx, position, tmWin, hasPoints);
  }

  const overkill = isOverkill(ctx);

  if (leadCombo.hasTractor) {
    const myTractors = detectTractors(trumpCards, ctx);
    if (myTractors.length > 0) {
      // Sort by max rank — ascending for no-points, descending for points
      myTractors.sort((a, b) => {
        const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
        const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
        return aMax - bMax;
      });
      if (hasPoints && !overkill) myTractors.reverse(); // biggest first
      let picked = tryMatchTractorSlots(leadCombo, myTractors, trumpCards, leadLen, ctx);
      if (picked && !canTrumpKillBeat(picked, leadCards, ctx)) {
        // Reverse sort to try finding a tractor that can beat
        myTractors.reverse();
        const alt = tryMatchTractorSlots(leadCombo, myTractors, trumpCards, leadLen, ctx);
        if (alt && canTrumpKillBeat(alt, leadCards, ctx)) picked = alt;
      }
      if (picked && canTrumpKillBeat(picked, leadCards, ctx)) {
        const reason = overkill ? '盖毙' : '用主牌毙';
        return { cards: picked, reason };
      }
    }
    // Can't match tractor or can't beat - discard
    return discardNonTrump(hand, leadLen, ctx, position, tmWin);
  }

  if (leadCombo.pairCount > 0) {
    const myPairs = findAllPairs(trumpCards);
    pairKillSort(myPairs, trumpCards, ctx);
    if (hasPoints && !overkill) myPairs.reverse(); // biggest first for points
    if (myPairs.length >= leadCombo.pairCount) {
      let chosen = myPairs.slice(0, leadCombo.pairCount).flat();
      // If selected pair cannot beat, scan for one that can
      if (!canTrumpKillBeat(chosen, leadCards, ctx)) {
        const beatingPairs = myPairs.filter(p => canTrumpKillBeat(p, leadCards, ctx));
        if (beatingPairs.length >= leadCombo.pairCount) {
          // For overkill/no-points: smallest beating. For hasPoints: biggest beating.
          beatingPairs.sort((a, b) =>
            getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx));
          if (hasPoints && !overkill) beatingPairs.reverse();
          chosen = beatingPairs.slice(0, leadCombo.pairCount).flat();
        }
      }
      if (!canTrumpKillBeat(chosen, leadCards, ctx)) {
        return discardNonTrump(hand, leadLen, ctx, position, tmWin);
      }
      if (chosen.length === leadLen) {
        const reason = overkill ? '盖毙' : '用主牌毙';
        return { cards: chosen, reason };
      }
      const used = new Set(chosen.map(c => c.id));
      const rest = trumpCards.filter(c => !used.has(c.id));
      rest.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      const result = [...chosen, ...rest.slice(0, leadLen - chosen.length)];
      if (canTrumpKillBeat(result, leadCards, ctx)) {
        const reason = overkill ? '盖毙' : '用主牌毙';
        return { cards: result, reason };
      }
      return discardNonTrump(hand, leadLen, ctx, position, tmWin);
    }
    // Not enough trump pairs to kill pairs/tractor - discard instead
    return discardNonTrump(hand, leadLen, ctx, position, tmWin);
  }

  // Pure singles
  trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
  let killKeyIdx = -1;
  if (hasPoints && !overkill) {
    // Try >= A trump
    const aceRank = getEffectiveRank({ suit: ctx.trumpSuit ?? Suit.Spades, rank: Rank.Ace, isJoker: false, id: '' } as Card, ctx);
    for (let i = 0; i < trumpCards.length; i++) {
      if (getEffectiveRank(trumpCards[i], ctx) >= aceRank) {
        killKeyIdx = i;
        break;
      }
    }
    // No >=A — use biggest
    if (killKeyIdx < 0) killKeyIdx = trumpCards.length - 1;
  } else {
    // No points or overkill — use smallest that beats
    if (ctx.bestSoFar && ctx.bestSoFar.cards.length > 0) {
      const bestRank = Math.max(...ctx.bestSoFar.cards.map(c => getEffectiveRank(c, ctx)));
      for (let i = 0; i < trumpCards.length; i++) {
        if (getEffectiveRank(trumpCards[i], ctx) > bestRank) {
          killKeyIdx = i;
          break;
        }
      }
    }
    if (killKeyIdx < 0) killKeyIdx = 0; // first card kills off-suit
  }
  // Build result: kill key + smallest remaining trump
  const kill: Card[] = [trumpCards[killKeyIdx]];
  for (let i = 0; i < trumpCards.length && kill.length < leadLen; i++) {
    if (i === killKeyIdx) continue;
    kill.push(trumpCards[i]);
  }
  if (canTrumpKillBeat(kill, leadCards, ctx)) {
    const reason = overkill ? '盖毙' : '用主牌毙';
    return { cards: kill, reason };
  }
  return discardNonTrump(hand, leadLen, ctx, position, tmWin);
}

function trumpKillSingle(
  trumpCards: Card[],
  nonTrump: Card[],
  ctx: AIContext,
  position: string,
  tmWin: boolean,
  hasPoints: boolean,
): { cards: Card[]; reason: string } {
  const overkill = isOverkill(ctx);

  if (ctx.bestSoFar && ctx.bestSoFar.cards.length > 0) {
    if (overkill) {
      const bestRank = Math.max(...ctx.bestSoFar.cards.map(c => getEffectiveRank(c, ctx)));
      const canBeatCards = trumpCards.filter(c => getEffectiveRank(c, ctx) > bestRank);
      if (canBeatCards.length > 0) {
        canBeatCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
        return { cards: [canBeatCards[0]], reason: '盖毙' };
      }
      if (nonTrump.length > 0) {
        nonTrump.sort(discardSort(!!tmWin, ctx));
        return { cards: [nonTrump[0]], reason: '盖不过，垫副牌' };
      }
      return { cards: [trumpCards[0]], reason: '盖不过，垫主牌' };
    }
    // bestSoFar is off-suit — first kill
    trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    if (hasPoints) {
      const aceRank = getEffectiveRank({ suit: ctx.trumpSuit ?? Suit.Spades, rank: Rank.Ace, isJoker: false, id: '' } as Card, ctx);
      const big = trumpCards.filter(c => getEffectiveRank(c, ctx) >= aceRank);
      if (big.length > 0) return { cards: [big[0]], reason: '用主牌毙' };
      // No >=A trump — use biggest
      return { cards: [trumpCards[trumpCards.length - 1]], reason: '用主牌毙' };
    }
    return { cards: [trumpCards[0]], reason: '用主牌毙' };
  }

  // No best yet — smallest trump kills
  trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
  if (hasPoints) {
    const aceRank = getEffectiveRank({ suit: ctx.trumpSuit ?? Suit.Spades, rank: Rank.Ace, isJoker: false, id: '' } as Card, ctx);
    const big = trumpCards.filter(c => getEffectiveRank(c, ctx) >= aceRank);
    if (big.length > 0) return { cards: [big[0]], reason: '用主牌毙' };
    return { cards: [trumpCards[trumpCards.length - 1]], reason: '用主牌毙' };
  }
  return { cards: [trumpCards[0]], reason: '用主牌毙' };
}

// ---- Follow throw off-suit ----

function followOffSuitThrow(
  hand: Card[],
  leadCards: Card[],
  leadSuitCards: Card[],
  trumpCards: Card[],
  leadLen: number,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  // Must follow suit first, then non-trump, then trump
  if (leadSuitCards.length >= leadLen) {
    // Try to match the throw's pattern (tractors, pairs) first
    const leadCombo = classifyCombo(leadCards, ctx);
    return followOffSuit(leadSuitCards, leadCards, leadLen, leadCombo, ctx, position, tmWin, trumpCards);
  }

  if (leadSuitCards.length > 0) {
    // Partial suit follow
    const remaining = hand.filter(c => !leadSuitCards.includes(c));
    const nonTrump = remaining.filter(c => !isTrump(c, ctx));
    nonTrump.sort(discardSort(!!tmWin, ctx));
    const trumps = remaining.filter(c => isTrump(c, ctx));
    trumps.sort(discardSort(!!tmWin, ctx));
    const fill = [...nonTrump, ...trumps].slice(0, leadLen - leadSuitCards.length);
    const cards = [...leadSuitCards, ...fill];
    const leadCombo = classifyCombo(leadCards, ctx);
    const baseReason = fill.some(c => isTrump(c, ctx))
      ? '同花色不够，垫主牌'
      : '同花色不够，垫其他花色';
    // Second position with max pattern (throw) should avoid points
    const shouldAvoid = (position === 'fourth' && !tmWin)
      || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx));
    const intent = shouldAvoid ? 'avoid' : 'none';
    const reason = annotateReason(baseReason, cards, leadSuitCards, trumpCards,
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Void in lead suit - try to trump the throw.
  // Delegate to trumpKill for proper pattern matching (pairs/tractors).
  if (trumpCards.length >= leadLen) {
    const leadCombo = classifyCombo(leadCards, ctx);
    return trumpKill(trumpCards, hand, leadCards, leadCombo, leadLen, ctx, position, tmWin);
  }

  return discardNonTrump(hand, leadLen, ctx, position, tmWin);
}

// ---- Follow trump throw ----

function followTrumpThrow(
  hand: Card[],
  leadLen: number,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  const trump = hand.filter(c => isTrump(c, ctx));
  if (trump.length >= leadLen) {
    trump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    return { cards: trump.slice(0, leadLen), reason: '垫主牌' };
  }
  // Not enough trump
  padWithDiscards(hand, trump, leadLen, ctx, tmWin);
  return {
    cards: [...trump, ...hand.filter(c => !isTrump(c, ctx)).slice(0, leadLen - trump.length)],
    reason: '主牌不够，垫副牌',
  };
}

// ---- NT trump follow ----

function followNTTrumpLead(
  hand: Card[],
  leadCards: Card[],
  leadLen: number,
  leadCombo: ComboClass,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  const myTrump = hand.filter(c => isTrump(c, ctx));
  const bs = ctx.bestSoFar;
  const currentMax = bs && bs.cards.length > 0
    ? Math.max(...bs.cards.map(c => getEffectiveRank(c, ctx)))
    : Math.max(...leadCards.map(c => getEffectiveRank(c, ctx)));

  if (leadLen === 1) {
    if (myTrump.length > 0) {
      const canBeatCards = myTrump.filter(c => getEffectiveRank(c, ctx) > currentMax);
      if (canBeatCards.length > 0) {
        canBeatCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
        const cards = [canBeatCards[0]];
        const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
        const intent = addPoints ? 'add' : 'none';
        const reason = annotateReason('同花色出大', cards, [], myTrump,
          leadCombo, 1, ctx, position, tmWin, false, intent);
        return { cards, reason };
      }
      myTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      const cards = [myTrump[0]];
      const intent = 'none';
      const reason = annotateReason('同花色出小', cards, [], myTrump,
        leadCombo, 1, ctx, position, tmWin, false, intent);
      return { cards, reason };
    }
    const nonTrump = hand.filter(c => !isTrump(c, ctx));
    nonTrump.sort(discardSort(!!tmWin, ctx));
    return { cards: [nonTrump[0] || hand[0]], reason: '垫牌' };
  }

  // Multi-card NT trump lead
  if (myTrump.length >= leadLen) {
    // Try to match pattern: use pairs/tractors if lead requires them
    if (leadCombo.pairCount > 0 || leadCombo.hasTractor) {
      const myPairs = findAllPairs(myTrump);
      if (myPairs.length > 0) {
        pairKillSort(myPairs, myTrump, ctx);
        // Match as many pairs as needed
        const neededPairs = Math.min(myPairs.length, leadCombo.pairCount);
        const used = myPairs.slice(0, neededPairs).flat();
        const usedIds = new Set(used.map(c => c.id));
        // Fill remaining with smallest singles
        const rest = myTrump.filter(c => !usedIds.has(c.id));
        rest.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
        const cards = [...used, ...rest].slice(0, leadLen);
        const beating = canBeat(cards, ctx.bestSoFar, ctx);
        const baseReason = beating ? '同花色出大' : '同花色出小';
        const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
        const intent = addPoints ? 'add' : 'none';
        const reason = annotateReason(baseReason, cards, [], myTrump,
          leadCombo, leadLen, ctx, position, tmWin, false, intent);
        return { cards, reason };
      }
    }
    // No pattern to match — smallest N trump
    const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
    const sorted = [...myTrump];
    if (addPoints) {
      sorted.sort(discardSort(true, ctx));
    } else {
      sorted.sort(discardSort(false, ctx));
    }
    const cards = sorted.slice(0, leadLen);
    const intent = addPoints ? 'add' : 'none';
    const reason = annotateReason('垫同花色', cards, [], myTrump,
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Pad with discards
  return padWithDiscards(hand, myTrump, leadLen, ctx, tmWin);
}

// ---- Discard helpers ----

/** Sort pairs for killing/following: non-tractor first (avoid breaking tractors),
 *  then non-point first, then smallest effective rank. */
function pairKillSort(pairs: Card[][], cards: Card[], ctx: AIContext): void {
  const tractors = detectTractors(cards, ctx);
  const tractorIds = new Set(tractors.flat().map(c => c.id));
  pairs.sort((a, b) => {
    const aTr = tractorIds.has(a[0].id) ? 100 : 0;
    const bTr = tractorIds.has(b[0].id) ? 100 : 0;
    if (aTr !== bTr) return aTr - bTr;
    const aPts = isPointRank(a[0].rank) ? 100 : 0;
    const bPts = isPointRank(b[0].rank) ? 100 : 0;
    if (aPts !== bPts) return aPts - bPts;
    return getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx);
  });
}

function discardNonTrump(
  hand: Card[],
  leadLen: number,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  const nonTrump = hand.filter(c => !isTrump(c, ctx));
  nonTrump.sort(discardSort(!!tmWin, ctx));
  if (nonTrump.length >= leadLen) {
    const cards = nonTrump.slice(0, leadLen);
    const intent = (tmWin && position === 'fourth') ? 'add' : 'none';
    const reason = intent === 'add' ? '垫牌（队友已大，尽量加分）' : '垫牌';
    return { cards, reason };
  }
  const trump = hand.filter(c => isTrump(c, ctx));
  trump.sort(discardSort(!!tmWin, ctx));
  return {
    cards: [...nonTrump, ...trump].slice(0, leadLen),
    reason: '垫牌(含主牌)',
  };
}

function padWithDiscards(
  hand: Card[],
  myTrump: Card[],
  leadLen: number,
  ctx: AIContext,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  const nonTrump = hand.filter(c => !isTrump(c, ctx));
  nonTrump.sort(discardSort(!!tmWin, ctx));
  return {
    cards: [...myTrump, ...nonTrump].slice(0, leadLen),
    reason: '主牌不足，补垫牌',
  };
}

// ---- Shared helpers ----

/** Whether we should add points when teammate is winning.
 *  Fourth: always.
 *  Third: only if lead is max pattern — big card (A/K single or pair),
 *         has tractor, or is a throw (甩牌 already max). */
function canAddPoints(tmWin: boolean, position: string, leadCombo: ComboClass, ctx: AIContext): boolean {
  if (!tmWin) return false;
  if (position === 'fourth') return true;
  if (position === 'third') {
    if (leadCombo.hasTractor) return true;
    if (leadCombo.type === 'throw') return true;
    // Single or pair of big off-suit card (A, or K when A is level)
    if (leadCombo.type === 'single' || leadCombo.type === 'pair') {
      return leadCombo.cards.every(c => isBigOffSuitCard(c, ctx));
    }
  }
  return false;
}

/** Whether the lead combo is a max pattern — big card, tractor, or throw.
 *  Second position should avoid points when following such a lead. */
function isMaxPattern(leadCombo: ComboClass, ctx: AIContext): boolean {
  if (leadCombo.hasTractor) return true;
  if (leadCombo.type === 'throw') return true;
  if (leadCombo.type === 'single' && isBigOffSuitCard(leadCombo.cards[0], ctx)) return true;
  if (leadCombo.type === 'pair' && leadCombo.cards.every(c => isBigOffSuitCard(c, ctx))) return true;
  return false;
}

/**
 * Check if the chosen cards are the only legal play from this hand.
 * True when: lead-suit cards exactly match what's needed (single=1 card,
 * pair=1 pair or 2 cards, tractor=1 matching tractor or N pairs or N*2 cards),
 * AND no cross-suit filling is needed.
 * Does NOT apply to short-suited fills or last-card situations.
 */
function isOnlyLegalPlay(
  cards: Card[],
  leadSuitCards: Card[],
  leadLen: number,
  trumpCards: Card[],
  isTrumpKill: boolean,
  config: AIContext,
  leadCombo: ComboClass,
): boolean {
  if (isTrumpKill) return false;
  if (leadSuitCards.length === 0) return false; // void + discard, many choices
  if (leadSuitCards.length < leadLen) return false; // short-suited, need fillers

  // Single lead: only 1 lead-suit card → unique
  if (leadLen === 1 && leadSuitCards.length === 1) return true;

  // Pair lead: unique if only 1 pair exists among lead-suit cards
  if (leadCombo.pairCount > 0 && !leadCombo.hasTractor) {
    const pairs = findAllPairs(leadSuitCards);
    const tractorPairs = detectTractors(leadSuitCards, config);
    // Tractors can be broken, so only count standalone pairs + pairs in tractors
    // Simple check: if findAllPairs returns exactly leadCombo.pairCount pairs
    // and total cards are accounted for by those pairs + remaining singles,
    // then unique means only 1 legal way to form the required pairs.
    if (pairs.length === leadCombo.pairCount && leadSuitCards.length === leadLen) {
      // All lead-suit cards are used in pairs → exactly these pairs must be played
      return true;
    }
    // More cards than needed, but only 1 way to pick pairs:
    // e.g. 3 lead-suit cards, 1 pair needed, only 1 pair exists → unique
    if (leadCombo.pairCount === 1 && pairs.length === 1) return true;
    if (leadCombo.pairCount > 1 && pairs.length === leadCombo.pairCount
        && leadSuitCards.length === leadLen) return true;
    return false;
  }

  // Tractor lead: unique if exactly 1 matching tractor exists and all cards pair up
  if (leadCombo.hasTractor) {
    const tractors = detectTractors(leadSuitCards, config);
    if (tractors.length > 0) {
      const matched = tryMatchTractorSlots(leadCombo, tractors, leadSuitCards, leadLen, config);
      if (matched && matched.length === leadLen) {
        // Only one way to match → unique
        return true;
      }
    }
    // No matching tractor: fill with pairs + singles
    const pairs = findAllPairs(leadSuitCards);
    if (leadCombo.pairCount >= 1 && pairs.length === leadCombo.pairCount
        && leadSuitCards.length === leadLen) return true;
    return false;
  }

  // Pure singles: unique if lead-suit cards === leadLen (only these to play)
  if (leadCombo.pairCount === 0 && !leadCombo.hasTractor
      && leadSuitCards.length === leadLen) return true;

  return false;
}

/**
 * Append point-strategy annotation to a base reason.
 * The annotation explains WHY certain cards were chosen,
 * e.g. "（队友已大，尽量加分）", "（盖不过，尽量不加分）",
 * "（唯一可出）", "（用分牌盖）", "（但没分可加）", etc.
 */
function annotateReason(
  baseReason: string,
  cards: Card[],
  leadSuitCards: Card[],
  trumpCards: Card[],
  leadCombo: ComboClass,
  leadLen: number,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
  isTrumpKill: boolean,
  intent: 'add' | 'avoid' | 'beat_points' | 'none',
): string {
  // Check unique-play first
  if (isOnlyLegalPlay(cards, leadSuitCards, leadLen, trumpCards, isTrumpKill, ctx, leadCombo)) {
    return `${baseReason}（唯一可出）`;
  }

  if (intent === 'add') {
    // Tried to add points.
    const hasPoints = cards.some(c => isPointRank(c.rank));
    if (!hasPoints) return `${baseReason}（但没分可加）`;
    const suffix = (tmWin && leadCombo.hasTractor) ? '队友出拖拉机，尽量加分' : '队友已大，尽量加分';
    return `${baseReason}（${suffix}）`;
  }

  if (intent === 'avoid') {
    // Tried to avoid adding points.
    const hasPoints = cards.some(c => isPointRank(c.rank));
    if (hasPoints) return `${baseReason}（尽量少加分）`;
    // Second or third position avoiding
    if (position === 'second' && !isTrumpKill) return `${baseReason}（盖不过，尽量不加分）`;
    return `${baseReason}（盖不过，尽量不加分）`;
  }

  if (intent === 'beat_points') {
    // Fourth position trying to beat with point cards
    const hasPoints = cards.some(c => isPointRank(c.rank));
    if (!hasPoints) return `${baseReason}（用最小牌盖）`;
    return `${baseReason}（用分牌盖）`;
  }

  return baseReason;
}

function tryMatchTractorSlots(
  leadCombo: ComboClass,
  myTractors: Card[][],
  cardPool: Card[],
  leadLen: number,
  ctx: AIContext,
): Card[] | null {
  const picked: Card[] = [];
  const usedIds = new Set<string>();

  for (const req of leadCombo.tractors.map(t => t.pairCount)) {
    const available = myTractors.filter(t =>
      t.every(c => !usedIds.has(c.id)) && t.length / 2 >= req,
    );
    if (available.length > 0) {
      available.sort((a, b) => (a.length / 2) - (b.length / 2));
      const sel = available[0].slice(0, req * 2);
      picked.push(...sel);
      sel.forEach(c => usedIds.add(c.id));
    }
  }

  if (picked.length === 0) return null;

  const remaining = cardPool.filter(c => !usedIds.has(c.id));
  // Fill remaining: pairs first, then singles (non-point priority)
  const remPairs = findAllPairs(remaining);
  remPairs.sort(pairSortAsc(ctx));
  const fill: Card[] = [];
  for (const p of remPairs) {
    if (picked.length + fill.length + 2 > leadLen) break;
    if (p.some(c => usedIds.has(c.id))) continue;
    fill.push(...p);
    p.forEach(c => usedIds.add(c.id));
  }
  const restSingles = remaining.filter(c => !usedIds.has(c.id));
  restSingles.sort((a, b) => {
    const aPts = isPointRank(a.rank) ? 100 : 0;
    const bPts = isPointRank(b.rank) ? 100 : 0;
    if (aPts !== bPts) return aPts - bPts;
    return getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx);
  });
  fill.push(...restSingles.slice(0, leadLen - picked.length - fill.length));

  return [...picked, ...fill].slice(0, leadLen);
}

/** add final-hand suffix to reason if applicable */
function maybeAppendFinal(
  selected: Card[],
  fullHand: Card[],
  baseReason: string,
  ctx?: AIContext,
): string {
  if (selected.length !== fullHand.length) return baseReason;
  if (fullHand.length === 1) return '最后一张手牌，必出';

  // Check for last pair
  const pairs = findAllPairs(selected);
  if (pairs.length > 0 && pairs[0].length === selected.length) {
    return '出最后一对';
  }

  // Check for last tractor
  if (ctx) {
    const tractors = detectTractors(selected, ctx);
    if (tractors.length > 0 && tractors[0].length === selected.length) {
      return `出最后一个拖拉机(${selected.length / 2}对)`;
    }
  }

  return `最后${selected.length}张手牌，必出`;
}

function rankLabelStr(rank: number): string {
  return { 14: 'A', 13: 'K', 12: 'Q', 11: 'J' }[rank] || String(rank);
}

/** Ensure we have an AIContext, converting from TrumpDeclaration if needed. */
function ensureContext(
  config: AIContext | TrumpDeclaration,
  bestSoFar?: { cards: Card[]; playerIdx: number } | null,
  myIdx?: number,
): AIContext {
  if ('myIndex' in config && (config as AIContext).myIndex >= 0) {
    return config as AIContext;
  }
  // Build context from scratch for backward compat.
  const bs = bestSoFar ? { cards: bestSoFar.cards, playerIndex: bestSoFar.playerIdx } : null;
  const idx = myIdx ?? -1;
  const declIdx = config.declarerIndex;
  // Infer position from myIdx relative to lead (default: declarer leads)
  const leadIdx = bs && bs.playerIndex >= 0 ? declIdx : declIdx;
  const pc = idx >= 0 ? (idx - leadIdx + 4) % 4 : 0;
  return {
    declarerIndex: declIdx,
    trumpSuit: config.trumpSuit,
    level: config.level,
    myIndex: idx,
    isDeclarer: idx === declIdx,
    isDeclarerPartner: idx === (declIdx + 2) % 4,
    isAttacker: idx >= 0 ? idx % 2 !== declIdx % 2 : false,
    attackerPoints: 0,
    handCounts: [25, 25, 25, 25] as const,
    trickHistory: [],
    reveals: [],
    playCount: pc,
    leadPlayerIndex: leadIdx,
    bestSoFar: bs,
    ntState: null,
    bottomCards: [],
    debug: false,
  };
}

// ---- suggestPlay ----

/** suggest plays for human in debug mode */
export function suggestPlay(
  hand: Card[],
  isLeading: boolean,
  leadCombo: ComboClass | null,
  leadSuit: CardSuit | null,
  config: AIContext | TrumpDeclaration,
): { suggested: Card[]; reason: string } | null {
  if (isLeading) {
    const result = aiLeadPlay(hand, config);
    return { suggested: result.cards, reason: result.reason };
  }
  if (leadCombo && leadSuit) {
    const result = aiFollowPlay(hand, leadCombo.cards, leadSuit, config);
    return { suggested: result.cards, reason: result.reason };
  }
  return null;
}
