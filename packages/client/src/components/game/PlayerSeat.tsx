import React from 'react';
import type { PlayerState, Reveal } from '@poker/engine';
import { suitLabel, rankLabel } from '@poker/engine';

export interface FinalRevealChip {
  /** 小牌文字：有主 = 级牌+花色（如 2♠）；无主 = JO（大王）/ jo（小王） */
  label: string;
  /** 红字（♥♦ 与大王 JO） */
  red: boolean;
  /** 张数：对子亮主（含对王无主）显示两张，单张亮显示一张 */
  count: number;
}

/** 最终亮主小牌（替代原"主牌:"指示器）：只取当前生效的主（被反的不显示）。 */
export function finalRevealChip(reveal: Reveal, level: number): FinalRevealChip {
  const count = reveal.strength >= 2 ? 2 : 1;
  if (reveal.suit === null) {
    const big = reveal.strength >= 4;
    return { label: big ? 'JO' : 'jo', red: big, count };
  }
  return {
    label: `${rankLabel(level)}${suitLabel(reveal.suit)}`,
    red: reveal.suit === 'H' || reveal.suit === 'D',
    count,
  };
}

interface PlayerSeatProps {
  player: PlayerState;
  position: 'top' | 'left' | 'right';
  isActive: boolean;
  /** 最终亮主小牌（亮主玩家座位显示，与闲家得分同款 score-point 样式） */
  finalChip?: FinalRevealChip | null;
  /** 小牌相对座位框的位置：'below-right' = 框外右下（右对齐）；'right-top' = 框外右上（上对齐） */
  chipAlign?: 'below-right' | 'right-top';
}

const PlayerSeat: React.FC<PlayerSeatProps> = ({
  player,
  position,
  isActive,
  finalChip = null,
  chipAlign = 'below-right',
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
      {/* 最终亮主小牌在座位框外（不占框内布局）：右侧/左侧框外右下右对齐，顶部框外右上上对齐 */}
      {finalChip && (
        <div
          className={`final-reveal-chip align-${chipAlign}`}
          data-testid={`seat-final-reveal-${player.index}`}
        >
          {Array.from({ length: finalChip.count }, (_, i) => (
            <span
              key={i}
              className={`score-point${finalChip.red ? ' red' : ''}`}
            >
              {finalChip.label}
            </span>
          ))}
        </div>
      )}
      {/* 已出牌统一显示在中央区域（按玩家方位），座位旁不再重复显示；不画手牌示意图 */}
    </div>
  );
};

export default PlayerSeat;
