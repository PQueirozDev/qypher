// Gera os ícones do aplicativo a partir do logo em apps/desktop/icon-source.png
// (o "Q" neon). Redimensiona no navegador (Playwright/Edge) e empacota ICO/ICNS.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'apps/desktop/src-tauri/icons/');
const source = path.join(root, 'apps/desktop/icon-source.png');
mkdirSync(out, { recursive: true });

const dataUri = `data:image/png;base64,${readFileSync(source).toString('base64')}`;
const sizes = [32, 128, 256, 512];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const assets = new Map();
for (const size of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#07070b">
      <img src="${dataUri}" style="width:${size}px;height:${size}px;display:block"/>
    </body></html>`,
  );
  assets.set(size, await page.locator('img').screenshot());
  await page.close();
}
await browser.close();

writeFileSync(path.join(out, '32x32.png'), assets.get(32));
writeFileSync(path.join(out, '128x128.png'), assets.get(128));
writeFileSync(path.join(out, '128x128@2x.png'), assets.get(256));
writeFileSync(path.join(out, '512x512.png'), assets.get(512));

// ICO com um PNG de 256×256 embutido (Windows Vista+).
const png256 = assets.get(256);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png256.length, 14);
ico.writeUInt32LE(22, 18);
writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([ico, png256]));

// ICNS com o PNG de 512×512 (tipo ic09).
const png512 = assets.get(512);
const icns = Buffer.alloc(16);
icns.write('icns', 0);
icns.writeUInt32BE(png512.length + 16, 4);
icns.write('ic09', 8);
icns.writeUInt32BE(png512.length + 8, 12);
writeFileSync(path.join(out, 'icon.icns'), Buffer.concat([icns, png512]));

// Versões para o site: favicon e logo da marca.
const site = path.join(root, 'site');
writeFileSync(path.join(site, 'favicon.png'), assets.get(128));
writeFileSync(path.join(site, 'logo.png'), assets.get(256));

console.log('Ícones gerados a partir do logo neon em', out, 'e em', site);
