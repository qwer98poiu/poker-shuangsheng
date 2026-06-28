import type { GameState, PlayerState, TrumpDeclaration, Reveal } from '../types/game.js';
import { GamePhase, type Trick } from '../types/game.js';
import type { Card, CardSuit } from '../types/card.js';
import { SpecialSuit, Suit, Rank, cardPoints } from '../types/card.js';
import type { PlayedCards } from '../types/play.js';
import { classifyCombo, detectTractor } from '../rules/tractor.js';
import { getComboSuit } from '../rules/comparison.js';
import { isTrump, getEffectiveRank } from '../model/rank.js';

// ============ reveal trump (亮主) ============

export function tryReveal(
  state: GameState,
  playerIndex: number,
  suit: Suit | null,
): GameState {
  if (state.phase !== GamePhase.Dealing && state.phase !== GamePhase.Revealing) return state;

  const player = state.players[playerIndex];
  const level = state.currentLevel;

  let strength: number;
  if (suit === null) {
    // NT requires a PAIR of jokers (same rank): two BigJokers or two SmallJokers
    const bigJokers = player.hand.filter(c => c.rank === Rank.BigJoker);
    const smallJokers = player.hand.filter(c => c.rank === Rank.SmallJoker);
    if (bigJokers.length < 2 && smallJokers.length < 2) return state;
    strength = 3;
  } else {
    const levelOfSuit = player.hand.filter(c => c.suit === suit && c.rank === level);
    if (levelOfSuit.length === 0) return state;
    strength = levelOfSuit.length >= 2 ? 2 : 1;
  }

  const reveal: Reveal = { playerIndex, suit, strength };

  if (!state.currentReveal || strength > state.currentReveal.strength) {
    return {
      ...state,
      currentReveal: reveal,
      reveals: [...state.reveals, reveal],
      phase: GamePhase.Revealing,
    };
  }

  return { ...state, reveals: [...state.reveals, reveal] };
}

export function finalizeReveal(state: GameState): GameState {
  if (state.currentReveal) {
    const rev = state.currentReveal;
    const trump: TrumpDeclaration = {
      declarerIndex: rev.playerIndex,
      trumpSuit: rev.suit,
      level: state.currentLevel,
    };
    return {
      ...state,
      phase: GamePhase.Playing,
      trumpDeclaration: trump,
      currentPlayerIndex: rev.playerIndex,
      leadPlayerIndex: rev.playerIndex,
      dealingComplete: true,
    };
  }
  return autoCallTrump(state);
}

function autoCallTrump(state: GameState): GameState {
  const dealer = state.players[state.dealerIndex];
  const level = state.currentLevel;
  for (const suit of [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds]) {
    const count = dealer.hand.filter(c => c.suit === suit && c.rank === level).length;
    if (count > 0) {
      return {
        ...state,
        phase: GamePhase.Playing,
        trumpDeclaration: { declarerIndex: state.dealerIndex, trumpSuit: suit, level },
        currentPlayerIndex: state.dealerIndex,
        leadPlayerIndex: state.dealerIndex,
        dealingComplete: true,
      };
    }
  }
  return {
    ...state,
    phase: GamePhase.Playing,
    trumpDeclaration: { declarerIndex: state.dealerIndex, trumpSuit: Suit.Spades, level },
    currentPlayerIndex: state.dealerIndex,
    leadPlayerIndex: state.dealerIndex,
    dealingComplete: true,
  };
}

// ============ play cards ============

export function playCards(
  state: GameState,
  playerIndex: number,
  cards: Card[],
): { state: GameState; error?: string } {
  if (state.phase !== GamePhase.Playing) {
    return { state, error: 'not in playing phase' };
  }
  if (playerIndex !== state.currentPlayerIndex) {
    return { state, error: 'not your turn' };
  }

  const player = state.players[playerIndex];
  const isLeading = state.trickPlays.length === 0;

  for (const c of cards) {
    if (!c || !player.hand.some(h => h && h.id === c.id)) {
      return { state, error: `card ${c?.id || 'undefined'} not in hand` };
    }
  }

  const idSet = new Set(cards.map(c => c.id));
  if (idSet.size !== cards.length) {
    return { state, error: 'duplicate cards' };
  }

  if (!isLeading) {
    const leadPlay = state.trickPlays[0];
    const leadLen = leadPlay.cards.length;

    if (cards.length !== leadLen) {
      return { state, error: `must play exactly ${leadLen} cards, got ${cards.length}` };
    }

    const config = state.trumpDeclaration!;
    const leadSuit = getComboSuit(leadPlay.pattern);

    // if lead is ALL trump: followers must follow with trump if they have any
    const leadIsTrumpLead = leadPlay.cards.every(c => isTrump(c, config));
    const trumpCardsInHand = player.hand.filter(c => isTrump(c, config));

    if (leadIsTrumpLead) {
      // must play trump if you have enough to match the lead count
      if (trumpCardsInHand.length >= leadLen) {
        const playTrump = cards.filter(c => isTrump(c, config));
        if (playTrump.length < leadLen) {
          // player didn't play enough trump — they had them but didn't use them
          return { state, error: '领出主牌，你必须跟主牌' };
        }
      }

      // multi-card trump lead: check pattern (pair/tractor)
      if (leadLen >= 2) {
        if (leadPlay.pattern.type === 'pair' && leadLen === 2) {
          const playIsPair = cards.length === 2 && cards[0].suit === cards[1].suit && cards[0].rank === cards[1].rank;
          if (!playIsPair && trumpCardsInHand.length >= 2) {
            const myPairs = findPairs(trumpCardsInHand);
            if (myPairs.length > 0) {
              return { state, error: '主牌对子领出，你有主牌对子必须跟对子' };
            }
          }
        }

        if (leadPlay.pattern.hasTractor && trumpCardsInHand.length >= 4) {
          const myTractors = detectTractor(trumpCardsInHand, config);
          if (myTractors.length > 0) {
            const playTrump = cards.filter(c => isTrump(c, config));
            const playTractors = detectTractor(playTrump, config);
            if (playTractors.length === 0) {
              return { state, error: '主牌拖拉机领出，你有拖拉机必须跟' };
            }
          }
        }
      }
    }

    if (leadSuit && !leadIsTrumpLead) {
      // normal suit lead: followers must follow suit if they have it
      const leadSuitCards = player.hand.filter(
        c => c.suit === leadSuit && !isTrump(c, config),
      );

      if (leadSuitCards.length >= leadLen) {
        const playNonTrump = cards.filter(c => !isTrump(c, config));
        if (!playNonTrump.every(c => c.suit === leadSuit)) {
          return { state, error: 'must follow suit' };
        }

        if (leadPlay.pattern.type === 'pair' && cards.length === 2) {
          if (cards[0].suit !== cards[1].suit || cards[0].rank !== cards[1].rank) {
            const pairs = findPairs(leadSuitCards);
            if (pairs.length > 0) {
              return { state, error: 'must play a pair if you have one' };
            }
          }
        }

        if (leadPlay.pattern.hasTractor && leadSuitCards.length >= 4) {
          const tractors = detectTractor(leadSuitCards, config);
          if (tractors.length > 0) {
            const playTractors = detectTractor(
              cards.filter(c => c.suit === leadSuit), config,
            );
            if (playTractors.length === 0) {
              return { state, error: 'must play tractor if you have one' };
            }
          }
        }
      }
    }
  }

  const combo = classifyCombo(cards, state.trumpDeclaration!);
  const played: PlayedCards = {
    cards,
    pattern: combo,
    leadSuit: isLeading ? getComboSuit(combo) : state.trickPlays[0].leadSuit,
  };

  const newTrickPlays = [...state.trickPlays, played];
  const newHand = player.hand.filter(c => !cards.some(p => p.id === c.id));

  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, hand: newHand } : p,
  ) as [PlayerState, PlayerState, PlayerState, PlayerState];

  const nextPlayer = (playerIndex + 1) % 4;

  if (newTrickPlays.length === 4) {
    return resolveTrick({
      ...state, players: newPlayers, trickPlays: newTrickPlays, currentPlayerIndex: nextPlayer,
    });
  }

  return {
    state: {
      ...state,
      players: newPlayers,
      trickPlays: newTrickPlays,
      currentPlayerIndex: nextPlayer,
    },
  };
}

function findPairs(cards: Card[]): Card[][] {
  const result: Card[][] = [];
  const sorted = [...cards].sort((a, b) => {
    if (a.suit !== b.suit) return String(a.suit).localeCompare(String(b.suit));
    return b.rank - a.rank;
  });
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].suit === sorted[i + 1].suit && sorted[i].rank === sorted[i + 1].rank) {
      result.push([sorted[i], sorted[i + 1]]);
      i++;
    }
  }
  return result;
}

function resolveTrick(
  state: GameState,
): { state: GameState; error?: string } {
  const plays = state.trickPlays as [PlayedCards, PlayedCards, PlayedCards, PlayedCards];
  const config = state.trumpDeclaration!;

  let winnerIdx = state.leadPlayerIndex;
  let bestPlay = plays[0];

  for (let i = 1; i < 4; i++) {
    if (comparePlays(plays[i], bestPlay, config) > 0) {
      winnerIdx = (state.leadPlayerIndex + i) % 4;
      bestPlay = plays[i];
    }
  }

  let points = 0;
  for (const play of plays) {
    for (const card of play.cards) {
      points += cardPoints(card.rank);
    }
  }

  const trick: Trick = { plays, leadPlayerIndex: state.leadPlayerIndex, winnerIndex: winnerIdx, points };

  // defender = team of the玩家 who won the reveal (庄家), NOT the original dealer
  const defenderTeam = config.declarerIndex % 2;
  const attackerTeam = defenderTeam === 0 ? 1 : 0;
  const winnerTeam = winnerIdx % 2;
  const attackerPoints = points > 0 && winnerTeam === attackerTeam
    ? state.attackerPoints + points
    : state.attackerPoints;

  const newTricksPlayed = state.tricksPlayed + 1;

  // Invariant: after every trick, all four players must have the same hand size.
  // If not, something went wrong—log it and end the round gracefully.
  const sizes = state.players.map(p => p.hand.length);
  const allSame = sizes.every(s => s === sizes[0]);

  if (!allSame) {
    // This should never happen; it indicates a bug in play-card counting.
    // End the round immediately to avoid cascading failures.
    const ended = endRound({
      ...state,
      trickHistory: [...state.trickHistory, trick],
      attackerPoints,
      tricksPlayed: newTricksPlayed,
      trickPlays: [],
      leadPlayerIndex: winnerIdx,
      currentPlayerIndex: winnerIdx,
    });
    return { state: ended };
  }

  const allEmpty = sizes[0] === 0;

  if (allEmpty) {
    const ended = endRound({
      ...state,
      trickHistory: [...state.trickHistory, trick],
      attackerPoints,
      tricksPlayed: newTricksPlayed,
      trickPlays: [],
      leadPlayerIndex: winnerIdx,
      currentPlayerIndex: winnerIdx,
    });
    return { state: ended };
  }

  return {
    state: {
      ...state,
      trickHistory: [...state.trickHistory, trick],
      attackerPoints,
      tricksPlayed: newTricksPlayed,
      trickPlays: [],
      leadPlayerIndex: winnerIdx,
      currentPlayerIndex: winnerIdx,
    },
  };
}

function comparePlays(
  follow: PlayedCards,
  best: PlayedCards,
  config: TrumpDeclaration,
): number {
  const followTrump = follow.cards.some(c => isTrump(c, config));
  const bestTrump = best.cards.some(c => isTrump(c, config));

  // trump always beats non-trump
  if (followTrump && !bestTrump) return 1;
  if (!followTrump && bestTrump) return -1;

  // both trump: compare by effective rank, then pattern
  if (followTrump && bestTrump) {
    const fMax = Math.max(...follow.cards.map(c => getEffectiveRank(c, config)));
    const bMax = Math.max(...best.cards.map(c => getEffectiveRank(c, config)));
    if (follow.pattern.hasTractor && !best.pattern.hasTractor) return 1;
    if (!follow.pattern.hasTractor && best.pattern.hasTractor) return -1;
    if (follow.pattern.pairCount > best.pattern.pairCount) return 1;
    if (follow.pattern.pairCount < best.pattern.pairCount) return -1;
    return fMax - bMax;
  }

  // both non-trump: use lead suit from the plays (all share same leadSuit)
  const leadSuit = best.leadSuit;
  const followInLead = leadSuit ? follow.cards.every(c => c.suit === leadSuit) : false;
  const bestInLead = leadSuit ? best.cards.every(c => c.suit === leadSuit) : false;

  // following suit beats discarding
  if (followInLead && !bestInLead) return 1;
  if (!followInLead && bestInLead) return -1;

  // both following suit: compare by rank, then pattern
  if (followInLead && bestInLead) {
    const fMax = Math.max(...follow.cards.map(c => c.rank));
    const bMax = Math.max(...best.cards.map(c => c.rank));
    if (follow.pattern.hasTractor && !best.pattern.hasTractor) return 1;
    if (!follow.pattern.hasTractor && best.pattern.hasTractor) return -1;
    if (follow.pattern.pairCount > best.pattern.pairCount) return 1;
    if (follow.pattern.pairCount < best.pattern.pairCount) return -1;
    return fMax - bMax;
  }

  // both discarding: first-discarded (best) wins
  return -1;
}

function endRound(state: GameState): GameState {
  const lastTrick = state.trickHistory[state.trickHistory.length - 1];
  const lastWinnerTeam = lastTrick.winnerIndex % 2;
  const defenderTeam = state.trumpDeclaration!.declarerIndex % 2;
  const attackerTeam = defenderTeam === 0 ? 1 : 0;

  let bottomPoints = 0;
  for (const card of state.bottomCards) {
    bottomPoints += cardPoints(card.rank);
  }
  bottomPoints *= 2;

  const finalAttackerPoints = lastWinnerTeam === attackerTeam
    ? state.attackerPoints + bottomPoints
    : state.attackerPoints;

  return { ...state, phase: GamePhase.RoundEnd, attackerPoints: finalAttackerPoints };
}

export function computeLevelChange(attackerPoints: number): { defenderChange: number; attackerChange: number } {
  if (attackerPoints >= 80) return { defenderChange: 0, attackerChange: 1 };
  if (attackerPoints >= 40) return { defenderChange: 1, attackerChange: 0 };
  return { defenderChange: 2, attackerChange: 0 };
}
