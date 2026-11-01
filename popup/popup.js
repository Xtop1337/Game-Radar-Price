import { ext, hasHostPermissions } from '../lib/api.js';
import { getSettings, saveSettings, getLocal, setLocal, getCache, getWishlist, updateWishlist } from '../lib/storage.js';
import { compose, sourceErrors } from '../lib/compose.js';
import { getRegion } from '../lib/regions.js';
import { localeCountry } from '../lib/geo.js';
import { money, moneyValue, setMoneyContext, resolveCurrency, displayCurrency } from '../lib/currency.js';
import { isTargetReached } from '../lib/wishlist.js';
import {
  formatPrice, formatTimeLeft, formatDate, formatAgo, normTitle, storeLabel, storeGroup,
} from '../lib/format.js';
import { t, setLang, resolveLang, applyI18n, browserLang } from '../lib/i18n/index.js';
import { searchSteam, parseSteamTab, fetchSteamApp, steamHeader, steamUrl } from '../lib/sources/steam.js';
import { searchCheapShark } from '../lib/sources/cheapshark.js';
import { makeWishlistItem } from '../lib/wishlist.js';

const $ = (sel) => document.querySelector(sel);
const TABS = ['giveaways', 'deals', 'wishlist'];
const DEAL_PAGE = 40;

const state = {
  tab: 'giveaways',
  settings: null,
  cache: null,
  wishlist: [],
  rates: null,
  geo: null,
  data: { giveaways: [], upcoming: [], deals: [] },
  newIds: new Set(),
  gwStore: 'all',
  deal: { store: 'all', min: 0, sort: 'discount', q: '', limit: DEAL_PAGE },
  refreshing: false,
  rendered: new Set(), // какие вкладки уже анимировали появление
};

// ---------- DOM-хелперы (без innerHTML — данные приходят из сети)
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function icon(name, cls = 'icon') {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', cls);
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function img(src, cls, fallbackTitle) {
  if (!src) return h('div', { class: 'thumb-ph' }, (fallbackTitle ?? '?').trim().charAt(0).toUpperCase());
  const el = h('img', { class: cls, src, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  el.addEventListener('load', () => el.classList.add('loaded'));
  el.addEventListener('error', () => {
    if (cls === 'thumb') el.replaceWith(img(null, cls, fallbackTitle));
    else el.style.visibility = 'hidden';
  });
  return el;
}

// Цена в валюте отображения; пересчитанная по курсу помечена ≈ и подсказкой с исходной ценой
function priceEl(value, currency, cls) {
  const m = money(value, currency);
  // у зачёркнутой старой цены знак ≈ не нужен — достаточно подсказки
  const text = cls === 'price-old' ? m.text.replace(/^≈\s/, '') : m.text;
  return h('span', { class: `${cls}${m.approx ? ' approx' : ''}`, title: m.title || null }, text);
}

// Страна пользователя: из кэша (последнее обновление), затем по IP, затем из локали браузера
function currentRegion() {
  return getRegion(state.cache?.region ?? state.geo?.code ?? localeCountry(browserLang()));
}

function applyMoney() {
  setMoneyContext({ currency: resolveCurrency(state.settings.currency), rates: state.rates });
}

const storeBadge = (store) => h('span', { class: `store-badge ${store}` }, storeLabel(store));

function openUrl(url) {
  if (!url) return;
  ext.tabs.create({ url });
  window.close();
}

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

const isWished = (item) =>
  state.wishlist.some((w) => (item.steamAppId && w.steamAppId === item.steamAppId) || normTitle(w.title) === normTitle(item.title));

function timerEl(endsAt, extraClass = '') {
  const soon = endsAt - Date.now() < 24 * 3600e3;
  return h('span', { class: `timer ${soon ? 'soon' : ''} ${extraClass}`, dataset: { ends: endsAt }, title: t('gw.until', { date: formatDate(endsAt) }) },
    icon('clock'), formatTimeLeft(endsAt));
}

// ---------- Тема
const THEME_ORDER = ['auto', 'light', 'dark'];
const THEME_ICON = { auto: 'auto', light: 'sun', dark: 'moon' };

function applyTheme(theme, animations) {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme; else root.dataset.theme = theme;
  if (animations === false) root.dataset.motion = 'off'; else delete root.dataset.motion;
  const btn = $('#themeBtn');
  btn.querySelector('use').setAttribute('href', `#i-${THEME_ICON[theme]}`);
  btn.title = t(`theme.${theme}`);
  try {
    localStorage.setItem('gr-theme', theme);
    localStorage.setItem('gr-motion', animations === false ? 'off' : 'on');
  } catch { /* ignore */ }
}

async function cycleTheme() {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(state.settings.theme) + 1) % THEME_ORDER.length];
  const btn = $('#themeBtn');
  btn.classList.add('flip');
  setTimeout(() => btn.classList.remove('flip'), 220);
  state.settings = await saveSettings({ theme: next });
  applyTheme(next, state.settings.animations);
  toast(t(`theme.${next}`));
}

// ---------- Вкладки
function moveIndicator() {
  const idx = TABS.indexOf(state.tab);
  $('.tab-indicator').style.transform = `translateX(${idx * 100}%)`;
}

function switchTab(tab) {
  if (tab === state.tab) return;
  const dir = TABS.indexOf(tab) > TABS.indexOf(state.tab) ? 'enter-right' : 'enter-left';
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-selected', b.dataset.tab === tab);
  });
  moveIndicator();
  for (const t of TABS) {
    const p = $(`#panel-${t}`);
    p.hidden = t !== tab;
    p.classList.remove('enter-right', 'enter-left');
  }
  const panel = $(`#panel-${tab}`);
  void panel.offsetWidth; // перезапуск анимации
  panel.classList.add(dir);
  $('#main').scrollTop = 0;
  render();
  try { sessionStorage.setItem('gr-tab', tab); } catch { /* ignore */ }
}

// ---------- Статус
function renderStatus() {
  const el = $('#status');
  const errs = sourceErrors(state.cache?.sources);
  const region = currentRegion();
  if (state.refreshing) {
    el.textContent = t('status.refreshing');
    el.className = 'status';
    el.title = '';
    return;
  }
  el.textContent = `${region.label} · ${formatAgo(state.cache?.updatedAt)}${errs.length ? ` · ${t('status.partial')}` : ''}`;
  el.className = `status ${errs.length ? 'error' : ''}`;
  el.title = errs.join('\n');
}

function renderCounts() {
  const g = state.data.giveaways.length;
  const cg = $('#cnt-giveaways');
  cg.textContent = g || '';
  cg.classList.toggle('hot', state.newIds.size > 0);
  $('#cnt-deals').textContent = state.data.deals.length || '';
  const hits = state.wishlist.filter((w) => w.targetReached || w.freeNow).length;
  const cw = $('#cnt-wishlist');
  cw.textContent = hits ? `${hits}★` : state.wishlist.length || '';
  cw.classList.toggle('hot', hits > 0);
}

// ---------- Раздачи
function giveawayCard(g, i, animate) {
  const card = h('article', {
    class: `gcard ${animate ? 'anim-in' : ''}`,
    style: `--i:${i}`,
    onclick: () => openUrl(g.url),
    title: g.description ? g.description.slice(0, 300) : g.title,
  },
  h('div', { class: 'gcard-media' },
    img(g.image, 'cover', g.title),
    storeBadge(g.store),
    state.newIds.has(g.id) ? h('span', { class: 'new-pill' }, 'NEW') : null,
    g.endsAt ? timerEl(g.endsAt) : null,
  ),
  h('div', { class: 'gcard-body' },
    h('div', { class: 'gcard-info' },
      h('h3', { class: 'gcard-title' }, g.title),
      h('div', { class: 'prices' },
        g.oldPrice ? priceEl(g.oldPrice, g.currency, 'price-old') : null,
        h('span', { class: 'price-free' }, t('price.free')),
      ),
    ),
    h('button', { class: 'btn primary', onclick: (e) => { e.stopPropagation(); openUrl(g.url); } }, t('gw.claim')),
  ));
  return card;
}

function upcomingRow(g, i, animate) {
  return h('div', { class: `row ${animate ? 'anim-in' : ''}`, style: `--i:${i}`, onclick: () => openUrl(g.url) },
    img(g.image, 'thumb', g.title),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, g.title),
      h('div', { class: 'row-sub' }, storeBadge(g.store), icon('calendar'),
        t('gw.from', { date: formatDate(g.startsAt) }), g.startsAt ? ` · ${t('gw.in', { time: formatTimeLeft(g.startsAt) })}` : ''),
    ),
    h('div', { class: 'row-price' },
      g.oldPrice ? priceEl(g.oldPrice, g.currency, 'price-old') : null,
      h('span', { class: 'price-free' }, t('gw.soon')),
    ),
  );
}

function storeChips(container, items, active, onPick) {
  clear(container);
  const counts = { all: items.length, epic: 0, steam: 0, gog: 0, other: 0 };
  for (const i of items) counts[storeGroup(i.store)]++;
  const defs = [['all', t('chips.all')], ['epic', 'Epic'], ['steam', 'Steam'], ['gog', 'GOG'], ['other', t('chips.other')]];
  for (const [key, label] of defs) {
    if (key !== 'all' && !counts[key]) continue;
    container.append(h('button', { class: `chip ${active === key ? 'active' : ''}`, onclick: () => onPick(key) },
      label, h('small', {}, counts[key])));
  }
}

function emptyState(iconName, title, text) {
  return h('div', { class: 'empty' }, icon(iconName), h('h3', {}, title), h('p', {}, text));
}

function skeleton(kind, n) {
  return Array.from({ length: n }, () => h('div', { class: `skeleton ${kind}` }));
}

function renderGiveaways() {
  const list = clear($('#gwList'));
  const animate = !state.rendered.has('giveaways');
  const { giveaways, upcoming } = state.data;
  if (!state.cache) {
    clear($('#gwChips'));
    list.append(...skeleton('sk-card', 2));
    return;
  }
  storeChips($('#gwChips'), giveaways, state.gwStore, (k) => { state.gwStore = k; state.rendered.delete('giveaways'); renderGiveaways(); });
  const shown = giveaways.filter((g) => state.gwStore === 'all' || storeGroup(g.store) === state.gwStore);
  if (!shown.length && !upcoming.length) {
    list.append(emptyState('gift', t('gw.emptyTitle'), t('gw.emptyText')));
  }
  if (shown.length) {
    list.append(h('div', { class: 'section-title' }, icon('gift'), t('gw.nowFree', { n: shown.length })));
    shown.forEach((g, i) => list.append(giveawayCard(g, i, animate)));
  }
  const up = upcoming.filter((g) => state.gwStore === 'all' || storeGroup(g.store) === state.gwStore);
  if (up.length) {
    list.append(h('div', { class: 'section-title' }, icon('calendar'), t('gw.soonFree')));
    up.forEach((g, i) => list.append(upcomingRow(g, shown.length + i, animate)));
  }
  state.rendered.add('giveaways');
}

// ---------- Скидки
function dealRow(d, i, animate) {
  const liked = isWished(d);
  const heart = h('button', {
    class: `mini-btn ${liked ? 'liked' : ''}`,
    title: liked ? t('deals.inWishlist') : t('deals.toWishlist'),
    onclick: async (e) => {
      e.stopPropagation();
      if (isWished(d)) return toast(t('wl.already'));
      await addToWishlist(makeWishlistItem({ ...d, key: d.steamAppId ? `steam:${d.steamAppId}` : d.gameID ? `cs:${d.gameID}` : undefined, cheapsharkId: d.gameID ?? null }));
      heart.classList.add('liked');
    },
  }, icon('heart'));
  return h('div', { class: `row ${animate ? 'anim-in' : ''}`, style: `--i:${i}`, onclick: () => openUrl(d.url), title: d.title },
    img(d.image, 'thumb', d.title),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, d.title),
      h('div', { class: 'row-sub' },
        storeBadge(d.store),
        d.rating ? h('span', {}, `👍 ${d.rating}%`) : d.metacritic ? h('span', {}, `MC ${d.metacritic}`) : null,
        d.endsAt ? h('span', { title: formatDate(d.endsAt) }, `⏳ ${formatTimeLeft(d.endsAt)}`) : null,
      ),
    ),
    h('div', { class: 'row-price' },
      h('span', { class: `disc ${d.discount >= 75 ? 'mega' : ''}` }, `−${d.discount}%`),
      h('span', {}, d.oldPrice ? priceEl(d.oldPrice, d.currency, 'price-old') : null),
      priceEl(d.price, d.currency, 'price-now'),
    ),
    heart,
  );
}

function filteredDeals() {
  const { store, min, sort, q } = state.deal;
  const nq = normTitle(q);
  const list = state.data.deals.filter((d) =>
    (store === 'all' || storeGroup(d.store) === store) && d.discount >= min && (!nq || normTitle(d.title).includes(nq)));
  const sorters = {
    discount: (a, b) => b.discount - a.discount,
    price: (a, b) => moneyValue(a.price, a.currency) - moneyValue(b.price, b.currency),
    rating: (a, b) => (b.rating ?? b.metacritic ?? 0) - (a.rating ?? a.metacritic ?? 0),
    ending: (a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity),
  };
  return list.sort(sorters[sort] ?? sorters.discount);
}

function renderDeals() {
  const list = clear($('#dealList'));
  const animate = !state.rendered.has('deals');
  if (!state.cache) {
    list.append(...skeleton('sk-row', 7));
    return;
  }
  storeChips($('#dealChips'), state.data.deals, state.deal.store, (k) => {
    state.deal.store = k; state.deal.limit = DEAL_PAGE; state.rendered.delete('deals'); renderDeals();
  });
  const deals = filteredDeals();
  if (!deals.length) {
    list.append(emptyState('tag', t('deals.emptyTitle'), t('deals.emptyText')));
  }
  deals.slice(0, state.deal.limit).forEach((d, i) => list.append(dealRow(d, i, animate)));
  if (deals.length > state.deal.limit) {
    list.append(h('div', { class: 'more' }, h('button', {
      class: 'btn ghost',
      onclick: () => { state.deal.limit += DEAL_PAGE; state.rendered.add('deals'); renderDeals(); },
    }, t('deals.more', { n: deals.length - state.deal.limit }))));
  }
  state.rendered.add('deals');
}

// ---------- Желаемое
async function addToWishlist(item) {
  let added = false;
  await updateWishlist((list) => {
    if (list.some((w) => w.key === item.key || (item.steamAppId && w.steamAppId === item.steamAppId))) return list;
    added = true;
    return [item, ...list];
  });
  if (added) {
    toast(t('wl.added', { title: item.title }));
    ext.runtime.sendMessage({ type: 'refreshWishlist' }).catch(() => {});
  } else {
    toast(t('wl.already'));
  }
  return added;
}

function wishlistRow(w, i, animate) {
  const currency = w.currency;
  // цель задаётся в валюте отображения (или в той, в которой её задали раньше)
  // у старых записей без targetCurrency цель задана в валюте цены (так же считает isTargetReached)
  const targetCurrency = w.targetCurrency ?? (w.targetPrice != null ? currency : null) ?? displayCurrency() ?? currency;
  const input = h('input', {
    type: 'number', min: '0', step: 'any', inputmode: 'decimal', placeholder: t('wl.targetAny'),
    value: w.targetPrice ?? '',
    title: t('wl.targetTitle'),
    onchange: async (e) => {
      const raw = e.target.value.trim().replace(',', '.');
      const val = raw === '' ? null : Math.max(0, parseFloat(raw));
      await updateWishlist((list) => list.map((x) => (x.key === w.key
        ? (() => {
          const next = { ...x, targetPrice: Number.isFinite(val) ? val : null, targetCurrency, notifiedPrice: null };
          return { ...next, targetReached: isTargetReached(next, state.rates) };
        })()
        : x)));
      toast(val == null ? t('wl.targetCleared') : t('wl.targetSet', { price: formatPrice(val, targetCurrency) }));
    },
  });
  const removeBtn = h('button', {
    class: 'mini-btn danger', title: t('wl.remove'),
    onclick: async (e) => {
      e.stopPropagation();
      row.classList.add('removing');
      setTimeout(() => updateWishlist((list) => list.filter((x) => x.key !== w.key)), 240);
    },
  }, icon('trash'));

  let flag = null;
  if (w.freeNow) flag = h('span', { class: 'flag free' }, icon('gift'), t('wl.freeNow'));
  else if (w.targetReached) flag = h('span', { class: 'flag ok' }, icon('check'), t('wl.targetReached'));

  const priceBlock = h('div', { class: 'row-price' },
    w.discount > 0 ? h('span', { class: `disc ${w.discount >= 75 ? 'mega' : ''}` }, `−${w.discount}%`) : null,
    w.discount > 0 && w.oldPrice ? priceEl(w.oldPrice, currency, 'price-old') : null,
    w.price != null ? priceEl(w.price, currency, 'price-now') : h('span', { class: 'price-now' }, '—'),
  );

  const row = h('div', { class: `row wl-item ${w.freeNow ? 'free-now' : w.targetReached ? 'hit' : ''} ${animate ? 'anim-in' : ''}`, style: `--i:${i}` },
    img(w.image, 'thumb', w.title),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', title: t('wl.open'), onclick: () => openUrl(w.freeNow?.url ?? w.url) }, w.title),
      h('div', { class: 'row-sub' },
        w.dealStore || w.store ? storeBadge(w.dealStore ?? w.store) : null,
        w.lowest != null ? h('span', { title: t('wl.lowestTitle') }, t('wl.lowest', { price: money(w.lowest, 'USD').text })) : null,
        w.checkedAt ? h('span', { title: t('wl.checked') }, formatAgo(w.checkedAt)) : h('span', {}, t('wl.pending')),
      ),
    ),
    priceBlock,
    h('div', { class: 'wl-bottom' },
      h('label', { class: 'target' }, icon('target'), t('wl.target'), input, targetCurrency ?? ''),
      flag,
      removeBtn,
    ),
  );
  return row;
}

function renderWishlist() {
  const list = clear($('#wlList'));
  const animate = !state.rendered.has('wishlist');
  if (!state.wishlist.length) {
    list.append(emptyState('heart', t('wl.emptyTitle'), t('wl.emptyText')));
  }
  const sorted = [...state.wishlist].sort((a, b) =>
    (Number(Boolean(b.freeNow)) - Number(Boolean(a.freeNow))) || (Number(Boolean(b.targetReached)) - Number(Boolean(a.targetReached))) || ((b.discount ?? 0) - (a.discount ?? 0)));
  sorted.forEach((w, i) => list.append(wishlistRow(w, i, animate)));
  state.rendered.add('wishlist');
}

// Поиск игр
let searchSeq = 0;
let searchTimer;
function onSearchInput(e) {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { clear($('#wlResults')); return; }
  searchTimer = setTimeout(() => runSearch(q), 380);
}

function resultRow(r) {
  return h('div', { class: 'row', title: t('wl.addTitle'), onclick: async () => {
    if (await addToWishlist(makeWishlistItem(r))) {
      $('#wlSearch').value = '';
      clear($('#wlResults'));
    }
  } },
  img(r.image, 'thumb', r.title),
  h('div', { class: 'row-main' },
    h('div', { class: 'row-title' }, r.title),
    h('div', { class: 'row-sub' }, r.store ? storeBadge(r.store) : h('span', {}, t('wl.multiStore'))),
  ),
  h('div', { class: 'row-price' },
    r.discount > 0 ? h('span', { class: 'disc' }, `−${r.discount}%`) : null,
    h('span', { class: 'price-now' }, Number.isFinite(r.price) ? (r.store ? money(r.price, r.currency).text : t('wl.fromPrice', { price: money(r.price, 'USD').text })) : ''),
  ),
  h('button', { class: 'mini-btn', title: t('wl.add') }, icon('plus')));
}

async function runSearch(q) {
  const seq = ++searchSeq;
  const box = clear($('#wlResults'));
  box.append(...skeleton('sk-row', 3));
  const region = currentRegion();
  const [steam, cs] = await Promise.allSettled([searchSteam(q, region), searchCheapShark(q)]);
  if (seq !== searchSeq) return;
  clear(box);
  const steamItems = steam.status === 'fulfilled' ? steam.value.slice(0, 6) : [];
  const steamIds = new Set(steamItems.map((s) => s.steamAppId));
  const steamTitles = new Set(steamItems.map((s) => normTitle(s.title)));
  const csItems = cs.status === 'fulfilled'
    ? cs.value.filter((c) => !steamIds.has(c.steamAppId) && !steamTitles.has(normTitle(c.title))).slice(0, 5)
    : [];
  const all = [...steamItems, ...csItems];
  if (!all.length) {
    box.append(h('div', { class: 'hint' }, steam.status === 'rejected' && cs.status === 'rejected'
      ? t('wl.searchFail') : t('wl.notFound')));
    return;
  }
  all.forEach((r) => box.append(resultRow(r)));
}

// Добавление открытой вкладки
async function addFromTab() {
  let tab;
  try {
    [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  } catch { /* ignore */ }
  const url = tab?.url ?? '';
  const title = tab?.title ?? '';
  const region = currentRegion();

  const steam = parseSteamTab(url, title);
  if (steam) {
    let p = null;
    try { p = await fetchSteamApp(steam.appId, region); } catch { /* ignore */ }
    await addToWishlist(makeWishlistItem({
      key: `steam:${steam.appId}`, title: p?.title ?? steam.title, steamAppId: steam.appId, store: 'steam',
      image: p?.image ?? steamHeader(steam.appId), url: steamUrl(steam.appId),
      price: p?.price ?? null, oldPrice: p?.oldPrice ?? null, discount: p?.discount ?? 0, currency: p?.currency ?? null,
    }));
    return;
  }

  const epic = /store\.epicgames\.com\/(?:[a-z-]+\/)?(?:p|bundles)\/([^/?#]+)/i.exec(url);
  const gog = /gog\.com\/(?:[a-z]{2}\/)?game\/([^/?#]+)/i.exec(url);
  if (epic || gog) {
    const store = epic ? 'epic' : 'gog';
    const name = title.split(/\s+[|–—-]\s+/)[0].replace(/\s+(?:on|в|на|auf|en|w|na)\s+GOG\.com.*$/i, '').trim()
      || decodeURIComponent((epic ?? gog)[1]).replace(/[-_]/g, ' ');
    let match = null;
    try {
      const found = await searchCheapShark(name);
      match = found.find((f) => normTitle(f.title) === normTitle(name)) ?? found[0] ?? null;
    } catch { /* ignore */ }
    await addToWishlist(makeWishlistItem(match
      ? { ...match, title: name, store, url }
      : { key: `title:${normTitle(name)}`, title: name, store, url }));
    return;
  }
  toast(t('wl.openGamePage'));
}

// ---------- Общий рендер
function recompute() {
  state.data = compose(state.cache?.sources, state.settings);
}

function render() {
  renderStatus();
  renderCounts();
  if (state.tab === 'giveaways') renderGiveaways();
  else if (state.tab === 'deals') renderDeals();
  else renderWishlist();
}

async function refresh({ manual = false } = {}) {
  if (state.refreshing) return;
  state.refreshing = true;
  $('#refreshBtn').classList.add('spinning');
  renderStatus();
  try {
    const res = await ext.runtime.sendMessage({ type: 'refresh' });
    if (manual) toast(res?.ok ? t('toast.updated') : res?.error ? t('toast.updateFailWith', { error: res.error }) : t('toast.updateFail'));
  } catch (e) {
    if (manual) toast(t('toast.updateFail'));
  } finally {
    state.refreshing = false;
    $('#refreshBtn').classList.remove('spinning');
    renderStatus();
  }
}

function tickTimers() {
  document.querySelectorAll('.timer[data-ends]').forEach((el) => {
    const ends = Number(el.dataset.ends);
    el.lastChild.textContent = formatTimeLeft(ends);
    el.classList.toggle('soon', ends - Date.now() < 24 * 3600e3);
  });
}

async function init() {
  [state.settings, state.cache, state.wishlist, state.rates, state.geo] = await Promise.all([
    getSettings(), getCache(), getWishlist(), getLocal('rates', null), getLocal('geo', null),
  ]);
  setLang(resolveLang(state.settings.language));
  applyI18n();
  applyMoney();
  applyTheme(state.settings.theme, state.settings.animations);
  try {
    const savedTab = sessionStorage.getItem('gr-tab');
    if (TABS.includes(savedTab)) state.tab = savedTab;
  } catch { /* ignore */ }
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  TABS.forEach((t) => { $(`#panel-${t}`).hidden = t !== state.tab; });
  moveIndicator();

  recompute();
  // «новые» раздачи — которые ещё не видели в popup; после показа помечаем просмотренными
  const viewed = new Set(await getLocal('viewedGiveaways', []));
  state.newIds = new Set(state.data.giveaways.filter((g) => !viewed.has(g.id)).map((g) => g.id));
  render();
  if (state.data.giveaways.length) {
    await setLocal({ viewedGiveaways: [...new Set([...viewed, ...state.data.giveaways.map((g) => g.id)])].slice(-600) });
    ext.runtime.sendMessage({ type: 'updateBadge' }).catch(() => {});
  }

  // события
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#themeBtn').addEventListener('click', cycleTheme);
  $('#refreshBtn').addEventListener('click', () => refresh({ manual: true }));
  $('#settingsBtn').addEventListener('click', () => { ext.runtime.openOptionsPage(); window.close(); });
  $('#permBtn').addEventListener('click', () => openUrl(ext.runtime.getURL('onboarding/onboarding.html')));
  $('#wlSearch').addEventListener('input', onSearchInput);
  $('#addTabBtn').addEventListener('click', addFromTab);
  $('#dealSearch').addEventListener('input', (e) => { state.deal.q = e.target.value; state.deal.limit = DEAL_PAGE; renderDeals(); });
  $('#dealMin').addEventListener('change', (e) => { state.deal.min = Number(e.target.value); state.deal.limit = DEAL_PAGE; state.rendered.delete('deals'); renderDeals(); });
  $('#dealSort').addEventListener('change', (e) => { state.deal.sort = e.target.value; state.rendered.delete('deals'); renderDeals(); });

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let dirty = false;
    if (changes.cache) {
      state.cache = changes.cache.newValue;
      state.rendered.clear();
      dirty = true;
    }
    if (changes.settings) {
      state.settings = changes.settings.newValue;
      if (setLang(resolveLang(state.settings.language)) !== document.documentElement.lang) {
        applyI18n();
        state.rendered.clear();
      }
      applyTheme(state.settings.theme, state.settings.animations);
      applyMoney();
      dirty = true;
    }
    if (changes.rates) { state.rates = changes.rates.newValue; applyMoney(); dirty = true; }
    if (changes.geo) { state.geo = changes.geo.newValue; dirty = true; }
    if (changes.wishlist) { state.wishlist = changes.wishlist.newValue ?? []; dirty = true; }
    if (dirty) { recompute(); render(); }
  });

  setInterval(tickTimers, 30000);

  // разрешения и автообновление устаревших данных
  if (!(await hasHostPermissions())) {
    $('#permBanner').hidden = false;
    return;
  }
  const stale = !state.cache?.updatedAt || Date.now() - state.cache.updatedAt > state.settings.intervalMin * 60e3;
  if (stale || (await getLocal('refreshing', false))) refresh();
}

init();
