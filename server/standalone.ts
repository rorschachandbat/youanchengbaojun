import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, RoomService, type RoomConfig } from './rooms';

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
const config: RoomConfig = {
  maxRooms: integer('MAX_ROOMS', 100, 1, 100),
  reserveMb: integer('RESERVE_MB', 300, 0, 65536),
  idleMs: integer('ROOM_IDLE_SECONDS', 300, 1, 86400) * 1000,
  disconnectMs: integer('DISCONNECT_SECONDS', 120, 5, 3600) * 1000,
};
const rooms = new RoomService(config);
const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const buckets = new Map<string, { used: number; until: number }>();
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
// 单进程串行提交房间变更与落子，避免重复开局、清理与提交交错。
let tail: Promise<unknown> = Promise.resolve();
let pending = 0;
function serial<T>(fn: () => Promise<T>): Promise<T> {
  if (pending >= 128) return Promise.reject(new ApiError(503, 'server_busy'));
  pending++;
  const result = tail.then(fn);
  tail = result.catch(() => {}).finally(() => { pending--; });
  return result;
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': types['.json']!, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(body));
}
function rate(key: string, max: number) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.until <= now) {
    if (buckets.size > 10000) throw new ApiError(503, 'server_busy');
    bucket = { used: 0, until: now + 60000 };
    buckets.set(key, bucket);
  }
  if (++bucket.used > max) throw new ApiError(429, 'rate_limited');
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.method !== 'POST') return {};
  if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'json_required');
  if (Number(req.headers['content-length'] ?? 0) > 16384) throw new ApiError(413, 'body_too_large');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new ApiError(413, 'body_too_large');
    chunks.push(chunk);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new ApiError(400, 'invalid_json'); }
}
async function api(req: IncomingMessage, url: URL) {
  const ip = req.socket.remoteAddress ?? 'unknown';
  rate(ip, 600);
  if (req.method === 'POST' && url.pathname === '/api/rooms') rate(`create:${ip}`, 5);
  if (req.method === 'POST' && url.pathname === '/api/rooms/join') rate(`join:${ip}`, 60);
  // 拒绝其他网站发起的浏览器写请求；HTTP 正文仍不承载账号密码。
  if (req.headers.origin && req.headers.origin !== url.origin) throw new ApiError(403, 'invalid_origin');
  const data = await body(req);
  return serial(async () => {
    await rooms.reap();
    const method = req.method ?? 'GET';
    const token = url.searchParams.get('as') ?? '';
    if (method === 'GET' && url.pathname === '/api/health') return rooms.health();
    if (method === 'POST' && url.pathname === '/api/rooms') return rooms.create(data);
    if (method === 'POST' && url.pathname === '/api/rooms/join') return rooms.join(data);
    const room = /^\/api\/rooms\/(\d{6})(?:\/(start|leave))?$/.exec(url.pathname);
    if (room) {
      if (method === 'GET' && !room[2]) return rooms.status(room[1]!, token);
      if (method === 'POST' && room[2] === 'start') return rooms.start(room[1]!, token);
      if (method === 'POST' && room[2] === 'leave') return rooms.leave(room[1]!, token);
    }
    const game = /^\/api\/games\/([a-zA-Z0-9_-]+)(?:\/(legal|submit|chat))?$/.exec(url.pathname);
    if (game) return rooms.game(method, game[1]!, game[2], token, data);
    throw new ApiError(404, 'not_found');
  });
}
const server = createServer({ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      json(res, 200, await api(req, url));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError(405, 'method_not_allowed');
    const pathname = decodeURIComponent(url.pathname);
    const spa = pathname === '/' || /^\/(?:lobby|solo)\/?$/.test(pathname) || /^\/room\/\d{6}\/?$/.test(pathname);
    const file = resolve(root, spa ? 'index.html' : `.${pathname}`);
    if (!file.startsWith(root + sep) || pathname.includes('\0')) throw new ApiError(404, 'not_found');
    let stat;
    try { stat = statSync(file); } catch { throw new ApiError(404, 'not_found'); }
    if (!stat.isFile()) throw new ApiError(404, 'not_found');
    res.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Length': stat.size, 'X-Content-Type-Options': 'nosniff',
      // 只有内容哈希命名的图片长期缓存，更新图片时 URL 自动变化；页面和 API 不缓存。
      'Cache-Control': pathname.startsWith('/assets/') || /^\/media\/[a-f0-9]{64}\.webp$/.test(pathname)
        ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Referrer-Policy': 'no-referrer',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    const message = error instanceof Error ? error.message : '';
    const status = error instanceof ApiError ? error.status
      : message.includes('Not your turn') ? 403
      : message.includes('already exists') ? 409
      : /Illegal action|legal|invalid|rejected|required/i.test(message) ? 422 : 500;
    if (status === 500) console.error('[HTTP] request failed', error);
    json(res, status, { ok: false, error: error instanceof ApiError ? error.code
      : status === 403 ? 'not_your_turn' : status === 409 ? 'stale_state' : status === 422 ? 'invalid_action' : 'server_error' });
  }
});
const timer = setInterval(() => {
  for (const [key, bucket] of buckets) if (bucket.until < Date.now()) buckets.delete(key);
  void serial(() => rooms.reap()).catch(error => console.error('[ROOM] cleanup failed', error));
}, 5000);
timer.unref();
const port = integer('CONTROL_PORT', 8080, 1024, 65535);
server.listen(port, process.env.BIND_HOST ?? '0.0.0.0', () => console.info('[HTTP] listening', port));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  clearInterval(timer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
});
