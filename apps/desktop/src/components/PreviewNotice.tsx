import { useState } from 'react';
import { Monitor, ArrowRight, Copy, X } from 'lucide-react';
import { native } from '../api';
import { copyText } from '../aiPrompt';
import type { Workspace } from '../useWorkspace';
export function PreviewNotice({
  workspace: w,
  navigate,
}: {
  workspace: Workspace;
  navigate: (page: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState('');
  if (native && w.ready) return null;
  async function copy() {
    try {
      await copyText('npm.cmd run desktop:preview');
      setMessage('Comando copiado. Execute na pasta do Qypher para abrir o motor desktop.');
    } catch {
      setMessage('Na pasta do projeto, execute: npm.cmd run desktop:preview');
    }
  }
  return (
    <section className="runtime-notice" aria-label="Disponibilidade do motor">
      <Monitor size={17} />
      <div>
        <strong>{native ? 'Conectando ao motor local' : 'Você está na prévia do navegador'}</strong>
        <span>
          {native
            ? 'O banco e os eventos precisam conectar antes de iniciar uma análise.'
            : 'Interface, terminal e ferramentas locais disponíveis. Scanners e diálogos de arquivos usam o aplicativo desktop.'}
        </span>
      </div>
      <button aria-label="Abrir ferramentas locais" onClick={() => navigate('tools')}>
        Ferramentas locais <ArrowRight size={13} />
      </button>
      {native ? (
        <button disabled={w.connecting} onClick={w.reconnect}>
          {w.connecting ? 'Conectando…' : 'Reconectar'}
        </button>
      ) : (
        <button onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          Como ativar o motor
        </button>
      )}
      {expanded && (
        <div className="runtime-instructions">
          <button
            className="icon-button"
            aria-label="Fechar instruções do motor"
            onClick={() => setExpanded(false)}
          >
            <X size={14} />
          </button>
          <h3>Abra a versão desktop com as funções nativas</h3>
          <p>
            No checkout local do Qypher, execute o comando abaixo. Ele usa o motor real e um perfil
            de prévia separado. Não há resultados de demonstração.
          </p>
          <code>npm.cmd run desktop:preview</code>
          <button onClick={() => void copy()}>
            <Copy size={14} />
            Copiar comando do desktop
          </button>
          <p role="status">{message}</p>
          <p>
            A prévia no navegador continua útil para utilitários locais e navegação. Para o primeiro
            build desktop, as dependências Rust e o toolchain do sistema precisam estar instalados.
          </p>
        </div>
      )}
    </section>
  );
}
