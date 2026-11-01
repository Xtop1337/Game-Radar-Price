// Регион магазина = страна пользователя (любой ISO-код): cc для Steam/Epic и локализованное название
import { countryName } from './geo.js';

export function getRegion(code) {
  const cc = /^[A-Z]{2}$/.test(code ?? '') ? code : 'US';
  return { code: cc, cc: cc.toLowerCase(), label: countryName(cc) };
}
