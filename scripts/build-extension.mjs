// Gera a extensão em extensions/browser/dist/{chromium,firefox}, prontas para
// "Carregar sem compactação" (Chromium) ou "Carregar extensão temporária" (Firefox).
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const ext = join(root, 'extensions', 'browser');
const dist = join(ext, 'dist');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const base = JSON.parse(await readFile(join(ext, 'manifest.json'), 'utf8'));

const assets = [
  [join(root, 'apps/desktop/src-tauri/icons/32x32.png'), 'icons/32.png'],
  [join(root, 'apps/desktop/src-tauri/icons/128x128.png'), 'icons/128.png'],
  [
    join(root, 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'),
    'fonts/geist.woff2',
  ],
  [
    join(
      root,
      'node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2',
    ),
    'fonts/geist-mono.woff2',
  ],
];

function firefoxManifest(manifest) {
  const copy = structuredClone(manifest);
  delete copy.key;
  delete copy.minimum_chrome_version;
  copy.background = { scripts: ['background.js'], type: 'module' };
  copy.browser_specific_settings = {
    gecko: { id: 'browser@qypher.org', strict_min_version: '128.0' },
  };
  return copy;
}

await rm(dist, { recursive: true, force: true });
for (const [target, manifest] of [
  ['chromium', { ...base, version }],
  ['firefox', firefoxManifest({ ...base, version })],
]) {
  const out = join(dist, target);
  await mkdir(join(out, 'icons'), { recursive: true });
  await mkdir(join(out, 'fonts'), { recursive: true });
  await cp(join(ext, 'src'), out, {
    recursive: true,
    filter: (path) => !path.endsWith('.d.ts'),
  });
  for (const [from, to] of assets) await cp(from, join(out, to));
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`Extensão ${target} gerada em ${out}\n`);
}
