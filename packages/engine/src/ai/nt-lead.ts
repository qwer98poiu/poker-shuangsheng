/**
 * NT (无主) long-suit lead layer.
 *
 * The general ladder in `lead.ts` cashes off-suit big cards one shape at a
 * time. In NT the declarer instead holds one *long suit* — the suit the bottom
 * strategy deliberately kept out of the bottom — and plays it in phases:
 *
 *   §1  cash the control cards (T1) of every *other* off-suit
 *   §3  first long-suit lead: tractors only (the single top card + tractor
 *       special case goes out whole)
 *   §5  later leads: pick a proposal out of the current T1
 *   §6  if opponents could trump it, draw trumps safely first, or shrink
 *   §7  once the long suit has been led twice: only pairs, or everything if
 *       nobody else holds the suit any more
 *   §9  non-declarers run a simpler version of the same idea
 *
 * Multi-card leads that contain pairs must survive a worst-case check; the
 * engine fines an illegal throw (±10 and a forced down-play), so the check is
 * run through the engine's own `validateThrow` against the worst-case hand
 * rather than reimplemented. Tractors are exempt by design — their
 * interception probability is judged negligible.
 */
import type { Card, Suit } from '../types.js';
import { Rank, SUIT_ORDER, isPointRank } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { detectTractors, classify as classifyCombo } from '../pattern/index.js';
import { extractComponents } from '../comparing/index.js';
import { validateThrow } from '../leading/index.js';
import type { AIContext } from './types.js';
import { suitLabelCn, maxCardT } from './utils.js';
import { computeOffSuitControls, pairUnitCount, pairUnitsOf } from './bottom-controls.js';
import { worstCaseSuitHand } from './throw-detector.js';
import { pickNTTrumpLead } from './nt-trump.js';
import {
  computeLongSuit, computeLongSuitMemory, initialHand, longSuitLeadCount,
  myPlayedCards, type LongSuitMemory,
} from './suit-memory.js';

interface Proposal { cards: Card[]; reason: string }

/** Non-trump cards of one suit. */
function cardsOfSuit(cards: readonly Card[], suit: Suit, ctx: AIContext): Card[] {
  return cards.filter(c => c.suit === suit && !isTrump(c, ctx));
}

/** Cards of the suit played in the immediately preceding trick. */
function lastTrickSuitCards(ctx: AIContext, suit: Suit): Card[] {
  const t = ctx.trickHistory[ctx.trickHistory.length - 1];
  if (!t) return [];
  return cardsOfSuit(t.plays.flatMap(p => p.cards), suit, ctx);
}

function othersOf(ctx: AIContext): number[] {
  return [0, 1, 2, 3].filter(p => p !== ctx.myIndex);
}

function opponentsOf(ctx: AIContext): number[] {
  return [0, 1, 2, 3].filter(p => p % 2 !== ctx.myIndex % 2);
}

// ---- Throw gate ----

/** Is this sub-pattern unbeatable even when every unknown card sits in one hand? */
function isSafeComponent(
  component: Card[], hand: Card[], suitCards: Card[], suit: Suit, ctx: AIContext,
  exclude: readonly Card[],
): boolean {
  const worst = worstCaseSuitHand(suitCards, suit, ctx, exclude);
  return validateThrow(component, hand, [worst], ctx).valid;
}

/**
 * Drop the components of a proposal that would not survive the worst case.
 * Tractors pass untouched (explicit product decision); pairs and singles have
 * to satisfy the engine's own block rules. What is left is guaranteed legal,
 * so a lead built here can never take the throw penalty.
 */
function gateComponents(
  proposal: Card[], hand: Card[], suit: Suit, ctx: AIContext,
  exclude: readonly Card[],
): Card[] {
  const suitCards = cardsOfSuit(hand, suit, ctx);
  const comps = extractComponents(proposal, ctx);
  const out: Card[] = [];
  // Tractors: exempt.
  for (const t of comps.tractors) out.push(...t);
  for (const p of comps.pairs) {
    if (isSafeComponent(p, hand, suitCards, suit, ctx, exclude)) out.push(...p);
  }
  for (const s of comps.singles) {
    if (isSafeComponent([s], hand, suitCards, suit, ctx, exclude)) out.push(s);
  }
  return out;
}

/**
 * Only `throw`-classified leads are validated by the engine, and only they
 * carry the ±10 penalty. Singles, pairs and tractors are always legal (they
 * just lose the trick), so the gate must leave them alone — gating them would
 * wrongly veto plays like §7's "smallest single for the teammate to trump".
 */
function applyGate(
  proposal: Card[], hand: Card[], suit: Suit, ctx: AIContext,
  exclude: readonly Card[],
): Card[] {
  if (classifyCombo(proposal, ctx).type !== 'throw') return proposal;
  return gateComponents(proposal, hand, suit, ctx, exclude);
}

// ---- §1: control cards of the non-long suits ----

/**
 * §1 — pick the non-long suit with the fewest control cards and lead all of
 * them at once. The three sort keys are "which suit", not "how to split".
 */
function tryShortSuitControls(
  hand: Card[], ctx: AIContext, longSuit: Suit | null,
): Proposal | null {
  const handIds = new Set(hand.map(c => c.id));
  const candidates = [];
  for (const info of computeOffSuitControls(initialHand(hand, ctx), ctx)) {
    if (info.suit === longSuit) continue;
    const t1 = info.tier1.filter(c => handIds.has(c.id));
    if (t1.length === 0) continue;
    const handSuit = cardsOfSuit(hand, info.suit, ctx);
    const bottomCount = ctx.isDeclarer && ctx.bottomCards
      ? cardsOfSuit(ctx.bottomCards, info.suit, ctx).length
      : 0;
    candidates.push({
      suit: info.suit,
      t1,
      // ③ the whole suit leaves the hand once these are played
      voidsAfter: t1.length === handSuit.length,
      // ③ hand + bottom
      total: handSuit.length + bottomCount,
      order: SUIT_ORDER.indexOf(info.suit),
    });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) =>
    a.t1.length - b.t1.length ||                          // ① fewest control cards
    Number(b.voidsAfter) - Number(a.voidsAfter) ||        // ② voids the suit
    a.total - b.total ||                                  // ③ hand + bottom
    a.order - b.order);

  const pick = candidates[0];
  const gated = applyGate(
    pick.t1, hand, pick.suit, ctx, lastTrickSuitCards(ctx, pick.suit),
  );
  if (gated.length === 0) return null;
  return {
    cards: gated,
    reason: `出${suitLabelCn(pick.suit)}控制张(${gated.length}张)`,
  };
}

// ---- proposal building ----

/** Longest tractor, then highest — control cards should be cashed strongest first. */
function sortTractors(tractors: Card[][], ctx: AIContext): Card[][] {
  return [...tractors].sort((a, b) =>
    b.length - a.length ||
    getEffectiveRank(maxCardT(b, ctx), ctx) - getEffectiveRank(maxCardT(a, ctx), ctx));
}

/**
 * §3 — first long-suit lead. Singles never ride along: the lead is the tractor
 * alone, except for the "single top card + one tractor" special case.
 */
function buildFirstLongSuitProposal(
  t1: Card[], handSuit: Card[], hand: Card[], suit: Suit, ctx: AIContext,
  exclude: readonly Card[],
): Proposal | null {
  // §5 global exception: a lone control card is not worth a suit lead.
  if (t1.length <= 1) return null;
  const comps = extractComponents(t1, ctx);

  // §3.3 special case: exactly one top single plus one tractor -> play it all,
  // the tractor being unlikely to be intercepted. The single has to BE the top
  // card (as in A6655), not merely an unblockable one.
  const singleIsTop = comps.singles.length === 1
    && comps.tractors.length === 1
    && getEffectiveRank(comps.singles[0], ctx)
       > getEffectiveRank(maxCardT(comps.tractors[0], ctx), ctx)
    && isSafeComponent([comps.singles[0]], hand, cardsOfSuit(hand, suit, ctx), suit, ctx, exclude);
  if (comps.pairs.length === 0 && comps.tractors.length === 1
      && comps.tractors[0].length + 1 === t1.length && singleIsTop) {
    return { cards: [...t1], reason: `长花色顶张+拖拉机(${t1.length}张)` };
  }

  const tractors = sortTractors(comps.tractors, ctx);
  if (tractors.length > 0) {
    // §3.1 at most two pairs per lead -> prefer a 2-pair tractor;
    // §3.2 when only a longer one is available, take it whole rather than split.
    const twoPair = tractors.filter(t => t.length === 4);
    const chosen = twoPair.length > 0 ? twoPair[0] : tractors[0];
    return { cards: chosen, reason: `长花色拖拉机(${chosen.length / 2}对)` };
  }

  // No tractor in T1 -> fall through to the §5 proposal builder.
  return buildRepeatedProposal(t1, handSuit, ctx);
}

/**
 * §5 — later T1 leads. `t1` is already intersected with the current hand.
 */
function buildRepeatedProposal(
  t1: Card[], handSuit: Card[], ctx: AIContext,
): Proposal | null {
  // §5 global exception: a lone control card is not worth a suit lead.
  if (t1.length <= 1) return null;
  const ids = new Set(t1.map(c => c.id));

  // §5.1 everything left in the suit goes out in one lead
  if (t1.length === handSuit.length) {
    return { cards: [...t1], reason: `长花色全出(${t1.length}张)` };
  }

  // §5.2 pairs outside T1 exist -> all of T1
  const nonT1Pairs = pairUnitsOf(handSuit.filter(c => !ids.has(c.id))).pairs;
  if (nonT1Pairs.length > 0) {
    return { cards: [...t1], reason: `长花色控制张(${t1.length}张)` };
  }

  const comps = extractComponents(t1, ctx);

  // §5.3 tractor present -> tractor (plus singles, see below)
  if (comps.tractors.length > 0) {
    const chosen = sortTractors(comps.tractors, ctx)[0];
    const chosenIds = new Set(chosen.map(c => c.id));
    const rest = handSuit.filter(c => !chosenIds.has(c.id));
    // Pairs still held after this lead -> keep the smaller throwable singles
    // for the next trick and ride only the largest one along.
    const pairsLeft = pairUnitCount(rest) > 0;
    const singles = comps.singles
      .filter(c => !chosenIds.has(c.id))
      .sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));
    const ridden = pairsLeft ? singles.slice(0, 1) : singles;
    return {
      cards: [...chosen, ...ridden],
      reason: `长花色拖拉机(${chosen.length / 2}对)`,
    };
  }

  // §5.3 no tractor: with more than two pairs, hold one back for the next lead.
  const pairUnits = pairUnitsOf(t1).pairs;
  if (pairUnits.length > 2 && !pairUnits.every(p => isPointRank(p[0].rank))) {
    const droppable = pairUnits
      .filter(p => !isPointRank(p[0].rank))
      .sort((a, b) => getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx));
    const dropIds = new Set(droppable[0].map(c => c.id));
    return {
      cards: t1.filter(c => !dropIds.has(c.id)),
      reason: `长花色控制张(${t1.length - 2}张)`,
    };
  }

  return { cards: [...t1], reason: `长花色控制张(${t1.length}张)` };
}

/**
 * §7 — after the long suit has been led twice: everything if the suit is
 * exhausted, otherwise pairs only.
 */
function buildTwicePlusProposal(
  handSuit: Card[], memory: LongSuitMemory, ctx: AIContext,
): Proposal | null {
  const bottomCount = ctx.isDeclarer && ctx.bottomCards
    ? cardsOfSuit(ctx.bottomCards, memory.suit, ctx).length
    : 0;
  const exhausted = memory.playedCards.length + bottomCount + handSuit.length >= 24;
  if (exhausted) {
    return { cards: [...handSuit], reason: `长花色已绝，全部打出(${handSuit.length}张)` };
  }

  const pairs = pairUnitsOf(handSuit).pairs;
  if (pairs.length > 0) {
    const flat = pairs.flat();
    return { cards: flat, reason: `长花色只出对牌(${flat.length}张)` };
  }

  // No pair left: feed the smallest single to a void teammate so he can trump.
  const partner = (ctx.myIndex + 2) % 4;
  if (memory.voidPlayers.has(partner)) {
    const sorted = [...handSuit].sort(
      (a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    return { cards: [sorted[0]], reason: '长花色最小单张，让队友毙' };
  }

  return null;
}

/** §9 — non-declarer: cash T1 first, then follow the narrowing branches. */
function buildNonDeclarerProposal(
  t1: Card[], handSuit: Card[], memory: LongSuitMemory, ctx: AIContext,
  leadsDone: number,
): Proposal | null {
  if (leadsDone === 0) {
    // §5 global exception: a lone control card is not worth a suit lead.
    if (t1.length <= 1) return null;
    return { cards: [...t1], reason: `长花色控制张(${t1.length}张)` };
  }

  const others = othersOf(ctx);

  // Nobody else holds the suit any more -> everything goes out.
  if (others.every(p => memory.voidPlayers.has(p))) {
    return { cards: [...handSuit], reason: `长花色全出(${handSuit.length}张)` };
  }

  const undecided = others.filter(p => !memory.voidPlayers.has(p));
  const pairs = pairUnitsOf(handSuit).pairs;
  const noneLeftWithPairs = undecided.length > 0
    && undecided.every(p => memory.noPairPlayers.has(p));

  if (noneLeftWithPairs) {
    if (pairs.length === 0) return null;
    const flat = pairs.flat();
    return { cards: flat, reason: `长花色所有对牌(${flat.length}张)` };
  }

  if (pairs.length === 0) return null; // stop playing this suit
  const best = pairs.sort((a, b) =>
    getEffectiveRank(b[0], ctx) - getEffectiveRank(a[0], ctx))[0];
  return { cards: best, reason: '长花色最大对' };
}

// ---- §6: trump risk ----

/** Initial trump holding = what is in hand now plus what I already played. */
function initialTrumpCount(hand: Card[], ctx: AIContext): number {
  return hand.filter(c => isTrump(c, ctx)).length
    + myPlayedCards(ctx).filter(c => isTrump(c, ctx)).length;
}

/** A reveal of strength ≥3 means that opponent showed a joker pair. */
function opponentShowedJokerPair(ctx: AIContext): boolean {
  return ctx.reveals.some(r => r.strength >= 3 && r.playerIndex % 2 !== ctx.myIndex % 2);
}

/** Could either opponent trump this lead? Void in the suit + enough trumps. */
function opponentsCanTrump(cards: Card[], memory: LongSuitMemory, ctx: AIContext): boolean {
  const n = cards.length;
  return opponentsOf(ctx).some(p =>
    memory.voidPlayers.has(p) && (ctx.ntState?.maxTrumpCounts[p] ?? 0) >= n);
}

/**
 * §6.3 — once trumps are short and an opponent is known to hold a joker pair,
 * a throw only goes out when it is big enough to be worth the risk.
 */
function meetsMinimumSize(cards: Card[], hand: Card[], ctx: AIContext): boolean {
  let minPairs = isPointRank(ctx.level as Rank) ? 2 : 1;
  let minTotal = 0;
  if (initialTrumpCount(hand, ctx) <= 3 && opponentShowedJokerPair(ctx)) {
    minPairs = 2;
    minTotal = 6;
  }
  return pairUnitCount(cards) >= minPairs && cards.length >= minTotal;
}

// ---- entry point ----

function tryLongSuit(hand: Card[], ctx: AIContext, longSuit: Suit): Proposal | null {
  const memory = computeLongSuitMemory(hand, ctx);
  if (!memory) return null;

  const handSuit = cardsOfSuit(hand, longSuit, ctx);
  // The long suit is derived from the initial hand and stays designated for
  // the whole round, so it can outlive my cards in it — bail out once empty.
  if (handSuit.length === 0) return null;

  const t1 = memory.tier1;

  const leadsDone = longSuitLeadCount(ctx, longSuit);
  const exclude = ctx.isDeclarer
    ? memory.playedCards
    : lastTrickSuitCards(ctx, longSuit);

  let proposal: Proposal | null;
  if (!ctx.isDeclarer) {
    proposal = buildNonDeclarerProposal(t1, handSuit, memory, ctx, leadsDone);
  } else if (leadsDone === 0) {
    proposal = buildFirstLongSuitProposal(t1, handSuit, hand, longSuit, ctx, exclude);
  } else if (leadsDone === 1) {
    proposal = buildRepeatedProposal(t1, handSuit, ctx);
  } else {
    proposal = buildTwicePlusProposal(handSuit, memory, ctx);
  }
  if (!proposal) return null;

  const gated = applyGate(proposal.cards, hand, longSuit, ctx, exclude);
  if (gated.length === 0) return null;

  // §6: opponents might trump it -> draw trumps first, or skip this suit.
  if (ctx.isDeclarer && opponentsCanTrump(gated, memory, ctx)) {
    const trumpCards = hand.filter(c => isTrump(c, ctx));
    const safe = trumpCards.length > 0 ? pickNTTrumpLead(hand, trumpCards, ctx) : null;
    if (safe) return safe;
    if (!meetsMinimumSize(gated, hand, ctx)) return null;
  }

  return { cards: gated, reason: proposal.reason };
}

/**
 * NT long-suit lead. Returns null when this layer has nothing to say, in which
 * case the caller falls back to the general seven-step ladder.
 */
export function tryNTLead(hand: Card[], ctx: AIContext): Proposal | null {
  if (ctx.trumpSuit !== null) return null;
  if (ctx.myIndex < 0 || hand.length === 0) return null;

  const longSuit = computeLongSuit(hand, ctx);

  const shortLead = tryShortSuitControls(hand, ctx, longSuit);
  if (shortLead) return shortLead;

  if (longSuit === null) return null;
  return tryLongSuit(hand, ctx, longSuit);
}
