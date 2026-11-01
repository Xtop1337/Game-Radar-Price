import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseEpic } from '../lib/sources/epic.js';
import { parseGamerPower, cleanTitle, storeFromPlatforms } from '../lib/sources/gamerpower.js';
import { parseFeatured, parseAppDetails, parseSearch, parseSteamTab } from '../lib/sources/steam.js';
import { parseDeals, applyRegionalPrices, regionalizeSteam, parseGamesByIds } from '../lib/sources/cheapshark.js';
import { compose } from '../lib/compose.js';
import { evaluateWishlist, makeWishlistItem } from '../lib/wishlist.js';
import { newItems, rememberIds, giveawayNotifications, wishlistNotifications } from '../lib/alerts.js';
import { formatPrice, formatTimeLeft, normTitle } from '../lib/format.js';
import { DEFAULT_SETTINGS, mergeSettings } from '../lib/storage.js';
import { setLang } from '../lib/i18n/index.js';

setLang('ru'); // ожидания ниже написаны для русского интерфейса

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const NOW = Date.parse('2026-11-01T12:00:00Z');

test('Epic: текущая, будущая и mystery раздачи; 50%-скидка не считается раздачей', () => {
  const items = parseEpic(fx('epic'), { now: NOW });
  assert.equal(items.length, 3);
  const gta = items.find((i) => i.title === 'Grand Theft Auto V');
  assert.equal(gta.upcoming, false);
  assert.equal(gta.url, 'https://store.epicgames.com/ru/p/grand-theft-auto-v');
  assert.equal(gta.image, 'https://cdn1.epicgames.com/gta-wide.jpg');
  assert.equal(gta.oldPrice, 1499);
  assert.equal(gta.currency, 'RUB');
  assert.equal(gta.endsAt, Date.parse('2026-11-05T15:00:00.000Z'));

  const future = items.find((i) => i.title === 'Future Free Game');
  assert.equal(future.upcoming, true);
  assert.equal(future.url, 'https://store.epicgames.com/ru/p/future-free-game');

  const mystery = items.find((i) => i.title === 'Mystery Game');
  assert.equal(mystery.url, 'https://store.epicgames.com/ru/free-games');
  assert.equal(mystery.oldPrice, null);
  assert.ok(!items.some((i) => i.title === 'Half-price Game'));
});

test('Epic: пустой/битый ответ не падает', () => {
  assert.deepEqual(parseEpic(null), []);
  assert.deepEqual(parseEpic({ errors: [] }), []);
});

test('GamerPower: чистка названий, магазин, фильтр DLC и истёкших', () => {
  const items = parseGamerPower(fx('gamerpower'), { now: NOW });
  assert.deepEqual(items.map((i) => i.title), ['Grand Theft Auto V', 'Cool Indie', 'Prime Thing']);
  assert.equal(items[0].store, 'epic');
  assert.equal(items[1].store, 'steam');
  assert.equal(items[1].endsAt, null);
  assert.equal(items[2].store, 'prime');
  assert.equal(items[0].oldPrice, 29.99);
  assert.deepEqual(parseGamerPower({ status: 0, status_reason: 'none' }), []);
  assert.equal(cleanTitle('Foo Bar (Steam) Giveaway'), 'Foo Bar');
  assert.equal(storeFromPlatforms('PC, GOG'), 'gog');
});

test('Steam: витрина скидок — дедуп, 100% = раздача, пакеты пропускаются', () => {
  const items = parseFeatured(fx('steam-featured'));
  assert.equal(items.length, 2);
  const cp = items.find((i) => i.steamAppId === 1091500);
  assert.equal(cp.kind, 'deal');
  assert.equal(cp.price, 1199);
  assert.equal(cp.oldPrice, 2999);
  assert.equal(cp.discount, 60);
  assert.equal(cp.endsAt, 1793880000000);
  const portal = items.find((i) => i.steamAppId === 400);
  assert.equal(portal.kind, 'giveaway');
});

test('Steam: appdetails и поиск', () => {
  const prices = parseAppDetails(fx('steam-appdetails'));
  assert.equal(prices.get(1091500).price, 1199);
  assert.equal(prices.get(730).freeToPlay, true);
  assert.equal(prices.has(1), false);
  const search = parseSearch(fx('steam-search'));
  assert.equal(search.length, 2);
  assert.equal(search[0].discount, 60);
  assert.equal(search[1].price, 0);
});

test('Steam: разбор вкладки', () => {
  assert.deepEqual(
    parseSteamTab('https://store.steampowered.com/app/1091500/Cyberpunk_2077/', 'Скидка 60% на Cyberpunk 2077 в Steam'),
    { appId: 1091500, title: 'Cyberpunk 2077' },
  );
  assert.deepEqual(parseSteamTab('https://store.steampowered.com/app/730/CounterStrike_2/', ''), { appId: 730, title: 'CounterStrike 2' });
  assert.equal(parseSteamTab('https://example.com', 'x'), null);
});

test('CheapShark: скидки и региональные цены Steam', async () => {
  const deals = parseDeals(fx('cheapshark-deals'));
  assert.equal(deals.length, 4); // магазин 11 отброшен
  const w3 = deals.find((d) => d.store === 'gog');
  assert.equal(w3.discount, 80);
  assert.equal(w3.url, 'https://www.cheapshark.com/redirect?dealID=dealW3');

  const regional = applyRegionalPrices(deals, parseAppDetails(fx('steam-appdetails')));
  const cp = regional.find((d) => d.steamAppId === 1091500);
  assert.equal(cp.currency, 'RUB');
  assert.equal(cp.price, 1199);
  assert.ok(!regional.some((d) => d.steamAppId === 999), 'в регионе нет скидки — убираем');

  const failed = await regionalizeSteam(deals, { cc: 'ru' }, async () => { throw new Error('net'); });
  assert.equal(failed.find((d) => d.steamAppId === 1091500).currency, 'USD');
});

test('CheapShark: лучшая цена по игре среди Steam/GOG/Epic', () => {
  const map = parseGamesByIds(fx('cheapshark-games'));
  const w3 = map.get('222');
  assert.equal(w3.price, 7.99);
  assert.equal(w3.store, 'gog');
  assert.equal(w3.lowest, 5.99);
  assert.equal(map.has('333'), false);
});

function sampleSources() {
  return {
    epic: { ok: true, items: parseEpic(fx('epic'), { now: NOW }) },
    gamerpower: { ok: true, items: parseGamerPower(fx('gamerpower'), { now: NOW }) },
    steam: { ok: true, items: parseFeatured(fx('steam-featured')) },
    cheapshark: { ok: false, error: 'HTTP 429', items: parseDeals(fx('cheapshark-deals')) },
  };
}

test('compose: дедуп раздач Epic vs GamerPower, будущие отдельно, фильтр магазинов', () => {
  const { giveaways, upcoming, deals } = compose(sampleSources(), DEFAULT_SETTINGS, NOW);
  const gta = giveaways.filter((g) => normTitle(g.title) === normTitle('Grand Theft Auto V'));
  assert.equal(gta.length, 1);
  assert.equal(gta[0].source, 'epic');
  assert.equal(giveaways[0].source, 'epic', 'Epic наверху');
  assert.ok(giveaways.some((g) => g.title === 'Portal'));
  assert.deepEqual(upcoming.map((u) => u.title), ['Future Free Game', 'Mystery Game']);
  // Cyberpunk из витрины Steam и из CheapShark — одна запись
  assert.equal(deals.filter((d) => d.steamAppId === 1091500).length, 1);
  assert.equal(deals.find((d) => d.steamAppId === 1091500).source, 'steam');
  assert.deepEqual(deals.map((d) => d.discount), [...deals.map((d) => d.discount)].sort((a, b) => b - a));

  const onlyEpic = compose(sampleSources(), mergeSettings({ stores: { steam: false, gog: false, other: false } }), NOW);
  assert.ok(onlyEpic.giveaways.every((g) => g.store === 'epic'));
  assert.ok(onlyEpic.deals.every((d) => d.store === 'epic'));

  const noGp = compose(sampleSources(), mergeSettings({ useGamerPower: false }), NOW);
  assert.ok(noGp.giveaways.every((g) => g.source !== 'gamerpower'));

  // будущая раздача становится текущей, когда наступило время
  const later = compose(sampleSources(), DEFAULT_SETTINGS, Date.parse('2026-11-06T00:00:00Z'));
  assert.ok(later.giveaways.some((g) => g.title === 'Future Free Game'));
  assert.ok(!later.giveaways.some((g) => g.title === 'Grand Theft Auto V'));
});

test('wishlist: цель, скидка, бесплатная раздача; без повторных уведомлений', () => {
  const items = [
    { ...makeWishlistItem({ title: 'Cyberpunk 2077', steamAppId: 1091500, price: 2999, currency: 'RUB' }), targetPrice: 1500 },
    makeWishlistItem({ title: 'The Witcher 3', cheapsharkId: '222', key: 'cs:222' }),
    makeWishlistItem({ title: 'Grand Theft Auto V', key: 'title:gta' }),
  ];
  const prices = new Map([
    ['steam:1091500', { price: 1199, oldPrice: 2999, discount: 60, currency: 'RUB', store: 'steam' }],
    ['cs:222', { price: 7.99, oldPrice: 39.99, discount: 80, currency: 'USD', store: 'gog' }],
  ]);
  const { giveaways } = compose(sampleSources(), DEFAULT_SETTINGS, NOW);
  const r1 = evaluateWishlist(items, prices, giveaways, NOW);
  assert.deepEqual(r1.alerts.map((a) => a.type).sort(), ['discount', 'free', 'target']);
  assert.equal(r1.items[0].targetReached, true);
  assert.ok(r1.items[2].freeNow);

  const r2 = evaluateWishlist(r1.items, prices, giveaways, NOW);
  assert.equal(r2.alerts.length, 0, 'повторно не уведомляем');

  const cheaper = new Map(prices);
  cheaper.set('steam:1091500', { price: 999, oldPrice: 2999, discount: 67, currency: 'RUB' });
  const r3 = evaluateWishlist(r2.items, cheaper, giveaways, NOW);
  assert.deepEqual(r3.alerts.map((a) => a.type), ['target'], 'цена упала ещё — снова уведомляем');

  const texts = wishlistNotifications(r1.alerts);
  assert.ok(texts.every((t) => t.title && t.url !== undefined));
});

test('alerts: новые раздачи и сводка, если их много', () => {
  const g = [1, 2, 3, 4, 5].map((n) => ({ id: `x${n}`, title: `Game ${n}`, store: 'epic', url: `u${n}` }));
  assert.equal(newItems(g, ['x1', 'x2']).length, 3);
  assert.equal(giveawayNotifications(newItems(g, ['x1', 'x2'])).length, 3);
  const summary = giveawayNotifications(g);
  assert.equal(summary.length, 1);
  assert.match(summary[0].title, /5/);
  assert.equal(rememberIds(['a'], g, 3).length, 3);
});

test('format: цены и таймеры', () => {
  assert.equal(formatPrice(0, 'RUB'), 'Бесплатно');
  assert.match(formatPrice(1199, 'RUB'), /1\s199\s₽/);
  assert.match(formatPrice(7.99, 'USD'), /7,99/);
  assert.equal(formatTimeLeft(NOW + (2 * 24 + 5) * 3600e3 + 60e3, NOW), '2 д 5 ч');
  assert.equal(formatTimeLeft(NOW + 90 * 60e3, NOW), '1 ч 30 мин');
  assert.equal(formatTimeLeft(NOW - 1, NOW), 'завершено');
  assert.equal(normTitle('The Witcher® 3: Wild Hunt'), normTitle('the witcher 3 wild hunt'));
});
