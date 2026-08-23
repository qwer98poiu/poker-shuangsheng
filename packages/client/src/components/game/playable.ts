import type { Card, GameState, Trick, TrumpDeclaration } from '@poker/engine';
import {
  GamePhase, computeFollowableCards, computeMandatoryFollow, validateFollow,
  classify, isTrump, findAllPairs, detectTractors, sortHand, computeBestSoFar,
} from '@poker/engine';

/**
 * 可出牌集合（不符合规则的牌灰色不可选）——委托引擎 computeFollowableCards
 * 判定（与 validateFollow 同口径）：
 * - 领出或非出牌阶段 → null（全可选）
 * - 跟牌：null = 全可点（缺门垫/毙、组牌不足任意填）；
 *   集合 = 能出现在某合法跟牌组合中的牌（唯一可出时仅组牌、跟对子时仅对子牌等）
 * 并叠加 computeMandatoryFollow 的不可选牌（同花色内必不可能出现在合法组合中的牌）。
 */
export function computePlayableIds(
  hand: Card[],
  trickPlays: GameState['trickPlays'],
  trump: TrumpDeclaration | null,
  phase: GamePhase,
): Set<string> | null {
  if (trickPlays.length === 0 || phase !== GamePhase.Playing) return null;
  const lead = trickPlays[0];
  const followable = computeFollowableCards(hand, lead.cards, trump!);
  const disabled = new Set(computeMandatoryFollow(hand, lead.cards, trump!).disabledIds);
  if (followable === null) {
    // 全可点：仅排除不可选牌
    return disabled.size === 0 ? null : new Set(hand.filter(c => !disabled.has(c.id)).map(c => c.id));
  }
  return new Set(followable.filter(c => !disabled.has(c.id)).map(c => c.id));
}

export interface FollowPlan {
  /** 必出牌 id（自动选中 + 锁定不可放下） */
  lockedIds: string[];
}

/**
 * 跟牌必出计划：必出牌（唯一可出组合 / 部分必出子牌型）。
 * 领出或非 Playing 阶段 → 空。
 */
export function computeFollowPlan(
  hand: Card[],
  trickPlays: GameState['trickPlays'],
  trump: TrumpDeclaration | null,
  phase: GamePhase,
): FollowPlan {
  if (trickPlays.length === 0 || phase !== GamePhase.Playing) return { lockedIds: [] };
  const lead = trickPlays[0];
  return { lockedIds: computeMandatoryFollow(hand, lead.cards, trump!).lockedIds };
}

/**
 * 扣底状态（庄家 BottomExchange 主按键判定）：
 * - canSubmit：已选恰好 8 张（≠8 时扣底键灰色不可点）
 * - trumpCount：所选底牌中的主牌数（>0 时扣底键变黄并显示警告小字，不设二次确认，点击直接扣）
 */
export function bottomExchangeStatus(
  selected: Card[],
  trump: TrumpDeclaration | null,
): { canSubmit: boolean; trumpCount: number } {
  return {
    canSubmit: selected.length === 8,
    trumpCount: trump ? selected.filter(c => isTrump(c, trump)).length : 0,
  };
}

/**
 * 出牌按钮可否提交（灰色判定）：
 * - 未选牌 → false（与 0 张样式一致）
 * - 领出：单张或同组（同花色非主 / 全部主牌）→ true，不同花色 → false
 * - 跟牌：张数与领出相等且 validateFollow 通过（牌型符合要求）→ true，否则 false
 */
export function canSubmitPlay(
  selected: Card[],
  hand: Card[],
  trickPlays: GameState['trickPlays'],
  trump: TrumpDeclaration | null,
): boolean {
  if (selected.length === 0) return false;
  if (trickPlays.length === 0) {
    // 领出：同组 = 同花色非主 或 全部主牌
    if (selected.length <= 1) return true;
    const groupOf = (c: Card) => (trump && isTrump(c, trump)) ? '_TRUMP_' : c.suit;
    const g = groupOf(selected[0]);
    return selected.every(c => groupOf(c) === g);
  }
  const lead = trickPlays[0];
  if (selected.length !== lead.cards.length) return false;
  if (!trump) return true;
  const leadPattern = classify(lead.cards, trump);
  return validateFollow(selected, hand, lead.cards, leadPattern, lead.leadSuit, trump).valid;
}

// ==================== 跟牌分组选择（点选/拖选的组粒度语义） ====================

/**
 * 跟牌时的选择模式：
 * - free：自由多选——领出、含单张的甩牌跟牌、完全缺门或同门张数不足的
 *   垫牌/毙牌局（引擎"组牌必出 + 任意填"，fill 无牌型约束），
 *   或唯一可出（自动锁定接管）/凑不出对应组——逐张 toggle / XOR 框选
 * - replace：点新放旧——单张领出每张自成一组（始终只选一张）；对子领出整对一组；
 *   拖拉机/无单甩牌领出去掉必出牌后恰剩两张要填时按对粒度（视同对牌，规则 3.1/4.1）。
 *   拖拽为"终点拾取"：轨迹经过可选牌动态切换候选组，终点落在不可选牌上清空
 * - accumulate：按对累加——拖拉机/无单甩牌领出去掉必出牌后还需填更多
 *   （视同甩牌）；点击/拖拽以对为粒度加选，不自动放下
 *
 * groups：cardId → 该牌所在组的全部 cardId（仅可选牌有映射；重叠窗口取先枚举者）。
 *
 * 必出口径：对子/甩牌用引擎 computeMandatoryFollow（先跟足领出花色再填的语义）；
 * 拖拉机引擎返回保守空集，改用同长窗口集合的交集（所有合法整机共有的牌）：
 * 窗口互斥（无共有牌）→ 点一张选整个拖拉机；有共有牌则扣除后按剩余张数分流。
 * 全对领出（含拖拉机）时组粒度仅适用于可选域全为对牌的情形——引擎对"散对填充"
 * 容忍拆对（bad 组合提交期拒绝），因此可选域含散牌时必须回退 free 让散牌自由填、
 * 由锁定接管必出对；可选域全对牌时按对分组，防止点选单张（如单张梅花2）。
 */
export type SelectionMode =
  | { kind: 'free' }
  | { kind: 'replace'; groups: Record<string, string[]> }
  | { kind: 'accumulate'; groups: Record<string, string[]> };

/** 可选牌上的成对分组（findAllPairs 引擎口径；成员不全可选或与已有组重叠则跳过）。 */
function buildPairGroups(hand: Card[], playable: Set<string>): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const p of findAllPairs(hand)) {
    if (!p.every(c => playable.has(c.id))) continue;
    if (p.some(c => groups[c.id])) continue;
    const ids = p.map(c => c.id);
    ids.forEach(id => { groups[id] = ids; });
  }
  return groups;
}

/** 该牌是否属于领出花色组（吊主 leadSuit=null 时为主牌组）。 */
function inLeadSuitGroup(c: Card, leadSuit: string | null, trump: TrumpDeclaration): boolean {
  if (leadSuit === null) return isTrump(c, trump);
  return c.suit === leadSuit;
}

/**
 * 依据领出牌型推导选择模式。组枚举复用引擎口径（findAllPairs/detectTractors，
 * 与 classify/validateFollow 同源）；扣除必出牌后按剩余要填的张数分流：
 * 恰剩 2 张（一对）→ replace 视同对牌，否则 accumulate 视同甩牌。
 * playableOverride：外部给定的可选域（如强制拆对场景只留一张），跳过引擎推导。
 */
export function computeSelectionMode(
  hand: Card[],
  trickPlays: GameState['trickPlays'],
  trump: TrumpDeclaration | null,
  phase: GamePhase,
  playableOverride?: Set<string>,
): SelectionMode {
  if (!trump || trickPlays.length === 0 || phase !== GamePhase.Playing) return { kind: 'free' };
  const lead = trickPlays[0];
  const pattern = classify(lead.cards, trump);
  if (pattern.type === 'throw') {
    // 含单张的甩牌 → 自由选择（结构由用户自行拼配）
    const tractorCards = pattern.tractors.reduce((n, t) => n + t.pairCount * 2, 0);
    const singles = pattern.length - pattern.pairCount * 2 - tractorCards;
    if (singles > 0) return { kind: 'free' };
  }
  // 完全缺门或同门张数不足（垫牌/毙牌/部分 0 < ledCount < leadLen）：
  // 引擎规则为"组牌必出 + 其余任意填"，fill 无牌型约束（validateFollow 同长即可），
  // 组粒度语义（按对/整组）不适用——非单张领出一律自由；锁定由 computeFollowPlan 接管。
  const ledCount = hand.filter(c => inLeadSuitGroup(c, lead.leadSuit, trump)).length;
  if (pattern.type !== 'single' && ledCount < lead.cards.length) return { kind: 'free' };

  // 部分缺门时引擎给全可选 null → 以整手为可选域（合法性由 validateFollow 兜底）
  const playable = playableOverride
    ?? computePlayableIds(hand, trickPlays, trump, phase)
    ?? new Set(hand.map(c => c.id));

  if (pattern.type === 'single') {
    const groups: Record<string, string[]> = {};
    for (const c of hand) if (playable.has(c.id)) groups[c.id] = [c.id];
    return Object.keys(groups).length > 0 ? { kind: 'replace', groups } : { kind: 'free' };
  }

  const leadLen = lead.cards.length;
  if (pattern.type === 'tractor') {
    // 引擎只返回整链与部分子链，未必含恰好同长的窗口——从各链上滑窗切出
    const kPairs = leadLen / 2;
    const seen = new Set<string>();
    const wins: Card[][] = [];
    for (const t of detectTractors(hand, trump)) {
      if (t.length < leadLen || !t.every(c => playable.has(c.id))) continue;
      const units: Card[][] = [];
      for (let i = 0; i + 1 < t.length; i += 2) units.push([t[i], t[i + 1]]);
      for (let s = 0; s + kPairs <= units.length; s++) {
        const w = units.slice(s, s + kPairs).flat();
        const key = w.map(c => c.id).sort().join(',');
        if (!seen.has(key)) { seen.add(key); wins.push(w); }
      }
    }
    if (wins.length > 1) {
      // 多台同长窗口（互斥或共享/同链滑动窗）：每台窗口都是一份完整合法跟出
      // （引擎 4.1 "提取同长/更长整机"口径）。窗口可能重叠——按"先枚举窗口归属"映射：
      // 专属牌点一张即整机选入，同属多窗的牌归先枚举窗口；点另一窗替换（replace 整机）。
      // 不能退到"按对分组 ±必出交集"——必出对未锁定 + replace 只留一组时，按对点选
      // 无法拼出整台（如必出 66 后点 77：先选 66 再点 77 会放掉 66，只有 2 张提交死路；
      // 实测 canSubmitPlay=false）；accumulate 可点出非窗口组合（如 55+88）被引擎拒绝。
      const groups: Record<string, string[]> = {};
      for (const w of wins) {
        const ids = w.map(c => c.id);
        for (const id of ids) if (!groups[id]) groups[id] = ids;
      }
      return { kind: 'replace', groups };
    }
    if (wins.length === 1) return { kind: 'free' }; // 唯一窗口：唯一可出，由自动锁定接管
    // 手牌无同长整机（如仅若干散对，实测如 主拖拉机领出 + 3 个主对）：
    // 引擎口径——跟拖拉机用"散对填充"（minTotalPairs 由剩余对数决定），
    // 整对是软约束（拆对即组合不合法），不能回退 free（否则单张可选——用户 bug）。
    // 落入下方公共"对子 / 无单甩牌"分支按对分组。
  }

  // 对子 / 无单甩牌 / 拖拉机无同长整机：引擎必出（含"先跟足领出花色"的部分缺门口径）
  const forcedCount = computeMandatoryFollow(hand, lead.cards, trump).lockedIds.length;
  if (forcedCount >= leadLen) return { kind: 'free' }; // 唯一可出：由自动锁定接管
  const groups = buildPairGroups(hand, playable);
  if (Object.keys(groups).length === 0) return { kind: 'free' };
  // 可选域含成组外的散牌（对子不足，引擎允许"垫近似组合"、散牌自由填）：
  // 必出的对由 computeFollowPlan 锁定接管，散牌填充须自由多选 → free；
  // 否则（可选域全为对牌）按对分组，杜绝点选单张。
  if ([...playable].some(id => !groups[id])) return { kind: 'free' };
  // 去掉必出后恰剩一对要填 → 视同对牌（replace）；否则视同甩牌（accumulate）
  const kind: 'replace' | 'accumulate' = leadLen - forcedCount === 2 ? 'replace' : 'accumulate';
  return { kind, groups };
}

/**
 * 点击一张可选牌后的期望选中集（组粒度）。锁定牌始终保留。
 * - replace：该组已全选 → 放下（保留锁定）；否则放旧选新，只留锁定 + 新组
 * - accumulate：全选 → 整组放下（保留组内锁定）；否则整组补齐
 * - 无组映射的牌回退单卡 toggle
 */
export function applyGroupClick(
  selected: string[],
  locked: string[],
  mode: Exclude<SelectionMode, { kind: 'free' }>,
  cardId: string,
): string[] {
  const sel = new Set(selected);
  const group = mode.groups[cardId] ?? [cardId];
  const allSelected = group.every(id => sel.has(id));
  if (mode.kind === 'replace') {
    if (allSelected) return selected.filter(id => locked.includes(id));
    const out = selected.filter(id => locked.includes(id));
    group.forEach(id => { if (!out.includes(id)) out.push(id); });
    return out;
  }
  if (allSelected) return selected.filter(id => !(group.includes(id) && !locked.includes(id)));
  const out = [...selected];
  group.forEach(id => { if (!out.includes(id)) out.push(id); });
  return out;
}

/** 替换式拖拽拾取：返回候选牌所在组的期望选中集（无映射回退单卡）。 */
export function applyGroupDragPick(
  mode: Exclude<SelectionMode, { kind: 'free' }>,
  cardId: string,
): string[] {
  return mode.groups[cardId] ?? [cardId];
}

/** 拖拽终点落在不可选牌上：清空选择，仅保留锁定牌。 */
export function clearSelectionKeepLocked(selected: string[], locked: string[]): string[] {
  return selected.filter(id => locked.includes(id));
}

// ==================== 跟单张的强制拆对（可选牌恰为一对） ====================

export interface ForcedPairSplit {
  /** 应自动选中并锁定的那张（显示序左边一张） */
  selectId: string;
  /** 该对的全部 id（另一张据此灰显） */
  pairIds: string[];
}

/**
 * 跟单张领出时可选牌恰好只有一对（如同门只剩 ♥99，或缺门后仅剩主对毙单）：
 * 必须拆对出一张，出哪张对玩家无区别（引擎对两张对称处理）→ 自动选中显示序
 * 左边一张并锁定，另一张灰显不可点。非跟单张 / 可选数 ≠ 2 / 两张不成对 → null。
 */
export function detectForcedPairSplit(
  hand: Card[],
  trickPlays: GameState['trickPlays'],
  trump: TrumpDeclaration | null,
  phase: GamePhase,
): ForcedPairSplit | null {
  if (!trump || phase !== GamePhase.Playing) return null;
  if (trickPlays.length === 0 || trickPlays[0].cards.length !== 1) return null;
  const playable = computePlayableIds(hand, trickPlays, trump, phase)
    ?? new Set(hand.map(c => c.id));
  if (playable.size !== 2) return null;
  const two = hand.filter(c => playable.has(c.id));
  const [a, b] = two;
  if (a.suit !== b.suit || a.rank !== b.rank || a.isJoker) return null;
  const ordered = sortHand(two, trump);
  return { selectId: ordered[0].id, pairIds: ordered.map(c => c.id) };
}

// ==================== 桌面最大牌标记（纯展示，不改游戏状态） ====================

/**
 * 当前墩**暂时领先者**所出组合的全部牌 id（整组橙色描边标记）。
 * 部分墩（1-3 家已出）用引擎 computeBestSoFar 逐家比较，随每张落地实时更新；
 * 领出单独在桌上时即领出组合整组。
 */
export function findLeadingCardIds(
  trickPlays: GameState['trickPlays'],
  leadPlayerIndex: number,
  trump: TrumpDeclaration,
): Set<string> {
  if (trickPlays.length === 0) return new Set();
  const best = computeBestSoFar(trickPlays, leadPlayerIndex, trump);
  if (!best) return new Set();
  return new Set(best.cards.map(c => c.id));
}

/**
 * 已结算墩的**赢家**组合的全部牌 id（回看上墩 / 墩结算停留画面用，
 * 与实时领先口径一致：赢家即最终领先者，整组橙描边）。
 */
export function findWinningCardIds(trick: Trick): Set<string> {
  const off = (trick.winnerIndex - trick.leadPlayerIndex + 4) % 4;
  const play = trick.plays[off];
  if (!play) return new Set();
  return new Set(play.cards.map(c => c.id));
}

// ==================== 桌面出牌显示顺序（纯展示，不改游戏状态） ====================

/**
 * 桌布/回看面板上单墩出牌的显示顺序（从左到右）：
 * - 领出（同花色）：按单牌力度从大到小；主牌内部为 大王、小王、主级牌、
 *   副级牌（多张按 SHCD）、A、K……（即引擎 sortHand 的全局序）
 * - 跟牌：最左为领出花色组，其后按 主牌、副牌 SHCD（不含领出花色）依次排列，
 *   各组内部同样从大到小
 *
 * 实现：sortHand 已给出"主牌力度序 + 副牌 SHCD 序"；非主领出的跟牌只需把
 * 领出花色提到最前（其余保持相对顺序）。吊主（leadSuit null / =主花色）
 * 与无主局直接用 sortHand 序。不修改 trickPlays 存储顺序。
 */
export function orderTrickCardsForDisplay(
  cards: Card[],
  leadSuit: string | null,
  trump: TrumpDeclaration | null,
): Card[] {
  const sorted = sortHand(cards, trump);
  if (!trump || trump.trumpSuit === null || leadSuit === null || leadSuit === trump.trumpSuit) {
    return sorted;
  }
  const led = sorted.filter(c => c.suit === leadSuit);
  if (led.length === sorted.length) return sorted; // 领出花色本身：保持力度序
  return [...led, ...sorted.filter(c => c.suit !== leadSuit)];
}
