/**
 * 单副牌 A/B 竞技场 worker：从 stdin 读 JSON 任务行、把 JSON 结果行写回 stdout，循环。
 * stdin 关闭即退出。
 *
 * 启动方式见 solo-run.ts 的 ChildPool.create（同一个 node + tsx loader，不经 npx），
 * 参数为 `<seed> <strategyA> <strategyB> <levelsCsv> <ntOnly 0|1> <filtersCsv>`；
 * 任务为发牌区间 { dealStart, dealCount }。
 */
import readline from 'node:readline';
import { runSoloDeals, soloStatsToJSON } from './solo-arena.js';
import { strategyByName } from './strategies.js';
import { parseLevels } from './solo-filter.js';

interface Task {
  id: number;
  dealStart: number;
  dealCount: number;
}

const seed = Number(process.argv[2]);
const strategyA = strategyByName(process.argv[3]);
const strategyB = strategyByName(process.argv[4]);
const levels = parseLevels(process.argv[5]);
const ntOnly = process.argv[6] === '1';
const filtersArg = process.argv[7] ?? '';
const dealFilters = filtersArg ? filtersArg.split(',').filter(Boolean) : [];

process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');

// crlfDelay 必须是有界值：Infinity 在管道输入上（流不关闭时）行事件不触发。
const rl = readline.createInterface({ input: process.stdin, crlfDelay: 100 });
rl.on('line', (line: string) => {
  const task = JSON.parse(line) as Task;
  const stats = runSoloDeals(
    seed, task.dealStart, task.dealCount, levels, strategyA, strategyB, ntOnly, dealFilters,
  );
  process.stdout.write(JSON.stringify({ id: task.id, stats: soloStatsToJSON(stats) }) + '\n');
});
