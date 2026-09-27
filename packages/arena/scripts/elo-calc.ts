/**
 * 根据竞技场报告的实测胜率计算一组策略的 Elo 分。
 *
 * 运行：npx tsx packages/arena/scripts/elo-calc.ts
 *
 * 用法：
 * 1. 编辑同目录的 `elo-matches.json` 更新实测数据：每行
 *    `{ a, b, pHat, n }`——`pHat` 为 a 对 b 的含平局胜率（来自竞技场报告），
 *    `n` 为对局数。数据与逻辑分家：该文件是**纯数据**，改动它不写 Changelog
 *    （check-commits 把 packages 下的 .json 数据文件排除在「代码/配置」口径外），
 *    所以**重测提交的标题必须写明测量日期**，否则以后无从追溯某行是哪次测的，
 *    例如 `docs: Elo table updated with 2026-09-27 measurements — ai 1249`。
 * 2. 确认本文件的 `ANCHOR`（锚点策略名）与 `ANCHOR_ELO`（其 Elo 分，实测给定）——
 *    两者是整个刻度唯一的自由参数，`GIVEN` 由它们派生，不必也不能单独改。
 *    它们留在本文件（不随数据搬走）：换锚点/重定刻度是**决策**，仍按代码提交。
 * 3. 运行脚本：输出各边 ΔR、各策略 Elo（1 位小数）、拟合残差（自洽性检查）。
 *
 * 补充新数据：
 * - 新对决：在 `elo-matches.json` 追加一行即可；新出现的策略名自动进入求解集合。
 * - 更换锚点策略：改 `ANCHOR`；重定刻度：改 `ANCHOR_ELO`。
 * - 读数进 README：某策略新拟合值与表中原值**只差 1** 时保留原值——新增对决会让整条
 *   刻度轻微漂移，逐次跟随只会让历史分数无谓抖动（差 2 及以上才改）。
 *
 * 方法（与报告口径一致）：
 * 1. 每场对决的 Elo 差 ΔR = 400·log10(p̂/(1−p̂))，p̂ 为含平局（按 0.5 计）的胜率。
 * 2. 各边的 ΔR 互相矛盾（图中有环）时，对 ΔR 做以对局数 n 为权重的加权最小二乘
 *    （WLS），固定锚点策略的 Elo（`ANCHOR_ELO`）解出全体 Elo。
 * 3. 输出拟合残差供自洽性检查（残差应远小于 100 量级的 Elo 差）。
 *
 * 已知近似：visibleTrickPoints 相关近似不涉及本脚本；p̂ 的统计误差（n 不同）由
 * 权重 n 自动体现。
 */
import matchesRaw from './elo-matches.json' with { type: 'json' };

interface MatchRow {
  readonly a: string;
  readonly b: string;
  readonly pHat: number;
  readonly n: number;
}

/**
 * 校验数据文件形状——喂错立刻炸，不把脏数据静默算进刻度
 * （与 `aiChooseBottomCards` 的 33 张断言同一口径）。
 */
function parseMatches(raw: unknown): MatchRow[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('elo-matches.json：应为非空数组');
  }
  return raw.map((row: unknown, i: number) => {
    const { a, b, pHat, n } = (row ?? {}) as Record<string, unknown>;
    const bad = typeof a !== 'string' || typeof b !== 'string'
      || typeof pHat !== 'number' || !(pHat > 0 && pHat < 1)
      || typeof n !== 'number' || !Number.isInteger(n) || n <= 0;
    if (bad) {
      throw new Error(`elo-matches.json 第 ${i + 1} 行形状不对：${JSON.stringify(row)}`);
    }
    return { a, b, pHat, n } as MatchRow;
  });
}

const MATCHES: readonly MatchRow[] = parseMatches(matchesRaw);

/** 锚点策略：其 Elo 由 ANCHOR_ELO 给定，其余策略都是相对它解出来的。 */
const ANCHOR = 'ai-0802';

/**
 * 锚点策略的 Elo 分（实测给定）——**整个刻度唯一的自由参数**，
 * 想换刻度只改这一个常量；脚本里其余地方一律引用它，不再写字面量。
 * 当前值 = 扣底口径修复（2026-09-16）后的实测分。
 */
const ANCHOR_ELO = 1082.7;

/** 用户给定值（仅锚点策略；其余策略为求解对象，显示重算值本身）。 */
const GIVEN: Record<string, number> = {
  [ANCHOR]: ANCHOR_ELO,
};

function log10(x: number): number {
  return Math.log(x) / Math.LN10;
}

/** 单场对决的 Elo 差：ΔR = 400·log10(p̂/(1−p̂))。 */
function deltaFromWinRate(p: number): number {
  return 400 * log10(p / (1 - p));
}

/** 解线性方程组 A x = b（高斯消元，N 小无需泛化）。 */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    // 部分主元
    let pivot = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    }
    if (Math.abs(M[pivot][c]) < 1e-12) throw new Error('矩阵奇异：边不足以确定全部 Elo');
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** 加权最小二乘：min Σ n·(x_a − x_b − ΔR_ab)²，锚定 ANCHOR = ANCHOR_ELO。 */
function fitWls(names: string[]): Map<string, number> {
  const freeNames = names.filter((x) => x !== ANCHOR);
  const freeIdx = new Map(freeNames.map((x, i) => [x, i]));
  const N = freeNames.length;
  const AtA = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  const Atb = new Array<number>(N).fill(0);
  for (const { a, b, pHat, n } of MATCHES) {
    const d = deltaFromWinRate(pHat);
    // 方程：R_a − R_b = d。锚点策略的 R 固定为 ANCHOR_ELO，折入右侧：
    // x_a − x_b = d − ANCHOR_ELO·(anchor_a − anchor_b)，解出的 x 即绝对 Elo。
    const i = a === ANCHOR ? -1 : freeIdx.get(a)!;
    const j = b === ANCHOR ? -1 : freeIdx.get(b)!;
    const rhs = d - (a === ANCHOR ? ANCHOR_ELO : 0) + (b === ANCHOR ? ANCHOR_ELO : 0);
    const coeff = (k: number): number => (i === k ? 1 : 0) - (j === k ? 1 : 0);
    for (let k = 0; k < N; k++) {
      for (let l = 0; l < N; l++) AtA[k][l] += n * coeff(k) * coeff(l);
      Atb[k] += n * coeff(k) * rhs;
    }
  }
  const x = solveLinear(AtA, Atb);
  const out = new Map<string, number>([[ANCHOR, ANCHOR_ELO]]);
  freeNames.forEach((name, i) => out.set(name, x[i]));
  return out;
}

function main(): void {
  const names = [...new Set(MATCHES.flatMap(({ a, b }) => [a, b]))];
  const ratings = fitWls(names);

  console.log('=== 1. 单场对决的 Elo 差（ΔR = 400·log10(p̂/(1−p̂))） ===');
  for (const { a, b, pHat, n } of MATCHES) {
    const d = deltaFromWinRate(pHat);
    console.log(`  ${a} vs ${b}: p̂=${pHat} n=${n}  ΔR=${d.toFixed(2)}`);
  }

  console.log(`\n=== 2. 加权最小二乘解（锚定 ${ANCHOR} = ${ANCHOR_ELO}，权重 = n） ===`);
  console.log('\n  策略     给定值    重算值   偏差');
  let maxDiff = 0;
  for (const name of names) {
    const got = ratings.get(name)!;
    const given = GIVEN[name] ?? got; // 未给定（求解模式）→ 显示重算值本身
    const diff = Math.abs(given - got);
    maxDiff = Math.max(maxDiff, diff);
    console.log(`  ${name.padEnd(8)} ${given.toFixed(1).padStart(7)} ${got.toFixed(1).padStart(7)}  ${diff.toFixed(2).padStart(6)}`);
  }
  const ok = maxDiff <= 0.051;
  console.log(`\n  最大偏差 = ${maxDiff.toFixed(2)}（容差 0.051，1 位小数舍入）`);

  console.log('\n=== 3. 拟合残差：重算 Elo 预测的胜率 vs 报告实测 ===');
  for (const { a, b, pHat } of MATCHES) {
    const ra = ratings.get(a)!;
    const rb = ratings.get(b)!;
    const pred = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const resid = 400 * log10(pHat / (1 - pHat)) - (ra - rb);
    console.log(`  ${a} vs ${b}: 实测 p̂=${pHat.toFixed(4)}  预测=${pred.toFixed(4)}  残差 ΔR=${resid.toFixed(2)}`);
  }

  console.log(`\n结论: ${ok ? '✓ 拟合完成（残差自洽）' : '✗ 拟合偏差超出容差'}`);
  process.exit(ok ? 0 : 1);
}

main();
