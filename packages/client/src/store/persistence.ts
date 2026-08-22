import type { Card, Trick } from '@poker/engine';
import { GamePhase } from '@poker/engine';
import type { StoreApi, UseBoundStore } from 'zustand';
import { devParams, type DevParams } from '../dev.js';
import { tick, type GameStore } from './gameStore.js';

const SAVE_URL = '/__poker-game-state';
/**
 * 节流间隔：连续变更（如发牌每 15ms 一次 set）下至多每这么久落盘一次。
 * 纯 trailing 防抖会被持续变更无限顺延——整个发牌期间一次都存不出去。
 */
export const SAVE_INTERVAL_MS = 400;
export const SNAPSHOT_VERSION = 2;
const VERSION = SNAPSHOT_VERSION;

type GameStoreApi = UseBoundStore<StoreApi<GameStore>>;

/**
 * 快照 JSON 的 base64 编解码。目的：URL/curl/F12 里看不到明文手牌——
 * 防普通用户手滑剧透的混淆；base64 是编码不是加密，不防有意解码。
 */
export function encodeSnapshot(snapshot: Snapshot): string {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  let bin = '';
  const CHUNK = 0x8000; // 分块避免 String.fromCharCode 参数爆栈
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function decodeSnapshot(data: string): Snapshot {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes)) as Snapshot;
}

/** 快照白名单：恢复一局所需的全部持久化字段（瞬态 UI 字段一律不入快照）。 */
export interface Snapshot {
  gameState: GameStore['gameState'];
  localPlayerIndex: number;
  aiPlayers: boolean[];
  debug: boolean;
  roundNumber: number;
  teamLevels: [number, number];
  matchOver: boolean;
  message: string;
  settledTrick: Trick | null;
  /** 发牌阶段的洗牌结果（108 张）：发牌中刷新从断点续发所需；其余阶段为 null。 */
  dealingDeck: Card[] | null;
}

/** 线格式：data 为快照 JSON 的 base64（非明文）。 */
export interface Envelope {
  version: number;
  savedAt: number | null;
  data: string;
}

/**
 * 自动化流（?auto=1 / ?seed=N）完全绕过持久化：保持脚本确定性，
 * 也不读写人工对局的存档。
 */
export function persistenceEnabled(p: DevParams = devParams): boolean {
  return !(p.auto || p.seed !== null);
}

/**
 * 从 store 状态挑出快照字段。发牌阶段仅在洗牌堆可用时才可快照——
 * runDealStep 靠 dealingDeck 续发，没有它发牌不可恢复（保留槽里的旧快照）。
 */
export function pickSnapshot(s: GameStore): Snapshot | null {
  const gs = s.gameState;
  if (s.mode !== 'playing' || !gs) return null;
  if (gs.phase === GamePhase.Dealing && !s.dealingDeck) return null;
  return {
    gameState: gs,
    localPlayerIndex: s.localPlayerIndex,
    aiPlayers: [...s.aiPlayers] as [boolean, boolean, boolean, boolean],
    debug: s.debug,
    roundNumber: s.roundNumber,
    teamLevels: [...s.teamLevels] as [number, number],
    matchOver: s.matchOver,
    message: s.message,
    settledTrick: s.settledTrick,
    dealingDeck: s.dealingDeck ? [...s.dealingDeck] : null,
  };
}

/** GET 拉回线格式并解码为快照；版本不符/数据损坏抛错（调用方落回 setup）。 */
async function loadSnapshot(fetchImpl: typeof fetch): Promise<Snapshot> {
  const res = await fetchImpl(SAVE_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${SAVE_URL} -> ${res.status}`);
  const env: Envelope = await res.json();
  if (env?.version !== VERSION || typeof env?.data !== 'string') {
    throw new Error('incompatible envelope');
  }
  return decodeSnapshot(env.data);
}

/**
 * 订阅 store，节流保存最新快照到 dev server 内存单槽：
 * 首次变更立即落盘（开局/发牌开始瞬间即有存档），持续变更期间每
 * SAVE_INTERVAL_MS 至多一次（冷却结束时补发 trailing），空闲后单次变更即时保存。
 * pickSnapshot 为 null（未开局/无牌堆的发牌）时取消挂起保存并直接 return：
 * 绝不能 POST {snapshot:null} 清槽。返回退订函数。POST 失败静默——持久化永不干扰对局。
 */
export function attachPersistence(
  store: GameStoreApi,
  opts: { enabled?: boolean; fetchImpl?: typeof fetch; intervalMs?: number } = {},
): () => void {
  if (!(opts.enabled ?? persistenceEnabled())) return () => {};
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
  const interval = opts.intervalMs ?? SAVE_INTERVAL_MS;
  let latest: Snapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSaveAt = 0;

  const save = (snap: Snapshot) => {
    doFetch(SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: VERSION, data: encodeSnapshot(snap) }),
    }).catch(() => {});
  };

  const unsubscribe = store.subscribe(state => {
    const snap = pickSnapshot(state);
    if (!snap) {
      latest = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return;
    }
    latest = snap;
    const remain = lastSaveAt + interval - Date.now();
    if (remain <= 0) {
      // 冷却已过：立即落盘（取消挂起的 trailing，它已包含在本次里）
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      lastSaveAt = Date.now();
      save(snap);
    } else if (!timer) {
      // 冷却中：挂一个冷却结束时的 trailing 保存
      timer = setTimeout(() => {
        timer = null;
        if (!latest) return;
        lastSaveAt = Date.now();
        save(latest);
      }, remain);
    }
  });

  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe();
  };
}

/** 恢复中的并发保护：第二次调用直接放弃（完成后靠 mode!=='setup' 拦截）。 */
let restoreInFlight = false;

/**
 * 页面加载时从 dev server 拉回快照并恢复牌局，随后按 phase 续链：
 * - dealing → runDealStep(dealingDeck) 从断点续发（洗牌堆随快照保存）
 * - revealing 全 AI → 重挂 finalize 定时器；含人类 → GameTable 亮主自动确认 effect 接管
 * - playing / round_end → runAiTurns() 重建 AI 链（round_end+matchOver 原地停）
 * - bottom_exchange → 等人类扣底，无需 kick
 * 返回是否实际恢复了牌局。
 */
export async function restoreFromServer(
  store: GameStoreApi,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<boolean> {
  if (restoreInFlight || store.getState().mode !== 'setup') return false;
  restoreInFlight = true;
  try {
    let snap: Snapshot;
    try {
      snap = await loadSnapshot(fetchImpl);
    } catch {
      return false; // 无存档 / server 不在 / 数据损坏 → setup 界面
    }
    if (!snap?.gameState || store.getState().mode !== 'setup') return false;
    // 结构校验：出牌相关阶段必有亮主结果（缺了 buildAIContext 返回 null，续链即崩）；
    // 发牌阶段必有完整洗牌堆（108 张），否则无法续发
    const gsPhase = snap.gameState.phase;
    const needsTrump = gsPhase === GamePhase.Playing || gsPhase === GamePhase.RoundEnd
      || gsPhase === GamePhase.BottomExchange;
    if (needsTrump && !snap.gameState.trumpDeclaration) return false;
    if (gsPhase === GamePhase.Dealing && snap.dealingDeck?.length !== 108) return false;

    store.setState({
      mode: 'playing',
      gameState: snap.gameState,
      localPlayerIndex: snap.localPlayerIndex,
      aiPlayers: snap.aiPlayers,
      debug: snap.debug,
      roundNumber: snap.roundNumber,
      teamLevels: snap.teamLevels,
      matchOver: snap.matchOver,
      message: snap.message ?? '',
      settledTrick: snap.settledTrick ?? null,
      dealingDeck: snap.dealingDeck ?? null,
      // 瞬态 UI 字段一律复位（选中/锁定由 GameTable effect 在人类回合重新推导）
      selectedCardIds: [],
      lockedCardIds: [],
      highlightedCards: [],
      lastTrickReview: false,
      errorMessage: null,
    });

    const st = store.getState();
    const gs = st.gameState!;
    switch (gs.phase) {
      case GamePhase.Dealing:
        // 校验已保证 dealingDeck 存在：从断点继续逐张发牌
        store.getState().runDealStep(st.dealingDeck!);
        break;
      case GamePhase.Revealing:
        if (st.aiPlayers.every(Boolean)) {
          setTimeout(() => store.getState().finalizeRevealAndBottom(), tick(300));
        }
        break;
      case GamePhase.Playing:
      case GamePhase.RoundEnd:
        store.getState().runAiTurns();
        break;
      default:
        break; // bottom_exchange 等人类操作
    }
    return true;
  } finally {
    restoreInFlight = false;
  }
}
