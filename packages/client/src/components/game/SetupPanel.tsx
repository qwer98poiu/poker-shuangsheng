import React, { useState } from 'react';

interface SetupPanelProps {
  onStart: (aiConfig: boolean[], debug: boolean, autoGrabDealer: boolean) => void;
}

const SetupPanel: React.FC<SetupPanelProps> = ({ onStart }) => {
  const [aiConfig, setAiConfig] = useState<boolean[]>([false, true, true, true]);
  const [debug, setDebug] = useState(false);
  const [autoGrabDealer, setAutoGrabDealer] = useState(true);

  const toggleAi = (index: number) => {
    // Only seat 0 (南, the human player) can toggle; seats 1-3 stay AI.
    if (index !== 0) return;
    setAiConfig(next => {
      const n = [...next];
      n[0] = !n[0];
      return n;
    });
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
              disabled={i !== 0 && !isAi}
              title={i !== 0 ? '仅南座可为人类' : ''}
            >
              {isAi ? '🤖 AI' : '👤 人类'}
            </button>
            {i !== 0 && !isAi && <span className="setup-locked">(锁定)</span>}
          </div>
        ))}
      </div>

      <div className="setup-summary">
        {isSpectator
          ? '👀 观战模式 — 4 AI 自动对战'
          : `1 人类 (南) + 3 AI`}
      </div>

      <div className="setup-debug">
        <label className="debug-label">
          <input
            type="checkbox"
            data-testid="setup-autograb"
            checked={autoGrabDealer}
            onChange={e => setAutoGrabDealer(e.target.checked)}
          />
          <span>首局自动抢庄（无主除外）</span>
        </label>
      </div>

      <div className="setup-debug">
        <label className="debug-label">
          <input
            type="checkbox"
            data-testid="setup-debug"
            checked={debug}
            onChange={e => setDebug(e.target.checked)}
          />
          <span>调试模式（显示 AI 出牌理由 + 回看 + 提示）</span>
        </label>
      </div>

      <button
        className="setup-start-btn"
        data-testid="setup-start"
        onClick={() => onStart(aiConfig, debug, autoGrabDealer)}
      >
        开始游戏
      </button>
    </div>
  );
};

export default SetupPanel;
