import { Suit } from '@poker/engine';

/** Parse level + suit from CLI input like "2C", "KNT", "5". Invalid input clamps to defaults and attaches a warning. */
export function parseLevelSuit(input: string): {
  level: number; suit: Suit | null | undefined; hasSuit: boolean; warning: string | null;
} {
  const trimmed = input.trim().toUpperCase();
  let level = 2;
  let suit: Suit | null | undefined;
  let hasSuit = false;
  let warning: string | null = null;

  if (trimmed) {
    const levelMatch = trimmed.match(/(\d+|[JQKA]+)/i);
    if (levelMatch) {
      const lv = levelMatch[0].toUpperCase();
      if (lv === 'J') level = 11;
      else if (lv === 'Q') level = 12;
      else if (lv === 'K') level = 13;
      else if (lv === 'A') level = 14;
      else level = parseInt(lv);
      if (level < 2 || level > 14) {
        warning = `等级超出范围 (2-14)，已按 2 处理`;
        level = 2;
      }
    }
    const suitMatch = trimmed.match(/[SHDC]|NT/i);
    if (suitMatch) {
      const s = suitMatch[0].toUpperCase();
      if (s === 'NT') suit = null;
      else if (s === 'S') suit = Suit.Spades;
      else if (s === 'H') suit = Suit.Hearts;
      else if (s === 'C') suit = Suit.Clubs;
      else if (s === 'D') suit = Suit.Diamonds;
      hasSuit = true;
    }
    // 等级和花色都没有匹配到（如 "xyz"），"NT" 单独出现是合法的（默认 2 级）
    if (!levelMatch && !suitMatch) {
      warning = `无法识别等级花色 (如 2C、KNT)，已按默认 2 级`;
    }
  }
  return { level, suit, hasSuit, warning };
}
