import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 只启动当前源码的临时回环服务；绝不向生产统计写入测试事件。
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = createRequire(import.meta.url).resolve('vite-node/cli');
const directory = await mkdtemp(join(tmpdir(), 'tyrants-ai-http-'));
const file = join(directory, 'stats.json');
let child: ChildProcess | undefined;
let output = '';
let base = '';
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}
async function launch() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  base = `http://127.0.0.1:${port}`;
  output = '';
  child = spawn(process.execPath, [cli, 'server/standalone.ts'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BIND_HOST: '127.0.0.1', CONTROL_PORT: String(port), LOCAL_AI_STATS_FILE: file },
  });
  const append = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-10000); };
  child.stdout!.on('data', append);
  child.stderr!.on('data', append);
  child.on('error', error => { output += error.message; });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error(`临时服务退出：${output}`);
    try {
      if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch { /* 仅等待本次启动的服务，不连接其他地址。 */ }
    await pause();
  }
  throw new Error(`临时服务启动超时：${output}`);
}
async function call(data?: unknown, origin?: string) {
  const response = await fetch(`${base}${data === undefined ? '/api/health' : '/api/local-ai/starts'}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: data === undefined ? undefined : { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, data: await response.json() as {
    ok?: boolean; duplicate?: boolean; error?: string; rooms?: number;
    local_ai?: { available: boolean; total?: number };
  } };
}
try {
  await launch();
  assert.equal((await call()).data.local_ai?.total, 0);
  const eventId = randomUUID();
  assert.equal((await call({ eventId })).status, 200);
  assert.equal((await call({ eventId })).data.duplicate, true);
  const health = (await call()).data;
  assert.equal(health.local_ai?.total, 1);
  assert.equal(health.rooms, 0, '本地 AI 事件不创建服务器房间');
  assert.equal((await call({ eventId: 'bad' })).status, 422);
  assert.equal((await call({ eventId, nickname: '不应上传的玩家资料' })).status, 422);
  assert.equal((await call({ eventId }, 'http://untrusted.invalid')).status, 403);
  let rateLimited = false;
  for (let index = 0; index < 31; index++) {
    if ((await call({ eventId })).status === 429) { rateLimited = true; break; }
  }
  assert.equal(rateLimited, true, '统计写入有独立限流');
  await stop();
  await launch();
  assert.equal((await call()).data.local_ai?.total, 1, '进程重启后保留统计');
  assert.equal((await call({ eventId })).data.duplicate, true);
  assert.equal((await call({ eventId: randomUUID() })).status, 200);
  assert.equal((await call()).data.local_ai?.total, 2);
  const snapshot = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(snapshot).sort(), ['days', 'firstStart', 'lastStart', 'recentIds', 'total', 'version']);
  await stop();
  await writeFile(file, 'corrupted');
  await launch();
  assert.equal((await call()).data.local_ai?.available, false);
  const failed = await call({ eventId: randomUUID() });
  assert.equal(failed.status, 503, '持久化不可用不能确认收件');
  assert.equal(await readFile(file, 'utf8'), 'corrupted');
  console.log('PASS HTTP: 匿名事件、参数与来源拒绝、限流、不占房间、进程重启及损坏文件保护。');
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
