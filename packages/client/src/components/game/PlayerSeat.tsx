import React from 'react';
import type { PlayerState } from '@poker/engine';

interface PlayerSeatProps {
  player: PlayerState;
  position: 'top' | 'left' | 'right';
  isActive: boolean;
}

const PlayerSeat: React.FC<PlayerSeatProps> = ({
  player,
  position,
  isActive,
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
      {/* 已出牌统一显示在中央区域（按玩家方位），座位旁不再重复显示；不画手牌示意图 */}
    </div>
  );
};

export default PlayerSeat;
