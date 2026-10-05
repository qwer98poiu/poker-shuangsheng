/**
 * Bottom exchange strategy (扣底策略).
 *
 * Determines which 8 cards to discard into the bottom when the AI is declarer.
 *
 * Control-card tiers (see bottom-controls.ts): per off-suit,
 *   tier1 = top card (A, or K when A is the level) + any structural tractor
 *           + worst-case throwable cards;
 *   tier2 = all other pairs when tier1 has >= 2 pairs, rank >= 10 pairs when
 *           tier1 has exactly 1 pair, none when tier1 has 0 pairs.
 *
 * 有主 (suited): void off-suits one round at a time by discarding their
 *   non-control remainder (<= 8 cards, points within the main-count band
 *   0/5/10, cumulative capped), preferring the cheapest point band each
 *   round (0 -> 5 -> 10; a 0-point door beats a 5-point door, etc.), then
 *   fill the remaining slots from the suited ladder (桶1 副牌非分单牌 pre-pick
 *   keeps one low non-point single per fragile suit — no-control, singles +
 *   points only, not voided — when candidates exceed the slots).
 * NT (无主): trump cards never enter the bottom; a suit is voidable only
 *   when its total <= 8 or (total >= 9 and control < 6). Long suits
 *   (total >= 9 and control >= 6) stay for play — only ONE suit is
 *   designated long (strongest first), the other candidates are treated as
 *   ordinary suits; fill follows the NT ladder where the long suit still
 *   contributes late-position cards.
 */
import type { Card, CardSuit } from '../types.js';
import { Suit, SUIT_ORDER, Rank, cardPointsFromRank } from '../types.js';
import type { TrumpDeclaration } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import type { AIContext } from './types.js';
import {
  computeOffSuitControls, pairUnitCount, pairUnitsOf,
  type OffSuitControlInfo,
} from './bottom-controls.js';

const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', C: '♣', D: '♦' };

/** 扣底决策的输入张数：发到的 25 张 + 拿进手里的 8 张底牌。 */
export const BOTTOM_DECISION_HAND_SIZE = 33;

export interface BottomVoidDetail {
  suit: Suit;
  /** Discarded cards of this door — the suit's whole non-control remainder. */
  length: number;
  points: number;
  /** Control cards of this suit kept in hand (tier1 + tier2). */
  keptControl: number;
}

/** Decision plus internal structure — for scripts and scene classification. */
export interface BottomChoiceDetail {
  mode: 'suited' | 'NT';
  /** Trump count in hand before discarding. */
  mainCount: number;
  /** Void point cap from the main-count band (suited 0/5/10, NT 0/5). */
  cap: number;
  keep: Card[];
  discard: Card[];
  reason: string;
  /** Void doors in selection order. */
  voids: BottomVoidDetail[];
  /** Conceptual ladder buckets (suited / NT both 1..9) contributing fill cards. */
  fillBuckets: number[];
}

/**
 * Run bottom selection and also return its internal structure (same decision).
 *
 * 这里是选牌算法本身，对任意手牌形状都成立；「必须 33 张」是对外入口
 * （`ai/index.ts` 的 aiChooseBottomCards）的契约，不在此处断言——单元测试
 * 用手工构造的形状手牌直接打这个函数。
 */
export function aiChooseBottomCardsDetailed(
  hand: Card[],
  config: AIContext | TrumpDeclaration,
): BottomChoiceDetail {
  if (config.trumpSuit === null) {
    return chooseNTBottom(hand, config);
  }
  return chooseSuitedBottom(hand, config);
}

export function aiChooseBottomCards(
  hand: Card[],
  config: AIContext | TrumpDeclaration,
): { keep: Card[]; discard: Card[]; reason: string } {
  const d = aiChooseBottomCardsDetailed(hand, config);
  return { keep: d.keep, discard: d.discard, reason: d.reason };
}

/** Number of trump cards in hand before discarding. */
function mainCount(hand: Card[], config: TrumpDeclaration): number {
  return hand.filter(c => isTrump(c, config)).length;
}

function pointOf(c: Card): number {
  return cardPointsFromRank(c.rank);
}

// ---- Suited trump mode ----

function chooseSuitedBottom(
  hand: Card[],
  config: TrumpDeclaration,
): BottomChoiceDetail {
  const trumps = mainCount(hand, config);
  const cap = trumps <= 8 ? 0 : trumps === 9 ? 5 : 10;
  const infos = computeOffSuitControls(hand, config);

  // 1. Void loop — cheapest point band first each round.
  const discarded: Card[] = [];
  const voids: BottomVoidDetail[] = [];
  const usedSuits = new Set<Suit>();
  const buckets = new Set<number>();
  let slots = 8;
  let cumPoints = 0;
  for (;;) {
    const door = pickDoor(infos, usedSuits, slots, cap - cumPoints, [0, 5, 10], () => true);
    if (!door) break;
    usedSuits.add(door.suit);
    discarded.push(...door.voidable);
    slots -= door.voidable.length;
    cumPoints += door.voidablePoints;
    voids.push({
      suit: door.suit,
      length: door.voidable.length,
      points: door.voidablePoints,
      keptControl: door.tier1.length + door.tier2.length,
    });
  }

  // 2. Fill the remaining slots from the ladder (budget = band cap minus
  //    points already fixed by 扣绝 — 桶3 分单受同一限额约束).
  if (slots > 0) {
    const usedIds = new Set(discarded.map(c => c.id));
    discarded.push(...fillSuited(hand, usedIds, infos, config, slots, cap - cumPoints, b => buckets.add(b)));
  }

  const reason = buildBottomReason(discarded, infos, '');
  const discardIds = new Set(discarded.map(c => c.id));
  return {
    mode: 'suited',
    mainCount: trumps,
    cap,
    keep: hand.filter(c => !discardIds.has(c.id)),
    discard: discarded,
    reason,
    voids,
    fillBuckets: [...buckets].sort((a, b) => a - b),
  };
}

// ---- NT (no-trump) mode ----

function chooseNTBottom(
  hand: Card[],
  config: TrumpDeclaration,
): BottomChoiceDetail {
  const trumps = mainCount(hand, config);
  const cap = trumps >= 3 ? 5 : 0;
  const infos = computeOffSuitControls(hand, config);
  // ⑥ 长花色只有一门: among suits with total >= 9 and control >= 6 pick the
  // single longest/strongest by (total+control) -> total -> tier1 -> total
  // pairs -> SHCD; other candidates are treated as ordinary suits.
  const longCandidates = infos.filter(longShape);
  longCandidates.sort(compareLongCandidate);
  const longSuits = new Set(
    longCandidates.length > 0 ? [longCandidates[0].suit] : [],
  );
  const ntEligible = (info: OffSuitControlInfo): boolean => {
    // ① total <= 8, or ④ total >= 9 with control < 6.
    const total = info.cards.length;
    const ctrl = info.tier1.length + info.tier2.length;
    return total <= 8 || (total >= 9 && ctrl < 6);
  };

  // Void loop — NT has no 10-point band (cap is 5 at most).
  const discarded: Card[] = [];
  const voids: BottomVoidDetail[] = [];
  const usedSuits = new Set<Suit>();
  const buckets = new Set<number>();
  let slots = 8;
  let cumPoints = 0;
  for (;;) {
    const door = pickDoor(infos, usedSuits, slots, cap - cumPoints, [0, 5], ntEligible);
    if (!door) break;
    usedSuits.add(door.suit);
    discarded.push(...door.voidable);
    slots -= door.voidable.length;
    cumPoints += door.voidablePoints;
    voids.push({
      suit: door.suit,
      length: door.voidable.length,
      points: door.voidablePoints,
      keptControl: door.tier1.length + door.tier2.length,
    });
  }

  if (slots > 0) {
    const usedIds = new Set(discarded.map(c => c.id));
    discarded.push(...fillNT(hand, usedIds, infos, config, longSuits, slots, cap - cumPoints, b => buckets.add(b)));
  }

  const reason = buildBottomReason(discarded, infos, 'NT: ');
  const discardIds = new Set(discarded.map(c => c.id));
  return {
    mode: 'NT',
    mainCount: trumps,
    cap,
    keep: hand.filter(c => !discardIds.has(c.id)),
    discard: discarded,
    reason,
    voids,
    fillBuckets: [...buckets].sort((a, b) => a - b),
  };
}

// ---- Long-suit (长花色) designation (NT only) ----

/** Shape of a long suit candidate: total >= 9 and control cards >= 6. */
export function longShape(info: OffSuitControlInfo): boolean {
  return info.cards.length >= 9 && info.tier1.length + info.tier2.length >= 6;
}

/** Choose the single long suit: strongest first (大者优先), SHCD last. */
export function compareLongCandidate(a: OffSuitControlInfo, b: OffSuitControlInfo): number {
  const sumDiff = (b.cards.length + b.tier1.length + b.tier2.length)
    - (a.cards.length + a.tier1.length + a.tier2.length);
  if (sumDiff !== 0) return sumDiff;
  const lenDiff = b.cards.length - a.cards.length;
  if (lenDiff !== 0) return lenDiff;
  const tier1Diff = b.tier1.length - a.tier1.length;
  if (tier1Diff !== 0) return tier1Diff;
  const pairsDiff = pairUnitCount(b.cards) - pairUnitCount(a.cards);
  if (pairsDiff !== 0) return pairsDiff;
  return suitIdx(a.suit) - suitIdx(b.suit);
}

// ---- Void-door selection ----

/**
 * Pick one voidable door for the current round:
 * only the cheapest point band present is considered (有 0 分就不选 5 分门、
 * 有 ≤5 分就不选 10 分门), ties broken by fewer cards -> fewer pairs ->
 * fewer control cards -> SHCD suit order. Returns null when no door fits.
 */
function pickDoor(
  infos: OffSuitControlInfo[],
  usedSuits: Set<Suit>,
  slots: number,
  remainingCap: number,
  bands: number[],
  eligible: (info: OffSuitControlInfo) => boolean,
): OffSuitControlInfo | null {
  for (const band of bands) {
    if (band > remainingCap) continue;
    const candidates = infos.filter(info =>
      !usedSuits.has(info.suit)
      && eligible(info)
      && info.voidable.length >= 1
      && info.voidable.length <= slots
      && info.voidablePoints === band,
    );
    if (candidates.length === 0) continue;
    candidates.sort(compareDoor);
    return candidates[0];
  }
  return null;
}

function compareDoor(a: OffSuitControlInfo, b: OffSuitControlInfo): number {
  const byLen = a.voidable.length - b.voidable.length;
  if (byLen !== 0) return byLen;
  const byPairs = a.voidablePairCount - b.voidablePairCount;
  if (byPairs !== 0) return byPairs;
  const aCtrl = a.tier1.length + a.tier2.length;
  const bCtrl = b.tier1.length + b.tier2.length;
  if (aCtrl !== bCtrl) return aCtrl - bCtrl;
  return suitIdx(a.suit) - suitIdx(b.suit);
}

/**
 * 最终理由——对扣绝与填充做**整体归类**：一门副牌的非控制部分全部入底即计入
 * 扣绝（无论由扣绝门选中，还是填充恰好把整门凑空——"特定情况下填充也会导致
 * 扣绝"）；花色按 SHCD 合并、分数合并。其余入底牌计入填充。
 * 两段固定顺序：`扣绝♠♥花色（共N分）；填充M张（共K分）`，空段写作
 * 无扣绝 / 无填充。`prefix` 为无主模式的前缀（"NT: "）。
 */
function buildBottomReason(
  discard: Card[],
  infos: OffSuitControlInfo[],
  prefix: string,
): string {
  const discardIds = new Set(discard.map(c => c.id));
  const voidedSuits: Suit[] = [];
  for (const info of infos) {
    if (info.voidable.length > 0 && info.voidable.every(c => discardIds.has(c.id))) {
      voidedSuits.push(info.suit);
    }
  }
  const voided = new Set(voidedSuits);
  let voidPoints = 0;
  let fillCount = 0;
  let fillPoints = 0;
  for (const c of discard) {
    const pts = cardPointsFromRank(c.rank);
    if (voided.has(c.suit as Suit)) voidPoints += pts;
    else {
      fillCount++;
      fillPoints += pts;
    }
  }
  const part1 = voidedSuits.length > 0
    ? `扣绝${voidedSuits.map(s => SUIT_SYMBOL[s] || s).join('')}花色（共${voidPoints}分）`
    : '无扣绝';
  const part2 = fillCount > 0 ? `填充${fillCount}张（共${fillPoints}分）` : '无填充';
  return `${prefix}${part1}；${part2}`;
}

// ---- Ladder fill (shared walker) ----

interface LadderGroup {
  kind: 'single' | 'pair';
  ok: (c: Card) => boolean;
  /** Conceptual bucket number (suited ladder 1..8 / NT ladder 1..9). */
  bucket: number;
  /** Allow splitting pairs to fill an odd remaining slot. */
  split?: boolean;
  /**
   * Optional pair-unit ordering for this group (pair buckets only).
   * Defaults to unitCmp (rank asc → SHCD → id). Used by 桶2 (副牌非分对) to
   * order 非tier2 before tier2 pairs and pair-poor suits first.
   */
  pairSort?: (a: Card[], b: Card[]) => number;
  /**
   * Optional single ordering for this group (single buckets only). Factory
   * receives the group-time pool and taken ids — singles are re-ordered by
   * context, e.g. 分单桶 (有主桶3 / 无主桶7) promotes cards whose door has
   * only them left. Defaults to unitCmp (rank asc → SHCD → id).
   */
  singleSort?: (pool: Card[], taken: Set<string>) => (a: Card[], b: Card[]) => number;
  /**
   * Point-limited 分单 bucket. The limit applies only at the odd-slot
   * crossing (pair buckets skipped, 1 slot left): a single is taken while
   * the point budget covers it, otherwise 0-point pairs are split instead.
   */
  gatePoint?: boolean;
}

/**
 * Consume `slots` cards from `pool` through an ordered ladder of groups.
 * Whole units are taken while they fit; split groups fill the final odd
 * slot by breaking the weakest remaining pair of their own members; a
 * final fallback splits weakest remaining pairs (non-control off-suit ->
 * control off-suit -> trump) if the ladder still cannot reach the target.
 * The 分单 group (the first group flagged `gatePoint`, suited 桶3 / NT 桶7)
 * is point-limited in one narrow state only: when 0-point pairs could not
 * fit the remaining odd slot and the ladder is about to cross from the
 * pair buckets into 分单 (恰剩 1 槽). There a single is taken only while
 * `budget` — the main-count band cap minus points already fixed by 扣绝 —
 * covers it (扣绝+分单 ≤ cap); when the single would exceed the budget the
 * whole 分单 bucket is skipped and the odd slot falls through to the
 * later split buckets (有主 桶6/桶7/桶9、NT 桶4/桶5/桶6) or the final
 * fallback, which fill it with 0-point pair halves instead of points.
 * All other paths and every later bucket keep their original, budget-free
 * priority.
 * `onBucket` (when given) receives the conceptual bucket of every group
 * (or the fallback) that actually contributed cards — for scene tracing.
 */
function runLadder(
  pool0: Card[],
  slots: number,
  groups: LadderGroup[],
  config: TrumpDeclaration,
  kindOf: (c: Card) => number,
  budget: number,
  onBucket?: (bucket: number) => void,
): Card[] {
  const pool = [...pool0];
  const taken: Card[] = [];
  const takenIds = new Set<string>();
  const fallbackBucket = groups[groups.length - 1].bucket;
  const gateIdx = groups.findIndex(g => g.gatePoint);
  const unitPoints = (u: Card[]) =>
    u.reduce((s, c) => s + cardPointsFromRank(c.rank), 0);
  let left = budget;

  for (const [gi, g] of groups.entries()) {
    if (slots <= 0) break;
    const cands = pool.filter(c => !takenIds.has(c.id) && g.ok(c));
    const { pairs, singles } = pairUnitsOf(cands);
    // Normalize to units of cards (pairs stay whole; each single is its own unit).
    const units: Card[][] = g.kind === 'pair'
      ? pairs
      : singles.map(c => [c]);
    units.sort(
      g.kind === 'pair' && g.pairSort
        ? g.pairSort
        : g.kind === 'single' && g.singleSort
          ? g.singleSort(pool, takenIds)
          : unitCmp(config),
    );
    // 限额仅在"0 分对放不下整对被跳过、即将从桶2/前级进分单桶（恰剩 1 槽）"
    // 时生效；其余情形分单桶照旧不设限。
    const gateOn = gi === gateIdx && slots === 1
      && pool.some(c => !takenIds.has(c.id) && pointOf(c) === 0
        && groups.slice(0, gi).some(gg => gg.kind === 'pair' && gg.ok(c)));
    for (const u of units) {
      if (slots <= 0) break;
      if (u.length > slots) continue;
      const pts = gateOn ? unitPoints(u) : 0;
      if (gateOn && pts > left) {
        // 限额余量放不下这张分单 → 整桶跳过，奇数槽继续下探：后续可拆对
        // 桶（有主 桶6/桶7/桶9、NT 桶4/桶5/桶6）或末尾兜底以 0 分对
        // 拆半张补足，不再填分。
        break;
      }
      for (const c of u) takenIds.add(c.id);
      taken.push(...u);
      slots -= u.length;
      if (gateOn) left -= pts;
      onBucket?.(g.bucket);
    }
    if (g.split && g.kind === 'pair' && slots > 0) {
      // slots === 1 here: split the weakest remaining pair of this group.
      const rest = units.filter(u => u.every(c => !takenIds.has(c.id)));
      if (rest.length > 0 && rest[0].length > slots) {
        taken.push(rest[0][0]);
        takenIds.add(rest[0][0].id);
        slots--;
        onBucket?.(g.bucket);
      }
    }
  }

  // Final parity fallback: split pairs weakest-first, never above a
  // non-control off-suit pair if a control/trump pair is the alternative.
  if (slots > 0) {
    const remaining = pool.filter(c => !takenIds.has(c.id));
    const { pairs } = pairUnitsOf(remaining);
    pairs.sort((a, b) => {
      const ka = kindOf(a[0]);
      const kb = kindOf(b[0]);
      if (ka !== kb) return ka - kb;
      return unitCmp(config)(a, b);
    });
    for (const p of pairs) {
      for (const c of p) {
        if (slots <= 0) break;
        takenIds.add(c.id);
        taken.push(c);
        slots--;
      }
      onBucket?.(fallbackBucket);
      if (slots <= 0) break;
    }
    // Defensive: only reachable with impossible hand shapes.
    if (slots > 0) {
      const rest = remaining.filter(c => !takenIds.has(c.id));
      rest.sort((a, b) => unitCmp(config)([a], [b]));
      for (const c of rest) {
        if (slots <= 0) break;
        takenIds.add(c.id);
        taken.push(c);
        slots--;
      }
      if (rest.length > 0) onBucket?.(fallbackBucket);
    }
  }
  return taken;
}

// ---- Bucket-1 protection (桶1 留保护牌) ----

/** 一门的保护信息：分牌全在、只有单牌、无控制、未被扣绝的花色。 */
interface JunkGuard {
  suit: Suit;
  /** 整门分牌之和（保留优先级：分多的花色优先留保护牌）。 */
  points: number;
  /** 该门全部非分单牌（桶1 候选成员）。 */
  members: Card[];
  /** 保护牌：最小的非分单牌（留在手中作垫牌）。 */
  keeper: Card;
}

/**
 * 桶1（副牌非分单牌）预选取。
 *
 * 候选多于待填槽位（`cands.length > slots`）且存在"脆弱花色"——该门不在扣绝门
 * 内（牌仍留在池中）、无控制张（tier1/tier2 皆空）、只有单牌、且带分牌——时，
 * 尽量避免把该门抽成只剩分牌：穷举"哪些门保留其最小非分单牌"（≤ slack 个，
 * slack = 候选数 − 槽位数），以"留在手中的脆弱花色总分数最少"为目标选最优
 * 方案（并列：受害者数少 → 保留门数少 → 保留门按 分多 → SHCD 靠前 优先）。
 * 枚举保证：只有当某门原本会被抽光非分单张时才真正生效；抽出的非分单牌尽量
 * 取小，与旧行为仅在确有受害者时不同。
 */
function selectBucket1Singles(
  cands: Card[],
  slots: number,
  pool: Card[],
  infos: OffSuitControlInfo[],
  config: TrumpDeclaration,
): Card[] {
  const cmpCard = (a: Card, b: Card): number => unitCmp(config)([a], [b]);
  const sorted = [...cands].sort(cmpCard);
  if (slots <= 0 || sorted.length <= slots) return sorted;

  // 脆弱花色（守卫）：在池中仍有牌（未被扣绝门清空）、无控制张、只有单牌、
  // 有分牌、且至少有 1 张非分单牌可保护。
  const guards: JunkGuard[] = [];
  for (const info of infos) {
    if (info.tier1.length + info.tier2.length > 0) continue; // 有控制张
    const suitCards = pool.filter(c => c.suit === info.suit);
    if (suitCards.length === 0) continue; // 该门已被扣绝（或已不在池中）
    if (pairUnitCount(suitCards) > 0) continue; // 有对 → 对子本身可垫
    const members = suitCards.filter(c => pointOf(c) === 0);
    if (members.length === 0) continue; // 无保护牌可留
    const pointSum = suitCards.reduce((s, c) => s + pointOf(c), 0);
    if (pointSum === 0) continue; // 无分牌
    const keeper = [...members].sort(cmpCard)[0];
    guards.push({ suit: info.suit, points: pointSum, members, keeper });
  }
  if (guards.length === 0) return sorted.slice(0, slots);

  const slack = sorted.length - slots;
  const keepers = guards.map(g => g.keeper.id);
  const guardIds = guards.map(g => g.members.map(c => c.id));

  // 按 分多 → SHCD 靠前 排序的保护优先级键（用于并列比较）。
  const rankKey = (g: JunkGuard): string =>
    `${String(g.points).padStart(3, '0')}:${String(99 - suitIdx(g.suit)).padStart(3, '0')}`;

  let best: GuardSolution | null = null;
  for (let mask = 0; mask < 1 << guards.length; mask++) {
    let ecount = 0;
    for (let i = 0; i < guards.length; i++) if (mask & (1 << i)) ecount++;
    if (ecount > slack) continue;
    const exempt = new Set<string>();
    for (let i = 0; i < guards.length; i++) if (mask & (1 << i)) exempt.add(keepers[i]);
    // 保留门的最小非分单牌移出候选，仍从最小开始取。
    const take: Card[] = [];
    const takeIds = new Set<string>();
    for (const c of sorted) {
      if (exempt.has(c.id)) continue;
      if (take.length >= slots) break;
      take.push(c);
      takeIds.add(c.id);
    }
    // 受害者：全部非分单牌都被取走、留在手中的只剩分牌的门（保留门除外——
    // 其 keeper 已移出候选，不可能被取走）。
    let vsum = 0;
    let vcount = 0;
    for (let i = 0; i < guards.length; i++) {
      if (mask & (1 << i)) continue;
      if (guardIds[i].every(id => takeIds.has(id))) {
        vsum += guards[i].points;
        vcount++;
      }
    }
    const cand: GuardSolution = {
      take,
      vsum,
      vcount,
      ecount,
      key: guards.filter((_, i) => mask & (1 << i)).map(rankKey).sort().reverse(),
    };
    if (best === null || better(cand, best)) best = cand;
  }
  return best ? best.take : sorted.slice(0, slots);
}

/** 一个保护方案：`take` 入底牌；保留门 = mask 对应门，其 keeper 留在手中。 */
interface GuardSolution {
  take: Card[];
  /** 受害门（留在手中的只剩分牌）总分。 */
  vsum: number;
  vcount: number;
  ecount: number;
  /** 保留门按 分多 → SHCD 靠前 排序的键，降序（并列决胜）。 */
  key: string[];
}

/** 方案比较：受害者总分少 → 受害者门数少 → 保留门数少 → 保留门按分多/SHCD 优。 */
function better(a: GuardSolution, b: GuardSolution): boolean {
  if (a.vsum !== b.vsum) return a.vsum < b.vsum;
  if (a.vcount !== b.vcount) return a.vcount < b.vcount;
  if (a.ecount !== b.ecount) return a.ecount < b.ecount;
  for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
    const ka = a.key[i];
    const kb = b.key[i];
    if (ka === undefined && kb === undefined) return false;
    if (kb === undefined) return true; // a 更长：同样键前缀下多保护一门
    if (ka === undefined) return false;
    if (ka !== kb) return ka > kb;
  }
  return false;
}

/** Unit comparator: off-suit by rank, trump by effective rank, then SHCD, then id. */
function unitCmp(config: TrumpDeclaration) {
  return (a: Card[], b: Card[]): number => {
    const ca = a[0];
    const cb = b[0];
    const ta = isTrump(ca, config) ? 1 : 0;
    const tb = isTrump(cb, config) ? 1 : 0;
    if (ta !== tb) return ta - tb;
    const va = isTrump(ca, config) ? getEffectiveRank(ca, config) : ca.rank;
    const vb = isTrump(cb, config) ? getEffectiveRank(cb, config) : cb.rank;
    if (va !== vb) return va - vb;
    const sa = suitIdx(ca.suit);
    const sb = suitIdx(cb.suit);
    if (sa !== sb) return sa - sb;
    const minId = (cards: Card[]) => cards.map(c => c.id).sort()[0];
    const ia = minId(a);
    const ib = minId(b);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  };
}

function suitIdx(s: CardSuit): number {
  const idx = SUIT_ORDER.indexOf(s as Suit);
  return idx >= 0 ? idx : 99;
}

/**
 * 分单桶（有主桶3 / 无主桶7）内排序：按价值档 5 → 10/K 依次取（K 的档与 10 相同，
 * 同级先 10 后 K）。同档内"扣掉即整门扣绝"的单张优先——该门其余牌（非分单牌等）
 * 已全部入底、手中只剩这一张时，扣它能清掉整门（不再留单张死分牌）；否则照旧
 * 从小到大、各花色一视同仁。并列按 SHCD → id。
 * 工厂在分组处理时以当时的池与已取集合调用——`taken` 含本梯更早桶取走的牌。
 */
function pointSingleSort(
  pool: Card[],
  taken: Set<string>,
): (a: Card[], b: Card[]) => number {
  const lastOfSuit = (c: Card): boolean =>
    !pool.some(x => x.suit === c.suit && x.id !== c.id && !taken.has(x.id));
  return (a: Card[], b: Card[]): number => {
    const ca = a[0];
    const cb = b[0];
    const la = lastOfSuit(ca);
    const lb = lastOfSuit(cb);
    const cls = (c: Card, lone: boolean): number =>
      c.rank === Rank.Five ? 0 : c.rank === Rank.Ten || lone ? 1 : 2;
    const cla = cls(ca, la);
    const clb = cls(cb, lb);
    if (cla !== clb) return cla - clb;
    if (la !== lb) return la ? -1 : 1;
    if (ca.rank !== cb.rank) return ca.rank - cb.rank;
    const sa = suitIdx(ca.suit);
    const sb = suitIdx(cb.suit);
    if (sa !== sb) return sa - sb;
    return ca.id < cb.id ? -1 : ca.id > cb.id ? 1 : 0;
  };
}

// ---- Suited fill ladder (⑤) ----

/**
 * Suited ladder:
 *   1 副牌非分单牌(不含tier1)    2 副牌非分对牌(不含tier1, 不拆对)
 *   3 副牌分单牌                  4 副牌分对牌(不拆对)
 *   5 主牌A以下非分单牌           6 副牌非分对牌(不含tier1, 拆对)
 *   7 副牌分对牌(拆对)            8 tier1(非分单→分单→非分对→分对,尽量不拆对)
 *   9 其他主牌(非分单→分单→非分对→分对,最后可拆)
 *
 * 桶 1（副牌非分单牌，不含 tier1）在进入梯前预取，候选多于槽位且存在
 * "脆弱花色"（不在扣绝门内、无控制张、只有单牌、带分牌）时为其留一张最小
 * 非分单牌（见 selectBucket1Singles），避免该门被抽成只剩分牌；否则照旧
 * 跨花色从小到大取。
 *
 * 桶 2 与桶 6 成员相同（副牌非分对，不含 tier1；tier2 对排在桶内后段）：
 * 桶 2 只整取不拆，桶 6 是它的可拆变体——奇数空槽走到桶 6 时拆最弱一张，
 * 只在桶 3 分单(超限/无货)与桶 5 主牌小单张都落空后才发生，即保留对子优先
 * 于拆对、0 分对拆对先于分对拆对/tier1/其他主牌。
 *
 * 桶 2/6 内排序：非 tier2 控制张的对先于 tier2 对；同级内该门总对数少的花色
 * 优先，总对数相同按对大小（rank 升序），再并列按 SHCD/id。
 *
 * 桶 3（分单）只在"0 分对放不下整对跳过、剩 1 槽进桶 3"时受主牌档位限额
 * 约束（见 runLadder 的 gatePoint）：取分单后 扣绝+分单 ≤ cap（主 ≤8→0、
 * 9→5、≥10→10）；超限则整桶跳过（不再就地拆 0 分对），奇数槽交给桶 5 的
 * 主牌小单张或桶 6 的拆对补足。桶 4 及之后各级不受限额约束。
 * 桶内排序（pointSingleSort）：按价值档 5 → 10/K 依次取（K 与 10 同级、先 10
 * 后 K），同档内"扣掉即整门扣绝"的单张优先（该门其余牌已入底、只剩这一张），
 * 并列按 SHCD → id。
 *
 * 常主（王与级牌）与主分（带分的主牌：主花色 5/10/K 与分级牌）永不扣入
 * 底牌——两类并集最多 18 张，33 张手牌中恒有 ≥8 张其它牌可扣。实现上
 * 直接把这类牌从填充池中剔除，梯与最后的拆对兜底自然都碰不到它们。
 */
function fillSuited(
  hand: Card[],
  usedIds: Set<string>,
  infos: OffSuitControlInfo[],
  config: TrumpDeclaration,
  slots: number,
  budget: number,
  onBucket?: (bucket: number) => void,
): Card[] {
  const tier1Ids = new Set<string>();
  const tier2Ids = new Set<string>();
  for (const info of infos) {
    for (const c of info.tier1) tier1Ids.add(c.id);
    for (const c of info.tier2) tier2Ids.add(c.id);
  }
  const isTier1 = (c: Card) => tier1Ids.has(c.id);
  const isTier2 = (c: Card) => tier2Ids.has(c.id);
  const offSuit = (c: Card) => !isTrump(c, config);
  const belowTrumpAce = (c: Card) =>
    c.rank < Rank.Ace && c.rank !== config.level && pointOf(c) === 0;
  const isForbiddenTrump = (c: Card): boolean =>
    isTrump(c, config)
    && (c.isJoker || c.rank === config.level || pointOf(c) > 0);

  const pool = hand.filter(c => !usedIds.has(c.id) && !isForbiddenTrump(c));
  // ---- 桶1 副牌非分单牌：预选取（跨花色从小到大；脆弱花色留一张保护牌）----
  const bucket1Ok = (c: Card): boolean => offSuit(c) && !isTier1(c) && pointOf(c) === 0;
  const { singles } = pairUnitsOf(pool);
  const bucket1 = selectBucket1Singles(singles.filter(bucket1Ok), slots, pool, infos, config);
  for (const c of bucket1) onBucket?.(1);
  const junkIds = new Set(bucket1.map(c => c.id));
  const restPool = pool.filter(c => !junkIds.has(c.id));
  const restSlots = slots - bucket1.length;
  // 桶2/6 排序: 各门总对数 = 整门在手对数（含 tier1/tier2 与待扣部分）。
  const suitTotalPairs = new Map<Suit, number>();
  for (const info of infos) suitTotalPairs.set(info.suit, pairUnitCount(info.cards));
  // 桶2/6 内顺序: 非 tier2 控制张的对先于 tier2 对 → 总对数少的花色优先 →
  // 对本身从小到大（unitCmp: rank → SHCD → id）。
  const bucket2PairSort = (a: Card[], b: Card[]): number => {
    const ta = isTier2(a[0]) ? 1 : 0;
    const tb = isTier2(b[0]) ? 1 : 0;
    if (ta !== tb) return ta - tb;
    const pa = suitTotalPairs.get(a[0].suit as Suit) ?? 0;
    const pb = suitTotalPairs.get(b[0].suit as Suit) ?? 0;
    if (pa !== pb) return pa - pb;
    return unitCmp(config)(a, b);
  };
  const nonPointOffPair = (c: Card): boolean =>
    offSuit(c) && !isTier1(c) && pointOf(c) === 0;
  const groups: LadderGroup[] = [
    // 桶2 副牌非分对牌 — 整对不拆。
    { kind: 'pair', bucket: 2, pairSort: bucket2PairSort, ok: nonPointOffPair },
    // 桶3 副牌分单牌 — gatePoint: 受主牌档位限额约束的分单桶。
    { kind: 'single', bucket: 3, gatePoint: true, singleSort: pointSingleSort, ok: c => offSuit(c) && !isTier1(c) && pointOf(c) > 0 },
    // 桶4 副牌分对牌（不拆对）
    { kind: 'pair', bucket: 4, ok: c => offSuit(c) && !isTier1(c) && pointOf(c) > 0 },
    // 桶5 主牌 A 以下非分单牌 — jokers (rank 15/16) and level cards excluded.
    { kind: 'single', bucket: 5, ok: c => isTrump(c, config) && belowTrumpAce(c) },
    // 桶6 副牌非分对牌（拆对）— 桶2 的可拆变体，奇数空槽拆最弱一张。
    { kind: 'pair', bucket: 6, pairSort: bucket2PairSort, ok: nonPointOffPair, split: true },
    // 桶7 副牌分对牌（拆对）
    { kind: 'pair', bucket: 7, ok: c => offSuit(c) && !isTier1(c) && pointOf(c) > 0, split: true },
    // 桶8 tier1 — keep until the ladder runs deep.
    { kind: 'single', bucket: 8, ok: c => isTier1(c) && pointOf(c) === 0 },
    { kind: 'single', bucket: 8, ok: c => isTier1(c) && pointOf(c) > 0 },
    { kind: 'pair', bucket: 8, ok: c => isTier1(c) && pointOf(c) === 0 },
    { kind: 'pair', bucket: 8, ok: c => isTier1(c) && pointOf(c) > 0 },
    // 桶9 其他主牌 — everything trump not consumed above.
    { kind: 'single', bucket: 9, ok: c => isTrump(c, config) && pointOf(c) === 0 },
    { kind: 'single', bucket: 9, ok: c => isTrump(c, config) && pointOf(c) > 0 },
    { kind: 'pair', bucket: 9, ok: c => isTrump(c, config) && pointOf(c) === 0 },
    { kind: 'pair', bucket: 9, ok: c => isTrump(c, config) && pointOf(c) > 0 },
    { kind: 'pair', bucket: 9, ok: c => isTrump(c, config), split: true },
  ];
  const kindOf = (c: Card): number =>
    isTrump(c, config) ? 2 : (isTier1(c) || isTier2(c) ? 1 : 0);
  return [...bucket1, ...runLadder(restPool, restSlots, groups, config, kindOf, budget, onBucket)];
}

// ---- NT fill ladder (⑧) ----

/**
 * NT ladder:
 *   1 非长 非分 非控制张 单牌    2 非长 非分 非控制张 对牌(不拆)
 *   3 长   非分 非控制张 单牌    4 非长 非分 非控制张 对牌(拆对)
 *   5 非长 非分 tier2(必要时拆对) 6 长   非分 tier2(必要时拆对)
 *   7 分单牌                      8 分对牌(整对)
 *   9 tier1(非分单→分单→非分对→分对,最后可拆)
 *
 * 不存在"长花色非分非控制张对牌"桶：长花色（总 ≥9 且控制 ≥6）的所有对牌
 * 都是控制张（tier1/tier2），非控制部分只剩单牌（桶 3）。
 *
 * 桶 1（非长 非分 非控制 单牌）在进入梯前预取，脆弱花色（带分、无控制、
 * 只有单牌）在候选多于槽位时留一张最小非分单牌（同有主，见
 * selectBucket1Singles）；长花色带 ≥6 控制张，天然不满足脆弱条件。
 *
 * 桶 2 与桶 4 成员相同（非长非分非控制对）：桶 2 整对不拆，桶 4 是可拆
 * 变体——奇数空槽走到桶 4 时拆最弱一张，先于 tier2 拆对与分单桶。
 * 桶 2/4 内排序：该门总对数少的花色优先，总对数相同按对大小，再并列按
 * SHCD/id（桶 5/6 tier2 不套用此排序）。
 *
 * 桶 7（分单）只在"0 分对放不下整对跳过、剩 1 槽进桶 7"时受加分限额约束
 * （扣绝 + 分单 ≤ cap：主 ≥3→5 分、<3→0）；超限整桶跳过，奇数槽交给末尾
 * 兜底，其余路径与之后各级不受限额约束。桶内排序同有主桶 3（pointSingleSort：
 * 价值档 5 → 10/K，同档"扣掉即整门扣绝"的单张优先，并列 SHCD → id）。
 */
function fillNT(
  hand: Card[],
  usedIds: Set<string>,
  infos: OffSuitControlInfo[],
  config: TrumpDeclaration,
  longSuits: Set<Suit>,
  slots: number,
  budget: number,
  onBucket?: (bucket: number) => void,
): Card[] {
  const tier1Ids = new Set<string>();
  const tier2Ids = new Set<string>();
  for (const info of infos) {
    for (const c of info.tier1) tier1Ids.add(c.id);
    for (const c of info.tier2) tier2Ids.add(c.id);
  }
  const isTier1 = (c: Card) => tier1Ids.has(c.id);
  const isTier2 = (c: Card) => tier2Ids.has(c.id);
  const isCtrl = (c: Card) => isTier1(c) || isTier2(c);
  const isLong = (c: Card) => longSuits.has(c.suit as Suit);
  // NT: trump cards never enter the bottom.
  const pool = hand.filter(c => !usedIds.has(c.id) && !isTrump(c, config));
  const nonPoint = (c: Card) => pointOf(c) === 0;
  // 桶2/4 排序: 各门总对数 = 整门在手对数; 桶内总对数少的花色优先 → 对大小 → SHCD/id
  //（无主桶 5/6 tier2 不套用此排序）。
  const suitTotalPairs = new Map<Suit, number>();
  for (const info of infos) suitTotalPairs.set(info.suit, pairUnitCount(info.cards));
  const bucket2PairSort = (a: Card[], b: Card[]): number => {
    const pa = suitTotalPairs.get(a[0].suit as Suit) ?? 0;
    const pb = suitTotalPairs.get(b[0].suit as Suit) ?? 0;
    if (pa !== pb) return pa - pb;
    return unitCmp(config)(a, b);
  };
  const nonLongNonCtrlNonPoint = (c: Card): boolean =>
    !isLong(c) && nonPoint(c) && !isCtrl(c);
  // ---- 桶1 非长 非分 非控制 单牌：预选取（留保护牌；长花色有控制不参与）----
  const { singles } = pairUnitsOf(pool);
  const bucket1 = selectBucket1Singles(
    singles.filter(nonLongNonCtrlNonPoint), slots, pool, infos, config,
  );
  for (const c of bucket1) onBucket?.(1);
  const junkIds = new Set(bucket1.map(c => c.id));
  const restPool = pool.filter(c => !junkIds.has(c.id));
  const restSlots = slots - bucket1.length;
  const groups: LadderGroup[] = [
    // 桶2 非长 非分 非控制张 对牌 — 整对不拆; pairSort: 总对数少的花色优先。
    { kind: 'pair', bucket: 2, pairSort: bucket2PairSort, ok: nonLongNonCtrlNonPoint },
    // 桶3 长花色 非分 非控制张 单牌
    { kind: 'single', bucket: 3, ok: c => isLong(c) && nonPoint(c) && !isCtrl(c) },
    // 桶4 非长 非分 非控制张 对牌（拆对）— 桶2 的可拆变体。
    { kind: 'pair', bucket: 4, pairSort: bucket2PairSort, ok: nonLongNonCtrlNonPoint, split: true },
    // 桶5 非长 非分 tier2（必要时拆对）
    { kind: 'pair', bucket: 5, ok: c => !isLong(c) && nonPoint(c) && isTier2(c), split: true },
    // 桶6 长花色 非分 tier2（必要时拆对）
    { kind: 'pair', bucket: 6, ok: c => isLong(c) && nonPoint(c) && isTier2(c), split: true },
    // 桶7 分单牌 — gatePoint: 受主牌档位限额约束的分单桶。
    { kind: 'single', bucket: 7, gatePoint: true, singleSort: pointSingleSort, ok: c => pointOf(c) > 0 && !isTier1(c) },
    // 桶8 分对牌（整对）
    { kind: 'pair', bucket: 8, ok: c => pointOf(c) > 0 && !isTier1(c) },
    // 桶9 tier1 last.
    { kind: 'single', bucket: 9, ok: c => isTier1(c) && nonPoint(c) },
    { kind: 'single', bucket: 9, ok: c => isTier1(c) && pointOf(c) > 0 },
    { kind: 'pair', bucket: 9, ok: c => isTier1(c) && nonPoint(c) },
    { kind: 'pair', bucket: 9, ok: c => isTier1(c) && pointOf(c) > 0 },
    { kind: 'pair', bucket: 9, ok: c => isTier1(c), split: true },
  ];
  const kindOf = (c: Card): number => (isCtrl(c) ? 1 : 0);
  return [...bucket1, ...runLadder(restPool, restSlots, groups, config, kindOf, budget, onBucket)];
}
