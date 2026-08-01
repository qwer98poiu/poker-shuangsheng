/**
 * Child process worker: reads JSON task lines from stdin, writes JSON result
 * lines to stdout, then loops. Exits when stdin closes.
 *
 * Used INSTEAD of worker_threads: tsx's loader on Node 17.5 deadlocks inside
 * worker threads under concurrent work (empirically confirmed across several
 * import/message patterns). A child process runs its own loader in its main
 * thread, which is reliable.
 *
 * Usage: npx tsx src/child-run.ts <seed> <strategyA> <strategyB>
 */
import readline from 'node:readline';
import { runPairs } from './run-pairs.js';
import { strategyByName } from './strategies.js';
import { toJSON } from './stats.js';

interface Task {
  id: number;
  pairStart: number;
  pairCount: number;
}

const seed = Number(process.argv[2]);
const strategyA = strategyByName(process.argv[3]);
const strategyB = strategyByName(process.argv[4]);

process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');

// crlfDelay 必须是有界值：Infinity 在管道输入上（流不关闭时）行事件不触发。
const rl = readline.createInterface({ input: process.stdin, crlfDelay: 100 });
rl.on('line', (line: string) => {
  const task = JSON.parse(line) as Task;
  const { statsA, statsB } = runPairs(seed, task.pairStart, task.pairCount, strategyA, strategyB);
  process.stdout.write(JSON.stringify({ id: task.id, statsA: toJSON(statsA), statsB: toJSON(statsB) }) + '\n');
});
