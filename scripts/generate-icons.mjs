// Gera os ícones do aplicativo a partir do logo "q" (igual ao do site):
// quadrado arredondado com gradiente violeta e a letra "q" em monoespaçada.
// Renderiza um SVG no navegador (Playwright/Edge) em vários tamanhos e empacota ICO/ICNS.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const out = fileURLToPath(new URL('../apps/desktop/src-tauri/icons/', import.meta.url));
mkdirSync(out, { recursive: true });

function svg(size) {
  const r = Math.round(size * 0.22);
  const fs = Math.round(size * 0.66);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#7c5cff"/>
    </linearGradient></defs>
    <rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/>
    <text x="50%" y="52%" dominant-baseline="central" text-anchor="middle"
      font-family="'JetBrains Mono','Cascadia Mono',Consolas,monospace" font-size="${fs}"
      font-weight="700" fill="#07070b">q</text>
  </svg>`;
}

const sizes = [32, 128, 256, 512];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const assets = new Map();
for (const size of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<!doctype html><html><body style="margin:0">${svg(size)}</body></html>`,
  );
  const buf = await page.locator('svg').screenshot({ omitBackground: true });
  assets.set(size, buf);
  await page.close();
}
await browser.close();

writeFileSync(path.join(out, '32x32.png'), assets.get(32));
writeFileSync(path.join(out, '128x128.png'), assets.get(128));
writeFileSync(path.join(out, '128x128@2x.png'), assets.get(256));
writeFileSync(path.join(out, '512x512.png'), assets.get(512));

// ICO com um PNG de 256×256 embutido (suportado no Windows Vista+).
const png256 = assets.get(256);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = 0; // 0 = 256
ico[7] = 0;
ico[8] = 0;
ico[9] = 0;
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

console.log('Ícones "q" gerados em', out);
