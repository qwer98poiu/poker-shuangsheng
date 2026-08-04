/**
 * 验证竞技场报告中的策略 Elo 分是否准确。
 *
 * 运行：npx tsx packages/arena/scripts/elo-verify.ts
 *
 * 方法（与报告口径一致）：
 * 1. 每场对决的 Elo 差 ΔR = 400·log10(p̂/(1−p̂))，p̂ 为含平局（按 0.5 计）的胜率。
 * 2. 图中有环（如 ai-0726 既可直测也可经 ai-0801 传递），各边的 ΔR 互相矛盾，
 *    因此对 ΔR 做以对局数 n 为权重的加权最小二乘（WLS），固定 ai = 1000 解出全体 Elo。
 * 3. 与给定值逐策略对比（1 位小数），任一偏差超过 0.051 则判定不一致。
 *
 * 已知近似：visibleTrickPoints 相关近似不涉及本脚本；p̂ 的统计误差（n 不同）由
 * 权重 n 自动体现。
 */

const MATCHES: ReadonlyArray<readonly [string, string, number, number]> = [
  // A           B           p̂(A)      n(对局数)
  ['ai-0801', 'ai-0726', 0.506, 48000],
  ['ai', 'ai-0801', 0.5114, 13000],
  ['ai', 'ai-0726', 0.5172, 10000],
  ['ai', 'ai-0719', 0.6363, 10000],
  ['ai', 'ai-0712', 0.9581, 10000],
  ['ai-0726', 'ai-0719', 0.631, 6300],
  ['ai-0719', 'ai-0712', 0.9201, 10000],
  ['ai-0712', 'ai-0707', 0.9967, 10000],
];

/** 用户给定值（ai 为基准 1000，其余为报告中的 Elo 分）。 */
const GIVEN: Record<string, number> = {
  ai: 1000,
  'ai-0801': 992.2,
  'ai-0726': 988.1,
  'ai-0719': 895.3,
  'ai-0712': 463.6,
  'ai-0707': -528.5,
};

const ANCHOR = 'ai';

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

/** 加权最小二乘：min Σ n·(x_a − x_b − ΔR_ab)²，锚定 ANCHOR = 1000。 */
function fitWls(names: string[]): Map<string, number> {
  const freeNames = names.filter((x) => x !== ANCHOR);
  const freeIdx = new Map(freeNames.map((x, i) => [x, i]));
  const N = freeNames.length;
  const AtA = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  const Atb = new Array<number>(N).fill(0);
  for (const [a, b, p, n] of MATCHES) {
    const d = deltaFromWinRate(p);
    // 方程：R_a − R_b = d。锚点 ai 的 R 固定为 1000，折入右侧：
    // x_a − x_b = d − 1000·(anchor_a − anchor_b)，解出的 x 即绝对 Elo。
    const i = a === ANCHOR ? -1 : freeIdx.get(a)!;
    const j = b === ANCHOR ? -1 : freeIdx.get(b)!;
    const rhs = d - (a === ANCHOR ? 1000 : 0) + (b === ANCHOR ? 1000 : 0);
    const coeff = (k: number): number => (i === k ? 1 : 0) - (j === k ? 1 : 0);
    for (let k = 0; k < N; k++) {
      for (let l = 0; l < N; l++) AtA[k][l] += n * coeff(k) * coeff(l);
      Atb[k] += n * coeff(k) * rhs;
    }
  }
  const x = solveLinear(AtA, Atb);
  const out = new Map<string, number>([[ANCHOR, 1000]]);
  freeNames.forEach((name, i) => out.set(name, x[i]));
  return out;
}

function main(): void {
  const names = [...new Set(MATCHES.flatMap(([a, b]) => [a, b]))];
  const ratings = fitWls(names);

  console.log('=== 1. 单场对决的 Elo 差（ΔR = 400·log10(p̂/(1−p̂))） ===');
  for (const [a, b, p, n] of MATCHES) {
    const d = deltaFromWinRate(p);
    console.log(`  ${a} vs ${b}: p̂=${p} n=${n}  ΔR=${d.toFixed(2)}`);
  }

  console.log('\n=== 2. 加权最小二乘解（锚定 ai = 1000，权重 = n） ===');
  console.log('\n  策略     给定值    重算值   偏差');
  let maxDiff = 0;
  for (const name of names) {
    const given = GIVEN[name];
    const got = ratings.get(name)!;
    const diff = Math.abs(given - got);
    maxDiff = Math.max(maxDiff, diff);
    console.log(`  ${name.padEnd(8)} ${given.toFixed(1).padStart(7)} ${got.toFixed(1).padStart(7)}  ${diff.toFixed(2).padStart(6)}`);
  }
  const ok = maxDiff <= 0.051;
  console.log(`\n  最大偏差 = ${maxDiff.toFixed(2)}（容差 0.051，1 位小数舍入）`);

  console.log('\n=== 3. 拟合残差：重算 Elo 预测的胜率 vs 报告实测 ===');
  for (const [a, b, p, n] of MATCHES) {
    const ra = ratings.get(a)!;
    const rb = ratings.get(b)!;
    const pred = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const resid = 400 * log10(p / (1 - p)) - (ra - rb);
    console.log(`  ${a} vs ${b}: 实测 p̂=${p.toFixed(4)}  预测=${pred.toFixed(4)}  残差 ΔR=${resid.toFixed(2)}`);
  }

  console.log(`\n结论: ${ok ? '✓ 给定 Elo 分与加权最小二乘解一致（1 位小数舍入误差内）' : '✗ 不一致（偏差超出舍入容差）'}`);
  process.exit(ok ? 0 : 1);
}

main();
