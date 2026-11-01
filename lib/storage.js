import { ext } from './api.js';

export const DEFAULT_SETTINGS = {
  language: 'auto', // auto = язык браузера
  country: 'auto', // auto = по IP
  currency: 'auto', // auto = по языку интерфейса
  intervalMin: 60,
  theme: 'auto', // auto | light | dark
  animations: true,
  stores: { steam: true, epic: true, gog: true, other: true },
  useGamerPower: true,
  minDiscount: 20,
  notifyGiveaways: true,
  notifyWishlist: true,
  notifyDeals: false,
  notifyDealsMin: 85,
};

export async function getLocal(key, fallback) {
  const data = await ext.storage.local.get(key);
  return data[key] ?? fallback;
}

export function setLocal(obj) {
  return ext.storage.local.set(obj);
}

export function mergeSettings(saved) {
  // region (v1.0) был захардкоженным дефолтом «RU» — заменён на country: 'auto'
  const { region, ...rest } = saved ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    stores: { ...DEFAULT_SETTINGS.stores, ...(saved?.stores ?? {}) },
  };
}

export async function getSettings() {
  return mergeSettings(await getLocal('settings', null));
}

export async function saveSettings(patch) {
  const next = mergeSettings({ ...(await getSettings()), ...patch });
  await setLocal({ settings: next });
  return next;
}

export const getCache = () => getLocal('cache', null);
export const getWishlist = () => getLocal('wishlist', []);

// Атомарное по смыслу изменение списка желаемого: читаем → меняем → пишем
export async function updateWishlist(fn) {
  const list = await getWishlist();
  const next = (await fn(list)) ?? list;
  await setLocal({ wishlist: next });
  return next;
}
