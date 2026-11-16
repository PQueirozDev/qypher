import { element, type MotionContext } from './dom.ts';

function distance(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/** Original character drawing: shield outline, terminal chevron and Q tail. */
export function makeAsciiLogo(columns = 37, rows = 24): string {
  const outline = [
    [0, -0.95],
    [0.73, -0.59],
    [0.73, 0.18],
    [0.57, 0.55],
    [0, 0.95],
    [-0.57, 0.55],
    [-0.73, 0.18],
    [-0.73, -0.59],
    [0, -0.95],
  ];
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => {
      const x = (column / (columns - 1) - 0.5) * 2.2;
      const y = (row / (rows - 1) - 0.5) * 2.2;
      const border = outline.some(
        (point, index) =>
          index > 0 &&
          distance(
            x,
            y,
            ...(outline[index - 1] as [number, number]),
            ...(point as [number, number]),
          ) < 0.075,
      );
      const tail = distance(x, y, 0.2, 0.48, 0.88, 1.02) < 0.08;
      const chevron =
        distance(x, y, -0.3, -0.24, -0.07, 0) < 0.055 ||
        distance(x, y, -0.07, 0, -0.3, 0.24) < 0.055;
      const underscore = distance(x, y, 0.03, 0.21, 0.38, 0.21) < 0.055;
      if (chevron || underscore) return '@';
      if (tail) return '#';
      return border ? ((column + row) % 3 === 0 ? '+' : '#') : ' ';
    }).join(''),
  ).join('\n');
}

export function createAscii() {
  const pre = element('#ascii-logo');
  const phase = element('#ascii-phase');
  const original = makeAsciiLogo();
  const symbols = [...original];
  const scraps = '.:+/*';
  let previous = -1;
  let visible = true;
  let time = 0;
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  });
  observer.observe(pre);
  pre.textContent = original;
  return {
    tick(delta: number) {
      if (!visible) return;
      time += delta;
      const cycle = time % 18000;
      const dissolving = cycle > 15100 && cycle < 16000;
      const assembling = cycle < 1100 || cycle >= 16000;
      const frame = Math.floor(time / 90);
      if (
        frame === previous ||
        (!dissolving && !assembling && phase.textContent === 'SHIELD / STABLE')
      )
        return;
      previous = frame;
      const amount = dissolving
        ? (cycle - 15100) / 900
        : assembling
          ? Math.min(1, (cycle >= 16000 ? cycle - 16000 : cycle) / 1100)
          : 1;
      pre.textContent = symbols
        .map((character, index) => {
          if (character === '\n' || character === ' ') return character;
          const threshold = ((index * 73) % 997) / 997;
          const shown = dissolving ? threshold > amount : threshold < amount;
          return shown ? character : scraps[(index + frame) % scraps.length];
        })
        .join('');
      phase.textContent = dissolving
        ? 'SHIELD / DISSOLVE'
        : assembling && amount < 1
          ? 'SHIELD / ASSEMBLY'
          : 'SHIELD / STABLE';
    },
    settle() {
      pre.textContent = original;
      phase.textContent = 'SHIELD / STABLE';
    },
    destroy() {
      observer.disconnect();
    },
  };
}

export function createTextReveals(context: MotionContext) {
  const tasks = new Map<HTMLElement, { original: string; started: number | null }>();
  let now = 0;
  const observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const source = entry.target as HTMLElement;
        const original = source.textContent || '';
        const accessible = document.createElement('span');
        accessible.className = 'sr-only';
        accessible.textContent = original;
        const visual = document.createElement('span');
        visual.setAttribute('aria-hidden', 'true');
        visual.textContent = original;
        source.replaceChildren(accessible, visual);
        if (context.moving()) tasks.set(visual, { original, started: null });
        observer.unobserve(source);
      }),
    { threshold: 0.2 },
  );
  document
    .querySelectorAll<HTMLElement>('[data-scramble]')
    .forEach((source) => observer.observe(source));
  return {
    tick(time: number) {
      if (Math.floor(time / 55) === Math.floor(now / 55)) return;
      now = time;
      tasks.forEach((task, visual) => {
        task.started ??= time;
        const progress = (time - task.started) / 800;
        if (progress >= 1) {
          visual.textContent = task.original;
          tasks.delete(visual);
          return;
        }
        visual.textContent = [...task.original]
          .map((character, index) =>
            index / task.original.length < progress || character === ' '
              ? character
              : '01/[]#'[(index + Math.floor(time / 55)) % 6],
          )
          .join('');
      });
    },
    settle() {
      tasks.forEach((task, visual) => {
        visual.textContent = task.original;
      });
      tasks.clear();
    },
    destroy() {
      observer.disconnect();
    },
  };
}
