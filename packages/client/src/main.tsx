import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import { useGameStore } from './store/gameStore.js';
import { attachPersistence, persistenceEnabled, restoreFromServer } from './store/persistence.js';
import { devParams } from './dev.js';
import './styles/global.css';

// Expose the store for automation: scripts/ui-dump.ts reads the full
// GameState + UI state via window.__POKER_STORE__.getState().
(window as unknown as { __POKER_STORE__?: typeof useGameStore }).__POKER_STORE__ = useGameStore;

// Dev-server 内存快照：进程存活期间刷新浏览器不丢局（进程退出存档自然消失）。
// 模块级执行一次；自动化流（?auto/?seed）在 persistenceEnabled 内绕过。
if (persistenceEnabled()) {
  attachPersistence(useGameStore);
  void restoreFromServer(useGameStore);
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
