import React, { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore.js';
import {
  GamePhase, sortHand, Suit, suitLabel, rankLabel,
  computeRoundOutcome, advanceLevel, buildAIContext,
} from '@poker/engine';
import type { GameState, Card } from '@poker/engine';
import CardFace from '../cards/CardFace.js';
import PlayerHand from './PlayerHand.js';
import PlayerSeat, { finalRevealChip } from './PlayerSeat.js';
import { revealPills } from './revealPanel.js';
import CenterArea from './CenterArea.js';
import ActionBar from './ActionBar.js';
import { computePlayableIds, computeFollowPlan } from './playable.js';
import { formatGameExport } from './export-game.js';
import './GameTable.css';

/** 牌面文字（调试输出用） */
const cardText = (c: Card): string => c.isJoker
  ? (c.rank === 16 ? '大王' : '小王')
  : `${rankLabel(c.rank)}${suitLabel(c.suit)}`;

const TRACKER_SUIT_ORDER: Record<string, number> = { S: 0, H: 1, C: 2, D: 3 };

function possibleTrumpLabel(key: string): string {
  const idx = key.indexOf('-');
  const suit = key.slice(0, idx);
  const rank = parseInt(key.slice(idx + 1), 10);
  return rank === 16 ? '大王' : rank === 15 ? '小王' : `${suitLabel(suit as any)}${rankLabel(rank as any)}`;
}

function trackerSortKey(key: string): number {
  if (key.startsWith('J-16')) return 0; // 大王
  if (key.startsWith('J-15')) return 1; // 小王
  return TRACKER_SUIT_ORDER[key[0]] ?? 9;
}

/** 无主记牌器文字（移植 CLI showOneTracker，视角 playerIndex） */
function ntrackerText(gs: GameState, playerIndex: number): string {
  const ctx = buildAIContext(gs, playerIndex);
  if (!ctx?.ntState) return '记牌器数据不可用';
  const s = ctx.ntState;
  const lines: string[] = [];
  const label = (i: number) => gs.players[i].name;

  const myTrumps = s.knownTrumpsPerPlayer[playerIndex];
  lines.push(`手牌常主 (${myTrumps.length}张): ${myTrumps.length ? myTrumps.map(cardText).join(' ') : '无'}`);

  const renderRec = (idx: number, recLabel: string): void => {
    const rec = s.possibleTrumps[idx];
    if (rec === null) { lines.push(`${recLabel}可能常主: (已知,不追踪)`); return; }
    const total = Object.values(rec).reduce((a, b) => a + b, 0);
    if (total === 0) { lines.push(`${recLabel}可能常主: 无`); return; }
    const parts = Object.entries(rec)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => trackerSortKey(a) - trackerSortKey(b))
      .map(([k, n]) => (n > 1 ? Array(n).fill(possibleTrumpLabel(k)).join(' ') : possibleTrumpLabel(k)));
    lines.push(`${recLabel}可能常主 (${total}张): ${parts.join(' ')}`);
  };

  for (let idx = 0; idx < 4; idx++) {
    if (idx === playerIndex) continue;
    renderRec(idx, label(idx));
  }
  renderRec(4, ctx.isDeclarer ? '底牌(已知)' : '底牌');

  const flags: string[] = [];
  for (let p = 0; p < 4; p++) {
    if (s.playersWithNoTrump.has(p)) flags.push(`${label(p)}无主`);
  }
  if (flags.length > 0) lines.push(`无主: ${flags.join(', ')}`);
  return lines.join('\n');
}

const GameTable: React.FC = () => {
  const {
    gameState, localPlayerIndex, selectedCardIds, debug,
    message, errorMessage, failedThrow, lastTrickReview, highlightedCards,
    selectCard, deselectCard,
    submitPlay, submitBottomExchange,
    humanReveal, humanPassReveal,
    toggleLastTrickReview, getHint, getBottomHint,
    aiPlayers, teamLevels, matchOver, settledTrick, roundNumber,
  } = useGameStore();

  const [exportCopied, setExportCopied] = useState(false);
  const [showBottomView, setShowBottomView] = useState(false);
  /** 亮主阶段剩余秒数（null = 不显示）：3 秒静默倒计时，亮/反即重置。 */
  const [revealLeft, setRevealLeft] = useState<number | null>(null);

  // 查看底牌弹层 5 秒后自动消失（与回看上墩一致），也可手动点按钮隐藏
  useEffect(() => {
    if (!showBottomView) return;
    const t = setTimeout(() => setShowBottomView(false), 5000);
    return () => clearTimeout(t);
  }, [showBottomView]);
  // 每墩重置：唯一可出自动选中只发生一次，用户清空后不再自动
  const autoSelectedRef = useRef(false);

  // 亮主阶段倒计时：发牌结束进入亮主即开始 3 秒静默倒计时；任何人亮/反
  // （currentReveal 变化触发 effect 重挂）即重置；走完仍无人动作才自动确认进扣底。
  // 倒计时数字显示在"回看上墩"槽位（table-actions 右侧，绝对定位不影响布局）。
  useEffect(() => {
    const gs = gameState;
    if (gs?.phase !== GamePhase.Revealing || aiPlayers.every(Boolean) || !gs.players[0].isHuman) {
      setRevealLeft(null);
      return;
    }
    const TOTAL_MS = 3000;
    const start = Date.now();
    setRevealLeft(3);
    const ticker = setInterval(() => {
      setRevealLeft(Math.max(0, Math.ceil((TOTAL_MS - (Date.now() - start)) / 1000)));
    }, 250);
    const t = setTimeout(() => {
      setRevealLeft(null);
      humanPassReveal();
    }, TOTAL_MS);
    return () => {
      clearInterval(ticker);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.phase, gameState?.currentReveal, gameState?.currentLevel, aiPlayers]);

  // 最后一墩自动打出：跟出张数 == 出牌前手牌张数（这墩后手牌清零），
  // 且人类跟出（非领出）→ 停留 1 秒后自动出全部手牌，无需确认。
  useEffect(() => {
    const gs = gameState;
    if (!gs || gs.phase !== GamePhase.Playing) return;
    if (gs.currentPlayerIndex !== localPlayerIndex) return;
    if (gs.trickPlays.length === 0) return; // 领出不自动
    const leadLen = gs.trickPlays[0].cards.length;
    if (gs.players[localPlayerIndex].hand.length !== leadLen) return; // 非最后一墩
    if (selectedCardIds.length > 0) return; // 人类已手动选牌
    const t = setTimeout(() => {
      const st = useGameStore.getState();
      const cur = st.gameState;
      if (!cur || cur.phase !== GamePhase.Playing) return;
      if (cur.currentPlayerIndex !== st.localPlayerIndex) return;
      if (cur.trickPlays.length === 0) return;
      if (cur.players[st.localPlayerIndex].hand.length !== cur.trickPlays[0].cards.length) return;
      // 手牌全部必出：选中全部手牌并打出
      st.clearSelection();
      cur.players[st.localPlayerIndex].hand.forEach(c => st.selectCard(c.id));
      st.submitPlay();
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, localPlayerIndex, selectedCardIds.length]);

  // 新墩重置自动选中标记 + 释放上一墩的锁定（每墩最多自动选中一次）
  useEffect(() => {
    autoSelectedRef.current = false;
    useGameStore.getState().clearLockedCards();
  }, [gameState?.tricksPlayed]);

  // 跟牌必出牌 → 自动选中并锁定（不可放下，出牌后释放）。
  // 覆盖唯一可出与部分必出（computeMandatoryFollow，见引擎）；
  // 最后一墩仍由上方自动打处理；每墩仅一次。必出为强制约束，
  // 不因用户已手动选牌而跳过。
  useEffect(() => {
    const gs = gameState;
    if (!gs || gs.phase !== GamePhase.Playing) return;
    if (gs.currentPlayerIndex !== localPlayerIndex) return;
    if (gs.trickPlays.length === 0) return; // 领出不自动
    const trump = gs.trumpDeclaration;
    if (!trump) return;
    const hand = gs.players[localPlayerIndex].hand;
    if (hand.length === gs.trickPlays[0].cards.length) return; // 最后一墩（自动打分支处理）
    if (autoSelectedRef.current) return;
    const plan = computeFollowPlan(hand, gs.trickPlays, trump, gs.phase);
    if (plan.lockedIds.length === 0) return; // 无必出牌
    autoSelectedRef.current = true;
    // 自动选中并锁定（不可放下，出牌后释放）
    useGameStore.getState().lockCards(plan.lockedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, localPlayerIndex, selectedCardIds.length]);

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

  // 最终亮主小牌（桌布外座位卡）：扣底开始后（BottomExchange/Playing）显示，
  // 发牌/亮主阶段不显示（最终主未定），本局结束（RoundEnd）清除
  const chipVisible = gameState.phase === GamePhase.BottomExchange
    || gameState.phase === GamePhase.Playing;
  const finalChipOf = (gameIndex: number) =>
    chipVisible && gameState.currentReveal?.playerIndex === gameIndex
      ? finalRevealChip(gameState.currentReveal, gameState.currentLevel)
      : null;

  const localPlayer = gameState.players[localPlayerIndex];
  const otherPlayers = [0, 1, 2, 3].filter(i => i !== localPlayerIndex);

  const isPlaying = gameState.phase === GamePhase.Playing;
  const isRevealing = gameState.phase === GamePhase.Revealing;
  const isBottomExchange = gameState.phase === GamePhase.BottomExchange;
  const isMyTurn = gameState.currentPlayerIndex === localPlayerIndex;
  const isDeclarer = gameState.trumpDeclaration?.declarerIndex === localPlayerIndex;
  const isSpectator = aiPlayers.every(Boolean);

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
              finalChip={finalChipOf(idx)}
              chipAlign="right-top"
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
                finalChip={finalChipOf(idx)}
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
                finalChip={finalChipOf(idx)}
                />
            );
          })}
        </div>
      </div>

      {/* message — 玩家1 小牌在 bar 上方居中（bar 本身 overflow hidden 会裁剪框外内容，
          故小牌放在外层 .message-wrap 容器内） */}
      <div className="message-wrap">
        <div className="table-message">
          {failedThrow ? <span className="fail-msg" data-testid="fail-msg">⚠ {failedThrow.notice}</span>
            : errorMessage ? <span className="error-msg">❌ {errorMessage}</span>
            : <span className="info-msg">{message}</span>}
        </div>
        {finalChipOf(localPlayerIndex) && (
          <div
            className="final-reveal-chip align-above-message"
            data-testid="seat-final-reveal-0"
          >
            {Array.from({ length: finalChipOf(localPlayerIndex)!.count }, (_, i) => (
              <span key={i} className={`score-point${finalChipOf(localPlayerIndex)!.red ? ' red' : ''}`}>
                {finalChipOf(localPlayerIndex)!.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 固定 48px 槽位（常驻，内容可空）：亮主面板 / 出牌·扣底按键——
          手牌与桌布位置不随槽位内容出现/消失而变化（按钮 bar 相对手牌位置固定） */}
      <div className="table-actions">
      {/* reveal panel for humans — dealing & reveal phases：6 个胶囊框（NT 红 / nt 黑 / ♠♥♣♦），
          无文字描述；框宽固定容纳两图标；不可亮置灰；无人亮主时只能单张亮（图标 1 → 自保 2） */}
      {(isRevealing || gameState.phase === GamePhase.Dealing) && !isSpectator && localPlayer.isHuman && (() => {
        const pills = revealPills(localPlayer.hand, gameState.currentLevel, gameState.currentReveal, localPlayerIndex);
        return (
          <div className="reveal-panel" data-testid="reveal-panel">
            {pills.map(p => (
              <button
                key={p.suit ?? p.label}
                className={`reveal-pill${p.available ? '' : ' reveal-pill-off'}`}
                data-testid={`reveal-btn-${p.suit ?? p.label}`}
                disabled={!p.available}
                onClick={() => humanReveal(p.suit)}
              >
                {/* 胶囊即图标容器：花色符号直接显示在胶囊上（无内部圆圈） */}
                {Array.from({ length: p.icons }, (_, i) => (
                  <span key={i} className={`reveal-sym${p.red ? ' red' : ''}${p.suit === null ? ' nt-text' : ''}`}>
                    {p.label}
                  </span>
                ))}
              </button>
            ))}
          </div>
        );
      })()}

      {/* 亮主倒计时（"回看上墩"槽位右侧）：3s 静默倒计时，亮/反即重置；
          绝对定位不参与文档流——任何阶段零布局影响 */}
      {isRevealing && revealLeft !== null && (
        <span className="reveal-countdown" data-testid="reveal-countdown">
          {revealLeft}
        </span>
      )}

      {/* action bar — 出牌/扣底主按键（ActionBar 内部按阶段决定渲染：Playing 当前玩家 / BottomExchange 庄家） */}
      {localPlayer.isHuman && (
        <ActionBar
          gameState={gameState}
          localPlayerIndex={localPlayerIndex}
          selectedCards={localPlayer.hand.filter(c => selectedCardIds.includes(c.id))}
          hand={localPlayer.hand}
          trumpDeclaration={gameState.trumpDeclaration}
          isHuman={localPlayer.isHuman}
          isReviewing={lastTrickReview}
          onSubmitPlay={submitPlay}
          onSubmitBottomExchange={submitBottomExchange}
          onToggleReview={toggleLastTrickReview}
        />
      )}
      </div>

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
            {/* 底牌统一在桌布中央展示（CenterArea bottom-reveal 含分×倍率/抠底标注），结算面板不再重复 */}
          </div>
        );
      })()}

      {/* 建议出牌（调试，仅出牌阶段）+ 查看底牌（人类庄家，非调试也可用）— 回看上墩在 ActionBar 出牌按钮右侧 */}
      {(debug || (isDeclarer && localPlayer.isHuman)) && (
        <div className="debug-bar">
          {debug && isPlaying && (
            <button className="debug-btn" onClick={getHint} data-testid="hint-btn">
              🤖 建议出牌
            </button>
          )}
          {debug && isBottomExchange && isDeclarer && localPlayer.isHuman && (
            <button className="debug-btn" onClick={getBottomHint} data-testid="bottom-hint-btn">
              🤖 建议扣底
            </button>
          )}
          {isDeclarer && localPlayer.isHuman && (
            <button
              className="debug-btn"
              data-testid="bottom-view-btn"
              onClick={() => setShowBottomView(v => !v)}
            >
              {showBottomView ? '隐藏底牌' : '查看底牌'}
            </button>
          )}
        </div>
      )}

      {/* 查看底牌弹层（人类庄家） */}
      {showBottomView && isDeclarer && localPlayer.isHuman && (
        <div className="bottom-view" data-testid="bottom-view">
          <div className="bottom-view-title">底牌 ({gameState.bottomCards.length}张)</div>
          <div className="bottom-view-cards">
            {gameState.bottomCards.map(card => (
              <CardFace key={card.id} card={card} size="small" />
            ))}
          </div>
        </div>
      )}

      {/* 调试菜单 — 右上角（absolute，展开不覆盖手牌） */}
      {debug && (
        <details
          className="debug-menu"
          data-testid="debug-menu"
          onToggle={e => { if (!e.currentTarget.open) setExportCopied(false); }} // 关闭时重置导出文案
        >
          <summary>🔧 调试</summary>
          <div className="debug-menu-content">
            <button
              className="debug-btn"
              data-testid="export-btn"
              onClick={() => {
                const text = formatGameExport({ gameState, roundNumber });
                navigator.clipboard.writeText(text).then(
                  () => setExportCopied(true),
                  () => setExportCopied(false),
                );
              }}
            >
              {exportCopied ? '✅ 已复制' : '📋 导出'}
            </button>

            {/* 其他玩家手牌（二级菜单：功能 → 玩家 → 手牌） */}
            <details className="debug-sub">
              <summary data-testid="dbg-hands">🖐 其他玩家手牌</summary>
              {[0, 1, 2, 3].filter(i => i !== localPlayerIndex).map(i => (
                <details key={i} className="debug-sub">
                  <summary data-testid={`dbg-player-${i}`}>{gameState.players[i].name} ({gameState.players[i].hand.length}张)</summary>
                  <div className="debug-text">
                    {gameState.players[i].hand.map(cardText).join(' ') || '(空)'}
                  </div>
                </details>
              ))}
            </details>

            {/* 底牌（即使不是庄家） */}
            <details className="debug-sub">
              <summary data-testid="dbg-bottom">🂠 底牌 ({gameState.bottomCards.length}张)</summary>
              <div className="debug-text">
                {gameState.bottomCards.map(cardText).join(' ') || '(空)'}
              </div>
            </details>

            {/* 历史出牌 */}
            <details className="debug-sub">
              <summary data-testid="dbg-history">📜 历史出牌 ({gameState.trickHistory.length}墩)</summary>
              <div className="debug-text">
                {gameState.trickHistory.map((t, i) =>
                  `第${i + 1}墩: ${t.plays.map((p, j) =>
                    `${gameState.players[(t.leadPlayerIndex + j) % 4].name} ${p.cards.map(cardText).join('')}`
                  ).join(' | ')}`
                ).join('\n') || '(无)'}
              </div>
            </details>

            {/* 记牌器（无主模式）— 二级菜单 */}
            {gameState.trumpDeclaration?.trumpSuit === null && (
              <details className="debug-sub">
                <summary data-testid="dbg-tracker">🧮 记牌器（无主）</summary>
                {[0, 1, 2, 3].map(i => (
                  <details key={i} className="debug-sub">
                    <summary>{gameState.players[i].name}</summary>
                    <pre className="debug-text">{ntrackerText(gameState, i)}</pre>
                  </details>
                ))}
              </details>
            )}

            {gameState.aiReasons.length > 0 && (
              <details className="ai-log" open>
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
        </details>
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
            dimInactive={gameState.phase !== GamePhase.Dealing} // 发牌阶段亮色展示（仍不可点）
            playerName={localPlayer.name}
            isHuman={localPlayer.isHuman}
          />
        )}
      </div>
    </div>
  );
};

export default GameTable;
