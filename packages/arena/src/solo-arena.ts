/**
 * 单副牌 A/B 竞技场的核心（纯计算，无 IO）。
 *
 * 每 **(副, 等级)** 打 3 局，同一副牌、同一等级、庄家固定 P0：
 *   L1 = [A, B]   P0/P2 = A  → 测 A 当庄（vs 基准）
 *   L0 = [B, B]   四家都 B   → 两块共用的基准
 *   L2 = [B, A]   P1/P3 = A  → 测 A 当闲（vs 同一基准）
 * L1 与 L0 只差 P0/P2，L2 与 L0 只差 P1/P3 —— 所以 3 局两两相减，A/B 的差异就从
 * 「发牌运气 / 座位」里剥出来了。闲家恒为队 1（P1/P3），`finalPts` 就是闲家得分。
 *
 * 庄家固定 P0 由 `playHand` 的既有行为给出：传 `declarerIdx: 0, isFirstHand: false`
 * 而不给 `forceDeclaration` 时，`finalizeReveal` 保留传入的庄家、只取亮主所得的花色
 * （无人亮主则按 P0 手牌自动定主）。也就是说**每条腿各跑自己的自然亮主**。
 */
import type { Card } from '@poker/engine';
import { deckForHand } from './rng.js';
import { playHand, dealtHands } from './match.js';
import { hasJokerPairDeal } from './nt-arena.js';
import type { HandEvent, Strategy } from './types.js';
import { passesDealFilters } from './solo-filter.js';

/**
 * 档位 = 升级量档：**0 分单列一档**（−1），其余按 ⌊闲家分 / 40⌋。
 *
 * 双升的升级量是一条阶梯（`computeLevelChange`）：0 分是大光、庄家升 3 级；
 * 5–35 分小光升 2 级；40–75 分保庄升 1 级；80–115 分上台不升；之后每 40 分再 +1 级。
 * 闲家得分恒为 5 的倍数，所以每一段就是 ⌊分/40⌋ 的一档——**前提是把 0 分单独拆出来**，
 * 否则大光与小光会并成同一档，等于把差 1 级的两个结果判成平局。
 */
export function tierOf(pts: number): number {
  return pts === 0 ? -1 : Math.floor(pts / 40);
}

/**
 * 档位口径胜负。`aWantsLower` 为真表示 A 希望分低（A 当庄），为假表示 A 希望分高
 * （A 当闲）。**第一个实参必须是 A 所在那条腿的分数**，否则方向会反过来。
 */
export function tierOutcome(ptsA: number, ptsBase: number, aWantsLower: boolean): 'a' | 'b' | 'draw' {
  const tA = tierOf(ptsA);
  const tB = tierOf(ptsBase);
  if (tA === tB) return 'draw';
  const aBetter = aWantsLower ? tA < tB : tA > tB;
  return aBetter ? 'a' : 'b';
}

/** 一侧一副牌的结果，已定向为「A 更好为正」。 */
export interface SideOutcome {
  /** 档位口径（A/B/平）。 */
  outcome: 'a' | 'b' | 'draw';
  /** 分差口径：闲家得分差（正 = A 更好）。 */
  d: number;
}

export interface Trial {
  banker: SideOutcome;
  attacker: SideOutcome;
}

/** 一副牌跑完所有等级的结果。 */
export interface SoloDealResult {
  dealIndex: number;
  /** 所有等级都被过滤掉（含 `--nt-only`）→ 整副不计入有效发牌。 */
  skipped: boolean;
  /** 只含**完整**跑完的等级；中止的三级组不在其中。 */
  perLevel: Map<number, Trial>;
  /** 中止的腿数（已计入全局「中止小局」）。 */
  abortedHands: number;
  /** 完整跑完的腿数（= perLevel.size × 3）。 */
  handsPlayed: number;
  /** 完整腿的墩数合计（供「每局平均墩数」）。 */
  tricksPlayed: number;
}

export interface SoloRunOptions {
  seed: number;
  dealIndex: number;
  levels: readonly number[];
  strategyA: Strategy;
  strategyB: Strategy;
  /** 只打无主：过滤掉四家都没有对王的发牌（有对王的自然亮主即无主）。 */
  ntOnly: boolean;
  /** 已注册的发牌过滤器名（见 solo-filter.ts）。 */
  dealFilters: readonly string[];
}

/**
 * 由三级组的闲家最终分拼出一对结果（p0 = 基准腿 L0，p1 = 庄家腿 L1，p2 = 闲家腿 L2）。
 * 闲家恒为队 1，`finalPts` 就是闲家得分，故两块都直接用它。
 */
export function trialFromPoints(p0: number, p1: number, p2: number): Trial {
  return {
    // 庄家测：A 当庄，闲家分越低越好 → d = pts(L0) − pts(L1)
    banker: { outcome: tierOutcome(p1, p0, true), d: p0 - p1 },
    // 闲家测：A 当闲，闲家分越高越好 → d = pts(L2) − pts(L0)
    attacker: { outcome: tierOutcome(p2, p0, false), d: p2 - p0 },
  };
}

/** 一副牌、一个等级的三级组：同一 deck、同一 level、庄家恒 P0。 */
function runTrial(
  deck: Card[], level: number, o: SoloRunOptions,
): { trial: Trial | null; aborted: number; tricks: number } {
  const base = {
    deck, handIndex: level, declarerIdx: 0, level, attackerLevel: level, isFirstHand: false,
  };
  const l1 = playHand({ ...base, strategies: [o.strategyA, o.strategyB] });
  const l0 = playHand({ ...base, strategies: [o.strategyB, o.strategyB] });
  const l2 = playHand({ ...base, strategies: [o.strategyB, o.strategyA] });
  if (l1.aborted || l0.aborted || l2.aborted) {
    // 4 个指标共用同一个 n，半个三级组会让档位/分差的分母对不上——整个三级组丢弃。
    return {
      trial: null,
      aborted: (l1.aborted ? 1 : 0) + (l0.aborted ? 1 : 0) + (l2.aborted ? 1 : 0),
      tricks: 0,
    };
  }
  return {
    trial: trialFromPoints(l0.finalPts, l1.finalPts, l2.finalPts),
    aborted: 0,
    tricks: l1.tricksPlayed + l0.tricksPlayed + l2.tricksPlayed,
  };
}

/** 跑一副牌的全部等级；同一副牌只发一次，各等级共用。 */
export function runSoloDeal(o: SoloRunOptions): SoloDealResult {
  const deck = deckForHand(o.seed, 0, o.dealIndex);
  const empty: SoloDealResult = {
    dealIndex: o.dealIndex, skipped: true, perLevel: new Map(),
    abortedHands: 0, handsPlayed: 0, tricksPlayed: 0,
  };
  if (o.ntOnly && !hasJokerPairDeal(deck)) return empty;

  const hands = dealtHands(deck);
  const perLevel = new Map<number, Trial>();
  let abortedHands = 0;
  let handsPlayed = 0;
  let tricksPlayed = 0;
  let tried = 0;
  for (const level of o.levels) {
    if (!passesDealFilters(o.dealFilters, { hands, deck, level })) continue;
    tried += 1;
    const r = runTrial(deck, level, o);
    abortedHands += r.aborted;
    if (r.trial === null) continue;
    perLevel.set(level, r.trial);
    handsPlayed += 3;
    tricksPlayed += r.tricks;
  }
  return { dealIndex: o.dealIndex, skipped: tried === 0, perLevel, abortedHands, handsPlayed, tricksPlayed };
}

// ---- accumulation ----

/** 档位口径的三分类计数。 */
export interface TierBucket {
  n: number;
  a: number;
  b: number;
  draw: number;
}

/** 分差口径：均值/方差 + 符号三分类计数。 */
export interface PairedBucket {
  n: number;
  sumD: number;
  sumD2: number;
  pos: number;
  neg: number;
  zero: number;
}

export interface SoloLevelStats {
  bankerTier: TierBucket;
  bankerPts: PairedBucket;
  attackerTier: TierBucket;
  attackerPts: PairedBucket;
}

export interface SoloStats {
  /** 只含请求的等级，升序。 */
  levels: Map<number, SoloLevelStats>;
  attemptedDeals: number;
  /** 至少在一个等级上试过的发牌数（= 有效发牌）。 */
  keptDeals: number;
  /** 所有等级都被过滤掉的发牌数。 */
  skippedDeals: number;
  handsPlayed: number;
  abortedHands: number;
  tricksPlayed: number;
}

const emptyTier = (): TierBucket => ({ n: 0, a: 0, b: 0, draw: 0 });
const emptyPaired = (): PairedBucket => ({ n: 0, sumD: 0, sumD2: 0, pos: 0, neg: 0, zero: 0 });

const emptyLevel = (): SoloLevelStats => ({
  bankerTier: emptyTier(), bankerPts: emptyPaired(),
  attackerTier: emptyTier(), attackerPts: emptyPaired(),
});

export function createSoloStats(levels: readonly number[]): SoloStats {
  return {
    levels: new Map(levels.map(lv => [lv, emptyLevel()])),
    attemptedDeals: 0, keptDeals: 0, skippedDeals: 0,
    handsPlayed: 0, abortedHands: 0, tricksPlayed: 0,
  };
}

function addTier(b: TierBucket, outcome: 'a' | 'b' | 'draw'): void {
  b.n += 1;
  if (outcome === 'a') b.a += 1;
  else if (outcome === 'b') b.b += 1;
  else b.draw += 1;
}

function addPaired(b: PairedBucket, d: number): void {
  b.n += 1;
  b.sumD += d;
  b.sumD2 += d * d;
  if (d > 0) b.pos += 1;
  else if (d < 0) b.neg += 1;
  else b.zero += 1;
}

function addTrial(st: SoloLevelStats, trial: Trial): void {
  addTier(st.bankerTier, trial.banker.outcome);
  addPaired(st.bankerPts, trial.banker.d);
  addTier(st.attackerTier, trial.attacker.outcome);
  addPaired(st.attackerPts, trial.attacker.d);
}

/** 把一副牌的结果并进累加器。 */
export function addSoloDeal(acc: SoloStats, res: SoloDealResult): void {
  acc.attemptedDeals += 1;
  acc.abortedHands += res.abortedHands;
  acc.handsPlayed += res.handsPlayed;
  acc.tricksPlayed += res.tricksPlayed;
  if (res.skipped) {
    acc.skippedDeals += 1;
    return;
  }
  acc.keptDeals += 1;
  for (const [level, trial] of res.perLevel) {
    const st = acc.levels.get(level);
    if (!st) continue; // 不在请求列表里的等级（防呆）
    addTrial(st, trial);
  }
}

/** 跑一段连续区间的发牌，合并进一个累加器。 */
export function runSoloDeals(
  seed: number,
  dealStart: number,
  dealCount: number,
  levels: readonly number[],
  strategyA: Strategy,
  strategyB: Strategy,
  ntOnly: boolean,
  dealFilters: readonly string[],
): SoloStats {
  const acc = createSoloStats(levels);
  for (let k = dealStart; k < dealStart + dealCount; k++) {
    addSoloDeal(acc, runSoloDeal({ seed, dealIndex: k, levels, strategyA, strategyB, ntOnly, dealFilters }));
  }
  return acc;
}

function addTierInto(into: TierBucket, from: TierBucket): void {
  into.n += from.n;
  into.a += from.a;
  into.b += from.b;
  into.draw += from.draw;
}

function addPairedInto(into: PairedBucket, from: PairedBucket): void {
  into.n += from.n;
  into.sumD += from.sumD;
  into.sumD2 += from.sumD2;
  into.pos += from.pos;
  into.neg += from.neg;
  into.zero += from.zero;
}

function addLevelInto(into: SoloLevelStats, from: SoloLevelStats): void {
  addTierInto(into.bankerTier, from.bankerTier);
  addPairedInto(into.bankerPts, from.bankerPts);
  addTierInto(into.attackerTier, from.attackerTier);
  addPairedInto(into.attackerPts, from.attackerPts);
}

export function mergeSoloStats(a: SoloStats, b: SoloStats): SoloStats {
  const levels = new Map<number, SoloLevelStats>();
  for (const [lv, st] of a.levels) levels.set(lv, st);
  for (const [lv, st] of b.levels) {
    const into = levels.get(lv);
    if (!into) levels.set(lv, st);
    else addLevelInto(into, st);
  }
  const sorted = new Map([...levels.entries()].sort((x, y) => x[0] - y[0]));
  return {
    levels: sorted,
    attemptedDeals: a.attemptedDeals + b.attemptedDeals,
    keptDeals: a.keptDeals + b.keptDeals,
    skippedDeals: a.skippedDeals + b.skippedDeals,
    handsPlayed: a.handsPlayed + b.handsPlayed,
    abortedHands: a.abortedHands + b.abortedHands,
    tricksPlayed: a.tricksPlayed + b.tricksPlayed,
  };
}

export function soloStatsToJSON(s: SoloStats): Record<string, unknown> {
  const levels: Record<string, SoloLevelStats> = {};
  for (const [lv, st] of s.levels) levels[String(lv)] = st;
  return {
    levels,
    attemptedDeals: s.attemptedDeals,
    keptDeals: s.keptDeals,
    skippedDeals: s.skippedDeals,
    handsPlayed: s.handsPlayed,
    abortedHands: s.abortedHands,
    tricksPlayed: s.tricksPlayed,
  };
}

export function soloStatsFromJSON(j: Record<string, any>): SoloStats {
  const levels = new Map<number, SoloLevelStats>();
  for (const [k, v] of Object.entries(j.levels as Record<string, SoloLevelStats>)) {
    levels.set(Number(k), v);
  }
  return {
    levels: new Map([...levels.entries()].sort((x, y) => x[0] - y[0])),
    attemptedDeals: j.attemptedDeals,
    keptDeals: j.keptDeals,
    skippedDeals: j.skippedDeals,
    handsPlayed: j.handsPlayed,
    abortedHands: j.abortedHands,
    tricksPlayed: j.tricksPlayed,
  };
}
