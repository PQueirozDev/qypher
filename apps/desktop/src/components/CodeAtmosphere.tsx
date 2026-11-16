import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Shuffle } from 'lucide-react';
import { asciiFrame, type AsciiScene } from '../ascii';

const GALLERY: { scene: AsciiScene; label: string; fig: string }[] = [
  { scene: 'shield', label: 'cadeado', fig: 'FIG_01 / CADEADO' },
  { scene: 'orbit', label: 'órbita', fig: 'FIG_02 / ÓRBITA' },
  { scene: 'globe', label: 'globo', fig: 'FIG_03 / GLOBO' },
  { scene: 'cube', label: 'cubo', fig: 'FIG_04 / CUBO' },
  { scene: 'wave', label: 'onda', fig: 'FIG_05 / ONDA' },
];

/** Geometria local e decorativa. O modo de análise define a arte inicial (cadeado/órbita);
 *  o botão de galeria percorre todas as artes. Nunca usa dados do alvo. */
export function CodeAtmosphere({ scene }: { scene: AsciiScene }) {
  const frame = useRef<HTMLPreElement>(null);
  const clock = useRef(0);
  const [paused, setPaused] = useState(false);
  // Guarda o modo-base junto da escolha: ao trocar o modo, a escolha é descartada.
  const [pick, setPick] = useState<{ base: AsciiScene; scene: AsciiScene } | null>(null);
  const active = pick && pick.base === scene ? pick.scene : scene;
  const meta = GALLERY.find((g) => g.scene === active) ?? GALLERY[0];
  function nextScene() {
    const index = GALLERY.findIndex((g) => g.scene === active);
    setPick({ base: scene, scene: GALLERY[(index + 1) % GALLERY.length].scene });
  }
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    function render() {
      if (element) element.textContent = asciiFrame(clock.current, active);
    }
    function update() {
      clearInterval(timer);
      timer = undefined;
      render();
      if (
        !paused &&
        visible &&
        !document.hidden &&
        !preference.matches &&
        document.documentElement.dataset.motion !== 'off'
      ) {
        timer = setInterval(() => {
          clock.current += 0.085;
          render();
        }, 85);
      }
    }
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    intersection.observe(element);
    const settings = new MutationObserver(update);
    settings.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    });
    preference.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      clearInterval(timer);
      intersection.disconnect();
      settings.disconnect();
      preference.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [active, paused]);
  return (
    <aside className="code-atmosphere" aria-label="Arte ASCII do Qypher">
      <div className="atmosphere-title">
        <span>
          <i /> QYPHER / ASCII ENGINE
        </span>
        <span>render local</span>
      </div>
      <div className="ascii-stage" aria-hidden="true">
        <span className="ascii-coordinate">{meta.fig}</span>
        <pre ref={frame} className="ascii-art">
          {asciiFrame(0, active)}
        </pre>
        <span className="ascii-axis">
          + x <span>y +</span>
        </span>
      </div>
      <div className="ascii-controls">
        <button className="ascii-gallery" onClick={nextScene} aria-label="Próxima arte ASCII">
          <Shuffle size={12} /> {meta.label}
        </button>
        <button
          className="ascii-play"
          aria-label={paused ? 'Retomar arte ASCII' : 'Pausar arte ASCII'}
          aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
        </button>
      </div>
      <div className="atmosphere-footer">
        <span>ARTE GENERATIVA · SEM DADOS DO ALVO</span>
        <span className="atmosphere-cursor" />
      </div>
    </aside>
  );
}
