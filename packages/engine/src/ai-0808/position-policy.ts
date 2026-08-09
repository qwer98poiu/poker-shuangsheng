/**
 * 分位置跟牌策略 —— 跨类别垫牌排序与位置谓词。
 *
 * 实现分位置跟牌规格（第二家/第三家/第四家）中的垫牌优先级与
 * 位置判断：排序类别（avoid/open/add/full/forbid）、强后续判断、
 * 可见分数统计、80 分防御、垫牌花色选择。
 *
 * 排序以"单元"为单位：相同 suit+rank 的两张组成对单元，整体消费
 * （整对垫牌不属于拆对）；对单元放不下所需张数时不拆，最后兜底才拆。
 */
import type { Card, ComboClass, TrumpDeclaration } from '../types.js';
import { Rank, Suit, isPointRank } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { detectTractors } from '../pattern/index.js';
import { findThrowableOffSuitCombos } from './throw-detector.js';
import { groupBySuit } from './utils.js';
import type { AIContext } from './types.js';

// ---- Position predicates ----

/** 手中有拖拉机或可甩的副牌（强后续手段，出大牌抢权/毙牌的依据）。 */
export function hasStrongFollowUp(hand: Card[], ctx: TrumpDeclaration): boolean {
  if (detectTractors(hand, ctx).length > 0) return true;
  const throwable = findThrowableOffSuitCombos(hand, ctx as AIContext);
  return (throwable?.cards.length ?? 0) > 0;
}

function pointsOf(cards: Card[]): number {
  return cards.reduce(
    (s, c) => s + (isPointRank(c.rank) ? (c.rank === Rank.Five ? 5 : 10) : 0), 0);
}

/**
 * 本墩已出的分数（领出 + 当前最大；当前最大为领出者时不重复计）。
 * context 无完整 trickPlays，此为规格认可的近似。
 */
export function visibleTrickPoints(ctx: AIContext, leadCards: Card[]): number {
  let pts = pointsOf(leadCards);
  const bs = ctx.bestSoFar;
  if (bs && bs.cards.length > 0 && bs.playerIndex !== ctx.leadPlayerIndex) {
    pts += pointsOf(bs.cards);
  }
  return pts;
}

/** 第二家避分：出牌前手牌 >15 张；<=15 张分非分一视同仁。 */
export function secondShouldAvoid(hand: Card[]): boolean {
  return hand.length > 15;
}

/** 毙甩牌的 80 分防御（庄家方）：已出含分且闲家得分 + 已出分 >= 80 时全力毙。 */
export function defense80(ctx: AIContext, leadCards: Card[]): boolean {
  if (ctx.isAttacker) return false;
  const vis = visibleTrickPoints(ctx, leadCards);
  return vis > 0 && ctx.attackerPoints + vis >= 80;
}

/** 领出或当前最大是否含分。 */
export function leadHasPoints(leadCombo: ComboClass, ctx: AIContext): boolean {
  if (leadCombo.cards.some(c => isPointRank(c.rank))) return true;
  return !!(ctx.bestSoFar && ctx.bestSoFar.cards.some(c => isPointRank(c.rank)));
}

// ---- Cross-category discard sorting ----

export type DiscardMode = 'avoid' | 'open' | 'add' | 'full' | 'forbid';

interface Unit {
  kind: 'single' | 'pair';
  cards: Card[];
  card: Card;
  /** 对单元是否处于拖拉机中（拆拖拉机才能用——副牌分对拆拖拉机的归类依据）。 */
  inTractor?: boolean;
}

/** 相同 suit+rank 分组为单元：偶数成对（整对垫出不拆），奇数余单。 */
function unitize(cards: Card[], ctx?: TrumpDeclaration): Unit[] {
  const groups = new Map<string, Card[]>();
  for (const c of cards) {
    const key = `${c.suit}-${c.rank}`;
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); }
    g.push(c);
  }
  let tractorIds: Set<string> | null = null;
  if (ctx) {
    tractorIds = new Set(detectTractors(cards, ctx).flat().map(c => c.id));
  }
  const units: Unit[] = [];
  for (const g of groups.values()) {
    const pairs = Math.floor(g.length / 2);
    for (let i = 0; i < pairs; i++) {
      units.push({
        kind: 'pair',
        cards: [g[i * 2], g[i * 2 + 1]],
        card: g[i * 2],
        inTractor: tractorIds ? tractorIds.has(g[i * 2].id) : undefined,
      });
    }
    if (g.length % 2 === 1) {
      const last = g[g.length - 1];
      units.push({ kind: 'single', cards: [last], card: last });
    }
  }
  return units;
}

/** 主牌 A 的有效大小（"主牌A或更大"的阈值）。 */
function aceEff(ctx: TrumpDeclaration): number {
  return getEffectiveRank(
    { suit: ctx.trumpSuit ?? Suit.Spades, rank: Rank.Ace, isJoker: false, id: '' } as Card, ctx);
}

/** 有效大小最小/最大的牌。 */
export function minEff(cards: Card[], config: TrumpDeclaration): Card {
  return cards.reduce((best, c) =>
    getEffectiveRank(c, config) < getEffectiveRank(best, config) ? c : best);
}
export function maxEff(cards: Card[], config: TrumpDeclaration): Card {
  return cards.reduce((best, c) =>
    getEffectiveRank(c, config) > getEffectiveRank(best, config) ? c : best);
}

/** 单元类别编号（小 = 先垫）。 */
function catOf(u: Unit, mode: DiscardMode, ctx: TrumpDeclaration): number {
  const c = u.card;
  const tr = isTrump(c, ctx);
  const pts = isPointRank(c.rank);
  const eff = getEffectiveRank(c, ctx);
  const ace = aceEff(ctx);
  const lvl = c.rank === ctx.level;
  const single = u.kind === 'single';
  const pair = u.kind === 'pair';

  if (mode === 'avoid') {
    // 第二家原则5：副非分单 < 副非分对 < 主A下非分单 < 副分单 < 副分对
    //   < 主A下分单（分数为等级时不属此类，归末类）< 主A下非分对
    //   < 主A下分对 < 主A或更大（单/对、分/非分一律）
    if (!tr && !pts && single) return 1;
    if (!tr && !pts && pair) return 2;
    if (tr && eff < ace && !pts && single) return 3;
    if (!tr && pts && single) return 4;
    if (!tr && pts && pair) return 5;
    if (tr && eff < ace && pts && single && !lvl) return 6;
    if (tr && eff < ace && !pts && pair) return 7;
    if (tr && eff < ace && pts && pair) return 8;
    return 9;
  }
  if (mode === 'open') {
    // 第二家原则6：副单 < 副对 < 主A下单 < 主A下对 < 主A或更大
    if (!tr && single) return 1;
    if (!tr && pair) return 2;
    if (tr && eff < ace && single) return 3;
    if (tr && eff < ace && pair) return 4;
    return 5;
  }
  if (mode === 'add') {
    // 第三家原则6：副10 < 副K < 副5 < 副牌分对(非拖拉机，类内10>K>5) < 其他非分副
    //   < 副牌分对(拆拖拉机) < 主10(非常主) < 主K(非常主) < 主5(非常主)
    //   < 主牌分对(非常主) < A以下主牌非分单 < A以下主牌非分对 < 常主分单
    //   < 其他主牌(小→大，不分对单)；所有副牌花色一视同仁
    if (!tr && single && c.rank === Rank.Ten) return 1;
    if (!tr && single && c.rank === Rank.King) return 2;
    if (!tr && single && c.rank === Rank.Five) return 3;
    if (!tr && pair && pts && !u.inTractor) return 4;
    if (!tr && !pts) return 5;
    if (!tr && pair && pts && u.inTractor) return 6;
    if (tr && single && c.rank === Rank.Ten && !lvl) return 7;
    if (tr && single && c.rank === Rank.King && !lvl) return 8;
    if (tr && single && c.rank === Rank.Five && !lvl) return 9;
    if (tr && pair && pts && !lvl) return 10;
    if (tr && single && !pts && eff < ace) return 11;
    if (tr && pair && !pts && eff < ace) return 12;
    if (tr && single && pts && lvl) return 13;
    return 14;
  }
  if (mode === 'full') {
    // 第三家原则7：副10 < 副K < 主10(非常主) < 主K(非常主) < 常主10/K
    //   < 副5 < 主5(非常主) < 其他非分副 < 其他主牌
    if (!tr && c.rank === Rank.Ten) return 1;
    if (!tr && c.rank === Rank.King) return 2;
    if (tr && c.rank === Rank.Ten && !lvl) return 3;
    if (tr && c.rank === Rank.King && !lvl) return 4;
    if (tr && (c.rank === Rank.Ten || c.rank === Rank.King) && lvl) return 5;
    if (!tr && c.rank === Rank.Five) return 6;
    if (tr && c.rank === Rank.Five && !lvl) return 7;
    if (!tr && !pts) return 8;
    return 9;
  }
  // forbid —— 第三家原则9：非分副 < 非分主 < 副5 < 主5 < 副10 < 副K < 主10/K
  // （类内谁小谁优先 = 有效大小升序）
  if (!tr && !pts) return 1;
  if (tr && !pts) return 2;
  if (!tr && c.rank === Rank.Five) return 3;
  if (tr && c.rank === Rank.Five) return 4;
  if (!tr && c.rank === Rank.Ten) return 5;
  if (!tr && c.rank === Rank.King) return 6;
  return 7;
}

function unitCompare(a: Unit, b: Unit, mode: DiscardMode, ctx: TrumpDeclaration): number {
  const ca = catOf(a, mode, ctx);
  const cb = catOf(b, mode, ctx);
  if (ca !== cb) return ca - cb;
  // 副牌分对类内 10>K>5（分高在前，同分 rank 大在前）
  if (mode === 'add' && (ca === 4 || ca === 6)) {
    const pv = (c: Card): number => c.rank === Rank.Ten ? 10 : 5;
    const d = pv(b.card) - pv(a.card);
    if (d !== 0) return d;
    return b.card.rank - a.card.rank;
  }
  return getEffectiveRank(a.card, ctx) - getEffectiveRank(b.card, ctx);
}

/** 全量类别排序（单元整体排列，不拆对）。 */
export function sortDiscards(
  hand: Card[], ctx: TrumpDeclaration, mode: DiscardMode,
): Card[] {
  return unitize(hand, ctx)
    .sort((a, b) => unitCompare(a, b, mode, ctx))
    .flatMap(u => u.cards);
}

/**
 * 按类别选 need 张：对单元整体消费（不拆对），放不下则跳过，
 * 最后仍不足时兜底拆对补足。allowBreakPair 时对单元可按单张拆出
 * （闲家跨 40 台阶冲分的场景）。
 */
export function pickDiscards(
  hand: Card[], need: number, ctx: TrumpDeclaration, mode: DiscardMode,
  opts?: { allowBreakPair?: boolean },
): Card[] {
  const units = unitize(hand, ctx);
  units.sort((a, b) => unitCompare(a, b, mode, ctx));
  const picked: Card[] = [];
  const used = new Set<string>();
  const allowBreak = !!opts?.allowBreakPair;
  for (const u of units) {
    if (picked.length + u.cards.length > need) {
      if (allowBreak && u.kind === 'pair' && picked.length < need) {
        picked.push(u.cards[0]);
        used.add(u.cards[0].id);
        if (picked.length === need) return picked;
      }
      continue;
    }
    picked.push(...u.cards);
    u.cards.forEach(c => used.add(c.id));
    if (picked.length === need) return picked;
  }
  if (picked.length < need) {
    const rest = hand.filter(c => !used.has(c.id));
    rest.sort((a, b) => unitCompare(
      { kind: 'single', cards: [a], card: a },
      { kind: 'single', cards: [b], card: b },
      mode, ctx));
    picked.push(...rest.slice(0, need - picked.length));
  }
  return picked;
}

/** 闲家加分时拆对跨 40 台阶的判定：存在分牌使闲家得分 + 本墩已出分 + 该分牌
 *  跨入更高的 40 台阶（40/80/120）。 */
export function shouldBreakPairForPoints(ctx: AIContext, leadCombo: ComboClass): boolean {
  if (!ctx.isAttacker) return false;
  const vis = visibleTrickPoints(ctx, leadCombo.cards);
  const currTier = Math.floor(ctx.attackerPoints / 40);
  for (const pts of [5, 10]) {
    if (Math.floor((ctx.attackerPoints + vis + pts) / 40) > currTier) return true;
  }
  return false;
}

/**
 * 加分选牌：add 优先级与"全力加分"（full + 允许拆对）比较，
 * 后者跨入更高 40 台阶时采用（闲家全力冲分）。
 */
export function pickBestAddCards(
  hand: Card[], leadLen: number, leadCombo: ComboClass, ctx: AIContext,
): Card[] {
  const addCards = pickDiscards(hand, leadLen, ctx, 'add');
  if (!ctx.isAttacker) return addCards;
  const fullCards = pickDiscards(hand, leadLen, ctx, 'full', { allowBreakPair: true });
  const vis = visibleTrickPoints(ctx, leadCombo.cards);
  const ptsOf = (cs: Card[]) => cs.reduce(
    (s, c) => s + (isPointRank(c.rank) ? (c.rank === Rank.Five ? 5 : 10) : 0), 0);
  const tier = (p: number) => Math.floor((ctx.attackerPoints + vis + p) / 40);
  if (ptsOf(fullCards) > ptsOf(addCards) && tier(ptsOf(fullCards)) > tier(ptsOf(addCards))) {
    return fullCards;
  }
  return addCards;
}

/**
 * 垫牌花色选择：avoid/forbid 时按类别全局排序（避分优先，可混合多花色）；
 * open/add/full 时按副牌花色张数升序整门垫出（断门优先），垫不完或副牌
 * 不够时混合多花色，主牌兜底。
 */
export function selectFillers(
  hand: Card[], need: number, ctx: TrumpDeclaration, mode: DiscardMode,
  opts?: { allowBreakPair?: boolean },
): Card[] {
  if (mode === 'avoid' || mode === 'forbid') {
    return pickDiscards(hand, need, ctx, mode, opts);
  }
  const nonTrump = hand.filter(c => !isTrump(c, ctx));
  const suits = groupBySuit(nonTrump).sort((a, b) => a.length - b.length);
  const chosen: Card[] = [];
  for (const g of suits) {
    if (chosen.length >= need) break;
    if (chosen.length + g.length <= need) {
      chosen.push(...g);
    } else {
      chosen.push(...pickDiscards(g, need - chosen.length, ctx, mode, opts));
      break;
    }
  }
  if (chosen.length < need) {
    const trumps = hand.filter(c => isTrump(c, ctx));
    chosen.push(...pickDiscards(trumps, need - chosen.length, ctx, mode, opts));
  }
  return sortDiscards(chosen, ctx, mode).slice(0, need);
}
