import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  Crosshair,
  Info,
  LockKeyhole,
  ShieldCheck,
  Square,
  Terminal,
} from 'lucide-react';
import { api, native } from '../api';
import type { Workspace } from '../useWorkspace';
import type { ScanConfig } from '../types';
import { PageTitle, Panel, StatusBadge } from './ui';
export function NewScan({
  workspace: w,
  projectId,
  openScan,
  createProject,
}: {
  workspace: Workspace;
  projectId: string;
  openScan: (id: string) => void;
  createProject: () => void;
}) {
  const initial = w.projects.find((p) => p.id === projectId) ?? w.projects[0];
  const [config, setConfig] = useState<ScanConfig>({
    projectId: initial?.id ?? '',
    url: initial?.url ?? '',
    authorized: false,
    allowPrivate: false,
    pathPrefix: '/',
    maxRequests: 3,
    maxRedirects: 2,
    timeoutSeconds: 10,
    discovery: false,
    activeChecks: false,
  });
  const [starting, setStarting] = useState(false);
  function update<K extends keyof ScanConfig>(key: K, value: ScanConfig[K]) {
    setConfig((c) => ({
      ...c,
      [key]: value,
      ...(key === 'pathPrefix' || key === 'allowPrivate' ? { authorized: false } : {}),
    }));
  }
  // Fases profundas mudam o que será enviado ao alvo: exigem nova confirmação e mais orçamento.
  function toggleDeep(key: 'discovery' | 'activeChecks', enabled: boolean) {
    setConfig((c) => {
      const next = { ...c, [key]: enabled, authorized: false };
      const needed = 6 + (next.discovery ? 30 : 0) + (next.activeChecks ? 4 : 0);
      return { ...next, maxRequests: enabled ? Math.max(c.maxRequests, needed) : c.maxRequests };
    });
  }
  async function start(e: FormEvent) {
    e.preventDefault();
    setStarting(true);
    try {
      const id = await api.startScan(config);
      openScan(id);
    } catch (e) {
      w.setError(String(e));
    } finally {
      setStarting(false);
    }
  }
  async function cancel() {
    if (w.active)
      try {
        await api.cancelScan(w.active.id);
      } catch (e) {
        w.setError(String(e));
      }
  }
  if (w.active)
    return (
      <>
        <PageTitle
          tag="MOTOR / AO VIVO"
          title="Auditoria em execução."
          description="A interface continua disponível. O cancelamento interrompe requisições e resolução DNS pendentes."
        />
        <Panel title="Console do motor" meta={<StatusBadge value="running" />}>
          <div className="live-info">
            <Terminal size={20} />
            <code>{w.active.config.url}</code>
            <button className="button danger" onClick={() => void cancel()}>
              <Square size={13} />
              Cancelar agora
            </button>
          </div>
          <div className="budget">
            <span>Orçamento utilizado</span>
            <b>
              {w.active.requestCount} / {w.active.config.maxRequests} requisições
            </b>
          </div>
          <div className="segments">
            {Array.from({ length: w.active.config.maxRequests }, (_, i) => (
              <i className={i < w.active!.requestCount ? 'filled' : ''} key={i} />
            ))}
          </div>
          <div className="terminal" role="log" aria-label="Logs do scanner">
            {w.active.logs.map((l, i) => (
              <p key={i}>
                <span title={l.at}>{String(i + 1).padStart(2, '0')}</span>
                {l.message}
              </p>
            ))}
          </div>
          <button className="text-button" onClick={() => openScan(w.active!.id)}>
            Ver resultados parciais <ArrowRight size={16} />
          </button>
        </Panel>
      </>
    );
  return (
    <>
      <PageTitle
        tag="AUDITORIA / NOVA ANÁLISE"
        title="Auditoria HTTP / TLS"
        description="Configure uma auditoria de baixo impacto. Todos os limites são aplicados pelo motor Rust."
      />
      <form onSubmit={start} className="scan-form">
        <div className="scan-form-main">
          <Panel title="01 / scope.json" meta={<Crosshair size={17} />}>
            {!w.projects.length ? (
              <div className="inline-note">
                <Info size={18} />
                <span>Cadastre um projeto para começar.</span>
                <button type="button" className="text-button" onClick={createProject}>
                  Criar projeto <ArrowRight size={14} />
                </button>
              </div>
            ) : null}
            <div className="form-fields">
              <label>
                Projeto
                <select
                  value={config.projectId}
                  required
                  onChange={(e) => {
                    const p = w.projects.find((p) => p.id === e.target.value);
                    setConfig((c) => ({
                      ...c,
                      projectId: e.target.value,
                      url: p?.url ?? '',
                      authorized: false,
                    }));
                  }}
                >
                  <option value="" disabled>
                    Selecione um projeto
                  </option>
                  {w.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                URL do alvo
                <input
                  type="url"
                  required
                  maxLength={2048}
                  value={config.url}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, url: e.target.value, authorized: false }))
                  }
                  placeholder="https://sua-aplicacao.com"
                />
                <small>
                  Somente a origem exata do projeto. Sem query, credenciais ou fragmentos.
                </small>
              </label>
              <label>
                Allowlist de caminho
                <input
                  value={config.pathPrefix}
                  onChange={(e) => update('pathPrefix', e.target.value)}
                  required
                  maxLength={1024}
                  placeholder="/"
                />
                <small>/ permite todos os caminhos da origem; /app permite /app e /app/…</small>
              </label>
            </div>
          </Panel>
          <Panel
            title="02 / detectors.registry"
            meta={<span className="badge status-completed">Baixo impacto</span>}
          >
            <div className="module-option">
              <div className="check-icon">
                <Check size={16} />
              </div>
              <div>
                <strong>Cabeçalhos de segurança</strong>
                <p>
                  HTTPS, força da CSP e do HSTS, clickjacking, cookies, CORS e divulgação técnica.
                </p>
              </div>
              <span className="module-tag">OBSERVACIONAL</span>
            </div>
            <div className="module-option">
              <div className="check-icon">
                <Check size={16} />
              </div>
              <div>
                <strong>Certificado e protocolo TLS</strong>
                <p>
                  Validade, chave e assinatura do certificado; TLS 1.0/1.1 e cifras fracas (usa 3
                  requisições do orçamento).
                </p>
              </div>
              <span className="module-tag">HANDSHAKE</span>
            </div>
            <label className="module-option module-toggle">
              <input
                type="checkbox"
                checked={config.discovery ?? false}
                onChange={(e) => toggleDeep('discovery', e.target.checked)}
              />
              <div>
                <strong>Exposição de arquivos e conteúdo</strong>
                <p>
                  Procura .git, .env, backups, dumps e painéis de debug expostos; analisa o HTML
                  atrás de bibliotecas vulneráveis, scripts sem SRI, conteúdo misto e credenciais.
                  Cerca de 30 requisições GET.
                </p>
              </div>
              <span className="module-tag">DESCOBERTA</span>
            </label>
            <label className="module-option module-toggle">
              <input
                type="checkbox"
                checked={config.activeChecks ?? false}
                onChange={(e) => toggleDeep('activeChecks', e.target.checked)}
              />
              <div>
                <strong>Testes ativos não destrutivos</strong>
                <p>
                  Verifica se o CORS reflete uma origem arbitrária ou aceita null, e se o servidor
                  anuncia PUT/DELETE ou responde a TRACE. Nada é alterado no alvo.
                </p>
              </div>
              <span className="module-tag">ATIVO</span>
            </label>
            <div className="inline-note">
              <Info size={16} />
              <span>
                Todo pedido gera tráfego no alvo. Sem crawling, payloads de exploração, envio de
                formulários, força bruta ou execução de JavaScript.
              </span>
            </div>
          </Panel>
          <Panel title="03 / limits.conf">
            <div className="limits-grid">
              <label>
                Máx. requisições
                <input
                  type="number"
                  min={1}
                  max={60}
                  required
                  value={config.maxRequests}
                  onChange={(e) => update('maxRequests', Number(e.target.value))}
                />
              </label>
              <label>
                Redirecionamentos
                <input
                  type="number"
                  min={0}
                  max={5}
                  required
                  value={config.maxRedirects}
                  onChange={(e) => update('maxRedirects', Number(e.target.value))}
                />
              </label>
              <label>
                Timeout / operação (s)
                <input
                  type="number"
                  min={2}
                  max={30}
                  required
                  value={config.timeoutSeconds}
                  onChange={(e) => update('timeoutSeconds', Number(e.target.value))}
                />
              </label>
            </div>
            <div className="form-fields compact">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.allowPrivate}
                  onChange={(e) => update('allowPrivate', e.target.checked)}
                />
                <span>
                  Autorizo também rede privada / localhost neste escopo.
                  <small>
                    Metadados de nuvem, link-local e faixas reservadas continuam bloqueados.
                  </small>
                </span>
              </label>
            </div>
          </Panel>
        </div>
        <aside className="scan-summary">
          <div className="summary-icon">
            <ShieldCheck size={28} />
          </div>
          <div className="eyebrow">AUTORIZAÇÃO OBRIGATÓRIA</div>
          <h2>Segurança com responsabilidade.</h2>
          <p>Audite somente aplicações suas ou para as quais tenha permissão explícita.</p>
          <ul className="check-list">
            <li>
              <Check size={14} /> Uma conexão por vez
            </li>
            <li>
              <Check size={14} /> DNS revalidado em cada salto
            </li>
            <li>
              <Check size={14} /> Corpo das respostas nunca é armazenado
            </li>
            <li>
              <Check size={14} /> Cancelamento imediato
            </li>
          </ul>
          <label className="checkbox-label authorization">
            <input
              type="checkbox"
              checked={config.authorized}
              required
              onChange={(e) => update('authorized', e.target.checked)}
            />
            <span>Confirmo minha autorização para analisar o alvo e os caminhos definidos.</span>
          </label>
          <button
            className="button primary wide"
            disabled={
              !native || !w.ready || !config.projectId || !config.authorized || starting || w.busy
            }
          >
            <Crosshair size={17} />
            {starting ? 'Iniciando…' : 'Iniciar auditoria'}
            <ArrowRight size={16} />
          </button>
          <div className="privacy-line">
            <LockKeyhole size={12} /> Execução e dados 100% locais
          </div>
        </aside>
      </form>
    </>
  );
}
