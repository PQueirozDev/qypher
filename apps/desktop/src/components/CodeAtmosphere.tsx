import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { asciiFrame, type AsciiScene } from '../ascii';

/** Geometria local e decorativa, guiada pelo modo de análise. Nunca usa dados do alvo.
 *  Quick Scan mostra um cadeado; a varredura profunda mostra uma órbita. */
export function CodeAtmosphere({ scene }: { scene: AsciiScene }) {
  const frame = useRef<HTMLPreElement>(null);
  const clock = useRef(0);
  const [paused, setPaused] = useState(false);
  const padlock = scene === 'shield';
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    function render() {
      if (element) element.textContent = asciiFrame(clock.current, scene);
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
  }, [scene, paused]);
  return (
    <aside className="code-atmosphere" aria-label="Arte ASCII do Qypher">
      <div className="atmosphere-title">
        <span>
          <i /> QYPHER / ASCII ENGINE
        </span>
        <span>render local</span>
      </div>
      <div className="ascii-stage" aria-hidden="true">
        <span className="ascii-coordinate">{padlock ? 'FIG_01 / CADEADO' : 'FIG_02 / ÓRBITA'}</span>
        <pre ref={frame} className="ascii-art">
          {asciiFrame(0, scene)}
        </pre>
        <span className="ascii-axis">
          + x <span>y +</span>
        </span>
      </div>
      <div className="ascii-controls">
        <div className="ascii-mode" aria-live="polite">
          {padlock ? 'quick scan · cadeado' : 'varredura profunda · órbita'}
        </div>
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
