import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest from '../src/server-image-manifest.json';

const base = (process.env.SMOKE_BASE ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function fetchRelease(file: string, method = 'GET') {
  const response = await fetch(`${base}/${file}`, { method, signal: AbortSignal.timeout(120000) });
  assert.equal(response.status, 200, `${method} ${file}`);
  return response;
}
const html = readFileSync(new URL('../dist/index.html', import.meta.url));
assert.equal(hash(new Uint8Array(await (await fetchRelease('')).arrayBuffer())), hash(html), '服务器首页必须与本次构建相同');
// 首页引用的入口脚本也必须与本次构建一致，避免只更新静态首页。
for (const match of html.toString().matchAll(/<script[^>]+src="([^"]+)"/g)) {
  const file = match[1].replace(/^\//, '');
  assert.match(file, /^assets\/[a-zA-Z0-9_-]+\.js$/);
  const local = readFileSync(new URL(`../dist/${file}`, import.meta.url));
  assert.equal(hash(new Uint8Array(await (await fetchRelease(file)).arrayBuffer())), hash(local), file);
}
const files = [...new Map(Object.values(manifest.images).map(image => [image.file, image])).values()];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < files.length) {
    const image = files[next++];
    const response = await fetchRelease(image.file, 'HEAD');
    assert.equal(response.headers.get('Content-Type'), 'image/webp', image.file);
    assert.equal(Number(response.headers.get('Content-Length')), image.bytes, image.file);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable', image.file);
  }
}));
// 实际下载地图与一张卡图校验内容，HEAD 全量验证其余图片的路径、类型和大小。
const sample = [manifest.images['assets/board/map.jpg'], files.find(image => image.file !== manifest.images['assets/board/map.jpg'].file)!];
for (const image of sample) {
  const content = new Uint8Array(await (await fetchRelease(image.file)).arrayBuffer());
  assert.equal(hash(content), image.file.slice(6, -5), image.file);
}
console.log(`PASS release HTTP: ${base} 首页与入口脚本匹配本次构建；${files.length} 个 WebP 响应及长期缓存头正确；地图和卡图内容哈希正确。`);
