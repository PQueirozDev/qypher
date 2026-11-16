import { useState, type FormEvent } from 'react';
import { ArrowUpRight, FolderGit2, Plus, Trash2 } from 'lucide-react';
import { api, native } from '../api';
import type { Workspace } from '../useWorkspace';
import { ConfirmDialog, Empty, PageTitle, Panel } from './ui';
export function Projects({
  workspace: w,
  scanProject,
}: {
  workspace: Workspace;
  scanProject: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createProject(name, url);
      await w.refresh();
      setName('');
      setUrl('https://');
    } catch (e) {
      w.setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function deleteProject() {
    const id = remove;
    setRemove(null);
    if (!id) return;
    try {
      await api.deleteProject(id);
      await w.refresh();
    } catch (e) {
      w.setError(String(e));
    }
  }
  return (
    <>
      <PageTitle
        tag="TRABALHO / PROJETOS"
        title="Alvos autorizados"
        description="Organize alvos autorizados e mantenha um histórico por projeto."
      />
      <Panel title="Criar projeto" meta={<Plus size={16} />}>
        <form className="project-form" onSubmit={submit}>
          <label>
            Nome do projeto
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
              placeholder="Ex.: Portal da equipe"
            />
          </label>
          <label>
            URL base autorizada
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              maxLength={2048}
              placeholder="https://sua-aplicacao.com"
            />
            <small>HTTP(S), sem credenciais, parâmetros ou fragmentos.</small>
          </label>
          <button className="button primary" disabled={busy || !native || !w.ready}>
            <Plus size={16} />
            {busy ? 'Salvando…' : 'Criar projeto'}
          </button>
        </form>
      </Panel>
      <div className="section-label">
        SEUS PROJETOS <span>{w.projects.length.toString().padStart(2, '0')}</span>
      </div>
      {w.projects.length ? (
        <div className="project-grid">
          {w.projects.map((p) => (
            <article className="project-card" key={p.id}>
              <div className="card-top">
                <div className="list-icon">
                  <FolderGit2 size={22} />
                </div>
                <button
                  className="icon-button"
                  aria-label={`Excluir ${p.name}`}
                  disabled={w.busy}
                  onClick={() => setRemove(p.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <h2>{p.name}</h2>
              <code>{p.url}</code>
              <div className="project-card-footer">
                <small>
                  {w.scans.filter((s) => s.config.projectId === p.id).length} auditorias no
                  histórico recente
                </small>
                <button className="text-button" onClick={() => scanProject(p.id)}>
                  Auditar
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Panel title="Projetos">
          <Empty
            icon={FolderGit2}
            title="Nenhum projeto cadastrado"
            description="Adicione acima uma aplicação própria ou com autorização explícita. O Qypher não fará requisições ao criar um projeto."
          />
        </Panel>
      )}
      {remove && (
        <ConfirmDialog
          title="Excluir projeto e histórico?"
          onCancel={() => setRemove(null)}
          onConfirm={() => void deleteProject()}
        >
          O projeto e todas as auditorias vinculadas serão removidos do banco local. Esta ação não
          pode ser desfeita; relatórios já exportados permanecem no disco.
        </ConfirmDialog>
      )}
    </>
  );
}
