import React, { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore.js';
import { GamePhase, sortHand, Suit, suitLabel, rankLabel, isTrump, getRevealOptions, canOverride, computeRoundOutcome, advanceLevel } from '@poker/engine';
import CardFace from '../cards/CardFace.js';
import PlayerHand from './PlayerHand.js';
import PlayerSeat from './PlayerSeat.js';
import CenterArea from './CenterArea.js';
import ActionBar from './ActionBar.js';
import { computePlayableIds } from './playable.js';
import './GameTable.css';

const GameTable: React.FC = () => {
  const {
    gameState, localPlayerIndex, selectedCardIds, debug,
    message, errorMessage, lastTrickReview, highlightedCards,
    selectCard, deselectCard, clearSelection,
    submitPlay, submitBottomExchange,
    humanReveal, humanPassReveal,
    toggleLastTrickReview, getHint,
    aiPlayers, teamLevels, matchOver, settledTrick,
  } = useGameStore();

  const [trumpConfirm, setTrumpConfirm] = useState(false);

  // 亮主自动确认：能亮/反主 → 3 秒后自动确认；不能亮/反 → 1 秒后自动（无需人类操作）。
  // 人类点击亮主后 humanReveal 直接 finalize，phase 变化触发 cleanup。
  useEffect(() => {
    const gs = gameState;
    if (gs?.phase !== GamePhase.Revealing || aiPlayers.every(Boolean) || !gs.players[0].isHuman) return;
    const opts = getRevealOptions(gs.players[0].hand, gs.currentLevel)
      .filter(o => canOverride(gs.currentReveal, {
        playerIndex: 0, suit: o.suit, strength: o.strength,
      }));
    const delay = opts.length > 0 ? 3000 : 1000;
    const t = setTimeout(() => humanPassReveal(), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.phase, gameState?.currentReveal, gameState?.currentLevel, aiPlayers]);

  if (!gameState) return null;

  const getUIPosition = (gameIndex: number): 'top' | 'left' | 'right' => {
    const relative = (gameIndex - localPlayerIndex + 4) % 4;
    switch (relative) {
      case 1: return 'right';
      case 2: return 'top';
      case 3: return 'left';
      default: return 'top';
    }
  };

  const localPlayer = gameState.players[localPlayerIndex];
  const otherPlayers = [0, 1, 2, 3].filter(i => i !== localPlayerIndex);

  const isPlaying = gameState.phase === GamePhase.Playing;
  const isRevealing = gameState.phase === GamePhase.Revealing;
  const isBottomExchange = gameState.phase === GamePhase.BottomExchange;
  const isMyTurn = gameState.currentPlayerIndex === localPlayerIndex;
  const isDeclarer = gameState.trumpDeclaration?.declarerIndex === localPlayerIndex;
  const isSpectator = aiPlayers.every(Boolean);

  const getPlayedForPlayer = (playerIndex: number) => {
    const idx = gameState.trickPlays.findIndex(p => {
      const playIdx = gameState.trickPlays.indexOf(p);
      const pi = (gameState.leadPlayerIndex + playIdx) % 4;
      return pi === playerIndex;
    });
    if (idx >= 0) return gameState.trickPlays[idx];
    return null;
  };

  // sorted hand for display
  const displayHand = sortHand(localPlayer.hand, gameState.trumpDeclaration);

  // 可出牌集合：不符合规则的牌灰色不可选（见 playable.ts）
  const playableIds = computePlayableIds(
    localPlayer.hand, gameState.trickPlays, gameState.trumpDeclaration, gameState.phase,
  );

  return (
    <div className="game-table">
      {/* top section: partner + opponents */}
      <div className="table-top">
        {otherPlayers.map(idx => {
          if (getUIPosition(idx) !== 'top') return null;
          return (
            <PlayerSeat
              key={idx}
              player={gameState.players[idx]}
              position="top"
              isActive={gameState.currentPlayerIndex === idx}
              playedCards={getPlayedForPlayer(idx)}
            />
          );
        })}
      </div>

      {/* middle row */}
      <div className="table-middle">
        <div className="table-left">
          {otherPlayers.map(idx => {
            if (getUIPosition(idx) !== 'left') return null;
            return (
              <PlayerSeat
                key={idx}
                player={gameState.players[idx]}
                position="left"
                isActive={gameState.currentPlayerIndex === idx}
                playedCards={getPlayedForPlayer(idx)}
              />
            );
          })}
        </div>

        <div className="table-center">
          <CenterArea
            gameState={gameState}
            lastTrickReview={lastTrickReview}
            onCloseReview={toggleLastTrickReview}
            settledTrick={settledTrick}
          />
        </div>

        <div className="table-right">
          {otherPlayers.map(idx => {
            if (getUIPosition(idx) !== 'right') return null;
            return (
              <PlayerSeat
                key={idx}
                player={gameState.players[idx]}
                position="right"
                isActive={gameState.currentPlayerIndex === idx}
                playedCards={getPlayedForPlayer(idx)}
              />
            );
          })}
        </div>
      </div>

      {/* message */}
      <div className="table-message">
        {errorMessage && <span className="error-msg">❌ {errorMessage}</span>}
        {!errorMessage && <span className="info-msg">{message}</span>}
      </div>

      {/* reveal panel for humans — dealing & reveal phases; 亮主即确认 */}
      {(isRevealing || gameState.phase === GamePhase.Dealing) && !isSpectator && localPlayer.isHuman && (() => {
        const opts = getRevealOptions(localPlayer.hand, gameState.currentLevel)
          .filter(o => canOverride(gameState.currentReveal, {
            playerIndex: localPlayerIndex, suit: o.suit, strength: o.strength,
          }));
        return (
          <div className="reveal-panel" data-testid="reveal-panel">
            <span className="reveal-hint">
              {gameState.currentReveal
                ? `当前: ${gameState.currentReveal.suit ? suitLabel(gameState.currentReveal.suit) + rankLabel(gameState.currentLevel) : '无主'}${opts.length > 0 ? '（可反主）' : '（不可反）'}`
                : '亮主：点选花色（或选无主）'}
            </span>
            {opts.map(o => (
              <button
                key={o.suit ?? 'NT'}
                className={`reveal-btn ${o.suit === null ? 'reveal-nt' : ''}`}
                data-testid={`reveal-btn-${o.suit ?? 'NT'}`}
                onClick={() => humanReveal(o.suit)}
              >
                {o.suit === null ? '无主 🃏' : `${suitLabel(o.suit)} ${rankLabel(gameState.currentLevel)}${o.strength >= 2 ? ' (对)' : ''}`}
              </button>
            ))}
            {opts.length === 0 && (
              <span className="reveal-wait">
                {isRevealing ? '（无可亮/反选项，即将开始）' : '（发牌中，可亮主/反主）'}
              </span>
            )}
          </div>
        );
      })()}

      {/* bottom exchange panel — human declarer, 33-card hand */}
      {isBottomExchange && isDeclarer && localPlayer.isHuman && (
        <div className="bottom-exchange" data-testid="bottom-exchange">
          <span>扣底：选 8 张手牌放入底牌 (已选 {selectedCardIds.length}/8)</span>
          {trumpConfirm ? (
            <div className="trump-warning">
              <span>⚠️ 含主牌，确定扣入？</span>
              <button className="action-btn play-btn" data-testid="trump-confirm" onClick={() => { setTrumpConfirm(false); submitBottomExchange(); }}>确认扣主</button>
              <button className="action-btn cancel-btn" onClick={() => setTrumpConfirm(false)}>取消</button>
            </div>
          ) : (
            <button
              className="action-btn play-btn"
              data-testid="bottom-confirm"
              disabled={selectedCardIds.length !== 8}
              onClick={() => {
                const declarer = gameState.players[localPlayerIndex];
                const selCards = declarer.hand.filter(c => selectedCardIds.includes(c.id));
                if (gameState.trumpDeclaration && selCards.some(c => isTrump(c, gameState.trumpDeclaration!))) {
                  setTrumpConfirm(true);
                } else {
                  submitBottomExchange();
                }
              }}
            >
              确认扣底 ({selectedCardIds.length}/8)
            </button>
          )}
        </div>
      )}

      {/* action bar */}
      {isPlaying && isMyTurn && localPlayer.isHuman && (
        <ActionBar
          gameState={gameState}
          localPlayerIndex={localPlayerIndex}
          selectedCardCount={selectedCardIds.length}
          isHuman={localPlayer.isHuman}
          onSubmitPlay={submitPlay}
          onClearSelection={clearSelection}
        />
      )}

      {/* round-end settlement panel — same wording as CLI showRoundResult */}
      {gameState.phase === GamePhase.RoundEnd && (() => {
        const declarerIdx = gameState.trumpDeclaration?.declarerIndex ?? gameState.declarerIndex;
        const lastTrick = gameState.trickHistory[gameState.trickHistory.length - 1] ?? null;
        const outcome = computeRoundOutcome(
          gameState.attackerPoints, gameState.bottomCards, lastTrick,
          gameState.trumpDeclaration, declarerIdx,
        );
        const advancingTeam = outcome.attackerSits ? (declarerIdx + 1) % 2 : declarerIdx % 2;
        const adv = advanceLevel(teamLevels[advancingTeam], outcome.finalPts);
        const verdict = matchOver
          ? '🏆 庄家队在 A 打赢，胜出！'
          : outcome.attackerSits
            ? `闲家上台（${adv.newLevel > teamLevels[advancingTeam] ? `+${adv.newLevel - teamLevels[advancingTeam]} 级` : '不升级'}）`
            : outcome.changes.defenderChange === 3 ? '大光！庄家 +3 级'
            : outcome.changes.defenderChange === 2 ? '小光！庄家 +2 级'
            : '庄家保级 +1 级';
        return (
          <div className="round-result" data-testid="round-result">
            <div className="round-verdict">{verdict}</div>
            <div className="round-detail">
              <span>闲家得分: {outcome.finalPts}</span>
              {outcome.bottomPoints > 0 && (
                <span>底牌 {outcome.bottomPoints} 分 ×{outcome.multiplier}
                  {outcome.attackerWonLast ? '（闲家抠底）' : ''}
                </span>
              )}
              {matchOver && <span>胜方: {declarerIdx % 2 === 0 ? '玩家1/AI-3' : 'AI-2/AI-4'} 队</span>}
            </div>
            <div className="round-bottom">
              <span className="bottom-label">底牌 (8张)</span>
              <div className="bottom-cards">
                {gameState.bottomCards.map(card => (
                  <CardFace key={card.id} card={card} size="small" />
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* debug controls */}
      {debug && (
        <div className="debug-bar">
          <button className="debug-btn" onClick={toggleLastTrickReview}>
            {lastTrickReview ? '隐藏' : '回看'}上轮
          </button>
          <button className="debug-btn" onClick={getHint} data-testid="hint-btn">
            🤖 建议出牌（直接选中）
          </button>
          {gameState.aiReasons.length > 0 && (
            <details className="ai-log">
              <summary>AI 日志 ({gameState.aiReasons.length})</summary>
              <div className="ai-log-content">
                {[...gameState.aiReasons].reverse().map((r, i) => (
                  <div key={i} className="ai-log-entry">
                    <strong>{gameState.players[r.playerIndex].name}</strong> [{r.phase}]
                    <span className="ai-reason">{r.reason}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* spectator banner */}
      {isSpectator && (
        <div className="spectator-banner" data-testid="spectator-banner">👀 观战模式</div>
      )}

      {/* local player hand — hidden in spectator mode */}
      <div className="table-bottom">
        {!isSpectator && (
          <PlayerHand
            cards={displayHand}
            selectedIds={selectedCardIds}
            highlightedIds={highlightedCards}
            playableIds={playableIds}
            onSelectCard={selectCard}
            onDeselectCard={deselectCard}
            isActive={isMyTurn && (isPlaying || isBottomExchange)}
            playerName={localPlayer.name}
            isHuman={localPlayer.isHuman}
          />
        )}
      </div>
    </div>
  );
};

export default GameTable;
