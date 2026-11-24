import { createExperience } from './experience/index.ts';
import { createInteractions } from './experience/interactions.ts';
import {
  LATEST_API,
  PLATFORM_LABEL,
  detectPlatform,
  formatSize,
  pickInstaller,
} from './experience/download.ts';

// The public website is deliberately independent of the desktop runtime.
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const fine = matchMedia('(hover: hover) and (pointer: fine)');
const mobile = matchMedia('(max-width: 760px)');
const controller = new AbortController();
const { signal } = controller;
const listen = (target, name, callback, options = {}) =>
  target.addEventListener(name, callback, { ...options, signal });
const select = (selector) => document.querySelector(selector);
const header = select('.site-header');
const menu = select('.menu-toggle');
const nav = select('#navigation');
const radar = select('.radar-scene');
const parallax = select('.radar-parallax');
const halo = select('.cursor-halo');
const motionButton = select('#motion-toggle');
const canvas = select('#ambient');
const ctx = canvas.getContext('2d');
const animations = new Set();
let paused = false;
let frameId = 0;
let previous = 0;
let elapsed = 0;
let width = 0;
let height = 0;
let codeStreams = [];
let readingZones = [];
const codeGlyphs = '01{}[]<>/\\|=+*#$%&xX';
const rainColors = ['#a78bfa', '#6ea8ff', '#4fd1e0'];
let radarVisible = true;
let terminalVisible = false;
let radarX = 0;
let radarY = 0;
let depthX = 0;
let depthY = 0;
const pointer = { x: -1000, y: -1000, smoothX: -1000, smoothY: -1000, active: false };
const blips = [...document.querySelectorAll('.blip')];
const experience = createExperience({
  moving: running,
  reduced: () => reduced.matches,
  animations,
});

const interactions = createInteractions(
  { moving: running, reduced: () => reduced.matches, animations },
  { signal, platform: detectPlatform(navigator.userAgent, navigator.userAgentData?.platform) },
);

function running() {
  return !paused && !reduced.matches && !document.hidden;
}

function animate(element, keyframes, options) {
  if (!running()) return;
  const animation = element.animate(keyframes, options);
  animations.add(animation);
  animation.onfinish = () => animations.delete(animation);
  animation.oncancel = () => animations.delete(animation);
}

function closeMenu(restoreFocus = false) {
  const wasOpen = menu.getAttribute('aria-expanded') === 'true';
  menu.setAttribute('aria-expanded', 'false');
  nav.classList.remove('open');
  if (wasOpen && restoreFocus) menu.focus();
}
listen(menu, 'click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('open', open);
});
listen(nav, 'click', (event) => {
  if (event.target.closest('a')) closeMenu();
});
listen(document, 'click', (event) => {
  if (!event.target.closest('.site-header')) closeMenu();
});
listen(document, 'keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeMenu(true);
});

const navLinks = [...nav.querySelectorAll('a[href^="#"]')];
const sections = [...document.querySelectorAll('main > section[id]')];
const readingElements = [
  ...document.querySelectorAll(
    '.hero-copy, .section-intro, .sub, .product-notes, .step, .principle, .note',
  ),
];
function updateReadingZones() {
  readingZones = readingElements
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.bottom > -10 && box.top < innerHeight + 10)
    .map((box) => ({
      left: box.left - 12,
      right: box.right + 12,
      top: box.top - 10,
      bottom: box.bottom + 10,
    }));
}
let scrollScheduled = false;
function updateNavigation() {
  scrollScheduled = false;
  header.classList.toggle('scrolled', scrollY > 20);
  updateReadingZones();
  if (reduced.matches || paused) drawAmbient(0);
  let active = '';
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= innerHeight * 0.38) active = section.id;
  }
  navLinks.forEach((link) => {
    if (link.hash === `#${active}`) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}
listen(
  window,
  'scroll',
  () => {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(updateNavigation);
  },
  { passive: true },
);
updateNavigation();

// One observer reveals content without hiding the no-JavaScript version.
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const element = entry.target;
      const siblings = [...element.parentElement.children];
      const delay = element.matches('.card, .step, .dl-card')
        ? (siblings.indexOf(element) % 3) * 65
        : 0;
      animate(
        element,
        [
          { opacity: 0, transform: 'translateY(20px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 650, delay, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' },
      );
      revealObserver.unobserve(element);
    });
  },
  { threshold: 0.08 },
);
document
  .querySelectorAll(
    '.section-intro, .product-window, .card, .step, .panel-box, .dl-card, .finale, section:not(.hero) h2',
  )
  .forEach((element) => revealObserver.observe(element));

const icons = [
  '<path d="M4 4h9l5 5v11H4zM13 4v5h5M8 13h6M8 16h3"/><path d="m18 15 3 3-3 3"/>',
  '<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z"/><path d="m8 12 3 3 5-6"/>',
  '<path d="M4 5h16v14H4zM4 9h16M8 13h3M8 16h7"/>',
  '<path d="M3 4h18v16H3zM3 8h18m-11 4-3 2 3 2m4-4 3 2-3 2"/>',
  '<circle cx="12" cy="12" r="7"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',
  '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
];
document.querySelectorAll('.glyph').forEach((element, index) => {
  const text = element.textContent;
  element.innerHTML = `<svg class="feature-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[index]}</svg><span>${text}</span>`;
});

function resize() {
  width = innerWidth;
  height = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, mobile.matches ? 1 : 1.5);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  const spacing = mobile.matches ? 40 : 30;
  const count = Math.ceil(width / spacing);
  codeStreams = Array.from({ length: count }, (_, index) => ({
    x: index * spacing + Math.random() * 10,
    y: Math.random() * (height + 300),
    speed: 14 + Math.random() * 18,
    depth: 0.5 + Math.random() * 0.5,
    length: mobile.matches
      ? 9 + Math.floor(Math.random() * 8)
      : 13 + Math.floor(Math.random() * 15),
    color: rainColors[index % rainColors.length],
    glyphs: Array.from(
      { length: 28 },
      () => codeGlyphs[Math.floor(Math.random() * codeGlyphs.length)],
    ),
    nextMutation: elapsed + Math.random() * 500,
  }));
  updateReadingZones();
  drawAmbient(0);
  if (!mobile.matches) closeMenu();
}
listen(window, 'resize', resize, { passive: true });

function drawAmbient(delta) {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  const drift = reduced.matches ? 0 : Math.sin(elapsed / 16000) * 8;
  ctx.strokeStyle = '#a78bfa07';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let x = -80 + drift; x < width + 80; x += 80) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = -80 + drift; y < height + 80; y += 80) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  const glowX =
    pointer.active && fine.matches
      ? pointer.smoothX
      : width * (0.65 + Math.sin(elapsed / 20000) * 0.15);
  const glowY = pointer.active && fine.matches ? pointer.smoothY : height * 0.35;
  const glow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, mobile.matches ? 170 : 370);
  glow.addColorStop(0, '#7c5cff0c');
  glow.addColorStop(1, '#7c5cff00');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  const glyphSize = mobile.matches ? 11 : 13;
  const rowHeight = glyphSize + 2;
  const reacts = pointer.active && fine.matches && !reduced.matches;
  ctx.font = `${glyphSize}px 'JetBrains Mono', Consolas, monospace`;
  for (const stream of codeStreams) {
    const headDistance = reacts
      ? Math.hypot(stream.x - pointer.smoothX, stream.y - pointer.smoothY)
      : Infinity;
    const headInfluence = Math.max(0, 1 - headDistance / 210);
    stream.y += delta * 0.001 * stream.speed * (1 + headInfluence * 0.65);
    if (stream.y - stream.length * rowHeight > height) stream.y = -rowHeight;
    if (delta > 0 && elapsed >= stream.nextMutation) {
      const index = Math.floor(Math.random() * stream.glyphs.length);
      stream.glyphs[index] = codeGlyphs[Math.floor(Math.random() * codeGlyphs.length)];
      stream.nextMutation = elapsed + 160 + Math.random() * 380;
    }
    ctx.fillStyle = stream.color;
    for (let index = stream.length - 1; index >= 0; index--) {
      const y = stream.y - index * rowHeight;
      if (y < -rowHeight || y > height + rowHeight) continue;
      if (
        readingZones.some(
          (box) => stream.x >= box.left && stream.x <= box.right && y >= box.top && y <= box.bottom,
        )
      )
        continue;
      const distance = reacts
        ? Math.hypot(stream.x - pointer.smoothX, y - pointer.smoothY)
        : Infinity;
      const influence = Math.max(0, 1 - distance / 190);
      const trail = 1 - index / stream.length;
      const bend = reacts ? (stream.x - pointer.smoothX) * influence * 0.09 : 0;
      const sway = reduced.matches ? 0 : Math.sin(elapsed / 7000 + stream.x * 0.01) * 2;
      ctx.globalAlpha =
        (index === 0 ? 0.28 : 0.035 + trail * trail * 0.15) * stream.depth + influence * 0.38;
      if (reduced.matches) ctx.globalAlpha *= 0.65;
      ctx.fillText(stream.glyphs[index], stream.x + bend + sway, y);
    }
  }
  ctx.globalAlpha = 1;
  // A few ambient points share this canvas and clock, rather than another renderer.
  ctx.fillStyle = '#a78bfa25';
  for (let index = 0; index < Math.min(codeStreams.length, mobile.matches ? 3 : 8); index++) {
    const stream = codeStreams[index];
    const x = (stream.x * 2.7 + 25) % width;
    const y = (stream.y * 0.6 + index * 71) % height;
    if (
      readingZones.some((box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)
    )
      continue;
    ctx.beginPath();
    ctx.arc(x, y, 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

const interactiveSelector = 'a, button, summary';
listen(
  document,
  'pointermove',
  (event) => {
    if (!fine.matches || !running() || event.pointerType === 'touch') return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (!pointer.active) {
      pointer.smoothX = pointer.x;
      pointer.smoothY = pointer.y;
    }
    pointer.active = true;
    halo.classList.add('active');
    halo.classList.toggle('interactive', Boolean(event.target.closest(interactiveSelector)));
    halo.classList.toggle(
      'text',
      Boolean(event.target.closest('p, h1, h2, h3, input, textarea, [contenteditable]')),
    );
  },
  { passive: true },
);
listen(document, 'pointerout', (event) => {
  if (event.relatedTarget) return;
  pointer.active = false;
  halo.classList.remove('active');
});
listen(document, 'keydown', () => {
  halo.classList.remove('active');
  pointer.active = false;
});
listen(
  radar,
  'pointermove',
  (event) => {
    if (!fine.matches || !running()) return;
    const bounds = radar.getBoundingClientRect();
    radarX = (event.clientX - bounds.left) / bounds.width - 0.5;
    radarY = (event.clientY - bounds.top) / bounds.height - 0.5;
    blips.forEach((blip) => {
      const box = blip.getBoundingClientRect();
      blip.classList.toggle(
        'near',
        Math.hypot(event.clientX - box.x - box.width / 2, event.clientY - box.y - box.height / 2) <
          95,
      );
    });
  },
  { passive: true },
);
listen(radar, 'pointerleave', () => {
  radarX = 0;
  radarY = 0;
  blips.forEach((blip) => blip.classList.remove('near'));
});

document.querySelectorAll('.card, .dl-card, .btn').forEach((element) => {
  listen(
    element,
    'pointermove',
    (event) => {
      if (!fine.matches || !running()) return;
      const bounds = element.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      element.style.setProperty('--spot-x', `${x}px`);
      element.style.setProperty('--spot-y', `${y}px`);
      if (element.classList.contains('magnetic'))
        element.style.translate = `${(x - bounds.width / 2) * 0.06}px ${(y - bounds.height / 2) * 0.09}px`;
    },
    { passive: true },
  );
  listen(element, 'pointerleave', () => {
    element.style.translate = '';
  });
});

const visibilityObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.target === radar) radarVisible = entry.isIntersecting;
      else {
        terminalVisible = entry.isIntersecting;
      }
    });
  },
  { threshold: 0.05 },
);
visibilityObserver.observe(radar);
visibilityObserver.observe(select('.term'));

function updateRadar() {
  depthX += (radarX * 9 - depthX) * 0.07;
  depthY += (radarY * 7 - depthY) * 0.07;
  parallax.style.transform = `translate3d(${depthX}px, ${depthY}px, 0)`;
}

function frame(now) {
  // Synchronize before stopping the loop if a media change arrives between frames.
  if (reduced.matches !== motionButton.disabled) {
    refreshMotion();
    return;
  }
  if (!running()) {
    frameId = 0;
    return;
  }
  frameId = requestAnimationFrame(frame);
  if (previous && now - previous < 32) return;
  const delta = previous ? Math.min(now - previous, 80) : 0;
  previous = now;
  elapsed += delta;
  pointer.smoothX += (pointer.x - pointer.smoothX) * 0.16;
  pointer.smoothY += (pointer.y - pointer.smoothY) * 0.16;
  if (fine.matches && pointer.active)
    halo.style.transform = `translate3d(${pointer.smoothX}px, ${pointer.smoothY}px, 0)`;
  drawAmbient(delta);
  if (radarVisible) updateRadar();
  experience.tick(elapsed, delta, radarVisible, terminalVisible);
}
function refreshMotion() {
  root.classList.toggle('motion-paused', paused || reduced.matches);
  root.classList.toggle('page-hidden', document.hidden);
  if (paused || reduced.matches) experience.settle();
  cancelAnimationFrame(frameId);
  frameId = 0;
  previous = 0;
  if (running()) {
    animations.forEach((animation) => animation.play());
    frameId = requestAnimationFrame(frame);
  } else {
    animations.forEach((animation) => (reduced.matches ? animation.finish() : animation.pause()));
    halo.classList.remove('active');
    document.querySelectorAll('.magnetic').forEach((element) => {
      element.style.translate = '';
    });
    if (reduced.matches) {
      parallax.style.transform = '';
      drawAmbient(0);
    }
  }
  motionButton.disabled = reduced.matches;
  motionButton.setAttribute('aria-pressed', String(paused || reduced.matches));
  motionButton.innerHTML = reduced.matches
    ? 'Movimento reduzido'
    : paused
      ? 'Retomar animações <span aria-hidden="true">▷</span>'
      : 'Pausar animações <span aria-hidden="true">Ⅱ</span>';
}
listen(motionButton, 'click', () => {
  paused = !paused;
  refreshMotion();
});
reduced.addEventListener('change', refreshMotion);
function refreshPointer() {
  pointer.active = false;
  halo.classList.remove('active');
}
fine.addEventListener('change', refreshPointer);
listen(document, 'visibilitychange', refreshMotion);
listen(window, 'pageshow', refreshMotion);
listen(window, 'pagehide', (event) => {
  cancelAnimationFrame(frameId);
  if (event.persisted) return;
  controller.abort();
  experience.destroy();
  interactions.destroy();
  reduced.removeEventListener('change', refreshMotion);
  fine.removeEventListener('change', refreshPointer);
  revealObserver.disconnect();
  visibilityObserver.disconnect();
  animations.forEach((animation) => animation.cancel());
});
// Download direto: troca os links de release pelo instalador do último release público.
// Sem rede, sem release publicada ou sem instalador para o sistema, os links originais ficam.
async function wireDownloads() {
  let release;
  try {
    const response = await fetch(LATEST_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal,
    });
    if (!response.ok) return;
    release = await response.json();
  } catch {
    return;
  }
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const version = typeof release?.tag_name === 'string' ? release.tag_name : '';
  for (const card of document.querySelectorAll('.dl-card[data-platform]')) {
    const installer = pickInstaller(assets, card.dataset.platform);
    const link = card.querySelector('.get');
    if (!installer || !link) continue;
    const extension = installer.name.split('.').pop();
    link.href = installer.url;
    link.removeAttribute('target');
    link.setAttribute('download', '');
    link.title = installer.name;
    link.textContent = `⤓ baixar .${extension} ${formatSize(installer.size)}`.trim();
  }
  const platform = detectPlatform(navigator.userAgent, navigator.userAgentData?.platform);
  const installer = platform && pickInstaller(assets, platform);
  if (!installer) return;
  for (const button of document.querySelectorAll('[data-download]')) {
    button.href = installer.url;
    button.setAttribute('download', '');
    button.title = installer.name;
    button.setAttribute('aria-label', `Baixar Qypher ${version} para ${PLATFORM_LABEL[platform]}`);
  }
  const label = select('[data-download-label]');
  if (label) label.textContent = `Baixar para ${PLATFORM_LABEL[platform]}`;
  const hint = select('[data-download-hint]');
  if (hint) {
    hint.textContent = [version, installer.name, formatSize(installer.size)]
      .filter(Boolean)
      .join(' · ');
    const others = document.createElement('a');
    others.href = '#downloads';
    others.textContent = 'outros sistemas';
    hint.append(' · ', others);
    hint.hidden = false;
  }
}

resize();
refreshMotion();
wireDownloads();
