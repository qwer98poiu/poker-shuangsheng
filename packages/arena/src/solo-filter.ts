/**
 * 单副牌 A/B 竞技场的两个「入口侧」纯工具：
 *
 * 1. 等级列表解析 —— `--level 2,5,10,Q,K,A` / `--level all`。
 * 2. 发牌过滤器注册表 —— `--deal-filter` 的**接口/管道**。本次不注册任何具体
 *    过滤器（注册表为空），只把「名字 → 谓词」的解析、校验与求值就位；以后要加
 *    一个过滤器，就是在 `DEAL_FILTERS` 里加一行（谓词是仓库内代码，不从外部文件加载）。
 */
import type { Card } from '@poker/engine';

/** 2..A 的全部 13 个等级。 */
export const ALL_LEVELS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** `--level` 的默认值：2、5、10、Q、K、A。 */
export const DEFAULT_LEVELS: readonly number[] = [2, 5, 10, 12, 13, 14];

/** J/Q/K/A 与牌点同序（11..14），大小写不敏感。 */
const LEVEL_LETTERS: Record<string, number> = { J: 11, Q: 12, K: 13, A: 14 };

/**
 * 解析 `--level`：`all` = 2..A；否则逗号分隔（数字 2..14 或 J/Q/K/A）。
 * 去重、升序；非法项报错并指出该项。
 */
export function parseLevels(spec: string): number[] {
  const trimmed = spec.trim();
  if (trimmed === '') throw new Error('--level 不能为空（可用 2,5,10,Q,K,A 或 all）');
  if (trimmed.toLowerCase() === 'all') return [...ALL_LEVELS];

  const out = new Set<number>();
  for (const raw of trimmed.split(',')) {
    const token = raw.trim();
    if (token === '') throw new Error(`--level 含空项: 「${spec}」`);
    const letter = LEVEL_LETTERS[token.toUpperCase()];
    if (letter !== undefined) {
      out.add(letter);
      continue;
    }
    if (!/^\d+$/.test(token)) {
      throw new Error(`--level 非法等级: ${token}（可用 2..14、J/Q/K/A，或 all）`);
    }
    const lv = Number(token);
    if (lv < 2 || lv > 14) throw new Error(`--level 等级超出 2..14: ${token}`);
    out.add(lv);
  }
  return [...out].sort((a, b) => a - b);
}

/** 过滤器求值所需的上下文：这一副牌的发出手牌、整副牌、以及正在跑的等级。 */
export interface DealFilterContext {
  /** `dealtHands(deck)`：第 i 张归座位 i % 4。 */
  hands: readonly Card[][];
  /** 整副牌；庄家 P0 的 33 张池 = hands[0] + deck.slice(100, 108)。 */
  deck: readonly Card[];
  /** 当前等级（牌点是主牌的那个等级）——过滤器可以依赖它。 */
  level: number;
}

/** 一个发牌过滤器：为真表示「这一副（在这个等级下）保留」。 */
export type DealFilter = (ctx: DealFilterContext) => boolean;

/**
 * 过滤器注册表 —— `--deal-filter NAME` 的取名字处，也是唯一的扩展点。
 *
 * 目前**故意为空**：本次只落接口/管道。加一个过滤器即在此加一行，例如
 * 长花色（与 `--nt-only` 共用即「NT 长花色」）可用
 * `computeOffSuitControls(hands[0], decl).some(longShape)` 之类现成的谓词。
 * 谓词必须是仓库内代码，`--deal-filter` 不支持外部文件。
 */
export const DEAL_FILTERS: Map<string, DealFilter> = new Map();

/** 当前可用的过滤器名（升序），供帮助文本与报错列举。 */
export function availableFilterNames(): string[] {
  return [...DEAL_FILTERS.keys()].sort();
}

/**
 * 校验 `--deal-filter` 的名字列表；未注册的名字抛错并列出当前可用名字。
 * 返回规范化后的名字列表（原样、保持顺序）。
 */
export function resolveDealFilters(names: readonly string[]): string[] {
  for (const name of names) {
    if (!DEAL_FILTERS.has(name)) {
      const avail = availableFilterNames();
      throw new Error(avail.length > 0
        ? `未知的发牌过滤器: ${name}（可选: ${avail.join(', ')}）`
        : `未知的发牌过滤器: ${name}（目前无可用过滤器——--deal-filter 是预留接口）`);
    }
  }
  return [...names];
}

/** 全部过滤器都通过才保留（AND）；空列表恒为真。 */
export function passesDealFilters(names: readonly string[], ctx: DealFilterContext): boolean {
  for (const name of names) {
    if (!DEAL_FILTERS.get(name)!(ctx)) return false;
  }
  return true;
}
