import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  FileDown,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
} from 'lucide-react';
import { copyText, safeLocation, sanitizeTechnicalText, type FixIssue } from '../aiPrompt';
import { confidenceLabel, findingKind, kindLabel } from '../assessment';
import { severityLabel, type Finding, type Scan, type Severity } from '../types';
import { AiFixStudio } from './AiFixStudio';

// Telas de execução e resultado da análise rápida (página "analisar").
// Toda informação exibida vem do motor; animações são só apresentação.

export const severityOrder: Severity[] = ['high', 'medium', 'low', 'info', 'unrated'];

function prefersStill() {
  return (
    typeof window !== 'undefined' &&
    (document.documentElement.dataset.motion === 'off' ||
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches &&
        document.documentElement.dataset.motion !== 'on'))
  );
}

/** Conta de 0 até `target` com desaceleração; instantâneo sem movimento. */
export function useCountUp(target: number, duration = 1100) {
  const [value, setValue] = useState(0);
  const still = prefersStill();
  useEffect(() => {
    if (still) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, still]);
  return still ? target : value;
}

export function gradeFor(score: number | null): string {
  if (score === null) return 'none';
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}
const gradeText: Record<string, string> = {
  A: 'Índice sem alertas relevantes',
  B: 'Índice com pontos a revisar',
  C: 'Atenção',
  D: 'Revisão prioritária',
  F: 'Múltiplos alertas',
  none: 'Análise incompleta',
};

function ScoreGauge({ score }: { score: number | null }) {
  const shown = useCountUp(score ?? 0);
  const grade = gradeFor(score);
  const radius = 52;
  const length = 2 * Math.PI * radius;
  return (
    <div
      className={`rs-gauge grade-${grade}`}
      role="img"
      aria-label={
        score === null
          ? 'Índice indisponível: execução parcial ou inconclusiva'
          : `Índice ${score} de 100, nota ${grade}`
      }
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="rs-gauge-track" cx="60" cy="60" r={radius} />
        {score !== null && (
          <circle
            className="rs-gauge-value"
            cx="60"
            cy="60"
            r={radius}
            strokeDasharray={length}
            style={{ '--rs-offset': length * (1 - score / 100) } as CSSProperties}
          />
        )}
      </svg>
      <div className="rs-gauge-text" aria-hidden="true">
        <strong>{score === null ? '—' : shown}</strong>
        <span>{score === null ? 'sem índice' : `nota ${grade}`}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const shown = useCountUp(value, 900);
  return (
    <div className="rs-stat">
      <dt>{label}</dt>
      <dd>
        <strong>{shown}</strong>
        {hint && <span>{hint}</span>}
      </dd>
    </div>
  );
}

export function ResultSummary({
  scan,
  score,
  coverage,
  findings,
  filter,
  onFilter,
  action,
}: {
  scan: Scan;
  score: number | null;
  coverage: { executed: number; notRun: number; errors: number } | null;
  findings: Finding[];
  filter: Severity | 'all';
  onFilter: (value: Severity | 'all') => void;
  action: ReactNode;
}) {
  const grade = gradeFor(score);
  const counts = severityOrder
    .map((value) => ({ value, n: findings.filter((f) => f.severity === value).length }))
    .filter((item) => item.n > 0);
  return (
    <section className={`rs-summary grade-${grade}`} aria-label="Resumo da análise">
      <ScoreGauge score={score} />
      <div className="rs-summary-main">
        <div className="rs-summary-head">
          <span className="rs-kicker">
            {scan.status === 'completed' ? 'análise concluída' : 'análise interrompida'}
          </span>
          <h2>{score !== null ? gradeText[grade] : gradeText.none}</h2>
          <code title={safeLocation(scan.config.url)}>{safeLocation(scan.config.url)}</code>
          {scan.error && <p className="rs-error">{sanitizeTechnicalText(scan.error)}</p>}
        </div>
        {findings.length > 0 ? (
          <div className="rs-distribution">
            <div className="rs-bar" aria-hidden="true">
              {counts.map(({ value, n }, i) => (
                <i
                  key={value}
                  className={`sev-${value}`}
                  style={{ flexGrow: n, animationDelay: `${300 + i * 90}ms` }}
                  data-dim={filter !== 'all' && filter !== value ? '' : undefined}
                />
              ))}
            </div>
            <div className="rs-chips" role="group" aria-label="Filtrar achados por severidade">
              <button
                className={filter === 'all' ? 'active' : ''}
                aria-pressed={filter === 'all'}
                onClick={() => onFilter('all')}
              >
                tudo <b>{findings.length}</b>
              </button>
              {counts.map(({ value, n }) => (
                <button
                  key={value}
                  className={`sev-${value} ${filter === value ? 'active' : ''}`}
                  aria-pressed={filter === value}
                  onClick={() => onFilter(filter === value ? 'all' : value)}
                >
                  <i aria-hidden="true" />
                  {severityLabel[value]} <b>{n}</b>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="rs-summary-side">
        <dl className="rs-stats">
          <Stat
            label="requisições"
            value={scan.requestCount}
            hint={`de ${scan.config.maxRequests}`}
          />
          <Stat label="verificações" value={coverage?.executed ?? 0} hint="executadas" />
        </dl>
        <p className="rs-coverage">
          {coverage?.notRun ?? 0} não executadas · {coverage?.errors ?? 0} erros
        </p>
        {action}
      </div>
    </section>
  );
}

function Evidence({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rs-evidence">
      <pre>{text}</pre>
      <button
        type="button"
        aria-label="Copiar evidência técnica"
        onClick={() =>
          void copyText(text).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            },
            () => undefined,
          )
        }
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span>{copied ? 'copiado' : 'copiar'}</span>
      </button>
    </div>
  );
}

function Leak({ sample }: { sample: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rs-leak">
      <div className="rs-leak-head">
        <AlertTriangle size={15} />
        <strong>Conteúdo exposto publicamente</strong>
        <button type="button" onClick={() => setOpen((v) => !v)}>
          {open ? <EyeOff size={13} /> : <Eye size={13} />}
          {open ? 'ocultar' : 'revelar'}
        </button>
        <button
          type="button"
          onClick={() =>
            void copyText(sample).then(
              () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2200);
              },
              () => undefined,
            )
          }
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'copiado' : 'copiar'}
        </button>
      </div>
      {open ? (
        <pre>{sample}</pre>
      ) : (
        <p>
          Qualquer visitante vê este arquivo. A prévia mostra as chaves e um pedaço de cada valor (o
          resto fica oculto) para você confirmar o vazamento e avisar o responsável. Troque
          imediatamente qualquer senha, chave ou token que apareça aqui.
        </p>
      )}
    </div>
  );
}

export function FindingRow({
  finding,
  index,
  target,
  issues,
}: {
  finding: Finding;
  index: number;
  target: string;
  issues: (findings: Finding[]) => FixIssue[];
}) {
  const [open, setOpen] = useState(false);
  const [fix, setFix] = useState(false);
  const id = useId();
  const clean = sanitizeTechnicalText;
  const steps: [string, ReactNode][] = [
    ['O que está errado', <p key="w">{clean(finding.description || finding.title)}</p>],
    ['Evidência', <Evidence key="e" text={clean(finding.evidence)} />],
    ['Por que importa', <p key="i">{clean(finding.impact)}</p>],
    [
      'Como corrigir',
      <p key="r" className="rs-fix-text">
        {clean(finding.recommendation)}
      </p>,
    ],
    [
      'Como verificar',
      <p key="v">
        {clean(
          finding.verification ||
            'Repita a verificação no mesmo escopo e confirme a cobertura do detector em um ambiente autorizado.',
        )}
      </p>,
    ],
  ];
  return (
    <article
      className={`rs-finding sev-${finding.severity} ${open ? 'open' : ''}`}
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      <button
        type="button"
        className="rs-finding-head"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rs-dot" aria-hidden="true" />
        <span className="rs-finding-title">
          <strong>{clean(finding.title)}</strong>
          <span>
            <em className="rs-sev">{severityLabel[finding.severity]}</em>
            <code>{finding.detectorId}</code>
            <code>{clean(safeLocation(finding.location))}</code>
          </span>
        </span>
        {finding.sample && (
          <span className="rs-leak-flag" title="Conteúdo exposto">
            <AlertTriangle size={14} />
          </span>
        )}
        <ChevronDown size={18} className="rs-chev" aria-hidden="true" />
      </button>
      <div className="rs-collapse" id={id} role="region" aria-label={clean(finding.title)}>
        <div className="rs-collapse-inner" inert={!open}>
          <div className="rs-finding-body">
            <ol className="rs-steps">
              {steps.map(([title, body], i) => (
                <li key={title} style={{ '--i': i } as CSSProperties}>
                  <span className="rs-step-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <h4>{title}</h4>
                    {body}
                  </div>
                </li>
              ))}
            </ol>
            {finding.sample && <Leak sample={finding.sample} />}
            <div className="rs-tags">
              <span>{kindLabel[findingKind(finding)]}</span>
              <span>{confidenceLabel(finding.confidence)}</span>
              {[finding.cwe, finding.owasp].filter(Boolean).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            <div className="rs-fix">
              <button type="button" className="rs-fix-toggle" onClick={() => setFix((v) => !v)}>
                <Sparkles size={14} />
                {fix ? 'Fechar prompt de correção' : 'Gerar prompt de correção com IA'}
              </button>
              {fix && <AiFixStudio context={target} issues={issues([finding])} />}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function BulkFix({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className={`rs-bulk ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="rs-bulk-head"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rs-bulk-icon" aria-hidden="true">
          <Sparkles size={16} />
        </span>
        <span>
          <strong>Corrigir com IA</strong>
          <small>
            {count === 1
              ? 'Um prompt com o achado para colar no seu assistente.'
              : `Um prompt com os ${count} achados para colar no seu assistente.`}
          </small>
        </span>
        <ChevronDown size={18} className="rs-chev" aria-hidden="true" />
      </button>
      <div className="rs-collapse" id={id}>
        <div className="rs-collapse-inner" inert={!open}>
          <div className="rs-bulk-body">{children}</div>
        </div>
      </div>
    </section>
  );
}

export function CleanResult() {
  return (
    <section className="rs-clean">
      <span className="rs-clean-icon" aria-hidden="true">
        <ShieldCheck size={26} />
      </span>
      <div>
        <strong>Nenhuma fraqueza nas verificações executadas</strong>
        <p>
          Bom sinal, mas não é garantia: confira a cobertura e rode o Deep Scan para descoberta de
          arquivos e testes ativos autorizados.
        </p>
      </div>
    </section>
  );
}

export function ExportBar({
  onSave,
  message,
}: {
  onSave: (format: string) => void;
  message: string;
}) {
  return (
    <div className="rs-export">
      <span>Exportar relatório redigido</span>
      <div>
        {['pdf', 'html', 'json'].map((format) => (
          <button key={format} type="button" onClick={() => onSave(format)}>
            <FileDown size={14} /> {format.toUpperCase()}
          </button>
        ))}
      </div>
      {message && (
        <p role="status" className="rs-export-msg">
          {message}
        </p>
      )}
    </div>
  );
}

export function SummaryAction({
  redirectTarget,
  onRedirect,
  onReset,
}: {
  redirectTarget?: string;
  onRedirect: (url: string) => void;
  onReset: () => void;
}) {
  return redirectTarget ? (
    <button type="button" className="rs-primary" onClick={() => onRedirect(redirectTarget)}>
      <ArrowRight size={15} /> analisar esse endereço
    </button>
  ) : (
    <button type="button" className="rs-secondary" onClick={onReset}>
      <RotateCcw size={14} /> nova análise
    </button>
  );
}

function useElapsed(startedAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  return Number.isFinite(seconds) ? seconds : 0;
}

export function RunningScan({
  scan,
  deep,
  onCancel,
}: {
  scan: Scan;
  deep: boolean;
  onCancel: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const elapsed = useElapsed(scan.startedAt);
  const progress = Math.min(scan.requestCount / Math.max(scan.config.maxRequests, 1), 1);
  const step = scan.logs.at(-1)?.message || 'Aguardando evento real do motor.';
  // Acompanha o fim do log só se a pessoa já estiver perto dele (não rouba a leitura).
  const follow = useRef(true);
  useEffect(() => {
    const log = logRef.current;
    if (log && follow.current) log.scrollTop = log.scrollHeight;
  }, [scan.logs.length]);
  const hours = Math.floor(elapsed / 3600);
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const clock = hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
  return (
    <section className="rs-running" aria-label="Análise em andamento">
      <div className="rs-running-head">
        <div className="rs-radar" aria-hidden="true">
          <i />
          <i />
          <i />
          <span />
        </div>
        <div className="rs-running-title">
          <span className="rs-kicker">{deep ? 'deep scan' : 'quick scan'} em andamento</span>
          <h2>Analisando {safeLocation(scan.config.url)}</h2>
          <p aria-live="polite">{sanitizeTechnicalText(step)}</p>
        </div>
        <button type="button" className="rs-danger" onClick={onCancel}>
          <Square size={12} /> interromper
        </button>
      </div>
      <div className="rs-progress" aria-hidden="true">
        <i style={{ transform: `scaleX(${Math.max(progress, 0.04)})` }} />
      </div>
      <dl className="rs-running-stats">
        <div>
          <dt>requisições</dt>
          <dd>
            {scan.requestCount}
            <span> / {scan.config.maxRequests}</span>
          </dd>
        </div>
        <div>
          <dt>tempo</dt>
          <dd>{clock}</dd>
        </div>
        <div>
          <dt>eventos</dt>
          <dd>{scan.logs.length}</dd>
        </div>
      </dl>
      <div
        className="rs-log"
        ref={logRef}
        role="log"
        aria-label="Eventos da análise"
        onScroll={(event) => {
          const log = event.currentTarget;
          follow.current = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
        }}
      >
        <div className="rs-log-line cmd">
          <span className="pfx">❯</span>
          <span>
            qypher scan {deep ? '--deep ' : ''}
            {sanitizeTechnicalText(scan.config.url)}
          </span>
        </div>
        {scan.logs.slice(-40).map((log, i) => (
          <div className={`rs-log-line ${log.level}`} key={`${log.at}-${i}`}>
            <time>{log.at.slice(11, 19)}</time>
            <span>{sanitizeTechnicalText(log.message)}</span>
          </div>
        ))}
        <div className="rs-log-line live">
          <span className="pfx">❯</span>
          <span className="rs-caret" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
