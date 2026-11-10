import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App, NewGameDialog, isNoImagesMode } from '../src/App';
import { RoomApp } from '../src/online/RoomApp';
import { AI_STYLES, labelForStyle, type AiStyle } from '../src/ai/difficulty';
import { setLocale, ui } from '../src/i18n';
import { setServerImageMode } from '../src/server-images';

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;
const requests: string[] = [];
const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
} as unknown as Storage;
globalThis.fetch = (async (input: string | URL | Request) => {
  requests.push(String(input));
  throw new Error('本地设置不应创建房间或下载图片');
}) as typeof fetch;

try {
  assert.equal(import.meta.env.VITE_FRIENDS_ONLY, 'true');
  for (const locale of ['zh-CN', 'en'] as const) {
    setLocale(locale);
    for (const numPlayers of [2, 3, 4]) {
      const aiStyles: AiStyle[] = ['random', 'easy', 'hard'].slice(0, numPlayers - 1) as AiStyle[];
      const html = renderToStaticMarkup(createElement(NewGameDialog, {
        onStart() {}, onResume() {}, hasSave: false,
        lastConfig: { numPlayers, aiStyles, halfDecks: ['drow', 'dragons'] },
      }));
      for (const style of AI_STYLES) {
        const label = `>${ui(labelForStyle(style))}</button>`;
        assert.equal(html.split(label).length - 1, numPlayers - 1, '每个 AI 均可选择全部四档难度');
      }
      assert.ok(html.includes(`P${numPlayers}`));
      assert.ok(!html.includes(`P${numPlayers + 1}</span>`));
    }
    const lobby = renderToStaticMarkup(createElement(RoomApp));
    assert.ok(lobby.includes('href="/solo"'), '好友大厅必须提供本地 AI 入口');
  }
  setLocale('zh-CN');
  setServerImageMode('local');
  // 即使旧存档配置存在，图片准备完成前也不能挂载游戏。
  storage.set('totu.savegame', 'existing-save');
  storage.set('totu.gameconfig', JSON.stringify({
    numPlayers: 4, aiStyles: ['random', 'easy', 'hard'], halfDecks: ['drow', 'dragons'],
  }));
  const gated = renderToStaticMarkup(createElement(App));
  assert.ok(gated.includes('role="dialog"') && gated.includes('提前下载到本机'));
  assert.ok(!gated.includes('开始游戏</button>'));
  setServerImageMode('none');
  assert.equal(isNoImagesMode(), true, '无图偏好必须同时控制地图和卡牌');
  const textOnly = renderToStaticMarkup(createElement(App));
  assert.ok(textOnly.includes('继续游戏'));
  assert.equal(requests.length, 0, '设置与图片门禁不应调用房间、统计或图片服务');
  console.log('PASS: 好友大厅本地入口、1～3 个 AI 各自四档难度、中英界面、完整图片门禁和无图偏好。');
} finally {
  setServerImageMode('local');
  setLocale('zh-CN');
  globalThis.fetch = originalFetch;
  globalThis.localStorage = originalLocalStorage;
}
