/**
 * 通用领出阶梯 5–12（庄家方与闲家共用）。
 *
 *   5  直接断门副对 / J 以上副对（排除顶张；不避分）
 *   6  无主吊主（单张/对子/拖拉机；仅 NT 且等级为分牌 5/10/K，规则见 nt-trump.ts）
 *   7  有主吊主对（两队）；主拖拉机归庄4.5
 *      两队都不受“副牌分对”与“保留主对”两条限制
 *   8  副牌 10 以下对牌（非直接断门；非分优先）
 *   9  有主单张吊主（最小的 A 以下主单；不再分首次/非首次）
 *      无主且等级非分牌（2/3/4/6/7/8/9/J/Q/A）的吊主也在这里，排在通用 8 之后
 *   10 直接断门单张 / J 以上单张（取最大；排除顶张；不避分）
 *   11 副牌 10 以下单张（从最长花色里挑）
 *   12 最后手牌：同组副牌整手甩出（仅本档受台阶防护），否则出最小单张
 *
 * 顶张口径：非长门静态、NT 长门动态（`topRankForSuit`）。
 * 无主与有主在 6/7/9 上完全分流：有主对子/拖拉机归 7、单张归 9；
 * 无主吊主按**等级牌是否分牌**分流——5/10/K 留在 6（提前吊），其余等级延后到 9。
 * 2026-10-24 实测（seed 47/46，默认 6 级 × 10000 副）：条件化后无主得分差
 * +0.804/+0.727 分/副（99% 判 A），有主逐字节不变；13 级复测中十个非分等级
 * 延后均为正、5/10/K 均为负。
 */
import type { Card } from '../types.js';
import { Suit } from '../types.js';
import { Rank, SUIT_ORDER, isPointRank } from '../types.js';
import { getEffectiveRank, isTrump } from '../model.js';
import { classify, findAllPairs, detectTractors } from '../pattern/index.js';
import { suitGroup, validateThrow } from '../leading/index.js';
import type { AIContext } from './types.js';
import { createCard } from '../model.js';
import { getTopOffSuitRank, suitLabelCn } from './utils.js';
import { rankLabelStr } from './reason.js';
import { topRankForSuit } from './drain.js';
import { worstCaseSuitHand } from './throw-detector.js';
import { knownOutOfPlay } from './suit-memory.js';
import { pairUnitCount, pairUnitsOf } from './bottom-controls.js';
import { shouldDrawTrumpInNT, pickNTTrumpLead } from './nt-trump.js';

export interface Proposal { cards: Card[]; reason: string }

interface Candidate {
  readonly cards: Card[];
  readonly keys: readonly number[];
  readonly reason: string;
}

function cardsOfSuit(cards: readonly Card[], suit: Suit, ctx: AIContext): Card[] {
  return cards.filter(c => c.suit === suit && !isTrump(c, ctx));
}

function trumpCardsOf(hand: readonly Card[], ctx: AIContext): Card[] {
  return hand.filter(c => isTrump(c, ctx));
}

function suitWeight(suit: Suit): number {
  return SUIT_ORDER.length - SUIT_ORDER.indexOf(suit);
}

function better(a: Candidate, b: Candidate): boolean {
  for (let i = 0; i < Math.min(a.keys.length, b.keys.length); i++) {
    if (a.keys[i] !== b.keys[i]) return a.keys[i] > b.keys[i];
  }
  return false;
}

function pick(candidates: Candidate[]): Proposal | null {
  let best: Candidate | null = null;
  for (const cand of candidates) {
    if (best === null || better(cand, best)) best = cand;
  }
  return best === null ? null : { cards: best.cards, reason: best.reason };
}

function pairReason(suit: Suit, rank: number): string {
  return `出${suitLabelCn(suit)}${rankLabelStr(rank)}对`;
}

// ---- 通用 5：直接断门副对 / J 以上副对 ----

export function tryTier5Pair(
  hand: Card[], ctx: AIContext, longSuit: Suit | null,
): Proposal | null {
  const candidates: Candidate[] = [];
  for (const suit of SUIT_ORDER) {
    const cards = cardsOfSuit(hand, suit, ctx);
    if (cards.length < 2) continue;
    const top = topRankForSuit(suit, ctx, longSuit);
    const directDrain = cards.length === 2;
    for (const pair of findAllPairs(cards)) {
      const rank = pair[0].rank;
      if (rank === top) continue; // 顶张归庄1/庄4（闲家归闲2）
      const jPlus = rank >= Rank.Jack;
      if (!directDrain && !jPlus) continue;
      candidates.push({
        cards: pair,
        keys: [
          directDrain ? 1 : 0,
          jPlus ? 1 : 0,
          -getEffectiveRank(pair[0], ctx),
          suitWeight(suit),
        ],
        reason: pairReason(suit, rank),
      });
    }
  }
  return pick(candidates);
}

// ---- 通用 6：无主吊主 / 通用 9：有主单张吊主 ----

function ntTrumpProposal(hand: Card[], ctx: AIContext): Proposal | null {
  if (!shouldDrawTrumpInNT(ctx)) return null;
  const trumpCards = trumpCardsOf(hand, ctx);
  if (trumpCards.length === 0) return null;
  return pickNTTrumpLead(hand, trumpCards, ctx);
}

/** 最小的小主（小于 A 的主牌），没有则 null。 */
function smallestSmallTrump(hand: Card[], ctx: AIContext): Card | null {
  const ace = createCard(ctx.trumpSuit ?? Suit.Spades, Rank.Ace, 0);
  const limit = getEffectiveRank(ace, ctx);
  const small = trumpCardsOf(hand, ctx)
    .filter(c => getEffectiveRank(c, ctx) < limit)
    .sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
  return small.length > 0 ? small[0] : null;
}

/** 通用 6：无主吊主（单张/对子/拖拉机都由 ntTrumpProposal 决定）。 */
export function tryTier6NTTrump(hand: Card[], ctx: AIContext): Proposal | null {
  if (ctx.trumpSuit !== null) return null;
  return ntTrumpProposal(hand, ctx);
}

/** 通用 9：有主单张吊主（最小的 A 以下主单；不再判首次）。 */
export function tryTier9SuitedTrump(hand: Card[], ctx: AIContext): Proposal | null {
  if (ctx.trumpSuit === null) return null;
  const card = smallestSmallTrump(hand, ctx);
  return card === null ? null : { cards: [card], reason: '吊主' };
}

/** 无主吊主是否延后到通用 9：仅 NT，且等级牌不是分牌（5/10/K）。 */
function ntTrumpDelayed(ctx: AIContext): boolean {
  return ctx.trumpSuit === null && !isPointRank(ctx.level);
}

/** 通用 9：有主单张吊主；无主非分等级的吊主也在这里（延后到通用 8 之后）。 */
export function tryTier9Trump(hand: Card[], ctx: AIContext): Proposal | null {
  if (ctx.trumpSuit === null) {
    return ntTrumpDelayed(ctx) ? ntTrumpProposal(hand, ctx) : null;
  }
  return tryTier9SuitedTrump(hand, ctx);
}

// ---- 通用 7：有主吊主对（两队；无主归 6） ----

function maximalTractors(tractors: Card[][]): Card[][] {
  const unique: Card[][] = [];
  const seen = new Set<string>();
  for (const t of tractors) {
    const key = t.map(c => c.id).sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(t);
  }
  return unique.filter((a, i) => !unique.some((b, j) => {
    if (i === j || a.length >= b.length) return false;
    const ids = new Set(b.map(c => c.id));
    return a.every(c => ids.has(c.id));
  }));
}

export function tryTier7TrumpPair(
  hand: Card[], ctx: AIContext, myHandCount: number,
): Proposal | null {
  // 无主吊主（单张/对子/拖拉机）已全部归通用 6。
  if (ctx.trumpSuit === null) return null;

  // 有主：庄家对家永不出主对；庄家与闲家都只出独立主对。主拖拉机归
  // 庄4.5（庄家本人）与闲1（闲家）。
  // 两队都不受“有副牌分对才吊”“至少保留一个主对”两条限制：10-18 实测
  // 庄家受两条限制时有主局当庄胜率约 -3.5；闲家去掉两条门禁后 10000 场
  // 直接 A/B 显著更好（p̂=0.5160，99% CI 下界 0.5031），故两队统一去掉。
  if (ctx.isDeclarerPartner) return null;

  const trump = trumpCardsOf(hand, ctx);
  const totalPairs = pairUnitCount(trump);
  if (totalPairs === 0) return null;

  const ace = createCard(ctx.trumpSuit, Rank.Ace, 0);
  const rankLimit = getEffectiveRank(ace, ctx);

  const allTrumpTractors = maximalTractors(detectTractors(trump, ctx))
    .filter(t => t.every(c => isTrump(c, ctx)));
  const tractorIds = new Set(allTrumpTractors.flat().map(c => c.id));
  const standalonePairs = pairUnitsOf(trump).pairs.filter(
    p => !p.some(c => tractorIds.has(c.id)),
  );

  const candidates: Candidate[] = [];
  const add = (cards: Card[], reason: string): void => {
    if (ctx.isDeclarer && myHandCount >= 20
        && cards.some(c => getEffectiveRank(c, ctx) > rankLimit)) return;
    const minRank = Math.min(...cards.map(c => getEffectiveRank(c, ctx)));
    candidates.push({
      cards,
      // 出最小主对；同最小对时先出更长的拖拉机。
      keys: [-minRank, cards.length, suitWeight(ctx.trumpSuit as Suit)],
      reason,
    });
  };

  // 主拖拉机由庄4.5 先取走；本档不拆拖拉机取其中的对子。
  for (const p of standalonePairs) {
    add(p, '出主对');
  }

  return pick(candidates);
}

// ---- 通用 8：副牌 10 以下对牌 ----

export function tryTier8LowPair(
  hand: Card[], ctx: AIContext, longSuit: Suit | null,
): Proposal | null {
  const candidates: Candidate[] = [];
  for (const suit of SUIT_ORDER) {
    const cards = cardsOfSuit(hand, suit, ctx);
    if (cards.length < 2) continue;
    if (cards.length === 2) continue; // 直接断门副对归通用 5
    const top = topRankForSuit(suit, ctx, longSuit);
    for (const pair of findAllPairs(cards)) {
      const rank = pair[0].rank;
      if (rank >= Rank.Jack) continue;
      if (rank === top) continue;
      candidates.push({
        cards: pair,
        keys: [
          isPointRank(rank) ? 0 : 1, // 非分优先
          -getEffectiveRank(pair[0], ctx),
          suitWeight(suit),
        ],
        reason: pairReason(suit, rank),
      });
    }
  }
  return pick(candidates);
}

// ---- 通用 10：直接断门单张 / J 以上单张 ----

export function tryTier10BigSingle(
  hand: Card[], ctx: AIContext, longSuit: Suit | null,
): Proposal | null {
  const candidates: Candidate[] = [];
  for (const suit of SUIT_ORDER) {
    const cards = cardsOfSuit(hand, suit, ctx);
    if (cards.length === 0) continue;
    const top = topRankForSuit(suit, ctx, longSuit);
    const directDrain = cards.length === 1;
    for (const c of cards) {
      if (c.rank === top) continue;
      if (!directDrain && c.rank < Rank.Jack) continue;
      candidates.push({
        cards: [c],
        keys: [
          directDrain ? 1 : 0,
          directDrain ? 0 : c.rank, // J 以上取最大单牌
          suitWeight(suit),
        ],
        reason: `出${suitLabelCn(suit)}${rankLabelStr(c.rank)}`,
      });
    }
  }
  return pick(candidates);
}

// ---- 通用 11：副牌 10 以下单张（从最长花色里挑） ----

export function tryTier11SmallSingle(
  hand: Card[], ctx: AIContext,
): Proposal | null {
  interface Cand { suit: Suit; cards: Card[]; low: Card[] }
  const perSuit: Cand[] = [];
  for (const suit of SUIT_ORDER) {
    const cards = cardsOfSuit(hand, suit, ctx);
    if (cards.length === 0) continue;
    const low = cards.filter(c => c.rank < Rank.Jack);
    if (low.length === 0) continue;
    perSuit.push({ suit, cards, low });
  }
  if (perSuit.length === 0) return null;
  perSuit.sort((a, b) =>
    b.cards.length - a.cards.length || suitWeight(b.suit) - suitWeight(a.suit));
  const chosenSuit = perSuit[0];
  const card = [...chosenSuit.low].sort((a, b) => a.rank - b.rank)[0];
  return {
    cards: [card],
    reason: `出${suitLabelCn(chosenSuit.suit)}小牌，长套引诱对手出分`,
  };
}

// ---- 通用 12：最后手牌 + 台阶防护 ----

/** 台阶 = 0 分单独一档，其余按 1–40、41–80 … 分档。 */
export function stepBucket(points: number): number {
  return points === 0 ? 0 : 1 + Math.floor((points - 1) / 40);
}

/** 出手方本局的罚分次数下标：[庄家方, 闲家方]。 */
function sideIndex(ctx: AIContext): 0 | 1 {
  if (ctx.isAttacker) return 1;
  if (ctx.isDeclarer || ctx.isDeclarerPartner) return 0;
  if (ctx.myIndex >= 0) {
    return ((ctx.myIndex - ctx.declarerIndex + 4) % 4) % 2 === 0 ? 0 : 1;
  }
  return 0;
}

/**
 * 台阶防护：只有甩牌（非单一牌型）受影响。
 * 闲家跨台阶的风险是 −10，庄家方是 +10；该方已用满 3 次罚分时防护失效。
 */
export function throwAllowedByStep(cards: Card[], ctx: AIContext): boolean {
  if (classify(cards, ctx).type !== 'throw') return true;
  const side = sideIndex(ctx);
  if (ctx.throwPenalties[side] >= 3) return true;
  const delta = side === 1 ? -10 : 10;
  return stepBucket(ctx.attackerPoints) === stepBucket(ctx.attackerPoints + delta);
}

/** 整手副牌甩出的最坏情况校验（NT 长门用动态排除集）。 */
function wholeSuitThrowValid(
  hand: Card[], suit: Suit, ctx: AIContext, longSuit: Suit | null,
): boolean {
  const exclude = suit === longSuit ? knownOutOfPlay(ctx, suit) : [];
  const worst = worstCaseSuitHand(hand, suit, ctx, exclude);
  return validateThrow(hand, hand, [worst], ctx).valid;
}

export function tryTier12LastHand(
  hand: Card[], ctx: AIContext, longSuit: Suit | null,
): Proposal | null {
  if (hand.length === 0) return null;

  const group = suitGroup(hand[0], ctx);
  const allSameGroup = hand.every(c => suitGroup(c, ctx) === group);
  if (allSameGroup) {
    const combo = classify(hand, ctx);
    if (combo.type === 'pair' || combo.type === 'tractor') {
      return { cards: hand, reason: `最后${hand.length}张手牌，必出` };
    }
    if (combo.type === 'throw' && group !== '_TRUMP_') {
      const suit = hand[0].suit as Suit;
      if (wholeSuitThrowValid(hand, suit, ctx, longSuit)
          && throwAllowedByStep(hand, ctx)) {
        return { cards: hand, reason: `甩${suitLabelCn(suit)}副牌(${hand.length}张)` };
      }
    }
  }

  const card = [...hand].sort((a, b) =>
    getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx)
    || String(a.suit).localeCompare(String(b.suit)))[0];
  return { cards: [card], reason: '出最小牌' };
}

// ---- 串联 ----

export function tryGenericLadder(
  hand: Card[], ctx: AIContext, longSuit: Suit | null, myHandCount: number,
): Proposal | null {
  // 无主非分等级：通用 6 整档让位，吊主并入通用 9（排在通用 8 之后）。
  const delayed = ntTrumpDelayed(ctx);
  const tiers = [
    () => tryTier5Pair(hand, ctx, longSuit),
    ...(delayed ? [] : [() => tryTier6NTTrump(hand, ctx)]),
    () => tryTier7TrumpPair(hand, ctx, myHandCount),
    () => tryTier8LowPair(hand, ctx, longSuit),
    () => tryTier9Trump(hand, ctx),
    () => tryTier10BigSingle(hand, ctx, longSuit),
    () => tryTier11SmallSingle(hand, ctx),
    () => tryTier12LastHand(hand, ctx, longSuit),
  ];
  for (const tier of tiers) {
    const r = tier();
    if (r) return r;
  }
  return null;
}

/** 供 `hasWorthLeadCards` 使用：是否有含副牌的“值得领出”候选。 */
export function hasWorthGenericLead(
  hand: Card[], ctx: AIContext, longSuit: Suit | null,
): boolean {
  // 顶张（庄4/闲2 的领地，但兼容 ctx 可能没有队伍标记）：顶张单/对都值得。
  for (const suit of SUIT_ORDER) {
    const cards = cardsOfSuit(hand, suit, ctx);
    const top = getTopOffSuitRank(suit, ctx);
    if (cards.some(c => c.rank === top)) return true;
  }

  const pairTiers = [
    tryTier5Pair(hand, ctx, longSuit),
    tryTier8LowPair(hand, ctx, longSuit),
  ];
  if (pairTiers.some(r => r !== null && r.cards.some(c => !isTrump(c, ctx)))) return true;
  // 单张只有 J+ 才算“值得”；直接断门的低单张（一张 2/3）不值一张主牌。
  const big = tryTier10BigSingle(hand, ctx, longSuit);
  return big !== null && big.cards[0].rank >= Rank.Jack;
}
