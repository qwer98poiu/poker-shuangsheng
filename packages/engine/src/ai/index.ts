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
import { compareTwo, matchPattern } from '../comparing/index.js';
import type { AIContext } from './types.js';
import {
  getPositionInTrick, isTeammateWinning,
  discardSort, fillerSort,
  groupBySuit, suitLabelCn,
} from './utils.js';
import { isOnlyLegalPlay } from '../following/index.js';
import { aiChooseBottomCards as aiChooseBottomImpl } from './bottom-strategy.js';
import { annotateReason } from './reason.js';
import {
  discardNonTrump,
  canAddPoints, isMaxPattern, attackerNearThreshold,
} from './helpers.js';
import {
  followTrumpLead,
  trumpKill, followTrumpThrow, rule1KillMode,
} from './follow-trump.js';
import { followOffSuit, followOffSuitThrow } from './follow-offsuit.js';
import {
  pickDiscards, selectFillers, secondShouldAvoid, shouldBreakPairForPoints,
  pickBestAddCards, visibleTrickPoints, type DiscardMode,
} from './position-policy.js';
import { _aiLeadPlay } from './lead.js';

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
  playerIndex: number,
  level: number,
  currentReveal: { suit: Suit | null; strength: number; playerIndex?: number } | null,
): { suit: Suit | null; reason: string } | null {
  const allCards = hand;

  const bigJokers = allCards.filter(c => c.rank === Rank.BigJoker);
  const smallJokers = allCards.filter(c => c.rank === Rank.SmallJoker);
  const levelCardsOf = (suit: Suit) => allCards.filter(c => c.suit === suit && c.rank === level);

  // 自己亮的主：自保仅限有主同花色巩固（单张→同花色对子）；无主不可自保，禁止自反
  if (currentReveal?.playerIndex === playerIndex) {
    if (currentReveal.suit !== null
      && currentReveal.strength === 1
      && levelCardsOf(currentReveal.suit).length >= 2) {
      return { suit: currentReveal.suit, reason: `同花色对${suitLabelCn(currentReveal.suit)}级牌自保` };
    }
    return null;
  }

  // 别人亮的主（或未亮）：按力量亮主/反主
  if (bigJokers.length >= 2 || smallJokers.length >= 2) {
    if (!currentReveal || currentReveal.strength < 3) {
      return { suit: null, reason: '有对王，亮无主' };
    }
  }

  for (const suit of SUIT_ORDER) {
    const levelCards = levelCardsOf(suit);
    if (levelCards.length >= 2) {
      if (!currentReveal || currentReveal.strength < 2) {
        return { suit, reason: `有${suitLabelCn(suit)}级牌对，亮主` };
      }
    }
  }

  for (const suit of SUIT_ORDER) {
    if (levelCardsOf(suit).length >= 1) {
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

// ---- Following strategy ----

/** decide what to follow */
export function aiFollowPlay(
  hand: Card[],
  leadCards: Card[],
  leadSuit: CardSuit | null,
  config: AIContext | TrumpDeclaration,
  bestSoFar?: { cards: Card[]; playerIdx: number } | null,
  myIdx?: number,
): { cards: Card[]; reason: string } {
  const ctx = ensureContext(config, bestSoFar, myIdx);
  const result = _aiFollowPlay(hand, leadCards, leadSuit, ctx);
  return { cards: result.cards, reason: maybeAppendFinal(result.cards, hand, result.reason, ctx) };
}

/** Determine reason for a tmWin void-follow card selection. */
function finishTeammateWin(
  cards: Card[], leadCards: Card[], leadCombo: ComboClass, leadLen: number,
  ctx: AIContext, position: string, tmWin: boolean, trumpCards: Card[],
): { cards: Card[]; reason: string } {
  const allTrump = cards.every(c => isTrump(c, ctx));
  const overkill = !!(ctx.bestSoFar && ctx.bestSoFar.cards.length > 0
    && ctx.bestSoFar.cards.some(c => isTrump(c, ctx)));
  // 盖毙: all trump + pattern matches + beats current winner
  const isKill = allTrump && overkill
    && matchPattern(leadCards, cards, ctx)
    && compareTwo(ctx.bestSoFar!.cards, cards, leadCards, ctx) === 'second';
  if (isKill) {
    const baseReason = overkill ? '盖毙' : '用主牌毙';
    const reason = annotateReason(baseReason, cards, [], trumpCards,
      leadCombo, leadLen, ctx, position, tmWin, true, 'beat_points');
    return { cards, reason };
  }
  // Not a kill → 垫牌 or 垫主牌
  const hasNonTrump = cards.some(c => !isTrump(c, ctx));
  const baseReason = hasNonTrump ? '垫牌' : '垫主牌';
  const hasPoints = cards.some(c => isPointRank(c.rank));
  const intent = hasPoints ? 'add' : 'none';
  const reason = annotateReason(baseReason, cards, [], trumpCards,
    leadCombo, leadLen, ctx, position, tmWin, false, intent);
  return { cards, reason };
}

function _aiFollowPlay(
  hand: Card[],
  leadCards: Card[],
  leadSuit: CardSuit | null,
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

  // Fast path: only one legal play — skip strategy, play forced cards.
  // When lead-suit count equals leadLen, all cards in that suit group
  // must be played (no choice), so sorting and taking all is correct.
  if (leadSuitCards.length === leadLen && isOnlyLegalPlay(leadSuitCards, leadLen, leadCombo, ctx)) {
    const sorted = [...leadSuitCards].sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    const cards = sorted.slice(0, leadLen);
    let baseReason: string;
    if (leadCombo.type === 'throw') {
      baseReason = '垫同花色';
    } else if (!matchPattern(leadCards, cards, ctx)) {
      // Cards can't match lead pattern (e.g. two singles vs a pair lead).
      baseReason = '垫同花色';
    } else {
      // Pattern matches — compare ranks via compareTwo (pattern-aware).
      const bestCards = ctx.bestSoFar ? ctx.bestSoFar.cards : leadCards;
      const beating = compareTwo(bestCards, cards, leadCards, ctx) === 'second';
      baseReason = beating ? '同花色出大' : '同花色出小';
    }
    const reason = annotateReason(baseReason, cards, leadSuitCards, trumpCards,
      leadCombo, leadLen, ctx, position, tmWin, false, 'none');
    return { cards, reason };
  }

  // ---- Throw lead (甩牌) ----
  if (leadCombo.type === 'throw') {
    if (leadIsTrump) {
      return followTrumpThrow(hand, leadCards, leadLen, leadCombo, ctx, position, tmWin);
    }
    return followOffSuitThrow(hand, leadCards, leadSuitCards, trumpCards, leadLen, ctx, position, tmWin);
  }

  // ---- Standard off-suit follow ----

  // Have enough lead-suit cards
  if (leadSuitCards.length >= leadLen) {
    return followOffSuit(leadSuitCards, leadCards, leadLen, leadCombo, ctx, position, tmWin, trumpCards, hand);
  }

  // Short-suited - must play all lead-suit cards
  if (leadSuitCards.length > 0) {
    const other = hand.filter(c => !leadSuitCards.includes(c));
    const needed = leadLen - leadSuitCards.length;
    const mode: DiscardMode = position === 'second'
      ? (secondShouldAvoid(hand) ? 'avoid' : 'open')
      : (tmWin && canAddPoints(tmWin, position, leadCombo, ctx))
        ? ((ctx.isAttacker && attackerNearThreshold(ctx, visibleTrickPoints(ctx, leadCombo.cards))) ? 'full' : 'add')
        : 'avoid';
    const fill = selectFillers(other, needed, ctx, mode,
      { allowBreakPair: shouldBreakPairForPoints(ctx, leadCombo) });
    const cards = [...leadSuitCards, ...fill];
    const baseReason = fill.some(c => isTrump(c, ctx))
      ? '同花色不够，垫主牌'
      : fill.some(c => c.suit !== leadSuitCards[0].suit)
        ? '同花色不够，垫其他花色'
        : '垫同花色';
    const addPoints = tmWin && canAddPoints(tmWin, position, leadCombo, ctx);
    const isPositioned = position === 'second' || position === 'third' || position === 'fourth';
    const intent = (mode === 'add' || mode === 'full') ? 'add'
      : (mode === 'avoid' && isPositioned) ? 'avoid' : 'none';
    const reason = annotateReason(baseReason, cards, leadSuitCards, trumpCards,
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Void in lead suit
  if (trumpCards.length >= leadLen) {
    // 队友已大且可加分：按加分优先级选牌（第三家有副牌垫副牌、全主出主分；
    // 第四家全手选可含主牌=毙加分；全力加分能跨 40 台阶时用全力加分优先级）
    if (tmWin && canAddPoints(tmWin, position, leadCombo, ctx)) {
      const cards = pickBestAddCards(hand, leadLen, leadCombo, ctx);
      return finishTeammateWin(cards, leadCards, leadCombo, leadLen, ctx, position, tmWin, trumpCards);
    }
    // 第三家第3条特判：领出大（队友）且自己能毙——只有领出一对 J 以下（不含）
    // 才毙最小；领出 >=J 对子或拖拉机不毙（按不能毙垫牌：拖拉机且可加分则加分，
    // 否则一视同仁）
    if (position === 'third' && tmWin && (leadCombo.type === 'pair' || leadCombo.hasTractor)) {
      const maxLeadRank = Math.max(...leadCards.map(c => getEffectiveRank(c, ctx)));
      if (leadCombo.type === 'pair' && maxLeadRank < 11) {
        return trumpKill(trumpCards, hand, leadCards, leadCombo, leadLen, ctx, position, tmWin);
      }
      const addMode = canAddPoints(tmWin, position, leadCombo, ctx);
      const mode: DiscardMode = addMode
        ? ((ctx.isAttacker && attackerNearThreshold(ctx, visibleTrickPoints(ctx, leadCombo.cards))) ? 'full' : 'add')
        : 'open';
      const cards = pickDiscards(hand, leadLen, ctx, mode);
      const intent = (mode === 'add' || mode === 'full') ? 'add' : 'none';
      const reason = annotateReason('垫牌', cards, [], trumpCards,
        leadCombo, leadLen, ctx, position, tmWin, false, intent);
      return { cards, reason };
    }
    // 第二家/第三家毙牌按第1条三档（强牌最大 / 墩含分不小于A / 最小）；
    // 第四家与 lead 保持现行为
    if (position === 'second' || position === 'third') {
      const killMode = rule1KillMode(position, tmWin, leadCombo, ctx, hand, leadCards);
      return trumpKill(trumpCards, hand, leadCards, leadCombo, leadLen, ctx, position, tmWin,
        { killMode });
    }
    return trumpKill(trumpCards, hand, leadCards, leadCombo, leadLen, ctx, position, tmWin);
  }

  // Can't fully trump - discard
  return discardNonTrump(hand, leadLen, ctx, position, tmWin, leadCombo);
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
