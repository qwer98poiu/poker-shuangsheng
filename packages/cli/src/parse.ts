import { sortHand, suitLabel, rankLabel, Suit, getRevealOptions, canOverride, suitName } from '@poker/engine';
import type { Card, TrumpDeclaration, Reveal } from '@poker/engine';

const SUIT_KEY: Record<Suit, string> = {
  [Suit.Spades]: 'S', [Suit.Hearts]: 'H', [Suit.Clubs]: 'C', [Suit.Diamonds]: 'D',
};

/**
 * 亮主状态显示：对子亮主显示两张（♥5♥5），单张显示一张（♥5），王对显示
 * JOKER JOKER / joker joker。避免"当前主: ♥5"这种单张外观让人误以为是单张
 * 亮主（单张与对子的反主规则不同）。
 */
export function revealLabel(rev: { suit: Suit | null; strength: number }, level: number): string {
  if (rev.suit) {
    const label = suitLabel(rev.suit) + rankLabel(level);
    return rev.strength >= 2 ? label + label : label;
  }
  if (rev.strength === 4) return 'JOKER JOKER';
  if (rev.strength === 3) return 'joker joker';
  return '无主';
}

/** 玩家可成功亮/反的选项：按手牌生成所有亮主选项，按反主规则过滤，并按花色去重
 *  （对大王与对小王同花色 null——保留先出现的强者，与 tryReveal 的 find 行为一致）。 */
export function usableRevealOptions(
  hand: Card[],
  level: number,
  current: { suit: Suit | null; strength: number } | null,
): { suit: Suit | null; strength: number }[] {
  const seen = new Set<Suit | null>();
  return getRevealOptions(hand, level)
    .filter(o => canOverride(current as Reveal | null, { playerIndex: 0, suit: o.suit, strength: o.strength }))
    .filter(o => {
      if (seen.has(o.suit)) return false;
      seen.add(o.suit);
      return true;
    })
    .map(o => ({ suit: o.suit, strength: o.strength }));
}

/** 亮主提示文案：只列可用选项，缩写=花色（如 C=草花主），N 标注用的哪对王
 *  （N=大王无主 / N=小王无主）。 */
export function revealHint(opts: { suit: Suit | null; strength: number }[]): string {
  return opts.map(o => {
    if (o.suit === null) {
      return o.strength === 4 ? 'N=大王无主' : 'N=小王无主';
    }
    return `${SUIT_KEY[o.suit]}=${suitName(o.suit)}主`;
  }).join(', ');
}

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

/** 解析 y/n 回答（y/yes → true，n/no → false，不区分大小写）。空输入静默取默认，非法输入取默认并警告。 */
export function parseYesNo(input: string, defaultValue: boolean): { value: boolean; warning: string | null } {
  const t = input.trim().toLowerCase();
  if (t === '') return { value: defaultValue, warning: null };
  if (t === 'y' || t === 'yes') return { value: true, warning: null };
  if (t === 'n' || t === 'no') return { value: false, warning: null };
  return { value: defaultValue, warning: `无效输入 (y/n)，按默认 ${defaultValue ? 'y' : 'n'} 处理` };
}

/** 解析存档编号（1 基）。空输入静默跳过，非法/超范围返回 null 并警告。 */
export function parseSaveChoice(input: string, count: number): { index: number | null; warning: string | null } {
  if (input.trim() === '') return { index: null, warning: null };
  const idx = parseInt(input) - 1;
  if (isNaN(idx) || idx < 0 || idx >= count) {
    return { index: null, warning: `无效编号 (1-${count})，未加载存档` };
  }
  return { index: idx, warning: null };
}

/** 解析续玩墩号 (0-max)。空输入返回 null（从当前继续），非法/越界返回 null 并警告。 */
export function parseTrickNumber(input: string, max: number): { trick: number | null; warning: string | null } {
  if (input.trim() === '') return { trick: null, warning: null };
  const n = parseInt(input);
  if (isNaN(n) || n < 0 || n > max) {
    return { trick: null, warning: `墩号无效 (0-${max})，从当前墩继续` };
  }
  return { trick: n, warning: null };
}
