// Сборка итоговых списков из кэша источников (чистая функция — используется в фоне и в popup)
import { normTitle, storeGroup } from './format.js';

const SOURCE_PRIORITY = { epic: 0, steam: 1, cheapshark: 2, gamerpower: 3 };

export function compose(sources, settings, now = Date.now()) {
  const all = Object.values(sources ?? {}).flatMap((s) => s?.items ?? []);
  const storeOn = (item) => settings.stores?.[storeGroup(item.store)] !== false;

  // --- Раздачи: дедуп по магазину + названию, приоритет — официальные источники
  const byKey = new Map();
  const sorted = all
    .filter((i) => i.kind === 'giveaway')
    .sort((a, b) => (SOURCE_PRIORITY[a.source] ?? 9) - (SOURCE_PRIORITY[b.source] ?? 9));
  for (const g of sorted) {
    if (!settings.useGamerPower && g.source === 'gamerpower') continue;
    const key = `${g.store}|${g.steamAppId ?? normTitle(g.title)}`;
    if (!byKey.has(key)) byKey.set(key, g);
  }
  const giveaways = [];
  const upcoming = [];
  for (const g of byKey.values()) {
    if (!storeOn(g)) continue;
    if (g.endsAt && g.endsAt <= now) continue;
    const started = !g.startsAt || g.startsAt <= now;
    if (g.upcoming && !started) upcoming.push(g);
    else giveaways.push({ ...g, upcoming: false });
  }
  giveaways.sort((a, b) => {
    if (a.source === 'epic' && b.source !== 'epic') return -1;
    if (b.source === 'epic' && a.source !== 'epic') return 1;
    return (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity);
  });
  upcoming.sort((a, b) => a.startsAt - b.startsAt);

  // --- Скидки: Steam дедуп по appid (витрина Steam приоритетнее), остальные по магазину+названию
  const dealMap = new Map();
  const dealList = all
    .filter((i) => i.kind === 'deal')
    .sort((a, b) => (SOURCE_PRIORITY[a.source] ?? 9) - (SOURCE_PRIORITY[b.source] ?? 9));
  for (const d of dealList) {
    if (!storeOn(d)) continue;
    if (d.endsAt && d.endsAt <= now) continue;
    if ((d.discount ?? 0) < (settings.minDiscount ?? 0)) continue;
    const key = d.store === 'steam' && d.steamAppId ? `steam|${d.steamAppId}` : `${d.store}|${normTitle(d.title)}`;
    if (!dealMap.has(key)) dealMap.set(key, d);
  }
  const deals = [...dealMap.values()].sort((a, b) => b.discount - a.discount);

  return { giveaways, upcoming, deals };
}

export function sourceErrors(sources) {
  const names = { epic: 'Epic', gamerpower: 'GamerPower', steam: 'Steam', cheapshark: 'CheapShark' };
  return Object.entries(sources ?? {})
    .filter(([, s]) => s && s.ok === false)
    .map(([k, s]) => `${names[k] ?? k}: ${s.error}`);
}
