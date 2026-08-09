import React from 'react';
import type { GameState } from '@poker/engine';
import { GamePhase, suitLabel, rankLabel, suitName, isPointRank, cardPointsFromRank } from '@poker/engine';
import CardFace from '../cards/CardFace.js';

interface CenterAreaProps {
  gameState: GameState;
  lastTrickReview: boolean;
  onCloseReview: () => void;
}

const CenterArea: React.FC<CenterAreaProps> = ({ gameState, lastTrickReview, onCloseReview }) => {
  const { phase, trumpDeclaration, attackerPoints, currentLevel, trickPlays, bottomCards, trickHistory } = gameState;

  const getPhaseText = () => {
    if (phase === GamePhase.Dealing) return '🔄 发牌中...';
    if (phase === GamePhase.Revealing) return '🃏 亮主阶段';
    if (phase === GamePhase.Playing) return '🎯 出牌阶段';
    if (phase === GamePhase.RoundEnd) return '🏆 本局结束';
    return '';
  };

  return (
    <div className="center-area">
      <div className="phase-banner" data-testid="phase-banner">{getPhaseText()}</div>

      {trumpDeclaration && (
        <div className="trump-indicator" data-testid="trump-indicator">
          <span className="trump-label">主牌:</span>
          <span className="trump-value">
            {trumpDeclaration.trumpSuit
              ? `${suitLabel(trumpDeclaration.trumpSuit)} ${rankLabel(trumpDeclaration.level)}`
              : `无主 (${rankLabel(trumpDeclaration.level)})`}
          </span>
          <span className="declarer-label" data-testid="declarer-label">
            庄家: {gameState.players[trumpDeclaration.declarerIndex].name}
          </span>
        </div>
      )}

      <div className="score-display" data-testid="score-display">
        <span className="score-item">级别: {rankLabel(currentLevel)}</span>
        <span className="score-item">闲家得分: {attackerPoints}</span>
        <span className="score-item">墩数: {gameState.tricksPlayed}/25</span>
      </div>

      {/* played point cards collected by attacker */}
      {trickHistory.length > 0 && (
        <div className="point-collection">
          {(() => {
            const declarerIdx = gameState.trumpDeclaration?.declarerIndex ?? gameState.declarerIndex;
            const attackerTeam = declarerIdx % 2 === 0 ? 1 : 0;
            const allPointCards = trickHistory
              .filter(t => t.points > 0 && t.winnerIndex % 2 === attackerTeam)
              .flatMap(t => t.plays.flatMap(p => p.cards))
              .filter(c => isPointRank(c.rank));
            if (allPointCards.length === 0) return null;
            return (
              <>
                <div className="point-label">闲家已得分牌 ({allPointCards.length}张):</div>
                <div className="point-cards">
                  {allPointCards.map((c, i) => (
                    <CardFace key={`${c.id}-${i}`} card={c} size="small" />
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* current trick */}
      {trickPlays.length > 0 && phase === GamePhase.Playing && (
        <div className="trick-display">
          <div className="trick-label">当前牌局</div>
          <div className="trick-cards">
            {trickPlays.map((play, i) => (
              <div key={i} className="trick-play-slot">
                <div className="trick-player-label">
                  {gameState.players[(gameState.leadPlayerIndex + i) % 4].name}
                </div>
                <div className="trick-cards-row">
                  {play.cards.map(card => (
                    <CardFace key={card.id} card={card} size="small" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* last trick review */}
      {lastTrickReview && trickHistory.length > 0 && (() => {
        const last = trickHistory[trickHistory.length - 1];
        return (
          <div className="last-trick-review">
            <div className="review-header">
              <span className="review-label">上一墩回顾</span>
              <button className="review-close-btn" onClick={onCloseReview}>✕ 关闭</button>
            </div>
            {last.plays.map((play, i) => {
              const pi = (last.leadPlayerIndex + i) % 4;
              const isWinner = pi === last.winnerIndex;
              return (
                <div key={i} className={`review-play ${isWinner ? 'winner-play' : ''}`}>
                  <span className="review-player">
                    {gameState.players[pi].name} {isWinner ? '👑' : ''}
                  </span>
                  <div className="review-cards">
                    {play.cards.map(c => (
                      <CardFace key={c.id} card={c} size="small" highlighted={isWinner} />
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="review-points">得分: {last.points}</div>
          </div>
        );
      })()}

      {/* bottom cards */}
      {phase === GamePhase.RoundEnd && (
        <div className="bottom-reveal">
          <div className="bottom-label">底牌 (8张) — 分数翻倍</div>
          <div className="bottom-cards">
            {bottomCards.map(card => (
              <CardFace key={card.id} card={card} size="small" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CenterArea;
