import React from 'react';
import type { Card } from '@poker/engine';
import CardFace from '../cards/CardFace.js';

interface PlayerHandProps {
  cards: Card[];
  selectedIds: string[];
  highlightedIds: string[];
  onSelectCard: (id: string) => void;
  onDeselectCard: (id: string) => void;
  isActive: boolean;
  playerName: string;
  isHuman: boolean;
}

const PlayerHand: React.FC<PlayerHandProps> = ({
  cards,
  selectedIds,
  highlightedIds,
  onSelectCard,
  onDeselectCard,
  isActive,
  playerName,
  isHuman,
}) => {
  const handleCardClick = (id: string) => {
    if (!isActive || !isHuman) return;
    selectedIds.includes(id) ? onDeselectCard(id) : onSelectCard(id);
  };

  return (
    <div className="player-hand-container">
      <div className="player-hand-label">
        {playerName} {isActive ? '← 当前' : ''} ({cards.length} 张)
      </div>
      <div className="player-hand-cards">
        {cards.map((card, i) => (
          <div
            key={card.id}
            className="hand-card-wrapper"
            style={{ marginLeft: i > 0 ? '-28px' : '0', zIndex: i }}
          >
            <CardFace
              card={card}
              size={isHuman ? 'medium' : 'small'}
              selected={selectedIds.includes(card.id)}
              highlighted={highlightedIds.includes(card.id)}
              disabled={!isActive || !isHuman}
              onClick={() => handleCardClick(card.id)}
              faceDown={!isHuman}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default PlayerHand;
