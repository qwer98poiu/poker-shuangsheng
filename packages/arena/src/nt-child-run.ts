/**
 * NT arena worker: reads JSON task lines from stdin, writes JSON result lines
 * to stdout, then loops. Exits when stdin closes.
 *
 * 启动方式见 nt-run.ts 的 ChildPool.create（同一个 node + tsx loader，不经 npx），
 * 参数为 <seed> <strategyA> <strategyB>；任务为发牌区间 { dealStart, dealCount }。
 */
import readline from 'node:readline';
import { runNTDeals, ntStatsToJSON } from './nt-arena.js';
import { strategyByName } from './strategies.js';

interface Task {
  id: number;
  dealStart: number;
  dealCount: number;
}

const seed = Number(process.argv[2]);
const strategyA = strategyByName(process.argv[3]);
const strategyB = strategyByName(process.argv[4]);

process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');

// crlfDelay 必须是有界值：Infinity 在管道输入上（流不关闭时）行事件不触发。
const rl = readline.createInterface({ input: process.stdin, crlfDelay: 100 });
rl.on('line', (line: string) => {
  const task = JSON.parse(line) as Task;
  const stats = runNTDeals(seed, task.dealStart, task.dealCount, strategyA, strategyB);
  process.stdout.write(JSON.stringify({ id: task.id, stats: ntStatsToJSON(stats) }) + '\n');
});
