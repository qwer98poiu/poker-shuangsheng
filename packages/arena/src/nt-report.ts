/**
 * NT arena report — same layout as the general arena's, but only A's numbers
 * (A is the strategy under test; B is the baseline it is measured against).
 *
 * The headline win rate is deal-based (the north star, same numbers the
 * significance test runs on); the breakdowns below it are 小局-based, exactly
 * like the general arena's match rate vs hand breakdowns.
 */
import type { NTStats } from './nt-arena.js';
import { compareRates } from './nt-significance.js';
import type { CountPair } from './stats.js';
import type { SignificanceResult } from './significance.js';

const LEVEL_NAMES: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

function ratio(p: CountPair): string {
  if (p.d === 0) return '—';
  return `${(p.n / p.d).toFixed(4)} (${Math.round(p.n)}/${Math.round(p.d)})`;
}

function perLevelTable(title: string, m: Map<number, CountPair>): string {
  const lines: string[] = [];
  for (let lv = 2; lv <= 14; lv++) {
    const p = m.get(lv);
    lines.push(`    L${LEVEL_NAMES[lv]}: ${p ? ratio(p) : '—'}`);
  }
  return `${title}:\n${lines.join('\n')}`;
}

/** A-vs-B verdict line for one rate metric (no Δ column — B follows from A). */
function sigRow(label: string, pA: CountPair, pB: CountPair): string {
  const cmp = compareRates(pA.n, pA.d, pB.n, pB.d);
  const verdict = pA.d === 0 || pB.d === 0
    ? '—'
    : cmp.significant ? `${cmp.leader} 显著` : '不显著';
  const ci = pA.d === 0 || pB.d === 0
    ? '—'
    : `[${cmp.diffCi.lower >= 0 ? '+' : ''}${cmp.diffCi.lower.toFixed(4)}, ${cmp.diffCi.upper >= 0 ? '+' : ''}${cmp.diffCi.upper.toFixed(4)}]`;
  return `  ${label.padEnd(24)}${ratio(pA).padEnd(22)}${ratio(pB).padEnd(22)}${ci.padEnd(20)}${verdict}`;
}

/** A mean (not a proportion) — A and B side by side, no verdict. */
function valueRow(label: string, pA: CountPair, pB: CountPair): string {
  return `  ${label.padEnd(24)}${ratio(pA).padEnd(22)}${ratio(pB).padEnd(22)}${'—'.padEnd(20)}均值不作显著性检验`;
}

export interface NTReportInput {
  nameA: string;
  nameB: string;
  seed: number;
  elapsedMs: number;
  /** Deal target the run stopped at. */
  targetDeals: number;
  outcome: SignificanceResult;
  verdict: string;
  stats: NTStats;
}

export function formatNTReport(input: NTReportInput): string {
  const { nameA, nameB, seed, elapsedMs, targetDeals, outcome, verdict, stats } = input;
  const a = stats.statsA;
  const b = stats.statsB;
  const hands = a.handsPlayed;
  const deals = stats.dealsWonA + stats.dealsWonB + stats.dealsDrawn;
  const lines: string[] = [];

  lines.push('');
  lines.push('='.repeat(64));
  lines.push('无主（NT）竞技场报告');
  lines.push('='.repeat(64));
  lines.push(`A: ${nameA}    B: ${nameB}    seed=${seed}`);
  lines.push(`发牌数: ${deals} 副（目标 ${targetDeals} 副）  耗时 ${(elapsedMs / 1000).toFixed(0)}s`);
  lines.push(`结论: ${verdict}`);
  if (outcome.n > 0) {
    lines.push(`  leader=${outcome.leader ?? '—'}  p̂=${outcome.pHat.toFixed(4)}  99% CI 下界=${outcome.ciLower.toFixed(4)}  (n=${outcome.n})`);
  }
  lines.push('');
  lines.push('全局指标:');
  lines.push(`  每局平均墩数: ${ratio({ n: a.tricks.won.d, d: hands })}`);
  lines.push(`  中止小局: ${a.abortedHands}`);
  lines.push('');
  lines.push(`策略 A (${nameA}):`);
  lines.push(`  胜率: ${ratio({ n: stats.dealsWonA + 0.5 * stats.dealsDrawn, d: deals })}`);
  lines.push(`  台上胜率: ${ratio({ n: a.banker.wins, d: a.banker.hands })}`);
  lines.push(perLevelTable('  台上各等级胜率', a.banker.perLevel));
  lines.push(`  台上打NT胜率: ${ratio(a.banker.ntHands)}`);
  lines.push(`  台上平均失分: ${ratio(a.banker.avgLoss)}`);
  lines.push(`  台上扣底平均分数: ${ratio(a.banker.avgBottomPts)}`);
  lines.push(`  台上扣绝一门频率: ${ratio(a.banker.killSuitFreq)}`);
  lines.push(`  庄家保底频率: ${ratio(a.banker.keepBottom)}`);
  lines.push(`  台下胜率: ${ratio({ n: a.attacker.wins, d: a.attacker.hands })}`);
  lines.push(perLevelTable('  台下各等级胜率', a.attacker.perLevel));
  lines.push(`  台下打NT胜率: ${ratio(a.attacker.ntHands)}`);
  lines.push(`  抠底频率: ${ratio(a.attacker.kouDiFreq)}`);
  lines.push(`  抠底成功频率: ${ratio(a.attacker.kouDiSuccess)}`);
  lines.push(`  闲家抠底平均加分: ${ratio(a.attacker.avgKouDi)}`);
  lines.push(`  每墩胜率: ${ratio(a.tricks.won)}`);
  lines.push(`  每局平均领出次数: ${ratio({ n: a.tricks.leads.n, d: hands })}`);
  lines.push(`  每局平均每墩领出张数: ${ratio(a.tricks.leadCards)}`);
  lines.push(`  平均每局赢得张数: ${ratio(a.tricks.cardsWon)}`);
  lines.push('');

  lines.push('附：各指标 A / B 显著性（99% Newcombe 区间，指标按小局口径）:');
  lines.push(`  ${'指标'.padEnd(24)}${'A'.padEnd(22)}${'B'.padEnd(22)}${'99% CI(Δ)'.padEnd(20)}结论`);
  lines.push(sigRow('台上胜率', { n: a.banker.wins, d: a.banker.hands }, { n: b.banker.wins, d: b.banker.hands }));
  for (let lv = 2; lv <= 14; lv++) {
    lines.push(sigRow(`台上等级 ${LEVEL_NAMES[lv]} 胜率`,
      a.banker.perLevel.get(lv) ?? { n: 0, d: 0 },
      b.banker.perLevel.get(lv) ?? { n: 0, d: 0 }));
  }
  lines.push(sigRow('台上打NT胜率', a.banker.ntHands, b.banker.ntHands));
  lines.push(sigRow('台上扣绝一门频率', a.banker.killSuitFreq, b.banker.killSuitFreq));
  lines.push(sigRow('庄家保底频率', a.banker.keepBottom, b.banker.keepBottom));
  lines.push(sigRow('台下胜率', { n: a.attacker.wins, d: a.attacker.hands }, { n: b.attacker.wins, d: b.attacker.hands }));
  for (let lv = 2; lv <= 14; lv++) {
    lines.push(sigRow(`台下等级 ${LEVEL_NAMES[lv]} 胜率`,
      a.attacker.perLevel.get(lv) ?? { n: 0, d: 0 },
      b.attacker.perLevel.get(lv) ?? { n: 0, d: 0 }));
  }
  lines.push(sigRow('台下打NT胜率', a.attacker.ntHands, b.attacker.ntHands));
  lines.push(sigRow('抠底频率', a.attacker.kouDiFreq, b.attacker.kouDiFreq));
  lines.push(sigRow('抠底成功频率', a.attacker.kouDiSuccess, b.attacker.kouDiSuccess));
  lines.push(sigRow('每墩胜率', a.tricks.won, b.tricks.won));
  lines.push(valueRow('平均每局赢得张数', a.tricks.cardsWon, b.tricks.cardsWon));
  lines.push('='.repeat(64));
  return lines.join('\n');
}
