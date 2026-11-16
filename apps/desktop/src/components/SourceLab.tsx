import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  FileDown,
  FolderOpen,
  GitBranch,
  Play,
  Search,
  Square,
  Trash2,
  ShieldAlert,
} from 'lucide-react';
import { api, native } from '../api';
import type { Workspace } from '../useWorkspace';
import {
  defaultSourceConfig,
  type SourceConfig,
  type SourceTarget,
  type AntivirusStatus,
  type SourceReportFormat,
  type SourceReview,
} from '../sourceTypes';
import { date } from '../types';
import { PageTitle, Panel, SeverityBadge, StatusBadge, ConfirmDialog } from './ui';
import { CodeView } from './CodeView';
import { AiFixStudio } from './AiFixStudio';
import { SourceReadiness } from './SourceReadiness';
import { sanitizeTechnicalText } from '../aiPrompt';

function Pagination({
  label,
  page,
  pages,
  total,
  onChange,
}: {
  label: string;
  page: number;
  pages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <nav className="source-pagination" aria-label={label}>
      <button
        className="button secondary"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label={`${label}: anterior`}
      >
        Anterior
      </button>
      <span role="status">
        Página {page} de {pages} · {total} itens
      </span>
      <button
        className="button secondary"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
        aria-label={`${label}: próxima`}
      >
        Próxima
      </button>
    </nav>
  );
}

export function SourceLab({ workspace: w }: { workspace: Workspace }) {
  const [target, setTarget] = useState<SourceTarget | null>(null);
  const [config, setConfig] = useState<SourceConfig>({ ...defaultSourceConfig });
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [reviewFilter, setReviewFilter] = useState('open');
  const [reviewState, setReviewState] = useState<{ scanId: string; items: SourceReview[] }>({
    scanId: '',
    items: [],
  });
  const [reviewBusy, setReviewBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [dependencyPage, setDependencyPage] = useState(1);
  const [format, setFormat] = useState<SourceReportFormat>('json');
  const [redactPaths, setRedactPaths] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [antivirus, setAntivirus] = useState<AntivirusStatus | null>(null);
  const [remove, setRemove] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const scan = selected ? w.sourceScans.find((s) => s.id === selected) : w.sourceScans[0];
  const reviews = reviewState.scanId === scan?.id ? reviewState.items : [];
  const reviewed = new Set(reviews.map((review) => review.findingId));
  const currentScanId = scan?.id;
  const { setError } = w;
  useEffect(() => {
    if (!native || !currentScanId) return;
    let disposed = false;
    api
      .sourceReviews(currentScanId)
      .then((items) => {
        if (!disposed) setReviewState({ scanId: currentScanId, items });
      })
      .catch((error) => {
        if (!disposed) setError(String(error));
      });
    return () => {
      disposed = true;
    };
  }, [currentScanId, setError]);
  async function reviewFinding(findingId: string, falsePositive: boolean) {
    if (!scan) return;
    setReviewBusy(true);
    try {
      await api.reviewSource(scan.id, findingId, falsePositive);
      const items = await api.sourceReviews(scan.id);
      setReviewState({ scanId: scan.id, items });
    } catch (error) {
      w.setError(String(error));
    } finally {
      setReviewBusy(false);
    }
  }
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    api
      .antivirusStatus()
      .then((s) => {
        if (!disposed) setAntivirus(s);
      })
      .catch(() => {
        if (!disposed)
          setAntivirus({
            engine: 'ClamAV',
            available: false,
            detail: 'Não foi possível consultar o runtime antivírus.',
          });
      });
    return () => {
      disposed = true;
    };
  }, []);
  function update<K extends keyof SourceConfig>(key: K, value: SourceConfig[K]) {
    setConfig((c) => ({ ...c, [key]: value }));
  }
  async function pick() {
    setBusy(true);
    try {
      const t = await api.pickRepository();
      if (t) {
        setTarget(t);
        setConfig((c) => ({ ...c, authorized: false }));
      }
    } catch (e) {
      w.setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function start(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    try {
      const id = await api.startSource(target.token, config);
      setSelected(id);
      setPage(1);
      setDependencyPage(1);
      setMessage('');
      setConfig((c) => ({ ...c, authorized: false }));
    } catch (e) {
      w.setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (w.activeSource)
      try {
        await api.cancelScan(w.activeSource.id);
      } catch (e) {
        w.setError(String(e));
      }
  }
  async function exportScan() {
    if (!scan || exporting) return;
    setExporting(true);
    setMessage('');
    try {
      const result = await api.exportSource(scan.id, redactPaths, format);
      setMessage(result ? `Artefato salvo em ${result}` : 'Exportação cancelada.');
    } catch (e) {
      w.setError(String(e));
    } finally {
      setExporting(false);
    }
  }
  async function deleteScan() {
    const id = remove;
    setRemove(null);
    if (id)
      try {
        await api.deleteSource(id);
        setSelected('');
        await w.refresh();
      } catch (e) {
        w.setError(String(e));
      }
  }
  const findings = (scan?.findings ?? []).filter(
    (f) =>
      (category === 'all' || f.category === category) &&
      (severity === 'all' || f.severity === severity) &&
      (reviewFilter === 'all' ||
        (reviewFilter === 'false_positive' ? reviewed.has(f.id) : !reviewed.has(f.id))) &&
      `${f.title} ${f.path} ${f.ruleId}`.toLowerCase().includes(search.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(findings.length / 50));
  const currentPage = Math.min(page, pages);
  const dependencyPages = Math.max(1, Math.ceil((scan?.dependencies.length ?? 0) / 100));
  const currentDependencyPage = Math.min(dependencyPage, dependencyPages);
  return (
    <>
      <PageTitle
        tag="CÓDIGO / ANÁLISE SOMENTE LEITURA"
        title="Análise de código"
        description="Código local e cópias de repositórios do GitHub. Sem executar scripts, builds ou hooks do projeto."
      />
      <div className="source-layout">
        <form className="source-config" onSubmit={start}>
          <Panel title="scope.local" meta={<GitBranch size={14} />}>
            <div className="source-scope">
              <button
                type="button"
                className="button secondary wide"
                disabled={!native || !w.ready || busy || w.busy}
                onClick={() => void pick()}
              >
                <FolderOpen size={15} />
                Selecionar repositório local
              </button>
              <div className="source-path">
                <span>{target ? target.name : '// no directory selected'}</span>
                {target && <code>{target.path}</code>}
              </div>
              <small>
                Escolha uma cópia local autorizada. O Qypher não faz clone, checkout ou instalação
                de dependências.
              </small>
            </div>
          </Panel>
          <Panel title="modules.enabled">
            <div className="source-options">
              {[
                {
                  key: 'sast' as const,
                  name: 'Static code triage',
                  description: 'Sinks e configurações inseguras; heurísticas lexicais.',
                },
                {
                  key: 'secrets' as const,
                  name: 'Possible secrets',
                  description: 'Padrões de credenciais e chaves; valores não persistidos.',
                },
                {
                  key: 'suspicious' as const,
                  name: 'Suspicious code',
                  description: 'Ofuscação, download + execução e indicadores de webshell.',
                },
                {
                  key: 'dependencies' as const,
                  name: 'Dependency inventory',
                  description: 'package-lock v2/v3, Cargo.lock e requirements com ==.',
                },
              ].map((m) => (
                <label className="checkbox-label" key={m.key}>
                  <input
                    type="checkbox"
                    checked={config[m.key]}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        [m.key]: e.target.checked,
                        ...(m.key === 'dependencies' && !e.target.checked ? { osv: false } : {}),
                      }))
                    }
                  />
                  <span>
                    <strong>{m.name}</strong>
                    <small>{m.description}</small>
                  </span>
                </label>
              ))}
              <label className="checkbox-label external-module">
                <input
                  type="checkbox"
                  disabled={!config.dependencies}
                  checked={config.osv}
                  onChange={(e) => update('osv', e.target.checked)}
                />
                <span>
                  <strong>
                    OSV advisory lookup <em>REDE</em>
                  </strong>
                  <small>
                    Autorizo enviar apenas nomes, ecossistemas e versões de até 500 pacotes ao OSV.
                    Código e credenciais não são enviados.
                  </small>
                </span>
              </label>
              <label className="checkbox-label external-module">
                <input
                  type="checkbox"
                  checked={config.antivirus}
                  disabled={!antivirus?.available}
                  onChange={(e) => update('antivirus', e.target.checked)}
                />
                <span>
                  <strong>
                    ClamAV signature scan{' '}
                    <em>{antivirus?.available ? 'AVAILABLE' : 'NOT INSTALLED'}</em>
                  </strong>
                  <small>
                    {antivirus?.detail ?? 'Abra o desktop para consultar a instalação do ClamAV.'}
                  </small>
                </span>
              </label>
            </div>
          </Panel>
          <Panel title="limits.conf">
            <div className="source-limits">
              <label>
                Arquivos (1–10.000)
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={config.maxFiles}
                  onChange={(e) => update('maxFiles', Number(e.target.value))}
                  required
                />
              </label>
              <label>
                Máx. arquivo (MiB)
                <input
                  type="number"
                  min={0.01}
                  max={4}
                  step={0.01}
                  value={config.maxFileBytes / 1048576}
                  onChange={(e) =>
                    update('maxFileBytes', Math.round(Number(e.target.value) * 1048576))
                  }
                  required
                />
              </label>
              <label>
                Leitura total (MiB)
                <input
                  type="number"
                  min={1}
                  max={256}
                  value={config.maxTotalBytes / 1048576}
                  onChange={(e) => update('maxTotalBytes', Number(e.target.value) * 1048576)}
                  required
                />
              </label>
              <label>
                Timeout / módulo (s)
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={config.timeoutSeconds}
                  onChange={(e) => update('timeoutSeconds', Number(e.target.value))}
                  required
                />
              </label>
            </div>
          </Panel>
          <div className="source-authorization">
            <label className="checkbox-label">
              <input
                type="checkbox"
                required
                checked={config.authorized}
                onChange={(e) => update('authorized', e.target.checked)}
              />
              <span>Tenho autorização para analisar os arquivos desta cópia local.</span>
            </label>
            <button
              className="button primary wide"
              disabled={!native || !w.ready || !target || !config.authorized || busy || w.busy}
            >
              <Play size={13} />
              {busy ? 'dispatching…' : 'Iniciar análise de código'}
              <ArrowRight size={14} />
            </button>
            {w.activeSource && (
              <button type="button" className="button danger wide" onClick={() => void cancel()}>
                <Square size={12} />
                Cancelar análise ativa
              </button>
            )}
          </div>
        </form>
        <div className="source-results">
          <div className="source-result-header">
            <div>
              <span className="eyebrow">ARTEFATO / AUDITORIA DE CÓDIGO</span>
              <h2>{scan ? scan.rootName : 'Aguardando execução'}</h2>
            </div>
            {scan && <StatusBadge value={scan.status} />}
          </div>
          {scan ? (
            <>
              <label className="source-run-selector">
                Execução salva
                <select
                  value={scan.id}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setPage(1);
                    setDependencyPage(1);
                    setMessage('');
                  }}
                >
                  {w.sourceScans.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.rootName} · {date(s.startedAt)} · {s.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="source-counters">
                <div>
                  <strong>{scan.stats.files}</strong>
                  <span>files read</span>
                </div>
                <div>
                  <strong>{(scan.stats.bytes / 1048576).toFixed(2)}</strong>
                  <span>MiB read</span>
                </div>
                <div>
                  <strong>{scan.findings.length}</strong>
                  <span>findings</span>
                </div>
                <div>
                  <strong>{scan.stats.skipped}</strong>
                  <span>skipped</span>
                </div>
              </div>
              {(scan.error ||
                scan.stats.truncated ||
                scan.stats.errors > 0 ||
                scan.stats.skipped > 0 ||
                scan.stats.binaries > 0) && (
                <div className="notice warning">
                  <ShieldAlert size={15} />
                  <p>
                    {scan.error ??
                      'Cobertura parcial: arquivos ignorados, binários, limite ou erro de leitura. Consulte os módulos e contadores.'}
                  </p>
                </div>
              )}
              <div className="source-modules">
                {scan.modules.map((m) => (
                  <details key={m.id}>
                    <summary>
                      <code>{m.id}</code>
                      <span className={`module-state state-${m.status}`}>{m.status}</span>
                    </summary>
                    <p>{m.detail}</p>
                  </details>
                ))}
              </div>
              <div className="filter-bar">
                <div className="search-input">
                  <Search size={13} />
                  <input
                    aria-label="Pesquisar achados de código"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder="rule, file, finding…"
                  />
                </div>
                <select
                  aria-label="Categoria de código"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All modules</option>
                  {[
                    'sast',
                    'secrets',
                    'suspicious',
                    'dependency',
                    'antivirus',
                    'supabase',
                    'firebase',
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
                <select
                  aria-label="Severidade dos achados de código"
                  value={severity}
                  onChange={(e) => {
                    setSeverity(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">Todas as severidades</option>
                  <option value="high">Alta</option>
                  <option value="medium">Média</option>
                  <option value="low">Baixa</option>
                  <option value="info">Informativa</option>
                  <option value="unrated">Sem classificação</option>
                </select>
                <select
                  aria-label="Revisão dos achados de código"
                  value={reviewFilter}
                  onChange={(event) => {
                    setReviewFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="open">Pendentes</option>
                  <option value="false_positive">Falsos positivos revisados</option>
                  <option value="all">Todos os resultados</option>
                </select>
              </div>
              <div className="source-findings">
                {findings.slice((currentPage - 1) * 50, currentPage * 50).map((f) => (
                  <details className="source-finding" key={f.id}>
                    <summary>
                      <SeverityBadge value={f.severity} />
                      <span>
                        <strong>{f.title}</strong>
                        <code>
                          {f.path}
                          {f.line ? `:${f.line}` : ''}
                        </code>
                      </span>
                      <span className="finding-category">{f.category}</span>
                    </summary>
                    <div className="source-finding-body">
                      {f.description && <p>{f.description}</p>}
                      <CodeView
                        label="finding.json"
                        value={{
                          rule: f.ruleId,
                          version: f.detectorVersion,
                          confidence: f.confidence,
                          file: f.path,
                          line: f.line,
                          evidence: f.evidence,
                        }}
                      />
                      <h3>Impacto e validação</h3>
                      <p>{f.impact}</p>
                      <h3>Correção recomendada</h3>
                      <p>{f.recommendation}</p>
                      {f.suggestedFix && (
                        <>
                          <h3>Sugestão para revisão manual</h3>
                          <CodeView label="suggested-fix.txt" value={f.suggestedFix} />
                          <p>
                            Revise nomes, regras e contexto em homologação antes de aplicar. O
                            Qypher não executa essa alteração.
                          </p>
                        </>
                      )}
                      <h3>Como verificar a correção</h3>
                      <p>
                        {f.verification ||
                          'Repita a análise no mesmo escopo e confirme a cobertura do detector. Valide o comportamento manualmente em um ambiente autorizado.'}
                      </p>
                      <small>{f.reference}</small>
                      <div className="button-row">
                        <button
                          className="button secondary"
                          disabled={!native || scan.status === 'running' || reviewBusy}
                          onClick={() => void reviewFinding(f.id, !reviewed.has(f.id))}
                        >
                          {reviewed.has(f.id)
                            ? 'Restaurar achado pendente'
                            : 'Marcar como falso positivo'}
                        </button>
                      </div>
                    </div>
                  </details>
                ))}
                {!findings.length && (
                  <div className="journal-empty">
                    <code>// no findings in current selection</code>
                    <p>Ausência de achados não comprova ausência de vulnerabilidades ou malware.</p>
                  </div>
                )}
              </div>
              <Pagination
                label="Páginas de achados de código"
                page={currentPage}
                pages={pages}
                total={findings.length}
                onChange={setPage}
              />
              <SourceReadiness key={scan.id} scan={scan} reviews={reviews} workspace={w} />
              <AiFixStudio
                context={`Repositório local autorizado: ${scan.rootName}. Triagem estática; não executar conteúdo do alvo.`}
                issues={findings.slice((currentPage - 1) * 50, currentPage * 50).map((finding) => ({
                  ...finding,
                  ruleId: finding.ruleId,
                  location: `${finding.path}:${finding.line || '?'}`,
                  references: [finding.reference],
                }))}
              />
              <details className="dependency-inventory">
                <summary>
                  Dependency inventory <span>{scan.dependencies.length} versions</span>
                </summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Ecosystem</th>
                        <th>Package</th>
                        <th>Version / origem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scan.dependencies
                        .slice((currentDependencyPage - 1) * 100, currentDependencyPage * 100)
                        .map((d, i) => (
                          <tr key={i}>
                            <td>{d.ecosystem}</td>
                            <td>
                              <code>{sanitizeTechnicalText(d.name)}</code>
                            </td>
                            <td>
                              <code>{sanitizeTechnicalText(d.version)}</code>
                              <small>
                                {d.versionSource === 'manifest_pin'
                                  ? 'Declarada no manifesto; instalação não confirmada'
                                  : d.versionSource === 'lockfile'
                                    ? 'Lockfile'
                                    : d.versionSource === 'requirement_pin'
                                      ? 'Versão fixada'
                                      : 'Origem não registrada'}
                              </small>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  label="Páginas de dependências"
                  page={currentDependencyPage}
                  pages={dependencyPages}
                  total={scan.dependencies.length}
                  onChange={setDependencyPage}
                />
              </details>
              <div className="source-export-options">
                <label>
                  Formato do relatório de código
                  <select
                    value={format}
                    disabled={exporting}
                    onChange={(e) => setFormat(e.target.value as SourceReportFormat)}
                  >
                    <option value="json">JSON nativo</option>
                    <option value="sarif">SARIF 2.1.0</option>
                  </select>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={redactPaths}
                    disabled={exporting}
                    onChange={(e) => setRedactPaths(e.target.checked)}
                  />
                  Ocultar nomes e caminhos no relatório
                </label>
                <p>
                  Para navegar até arquivos em um leitor SARIF, desmarque a ocultação de caminhos. A
                  exportação inclui todos os achados da execução, independentemente dos filtros.
                </p>
              </div>
              <div className="button-row source-actions">
                <button
                  className="button secondary"
                  disabled={!native || scan.status === 'running' || exporting}
                  aria-busy={exporting}
                  onClick={() => void exportScan()}
                >
                  <FileDown size={13} />
                  {exporting ? 'Exportando relatório…' : 'Exportar relatório de código'}
                </button>
                <button
                  className="icon-button"
                  disabled={w.busy}
                  onClick={() => setRemove(scan.id)}
                  aria-label="Excluir análise de código"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <p className="success-message" role="status">
                {message}
              </p>
            </>
          ) : (
            <>
              <CodeView
                label="source.policy.json"
                value={{
                  mode: 'read_only',
                  execute_repository_code: false,
                  follow_symlinks: false,
                  scope: 'native directory selection',
                  sast: 'lexical triage / review required',
                  secrets: 'values never stored',
                  malware: 'indicators + optional ClamAV',
                  osv: 'off unless authorized',
                }}
              />
              <div className="source-limit-note">
                <ShieldAlert size={18} />
                <p>
                  Heurísticas não confirmam exploração ou infecção. Testes semânticos, auditorias
                  manuais e análise especializada de malware continuam necessários.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
      {remove && (
        <ConfirmDialog
          title="Excluir análise local?"
          onCancel={() => setRemove(null)}
          onConfirm={() => void deleteScan()}
        >
          A análise será excluída do histórico local. Nenhum arquivo do repositório será modificado.
        </ConfirmDialog>
      )}
    </>
  );
}
