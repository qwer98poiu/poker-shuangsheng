import React, { useState, useEffect } from 'react';

/** 画布固定尺寸：所有组件必须在此范围内，超出即用户无法点击。 */
export const CANVAS_W = 1280;
export const CANVAS_H = 720;

const WindowSizeWarning: React.FC = () => {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const tooSmall = size.w < CANVAS_W || size.h < CANVAS_H;
  if (!tooSmall) return null;

  return (
    <div className="window-warning" data-testid="window-warning">
      ⚠️ 窗口过小（当前 {size.w}×{size.h}）：超出 {CANVAS_W}×{CANVAS_H} 画布的区域不可见/不可点击，请放大窗口
    </div>
  );
};

export default WindowSizeWarning;
