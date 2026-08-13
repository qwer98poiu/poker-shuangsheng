import type { GameState } from '@poker/engine';
import { rankLabel, suitLabel } from '@poker/engine';

/** CLI 风格单牌显示（如 ♠A / 🃏JOKER）。 */
export function cardName(c: { suit: string; rank: number }): string {
  if (c.rank >= 15) return c.rank === 16 ? 'JOKER' : 'joker';
  return `${suitLabel(c.suit as any)}${rankLabel(c.rank)}`;
}

export interface ExportInput {
  gameState: GameState;
  roundNumber: number;
}

/** 调试导出：亮主信息、底牌、历史出牌、当前墩、所有玩家手牌（紧凑 CLI 风格）。 */
export function formatGameExport({ gameState: gs, roundNumber }: ExportInput): string {
  const lines: string[] = [];
  const trump = gs.trumpDeclaration;
  const declarerIdx = trump?.declarerIndex ?? gs.declarerIndex;

  lines.push(
    `第 ${roundNumber + 1} 局 | 级牌 ${rankLabel(gs.currentLevel)}`
    + (trump
      ? ` | 主牌: ${trump.trumpSuit ? `${suitLabel(trump.trumpSuit)}${rankLabel(trump.level)} (${suitLabel(trump.trumpSuit)}主)` : `无主 (${rankLabel(trump.level)})`}`
      : ' | 主牌: 未亮')
    + ` | 庄家: ${gs.players[declarerIdx].name}`,
  );
  lines.push(`闲家得分: ${gs.attackerPoints} | 墩: ${gs.tricksPlayed}/25`);

  const bottom = gs.bottomCards.map(cardName).join(' ');
  lines.push(`底牌(${gs.bottomCards.length}): ${bottom || '—'}`);

  // 初始手牌（扣底后各 25 张，免反推开局）
  if (gs.initialHands && gs.initialHands.length === 4) {
    lines.push('--- 初始手牌 ---');
    for (let i = 0; i < 4; i++) {
      const init = gs.initialHands[i];
      lines.push(`${gs.players[i].name}(${init.length}): ${init.map(cardName).join(' ') || '—'}`);
    }
  }

  // 历史出牌
  if (gs.trickHistory.length > 0) {
    lines.push('--- 出牌历史 ---');
    for (let i = 0; i < gs.trickHistory.length; i++) {
      const t = gs.trickHistory[i];
      const plays = t.plays.map((p, j) => {
        const pi = (t.leadPlayerIndex + j) % 4;
        const crown = pi === t.winnerIndex ? ' 👑' : '';
        return `${gs.players[pi].name}${crown}: ${p.cards.map(cardName).join(' ')}`;
      }).join(' | ');
      lines.push(`第 ${i + 1} 墩 ${plays}${t.points > 0 ? ` 得分${t.points}` : ''}`);
    }
  }

  // 当前墩
  if (gs.trickPlays.length > 0) {
    lines.push('--- 当前墩 ---');
    const plays = gs.trickPlays.map((p, j) => {
      const pi = (gs.leadPlayerIndex + j) % 4;
      return `${gs.players[pi].name}: ${p.cards.map(cardName).join(' ')}`;
    }).join(' | ');
    lines.push(plays);
  }

  // 手牌
  lines.push('--- 手牌 ---');
  for (let i = 0; i < 4; i++) {
    const p = gs.players[i];
    lines.push(`${p.name}(${p.hand.length}): ${p.hand.map(cardName).join(' ') || '—'}`);
  }

  return lines.join('\n');
}
