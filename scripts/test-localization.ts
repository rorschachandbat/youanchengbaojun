import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { allCards } from '../src/card-data';
import {
  CARD_STRING_TABLE, UI_STRING_TABLE, cardName, cardStrings, choiceText,
  getLocale, setLocale, subscribeLocale, ui,
} from '../src/i18n';
import { PlaceholderCard } from '../src/components/PlaceholderCard';

const cards = allCards();
const original = JSON.stringify(cards);
const keys = new Set(cards.map(card => card.effectKey));
assert.equal(getLocale(), 'zh-CN');
assert.deepEqual(new Set(Object.keys(CARD_STRING_TABLE)), keys, '译文必须覆盖所有卡牌，且不能出现失效规则标识');

for (const card of cards) {
  const localized = cardStrings(card);
  assert.match(localized.name, /[\u3400-\u9fff]/u, `缺少中文卡名：${card.effectKey}`);
  assert.ok(localized.benefits.length > 0, `缺少中文效果：${card.effectKey}`);
  assert.ok(localized.benefits.every(text => /[\u3400-\u9fff]/u.test(text)), `效果尚未翻译：${card.effectKey}`);
  assert.equal(cardName(card.name), localized.name);
  const html = renderToStaticMarkup(createElement(PlaceholderCard, { card, hover: false }));
  assert.ok(html.includes(localized.name), `卡面没有显示译名：${card.effectKey}`);
  for (const benefit of localized.benefits) assert.ok(html.includes(benefit), `卡面缺失效果：${card.effectKey}`);
}

assert.equal(ui('Recruit ({cost} Inf)', { cost: 3 }), '招募（3 影响力）');
assert.equal(choiceText('Assassinate a white troop (2 left).'), '选择暗杀一个白色部队（剩余 2 次）。');
assert.equal(choiceText('Return a spy → +2 Power +2 Influence'), '收回一个间谍 → 获得 2 军力和 2 影响力');
assert.equal(choiceText('Unrecognised prompt'), 'Unrecognised prompt', '未知提示必须保留英文，而非丢失');
assert.ok(CARD_STRING_TABLE['green-dragon'].benefits[0].includes('或收回'));
// 异怪弃牌门槛是超过三张，即至少四张；不能沿用旧卡牌数据中的三张。
for (const key of ['chuul', 'nothic', 'cranium-rats', 'mindwitness', 'gauth']) {
  assert.ok(CARD_STRING_TABLE[key].benefits.some(text => text.includes('至少 4 张手牌')), `弃牌门槛错误：${key}`);
}
assert.ok(choiceText('Return a spy → draw + each opp with 4+ cards discards').includes('至少 4 张手牌'));
assert.ok(choiceText('Draw a card, choose opp (4+ cards) to discard').includes('至少 4 张手牌'));

// 检查所有效果选择按钮，避免扩展卡存在英文选项遗漏。
for (const deck of ['drow', 'dragons', 'elemental', 'demons', 'aberrations', 'undead']) {
  const source = readFileSync(new URL(`../src/engine/handlers/${deck}.ts`, import.meta.url), 'utf8');
  for (const match of source.matchAll(/label:\s*'([^']+)'/g)) {
    assert.notEqual(choiceText(match[1]), match[1], `选择按钮未翻译：${deck} / ${match[1]}`);
  }
}

let notifications = 0;
const unsubscribe = subscribeLocale(() => { notifications++; });
setLocale('en');
assert.equal(getLocale(), 'en');
assert.equal(cardName('Noble'), 'Noble');
for (const card of cards) assert.equal(cardStrings(card), card);
assert.equal(ui('Start game'), 'Start game');
assert.equal(choiceText('Choose one:'), 'Choose one:');
assert.ok(ui('Help setup').includes('AI opponents'));
setLocale('zh-CN');
assert.equal(notifications, 2);
unsubscribe();
setLocale('en');
assert.equal(notifications, 2, '取消订阅后不应继续收到通知');
setLocale('zh-CN');
assert.equal(JSON.stringify(cards), original, '语言切换不能修改引擎原始数据');

// 玩家界面使用的固定键均需在中文 StringTable 中声明。
for (const path of ['src/App.tsx', 'src/online/RoomApp.tsx', 'src/components/ServerImageSetup.tsx', 'src/components/LanguageTools.tsx', 'src/components/PlaceholderCard.tsx', 'src/components/FirstRunImageImport.tsx']) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  for (const match of source.matchAll(/\bui\('([^']+)'/g)) {
    const key = match[1].replace(/\\n/g, '\n');
    assert.ok(Object.hasOwn(UI_STRING_TABLE, key), `StringTable 缺少键：${key}`);
  }
}
console.log(`PASS: ${cards.length} 条卡牌记录 / ${keys.size} 种卡牌的译文、文字卡面、中英切换、数据不变性及效果选择按钮。`);
