import { ext, HOST_ORIGINS, hasHostPermissions } from '../lib/api.js';
import { getSettings, saveSettings, getWishlist, setLocal } from '../lib/storage.js';
import { COUNTRY_CHOICES, countryName, resolveCountry } from '../lib/geo.js';
import { CURRENCIES, LANG_CURRENCY, currencySymbol, currencyName } from '../lib/currency.js';
import {
  t, plural, setLang, resolveLang, applyI18n, detectLang, browserLang, getLang, localeTag, LANGS, LANG_NAMES,
} from '../lib/i18n/index.js';

const $ = (s) => document.querySelector(s);
let settings;
let detected = null; // страна, определённая по IP

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

async function save(patch, messageKey = 'opt.saved') {
  settings = await saveSettings(patch);
  toast(t(messageKey));
}

function option(value, text) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = text;
  return opt;
}

const currencyLabel = (code) => `${currencySymbol(code, localeTag())} ${code} — ${currencyName(code, localeTag())}`;

// Списки, текст которых зависит от языка: язык, страна, валюта
function fillSelects() {
  const lang = $('#language');
  lang.replaceChildren(
    option('auto', t('opt.langAuto', { lang: LANG_NAMES[detectLang(browserLang())] })),
    ...LANGS.map((code) => option(code, LANG_NAMES[code])),
  );
  lang.value = settings.language ?? 'auto';

  const country = $('#country');
  const auto = detected?.code ? countryName(detected.code) : t('opt.countryDetecting');
  const sorted = [...COUNTRY_CHOICES].sort((a, b) => countryName(a).localeCompare(countryName(b), localeTag()));
  if (settings.country !== 'auto' && !sorted.includes(settings.country)) sorted.unshift(settings.country);
  country.replaceChildren(option('auto', t('opt.countryAuto', { country: auto })), ...sorted.map((cc) => option(cc, countryName(cc))));
  country.value = settings.country ?? 'auto';

  const currency = $('#currency');
  const langCurrency = LANG_CURRENCY[getLang()] ?? 'USD';
  currency.replaceChildren(
    option('auto', t('opt.currencyAuto', { currency: `${currencySymbol(langCurrency, localeTag())} ${langCurrency}` })),
    ...CURRENCIES.map((code) => option(code, currencyLabel(code))),
  );
  currency.value = settings.currency ?? 'auto';
}

function applyLanguage() {
  setLang(resolveLang(settings.language));
  applyI18n();
  fillSelects();
}

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = settings.theme;
  if (settings.animations === false) root.dataset.motion = 'off'; else delete root.dataset.motion;
  try {
    localStorage.setItem('gr-theme', settings.theme);
    localStorage.setItem('gr-motion', settings.animations === false ? 'off' : 'on');
  } catch { /* ignore */ }
  const seg = $('#theme');
  const buttons = [...seg.querySelectorAll('button')];
  const idx = buttons.findIndex((b) => b.dataset.value === settings.theme);
  buttons.forEach((b, i) => b.classList.toggle('active', i === idx));
  seg.querySelector('.seg-indicator').style.transform = `translateX(${idx * 100}%)`;
}

async function checkPerms() {
  $('#permCard').hidden = await hasHostPermissions();
}

async function init() {
  settings = await getSettings();
  ({ geo: detected } = await ext.storage.local.get('geo'));
  applyLanguage();
  // уточняем страну по IP (из кэша на сутки) и обновляем подпись «Авто (по IP: …)»
  resolveCountry('auto').then((geo) => { detected = geo; fillSelects(); }).catch(() => {});

  $('#language').addEventListener('change', async (e) => {
    settings = await saveSettings({ language: e.target.value });
    applyLanguage();
    toast(t('opt.langSaved'));
  });
  $('#country').addEventListener('change', (e) => save({ country: e.target.value }, 'opt.regionSaved'));
  $('#currency').addEventListener('change', (e) => save({ currency: e.target.value }, 'opt.currencySaved'));

  for (const id of ['intervalMin', 'minDiscount', 'notifyDealsMin']) {
    const el = $(`#${id}`);
    el.value = String(settings[id]);
    el.addEventListener('change', () => save({ [id]: Number(el.value) }));
  }

  for (const id of ['useGamerPower', 'notifyGiveaways', 'notifyWishlist', 'notifyDeals', 'animations']) {
    const el = $(`#${id}`);
    el.checked = Boolean(settings[id]);
    el.addEventListener('change', async () => {
      await save({ [id]: el.checked });
      if (id === 'animations') applyTheme();
      if (id === 'notifyDeals') $('#notifyDealsMin').closest('.field').classList.toggle('disabled', !el.checked);
    });
  }
  $('#notifyDealsMin').closest('.field').classList.toggle('disabled', !settings.notifyDeals);

  document.querySelectorAll('[data-store]').forEach((el) => {
    el.checked = settings.stores[el.dataset.store] !== false;
    el.addEventListener('change', () => save({ stores: { ...settings.stores, [el.dataset.store]: el.checked } }));
  });

  $('#theme').querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    await save({ theme: b.dataset.value });
    applyTheme();
  }));
  applyTheme();

  $('#grantBtn').addEventListener('click', async () => {
    const ok = await ext.permissions.request({ origins: HOST_ORIGINS });
    toast(t(ok ? 'opt.permGranted' : 'opt.permDenied'));
    if (ok) ext.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
    checkPerms();
  });
  checkPerms();

  $('#testNotify').addEventListener('click', () => {
    ext.notifications.create({
      type: 'basic',
      iconUrl: ext.runtime.getURL('icons/icon-128.png'),
      title: t('n.testTitle'),
      message: t('n.testMsg'),
    });
  });

  $('#exportBtn').addEventListener('click', async () => {
    const blob = new Blob([JSON.stringify(await getWishlist(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'game-radar-wishlist.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error('bad format');
      const current = await getWishlist();
      const keys = new Set(current.map((w) => w.key));
      const merged = [...current, ...data.filter((w) => w?.key && w?.title && !keys.has(w.key))];
      await setLocal({ wishlist: merged });
      toast(t('opt.imported', { games: plural('games', merged.length - current.length) }));
      ext.runtime.sendMessage({ type: 'refreshWishlist' }).catch(() => {});
    } catch {
      toast(t('opt.importFail'));
    }
    e.target.value = '';
  });
  $('#clearCache').addEventListener('click', async () => {
    await ext.storage.local.remove(['cache', 'seenDeals']);
    toast(t('opt.cleared'));
    ext.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
  });
}

init();
