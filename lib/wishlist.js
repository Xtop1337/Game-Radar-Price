// Список желаемого: получение цен и правила уведомлений
import { normTitle } from './format.js';
import { fetchSteamPrices, steamUrl } from './sources/steam.js';
import { fetchCheapSharkPrices } from './sources/cheapshark.js';
import { convert } from './currency.js';

export function makeWishlistItem(src) {
  return {
    key: src.key ?? (src.steamAppId ? `steam:${src.steamAppId}` : `title:${normTitle(src.title)}`),
    title: src.title,
    image: src.image ?? null,
    url: src.url ?? (src.steamAppId ? steamUrl(src.steamAppId) : null),
    store: src.store ?? (src.steamAppId ? 'steam' : null),
    steamAppId: src.steamAppId ?? null,
    cheapsharkId: src.cheapsharkId ?? null,
    targetPrice: null,
    targetCurrency: null,
    price: src.price ?? null,
    oldPrice: src.oldPrice ?? null,
    discount: src.discount ?? 0,
    currency: src.currency ?? null,
    addedAt: Date.now(),
    checkedAt: null,
    notifiedPrice: null,
    notifiedDiscount: src.discount ?? 0,
    notifiedFreeId: null,
  };
}

export async function fetchWishlistPrices(items, region) {
  const prices = new Map();
  const steamItems = items.filter((i) => i.steamAppId);
  const csItems = items.filter((i) => !i.steamAppId && i.cheapsharkId);
  const errors = [];
  if (steamItems.length) {
    try {
      const map = await fetchSteamPrices(steamItems.map((i) => i.steamAppId), region);
      for (const i of steamItems) {
        const p = map.get(Number(i.steamAppId));
        if (p) prices.set(i.key, { ...p, store: 'steam', url: steamUrl(i.steamAppId) });
      }
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (csItems.length) {
    try {
      const map = await fetchCheapSharkPrices(csItems.map((i) => i.cheapsharkId));
      for (const i of csItems) {
        const p = map.get(String(i.cheapsharkId));
        if (p) prices.set(i.key, p);
      }
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { prices, errors };
}

// Возвращает обновлённые позиции и список событий для уведомлений
// rates — курсы валют: цель может быть задана в другой валюте, чем цена магазина
export function evaluateWishlist(items, prices, giveaways, now = Date.now(), rates = null) {
  const freeByTitle = new Map(giveaways.map((g) => [normTitle(g.title), g]));
  const freeBySteam = new Map(giveaways.filter((g) => g.steamAppId).map((g) => [g.steamAppId, g]));
  const alerts = [];
  const next = items.map((orig) => {
    const item = { ...orig };
    const p = prices.get(item.key);
    if (p) {
      Object.assign(item, {
        price: p.price,
        oldPrice: p.oldPrice,
        discount: p.discount,
        currency: p.currency ?? item.currency,
        checkedAt: now,
      });
      if (p.store) item.dealStore = p.store;
      if (p.url && !item.url) item.url = p.url;
      if (p.lowest != null) item.lowest = p.lowest;
    }

    // 1) Игра из желаемого раздаётся бесплатно
    const free = (item.steamAppId && freeBySteam.get(item.steamAppId)) || freeByTitle.get(normTitle(item.title));
    item.freeNow = free ? { id: free.id, url: free.url, store: free.store, endsAt: free.endsAt } : null;
    if (free && item.notifiedFreeId !== free.id) {
      alerts.push({ type: 'free', item, giveaway: free });
      item.notifiedFreeId = free.id;
    }

    // 2) Достигнута целевая цена
    const hasTarget = item.targetPrice != null && item.price != null;
    item.targetReached = hasTarget && isTargetReached(item, rates);
    if (p && item.targetReached) {
      if (item.notifiedPrice !== item.price) {
        alerts.push({ type: 'target', item });
        item.notifiedPrice = item.price;
      }
    } else if (p && hasTarget) {
      item.notifiedPrice = null;
    }

    // 3) Без цели: появилась скидка или она выросла
    if (p && item.targetPrice == null) {
      const prev = item.notifiedDiscount ?? 0;
      if (item.discount > 0 && item.discount > prev) alerts.push({ type: 'discount', item });
      item.notifiedDiscount = item.discount;
    }
    return item;
  });
  return { items: next, alerts };
}

// Цена ≤ цели с учётом валюты цели (если курса нет — сравниваем только в одной валюте)
export function isTargetReached(item, rates) {
  if (item.targetPrice == null || item.price == null) return false;
  const targetCurrency = item.targetCurrency ?? item.currency;
  const price = convert(item.price, item.currency ?? targetCurrency, targetCurrency, rates);
  return price != null && price <= item.targetPrice + 1e-9;
}
