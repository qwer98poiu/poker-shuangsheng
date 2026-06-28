import React, { useState } from 'react';

interface SetupPanelProps {
  onStart: (aiConfig: boolean[], debug: boolean) => void;
}

const SetupPanel: React.FC<SetupPanelProps> = ({ onStart }) => {
  const [aiConfig, setAiConfig] = useState<boolean[]>([false, true, true, true]);
  const [debug, setDebug] = useState(false);

  const toggleAi = (index: number) => {
    const next = [...aiConfig];
    next[index] = !next[index];
    setAiConfig(next);
  };

  const humanCount = aiConfig.filter(v => !v).length;
  const isSpectator = humanCount === 0;

  const positions = ['南', '东', '北 (队友)', '西'];

  return (
    <div className="setup-panel">
      <h1>🃏 双升 (拖拉机)</h1>
      <p className="setup-subtitle">升级扑克牌游戏 — 4人对战，2副牌</p>

      <div className="setup-players">
        {aiConfig.map((isAi, i) => (
          <div key={i} className="setup-player-row">
            <span className="setup-player-pos">{positions[i]}</span>
            <button
              className={`setup-toggle ${isAi ? 'ai' : 'human'}`}
              onClick={() => toggleAi(i)}
            >
              {isAi ? '🤖 AI' : '👤 人类'}
            </button>
          </div>
        ))}
      </div>

      <div className="setup-summary">
        {isSpectator ? '👀 观战模式 — 4 AI 自动对战' : `${humanCount} 人类 + ${4 - humanCount} AI`}
      </div>

      <div className="setup-debug">
        <label className="debug-label">
          <input
            type="checkbox"
            checked={debug}
            onChange={e => setDebug(e.target.checked)}
          />
          <span>调试模式（显示 AI 出牌理由 + 回看 + 提示）</span>
        </label>
      </div>

      <button
        className="setup-start-btn"
        onClick={() => onStart(aiConfig, debug)}
      >
        开始游戏
      </button>
    </div>
  );
};

export default SetupPanel;
