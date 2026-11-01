// Единая точка доступа к WebExtension API (Firefox: browser.*, на всякий случай fallback на chrome.*)
export const ext = globalThis.browser ?? globalThis.chrome;

export const HOST_ORIGINS = [
  'https://store-site-backend-static.ak.epicgames.com/*',
  'https://store.steampowered.com/*',
  'https://www.gamerpower.com/*',
  'https://www.cheapshark.com/*',
  'https://cdn.jsdelivr.net/*',
  'https://open.er-api.com/*',
  'https://www.cloudflare.com/*',
  'https://api.country.is/*',
];

export async function hasHostPermissions() {
  try {
    return await ext.permissions.contains({ origins: HOST_ORIGINS });
  } catch {
    return true;
  }
}
