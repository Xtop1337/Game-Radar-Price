// Полное обновление: страна → источники → кэш; курсы валют; список желаемого → цены
import { getRegion } from './regions.js';
import { resolveCountry } from './geo.js';
import { fetchRates } from './currency.js';
import { getSettings, getCache, getLocal, getWishlist, setLocal, updateWishlist } from './storage.js';
import { compose } from './compose.js';
import { fetchEpic } from './sources/epic.js';
import { fetchGamerPower } from './sources/gamerpower.js';
import { fetchSteamFeatured } from './sources/steam.js';
import { fetchCheapSharkDeals } from './sources/cheapshark.js';
import { fetchWishlistPrices, evaluateWishlist } from './wishlist.js';

const RATES_TTL = 12 * 3600e3;

// Курсы обновляем раз в 12 часов; при ошибке остаются прежние
export async function refreshRates({ force = false } = {}) {
  const cached = await getLocal('rates', null);
  if (!force && cached?.at && Date.now() - cached.at < RATES_TTL) return cached;
  try {
    const rates = await fetchRates();
    await setLocal({ rates });
    return rates;
  } catch {
    return cached;
  }
}

export async function refreshSources(settings) {
  const country = await resolveCountry(settings.country);
  const region = getRegion(country.code);
  const prev = (await getCache()) ?? { sources: {} };
  const regionChanged = prev.region && prev.region !== region.code;
  const tasks = {
    epic: () => fetchEpic(region),
    gamerpower: () => (settings.useGamerPower ? fetchGamerPower() : []),
    steam: () => fetchSteamFeatured(region),
    cheapshark: () => fetchCheapSharkDeals(region),
  };
  const entries = await Promise.all(
    Object.entries(tasks).map(async ([name, run]) => {
      try {
        return [name, { items: await run(), ok: true, at: Date.now() }];
      } catch (e) {
        // при ошибке оставляем прошлые данные источника (если страна та же)
        const old = regionChanged ? [] : prev.sources?.[name]?.items ?? [];
        return [name, { items: old, ok: false, error: e?.message ?? String(e), at: prev.sources?.[name]?.at ?? null }];
      }
    }),
  );
  const cache = { sources: Object.fromEntries(entries), updatedAt: Date.now(), region: region.code };
  await setLocal({ cache });
  return cache;
}

export async function refreshWishlist(settings, cache, rates) {
  const region = getRegion(cache?.region ?? (await resolveCountry(settings.country)).code);
  rates ??= await getLocal('rates', null);
  const { giveaways } = compose(cache?.sources, { ...settings, stores: { steam: true, epic: true, gog: true, other: true } });
  const snapshot = await getWishlist();
  if (!snapshot.length) return [];
  // сеть — до чтения/записи, чтобы не затереть правки, сделанные в popup во время запроса
  const { prices } = await fetchWishlistPrices(snapshot, region);
  let alerts = [];
  await updateWishlist((list) => {
    const res = evaluateWishlist(list, prices, giveaways, Date.now(), rates);
    alerts = res.alerts;
    return res.items;
  });
  return alerts;
}

export async function refreshAll() {
  const settings = await getSettings();
  const [cache, rates] = await Promise.all([refreshSources(settings), refreshRates()]);
  const wishlistAlerts = await refreshWishlist(settings, cache, rates);
  return { settings, cache, rates, wishlistAlerts };
}
