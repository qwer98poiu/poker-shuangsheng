import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import { useGameStore } from './store/gameStore.js';
import { devParams } from './dev.js';
import './styles/global.css';

// Expose the store for automation: scripts/ui-dump.ts reads the full
// GameState + UI state via window.__POKER_STORE__.getState().
(window as unknown as { __POKER_STORE__?: typeof useGameStore }).__POKER_STORE__ = useGameStore;

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
