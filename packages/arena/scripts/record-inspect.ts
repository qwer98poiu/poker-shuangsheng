/**
 * 录制数据集查看器（reader 的最小验收工具）。
 *
 *   npx tsx packages/arena/scripts/record-inspect.ts <runDir>
 *   npx tsx packages/arena/scripts/record-inspect.ts <runDir> --hand 12345
 *   npx tsx packages/arena/scripts/record-inspect.ts <runDir> --chain 1 --index 2345
 *   npx tsx packages/arena/scripts/record-inspect.ts <runDir> --level 7 --declarer 2 --trump NT --limit 20
 *
 * 不给查询条件时打印 manifest 汇总。按 context 过滤直接扫 `.idx`（不写二级索引）。
 */
import path from 'node:path';
import {
  initialHands, RecordDataset,
} from '../src/record-codec.js';
import { NT_TRUMP_CODE, TRUMP_SUIT_BY_CODE } from '../src/record-types.js';
import type { HandRecord } from '../src/record-types.js';

function usage(): void {
  console.log(`用法: npx tsx packages/arena/scripts/record-inspect.ts <runDir> [选项]

  --hand N              打印全局第 N 手（完整 JSON）
  --chain C --index I   打印链 C 的链内第 I 手（完整 JSON）
  --level L             按等级过滤（2..14）
  --declarer D          按庄家过滤（0..3）
  --trump S|H|C|D|NT    按主牌过滤
  --block B             按 random 块号过滤
  --limit N             过滤时最多打印多少手（默认 10；0 = 只看计数）
  -h, --help            显示帮助`);
}

function trumpLabel(code: number): string {
  if (code === NT_TRUMP_CODE) return 'NT';
  return TRUMP_SUIT_BY_CODE[code] ?? `?${code}`;
}

function printHand(record: HandRecord, dataset: RecordDataset): void {
  const hands = initialHands(record);
  const out = {
    ...record,
    trump: trumpLabel(record.trumpCode),
    initialHands: hands,
  };
  console.log(JSON.stringify(out, null, 2));
  const chain = dataset.chainInfos.find(c => record.globalHandIndex >= c.globalStart
    && record.globalHandIndex < c.globalStart + c.handsRequested);
  if (chain) {
    console.log(`# chain=${chain.chainId} 链内 #${record.globalHandIndex - chain.globalStart}`
      + ` block=${record.blockIndex} cell=${record.cellIndex}`
      + ` level=${record.level} declarer=${record.declarer} trump=${trumpLabel(record.trumpCode)}`);
  }
}

interface Args {
  runDir: string;
  hand: number | null;
  chain: number | null;
  index: number | null;
  level: number | null;
  declarer: number | null;
  trump: number | null;
  block: number | null;
  limit: number;
}

function parseHandIndex(argv: string[], i: number, name: string): number {
  const raw = argv[i + 1];
  if (raw === undefined) throw new Error(`${name} 需要参数值`);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} 必须是非负整数: ${raw}`);
  return n;
}

function parseArgs(argv: string[]): Args | null {
  const args: Args = {
    runDir: '', hand: null, chain: null, index: null,
    level: null, declarer: null, trump: null, block: null, limit: 10,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h':
      case '--help':
        usage();
        return null;
      case '--hand': args.hand = parseHandIndex(argv, i, a); i += 1; break;
      case '--chain': args.chain = parseHandIndex(argv, i, a); i += 1; break;
      case '--index': args.index = parseHandIndex(argv, i, a); i += 1; break;
      case '--level': args.level = parseHandIndex(argv, i, a); i += 1; break;
      case '--declarer': args.declarer = parseHandIndex(argv, i, a); i += 1; break;
      case '--block': args.block = parseHandIndex(argv, i, a); i += 1; break;
      case '--limit': args.limit = parseHandIndex(argv, i, a); i += 1; break;
      case '--trump': {
        const v = argv[i + 1];
        if (v === undefined) throw new Error('--trump 需要参数值');
        if (v === 'NT') args.trump = NT_TRUMP_CODE;
        else {
          const code = TRUMP_SUIT_BY_CODE.findIndex(s => s === v.toUpperCase());
          if (code < 0) throw new Error('--trump 只能是 S/H/C/D/NT');
          args.trump = code;
        }
        i += 1;
        break;
      }
      default:
        if (a.startsWith('-')) throw new Error(`未知选项: ${a}`);
        positional.push(a);
    }
  }
  if (positional.length !== 1) throw new Error('需要且只需要一个 runDir');
  args.runDir = path.resolve(positional[0]);
  return args;
}

function main(): void {
  let args: Args | null;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    usage();
    process.exitCode = 1;
    return;
  }
  if (!args) return;

  const dataset = RecordDataset.open(args.runDir);
  const manifest = dataset.manifest;
  try {
    if (args.hand !== null) {
      const record = dataset.getHand(args.hand);
      if (!record) { console.error(`找不到全局第 ${args.hand} 手`); process.exitCode = 1; return; }
      printHand(record, dataset);
      return;
    }
    if (args.chain !== null || args.index !== null) {
      if (args.chain === null || args.index === null) {
        console.error('--chain 与 --index 必须同时给出');
        process.exitCode = 1;
        return;
      }
      const record = dataset.getChainHand(args.chain, args.index);
      if (!record) {
        console.error(`找不到 chain ${args.chain} 的链内第 ${args.index} 手`);
        process.exitCode = 1;
        return;
      }
      printHand(record, dataset);
      return;
    }

    const hasFilter = args.level !== null || args.declarer !== null
      || args.trump !== null || args.block !== null;
    if (!hasFilter) {
      console.log(`runDir      ${args.runDir}`);
      console.log(`status      ${manifest.status} | ${manifest.contextMode}`
        + ` | ${manifest.handsCompleted}/${manifest.handsRequested} 手`);
      console.log(`seed        ${manifest.seed.base} (${manifest.seed.source}, ${manifest.seed.algorithm})`);
      console.log(`strategies  A=${manifest.strategies.A} B=${manifest.strategies.B}`);
      for (const chain of dataset.chainInfos) {
        const m = manifest.chains.find(c => c.chainId === chain.chainId);
        console.log(`chain ${chain.chainId}  globalStart=${chain.globalStart}`
          + ` records=${dataset.chainHandCount(chain.chainId)}`
          + ` status=${m?.status ?? '?'}`);
      }
      return;
    }

    let matched = 0;
    let printed = 0;
    for (const chain of dataset.chainInfos) {
      for (let shard = 0; shard < dataset.shardCount(chain.chainId); shard++) {
        for (const entry of dataset.readIndex(chain.chainId, shard)) {
          if (args.level !== null && entry.level !== args.level) continue;
          if (args.declarer !== null && entry.declarer !== args.declarer) continue;
          if (args.trump !== null && entry.trumpCode !== args.trump) continue;
          if (args.block !== null && entry.blockIndex !== args.block) continue;
          matched += 1;
          if (printed < args.limit) {
            const global = chain.globalStart + entry.chainHandIndex;
            const record = dataset.getHand(global);
            console.log(`global=${global} chain=${chain.chainId} hand=${entry.chainHandIndex}`
              + ` block=${entry.blockIndex} level=${entry.level} declarer=${entry.declarer}`
              + ` trump=${trumpLabel(entry.trumpCode)}`
              + (record ? ` finalPts=${record.finalPts} cell=${record.cellIndex}` : ''));
            printed += 1;
          }
        }
      }
    }
    console.log(`# matched ${matched} 手，打印 ${printed} 手`);
  } finally {
    dataset.close();
  }
}

main();
