/**
 * 无主（NT）竞技场报告 —— 与整体竞技场同一张 A/B 对比表（report.ts 渲染：按显示
 * 宽度对齐、更优侧标绿），差别只在指标集合：无主局没有「打有主」口径，也没有整场
 * （对王/升到 A）概念；本竞技场每一局都是无主，「打NT胜率」与「台上/台下胜率」完全
 * 同值，故不再单列这两行。
 *
 * **两个判据并存，别混着比**：
 * - **升级口径**（「胜率（发牌口径）」按副聚合、「胜率（小局升级口径）」与「等级 X
 *   胜率」block 按对聚合）：同一 (等级, 庄家座位) 的两场镜像配成一对，比
 *   `tierOf(闲家分)`——即「这局值几级」；显著性检验跑在发牌口径那组计数上。
 * - **80 分口径**（台上/台下两行的胜率与 per-level）：仍是「闲家过 80 即上台」。
 *   升级口径下 A 在一对里恰有一腿当庄、一腿当闲，台上/台下恒等（角色信息被配对消掉），
 *   所以角色维度只能靠这套 80 口径的读数保留。
 *
 * 对比表第 4 列是**平局率**：升级口径的三族（发牌口径、小局升级口径、等级 X 胜率）是
 * A 胜 / B 胜 / 平 三分，三格共享同一分母、相加恒为 1（`trioShares`）；判据本身没有
 * 「平」这一态的行（80 口径的台上/台下、每墩胜率）与各种频率/均值一律渲染成 —。
 * ⚠️ 表头的 `p̂` 与显著性仍按「平局算 0.5 胜」的旧约定，所以表头那个数与表内
 * 「胜率（发牌口径）」行的 **A 格不相等**——前者把平局折半记给双方，后者不含平局。
 */
import type { NTStats } from './nt-arena.js';
import type { CountPair } from './stats.js';
import type { TierBucket } from './tier.js';
import { renderTable, perLevelSpecs, rowsFrom, ratioText, trioShares } from './report.js';
import type { MetricSpec, TableRow } from './report.js';
import type { SignificanceResult } from './significance.js';

/** 等级 block：把每等级的配对三分类摊成 A/B/平 三列的 13 条指标（不分台上/台下）。 */
function tierLevelSpecs(byLevel: Map<number, TierBucket>): MetricSpec[] {
  const ca = new Map<number, CountPair>();
  const cb = new Map<number, CountPair>();
  const cd = new Map<number, CountPair>();
  for (const [lv, bucket] of byLevel) {
    const t = trioShares(bucket);
    ca.set(lv, t.a);
    cb.set(lv, t.b);
    cd.set(lv, t.draw);
  }
  return perLevelSpecs('等级', ca, cb, cd);
}

/**
 * A/B 对比表的数据行；方向约定与整体竞技场一致（见 run.ts 的说明）。
 * 升级口径三族带上第 4 格（平局率，三格同分母）；其余行不给 draw，渲染成 —。
 */
export function comparisonRows(s: NTStats): TableRow[] {
  const a = s.statsA;
  const b = s.statsB;
  const hands = a.handsPlayed;
  const deal = trioShares({ a: s.dealsWonA, b: s.dealsWonB, draw: s.dealsDrawn });
  const pair = trioShares({ a: s.pairWinsA, b: s.pairWinsB, draw: s.pairsDrawn });
  const specs: MetricSpec[] = [
    ['胜率（发牌口径）', deal.a, deal.b, 'high', deal.draw],
    ['胜率（小局升级口径）', pair.a, pair.b, 'high', pair.draw],
    ...tierLevelSpecs(s.tierByLevel),
    ['当庄频率', { n: a.banker.hands, d: hands }, { n: b.banker.hands, d: hands }, 'neutral'],
    ['台上胜率', { n: a.banker.wins, d: a.banker.hands }, { n: b.banker.wins, d: b.banker.hands }, 'high'],
    ...perLevelSpecs('台上', a.banker.perLevel, b.banker.perLevel),
    ['台上平均失分', a.banker.avgLoss, b.banker.avgLoss, 'low'],
    ['台上扣底平均分数', a.banker.avgBottomPts, b.banker.avgBottomPts, 'neutral'],
    ['台上扣绝一门频率', a.banker.killSuitFreq, b.banker.killSuitFreq, 'neutral'],
    ['庄家保底频率', a.banker.keepBottom, b.banker.keepBottom, 'high'],
    ['台下胜率', { n: a.attacker.wins, d: a.attacker.hands }, { n: b.attacker.wins, d: b.attacker.hands }, 'high'],
    ...perLevelSpecs('台下', a.attacker.perLevel, b.attacker.perLevel),
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
  console.log(`  每副平均配对数: ${ratioText({ n: stats.pairs, d: deals })}（中止小局的配对会整对作废）`);
  console.log(`  每局平均墩数: ${ratioText({ n: a.tricks.won.d, d: hands })}`);
  console.log(`  平局发牌: ${stats.dealsDrawn}   中止小局: ${a.abortedHands}`);

  console.log('\n对比表（绿 = 该侧更优；相等都标绿；中性指标不染色）:');
  for (const line of renderTable(
    ['指标', `策略A（${nameA}）`, `策略B（${nameB}）`, '平局率'],
    comparisonRows(stats),
    color,
  )) {
    console.log(line);
  }
  console.log('='.repeat(64));
}
