import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { bootSplashEnabled, motionReduced } from '../appearance';
import { PixelMark } from './PixelLogo';

// Animação de abertura do app. Aparece uma vez por sessão da janela e pode ser
// pulada com clique ou Esc. Com "reduzir movimento" no sistema (por exemplo, o modo
// de melhor desempenho do Windows), toca uma versão calma só com fades.
// Renderizada fora de .t-shell para não ser desligada pelas regras globais de
// movimento do workspace. As linhas de status refletem o estado real; nada é simulado.
const SESSION_KEY = 'qypher.bootShown';
const WORD = 'qypher';

function shouldShow(): boolean {
  if (!bootSplashEnabled()) return false;
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return false;
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* Sem armazenamento de sessão: mostra a abertura normalmente. */
  }
  return true;
}

// Decidido uma única vez ao carregar o módulo (o StrictMode repete inicializadores).
const SHOW_AT_LAUNCH = typeof window !== 'undefined' && shouldShow();

export function BootSplash({ native, ready }: { native: boolean; ready: boolean }) {
  const [visible, setVisible] = useState(SHOW_AT_LAUNCH);
  const [playing, setPlaying] = useState(false);
  const [minimumDone, setMinimumDone] = useState(false);
  const [capped, setCapped] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [calm] = useState(motionReduced);

  // Só anima depois que as fontes carregam (evita troca de fonte no meio), com teto de 400 ms.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    const start = () => active && setPlaying(true);
    const fallback = window.setTimeout(start, 400);
    document.fonts?.ready.then(start, start);
    return () => {
      active = false;
      window.clearTimeout(fallback);
    };
  }, [visible]);

  // Tempo mínimo de exibição, contado a partir do início real da animação.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setMinimumDone(true), 2000);
    return () => window.clearTimeout(timer);
  }, [playing]);

  // Sai quando o tempo mínimo passou e o motor respondeu; nunca segura mais de 1,6 s extra.
  useEffect(() => {
    if (!minimumDone) return;
    const cap = window.setTimeout(() => setCapped(true), 1600);
    return () => window.clearTimeout(cap);
  }, [minimumDone]);
  const leaving = skipped || (minimumDone && (!native || ready || capped));

  useEffect(() => {
    if (!visible) return;
    const skip = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSkipped(true);
    };
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, [visible]);

  // Na saída o workspace entra junto (classe no <html>), e o splash é removido ao final.
  useEffect(() => {
    if (!leaving) return;
    const root = document.documentElement;
    root.dataset.boot = 'reveal';
    const done = window.setTimeout(() => setVisible(false), 640);
    const clear = window.setTimeout(() => delete root.dataset.boot, 900);
    return () => {
      window.clearTimeout(done);
      window.clearTimeout(clear);
    };
  }, [leaving]);

  if (!visible) return null;
  const engine = !native
    ? { label: 'modo navegador', tone: 'muted' }
    : ready
      ? { label: 'conectado', tone: 'ok' }
      : { label: 'conectando', tone: 'wait' };
  const lines = [
    { name: 'interface', value: 'pronta', tone: 'ok' },
    { name: 'motor local', value: engine.label, tone: engine.tone },
    { name: 'telemetria', value: 'desativada', tone: 'ok' },
  ];
  return createPortal(
    <div
      className={`boot-splash${calm ? ' calm' : ''}${playing ? ' playing' : ''}${leaving ? ' leaving' : ''}`}
      aria-hidden="true"
      onClick={() => setSkipped(true)}
    >
      <div className="boot-center">
        <PixelMark className="boot-mark boot-pixel" />
        <div className="boot-word">
          {WORD.split('').map((letter, i) => (
            <span key={i} style={{ animationDelay: `${420 + i * 60}ms` }}>
              {letter}
            </span>
          ))}
        </div>
        <p className="boot-tagline">segurança local para sites e código</p>
        <ul className="boot-lines">
          {lines.map((line, i) => (
            <li key={line.name} style={{ animationDelay: `${900 + i * 160}ms` }}>
              <span>{line.name}</span>
              <i />
              <b className={`tone-${line.tone}`}>{line.value}</b>
            </li>
          ))}
        </ul>
      </div>
      <div className="boot-progress">
        <i />
      </div>
      <div className="boot-scan" />
    </div>,
    document.body,
  );
}
