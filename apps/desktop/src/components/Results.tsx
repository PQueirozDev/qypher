import { useState } from 'react';
import { ChevronDown, FileDown, Search, Shield, Square } from 'lucide-react';
import { api } from '../api';
import { confidenceLabel, findingKind, kindLabel, scanCoverage, usableScore } from '../assessment';
import { safeLocation, sanitizeTechnicalText } from '../aiPrompt';
import { date, severityLabel, type Finding, type Scan, type Severity } from '../types';
import type { Workspace } from '../useWorkspace';
import { Empty, PageTitle, Panel, SeverityBadge, StatusBadge } from './ui';
import { CodeView } from './CodeView';
import { AiFixStudio } from './AiFixStudio';

function fixIssues(findings: Finding[]) {
  return findings.map((finding) => ({
    id: finding.id,
    ruleId: finding.detectorId,
    title: finding.title,
    severity: finding.severity,
    confidence: finding.confidence,
    classification: finding.classification,
    location: finding.location,
    evidence: finding.evidence,
    impact: finding.impact,
    recommendation: finding.recommendation,
    references: finding.references,
    verification: finding.verification,
  }));
}
export function FindingList({ findings }: { findings: Finding[] }) {
  if (!findings.length)
    return (
      <Empty
        icon={Shield}
        title="Nenhum achado nesta seleção"
        description="Confira a cobertura da execução. Ausência de achados não comprova ausência de vulnerabilidades."
      />
    );
  const clean = sanitizeTechnicalText;
  return (
    <div className="findings-list">
      {findings.map((finding) => (
        <details className="finding" key={finding.id}>
          <summary>
            <SeverityBadge value={finding.severity} />
            <div>
              <strong>{clean(finding.title)}</strong>
              <code>
                {finding.detectorId} · v{finding.detectorVersion}
              </code>
            </div>
            <ChevronDown size={17} />
          </summary>
          <div className="finding-body">
            <div className="finding-meta">
              <span>{kindLabel[findingKind(finding)]}</span>
              <code>{clean(safeLocation(finding.location))}</code>
              <span>Confiança: {confidenceLabel(finding.confidence)}</span>
            </div>
            <h3>O que está errado?</h3>
            <p>{clean(finding.description || finding.title)}</p>
            <h3>Evidência técnica</h3>
            <pre>{clean(finding.evidence)}</pre>
            <h3>Por que isso importa?</h3>
            <p>{clean(finding.impact)}</p>
            <h3>Como corrigir?</h3>
            <p className="recommendation">{clean(finding.recommendation)}</p>
            <h3>Como verificar a correção?</h3>
            <p>
              {clean(
                finding.verification ||
                  'Repita a mesma verificação no escopo autorizado após a alteração e compare evidências e cobertura. Verificações não executadas ou incompletas são inconclusivas.',
              )}
            </p>
            <h3>Referências</h3>
            {finding.references.map((reference) => (
              <p className="reference" key={reference}>
                {clean(reference)}
              </p>
            ))}
            <small>ID: {clean(finding.id)}</small>
            <AiFixStudio context={finding.location} issues={fixIssues([finding])} />
          </div>
        </details>
      ))}
    </div>
  );
}
// Finding Inspector 2.0: lista selecionável à esquerda, detalhe completo à direita.
export function FindingInspector({ findings }: { findings: Finding[] }) {
  const [sel, setSel] = useState(0);
  if (!findings.length)
    return (
      <Empty
        icon={Shield}
        title="Nenhum achado nesta seleção"
        description="Confira a cobertura da execução. Ausência de achados não comprova ausência de vulnerabilidades."
      />
    );
  const clean = sanitizeTechnicalText;
  const index = Math.min(sel, findings.length - 1);
  const finding = findings[index];
  return (
    <div className="finding-inspector">
      <ul className="fi-list" role="listbox" aria-label="Lista de achados">
        {findings.map((item, i) => (
          <li key={item.id}>
            <button
              role="option"
              aria-selected={i === index}
              className={`fi-row ${i === index ? 'active' : ''}`}
              onClick={() => setSel(i)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSel(Math.min(i + 1, findings.length - 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSel(Math.max(i - 1, 0));
                }
              }}
            >
              <SeverityBadge value={item.severity} />
              <span className="fi-row-text">
                <strong>{clean(item.title)}</strong>
                <code>{item.detectorId}</code>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="fi-detail" key={finding.id}>
        <div className="fi-head">
          <SeverityBadge value={finding.severity} />
          <div>
            <h2>{clean(finding.title)}</h2>
            <code>
              {finding.detectorId} · v{finding.detectorVersion}
            </code>
          </div>
        </div>
        <div className="fi-tags">
          <span className="fi-tag">{kindLabel[findingKind(finding)]}</span>
          <span className="fi-tag">Confiança: {confidenceLabel(finding.confidence)}</span>
          {finding.category && <span className="fi-tag">{clean(finding.category)}</span>}
          <code className="fi-loc">{clean(safeLocation(finding.location))}</code>
        </div>
        <h3>O que está errado?</h3>
        <p>{clean(finding.description || finding.title)}</p>
        <h3>Evidência técnica</h3>
        <pre>{clean(finding.evidence)}</pre>
        <h3>Por que isso importa?</h3>
        <p>{clean(finding.impact)}</p>
        <h3>Como corrigir?</h3>
        <p className="recommendation">{clean(finding.recommendation)}</p>
        <h3>Como verificar a correção?</h3>
        <p>
          {clean(
            finding.verification ||
              'Repita a mesma verificação no escopo autorizado após a alteração e compare evidências e cobertura. Verificações não executadas ou incompletas são inconclusivas.',
          )}
        </p>
        <h3>Referências</h3>
        {finding.references.map((reference) => (
          <p className="reference" key={reference}>
            {clean(reference)}
          </p>
        ))}
        <small>ID: {clean(finding.id)}</small>
        <AiFixStudio context={finding.location} issues={fixIssues([finding])} />
      </div>
    </div>
  );
}
// Resumo de severidades clicável (filtra ao clicar) acima do inspetor.
function SeveritySummary({
  findings,
  active,
  onPick,
}: {
  findings: Finding[];
  active: string;
  onPick: (value: string) => void;
}) {
  if (!findings.length) return null;
  const order: Severity[] = ['high', 'medium', 'low', 'info', 'unrated'];
  const counts = order
    .map((value) => ({ value, n: findings.filter((f) => f.severity === value).length }))
    .filter((item) => item.n > 0);
  return (
    <div className="sev-summary" role="group" aria-label="Resumo por severidade">
      <button
        className={`sev-chip ${active === 'all' ? 'active' : ''}`}
        onClick={() => onPick('all')}
      >
        Todas <b>{findings.length}</b>
      </button>
      {counts.map(({ value, n }) => (
        <button
          key={value}
          className={`sev-chip sev-${value} ${active === value ? 'active' : ''}`}
          aria-pressed={active === value}
          onClick={() => onPick(value)}
        >
          {severityLabel[value]} <b>{n}</b>
        </button>
      ))}
    </div>
  );
}
export function Results({
  workspace: w,
  selectedId,
  reports,
}: {
  workspace: Workspace;
  selectedId: string;
  reports: (id: string) => void;
}) {
  const [severity, setSeverity] = useState('all');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [confidence, setConfidence] = useState('all');
  const [kind, setKind] = useState('all');
  const [tab, setTab] = useState<'findings' | 'terminal' | 'details'>('findings');
  const [current, setCurrent] = useState(selectedId);
  const scan = current ? w.scans.find((item) => item.id === current) : w.scans[0];
  const all = scan?.findings ?? [];
  const findings = all.filter(
    (finding) =>
      (severity === 'all' || finding.severity === severity) &&
      (category === 'all' || finding.category === category) &&
      (confidence === 'all' || finding.confidence === confidence) &&
      (kind === 'all' || findingKind(finding) === kind) &&
      `${finding.title} ${finding.detectorId} ${finding.location}`
        .toLocaleLowerCase('pt-BR')
        .includes(search.toLocaleLowerCase('pt-BR')),
  );
  const coverage = scan ? scanCoverage(scan) : null;
  const tabs = [
    { key: 'findings', label: 'Resultados' },
    { key: 'terminal', label: 'Terminal' },
    { key: 'details', label: 'Detalhes e cobertura' },
  ] as const;
  async function cancel() {
    if (scan)
      try {
        await api.cancelScan(scan.id);
      } catch (error) {
        w.setError(String(error));
      }
  }
  return (
    <>
      <PageTitle
        tag="INTELIGÊNCIA / ACHADOS"
        title="Inspetor de evidências HTTP"
        description="Entenda a evidência, revise a classificação e verifique a correção no mesmo escopo."
        action={
          <button
            className="button secondary"
            disabled={!scan || scan.status === 'running'}
            onClick={() => scan && reports(scan.id)}
          >
            <FileDown size={16} />
            Exportar relatório
          </button>
        }
      />
      {!scan ? (
        <Panel title="Resultados">
          <Empty
            title="Aguardando resultados"
            description="Execute uma auditoria autorizada para ver evidências reais."
          />
        </Panel>
      ) : (
        <>
          <div className="scan-selector">
            <label>
              Execução
              <select value={scan.id} onChange={(event) => setCurrent(event.target.value)}>
                {w.scans.map((item) => (
                  <option key={item.id} value={item.id}>
                    {w.projects.find((project) => project.id === item.config.projectId)?.name} ·{' '}
                    {date(item.startedAt)} · {item.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <StatusBadge value={scan.status} />
            {scan.status === 'running' && (
              <button className="button danger" onClick={() => void cancel()}>
                <Square size={13} />
                Interromper análise
              </button>
            )}
          </div>
          <div className="result-strip">
            <div>
              <small>ALVO / ESCOPO</small>
              <code>{safeLocation(scan.config.url)}</code>
              <span>Prefixo: {scan.config.pathPrefix}</span>
            </div>
            <div>
              <small>REQUISIÇÕES</small>
              <strong>
                {scan.requestCount} / {scan.config.maxRequests}
              </strong>
            </div>
            <div>
              <small>ÍNDICE DE POSTURA</small>
              <strong>{usableScore(scan) ?? '—'} / 100</strong>
            </div>
            <div>
              <small>COBERTURA</small>
              <span>
                {coverage?.executed} executadas · {coverage?.notRun} não executadas ·{' '}
                {coverage?.errors} erros
              </span>
            </div>
          </div>
          {(scan.error || coverage?.partial) && (
            <div className="notice warning">
              <Shield size={18} />
              <p>
                <strong>Cobertura parcial ou inconclusiva</strong>
                <br />
                {sanitizeTechnicalText(
                  scan.error ||
                    'Há verificações não executadas ou com erro. O índice não representa garantia de segurança.',
                )}
              </p>
            </div>
          )}
          <div className="analysis-tabs" role="tablist" aria-label="Painéis da auditoria">
            {tabs.map((item, index) => (
              <button
                key={item.key}
                id={`scan-tab-${item.key}`}
                role="tab"
                aria-selected={tab === item.key}
                aria-controls={`scan-panel-${item.key}`}
                tabIndex={tab === item.key ? 0 : -1}
                onClick={() => setTab(item.key)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    const next =
                      tabs[
                        (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
                      ];
                    setTab(next.key);
                    document.getElementById(`scan-tab-${next.key}`)?.focus();
                  }
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <section role="tabpanel" id={`scan-panel-${tab}`} aria-labelledby={`scan-tab-${tab}`}>
            {tab === 'findings' && (
              <>
                <div className="results-filters">
                  <label className="search-input">
                    <Search size={15} />
                    <input
                      aria-label="Pesquisar achados"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Regra, título ou caminho…"
                    />
                  </label>
                  <select
                    aria-label="Filtrar por severidade"
                    value={severity}
                    onChange={(event) => setSeverity(event.target.value)}
                  >
                    <option value="all">Todas as severidades</option>
                    {(['high', 'medium', 'low', 'info', 'unrated'] as Severity[]).map((value) => (
                      <option key={value} value={value}>
                        {severityLabel[value]}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filtrar por categoria"
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                  >
                    <option value="all">Todas as categorias</option>
                    {[...new Set(all.map((finding) => finding.category))].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Filtrar por confiança"
                    value={confidence}
                    onChange={(event) => setConfidence(event.target.value)}
                  >
                    <option value="all">Todas as confianças</option>
                    {[...new Set(all.map((finding) => finding.confidence))].map((value) => (
                      <option key={value} value={value}>
                        {confidenceLabel(value)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filtrar por status de evidência"
                    value={kind}
                    onChange={(event) => setKind(event.target.value)}
                  >
                    <option value="all">Todos os estados</option>
                    {Object.entries(kindLabel).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <span className="muted-text">{findings.length} resultados</span>
                </div>
                <SeveritySummary findings={all} active={severity} onPick={setSeverity} />
                {!!all.length && <AiFixStudio context={scan.config.url} issues={fixIssues(all)} />}
                <FindingInspector findings={findings} />
              </>
            )}
            {tab === 'terminal' && (
              <Panel title="Eventos reais da execução">
                <p className="padded muted-text">
                  Use a busca e os filtros do terminal integrado para pesquisar ou copiar logs.
                  Limpar a visualização preserva o histórico.
                </p>
                <div className="terminal" role="log" aria-label="Logs da execução">
                  {scan.logs.map((entry, index) => (
                    <p key={`${entry.at}-${index}`}>
                      <time title={entry.at}>[{entry.at.slice(11, 19)} UTC]</time>{' '}
                      {entry.level.toUpperCase()} <code>{sanitizeTechnicalText(entry.event)}</code>{' '}
                      {sanitizeTechnicalText(entry.message)}
                    </p>
                  ))}
                  {!scan.logs.length && <p>Nenhum evento registrado.</p>}
                </div>
              </Panel>
            )}
            {tab === 'details' && <Coverage scan={scan} />}
          </section>
          <p className="footnote">
            A cobertura depende do modo e dos consentimentos registrados. Configuração insegura,
            exposição e exploração confirmada têm significados diferentes. A pontuação não é CVSS.
          </p>
        </>
      )}
    </>
  );
}
function Coverage({ scan }: { scan: Scan }) {
  return (
    <Panel title="Cobertura verificável">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Detector / versão</th>
              <th>Recurso</th>
              <th>Resultado</th>
              <th>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {scan.checks.map((check, index) => (
              <tr key={`${check.detectorId}-${index}`}>
                <td>
                  <code>
                    {check.detectorId} / {check.detectorVersion}
                  </code>
                </td>
                <td>
                  <code>{safeLocation(check.resource)}</code>
                </td>
                <td>
                  <span className={`coverage-${check.status}`}>
                    {
                      {
                        passed: 'Sem achado observado',
                        finding: 'Achado observado',
                        not_run: 'Não executado',
                        error: 'Erro / inconclusivo',
                      }[check.status]
                    }
                  </span>
                </td>
                <td>{sanitizeTechnicalText(check.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!scan.checks.length && (
          <p className="padded">Nenhuma verificação concluída. Consulte os logs.</p>
        )}
      </div>
      {scan.observations.map((observation, index) => (
        <details className="observation" key={index}>
          <summary>
            HTTP {observation.status} · {observation.elapsedMs} ms · {safeLocation(observation.url)}
            <ChevronDown size={16} />
          </summary>
          <CodeView
            value={{
              ...observation,
              url: safeLocation(observation.url),
              headers: Object.fromEntries(
                Object.entries(observation.headers).map(([name, value]) => [
                  name,
                  sanitizeTechnicalText(value),
                ]),
              ),
            }}
            label={`response-${index + 1}.json`}
          />
        </details>
      ))}
    </Panel>
  );
}
