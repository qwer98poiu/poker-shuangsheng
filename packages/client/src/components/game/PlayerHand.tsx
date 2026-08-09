import React, { useRef } from 'react';
import type { Card } from '@poker/engine';
import CardFace from '../cards/CardFace.js';

interface PlayerHandProps {
  cards: Card[];
  selectedIds: string[];
  highlightedIds: string[];
  /** null = 全部可选；非 null = 仅这些牌可出（其余灰色不可选） */
  playableIds?: Set<string> | null;
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
  playableIds = null,
  onSelectCard,
  onDeselectCard,
  isActive,
  playerName,
  isHuman,
}) => {
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  // 拖拽结束时吞掉随后的 click（防止 mouseup 在卡上触发 toggle）；
  // 只有真正位移（超过阈值）才算拖拽，单击（mousedown+mouseup 无位移）不吞
  const dragMovedRef = useRef(false);
  const suppressClickRef = useRef(false);

  const handleCardClick = (id: string) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (!isActive || !isHuman) return;
    if (playableIds && !playableIds.has(id)) return; // 灰色牌不可选
    selectedIds.includes(id) ? onDeselectCard(id) : onSelectCard(id);
  };

  /** 拖拽框选：轨迹矩形覆盖的牌全部选中 */
  const handleMouseDown = (e: React.MouseEvent) => {
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragMovedRef.current = false;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const start = dragStartRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // 误触阈值
    dragMovedRef.current = true; // 真正拖拽（单击的 mousedown+mouseup 无位移）
    if (!isActive || !isHuman) return;
    const x1 = Math.min(start.x, e.clientX), x2 = Math.max(start.x, e.clientX);
    const y1 = Math.min(start.y, e.clientY), y2 = Math.max(start.y, e.clientY);
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      const card = cards[i];
      if (selectedIds.includes(card.id)) return;
      if (playableIds && !playableIds.has(card.id)) return; // 灰色不可拖选
      const r = el.getBoundingClientRect();
      if (r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) {
        onSelectCard(card.id);
      }
    });
  };

  const handleMouseUp = () => {
    if (dragMovedRef.current) suppressClickRef.current = true; // 仅拖拽后吞 click
    dragMovedRef.current = false;
    dragStartRef.current = null;
  };

  return (
    <div className="player-hand-container" onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      <div className="player-hand-label">
        {playerName} {isActive ? '← 当前' : ''} ({cards.length} 张)
      </div>
      <div className="player-hand-cards">
        {cards.map((card, i) => (
          <div
            key={card.id}
            ref={el => { cardRefs.current[i] = el; }}
            className="hand-card-wrapper"
            style={{ marginLeft: i > 0 ? '-34px' : '0', zIndex: i }}
          >
            <CardFace
              card={card}
              size={isHuman ? 'medium' : 'small'}
              selected={selectedIds.includes(card.id)}
              highlighted={highlightedIds.includes(card.id)}
              disabled={!isActive || !isHuman || (playableIds !== null && !playableIds.has(card.id))}
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
