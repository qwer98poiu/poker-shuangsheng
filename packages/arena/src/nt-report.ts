/**
 * 无主（NT）竞技场报告 —— 与整体竞技场同一张 A/B 对比表（report.ts 渲染：按显示
 * 宽度对齐、更优侧标绿），差别只在指标集合：无主局没有「打有主」口径，也没有整场
 * （对王/升到 A）概念。
 *
 * 头条胜率是**发牌口径**（一副牌里 A 赢的小局多则算 A 胜，显著性检验用的就是这组
 * 数）；其余各行是小局口径，与整体竞技场的「整场 vs 小局」分层同理。
 */
import type { NTStats } from './nt-arena.js';
import { renderTable, perLevelSpecs, rowsFrom, ratioText } from './report.js';
import type { MetricSpec, TableRow } from './report.js';
import type { SignificanceResult } from './significance.js';

/** A/B 对比表的数据行；方向约定与整体竞技场一致（见 run.ts 的说明）。 */
function comparisonRows(s: NTStats): TableRow[] {
  const a = s.statsA;
  const b = s.statsB;
  const hands = a.handsPlayed;
  const deals = s.dealsWonA + s.dealsWonB + s.dealsDrawn;
  const specs: MetricSpec[] = [
    ['胜率（发牌口径）', { n: s.dealsWonA + 0.5 * s.dealsDrawn, d: deals }, { n: s.dealsWonB + 0.5 * s.dealsDrawn, d: deals }, 'high'],
    ['当庄频率', { n: a.banker.hands, d: hands }, { n: b.banker.hands, d: hands }, 'neutral'],
    ['台上胜率', { n: a.banker.wins, d: a.banker.hands }, { n: b.banker.wins, d: b.banker.hands }, 'high'],
    ...perLevelSpecs('台上', a.banker.perLevel, b.banker.perLevel),
    ['台上打NT胜率', a.banker.ntHands, b.banker.ntHands, 'high'],
    ['台上平均失分', a.banker.avgLoss, b.banker.avgLoss, 'low'],
    ['台上扣底平均分数', a.banker.avgBottomPts, b.banker.avgBottomPts, 'neutral'],
    ['台上扣绝一门频率', a.banker.killSuitFreq, b.banker.killSuitFreq, 'neutral'],
    ['庄家保底频率', a.banker.keepBottom, b.banker.keepBottom, 'high'],
    ['台下胜率', { n: a.attacker.wins, d: a.attacker.hands }, { n: b.attacker.wins, d: b.attacker.hands }, 'high'],
    ...perLevelSpecs('台下', a.attacker.perLevel, b.attacker.perLevel),
    ['台下打NT胜率', a.attacker.ntHands, b.attacker.ntHands, 'high'],
    ['抠底频率', a.attacker.kouDiFreq, b.attacker.kouDiFreq, 'neutral'],
    ['抠底成功频率', a.attacker.kouDiSuccess, b.attacker.kouDiSuccess, 'high'],
    ['闲家抠底平均加分', a.attacker.avgKouDi, b.attacker.avgKouDi, 'high'],
    ['每墩胜率', a.tricks.won, b.tricks.won, 'high'],
    // leads 的 d 存的是总墩数，本指标分母是小局数
    ['每局平均领出次数', { n: a.tricks.leads.n, d: hands }, { n: b.tricks.leads.n, d: hands }, 'neutral'],
    ['每局平均每墩领出张数', a.tricks.leadCards, b.tricks.leadCards, 'neutral'],
    ['平均每局赢得张数', a.tricks.cardsWon, b.tricks.cardsWon, 'high'],
  ];
  return rowsFrom(specs);
}

export interface NTReportInput {
  nameA: string;
  nameB: string;
  seed: number;
  elapsedMs: number;
  /** 发牌数目标（运行结束时停在的那一档）。 */
  targetDeals: number;
  outcome: SignificanceResult;
  verdict: string;
  stats: NTStats;
  /** 是否输出 ANSI 颜色（非 TTY 时关掉）。 */
  color: boolean;
}

export function printNTReport(input: NTReportInput): void {
  const { nameA, nameB, seed, elapsedMs, targetDeals, outcome, verdict, stats, color } = input;
  const a = stats.statsA;
  const hands = a.handsPlayed;
  const deals = stats.dealsWonA + stats.dealsWonB + stats.dealsDrawn;

  console.log('\n' + '='.repeat(64));
  console.log('无主（NT）竞技场报告');
  console.log('='.repeat(64));
  console.log(`A: ${nameA}    B: ${nameB}    seed=${seed}`);
  console.log(`发牌数: ${deals} 副（目标 ${targetDeals} 副，过滤掉 ${stats.skippedDeals} 副）  耗时 ${(elapsedMs / 1000).toFixed(0)}s`);
  console.log(`结论: ${verdict}`);
  if (outcome.n > 0) {
    console.log(`  leader=${outcome.leader ?? '—'}  p̂=${outcome.pHat.toFixed(4)}  99% CI 下界=${outcome.ciLower.toFixed(4)}  (n=${outcome.n})`);
  }
  console.log('\n全局指标（双方共享）:');
  console.log(`  每副平均小局数: ${ratioText({ n: hands, d: deals })}`);
  console.log(`  每局平均墩数: ${ratioText({ n: a.tricks.won.d, d: hands })}`);
  console.log(`  平局发牌: ${stats.dealsDrawn}   中止小局: ${a.abortedHands}`);

  console.log('\n对比表（绿 = 该侧更优；相等都标绿；中性指标不染色）:');
  for (const line of renderTable(
    ['指标', `策略A（${nameA}）`, `策略B（${nameB}）`],
    comparisonRows(stats),
    color,
  )) {
    console.log(line);
  }
  console.log('='.repeat(64));
}
