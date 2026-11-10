import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAiStats, isStartId } from '../server/local-ai-stats';
import { flushLocalAiStarts, recordLocalAiStart } from '../src/local-ai-start';

const directory = await mkdtemp(join(tmpdir(), 'tyrants-ai-stats-'));
const originalFetch = globalThis.fetch;
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalInfo = console.info;
const key = 'totu.local-ai-starts.v1';
const restoredId = randomUUID();
const storage = new Map([[key, JSON.stringify(['bad-entry', restoredId])]]);
const requests: { url: string; init: RequestInit }[] = [];
let failure = true;
let accepted = false;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
console.info = () => {};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (name: string) => storage.get(name) ?? null,
  setItem: (name: string, value: string) => { storage.set(name, value); },
} });
globalThis.fetch = (async (input: string | URL | Request, init: RequestInit) => {
  requests.push({ url: String(input), init });
  if (failure) throw new Error('模拟离线');
  return new Response(JSON.stringify({ ok: accepted }), { status: 200 });
}) as typeof fetch;
try {
  const file = join(directory, 'stats.json');
  let now = Date.parse('2026-11-10T15:59:59Z');
  const stats = new LocalAiStats(file, () => now);
  assert.deepEqual(await stats.summary(), {
    available: true, total: 0, today: 0, last_7_days: 0,
    first_start: null, last_start: null, timezone: 'Asia/Shanghai',
  });
  const id = randomUUID();
  assert.equal(isStartId(id), true);
  assert.equal(isStartId('not-an-id'), false);
  await assert.rejects(stats.record('invalid'));
  await Promise.all([stats.record(id), stats.record(id), stats.record(randomUUID())]);
  assert.equal((await stats.summary()).total, 2, '并发重复请求只记一次');
  now += 2000;
  await stats.record(randomUUID());
  assert.equal((await stats.summary()).today, 1, '北京时间午夜切日');
  assert.equal((await stats.summary()).last_7_days, 3);
  const restarted = new LocalAiStats(file, () => now);
  assert.equal((await restarted.summary()).total, 3, '重建实例保留累计数');
  assert.equal((await restarted.record(id)).duplicate, true, '重启保留最近去重记录');
  now = Date.parse('2026-11-17T00:00:00Z');
  assert.equal((await stats.summary()).last_7_days, 1, '最近七个北京时间自然日');
  now = Date.parse('2026-11-18T00:00:00Z');
  assert.equal((await stats.summary()).last_7_days, 0);

  const beforeFailure = await readFile(file, 'utf8');
  await mkdir(`${file}.tmp`);
  await assert.rejects(stats.record(randomUUID()), '写盘失败不能确认收件');
  assert.equal((await stats.summary()).total, 3, '写盘失败不能增加内存统计');
  assert.equal(await readFile(file, 'utf8'), beforeFailure, '写盘失败不能破坏原文件');
  await rm(`${file}.tmp`, { recursive: true });
  await stats.record(randomUUID());
  assert.equal((await stats.summary()).total, 4, '队列可从写盘失败恢复');

  const boundedFile = join(directory, 'bounded.json');
  const seed = JSON.parse(await readFile(file, 'utf8'));
  seed.days = Object.fromEntries(Array.from({ length: 31 }, (_, index) =>
    [`2026-10-${String(index + 1).padStart(2, '0')}`, 1]));
  seed.recentIds = Array.from({ length: 2048 }, () => randomUUID());
  await writeFile(boundedFile, JSON.stringify(seed));
  await new LocalAiStats(boundedFile, () => now).record(randomUUID());
  const bounded = JSON.parse(await readFile(boundedFile, 'utf8'));
  assert.equal(Object.keys(bounded.days).length, 31);
  assert.equal(bounded.recentIds.length, 2048, '统计文件与去重内存有固定上限');

  const corruptFile = join(directory, 'corrupt.json');
  await writeFile(corruptFile, '{"version":1,"total":"broken"}');
  const corrupt = new LocalAiStats(corruptFile);
  await assert.rejects(corrupt.summary());
  await assert.rejects(corrupt.record(randomUUID()));
  assert.equal(await readFile(corruptFile, 'utf8'), '{"version":1,"total":"broken"}', '损坏文件不能被零值覆盖');

  if (import.meta.env.VITE_FRIENDS_ONLY === 'true') {
    await flushLocalAiStarts();
    assert.equal(requests.length, 1, '进入页面补报历史待发事件');
    assert.equal(JSON.parse(requests[0]!.init.body as string).eventId, restoredId);
    failure = false;
    await flushLocalAiStarts();
    assert.ok(JSON.parse(storage.get(key)!).includes(restoredId), '只有明确确认成功才能移除');
    accepted = true;
    const beforeFlush = requests.length;
    await Promise.all([flushLocalAiStarts(), flushLocalAiStarts()]);
    assert.equal(requests.length, beforeFlush + 1);
    assert.equal(JSON.parse(storage.get(key)!).length, 0, '并发补报不会重复发送');
    const baseline = requests.length;
    await flushLocalAiStarts();
    assert.equal(requests.length, baseline, '没有新开局不会产生新事件');
    recordLocalAiStart();
    await tick();
    assert.equal(requests.length, baseline + 1);
    const sent = requests.at(-1)!;
    assert.equal(sent.url, '/api/local-ai/starts');
    assert.deepEqual(Object.keys(JSON.parse(sent.init.body as string)), ['eventId']);
    assert.equal(isStartId(JSON.parse(sent.init.body as string).eventId), true);
    assert.equal(sent.init.keepalive, true);
    failure = true;
    for (let index = 0; index < 25; index++) recordLocalAiStart();
    await tick();
    assert.equal(JSON.parse(storage.get(key)!).length, 20, '断网待发队列有上限');
    const retryId = JSON.parse(storage.get(key)!)[0];
    await flushLocalAiStarts();
    assert.equal(JSON.parse(requests.at(-1)!.init.body as string).eventId, retryId, '重试使用同一事件标识');
    failure = false;
    await flushLocalAiStarts();
    assert.equal(JSON.parse(storage.get(key)!).length, 0);
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    assert.doesNotThrow(recordLocalAiStart, '统计能力异常不能打断开局');
  } else {
    recordLocalAiStart();
    await flushLocalAiStarts();
    assert.equal(requests.length, 0, '普通本地开发版不发送好友服统计');
  }
} finally {
  globalThis.fetch = originalFetch;
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
  console.info = originalInfo;
  await rm(directory, { recursive: true, force: true });
}
console.log('PASS: 本地 AI 聚合持久化、并发去重、日期边界、写盘故障、固定容量及客户端补报隔离。');
