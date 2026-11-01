// Применяем сохранённую тему как можно раньше, чтобы не было «вспышки» не той темы
(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  try {
    const cached = localStorage.getItem('gr-theme');
    if (cached && cached !== 'auto') document.documentElement.dataset.theme = cached;
    const motion = localStorage.getItem('gr-motion');
    if (motion === 'off') document.documentElement.dataset.motion = 'off';
  } catch (e) { /* localStorage недоступен — не страшно */ }
  api?.storage?.local.get('settings').then(({ settings }) => {
    const root = document.documentElement;
    const theme = settings?.theme ?? 'auto';
    if (theme === 'auto') delete root.dataset.theme; else root.dataset.theme = theme;
    if (settings?.animations === false) root.dataset.motion = 'off'; else delete root.dataset.motion;
    try {
      localStorage.setItem('gr-theme', theme);
      localStorage.setItem('gr-motion', settings?.animations === false ? 'off' : 'on');
    } catch (e) { /* ignore */ }
  }).catch(() => {});
})();
