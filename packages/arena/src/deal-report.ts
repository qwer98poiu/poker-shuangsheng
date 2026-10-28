/**
 * Deal 竞技场的指标推导与报告。
 *
 * 两张场景表（净升级 / 得分差）使用同一组场景：等级（总体或单等级）×
 * 主牌（总体/有主/无主）× 角色（总体/庄家/闲家）。净升级按发牌多数决，
 * 平局折 0.5 做 99% 显著性；得分差先按副求合格三元组均值，再跨副做配对区间。
 *
 * 「小局分析」沿用 80 分口径的 A/B 两列；只有胜率类指标（胜率、台上/台下/
 * 等级胜率）附 99% 显著性，其余指标显示 —。显著性走逐副配对差（内部字段
 * `winRates`），导出 JSON 不写该字段。
 */
import type { DealStats, DeclarerIdx, Scenario } from './deal-arena.js';
import { scenariosForLevels, scenarioKey } from './deal-arena.js';
import { Z, checkSignificance } from './significance.js';
import type { SignificanceResult } from './significance.js';
import { pairedInterval } from './intervals.js';
import type { PairedBucket } from './intervals.js';
import { betterSide, ratioText, renderColumns } from './report.js';
import type { CellTint, Direction, Verdict } from './report.js';
import type { TierBucket } from './tier.js';
import type { CountPair } from './stats.js';
import { levelLabel } from './level-label.js';

const UNKNOWN = '—';

export function scenarioLabel(s: Scenario, kind: 'tier' | 'pts'): string {
  if (s.level !== null) {
    const base = `等级 ${levelLabel(s.level)}`;
    if (s.suit === 'overall') return base;
    return `${base}·${s.suit === 'suited' ? '有主' : '无主'}`;
  }
  if (s.suit === 'overall') {
    if (s.role === 'overall') return kind === 'tier' ? '总体（核心）' : '总体';
    return s.role === 'declarer' ? '庄家' : '闲家';
  }
  const suit = s.suit === 'suited' ? '有主' : '无主';
  if (s.role === 'overall') return suit;
  return `${suit}·${s.role === 'declarer' ? '庄家' : '闲家'}`;
}

function proportionCell(count: number, n: number): string {
  if (n === 0) return UNKNOWN;
  return `${(count / n).toFixed(4)}（${count}/${n}）`;
}

function signedFixed(v: number, digits: number): string {
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

function tierSignificance(b: TierBucket): { text: string; tint: CellTint } {
  if (b.n === 0) return { text: UNKNOWN, tint: null };
  const r = checkSignificance(b.a, b.b, b.draw, b.n);
  if (!r.significant || r.leader === null) return { text: '不显著', tint: null };
  return { text: r.leader, tint: r.leader };
}

function pairedSignificance(b: PairedBucket | undefined): { text: string; tint: CellTint } {
  if (!b || b.n < 2) return { text: UNKNOWN, tint: null };
  const { lower, upper } = pairedInterval(b, Z);
  if (lower > 0) return { text: 'A', tint: 'A' };
  if (upper < 0) return { text: 'B', tint: 'B' };
  return { text: '不显著', tint: null };
}

export interface ScenarioRow {
  cells: string[];
  tints: CellTint[];
}

/** 净升级：发牌级 A/B/平比例 + 99% 显著性。 */
export function tierScenarioRows(stats: DealStats, levels: readonly number[]): ScenarioRow[] {
  return scenariosForLevels(levels).map(scenario => {
    const b = stats.scenarios.get(scenarioKey(scenario))?.tier
      ?? { n: 0, a: 0, b: 0, draw: 0 };
    const sig = tierSignificance(b);
    return {
      cells: [
        scenarioLabel(scenario, 'tier'),
        proportionCell(b.a, b.n),
        proportionCell(b.b, b.n),
        proportionCell(b.draw, b.n),
        sig.text,
      ],
      tints: [null, null, null, null, sig.tint],
    };
  });
}

/** 得分差：按副均值 + 分子（1 位小数）/分母 + 99% 配对显著性。 */
export function ptsScenarioRows(stats: DealStats, levels: readonly number[]): ScenarioRow[] {
  return scenariosForLevels(levels).map(scenario => {
    const p = stats.scenarios.get(scenarioKey(scenario))?.pts;
    const sig = pairedSignificance(p);
    const value = p && p.n > 0
      ? `${signedFixed(p.sumD / p.n, 3)}（${signedFixed(p.sumD, 1)}/${p.n}）`
      : UNKNOWN;
    return {
      cells: [scenarioLabel(scenario, 'pts'), value, sig.text],
      tints: [null, null, sig.tint],
    };
  });
}

export interface AnalysisRow {
  label: string;
  a: string;
  b: string;
  verdict: Verdict;
  sig: string;
  sigTint: CellTint;
}

function analysisRow(
  label: string,
  a: CountPair,
  b: CountPair,
  dir: Direction,
  bucket?: PairedBucket,
): AnalysisRow {
  const sig = pairedSignificance(bucket);
  return {
    label,
    a: ratioText(a),
    b: ratioText(b),
    verdict: betterSide(a, b, dir),
    sig: sig.text,
    sigTint: sig.tint,
  };
}

/**
 * 小局分析（原 80 分口径）：只含 AB/BA 两腿。
 * 只有胜率类指标带显著性桶；其余指标 `sig` 为 —。
 */
export function comparisonRows(stats: DealStats, levels: readonly number[]): AnalysisRow[] {
  const a = stats.statsA;
  const b = stats.statsB;
  const hands = a.handsPlayed;
  const triples = stats.overall.outcome.n;
  return [
    analysisRow(
      '胜率',
      { n: stats.handWinsA, d: 2 * triples },
      { n: stats.handWinsB, d: 2 * triples },
      'high',
      stats.winRates.overall,
    ),
    analysisRow(
      '台上胜率',
      { n: a.banker.wins, d: a.banker.hands },
      { n: b.banker.wins, d: b.banker.hands },
      'high',
      stats.winRates.banker,
    ),
    ...levels.map(lv => analysisRow(
      `台上 ${levelLabel(lv)} 胜率`,
      a.banker.perLevel.get(lv) ?? { n: 0, d: 0 },
      b.banker.perLevel.get(lv) ?? { n: 0, d: 0 },
      'high',
      stats.winRates.bankerByLevel.get(lv),
    )),
    analysisRow('台上平均失分', a.banker.avgLoss, b.banker.avgLoss, 'low'),
    analysisRow(
      '台上扣底平均分数',
      a.banker.avgBottomPts,
      b.banker.avgBottomPts,
      'neutral',
    ),
    analysisRow('台上扣绝一门频率', a.banker.killSuitFreq, b.banker.killSuitFreq, 'neutral'),
    analysisRow('庄家保底频率', a.banker.keepBottom, b.banker.keepBottom, 'high'),
    analysisRow(
      '台下胜率',
      { n: a.attacker.wins, d: a.attacker.hands },
      { n: b.attacker.wins, d: b.attacker.hands },
      'high',
      stats.winRates.attacker,
    ),
    ...levels.map(lv => analysisRow(
      `台下 ${levelLabel(lv)} 胜率`,
      a.attacker.perLevel.get(lv) ?? { n: 0, d: 0 },
      b.attacker.perLevel.get(lv) ?? { n: 0, d: 0 },
      'high',
      stats.winRates.attackerByLevel.get(lv),
    )),
    analysisRow('抠底频率', a.attacker.kouDiFreq, b.attacker.kouDiFreq, 'neutral'),
    analysisRow('抠底成功频率', a.attacker.kouDiSuccess, b.attacker.kouDiSuccess, 'high'),
    analysisRow('闲家抠底平均加分', a.attacker.avgKouDi, b.attacker.avgKouDi, 'high'),
    analysisRow('每墩胜率', a.tricks.won, b.tricks.won, 'high'),
    analysisRow(
      '每局平均领出次数',
      { n: a.tricks.leads.n, d: hands },
      { n: b.tricks.leads.n, d: hands },
      'neutral',
    ),
    analysisRow('每局平均每墩领出张数', a.tricks.leadCards, b.tricks.leadCards, 'neutral'),
    analysisRow('平均每局赢得张数', a.tricks.cardsWon, b.tricks.cardsWon, 'high'),
  ];
}

export function analysisTable(
  stats: DealStats,
  levels: readonly number[],
  nameA: string,
  nameB: string,
  color: boolean,
): string[] {
  const rows = comparisonRows(stats, levels);
  return renderColumns(
    ['指标', `策略A（${nameA}）`, `策略B（${nameB}）`, '99%显著性'],
    rows.map(r => [r.label, r.a, r.b, r.sig]),
    rows.map(r => [
      null,
      r.verdict === 'a' || r.verdict === 'tie' ? 'A' : null,
      r.verdict === 'b' || r.verdict === 'tie' ? 'A' : null,
      r.sigTint,
    ] as CellTint[]),
    color,
  );
}

export interface DealReportInput {
  nameA: string;
  nameB: string;
  seed: string;
  elapsedMs: number;
  levels: readonly number[];
  declarerSeats: readonly DeclarerIdx[];
  dealFilters: readonly string[];
  /** 运行结束时停在的目标有效发牌数。 */
  targetDeals: number;
  outcome: SignificanceResult;
  verdict: string;
  stats: DealStats;
  /** 是否输出 ANSI 颜色（非 TTY 时关掉）。 */
  color: boolean;
}

export function printDealReport(input: DealReportInput): void {
  const {
    nameA, nameB, seed, elapsedMs, levels, declarerSeats, dealFilters,
    targetDeals, outcome, verdict, stats, color,
  } = input;
  const a = stats.statsA;
  const seatsLabel = declarerSeats.length === 1
    ? `固定 P${declarerSeats[0]}`
    : `轮转 ${declarerSeats.map(s => `P${s}`).join(',')}`;

  console.log('\n' + '='.repeat(72));
  console.log('Deal 竞技场报告');
  console.log('='.repeat(72));
  console.log(`A: ${nameA}    B: ${nameB}    seed=${seed}`);
  console.log(`等级: ${levels.map(levelLabel).join(',')}（${levels.length} 档）    庄位: ${seatsLabel}    发牌过滤器: ${dealFilters.length ? dealFilters.join(',') : '无'}`);
  console.log(`有效发牌: ${stats.acceptedDeals} 副（目标 ${targetDeals} 副，尝试 ${stats.attemptedDeals} 副，过滤 ${stats.skippedDeals} 副：条件 ${stats.filterSkippedDeals}）  耗时 ${(elapsedMs / 1000).toFixed(0)}s`);
  console.log(`中止小局: ${stats.abortedHands}（庄 ${stats.settledByBanker} / 闲 ${stats.settledByAttacker}）`);
  console.log(`结论: ${verdict}`);
  if (outcome.n > 0) {
    console.log(`  leader=${outcome.leader ?? '—'}  p̂=${outcome.pHat.toFixed(4)}  99% CI 下界=${outcome.ciLower.toFixed(4)}  (n=${outcome.n})`);
  }

  console.log('\n全局指标（双方共享）:');
  console.log(`  每局平均墩数: ${ratioText({ n: stats.tricksPlayed, d: stats.handsPlayed })}`);
  console.log(`  中止致因: A ${a.abortCaused} / B ${stats.statsB.abortCaused} 小局`);

  const emptyLevels = levels.filter(lv => (stats.levels.get(lv)?.outcome.n ?? 0) === 0);
  if (emptyLevels.length > 0) {
    console.log(`  ⚠ 等级 ${emptyLevels.map(levelLabel).join(',')} 无有效三元组（全被过滤），未计入结论。`);
  }

  const tierRows = tierScenarioRows(stats, levels);
  console.log('\n净升级（发牌多数决；平局折 0.5 计入显著性）:');
  for (const line of renderColumns(
    ['场景', 'A胜', 'B胜', '平局', '99%显著性'],
    tierRows.map(r => r.cells),
    tierRows.map(r => r.tints),
    color,
  )) console.log('  ' + line);

  const ptsRows = ptsScenarioRows(stats, levels);
  console.log('\n得分差（每副先求合格三元组均值，再跨副配对）:');
  for (const line of renderColumns(
    ['场景', '值', '99%显著性'],
    ptsRows.map(r => r.cells),
    ptsRows.map(r => r.tints),
    color,
  )) console.log('  ' + line);

  console.log('\n小局分析:');
  console.log('  （绿 = 该侧更优；相等都标绿；中性指标不染色）');
  for (const line of analysisTable(stats, levels, nameA, nameB, color)) console.log('  ' + line);
  console.log('='.repeat(72));
}
