// Форматирование цен, дат и таймеров на языке интерфейса
import { t, localeTag } from './i18n/index.js';

export function formatPrice(value, currency) {
  if (value == null || Number.isNaN(value)) return '';
  if (value === 0) return t('price.free');
  const frac = Number.isInteger(value) || value >= 1000 ? 0 : 2;
  try {
    return new Intl.NumberFormat(localeTag(), {
      style: 'currency',
      currency: currency || 'USD',
      currencyDisplay: 'narrowSymbol', // ₽ / $ / € вместо RUB / USD на любом языке
      minimumFractionDigits: frac,
      maximumFractionDigits: frac,
    }).format(value);
  } catch {
    return `${value} ${currency ?? ''}`.trim();
  }
}

export function formatTimeLeft(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = ts - now;
  if (diff <= 0) return t('time.ended');
  const totalMin = Math.floor(diff / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return t('time.days', { d, h });
  if (h > 0) return t('time.hours', { h, m });
  return t('time.mins', { m: Math.max(m, 1) });
}

export function formatDate(ts, withTime = true) {
  if (!ts) return '';
  const opts = { day: 'numeric', month: 'short' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return new Intl.DateTimeFormat(localeTag(), opts).format(new Date(ts));
}

export function formatAgo(ts, now = Date.now()) {
  if (!ts) return t('time.never');
  const min = Math.floor((now - ts) / 60000);
  if (min < 1) return t('time.justNow');
  if (min < 60) return t('time.minAgo', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('time.hAgo', { n: h });
  return formatDate(ts);
}

// Нормализация названия для сравнения игр между магазинами
export function normTitle(title) {
  return String(title ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const STORE_NAMES = {
  steam: 'Steam',
  epic: 'Epic',
  gog: 'GOG',
  ubisoft: 'Ubisoft',
  itch: 'itch.io',
  prime: 'Prime',
  ea: 'EA',
  battlenet: 'Battle.net',
};

export function storeLabel(store) {
  return STORE_NAMES[store] ?? (store && store !== 'other' ? store : t('store.other'));
}

// Группа магазина для фильтров: steam / epic / gog / other
export function storeGroup(store) {
  return store === 'steam' || store === 'epic' || store === 'gog' ? store : 'other';
}
