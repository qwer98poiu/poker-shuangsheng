import { sortHand } from '@poker/engine';
import type { Card, TrumpDeclaration } from '@poker/engine';

export function parseCards(
  input: string, hand: Card[], trump: TrumpDeclaration | null,
): { cards: Card[]; error?: string } {
  const parts = input.trim().split(/\s+/);
  if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) return { cards: [] };

  const indices: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (isNaN(n)) return { cards: [], error: `无效编号: ${p}` };
    indices.push(n);
  }

  const sorted = sortHand(hand, trump);
  for (const idx of indices) {
    if (idx < 0 || idx >= sorted.length) {
      return { cards: [], error: `编号 ${idx} 超出范围 (0-${sorted.length - 1})` };
    }
  }

  // 同一张牌只能选一次：重复编号会让扣底/出牌数量失真——如扣底选 8 张实际只移走
  // 7 张，庄家手牌多 1 张，总牌数不再守恒，后续出牌必然出错。
  const dupes = [...new Set(indices.filter((v, i) => indices.indexOf(v) !== i))];
  if (dupes.length > 0) {
    return { cards: [], error: `重复编号: ${dupes.join(' ')}（同一张牌只能选一次）` };
  }

  return { cards: indices.map(i => sorted[i]) };
}

/** 解析人类玩家数量输入 (0-4，默认 1)。非法/超范围输入钳制后附警告，空输入静默取默认。 */
export function parseHumanCount(input: string): { count: number; warning: string | null } {
  const trimmed = input.trim();
  if (trimmed === '') return { count: 1, warning: null };
  const parsed = parseInt(trimmed);
  if (isNaN(parsed)) return { count: 1, warning: '无效输入，默认 1' };
  if (parsed < 0 || parsed > 4) {
    const count = Math.max(0, Math.min(4, parsed));
    return { count, warning: `输入超出范围 (0-4)，已按 ${count} 处理` };
  }
  return { count: parsed, warning: null };
}
