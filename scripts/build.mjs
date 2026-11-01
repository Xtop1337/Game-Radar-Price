// Сборка расширения для Firefox/Zen и Chromium (Chrome, Opera GX, Edge, Яндекс): node scripts/build.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const FILES = ['background.js', 'lib', 'popup', 'options', 'onboarding', 'styles', 'icons', '_locales', 'LICENSE'];

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

const targets = {
  firefox: (m) => m,
  chromium: (m) => {
    const { browser_specific_settings: _gecko, ...rest } = m;
    return {
      ...rest,
      background: { service_worker: m.background.scripts[0], type: 'module' },
      minimum_chrome_version: '116',
    };
  },
};

rmSync(dist, { recursive: true, force: true });
for (const [name, transform] of Object.entries(targets)) {
  const out = join(dist, name);
  mkdirSync(out, { recursive: true });
  for (const f of FILES) {
    if (existsSync(join(root, f))) cpSync(join(root, f), join(out, f), { recursive: true });
  }
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(transform(manifest), null, 2)}\n`);
  const zip = join(dist, `game-radar-${name}-${manifest.version}.zip`);
  execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: out });
  console.log(`✓ ${name}: dist/${name}/ → ${zip.replace(`${root}/`, '')}`);
}
