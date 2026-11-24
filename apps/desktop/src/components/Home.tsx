import { useState, type FormEvent } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { type FixIssue } from '../aiPrompt';
import { scanCoverage, usableScore } from '../assessment';
import { api, native } from '../api';
import { severityLabel, type Finding, type ScanConfig, type Severity } from '../types';
import type { Workspace } from '../useWorkspace';
import { AiFixStudio } from './AiFixStudio';
import {
  BulkFix,
  CleanResult,
  ExportBar,
  FindingRow,
  ResultSummary,
  RunningScan,
  SummaryAction,
  severityOrder,
} from './ScanResult';
import { CodeAtmosphere } from './CodeAtmosphere';
import { CodeView } from './CodeView';

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
  const scan = scanId ? w.scans.find((item) => item.id === scanId) : undefined;
  const running = scan?.status === 'running';

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
  const coverage = scan ? scanCoverage(scan) : null;
  const score = scan ? usableScore(scan) : null;
  // Redirecionamento para outra origem: oferece reanalisar o endereço real.
  const redirectTarget = !running
    ? /redireciona para (https?:\/\/[^\s]+?)(?:[.,;]|\s|$)/.exec(scan?.error ?? '')?.[1]
    : undefined;
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

      {scan && running && <RunningScan scan={scan} deep={deep} onCancel={() => void cancel()} />}

      {scan && !running && (
        <div className="rs-result">
          <ResultSummary
            scan={scan}
            score={score}
            coverage={coverage}
            findings={findings}
            filter={filter}
            onFilter={setFilter}
            action={
              <SummaryAction
                redirectTarget={redirectTarget}
                onRedirect={analyzeRedirect}
                onReset={reset}
              />
            }
          />
          {redirectTarget && (
            <p className="rs-note">
              O site redireciona para outra origem. Por segurança, o Qypher não a segue
              automaticamente. Clique em “analisar esse endereço” para preencher o endereço e
              confirme a autorização.
            </p>
          )}
          {findings.length > 0 ? (
            <>
              <div className="rs-list-head">
                <h3>
                  {visible.length} {visible.length === 1 ? 'achado' : 'achados'}
                  {filter !== 'all' && ` · ${severityLabel[filter]}`}
                </h3>
                <span>Clique em um achado para ver evidência e correção.</span>
              </div>
              <section className="rs-list" key={filter}>
                {visible.map((finding, index) => (
                  <FindingRow
                    key={finding.id}
                    finding={finding}
                    index={index}
                    target={scan.config.url}
                    issues={issues}
                  />
                ))}
              </section>
              <BulkFix count={findings.length}>
                <AiFixStudio context={scan.config.url} issues={issues(findings)} />
              </BulkFix>
            </>
          ) : (
            <CleanResult />
          )}
          <ExportBar onSave={(format) => void save(format)} message={message} />
          <p className="rs-note">
            O índice resume apenas as verificações realizadas. Não é garantia de segurança nem
            substitui um teste de invasão manual.
          </p>
        </div>
      )}
    </div>
  );
}
