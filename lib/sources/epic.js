// Epic Games Store: еженедельные бесплатные игры (текущие и будущие)
import { fetchJson } from '../http.js';
import { epicLocale } from '../i18n/index.js';

const API = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions';
const IMAGE_PRIORITY = [
  'OfferImageWide',
  'DieselStoreFrontWide',
  'featuredMedia',
  'Thumbnail',
  'VaultClosed',
  'OfferImageTall',
];

export async function fetchEpic(region) {
  const cc = region.cc.toUpperCase();
  const locale = epicLocale();
  const json = await fetchJson(`${API}?locale=${locale}&country=${cc}&allowCountries=${cc}`);
  return parseEpic(json, { locale });
}

function pickImage(keyImages = []) {
  for (const type of IMAGE_PRIORITY) {
    const img = keyImages.find((k) => k.type === type && k.url);
    if (img) return img.url;
  }
  return keyImages.find((k) => k.url)?.url ?? null;
}

function pickSlug(el) {
  const home = (list) => list?.find((m) => m.pageType === 'productHome')?.pageSlug;
  const candidates = [
    el.productSlug,
    home(el.offerMappings),
    home(el.catalogNs?.mappings),
    el.urlSlug,
  ];
  for (let slug of candidates) {
    if (!slug || slug === '[]') continue;
    slug = String(slug).replace(/\/home$/, '');
    if (/^[0-9a-f]{32}$/i.test(slug)) continue; // внутренние id — не slug
    return slug;
  }
  return null;
}

// Ищет 100%-скидку (discountPercentage === 0 → итоговая цена 0% от исходной)
function findFreeOffer(groups, now, upcoming) {
  for (const group of groups ?? []) {
    for (const offer of group?.promotionalOffers ?? []) {
      const start = Date.parse(offer.startDate);
      const end = Date.parse(offer.endDate);
      const pct = offer.discountSetting?.discountPercentage;
      if (pct !== 0) continue;
      if (upcoming ? start > now : start <= now && (Number.isNaN(end) || end > now)) {
        return { start, end: Number.isNaN(end) ? null : end };
      }
    }
  }
  return null;
}

export function parseEpic(json, { now = Date.now(), locale = epicLocale() } = {}) {
  const elements = json?.data?.Catalog?.searchStore?.elements ?? [];
  const out = [];
  for (const el of elements) {
    if (!el?.title) continue;
    const current = findFreeOffer(el.promotions?.promotionalOffers, now, false);
    const upcoming = current ? null : findFreeOffer(el.promotions?.upcomingPromotionalOffers, now, true);
    const promo = current ?? upcoming;
    if (!promo) continue;

    const total = el.price?.totalPrice ?? {};
    const decimals = total.currencyInfo?.decimals ?? 2;
    const original = typeof total.originalPrice === 'number' ? total.originalPrice / 10 ** decimals : null;
    const slug = pickSlug(el);
    const isBundle = el.offerType === 'BUNDLE';
    const isMystery = !slug || /mystery/i.test(el.title);
    const url = isMystery
      ? `https://store.epicgames.com/${locale}/free-games`
      : `https://store.epicgames.com/${locale}/${isBundle ? 'bundles' : 'p'}/${slug}`;

    out.push({
      id: `epic:${el.id ?? slug ?? el.title}:${promo.start}`,
      kind: 'giveaway',
      source: 'epic',
      store: 'epic',
      title: el.title,
      image: pickImage(el.keyImages),
      url,
      price: 0,
      oldPrice: original && original > 0 ? original : null,
      currency: total.currencyCode ?? null,
      discount: 100,
      startsAt: promo.start,
      endsAt: promo.end,
      upcoming: Boolean(upcoming),
      type: el.offerType ?? null,
      description: el.description ?? '',
    });
  }
  return out;
}
