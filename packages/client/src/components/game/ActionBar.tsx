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
  isReviewing: boolean;
  onSubmitPlay: () => void;
  onToggleReview: () => void;
}

const ActionBar: React.FC<ActionBarProps> = ({
  gameState,
  localPlayerIndex,
  selectedCards,
  hand,
  trumpDeclaration,
  isHuman,
  isReviewing,
  onSubmitPlay,
  onToggleReview,
}) => {
  if (gameState.phase !== GamePhase.Playing) return null;
  if (gameState.currentPlayerIndex !== localPlayerIndex) return null;
  if (!isHuman) return null;

  const isLeading = gameState.trickPlays.length === 0;
  const canSubmit = canSubmitPlay(selectedCards, hand, gameState.trickPlays, trumpDeclaration);
  // 第 1 墩（本局尚无已出墩）不显示回看按钮
  const canReview = gameState.trickHistory.length > 0;

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
      {canReview && (
        <button
          className="action-btn review-btn"
          data-testid="review-btn"
          onClick={onToggleReview}
        >
          {isReviewing ? '隐藏回看' : '回看上墩'}
        </button>
      )}
    </div>
  );
};

export default ActionBar;
