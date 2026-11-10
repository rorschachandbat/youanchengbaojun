import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getImageBlobUrl, evictImageFromCache } from '../src/image-cache';
import { TABLE_URL, DECK_SHEETS } from '../src/sheet-config';

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const originalDocument = globalThis.document;
const originalBitmap = globalThis.createImageBitmap;
const requests: string[] = [];
const image = new Blob([new Uint8Array(6_000)], { type: 'image/jpeg' });
let remoteAvailable = false;
let localAvailable = true;
let bitmapCalls = 0;
console.warn = () => {};

// 隔离网络与浏览器绘图，检查请求顺序和错误响应；不执行编译或构建。
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  requests.push(url);
  if ((url.startsWith('/') && localAvailable) || (url.startsWith('https:') && remoteAvailable)) {
    return new Response(image, { headers: { 'Content-Type': 'image/jpeg' } });
  }
  // Vite 对不存在的静态路径会返回 HTTP 200 的首页，不能将其缓存成图片。
  return new Response('<html>not an image</html>', { headers: { 'Content-Type': 'text/html' } });
}) as typeof fetch;
globalThis.createImageBitmap = (async () => {
  bitmapCalls++;
  return { width: 8449, height: 4992, close() {} } as ImageBitmap;
}) as typeof createImageBitmap;
globalThis.document = {
  createElement: () => ({
    getContext: () => ({ translate() {}, rotate() {}, drawImage() {} }),
    toBlob: (callback: BlobCallback) => callback(image),
  }),
} as unknown as Document;

const board = 'assets/board/map.jpg';
const card = 'assets/cards/drow/00-unnamed.jpg';
try {
  await getImageBlobUrl(board);
  assert.deepEqual(requests, ['/board/map.jpg'], '已有本地地图时，不应访问远程桌面图');
  assert.equal(bitmapCalls, 0, '本地地图不需要浏览器裁切');
  requests.length = 0;
  await getImageBlobUrl(card);
  assert.deepEqual(requests, ['/cards/drow/00-unnamed.jpg'], '已有本地卡图时，不应下载整张牌组图');

  await evictImageFromCache(board);
  requests.length = 0;
  localAvailable = false;
  remoteAvailable = true;
  await getImageBlobUrl(board);
  assert.deepEqual(requests, ['/board/map.jpg', TABLE_URL], '本地 HTML 必须被拒绝，随后从远程派生地图');
  assert.equal(bitmapCalls, 1);

  await evictImageFromCache(card);
  requests.length = 0;
  await getImageBlobUrl(card);
  assert.deepEqual(requests, ['/cards/drow/00-unnamed.jpg', DECK_SHEETS.drow.url]);

  await evictImageFromCache(board);
  remoteAvailable = false;
  await assert.rejects(getImageBlobUrl(board), /image|图片|Content-Type/i, 'HTML 不能冒充图片写入缓存');
  requests.length = 0;
  localAvailable = true;
  await getImageBlobUrl(board);
  assert.deepEqual(requests, ['/board/map.jpg'], '失败后重试应能读取新下载的本地图片');

  const source = readFileSync(new URL('../src/components/MapView.tsx', import.meta.url), 'utf8');
  assert.match(source, /aspectRatio:\s*'4646 \/ 4605'/, '地图必须在加载前预留原图比例');
  assert.match(source, /onError=/, '图片失败时必须切换到可操作地图');
  console.log('PASS: 本地地图/卡图优先、远程回退、拒绝 HTML 响应、失败后恢复及地图布局保护。');
} finally {
  await evictImageFromCache(board);
  await evictImageFromCache(card);
  globalThis.fetch = originalFetch;
  globalThis.document = originalDocument;
  globalThis.createImageBitmap = originalBitmap;
  console.warn = originalWarn;
}
