import React, { useRef, useState } from 'react';
import type { Card } from '@poker/engine';
import CardFace from '../cards/CardFace.js';
import {
  applyGroupClick, applyGroupDragPick, clearSelectionKeepLocked,
  type SelectionMode,
} from './playable.js';

/**
 * 拖拽框选判定：轨迹矩形是否与本牌的可见（露出）区域相交。
 * 手牌重叠摆放（下一张 marginLeft:-overlapPx 盖住本张右侧 overlapPx）：
 * 非最后一张只露出左侧，最后一张无后续牌覆盖（全露）。
 * 轨迹覆盖被盖住的部分不视为选中。x1<=x2、y1<=y2（调用方已归一化）。
 */
export function isCardCoveredByDrag(
  x1: number, y1: number, x2: number, y2: number,
  rect: { left: number; right: number; top: number; bottom: number },
  isLastCard: boolean,
  overlapPx = 34,
): boolean {
  const visibleRight = isLastCard ? rect.right : rect.right - overlapPx;
  return rect.left < x2 && visibleRight > x1 && rect.top < y2 && rect.bottom > y1;
}

/**
 * 拖拽框选状态应用（反选）：覆盖集合内的牌取反——初始已选 → 放下、初始未选 → 选中；
 * 覆盖外的牌保持初始状态（XOR 语义，与点击 toggle 一致）。返回新的状态集合。
 * 仅对 current 与期望状态不同的牌调用 onSelect/onDeselect——mousemove 每帧重算时幂等，不会反复 toggle 抖动。
 */
export function applyDragSelection(
  initialSelected: ReadonlySet<string>,
  coveredIds: ReadonlySet<string>,
  current: ReadonlySet<string>,
  onSelect: (id: string) => void,
  onDeselect: (id: string) => void,
): Set<string> {
  const desired = new Set(initialSelected);
  for (const id of coveredIds) {
    if (desired.has(id)) desired.delete(id);
    else desired.add(id);
  }
  for (const id of desired) if (!current.has(id)) onSelect(id);
  for (const id of current) if (!desired.has(id)) onDeselect(id);
  return desired;
}

interface PlayerHandProps {
  cards: Card[];
  selectedIds: string[];
  highlightedIds: string[];
  /** null = 全部可选；非 null = 仅这些牌可出（其余灰色不可选）。
   *  仅在轮到自己出牌时传入——非自己回合手牌不置灰（交互由内部闸门拦截）。 */
  playableIds?: Set<string> | null;
  /** 跟牌分组选择模式（null = 自由选择）。 */
  selectionMode?: SelectionMode | null;
  /** 锁定牌（必出/唯一可出自动选中）：任何放下操作都保留。 */
  lockedCardIds?: string[];
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
  selectionMode = null,
  lockedCardIds = [],
  onSelectCard,
  onDeselectCard,
  isActive,
  playerName,
  isHuman,
}) => {
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragStartRef = useRef<{
    x: number; y: number;
    initialSelected: Set<string>; // 拖拽开始时已选牌（mousedown 快照）
    current: Set<string>;         // 拖拽中已应用的状态（防止 mousemove 重复回调）
  } | null>(null);
  // 拖拽结束时吞掉随后的 click（防止 mouseup 在卡上触发 toggle）；
  // 只有真正位移（超过阈值）才算拖拽，单击（mousedown+mouseup 无位移）不吞
  const dragMovedRef = useRef(false);
  const suppressClickRef = useRef(false);
  // 替换式拖拽的当前候选牌（组粒度动态切换）
  const dragCandidateRef = useRef<string | null>(null);
  // 组粒度悬停：悬停可选牌时其所在整组一并上浮（free 模式/非交互不生效）
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverGroup = new Set<string>();
  if (hoverId && isActive && isHuman && selectionMode && selectionMode.kind !== 'free'
    && (!playableIds || playableIds.has(hoverId))) {
    (selectionMode.groups[hoverId] ?? [hoverId]).forEach(id => hoverGroup.add(id));
  }

  /** 把期望选中集同步进 store（差量调用，幂等）。 */
  const syncSelection = (desired: string[]) => {
    const des = new Set(desired);
    desired.forEach(id => { if (!selectedIds.includes(id)) onSelectCard(id); });
    selectedIds.forEach(id => { if (!des.has(id)) onDeselectCard(id); });
  };

  /** 指针位置下的手牌 id（不在任何牌上 → null）。 */
  const cardIdAt = (x: number, y: number): string | null =>
    (document.elementFromPoint(x, y) as HTMLElement | null)
      ?.closest('.card')?.getAttribute('data-card-id') ?? null;

  const handleCardClick = (id: string) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (!isActive || !isHuman) return;
    if (playableIds && !playableIds.has(id)) return; // 灰色牌不可选
    if (selectionMode && selectionMode.kind !== 'free') {
      syncSelection(applyGroupClick(selectedIds, lockedCardIds, selectionMode, id));
      return;
    }
    selectedIds.includes(id) ? onDeselectCard(id) : onSelectCard(id);
  };

  /** 拖拽框选：轨迹矩形覆盖的牌取反（未选 → 选中，已选 → 放下），快照初始选中集合作基准 */
  const handleMouseDown = (e: React.MouseEvent) => {
    dragStartRef.current = {
      x: e.clientX, y: e.clientY,
      initialSelected: new Set(selectedIds),
      current: new Set(selectedIds),
    };
    dragMovedRef.current = false;
    dragCandidateRef.current = null;
    // 不在此清 hoverId：普通点击也走 mousedown，清了会让组内伙伴牌先降后升
    // （group-lift 掉向 0、选中后又拉回 -12），且松开后光标静止不再触发
    // mouseenter，悬停就此失联——改为真正拖起来时（mousemove 越阈值）再清
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const start = dragStartRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // 误触阈值
    dragMovedRef.current = true; // 真正拖拽（单击的 mousedown+mouseup 无位移）
    setHoverId(null); // 拖拽期间不做组粒度悬停（单击不清，见 handleMouseDown 注释）
    if (!isActive || !isHuman) return;
    if (selectionMode?.kind === 'replace') {
      // 终点拾取：候选牌变化即整组切换；灰色/空白不算（保留原候选）
      const cid = cardIdAt(e.clientX, e.clientY);
      if (cid && cid !== dragCandidateRef.current
        && (!playableIds || playableIds.has(cid))) {
        dragCandidateRef.current = cid;
        syncSelection(applyGroupDragPick(selectionMode, cid));
      }
      return;
    }
    if (selectionMode?.kind === 'accumulate') return; // 累加式在 mouseup 结算终点
    const x1 = Math.min(start.x, e.clientX), x2 = Math.max(start.x, e.clientX);
    const y1 = Math.min(start.y, e.clientY), y2 = Math.max(start.y, e.clientY);
    const covered = new Set<string>();
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      const card = cards[i];
      if (playableIds && !playableIds.has(card.id)) return; // 灰色不可拖选
      const r = el.getBoundingClientRect();
      // 只认露出部分：手牌重叠摆放（下一张 marginLeft -34px 盖住本张右侧 34px），
      // 非最后一张只露出左侧；最后一张全露，全部区域都可选中
      if (isCardCoveredByDrag(x1, y1, x2, y2, r, i === cards.length - 1)) {
        covered.add(card.id);
      }
    });
    start.current = applyDragSelection(start.initialSelected, covered, start.current, onSelectCard, onDeselectCard);
  };

  const handleMouseUp = (e?: React.MouseEvent) => {
    if (dragMovedRef.current) {
      suppressClickRef.current = true; // 吞掉 mouseup 后同帧合成的 click
      // 该 click 落在 mousedown/mouseup 目标的共同祖先上（跨卡拖拽时是容器，无
      // onClick），不会消费本标记——限时自动失效，避免吞掉之后的真实点击
      setTimeout(() => { suppressClickRef.current = false; }, 150);
      if (selectionMode && selectionMode.kind !== 'free') {
        const cid = e ? cardIdAt(e.clientX, e.clientY) : null;
        const onPlayable = cid !== null && (!playableIds || playableIds.has(cid));
        if (selectionMode.kind === 'replace') {
          // 终点落在不可选的牌上 → 清空（保留锁定）；空白处 → 保留候选组
          if (cid !== null && !onPlayable) {
            syncSelection(clearSelectionKeepLocked(selectedIds, lockedCardIds));
          }
        } else if (onPlayable) {
          // 累加式：终点所在对整组加选（不自动放下）
          syncSelection([...new Set([...selectedIds, ...(selectionMode.groups[cid!] ?? [cid!])])]);
        }
      }
    }
    dragMovedRef.current = false;
    dragStartRef.current = null;
    dragCandidateRef.current = null;
    // 恢复组粒度悬停：单击路径 hoverId 从未清空（此处幂等）；拖拽路径按光标下
    // 的可选牌接回，避免结束后因光标静止而悬停失联
    if (e) {
      const cid = cardIdAt(e.clientX, e.clientY);
      if (cid && (!playableIds || playableIds.has(cid))) setHoverId(cid);
    }
  };

  return (
    <div className="player-hand-container" onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={() => handleMouseUp()}>
      <div className="player-hand-label">
        {playerName} {isActive ? '← 当前' : ''} ({cards.length} 张)
      </div>
      <div className="player-hand-cards">
        {cards.map((card, i) => (
          <div
            key={card.id}
            ref={el => { cardRefs.current[i] = el; }}
            className={`hand-card-wrapper${hoverGroup.has(card.id) ? ' group-lift' : ''}`}
            onMouseEnter={() => setHoverId(card.id)}
            onMouseLeave={() => setHoverId(cur => (cur === card.id ? null : cur))}
            style={{ marginLeft: i > 0 ? '-34px' : '0', zIndex: i }}
          >
            <CardFace
              card={card}
              size={isHuman ? 'medium' : 'small'}
              selected={selectedIds.includes(card.id)}
              highlighted={highlightedIds.includes(card.id)}
              disabled={isHuman && isActive && playableIds !== null && !playableIds.has(card.id)}
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
