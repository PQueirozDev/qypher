import { useEffect, useRef } from 'react';
import { asciiFrame } from '../ascii';

// Camada de transição mostrada ao desbloquear: a órbita ASCII animando,
// como um "conectando ao workspace". Puramente decorativa, sem dados do alvo.
export function UnlockTransition() {
  const frame = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    el.textContent = asciiFrame(0, 'orbit');
    const reduce =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.motion === 'off';
    if (reduce) return;
    let t = 0;
    const id = setInterval(() => {
      t += 0.12;
      if (frame.current) frame.current.textContent = asciiFrame(t, 'orbit');
    }, 70);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="unlock-transition" aria-hidden="true">
      <div className="ut-inner">
        <pre ref={frame} className="ut-orbit" />
        <div className="ut-caption">
          <span className="ut-dot" /> conectando ao workspace
        </div>
        <div className="ut-bar">
          <i />
        </div>
      </div>
    </div>
  );
}
