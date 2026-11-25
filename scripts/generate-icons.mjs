// Gera os ícones do aplicativo a partir do logo em apps/desktop/icon-source.png
// (escudo em Q em pixel art). Redimensiona no navegador (Playwright/Edge) e empacota ICO/ICNS.
// O desenho das imagens do NSIS roda dentro do navegador (page.evaluate).
/* global Image, document */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'apps/desktop/src-tauri/icons/');
const source = path.join(root, 'apps/desktop/icon-source.png');
mkdirSync(out, { recursive: true });

const dataUri = `data:image/png;base64,${readFileSync(source).toString('base64')}`;
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const assets = new Map();
for (const size of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#0a0a08">
      <img src="${dataUri}" style="width:${size}px;height:${size}px;display:block"/>
    </body></html>`,
  );
  // omitBackground garante PNG RGBA (com canal alfa); o Tauri exige RGBA nos ícones.
  assets.set(size, await page.locator('img').screenshot({ omitBackground: true }));
  await page.close();
}

// Imagens do instalador NSIS (BMP 24 bits): cabeçalho 150×57 e lateral 164×314.
const nsis = path.join(out, 'installer');
mkdirSync(nsis, { recursive: true });
const drawings = {
  'header.bmp': { width: 150, height: 57, layout: 'header' },
  'sidebar.bmp': { width: 164, height: 314, layout: 'sidebar' },
};
for (const [file, { width, height, layout }] of Object.entries(drawings)) {
  const page = await browser.newPage();
  const pixels = await page.evaluate(
    async ({ width, height, layout, logo }) => {
      const image = new Image();
      image.src = logo;
      await image.decode();
      await document.fonts.ready;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const sans = '"Segoe UI", system-ui, sans-serif';
      // O logo-fonte tem fundo opaco: desenha com cantos arredondados, como ícone de app.
      const drawLogo = (x, y, size) => {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, size, size, size * 0.22);
        ctx.clip();
        ctx.drawImage(image, x, y, size, size);
        ctx.restore();
      };
      const mono = 'Consolas, "Cascadia Code", monospace';
      if (layout === 'header') {
        // O cabeçalho do NSIS fica sobre fundo claro: mantém a faixa clara e só o logo.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        drawLogo(width - 52, 6, 45);
      } else {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#151410');
        gradient.addColorStop(1, '#090807');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        // Grade sutil no estilo do site.
        ctx.strokeStyle = 'rgba(228, 208, 161, 0.08)';
        for (let x = 0.5; x < width; x += 16) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
        for (let y = 0.5; y < height; y += 16) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
        const glow = ctx.createRadialGradient(82, 110, 4, 82, 110, 90);
        glow.addColorStop(0, 'rgba(218, 191, 129, 0.35)');
        glow.addColorStop(1, 'rgba(218, 191, 129, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);
        drawLogo(42, 40, 80);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f1efea';
        ctx.font = `600 22px ${sans}`;
        ctx.fillText('Qypher', 82, 166);
        ctx.fillStyle = '#e4d0a1';
        ctx.font = `10px ${mono}`;
        ctx.fillText('SEGURANÇA DE', 82, 190);
        ctx.fillText('APLICAÇÕES', 82, 204);
        ctx.fillStyle = '#726b5c';
        ctx.font = `9px ${mono}`;
        ctx.fillText('local-first', 82, 290);
      }
      return Array.from(ctx.getImageData(0, 0, width, height).data);
    },
    { width, height, layout, logo: dataUri },
  );
  await page.close();
  writeFileSync(path.join(nsis, file), toBmp(width, height, pixels));
}
await browser.close();

// BMP 24 bits sem compressão, linhas de baixo para cima com padding de 4 bytes (formato do NSIS).
function toBmp(width, height, rgba) {
  const stride = Math.ceil((width * 3) / 4) * 4;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      const target = (height - 1 - y) * stride + x * 3;
      data[target] = rgba[source + 2];
      data[target + 1] = rgba[source + 1];
      data[target + 2] = rgba[source];
    }
  }
  const header = Buffer.alloc(54);
  header.write('BM', 0);
  header.writeUInt32LE(54 + data.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(data.length, 34);
  header.writeInt32LE(2835, 38);
  header.writeInt32LE(2835, 42);
  return Buffer.concat([header, data]);
}

writeFileSync(path.join(out, '32x32.png'), assets.get(32));
writeFileSync(path.join(out, '128x128.png'), assets.get(128));
writeFileSync(path.join(out, '128x128@2x.png'), assets.get(256));
writeFileSync(path.join(out, '512x512.png'), assets.get(512));

// ICO multi-tamanho (PNG embutido em cada entrada, Windows Vista+): o Windows escolhe a
// resolução certa para atalhos, barra de tarefas, Explorer e o próprio instalador.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoHeader = Buffer.alloc(6 + icoSizes.length * 16);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(icoSizes.length, 4);
let icoOffset = icoHeader.length;
icoSizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  const png = assets.get(size);
  icoHeader.writeUInt8(size >= 256 ? 0 : size, entry);
  icoHeader.writeUInt8(size >= 256 ? 0 : size, entry + 1);
  icoHeader.writeUInt16LE(1, entry + 4);
  icoHeader.writeUInt16LE(32, entry + 6);
  icoHeader.writeUInt32LE(png.length, entry + 8);
  icoHeader.writeUInt32LE(icoOffset, entry + 12);
  icoOffset += png.length;
});
writeFileSync(
  path.join(out, 'icon.ico'),
  Buffer.concat([icoHeader, ...icoSizes.map((size) => assets.get(size))]),
);

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

console.log('Ícones gerados a partir do logo em pixel art em', out, 'e em', site);
