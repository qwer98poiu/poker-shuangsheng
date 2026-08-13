/**
 * Module 5 — Following (跟出).
 *
 * Validates a follow play against the current trick's lead.
 *
 * General premise:
 *  - hand cards in lead suit group ≤ lead count: play ALL of that suit, fill rest.
 *  - hand cards in lead suit group > lead count: must play only from that suit,
 *    match lead pattern as closely as possible.
 *
 * Pattern rules:
 *  1. Tractor lead: must play same-length tractor (exact or extract from longer —
 *     both equally valid).  If neither possible, play closest shorter tractor then
 *     fill with pairs from other tractors (long→short) then regular pairs.
 *  2. Pair lead: must play pairs if available.
 *  3. Throw lead: decompose into tractors + pairs, apply 1 & 2.
 */
import type { Card, CardSuit, ValidationResult } from '../types.js';
import type { TrumpDeclaration, ComboClass } from '../types.js';
import { isTrump } from '../model.js';
import { findAllPairs, detectTractors, classify } from '../pattern/index.js';

// ---- helpers ----

function followGroup(cards: Card[], config: TrumpDeclaration): string {
  return cards.every(c => isTrump(c, config)) ? '_TRUMP_' : String(cards[0].suit);
}

/** Decompose a lead into ordered requirements:
 *  tractor pair-counts (longest first) then standalone pair count. */
interface LeadReqs {
  tractorReqs: number[];
  pairReqs: number;
}
function decomposeLead(lead: ComboClass): LeadReqs {
  const tr = lead.tractors.map(t => t.pairCount);
  tr.sort((a, b) => b - a);
  return { tractorReqs: tr, pairReqs: lead.pairCount };
}

// ---- Main validation ----

export function validateFollow(
  cards: Card[], hand: Card[], leadCards: Card[],
  leadPattern: ComboClass, _leadSuit: CardSuit | null, config: TrumpDeclaration,
): ValidationResult {
  // Same count
  if (cards.length !== leadCards.length)
    return { valid: false, error: `must play ${leadCards.length} cards` };

  // Cards in hand, no duplicates
  const handIds = new Set(hand.map(c => c.id));
  for (const c of cards) {
    if (!c || !handIds.has(c.id)) return { valid: false, error: 'card not in hand' };
  }
  if (new Set(cards.map(c => c.id)).size !== cards.length)
    return { valid: false, error: 'duplicate cards' };

  const group = followGroup(leadCards, config);
  const handInGroup = hand.filter(c => followGroup([c], config) === group);
  const isTrumpLead = group === '_TRUMP_';

  // Void in lead suit — any play is legal
  if (handInGroup.length === 0) return { valid: true };

  // hand cards in group ≤ lead count: play ALL, fill rest with anything.
  // No pattern check — the player has no choice in which suit cards to play.
  if (handInGroup.length <= leadCards.length) {
    const playedInGroup = cards.filter(c => followGroup([c], config) === group);
    if (playedInGroup.length < handInGroup.length)
      return { valid: false, error: isTrumpLead ? 'lead is trump — must follow with trump' : 'must follow suit' };
    return { valid: true };
  }

  // hand cards in group > lead count: must play ALL from this group
  if (!cards.every(c => followGroup([c], config) === group))
    return { valid: false, error: isTrumpLead ? 'lead is trump — must follow with trump' : 'must follow suit' };

  return matchPattern(cards, handInGroup, leadPattern, config);
}

// ---- Pattern matching ----

function matchPattern(
  played: Card[], handGroupCards: Card[], lead: ComboClass, config: TrumpDeclaration,
): ValidationResult {
  if (lead.type === 'single') return { valid: true };

  if (lead.type === 'pair')
    return checkPairFollow(played, handGroupCards, config);

  // tractor or throw
  return checkTractorOrThrowFollow(played, handGroupCards, lead, config);
}

// ---- Pair follow ----

function checkPairFollow(
  played: Card[], handGroupCards: Card[], config: TrumpDeclaration,
): ValidationResult {
  if (findAllPairs(handGroupCards).length > 0 ||
      detectTractors(handGroupCards, config).length > 0) {
    if (findAllPairs(played).length === 0)
      return { valid: false, error: 'must play a pair' };
  }
  return { valid: true };
}

// ---- Tractor / throw follow ----

function checkTractorOrThrowFollow(
  played: Card[], handGroupCards: Card[], lead: ComboClass, config: TrumpDeclaration,
): ValidationResult {
  const leadReqs = decomposeLead(lead);
  const ideal = computeIdealFollow(handGroupCards, leadReqs, config);

  // Extract played structure
  const playedTractors = detectTractors(played, config);
  const playedTractorPairCounts = playedTractors.map(t => t.length / 2).sort((a, b) => b - a);
  const playedPairIds = new Set(playedTractors.flat().map(c => c.id));
  const playedPairs = findAllPairs(played).filter(p => !playedPairIds.has(p[0].id));

  // Greedy assignment: a played tractor of N pairs can satisfy a requirement
  // of ≤N pairs, with leftover N-req pairs contributed to fill.
  const remaining: number[] = [...playedTractorPairCounts];
  for (const req of ideal.tractorPairCounts) {
    const idx = remaining.findIndex(n => n >= req);
    if (idx === -1)
      return { valid: false, error: `must play a tractor with ${req} or more pairs` };
    const leftover = remaining[idx] - req;
    remaining.splice(idx, 1);
    if (leftover > 0) remaining.push(leftover);
  }

  // Total pair count must meet minimum (includes leftover tractor pairs + standalone pairs)
  const playedTotal = playedTractorPairCounts.reduce((s, n) => s + n, 0) + playedPairs.length;
  if (playedTotal < ideal.minTotalPairs)
    return { valid: false, error: `must play at least ${ideal.minTotalPairs} pairs (only ${playedTotal})` };

  return { valid: true };
}

// ---- Unique-play detection ----

/**
 * Check whether the follower's hand has exactly one legal play.
 *
 * Definition: not a single card in the chosen set can be swapped for
 * another card in the same suit group without breaking the follow rules.
 *
 * Rules:
 * 1. If lead-suit count equals lead length, all cards are forced (unique).
 * 2. If the lead contains singles, not unique (singles can be chosen freely).
 * 3. Lead only has pairs/tractors (no singles):
 *    a. No tractor in lead or no tractor in hand: compare pair counts.
 *    b. Both have tractors: use computeIdealFollow to compare pattern totals.
 */
export function isOnlyLegalPlay(
  leadSuitCards: Card[],
  leadLen: number,
  leadCombo: ComboClass,
  config: TrumpDeclaration,
): boolean {
  if (leadSuitCards.length === 0) return false;
  if (leadSuitCards.length < leadLen) return false;

  // Rule 1: same-suit count equals lead length, all cards forced.
  if (leadSuitCards.length === leadLen) return true;

  // Rule 1.5: single lead, hand has exactly one pair — both cards identical, unique.
  if (leadLen === 1 && findAllPairs(leadSuitCards).length === 1 && leadSuitCards.length === 2) {
    return true;
  }

  // Rule 2: lead contains singles, not unique.
  const tractorPairCount = leadCombo.tractors.reduce((s, t) => s + t.pairCount, 0);
  const totalPairCards = (leadCombo.pairCount + tractorPairCount) * 2;
  const hasSingles = leadCombo.type === 'single' || totalPairCards < leadLen;
  if (hasSingles) return false;

  // Rule 3: lead only has pairs/tractors (no singles).
  const handTractors = detectTractors(leadSuitCards, config);
  const leadHasTractor = leadCombo.hasTractor;
  const handHasTractor = handTractors.length > 0;

  if (!leadHasTractor || !handHasTractor) {
    // Rule 3a: compare pair counts (including tractor pairs).
    const leadTotalPairs = leadCombo.pairCount + tractorPairCount;
    const handTotalPairs = findAllPairs(leadSuitCards).length;
    return leadTotalPairs === handTotalPairs;
  }

  // Rule 3b: both have tractors, use computeIdealFollow.
  const tr = leadCombo.tractors.map(t => t.pairCount);
  tr.sort((a, b) => b - a);
  const ideal = computeIdealFollow(
    leadSuitCards,
    { tractorReqs: tr, pairReqs: leadCombo.pairCount },
    config,
  );

  // Build follow pattern: tractor pair counts + standalone pairs (each = 1).
  const played = ideal.tractorPairCounts.reduce((s, n) => s + n, 0);
  const standalonePairs = ideal.minTotalPairs - played;
  const allPairCounts = [...ideal.tractorPairCounts];
  for (let i = 0; i < standalonePairs; i++) allPairCounts.push(1);

  if (allPairCounts.length === 0) return false;
  const minIdeal = Math.min(...allPairCounts);

  // Remove hand tractors/pairs with pair count < minIdeal,
  // then compare remaining hand total pairs with ideal total.
  const allPairs = findAllPairs(leadSuitCards);
  const tractorSets = handTractors.map(t => ({ cards: new Set(t.map(c => c.id)), pc: t.length / 2 }));

  let handTotal = 0;
  for (const pair of allPairs) {
    let qualifies = minIdeal <= 1;
    if (!qualifies) {
      for (const ts of tractorSets) {
        if (ts.pc >= minIdeal && pair.every(c => ts.cards.has(c.id))) {
          qualifies = true;
          break;
        }
      }
    }
    if (qualifies) handTotal++;
  }

  const idealTotal = allPairCounts.reduce((a, b) => a + b, 0);
  // 理想降级（minTotalPairs < 领出对数）时，张数缺口由单牌填充，
  // 单牌可自由选择 → 组合不唯一
  if (idealTotal * 2 !== leadLen) return false;
  return idealTotal === handTotal;
}

// ---- Ideal follow computation ----

// ---- Followable cards (UI grey-out) ----

/**
 * 返回"能出现在某个合法跟牌组合中的牌"（UI 灰色判定用）：
 * - leadCards 空（领出）→ null（全可选）
 * - 缺门（手牌无 lead 组牌）→ null（可垫/毙任意）
 * - 手牌 lead 组牌数 < lead 张数 → null（组牌必出 + 其余任意填）
 * - 手牌 lead 组牌数 == lead 张数 → 组牌（唯一可出，其余全灰）
 * - 手牌 lead 组牌数 > lead 张数 → 按 lead 牌型收窄：
 *   - lead 含单张（single/throw 有单张）→ 组牌（fill 空间自由）
 *   - lead 全对（pair/tractor）：手牌有对子/拖拉机 → 对子牌（含拖拉机牌）；
 *     手牌无对子 → 组牌任意（单张组合合法）
 */
export function computeFollowableCards(
  hand: Card[],
  leadCards: Card[],
  config: TrumpDeclaration,
): Card[] | null {
  if (leadCards.length === 0) return null;
  const group = followGroup(leadCards, config);
  const handInGroup = hand.filter(c => followGroup([c], config) === group);
  const leadLen = leadCards.length;

  if (handInGroup.length === 0) return null;              // 缺门：任意
  if (handInGroup.length < leadLen) return null;          // 组牌必出 + 任意填
  if (handInGroup.length === leadLen) return handInGroup; // 唯一可出：只组牌

  const leadPattern = classify(leadCards, config);
  const tractorPairCount = leadPattern.tractors.reduce((s, t) => s + t.pairCount, 0);
  const leadAllPairs = leadLen === (leadPattern.pairCount + tractorPairCount) * 2;
  if (!leadAllPairs) return handInGroup; // lead 含单张 → 有 fill 空间 → 组内任意

  // lead 全对：手牌对子/拖拉机总量足够时必须出对子 → 对子牌可点；
  // 不足（无法匹配 lead 牌型）→ 可垫近似组合（同张数任意，validateFollow 允许）
  const pairIds = new Set<string>();
  for (const t of detectTractors(handInGroup, config)) t.forEach(c => pairIds.add(c.id));
  for (const p of findAllPairs(handInGroup)) p.forEach(c => pairIds.add(c.id));
  const needPairs = leadPattern.pairCount + tractorPairCount;
  if (pairIds.size / 2 >= needPairs) return handInGroup.filter(c => pairIds.has(c.id));
  return handInGroup; // 对子不足：组内任意（可垫近似组合）
}

// ---- Mandatory follow (GUI lock / disable) ----

export interface MandatoryFollow {
  lockedIds: string[];   // 必出：自动选中且不可放下
  disabledIds: string[]; // 不可选：置灰
}

/**
 * 计算跟牌时"部分必出"（锁定）与"同花色内不可选"（置灰）的牌。
 * 唯一可出（isOnlyLegalPlay）之外的扩展。流程：
 * 1. 缺门 / 领出为空 → 全部自由
 * 2. 手牌同花色张数 ≤ 领出张数 → 同花色全部必出（唯一可出 / 组牌必出+任意填）
 * 3. 唯一可出 → 全部对子必出（组合唯一，张数恰好填满）
 * 4. 部分必出：
 *    - 手牌总对数 == Ideal 总对数 → 所有对必出，单牌自由选择
 *    - 手牌总对数 > Ideal 总对数 → 循环 k=1..n 递增，首个 l1(k) == l2(k) 时
 *      对数 ≥ k 的子牌型必出；领出含单 → 同花色无不可选；否则单牌不可选，
 *      且对数 < Ideal 最短对数的子牌型不可选。
 * 子牌型 = detectTractors 的最大不重叠连续块 + 独立对牌（块内不可再拆）。
 */
export function computeMandatoryFollow(
  hand: Card[],
  leadCards: Card[],
  config: TrumpDeclaration,
): MandatoryFollow {
  if (leadCards.length === 0) return { lockedIds: [], disabledIds: [] };
  const group = followGroup(leadCards, config);
  const handInGroup = hand.filter(c => followGroup([c], config) === group);
  const leadLen = leadCards.length;

  // 缺门：可垫/毙任意
  if (handInGroup.length === 0) return { lockedIds: [], disabledIds: [] };

  // 张数不足或相等：组牌必出（不足时其余任意填；相等时唯一可出）
  if (handInGroup.length <= leadLen) {
    return { lockedIds: handInGroup.map(c => c.id), disabledIds: [] };
  }

  const leadPattern = classify(leadCards, config);
  const allPairs = findAllPairs(handInGroup);

  // 手牌子牌型：detectTractors 最大不重叠块 + 独立对牌（块内不可再拆）
  const structures: { pairCount: number; cards: Card[] }[] = [];
  {
    const sorted = [...detectTractors(handInGroup, config)].sort((a, b) => b.length - a.length);
    const usedIds = new Set<string>();
    for (const t of sorted) {
      if (new Set(t.map(c => c.id)).size !== t.length) continue; // 内部重复防御
      if (t.some(c => usedIds.has(c.id))) continue;              // 与已取块重叠（子块）→ 跳过
      structures.push({ pairCount: t.length / 2, cards: t });
      t.forEach(c => usedIds.add(c.id));
    }
    for (const p of allPairs) {
      if (!usedIds.has(p[0].id)) structures.push({ pairCount: 1, cards: p });
    }
  }

  // 唯一可出：组合唯一 → 组合牌必出，其余同花色牌不可选
  if (isOnlyLegalPlay(handInGroup, leadLen, leadPattern, config)) {
    let lockedIds: string[];
    if (leadLen === 1) {
      // 单领出（Rule 1.5）：恰一对，等价组合 → 锁 1 张
      lockedIds = [allPairs[0][0].id];
    } else {
      const idealU = computeIdealFollow(handInGroup, decomposeLead(leadPattern), config);
      const playedU = idealU.tractorPairCounts.reduce((s, n) => s + n, 0);
      const fillU = idealU.minTotalPairs - playedU;
      const distU = [...idealU.tractorPairCounts];
      for (let i = 0; i < fillU; i++) distU.push(1);
      const minIdealU = distU.length === 0 ? 1 : Math.min(...distU);
      const locked: string[] = [];
      if (minIdealU <= 1) {
        for (const p of allPairs) p.forEach(c => locked.push(c.id));
      } else {
        for (const s of structures) {
          if (s.pairCount >= minIdealU) s.cards.forEach(c => locked.push(c.id));
        }
      }
      lockedIds = locked;
    }
    const lockedSet = new Set(lockedIds);
    const disabledIds = handInGroup.filter(c => !lockedSet.has(c.id)).map(c => c.id);
    return { lockedIds, disabledIds };
  }

  // ---- 部分必出 ----
  const tractorPairCount = leadPattern.tractors.reduce((s, t) => s + t.pairCount, 0);
  const leadHasSingles = leadLen > (leadPattern.pairCount + tractorPairCount) * 2;

  // 领出全单：跟牌自由。注意 classify 对 single 的约定 pairCount=1（占位），
  // 不能按对数判断，须按牌型类型特判。
  if (leadPattern.type === 'single'
      || (leadHasSingles && leadPattern.pairCount === 0 && tractorPairCount === 0)) {
    return { lockedIds: [], disabledIds: [] };
  }

  const ideal = computeIdealFollow(handInGroup, decomposeLead(leadPattern), config);
  const played = ideal.tractorPairCounts.reduce((s, n) => s + n, 0);
  const fillPairs = ideal.minTotalPairs - played;
  const l2Dist = [...ideal.tractorPairCounts];
  for (let i = 0; i < fillPairs; i++) l2Dist.push(1); // fill 对子（对数 1）

  const handTotalPairs = allPairs.length;

  const lockedIds: string[] = [];
  const disabledIds: string[] = [];

  if (handTotalPairs === ideal.minTotalPairs) {
    // 3.1：所有对必出；单牌自由选择（理想降级时张数缺口由单牌填充）
    for (const p of allPairs) p.forEach(c => lockedIds.push(c.id));
  } else {
    // 3.2：手牌总对数 > Ideal 总对数（恒成立）
    const maxK = Math.max(1, ...structures.map(s => s.pairCount), ...l2Dist);
    let kStar = 0;
    let kStarL1 = 0;
    for (let k = 1; k <= maxK; k++) {
      const l1 = structures.filter(s => s.pairCount >= k).reduce((s, x) => s + x.pairCount, 0);
      const l2 = l2Dist.filter(v => v >= k).reduce((s, x) => s + x, 0);
      if (l1 === l2) { kStar = k; kStarL1 = l1; break; }
    }
    // 首个相等点（可能为空集 0==0 → 无必出）
    if (kStar > 0 && kStarL1 > 0) {
      for (const s of structures) {
        if (s.pairCount >= kStar) s.cards.forEach(c => lockedIds.push(c.id));
      }
    }
    if (!leadHasSingles) {
      // 3.2.3：单牌不可选
      const structIds = new Set(structures.flatMap(s => s.cards).map(c => c.id));
      for (const c of handInGroup) if (!structIds.has(c.id)) disabledIds.push(c.id);
      // 3.2.4：对数 < Ideal 最短对数的子牌型不可选
      const minIdeal = Math.min(...l2Dist);
      if (minIdeal > 1) {
        for (const s of structures) {
          if (s.pairCount < minIdeal) s.cards.forEach(c => disabledIds.push(c.id));
        }
      }
    }
    // 3.2.2：领出含单 → 同花色无不可选（disabled 保持空）
  }

  // 锁定优先：不可选集合排除已锁定牌（理论不重叠，防御）
  const lockedSet = new Set(lockedIds);
  return {
    lockedIds,
    disabledIds: disabledIds.filter(id => !lockedSet.has(id)),
  };
}

export interface FollowSpec {
  tractorPairCounts: number[];  // required tractor pair counts, longest first
  minTotalPairs: number;        // minimum total pair count (tractor + standalone)
}

export function computeIdealFollow(
  handCards: Card[], leadReqs: LeadReqs, config: TrumpDeclaration,
): FollowSpec {
  const totalReqPairs = leadReqs.tractorReqs.reduce((s, n) => s + n, 0) + leadReqs.pairReqs;

  // Track available tractors and their used state
  const handTractors = detectTractors(handCards, config);
  const tracts: { cards: Card[]; used: boolean }[] = handTractors.map(t => ({ cards: t, used: false }));

  const bestTractors: number[] = [];
  const usedIds = new Set<string>();

  for (const reqPairs of leadReqs.tractorReqs) {
    let remaining = reqPairs;
    // Keep filling this tractor slot with additional tractors as long as
    // the deficit is ≥2 pairs (a 1-pair deficit is handled by fill capacity).
    while (remaining >= 2) {
      const best = pickBestTractor(tracts, usedIds, remaining);
      if (!best) break;
      bestTractors.push(best.pairCount);
      best.cards.forEach(c => usedIds.add(c.id));
      remaining -= best.pairCount;
    }
  }

  bestTractors.sort((a, b) => b - a); // longest first

  // Fill capacity: pairs from unused tractors + regular pairs
  const remaining = handCards.filter(c => !usedIds.has(c.id));
  const remTractors = detectTractors(remaining, config);
  const remPairIds = new Set(remTractors.flat().map(c => c.id));
  const remPairs = findAllPairs(remaining).filter(p => !remPairIds.has(p[0].id));

  const fillCap = remTractors.reduce((s, t) => s + t.length / 2, 0) + remPairs.length;
  const played = bestTractors.reduce((s, n) => s + n, 0);
  const needed = Math.max(0, totalReqPairs - played);

  return {
    tractorPairCounts: bestTractors,
    minTotalPairs: played + Math.min(fillCap, needed),
  };
}

// ---- Best tractor picker ----

interface TractorSlot { cards: Card[]; used: boolean }

function pickBestTractor(
  tracts: TractorSlot[], usedIds: Set<string>, reqPairs: number,
): { pairCount: number; cards: Card[] } | null {
  const available = tracts
    .filter(t => !t.used && t.cards.length >= 4)
    .filter(t => t.cards.every(c => !usedIds.has(c.id)));

  if (available.length === 0) return null;

  // Exact match: same-length tractor
  const exact = available.find(t => t.cards.length / 2 === reqPairs);
  if (exact) {
    exact.used = true;
    return { pairCount: reqPairs, cards: exact.cards };
  }

  // Extract from longer: both equally valid as exact
  const longer = available
    .filter(t => t.cards.length / 2 > reqPairs)
    .sort((a, b) => (a.cards.length / 2) - (b.cards.length / 2));
  if (longer.length > 0) {
    longer[0].used = true;
    return { pairCount: reqPairs, cards: longer[0].cards.slice(0, reqPairs * 2) };
  }

  // Closest shorter: last resort
  available.sort((a, b) => (b.cards.length / 2) - (a.cards.length / 2));
  available[0].used = true;
  return {
    pairCount: available[0].cards.length / 2,
    cards: available[0].cards,
  };
}
