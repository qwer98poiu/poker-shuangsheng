/**
 * 闲家阶梯 1–3。
 *
 *   闲1  拖拉机 / 含拖拉机的副牌牌型
 *        键：拖拉机对数多 > 出完能断门 > 总张数多；
 *        纯拖拉机同对数：能直接断门的副拖拉机先于主拖拉机，再按最小对大的；
 *        含拖拉机甩牌的闸门只放宽拖拉机成分，非拖拉机成分仍严格。
 *   闲2  含顶张的副牌牌型（顶张单/对/不含拖拉机的甩牌）
 *        键：出完能断门 > 总张数多。顶张静态。
 *   闲3  兜底：断门 + 长花色非断门可甩牌；3 类张数多，4 类对数多，
 *        其他类 safe > 形状 > 对数 > 张数。直接断门小单张不再入候选：
 *        10-18 实测它抢在通用 5/7/8 之前是净负，改由通用梯子兜底。
 *
 * 0a/0b 在更前面；闲家没有庄3/庄4，也没有长花色等待。长花色只影响动态顶张
 * （`topRankForSuit`）、`knownOutOfPlay` 排除集和 0b skip。
 */
import type { Card, Suit } from '../types.js';
import { SUIT_ORDER } from '../types.js';
import { isTrump } from '../model.js';
import { classify, detectTractors } from '../pattern/index.js';
import { validateThrow } from '../leading/index.js';
import type { AIContext } from './types.js';
import { suitLabelCn, getTopOffSuitRank } from './utils.js';
import { rankLabelStr } from './reason.js';
import { worstCaseSuitHand, findThrowableSuitCards } from './throw-detector.js';
import { knownOutOfPlay } from './suit-memory.js';
import { beatsSafely, topRankForSuit } from './drain.js';

interface Proposal { cards: Card[]; reason: string }

interface Candidate {
  readonly cards: Card[];
  readonly keys: readonly number[];
  readonly reason: string;
}

function cardsOfSuit(cards: readonly Card[], suit: Suit, ctx: AIContext): Card[] {
  return cards.filter(c => c.suit === suit && !isTrump(c, ctx));
}

function excludeFor(suit: Suit, ctx: AIContext, longSuit: Suit | null): readonly Card[] {
  return longSuit !== null && suit === longSuit ? knownOutOfPlay(ctx, suit) : [];
}

/** SHCD 权重：♠ > ♥ > ♣ > ♦；主牌候选不参与花色序。 */
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

/**
 * 闲1 的放宽甩牌：所有拖拉机成分无条件保留（接受可能被更大拖拉机盖过的风险），
 * 非拖拉机成分只保留最坏情况下仍安全的那些。
 */
function relaxedTractorThrow(
  cards: Card[], suit: Suit, ctx: AIContext, exclude: readonly Card[],
): Card[] | null {
  const tractors = detectTractors(cards, ctx);
  if (tractors.length === 0) return null;

  const safe = findThrowableSuitCards(cards, suit, ctx, exclude);
  const out: Card[] = [];
  const ids = new Set<string>();
  const add = (c: Card): void => {
    if (ids.has(c.id)) return;
    ids.add(c.id);
    out.push(c);
  };
  safe.forEach(add);
  for (const t of tractors) t.forEach(add);

  if (out.length < 4) return null;
  const combo = classify(out, ctx);
  return combo.hasTractor ? out : null;
}

/** 闲1：拖拉机 / 含拖拉机的副牌牌型（含主拖拉机）。 */
export function tryAttackerTractor(
  hand: Card[], ctx: AIContext, longSuit: Suit | null,
): Proposal | null {
  const candidates: Candidate[] = [];

  // (a) 纯拖拉机（含主拖拉机）。十字/跨组拖拉机不属于“同门纯拖拉机”，跳过。
  for (const t of detectTractors(hand, ctx)) {
    const allTrump = t.every(c => isTrump(c, ctx));
    const sameSuit = t.every(c => c.suit === t[0].suit);
    if (!allTrump && !sameSuit) continue;

    const offSuit = !allTrump;
    const suitCards = offSuit ? cardsOfSuit(hand, t[0].suit as Suit, ctx) : [];
    const drains = offSuit && suitCards.length === t.length;
    const pairs = t.length / 2;
    const minRank = Math.min(...t.map(c => c.rank));
    candidates.push({
      cards: t,
      keys: [
        pairs,
        drains ? 1 : 0,
        t.length,
        offSuit ? 1 : 0,
        minRank,
        offSuit ? suitWeight(t[0].suit as Suit) : 0,
      ],
      reason: allTrump
        ? `出主拖拉机(${pairs}对)`
        : `出${suitLabelCn(t[0].suit)}拖拉机(${pairs}对)`,
    });
  }

  // (b) 含拖拉机的副牌甩牌；拖拉机成分放宽，其余成分严格。
  for (const suit of SUIT_ORDER) {
    const cards = cardsOfSuit(hand, suit, ctx);
    if (cards.length < 4) continue;
    const exclude = excludeFor(suit, ctx, longSuit);
    const chosen = relaxedTractorThrow(cards, suit, ctx, exclude);
    if (chosen === null) continue;
    const combo = classify(chosen, ctx);
    if (combo.type !== 'throw') continue;

    const pairs = combo.tractors.reduce((s, t) => s + t.pairCount, 0);
    const drains = chosen.length === cards.length;
    candidates.push({
      cards: chosen,
      keys: [pairs, drains ? 1 : 0, chosen.length, 1, 0, suitWeight(suit)],
      reason: `甩${suitLabelCn(suit)}副牌(${chosen.length}张)`,
    });
  }

  return pick(candidates);
}

/** 闲2：含顶张的副牌牌型（静态顶张，不含拖拉机甩牌）。 */
export function tryAttackerTop(
  hand: Card[], ctx: AIContext, longSuit: Suit | null,
): Proposal | null {
  const candidates: Candidate[] = [];

  for (const suit of SUIT_ORDER) {
    const cards = cardsOfSuit(hand, suit, ctx);
    if (cards.length === 0) continue;
    const top = getTopOffSuitRank(suit, ctx);
    const topCards = cards.filter(c => c.rank === top);
    if (topCards.length === 0) continue;

    // 不拆拖拉机：顶张若在拖拉机里，交给闲1。
    const tractorIds = new Set(detectTractors(cards, ctx).flat().map(c => c.id));
    const freeTops = topCards.filter(c => !tractorIds.has(c.id));
    if (freeTops.length === 0) continue;

    const exclude = excludeFor(suit, ctx, longSuit);
    const throwable = findThrowableSuitCards(cards, suit, ctx, exclude);
    const combo = classify(throwable, ctx);
    let chosen: Card[] | null = null;
    if (throwable.length > 0 && throwable.some(c => c.rank === top)
        && combo.type === 'throw' && !combo.hasTractor) {
      const worst = worstCaseSuitHand(cards, suit, ctx, exclude);
      if (validateThrow(throwable, hand, [worst], ctx).valid) chosen = throwable;
    }

    if (chosen === null && topCards.length >= 2 && freeTops.length >= 2) {
      chosen = [freeTops[0], freeTops[1]];
    }
    if (chosen === null && topCards.length === 1) {
      chosen = [freeTops[0]];
    }
    if (chosen === null) continue;

    candidates.push({
      cards: chosen,
      keys: [
        chosen.length === cards.length ? 1 : 0,
        chosen.length,
        suitWeight(suit),
      ],
      reason: classify(chosen, ctx).type === 'throw'
        ? `甩${suitLabelCn(suit)}副牌(${chosen.length}张)`
        : classify(chosen, ctx).type === 'pair'
          ? `出${suitLabelCn(suit)}${rankLabelStr(top)}对`
          : `出${suitLabelCn(suit)}${rankLabelStr(top)}`,
    });
  }

  return pick(candidates);
}

/** 闲3 的形状层：≥3 张甩牌 > 断门对 > 两单张甩牌 > 断门单 > 长花色单/对。 */
function shapeScore(cards: Card[], pairCount: number, drains: boolean): number {
  if (cards.length >= 3) return 10;
  if (drains) return pairCount >= 1 ? 8 : (cards.length === 2 ? 7 : 4);
  return cards.length === 2 ? 6 : 2;
}

function totalPairCount(combo: ReturnType<typeof classify>): number {
  return combo.pairCount + combo.tractors.reduce((s, t) => s + t.pairCount, 0);
}

/** 闲3：断门 + 长花色非断门可甩牌。 */
export function tryAttackerDrain(
  hand: Card[], ctx: AIContext, longSuit: Suit | null,
): Proposal | null {
  interface DrainCand extends Candidate { cls: 3 | 4 | 0 }
  const candidates: DrainCand[] = [];

  for (const suit of SUIT_ORDER) {
    const cards = cardsOfSuit(hand, suit, ctx);
    if (cards.length === 0) continue;
    const isLong = longSuit !== null && suit === longSuit;
    const exclude = isLong ? knownOutOfPlay(ctx, suit) : [];
    const combo = classify(cards, ctx);

    if (combo.type === 'throw') {
      const worst = worstCaseSuitHand(cards, suit, ctx, exclude);
      if (!validateThrow(cards, hand, [worst], ctx).valid) continue;
    }

    const top = topRankForSuit(suit, ctx, longSuit);
    const hasTop = cards.some(c => c.rank === top);
    const cls: 3 | 4 | 0 = hasTop ? 3 : combo.hasTractor ? 4 : 0;
    // 直接断门小单张不再入候选：它会把通用 5/7/8 的成组牌抢先压掉。
    if (cls === 0 && cards.length === 1) continue;
    const pairs = totalPairCount(combo);
    const tractorPairs = combo.tractors.reduce((s, t) => s + t.pairCount, 0);
    const safe = cls === 0 && beatsSafely(cards, ctx);
    const shape = shapeScore(cards, pairs, true);
    const keys = cls === 3
      ? [cards.length, suitWeight(suit)]
      : cls === 4
        ? [tractorPairs, cards.length, suitWeight(suit)]
        : [safe ? 1 : 0, shape, pairs, cards.length, suitWeight(suit)];

    candidates.push({
      cards,
      cls,
      keys,
      reason: `断门${suitLabelCn(suit)}(${cards.length}张)`,
    });
  }

  // 长花色那一手非断门可甩牌。
  if (longSuit !== null) {
    const handSuit = cardsOfSuit(hand, longSuit, ctx);
    const cards = findThrowableSuitCards(
      handSuit, longSuit, ctx, knownOutOfPlay(ctx, longSuit),
    );
    if (cards.length > 0 && cards.length < handSuit.length) {
      const combo = classify(cards, ctx);
      if (combo.type === 'throw') {
        const pairs = totalPairCount(combo);
        const safe = beatsSafely(cards, ctx);
        candidates.push({
          cards,
          cls: 0,
          keys: [
            safe ? 1 : 0,
            shapeScore(cards, pairs, false),
            pairs,
            cards.length,
            suitWeight(longSuit),
          ],
          reason: `甩${suitLabelCn(longSuit)}副牌(${cards.length}张)`,
        });
      }
    }
  }

  const CLASS_RANK: Record<3 | 4 | 0, number> = { 3: 2, 4: 1, 0: 0 };
  let best: DrainCand | null = null;
  for (const cand of candidates) {
    if (best === null) {
      best = cand;
      continue;
    }
    if (CLASS_RANK[cand.cls] !== CLASS_RANK[best.cls]) {
      if (CLASS_RANK[cand.cls] > CLASS_RANK[best.cls]) best = cand;
      continue;
    }
    for (let i = 0; i < cand.keys.length; i++) {
      if (cand.keys[i] !== best.keys[i]) {
        if (cand.keys[i] > best.keys[i]) best = cand;
        break;
      }
    }
  }

  return best === null ? null : { cards: best.cards, reason: best.reason };
}
