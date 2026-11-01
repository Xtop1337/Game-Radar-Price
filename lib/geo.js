// Страна пользователя: по IP (Cloudflare, запасной — country.is), кэш на сутки; иначе — из локали браузера
import { ext } from './api.js';
import { fetchJson } from './http.js';
import { localeTag, browserLang } from './i18n/index.js';

const DAY = 24 * 3600e3;
const isCountry = (cc) => typeof cc === 'string' && /^[A-Z]{2}$/.test(cc) && cc !== 'XX' && cc !== 'T1';

// Страны для ручного выбора (названия — через Intl.DisplayNames на языке интерфейса)
export const COUNTRY_CHOICES = [
  'RU', 'KZ', 'UA', 'BY', 'UZ', 'KG', 'AM', 'AZ', 'GE', 'MD', 'TJ', 'TR', 'US', 'CA', 'GB', 'DE', 'FR',
  'ES', 'IT', 'PL', 'NL', 'SE', 'FI', 'CZ', 'BR', 'AR', 'MX', 'IN', 'CN', 'JP', 'KR', 'AU',
];

export function parseTrace(text) {
  const m = /^loc=([A-Z]{2})\s*$/m.exec(String(text ?? ''));
  return m && isCountry(m[1]) ? m[1] : null;
}

export function localeCountry(tag) {
  try {
    const region = new Intl.Locale(tag).maximize().region;
    return isCountry(region) ? region : null;
  } catch {
    return null;
  }
}

export function countryName(cc, locale = localeTag()) {
  if (!cc) return '';
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(cc) ?? cc;
  } catch {
    return cc;
  }
}

export async function fetchCountry() {
  try {
    const res = await fetch('https://www.cloudflare.com/cdn-cgi/trace', { credentials: 'omit' });
    if (res.ok) {
      const cc = parseTrace(await res.text());
      if (cc) return cc;
    }
  } catch { /* пробуем запасной */ }
  try {
    const json = await fetchJson('https://api.country.is/');
    const cc = String(json?.country ?? '').toUpperCase();
    if (isCountry(cc)) return cc;
  } catch { /* ignore */ }
  return null;
}

/**
 * Итоговая страна: { code, source: 'manual' | 'ip' | 'locale' }.
 * setting — значение настройки country ('auto' или ISO-код).
 */
export async function resolveCountry(setting, { force = false, now = Date.now() } = {}) {
  if (setting && setting !== 'auto' && isCountry(setting)) return { code: setting, source: 'manual' };
  const { geo } = await ext.storage.local.get('geo');
  if (!force && geo?.code && now - geo.at < DAY) return geo;
  const ip = await fetchCountry();
  const next = ip
    ? { code: ip, source: 'ip', at: now }
    // без сети — страна из локали; повторим попытку через час
    : { code: geo?.code ?? localeCountry(browserLang()) ?? 'US', source: geo?.source ?? 'locale', at: now - DAY + 3600e3 };
  await ext.storage.local.set({ geo: next });
  return next;
}
