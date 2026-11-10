import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { allCards } from '../src/card-data';
import { getImageBlobUrl, evictImageFromCache } from '../src/image-cache';
import { getServerImageMode, loadServerImage, preloadServerImages, serverImagePack, setServerImageMode, serverImageUrl, serverImageCacheStatus } from '../src/server-images';
import manifest from '../src/server-image-manifest.json';

const originalFetch = globalThis.fetch;
const originalIndexedDB = globalThis.indexedDB;
const originalLocalStorage = globalThis.localStorage;
const files = new Map(Object.values(manifest.images).map(image => [image.file, image]));
const saved = new Map<IDBValidKey, unknown>();
const requests: string[] = [];
let failPath: string | undefined;
let fullStorage = false;
let abortDownload: AbortController | undefined;

// 用异步事务替身验证真实缓存分支，不依赖外网或新增测试依赖。
function installStorage() {
  globalThis.indexedDB = {
    open() {
      const request: any = {};
      setTimeout(() => {
        request.result = {
          objectStoreNames: { contains: () => true }, close() {},
          transaction() {
            const transaction: any = {};
            const operation = (fn: () => unknown) => {
              const result: any = {};
              setTimeout(() => {
                try { result.result = fn(); transaction.oncomplete?.(); }
                catch (error) { result.error = error; transaction.onerror?.(); }
              }, 0);
              return result;
            };
            transaction.objectStore = () => ({
              get: (key: IDBValidKey) => operation(() => saved.get(key)),
              getAllKeys: () => operation(() => [...saved.keys()]),
              delete: (key: IDBValidKey) => operation(() => saved.delete(key)),
              put: (value: unknown, key: IDBValidKey) => operation(() => {
                if (fullStorage) throw new DOMException('full', 'QuotaExceededError');
                saved.set(key, value); return key;
              }),
            });
            return transaction;
          },
        };
        request.onsuccess?.();
      }, 0);
      return request;
    },
  } as unknown as IDBFactory;
}
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  requests.push(url);
  assert.match(url, /^\/media\/[a-f0-9]{64}\.webp$/, '图片只能来自本站内容哈希路径');
  const image = files.get(url.slice(1))!;
  assert.ok(image);
  if (abortDownload) { abortDownload.abort(); throw new DOMException('cancelled', 'AbortError'); }
  if (url === failPath) return new Response('missing', { status: 404 });
  return new Response(new Blob([new Uint8Array(image.bytes)], { type: 'image/webp' }), { headers: { 'Content-Type': 'image/webp' } });
}) as typeof fetch;
try {
  globalThis.localStorage = { getItem: () => 'server' } as unknown as Storage;
  assert.equal(getServerImageMode(), 'local', '旧按需加载偏好必须迁移为预下载');
  globalThis.localStorage = originalLocalStorage;
  for (const image of files.values()) {
    const bytes = readFileSync(new URL(`../assets/${image.file}`, import.meta.url));
    assert.equal(bytes.length, image.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), image.file.slice(6, -5));
  }
  const unavailable = await preloadServerImages(() => {});
  assert.equal(unavailable.storageFailed, true);
  assert.equal(requests.length, 0, '存储不可用时不要浪费整包流量');
  installStorage();
  const first = await preloadServerImages(() => {});
  assert.equal(first.done, serverImagePack.count);
  assert.equal(first.bytes, serverImagePack.bytes);
  assert.equal(requests.length, files.size);
  assert.equal(await serverImageCacheStatus(), files.size);
  requests.length = 0;
  assert.equal((await preloadServerImages(() => {})).done, files.size);
  assert.equal(requests.length, 0, '再次进入不应重新下载已保存图片');
  setServerImageMode('local');
  const card = allCards()[0]!;
  assert.match(await getImageBlobUrl(card.image), /^blob:/);
  assert.equal(requests.length, 0, '本地模式命中缓存时不访问服务器');

  await evictImageFromCache(card.image);
  await assert.rejects(() => getImageBlobUrl(card.image), /image_not_cached/, '缺图时不能边玩边下载');
  assert.equal(requests.length, 0, '缺图也不能联网补齐');
  const damagedFile = files.values().next().value!;
  saved.set(damagedFile.file, new Blob(['truncated'], { type: 'image/webp' }));
  assert.ok(await serverImageCacheStatus() < files.size, '缓存就绪必须校验大小和格式，不能只看键');
  saved.delete(damagedFile.file);
  await preloadServerImages(() => {});
  requests.length = 0;
  await evictImageFromCache(card.image);
  failPath = serverImageUrl(card.image);
  const partial = await preloadServerImages(() => {});
  assert.equal(partial.failed, 1);
  assert.equal(partial.done, files.size - 1);
  assert.deepEqual(requests, [failPath, failPath], '只重试缺失文件');
  requests.length = 0;
  failPath = undefined;
  assert.equal((await preloadServerImages(() => {})).done, files.size);
  assert.deepEqual(requests, [serverImageUrl(card.image)], '继续下载时复用已完成部分');
  requests.length = 0;

  await evictImageFromCache(card.image);
  abortDownload = new AbortController();
  assert.equal((await preloadServerImages(() => {}, abortDownload.signal)).cancelled, true);
  abortDownload = undefined;
  fullStorage = true;
  requests.length = 0;
  assert.equal((await preloadServerImages(() => {})).storageFailed, true);
  assert.equal(requests.length, 0, '空间不足时先提示，不启动下载');
  fullStorage = false;
  await assert.rejects(() => getImageBlobUrl(card.image), /image_not_cached/);
  assert.equal(requests.length, 0, '存储失败后不能回退到按需下载');
  await preloadServerImages(() => {});
  requests.length = 0;
  setServerImageMode('none');
  await assert.rejects(() => getImageBlobUrl(card.image), /images_disabled/, '无图模式不能复用图片 URL');
  await assert.rejects(() => loadServerImage(card.image), /images_disabled/);
  assert.equal(requests.length, 0, '无图模式不下载图片');
  console.log(`PASS: ${files.size} 个压缩资源哈希、完整缓存校验、缺图不联网、无图模式、断点继续、取消和存储失败。`);
} finally {
  setServerImageMode('local');
  globalThis.fetch = originalFetch;
  globalThis.indexedDB = originalIndexedDB;
  globalThis.localStorage = originalLocalStorage;
}
