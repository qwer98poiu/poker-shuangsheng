import type { Card, CardSuit } from '../types.js';
import { Suit } from '../types.js';
import type { GameState, PlayerState, TrumpDeclaration, PlayedCards, ComboClass } from '../types.js';
import { GamePhase } from '../types.js';

/** lightweight JSON shape for card */
interface CardJSON {
  id: string;
  suit: string; // 'S'|'H'|'C'|'D'|'J'
  rank: number;
  isJoker: boolean;
}

interface SaveData {
  v: number;
  t: string;          // timestamp ISO
  deal: { hands: CardJSON[][]; bottom: CardJSON[] };
  players: { name: string; isHuman: boolean; index: number }[];
  trump: { declarerIndex: number; trumpSuit: string | null; level: number } | null;
  attackerPoints: number;
  currentLevel: number;
  dealerIndex: number;
  currentPlayer: number;
  leadPlayer: number;
  tricksPlayed: number;
  trickHistory: TrickJSON[];
  trickPlays: PlayJSON[];       // current trick plays
  bottomCards: CardJSON[];      // current bottom (post-exchange)
  reveals: { playerIndex: number; suit: string | null; strength: number }[];
  aiReasons: { playerIndex: number; phase: string; decision: string; reason: string; cards: string[] }[];
  aiPlayers: boolean[];
  debug: boolean;
}

interface TrickJSON {
  plays: [PlayJSON, PlayJSON, PlayJSON, PlayJSON];
  leadPlayerIndex: number;
  winnerIndex: number;
  points: number;
}

interface PlayJSON {
  cards: CardJSON[];
  pattern: { type: string; pairCount: number; hasTractor: boolean; tractors: { pairCount: number }[] };
  leadSuit: string | null;
}

function cardToJSON(c: Card): CardJSON {
  return { id: c.id, suit: c.suit, rank: c.rank, isJoker: c.isJoker };
}

function cardFromJSON(j: CardJSON): Card {
  return Object.freeze({
    id: j.id,
    suit: j.suit as CardSuit,
    rank: j.rank,
    isJoker: j.isJoker,
  });
}

function comboToJSON(p: ComboClass): PlayJSON['pattern'] {
  return { type: p.type, pairCount: p.pairCount, hasTractor: p.hasTractor, tractors: p.tractors };
}

function comboFromJSON(j: PlayJSON['pattern'], cards: Card[]): ComboClass {
  return {
    type: j.type as ComboClass['type'],
    cards,
    length: cards.length,
    pairCount: j.pairCount,
    hasTractor: j.hasTractor,
    tractors: j.tractors,
  };
}

function playToJSON(p: PlayedCards): PlayJSON {
  return {
    cards: p.cards.map(cardToJSON),
    pattern: comboToJSON(p.pattern),
    leadSuit: p.leadSuit,
  };
}

function playFromJSON(j: PlayJSON): PlayedCards {
  const cards = j.cards.map(cardFromJSON);
  return {
    cards,
    pattern: comboFromJSON(j.pattern, cards),
    leadSuit: j.leadSuit as CardSuit | null,
  };
}

/** serialize game state to JSON string */
export function serialize(state: GameState, aiPlayers: boolean[], debug: boolean): string {
  const save: SaveData = {
    v: 1,
    t: new Date().toISOString(),
    deal: {
      hands: state.players.map(p => p.hand.map(cardToJSON)),
      bottom: state.bottomCards.map(cardToJSON),
    },
    players: state.players.map(p => ({ name: p.name, isHuman: p.isHuman, index: p.index })),
    trump: state.trumpDeclaration
      ? { declarerIndex: state.trumpDeclaration.declarerIndex, trumpSuit: state.trumpDeclaration.trumpSuit, level: state.trumpDeclaration.level }
      : null,
    attackerPoints: state.attackerPoints,
    currentLevel: state.currentLevel,
    dealerIndex: state.dealerIndex,
    currentPlayer: state.currentPlayerIndex,
    leadPlayer: state.leadPlayerIndex,
    tricksPlayed: state.tricksPlayed,
    trickHistory: state.trickHistory.map(t => {
      const p0 = playToJSON(t.plays[0]);
      const p1 = playToJSON(t.plays[1]);
      const p2 = playToJSON(t.plays[2]);
      const p3 = playToJSON(t.plays[3]);
      return {
        plays: [p0, p1, p2, p3] as [PlayJSON, PlayJSON, PlayJSON, PlayJSON],
        leadPlayerIndex: t.leadPlayerIndex,
        winnerIndex: t.winnerIndex,
        points: t.points,
      };
    }),
    trickPlays: state.trickPlays.map(playToJSON),
    bottomCards: state.bottomCards.map(cardToJSON),
    reveals: state.reveals.map(r => ({ playerIndex: r.playerIndex, suit: r.suit, strength: r.strength })),
    aiReasons: state.aiReasons.map(r => ({ playerIndex: r.playerIndex, phase: r.phase, decision: r.decision, reason: r.reason, cards: r.cards })),
    aiPlayers,
    debug,
  };
  return JSON.stringify(save, null, 2);
}

/** deserialize JSON string into game state + metadata */
export function deserialize(json: string): { state: GameState; aiPlayers: boolean[]; debug: boolean } {
  const save: SaveData = JSON.parse(json);

  const players: PlayerState[] = save.players.map((p, i) => ({
    hand: save.deal.hands[i].map(cardFromJSON),
    isHuman: p.isHuman,
    name: p.name,
    index: p.index,
  }));

  const trumpDecl: TrumpDeclaration | null = save.trump
    ? { declarerIndex: save.trump.declarerIndex, trumpSuit: save.trump.trumpSuit as Suit | null, level: save.trump.level }
    : null;

  const state: GameState = {
    phase: GamePhase.Playing,
    currentLevel: save.currentLevel,
    players: players as [PlayerState, PlayerState, PlayerState, PlayerState],
    bottomCards: save.bottomCards.map(cardFromJSON),
    trickHistory: save.trickHistory.map(t => {
      const p0 = playFromJSON(t.plays[0]);
      const p1 = playFromJSON(t.plays[1]);
      const p2 = playFromJSON(t.plays[2]);
      const p3 = playFromJSON(t.plays[3]);
      return {
        plays: [p0, p1, p2, p3] as [PlayedCards, PlayedCards, PlayedCards, PlayedCards],
        leadPlayerIndex: t.leadPlayerIndex,
        winnerIndex: t.winnerIndex,
        points: t.points,
      };
    }),
    dealerIndex: save.dealerIndex,
    trumpDeclaration: trumpDecl,
    attackerPoints: save.attackerPoints,
    currentPlayerIndex: save.currentPlayer,
    leadPlayerIndex: save.leadPlayer,
    trickPlays: save.trickPlays.map(playFromJSON),
    tricksPlayed: save.tricksPlayed,
    reveals: save.reveals.map(r => ({ playerIndex: r.playerIndex, suit: r.suit as Suit | null, strength: r.strength })),
    currentReveal: null,
    dealingComplete: true,
    dealtCards: save.deal.hands.map(h => h.map(cardFromJSON)) as [Card[], Card[], Card[], Card[]],
    debug: save.debug,
    aiReasons: save.aiReasons.map(r => ({ playerIndex: r.playerIndex, phase: r.phase, decision: r.decision, reason: r.reason, cards: r.cards })),
  };

  return { state, aiPlayers: save.aiPlayers, debug: save.debug };
}

/** truncate a loaded state back to the start of trick N (0-indexed) */
export function resumeFromTrick(
  loaded: { state: GameState; aiPlayers: boolean[]; debug: boolean },
  trickN: number,
): { state: GameState; aiPlayers: boolean[]; debug: boolean } {
  const { state, aiPlayers, debug } = loaded;

  // keep only tricks before N
  const keptHistory = state.trickHistory.slice(0, trickN);

  // re-derive hands: start from dealt hands, then subtract all played cards in kept history
  const dealtHands = state.dealtCards.map(h => [...h]);
  for (const trick of keptHistory) {
    for (let i = 0; i < 4; i++) {
      const pi = (trick.leadPlayerIndex + i) % 4;
      for (const c of trick.plays[i].cards) {
        const idx = dealtHands[pi].findIndex(h => h.id === c.id);
        if (idx >= 0) dealtHands[pi].splice(idx, 1);
      }
    }
  }

  // attacker points = sum of points from kept history where winner is attacker
  const defenderTeam = state.trumpDeclaration ? state.trumpDeclaration.declarerIndex % 2 : state.dealerIndex % 2;
  const attackerTeam = defenderTeam === 0 ? 1 : 0;
  let ap = 0;
  for (const trick of keptHistory) {
    if (trick.winnerIndex % 2 === attackerTeam) ap += trick.points;
  }

  // who leads next trick N? the winner of trick N-1 if N>0, else the original lead
  const nextLead = keptHistory.length > 0
    ? keptHistory[keptHistory.length - 1].winnerIndex
    : state.leadPlayerIndex;

  const resumed: GameState = {
    ...state,
    players: state.players.map((p, i) => ({ ...p, hand: dealtHands[i] })) as any,
    trickHistory: keptHistory,
    attackerPoints: ap,
    tricksPlayed: keptHistory.length,
    trickPlays: [],
    currentPlayerIndex: nextLead,
    leadPlayerIndex: nextLead,
  };

  return { state: resumed, aiPlayers, debug };
}
