import { useState } from 'react';
import { ArrowRight, FileCode2, GitCompareArrows, Plus, ShieldCheck } from 'lucide-react';
import { api, native } from '../api';
import { elapsedSeconds, findingKind, scanCoverage, usableScore } from '../assessment';
import { date, severityLabel, type Comparison, type Severity } from '../types';
import type { Workspace } from '../useWorkspace';
import { StatusBadge } from './ui';
import { gradeFor, useCountUp } from './ScanResult';

function Metric({ label, value }: { label: string; value: number | null }) {
  const shown = useCountUp(value ?? 0, 900);
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value === null ? '—' : shown}</strong>
    </div>
  );
}

export function Dashboard({
  workspace: w,
  navigate,
  openScan,
}: {
  workspace: Workspace;
  navigate: (page: string) => void;
  openScan: (id: string) => void;
}) {
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [comparing, setComparing] = useState(false);
  const latest = w.scans[0];
  const available = native && w.ready;
  const score = latest ? usableScore(latest) : null;
  const coverage = latest ? scanCoverage(latest) : null;
  const comparable = latest
    ? w.scans
        .filter(
          (scan) =>
            scan.config.projectId === latest.config.projectId &&
            scan.config.url === latest.config.url &&
            scan.config.pathPrefix === latest.config.pathPrefix &&
            !!scan.config.discovery === !!latest.config.discovery &&
            !!scan.config.activeChecks === !!latest.config.activeChecks &&
            usableScore(scan) !== null,
        )
        .slice(0, 10)
    : [];
  async function compare() {
    if (comparable.length < 2) return;
    setComparing(true);
    try {
      setComparison(await api.compare(comparable[1].id, comparable[0].id));
    } catch (error) {
      w.setError(String(error));
    } finally {
      setComparing(false);
    }
  }
  return (
    <div className="security-dashboard">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">QYPHER / VISÃO GERAL</span>
          <h1>Seu próximo deploy começa aqui.</h1>
          <p>Você cria com IA. O Qypher ajuda a proteger.</p>
        </div>
        <button className="button primary" onClick={() => navigate('home')}>
          <Plus size={15} />
          Nova análise
        </button>
      </div>
      <div className="dashboard-stats">
        {[
          { label: 'Alvos cadastrados', value: w.projects.length },
          { label: 'Auditorias HTTP', value: w.scans.length },
          { label: 'Análises de código', value: w.sourceScans.length },
          { label: 'Em execução', value: w.busy ? 1 : 0 },
        ].map((metric) => (
          <Metric key={metric.label} label={metric.label} value={available ? metric.value : null} />
        ))}
      </div>
      <section className="dashboard-analysis">
        <div className="dashboard-section-heading">
          <h2>Última auditoria HTTP</h2>
          {latest && <StatusBadge value={latest.status} />}
        </div>
        {latest ? (
          <>
            <div className="posture-summary">
              <div className={`posture-score grade-${gradeFor(score)}`}>
                <strong>{score ?? '—'}</strong>
                <span>índice / 100</span>
              </div>
              <div>
                <p>
                  <code>{latest.config.url}</code>
                </p>
                <p>
                  {coverage?.executed} verificações executadas · {coverage?.notRun} não executadas ·{' '}
                  {coverage?.errors} erros
                </p>
                <p>
                  {elapsedSeconds(latest) === null
                    ? 'Duração ainda indisponível'
                    : `${elapsedSeconds(latest)?.toFixed(1)} segundos`}{' '}
                  · {coverage?.partial ? 'Cobertura parcial' : 'Cobertura registrada'}
                </p>
              </div>
            </div>
            <div className="dashboard-classifications">
              {[
                [
                  'Vulnerabilidades confirmadas',
                  latest.findings.filter((finding) => findingKind(finding) === 'confirmed').length,
                ],
                [
                  'Possíveis vulnerabilidades / exposições',
                  latest.findings.filter((finding) => findingKind(finding) === 'possible').length,
                ],
                [
                  'Recomendações de configuração',
                  latest.findings.filter((finding) => findingKind(finding) === 'configuration')
                    .length,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            {latest.findings.length > 0 && (
              <div className="dash-bar" aria-hidden="true">
                {(['high', 'medium', 'low', 'info', 'unrated'] as Severity[]).map((severity, i) => {
                  const n = latest.findings.filter((f) => f.severity === severity).length;
                  return n ? (
                    <i
                      key={severity}
                      className={`sev-${severity}`}
                      style={{ flexGrow: n, animationDelay: `${200 + i * 80}ms` }}
                    />
                  ) : null;
                })}
              </div>
            )}
            <div className="severity-overview">
              {(['high', 'medium', 'low', 'info', 'unrated'] as Severity[]).map((severity) => (
                <span key={severity} className={`severity-count severity-${severity}`}>
                  {severityLabel[severity]}{' '}
                  <b>{latest.findings.filter((finding) => finding.severity === severity).length}</b>
                </span>
              ))}
            </div>
            <div className="button-row">
              <button className="button secondary" onClick={() => openScan(latest.id)}>
                Abrir evidências
                <ArrowRight size={14} />
              </button>
              <button
                className="button secondary"
                disabled={comparable.length < 2 || comparing}
                onClick={() => void compare()}
              >
                <GitCompareArrows size={14} />
                {comparing ? 'Comparando…' : 'Comparar últimas execuções'}
              </button>
            </div>
            {comparison && (
              <div className="comparison-metrics">
                Novos: {comparison.new.length} · Persistentes: {comparison.persistent.length} · Não
                mais observados: {comparison.resolved.length} · Inconclusivos:{' '}
                {comparison.inconclusive.length}
              </div>
            )}
          </>
        ) : (
          <div className="dashboard-empty">
            <ShieldCheck size={26} />
            <h3>Ainda não há auditorias registradas.</h3>
            <p>
              O painel mostra somente resultados reais. Configure um alvo autorizado para começar.
            </p>
            <button className="button secondary" onClick={() => navigate('home')}>
              Analisar um site
              <ArrowRight size={14} />
            </button>
          </div>
        )}
        <details className="score-methodology">
          <summary>Como o índice é calculado</summary>
          <p>
            Começa em 100 e desconta uma vez por detector, usando sua maior severidade: alta 30,
            média 12, baixa 4 e informativa 1. Com uma alta, o índice é limitado a 55. Não pontuada
            não recebe peso.
          </p>
          <p>
            O índice só é exibido para execução concluída com verificações efetivas. Resume a
            cobertura executada; não é CVSS, certificação ou garantia de segurança. Ausência de
            achados não comprova ausência de vulnerabilidades.
          </p>
        </details>
      </section>
      <div className="dashboard-grid">
        <section className="dashboard-analysis">
          <div className="dashboard-section-heading">
            <h2>Alvos autorizados</h2>
            <button className="text-button" onClick={() => navigate('projects')}>
              Gerenciar
            </button>
          </div>
          {w.projects.length ? (
            w.projects.slice(0, 5).map((project) => (
              <div className="dashboard-row" key={project.id}>
                <div>
                  <strong>{project.name}</strong>
                  <code>{project.url}</code>
                </div>
              </div>
            ))
          ) : (
            <p className="muted-text">Nenhum alvo configurado.</p>
          )}
          <button className="dashboard-source" onClick={() => navigate('source')}>
            <FileCode2 size={18} />
            <span>
              Leak Hunter e análise de código
              <small>Segredos, dependências e configurações locais</small>
            </span>
            <ArrowRight size={15} />
          </button>
        </section>
        <section className="dashboard-analysis">
          <div className="dashboard-section-heading">
            <h2>Evolução comparável</h2>
            <button className="text-button" onClick={() => navigate('history')}>
              Histórico
            </button>
          </div>
          {comparable.length ? (
            <div className="dashboard-trend">
              {[...comparable].reverse().map((scan) => (
                <button key={scan.id} onClick={() => openScan(scan.id)}>
                  <time>{date(scan.startedAt)}</time>
                  <span className="trend-track">
                    <span style={{ width: `${usableScore(scan) ?? 0}%` }} />
                  </span>
                  <strong>{usableScore(scan)} / 100</strong>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted-text">
              A evolução aparece após análises concluídas do mesmo alvo, caminho e modos. Escopos
              diferentes não são comparados.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
