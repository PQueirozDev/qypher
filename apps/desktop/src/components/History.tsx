import { useState } from 'react';
import { ArrowUpRight, Clock3, GitCompareArrows, Trash2 } from 'lucide-react';
import { api } from '../api';
import { date, type Comparison } from '../types';
import type { Workspace } from '../useWorkspace';
import { ConfirmDialog, Empty, PageTitle, Panel, StatusBadge } from './ui';
import { FindingList } from './Results';
export function History({
  workspace: w,
  openScan,
}: {
  workspace: Workspace;
  openScan: (id: string) => void;
}) {
  const [remove, setRemove] = useState<string | null>(null);
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);
  async function compare() {
    setBusy(true);
    setComparison(null);
    try {
      setComparison(await api.compare(before, after));
    } catch (e) {
      w.setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function deleteScan() {
    const id = remove;
    setRemove(null);
    if (id)
      try {
        await api.deleteScan(id);
        setComparison(null);
        await w.refresh();
      } catch (e) {
        w.setError(String(e));
      }
  }
  return (
    <>
      <PageTitle
        tag="TRABALHO / HISTÓRICO"
        title="Histórico de execuções / comparação"
        description="Consulte as últimas 200 execuções. Compare cobertura antes de concluir que um problema foi resolvido."
      />
      <Panel title="Histórico de auditorias" meta={<Clock3 size={17} />}>
        {w.scans.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Projeto / data</th>
                  <th>Estado</th>
                  <th>Achados</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {w.scans.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{w.projects.find((p) => p.id === s.config.projectId)?.name}</strong>
                      <small>
                        {date(s.startedAt)} · {s.id.slice(0, 8)}
                      </small>
                    </td>
                    <td>
                      <StatusBadge value={s.status} />
                    </td>
                    <td>{s.findings.length}</td>
                    <td>
                      <div className="button-row">
                        <button className="text-button" onClick={() => openScan(s.id)}>
                          Abrir
                          <ArrowUpRight size={15} />
                        </button>
                        <button
                          className="icon-button"
                          disabled={!!w.active}
                          aria-label={`Excluir auditoria ${s.id.slice(0, 8)}`}
                          onClick={() => setRemove(s.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={Clock3}
            title="O histórico está começando"
            description="As execuções são persistidas no SQLite, inclusive quando falham ou são canceladas."
          />
        )}
      </Panel>
      <Panel title="Comparar duas execuções" meta={<GitCompareArrows size={17} />}>
        <div className="comparison-form">
          {[
            { label: 'Antes (mais antiga)', value: before, setter: setBefore },
            { label: 'Depois (mais recente)', value: after, setter: setAfter },
          ].map(({ label, value, setter }) => (
            <label key={label}>
              {label}
              <select
                value={value}
                onChange={(e) => {
                  setter(e.target.value);
                  setComparison(null);
                }}
              >
                <option value="">Selecione uma execução</option>
                {w.scans.map((s) => (
                  <option value={s.id} key={s.id}>
                    {w.projects.find((p) => p.id === s.config.projectId)?.name} ·{' '}
                    {date(s.startedAt)} · {s.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button
            className="button primary"
            disabled={!before || !after || before === after || busy}
            onClick={() => void compare()}
          >
            <GitCompareArrows size={16} />
            {busy ? 'Comparando…' : 'Comparar'}
          </button>
        </div>
        <p className="padded muted-text">
          Requer o mesmo projeto, URL, escopo e ordem cronológica. Verificações não executadas,
          versões diferentes ou execução incompleta geram resultado inconclusivo.
        </p>
        {comparison && (
          <div className="comparison-results">
            {(
              [
                { key: 'new', label: 'Novos' },
                { key: 'persistent', label: 'Persistentes' },
                { key: 'resolved', label: 'Não mais observados com cobertura válida' },
                { key: 'inconclusive', label: 'Inconclusivos' },
              ] as const
            ).map(({ key, label }) => (
              <details key={key}>
                <summary>
                  {label}
                  <span>{comparison[key].length}</span>
                </summary>
                {comparison[key].length > 0 && <FindingList findings={comparison[key]} />}
              </details>
            ))}
          </div>
        )}
      </Panel>
      {remove && (
        <ConfirmDialog
          title="Excluir esta auditoria?"
          onCancel={() => setRemove(null)}
          onConfirm={() => void deleteScan()}
        >
          A execução e suas evidências serão removidas permanentemente do histórico local.
        </ConfirmDialog>
      )}
    </>
  );
}
