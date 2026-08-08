import React from 'react';
import type { Card, PlayerState, PlayedCards } from '@poker/engine';
import CardFace from '../cards/CardFace.js';

interface PlayerSeatProps {
  player: PlayerState;
  position: 'top' | 'left' | 'right';
  isActive: boolean;
  playedCards: PlayedCards | null;
}

const positionLabels: Record<string, string> = {
  top: 'partner-label',
  left: 'left-label',
  right: 'right-label',
};

const PlayerSeat: React.FC<PlayerSeatProps> = ({
  player,
  position,
  isActive,
  playedCards,
}) => {
  return (
    <div
      className={`player-seat seat-${position} ${isActive ? 'active-seat' : ''}`}
      data-testid={`seat-${player.index}`}
    >
      <div className="player-info">
        <span className="player-name">{player.name}</span>
        <span className="player-card-count">({player.hand.length} 张)</span>
      </div>

      {/* played cards area */}
      {playedCards && (
        <div className="seat-played-cards">
          {playedCards.cards.map(card => (
            <CardFace key={card.id} card={card} size="small" />
          ))}
        </div>
      )}

      {/* face-down hand representation */}
      {!player.isHuman && (
        <div className="seat-hand-fan">
          {player.hand.slice(0, 8).map((_, i) => (
            <div
              key={i}
              className="seat-card-back"
              style={{
                marginLeft: i > 0 ? '-28px' : '0',
                transform: `rotate(${(i - 3) * 3}deg)`,
              }}
            >
              <CardFace card={player.hand[0]} faceDown size="small" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PlayerSeat;
