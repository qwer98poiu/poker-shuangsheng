import React from 'react';
import type { GameState, Trick } from '@poker/engine';
import { GamePhase, suitLabel, rankLabel, suitName, isPointRank, cardPointsFromRank } from '@poker/engine';
import CardFace from '../cards/CardFace.js';
import { useGameStore } from '../../store/gameStore.js';

interface CenterAreaProps {
  gameState: GameState;
  lastTrickReview: boolean;
  onCloseReview: () => void;
  /** 上一墩结算显示（第四家出牌后保留到下一墩第一张牌出现）。 */
  settledTrick?: Trick | null;
}

const CenterArea: React.FC<CenterAreaProps> = ({ gameState, lastTrickReview, onCloseReview, settledTrick = null }) => {
  const localPlayerIndex = useGameStore(s => s.localPlayerIndex);
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

      {/* current trick — 按玩家方位布局（上/左/右/下），没出就空着 */}
      {phase === GamePhase.Playing && (
        <div className="trick-position-layout" data-testid="trick-position-layout">
          {([0, 1, 2, 3] as const).map(rel => {
            const pi = (localPlayerIndex + rel) % 4;
            const pos = ['bottom', 'right', 'top', 'left'][rel];
            const play = trickPlays.find((p, j) => (gameState.leadPlayerIndex + j) % 4 === pi);
            return (
              <div key={rel} className={`trick-pos trick-pos-${pos}`}>
                <div className="trick-pos-player">{gameState.players[pi].name}</div>
                <div className="trick-pos-cards">
                  {play ? play.cards.map(card => (
                    <CardFace key={card.id} card={card} size="small" />
                  )) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* settled trick — 第四家出牌后保留显示到下一墩第一张牌出现 */}
      {settledTrick && phase === GamePhase.Playing && trickPlays.length === 0 && (
        <div className="settled-trick" data-testid="settled-trick">
          <div className="settled-label">本墩结算</div>
          {settledTrick.plays.map((play, i) => {
            const pi = (settledTrick.leadPlayerIndex + i) % 4;
            return (
              <div key={i} className="settled-play">
                <span className="settled-player">
                  {gameState.players[pi].name} {pi === settledTrick.winnerIndex ? '👑' : ''}
                </span>
                <div className="settled-cards">
                  {play.cards.map(card => (
                    <CardFace key={card.id} card={card} size="small" />
                  ))}
                </div>
              </div>
            );
          })}
          <div className="settled-points">得分: {settledTrick.points}</div>
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
