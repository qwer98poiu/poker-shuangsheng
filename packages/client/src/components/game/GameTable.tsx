import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore.js';
import { GamePhase, sortHand, Suit, suitLabel, rankLabel, isTrump } from '@poker/engine';
import PlayerHand from './PlayerHand.js';
import PlayerSeat from './PlayerSeat.js';
import CenterArea from './CenterArea.js';
import ActionBar from './ActionBar.js';
import './GameTable.css';

const GameTable: React.FC = () => {
  const {
    gameState, localPlayerIndex, selectedCardIds, debug,
    message, errorMessage, lastTrickReview, highlightedCards,
    humanCanReveal,
    selectCard, deselectCard, clearSelection,
    submitPlay, submitBottomExchange,
    humanReveal, humanPassReveal,
    toggleLastTrickReview, getHint,
  } = useGameStore();

  const [trumpConfirm, setTrumpConfirm] = useState(false);

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
  const isMyTurn = gameState.currentPlayerIndex === localPlayerIndex;
  const isDeclarer = gameState.trumpDeclaration?.declarerIndex === localPlayerIndex;

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
          <CenterArea gameState={gameState} lastTrickReview={lastTrickReview} onCloseReview={toggleLastTrickReview} />
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

      {/* reveal panel for humans */}
      {isRevealing && humanCanReveal && localPlayer.isHuman && (
        <div className="reveal-panel">
          <span className="reveal-hint">亮主：点选花色（或选无主）</span>
          {([Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds] as Suit[]).map(suit => {
            const hasLevel = localPlayer.hand.filter(c => c.suit === suit && c.rank === gameState.currentLevel);
            return (
              <button
                key={suit}
                className="reveal-btn"
                disabled={hasLevel.length === 0}
                onClick={() => humanReveal(suit)}
              >
                {suitLabel(suit)} {rankLabel(gameState.currentLevel)}
                {hasLevel.length >= 2 ? ' (对)' : ''}
              </button>
            );
          })}
          <button className="reveal-btn reveal-nt" onClick={() => humanReveal(null)}>
            无主 🃏
          </button>
          <button className="reveal-pass-btn" onClick={humanPassReveal}>不亮</button>
        </div>
      )}

      {/* bottom exchange panel */}
      {isDeclarer && gameState.players[localPlayerIndex].hand.length === 33 && isPlaying && (
        <div className="bottom-exchange">
          <span>扣底：选 8 张手牌放入底牌 (已选 {selectedCardIds.length}/8)</span>
          {trumpConfirm ? (
            <div className="trump-warning">
              <span>⚠️ 含主牌，确定扣入？</span>
              <button className="action-btn play-btn" onClick={() => { setTrumpConfirm(false); submitBottomExchange(); }}>确认扣主</button>
              <button className="action-btn cancel-btn" onClick={() => setTrumpConfirm(false)}>取消</button>
            </div>
          ) : (
            <button
              className="action-btn play-btn"
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

      {/* debug controls */}
      {debug && (
        <div className="debug-bar">
          <button className="debug-btn" onClick={toggleLastTrickReview}>
            {lastTrickReview ? '隐藏' : '回看'}上轮
          </button>
          <button className="debug-btn" onClick={getHint}>
            💡 提示
          </button>
          {isMyTurn && localPlayer.isHuman && (
            <button className="debug-btn" onClick={getHint}>
              🤖 建议出牌
            </button>
          )}
          {gameState.aiReasons.length > 0 && (
            <details className="ai-log">
              <summary>AI 日志 ({gameState.aiReasons.length})</summary>
              <div className="ai-log-content">
                {[...gameState.aiReasons].reverse().map((r, i) => (
                  <div key={i} className="ai-log-entry">
                    <strong>P{r.playerIndex + 1}</strong> [{r.phase}]
                    <span className="ai-reason">{r.reason}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* local player hand */}
      <div className="table-bottom">
        <PlayerHand
          cards={displayHand}
          selectedIds={selectedCardIds}
          highlightedIds={highlightedCards}
          onSelectCard={selectCard}
          onDeselectCard={deselectCard}
          isActive={isMyTurn && (isPlaying || (isDeclarer && gameState.players[localPlayerIndex].hand.length === 33))}
          playerName={localPlayer.name}
          isHuman={localPlayer.isHuman}
        />
      </div>
    </div>
  );
};

export default GameTable;
