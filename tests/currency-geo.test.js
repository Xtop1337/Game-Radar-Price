import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFawazRates, parseErApiRates, convert, money, moneyText, moneyValue, setMoneyContext, resolveCurrency,
} from '../lib/currency.js';
import { parseTrace, countryName, localeCountry } from '../lib/geo.js';
import { getRegion } from '../lib/regions.js';
import { setLang } from '../lib/i18n/index.js';
import { evaluateWishlist, isTargetReached, makeWishlistItem } from '../lib/wishlist.js';
import { mergeSettings } from '../lib/storage.js';

const RATES = { base: 'USD', rates: { USD: 1, RUB: 90, EUR: 0.9, KZT: 500, TRY: 40 } };

test('курсы: разбор обоих источников', () => {
  const fawaz = parseFawazRates({
    date: '2026-11-01',
    usd: { rub: 90, eur: 0.9, kzt: 500, uah: 41, try: 40, pln: 3.9, gbp: 0.78, jpy: 150, cny: 7.1, inr: 88, brl: 5.4, '1inch': 3 },
  });
  assert.equal(fawaz.rates.RUB, 90);
  assert.equal(fawaz.rates.USD, 1);
  assert.equal(fawaz.rates['1INCH'], undefined, 'криптовалюты/мусор отбрасываются');
  assert.equal(parseFawazRates({ usd: {} }), null);

  const er = parseErApiRates({ result: 'success', rates: { RUB: 91, EUR: 0.91 } });
  assert.equal(er.rates.RUB, 91);
  assert.equal(parseErApiRates({ result: 'error' }), null);
});

test('convert: прямой и кросс-курс, нет курса → null', () => {
  assert.equal(convert(10, 'USD', 'RUB', RATES), 900);
  assert.equal(convert(900, 'RUB', 'USD', RATES), 10);
  assert.ok(Math.abs(convert(900, 'RUB', 'EUR', RATES) - 9) < 1e-9);
  assert.equal(convert(5, 'EUR', 'EUR', null), 5);
  assert.equal(convert(5, 'USD', 'XYZ', RATES), null);
  assert.equal(convert(5, 'USD', 'RUB', null), null);
});

test('money(): ≈ только при пересчёте, округление, без курса — исходная валюта', () => {
  setLang('ru');
  setMoneyContext({ currency: 'RUB', rates: RATES });
  const usd = money(3.99, 'USD');
  assert.equal(usd.approx, true);
  assert.equal(usd.value, 359);
  assert.match(usd.text, /^≈\s359\s₽$/);
  assert.match(usd.title, /3,99\s\$/);

  const rub = money(1199, 'RUB');
  assert.equal(rub.approx, false);
  assert.match(rub.text, /^1\s199\s₽$/);

  assert.equal(moneyText(0, 'USD'), 'Бесплатно');
  assert.equal(money(0.5, 'USD').value, 45);
  assert.equal(money(1, 'TRY').value, 2.25, 'мелкие суммы — с копейками');

  setMoneyContext({ currency: 'RUB', rates: null });
  assert.match(moneyText(3.99, 'USD'), /3,99\s\$/, 'без курсов показываем как есть');

  setMoneyContext({ currency: 'RUB', rates: RATES });
  assert.ok(moneyValue(10, 'USD') > moneyValue(100, 'RUB'), 'сортировка в одной валюте');
  setMoneyContext({});
});

test('валюта по умолчанию следует за языком интерфейса', () => {
  const expect = { ru: 'RUB', en: 'USD', de: 'EUR', es: 'EUR', tr: 'TRY', pl: 'PLN' };
  for (const [lang, cur] of Object.entries(expect)) {
    setLang(lang);
    assert.equal(resolveCurrency('auto'), cur, lang);
    assert.equal(resolveCurrency('KZT'), 'KZT', 'ручной выбор важнее языка');
  }
  setLang('ru');
});

test('страна: Cloudflare trace, локаль, название на языке интерфейса', () => {
  assert.equal(parseTrace('fl=123\nh=www.cloudflare.com\nip=1.2.3.4\nloc=KZ\ntls=TLSv1.3\n'), 'KZ');
  assert.equal(parseTrace('loc=XX\n'), null);
  assert.equal(parseTrace('no loc here'), null);
  assert.equal(localeCountry('ru-RU'), 'RU');
  assert.equal(localeCountry('ru'), 'RU');
  assert.equal(localeCountry('de'), 'DE');
  setLang('ru');
  assert.equal(countryName('KZ'), 'Казахстан');
  assert.equal(getRegion('KZ').label, 'Казахстан');
  assert.equal(getRegion('KZ').cc, 'kz');
  setLang('en');
  assert.equal(countryName('KZ'), 'Kazakhstan');
  assert.equal(getRegion(undefined).code, 'US');
  setLang('ru');
});

test('настройки: старое region: RU не мешает автоопределению страны', () => {
  const s = mergeSettings({ region: 'RU', theme: 'dark' });
  assert.equal(s.region, undefined);
  assert.equal(s.country, 'auto');
  assert.equal(s.currency, 'auto');
  assert.equal(s.theme, 'dark');
});

test('желаемое: цель в рублях, цена магазина в долларах', () => {
  const item = { ...makeWishlistItem({ title: 'Hades', key: 'cs:1', cheapsharkId: '1', currency: 'USD' }), targetPrice: 400, targetCurrency: 'RUB' };
  const prices = new Map([['cs:1', { price: 3.99, oldPrice: 24.99, discount: 84, currency: 'USD', store: 'epic' }]]);

  const r1 = evaluateWishlist([item], prices, [], Date.now(), RATES);
  assert.equal(r1.items[0].targetReached, true, '3,99 $ ≈ 359 ₽ ≤ 400 ₽');
  assert.deepEqual(r1.alerts.map((a) => a.type), ['target']);

  const r2 = evaluateWishlist([{ ...item, targetPrice: 300 }], prices, [], Date.now(), RATES);
  assert.equal(r2.items[0].targetReached, false);

  // без курсов цели в другой валюте не срабатывают ложно
  assert.equal(isTargetReached({ ...item, price: 3.99 }, null), false);
  // старые записи без targetCurrency — сравнение в валюте цены
  assert.equal(isTargetReached({ price: 5, currency: 'USD', targetPrice: 6 }, null), true);
});
