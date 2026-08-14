import React from 'react';
import type { Card, GameState, TrumpDeclaration } from '@poker/engine';
import { GamePhase } from '@poker/engine';
import { canSubmitPlay } from './playable.js';

interface ActionBarProps {
  gameState: GameState;
  localPlayerIndex: number;
  selectedCards: Card[];
  hand: Card[];
  trumpDeclaration: TrumpDeclaration | null;
  isHuman: boolean;
  onSubmitPlay: () => void;
  onClearSelection: () => void;
}

const ActionBar: React.FC<ActionBarProps> = ({
  gameState,
  localPlayerIndex,
  selectedCards,
  hand,
  trumpDeclaration,
  isHuman,
  onSubmitPlay,
  onClearSelection,
}) => {
  if (gameState.phase !== GamePhase.Playing) return null;
  if (gameState.currentPlayerIndex !== localPlayerIndex) return null;
  if (!isHuman) return null;

  const isLeading = gameState.trickPlays.length === 0;
  const canSubmit = canSubmitPlay(selectedCards, hand, gameState.trickPlays, trumpDeclaration);

  return (
    <div className="action-bar">
      <button
        className="action-btn play-btn"
        data-testid="play-btn"
        disabled={!canSubmit}
        onClick={onSubmitPlay}
      >
        {isLeading
          ? `出牌 (${selectedCards.length} 张)`
          : `跟牌 (${selectedCards.length}/${gameState.trickPlays[0].cards.length} 张)`}
      </button>
      <button
        className="action-btn clear-btn"
        data-testid="clear-btn"
        disabled={selectedCards.length === 0}
        onClick={onClearSelection}
      >
        重选
      </button>
    </div>
  );
};

export default ActionBar;
