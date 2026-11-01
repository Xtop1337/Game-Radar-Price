// Чистые функции: что показывать в уведомлениях (на текущем языке интерфейса)
import { formatDate, formatPrice, storeLabel } from './format.js';
import { t } from './i18n/index.js';
import { moneyText } from './currency.js';

const MAX_SINGLE = 3;

export function newItems(items, seenIds) {
  const seen = new Set(seenIds ?? []);
  return items.filter((i) => !seen.has(i.id));
}

// Обновлённый список «уже уведомляли»: текущие id + хвост старых (ограничение размера)
export function rememberIds(seenIds, items, limit = 600) {
  const set = new Set([...(seenIds ?? []), ...items.map((i) => i.id)]);
  return [...set].slice(-limit);
}

export function giveawayNotifications(fresh) {
  if (!fresh.length) return [];
  if (fresh.length > MAX_SINGLE) {
    const names = fresh.slice(0, 4).map((g) => g.title).join(', ');
    return [{
      title: t('n.gwMany', { n: fresh.length }),
      message: `${names}${fresh.length > 4 ? t('n.andMore') : ''}`,
      url: fresh[0].url,
    }];
  }
  return fresh.map((g) => ({
    title: t('n.gwOne', { store: storeLabel(g.store), title: g.title }),
    message: [
      g.oldPrice ? t('n.oldPrice', { price: moneyText(g.oldPrice, g.currency) }) : '',
      g.endsAt ? t('n.claimUntil', { date: formatDate(g.endsAt) }) : t('n.claim'),
    ].filter(Boolean).join(' '),
    url: g.url,
    image: g.image,
  }));
}

export function wishlistNotifications(alerts) {
  return alerts.map(({ type, item, giveaway }) => {
    if (type === 'free') {
      const store = storeLabel(giveaway.store);
      return {
        title: t('n.wlFree', { title: item.title }),
        message: giveaway.endsAt
          ? t('n.wlFreeMsgUntil', { store, date: formatDate(giveaway.endsAt) })
          : t('n.wlFreeMsg', { store }),
        url: giveaway.url,
      };
    }
    if (type === 'target') {
      return {
        title: t('n.target', { title: item.title }),
        message: t('n.targetMsg', {
          price: moneyText(item.price, item.currency),
          target: formatPrice(item.targetPrice, item.targetCurrency ?? item.currency),
        }) + (item.discount ? t('n.discountSuffix', { n: item.discount }) : '') + '.',
        url: item.url,
      };
    }
    return {
      title: t('n.discount', { n: item.discount, title: item.title }),
      message: t('n.discountMsg', { price: moneyText(item.price, item.currency) })
        + (item.oldPrice ? t('n.insteadOf', { price: moneyText(item.oldPrice, item.currency) }) : '') + '.',
      url: item.url,
    };
  });
}

export function dealNotifications(fresh) {
  if (!fresh.length) return [];
  if (fresh.length > MAX_SINGLE) {
    return [{
      title: t('n.dealsMany', { n: fresh.length }),
      message: fresh.slice(0, 4).map((d) => `${d.title} −${d.discount}%`).join(', '),
      url: fresh[0].url,
    }];
  }
  return fresh.map((d) => ({
    title: t('n.dealOne', { n: d.discount, store: storeLabel(d.store), title: d.title }),
    message: t('n.dealMsg', { price: moneyText(d.price, d.currency), old: moneyText(d.oldPrice, d.currency) }),
    url: d.url,
  }));
}
