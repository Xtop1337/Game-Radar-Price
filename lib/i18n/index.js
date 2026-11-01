// Локализация интерфейса: авто по языку браузера или ручной выбор в настройках
import ru from './ru.js';
import en from './en.js';
import de from './de.js';
import es from './es.js';
import tr from './tr.js';
import pl from './pl.js';

const DICTS = { ru, en, de, es, tr, pl };
export const LANGS = Object.keys(DICTS);
export const LANG_NAMES = { ru: 'Русский', en: 'English', de: 'Deutsch', es: 'Español', tr: 'Türkçe', pl: 'Polski' };

const LOCALE_TAGS = { ru: 'ru-RU', en: 'en-US', de: 'de-DE', es: 'es-ES', tr: 'tr-TR', pl: 'pl-PL' };
const STEAM_LANGS = { ru: 'russian', en: 'english', de: 'german', es: 'spanish', tr: 'turkish', pl: 'polish' };
const EPIC_LOCALES = { ru: 'ru', en: 'en-US', de: 'de', es: 'es-ES', tr: 'tr', pl: 'pl' };

let current = 'en';

// 'de-AT' → 'de'; неподдерживаемые языки → английский
export function detectLang(tag) {
  const base = String(tag ?? '').toLowerCase().split(/[-_]/)[0];
  return DICTS[base] ? base : 'en';
}

export function browserLang() {
  try {
    const api = globalThis.browser ?? globalThis.chrome;
    return api?.i18n?.getUILanguage?.() || globalThis.navigator?.language || 'en';
  } catch {
    return 'en';
  }
}

export function resolveLang(setting) {
  return setting && setting !== 'auto' && DICTS[setting] ? setting : detectLang(browserLang());
}

export function setLang(code) {
  current = DICTS[code] ? code : 'en';
  return current;
}

export const getLang = () => current;
export const localeTag = () => LOCALE_TAGS[current];
export const steamLang = () => STEAM_LANGS[current];
export const epicLocale = () => EPIC_LOCALES[current];
export const dictionary = (code) => DICTS[code];

export function t(key, params) {
  let s = DICTS[current][key] ?? DICTS.en[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
  return s;
}

// plural('games', 5) → «5 игр» / «5 games» (формы key.one / key.few / key.many / key.other)
export function plural(key, n) {
  const form = new Intl.PluralRules(LOCALE_TAGS[current]).select(n);
  const pick = (d) => d[`${key}.${form}`] ?? d[`${key}.other`];
  return (pick(DICTS[current]) ?? pick(DICTS.en) ?? key).replace('{n}', n);
}

// Переводит статичную разметку: data-i18n, data-i18n-placeholder, data-i18n-title, data-i18n-aria-label
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    root.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => {
      el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
    });
  }
  if (root === document) {
    document.documentElement.lang = current;
    document.documentElement.classList.add('i18n-ready');
  }
}
