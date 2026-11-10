// 个人使用的图片预下载工具；原版美术版权属于 Wizards of the Coast / Gale Force Nine。
// 在任意工作目录运行 node <项目目录>/scripts/preload-images.mjs；
// 加 --board-only 只准备地图。无需 TTS 存档，不编译或构建项目。
// 跨工作副本复制时需保留 scripts/、assets/ 中的 JSON 与 package.json 布局，
// 并在目标副本安装项目依赖。下载结果仅写入该副本被 Git 忽略的 assets/ 目录。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--board-only')) {
  console.error('用法：node scripts/preload-images.mjs [--board-only]');
  process.exit(1);
}
const urls = JSON.parse(await fs.readFile(path.join(root, 'assets/asset-urls.json'), 'utf8'));
const cards = Object.values(JSON.parse(await fs.readFile(path.join(root, 'assets/card-data.json'), 'utf8')));
const rawDir = path.join(root, 'assets/raw');
await fs.mkdir(rawDir, { recursive: true });

function assetPath(relative) {
  const absolute = path.resolve(root, relative);
  const within = path.relative(path.join(root, 'assets'), absolute);
  if (path.isAbsolute(within) || within === '..' || within.startsWith(`..${path.sep}`)) {
    throw new Error(`拒绝写入 assets 目录之外：${relative}`);
  }
  return absolute;
}

async function validImage(file, width, height) {
  try {
    const meta = await sharp(file).metadata();
    return meta.width === width && meta.height === height;
  } catch { return false; }
}

async function writeImage(file, pipeline, width, height) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.part`;
  try {
    await pipeline.jpeg({ quality: 92 }).toFile(temporary);
    if (!await validImage(temporary, width, height)) throw new Error(`图片尺寸校验失败：${file}`);
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

async function download(source, width, height) {
  const url = source.replace(/^http:/, 'https:');
  const name = createHash('sha256').update(url).digest('hex').slice(0, 20);
  const file = path.join(rawDir, `${name}.jpg`);
  if (await validImage(file, width, height)) return file;
  const temporary = `${file}.${process.pid}.part`;
  console.log(`正在下载：${url}`);
  try {
    // 使用系统 curl，可继承本机网络设置；总超时与有限重试避免无限等待。
    execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl', [
      '--fail', '--location', '--silent', '--show-error',
      '--connect-timeout', '20', '--max-time', '180',
      '--retry', '2', '--retry-delay', '2',
      '--output', temporary, url,
    ], { stdio: 'inherit', windowsHide: true });
    if (!await validImage(temporary, width, height)) {
      throw new Error(`图源不是预期的 ${width}×${height} 图片，未保存：${url}`);
    }
    await fs.rename(temporary, file);
    return file;
  } finally { await fs.rm(temporary, { force: true }); }
}

let failures = 0;
try {
  const board = assetPath('assets/board/map.jpg');
  if (!await validImage(board, 4646, 4605)) {
    const table = await download(urls.table, 8449, 4992);
    // 与 image-cache.ts 的 BOARD_CROP 和逆时针旋转完全一致，不能改变棋子校准坐标。
    // 先物化裁切再旋转，避免 sharp 的运算重排先旋转整张桌面图。
    const crop = await sharp(table).extract({ left: 2999, top: 152, width: 4605, height: 4646 })
      .png().toBuffer();
    await writeImage(board, sharp(crop).rotate(270), 4646, 4605);
  }
  console.log(`地图已就绪：${board}`);
} catch (error) {
  failures++;
  console.error('地图准备失败：', error.message);
}

if (!args.includes('--board-only')) {
  const groups = new Map();
  for (const card of cards) {
    const sheet = urls.decks[card.deck] ?? urls.decks.misc;
    if (!sheet || !card.image) throw new Error(`缺少卡图配置：${card.deck} / ${card.slot}`);
    const key = sheet.sheetUrl.replace(/^http:/, 'https:');
    if (!groups.has(key)) groups.set(key, { sheet, cards: [] });
    groups.get(key).cards.push(card);
  }
  let ready = 0;
  for (const { sheet, cards: group } of groups.values()) {
    try {
      const width = sheet.width ?? 7490;
      const height = sheet.height ?? 5230;
      const tileW = Math.floor(width / sheet.cols);
      const tileH = Math.floor(height / sheet.rows);
      const pending = [];
      for (const card of group) {
        if (await validImage(assetPath(card.image), tileW, tileH)) ready++;
        else pending.push(card);
      }
      if (pending.length) {
        const file = await download(sheet.sheetUrl, width, height);
        for (const card of pending) {
          const slot = Number(/^assets\/cards\/[^/]+\/(\d+)-/.exec(card.image)?.[1]);
          if (!Number.isInteger(slot) || slot < 0 || slot >= sheet.cols * sheet.rows) {
            throw new Error(`卡图格位无效：${card.image}`);
          }
          await writeImage(assetPath(card.image), sharp(file).extract({
            left: (slot % sheet.cols) * tileW, top: Math.floor(slot / sheet.cols) * tileH,
            width: tileW, height: tileH,
          }), tileW, tileH);
          ready++;
        }
      }
      console.log(`卡图已就绪：${ready}/${cards.length}`);
    } catch (error) {
      failures++;
      console.error(`牌组图片准备失败（${sheet.nickname}）：`, error.message);
    }
  }
  console.log(`本地卡图：${ready}/${cards.length}；开启图像后显示原版卡图，并保留中文说明。`);
}
if (failures) process.exitCode = 1;
else console.log('图片预下载完成。刷新游戏页面即可，无需重新开局。请勿将原版美术公开分发。');
