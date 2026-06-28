import React from 'react';
import { useGameStore } from './store/gameStore.js';
import SetupPanel from './components/game/SetupPanel.js';
import GameTable from './components/game/GameTable.js';

const App: React.FC = () => {
  const mode = useGameStore(s => s.mode);
  const startGame = useGameStore(s => s.startGame);

  if (mode === 'setup') {
    return (
      <div className="app-container">
        <SetupPanel onStart={(aiConfig: boolean[], debug: boolean) => startGame(aiConfig, debug)} />
      </div>
    );
  }

  return <GameTable />;
};

export default App;
