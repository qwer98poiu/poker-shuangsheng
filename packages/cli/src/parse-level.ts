import { Suit } from '@poker/engine';

/** Parse level + suit from CLI input like "2C", "KNT", "5". */
export function parseLevelSuit(input: string): { level: number; suit: Suit | null | undefined; hasSuit: boolean } {
  const trimmed = input.trim().toUpperCase();
  let level = 2;
  let suit: Suit | null | undefined;
  let hasSuit = false;

  if (trimmed) {
    const levelMatch = trimmed.match(/(\d+|[JQKA]+)/i);
    if (levelMatch) {
      const lv = levelMatch[0].toUpperCase();
      if (lv === 'J') level = 11;
      else if (lv === 'Q') level = 12;
      else if (lv === 'K') level = 13;
      else if (lv === 'A') level = 14;
      else level = parseInt(lv);
      if (level > 14) level = 2;
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
  }
  return { level, suit, hasSuit };
}
