import type { useGameStore } from '../store/gameStore.js';

declare global {
  interface Window {
    /** Store exposed for automation (scripts/ui-dump.ts). */
    __POKER_STORE__: typeof useGameStore;
  }
}

export {};
