// Interações de leitura do site: progresso de rolagem, voltar ao topo, inclinação
// dos cartões, passos e princípios revelados em sequência e o cartão de download
// do sistema do visitante destacado. Tudo respeita "reduzir movimento" e o botão
// de pausar animações (classe motion-paused no <html>).
import type { MotionContext } from './dom.ts';

type Platform = 'windows' | 'linux' | 'macos' | null;

export function createInteractions(
  context: MotionContext,
  options: { signal: AbortSignal; platform: Platform },
) {
  const { signal } = options;
  const listen = <K extends keyof WindowEventMap>(
    target: Window | HTMLElement | Document,
    name: K | string,
    handler: (event: Event) => void,
    extra: AddEventListenerOptions = {},
  ) => target.addEventListener(name, handler, { ...extra, signal });
  const fine = matchMedia('(hover: hover) and (pointer: fine)');

  // Barra de progresso de leitura presa ao cabeçalho.
  const header = document.querySelector<HTMLElement>('.site-header .nav');
  const progress = document.createElement('div');
  progress.className = 'scroll-progress';
  progress.setAttribute('aria-hidden', 'true');
  header?.append(progress);

  // Botão de voltar ao topo, visível depois da primeira dobra.
  const top = document.createElement('button');
  top.type = 'button';
  top.className = 'back-to-top';
  top.setAttribute('aria-label', 'Voltar ao topo');
  top.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>';
  document.body.append(top);
  listen(top, 'click', () => {
    scrollTo({ top: 0, behavior: context.reduced() ? 'auto' : 'smooth' });
    document.querySelector<HTMLElement>('.site-header a, .site-header button')?.focus({
      preventScroll: true,
    });
  });

  let scheduled = false;
  const update = () => {
    scheduled = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    progress.style.transform = `scaleX(${ratio})`;
    top.classList.toggle('visible', scrollY > innerHeight * 1.2);
  };
  listen(
    window,
    'scroll',
    () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(update);
    },
    { passive: true },
  );
  listen(window, 'resize', update, { passive: true });
  update();

  // Passos e princípios: entram em sequência ao aparecer.
  const sequence = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        sequence.unobserve(entry.target);
      }),
    { threshold: 0.35 },
  );
  document.querySelectorAll('.steps, .principles').forEach((element) => sequence.observe(element));

  // Inclinação sutil dos cartões de recursos, seguindo o ponteiro.
  document.querySelectorAll<HTMLElement>('.card').forEach((card) => {
    listen(
      card,
      'pointermove',
      (event) => {
        if (!fine.matches || !context.moving()) return;
        const pointer = event as PointerEvent;
        const box = card.getBoundingClientRect();
        const x = (pointer.clientX - box.left) / box.width - 0.5;
        const y = (pointer.clientY - box.top) / box.height - 0.5;
        card.style.setProperty('--tilt-x', `${(-y * 5).toFixed(2)}deg`);
        card.style.setProperty('--tilt-y', `${(x * 6).toFixed(2)}deg`);
        card.classList.add('tilting');
      },
      { passive: true },
    );
    listen(card, 'pointerleave', () => {
      card.classList.remove('tilting');
      card.style.removeProperty('--tilt-x');
      card.style.removeProperty('--tilt-y');
    });
  });

  // Cartão de download do sistema do visitante.
  if (options.platform) {
    const card = document.querySelector<HTMLElement>(
      `.dl-card[data-platform="${options.platform}"]`,
    );
    const os = card?.querySelector('.os');
    if (card && os) {
      card.classList.add('recommended');
      const badge = document.createElement('span');
      badge.className = 'dl-badge';
      badge.textContent = 'seu sistema';
      os.append(badge);
    }
  }

  return {
    destroy() {
      sequence.disconnect();
      progress.remove();
      top.remove();
    },
  };
}
