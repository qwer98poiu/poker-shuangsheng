/**
 * 批量测量 Elo 对决：按 elo-matchups.json 的 seed 与对决列表逐组跑竞技场，
 * 把每组 p̂ 写回 elo-matches.json。
 *
 * 运行：npx tsx packages/arena/scripts/run-elo-matchups.ts
 *
 * 输入 elo-matchups.json 与脚本同目录，形状 { "seed": 47, "matchups": [["a", "b"], …] }。
 * 它是本地实验配置（seed 与待测对决随测量变化），不入库，见根 .gitignore。
 *
 * 每组命令：npm run arena -- --strategy-a <a> --strategy-b <b> --seed <seed>
 * 每组跑完打印报告开头（A/B、对局数、结论、leader/p̂/CI）；
 * 运行中只回显带显著性结果的进度行（leader/p̂/CI）与中止提示，不输出普通进度行。
 *
 * 写入口径：elo-matches.json 的 `pHat` 是 **a 对 b 的含平局胜率**；竞技场报告里的
 * p̂ 是**领先方**的胜率，故 leader=B 时取 1 − p̂。同 (a, b) 已存在则覆盖，否则追加；
 * 行按 (a, b) 字典序排列，与现有文件一致。每跑完一组立即落盘，中断时已完成的结果保留。
 *
 * 本脚本不运行 elo-calc.ts，也不做任何 git 操作。
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const REPO_ROOT = resolve(SCRIPT_DIR, '../../..');
const MATCHES_PATH = resolve(SCRIPT_DIR, 'elo-matches.json');
const MATCHUPS_PATH = resolve(SCRIPT_DIR, 'elo-matchups.json');
const SEPARATOR = '='.repeat(64);

interface MatchRow {
  a: string;
  b: string;
  pHat: number;
}

interface MatchupsConfig {
  seed: number;
  matchups: readonly (readonly [string, string])[];
}

interface ArenaResult {
  /** 报告开头（= 分隔线、A/B 行、对局数、结论、leader 行）。 */
  header: string[];
  /** 报告里领先方的 p̂（落后方仅赢时也 > 0.5）。 */
  leaderPHat: number;
  leader: 'A' | 'B' | null;
}

function runArena(a: string, b: string, seed: number): Promise<ArenaResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      'npm',
      ['run', 'arena', '--', '--strategy-a', a, '--strategy-b', b, '--seed', String(seed)],
      { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const stdout: string[] = [];
    const stderr: string[] = [];

    const onLine = (line: string): void => {
      // 只回显带显著性结果的检查行与中止提示；普通进度行（无 leader/p̂/CI）不刷屏。
      // 完整报告留给结束后的「报告开头」。
      const hasSignificance = line.includes('已完赛') && line.includes('leader=');
      if (hasSignificance || line.includes('已中止') || line.includes('已保存')) {
        process.stdout.write(`  ${line.trim()}\n`);
      }
    };

    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout.push(chunk);
      pending += chunk;
      const parts = pending.split(/\r?\n/);
      pending = parts.pop() ?? '';
      for (const part of parts) onLine(part);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr.push(chunk);
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      const lines = stdout.join('').split(/\r?\n/);
      if (code !== 0) {
        reject(new Error(`竞技场退出码 ${code}（${a} vs ${b}）\n${stderr.join('')}`));
        return;
      }

      // 最终报告的 A/B 行是最后一块「===== / 策略竞技场报告 / ===== / A: ...
      // / 对局数 / 结论 / leader」；从 A 行往前取分隔线，向后取到 leader 行。
      let aIdx = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].startsWith('A: ') && lines[i].includes('seed=')) { aIdx = i; break; }
      }
      if (aIdx < 0) {
        reject(new Error(`找不到报告开头（${a} vs ${b}）`));
        return;
      }

      const header = [SEPARATOR, ...lines.slice(aIdx, aIdx + 3)]; // A、对局数、结论
      const leaderLine = lines.slice(aIdx).find((l) => l.includes('leader='));
      if (!leaderLine) {
        reject(new Error(`报告缺少 leader 行（${a} vs ${b}）`));
        return;
      }
      header.push(leaderLine);

      const leaderMatch = /leader=(A|B|null)/.exec(leaderLine);
      const pHatMatch = /p̂=([0-9.]+)/.exec(leaderLine);
      if (!pHatMatch) {
        reject(new Error(`无法解析 p̂（${a} vs ${b}）：${leaderLine}`));
        return;
      }
      const leaderRaw = leaderMatch?.[1];
      const leader: 'A' | 'B' | null = leaderRaw === 'A' || leaderRaw === 'B' ? leaderRaw : null;
      resolvePromise({ header, leaderPHat: Number(pHatMatch[1]), leader });
    });
  });
}

function loadConfig(): MatchupsConfig {
  let text: string;
  try {
    text = readFileSync(MATCHUPS_PATH, 'utf8');
  } catch {
    throw new Error(
      `elo-matchups.json 不存在（${MATCHUPS_PATH}）：` +
      '请按 { "seed": 47, "matchups": [["a", "b"], …] } 创建（该文件不入库）',
    );
  }
  const raw: unknown = JSON.parse(text);
  const { seed, matchups } = (raw ?? {}) as Record<string, unknown>;
  if (typeof seed !== 'number' || !Number.isInteger(seed)) {
    throw new Error(`elo-matchups.json：seed 应为整数，实际 ${JSON.stringify(seed)}`);
  }
  if (!Array.isArray(matchups) || matchups.length === 0) {
    throw new Error('elo-matchups.json：matchups 应为非空数组');
  }
  return {
    seed,
    matchups: matchups.map((pair: unknown, i): readonly [string, string] => {
      const [a, b] = Array.isArray(pair) ? pair : [];
      if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) {
        throw new Error(`elo-matchups.json 第 ${i + 1} 组对决形状不对：${JSON.stringify(pair)}`);
      }
      return [a, b];
    }),
  };
}

function loadMatches(): MatchRow[] {
  const raw: unknown = JSON.parse(readFileSync(MATCHES_PATH, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('elo-matches.json：应为数组');
  return raw.map((row: unknown, i) => {
    const { a, b, pHat } = (row ?? {}) as Record<string, unknown>;
    const bad = typeof a !== 'string' || typeof b !== 'string' || typeof pHat !== 'number';
    if (bad) throw new Error(`elo-matches.json 第 ${i + 1} 行形状不对：${JSON.stringify(row)}`);
    return { a, b, pHat };
  });
}

function saveMatches(rows: MatchRow[]): void {
  const sorted = [...rows].sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  const body = sorted
    .map(({ a, b, pHat }) => `  { "a": "${a}", "b": "${b}", "pHat": ${pHat.toFixed(4)} }`)
    .join(',\n');
  writeFileSync(MATCHES_PATH, `[\n${body}\n]\n`, 'utf8');
}

function upsert(rows: MatchRow[], a: string, b: string, pHat: number): void {
  const row = rows.find((r) => r.a === a && r.b === b);
  if (row) row.pHat = pHat;
  else rows.push({ a, b, pHat });
}

async function main(): Promise<void> {
  const { seed, matchups } = loadConfig();
  console.log(`Elo 对决测量：${matchups.length} 组，seed=${seed}`);
  console.log(`输入：${MATCHUPS_PATH}`);
  console.log(`结果写入：${MATCHES_PATH}\n`);

  const matches = loadMatches();
  const failed: string[] = [];

  for (const [i, [a, b]] of matchups.entries()) {
    console.log(`[${i + 1}/${matchups.length}] ${a} vs ${b} …`);
    const t0 = Date.now();
    let result: ArenaResult;
    try {
      result = await runArena(a, b, seed);
    } catch (err) {
      console.error(`  失败：${(err as Error).message}`);
      failed.push(`${a} vs ${b}`);
      continue;
    }

    console.log(result.header.join('\n'));
    console.log(`  耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

    // 报告 p̂ 是领先方的胜率；JSON 需要 a 的胜率。
    const pHatA = result.leader === 'B' ? 1 - result.leaderPHat : result.leaderPHat;
    upsert(matches, a, b, pHatA);
    saveMatches(matches);
    console.log(`  已写入 elo-matches.json：${a} vs ${b}  p̂(a)=${pHatA.toFixed(4)}\n`);
  }

  if (failed.length > 0) {
    throw new Error(`以下对决失败：${failed.join('；')}`);
  }
  console.log(`全部 ${matchups.length} 组完成，elo-matches.json 已更新。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
