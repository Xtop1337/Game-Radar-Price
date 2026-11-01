import { ext, hasHostPermissions } from './lib/api.js';
import { getSettings, getLocal, setLocal, getCache } from './lib/storage.js';
import { refreshAll, refreshWishlist } from './lib/refresh.js';
import { compose } from './lib/compose.js';
import { setLang, resolveLang } from './lib/i18n/index.js';
import { setMoneyContext, resolveCurrency } from './lib/currency.js';
import {
  newItems, rememberIds, giveawayNotifications, wishlistNotifications, dealNotifications,
} from './lib/alerts.js';

const ALARM = 'game-radar-refresh';
const ICON = ext.runtime.getURL('icons/icon-128.png');

// ---------- Расписание
async function ensureAlarm({ reset = false } = {}) {
  const { intervalMin } = await getSettings();
  const existing = await ext.alarms.get(ALARM);
  if (!existing || reset || existing.periodInMinutes !== intervalMin) {
    await ext.alarms.create(ALARM, { delayInMinutes: reset ? intervalMin : 1, periodInMinutes: intervalMin });
  }
}

// ---------- Уведомления
async function notify(list) {
  if (!list.length) return;
  const links = await getLocal('notifLinks', {});
  for (const n of list) {
    const id = `gr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    links[id] = n.url;
    try {
      await ext.notifications.create(id, {
        type: 'basic',
        iconUrl: ICON,
        title: n.title.slice(0, 120),
        message: n.message || ' ',
      });
    } catch (e) {
      console.warn('notification failed', e);
    }
  }
  const trimmed = Object.fromEntries(Object.entries(links).slice(-50));
  await setLocal({ notifLinks: trimmed });
}

ext.notifications.onClicked.addListener(async (id) => {
  const links = await getLocal('notifLinks', {});
  if (links[id]) await ext.tabs.create({ url: links[id] });
  ext.notifications.clear(id);
});

// ---------- Бейдж: число непросмотренных раздач
export async function updateBadge(cache, settings) {
  cache ??= await getCache();
  settings ??= await getSettings();
  const { giveaways } = compose(cache?.sources, settings);
  const viewed = new Set(await getLocal('viewedGiveaways', []));
  const count = giveaways.filter((g) => !viewed.has(g.id)).length;
  await ext.action.setBadgeBackgroundColor({ color: '#7c5cff' });
  if (ext.action.setBadgeTextColor) await ext.action.setBadgeTextColor({ color: '#ffffff' });
  await ext.action.setBadgeText({ text: count ? String(count) : '' });
}

// ---------- Основной цикл
let running = null;

function run() {
  running ??= doRun().finally(() => { running = null; });
  return running;
}

// Язык уведомлений и данных магазинов — как в настройках (auto = язык браузера)
// Валюта уведомлений: выбранная или по языку, пересчёт по сохранённым курсам
async function applyLanguage(settings) {
  setLang(resolveLang(settings.language));
  setMoneyContext({ currency: resolveCurrency(settings.currency), rates: await getLocal('rates', null) });
}

async function doRun() {
  await applyLanguage(await getSettings());
  if (!(await hasHostPermissions())) {
    await ext.action.setBadgeBackgroundColor({ color: '#ef4444' });
    await ext.action.setBadgeText({ text: '!' });
    return { ok: false, error: 'no-permissions' };
  }
  await setLocal({ refreshing: true });
  try {
    const { settings, cache, wishlistAlerts } = await refreshAll();
    await applyLanguage(settings); // курсы могли обновиться
    const { giveaways, deals } = compose(cache.sources, settings);
    const out = [];

    // Новые раздачи
    const seenGiveaways = await getLocal('seenGiveaways', []);
    if (settings.notifyGiveaways) out.push(...giveawayNotifications(newItems(giveaways, seenGiveaways)));
    await setLocal({ seenGiveaways: rememberIds(seenGiveaways, giveaways) });

    // Список желаемого
    if (settings.notifyWishlist) out.push(...wishlistNotifications(wishlistAlerts));

    // Горячие скидки (первый запуск — молча запоминаем, чтобы не заспамить)
    const hot = deals.filter((d) => d.discount >= settings.notifyDealsMin);
    const seenDeals = await getLocal('seenDeals', null);
    if (settings.notifyDeals && seenDeals) out.push(...dealNotifications(newItems(hot, seenDeals)));
    await setLocal({ seenDeals: rememberIds(seenDeals ?? [], hot) });

    await notify(out);
    await updateBadge(cache, settings);
    return { ok: true };
  } catch (e) {
    console.error('refresh failed', e);
    return { ok: false, error: e?.message ?? String(e) };
  } finally {
    await setLocal({ refreshing: false });
  }
}

// ---------- События
ext.runtime.onInstalled.addListener(async ({ reason }) => {
  await ensureAlarm({ reset: true });
  if (reason === 'install' || !(await hasHostPermissions())) {
    await ext.tabs.create({ url: ext.runtime.getURL('onboarding/onboarding.html') });
  }
  run();
});

ext.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  run();
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) run();
});

ext.permissions.onAdded?.addListener(() => run());

ext.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const before = changes.settings.oldValue ?? {};
  const after = changes.settings.newValue ?? {};
  if (before.intervalMin !== after.intervalMin) ensureAlarm({ reset: true });
  if (before.country !== after.country || before.useGamerPower !== after.useGamerPower || before.language !== after.language) run();
  else updateBadge();
});

// Chrome не принимает Promise из слушателя — отвечаем через sendResponse и возвращаем true
function handleMessage(msg) {
  switch (msg?.type) {
    case 'refresh':
      return run();
    case 'refreshWishlist':
      return (async () => {
        const settings = await getSettings();
        await applyLanguage(settings);
        const alerts = await refreshWishlist(settings, await getCache());
        if (settings.notifyWishlist) await notify(wishlistNotifications(alerts));
        return { ok: true };
      })();
    case 'updateBadge':
      return updateBadge().then(() => ({ ok: true }));
    default:
      return null;
  }
}

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const task = handleMessage(msg);
  if (!task) return false;
  task.then(sendResponse, (e) => sendResponse({ ok: false, error: e?.message ?? String(e) }));
  return true;
});
