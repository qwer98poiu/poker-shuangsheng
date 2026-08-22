import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import { useGameStore } from './store/gameStore.js';
import { attachPersistence, persistenceEnabled, restoreFromServer } from './store/persistence.js';
import { devParams } from './dev.js';
// global.css 由 index.html <link> 加载（冷启动时先于 JS 上色），此处不再重复引入

// Expose the store for automation: scripts/ui-dump.ts reads the full
// GameState + UI state via window.__POKER_STORE__.getState().
(window as unknown as { __POKER_STORE__?: typeof useGameStore }).__POKER_STORE__ = useGameStore;

// Dev-server 内存快照：进程存活期间刷新浏览器不丢局（进程退出存档自然消失）。
// 自动化流（?auto/?seed）在 persistenceEnabled 内绕过。
const BOOTSTRAP_TIMEOUT_MS = 800;

/**
 * 异步引导：先渲染"加载中……"，再检测快照——有则恢复进牌局，无则进 setup。
 * 直接渲染 App 会先闪一帧 setup 面板再切牌局；白屏等待又像卡死。
 * 本地 GET 仅几毫秒；race 超时兜底防 server 挂起卡在加载页；
 * restore 内部异常也不能阻断后续渲染。root 只创建一次，render 可重复调用。
 */
async function bootstrap(): Promise<void> {
  const root = ReactDOM.createRoot(document.getElementById('root')!);
  if (persistenceEnabled()) {
    root.render(<div className="boot-loading">加载中……</div>);
    attachPersistence(useGameStore);
    await Promise.race([
      restoreFromServer(useGameStore).catch(() => {}),
      new Promise(resolve => setTimeout(resolve, BOOTSTRAP_TIMEOUT_MS)),
    ]);
  }
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// ?auto=1: start a 4-AI spectator match on load. Module-level code runs once
// (StrictMode only double-invokes renders/effects), but guard anyway so a
// future hot reload can never start a second match.
if (devParams.auto) {
  const s = useGameStore.getState();
  if (s.mode === 'setup') {
    useGameStore.getState().startGame([true, true, true, true], false);
  }
}

void bootstrap();
