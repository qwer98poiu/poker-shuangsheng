/**
 * 庄3：NT 长花色（仅庄家方）。
 *
 * 长花色由 `suit-memory.ts` 按初始手牌认定，运行时用当前手牌计算 T1：
 *
 *   - T1 是拖拉机或甩牌 → 整段 T1 出掉（过长花色闸门）；
 *   - T1 是单张或对子、且该门还有更多牌 → **等待**：本墩不出这门；
 *   - T1 为空 → null。
 *
 * 24 张反推归庄1（`drain.ts`），本层不再处理“整门已绝全出”；非长花色的断门/
 * 拖拉机也不在这里，交给庄1/庄4 与通用档。等待只影响本层：庄1/庄2/庄4 不人为
 * 跳过，通用 5–12 照常兜底。
 *
 * 长花色闸门严格：混合甩牌里的拖拉机也过 `validateThrow` 的最坏情况校验。
 */
import type { Card, Suit } from '../types.js';
import { isTrump } from '../model.js';
import { getEffectiveRank } from '../model.js';
import { classify as classifyCombo } from '../pattern/index.js';
import { extractComponents } from '../comparing/index.js';
import { validateThrow } from '../leading/index.js';
import type { AIContext } from './types.js';
import { maxCardT } from './utils.js';
import { worstCaseSuitHand } from './throw-detector.js';
import { computeLongSuitMemory, knownOutOfPlay, type LongSuitMemory } from './suit-memory.js';

interface Proposal { cards: Card[]; reason: string }

/** Non-trump cards of one suit. */
function cardsOfSuit(cards: readonly Card[], suit: Suit, ctx: AIContext): Card[] {
  return cards.filter(c => c.suit === suit && !isTrump(c, ctx));
}

/** Is this sub-pattern unbeatable even when every unknown card sits in one hand? */
function isSafeComponent(
  component: Card[], hand: Card[], suitCards: Card[], suit: Suit, ctx: AIContext,
  exclude: readonly Card[],
): boolean {
  const worst = worstCaseSuitHand(suitCards, suit, ctx, exclude);
  return validateThrow(component, hand, [worst], ctx).valid;
}

/** 长花色闸门：拖拉机不再豁免，混合甩牌里含拖拉机时也要过最坏情况校验。 */
function gateWithTractors(
  proposal: Card[], hand: Card[], suit: Suit, ctx: AIContext,
  exclude: readonly Card[],
): Card[] {
  const suitCards = cardsOfSuit(hand, suit, ctx);
  const comps = extractComponents(proposal, ctx);
  const out: Card[] = [];
  for (const t of comps.tractors) {
    if (isSafeComponent(t, hand, suitCards, suit, ctx, exclude)) out.push(...t);
  }
  for (const p of comps.pairs) {
    if (isSafeComponent(p, hand, suitCards, suit, ctx, exclude)) out.push(...p);
  }
  for (const s of comps.singles) {
    if (isSafeComponent([s], hand, suitCards, suit, ctx, exclude)) out.push(s);
  }
  return out;
}

/** 整手在 worst case 下是否合法。 */
function safeAsWhole(
  cards: Card[], hand: Card[], suit: Suit, ctx: AIContext, exclude: readonly Card[],
): boolean {
  const suitCards = cardsOfSuit(hand, suit, ctx);
  const worst = worstCaseSuitHand(suitCards, suit, ctx, exclude);
  return validateThrow(cards, hand, [worst], ctx).valid;
}

/** 丢掉价值最低的一个成分，把「逐个成分都判过、拼起来却不合法」的一手缩到合法。 */
function dropWeakestComponent(cards: Card[], ctx: AIContext): Card[] | null {
  const comps = extractComponents(cards, ctx);
  const rankOf = (comp: Card[]): number => getEffectiveRank(maxCardT(comp, ctx), ctx);
  const drop = (comp: Card[]): Card[] => {
    const ids = new Set(comp.map(c => c.id));
    return cards.filter(c => !ids.has(c.id));
  };
  if (comps.singles.length > 0) {
    return drop([[...comps.singles].sort((a, b) => rankOf([a]) - rankOf([b]))[0]]);
  }
  if (comps.pairs.length > 0) {
    return drop([...comps.pairs].sort((a, b) => rankOf(a) - rankOf(b))[0]);
  }
  if (comps.tractors.length > 0) {
    return drop([...comps.tractors]
      .sort((a, b) => a.length - b.length || rankOf(a) - rankOf(b))[0]);
  }
  return null;
}

/** 长花色闸门：拼起来仍非法时逐个丢成分，直到整手合法或为空。 */
function applyGate(
  proposal: Card[], hand: Card[], suit: Suit, ctx: AIContext,
  exclude: readonly Card[],
): Card[] {
  if (classifyCombo(proposal, ctx).type !== 'throw') return proposal;

  let out = gateWithTractors(proposal, hand, suit, ctx, exclude);
  for (let guard = 0; guard <= proposal.length && out.length > 0; guard++) {
    if (classifyCombo(out, ctx).type !== 'throw') break;
    if (safeAsWhole(out, hand, suit, ctx, exclude)) break;
    const next = dropWeakestComponent(out, ctx);
    if (next === null) return [];
    out = next;
  }
  return out;
}

/** T1 的出牌选择：单张/对子等待，拖拉机/甩牌整段出。 */
function tryLongSuitT1(
  handSuit: Card[], memory: LongSuitMemory, ctx: AIContext, hand: Card[],
): Proposal | null {
  const t1 = memory.tier1;
  if (t1.length === 0) return null;

  // 只剩一张单牌或一对时，全口径停用长花色（调用侧会在后续步骤把 longSuit 置空）；
  // 这里先按“等待”处理，避免把 T1 的单/对当作长花色应甩尽甩。
  const combo = classifyCombo(t1, ctx);
  if (combo.type === 'single' || combo.type === 'pair') return null;

  const exclude = knownOutOfPlay(ctx, memory.suit);
  const gated = applyGate(t1, hand, memory.suit, ctx, exclude);
  if (gated.length === 0) return null;

  return {
    cards: gated,
    reason: `长花色控制张(${gated.length}张)`,
  };
}

/**
 * 庄3 入口。`longSuit` 由调用方算好传入（与 0b 的 skipSuit 共用）。
 * 没有长花色、长花色已空或 T1 单/对等待时返回 null，交回后续档位。
 */
export function tryNTLead(hand: Card[], ctx: AIContext, longSuit: Suit): Proposal | null {
  if (ctx.trumpSuit !== null) return null;
  if (ctx.myIndex < 0 || hand.length === 0) return null;
  if (!ctx.isDeclarer && !ctx.isDeclarerPartner) return null; // 庄3 仅庄家方

  const memory = computeLongSuitMemory(hand, ctx);
  if (!memory) return null;

  const handSuit = cardsOfSuit(hand, longSuit, ctx);
  if (handSuit.length === 0) return null;

  return tryLongSuitT1(handSuit, memory, ctx, hand);
}
