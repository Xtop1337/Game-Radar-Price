import { ext, HOST_ORIGINS, hasHostPermissions } from '../lib/api.js';
import { getSettings } from '../lib/storage.js';
import { setLang, resolveLang, applyI18n } from '../lib/i18n/index.js';

const done = () => {
  document.getElementById('action').hidden = true;
  document.getElementById('done').hidden = false;
};

getSettings().then((settings) => {
  setLang(resolveLang(settings.language));
  applyI18n();
});

document.getElementById('grantBtn').addEventListener('click', async () => {
  const ok = await ext.permissions.request({ origins: HOST_ORIGINS });
  if (ok) {
    done();
    ext.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
  }
});

hasHostPermissions().then((ok) => { if (ok) done(); });
