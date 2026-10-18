/**
 * NT (无主) long-suit lead layer.
 *
 * A player whose holding contains a *long suit* — one suit the bottom strategy
 * deliberately kept out of the bottom (total >= 9, controls >= 6) — leads
 * through this layer instead of the general ladder:
 *
 *   第 2 条   先断门：出一门非长花色，且这一手正好把该门出空（甩/含顶张/
 *             拖拉机/对子/其他单张，按现行牌型优先级取最高档）
 *   第 2.1 条 非长、又断不了门的门里的拖拉机，也在这一档出
 *   第 5 条   应甩尽甩：T1 非空就把整段 T1 甩出去（过了闸门即合法）
 *   第 10 条  庄家整门已绝（已出 + 底牌 + 手牌 = 24）→ 剩下的全部一起打出
 *
 * 记忆与 T1 动态升级（第 4 条）全部由 `suit-memory.ts` 从 `trickHistory`
 * 重建；本文件只做「拟出牌选择」。没有长花色时 `tryNTLead` 直接返回 null，
 * 调用方回落到现行七步阶梯（第 1 条）。
 *
 * Multi-card leads that contain pairs must survive a worst-case check; the
 * engine fines an illegal throw (±10 and a forced down-play), so the check is
 * run through the engine's own `validateThrow` against the worst-case hand
 * rather than reimplemented. The **long-suit** gate checks tractors too: a
 * mixed throw that contains one is still classified `throw`, and
 * `validateThrow` still runs `checkTractorBlock` over it, so exempting
 * tractors let the gate pass hands the engine then fined. The non-long-suit
 * drain path keeps the old exemption — `drainClass` already pre-checks that
 * whole suit with `findThrowableSuitCards`, and does so **statically**: card
 * counting is long-suit only, so nothing outside that suit is judged against
 * anything but the full unseen universe.
 */
import type { Card, Suit } from '../types.js';
import { SUIT_ORDER } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { detectTractors, classify as classifyCombo } from '../pattern/index.js';
import { extractComponents } from '../comparing/index.js';
import { validateThrow } from '../leading/index.js';
import type { AIContext } from './types.js';
import { suitLabelCn, maxCardT, getTopOffSuitRank } from './utils.js';
import { findThrowableSuitCards, worstCaseSuitHand } from './throw-detector.js';
import {
  computeLongSuitMemory, knownOutOfPlay, type LongSuitMemory,
} from './suit-memory.js';

interface Proposal { cards: Card[]; reason: string }

/** Non-trump cards of one suit. */
function cardsOfSuit(cards: readonly Card[], suit: Suit, ctx: AIContext): Card[] {
  return cards.filter(c => c.suit === suit && !isTrump(c, ctx));
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
 * Used by the **non-long-suit** drain path, where tractors stay exempt:
 * `drainClass` already asked `findThrowableSuitCards` to check the whole door,
 * so letting a tractor through here cannot earn a penalty. That is a
 * deliberate fixed boundary — this change only tightens the long suit.
 */
function gateKeepTractors(
  proposal: Card[], hand: Card[], suit: Suit, ctx: AIContext,
  exclude: readonly Card[],
): Card[] {
  const suitCards = cardsOfSuit(hand, suit, ctx);
  const comps = extractComponents(proposal, ctx);
  const out: Card[] = [];
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
 * 长花色闸门：**拖拉机不再豁免**。混合甩牌里含拖拉机时整手 `classify` 就是
 * `'throw'`，引擎的 `checkTractorBlock` 照查不误；闸门过去把拖拉机无条件放行，
 * 于是「闸门放行、引擎照罚」——实测的甩牌 ±10 罚分全部出自这里。
 */
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

/** 整手在 worst case 下是否合法 —— `validateThrow` 按整手判，不能只看单个成分。 */
function safeAsWhole(
  cards: Card[], hand: Card[], suit: Suit, ctx: AIContext, exclude: readonly Card[],
): boolean {
  const suitCards = cardsOfSuit(hand, suit, ctx);
  const worst = worstCaseSuitHand(suitCards, suit, ctx, exclude);
  return validateThrow(cards, hand, [worst], ctx).valid;
}

/**
 * 丢掉价值最低的一个成分（单张 → 对子 → 拖拉机，同类取最小）。用来把「逐个成分
 * 都判过、拼起来却仍不合法」的这一手缩到合法为止。
 */
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

/**
 * Only `throw`-classified leads are validated by the engine, and only they
 * carry the ±10 penalty. Singles, pairs and tractors on their own are always
 * legal (they just lose the trick), so the gate must leave them alone.
 *
 * `checkTractors` is opened only for the long suit. When it is open the
 * assembled hand is re-validated **as a whole**: the `validateThrow` the
 * engine runs is on the whole throw, and concatenating tractors ++ pairs ++
 * singles can re-partition the cards into a structure the per-component
 * checks never saw. If the whole is still illegal, drop the weakest component
 * and retry. Closed, the behaviour is byte-for-byte the pre-change gate.
 */
function applyGate(
  proposal: Card[], hand: Card[], suit: Suit, ctx: AIContext,
  exclude: readonly Card[], checkTractors: boolean,
): Card[] {
  if (classifyCombo(proposal, ctx).type !== 'throw') return proposal;
  if (!checkTractors) return gateKeepTractors(proposal, hand, suit, ctx, exclude);

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

// ---- 第 2 / 2.1 条：非长花色的断门（与断不了门的拖拉机） ----

/** Longest tractor, then highest — control cards should be cashed strongest first. */
function sortTractors(tractors: Card[][], ctx: AIContext): Card[][] {
  return [...tractors].sort((a, b) =>
    b.length - a.length ||
    getEffectiveRank(maxCardT(b, ctx), ctx) - getEffectiveRank(maxCardT(a, ctx), ctx));
}

/**
 * 断门档位：甩(1) > 含顶张(2) > 拖拉机(3) > 对子(4) > 其他单张(6)。
 * 不能一次出空整门时返回 null。`group` 必须是**该门的非主牌**（级牌是常主，由调用方剔除）。
 *
 * 判据一律是**静态**的：不扣已知出局的牌。计数（`knownOutOfPlay`）只用于长花色，
 * 本层是「非长门不记牌」的规格边界——详见 `tryDrainOrTractorNonLong`。
 */
function drainClass(
  group: Card[], suit: Suit, ctx: AIContext,
): number | null {
  if (group.length === 0) return null;
  const combo = classifyCombo(group, ctx);
  // 整门恰为一个牌型（单张 / 一对 / 拖拉机）：打出即断门，不查对手能否盖过。
  // 只有复合甩牌才需要最坏情况分析，且要求整门都盖不过。
  if (combo.type === 'throw') {
    if (findThrowableSuitCards(group, suit, ctx).length !== group.length) return null;
    return 1;
  }
  if (group.some(c => c.rank === getTopOffSuitRank(suit, ctx))) return 2;
  if (combo.type === 'tractor') return 3;
  if (combo.type === 'pair') return 4;
  return 6;
}

/**
 * 第 2 + 2.1 条：在**非长**花色里挑一门出牌——能一次出空整门者优先（按档位），
 * 断不了门的门里的拖拉机同档（档位 3）参选。多门并列取张数更多者。
 *
 * **非长门不记牌**：本层判整门能不能甩、闸门留哪些成分，都用**静态**最坏情况
 * （exclude 为空）。计数只属于长花色——那里的「顶张」是动态的，由该门自己的
 * `knownOutOfPlay` 算出，与此处无关。曾经这里也传该门的已知出局牌（已出牌 +
 * 庄家底牌），那等于把只有长花色才被授权使用的信息用到了非长门上：它不会产生
 * 非法出牌（剔掉的牌确实不在场），只会单向地让更多整门被判成可甩，因而在测试、
 * 罚分与对局统计里都看不出来。撤销后本层完全由静态信息决定。
 */
function tryDrainOrTractorNonLong(
  hand: Card[], ctx: AIContext, longSuit: Suit,
): Proposal | null {
  let best: { cards: Card[]; suit: Suit; cls: number; reason: string } | null = null;

  for (const suit of SUIT_ORDER) {
    if (suit === longSuit) continue;
    const group = cardsOfSuit(hand, suit, ctx);
    if (group.length === 0) continue;

    let candidate: { cards: Card[]; cls: number; reason: string } | null = null;
    const cls = drainClass(group, suit, ctx);
    if (cls !== null) {
      candidate = {
        cards: group,
        cls,
        reason: `断门${suitLabelCn(suit)}(${group.length}张)`,
      };
    } else {
      // 第 2.1 条：断不了门的门里的拖拉机（非主牌）也在这一档。
      const tractors = detectTractors(group, ctx)
        .filter(t => t.every(c => !isTrump(c, ctx)));
      if (tractors.length > 0) {
        const chosen = sortTractors(tractors, ctx)[0];
        candidate = {
          cards: chosen,
          cls: 3,
          reason: `出${suitLabelCn(suit)}拖拉机(${chosen.length / 2}对)`,
        };
      }
    }
    if (!candidate) continue;

    if (!best || candidate.cls < best.cls
        || (candidate.cls === best.cls && candidate.cards.length > best.cards.length)) {
      best = { cards: candidate.cards, cls: candidate.cls, suit, reason: candidate.reason };
    }
  }

  if (!best) return null;
  const gated = applyGate(best.cards, hand, best.suit, ctx, [], false);
  if (gated.length === 0) return null;
  return { cards: gated, reason: best.reason };
}

// ---- 第 5 / 10 条：长花色 T1 的出牌选择 ----

function tryLongSuitT1(
  handSuit: Card[], memory: LongSuitMemory, ctx: AIContext, hand: Card[],
): Proposal | null {
  const t1 = memory.tier1;
  if (t1.length === 0) return null;
  const exclude = knownOutOfPlay(ctx, memory.suit);

  const lead = (cards: Card[], reason: string): Proposal | null => {
    const gated = applyGate(cards, hand, memory.suit, ctx, exclude, true);
    return gated.length > 0 ? { cards: gated, reason: `${reason}(${gated.length}张)` } : null;
  };

  // 第 10 条（仅庄家）：我用「总数 24 张」反推整门已绝 → 剩下的全部一起打出。
  // 闲家不知道底牌、不许用总数反推，只能靠 memory.voidPlayers 的证据。
  if (ctx.isDeclarer) {
    const bottomCount = ctx.bottomCards ? cardsOfSuit(ctx.bottomCards, memory.suit, ctx).length : 0;
    if (memory.playedCards.length + bottomCount + handSuit.length >= 24) {
      const full = lead([...handSuit], '长花色全出');
      if (full) return full;
    }
  }

  // 第 5 条：应甩尽甩——T1 非空就把整段甩出去，不再问「会不会被毙」，也不再为留
  // T2 而减量。甩出去的牌仍过闸门（§ gate），所以不会有 ±10 罚分与强制降级。
  // 旧规则在这里分了三档（第 3 条减量 / 第 5.1 条有对全出 / 第 8 条无对查两家
  // 能否毙），第 5.1 与第 8 条对本行输入与闸门与本条完全一致，因而不可达。
  const all = lead([...t1], '长花色控制张');
  if (all) return all;

  // 闸门把整段 T1 都判为不可甩（没有任何合法子集）→ 交回现行七步阶梯（第 1 条）。
  return null;
}

// ---- entry point ----

/**
 * NT long-suit lead. `longSuit` is computed once by the caller (`_aiLeadPlay`)
 * and shared with the priority-0b exclusion.
 *
 * Returns null when this layer has nothing to say, in which case the caller
 * falls back to the general seven-step ladder (第 1 条: no long suit ⇒ 策略不变).
 */
export function tryNTLead(hand: Card[], ctx: AIContext, longSuit: Suit): Proposal | null {
  if (ctx.trumpSuit !== null) return null;
  if (ctx.myIndex < 0 || hand.length === 0) return null;

  const memory = computeLongSuitMemory(hand, ctx);
  if (!memory) return null;

  const side = tryDrainOrTractorNonLong(hand, ctx, longSuit);
  if (side) return side;

  const handSuit = cardsOfSuit(hand, longSuit, ctx);
  // The long suit is derived from the initial hand and stays designated for
  // the whole round, so it can outlive my cards in it — bail out once empty.
  if (handSuit.length === 0) return null;

  return tryLongSuitT1(handSuit, memory, ctx, hand);
}
