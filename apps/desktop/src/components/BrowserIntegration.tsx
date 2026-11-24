import { useEffect, useState } from 'react';
import { api, native, type BrowserIntegrationStatus } from '../api';

// Liga ou desliga o host de Native Messaging usado pela extensão de navegador.
// Nada é registrado sem este clique; desligar remove os registros do usuário atual.
export function BrowserIntegration() {
  const [status, setStatus] = useState<BrowserIntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!native) return;
    api
      .browserIntegrationStatus()
      .then(setStatus)
      .catch(() => setMessage('Não foi possível ler o estado da integração.'));
  }, []);

  async function toggle(enabled: boolean) {
    setBusy(true);
    setMessage('');
    try {
      const next = await api.setBrowserIntegration(enabled);
      setStatus(next);
      setMessage(
        enabled
          ? `Integração ativada para ${next.browsers.join(', ') || 'nenhum navegador encontrado'}.`
          : 'Integração removida dos navegadores.',
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!native)
    return (
      <p className="padded muted-text">
        Disponível no aplicativo desktop. A extensão conversa apenas com o Qypher instalado neste
        computador.
      </p>
    );
  return (
    <div className="padded browser-integration">
      <p>
        A extensão analisa de forma passiva a aba aberta (cabeçalhos e HTML que o navegador já
        recebeu), sem novas requisições. Análises completas continuam exigindo sua autorização aqui
        no app.
      </p>
      <div className="button-row">
        {status?.enabled ? (
          <button className="button secondary" disabled={busy} onClick={() => void toggle(false)}>
            Desativar integração
          </button>
        ) : (
          <button className="button primary" disabled={busy} onClick={() => void toggle(true)}>
            Ativar integração com o navegador
          </button>
        )}
        <span className="muted-text" role="status">
          {status === null
            ? 'Verificando…'
            : status.enabled
              ? `Ativa: ${status.browsers.join(', ')}`
              : 'Desativada'}
        </span>
      </div>
      {status && (
        <p className="muted-text">
          ID esperado da extensão (Chromium): <code>{status.chromeExtensionId}</code>
        </p>
      )}
      {message && <p className="muted-text">{message}</p>}
    </div>
  );
}
