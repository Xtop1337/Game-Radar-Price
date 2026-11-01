// CheapShark: агрегатор скидок (цены в USD). Магазины: 1 = Steam, 7 = GOG, 25 = Epic
import { fetchJson } from '../http.js';
import { steamHeader, steamUrl, fetchSteamPrices } from './steam.js';

const API = 'https://www.cheapshark.com/api/1.0';
export const CS_STORES = { 1: 'steam', 7: 'gog', 25: 'epic' };
const STORE_IDS = { steam: 1, gog: 7, epic: 25 };

export const dealUrl = (dealID) =>
  `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(dealID)}`;

export async function fetchCheapSharkDeals(region, { pageSize = 60 } = {}) {
  const all = [];
  const errors = [];
  for (const store of Object.keys(STORE_IDS)) {
    try {
      const url = `${API}/deals?storeID=${STORE_IDS[store]}&onSale=1&sortBy=Deal%20Rating&pageSize=${pageSize}`;
      all.push(...parseDeals(await fetchJson(url)));
    } catch (e) {
      errors.push(`${store}: ${e.message}`);
    }
  }
  if (!all.length && errors.length) throw new Error(errors.join('; '));
  return regionalizeSteam(all, region);
}

export function parseDeals(json) {
  if (!Array.isArray(json)) return [];
  const out = [];
  for (const d of json) {
    const store = CS_STORES[d.storeID];
    if (!store || !d.title || !d.dealID) continue;
    const price = parseFloat(d.salePrice);
    const oldPrice = parseFloat(d.normalPrice);
    const discount = Math.round(parseFloat(d.savings) || 0);
    if (!(discount > 0)) continue;
    const steamAppId = d.steamAppID ? Number(d.steamAppID) : null;
    const free = price === 0 && oldPrice > 0;
    out.push({
      id: `cs:${d.dealID}`,
      kind: free ? 'giveaway' : 'deal',
      source: 'cheapshark',
      store,
      title: d.title,
      image: store === 'steam' && steamAppId ? steamHeader(steamAppId) : d.thumb || null,
      url: store === 'steam' && steamAppId ? steamUrl(steamAppId) : dealUrl(d.dealID),
      price,
      oldPrice: Number.isFinite(oldPrice) ? oldPrice : null,
      currency: 'USD',
      discount: free ? 100 : discount,
      startsAt: null,
      endsAt: null,
      upcoming: false,
      steamAppId,
      rating: d.steamRatingPercent && d.steamRatingPercent !== '0' ? Number(d.steamRatingPercent) : null,
      metacritic: d.metacriticScore && d.metacriticScore !== '0' ? Number(d.metacriticScore) : null,
      changedAt: d.lastChange ? d.lastChange * 1000 : null,
      gameID: d.gameID,
    });
  }
  return out;
}

// Steam-скидки из CheapShark переводим в цены выбранного региона
export async function regionalizeSteam(deals, region, priceFetcher = fetchSteamPrices) {
  const steamIds = deals.filter((d) => d.store === 'steam' && d.steamAppId).map((d) => d.steamAppId);
  if (!steamIds.length) return deals;
  let prices;
  try {
    prices = await priceFetcher(steamIds, region);
  } catch {
    return deals; // оставляем USD
  }
  return applyRegionalPrices(deals, prices);
}

export function applyRegionalPrices(deals, prices) {
  const out = [];
  for (const d of deals) {
    if (d.store !== 'steam' || !d.steamAppId || !prices.has(d.steamAppId)) {
      out.push(d);
      continue;
    }
    const p = prices.get(d.steamAppId);
    if (p.freeToPlay || !(p.discount > 0)) continue; // в этом регионе скидки нет
    out.push({ ...d, price: p.price, oldPrice: p.oldPrice, discount: p.discount, currency: p.currency, regional: true });
  }
  return out;
}

// --- Поиск и цены для списка желаемого
export async function searchCheapShark(term) {
  const json = await fetchJson(`${API}/games?title=${encodeURIComponent(term)}&limit=12`);
  return parseGameSearch(json);
}

export function parseGameSearch(json) {
  if (!Array.isArray(json)) return [];
  return json.map((g) => ({
    key: `cs:${g.gameID}`,
    store: null,
    title: g.external,
    image: g.thumb || null,
    url: g.cheapestDealID ? dealUrl(g.cheapestDealID) : null,
    cheapsharkId: g.gameID,
    steamAppId: g.steamAppID ? Number(g.steamAppID) : null,
    price: parseFloat(g.cheapest),
    oldPrice: null,
    discount: 0,
    currency: 'USD',
  }));
}

export async function fetchCheapSharkPrices(gameIds) {
  const ids = [...new Set(gameIds.filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 25) {
    const part = ids.slice(i, i + 25);
    const json = await fetchJson(`${API}/games?ids=${part.join(',')}`);
    for (const [id, v] of parseGamesByIds(json)) out.set(id, v);
  }
  return out;
}

// Лучшее предложение среди Steam/GOG/Epic по каждой игре
export function parseGamesByIds(json) {
  const out = new Map();
  for (const [id, g] of Object.entries(json ?? {})) {
    const deals = (g?.deals ?? []).filter((d) => CS_STORES[d.storeID]);
    if (!deals.length) continue;
    const best = deals.reduce((a, b) => (parseFloat(b.price) < parseFloat(a.price) ? b : a));
    out.set(String(id), {
      price: parseFloat(best.price),
      oldPrice: parseFloat(best.retailPrice),
      discount: Math.round(parseFloat(best.savings) || 0),
      currency: 'USD',
      store: CS_STORES[best.storeID],
      url: dealUrl(best.dealID),
      lowest: g.cheapestPriceEver?.price != null ? parseFloat(g.cheapestPriceEver.price) : null,
    });
  }
  return out;
}
