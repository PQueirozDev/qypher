import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const out = fileURLToPath(new URL('../apps/desktop/src-tauri/icons/', import.meta.url));
mkdirSync(out, { recursive: true });
const polygon = [
  [512, 170],
  [788, 290],
  [788, 500],
  [775, 590],
  [730, 680],
  [640, 770],
  [512, 854],
  [384, 770],
  [294, 680],
  [249, 590],
  [236, 500],
  [236, 290],
];
const glyph = [
  [
    [434, 387],
    [338, 483],
  ],
  [
    [338, 483],
    [434, 579],
  ],
  [
    [590, 387],
    [686, 483],
  ],
  [
    [686, 483],
    [590, 579],
  ],
  [
    [530, 349],
    [468, 617],
  ],
];
const distance = (x, y, a, b) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
};
function inside(x, y) {
  let v = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) v = !v;
  }
  return v;
}
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(size) {
  const data = Buffer.alloc((size * 4 + 1) * size);
  const scale = 1024 / size;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      const color = [0, 0, 0, 0];
      for (let sy = 0; sy < 2; sy++)
        for (let sx = 0; sx < 2; sx++) {
          const px = (x + (sx + 0.5) / 2) * scale,
            py = (y + (sy + 0.5) / 2) * scale;
          const qx = Math.max(224 - px, px - 800, 0),
            qy = Math.max(224 - py, py - 800, 0);
          let c = qx * qx + qy * qy > 224 * 224 ? [0, 0, 0, 0] : [8, 12, 10, 255];
          if (inside(px, py)) c = [16, 38, 28, 255];
          if (
            polygon.some((p, i) => distance(px, py, p, polygon[(i + 1) % polygon.length]) <= 20) ||
            glyph.some(([a, b]) => distance(px, py, a, b) <= 18)
          )
            c = [0, 255, 136, 255];
          for (let k = 0; k < 4; k++) color[k] += c[k] / 4;
        }
      for (let k = 0; k < 4; k++) data[row + 1 + x * 4 + k] = Math.round(color[k]);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(data)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const assets = new Map();
for (const [name, size] of [
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
  ['512x512.png', 512],
]) {
  const bytes = png(size);
  assets.set(size, bytes);
  writeFileSync(path.join(out, name), bytes);
}
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(assets.get(256).length, 14);
ico.writeUInt32LE(22, 18);
writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([ico, assets.get(256)]));
const icon = assets.get(512),
  icns = Buffer.alloc(16);
icns.write('icns');
icns.writeUInt32BE(icon.length + 16, 4);
icns.write('ic09', 8);
icns.writeUInt32BE(icon.length + 8, 12);
writeFileSync(path.join(out, 'icon.icns'), Buffer.concat([icns, icon]));
console.log(`Generated PNG, ICO and ICNS icons in ${out}`);
