/**
 * Deal 竞技场 probe：只统计「条件命中且实际改牌」的发牌。
 *
 * 用法（见 deal-run.ts）：
 *   --probe-module PATH   动态加载临时模块，导出 hit(decision) => boolean
 *   --probe-check N       先在前 N 副的**每个决策**上对比 A/B，假阴性必须为 0
 *
 * 口径：A/B 仍是完整策略对局（A 在 A 队、B 在 B 队）；probe 只在 A 的决策里
 * 命中条件时再调用 B，比较牌是否不同。受影响发牌/三元组统计与显著性检验见
 * deal-arena.ts 的 ProbeStats 与 deal-run.ts 的 probe 报告。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Card, CardSuit } from '@poker/engine';
import type { AIContext } from '@poker/ai';
import type { Strategy } from './types.js';
import { checkSignificance } from './significance.js';
import type { SignificanceResult } from './significance.js';

/** 一次决策的完整输入；probe 条件只依赖这些字段。 */
export interface ProbeDecision {
  readonly kind: 'lead' | 'follow';
  readonly hand: readonly Card[];
  /** 领出时为空数组。 */
  readonly leadCards: readonly Card[];
  readonly leadSuit: CardSuit | null;
  readonly config: AIContext;
}

/** 临时 probe 模块的契约（由 --probe-module 指向的 TS/JS 文件导出）。 */
export interface ProbeModule {
  readonly name?: string;
  hit(decision: ProbeDecision): boolean;
}

/** 与 JSON 兼容的 probe 累加器；跨 worker 合并。 */
export interface ProbeStats {
  /** 条件命中的决策数。 */
  hits: number;
  /** 命中且 A/B 出牌不同的决策数。 */
  changedDecisions: number;
  /** 至少有一次实际改牌的发牌数。 */
  affectedDeals: number;
  /** 至少有一次实际改牌的三元组数。 */
  affectedTriples: number;
  /** 受影响三元组里 A 更好的个数。 */
  tripleA: number;
  /** 受影响三元组里 B 更好的个数。 */
  tripleB: number;
  /** 受影响发牌里 A 更好的个数（三元组多数决）。 */
  dealA: number;
  /** 受影响发牌里 B 更好的个数。 */
  dealB: number;
  /** 受影响发牌里平局个数。 */
  dealDraw: number;
  /** 受影响三元组的 tierNorthStar 之和。 */
  tierSum: number;
  /** 受影响三元组的 ptsNorthStar 之和。 */
  ptsSum: number;
}

export function emptyProbeStats(): ProbeStats {
  return {
    hits: 0, changedDecisions: 0, affectedDeals: 0, affectedTriples: 0,
    tripleA: 0, tripleB: 0, dealA: 0, dealB: 0, dealDraw: 0,
    tierSum: 0, ptsSum: 0,
  };
}

export function mergeProbeStats(a: ProbeStats, b: ProbeStats): ProbeStats {
  return {
    hits: a.hits + b.hits,
    changedDecisions: a.changedDecisions + b.changedDecisions,
    affectedDeals: a.affectedDeals + b.affectedDeals,
    affectedTriples: a.affectedTriples + b.affectedTriples,
    tripleA: a.tripleA + b.tripleA,
    tripleB: a.tripleB + b.tripleB,
    dealA: a.dealA + b.dealA,
    dealB: a.dealB + b.dealB,
    dealDraw: a.dealDraw + b.dealDraw,
    tierSum: a.tierSum + b.tierSum,
    ptsSum: a.ptsSum + b.ptsSum,
  };
}

export function sameCards(a: readonly Card[], b: readonly Card[]): boolean {
  if (a.length !== b.length) return false;
  const ka = a.map(c => c.id).sort().join(',');
  const kb = b.map(c => c.id).sort().join(',');
  return ka === kb;
}

/** 动态加载临时 probe 模块；模块需导出 hit(decision)，可选 name。 */
export async function loadProbeModule(spec: string): Promise<ProbeModule> {
  const abs = path.resolve(spec);
  const mod = await import(pathToFileURL(abs).href) as Record<string, unknown> & {
    default?: Record<string, unknown>;
  };
  const hit = mod.hit ?? mod.default?.hit;
  if (typeof hit !== 'function') {
    throw new Error(`probe 模块必须导出 hit(decision) 函数: ${abs}`);
  }
  const name = (mod.name ?? mod.default?.name) as string | undefined;
  return { name, hit: hit as ProbeModule['hit'] };
}

/**
 * A 侧 probe wrapper：命中时调用一次 B 并比较牌；未命中不调用 B。
 * `changed` 按三元组由 takeChanged() 读取，命中数与改牌数直接累加到 stats。
 */
export class ProbeTracker {
  private changed = false;

  constructor(
    private readonly mod: ProbeModule,
    private readonly baseline: Strategy,
    private readonly stats: ProbeStats,
  ) {}

  wrap(base: Strategy): Strategy {
    return {
      ...base,
      lead: (hand, config) => {
        const a = base.lead(hand, config);
        this.observe({ kind: 'lead', hand, leadCards: [], leadSuit: null, config }, a.cards);
        return a;
      },
      follow: (hand, leadCards, leadSuit, config) => {
        const a = base.follow(hand, leadCards, leadSuit, config);
        this.observe({ kind: 'follow', hand, leadCards, leadSuit, config }, a.cards);
        return a;
      },
    };
  }

  /** 该三元组是否发生过实际改牌；读取后清零。 */
  takeChanged(): boolean {
    const c = this.changed;
    this.changed = false;
    return c;
  }

  private observe(decision: ProbeDecision, actual: readonly Card[]): void {
    if (!this.mod.hit(decision)) return;
    this.stats.hits += 1;
    const alt = decision.kind === 'lead'
      ? this.baseline.lead(decision.hand as Card[], decision.config)
      : this.baseline.follow(
        decision.hand as Card[], decision.leadCards as Card[],
        decision.leadSuit, decision.config,
      );
    if (!sameCards(actual, alt.cards)) {
      this.stats.changedDecisions += 1;
      this.changed = true;
    }
  }
}

/** check 模式里一次「A/B 应一致与否」的观测（可直接序列化）。 */
export interface ProbeComparison {
  readonly dealIndex: number;
  readonly kind: 'lead' | 'follow';
  readonly myIndex: number;
  readonly playCount: number;
  readonly level: number;
  readonly trumpSuit: CardSuit | null;
  readonly lead: string;
  readonly hand: string;
  readonly actual: string;
  readonly alternative: string;
  readonly hit: boolean;
}

function fmt(cards: readonly Card[]): string {
  return cards.map(c => `${c.suit}${c.rank}`).join(' ');
}

export interface ProbeCheckStats {
  comparisons: number;
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
  examples: ProbeComparison[];
}

export function emptyProbeCheckStats(): ProbeCheckStats {
  return {
    comparisons: 0, truePositive: 0, trueNegative: 0,
    falsePositive: 0, falseNegative: 0, examples: [],
  };
}

/**
 * check wrapper：每个决策都调用 another 策略一次并对比，用于发现条件假阴性。
 * actual 必须是本局实际采用的策略（A 或 B），another 是对照策略。
 */
export function wrapForCheck(
  base: Strategy,
  another: Strategy,
  mod: ProbeModule,
  stats: ProbeCheckStats,
  dealIndex: number,
): Strategy {
  const observe = (decision: ProbeDecision, actual: readonly Card[], alternative: readonly Card[]): void => {
    const hit = mod.hit(decision);
    const changed = !sameCards(actual, alternative);
    stats.comparisons += 1;
    if (changed && hit) stats.truePositive += 1;
    else if (changed && !hit) {
      stats.falseNegative += 1;
      if (stats.examples.length < 10) {
        stats.examples.push({
          dealIndex,
          kind: decision.kind,
          myIndex: decision.config.myIndex,
          playCount: decision.config.playCount,
          level: decision.config.level,
          trumpSuit: decision.config.trumpSuit,
          lead: fmt(decision.leadCards),
          hand: fmt(decision.hand),
          actual: fmt(actual),
          alternative: fmt(alternative),
          hit,
        });
      }
    } else if (!changed && hit) stats.falsePositive += 1;
    else stats.trueNegative += 1;
  };
  return {
    ...base,
    lead: (hand, config) => {
      const a = base.lead(hand, config);
      const b = another.lead(hand, config);
      observe({ kind: 'lead', hand, leadCards: [], leadSuit: null, config }, a.cards, b.cards);
      return a;
    },
    follow: (hand, leadCards, leadSuit, config) => {
      const a = base.follow(hand, leadCards, leadSuit, config);
      const b = another.follow(hand, leadCards, leadSuit, config);
      observe({ kind: 'follow', hand, leadCards, leadSuit, config }, a.cards, b.cards);
      return a;
    },
  };
}

/** 受影响发牌/三元组的显著性（99% Wilson）。 */
export function probeSignificance(p: ProbeStats): {
  deal: SignificanceResult;
  triple: SignificanceResult;
  dealN: number;
  tripleN: number;
} {
  const dealN = p.affectedDeals;
  const tripleN = p.affectedTriples;
  return {
    deal: checkSignificance(p.dealA, p.dealB, p.dealDraw, dealN),
    triple: checkSignificance(p.tripleA, p.tripleB, tripleN - p.tripleA - p.tripleB, tripleN),
    dealN,
    tripleN,
  };
}
