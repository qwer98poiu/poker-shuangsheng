import type { Card, CardSuit, ComboClass } from '../types.js';
import { Rank, SpecialSuit, Suit, SUIT_ORDER, isPointRank as isPointCard } from '../types.js';
import type { TrumpDeclaration } from '../types.js';
import { isTrump, getEffectiveRank, sortHand } from '../model.js';
import { findAllPairs, detectTractors, classify as classifyCombo } from '../pattern/index.js';

export interface AIResult<T> {
  decision: T;
  reason: string;
}

/** try to reveal trump during dealing */
export function aiTryReveal(
  hand: Card[],
  _dealtCards: Card[],
  _playerIndex: number,
  level: number,
  currentReveal: { suit: Suit | null; strength: number } | null,
): { suit: Suit | null; reason: string } | null {
  // only consider newly dealt cards + existing hand for reveal
  const allCards = hand;

  // check for pair of same jokers (NT) — two BigJokers or two SmallJokers
  const bigJokers = allCards.filter(c => c.rank === Rank.BigJoker);
  const smallJokers = allCards.filter(c => c.rank === Rank.SmallJoker);
  if (bigJokers.length >= 2 || smallJokers.length >= 2) {
    if (!currentReveal || currentReveal.strength < 3) {
      return { suit: null, reason: '有对王，亮无主' };
    }
  }

  // check for pair of level cards per suit
  for (const suit of SUIT_ORDER) {
    const levelCards = allCards.filter(c => c.suit === suit && c.rank === level);
    if (levelCards.length >= 2) {
      if (!currentReveal || currentReveal.strength < 2) {
        return { suit, reason: `有${suitLabelCn(suit)}级牌对，亮主` };
      }
    }
  }

  // single level card
  for (const suit of SUIT_ORDER) {
    const levelCards = allCards.filter(c => c.suit === suit && c.rank === level);
    if (levelCards.length >= 1) {
      if (!currentReveal) {
        return { suit, reason: `有${suitLabelCn(suit)}级牌单张，亮主` };
      }
    }
  }

  return null;
}

/** pick 8 cards to discard to bottom */
export function aiChooseBottomCards(
  hand: Card[],
  config: TrumpDeclaration,
): { keep: Card[]; discard: Card[]; reason: string } {
  const scored = hand.map(card => ({
    card,
    score: cardKeepScore(card, config),
  }));
  scored.sort((a, b) => a.score - b.score);
  const discard = scored.slice(0, 8).map(s => s.card);
  const keep = scored.slice(8).map(s => s.card);

  const reason = `保留高分牌(主牌${keep.filter(c => isTrump(c, config)).length}张)，弃短套低分牌`;
  return { keep, discard, reason };
}

function cardKeepScore(card: Card, config: TrumpDeclaration): number {
  let score = 0;
  if (isTrump(card, config)) score += 50 + getEffectiveRank(card, config);
  if (card.rank === Rank.Ace) score += 35;
  if (card.rank === Rank.King) score += 28;
  if (card.rank === Rank.Ten) score += 22;
  if (card.rank === Rank.Five) score += 18;
  if (card.rank >= Rank.Queen) score += 10;
  return score;
}

/** add final-hand suffix to reason if applicable */
function maybeAppendFinal(selected: Card[], fullHand: Card[], baseReason: string): string {
  if (selected.length === fullHand.length && fullHand.length === 1) return '最后一张手牌，必出';
  if (selected.length === fullHand.length) return `最后${fullHand.length}张手牌，必出`;
  return baseReason;
}

/** decide what to lead */
export function aiLeadPlay(
  hand: Card[],
  config: TrumpDeclaration,
): { cards: Card[]; reason: string } {
  const tractors = detectTractors(hand, config);
  if (tractors.length > 0) {
    const cards = tractors[0];
    return { cards, reason: maybeAppendFinal(cards, hand, `领出拖拉机(${tractors[0].length / 2}对)`) };
  }

  const pairs = findAllPairs(hand);
  if (pairs.length > 0) {
    pairs.sort((a, b) => getEffectiveRank(b[0], config) - getEffectiveRank(a[0], config));
    const cards = pairs[0];
    return { cards, reason: maybeAppendFinal(cards, hand, '领出对子，试探牌力') };
  }

  const trumpCards = hand.filter(c => isTrump(c, config));
  const nonTrump = hand.filter(c => !isTrump(c, config));

  if (trumpCards.length > 6) {
    trumpCards.sort((a, b) => getEffectiveRank(b, config) - getEffectiveRank(a, config));
    const cards = [trumpCards[0]];
    return { cards, reason: maybeAppendFinal(cards, hand, `主牌多(${trumpCards.length}张)，出主牌清主`) };
  }

  const aces = nonTrump.filter(c => c.rank === Rank.Ace && !isTrump(c, config));
  if (aces.length > 0) {
    const cards = [aces[0]];
    return { cards, reason: maybeAppendFinal(cards, hand, '领出A，清副牌') };
  }
  // If Ace is the level/trump, K is the top non-trump rank
  const kings = nonTrump.filter(c => c.rank === Rank.King && !isTrump(c, config));
  if (kings.length > 0) {
    const cards = [kings[0]];
    return { cards, reason: maybeAppendFinal(cards, hand, '领出K，清副牌') };
  }

  const bySuit = groupBySuit(nonTrump);
  const longestSuit = bySuit.reduce((best, cds) =>
    cds.length > best.length ? cds : best, bySuit[0] || [],
  );
  if (longestSuit.length > 0) {
    longestSuit.sort((a, b) => a.rank - b.rank);
    const cards = [longestSuit[0]];
    return { cards, reason: maybeAppendFinal(cards, hand, `出${suitLabelCn(longestSuit[0].suit as Suit)}小牌，长套引诱对手出分`) };
  }

  const sorted = sortHand(hand, config);
  const c = [sorted[sorted.length - 1]];
  return { cards: c, reason: maybeAppendFinal(c, hand, '出最小牌') };
}

/** sort comparator: when teammateWinning, prefer point cards; otherwise avoid them, prefer smallest */
function discardSort(teammateWinning: boolean): (a: Card, b: Card) => number {
  return (a, b) => {
    // Prefer non-point cards unless teammate is already winning
    const aPts = isPointCard(a.rank) ? (teammateWinning ? 0 : 100) : 0;
    const bPts = isPointCard(b.rank) ? (teammateWinning ? 0 : 100) : 0;
    if (aPts !== bPts) return aPts - bPts;
    // Among same point status, pick smallest rank
    return a.rank - b.rank;
  };
}

/** Same as discardSort but additionally deprioritizes trump cards (prefer non-trump for filling) */
function fillerSort(teammateWinning: boolean, config: TrumpDeclaration): (a: Card, b: Card) => number {
  return (a, b) => {
    const aPts = isPointCard(a.rank) ? (teammateWinning ? 0 : 100) : 0;
    const bPts = isPointCard(b.rank) ? (teammateWinning ? 0 : 100) : 0;
    if (aPts !== bPts) return aPts - bPts;
    // Prefer non-trump over trump as fillers
    const aTr = isTrump(a, config) ? 100 : 0;
    const bTr = isTrump(b, config) ? 100 : 0;
    if (aTr !== bTr) return aTr - bTr;
    return a.rank - b.rank;
  };
}

function canBeatBest(cards: Card[], best: { cards: Card[]; playerIdx: number } | null | undefined, config: TrumpDeclaration): boolean {
  if (!best || best.cards.length === 0) return true;
  return Math.max(...cards.map(c => getEffectiveRank(c, config))) > Math.max(...best.cards.map(c => getEffectiveRank(c, config)));
}

function teammateWins(myIdx: number | undefined, best: { cards: Card[]; playerIdx: number } | null | undefined): boolean {
  if (myIdx === undefined || !best) return false;
  return best.playerIdx === (myIdx + 2) % 4;
}

function maxCardT(cards: Card[], config: TrumpDeclaration): Card {
  return cards.reduce((best, c) => getEffectiveRank(c, config) > getEffectiveRank(best, config) ? c : best);
}

/** decide what to follow */
export function aiFollowPlay(
  hand: Card[],
  leadCards: Card[],
  leadSuit: CardSuit,
  config: TrumpDeclaration,
  bestSoFar?: { cards: Card[]; playerIdx: number } | null,
  myIdx?: number,
): { cards: Card[]; reason: string } {
  const leadLen = leadCards.length;
  const tmWin = teammateWins(myIdx, bestSoFar);
  const leadIsTrump = leadCards.every(c => isTrump(c, config));

  let result: { cards: Card[]; reason: string };

  if (!leadSuit || leadSuit === SpecialSuit.Joker) {
    result = aiFollowTrumpOnly(hand, leadCards, config, tmWin);
    return { cards: result.cards, reason: maybeAppendFinal(result.cards, hand, result.reason) };
  }

  const leadSuitCards = hand.filter(
    c => c.suit === leadSuit && !isTrump(c, config),
  );
  const trumpCards = hand.filter(c => isTrump(c, config));

  if (leadIsTrump) {
    if (leadLen > 1) {
      result = aiFollowTrumpOnly(hand, leadCards, config, tmWin);
      return { cards: result.cards, reason: maybeAppendFinal(result.cards, hand, result.reason) };
    }

    if (trumpCards.length > 0) {
      const leadMax = Math.max(...leadCards.map(c => getEffectiveRank(c, config)));
      const canBeat = trumpCards.filter(c => getEffectiveRank(c, config) > leadMax);
      if (canBeat.length > 0) {
        canBeat.sort((a, b) => getEffectiveRank(a, config) - getEffectiveRank(b, config));
        result = { cards: [canBeat[0]], reason: '用最小能盖过的主牌' };
      } else {
        trumpCards.sort((a, b) => getEffectiveRank(a, config) - getEffectiveRank(b, config));
        result = { cards: [trumpCards[0]], reason: '主牌不够大，出最小主牌' };
      }
      return { cards: result.cards, reason: maybeAppendFinal(result.cards, hand, result.reason) };
    }
    const nonTrump0 = hand.filter(c => !isTrump(c, config));
    if (nonTrump0.length > 0) {
      nonTrump0.sort(discardSort(tmWin));
      result = { cards: [nonTrump0[0]], reason: tmWin ? '队友已大，垫分牌' : '无主牌，垫副牌' };
    } else {
      result = { cards: [hand[0]], reason: '无牌可选' };
    }
    return { cards: result.cards, reason: maybeAppendFinal(result.cards, hand, result.reason) };
  }

  if (leadSuitCards.length >= leadLen) {
    result = leadLen === 1
      ? aiFollowSingle(leadSuitCards, config, bestSoFar, tmWin)
      : aiFollowMulti(leadSuitCards, leadCards, config, bestSoFar, tmWin);
    return { cards: result.cards, reason: maybeAppendFinal(result.cards, hand, result.reason) };
  }

  // short-suited: must play ALL lead suit cards, fill rest
  if (leadSuitCards.length > 0) {
    const otherCards = hand.filter(c => !leadSuitCards.includes(c));
    otherCards.sort(fillerSort(!!tmWin, config));
    const fill = otherCards.slice(0, leadLen - leadSuitCards.length);
    return {
      cards: [...leadSuitCards, ...fill],
      reason: maybeAppendFinal([...leadSuitCards, ...fill], hand, '同花色不足，全部打出'),
    };
  }

  // void in lead suit
  if (trumpCards.length >= leadLen) {
    trumpCards.sort((a, b) => getEffectiveRank(a, config) - getEffectiveRank(b, config));
    result = { cards: trumpCards.slice(-leadLen), reason: tmWin ? '队友已大，用小主牌' : '无领出花色，用主牌毙' };
    return { cards: result.cards, reason: maybeAppendFinal(result.cards, hand, result.reason) };
  }

  // can't fully trump — discard
  const nonTrump2 = hand.filter(c => !isTrump(c, config));
  nonTrump2.sort(discardSort(!!tmWin));
  if (nonTrump2.length >= leadLen) {
    result = { cards: nonTrump2.slice(0, leadLen), reason: tmWin ? '队友已大，垫分牌' : '垫副牌' };
  } else {
    const remainingHand = [...nonTrump2, ...trumpCards];
    remainingHand.sort(discardSort(!!tmWin));
    result = {
      cards: remainingHand.slice(0, leadLen),
      reason: '垫牌(含主牌)',
    };
  }
  return { cards: result.cards, reason: maybeAppendFinal(result.cards, hand, result.reason) };
}

function aiFollowSingle(
  leadSuitCards: Card[],
  config: TrumpDeclaration,
  bestSoFar?: { cards: Card[]; playerIdx: number } | null,
  tmWin?: boolean,
): { cards: Card[]; reason: string } {
  leadSuitCards.sort((a, b) => getEffectiveRank(b, config) - getEffectiveRank(a, config));

  if (tmWin) {
    leadSuitCards.sort(discardSort(true));
    return { cards: [leadSuitCards[0]], reason: '队友已大，垫分牌' };
  }

  if (bestSoFar && !canBeatBest([leadSuitCards[0]], bestSoFar, config)) {
    leadSuitCards.sort(discardSort(false));
    return { cards: [leadSuitCards[0]], reason: '盖不过，出最小牌' };
  }

  if (bestSoFar && bestSoFar.cards.length > 0) {
    const bestRank = Math.max(...bestSoFar.cards.map(c => getEffectiveRank(c, config)));
    const beaters = leadSuitCards.filter(c => getEffectiveRank(c, config) > bestRank);
    if (beaters.length > 0) {
      beaters.sort((a, b) => getEffectiveRank(a, config) - getEffectiveRank(b, config));
      return { cards: [beaters[0]], reason: `用最小能盖过${cardName(beaters[0])}` };
    }
  }

  return { cards: [leadSuitCards[0]], reason: `出同花色最大牌${cardName(leadSuitCards[0])}` };
}

function aiFollowMulti(
  leadSuitCards: Card[],
  leadCards: Card[],
  config: TrumpDeclaration,
  bestSoFar?: { cards: Card[]; playerIdx: number } | null,
  tmWin?: boolean,
): { cards: Card[]; reason: string } {
  const leadLen = leadCards.length;
  const leadPairs = findAllPairs(leadCards);
  const myPairs = findAllPairs(leadSuitCards);
  const leadCombo = classifyCombo(leadCards, config);

  // Tractor / throw: try to match tractor slots
  if (leadCombo.hasTractor) {
    const myTractors = detectTractors(leadSuitCards, config);
    if (myTractors.length > 0) {
      myTractors.sort((a, b) => b.length - a.length);
      const picked: Card[] = [];
      const usedIds = new Set<string>();
      for (const req of leadCombo.tractors.map(t => t.pairCount)) {
        const available = myTractors.filter(t =>
          t.every(c => !usedIds.has(c.id)) && t.length / 2 >= req,
        );
        if (available.length > 0) {
          available.sort((a, b) => (a.length / 2) - (b.length / 2));
          const selected = available[0].slice(0, req * 2);
          picked.push(...selected);
          selected.forEach(c => usedIds.add(c.id));
        }
      }
      if (picked.length > 0) {
        // Fill remaining slots: pairs first, then singles
        const remaining = leadSuitCards.filter(c => !usedIds.has(c.id));
        const remPairs = findAllPairs(remaining);
        const remPairIds = new Set(remPairs.flat().map(c => c.id));
        remPairs.sort((a, b) => getEffectiveRank(a[0], config) - getEffectiveRank(b[0], config));
        const remSingles = remaining.filter(c => !remPairIds.has(c.id));
        remSingles.sort((a, b) => a.rank - b.rank);
        const fill: Card[] = [];
        for (const p of remPairs) {
          if (picked.length + fill.length + 2 > leadLen) break;
          fill.push(...p);
        }
        const singleCount = leadLen - picked.length - fill.length;
        fill.push(...remSingles.slice(0, singleCount));
        return { cards: [...picked, ...fill], reason: '用拖拉机跟牌' };
      }
    }
    // No tractor available: fill with pairs then singles
    if (myPairs.length > 0) {
      myPairs.sort((a, b) => getEffectiveRank(b[0], config) - getEffectiveRank(a[0], config));
      const chosen = myPairs.flat();
      const used = new Set(chosen.map(c => c.id));
      const remaining = leadSuitCards.filter(c => !used.has(c.id));
      remaining.sort((a, b) => a.rank - b.rank);
      return { cards: [...chosen, ...remaining].slice(0, leadLen), reason: '无拖拉机，用对子跟牌' };
    }
  }

  if (leadPairs.length > 0 && myPairs.length >= leadPairs.length) {
    myPairs.sort((a, b) => getEffectiveRank(b[0], config) - getEffectiveRank(a[0], config));
    const chosen = myPairs.slice(0, leadPairs.length).flat();
    if (chosen.length < leadLen) {
      const used = new Set(chosen.map(c => c.id));
      const remaining = leadSuitCards.filter(c => !used.has(c.id));
      remaining.sort((a, b) => a.rank - b.rank);
      chosen.push(...remaining.slice(0, leadLen - chosen.length));
    }
    return { cards: chosen.slice(0, leadLen), reason: '用对子跟牌' };
  }

  if (tmWin) {
    leadSuitCards.sort(discardSort(true));
    return { cards: leadSuitCards.slice(0, leadLen), reason: '队友已大，垫分牌' };
  }

  leadSuitCards.sort(discardSort(false));
  return { cards: leadSuitCards.slice(0, leadLen), reason: '盖不过，出最小牌' };
}

/** follow when lead is all jokers or all trump */
function aiFollowTrumpOnly(
  hand: Card[],
  leadCards: Card[],
  config: TrumpDeclaration,
  tmWin?: boolean,
): { cards: Card[]; reason: string } {
  const leadLen = leadCards.length;
  const leadCombo = classifyCombo(leadCards, config);
  const jokers = hand.filter(c => c.suit === SpecialSuit.Joker);
  const trump = hand.filter(c => isTrump(c, config) && c.suit !== SpecialSuit.Joker);
  const allTrump = [...jokers, ...trump];
  // sort by effective rank ASCENDING (weakest first) — only pick strongest when needed
  allTrump.sort((a, b) => getEffectiveRank(a, config) - getEffectiveRank(b, config));

  if (leadLen === 1) {
    if (allTrump.length > 0) {
      const leadMax = Math.max(...leadCards.map(c => getEffectiveRank(c, config)));
      const canBeat = allTrump.filter(c => getEffectiveRank(c, config) > leadMax);
      if (canBeat.length > 0) {
        return { cards: [canBeat[0]], reason: '用最小能盖过的主牌' };
      }
      return { cards: [allTrump[0]], reason: tmWin ? '队友已大，垫小主牌' : '盖不过，出最小主牌' };
    }
    const nonTrump = hand.filter(c => !isTrump(c, config));
    nonTrump.sort(discardSort(!!tmWin));
    return { cards: [nonTrump[0] || hand[0]], reason: tmWin ? '队友已大，垫分' : '无主牌，垫牌' };
  }

  // multi-card lead: try to match pattern with smallest possible cards
  if (leadCombo.hasTractor) {
    const myTractors = detectTractors(allTrump, config);
    if (myTractors.length > 0) {
      // Sort: smallest max effRank first
      myTractors.sort((a, b) =>
        getEffectiveRank(maxCardT(a, config), config) -
        getEffectiveRank(maxCardT(b, config), config),
      );
      const picked: Card[] = [];
      const usedIds = new Set<string>();
      for (const req of leadCombo.tractors.map(t => t.pairCount)) {
        const available = myTractors.filter(t =>
          t.every(c => !usedIds.has(c.id)) && t.length / 2 >= req,
        );
        if (available.length > 0) {
          available.sort((a, b) => (a.length / 2) - (b.length / 2));
          const selected = available[0].slice(0, req * 2);
          picked.push(...selected);
          selected.forEach(c => usedIds.add(c.id));
        }
      }
      if (picked.length > 0) {
        const remaining = allTrump.filter(c => !usedIds.has(c.id));
        const remPairs = findAllPairs(remaining);
        const remPairIds = new Set(remPairs.flat().map(c => c.id));
        // Prefer non-point pairs for fill
        remPairs.sort((a, b) => {
          const aPts = isPointCard(a[0].rank) ? 100 : 0;
          const bPts = isPointCard(b[0].rank) ? 100 : 0;
          if (aPts !== bPts) return aPts - bPts;
          return getEffectiveRank(a[0], config) - getEffectiveRank(b[0], config);
        });
        const remSingles = remaining.filter(c => !remPairIds.has(c.id));
        // Avoid point singles if possible
        remSingles.sort((a, b) => {
          const aPts = isPointCard(a.rank) ? 100 : 0;
          const bPts = isPointCard(b.rank) ? 100 : 0;
          if (aPts !== bPts) return aPts - bPts;
          return getEffectiveRank(a, config) - getEffectiveRank(b, config);
        });
        const fill: Card[] = [];
        for (const p of remPairs) {
          if (picked.length + fill.length + 2 > leadLen) break;
          fill.push(...p);
        }
        const singleCount = leadLen - picked.length - fill.length;
        fill.push(...remSingles.slice(0, singleCount));
        return { cards: [...picked, ...fill], reason: '用最小主牌拖拉机跟牌' };
      }
    }
    // No tractor available: fill with pairs then singles, avoid point pairs
    if (allTrump.length >= leadLen) {
      const myPairsAll = findAllPairs(allTrump);
      if (myPairsAll.length > 0) {
        myPairsAll.sort((a, b) => {
          const aPts = isPointCard(a[0].rank) ? 100 : 0;
          const bPts = isPointCard(b[0].rank) ? 100 : 0;
          if (aPts !== bPts) return aPts - bPts;
          return getEffectiveRank(a[0], config) - getEffectiveRank(b[0], config);
        });
        const picked = myPairsAll.flat();
        const usedIds2 = new Set(picked.map(c => c.id));
        const rest = allTrump.filter(c => !usedIds2.has(c.id));
        rest.sort((a, b) => {
          const aPts = isPointCard(a.rank) ? 100 : 0;
          const bPts = isPointCard(b.rank) ? 100 : 0;
          if (aPts !== bPts) return aPts - bPts;
          return getEffectiveRank(a, config) - getEffectiveRank(b, config);
        });
        return { cards: [...picked, ...rest].slice(0, leadLen), reason: '无拖拉机，出最小主牌对子跟牌' };
      }
      return { cards: allTrump.slice(0, leadLen), reason: '无拖拉机，出最小主牌' };
    }
  }

  // pair pattern: try smallest non-point pairs first
  const myPairs = findAllPairs(allTrump);
  const leadPairs = findAllPairs(leadCards);

  if (leadPairs.length > 0) {
    if (myPairs.length >= leadPairs.length) {
      // Prefer non-point pairs
      myPairs.sort((a, b) => {
        const aPts = isPointCard(a[0].rank) ? 100 : 0;
        const bPts = isPointCard(b[0].rank) ? 100 : 0;
        if (aPts !== bPts) return aPts - bPts;
        return getEffectiveRank(a[0], config) - getEffectiveRank(b[0], config);
      });
      const picked = myPairs.slice(0, leadPairs.length).flat();
      if (picked.length === leadLen) {
        return { cards: picked, reason: `用${leadPairs.length}个最小主牌对子跟牌` };
      }
    }
    if (myPairs.length > 0) {
      myPairs.sort((a, b) => {
        const aPts = isPointCard(a[0].rank) ? 100 : 0;
        const bPts = isPointCard(b[0].rank) ? 100 : 0;
        if (aPts !== bPts) return aPts - bPts;
        return getEffectiveRank(a[0], config) - getEffectiveRank(b[0], config);
      });
      const picked = myPairs.flat();
      const usedIds = new Set(picked.map(c => c.id));
      const remaining = allTrump.filter(c => !usedIds.has(c.id));
      remaining.sort((a, b) => {
        const aPts = isPointCard(a.rank) ? 100 : 0;
        const bPts = isPointCard(b.rank) ? 100 : 0;
        if (aPts !== bPts) return aPts - bPts;
        return getEffectiveRank(a, config) - getEffectiveRank(b, config);
      });
      return {
        cards: [...picked, ...remaining.slice(0, leadLen - picked.length)],
        reason: `用最小主牌对子跟牌(${myPairs.length}对)`,
      };
    }
  }

  // can't match any pattern — play smallest non-point trump cards
  if (allTrump.length >= leadLen) {
    const sorted = [...allTrump].sort((a, b) => {
      const aPts = isPointCard(a.rank) ? 100 : 0;
      const bPts = isPointCard(b.rank) ? 100 : 0;
      if (aPts !== bPts) return aPts - bPts;
      return getEffectiveRank(a, config) - getEffectiveRank(b, config);
    });
    return { cards: sorted.slice(0, leadLen), reason: `出${leadLen}张最小主牌` };
  }

  // really can't — pad with non-trump
  const nonTrump = hand.filter(c => !isTrump(c, config));
  nonTrump.sort(discardSort(!!tmWin));
  return {
    cards: [...allTrump, ...nonTrump.slice(0, leadLen - allTrump.length)],
    reason: '主牌不足，补垫牌',
  };
}

export function groupBySuit(cards: Card[]): Card[][] {
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    const key = String(card.suit);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(card);
  }
  return Array.from(groups.values());
}

function suitLabelCn(suit: Suit): string {
  return { S: '♠', H: '♥', C: '♣', D: '♦' }[suit] || suit;
}

function cardName(card: Card): string {
  const rankMap: Record<number, string> = {
    14: 'A', 13: 'K', 12: 'Q', 11: 'J', 15: 'joker', 16: 'JOKER',
  };
  const rank = rankMap[card.rank] || String(card.rank);
  const suit = card.isJoker ? '' : { S: '♠', H: '♥', C: '♣', D: '♦' }[card.suit as Suit] || String(card.suit);
  return suit + rank;
}

/** suggest plays for human in debug mode */
export function suggestPlay(
  hand: Card[],
  isLeading: boolean,
  leadCombo: ComboClass | null,
  leadSuit: CardSuit | null,
  config: TrumpDeclaration,
): { suggested: Card[]; reason: string } | null {
  const result = isLeading ? aiLeadPlay(hand, config) : (
    leadCombo && leadSuit
      ? aiFollowPlay(hand, leadCombo.cards, leadSuit, config)
      : null
  );
  if (!result) return null;
  return { suggested: result.cards, reason: result.reason };
}
