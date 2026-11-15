/**
 * Deal arena worker: reads JSON task lines from stdin, writes JSON result lines
 * to stdout, then loops. Exits when stdin closes.
 *
 * 启动方式见 deal-run.ts 的 ChildPool.create（同一个 node + tsx loader，不经 npx），
 * 参数为 <seed> <strategyA> <strategyB> <levelsCsv> <filtersCsv> <declarerSeatsCsv> <probeModule>；
 * 任务为发牌区间 { dealStart, dealCount }。
 */
import readline from 'node:readline';
import { runDealDeals, dealStatsToJSON, parseDeclarerSeats } from './deal-arena.js';
import { parseLevels } from './deal-filter.js';
import { normalizeSeed } from './rng.js';
import { strategyByName } from './strategies.js';
import { loadProbeModule } from './probe.js';
import type { ProbeModule } from './probe.js';

interface Task {
  id: number;
  dealStart: number;
  dealCount: number;
}

async function main(): Promise<void> {
  const seed = normalizeSeed(process.argv[2] ?? '');
  const strategyA = strategyByName(process.argv[3]);
  const strategyB = strategyByName(process.argv[4]);
  const levels = parseLevels(process.argv[5] ?? '');
  const filters = (process.argv[6] ?? '').split(',').filter(Boolean);
  const declarerSeats = parseDeclarerSeats(process.argv[7] ?? '0');
  const probePath = process.argv[8] ?? '';
  const probe: ProbeModule | undefined = probePath
    ? await loadProbeModule(probePath) : undefined;

  process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');

  // crlfDelay 必须是有界值：Infinity 在管道输入上（流不关闭时）行事件不触发。
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: 100 });
  rl.on('line', (line: string) => {
    const task = JSON.parse(line) as Task;
    const stats = runDealDeals(
      seed, task.dealStart, task.dealCount, levels, strategyA, strategyB, filters,
      declarerSeats, probe,
    );
    process.stdout.write(JSON.stringify({
      id: task.id,
      stats: dealStatsToJSON(stats, { includeInternal: true }),
    }) + '\n');
  });
}

main().catch(e => { console.error(e); process.exit(1); });
