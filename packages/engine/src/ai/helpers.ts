/**
 * Shared AI strategy helpers — tactical utilities used by both trump-follow
 * and off-suit-follow modules for pattern evaluation, point management,
 * and card selection.
 */
import type { Card, ComboClass } from '../types.js';
import { Rank, isPointRank } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { findAllPairs, detectTractors } from '../pattern/index.js';
import type { AIContext } from './types.js';
import { isBigOffSuitCard, discardSort, pairSortAsc } from './utils.js';
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

/** Whether we should add points when teammate is winning.
 *  Fourth: always.
 *  Third: only if lead is max pattern — big card (A/K single or pair),
 *         has tractor, or is a throw (甩牌 already max).
 *  Never adds if defender team and any point card would push attacker to 80+.
 *  分位置规格：甩副牌只有含顶张才加分；甩主牌加分；庄家方且闲家得分 +
 *  本墩已出分为 70 或 75 时禁分。 */
export function canAddPoints(tmWin: boolean, position: string, leadCombo: ComboClass, ctx: AIContext): boolean {
  if (!tmWin) return false;
  // Defender side: never add if attacker is close to 80 (even 5 pts could cross).
  if (!ctx.isAttacker && ctx.attackerPoints >= 75 && ctx.attackerPoints < 80) return false;
  // 第三家原则9：庄家方且闲家得分 + 本墩已出分 = 70 或 75 时禁分。
  if (!ctx.isAttacker) {
    const vis = visibleTrickPoints(ctx, leadCombo.cards);
    if (ctx.attackerPoints + vis === 70 || ctx.attackerPoints + vis === 75) return false;
  }
  if (position === 'fourth') return true;
  if (position === 'third') {
    const isTrumpLead = leadCombo.cards.every(c => isTrump(c, ctx));
    if (isTrumpLead) {
      if (leadCombo.type === 'throw') return true; // 甩主牌 → 加分
      return isTrumpMax(leadCombo, ctx);
    }
    if (leadCombo.hasTractor) return true;
    if (leadCombo.type === 'throw') {
      // 甩副牌：含顶张才加分（含拖拉机已在 hasTractor 分支提前返回）
      return leadCombo.cards.some(c => isBigOffSuitCard(c, ctx));
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
      for (const c of trick.plays[pi].cards) {
        if (c.rank === Rank.BigJoker && ourTeam.has(pi)) return true;
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
