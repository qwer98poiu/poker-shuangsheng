/**
 * 报告表格渲染：A/B 双列对齐 + 优劣染色。
 *
 * 对齐按**终端显示宽度**算（CJK/全角字符占 2 列），染色码为零宽，故先按原文
 * 宽度算好填充再套色。颜色由调用方按是否 TTY 决定（重定向到文件时不输出 ANSI 码）。
 */
import type { CountPair } from './stats.js';

/** 指标方向：high = 越大越好，low = 越小越好，neutral = 中性（不判定优劣）。 */
export type Direction = 'high' | 'low' | 'neutral';

/** 单元格优劣：a/b = 该侧更优，tie = 相等（两侧都算优），none = 不判定。 */
export type Verdict = 'a' | 'b' | 'tie' | 'none';

export interface TableRow {
  label: string;
  a: string;
  b: string;
  verdict: Verdict;
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
 * 渲染三列表格（指标 | A | B），三列均按显示宽度左对齐。
 * 最优的一侧套绿；verdict 为 tie 时两侧都套绿。最后一列不留尾随空格。
 */
export function renderTable(
  header: readonly [string, string, string],
  rows: readonly TableRow[],
  color: boolean,
): string[] {
  const w0 = Math.max(displayWidth(header[0]), ...rows.map(r => displayWidth(r.label)));
  const w1 = Math.max(displayWidth(header[1]), ...rows.map(r => displayWidth(r.a)));
  const lines = [cell(header[0], w0, false, false) + '  ' + cell(header[1], w1, false, false) + '  ' + header[2]];
  for (const r of rows) {
    const greenA = r.verdict === 'a' || r.verdict === 'tie';
    const greenB = r.verdict === 'b' || r.verdict === 'tie';
    lines.push(
      cell(r.label, w0, false, false) + '  ' +
      cell(r.a, w1, greenA, color) + '  ' +
      cell(r.b, 0, greenB, color),
    );
  }
  return lines;
}
