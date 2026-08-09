import React from 'react';
import type { GameState, Trick } from '@poker/engine';
import { GamePhase, suitLabel, rankLabel, suitName, isPointRank, cardPointsFromRank, computeRoundOutcome } from '@poker/engine';
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
              ? (() => {
                  // 对子亮主显示两个花色符号（如 ♣♣ 2）
                  const finalReveal = gameState.reveals[gameState.reveals.length - 1];
                  const isPair = !!finalReveal
                    && finalReveal.suit === trumpDeclaration.trumpSuit
                    && finalReveal.strength >= 2;
                  const s = suitLabel(trumpDeclaration.trumpSuit!);
                  return `${isPair ? s + s : s} ${rankLabel(trumpDeclaration.level)}`;
                })()
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

      {/* current trick — 按玩家方位布局（上/左/右/下），没出就空着；
          墩结算沿用同一方位（不新开框），中央显示赢家与得分 */}
      {phase === GamePhase.Playing && (() => {
        const isSettled = trickPlays.length === 0 && !!settledTrick;
        const plays = trickPlays.length > 0 ? trickPlays : (settledTrick ? settledTrick.plays : []);
        const leadIdx = trickPlays.length > 0
          ? gameState.leadPlayerIndex
          : (settledTrick?.leadPlayerIndex ?? gameState.leadPlayerIndex);
        return (
          <div className="trick-position-layout" data-testid="trick-position-layout">
            {([0, 1, 2, 3] as const).map(rel => {
              const pi = (localPlayerIndex + rel) % 4;
              const pos = ['bottom', 'right', 'top', 'left'][rel];
              const play = plays.find((p, j) => (leadIdx + j) % 4 === pi);
              return (
                <div key={rel} className={`trick-pos trick-pos-${pos}`}>
                  <div className="trick-pos-player">
                    {gameState.players[pi].name}
                    {isSettled && pi === settledTrick!.winnerIndex ? ' 👑' : ''}
                  </div>
                  <div className="trick-pos-cards">
                    {play ? play.cards.map(card => (
                      <CardFace key={card.id} card={card} size="small" />
                    )) : null}
                  </div>
                </div>
              );
            })}
            {isSettled && (
              <div className="trick-pos-center" data-testid="settled-center">
                {gameState.players[settledTrick!.winnerIndex].name} 赢 · {settledTrick!.points} 分
              </div>
            )}
          </div>
        );
      })()}

      {/* last trick review — 文字一行，按出牌顺序从左到右 */}
      {lastTrickReview && trickHistory.length > 0 && (() => {
        const last = trickHistory[trickHistory.length - 1];
        const cardText = (c: any) => c.isJoker
          ? (c.rank === 16 ? '大王' : '小王')
          : `${rankLabel(c.rank)}${suitLabel(c.suit)}`;
        return (
          <div className="last-trick-review">
            <div className="review-header">
              <span className="review-label">上一墩回顾</span>
              <button className="review-close-btn" onClick={onCloseReview}>✕ 关闭</button>
            </div>
            <div className="review-line" data-testid="review-line">
              {last.plays.map((play, i) => {
                const pi = (last.leadPlayerIndex + i) % 4;
                const isWinner = pi === last.winnerIndex;
                return (
                  <span key={i} className="review-seg">
                    {i > 0 && <span className="review-arrow">→</span>}
                    <span className={`review-name ${isWinner ? 'winner' : ''}`}>
                      {gameState.players[pi].name}{isWinner ? '👑' : ''}
                    </span>
                    <span className="review-cards-text">
                      {play.cards.map(c => cardText(c)).join(' ')}
                    </span>
                  </span>
                );
              })}
              <span className="review-points">得分: {last.points}</span>
            </div>
          </div>
        );
      })()}

      {/* bottom cards — 局末中央展示底牌 + 底牌分×抠底倍率（庄家保底倍率 0） */}
      {phase === GamePhase.RoundEnd && (() => {
        const declarerIdx = gameState.trumpDeclaration?.declarerIndex ?? gameState.declarerIndex;
        const lastTrick = trickHistory[trickHistory.length - 1] ?? null;
        const outcome = computeRoundOutcome(
          attackerPoints, bottomCards, lastTrick, trumpDeclaration, declarerIdx,
        );
        const effMult = outcome.attackerWonLast ? outcome.multiplier : 0; // 庄家保底 → 0
        return (
          <div className="bottom-reveal" data-testid="bottom-reveal">
            <div className="bottom-label">
              底牌 ({bottomCards.length}张) — 底牌 {outcome.bottomPoints} 分 ×{effMult}
              {effMult === 0 ? '（庄家保底）' : '（闲家抠底）'}
            </div>
            <div className="bottom-cards">
              {bottomCards.map(card => (
                <CardFace key={card.id} card={card} size="small" />
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default CenterArea;
