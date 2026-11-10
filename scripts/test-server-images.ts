import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { allCards } from '../src/card-data';
import { usesServerImages, getImageBlobUrl } from '../src/image-cache';
import { CardArtwork } from '../src/components/CardArtwork';
import { FirstRunImageImport } from '../src/components/FirstRunImageImport';
import { cardStrings, setLocale } from '../src/i18n';
import { serverImageUrl, setServerImageMode } from '../src/server-images';
import { ServerImageSetup } from '../src/components/ServerImageSetup';

assert.equal(usesServerImages(), true, '此测试必须通过 --mode friends 运行');
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const originalError = console.error;
const requests: string[] = [];
const cards = allCards();
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  requests.push(url);
  throw new Error(`获取 URL 与静态渲染不应下载图片：${url}`);
}) as typeof fetch;
console.warn = () => {};
console.error = () => {};
try {
  setLocale('zh-CN');
  for (const card of cards) {
    await assert.rejects(() => getImageBlobUrl(card.image), '未预下载时不能返回远程图片');
    const url = serverImageUrl(card.image);
    assert.match(url, /^\/media\/[a-f0-9]{64}\.webp$/);
    const html = renderToStaticMarkup(createElement(CardArtwork, { card, url }));
    assert.ok(html.includes(`<img src="${url}"`), `中文卡面必须显示图片：${card.effectKey}`);
    const strings = cardStrings(card);
    assert.ok(html.includes(strings.name), `图片下方缺少中文卡名：${card.effectKey}`);
    for (const benefit of strings.benefits) assert.ok(html.includes(benefit), `图片下方缺少中文效果：${card.effectKey}`);
  }
  assert.equal(requests.length, 0, '缓存不可用时不应从服务器加载图片');
  assert.equal(renderToStaticMarkup(createElement(FirstRunImageImport)), '', '服务器图片模式不能要求玩家手动导入');
  const setup = renderToStaticMarkup(createElement(ServerImageSetup, { onContinue() {}, onCancel() {}, entering: true }));
  assert.ok(setup.includes('本地图片（推荐）') && setup.includes('无图模式') && setup.includes('提前下载到本机'));
  assert.ok(!setup.includes('value="server"') && !setup.includes('使用已有缓存进入'));
  assert.ok(!setup.includes('继续游戏'), '缓存尚未就绪不能跳过下载进入有图模式');
  setServerImageMode('none');
  const noImages = renderToStaticMarkup(createElement(ServerImageSetup, { onContinue() {}, onCancel() {}, entering: true }));
  assert.ok(noImages.includes('继续游戏'), '无图模式可以直接进入');
  console.log(`PASS: ${cards.length} 张中文卡面保留完整译文，进房只能选择完整预下载或无图，缺图不联网。`);
} finally {
  setServerImageMode('local');
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  console.error = originalError;
}
