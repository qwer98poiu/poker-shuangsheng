import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-only: dev server 内存里保留一份最新牌局快照（单槽，进程退出即消失）。
 * GET  /__poker-game-state -> {version, savedAt, data: string|null}
 * POST /__poker-game-state -> 覆盖槽（{version, data}）
 * data 为快照 JSON 的 base64 编码——URL/F12 里看不到明文手牌（防普通用户
 * 手滑剧透的混淆；base64 是编码不是加密）。服务器解码做最小校验后原样
 * 存字符串，不理解内容。仅同源 localhost 可达（无 CORS）。
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
          const slotBody = slot as { version?: number; data?: string } | null;
          res.end(JSON.stringify({
            version: slotBody?.version ?? 1,
            savedAt,
            data: slotBody?.data ?? null,
          }));
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
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as
                { version?: number; data?: string };
              if (!body || typeof body.data !== 'string') {
                res.statusCode = 400;
                res.end('bad snapshot');
                return;
              }
              // 解码校验（防垃圾数据入槽），但只原样存编码串——服务器不理解内容
              const decoded = JSON.parse(Buffer.from(body.data, 'base64').toString('utf8')) as
                { gameState?: { phase?: unknown } };
              if (typeof decoded?.gameState?.phase !== 'string') {
                res.statusCode = 400;
                res.end('bad snapshot');
                return;
              }
              slot = { version: body.version ?? 1, data: body.data };
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
    // 启动时后台预转换客户端源码，缩短冷启动后首次打开的白屏等待
    warmup: {
      clientFiles: ['./src/main.tsx', './src/**/*.tsx', './src/**/*.ts', './src/**/*.css'],
    },
  },
});
