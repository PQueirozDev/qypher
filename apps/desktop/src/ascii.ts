export type AsciiScene =
  'shield' | 'orbit' | 'globe' | 'cube' | 'wave' | 'radar' | 'helix' | 'matrix' | 'torus';
const columns = 78;
const rows = 44;
const ramp = '.,:;+=xX$#@';

/** Renderizador procedural e limitado: só formas geradas, sem rede nem assets. */
export function asciiFrame(time: number, scene: AsciiScene): string {
  const characters = new Array<string>(columns * rows).fill(' ');
  const depth = new Float32Array(columns * rows).fill(-Infinity);
  const [turn, tilt] = cameraFor(scene, time);
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

  // Anel ambiente sob a figura.
  if (scene === 'shield' || scene === 'orbit') {
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
  }

  if (scene === 'shield') renderShield(point);
  else if (scene === 'orbit') renderOrbit(point);
  else if (scene === 'globe') renderGlobe(point);
  else if (scene === 'cube') renderCube(point);
  else if (scene === 'radar') renderRadar(point, time);
  else if (scene === 'helix') renderHelix(point, time);
  else if (scene === 'matrix') renderMatrix(point, time);
  else if (scene === 'torus') renderTorus(point, time);
  else renderWave(point, time);

  const output = [];
  for (let row = 0; row < rows; row++)
    output.push(characters.slice(row * columns, (row + 1) * columns).join(''));
  return output.join('\n');
}

type Plot = (x: number, y: number, z: number, b: number, s?: string) => void;

function cameraFor(scene: AsciiScene, time: number): [number, number] {
  switch (scene) {
    case 'shield':
      return [Math.sin(time * 0.36) * 0.35 - 0.13, -0.12];
    case 'orbit':
      return [time * 0.19, 0.68 + Math.sin(time * 0.25) * 0.15];
    case 'globe':
      return [time * 0.24, 0.42];
    case 'cube':
      return [time * 0.3, 0.5 + Math.sin(time * 0.2) * 0.25];
    case 'wave':
      return [Math.sin(time * 0.3) * 0.3, 1.02];
    case 'radar':
      return [0.0, 0.62];
    case 'helix':
      return [time * 0.22, 0.12];
    case 'matrix':
      return [0, 0];
    case 'torus':
      return [time * 0.5, 0.72];
  }
}

function renderShield(point: Plot) {
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
}

function renderOrbit(point: Plot) {
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

function renderGlobe(point: Plot) {
  const r = 1.15;
  // Meridianos e paralelos como fios de arame.
  for (let lat = -Math.PI / 2 + 0.12; lat < Math.PI / 2; lat += Math.PI / 12) {
    for (let lon = 0; lon < Math.PI * 2; lon += 0.03) {
      plotSpherePoint(point, r, lat, lon);
    }
  }
  for (let lon = 0; lon < Math.PI * 2; lon += Math.PI / 12) {
    for (let lat = -Math.PI / 2; lat < Math.PI / 2; lat += 0.03) {
      plotSpherePoint(point, r, lat, lon);
    }
  }
}
function plotSpherePoint(point: Plot, r: number, lat: number, lon: number) {
  const x = r * Math.cos(lat) * Math.cos(lon);
  const y = r * Math.sin(lat);
  const z = r * Math.cos(lat) * Math.sin(lon);
  point(x, y, z, 0.25 + 0.75 * Math.max(0, z / r));
}

function renderCube(point: Plot) {
  const v = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ].map(([x, y, z]) => [x * 0.95, y * 0.95, z * 0.95]);
  const edges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  for (const [a, b] of edges) {
    for (let t = 0; t <= 1; t += 0.012) {
      const x = v[a][0] + (v[b][0] - v[a][0]) * t;
      const y = v[a][1] + (v[b][1] - v[a][1]) * t;
      const z = v[a][2] + (v[b][2] - v[a][2]) * t;
      point(x, y, z, 0.4 + 0.6 * ((z + 1) / 2));
    }
  }
}

function renderWave(point: Plot, time: number) {
  for (let x = -1.4; x <= 1.4; x += 0.035) {
    for (let yy = -1.4; yy <= 1.4; yy += 0.05) {
      const h = 0.34 * Math.sin(3 * x + time * 2.0) * Math.cos(3 * yy + time * 1.3);
      point(x, h, yy, 0.3 + 0.7 * ((h + 0.34) / 0.68));
    }
  }
}

// Varredura de radar: anéis, eixos, feixe giratório e alvos pulsantes.
function renderRadar(point: Plot, time: number) {
  const sweep = time % (Math.PI * 2);
  for (let r = 0.28; r <= 1.18; r += 0.3) {
    for (let a = 0; a < Math.PI * 2; a += 0.07) {
      point(Math.cos(a) * r, 0, Math.sin(a) * r, 0, a % 0.35 < 0.18 ? '.' : ':');
    }
  }
  for (let t = -1.18; t <= 1.18; t += 0.035) {
    point(t, 0, 0, 0, '.');
    point(0, 0, t, 0, '.');
  }
  // Rastro do feixe (fade atrás da borda de ataque).
  for (let d = 0; d < 1.1; d += 0.05) {
    const a = sweep - d * 0.85;
    for (let r = 0; r <= 1.18; r += 0.028) {
      point(Math.cos(a) * r, 0, Math.sin(a) * r, Math.max(0, 1 - d));
    }
  }
  const blips: Array<[number, number]> = [
    [0.7, 0.95],
    [1.9, 0.55],
    [2.7, 1.08],
    [4.6, 0.8],
  ];
  for (const [ba, br] of blips) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 3 + ba * 2);
    point(Math.cos(ba) * br, 0, Math.sin(ba) * br, 0.6 + 0.4 * pulse, pulse > 0.6 ? '@' : 'o');
  }
}

// Dupla hélice: dois filamentos em rotação com degraus ligando-os.
function renderHelix(point: Plot, time: number) {
  for (let t = -1.3; t <= 1.3; t += 0.018) {
    const a = t * 5 + time * 1.6;
    const x1 = Math.cos(a) * 0.52,
      z1 = Math.sin(a) * 0.52;
    const x2 = Math.cos(a + Math.PI) * 0.52,
      z2 = Math.sin(a + Math.PI) * 0.52;
    point(x1, t, z1, 0.3 + 0.7 * ((z1 + 0.52) / 1.04), '0');
    point(x2, t, z2, 0.3 + 0.7 * ((z2 + 0.52) / 1.04), 'O');
    if (Math.abs((((t * 5) % 1.0) + 1.0) % 1.0) < 0.04) {
      for (let s = 0.1; s < 1; s += 0.12) {
        point(x1 + (x2 - x1) * s, t, z1 + (z2 - z1) * s, 0.25, '-');
      }
    }
  }
}

// Chuva de caracteres: colunas caindo com cabeça brilhante e cauda que esmaece.
const MATRIX_GLYPHS = '01<>[]{}/|=+*#$%&';
function renderMatrix(point: Plot, time: number) {
  const cols = 40;
  for (let i = 0; i < cols; i++) {
    const x = -1.52 + (i / (cols - 1)) * 3.04;
    const speed = 0.45 + (((i * 73) % 17) / 17) * 1.25;
    const phase = (((i * 131) % 100) / 100) * 3.1;
    const headY = -1.42 + ((time * speed + phase) % 3.0);
    for (let t = 0; t < 14; t++) {
      const y = headY - t * 0.125;
      if (y < -1.44 || y > 1.44) continue;
      const bright = t === 0 ? 1 : Math.max(0.05, 0.72 - t * 0.055);
      const glyph = MATRIX_GLYPHS[(i * 7 + Math.floor(time * 9) + t * 5) % MATRIX_GLYPHS.length];
      point(x, y, 0, bright, t <= 2 ? glyph : undefined);
    }
  }
}

// Toro (donut) clássico, com sombreamento aproximado pela normal.
function renderTorus(point: Plot, time: number) {
  const r = 0.34,
    R = 0.82;
  for (let u = 0; u < Math.PI * 2; u += 0.09) {
    for (let v = 0; v < Math.PI * 2; v += 0.05) {
      const cu = Math.cos(u),
        su = Math.sin(u);
      const cv = Math.cos(v),
        sv = Math.sin(v);
      const x = (R + r * cv) * cu;
      const y = r * sv;
      const z = (R + r * cv) * su;
      // Luz vinda de cima-frente: realça a face superior do tubo.
      const bright = 0.3 + 0.7 * Math.max(0, (sv * 0.7 + cv * 0.5 + Math.sin(time) * 0.2 + 1) / 2);
      point(x, y, z, bright);
    }
  }
}
