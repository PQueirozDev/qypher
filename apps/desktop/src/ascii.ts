export type AsciiScene = 'shield' | 'orbit';
const columns = 78;
const rows = 44;
const ramp = '.,:;+=xX$#@';

/** Bounded character renderer: procedural shapes only, no network or assets. */
export function asciiFrame(time: number, scene: AsciiScene): string {
  const characters = new Array<string>(columns * rows).fill(' ');
  const depth = new Float32Array(columns * rows).fill(-Infinity);
  const turn = scene === 'shield' ? Math.sin(time * 0.36) * 0.35 - 0.13 : time * 0.19;
  const tilt = scene === 'shield' ? -0.12 : 0.68 + Math.sin(time * 0.25) * 0.15;
  const cy = Math.cos(turn),
    sy = Math.sin(turn),
    cx = Math.cos(tilt),
    sx = Math.sin(tilt);
  function point(x: number, y: number, z: number, brightness: number, symbol?: string) {
    const rx = x * cy + z * sy;
    const rz = z * cy - x * sy;
    const ry = y * cx - rz * sx;
    const zz = y * sx + rz * cx;
    const col = Math.round(columns / 2 + rx * 25);
    const row = Math.round(rows / 2 + ry * 15.3);
    if (col < 0 || col >= columns || row < 0 || row >= rows) return;
    const index = row * columns + col;
    if (zz <= depth[index]) return;
    depth[index] = zz;
    characters[index] =
      symbol ??
      ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(brightness * (ramp.length - 1))))];
  }
  for (let angle = 0; angle < Math.PI * 2; angle += 0.012) {
    point(Math.cos(angle) * 1.43, Math.sin(angle) * 0.45, Math.sin(angle) * 0.56 - 0.7, 0, '.');
    if (scene === 'shield')
      point(
        Math.cos(angle) * 1.26,
        Math.sin(angle) * 1.12,
        -0.55,
        0,
        angle % 0.16 < 0.08 ? ':' : '.',
      );
  }
  if (scene === 'shield') {
    for (let y = -1; y < 1.15; y += 0.023) {
      const width =
        y < -0.8
          ? (y + 1) * 4.25
          : y < 0.15
            ? 0.85 - (y + 0.8) * 0.06
            : 0.793 * (1 - Math.pow(y - 0.15, 1.45));
      if (width <= 0) continue;
      for (let x = -width; x <= width; x += 0.019) {
        const edge = Math.abs(x / width);
        const z = 0.34 * Math.sqrt(Math.max(0, 1 - edge * edge));
        const border = edge > 0.86 || y < -0.8 || y > 0.97;
        const shackle = y > -0.5 && y < -0.1 && Math.abs(Math.hypot(x, y + 0.18) - 0.27) < 0.053;
        const lock = Math.abs(x) < 0.36 && y > -0.12 && y < 0.42;
        const keyhole = Math.abs(x) < 0.036 && y > 0.01 && y < 0.23;
        const light = border
          ? 0.87
          : shackle || lock
            ? keyhole
              ? 0.08
              : 0.96
            : 0.13 + ((x + width) / (width * 2)) * 0.34;
        point(x, y, z, light);
      }
    }
  } else {
    for (let a = 0; a < Math.PI * 2; a += 0.045) {
      for (let b = 0; b < Math.PI * 2; b += 0.06) {
        const radius = 0.88 + 0.36 * Math.cos(b);
        const nx = Math.cos(a) * Math.cos(b),
          ny = Math.sin(a) * Math.cos(b),
          nz = Math.sin(b);
        point(
          Math.cos(a) * radius,
          Math.sin(a) * radius,
          0.36 * Math.sin(b),
          0.2 + 0.8 * Math.max(0, -nx * 0.42 - ny * 0.4 + nz * 0.81),
        );
      }
    }
  }
  const output = [];
  for (let row = 0; row < rows; row++)
    output.push(characters.slice(row * columns, (row + 1) * columns).join(''));
  return output.join('\n');
}
