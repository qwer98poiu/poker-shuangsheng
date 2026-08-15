import React from 'react';
import type { Card, GameState, TrumpDeclaration } from '@poker/engine';
import { GamePhase } from '@poker/engine';
import { canSubmitPlay, bottomExchangeStatus } from './playable.js';

interface ActionBarProps {
  gameState: GameState;
  localPlayerIndex: number;
  selectedCards: Card[];
  hand: Card[];
  trumpDeclaration: TrumpDeclaration | null;
  isHuman: boolean;
  isReviewing: boolean;
  onSubmitPlay: () => void;
  onSubmitBottomExchange: () => void;
  onToggleReview: () => void;
}

/**
 * 主要按键区 — 出牌阶段与庄家扣底阶段共用同一槽位/样式：
 * - 出牌：左边 出牌/跟牌，右边 回看上墩（第 1 墩灰色）
 * - 扣底：左边 扣底 (x/8)，右边 回看上墩（灰色不可选）；选不满 8 张扣底键灰色；
 *   所选含主牌时扣底键变黄 + 下方小字警告（不设二次确认，点击直接扣）
 */
const ActionBar: React.FC<ActionBarProps> = ({
  gameState,
  localPlayerIndex,
  selectedCards,
  hand,
  trumpDeclaration,
  isHuman,
  isReviewing,
  onSubmitPlay,
  onSubmitBottomExchange,
  onToggleReview,
}) => {
  const isBottomExchange = gameState.phase === GamePhase.BottomExchange;
  if (gameState.phase !== GamePhase.Playing && !isBottomExchange) return null;
  if (isBottomExchange) {
    if (gameState.trumpDeclaration?.declarerIndex !== localPlayerIndex) return null;
  } else {
    if (gameState.currentPlayerIndex !== localPlayerIndex) return null;
  }
  if (!isHuman) return null;

  // 扣底阶段无已出墩（回看上墩恒灰）；出牌阶段第 1 墩（本局尚无已出墩）灰色不可点
  const canReview = gameState.trickHistory.length > 0;

  if (isBottomExchange) {
    const { canSubmit, trumpCount } = bottomExchangeStatus(selectedCards, trumpDeclaration);
    return (
      <div className="action-bar-wrap">
        <div className="action-bar">
          <button
            className={`action-btn play-btn${trumpCount > 0 ? ' trump-warn-btn' : ''}`}
            data-testid="bottom-confirm"
            disabled={!canSubmit}
            onClick={onSubmitBottomExchange}
          >
            扣底 ({selectedCards.length}/8)
          </button>
          <button
            className="action-btn review-btn"
            data-testid="review-btn"
            disabled={!canReview}
            onClick={onToggleReview}
          >
            {isReviewing ? '隐藏回看' : '回看上墩'}
          </button>
        </div>
        {trumpCount > 0 && (
          <div className="action-warn" data-testid="bottom-trump-warn">
            ⚠️ 选了{trumpCount}张主牌
          </div>
        )}
      </div>
    );
  }

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
        className="action-btn review-btn"
        data-testid="review-btn"
        disabled={!canReview}
        onClick={onToggleReview}
      >
        {isReviewing ? '隐藏回看' : '回看上墩'}
      </button>
    </div>
  );
};

export default ActionBar;
