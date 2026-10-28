/**
 * Deal 竞技场的核心（纯计算，无 IO）。
 *
 * 统计单位是**发牌**。每（副, 等级）按 `declarerSeats` 指定的庄位逐个坐庄
 * （默认固定 P0；`all` = 四庄位轮转）；每个庄位打三腿（同一 deck、同一 level、同一庄位）：
 *
 *   AB = [A,B]  A 当庄、B 当闲 → 闲家分 pAB（B 的防守表现）
 *   BA = [B,A]  B 当庄、A 当闲 → 闲家分 pBA（A 的防守表现）
 *   BB = [B,B]  四家都 B          → 闲家分 pBB（公共基准）
 *
 * 两项指标各有三种角色口径，正数都表示 A 更好：
 *   总体   tier(pBA) − tier(pAB)     分差 pBA − pAB      （AB 对 BA）
 *   庄家   tier(pBB) − tier(pAB)     分差 pBB − pAB      （AB 对 BB）
 *   闲家   tier(pBA) − tier(pBB)     分差 pBA − pBB      （BA 对 BB）
 *
 * 场景 = 等级 × 主牌 × 角色。等级=总体时主牌与角色可组合（9 种）；单等级行只
 * 细分主牌（角色=总体）。主牌口径按**被比较的两条腿**的实际 `trumpSuit` 判定：
 * 两条腿都为有主 / 都为无主才计入有主 / 无主行，混合只进“主牌=总体”行。
 *
 * 净升级按发牌多数决：一副牌内该场景的合格三元组按符号计数，多者胜、相等算平；
 * 显著性检验跑在这组「发牌胜负」计数上（平局折 0.5）。分差先按副求合格三元组
 * 均值、再跨副汇总，n 的单位是发牌。没有合格三元组的发牌不计入该场景。
 *
 * 中止小局不整组作废：`playHand` 已按肇事方给出结算分（见 abort-settlement.ts），
 * 这里照常使用，并把 `settledHands / settledByBanker / settledByAttacker` 计入诊断。
 */
import { Rank } from '@poker/engine';
import type { Card } from '@poker/engine';
import { deckForHand, deckStream } from './rng.js';
import type { ArenaSeed } from './rng.js';
import { playHand, dealtHands, naturalDeclaration } from './match.js';
import type { HandEvent, Strategy } from './types.js';
import {
  createStats, addHandStats, mergeStats, toJSON as statsToJSON, fromJSON as statsFromJSON,
} from './stats.js';
import type { StrategyStats } from './stats.js';
import { tierOf, emptyTier, addTier } from './tier.js';
import type { TierBucket } from './tier.js';
import { emptyPaired, addPaired, mergePaired } from './intervals.js';
import type { PairedBucket } from './intervals.js';
import { passesDealFilters } from './deal-filter.js';

export const ALL_DECLARER_SEATS: readonly DeclarerIdx[] = [0, 1, 2, 3];
/** 默认固定 P0 坐庄：每副每等级 1 个三元组，等手数下有 4 倍独立发牌。 */
export const DEFAULT_DECLARER_SEATS: readonly DeclarerIdx[] = [0];
export const HANDS_PER_TRIPLE = 3;

/**
 * 解析 `--declarer-seats`：`all` = P0..P3 轮转；否则逗号分隔的 0..3。
 * 去重、升序；非法项报错并指出该项。
 */
export function parseDeclarerSeats(spec: string): DeclarerIdx[] {
  const trimmed = spec.trim();
  if (trimmed === '') throw new Error('--declarer-seats 不能为空（可用 0 或 all）');
  if (trimmed.toLowerCase() === 'all') return [...ALL_DECLARER_SEATS];

  const out = new Set<DeclarerIdx>();
  for (const raw of trimmed.split(',')) {
    const token = raw.trim();
    if (token === '') throw new Error(`--declarer-seats 含空项: 「${spec}」`);
    if (!/^[0-3]$/.test(token)) {
      throw new Error(`--declarer-seats 非法庄位: ${token}（可用 0..3，或 all）`);
    }
    out.add(Number(token) as DeclarerIdx);
  }
  return [...out].sort((a, b) => a - b);
}

export type DeclarerIdx = 0 | 1 | 2 | 3;
export type LegKind = 'AB' | 'BA' | 'BB';
export type Outcome = 'a' | 'b' | 'draw';
export type DealSkipReason = 'deal-filter';

export interface TripleMetrics {
  tierNorthStar: number;
  tierDeclarerGain: number;
  tierDefenderGain: number;
  ptsNorthStar: number;
  ptsDeclarerGain: number;
  ptsDefenderGain: number;
  /** sign(tierNorthStar)。 */
  outcome: Outcome;
}

export interface Triple {
  level: number;
  declarerIdx: DeclarerIdx;
  /** 三条腿的闲家最终分（已含中止结算）。 */
  ab: number;
  ba: number;
  bb: number;
  metrics: TripleMetrics;
  eventAB: HandEvent;
  eventBA: HandEvent;
  eventBB: HandEvent;
  /** 该三元组里已结算的中止腿数。 */
  settledHands: number;
}

export type ScenarioSuit = 'overall' | 'suited' | 'nt';
export type ScenarioRole = 'overall' | 'declarer' | 'defender';

/** 场景：等级（null = 总体）× 主牌 × 角色。等级行恒为 role='overall'。 */
export interface Scenario {
  level: number | null;
  suit: ScenarioSuit;
  role: ScenarioRole;
}

/** 一个场景的统计：发牌级净升级三分类 + 按副均值的分差配对桶。 */
export interface ScenarioStats {
  tier: TierBucket;
  pts: PairedBucket;
}

/** 北极星场景：全部等级、主牌=总体、角色=总体。 */
export const CORE_SCENARIO: Scenario = { level: null, suit: 'overall', role: 'overall' };

export function scenarioKey(s: Scenario): string {
  return `${s.level === null ? '*' : s.level}|${s.suit}|${s.role}`;
}

/**
 * 报告中的场景矩阵：等级=总体时 3 主牌 × 3 角色 = 9 种；多等级时每个等级
 * 再出 3 个主牌行（角色=总体）。单等级不展开等级行。
 */
export function scenariosForLevels(levels: readonly number[]): Scenario[] {
  const out: Scenario[] = [];
  for (const suit of ['overall', 'suited', 'nt'] as const) {
    for (const role of ['overall', 'declarer', 'defender'] as const) {
      out.push({ level: null, suit, role });
    }
  }
  if (levels.length > 1) {
    for (const level of levels) {
      for (const suit of ['overall', 'suited', 'nt'] as const) {
        out.push({ level, suit, role: 'overall' });
      }
    }
  }
  return out;
}

/** 该三元组在场景下“被比较的两条腿”。 */
function comparedLegs(t: Triple, role: ScenarioRole): [HandEvent, HandEvent] {
  if (role === 'declarer') return [t.eventAB, t.eventBB];
  if (role === 'defender') return [t.eventBA, t.eventBB];
  return [t.eventAB, t.eventBA];
}

function legsMatchSuit(legs: readonly [HandEvent, HandEvent], suit: ScenarioSuit): boolean {
  if (suit === 'overall') return true;
  return legs.every(ev => suit === 'suited' ? ev.trumpSuit !== null : ev.trumpSuit === null);
}

/** 三元组是否进入该场景（等级 + 被比较两腿的主牌类型）。 */
export function tripleInScenario(t: Triple, s: Scenario): boolean {
  if (s.level !== null && t.level !== s.level) return false;
  return legsMatchSuit(comparedLegs(t, s.role), s.suit);
}

function tierOfRole(t: Triple, role: ScenarioRole): number {
  if (role === 'declarer') return t.metrics.tierDeclarerGain;
  if (role === 'defender') return t.metrics.tierDefenderGain;
  return t.metrics.tierNorthStar;
}

function ptsOfRole(t: Triple, role: ScenarioRole): number {
  if (role === 'declarer') return t.metrics.ptsDeclarerGain;
  if (role === 'defender') return t.metrics.ptsDefenderGain;
  return t.metrics.ptsNorthStar;
}

export interface DealRunConfig {
  /** 64 位 base seed；发牌 k = 链 0 的 deck 流第 k 次抽取。 */
  seed: ArenaSeed;
  levels: readonly number[];
  strategyA: Strategy;
  strategyB: Strategy;
  dealFilters: readonly string[];
  /** 坐庄的座位；默认固定 P0，`ALL_DECLARER_SEATS` = 四庄位轮转。 */
  declarerSeats?: readonly DeclarerIdx[];
}

export interface DealSweepOptions extends DealRunConfig {
  dealIndex: number;
  /**
   * 已从链 0 的 deck 流抽到的这一副牌。连续发牌时由 `runDealDeals` 传入，
   * 避免按 dealIndex 重放整条流；缺省时由 seed + dealIndex 现场重放。
   */
  deck?: Card[];
}

export interface DealSweepResult {
  dealIndex: number;
  skipReason: DealSkipReason | null;
  triples: Triple[];
  handsPlayed: number;
  abortedHands: number;
  settledHands: number;
  settledByBanker: number;
  settledByAttacker: number;
  tricksPlayed: number;
}

/** 由三条腿的闲家分拼出六项指标与北极星三分类。 */
export function tripleMetrics(ab: number, ba: number, bb: number): TripleMetrics {
  const tAB = tierOf(ab);
  const tBA = tierOf(ba);
  const tBB = tierOf(bb);
  const tierNorthStar = tBA - tAB;
  return {
    tierNorthStar,
    tierDeclarerGain: tBB - tAB,
    tierDefenderGain: tBA - tBB,
    ptsNorthStar: ba - ab,
    ptsDeclarerGain: bb - ab,
    ptsDefenderGain: ba - bb,
    outcome: signOf(tierNorthStar),
  };
}

export function signOf(d: number): Outcome {
  return d > 0 ? 'a' : d < 0 ? 'b' : 'draw';
}

/**
 * 策略落位：`[A,B]` / `[B,A]` 描述的是**角色**（第一个 = 庄家策略），
 * 不是字面元组。座位 0/2 用 strategies[0]，1/3 用 strategies[1]。
 */
export function strategiesForLeg(
  declarerIdx: DeclarerIdx,
  leg: LegKind,
  strategyA: Strategy,
  strategyB: Strategy,
): [Strategy, Strategy] {
  const declarer = leg === 'AB' ? strategyA : strategyB;
  const defender = leg === 'BA' ? strategyA : strategyB;
  return declarerIdx % 2 === 0 ? [declarer, defender] : [defender, declarer];
}

/** 该腿里策略 A 所在的奇偶队；BB 腿没有 A，返回 null。 */
export function aParityForLeg(declarerIdx: DeclarerIdx, leg: LegKind): 0 | 1 | null {
  if (leg === 'BB') return null;
  const declarerParity = (declarerIdx % 2) as 0 | 1;
  return leg === 'AB' ? declarerParity : ((1 - declarerParity) as 0 | 1);
}

/** 四家任一人的 25 张手牌里同时有两张大王或两张小王。底牌不算（亮主在拿底牌前）。 */
export function hasJokerPairDeal(deck: Card[]): boolean {
  return dealtHands(deck).some(hand =>
    hand.filter(c => c.rank === Rank.BigJoker).length >= 2
    || hand.filter(c => c.rank === Rank.SmallJoker).length >= 2);
}

/**
 * 等级过滤器：对每个配置的庄位用该庄位 `[B,B]` 的自然亮主判一次，任一庄位通过
 * 即保留该 `(副, 等级)`，之后只打这些配置庄位。
 */
export function levelPassesDealFilters(
  deck: Card[],
  hands: readonly Card[][],
  level: number,
  filters: readonly string[],
  strategyB: Strategy,
  declarerSeats: readonly DeclarerIdx[] = DEFAULT_DECLARER_SEATS,
): boolean {
  if (filters.length === 0) return true;
  for (const seat of declarerSeats) {
    const decl = naturalDeclaration(deck, seat, level, false, [strategyB, strategyB]);
    if (passesDealFilters(filters, { hands, deck, level, decl })) return true;
  }
  return false;
}

function emptySweep(dealIndex: number): DealSweepResult {
  return {
    dealIndex, skipReason: null, triples: [],
    handsPlayed: 0, abortedHands: 0, settledHands: 0,
    settledByBanker: 0, settledByAttacker: 0, tricksPlayed: 0,
  };
}

/** 跑一副牌的全部等级、配置庄位、三腿。同一副牌只发一次。 */
export function runDealSweep(o: DealSweepOptions): DealSweepResult {
  const deck = o.deck ?? deckForHand(o.seed, 0, o.dealIndex);
  const declarerSeats = o.declarerSeats ?? DEFAULT_DECLARER_SEATS;
  if (declarerSeats.length === 0) throw new Error('declarerSeats 不能为空');
  const out = emptySweep(o.dealIndex);

  const hands = o.dealFilters.length > 0 ? dealtHands(deck) : [];
  let keptLevels = 0;
  for (const level of o.levels) {
    if (!levelPassesDealFilters(
      deck, hands, level, o.dealFilters, o.strategyB, declarerSeats,
    )) continue;
    keptLevels += 1;

    for (const declarerIdx of declarerSeats) {
      const base = {
        deck, handIndex: level, declarerIdx, level, attackerLevel: level, isFirstHand: false,
      };
      const eventAB = playHand({
        ...base, strategies: strategiesForLeg(declarerIdx, 'AB', o.strategyA, o.strategyB),
      });
      const eventBA = playHand({
        ...base, strategies: strategiesForLeg(declarerIdx, 'BA', o.strategyA, o.strategyB),
      });
      const eventBB = playHand({
        ...base, strategies: strategiesForLeg(declarerIdx, 'BB', o.strategyA, o.strategyB),
      });

      let settledHands = 0;
      for (const ev of [eventAB, eventBA, eventBB]) {
        out.handsPlayed += 1;
        if (ev.aborted) {
          out.abortedHands += 1;
          if (ev.settled) {
            settledHands += 1;
            out.settledHands += 1;
            if (ev.abortCause === 'banker') out.settledByBanker += 1;
            else out.settledByAttacker += 1;
          }
        }
        out.tricksPlayed += ev.tricksPlayed;
      }

      out.triples.push({
        level, declarerIdx,
        ab: eventAB.finalPts, ba: eventBA.finalPts, bb: eventBB.finalPts,
        metrics: tripleMetrics(eventAB.finalPts, eventBA.finalPts, eventBB.finalPts),
        eventAB, eventBA, eventBB, settledHands,
      });
    }
  }

  if (keptLevels === 0) out.skipReason = 'deal-filter';
  return out;
}

// ---- stats ----

/** 三元组级三分类 + 六项按副均值桶。 */
export interface DealSplitStats {
  tierNorthStar: PairedBucket;
  tierDeclarerGain: PairedBucket;
  tierDefenderGain: PairedBucket;
  ptsNorthStar: PairedBucket;
  ptsDeclarerGain: PairedBucket;
  ptsDefenderGain: PairedBucket;
  /** 三元组级北极星三分类。 */
  outcome: TierBucket;
  /** 三元组级旧 solo「庄家升级」。 */
  tierDeclarer: TierBucket;
  /** 三元组级旧 solo「闲家升级」。 */
  tierDefender: TierBucket;
  triples: number;
}

/**
 * 小局分析里胜率类指标的逐副配对差（A 胜率 − B 胜率）。
 * 每副牌只加一次；两条腿都有可用样本才计。
 */
export interface WinRateStats {
  overall: PairedBucket;
  banker: PairedBucket;
  attacker: PairedBucket;
  bankerByLevel: Map<number, PairedBucket>;
  attackerByLevel: Map<number, PairedBucket>;
}

export interface DealStats {
  overall: DealSplitStats;
  levels: Map<number, DealSplitStats>;
  seats: Map<DeclarerIdx, DealSplitStats>;
  /** (等级 × 庄位) 交叉桶，键 `${level}:${seat}`。 */
  levelSeats: Map<string, DealSplitStats>;
  /** 场景矩阵（见 scenariosForLevels）；发牌级净升级 + 按副分差。 */
  scenarios: Map<string, ScenarioStats>;
  /** 小局分析胜率类指标的逐副配对桶。 */
  winRates: WinRateStats;
  /** 发牌口径：多数决。驱动显著性。 */
  dealOutcome: TierBucket;
  /** 80 分口径，只喂 AB/BA 两腿。 */
  statsA: StrategyStats;
  statsB: StrategyStats;
  handWinsA: number;
  handWinsB: number;
  attemptedDeals: number;
  acceptedDeals: number;
  skippedDeals: number;
  filterSkippedDeals: number;
  handsPlayed: number;
  abortedHands: number;
  settledHands: number;
  settledByBanker: number;
  settledByAttacker: number;
  tricksPlayed: number;
}

const emptySplit = (): DealSplitStats => ({
  tierNorthStar: emptyPaired(),
  tierDeclarerGain: emptyPaired(),
  tierDefenderGain: emptyPaired(),
  ptsNorthStar: emptyPaired(),
  ptsDeclarerGain: emptyPaired(),
  ptsDefenderGain: emptyPaired(),
  outcome: emptyTier(),
  tierDeclarer: emptyTier(),
  tierDefender: emptyTier(),
  triples: 0,
});

const emptyScenarioStats = (): ScenarioStats => ({ tier: emptyTier(), pts: emptyPaired() });

function emptyWinRates(levels: readonly number[]): WinRateStats {
  return {
    overall: emptyPaired(),
    banker: emptyPaired(),
    attacker: emptyPaired(),
    bankerByLevel: new Map(levels.map(lv => [lv, emptyPaired()])),
    attackerByLevel: new Map(levels.map(lv => [lv, emptyPaired()])),
  };
}

export function createDealStats(
  levels: readonly number[],
  declarerSeats: readonly DeclarerIdx[] = DEFAULT_DECLARER_SEATS,
): DealStats {
  if (declarerSeats.length === 0) throw new Error('declarerSeats 不能为空');
  const levelSeats = new Map<string, DealSplitStats>();
  for (const level of levels) {
    for (const seat of declarerSeats) levelSeats.set(`${level}:${seat}`, emptySplit());
  }
  const scenarios = new Map<string, ScenarioStats>();
  for (const scenario of scenariosForLevels(levels)) {
    scenarios.set(scenarioKey(scenario), emptyScenarioStats());
  }
  return {
    overall: emptySplit(),
    levels: new Map(levels.map(lv => [lv, emptySplit()])),
    seats: new Map(declarerSeats.map(seat => [seat, emptySplit()])),
    levelSeats,
    scenarios,
    winRates: emptyWinRates(levels),
    dealOutcome: emptyTier(),
    statsA: createStats(),
    statsB: createStats(),
    handWinsA: 0,
    handWinsB: 0,
    attemptedDeals: 0,
    acceptedDeals: 0,
    skippedDeals: 0,
    filterSkippedDeals: 0,
    handsPlayed: 0,
    abortedHands: 0,
    settledHands: 0,
    settledByBanker: 0,
    settledByAttacker: 0,
    tricksPlayed: 0,
  };
}

/** 三元组的六项均值（按副汇总用）。 */
export function meanTripleMetrics(triples: readonly Triple[]): Omit<TripleMetrics, 'outcome'> {
  const n = triples.length;
  const sum = (pick: (m: TripleMetrics) => number): number =>
    triples.reduce((s, t) => s + pick(t.metrics), 0) / n;
  return {
    tierNorthStar: sum(m => m.tierNorthStar),
    tierDeclarerGain: sum(m => m.tierDeclarerGain),
    tierDefenderGain: sum(m => m.tierDefenderGain),
    ptsNorthStar: sum(m => m.ptsNorthStar),
    ptsDeclarerGain: sum(m => m.ptsDeclarerGain),
    ptsDefenderGain: sum(m => m.ptsDefenderGain),
  };
}

/** 把一个分组的三元组并进 split：三分类逐三元组，六项均值每副只记一次。 */
function addSplit(split: DealSplitStats, triples: readonly Triple[]): void {
  if (triples.length === 0) return;
  for (const t of triples) {
    addTier(split.outcome, t.metrics.outcome);
    addTier(split.tierDeclarer, signOf(t.metrics.tierDeclarerGain));
    addTier(split.tierDefender, signOf(t.metrics.tierDefenderGain));
    split.triples += 1;
  }
  const mean = meanTripleMetrics(triples);
  addPaired(split.tierNorthStar, mean.tierNorthStar);
  addPaired(split.tierDeclarerGain, mean.tierDeclarerGain);
  addPaired(split.tierDefenderGain, mean.tierDefenderGain);
  addPaired(split.ptsNorthStar, mean.ptsNorthStar);
  addPaired(split.ptsDeclarerGain, mean.ptsDeclarerGain);
  addPaired(split.ptsDefenderGain, mean.ptsDefenderGain);
}

function getOrCreate<T>(map: Map<T, DealSplitStats>, key: T): DealSplitStats {
  let split = map.get(key);
  if (!split) { split = emptySplit(); map.set(key, split); }
  return split;
}

function getOrCreatePaired<K>(map: Map<K, PairedBucket>, key: K): PairedBucket {
  let bucket = map.get(key);
  if (!bucket) { bucket = emptyPaired(); map.set(key, bucket); }
  return bucket;
}

/**
 * 场景统计：每副牌在每个场景内只记一次。
 * 净升级 = 合格三元组按符号多数决（多者胜、相等平）；分差 = 合格三元组均值。
 * 没有任何合格三元组的发牌不进该场景（分母只数参与本场景的发牌）。
 */
function addScenarioStats(acc: DealStats, triples: readonly Triple[]): void {
  const levels = [...acc.levels.keys()];
  for (const scenario of scenariosForLevels(levels)) {
    const split = acc.scenarios.get(scenarioKey(scenario));
    if (!split) continue;
    const eligible = triples.filter(t => tripleInScenario(t, scenario));
    if (eligible.length === 0) continue;

    let a = 0;
    let b = 0;
    for (const t of eligible) {
      const d = tierOfRole(t, scenario.role);
      if (d > 0) a += 1;
      else if (d < 0) b += 1;
    }
    const outcome: Outcome = a > b ? 'a' : b > a ? 'b' : 'draw';
    addTier(split.tier, outcome);
    addPaired(
      split.pts,
      eligible.reduce((sum, t) => sum + ptsOfRole(t, scenario.role), 0) / eligible.length,
    );

    if (scenario.level === null && scenario.suit === 'overall' && scenario.role === 'overall') {
      addTier(acc.dealOutcome, outcome);
    }
  }
}

interface RateTally {
  aWins: number;
  aHands: number;
  bWins: number;
  bHands: number;
}

const emptyRateTally = (): RateTally => ({ aWins: 0, aHands: 0, bWins: 0, bHands: 0 });

/** AB = A 当庄，BA = B 当庄；未结算中止腿与 80 分口径一样不进分母。 */
function tallyRates(triples: readonly Triple[]): {
  overall: RateTally;
  banker: RateTally;
  attacker: RateTally;
} {
  const overall = emptyRateTally();
  const banker = emptyRateTally();
  const attacker = emptyRateTally();
  for (const t of triples) {
    const ab = t.eventAB;
    const ba = t.eventBA;
    if (!(ab.aborted && !ab.settled)) {
      const aWin = ab.bankerWon ? 1 : 0;
      overall.aWins += aWin;
      overall.aHands += 1;
      overall.bWins += 1 - aWin;
      overall.bHands += 1;
      banker.aWins += aWin;
      banker.aHands += 1;
      attacker.bWins += 1 - aWin;
      attacker.bHands += 1;
    }
    if (!(ba.aborted && !ba.settled)) {
      const bWin = ba.bankerWon ? 1 : 0;
      overall.aWins += 1 - bWin;
      overall.aHands += 1;
      overall.bWins += bWin;
      overall.bHands += 1;
      banker.bWins += bWin;
      banker.bHands += 1;
      attacker.aWins += 1 - bWin;
      attacker.aHands += 1;
    }
  }
  return { overall, banker, attacker };
}

function addRateDiff(bucket: PairedBucket, tally: RateTally): void {
  if (tally.aHands === 0 || tally.bHands === 0) return;
  addPaired(bucket, tally.aWins / tally.aHands - tally.bWins / tally.bHands);
}

/** 小局分析胜率类指标的逐副配对差（每副只加一次）。 */
function addWinRates(acc: DealStats, triples: readonly Triple[]): void {
  const all = tallyRates(triples);
  addRateDiff(acc.winRates.overall, all.overall);
  addRateDiff(acc.winRates.banker, all.banker);
  addRateDiff(acc.winRates.attacker, all.attacker);

  const byLevel = new Map<number, Triple[]>();
  for (const t of triples) {
    const group = byLevel.get(t.level);
    if (group) group.push(t); else byLevel.set(t.level, [t]);
  }
  for (const [level, group] of byLevel) {
    const rates = tallyRates(group);
    addRateDiff(getOrCreatePaired(acc.winRates.bankerByLevel, level), rates.banker);
    addRateDiff(getOrCreatePaired(acc.winRates.attackerByLevel, level), rates.attacker);
  }
}

/** 把一副牌的扫描结果并进累加器。 */
export function addDealSweep(acc: DealStats, res: DealSweepResult): void {
  acc.attemptedDeals += 1;
  if (res.skipReason !== null) {
    acc.skippedDeals += 1;
    acc.filterSkippedDeals += 1;
    return;
  }
  acc.acceptedDeals += 1;
  acc.handsPlayed += res.handsPlayed;
  acc.abortedHands += res.abortedHands;
  acc.settledHands += res.settledHands;
  acc.settledByBanker += res.settledByBanker;
  acc.settledByAttacker += res.settledByAttacker;
  acc.tricksPlayed += res.tricksPlayed;

  const triples = res.triples;
  if (triples.length === 0) return; // 理论上不会：keep 的等级总会产出 4 个三元组

  addSplit(acc.overall, triples);

  const byLevel = new Map<number, Triple[]>();
  const bySeat = new Map<DeclarerIdx, Triple[]>();
  const byLevelSeat = new Map<string, Triple[]>();
  for (const t of triples) {
    const ls = byLevel.get(t.level);
    if (ls) ls.push(t); else byLevel.set(t.level, [t]);
    const ss = bySeat.get(t.declarerIdx);
    if (ss) ss.push(t); else bySeat.set(t.declarerIdx, [t]);
    const key = `${t.level}:${t.declarerIdx}`;
    const lss = byLevelSeat.get(key);
    if (lss) lss.push(t); else byLevelSeat.set(key, [t]);
  }
  for (const [level, group] of byLevel) addSplit(getOrCreate(acc.levels, level), group);
  for (const [seat, group] of bySeat) addSplit(getOrCreate(acc.seats, seat), group);
  for (const [key, group] of byLevelSeat) addSplit(getOrCreate(acc.levelSeats, key), group);

  addScenarioStats(acc, triples);
  addWinRates(acc, triples);

  // 80 分口径（只喂 AB/BA）。
  for (const t of triples) {
    const parityAB = (t.declarerIdx % 2) as 0 | 1;
    const parityBA = (1 - parityAB) as 0 | 1;
    addHandStats(acc.statsA, t.eventAB, parityAB);
    addHandStats(acc.statsB, t.eventAB, (1 - parityAB) as 0 | 1);
    addHandStats(acc.statsA, t.eventBA, parityBA);
    addHandStats(acc.statsB, t.eventBA, (1 - parityBA) as 0 | 1);

    for (const [ev, aParity] of [
      [t.eventAB, parityAB] as const,
      [t.eventBA, parityBA] as const,
    ]) {
      if (ev.aborted && !ev.settled) continue;
      const aIsBanker = ev.teamBanker === aParity;
      const aWon = aIsBanker ? ev.bankerWon : !ev.bankerWon;
      if (aWon) acc.handWinsA += 1;
      else acc.handWinsB += 1;
    }
  }
}

/** 跑一段连续区间的发牌，合并进一个累加器。 */
export function runDealDeals(
  seed: ArenaSeed,
  dealStart: number,
  dealCount: number,
  levels: readonly number[],
  strategyA: Strategy,
  strategyB: Strategy,
  dealFilters: readonly string[],
  declarerSeats: readonly DeclarerIdx[] = DEFAULT_DECLARER_SEATS,
): DealStats {
  const acc = createDealStats(levels, declarerSeats);
  // 顺序流：先快进到 dealStart，再连续取牌；与逐 dealIndex 重放等价。
  const nextDeck = deckStream(seed, 0);
  for (let k = 0; k < dealStart; k++) nextDeck();
  for (let k = dealStart; k < dealStart + dealCount; k++) {
    addDealSweep(acc, runDealSweep({
      seed, dealIndex: k, deck: nextDeck(), levels, strategyA, strategyB, dealFilters, declarerSeats,
    }));
  }
  return acc;
}

// ---- merge / JSON ----

function mergeTier(a: TierBucket, b: TierBucket): TierBucket {
  return { n: a.n + b.n, a: a.a + b.a, b: a.b + b.b, draw: a.draw + b.draw };
}

export function mergeSplit(a: DealSplitStats, b: DealSplitStats): DealSplitStats {
  return {
    tierNorthStar: mergePaired(a.tierNorthStar, b.tierNorthStar),
    tierDeclarerGain: mergePaired(a.tierDeclarerGain, b.tierDeclarerGain),
    tierDefenderGain: mergePaired(a.tierDefenderGain, b.tierDefenderGain),
    ptsNorthStar: mergePaired(a.ptsNorthStar, b.ptsNorthStar),
    ptsDeclarerGain: mergePaired(a.ptsDeclarerGain, b.ptsDeclarerGain),
    ptsDefenderGain: mergePaired(a.ptsDefenderGain, b.ptsDefenderGain),
    outcome: mergeTier(a.outcome, b.outcome),
    tierDeclarer: mergeTier(a.tierDeclarer, b.tierDeclarer),
    tierDefender: mergeTier(a.tierDefender, b.tierDefender),
    triples: a.triples + b.triples,
  };
}

function mergeSplitMap<K>(a: Map<K, DealSplitStats>, b: Map<K, DealSplitStats>): Map<K, DealSplitStats> {
  const out = new Map<K, DealSplitStats>();
  for (const [k, v] of a) out.set(k, mergeSplit(emptySplit(), v));
  for (const [k, v] of b) {
    const cur = out.get(k);
    out.set(k, cur ? mergeSplit(cur, v) : mergeSplit(emptySplit(), v));
  }
  return out;
}

function mergeScenarioMap(
  a: Map<string, ScenarioStats>,
  b: Map<string, ScenarioStats>,
): Map<string, ScenarioStats> {
  const out = new Map<string, ScenarioStats>();
  const mergeInto = (into: ScenarioStats | undefined, from: ScenarioStats): ScenarioStats => ({
    tier: mergeTier(into?.tier ?? emptyTier(), from.tier),
    pts: mergePaired(into?.pts ?? emptyPaired(), from.pts),
  });
  for (const [k, v] of a) out.set(k, mergeInto(undefined, v));
  for (const [k, v] of b) out.set(k, mergeInto(out.get(k), v));
  return out;
}

function mergePairedMap<K>(a: Map<K, PairedBucket>, b: Map<K, PairedBucket>): Map<K, PairedBucket> {
  const out = new Map<K, PairedBucket>();
  for (const [k, v] of a) out.set(k, mergePaired(emptyPaired(), v));
  for (const [k, v] of b) out.set(k, mergePaired(out.get(k) ?? emptyPaired(), v));
  return out;
}

function mergeWinRates(a: WinRateStats, b: WinRateStats): WinRateStats {
  return {
    overall: mergePaired(a.overall, b.overall),
    banker: mergePaired(a.banker, b.banker),
    attacker: mergePaired(a.attacker, b.attacker),
    bankerByLevel: mergePairedMap(a.bankerByLevel, b.bankerByLevel),
    attackerByLevel: mergePairedMap(a.attackerByLevel, b.attackerByLevel),
  };
}

export function mergeDealStats(a: DealStats, b: DealStats): DealStats {
  const levels = mergeSplitMap(a.levels, b.levels);
  const sortedLevels = new Map([...levels.entries()].sort((x, y) => x[0] - y[0]));
  return {
    overall: mergeSplit(a.overall, b.overall),
    levels: sortedLevels,
    seats: mergeSplitMap(a.seats, b.seats),
    levelSeats: mergeSplitMap(a.levelSeats, b.levelSeats),
    scenarios: mergeScenarioMap(a.scenarios, b.scenarios),
    winRates: mergeWinRates(a.winRates, b.winRates),
    dealOutcome: mergeTier(a.dealOutcome, b.dealOutcome),
    statsA: mergeStats(a.statsA, b.statsA),
    statsB: mergeStats(a.statsB, b.statsB),
    handWinsA: a.handWinsA + b.handWinsA,
    handWinsB: a.handWinsB + b.handWinsB,
    attemptedDeals: a.attemptedDeals + b.attemptedDeals,
    acceptedDeals: a.acceptedDeals + b.acceptedDeals,
    skippedDeals: a.skippedDeals + b.skippedDeals,
    filterSkippedDeals: a.filterSkippedDeals + b.filterSkippedDeals,
    handsPlayed: a.handsPlayed + b.handsPlayed,
    abortedHands: a.abortedHands + b.abortedHands,
    settledHands: a.settledHands + b.settledHands,
    settledByBanker: a.settledByBanker + b.settledByBanker,
    settledByAttacker: a.settledByAttacker + b.settledByAttacker,
    tricksPlayed: a.tricksPlayed + b.tricksPlayed,
  };
}

function splitToJSON(s: DealSplitStats): Record<string, unknown> {
  return {
    tierNorthStar: { ...s.tierNorthStar },
    tierDeclarerGain: { ...s.tierDeclarerGain },
    tierDefenderGain: { ...s.tierDefenderGain },
    ptsNorthStar: { ...s.ptsNorthStar },
    ptsDeclarerGain: { ...s.ptsDeclarerGain },
    ptsDefenderGain: { ...s.ptsDefenderGain },
    outcome: { ...s.outcome },
    tierDeclarer: { ...s.tierDeclarer },
    tierDefender: { ...s.tierDefender },
    triples: s.triples,
  };
}

function splitFromJSON(j: Record<string, any>): DealSplitStats {
  const bucket = (v: PairedBucket): PairedBucket => ({ ...v });
  return {
    tierNorthStar: bucket(j.tierNorthStar),
    tierDeclarerGain: bucket(j.tierDeclarerGain),
    tierDefenderGain: bucket(j.tierDefenderGain),
    ptsNorthStar: bucket(j.ptsNorthStar),
    ptsDeclarerGain: bucket(j.ptsDeclarerGain),
    ptsDefenderGain: bucket(j.ptsDefenderGain),
    outcome: { ...j.outcome },
    tierDeclarer: { ...j.tierDeclarer },
    tierDefender: { ...j.tierDefender },
    triples: j.triples,
  };
}

function splitMapToJSON<K extends string | number>(m: Map<K, DealSplitStats>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of m) out[String(k)] = splitToJSON(v);
  return out;
}

function scenarioToJSON(s: ScenarioStats): Record<string, unknown> {
  return { tier: { ...s.tier }, pts: { ...s.pts } };
}

function scenarioFromJSON(j: Record<string, any>): ScenarioStats {
  return { tier: { ...j.tier }, pts: { ...j.pts } };
}

function scenarioMapToJSON(m: Map<string, ScenarioStats>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of m) out[k] = scenarioToJSON(v);
  return out;
}

function pairedMapToJSON<K extends string | number>(m: Map<K, PairedBucket>): Record<string, PairedBucket> {
  const out: Record<string, PairedBucket> = {};
  for (const [k, v] of m) out[String(k)] = { ...v };
  return out;
}

function pairedMapFromJSON<K extends string | number>(
  o: Record<string, PairedBucket> | undefined,
  key: (raw: string) => K,
): Map<K, PairedBucket> {
  const out = new Map<K, PairedBucket>();
  for (const [k, v] of Object.entries(o ?? {})) out.set(key(k), { ...v });
  return out;
}

function winRatesToJSON(w: WinRateStats): Record<string, unknown> {
  return {
    overall: { ...w.overall },
    banker: { ...w.banker },
    attacker: { ...w.attacker },
    bankerByLevel: pairedMapToJSON(w.bankerByLevel),
    attackerByLevel: pairedMapToJSON(w.attackerByLevel),
  };
}

function winRatesFromJSON(j: Record<string, any>): WinRateStats {
  return {
    overall: { ...j.overall },
    banker: { ...j.banker },
    attacker: { ...j.attacker },
    bankerByLevel: pairedMapFromJSON(j.bankerByLevel, Number),
    attackerByLevel: pairedMapFromJSON(j.attackerByLevel, Number),
  };
}

export interface DealStatsJSONOptions {
  /**
   * 是否写入 worker 合并用的内部字段（逐副配对桶 `winRates`）。
   * 最终导出的结果 JSON 不含它；只有子进程回传统计时需要。
   */
  includeInternal?: boolean;
}

export function dealStatsToJSON(
  s: DealStats,
  options: DealStatsJSONOptions = {},
): Record<string, unknown> {
  const levels: Record<string, unknown> = {};
  for (const [k, v] of s.levels) levels[String(k)] = splitToJSON(v);
  const seats: Record<string, unknown> = {};
  for (const [k, v] of s.seats) seats[String(k)] = splitToJSON(v);
  return {
    version: 2,
    overall: splitToJSON(s.overall),
    levels,
    seats,
    levelSeats: splitMapToJSON(s.levelSeats),
    scenarios: scenarioMapToJSON(s.scenarios),
    ...(options.includeInternal ? { winRates: winRatesToJSON(s.winRates) } : {}),
    dealOutcome: { ...s.dealOutcome },
    statsA: statsToJSON(s.statsA),
    statsB: statsToJSON(s.statsB),
    handWinsA: s.handWinsA,
    handWinsB: s.handWinsB,
    attemptedDeals: s.attemptedDeals,
    acceptedDeals: s.acceptedDeals,
    skippedDeals: s.skippedDeals,
    filterSkippedDeals: s.filterSkippedDeals,
    handsPlayed: s.handsPlayed,
    abortedHands: s.abortedHands,
    settledHands: s.settledHands,
    settledByBanker: s.settledByBanker,
    settledByAttacker: s.settledByAttacker,
    tricksPlayed: s.tricksPlayed,
  };
}

export function dealStatsFromJSON(j: Record<string, any>): DealStats {
  const levels = new Map<number, DealSplitStats>();
  for (const [k, v] of Object.entries((j.levels ?? {}) as Record<string, Record<string, any>>)) {
    levels.set(Number(k), splitFromJSON(v));
  }
  const seats = new Map<DeclarerIdx, DealSplitStats>();
  for (const [k, v] of Object.entries((j.seats ?? {}) as Record<string, Record<string, any>>)) {
    seats.set(Number(k) as DeclarerIdx, splitFromJSON(v));
  }
  const levelSeats = new Map<string, DealSplitStats>();
  for (const [k, v] of Object.entries((j.levelSeats ?? {}) as Record<string, Record<string, any>>)) {
    levelSeats.set(k, splitFromJSON(v));
  }
  const sortedLevels = new Map([...levels.entries()].sort((x, y) => x[0] - y[0]));
  const scenarios = new Map<string, ScenarioStats>();
  for (const [k, v] of Object.entries((j.scenarios ?? {}) as Record<string, Record<string, any>>)) {
    scenarios.set(k, scenarioFromJSON(v));
  }
  if (scenarios.size === 0) {
    for (const scenario of scenariosForLevels([...sortedLevels.keys()])) {
      scenarios.set(scenarioKey(scenario), emptyScenarioStats());
    }
  }
  return {
    overall: splitFromJSON(j.overall),
    levels: sortedLevels,
    seats: new Map([...seats.entries()].sort((x, y) => x[0] - y[0])),
    levelSeats,
    scenarios,
    winRates: j.winRates ? winRatesFromJSON(j.winRates) : emptyWinRates([...sortedLevels.keys()]),
    dealOutcome: { ...j.dealOutcome },
    statsA: statsFromJSON(j.statsA),
    statsB: statsFromJSON(j.statsB),
    handWinsA: j.handWinsA,
    handWinsB: j.handWinsB,
    attemptedDeals: j.attemptedDeals,
    acceptedDeals: j.acceptedDeals,
    skippedDeals: j.skippedDeals,
    filterSkippedDeals: j.filterSkippedDeals,
    handsPlayed: j.handsPlayed,
    abortedHands: j.abortedHands,
    settledHands: j.settledHands,
    settledByBanker: j.settledByBanker,
    settledByAttacker: j.settledByAttacker,
    tricksPlayed: j.tricksPlayed,
  };
}
