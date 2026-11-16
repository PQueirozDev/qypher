import { useState } from 'react';
import { api, native } from '../api';
import type { Workspace } from '../useWorkspace';
import type { SourceScan, SourceReview, PredeploySummary } from '../sourceTypes';
import { date } from '../types';

export function SourceReadiness({
  scan,
  reviews,
  workspace: w,
}: {
  scan: SourceScan;
  reviews: SourceReview[];
  workspace: Workspace;
}) {
  const [baselineId, setBaselineId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ key: string; summary: PredeploySummary } | null>(null);
  const key = `${scan.id}:${baselineId}:${reviews
    .map((review) => review.findingId)
    .sort()
    .join(',')}`;
  const summary = result?.key === key ? result.summary : null;
  const baselines = w.sourceScans.filter(
    (item) =>
      item.id !== scan.id &&
      item.scopeId &&
      item.scopeId === scan.scopeId &&
      item.startedAt < scan.startedAt &&
      item.status !== 'running',
  );
  async function check() {
    setBusy(true);
    try {
      const summary = await api.sourcePredeploy(scan.id, baselineId || null);
      setResult({ key, summary });
    } catch (error) {
      w.setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="source-readiness" aria-label="Verificação pré-deploy">
      <h3>Pre-Deploy Security Check</h3>
      <p>
        Revise bloqueios e cobertura da análise salva antes de publicar. Nenhum código é enviado,
        alterado ou implantado por essa verificação.
      </p>
      <label>
        Comparar com análise anterior
        <select value={baselineId} onChange={(event) => setBaselineId(event.target.value)}>
          <option value="">Sem comparação</option>
          {baselines.map((item) => (
            <option key={item.id} value={item.id}>
              {date(item.startedAt)} · {item.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      {!scan.scopeId && (
        <p>
          Este histórico antigo não contém identidade de escopo; uma nova análise é necessária para
          comparar versões com segurança.
        </p>
      )}
      <button
        className="button secondary"
        disabled={!native || scan.status === 'running' || busy}
        onClick={() => void check()}
      >
        {busy ? 'Verificando cobertura…' : 'Verificar antes do deploy'}
      </button>
      {summary && (
        <div role="status">
          <h4>
            {
              {
                blocked: 'Bloqueado pela política local',
                review_required: 'Revisão necessária',
                no_blockers_observed: 'Sem bloqueios observados na cobertura',
              }[summary.status]
            }
          </h4>
          <p>{summary.reason}</p>
          <p>
            {summary.blockers} bloqueios · {summary.reviewed} achados revisados como falso positivo.
          </p>
          {summary.checksNotCompleted.length > 0 && (
            <p>Verificações incompletas: {summary.checksNotCompleted.join(', ')}.</p>
          )}
          {summary.comparison && (
            <p>
              Comparação: {summary.comparison.new.length} novos ·{' '}
              {summary.comparison.persistent.length} persistentes ·{' '}
              {summary.comparison.resolved.length} não observados na cobertura equivalente ·{' '}
              {summary.comparison.inconclusive.length} inconclusivos.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
