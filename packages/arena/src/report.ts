/**
 * 报告表格渲染：A/B 双列对齐 + 优劣染色。
 *
 * 对齐按**终端显示宽度**算（CJK/全角字符占 2 列），染色码为零宽，故先按原文
 * 宽度算好填充再套色。颜色由调用方按是否 TTY 决定（重定向到文件时不输出 ANSI 码）。
 */
import type { CountPair } from './stats.js';
import { levelLabel } from './level-label.js';

/** 指标方向：high = 越大越好，low = 越小越好，neutral = 中性（不判定优劣）。 */
export type Direction = 'high' | 'low' | 'neutral';

/** 单元格优劣：a/b = 该侧更优，tie = 相等（两侧都算优），none = 不判定。 */
export type Verdict = 'a' | 'b' | 'tie' | 'none';

export interface TableRow {
  label: string;
  a: string;
  b: string;
  verdict: Verdict;
  /**
   * 第 4 格（平局率）文本，只在表头有 4 列时渲染；缺省渲染成 —。
   * **只有判据本身三分**（A 胜 / B 胜 / 平）的行才有值——二分判据（如 80 口径的台上/台下、
   * 每墩胜率）「平」这一态根本不存在，写成 0.0000 会让人当成「测过、恰好为零」。
   */
  draw?: string;
}

const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

/**
 * 比较两个比值（n/d），返回更优的一侧。
 * 方向为中性、或任一侧无样本（d=0）时不判定。
 */
export function betterSide(a: CountPair, b: CountPair, dir: Direction): Verdict {
  if (dir === 'neutral' || a.d === 0 || b.d === 0) return 'none';
  const va = a.n / a.d;
  const vb = b.n / b.d;
  if (va === vb) return 'tie';
  return (dir === 'high' ? va > vb : va < vb) ? 'a' : 'b';
}

/** 比值文本：`0.5234 (n/d)`；无样本（d=0）输出 —。 */
export function ratioText(p: CountPair): string {
  if (p.d === 0) return '—';
  return `${(p.n / p.d).toFixed(4)} (${p.n}/${p.d})`;
}

/**
 * 三分（A 胜 / B 胜 / 平）→ 三格：共享同一分母（a + b + 平），相加恒为 1。
 *
 * 表里的「平局率」是独立一格，不再把平局按 0.5 摊给两侧——注意**表头的 p̂ 与显著性
 * 仍走 0.5×平 的旧约定**，所以表头那个数与表内「胜率（发牌口径）」行的 A 格不相等。
 * 好处是全平时 A/B 是 `0/N`（渲染成 0.0000）而不是 `0/0`（—）。
 */
export function trioShares(b: { a: number; b: number; draw: number }): {
  a: CountPair;
  b: CountPair;
  draw: CountPair;
} {
  const d = b.a + b.b + b.draw;
  return { a: { n: b.a, d }, b: { n: b.b, d }, draw: { n: b.draw, d } };
}

/** 一条待比较的指标：标签 + 双方比值 + 方向（+ 可选的平局率第 4 格）。 */
export type MetricSpec = [
  label: string, a: CountPair, b: CountPair, dir: Direction, draw?: CountPair,
];

/** 2..A 的全部 13 个等级（`perLevelSpecs` 的默认展开范围）。 */
export const LEVELS_2_TO_ACE: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/**
 * 各等级的胜负率展开成指标（默认 2..A）。
 * `draw` 给了就一并产出第 4 格（平局率）；缺样本的等级三格都是 —。
 * deal 竞技场默认只打 6 档，故 `levels` 可显式收窄。
 */
export function perLevelSpecs(
  prefix: string,
  a: Map<number, CountPair>,
  b: Map<number, CountPair>,
  draw?: Map<number, CountPair>,
  levels: readonly number[] = LEVELS_2_TO_ACE,
): MetricSpec[] {
  const out: MetricSpec[] = [];
  for (const lv of levels) {
    out.push([
      `${prefix} ${levelLabel(lv)} 胜率`,
      a.get(lv) ?? { n: 0, d: 0 },
      b.get(lv) ?? { n: 0, d: 0 },
      'high',
      draw === undefined ? undefined : (draw.get(lv) ?? { n: 0, d: 0 }),
    ]);
  }
  return out;
}

/** 指标规格 → 表格行（算好文本与优劣；两个竞技场的报告共用）。 */
export function rowsFrom(specs: readonly MetricSpec[]): TableRow[] {
  return specs.map(([label, a, b, dir, draw]) => ({
    label,
    a: ratioText(a),
    b: ratioText(b),
    verdict: betterSide(a, b, dir),
    draw: draw === undefined ? undefined : ratioText(draw),
  }));
}

/** 终端显示宽度：CJK/全角字符占 2 列，其余 1 列。 */
export function displayWidth(s: string): number {
  let width = 0;
  for (const ch of s) width += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
  return width;
}

function isWide(cp: number): boolean {
  if (cp < 0x1100) return false;
  return (
    cp <= 0x115f ||                       // 谚文字母
    cp === 0x2329 || cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) ||     // CJK 部首/符号
    (cp >= 0x3041 && cp <= 0x33ff) ||     // 假名/注音/CJK 兼容
    (cp >= 0x3400 && cp <= 0x4dbf) ||     // CJK 扩展 A
    (cp >= 0x4e00 && cp <= 0x9fff) ||     // CJK 基本区
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||     // 谚文音节
    (cp >= 0xf900 && cp <= 0xfaff) ||     // CJK 兼容表意
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||     // 全角 ASCII（含（））
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)      // CJK 扩展 B 及以后
  );
}

/** 右填充到指定显示宽度；染色码不计入宽度（对原文算填充，再套色）。 */
function cell(text: string, width: number, green: boolean, color: boolean): string {
  const body = green && color ? `${GREEN}${text}${RESET}` : text;
  return body + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

/**
 * 渲染表格（指标 | A | B，表头给 4 列时末列是平局率），列数由 header 长度决定（3 或 4）。
 * 各列按显示宽度左对齐，最后一列不留尾随空格。最优的一侧套绿（verdict 为 tie 时两侧都套绿）；
 * 指标列与平局列不参与优劣判定，不染色。
 */
export function renderTable(
  header: readonly string[],
  rows: readonly TableRow[],
  color: boolean,
): string[] {
  const cols = header.length === 4 ? 4 : 3;
  const cellsOf = (r: TableRow): string[] =>
    cols === 4 ? [r.label, r.a, r.b, r.draw ?? '—'] : [r.label, r.a, r.b];
  const body = rows.map(cellsOf);
  // 最后一列不补白，故宽度只需算到倒数第二列
  const widthAt = (i: number): number =>
    Math.max(displayWidth(header[i]), ...body.map(c => displayWidth(c[i])));
  const line = (cells: readonly string[], greens: readonly boolean[]): string =>
    cells
      .map((text, i) => cell(text, i === cells.length - 1 ? 0 : widthAt(i), greens[i], color))
      .join('  ');

  const lines = [line(header.slice(0, cols), header.slice(0, cols).map(() => false))];
  for (const r of rows) {
    const greenA = r.verdict === 'a' || r.verdict === 'tie';
    const greenB = r.verdict === 'b' || r.verdict === 'tie';
    lines.push(line(cellsOf(r), [false, greenA, greenB, false]));
  }
  return lines;
}

// ---- n 列宽表（deal 竞技场的北极星/分解指标） ----

/** 单元格染色：'A' = A 侧（绿）、'B' = B 侧（红）、null = 不染色。 */
export type CellTint = 'A' | 'B' | null;
const RED = '\x1b[31m';
const TINT_CODES: Record<'A' | 'B', string> = { A: GREEN, B: RED };

/**
 * 宽表渲染（`renderTable` 固定三/四列，这里列数由表头决定）。
 * 对齐按终端显示宽度（CJK 占 2 列），染色码零宽——先按原文宽度填充再套色。
 */
export function renderColumns(
  header: readonly string[],
  rows: readonly string[][],
  tints: readonly (readonly CellTint[])[],
  color: boolean,
): string[] {
  const widths = header.map((h, i) => Math.max(displayWidth(h), ...rows.map(r => displayWidth(r[i] ?? ''))));
  const cellOf = (text: string, w: number, tint: CellTint): string => {
    const body = tint !== null && color ? `${TINT_CODES[tint]}${text}${RESET}` : text;
    return body + ' '.repeat(Math.max(0, w - displayWidth(text)));
  };
  const lines = [header.map((h, i) => cellOf(h, widths[i], null)).join('  ').trimEnd()];
  rows.forEach((r, ri) => {
    lines.push(r.map((c, i) => cellOf(c, widths[i], tints[ri]?.[i] ?? null)).join('  ').trimEnd());
  });
  return lines;
}
