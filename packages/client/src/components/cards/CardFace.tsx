import React from 'react';
import type { Card } from '@poker/engine';
import { rankLabel, suitLabel, isRed } from '@poker/engine';
import './CardFace.css';

interface CardFaceProps {
  card: Card;
  selected?: boolean;
  disabled?: boolean;
  highlighted?: boolean;
  onClick?: () => void;
  size?: 'small' | 'medium' | 'large';
  faceDown?: boolean;
}

const CardFace: React.FC<CardFaceProps> = ({
  card,
  selected = false,
  disabled = false,
  highlighted = false,
  onClick,
  size = 'medium',
  faceDown = false,
}) => {
  if (faceDown) {
    return (
      <div className={`card card-back size-${size}`} data-card-id={card.id}>
        <div className="card-back-pattern">🂠</div>
      </div>
    );
  }

  const red = isRed(card);
  const rank = rankLabel(card.rank);
  const suit = suitLabel(card.suit);
  const isJoker = card.isJoker;

  const displaySuit = isJoker ? '' : suit;

  return (
    <div
      className={[
        'card',
        `size-${size}`,
        red ? 'red' : 'black',
        selected ? 'selected' : '',
        disabled ? 'disabled' : '',
        highlighted ? 'highlighted' : '',
        isJoker ? 'joker-card' : '',
      ].filter(Boolean).join(' ')}
      data-card-id={card.id}
      onClick={disabled ? undefined : onClick}
    >
      <div className="card-corner top-left">
        <span className="card-rank">{rank}</span>
        {!isJoker && <span className="card-suit">{suit}</span>}
      </div>
      <div className="card-center">
        {isJoker ? (
          <span className={`card-joker-icon ${red ? 'red' : 'black'}`}>
            {card.rank === 16 ? '🃏' : '🃏'}
          </span>
        ) : (
          <span className="card-suit-large">{suit}</span>
        )}
      </div>
      <div className="card-corner bottom-right">
        <span className="card-rank">{rank}</span>
        {!isJoker && <span className="card-suit">{suit}</span>}
      </div>
    </div>
  );
};

export default CardFace;
