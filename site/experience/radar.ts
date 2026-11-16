import { findings, crossesAngle, markerPosition, type Finding } from './demo.ts';
import { element, play, type MotionContext } from './dom.ts';

export function createRadar(
  context: MotionContext,
  onDetect: (finding: Finding, time: number) => void,
) {
  const abort = new AbortController();
  const { signal } = abort;
  const scene = element('.radar-scene');
  const plane = element('.radar-parallax');
  const circle = element('.radar');
  const panel = element('#radar-panel');
  const auto = element<HTMLButtonElement>('#radar-auto');
  const close = element<HTMLButtonElement>('#radar-close');
  const mode = element('#radar-mode');
  const markers = findings.map((finding) =>
    element<HTMLButtonElement>(`.blip[data-finding="${finding.id}"]`),
  );
  let current = findings[0];
  let latest = findings[0];
  let pinned: Finding | null = null;
  let hovered: Finding | null = null;
  let focused: Finding | null = null;
  let panelHovered = false;
  let holdUntil = 0;
  let now = 0;
  let scan = 0;
  let detections = 0;
  let transition: Animation | null = null;
  const pulses = new Map<HTMLButtonElement, number>();

  function show(finding: Finding) {
    if (finding.id !== current.id && context.moving()) {
      transition?.cancel();
      transition = play(
        element('.hud-content', panel),
        [
          { opacity: 0.15, transform: 'translateY(5px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 480, easing: 'ease-out' },
        context,
      );
    }
    current = finding;
    panel.dataset.finding = finding.id;
    panel.dataset.severity = finding.id;
    element('#hud-code').textContent = finding.code;
    element('#hud-category').textContent = finding.category;
    element('#hud-title').textContent = finding.title;
    element('#hud-detail').textContent = finding.detail;
    element('#hud-description').textContent = finding.description;
    element('#hud-severity').textContent = finding.severity;
    element('#hud-state').textContent = finding.state;
    panel.dataset.mode = pinned
      ? 'pinned'
      : hovered || focused || panelHovered
        ? 'preview'
        : 'auto';
    mode.textContent = pinned
      ? 'PAINEL FIXADO'
      : hovered || focused || panelHovered
        ? 'LEITURA DO MARCADOR'
        : 'VARREDURA AUTOMÁTICA';
    auto.textContent = pinned ? 'Voltar ao automático' : 'Fixar este painel';
    close.hidden = !pinned;
    markers.forEach((marker) => {
      marker.setAttribute('aria-pressed', String(marker.dataset.finding === pinned?.id));
      marker.classList.toggle('selected', marker.dataset.finding === finding.id);
    });
  }
  function release(restoreFocus = false) {
    const selected = pinned?.id;
    pinned = null;
    hovered = null;
    focused = null;
    holdUntil = 0;
    show(latest);
    if (restoreFocus && selected)
      markers.find((marker) => marker.dataset.finding === selected)?.focus();
  }
  findings.forEach((finding, index) => {
    const marker = markers[index];
    marker.addEventListener(
      'pointerenter',
      (event) => {
        if (event.pointerType !== 'mouse' || !matchMedia('(hover: hover)').matches) return;
        marker.removeAttribute('data-tooltip-dismissed');
        hovered = finding;
        if (!pinned) show(finding);
      },
      { signal },
    );
    marker.addEventListener(
      'pointerleave',
      () => {
        hovered = null;
        holdUntil = now + 900;
      },
      { signal },
    );
    marker.addEventListener(
      'focus',
      () => {
        marker.removeAttribute('data-tooltip-dismissed');
        focused = finding;
        if (!pinned) show(finding);
      },
      { signal },
    );
    marker.addEventListener(
      'blur',
      () => {
        focused = null;
        holdUntil = now + 900;
      },
      { signal },
    );
    marker.addEventListener(
      'click',
      () => {
        if (pinned?.id === finding.id) release();
        else {
          pinned = finding;
          show(finding);
        }
      },
      { signal },
    );
  });
  panel.addEventListener(
    'pointerenter',
    (event) => {
      if (event.pointerType === 'mouse') panelHovered = true;
    },
    { signal },
  );
  panel.addEventListener(
    'pointerleave',
    () => {
      panelHovered = false;
      holdUntil = now + 500;
    },
    { signal },
  );
  auto.addEventListener(
    'click',
    () => {
      if (pinned) release();
      else {
        pinned = current;
        show(current);
      }
    },
    { signal },
  );
  close.addEventListener('click', () => release(true), { signal });
  scene.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        markers.forEach((marker) => marker.setAttribute('data-tooltip-dismissed', ''));
        panelHovered = false;
        release(document.activeElement === close);
      }
    },
    { signal },
  );

  function resize() {
    findings.forEach((finding, index) => {
      const position = markerPosition(finding.angle, finding.radius, circle.offsetWidth);
      markers[index].style.left = `${plane.clientWidth / 2 + position.x}px`;
      markers[index].style.top = `${plane.clientHeight / 2 + position.y}px`;
    });
  }
  const observer = new ResizeObserver(resize);
  observer.observe(plane);
  show(current);
  resize();
  return {
    tick(delta: number, time: number, visible: boolean) {
      now = time;
      if (!visible) return;
      const previous = scan;
      scan += delta * 0.0225;
      scene.style.setProperty('--sweep', `${scan % 360}deg`);
      findings.forEach((finding, index) => {
        const marker = markers[index];
        if (crossesAngle(previous, scan, finding.angle)) {
          latest = finding;
          marker.classList.add('detected');
          pulses.set(marker, time + 1100);
          marker.dataset.detections = String(Number(marker.dataset.detections || 0) + 1);
          detections++;
          scene.dataset.detections = String(detections);
          onDetect(finding, time);
          if (!pinned && !hovered && !focused && !panelHovered && time >= holdUntil) show(finding);
        }
        if (pulses.has(marker) && time >= pulses.get(marker)!) {
          marker.classList.remove('detected');
          pulses.delete(marker);
        }
      });
      if (
        !pinned &&
        !hovered &&
        !focused &&
        !panelHovered &&
        time >= holdUntil &&
        (current !== latest || panel.dataset.mode !== 'auto')
      )
        show(latest);
    },
    settle() {
      transition?.finish();
    },
    destroy() {
      abort.abort();
      observer.disconnect();
      transition?.cancel();
    },
  };
}
