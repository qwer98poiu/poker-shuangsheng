import React, { useLayoutEffect, useRef, useState } from 'react';
import type { GameState, Trick, Card, Reveal } from '@poker/engine';
import { GamePhase, suitLabel, rankLabel, suitName, isPointRank, cardPointsFromRank, computeRoundOutcome } from '@poker/engine';
import CardFace from '../cards/CardFace.js';
import { useGameStore } from '../../store/gameStore.js';

/**
 * 打出牌叠放露出条（纯函数）：n 张牌在容器宽 containerWidth 内全部可见时的
 * 负 margin 露出条（每张露出的左条宽度）。
 * strip = clamp((containerWidth - cardWidth)/(n-1), minStrip, maxStrip)
 * 叠放总宽 = cardWidth + (n-1)*strip ≤ containerWidth（minStrip 充足时恒成立）。
 * 实际轨道宽 ~156px、maxStrip 18 → 25 张以内 strip ≥ 4，总宽 ≤ 152 恒放得下。
 */
export function playedStackStrip(
  count: number,
  containerWidth: number,
  cardWidth = 50,
  maxStrip = 18,
  minStrip = 4,
): number {
  if (count <= 1) return 0;
  const available = containerWidth - cardWidth;
  const strip = Math.min(maxStrip, Math.max(minStrip, Math.floor(available / (count - 1))));
  return strip;
}

/** 叠放负 margin = 牌宽 - 露出条。 */
export function playedStackOverlap(
  count: number,
  containerWidth: number,
  cardWidth = 50,
): number {
  return cardWidth - playedStackStrip(count, containerWidth, cardWidth);
}

/**
 * 亮主展示：只保留成功的亮/反主记录（引擎 attemptReveal 会把力量不足的失败
 * 尝试也追加进 reveals 历史，且同力量重复亮不覆盖——需按 strength 严格递增过滤）。
 * 返回按时间排序的成功记录；最后一条 = 当前主（正常色），其余 = 被反的主（置灰）。
 */
export function successfulReveals(reveals: readonly Reveal[]): Reveal[] {
  const out: Reveal[] = [];
  let maxStrength = 0;
  for (const r of reveals) {
    if (r.strength > maxStrength) { out.push(r); maxStrength = r.strength; }
  }
  return out;
}

/** r 是否为当前生效的主（未被反）。 */
export function isCurrentReveal(r: Reveal, current: Reveal | null): boolean {
  return !!current
    && r.playerIndex === current.playerIndex
    && r.suit === current.suit
    && r.strength === current.strength;
}

/**
 * 亮主展示列表（输入 = successfulReveals 的成功链，按时间排序）：
 * 自保（同一玩家同花色巩固，如 单♠2 → 对♠2）的旧记录被**直接替换**，不显示；
 * 其余被反记录（不同玩家 / 不同花色）保留原位置灰。当前主总是显示。
 */
export function displayReveals(reveals: readonly Reveal[]): Reveal[] {
  return reveals.filter((r, i) => {
    if (i === reveals.length - 1) return true;
    const next = reveals[i + 1];
    return !(next.playerIndex === r.playerIndex && next.suit === r.suit);
  });
}

export interface LevelBoxState {
  myLevel: number;
  oppLevel: number;
  /** 我方当庄（本家所在队为庄家队）——等级框对应行高亮 */
  myActive: boolean;
  oppActive: boolean;
}

/** 左上角等级框状态：我方/对方等级 + 哪一方当庄（team = index % 2；declarerIndex null = 未定，不高亮）。 */
export function levelBoxState(
  teamLevels: readonly [number, number],
  localPlayerIndex: number,
  declarerIndex: number | null,
): LevelBoxState {
  const myTeam = localPlayerIndex % 2;
  const oppTeam = 1 - myTeam;
  const declarerTeam = declarerIndex === null ? null : declarerIndex % 2;
  return {
    myLevel: teamLevels[myTeam],
    oppLevel: teamLevels[oppTeam],
    myActive: declarerTeam === myTeam,
    oppActive: declarerTeam === oppTeam,
  };
}

/**
 * 亮主展示牌：单张亮 1 张级牌，对级牌/对王亮 2 张（牌面相同）；
 * 无主 = 对大王（strength 4）/ 对小王（strength 3），均 2 张王。
 */
export function revealDisplayCards(reveal: Reveal, level: number): Card[] {
  const n = reveal.strength >= 2 ? 2 : 1;
  const baseId = `R-${reveal.playerIndex}-${reveal.strength}`;
  if (reveal.suit === null) {
    const rank = reveal.strength >= 4 ? 16 : 15;
    return Array.from({ length: n }, (_, i) => ({ id: `${baseId}-${i}`, suit: 'J', rank, isJoker: true }) as Card);
  }
  return Array.from({ length: n }, (_, i) => ({ id: `${baseId}-${i}`, suit: reveal.suit, rank: level, isJoker: false }) as Card);
}

/**
 * 打出牌叠放：每张牌负 margin 露出左条（与手牌叠放同视觉），
 * 露出条按容器轨道宽自适应——甩 10+ 张也能整叠完整显示在轨道内。
 * 轨道宽 = 所在 .trick-position-layout 宽度 / 3（等宽三列，见 CSS）。
 */
const PlayedStack: React.FC<{ cards: Card[] }> = ({ cards }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [strip, setStrip] = useState(() => playedStackStrip(cards.length, 156)); // 初始 1280 视口轨道宽，布局后修正
  useLayoutEffect(() => {
    const cell = ref.current?.parentElement;
    const grid = cell?.parentElement;
    if (!grid) return;
    const track = Math.floor(grid.clientWidth / 3);
    setStrip(playedStackStrip(cards.length, track));
  }, [cards.length]);
  return (
    <div className="trick-pos-cards" ref={ref}>
      {cards.map((card, i) => (
        <div key={card.id} className="played-card-slot" style={{ marginLeft: i > 0 ? `-${50 - strip}px` : '0' }}>
          <CardFace card={card} size="small" />
        </div>
      ))}
    </div>
  );
};

interface CenterAreaProps {
  gameState: GameState;
  lastTrickReview: boolean;
  onCloseReview: () => void;
  /** 上一墩结算显示（第四家出牌后保留到下一墩第一张牌出现）。 */
  settledTrick?: Trick | null;
}

const CenterArea: React.FC<CenterAreaProps> = ({ gameState, lastTrickReview, onCloseReview, settledTrick = null }) => {
  const localPlayerIndex = useGameStore(s => s.localPlayerIndex);
  const teamLevels = useGameStore(s => s.teamLevels);
  const roundNumber = useGameStore(s => s.roundNumber);
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
      <div className="phase-banner" data-testid="phase-banner">
        {getPhaseText()}
        {/* 局数/墩数：挂在横幅底部（bottom: 0 = 与横幅底边对齐，1 起计数）。
            锚定 .phase-banner 而非 .center-area——不给 center-area 设定位祖先，
            等级框/回看弹层仍锚定 .game-table，位置不变 */}
        <span className="trick-count" data-testid="trick-count">
          局数: {roundNumber + 1} 墩数: {gameState.tricksPlayed + 1}
        </span>
      </div>

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
              : (() => {
                  // 无主区分大王/小王（strength 4=对大王、3=对小王）
                  const finalReveal = gameState.reveals[gameState.reveals.length - 1];
                  const bigJoker = !!finalReveal && finalReveal.suit === null && finalReveal.strength >= 4;
                  return (
                    <span className={bigJoker ? 'nt-big' : 'nt-small'}>
                      {bigJoker ? '大王' : '小王'}无主 ({rankLabel(trumpDeclaration.level)})
                    </span>
                  );
                })()}
          </span>
          <span className="declarer-label" data-testid="declarer-label">
            庄家: {gameState.players[trumpDeclaration.declarerIndex].name}
          </span>
        </div>
      )}

      <div className="score-display" data-testid="score-display">
        {/* 等级框：我方/对方等级，当庄一方高亮 */}
        {(() => {
          const lb = levelBoxState(teamLevels, localPlayerIndex,
            gameState.trumpDeclaration?.declarerIndex ?? gameState.declarerIndex);
          return (
            <div className="level-box" data-testid="level-box">
              <div className={`level-row${lb.myActive ? ' level-active' : ''}`} data-testid="level-my">
                <span className="level-label">我方等级</span>
                <span className="level-value">{rankLabel(lb.myLevel)}</span>
              </div>
              <div className={`level-row${lb.oppActive ? ' level-active' : ''}`} data-testid="level-opp">
                <span className="level-label">对方等级</span>
                <span className="level-value">{rankLabel(lb.oppLevel)}</span>
              </div>
            </div>
          );
        })()}
        <span className="score-item">闲家得分: {attackerPoints}</span>
        {(() => {
          // 闲家已获得的分牌：一行 5 张，10/K 档在前、5 在后，同档按花色 SHCD
          const declarerIdx = gameState.trumpDeclaration?.declarerIndex ?? gameState.declarerIndex;
          const attackerTeam = declarerIdx % 2 === 0 ? 1 : 0;
          const pointCards = trickHistory
            .filter(t => t.points > 0 && t.winnerIndex % 2 === attackerTeam)
            .flatMap(t => t.plays.flatMap(p => p.cards))
            .filter(c => isPointRank(c.rank));
          if (pointCards.length === 0) return null;
          const suitOrder: Record<string, number> = { S: 0, H: 1, C: 2, D: 3 };
          const sorted = [...pointCards].sort((a, b) => {
            const ka = (a.rank === 10 || a.rank === 13) ? 0 : 1;
            const kb = (b.rank === 10 || b.rank === 13) ? 0 : 1;
            if (ka !== kb) return ka - kb;
            const sa = suitOrder[a.suit] ?? 4;
            const sb = suitOrder[b.suit] ?? 4;
            if (sa !== sb) return sa - sb;
            return b.rank - a.rank;
          });
          return (
            <div className="score-points" data-testid="score-points">
              {sorted.map((c, i) => (
                <span key={`${c.id}-${i}`} className={`score-point ${c.isJoker || c.suit === 'H' || c.suit === 'D' ? 'red' : ''}`}>
                  {rankLabel(c.rank)}{c.isJoker ? '' : suitLabel(c.suit)}
                </span>
              ))}
            </div>
          );
        })()}
      </div>

      {/* 桌布 + 当前墩 — 按玩家方位布局（上/左/右/下）：
          发牌/亮主/扣底/出牌阶段同尺寸（固定高度，不随亮主/反主变化）；
          发牌/亮主阶段亮出的主牌放在亮主者方位（单张 1 张、对牌 2 张；
          被反的主牌不收回、置灰；庄家拿底后全部收回不再显示），
          出牌时各家出的牌叠放在同一方位；墩结算沿用同一方位（不新开框） */}
      {(phase === GamePhase.Dealing || phase === GamePhase.Revealing
        || phase === GamePhase.BottomExchange || phase === GamePhase.Playing) && (() => {
        const isPlaying = phase === GamePhase.Playing;
        const isSettled = isPlaying && trickPlays.length === 0 && !!settledTrick;
        const plays = isPlaying
          ? (trickPlays.length > 0 ? trickPlays : (settledTrick ? settledTrick.plays : []))
          : [];
        const leadIdx = isPlaying
          ? (trickPlays.length > 0
            ? gameState.leadPlayerIndex
            : (settledTrick?.leadPlayerIndex ?? gameState.leadPlayerIndex))
          : 0;
        const goodReveals = displayReveals(successfulReveals(gameState.reveals));
        // 亮主牌只在发牌/亮主阶段展示：庄家拿到底牌后全部收回（扣底/出牌阶段不再显示）
        const showReveals = phase === GamePhase.Dealing || phase === GamePhase.Revealing;
        return (
          <div className="trick-position-layout" data-testid="trick-position-layout">
            {([0, 1, 2, 3] as const).map(rel => {
              const pi = (localPlayerIndex + rel) % 4;
              const pos = ['bottom', 'right', 'top', 'left'][rel];
              const play = plays.find((p, j) => (leadIdx + j) % 4 === pi);
              const myReveals = goodReveals.filter(r => r.playerIndex === pi);
              return (
                <div key={rel} className={`trick-pos trick-pos-${pos}`}>
                  <div className="trick-pos-player">
                    {gameState.players[pi].name}
                    {isSettled && pi === settledTrick!.winnerIndex ? ' 👑' : ''}
                  </div>
                  {showReveals && myReveals.length > 0 && (
                    <div className="trick-pos-reveal" data-testid={`reveal-cards-${pi}`}>
                      {myReveals.map(r => (
                        <div
                          key={`${pi}-${r.strength}`}
                          className={`reveal-pair${isCurrentReveal(r, gameState.currentReveal) ? '' : ' reveal-overridden'}`}
                        >
                          {revealDisplayCards(r, currentLevel).map(c => (
                            <CardFace key={c.id} card={c} size="small" />
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  {isPlaying && <PlayedStack cards={play ? play.cards : []} />}
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

      {/* last trick review — 弹层（与查看底牌同风格）：各家出的牌放在各家对应方位，
          与出牌展示（trick-position-layout）一致；5 秒后自动消失（store），也可点 ✕ 关闭 */}
      {lastTrickReview && trickHistory.length > 0 && (() => {
        const last = trickHistory[trickHistory.length - 1];
        return (
          <div className="review-overlay" data-testid="review-overlay">
            <div className="review-overlay-title">
              <span className="review-label">上一墩回顾</span>
              <button className="review-close-btn" onClick={onCloseReview}>✕</button>
            </div>
            <div className="trick-position-layout">
              {([0, 1, 2, 3] as const).map(rel => {
                const pi = (localPlayerIndex + rel) % 4;
                const pos = ['bottom', 'right', 'top', 'left'][rel];
                const play = last.plays.find((p, j) => (last.leadPlayerIndex + j) % 4 === pi);
                const isWinner = pi === last.winnerIndex;
                return (
                  <div key={rel} className={`trick-pos trick-pos-${pos}`}>
                    <div className="trick-pos-player">
                      {gameState.players[pi].name}{isWinner ? ' 👑' : ''}
                    </div>
                    <PlayedStack cards={play ? play.cards : []} />
                  </div>
                );
              })}
              <div className="trick-pos-center">
                {gameState.players[last.winnerIndex].name} 赢 · {last.points} 分
              </div>
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
