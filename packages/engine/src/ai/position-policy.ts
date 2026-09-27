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

export interface Unit {
  kind: 'single' | 'pair';
  cards: Card[];
  card: Card;
  /** 对单元是否处于拖拉机中（拆拖拉机才能用——副牌分对拆拖拉机的归类依据）。 */
  inTractor?: boolean;
}

/** 相同 suit+rank 分组为单元：偶数成对（整对垫出不拆），奇数余单。 */
export function unitize(cards: Card[], ctx?: TrumpDeclaration): Unit[] {
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
export function aceEff(ctx: TrumpDeclaration): number {
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
export function catOf(u: Unit, mode: DiscardMode, ctx: TrumpDeclaration): number {
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

// ---- 主牌档位筛选（毙单张 / 第四家吊主单张·队友大） ----

/** 档位模式：fourth = 第四家（毙/盖毙单张、吊主单张队友大）；mid = 第二/三家毙单张。 */
export type TrumpTierMode = 'fourth' | 'mid';

/** 分牌档内序：10(0) > K(1) > 5(2)；非分牌 3（只在分牌档内比较）。 */
function pointOrder(c: Card): number {
  return c.rank === Rank.Ten ? 0 : c.rank === Rank.King ? 1 : c.rank === Rank.Five ? 2 : 3;
}

/**
 * 按档位从候选主牌池取一张：档位优先，同档内取最小；池空返回 null。
 *
 * fourth（规格 2.3 第 3 条、第 1 条）：分牌单张（10>K>5）> 拆分牌散对（10>K>5）
 *   > A 以下非分单张 > A 以下非分散对（拆对）> A 以下含分拖拉机（出其中分牌）
 *   > A 以下不含分拖拉机 > A 和常主（升序，不区分单张/对牌/拖拉机）。
 *   分牌含「级牌本身 rank 为 5/10/K」的常主。
 * mid（规格毙牌通用规则·第二/三家，不区分分牌与非分）：A 以下单张 > A 以下散对（拆对）
 *   > A 以下拖拉机 > A 和常主（升序，不区分单张/对牌/拖拉机）。
 *
 * 拖拉机成员一律按拖拉机档归类（含 A 的拖拉机整段归末档，不按成员拆档），
 * 否则 A-K 拖拉机里的 K 会被分牌档抢走、含分拖拉机里的分牌会让拖拉机档永不可达。
 * 「A 以下」= 有效大小 < 主牌 A（级牌与王都算 A 以上）。
 */
export function pickTrumpByTier(
  pool: Card[], mode: TrumpTierMode, ctx: TrumpDeclaration,
): Card | null {
  if (pool.length === 0) return null;

  const unitOf = new Map<string, Unit>();
  for (const u of unitize(pool)) for (const c of u.cards) unitOf.set(c.id, u);
  const tractorOf = new Map<string, Card[]>();
  for (const t of detectTractors(pool, ctx)) for (const c of t) tractorOf.set(c.id, t);
  const ace = aceEff(ctx);

  const tier = (c: Card): number => {
    const eff = getEffectiveRank(c, ctx);
    const tr = tractorOf.get(c.id);
    if (tr) {
      const belowA = tr.every(x => getEffectiveRank(x, ctx) < ace);
      if (mode === 'mid') return belowA ? 2 : 3;
      if (!belowA) return 6;
      return tr.some(x => isPointRank(x.rank)) ? 4 : 5;
    }
    const single = unitOf.get(c.id)!.kind === 'single';
    if (mode === 'mid') {
      if (eff >= ace) return 3;
      return single ? 0 : 1;
    }
    // fourth：分牌档先于「A 和常主」档——rank 为 5/10/K 的常主（级牌）也按分牌算
    if (isPointRank(c.rank)) return single ? 0 : 1;
    if (eff >= ace) return 6;
    return single ? 2 : 3;
  };

  return [...pool].sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    // 仅 fourth 的分牌档（0/1/4）先比 10>K>5，再比有效大小；其余档只比有效大小
    if (mode === 'fourth' && (ta === 0 || ta === 1 || ta === 4)) {
      const d = pointOrder(a) - pointOrder(b);
      if (d !== 0) return d;
    }
    return getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx);
  })[0];
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

/**
 * 第四家「不抢无分墩」的垫牌：按 avoid 梯子（第二家原则 5）取 need 张，但只用"垫得起"的档位。
 *
 * 可用档（按 `catOf('avoid')` 的先后取，同类内从小到大）：副非分单(1)、副非分对(2)、
 *   主A下非分单张(3)、庄家副分单(4)与副分对(5)。
 * 禁用档（取到就返回 null，调用方改为毙/盖毙）：**一切主对**——散对与拖拉机成员都算，
 *   整对垫出与拆半张都不允许（含第 7 档主A下非分对）；主A下分单(6)、主A下分对(8)、
 *   主A或更大(9)；非庄家还禁用副分(4/5)。
 * **NT 下禁用档多一条：任何主牌（级牌与王）一律不得垫**（没有"主A以下非分单张"这一档）
 *   → NT 版只剩副牌各档可用，等价于"只垫副牌，垫不起就照常毙"。副分口径两模式相同。
 * 本路径下不会有副对：手里有副对即"优先级 4 能领出"，调用方早判为有值得出的牌而照常毙。
 * 庄家的"垫光副牌变全主"由梯子自然覆盖——副牌各档都排在禁用主牌档之前，副牌不够时
 *   梯子自动下探主牌非分单张（NT 下无此档，副牌不够即返回 null）。
 *
 * 分牌上限只算副分：累计 ≤10 分，且 `attackerPoints + 累计副分 < 80`（本墩已出分由
 *   调用方保证为 0——无分墩正是触发条件之一）。闲家 70 分可垫 5 分，75 分则一分不能垫。
 *
 * 不拆对：对单元放不下就跳过，绝不为凑数拆对（与 `pickDiscards` 的兜底拆对不同）。
 */
export function pickNoSeizeDiscards(
  hand: Card[], need: number, ctx: AIContext,
): Card[] | null {
  const tractorIds = new Set(detectTractors(hand, ctx).flat().map(c => c.id));
  const usable = (u: Unit): boolean => {
    const c = u.card;
    if (isTrump(c, ctx)) {
      // NT：主牌只有级牌与王（eff 800/900/1000），没有"主A以下非分单张"这一档，
      // 一律不得垫——若可垫的只剩主牌，那张主牌垫或毙都要花掉（垫=白丢控制张且丢
      // 牌权，毙=花同一张但赢下此墩），落回毙更优。此处显式判 NT，不要靠
      // "eff >= aceEff 在 NT 恒成立"这个算术巧合（级牌为 A 时 aceEff 会变成 800）。
      if (ctx.trumpSuit === null) return false;
      if (u.kind === 'pair' || tractorIds.has(c.id)) return false; // 一切主对
      if (isPointRank(c.rank)) return false;                       // 主分牌
      return getEffectiveRank(c, ctx) < aceEff(ctx);               // 主A下非分单张
    }
    if (!isPointRank(c.rank)) return true;                         // 副非分（单/对）
    return ctx.isDeclarer;                                         // 副分：仅庄家（上限见下）
  };

  const sorted = unitize(hand, ctx)
    .filter(usable)
    .sort((a, b) => {
      const d = catOf(a, 'avoid', ctx) - catOf(b, 'avoid', ctx);
      return d !== 0 ? d : getEffectiveRank(a.card, ctx) - getEffectiveRank(b.card, ctx);
    });

  const MAX_OFF_SUIT_POINTS = 10;
  const picked: Card[] = [];
  let offSuitPoints = 0;
  for (const u of sorted) {
    if (picked.length + u.cards.length > need) continue; // 整单位消费，放不下就跳过（不拆对）
    if (!isTrump(u.card, ctx) && isPointRank(u.card.rank)) {
      const add = u.cards.reduce((s, c) => s + (c.rank === Rank.Five ? 5 : 10), 0);
      if (offSuitPoints + add > MAX_OFF_SUIT_POINTS) continue;
      if (ctx.attackerPoints + offSuitPoints + add >= 80) continue;
      offSuitPoints += add;
    }
    picked.push(...u.cards);
    if (picked.length === need) break;
  }
  return picked.length === need ? picked : null;
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

/** 断门组合：含分副牌花色张数 <= need（可整门垫出，这一墩后该花色出绝）→
 *  该门全部垫出 + 其余按加分垫。多门可选时取张数最少者；无可出绝含分门 → null。 */
function pickVoidSuitCards(hand: Card[], need: number, ctx: TrumpDeclaration): Card[] | null {
  const nonTrump = hand.filter(c => !isTrump(c, ctx));
  const suits = groupBySuit(nonTrump)
    .filter(g => g.length <= need && g.some(c => isPointRank(c.rank)))
    .sort((a, b) => a.length - b.length);
  if (suits.length === 0) return null;
  const g = suits[0];
  const rest = hand.filter(c => !g.includes(c));
  const fill = pickDiscards(rest, need - g.length, ctx, 'add');
  return [...g, ...fill];
}

/**
 * 加分选牌：优先含分花色整门垫出（断门，第三/四家加分场景）；
 * 闲家时与"全力加分"（full + 允许拆对）比较，后者跨入更高 40 台阶时采用（闲家全力冲分）。
 */
export function pickBestAddCards(
  hand: Card[], leadLen: number, leadCombo: ComboClass, ctx: AIContext,
): Card[] {
  const base = pickVoidSuitCards(hand, leadLen, ctx)
    ?? pickDiscards(hand, leadLen, ctx, 'add');
  if (!ctx.isAttacker) return base;
  const fullCards = pickDiscards(hand, leadLen, ctx, 'full', { allowBreakPair: true });
  const vis = visibleTrickPoints(ctx, leadCombo.cards);
  const ptsOf = (cs: Card[]) => cs.reduce(
    (s, c) => s + (isPointRank(c.rank) ? (c.rank === Rank.Five ? 5 : 10) : 0), 0);
  const tier = (p: number) => Math.floor((ctx.attackerPoints + vis + p) / 40);
  if (ptsOf(fullCards) > ptsOf(base) && tier(ptsOf(fullCards)) > tier(ptsOf(base))) {
    return fullCards;
  }
  return base;
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
  if (mode === 'full') {
    // 闲家全力加分（近/跨 40 台阶）：分散选分牌，不优先断门
    return pickDiscards(hand, need, ctx, mode, opts);
  }
  const nonTrump = hand.filter(c => !isTrump(c, ctx));
  const suits = groupBySuit(nonTrump);
  if (mode === 'add') {
    // 第三/四家加分：含分花色优先整门垫出（断门，这一墩后该花色出绝）；
    // 同含分按张数升序（垫最少牌断门）
    suits.sort((a, b) => {
      const aPts = a.some(c => isPointRank(c.rank)) ? 0 : 1;
      const bPts = b.some(c => isPointRank(c.rank)) ? 0 : 1;
      if (aPts !== bPts) return aPts - bPts;
      return a.length - b.length;
    });
  } else {
    suits.sort((a, b) => a.length - b.length);
  }
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
