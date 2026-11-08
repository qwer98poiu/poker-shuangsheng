/**
 * Shared AI strategy helpers — tactical utilities used by both trump-follow
 * and off-suit-follow modules for pattern evaluation, point management,
 * and card selection.
 */
import type { Card, ComboClass } from '../types.js';
import { Rank, cardPointsFromRank, isPointRank } from '../types.js';
import { isTrump, getEffectiveRank, playOf } from '../model.js';
import { findAllPairs, detectTractors } from '../pattern/index.js';
import type { AIContext } from './types.js';
import { isBigOffSuitCard, discardSort, pairSortAsc } from './utils.js';
import { detectTeammateSafeLead } from './flush-detector.js';
import { canPlayerTrumpThrow } from './nt-tracking.js';
import {
  visibleTrickPoints, selectFillers, secondShouldAvoid, shouldBreakPairForPoints,
  type DiscardMode,
} from './position-policy.js';
import { annotateReason } from './reason.js';

// ---- Sorting helpers ----

/** Sort pairs for killing/following: non-tractor first (avoid breaking tractors),
 *  then non-point first, then smallest effective rank. */
export function pairKillSort(pairs: Card[][], cards: Card[], ctx: AIContext): void {
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

// ---- Tractor-splitting (follow side) ----

export interface TractorChain {
  /** Pairs sorted by effective rank ascending. */
  pairs: Card[][];
}

export interface PairStructure {
  /** Pairs that are not part of any tractor. */
  standalone: Card[][];
  /** Maximal disjoint tractor chains (2+ pairs). */
  chains: TractorChain[];
  /** First card id of a pair → its chain and index in that chain. */
  chainIndex: Map<string, { chain: TractorChain; index: number }>;
}

/**
 * Split a same-suit card pool into standalone pairs and maximal tractor
 * chains. Used only on the follow side for off-suit cards (no cross-group
 * tractors): the input is a single side suit, so level cards are already
 * excluded by the caller.
 */
export function analyzePairStructure(cards: Card[], ctx: AIContext): PairStructure {
  const allPairs = findAllPairs(cards);
  const pairsByRank = new Map<string, Card[][]>();
  for (const pair of allPairs) {
    const key = `${String(pair[0].suit)}-${pair[0].rank}`;
    const group = pairsByRank.get(key);
    if (group) group.push(pair);
    else pairsByRank.set(key, [pair]);
  }

  const candidates = detectTractors(cards, ctx)
    .filter(t => t.length >= 4)
    .slice()
    .sort((a, b) => (b.length - a.length)
      || (Math.min(...a.map(c => getEffectiveRank(c, ctx)))
        - Math.min(...b.map(c => getEffectiveRank(c, ctx)))));

  const used = new Set<string>();
  const chains: TractorChain[] = [];
  const chainIndex = new Map<string, { chain: TractorChain; index: number }>();
  for (const tractor of candidates) {
    const keys = [...new Set(tractor.map(c => `${String(c.suit)}-${c.rank}`))];
    const picked: Card[][] = [];
    let ok = true;
    for (const key of keys) {
      const pair = (pairsByRank.get(key) ?? [])
        .find(p => !used.has(p[0].id) && !picked.includes(p));
      if (!pair) { ok = false; break; }
      picked.push(pair);
    }
    if (!ok || picked.length < 2) continue;
    picked.sort((a, b) => getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx));
    const chain = { pairs: picked };
    chains.push(chain);
    picked.forEach((pair, index) => {
      used.add(pair[0].id);
      used.add(pair[1].id);
      chainIndex.set(pair[0].id, { chain, index });
    });
  }

  const standalone = allPairs.filter(p => !used.has(p[0].id));
  return { standalone, chains, chainIndex };
}

export type PairSplitMode = 'add' | 'avoid' | 'open' | 'full';

function splitPointOrder(rank: number): number {
  if (rank === Rank.Ten) return 0;
  if (rank === Rank.King) return 1;
  if (rank === Rank.Five) return 2;
  return 3;
}

function minPairByRank(pairs: Card[][], ctx: AIContext): Card[] {
  return pairs.reduce((best, pair) =>
    getEffectiveRank(pair[0], ctx) < getEffectiveRank(best[0], ctx) ? pair : best);
}

function pickPointPair(pairs: Card[][], ctx: AIContext): Card[] {
  return pairs.slice().sort((a, b) => {
    const ap = splitPointOrder(a[0].rank);
    const bp = splitPointOrder(b[0].rank);
    if (ap !== bp) return ap - bp;
    return getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx);
  })[0];
}

/**
 * Pick one pair from a pool that must be taken out of a tractor.
 *
 * `candidates` may be restricted by the caller (e.g. only pairs that can
 * beat the current best); `cards` is the remaining lead-suit pool used to
 * recover chain structure. Returns null when no candidate belongs to a
 * tractor (the caller falls back to its normal pair order).
 *
 * Follow-side point order is 10 > K > 5 (opposite of the lead side).
 * Structure priority: longer tractors first; when no point edge is present,
 * prefer the shortest long tractor, then its smallest edge. Two-pair
 * tractors are split only when no longer tractor can supply the pair.
 */
export function pickTractorSplitPair(
  candidates: Card[][],
  cards: Card[],
  ctx: AIContext,
  mode: PairSplitMode,
): Card[] | null {
  if (candidates.length === 0) return null;
  const structure = analyzePairStructure(cards, ctx);
  const candidateIds = new Set(candidates.map(p => p[0].id));
  const tractorPairs = candidates.filter(p => structure.chainIndex.has(p[0].id));
  if (tractorPairs.length === 0) return null;

  const chainInfo = structure.chains.map(chain => {
    const edges = chain.pairs.length >= 2
      ? [chain.pairs[0], chain.pairs[chain.pairs.length - 1]]
        .filter(p => candidateIds.has(p[0].id))
      : [];
    const available = chain.pairs.filter(p => candidateIds.has(p[0].id));
    return { length: chain.pairs.length, edges, available };
  });
  const long = chainInfo.filter(c => c.length > 2);
  const short = chainInfo.filter(c => c.length === 2);
  const allEdges = [...long, ...short].flatMap(c => c.edges);

  if (mode === 'full') {
    // Full add-points: ignore structure, take the point pair by 10 > K > 5.
    const points = tractorPairs.filter(p => isPointRank(p[0].rank));
    if (points.length > 0) return pickPointPair(points, ctx);
    return pickTractorSplitPair(candidates, cards, ctx, 'add');
  }

  if (mode === 'add') {
    const longEdges = long.flatMap(c => c.edges);
    const pointLongEdges = longEdges.filter(p => isPointRank(p[0].rank));
    if (pointLongEdges.length > 0) return pickPointPair(pointLongEdges, ctx);
    const longWithEdges = long.filter(c => c.edges.length > 0);
    if (longWithEdges.length > 0) {
      const minLen = Math.min(...longWithEdges.map(c => c.length));
      const pool = longWithEdges.filter(c => c.length === minLen).flatMap(c => c.edges);
      return minPairByRank(pool, ctx);
    }
    const shortEdges = short.flatMap(c => c.edges);
    if (shortEdges.length > 0) {
      const points = shortEdges.filter(p => isPointRank(p[0].rank));
      if (points.length > 0) return pickPointPair(points, ctx);
      const nonPoints = shortEdges.filter(p => !isPointRank(p[0].rank));
      return minPairByRank(nonPoints.length > 0 ? nonPoints : shortEdges, ctx);
    }
    return minPairByRank(tractorPairs, ctx);
  }

  if (mode === 'avoid') {
    const longEdges = long.flatMap(c => c.edges);
    const longNonPointEdges = longEdges.filter(p => !isPointRank(p[0].rank));
    if (longNonPointEdges.length > 0) {
      const minLen = Math.min(...long
        .filter(c => c.edges.some(p => !isPointRank(p[0].rank)))
        .map(c => c.length));
      const pool = long
        .filter(c => c.length === minLen)
        .flatMap(c => c.edges)
        .filter(p => !isPointRank(p[0].rank));
      return minPairByRank(pool, ctx);
    }
    const shortNonPoints = short
      .flatMap(c => c.edges)
      .filter(p => !isPointRank(p[0].rank));
    if (shortNonPoints.length > 0) return minPairByRank(shortNonPoints, ctx);
    // Only a single long tractor with point edges left: break its middle and
    // take the smallest non-point pair (e.g. KKJJ1010 with level Q → JJ).
    const longNonPoints = long
      .flatMap(c => c.available)
      .filter(p => !isPointRank(p[0].rank));
    if (longNonPoints.length > 0) return minPairByRank(longNonPoints, ctx);
    const nonPoints = tractorPairs.filter(p => !isPointRank(p[0].rank));
    return minPairByRank(nonPoints.length > 0 ? nonPoints : tractorPairs, ctx);
  }

  // open: second position with <=15 cards — points and non-points are equal.
  const longEdges = long.flatMap(c => c.edges);
  if (longEdges.length > 0) {
    const minLen = Math.min(...long.filter(c => c.edges.length > 0).map(c => c.length));
    const pool = long
      .filter(c => c.length === minLen)
      .flatMap(c => c.edges);
    return minPairByRank(pool, ctx);
  }
  if (allEdges.length > 0) return minPairByRank(allEdges, ctx);
  return minPairByRank(tractorPairs, ctx);
}

// ---- Discard / Pad helpers ----

export function discardNonTrump(
  hand: Card[],
  leadLen: number,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
  leadCombo?: ComboClass,
): { cards: Card[]; reason: string } {
  const combo = leadCombo || { type: 'single' as const, cards: [], length: leadLen, pairCount: 0, tractors: [], hasTractor: false };
  // 垫牌类别：第二家按手牌数避分；第三/四家队友大加分，否则避分
  const mode: DiscardMode = position === 'second'
    ? (secondShouldAvoid(hand) ? 'avoid' : 'open')
    : (tmWin && canAddPoints(tmWin, position, combo, ctx))
      ? ((ctx.isAttacker && attackerNearThreshold(ctx)) ? 'full' : 'add')
      : 'avoid';
  const cards = selectFillers(hand, leadLen, ctx, mode,
    { allowBreakPair: shouldBreakPairForPoints(ctx, combo) });
  const addPt = tmWin && canAddPoints(tmWin, position, combo, ctx);
  // 第四家恒标注：不加分时（avoid）标注避分；第二/三家保持原样。
  // 本函数内 mode 仅来自上方三元（avoid/open/add/full），不产生 forbid。
  const intent = addPt ? 'add'
    : (position === 'fourth' && mode === 'avoid') ? 'avoid' : 'none';
  // 垫出的全是主牌（缺门不能毙、手牌全主）→ 垫主牌（与 finishTeammateWin 一致）
  const baseReason = cards.every(c => isTrump(c, ctx)) ? '垫主牌' : '垫牌';
  const reason = annotateReason(baseReason, cards, [], [],
    combo, leadLen, ctx, position, tmWin, false, intent);
  return { cards, reason };
}

export function padWithDiscards(
  hand: Card[],
  myTrump: Card[],
  leadLen: number,
  ctx: AIContext,
  tmWin: boolean,
  position: string,
  leadCombo: ComboClass,
): { cards: Card[]; reason: string } {
  const nonTrump = hand.filter(c => !isTrump(c, ctx));
  const shouldAvoid = ((position === 'fourth' && !tmWin)
    || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx))
    || (position === 'third' && !tmWin)) && !attackerNearThreshold(ctx);
  nonTrump.sort(discardSort(!shouldAvoid && !!tmWin, ctx));
  const cards = [...myTrump, ...nonTrump].slice(0, leadLen);
  const addPts = !shouldAvoid && canAddPoints(tmWin, position, leadCombo, ctx);
  const intent = shouldAvoid ? 'avoid' : (addPts ? 'add' : 'none');
  const reason = annotateReason('主牌不够，垫副牌', cards, myTrump, myTrump,
    leadCombo, leadLen, ctx, position, tmWin, false, intent);
  return { cards, reason };
}

// ---- Point-adding strategy ----

/** 与位置无关的禁分档：庄家方（`!isAttacker`）下，闲家分已接近或正踩台阶时，
 *  即使领出本身可加分也不加——再加 5/10 分可能把闲家直接送过 80。
 *  两档：① 闲家 75–79（5 分即可跨线）；② 闲家得分 + 本墩已出分 = 70 或 75。 */
export function addPointsForbidden(ctx: AIContext, leadCombo: ComboClass): boolean {
  if (!ctx.isAttacker && ctx.attackerPoints >= 75 && ctx.attackerPoints < 80) return true;
  if (!ctx.isAttacker) {
    const vis = visibleTrickPoints(ctx, leadCombo.cards);
    if (ctx.attackerPoints + vis === 70 || ctx.attackerPoints + vis === 75) return true;
  }
  return false;
}

/**
 * 第三家出牌时已落在台面上的主牌张数（已完成各墩 + 本墩前两家的出牌）。
 * 第三家视角下完全可观测，也是「第四家还能不能毙」最直接的代理量。
 */
function playedTrumps(ctx: AIContext): number {
  const seen = [
    ...ctx.trickHistory.flatMap(t => t.plays.flatMap(p => p.cards)),
    ...ctx.trickPlays.flatMap(p => p.cards),
  ];
  return seen.filter(c => isTrump(c, ctx)).length;
}

/** Whether we should add points when teammate is winning.
 *  Fourth: always.
 *  Third: only if lead is max pattern — big card (A/K single or pair),
 *         has tractor, or is a throw. An off-suit throw can never be beaten
 *         in-suit, because the engine validates every throw lead and
 *         force-plays a downgraded sub-pattern when it would be beaten
 *         (game/index.ts), so a throw counts as max when it contains a top
 *         card and — in NT — otherwise too, unless the fourth seat is very
 *         likely to trump it (see the throw branch).
 *  Never adds if defender team and any point card would push attacker to 80+.
 *  分位置规格：甩副牌含顶张、或（无主下）第四家真毙率过半的形状 → 加分；甩主牌加分；
 *  庄家方且闲家得分 + 本墩已出分为 70 或 75 时禁分。 */
export function canAddPoints(tmWin: boolean, position: string, leadCombo: ComboClass, ctx: AIContext): boolean {
  if (!tmWin) return false;
  if (addPointsForbidden(ctx, leadCombo)) return false;
  if (position === 'fourth') return true;
  if (position === 'third') {
    // 0a/0b 领出：上一墩已验对手该花色对子已绝（0b）或三家整门已绝（0a），
    // 花色内无法被盖；仍可能被毙，按规格接受该风险 → 加分
    // （不得盖过队友，见 avoidBeatingTeammate）。
    if (detectTeammateSafeLead(ctx, leadCombo) !== null) return true;
    const isTrumpLead = leadCombo.cards.every(c => isTrump(c, ctx));
    if (isTrumpLead) {
      if (leadCombo.type === 'throw') return true; // 甩主牌 → 加分
      return isTrumpMax(leadCombo, ctx);
    }
    if (leadCombo.hasTractor) return true;
    if (leadCombo.type === 'throw') {
      // 甩副牌：含顶张 → 加分（含拖拉机已在 hasTractor 分支提前返回）
      if (leadCombo.cards.some(c => isBigOffSuitCard(c, ctx))) return true;
      // 唯一剩下的风险是「第四家缺门用主牌毙」。
      // 只有无主（有记牌器）时生效：有主局 ntState 为 null，行为完全不变（一律不加分）。
      if (ctx.ntState === null || ctx.myIndex < 0) return false;
      // 记牌器判**毙不了** → 放心加分（原有行为，不变）。
      if (!canPlayerTrumpThrow((ctx.myIndex + 1) % 4, leadCombo.cards, ctx.ntState, ctx)) return true;
      // 记牌器判**能毙**：不再因此不加分。加 K 分的 EV = K(1−2p)（本墩归我队 +K，
      // 被第四家毙 −K），p < 1/2 就该加——而 `canPlayerTrumpThrow` 是刻意保守的上界
      // （证不出凑不出就回 true），它说「能毙」只有约 48% 兑现（有实力率 53.0% → 30.6%，
      // 意愿率恒 86–93%），按它不加分会把该加的分大面积放过。
      // 真正该不加的只有真毙率过半的格：0对2张 / 0对3张 且 台面上主牌 ≤4 张
      // （实测 85.2% / 67.8%）；其余形状与阶段全部低于一半（0对4张 40.6%、1对3张 34.9%…）。
      return !(playedTrumps(ctx) <= 4 && leadCombo.pairCount === 0
        && (leadCombo.length === 2 || leadCombo.length === 3));
    }
    if (leadCombo.type === 'single' || leadCombo.type === 'pair') {
      return leadCombo.cards.every(c => isBigOffSuitCard(c, ctx));
    }
  }
  return false;
}

// ---- Pattern evaluation ----

/** Whether the lead combo is a max pattern — big card, tractor, or throw.
 *  Second position should avoid points when following such a lead. */
export function isMaxPattern(leadCombo: ComboClass, ctx: AIContext): boolean {
  if (leadCombo.hasTractor) return true;
  if (leadCombo.type === 'throw') return true;
  if (leadCombo.type === 'single' || leadCombo.type === 'pair') {
    const isTrumpLead = leadCombo.cards.every(c => isTrump(c, ctx));
    if (isTrumpLead) return isTrumpMax(leadCombo, ctx);
    if (leadCombo.type === 'single') return isBigOffSuitCard(leadCombo.cards[0], ctx);
    return leadCombo.cards.every(c => isBigOffSuitCard(c, ctx));
  }
  return false;
}

export function isTrumpMax(leadCombo: ComboClass, ctx: AIContext): boolean {
  if (leadCombo.cards.some(c => c.rank === Rank.BigJoker)) return true;
  if (leadCombo.cards.length === 2 && leadCombo.cards[0].rank === Rank.SmallJoker) {
    return sideHasBigJoker(ctx);
  }
  return false;
}

export function sideHasBigJoker(ctx: AIContext): boolean {
  if (ctx.myIndex < 0) return false;
  if (ctx.ntState) {
    const opponents = [0, 1, 2, 3].filter(p => p % 2 !== ctx.myIndex % 2);
    if (opponents.every(p => !ctx.ntState!.canHaveBigJoker[p])) return true;
    if (ctx.ntState!.allUnseenBigJokersOnOurSide) return true;
    return false;
  }
  const ourTeam = new Set([ctx.myIndex, (ctx.myIndex + 2) % 4]);
  for (const trick of ctx.trickHistory) {
    for (let pi = 0; pi < 4; pi++) {
      if (!ourTeam.has(pi)) continue;
      for (const c of playOf(trick, pi).cards) {
        if (c.rank === Rank.BigJoker) return true;
      }
    }
  }
  // Reveal objects don't carry individual card data — we can only check
  // played cards in trick history for Big Joker sightings.
  return false;
}

// ---- Threshold helpers ----

/** Whether the attacker should override shouldAvoid to cross a 40-point
 *  scoring threshold (40, 80, 120). Returns true when attackerPoints
 *  (加上本墩已出分 visiblePts) are within 10 points of the next threshold
 *  and adding any points would cross it. */
export function attackerNearThreshold(ctx: AIContext, visiblePts = 0): boolean {
  if (!ctx.isAttacker) return false;
  const pts = ctx.attackerPoints + visiblePts;
  const next = Math.floor(pts / 40) * 40 + 40;
  return next - pts <= 10;
}

/** 40 分一档的台阶序号。 */
export function attackerTier(points: number): number {
  return Math.floor(points / 40);
}

function cardPointsOf(cards: Card[]): number {
  return cards.reduce((sum, c) => sum + cardPointsFromRank(c.rank), 0);
}

/**
 * 本墩在出候选牌之前已经落下的分数。
 *
 * 有完整 `trickPlays` 时逐手求和（能算上第三家非最大但带分的牌）；
 * 测试或旧上下文只有 `bestSoFar` 时退化为“领出 + 当前最大”。
 */
function trickPointsBefore(ctx: AIContext, leadCards: Card[]): number {
  if (ctx.trickPlays.length > 0) {
    return ctx.trickPlays.reduce((sum, play) => sum + cardPointsOf(play.cards), 0);
  }
  let points = cardPointsOf(leadCards);
  const best = ctx.bestSoFar;
  if (best && best.cards.length > 0 && best.playerIndex !== ctx.leadPlayerIndex) {
    points += cardPointsOf(best.cards);
  }
  return points;
}

/** 赢下本墩后闲家的总分（含候选牌）。 */
export function attackerScoreAfterTrick(
  ctx: AIContext, leadCards: Card[], candidate: Card[],
): number {
  return ctx.attackerPoints + trickPointsBefore(ctx, leadCards) + cardPointsOf(candidate);
}

// ---- Tractor matching ----

export function tryMatchTractorSlots(
  leadCombo: ComboClass,
  myTractors: Card[][],
  cardPool: Card[],
  leadLen: number,
  ctx: AIContext,
  pointsStrategy?: 'add' | 'avoid',
): Card[] | null {
  const picked: Card[] = [];
  const usedIds = new Set<string>();

  for (const req of leadCombo.tractors.map(t => t.pairCount)) {
    const available = myTractors.filter(t =>
      t.every(c => !usedIds.has(c.id)) && t.length / 2 >= req,
    );
    if (available.length === 0) {
      // 无 ≥req 的拖拉机：降级取最长的可用拖拉机（与 computeIdealFollow
      // 的 closest-shorter 一致，validateFollow 接受更短拖拉机 + 对子填充；
      // 拆开拖拉机成对子不合法）。手牌无可用拖拉机则跳过该需求。
      const shorter = myTractors
        .filter(t => t.every(c => !usedIds.has(c.id)))
        .sort((a, b) => b.length - a.length);
      if (shorter.length === 0) continue;
      const sel = shorter[0];
      picked.push(...sel);
      sel.forEach(c => usedIds.add(c.id));
      continue;
    }
    if (available.length > 0) {
      available.sort((a, b) => {
        if (pointsStrategy === 'add') {
          const aPts = a.some(c => isPointRank(c.rank)) ? 0 : 100;
          const bPts = b.some(c => isPointRank(c.rank)) ? 0 : 100;
          if (aPts !== bPts) return aPts - bPts;
        } else if (pointsStrategy === 'avoid') {
          const aPts = a.some(c => isPointRank(c.rank)) ? 100 : 0;
          const bPts = b.some(c => isPointRank(c.rank)) ? 100 : 0;
          if (aPts !== bPts) return aPts - bPts;
        }
        return (a.length / 2) - (b.length / 2);
      });
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
  const need = leadLen - picked.length - fill.length;
  if (need > 0) fill.push(...restSingles.slice(0, need));

  return [...picked, ...fill];
}
