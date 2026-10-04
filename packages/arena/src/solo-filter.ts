/**
 * 单副牌 A/B 竞技场的两个「入口侧」纯工具：
 *
 * 1. 等级列表解析 —— `--level 2,5,10,Q,K,A` / `--level all`。
 * 2. 发牌过滤器注册表 —— `--deal-filter` 的「名字 → 谓词」解析、校验与求值。
 *    具体谓词放在 `solo-deal-filters.ts`，在这里显式登记（注册即确定，不靠 import
 *    副作用；谓词文件只 type-only 反引本文件的类型，运行时无环）。
 */
import type { Card, TrumpDeclaration } from '@poker/engine';
import { longSuitDealFilter } from './solo-deal-filters.js';

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

/** 过滤器求值所需的上下文：这一副牌的发出手牌、整副牌、正在跑的等级、以及自然亮主。 */
export interface DealFilterContext {
  /** `dealtHands(deck)`：第 i 张归座位 i % 4。 */
  hands: readonly Card[][];
  /** 整副牌；庄家 P0 的 33 张池 = hands[0] + deck.slice(100, 108)。 */
  deck: readonly Card[];
  /** 当前等级（牌点是主牌的那个等级）——过滤器可以依赖它。 */
  level: number;
  /**
   * 该副（该等级）的自然亮主 —— 判「哪几门是副牌」要用它。由竞技场按基准腿
   * [B, B] 的亮主重放得到（见 `naturalDeclaration`）；`--nt-only` 下恒为
   * `trumpSuit: null`（对王亮无主压过一切有主亮主）。
   */
  decl: TrumpDeclaration;
}

/** 一个发牌过滤器：为真表示「这一副（在这个等级下）保留」。 */
export type DealFilter = (ctx: DealFilterContext) => boolean;

/**
 * 过滤器注册表 —— `--deal-filter NAME` 的取名字处，也是唯一的扩展点。
 *
 * 加一个过滤器：在 `solo-deal-filters.ts` 写谓词，在此加一行登记。谓词必须是仓库
 * 内代码，`--deal-filter` 不支持外部文件。当前已登记：
 * - `long-suit`：任一座位在该副自然主牌下有长花色（庄家 P0 按 33 张池＝发到 25＋底牌 8，
 *   其余三家各 25 张；与 `--nt-only` 共用即「NT 长花色」）。
 */
export const DEAL_FILTERS: Map<string, DealFilter> = new Map([
  ['long-suit', longSuitDealFilter],
]);

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
        : `未知的发牌过滤器: ${name}（当前无可用过滤器）`);
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
