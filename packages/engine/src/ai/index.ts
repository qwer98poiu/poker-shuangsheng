/**
 * AI module - leading, following, revealing, bottom exchange strategies.
 *
 * All exported functions accept either AIContext (full game state) or
 * plain TrumpDeclaration (for backward compatibility).
 */
import type { Card, CardSuit, ComboClass } from '../types.js';
import { Rank, SpecialSuit, Suit, SUIT_ORDER, isPointRank } from '../types.js';
import type { TrumpDeclaration } from '../types.js';
import { isTrump, getEffectiveRank, sortHand } from '../model.js';
import { findAllPairs, detectTractors, classify as classifyCombo } from '../pattern/index.js';
import type { AIContext } from './types.js';
import {
  getPositionInTrick, isTeammateWinning, canBeat, maxCardT, teammateWins,
  isBigOffSuitCard, isPointCard, pairSortAsc, discardSort, fillerSort,
  groupBySuit, suitLabelCn, cardName, getTopOffSuitRank,
} from './utils.js';
import { findThrowableOffSuitCombos } from './throw-detector.js';
import { aiChooseBottomCards as aiChooseBottomImpl } from './bottom-strategy.js';

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
      return t.every(c => getEffectiveRank(c, ctx) <= getEffectiveRank({ rank: Rank.Ace } as any, ctx));
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
    // In NT, draw with smallest trump
    const trumpCards = hand.filter(c => isTrump(c, ctx));
    if (trumpCards.length === 0) return null;
    trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    // NT level card priority (see NT rules)
    return pickNTTrumpLead(hand, trumpCards, ctx);
  }

  // Suited: only draw if we have single trump smaller than A
  const trumpCards = hand.filter(c => isTrump(c, ctx));
  if (trumpCards.length === 0) return null;

  const hasSmallTrump = trumpCards.some(
    c => getEffectiveRank(c, ctx) < getEffectiveRank({ rank: Rank.Ace } as any, ctx),
  );
  if (!hasSmallTrump) return null;

  trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
  return { cards: [trumpCards[0]], reason: '吊主' };
}

// ---- NT trump drawing ----

function shouldDrawTrumpInNT(ctx: AIContext): boolean {
  if (!ctx.ntState) return false;

  // Rule 1: Opponents have no trump -> stop unless level is points + attacker leading + not yet 80
  if (ctx.ntState.opponentTrumpCount === 0) {
    if (!isPointRank(ctx.level as Rank)) return false;
    if (!ctx.isAttacker || ctx.playCount > 0) return false;
    if (ctx.attackerPoints >= 80) return false;
    return true;
  }

  // Rule 2: 4 jokers in hand or all unseen jokers on our side -> draw level cards to clear
  if (ctx.ntState.allUnseenJokersOnOurSide) return true;

  // Rule 3: Level card pair exists + no joker pairs on opponent side
  // Rule 4: Single big joker or single small joker (big jokers on our side)
  // Rule 5: Small joker pair + level pair tractor

  return true; // default: ok to draw in NT
}

function pickNTTrumpLead(
  hand: Card[],
  trumpCards: Card[],
  ctx: AIContext,
): { cards: Card[]; reason: string } | null {
  if (trumpCards.length === 0) return null;

  // Prefer level cards over jokers (save jokers for later)
  const levelCards = trumpCards.filter(c => c.suit !== SpecialSuit.Joker);
  const jokers = trumpCards.filter(c => c.suit === SpecialSuit.Joker);

  // If we can clear trumps, lead level cards first
  if (levelCards.length > 0) {
    levelCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    return { cards: [levelCards[0]], reason: '吊主(级牌)' };
  }

  // Otherwise, smallest joker
  if (jokers.length > 0) {
    jokers.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    return { cards: [jokers[0]], reason: '吊主(王)' };
  }

  return null;
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
    return followOffSuit(leadSuitCards, leadCards, leadLen, leadCombo, ctx, position, tmWin);
  }

  // Short-suited - must play all lead-suit cards
  if (leadSuitCards.length > 0) {
    const other = hand.filter(c => !leadSuitCards.includes(c));
    other.sort(fillerSort(!!tmWin, ctx));
    const fill = other.slice(0, leadLen - leadSuitCards.length);
    return {
      cards: [...leadSuitCards, ...fill],
      reason: '垫同花色',
    };
  }

  // Void in lead suit - try to trump
  if (trumpCards.length >= leadLen) {
    return trumpKill(trumpCards, hand, leadCards, leadCombo, leadLen, ctx, position, tmWin);
  }

  // Can't fully trump - discard
  return discardNonTrump(hand, leadLen, ctx, tmWin);
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
    return followNTTrumpLead(hand, leadCards, leadLen, ctx, tmWin);
  }

  // Can beat?
  const leadMax = Math.max(...leadCards.map(c => getEffectiveRank(c, ctx)));

  if (leadLen === 1) {
    // Single trump lead
    if (myTrump.length > 0) {
      const canBeatCards = myTrump.filter(c => getEffectiveRank(c, ctx) > leadMax);
      if (canBeatCards.length > 0) {
        // Position 2: generally play small unless have tractor/throw to seize lead
        if (position === 'second') {
          myTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
          return { cards: [myTrump[0]], reason: '出小' };
        }
        canBeatCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
        return { cards: [canBeatCards[0]], reason: '用最小能盖过的主牌' };
      }
      myTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      return { cards: [myTrump[0]], reason: '盖不过，出最小主牌' };
    }
    // No trump - discard
    const nonTrump = hand.filter(c => !isTrump(c, ctx));
    nonTrump.sort(discardSort(!!tmWin));
    return { cards: [nonTrump[0] || hand[0]], reason: '垫牌' };
  }

  // Multi-card trump lead - match pattern
  if (myTrump.length >= leadLen) {
    return matchTrumpPattern(myTrump, leadCards, leadCombo, leadLen, ctx, tmWin);
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
      const picked = tryMatchTractorSlots(leadCombo, myTractors, myTrump, leadLen, ctx);
      if (picked) return { cards: picked, reason: '用最小主牌拖拉机跟牌' };
    }
    // No tractor - play smallest pairs then singles
    const pairs = findAllPairs(myTrump);
    pairs.sort(pairSortAsc(ctx));
    const chosen = pairs.flat();
    const used = new Set(chosen.map(c => c.id));
    const rest = myTrump.filter(c => !used.has(c.id));
    rest.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    return { cards: [...chosen, ...rest].slice(0, leadLen), reason: '无拖拉机，出最小主牌对子跟牌' };
  }

  if (leadCombo.pairCount > 0) {
    const myPairs = findAllPairs(myTrump);
    myPairs.sort(pairSortAsc(ctx));
    const chosen = myPairs.slice(0, leadCombo.pairCount).flat();
    if (chosen.length < leadLen) {
      const used = new Set(chosen.map(c => c.id));
      const rest = myTrump.filter(c => !used.has(c.id));
      rest.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      chosen.push(...rest.slice(0, leadLen - chosen.length));
    }
    return { cards: chosen, reason: '用最小主牌对子跟牌' };
  }

  // Pure singles: play smallest trump
  myTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
  return { cards: myTrump.slice(0, leadLen), reason: '出最小主牌' };
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
): { cards: Card[]; reason: string } {
  if (leadLen === 1) {
    return followOffSuitSingle(leadSuitCards, ctx, position, tmWin);
  }
  return followOffSuitMulti(leadSuitCards, leadCards, leadLen, leadCombo, ctx, position, tmWin);
}

function followOffSuitSingle(
  leadSuitCards: Card[],
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  leadSuitCards.sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));

  // Teammate already winning - dump points
  if (tmWin && position === 'third') {
    leadSuitCards.sort(discardSort(true));
    return { cards: [leadSuitCards[0]], reason: '队友已大，尽量加分' };
  }

  // Can't beat - play smallest
  if (!canBeat([leadSuitCards[0]], ctx.bestSoFar, ctx)) {
    // Don't break pairs
    const singles = leadSuitCards;
    singles.sort(discardSort(false));
    const reason = position === 'third' && ctx.bestSoFar
      ? '盖不过，尽量不加分'
      : '同花色出小';
    return { cards: [singles[0]], reason };
  }

  // Can beat - play smallest that beats
  if (ctx.bestSoFar && ctx.bestSoFar.cards.length > 0) {
    const bestRank = Math.max(...ctx.bestSoFar.cards.map(c => getEffectiveRank(c, ctx)));
    const beaters = leadSuitCards.filter(c => getEffectiveRank(c, ctx) > bestRank);
    if (beaters.length > 0) {
      beaters.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      // Don't break pairs to beat
      const b = beaters[0];
      return { cards: [b], reason: `同花色出大` };
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
      const picked = tryMatchTractorSlots(leadCombo, myTractors, leadSuitCards, leadLen, ctx);
      if (picked) return { cards: picked, reason: '用拖拉机跟牌' };
    }
    // No tractor - fill with pairs then singles
    if (myPairs.length > 0) {
      myPairs.sort(pairSortAsc(ctx));
      const chosen = myPairs.flat();
      const used = new Set(chosen.map(c => c.id));
      const rest = leadSuitCards.filter(c => !used.has(c.id));
      rest.sort((a, b) => a.rank - b.rank);
      return { cards: [...chosen, ...rest].slice(0, leadLen), reason: '无拖拉机，用对子跟牌' };
    }
  }

  // Pair lead - match with pairs
  if (leadCombo.pairCount > 0 && myPairs.length >= leadCombo.pairCount) {
    // Teammate winning -> can add points
    if (tmWin && position === 'fourth') {
      leadSuitCards.sort(discardSort(true));
      return { cards: leadSuitCards.slice(0, leadLen), reason: '队友已大，尽量加分' };
    }
    myPairs.sort(pairSortAsc(ctx));
    const chosen = myPairs.slice(0, leadCombo.pairCount).flat();
    if (chosen.length < leadLen) {
      const used = new Set(chosen.map(c => c.id));
      const rest = leadSuitCards.filter(c => !used.has(c.id));
      rest.sort((a, b) => a.rank - b.rank);
      chosen.push(...rest.slice(0, leadLen - chosen.length));
    }
    return { cards: chosen.slice(0, leadLen), reason: '用对子跟牌' };
  }

  // Can't match pattern - play smallest
  if (tmWin) {
    leadSuitCards.sort(discardSort(true));
    return { cards: leadSuitCards.slice(0, leadLen), reason: '队友已大，尽量加分' };
  }

  leadSuitCards.sort(discardSort(false));
  return { cards: leadSuitCards.slice(0, leadLen), reason: '垫同花色' };
}

// ---- Trump kill ----

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

  if (leadLen === 1) {
    return trumpKillSingle(trumpCards, nonTrump, ctx, position, tmWin);
  }

  // Multi-card kill - match lead pattern with trump
  // Check if lead has points
  const leadHasPoints = leadCards.some(c => isPointRank(c.rank));

  if (leadCombo.hasTractor) {
    const myTractors = detectTractors(trumpCards, ctx);
    if (myTractors.length > 0) {
      myTractors.sort((a, b) => {
        const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
        const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
        return aMax - bMax;
      });
      const picked = tryMatchTractorSlots(leadCombo, myTractors, trumpCards, leadLen, ctx);
      if (picked) {
        const reason = leadHasPoints ? '用主牌拖拉机盖毙' : '用主牌拖拉机毙';
        return { cards: picked, reason };
      }
    }
  }

  if (leadCombo.pairCount > 0) {
    const myPairs = findAllPairs(trumpCards);
    myPairs.sort(pairSortAsc(ctx));
    if (myPairs.length >= leadCombo.pairCount) {
      const chosen = myPairs.slice(0, leadCombo.pairCount).flat();
      if (chosen.length === leadLen) {
        const reason = leadHasPoints ? '用主牌对子盖毙' : '用主牌对子毙';
        return { cards: chosen, reason };
      }
      const used = new Set(chosen.map(c => c.id));
      const rest = trumpCards.filter(c => !used.has(c.id));
      rest.sort((a, b) => {
        const aPts = isPointRank(a.rank) ? 100 : 0;
        const bPts = isPointRank(b.rank) ? 100 : 0;
        if (aPts !== bPts) return aPts - bPts;
        return getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx);
      });
      const result = [...chosen, ...rest.slice(0, leadLen - chosen.length)];
      const reason = leadHasPoints ? '用主牌对子盖毙' : '用主牌对子毙';
      return { cards: result, reason };
    }
  }

  // Pure singles - use strongest trump
  trumpCards.sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));
  const kill = trumpCards.slice(0, leadLen);
  const reason = leadHasPoints ? '用主牌盖毙' : '用主牌毙';
  return { cards: kill, reason };
}

function trumpKillSingle(
  trumpCards: Card[],
  nonTrump: Card[],
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  // Check if lead has points
  if (ctx.bestSoFar && ctx.bestSoFar.cards.length > 0) {
    const leadHasPoints = ctx.bestSoFar.cards.some(c => isPointRank(c.rank));
    const bestRank = Math.max(...ctx.bestSoFar.cards.map(c => getEffectiveRank(c, ctx)));

    // Can beat with trump
    const canBeatCards = trumpCards.filter(c => getEffectiveRank(c, ctx) > bestRank);
    if (canBeatCards.length > 0) {
      if (leadHasPoints) {
        // Use trump >= A to kill point cards
        const aceRank = getEffectiveRank({ rank: Rank.Ace } as any, ctx);
        const bigTrump = canBeatCards.filter(c => getEffectiveRank(c, ctx) >= aceRank);
        if (bigTrump.length > 0) {
          bigTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
          return { cards: [bigTrump[0]], reason: '用主牌盖毙' };
        }
        // No big trump - use max
        canBeatCards.sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));
        return { cards: [canBeatCards[0]], reason: '用主牌盖毙' };
      }
      // No points - use smallest trump
      canBeatCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      return { cards: [canBeatCards[0]], reason: '用主牌毙' };
    }

    // Can't beat
    if (nonTrump.length > 0) {
      nonTrump.sort(discardSort(!!tmWin));
      return { cards: [nonTrump[0]], reason: '盖不过，垫副牌' };
    }
    // All trump - must play smallest trump
    return { cards: [trumpCards[0]], reason: '盖不过，垫主牌' };
  }

  // No best yet - smallest trump
  trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
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
    return followOffSuit(leadSuitCards, leadCards, leadLen, leadCombo, ctx, position, tmWin);
  }

  if (leadSuitCards.length > 0) {
    // Partial suit follow
    const remaining = hand.filter(c => !leadSuitCards.includes(c));
    const nonTrump = remaining.filter(c => !isTrump(c, ctx));
    nonTrump.sort(discardSort(!!tmWin));
    const trumps = remaining.filter(c => isTrump(c, ctx));
    trumps.sort(discardSort(!!tmWin));
    const fill = [...nonTrump, ...trumps].slice(0, leadLen - leadSuitCards.length);
    const reason = fill.some(c => isTrump(c, ctx))
      ? '同花色不够，垫主牌'
      : '同花色不够，垫其他花色';
    return { cards: [...leadSuitCards, ...fill], reason };
  }

  // Void in lead suit - can trump
  if (trumpCards.length >= leadLen) {
    // Check if lead has points
    const leadHasPoints = leadCards.some(c => isPointRank(c.rank));

    // Check if we can beat (for throws, check longest sub-pattern)
    if (leadHasPoints) {
      trumpCards.sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));
      return { cards: trumpCards.slice(0, leadLen), reason: '用主牌盖毙' };
    }
    trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    return { cards: trumpCards.slice(0, leadLen), reason: '用主牌毙' };
  }

  return discardNonTrump(hand, leadLen, ctx, tmWin);
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
  ctx: AIContext,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  const myTrump = hand.filter(c => isTrump(c, ctx));
  const leadMax = Math.max(...leadCards.map(c => getEffectiveRank(c, ctx)));

  if (leadLen === 1) {
    if (myTrump.length > 0) {
      const canBeat = myTrump.filter(c => getEffectiveRank(c, ctx) > leadMax);
      if (canBeat.length > 0) {
        canBeat.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
        return { cards: [canBeat[0]], reason: '用最小能盖过的主牌' };
      }
      myTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      return { cards: [myTrump[0]], reason: '盖不过，出最小主牌' };
    }
    const nonTrump = hand.filter(c => !isTrump(c, ctx));
    nonTrump.sort(discardSort(!!tmWin));
    return { cards: [nonTrump[0] || hand[0]], reason: '垫牌' };
  }

  // Multi-card NT trump lead
  if (myTrump.length >= leadLen) {
    myTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    return { cards: myTrump.slice(0, leadLen), reason: '跟主牌' };
  }

  // Pad with discards
  return padWithDiscards(hand, myTrump, leadLen, ctx, tmWin);
}

// ---- Discard helpers ----

function discardNonTrump(
  hand: Card[],
  leadLen: number,
  ctx: AIContext,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  const nonTrump = hand.filter(c => !isTrump(c, ctx));
  nonTrump.sort(discardSort(!!tmWin));
  if (nonTrump.length >= leadLen) {
    return { cards: nonTrump.slice(0, leadLen), reason: tmWin ? '队友已大，尽量加分' : '垫牌' };
  }
  const trump = hand.filter(c => isTrump(c, ctx));
  trump.sort(discardSort(!!tmWin));
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
  nonTrump.sort(discardSort(!!tmWin));
  return {
    cards: [...myTrump, ...nonTrump].slice(0, leadLen),
    reason: '主牌不足，补垫牌',
  };
}

// ---- Shared helpers ----

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
  // Build mutable context from scratch (minimalContext returns readonly)
  const bs = bestSoFar ? { cards: bestSoFar.cards, playerIndex: bestSoFar.playerIdx } : null;
  const idx = myIdx ?? -1;
  return {
    declarerIndex: config.declarerIndex,
    trumpSuit: config.trumpSuit,
    level: config.level,
    myIndex: idx,
    isDeclarer: false,
    isDeclarerPartner: false,
    isAttacker: false,
    attackerPoints: 0,
    handCounts: [25, 25, 25, 25] as const,
    trickHistory: [],
    reveals: [],
    playCount: 0,
    leadPlayerIndex: -1,
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
