import { useState } from 'react';
import { Braces, FileCode2, FileDown, FileText, LockKeyhole } from 'lucide-react';
import { api } from '../api';
import { date } from '../types';
import type { Workspace } from '../useWorkspace';
import { Empty, PageTitle, Panel } from './ui';
export function Reports({
  workspace: w,
  selectedId,
}: {
  workspace: Workspace;
  selectedId: string;
}) {
  const scans = w.scans.filter((s) => s.status !== 'running');
  const [id, setId] = useState(selectedId);
  const scan = scans.find((s) => s.id === id) ?? scans[0];
  const [redact, setRedact] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(format: string) {
    if (!scan) return;
    setBusy(true);
    setMessage('');
    try {
      const path = await api.export(scan.id, format, redact);
      setMessage(path ? `Relatório salvo em ${path}` : 'Exportação cancelada.');
    } catch (e) {
      w.setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        tag="SAÍDA / RELATÓRIOS"
        title="Exportar relatórios"
        description="Relatórios gerados localmente, sem serviço de conversão ou envio para terceiros."
      />
      <Panel title="Preparar relatório" meta={<FileDown size={18} />}>
        {!scan ? (
          <Empty
            icon={FileText}
            title="Nenhuma auditoria finalizada"
            description="Auditorias concluídas, parciais ou canceladas podem ser exportadas com suas limitações explícitas."
          />
        ) : (
          <div className="report-config">
            <label>
              Execução
              <select
                value={scan.id}
                onChange={(e) => {
                  setId(e.target.value);
                  setMessage('');
                }}
              >
                {scans.map((s) => (
                  <option key={s.id} value={s.id}>
                    {w.projects.find((p) => p.id === s.config.projectId)?.name} ·{' '}
                    {date(s.startedAt)} · {s.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={redact}
                onChange={(e) => setRedact(e.target.checked)}
              />
              <span>
                Ocultar URLs, caminhos, nomes de cookies e emissor do certificado.
                <small>
                  Valores de cookies, credenciais e corpos de resposta nunca são coletados. Revise
                  nome do projeto e evidências antes de compartilhar.
                </small>
              </span>
            </label>
            <div className="notice">
              <LockKeyhole size={17} />
              <p>
                {redact
                  ? 'Redação ativada. Identificadores técnicos e referências permanecem no relatório.'
                  : 'O relatório incluirá URLs e evidências. Compartilhe somente com pessoas autorizadas.'}
              </p>
            </div>
            <div className="export-grid">
              {[
                {
                  format: 'pdf',
                  title: 'PDF',
                  icon: FileText,
                  description: 'Documento paginado, pronto para compartilhar.',
                },
                {
                  format: 'html',
                  title: 'HTML',
                  icon: FileCode2,
                  description: 'Relatório legível no navegador e adequado para impressão.',
                },
                {
                  format: 'json',
                  title: 'JSON',
                  icon: Braces,
                  description: 'Snapshot versionado para análise e automação.',
                },
              ].map(({ format, title, icon: Icon, description }) => (
                <button
                  key={format}
                  className="export-card"
                  disabled={busy}
                  onClick={() => void save(format)}
                >
                  <Icon size={26} />
                  <strong>{title}</strong>
                  <p>{description}</p>
                  <span>
                    {busy ? 'Aguarde…' : 'Escolher destino'} <FileDown size={14} />
                  </span>
                </button>
              ))}
            </div>
            <p className="success-message" role="status">
              {message}
            </p>
          </div>
        )}
      </Panel>
      <Panel title="O que está incluído">
        <div className="report-outline">
          {[
            'Resumo executivo e dados do projeto',
            'Escopo, limites, versões e datas',
            'Evidências, impacto e recomendações',
            'Cobertura e verificações não realizadas',
            'Estado completo ou parcial da execução',
            'Referências técnicas versionadas',
          ].map((l, i) => (
            <p key={l}>
              <span>0{i + 1}</span>
              {l}
            </p>
          ))}
        </div>
        <p className="padded muted-text">
          A comparação entre auditorias fica na seção Scan history e ainda não é incorporada ao
          arquivo exportado.
        </p>
      </Panel>
    </>
  );
}
