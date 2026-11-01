import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  LANGS, dictionary, detectLang, resolveLang, setLang, t, plural, epicLocale, steamLang,
} from '../lib/i18n/index.js';
import { formatPrice, formatTimeLeft, formatAgo } from '../lib/format.js';
import { parseEpic } from '../lib/sources/epic.js';
import { giveawayNotifications } from '../lib/alerts.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const PLURAL = /\.(zero|one|two|few|many|other)$/;
const NOW = Date.parse('2026-11-01T12:00:00Z');

test('все словари содержат одинаковый набор ключей и непустые строки', () => {
  const base = Object.keys(dictionary('ru')).filter((k) => !PLURAL.test(k)).sort();
  for (const lang of LANGS) {
    const d = dictionary(lang);
    const keys = Object.keys(d).filter((k) => !PLURAL.test(k)).sort();
    assert.deepEqual(keys, base, `ключи ${lang} расходятся с ru`);
    for (const [k, v] of Object.entries(d)) assert.ok(typeof v === 'string' && v.trim(), `${lang}: пустое значение ${k}`);
    for (const k of Object.keys(d).filter((x) => PLURAL.test(x))) {
      assert.ok(d[k.replace(PLURAL, '.other')], `${lang}: у ${k} нет формы .other`);
    }
  }
});

test('плейсхолдеры {x} совпадают во всех переводах', () => {
  const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  const ru = dictionary('ru');
  for (const lang of LANGS) {
    for (const [k, v] of Object.entries(dictionary(lang))) {
      if (PLURAL.test(k) || !(k in ru)) continue;
      assert.equal(ph(v), ph(ru[k]), `${lang}: ${k}`);
    }
  }
});

test('все data-i18n ключи из HTML есть в словарях', () => {
  const ru = dictionary('ru');
  for (const file of ['popup/popup.html', 'options/options.html', 'onboarding/onboarding.html']) {
    const keys = [...read(file).matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(keys.length > 5, `${file}: нет ключей`);
    for (const k of keys) assert.ok(k in ru, `${file}: нет ключа ${k}`);
  }
});

test('t() в коде использует только существующие ключи', () => {
  const ru = dictionary('ru');
  const files = ['popup/popup.js', 'options/options.js', 'lib/alerts.js', 'lib/format.js', 'lib/regions.js'];
  for (const file of files) {
    for (const m of read(file).matchAll(/\bt\('([\w.]+)'/g)) assert.ok(m[1] in ru, `${file}: нет ключа ${m[1]}`);
  }
});

test('манифест: все __MSG_x__ есть во всех _locales', () => {
  const manifest = read('manifest.json');
  const keys = [...manifest.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]);
  assert.ok(keys.length >= 3);
  const locales = readdirSync(new URL('_locales/', root));
  assert.deepEqual([...locales].sort(), [...LANGS].sort());
  for (const loc of locales) {
    const msgs = JSON.parse(read(`_locales/${loc}/messages.json`));
    for (const k of keys) assert.ok(msgs[k]?.message, `${loc}: нет ${k}`);
  }
});

test('определение языка браузера', () => {
  assert.equal(detectLang('de-AT'), 'de');
  assert.equal(detectLang('ru'), 'ru');
  assert.equal(detectLang('pl_PL'), 'pl');
  assert.equal(detectLang('es-419'), 'es');
  assert.equal(detectLang('fr-FR'), 'en');
  assert.equal(detectLang('pt'), 'en');
  assert.equal(detectLang(undefined), 'en');
  assert.equal(resolveLang('tr'), 'tr');
  assert.equal(resolveLang('xx'), detectLang(globalThis.navigator?.language));
  globalThis.browser = { i18n: { getUILanguage: () => 'de-CH' } };
  try {
    assert.equal(resolveLang('auto'), 'de');
    assert.equal(resolveLang('ru'), 'ru', 'ручной выбор важнее языка браузера');
  } finally {
    delete globalThis.browser;
  }
});

test('множественное число', () => {
  setLang('ru');
  assert.deepEqual([1, 3, 5, 21, 11].map((n) => plural('games', n)), ['1 игра', '3 игры', '5 игр', '21 игра', '11 игр']);
  setLang('pl');
  assert.deepEqual([1, 2, 5, 22].map((n) => plural('games', n)), ['1 gra', '2 gry', '5 gier', '22 gry']);
  setLang('en');
  assert.deepEqual([1, 2].map((n) => plural('games', n)), ['1 game', '2 games']);
});

test('форматирование и уведомления на разных языках', () => {
  setLang('en');
  assert.equal(t('price.free'), 'Free');
  assert.equal(formatPrice(0, 'USD'), 'Free');
  assert.equal(formatPrice(7.99, 'USD'), '$7.99');
  assert.equal(formatTimeLeft(NOW + (2 * 24 + 5) * 3600e3 + 60e3, NOW), '2d 5h');
  assert.equal(formatAgo(NOW - 5 * 60e3, NOW), '5 min ago');
  assert.match(giveawayNotifications([{ id: 'a', title: 'GTA V', store: 'epic', url: 'u' }])[0].title, /Free on Epic: GTA V/);

  setLang('de');
  assert.equal(formatTimeLeft(NOW + 90 * 60e3, NOW), '1 Std 30 Min');
  assert.match(formatPrice(7.99, 'EUR'), /7,99\s€/);

  setLang('ru');
  assert.equal(formatTimeLeft(NOW + 90 * 60e3, NOW), '1 ч 30 мин');
  assert.equal(t('nope.key'), 'nope.key', 'неизвестный ключ возвращается как есть');
});

test('язык данных магазинов следует за языком интерфейса', () => {
  setLang('de');
  assert.equal(steamLang(), 'german');
  assert.equal(epicLocale(), 'de');
  const fx = JSON.parse(read('tests/fixtures/epic.json'));
  const gta = parseEpic(fx, { now: NOW }).find((g) => g.title === 'Grand Theft Auto V');
  assert.equal(gta.url, 'https://store.epicgames.com/de/p/grand-theft-auto-v');
  setLang('en');
  assert.equal(steamLang(), 'english');
  assert.equal(epicLocale(), 'en-US');
  setLang('ru');
});
