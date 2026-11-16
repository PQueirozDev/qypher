import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FileDown,
  RotateCcw,
  Sparkles,
  Square,
} from 'lucide-react';
import { copyText, sanitizeTechnicalText, type FixIssue } from '../aiPrompt';
import { confidenceLabel, findingKind, kindLabel, scanCoverage, usableScore } from '../assessment';
import { api, native } from '../api';
import { severityLabel, type Finding, type ScanConfig, type Severity } from '../types';
import type { Workspace } from '../useWorkspace';
import { AiFixStudio } from './AiFixStudio';
import { CodeAtmosphere } from './CodeAtmosphere';
import { CodeView } from './CodeView';

const severityOrder: Severity[] = ['high', 'medium', 'low', 'info', 'unrated'];
const filterable: Severity[] = ['high', 'medium', 'low', 'info'];

export function normalizeTarget(input: string): URL {
  const text = input.trim();
  if (!text) throw new Error('Informe o endereço do seu projeto.');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text))
    throw new Error('Use um link HTTP ou HTTPS.');
  const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use um link HTTP ou HTTPS.');
  if (url.username || url.password) throw new Error('Não inclua credenciais na URL.');
  url.search = '';
  url.hash = '';
  return url;
}

function gradeText(grade: string) {
  return (
    {
      A: 'Índice sem alertas relevantes',
      B: 'Índice com pontos a revisar',
      C: 'Atenção',
      D: 'Revisão prioritária',
      F: 'Múltiplos alertas',
    }[grade] ?? 'Sem nota'
  );
}
function gradeFor(score: number | null): string {
  if (score === null) return 'none';
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function issues(findings: Finding[]): FixIssue[] {
  return findings.map((f) => ({
    id: f.id,
    ruleId: f.detectorId,
    title: f.title,
    severity: f.severity,
    confidence: f.confidence,
    classification: f.classification,
    location: f.location,
    evidence: f.evidence,
    impact: f.impact,
    recommendation: f.recommendation,
    references: [...f.references, f.cwe ?? '', f.owasp ?? ''].filter(Boolean),
    verification: f.verification,
  }));
}

function GradeRing({ score, grade }: { score: number; grade: string }) {
  const r = 33;
  const c = 2 * Math.PI * r;
  return (
    <div className={`t-grade t-grade-${grade}`}>
      <svg viewBox="0 0 78 78" width="78" height="78" aria-hidden="true">
        <circle cx="39" cy="39" r={r} className="track" />
        <circle
          cx="39"
          cy="39"
          r={r}
          className="val"
          strokeDasharray={c}
          strokeDashoffset={c - (c * score) / 100}
        />
      </svg>
      <span>{grade === 'none' ? '–' : grade}</span>
    </div>
  );
}

function Leak({ sample }: { sample: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await copyText(sample);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* ignora */
    }
  }
  return (
    <div className="t-leak">
      <div className="t-leak-head">
        <AlertTriangle size={14} />
        <strong>Conteúdo exposto publicamente</strong>
        <button onClick={() => setOpen((v) => !v)}>
          {open ? <EyeOff size={13} /> : <Eye size={13} />}
          {open ? 'ocultar' : 'revelar'}
        </button>
        <button onClick={() => void copy()}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'copiado' : 'copiar'}
        </button>
      </div>
      {open ? (
        <pre>{sample}</pre>
      ) : (
        <p className="t-leak-hidden">
          Qualquer visitante vê este arquivo. A prévia mostra as chaves e um pedaço de cada valor (o
          resto fica oculto) para você confirmar o vazamento e avisar o responsável. Troque
          imediatamente qualquer senha, chave ou token que apareça aqui.
        </p>
      )}
    </div>
  );
}

function FindingCard({ finding, target }: { finding: Finding; target: string }) {
  const clean = sanitizeTechnicalText;
  return (
    <details className="t-finding">
      <summary>
        <span className={`t-sev t-sev-${finding.severity}`}>{severityLabel[finding.severity]}</span>
        <strong>{clean(finding.title)}</strong>
        {finding.sample && <AlertTriangle size={14} className="t-leak-flag" />}
        <ChevronRight size={16} className="chev" />
      </summary>
      <div className="t-body">
        <h4>// o que está errado</h4>
        <p>{clean(finding.description || finding.evidence)}</p>
        <h4>// por que importa</h4>
        <p>{clean(finding.impact)}</p>
        <h4>// como corrigir</h4>
        <p>{clean(finding.recommendation)}</p>
        {finding.sample && <Leak sample={finding.sample} />}
        <h4>// como verificar a correção</h4>
        <p>
          {clean(
            finding.verification ||
              'Repita a verificação no mesmo escopo e confirme a cobertura do detector em um ambiente autorizado.',
          )}
        </p>
        <div className="t-tags">
          <span>{kindLabel[findingKind(finding)]}</span>
          <span>{confidenceLabel(finding.confidence)}</span>
          {[finding.cwe, finding.owasp].filter(Boolean).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        <AiFixStudio context={target} issues={issues([finding])} />
      </div>
    </details>
  );
}

export function Home({
  workspace: w,
  initialTarget = '',
  initialMode = 'quick',
  navigate,
}: {
  workspace: Workspace;
  initialTarget?: string;
  initialMode?: 'quick' | 'deep';
  navigate: (page: string) => void;
}) {
  const [input, setInput] = useState(initialTarget);
  const [deep, setDeep] = useState(initialMode === 'deep');
  const [heroPanel, setHeroPanel] = useState<'scan' | 'policy' | 'runtime'>('scan');
  const [activeChecks, setActiveChecks] = useState(false);
  const [allowPrivate, setAllowPrivate] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [scanId, setScanId] = useState('');
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<Severity | 'all'>('all');
  const logRef = useRef<HTMLDivElement>(null);
  const scan = scanId ? w.scans.find((item) => item.id === scanId) : undefined;
  const running = scan?.status === 'running';

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [scan?.logs.length, scan?.requestCount]);

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!authorized) {
      w.setError('Confirme sua autorização para este alvo.');
      return;
    }
    setStarting(true);
    setMessage('');
    w.setError('');
    setFilter('all');
    try {
      const target = normalizeTarget(input);
      let project = w.projects.find((item) => {
        try {
          return new URL(item.url).origin === target.origin;
        } catch {
          return false;
        }
      });
      if (!project) {
        project = await api.createProject(target.hostname.slice(0, 80), `${target.origin}/`);
        await w.refresh();
      }
      const config: ScanConfig = {
        projectId: project.id,
        url: `${target.origin}${target.pathname}`,
        authorized: true,
        allowPrivate,
        pathPrefix: target.pathname,
        maxRequests: deep ? 60 : 3,
        maxRedirects: 5,
        timeoutSeconds: 10,
        discovery: deep,
        activeChecks: deep && activeChecks,
      };
      setScanId(await api.startScan(config));
    } catch (error) {
      w.setError(String(error).replace(/^(TypeError|Error): /, ''));
    } finally {
      setStarting(false);
      setAuthorized(false);
    }
  }
  async function cancel() {
    if (scan)
      try {
        await api.cancelScan(scan.id);
      } catch (error) {
        w.setError(String(error));
      }
  }
  async function save(format: string) {
    if (scan)
      try {
        const path = await api.export(scan.id, format, true);
        setMessage(path ? `relatório salvo em ${path}` : 'exportação cancelada.');
      } catch (error) {
        w.setError(String(error));
      }
  }
  function reset() {
    setScanId('');
    setInput('');
    setMessage('');
    setAuthorized(false);
    setFilter('all');
  }
  // Reaproveita o endereço de um redirecionamento fora do escopo, exigindo nova autorização.
  function analyzeRedirect(url: string) {
    setScanId('');
    setMessage('');
    setAuthorized(false);
    setFilter('all');
    setInput(url);
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  const findings = scan
    ? [...scan.findings].sort(
        (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
      )
    : [];
  const visible = filter === 'all' ? findings : findings.filter((f) => f.severity === filter);
  const count = (s: Severity) => findings.filter((f) => f.severity === s).length;
  const coverage = scan ? scanCoverage(scan) : null;
  const score = scan ? usableScore(scan) : null;
  // Redirecionamento para outra origem: oferece reanalisar o endereço real.
  const redirectTarget = !running
    ? /redireciona para (https?:\/\/[^\s]+?)(?:[.,;]|\s|$)/.exec(scan?.error ?? '')?.[1]
    : undefined;
  const progress = scan ? Math.min(scan.requestCount / Math.max(scan.config.maxRequests, 1), 1) : 0;
  const step = scan?.logs.at(-1)?.message || 'Aguardando evento real do motor.';
  const blockedReason = !native
    ? 'Abra o desktop para conectar o motor real. As ferramentas locais funcionam nesta prévia.'
    : !w.ready
      ? 'Aguardando conexão com o motor local.'
      : w.busy
        ? 'Aguarde ou interrompa a análise ativa.'
        : !input.trim()
          ? 'Informe a URL do seu projeto.'
          : !authorized
            ? 'Confirme sua autorização para este escopo.'
            : '';
  let configuredScope = 'Aguardando URL válida';
  try {
    const target = normalizeTarget(input);
    configuredScope = `${target.origin}${target.pathname}`;
  } catch {
    /* No incomplete input is sent to the engine. */
  }

  return (
    <div className="t-wrap">
      {!scan && (
        <section className="t-hero">
          <div className="t-hero-inner">
            <div className="hero-copy">
              <div className="hero-window-title">
                <span>qypher@local</span>
                <span>~/security-workspace</span>
                <span className="hero-session-dot" />
              </div>
              <span className="t-tag">
                <Sparkles size={12} /> análise autorizada · sem telemetria
              </span>
              <h1>
                Você cria com IA.
                <br />
                <span className="b">Proteja o que constrói.</span>
              </h1>
              <p>
                Você cria com IA. O Qypher ajuda a proteger. Revise configurações observadas,
                evidências sanitizadas e caminhos de correção no seu próprio projeto.
              </p>
              <div className="hero-tabs" role="tablist" aria-label="Painéis da análise">
                {(
                  [
                    ['scan', 'executar'],
                    ['policy', 'scope.json'],
                    ['runtime', 'runtime'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    id={`hero-tab-${id}`}
                    role="tab"
                    aria-selected={heroPanel === id}
                    aria-controls={`hero-panel-${id}`}
                    onClick={() => setHeroPanel(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div
                role="tabpanel"
                id="hero-panel-scan"
                aria-labelledby="hero-tab-scan"
                hidden={heroPanel !== 'scan'}
              >
                <form onSubmit={start}>
                  <div className="t-prompt">
                    <span className="sign">❯</span>
                    <input
                      aria-label="Link do site"
                      value={input}
                      onChange={(event) => {
                        setInput(event.target.value);
                        setAuthorized(false);
                      }}
                      placeholder="seuprojeto.com.br"
                      spellCheck={false}
                      autoFocus
                    />
                    <button
                      className="t-run"
                      aria-label="Analisar"
                      title={blockedReason || 'Executar análise no escopo autorizado'}
                      aria-describedby="scan-prerequisites"
                      disabled={
                        !native || !w.ready || !authorized || starting || w.busy || !input.trim()
                      }
                    >
                      {starting ? 'iniciando…' : 'analisar'}
                      <ChevronRight size={15} />
                    </button>
                  </div>
                  <div className="t-opts">
                    <label className="t-opt">
                      Modo de análise
                      <select
                        value={deep ? 'deep' : 'quick'}
                        onChange={(event) => {
                          setDeep(event.target.value === 'deep');
                          setActiveChecks(false);
                          setAuthorized(false);
                        }}
                      >
                        <option value="quick">Quick Scan · configurações públicas</option>
                        <option value="deep">Deep Scan · descoberta autorizada</option>
                      </select>
                    </label>
                    {deep && (
                      <label className="t-opt scope-permission">
                        <input
                          type="checkbox"
                          aria-label="Autorizo sondagens ativas não destrutivas de CORS e métodos neste escopo."
                          checked={activeChecks}
                          onChange={(event) => {
                            setActiveChecks(event.target.checked);
                            setAuthorized(false);
                          }}
                        />
                        <span className="permission-copy">
                          <strong>Sondagens ativas</strong>
                          <span>
                            Autorizo testes não destrutivos de CORS e métodos neste escopo.
                          </span>
                        </span>
                        <span className="permission-tag" aria-hidden="true">
                          opcional
                        </span>
                      </label>
                    )}
                    <label className="t-opt scope-permission">
                      <input
                        type="checkbox"
                        aria-label="Permito acesso a localhost e rede privada neste escopo."
                        checked={allowPrivate}
                        onChange={(event) => {
                          setAllowPrivate(event.target.checked);
                          setAuthorized(false);
                        }}
                      />
                      <span className="permission-copy">
                        <strong>Ambiente local</strong>
                        <span>Permito acesso a localhost e rede privada neste escopo.</span>
                      </span>
                      <span className="permission-tag" aria-hidden="true">
                        opcional
                      </span>
                    </label>
                  </div>
                  <label className="t-consent scope-permission">
                    <input
                      type="checkbox"
                      aria-label="O site é meu ou tenho autorização explícita para o alvo, caminho e testes selecionados."
                      checked={authorized}
                      onChange={(event) => setAuthorized(event.target.checked)}
                    />
                    <span className="permission-copy">
                      <strong>Autorização de análise</strong>
                      <span>
                        O site é meu ou tenho autorização explícita para o alvo, caminho e testes
                        selecionados.
                      </span>
                    </span>
                    <span className="permission-tag" aria-hidden="true">
                      obrigatório
                    </span>
                  </label>
                </form>
                <p className="scan-prerequisites" id="scan-prerequisites">
                  {blockedReason ||
                    'Pronto para analisar. Somente os módulos autorizados serão executados.'}
                </p>
                {!native && (
                  <p className="t-hint">Abra o aplicativo desktop para executar a análise.</p>
                )}
              </div>
              <div
                role="tabpanel"
                id="hero-panel-policy"
                aria-labelledby="hero-tab-policy"
                hidden={heroPanel !== 'policy'}
              >
                <CodeView
                  label="scope.policy.json"
                  value={{
                    scope: configuredScope,
                    mode: deep ? 'deep' : 'quick',
                    requestBudget: deep ? 60 : 3,
                    activeChecks: deep && activeChecks,
                    privateNetwork: allowPrivate,
                    authorization: authorized,
                    automaticCrossOrigin: false,
                  }}
                />
                <p>
                  Configuração selecionada antes da execução. Isso não representa uma análise
                  realizada.
                </p>
              </div>
              <div
                role="tabpanel"
                id="hero-panel-runtime"
                aria-labelledby="hero-tab-runtime"
                hidden={heroPanel !== 'runtime'}
              >
                <CodeView
                  label="runtime.local.json"
                  value={{
                    surface: native ? 'desktop' : 'browser',
                    engine: native && w.ready ? 'connected' : 'unavailable',
                    savedProjects: native && w.ready ? w.projects.length : null,
                    activeExecution: native && w.ready ? w.busy : null,
                    localTools: 'available',
                    externalModels: false,
                  }}
                />
                <p>
                  Estado real desta sessão. Nenhuma vulnerabilidade ou evento de scan é simulado.
                </p>
              </div>
            </div>
            <CodeAtmosphere scene={deep ? 'orbit' : 'shield'} />
          </div>
        </section>
      )}

      {!scan && (
        <section className="workflows" aria-label="Fluxos de segurança">
          <button onClick={() => navigate('new')}>
            <span className="workflow-index">01 /</span>
            <span>
              <strong>auditoria HTTP</strong>
              <small>Escopo, limites e verificações públicas.</small>
            </span>
            <ChevronRight size={15} />
          </button>
          <button onClick={() => navigate('source')}>
            <span className="workflow-index">02 /</span>
            <span>
              <strong>code & leak hunter</strong>
              <small>Código, segredos e dependências locais.</small>
            </span>
            <ChevronRight size={15} />
          </button>
          <button onClick={() => navigate('lab')}>
            <span className="workflow-index">03 /</span>
            <span>
              <strong>laboratório</strong>
              <small>Contas de teste. Evidências reproduzíveis.</small>
            </span>
            <ChevronRight size={15} />
          </button>
        </section>
      )}

      {scan && running && (
        <section className="t-window t-run-log">
          <div className="t-window-bar">
            <div className="t-dots">
              <i />
              <i />
              <i />
            </div>
            qypher — analisando {sanitizeTechnicalText(scan.config.url)}
          </div>
          <div className="t-window-body" ref={logRef}>
            <div className="t-line">
              <span className="pfx">❯</span>
              <span>
                qypher scan {deep ? '--deep ' : ''}
                {sanitizeTechnicalText(scan.config.url)}
              </span>
            </div>
            {scan.logs.slice(-40).map((log, i) => (
              <div className="t-line" key={i}>
                <span className="pfx dim">{log.at.slice(11, 19)}</span>
                <span
                  className={log.level === 'warn' ? 't-warn' : log.level === 'error' ? 't-bad' : ''}
                >
                  {sanitizeTechnicalText(log.message)}
                </span>
              </div>
            ))}
            <div className="t-line">
              <span className="pfx">❯</span>
              <span className="t-muted">{step}</span>
              <span className="t-caret" />
            </div>
          </div>
          <div style={{ padding: '0 18px 16px' }}>
            <div className="t-progress">
              <i style={{ width: `${Math.max(progress * 100, 6)}%` }} />
            </div>
            <button
              className="t-btn danger"
              style={{ marginTop: 14 }}
              onClick={() => void cancel()}
            >
              <Square size={12} /> interromper
            </button>
          </div>
        </section>
      )}

      {scan && !running && (
        <>
          <section className="t-summary">
            <GradeRing score={score ?? 0} grade={gradeFor(score)} />
            <div className="t-summary-text">
              <strong>
                {score !== null
                  ? `${gradeText(gradeFor(score))} · ${score}/100`
                  : 'Análise incompleta'}
              </strong>
              <span>{sanitizeTechnicalText(scan.error ?? scan.config.url)}</span>
              <span>
                {coverage?.executed} verificações · {coverage?.notRun} não executadas ·{' '}
                {coverage?.errors} erros
              </span>
            </div>
            {redirectTarget ? (
              <button className="t-btn" onClick={() => analyzeRedirect(redirectTarget)}>
                <ArrowRight size={13} /> analisar esse endereço
              </button>
            ) : (
              <button className="t-btn" onClick={reset}>
                <RotateCcw size={13} /> nova análise
              </button>
            )}
          </section>
          {redirectTarget && (
            <p className="t-foot">
              O site redireciona para outra origem. Por segurança, o Qypher não a segue
              automaticamente. Clique acima para preencher o endereço e confirme a autorização.
            </p>
          )}

          {findings.length > 0 && (
            <>
              <div className="t-filters">
                <button
                  className={filter === 'all' ? 'active' : ''}
                  onClick={() => setFilter('all')}
                >
                  tudo <b>{findings.length}</b>
                </button>
                {filterable.map((s) =>
                  count(s) ? (
                    <button
                      key={s}
                      className={`t-chip-${s} ${filter === s ? 'active' : ''}`}
                      onClick={() => setFilter(filter === s ? 'all' : s)}
                    >
                      {severityLabel[s]} <b>{count(s)}</b>
                    </button>
                  ) : null,
                )}
              </div>

              <section className="t-ai">
                <div>
                  <Sparkles size={18} />
                  <div className="txt">
                    <strong>corrigir com IA</strong>
                    <span>Gere um prompt com as fraquezas e cole no seu assistente.</span>
                  </div>
                </div>
                <AiFixStudio context={scan.config.url} issues={issues(findings)} />
              </section>

              <section className="t-list">
                {visible.map((finding) => (
                  <FindingCard key={finding.id} finding={finding} target={scan.config.url} />
                ))}
              </section>
            </>
          )}

          {!findings.length && (
            <section className="t-empty">
              <Check size={20} />
              <span>Nenhuma fraqueza encontrada nas verificações executadas.</span>
            </section>
          )}

          <div className="t-actions">
            <div className="t-actions-group">
              <span>exportar (redigido):</span>
              {['pdf', 'html', 'json'].map((format) => (
                <button key={format} className="t-btn" onClick={() => void save(format)}>
                  <FileDown size={13} /> {format.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {message && (
            <p className="t-foot" role="status">
              {message}
            </p>
          )}
          <p className="t-foot">
            O índice resume apenas as verificações realizadas. Não é garantia de segurança nem
            substitui um teste de invasão manual.
          </p>
        </>
      )}
    </div>
  );
}
