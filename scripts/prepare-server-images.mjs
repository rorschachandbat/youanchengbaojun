// 从当前工作副本的原图生成同尺寸 WebP，内容哈希用于缓存更新与重复图片去重。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = path.join(root, 'assets');
const cards = Object.values(JSON.parse(await fs.readFile(path.join(assets, 'card-data.json'), 'utf8')));
const sources = [...new Set(['assets/board/map.jpg', ...cards.map(card => card.image)])].sort();
const images = {};
let originalBytes = 0;
const unique = new Map();
await fs.mkdir(path.join(assets, 'media'), { recursive: true });
for (const source of sources) {
  if (!/^assets\/(board\/map\.jpg|cards\/[a-z0-9-]+\/[a-z0-9-]+\.jpg)$/.test(source)) throw new Error(`无效图片路径：${source}`);
  const original = await fs.readFile(path.join(root, source));
  const { data, info } = await sharp(original).webp({ quality: 78, effort: 4 }).toBuffer({ resolveWithObject: true });
  const before = await sharp(original).metadata();
  if (info.width !== before.width || info.height !== before.height) throw new Error(`不能改变地图或卡图比例：${source}`);
  const digest = createHash('sha256').update(data).digest('hex');
  const file = `media/${digest}.webp`;
  if (!unique.has(file)) await fs.writeFile(path.join(assets, file), data);
  unique.set(file, data.length);
  originalBytes += original.length;
  images[source] = { file, bytes: data.length };
}
const manifest = { version: 1, images };
await fs.writeFile(path.join(root, 'src/server-image-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const bytes = [...unique.values()].reduce((sum, size) => sum + size, 0);
console.log(`服务器图片：${sources.length} 个引用 → ${unique.size} 个文件；${originalBytes} → ${bytes} 字节，减少 ${Math.round((1 - bytes / originalBytes) * 100)}%。`);
