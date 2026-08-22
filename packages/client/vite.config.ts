import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-only: dev server 内存里保留一份最新牌局快照（单槽，进程退出即消失）。
 * GET  /__poker-game-state -> {version, savedAt, snapshot: object|null}
 * POST /__poker-game-state -> 覆盖槽（{version, snapshot}）
 * 服务器对快照内容零解释、原样存取；仅同源 localhost 可达（无 CORS）。
 * 已知限制：多标签页共享单槽，后写覆盖——A 标签刷新可能恢复 B 标签的局。
 */
function gameStatePersist(): Plugin {
  const MAX_BYTES = 2 * 1024 * 1024;
  let slot: unknown = null;
  let savedAt: number | null = null;

  return {
    name: 'poker-game-state-persist',
    configureServer(server) {
      server.middlewares.use('/__poker-game-state', (req, res) => {
        if (req.method === 'GET') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ version: 1, savedAt, snapshot: slot }));
          return;
        }
        if (req.method === 'POST') {
          const chunks: Buffer[] = [];
          let size = 0;
          let rejected = false;
          req.on('data', (chunk: Buffer) => {
            if (rejected) return;
            size += chunk.length;
            if (size > MAX_BYTES) {
              // 超限立即拒绝，不继续缓冲
              rejected = true;
              res.statusCode = 413;
              res.end('snapshot too large');
              req.destroy();
              return;
            }
            chunks.push(chunk);
          });
          req.on('end', () => {
            if (rejected) return;
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              const phase = (body as { snapshot?: { gameState?: { phase?: unknown } } })
                ?.snapshot?.gameState?.phase;
              if (typeof phase !== 'string') {
                res.statusCode = 400;
                res.end('bad snapshot');
                return;
              }
              slot = body.snapshot;
              savedAt = Date.now();
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end('{"ok":true}');
            } catch {
              res.statusCode = 400;
              res.end('invalid json');
            }
          });
          req.on('error', () => {
            // 客户端中途断开：无从响应，忽略
          });
          return;
        }
        res.statusCode = 405;
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), gameStatePersist()],
  server: {
    port: 3000,
  },
});
