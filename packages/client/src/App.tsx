import React from 'react';
import { useGameStore } from './store/gameStore.js';
import SetupPanel from './components/game/SetupPanel.js';
import GameTable from './components/game/GameTable.js';
import WindowSizeWarning from './components/WindowSizeWarning.js';

const App: React.FC = () => {
  const mode = useGameStore(s => s.mode);
  const startGame = useGameStore(s => s.startGame);

  return (
    <div className="app-shell">
      {/* 窗口 <1280×720 时警告（fixed 视口级，任何大小都可见） */}
      <WindowSizeWarning />
      <div className="game-frame">
        {mode === 'setup' ? (
          <div className="app-container">
            <SetupPanel onStart={(aiConfig: boolean[], debug: boolean) => startGame(aiConfig, debug)} />
          </div>
        ) : (
          <GameTable />
        )}
      </div>
    </div>
  );
};

export default App;
