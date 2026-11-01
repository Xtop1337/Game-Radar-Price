// Валюта отображения: по языку интерфейса или выбранная вручную; пересчёт по текущему курсу
import { fetchJson } from './http.js';
import { getLang, t } from './i18n/index.js';
import { formatPrice } from './format.js';

export const CURRENCIES = [
  'RUB', 'USD', 'EUR', 'UAH', 'KZT', 'BYN', 'UZS', 'KGS', 'AMD', 'GEL', 'AZN',
  'TRY', 'PLN', 'GBP', 'CZK', 'CHF', 'CAD', 'AUD', 'BRL', 'MXN', 'INR', 'CNY', 'JPY', 'KRW',
];

export const LANG_CURRENCY = { ru: 'RUB', en: 'USD', de: 'EUR', es: 'EUR', tr: 'TRY', pl: 'PLN' };

export function resolveCurrency(setting) {
  return setting && setting !== 'auto' ? setting : LANG_CURRENCY[getLang()] ?? 'USD';
}

// ---------- Курсы (база — USD)
const RATE_SOURCES = [
  ['https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', parseFawazRates],
  ['https://open.er-api.com/v6/latest/USD', parseErApiRates],
];

export async function fetchRates() {
  let lastError;
  for (const [url, parse] of RATE_SOURCES) {
    try {
      const rates = parse(await fetchJson(url));
      if (rates) return rates;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('no exchange rates');
}

export function parseFawazRates(json) {
  const src = json?.usd;
  if (!src || typeof src !== 'object') return null;
  const rates = { USD: 1 };
  for (const [code, value] of Object.entries(src)) {
    if (/^[a-z]{3}$/.test(code) && typeof value === 'number' && value > 0) rates[code.toUpperCase()] = value;
  }
  return Object.keys(rates).length > 10 ? { base: 'USD', rates, date: json.date ?? null, at: Date.now() } : null;
}

export function parseErApiRates(json) {
  if (json?.result !== 'success' || !json.rates) return null;
  return { base: 'USD', rates: { ...json.rates, USD: 1 }, date: json.time_last_update_utc ?? null, at: Date.now() };
}

// Пересчёт через USD; null — если курса нет
export function convert(amount, from, to, rates) {
  if (amount == null || !Number.isFinite(amount)) return null;
  if (!from || !to || from === to) return amount;
  const table = rates?.rates ?? rates;
  const a = from === 'USD' ? 1 : table?.[from];
  const b = to === 'USD' ? 1 : table?.[to];
  if (!a || !b) return null;
  return (amount / a) * b;
}

const roundMoney = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 100) / 100);

// ---------- Контекст отображения (как setLang в i18n)
let ctx = { currency: null, rates: null };

export function setMoneyContext({ currency = null, rates = null } = {}) {
  ctx = { currency, rates };
}

export const displayCurrency = () => ctx.currency;

/**
 * Цена в валюте отображения.
 * Возвращает { text, value, currency, approx, title }: approx = true, если цена пересчитана по курсу.
 */
export function money(value, from) {
  if (value == null || Number.isNaN(value)) return { text: '', value: null, currency: from, approx: false, title: '' };
  const target = ctx.currency;
  if (value === 0 || !target || !from || from === target) {
    return { text: formatPrice(value, from), value, currency: from, approx: false, title: '' };
  }
  const converted = convert(value, from, target, ctx.rates);
  if (converted == null) return { text: formatPrice(value, from), value, currency: from, approx: false, title: '' };
  const v = roundMoney(converted);
  const original = formatPrice(value, from);
  return { text: `≈ ${formatPrice(v, target)}`, value: v, currency: target, approx: true, title: t('money.converted', { price: original }) };
}

export const moneyText = (value, from) => money(value, from).text;

// Значение в валюте отображения (для сортировки); без курса — исходное число
export function moneyValue(value, from) {
  const m = money(value, from);
  return m.value ?? Infinity;
}

export function currencySymbol(code, locale) {
  try {
    const part = new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value ?? code;
  } catch {
    return code;
  }
}

export function currencyName(code, locale) {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}
