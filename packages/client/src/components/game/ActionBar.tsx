import React from 'react';
import type { GameState } from '@poker/engine';
import { GamePhase } from '@poker/engine';

interface ActionBarProps {
  gameState: GameState;
  localPlayerIndex: number;
  selectedCardCount: number;
  isHuman: boolean;
  onSubmitPlay: () => void;
  onClearSelection: () => void;
}

const ActionBar: React.FC<ActionBarProps> = ({
  gameState,
  localPlayerIndex,
  selectedCardCount,
  isHuman,
  onSubmitPlay,
  onClearSelection,
}) => {
  if (gameState.phase !== GamePhase.Playing) return null;
  if (gameState.currentPlayerIndex !== localPlayerIndex) return null;
  if (!isHuman) return null;

  const isLeading = gameState.trickPlays.length === 0;

  return (
    <div className="action-bar">
      <button
        className="action-btn play-btn"
        disabled={selectedCardCount === 0}
        onClick={onSubmitPlay}
      >
        {isLeading ? '出牌' : '跟牌'} ({selectedCardCount} 张)
      </button>
      <button
        className="action-btn clear-btn"
        disabled={selectedCardCount === 0}
        onClick={onClearSelection}
      >
        重选
      </button>
    </div>
  );
};

export default ActionBar;
