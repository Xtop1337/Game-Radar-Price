// Steam Store: витрина скидок, поиск, региональные цены
import { fetchJson, chunk } from '../http.js';
import { steamLang } from '../i18n/index.js';

const STORE = 'https://store.steampowered.com';

export const steamHeader = (appId) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
export const steamUrl = (appId) => `${STORE}/app/${appId}/`;

export async function fetchSteamFeatured(region) {
  const json = await fetchJson(`${STORE}/api/featuredcategories?cc=${region.cc}&l=${steamLang()}`);
  return parseFeatured(json);
}

function itemToGame(it, sourceTag) {
  const discount = it.discount_percent ?? 0;
  const free = discount >= 100 || (it.final_price === 0 && it.original_price > 0);
  return {
    id: `steam:${it.id}`,
    kind: free ? 'giveaway' : 'deal',
    source: 'steam',
    store: 'steam',
    title: it.name,
    image: it.header_image || it.large_capsule_image || steamHeader(it.id),
    url: steamUrl(it.id),
    price: (it.final_price ?? 0) / 100,
    oldPrice: it.original_price != null ? it.original_price / 100 : null,
    currency: it.currency ?? null,
    discount: free ? 100 : discount,
    startsAt: null,
    endsAt: it.discount_expiration ? it.discount_expiration * 1000 : null,
    upcoming: false,
    steamAppId: it.id,
    tag: sourceTag,
  };
}

export function parseFeatured(json) {
  const seen = new Set();
  const out = [];
  const lists = [
    ['specials', json?.specials?.items],
    ['top_sellers', json?.top_sellers?.items],
    ['new_releases', json?.new_releases?.items],
  ];
  for (const [tag, items] of lists) {
    for (const it of items ?? []) {
      if (!it?.id || !it.name || !it.discounted || !(it.discount_percent > 0)) continue;
      if (it.type != null && it.type !== 0) continue; // 0 = приложение (игра)
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(itemToGame(it, tag));
    }
  }
  return out;
}

// --- Поиск (для списка желаемого)
export async function searchSteam(term, region) {
  const q = encodeURIComponent(term);
  const json = await fetchJson(`${STORE}/api/storesearch/?term=${q}&l=${steamLang()}&cc=${region.cc}`);
  return parseSearch(json);
}

export function parseSearch(json) {
  return (json?.items ?? [])
    .filter((it) => it.type === 'app' && it.id)
    .map((it) => {
      const p = it.price;
      const final = p?.final != null ? p.final / 100 : 0;
      const initial = p?.initial != null ? p.initial / 100 : null;
      return {
        key: `steam:${it.id}`,
        store: 'steam',
        title: it.name,
        image: it.tiny_image || steamHeader(it.id),
        url: steamUrl(it.id),
        steamAppId: it.id,
        price: final,
        oldPrice: initial,
        discount: initial && initial > final ? Math.round((1 - final / initial) * 100) : 0,
        currency: p?.currency ?? null,
      };
    });
}

// --- Региональные цены по appid (batch: несколько id разрешены только с filters=price_overview)
export async function fetchSteamPrices(appIds, region) {
  const result = new Map();
  const ids = [...new Set(appIds.filter(Boolean))];
  for (const part of chunk(ids, 40)) {
    const json = await fetchJson(
      `${STORE}/api/appdetails?appids=${part.join(',')}&cc=${region.cc}&filters=price_overview`,
    );
    for (const [id, v] of parseAppDetails(json)) result.set(id, v);
  }
  return result;
}

export function parseAppDetails(json) {
  const out = new Map();
  for (const [id, entry] of Object.entries(json ?? {})) {
    if (!entry?.success) continue;
    const po = entry.data?.price_overview;
    if (!po) {
      // data: [] — игра бесплатная или цена недоступна в регионе
      out.set(Number(id), { price: 0, oldPrice: null, discount: 0, currency: null, freeToPlay: true });
      continue;
    }
    out.set(Number(id), {
      price: po.final / 100,
      oldPrice: po.initial / 100,
      discount: po.discount_percent ?? 0,
      currency: po.currency,
      freeToPlay: false,
    });
  }
  return out;
}

// Разбор URL открытой вкладки Steam
export function parseSteamTab(url, title = '') {
  const m = /store\.steampowered\.com\/app\/(\d+)(?:\/([^/?#]+))?/i.exec(url ?? '');
  if (!m) return null;
  const appId = Number(m[1]);
  let name = String(title)
    .replace(/^(?:Save \d+% on|Скидка \d+% на)\s+/i, '')
    .replace(/\s+(?:on|в|на) Steam\s*$/i, '')
    .trim();
  if (!name && m[2]) name = decodeURIComponent(m[2]).replace(/_/g, ' ');
  return { appId, title: name || `Steam #${appId}` };
}

// Одна игра: локализованное название + цена (несколько фильтров разрешены только для одного appid)
export async function fetchSteamApp(appId, region) {
  const json = await fetchJson(
    `${STORE}/api/appdetails?appids=${appId}&cc=${region.cc}&l=${steamLang()}&filters=basic,price_overview`,
  );
  return parseSteamApp(json, appId);
}

export function parseSteamApp(json, appId) {
  const entry = json?.[appId] ?? json?.[String(appId)];
  if (!entry?.success || !entry.data?.name) return null;
  const po = entry.data.price_overview;
  return {
    title: entry.data.name,
    image: entry.data.header_image || steamHeader(appId),
    price: po ? po.final / 100 : entry.data.is_free ? 0 : null,
    oldPrice: po ? po.initial / 100 : null,
    discount: po?.discount_percent ?? 0,
    currency: po?.currency ?? null,
  };
}
