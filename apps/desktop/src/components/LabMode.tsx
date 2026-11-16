import { useState, type FormEvent } from 'react';
import { Play, Square, FileDown, Trash2, ShieldAlert } from 'lucide-react';
import { api, native } from '../api';
import type { Workspace } from '../useWorkspace';
import { scenarioLabel, verdictLabel, type LabRequest, type LabScenario } from '../labTypes';
import { date } from '../types';
import { CodeView } from './CodeView';
import { PageTitle, Panel, StatusBadge, ConfirmDialog } from './ui';

export function LabMode({ workspace: w }: { workspace: Workspace }) {
  const [projectId, setProjectId] = useState('');
  const [url, setUrl] = useState('');
  const [prefix, setPrefix] = useState('/');
  const [environment, setEnvironment] = useState<'local' | 'staging'>('local');
  const [scenario, setScenario] = useState<LabScenario>('protected_route');
  const [owner, setOwner] = useState('');
  const [challenger, setChallenger] = useState('');
  const [kind, setKind] = useState<'bearer' | 'cookie'>('bearer');
  const [marker, setMarker] = useState('qypher-fixture-resource-owner');
  const [denied, setDenied] = useState(403);
  const [maxRequests, setMaxRequests] = useState(4);
  const [timeout, setTimeout] = useState(5);
  const [authorized, setAuthorized] = useState(false);
  const [synthetic, setSynthetic] = useState(false);
  const [privateAllowed, setPrivateAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  const [remove, setRemove] = useState<string | null>(null);
  const run = selected ? w.labRuns.find((item) => item.id === selected) : w.labRuns[0];
  const ready = native && w.ready && !w.busy && !busy;
  function resetConsent() {
    setAuthorized(false);
    setSynthetic(false);
    setPrivateAllowed(false);
  }
  function selectProject(id: string) {
    setProjectId(id);
    const project = w.projects.find((item) => item.id === id);
    setUrl(project?.url ?? '');
    try {
      setPrefix(new URL(project?.url ?? '').pathname);
    } catch {
      setPrefix('/');
    }
    resetConsent();
  }
  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const request: LabRequest = {
      projectId,
      url,
      pathPrefix: prefix,
      authorized,
      syntheticDataConfirmed: synthetic,
      environment,
      allowPrivate: privateAllowed,
      scenario,
      marker,
      ownerCredential: { kind, value: owner },
      challengerCredential: scenario === 'protected_route' ? null : { kind, value: challenger },
      expectedDeniedStatus: denied,
      maxRequests,
      timeoutSeconds: timeout,
    };
    try {
      const id = await api.startLab(request);
      setSelected(id);
      setOwner('');
      setChallenger('');
      resetConsent();
    } catch (error) {
      w.setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!w.activeLab) return;
    try {
      await api.cancelScan(w.activeLab.id);
    } catch (error) {
      w.setError(String(error));
    }
  }
  async function exportRun() {
    if (!run) return;
    setBusy(true);
    setMessage('');
    try {
      const path = await api.exportLab(run.id, true);
      setMessage(path ? `Relatório salvo em ${path}` : 'Exportação cancelada.');
    } catch (error) {
      w.setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function deleteRun() {
    const id = remove;
    setRemove(null);
    if (!id) return;
    try {
      await api.deleteLab(id);
      setSelected('');
      await w.refresh();
    } catch (error) {
      w.setError(String(error));
    }
  }
  return (
    <>
      <PageTitle
        tag="LAB MODE / AUTH & PERMISSIONS"
        title="Laboratório de autorização"
        description="Compare acessos a um recurso fictício em loopback ou homologação HTTPS. Somente GET, sem executar logout ou alterar dados."
      />
      <div className="notice warning">
        <ShieldAlert size={18} />
        <p>
          Use contas de teste dedicadas e um recurso com marcador sintético exclusivo. Um HTTP 200
          sem o marcador não confirma acesso indevido. Credenciais ficam somente na execução, sem
          histórico, logs, prompts ou relatórios.
        </p>
      </div>
      <div className="source-layout lab-layout">
        <form className="source-config" onSubmit={(event) => void start(event)}>
          <Panel title="Cenário e escopo autorizado">
            <div className="lab-fields">
              <label>
                Projeto autorizado
                <select
                  aria-label="Projeto autorizado"
                  value={projectId}
                  onChange={(event) => selectProject(event.target.value)}
                  required
                  disabled={!ready}
                >
                  <option value="">Selecione um projeto</option>
                  {w.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              {!w.projects.length && (
                <p>Cadastre um projeto em Alvos antes de executar um cenário.</p>
              )}
              <label>
                Ambiente
                <select
                  aria-label="Ambiente"
                  value={environment}
                  onChange={(event) => {
                    setEnvironment(event.target.value as 'local' | 'staging');
                    resetConsent();
                  }}
                  disabled={!ready}
                >
                  <option value="local">Local: loopback</option>
                  <option value="staging">Homologação: HTTPS</option>
                </select>
              </label>
              <label>
                Cenário
                <select
                  aria-label="Cenário"
                  value={scenario}
                  onChange={(event) => {
                    setScenario(event.target.value as LabScenario);
                    setChallenger('');
                    resetConsent();
                  }}
                  disabled={!ready}
                >
                  {Object.entries(scenarioLabel).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                URL do recurso fictício
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    resetConsent();
                  }}
                  disabled={!ready}
                  placeholder="http://127.0.0.1:8878/fixture/private"
                />
              </label>
              <label>
                Prefixo de caminho autorizado
                <input
                  required
                  value={prefix}
                  onChange={(event) => {
                    setPrefix(event.target.value);
                    resetConsent();
                  }}
                  disabled={!ready}
                />
              </label>
              <label>
                Marcador sintético exclusivo
                <input
                  required
                  minLength={24}
                  maxLength={128}
                  value={marker}
                  onChange={(event) => setMarker(event.target.value)}
                  disabled={!ready}
                />
              </label>
              <small>
                Inclua esse marcador apenas na resposta do recurso fictício. A conta de referência
                precisa conseguir lê-lo. O marcador não será salvo no relatório.
              </small>
              <label>
                Formato de credencial
                <select
                  aria-label="Formato de credencial"
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as 'bearer' | 'cookie');
                    setOwner('');
                    setChallenger('');
                  }}
                  disabled={!ready}
                >
                  <option value="bearer">Bearer token de teste</option>
                  <option value="cookie">Cookie de teste: nome=valor</option>
                </select>
              </label>
              <label>
                Credencial da conta de referência
                <input
                  type="password"
                  autoComplete="off"
                  required
                  minLength={8}
                  maxLength={4096}
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  disabled={!ready}
                />
              </label>
              {scenario !== 'protected_route' && (
                <label>
                  Credencial da conta sem acesso
                  <input
                    type="password"
                    autoComplete="off"
                    required
                    minLength={8}
                    maxLength={4096}
                    value={challenger}
                    onChange={(event) => setChallenger(event.target.value)}
                    disabled={!ready}
                  />
                </label>
              )}
              {scenario === 'revoked_session' && (
                <p>
                  Forneça um token que você já revogou ou expirou no ambiente de teste. O Qypher não
                  efetua logout, cria sessões nem altera o servidor.
                </p>
              )}
              <label>
                Rejeição esperada
                <select
                  aria-label="Rejeição esperada"
                  value={denied}
                  onChange={(event) => setDenied(Number(event.target.value))}
                  disabled={!ready}
                >
                  {[401, 403, 404].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Limite de requisições
                <input
                  type="number"
                  required
                  min={2}
                  max={8}
                  value={maxRequests}
                  onChange={(event) => setMaxRequests(Number(event.target.value))}
                  disabled={!ready}
                />
              </label>
              <label>
                Timeout por requisição (segundos)
                <input
                  type="number"
                  required
                  min={2}
                  max={15}
                  value={timeout}
                  onChange={(event) => setTimeout(Number(event.target.value))}
                  disabled={!ready}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={privateAllowed}
                  onChange={(event) => setPrivateAllowed(event.target.checked)}
                  disabled={!ready}
                />
                Permito acesso à rede local/privada deste ambiente de teste.
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  required
                  checked={synthetic}
                  onChange={(event) => setSynthetic(event.target.checked)}
                  disabled={!ready}
                />
                Confirmo uso exclusivo de contas e recursos fictícios fornecidos pelo proprietário.
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  required
                  checked={authorized}
                  onChange={(event) => setAuthorized(event.target.checked)}
                  disabled={!ready}
                />
                Tenho autorização explícita para executar este cenário neste escopo.
              </label>
              <button
                className="button primary"
                disabled={
                  !ready ||
                  !projectId ||
                  !authorized ||
                  !synthetic ||
                  (environment === 'local' && !privateAllowed)
                }
              >
                <Play size={14} />
                Executar cenário controlado
              </button>
            </div>
          </Panel>
        </form>
        <section className="source-results" aria-label="Resultados do laboratório">
          <div className="button-row">
            <button className="button danger" disabled={!w.activeLab} onClick={() => void stop()}>
              <Square size={14} />
              Interromper laboratório
            </button>
          </div>
          {run ? (
            <>
              <label className="source-run-selector">
                Execução de laboratório
                <select
                  value={run.id}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setMessage('');
                  }}
                >
                  {w.labRuns.map((item) => (
                    <option key={item.id} value={item.id}>
                      {scenarioLabel[item.scenario]} · {date(item.startedAt)}
                    </option>
                  ))}
                </select>
              </label>
              <StatusBadge value={run.status} />
              <h2>{verdictLabel[run.verdict]}</h2>
              <p>{run.reason}</p>
              <p>
                {run.requestCount} / {run.maxRequests} requisições · {scenarioLabel[run.scenario]}
              </p>
              {run.error && <p role="alert">{run.error}</p>}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Identidade</th>
                      <th>Requisição</th>
                      <th>Esperado</th>
                      <th>Observado</th>
                      <th>Marcador</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.requests.map((request, index) => (
                      <tr key={index}>
                        <td>{request.identity}</td>
                        <td>
                          <code>
                            {request.method} {request.url}
                          </code>
                        </td>
                        <td>{request.expected}</td>
                        <td>
                          {request.status ?? 'Sem resposta'} · {request.elapsedMs} ms
                        </td>
                        <td>{request.markerObserved ? 'Presente' : 'Não observado'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>Como corrigir e verificar</h3>
              <p>
                Aplique negação por padrão e valide identidade, permissão e propriedade do recurso
                em cada requisição no servidor. Revise expiração e revogação de tokens no provedor.
                Repita o cenário com as mesmas contas e o recurso fictício; o resultado vale apenas
                para esse cenário.
              </p>
              <CodeView
                label="lab-evidence.json"
                value={{
                  scenario: run.scenario,
                  environment: run.environment,
                  verdict: run.verdict,
                  requests: run.requests,
                  limits: { maxRequests: run.maxRequests, timeoutSeconds: run.timeoutSeconds },
                }}
              />
              <div className="button-row source-actions">
                <button
                  className="button secondary"
                  disabled={run.status === 'running' || busy}
                  onClick={() => void exportRun()}
                >
                  <FileDown size={14} />
                  Exportar evidências do laboratório
                </button>
                <button
                  className="icon-button"
                  aria-label="Excluir execução de laboratório"
                  disabled={w.busy || busy}
                  onClick={() => setRemove(run.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <p role="status">{message}</p>
            </>
          ) : (
            <>
              <h2>Preparar uma simulação segura</h2>
              <ol>
                <li>
                  Crie duas contas de teste e um recurso fictício exclusivo da conta de referência.
                </li>
                <li>Inclua o marcador sintético na resposta desse recurso.</li>
                <li>Confirme qual status a conta sem acesso deve receber.</li>
                <li>Execute o cenário autorizado e revise as duas respostas.</li>
              </ol>
              <p>
                Não são executados brute force, busca de senhas, escrita, extração de dados privados
                ou descoberta automática de recursos.
              </p>
            </>
          )}
        </section>
      </div>
      {remove && (
        <ConfirmDialog
          title="Excluir execução de laboratório?"
          onCancel={() => setRemove(null)}
          onConfirm={() => void deleteRun()}
        >
          Apenas o histórico local desse cenário será excluído.
        </ConfirmDialog>
      )}
    </>
  );
}
