// GamerPower: агрегатор раздач (Steam, GOG, Epic, Ubisoft, itch.io, Prime и др.)
import { fetchJson } from '../http.js';

const API = 'https://www.gamerpower.com/api/giveaways?platform=pc&type=game&sort-by=date';

export async function fetchGamerPower() {
  const json = await fetchJson(API);
  return parseGamerPower(json);
}

export function storeFromPlatforms(platforms = '') {
  const s = platforms.toLowerCase();
  if (s.includes('epic')) return 'epic';
  if (s.includes('steam')) return 'steam';
  if (s.includes('gog')) return 'gog';
  if (s.includes('ubisoft')) return 'ubisoft';
  if (s.includes('itch')) return 'itch';
  if (s.includes('prime') || s.includes('amazon')) return 'prime';
  if (s.includes('battle')) return 'battlenet';
  if (s.includes('origin') || s.includes('ea ')) return 'ea';
  return 'other';
}

export function cleanTitle(title = '') {
  return title
    .replace(/\s*\((?:epic games(?: store)?|steam|gog(?:\.com)?|ubisoft(?: connect)?|itch\.io|indiegala|prime gaming|amazon prime|pc|origin|ea app|battle\.net|drm-free)\)\s*/gi, ' ')
    .replace(/\s+giveaway\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(s) {
  if (!s || s === 'N/A') return null;
  const t = Date.parse(String(s).replace(' ', 'T') + 'Z');
  return Number.isNaN(t) ? null : t;
}

function parseWorth(w) {
  const m = /([\d.]+)/.exec(String(w ?? ''));
  const v = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function parseGamerPower(json, { now = Date.now() } = {}) {
  // При отсутствии раздач API отдаёт объект {status: 0, ...}
  if (!Array.isArray(json)) return [];
  const out = [];
  for (const g of json) {
    if (!g?.title || (g.status && g.status !== 'Active')) continue;
    if (g.type && !/^game$/i.test(g.type)) continue;
    const endsAt = parseDate(g.end_date);
    if (endsAt && endsAt <= now) continue;
    out.push({
      id: `gp:${g.id}`,
      kind: 'giveaway',
      source: 'gamerpower',
      store: storeFromPlatforms(g.platforms),
      title: cleanTitle(g.title),
      image: g.image || g.thumbnail || null,
      url: g.open_giveaway_url || g.gamerpower_url,
      price: 0,
      oldPrice: parseWorth(g.worth),
      currency: 'USD',
      discount: 100,
      startsAt: parseDate(g.published_date),
      endsAt,
      upcoming: false,
      type: g.type ?? null,
      description: g.description ?? '',
    });
  }
  return out;
}
