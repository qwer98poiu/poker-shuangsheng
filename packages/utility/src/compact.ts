/**
 * Compact format converter for saves/match files.
 *
 * Converts verbose JSON (full card objects, nested arrays) into a compact
 * text representation that is human-readable and diff-friendly.
 *
 * Card shorthand: suit+rank, e.g. S14=♠A, H5=♥5, J16=JOKER, J15=joker
 * Trick display: P0: S14 H5 | P1: C3 C4 → P2 wins (10 pts)
 */
import type { Card } from '@poker/engine';

// ---- Card shorthand ----

export function shortCard(c: { suit: string; rank: number }): string {
  if (c.suit === 'J') return c.rank === 16 ? 'BJ' : 'SJ';
  return `${c.suit}${c.rank}`;
}

export function longCard(shorthand: string): { suit: string; rank: number } {
  if (shorthand === 'BJ') return { suit: 'J', rank: 16 };
  if (shorthand === 'SJ') return { suit: 'J', rank: 15 };
  return { suit: shorthand[0], rank: parseInt(shorthand.slice(1)) };
}

// ---- Compact round printer ----

interface RoundData {
  v: number; t: string;
  trump?: { trumpSuit: string | null; level: number; declarerIndex: number } | null;
  attackerPoints: number;
  currentLevel: number;
  dealerIndex: number;
  trickHistory?: TrickEntry[];
  tricksPlayed?: number;
  aiPlayers?: boolean[];
  players?: { name: string }[];
}

interface TrickEntry {
  leadPlayerIndex: number;
  winnerIndex: number;
  points: number;
  plays: { cards: { suit: string; rank: number }[] }[][];
}

export function compactRound(data: Record<string, any>): string {
  const lines: string[] = [];

  const trumpInfo = data.trump
    ? `trump=${data.trump.trumpSuit || 'NT'}${data.trump.level} declarer=P${(data.trump.declarerIndex ?? 0) + 1}`
    : 'trump=?';
  lines.push(`# Round — ${trumpInfo} | dealer=P${(data.dealerIndex ?? 0) + 1} | level=${data.currentLevel}`);

  const history: TrickEntry[] = data.trickHistory ?? [];
  for (let ti = 0; ti < history.length; ti++) {
    const t = history[ti];
    const parts: string[] = [];
    for (let pi = 0; pi < 4; pi++) {
      const playIdx = pi;
      if (t.plays && t.plays[playIdx]) {
        const cards = (t.plays[playIdx].cards ?? t.plays[playIdx] ?? []).map(shortCard).join(' ');
        const actualPi = (t.leadPlayerIndex + pi) % 4;
        parts.push(`P${actualPi + 1}: ${cards}`);
      }
    }
    const winner = t.winnerIndex !== undefined ? `P${t.winnerIndex + 1}` : '?';
    const pts = t.points ?? 0;
    lines.push(`  T${String(ti + 1).padStart(2)} | ${parts.join(' | ')} → ${winner} (${pts}pts)`);
  }

  lines.push(`  Attacker pts: ${data.attackerPoints ?? '?'}`);
  return lines.join('\n');
}

export function compactMatch(data: Record<string, any>[]): string {
  return data.map((r, i) => `## Round ${i + 1}\n${compactRound(r)}`).join('\n\n');
}

// ---- CLI tool entry ----

export function convertFile(inputPath: string, outputPath?: string): string {
  const fs = require('fs');
  const raw = fs.readFileSync(inputPath, 'utf-8');
  const data = JSON.parse(raw);

  let output: string;
  if (Array.isArray(data)) {
    output = compactMatch(data);
  } else {
    output = compactRound(data);
  }

  if (outputPath) {
    fs.writeFileSync(outputPath, output, 'utf-8');
    return `Written to ${outputPath}`;
  }
  return output;
}
