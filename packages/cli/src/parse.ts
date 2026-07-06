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

  return { cards: indices.map(i => sorted[i]) };
}
