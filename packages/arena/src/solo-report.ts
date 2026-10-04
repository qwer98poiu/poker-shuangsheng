/**
 * 单副牌 A/B 竞技场的指标推导与报告。
 *
 * 4 项指标 = 庄家/闲家 × 档位/分差，逐等级分开统计：
 * - **档位**：三分类胜负（A 胜/B 胜/平），显著性与 CI 走 Wilson 胜率口径；
 *   数值列固定显示 **A 的胜率**（B 领先时 < 0.5），99%CI 判定界列是 A 胜率的 Wilson 下界。
 * - **分差**：配对差值均值（正 = A 更好），99%CI 判定界列是均值的正态近似下界。
 * 显著性是**两侧对称**的：A 的 99% 区间整体高于原假设（档位 0.5 / 分差 0）即 A 显著，
 * 整体低于即 B 显著 —— 否则结论里的「B 显著领先」无从体现。
 */
import type { PairedBucket, SoloStats, SoloLevelStats, TierBucket } from './solo-arena.js';
import { Z } from './significance.js';
import { displayWidth, ratioText } from './report.js';
import { levelLabel } from './level-label.js';

const RESET = '\x1b[0m';
/** 单元格染色：'A' = A 侧（绿）、'B' = B 侧（红）、null = 不染色。 */
export type CellTint = 'A' | 'B' | null;
const TINT_CODES: Record<'A' | 'B', string> = { A: '\x1b[32m', B: '\x1b[31m' };

export type IndicatorKind = 'bankerTier' | 'bankerPts' | 'attackerTier' | 'attackerPts';

/** 表内每个等级的行序。 */
export const INDICATOR_KINDS: readonly IndicatorKind[] = [
  'bankerTier', 'bankerPts', 'attackerTier', 'attackerPts',
];

export const KIND_LABELS: Record<IndicatorKind, string> = {
  bankerTier: '庄家 档位',
  bankerPts: '庄家 分差',
  attackerTier: '闲家 档位',
  attackerPts: '闲家 分差',
};

export interface Indicator {
  /** `L2/bankerTier` 形式的稳定键（显著性行按它比对变化）。 */
  key: string;
  level: number;
  kind: IndicatorKind;
  /** 该等级完成的 trial 数（= 有效发牌数，若该等级没被过滤器掉过）。 */
  n: number;
  /** A 口径的数值：档位 = A 的胜率，分差 = 平均分差。n = 0 时为 NaN。 */
  value: number;
  /**
   * A 口径的 99% CI **判定界**：取靠近原假设的那一端——A 的胜率 ≥ 0.5 时取
   * Wilson 下界、< 0.5 时取 Wilson 上界（分差同理，按均值符号取靠近 0 的一侧）。
   * 于是「档位界 > 0.5 / 分差界 > 0 ⇒ A 显著领先」，「档位界 < 0.5 / 分差界 < 0 ⇒ B 显著领先」。
   * 样本不足时为 NaN。
   */
  ciBound: number;
  /** 点估计领先方（档位按得分率，分差按均值符号）。 */
  leader: 'A' | 'B' | null;
  /** 显著领先的一方（99% 区间排除原假设），null = 不显著。 */
  sigLeader: 'A' | 'B' | null;
}

/** A 口径的 Wilson 区间（与 significance.ts 同一公式；那边只返回领先方的下界）。 */
export function wilsonInterval(scoreA: number, n: number, z: number): { lower: number; upper: number } {
  const p = scoreA / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lower: center - half, upper: center + half };
}

/** A 口径的配对差区间（正态近似）；n < 2 时不可用。 */
export function pairedInterval(b: PairedBucket, z: number): { mean: number; lower: number; upper: number; usable: boolean } {
  if (b.n < 2) return { mean: b.n > 0 ? b.sumD / b.n : NaN, lower: NaN, upper: NaN, usable: false };
  const mean = b.sumD / b.n;
  const variance = Math.max(0, (b.sumD2 - b.n * mean * mean) / (b.n - 1));
  const half = z * Math.sqrt(variance / b.n);
  return { mean, lower: mean - half, upper: mean + half, usable: true };
}

function tierIndicator(level: number, kind: IndicatorKind, b: TierBucket): Indicator {
  const key = `L${level}/${kind}`;
  if (b.n === 0) {
    return { key, level, kind, n: 0, value: NaN, ciBound: NaN, leader: null, sigLeader: null };
  }
  const scoreA = b.a + 0.5 * b.draw;
  const scoreB = b.b + 0.5 * b.draw;
  const value = scoreA / b.n;
  const { lower, upper } = wilsonInterval(scoreA, b.n, Z);
  return {
    key, level, kind, n: b.n,
    value,
    ciBound: value >= 0.5 ? lower : upper, // A 不占优时看的是它的上界
    leader: scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : null,
    sigLeader: lower > 0.5 ? 'A' : upper < 0.5 ? 'B' : null,
  };
}

function pairedIndicator(level: number, kind: IndicatorKind, b: PairedBucket): Indicator {
  const key = `L${level}/${kind}`;
  if (b.n === 0) {
    return { key, level, kind, n: 0, value: NaN, ciBound: NaN, leader: null, sigLeader: null };
  }
  const { mean, lower, upper } = pairedInterval(b, Z);
  return {
    key, level, kind, n: b.n, value: mean,
    ciBound: mean >= 0 ? lower : upper, // A 不占优时看的是它的上界
    leader: mean > 0 ? 'A' : mean < 0 ? 'B' : null,
    sigLeader: lower > 0 ? 'A' : upper < 0 ? 'B' : null,
  };
}

function levelIndicators(level: number, st: SoloLevelStats): Indicator[] {
  return [
    tierIndicator(level, 'bankerTier', st.bankerTier),
    pairedIndicator(level, 'bankerPts', st.bankerPts),
    tierIndicator(level, 'attackerTier', st.attackerTier),
    pairedIndicator(level, 'attackerPts', st.attackerPts),
  ];
}

/** 全部等级 × 4 项指标（含样本为 0 的等级，报告里也要列出）。 */
export function enumerateIndicators(s: SoloStats): Indicator[] {
  const out: Indicator[] = [];
  for (const [level, st] of s.levels) out.push(...levelIndicators(level, st));
  return out;
}

/** 有样本的指标（等级被过滤器滤光时它的 4 项为 0，不计入停止判定与结论）。 */
export function activeIndicators(s: SoloStats): Indicator[] {
  return enumerateIndicators(s).filter(i => i.n > 0);
}

export function indicatorLabel(ind: Indicator): string {
  return `等级 ${levelLabel(ind.level)} ${KIND_LABELS[ind.kind]}`;
}

// ---- 结论 ----

export interface ConclusionCounts {
  a: number;
  b: number;
  none: number;
  total: number;
}

/** 结论计数：只数有样本的指标。 */
export function conclusionCounts(s: SoloStats): ConclusionCounts {
  let a = 0;
  let b = 0;
  let none = 0;
  for (const ind of activeIndicators(s)) {
    if (ind.sigLeader === 'A') a += 1;
    else if (ind.sigLeader === 'B') b += 1;
    else none += 1;
  }
  return { a, b, none, total: a + b + none };
}

/** 例：`A（ai）6项指标显著领先，B（ai-0929）1项指标显著领先，另有17项指标不显著`。 */
export function conclusionText(s: SoloStats, nameA: string, nameB: string): string {
  const { a, b, none } = conclusionCounts(s);
  const head = `A（${nameA}）${a}项指标显著领先，B（${nameB}）${b}项指标显著领先`;
  return none > 0 ? `${head}，另有${none}项指标不显著` : head;
}

// ---- 渲染 ----

/**
 * 宽表渲染（report.ts 的 renderTable 固定三列，这里是 n 列）。
 * 对齐按终端显示宽度（CJK 占 2 列），染色码零宽——先按原文宽度填充再套色。
 */
export function renderColumns(
  header: readonly string[],
  rows: readonly string[][],
  tints: readonly (readonly CellTint[])[],
  color: boolean,
): string[] {
  const widths = header.map((h, i) => Math.max(displayWidth(h), ...rows.map(r => displayWidth(r[i] ?? ''))));
  const cell = (text: string, w: number, tint: CellTint): string => {
    const body = tint !== null && color ? `${TINT_CODES[tint]}${text}${RESET}` : text;
    return body + ' '.repeat(Math.max(0, w - displayWidth(text)));
  };
  const lines = [header.map((h, i) => cell(h, widths[i], null)).join('  ').trimEnd()];
  rows.forEach((r, ri) => {
    lines.push(r.map((c, i) => cell(c, widths[i], tints[ri]?.[i] ?? null)).join('  ').trimEnd());
  });
  return lines;
}

const UNKNOWN = '—';

/** 表头：与 `indicatorRow` 的 `cells` 顺序一一对应（末三列 A胜 / B胜 / 平局）。 */
export const SOLO_TABLE_HEADER: readonly string[] =
  ['指标', '数值', '领先方', '99%CI判定界', 'A胜', 'B胜', '平局'];

/** 一行：指标 | 数值 | 领先方 | 99%CI判定界 | A胜 | B胜 | 平局。 */
export function indicatorRow(ind: Indicator, st: SoloLevelStats): { cells: string[]; tints: CellTint[] } {
  const tier = ind.kind.endsWith('Tier');
  const b = tier
    ? (ind.kind === 'bankerTier' ? st.bankerTier : st.attackerTier)
    : (ind.kind === 'bankerPts' ? st.bankerPts : st.attackerPts);
  const aWins = tier ? (b as TierBucket).a : (b as PairedBucket).pos;
  const draws = tier ? (b as TierBucket).draw : (b as PairedBucket).zero;
  const bWins = tier ? (b as TierBucket).b : (b as PairedBucket).neg;

  const value = ind.n === 0 || !Number.isFinite(ind.value)
    ? UNKNOWN
    : tier ? ind.value.toFixed(4) : ind.value.toFixed(3);
  const ci = Number.isFinite(ind.ciBound)
    ? (tier ? ind.ciBound.toFixed(4) : ind.ciBound.toFixed(3))
    : UNKNOWN;
  const leader = ind.leader ?? UNKNOWN;

  const count = (n: number): string => (ind.n === 0 ? UNKNOWN : ratioText({ n, d: ind.n }));
  return {
    cells: [
      KIND_LABELS[ind.kind], value, leader, ci,
      count(aWins), count(bWins), count(draws),
    ],
    // 领先方列只给**显著**的一侧上色（A 绿 / B 红）；不显著不染色
    tints: [null, null, ind.sigLeader, null, null, null, null],
  };
}

export interface SoloReportInput {
  nameA: string;
  nameB: string;
  seed: number;
  elapsedMs: number;
  levels: readonly number[];
  ntOnly: boolean;
  dealFilters: readonly string[];
  /** 运行结束时停在的目标有效发牌数。 */
  targetDeals: number;
  stats: SoloStats;
  verdict: string;
  /** 是否输出 ANSI 颜色（非 TTY 时关掉）。 */
  color: boolean;
}

export function printSoloReport(input: SoloReportInput): void {
  const { nameA, nameB, seed, elapsedMs, levels, ntOnly, dealFilters, targetDeals, stats, verdict, color } = input;
  const levelText = levels.map(levelLabel).join(',');
  console.log('\n' + '='.repeat(72));
  console.log('单副牌 A/B 竞技场报告');
  console.log('='.repeat(72));
  console.log(`A: ${nameA}    B: ${nameB}    seed=${seed}`);
  console.log(`等级: ${levelText}（${levels.length} 档）    nt-only: ${ntOnly ? '是' : '否'}    发牌过滤器: ${dealFilters.length ? dealFilters.join(',') : '无'}`);
  console.log(`有效发牌: ${stats.keptDeals} 副（目标 ${targetDeals} 副，尝试 ${stats.attemptedDeals} 副，过滤掉 ${stats.skippedDeals} 副）  耗时 ${(elapsedMs / 1000).toFixed(0)}s`);
  console.log(`结论: ${verdict}`);

  console.log('\n全局指标（双方共享）:');
  console.log(`  每局平均墩数: ${ratioText({ n: stats.tricksPlayed, d: stats.handsPlayed })}`);
  console.log(`  中止小局: ${stats.abortedHands}`);

  const emptyLevels = levels.filter(lv => (stats.levels.get(lv)?.bankerTier.n ?? 0) === 0);
  if (emptyLevels.length > 0) {
    console.log(`  ⚠ 等级 ${emptyLevels.map(levelLabel).join(',')} 无有效发牌（全被过滤），未计入结论。`);
  }

  console.log('\n逐等级指标（均为 A 口径：档位行 = A 的胜率、分差行 = 平均分差；'
    + '99%CI 列取靠近判定线的那一端——A 领先看下界、A 落后看其上界。'
    + '档位 > 0.5 / 分差 > 0 ⇒ A 显著领先，反之 ⇒ B 显著领先；'
    + '领先方列只给显著的一侧上色（A 绿、B 红））:');
  for (const level of levels) {
    const st = stats.levels.get(level);
    if (!st) continue;
    console.log(`\n等级 ${levelLabel(level)}:`);
    const rows: string[][] = [];
    const tints: CellTint[][] = [];
    for (const kind of INDICATOR_KINDS) {
      const ind = levelIndicators(level, st).find(i => i.kind === kind)!;
      const r = indicatorRow(ind, st);
      rows.push(r.cells);
      tints.push(r.tints);
    }
    for (const line of renderColumns(SOLO_TABLE_HEADER, rows, tints, color)) {
      console.log('  ' + line);
    }
  }
  console.log('='.repeat(72));
}
