import { useState } from 'react';
import {
  Braces,
  Cookie,
  FileCheck2,
  FileJson2,
  GitCompareArrows,
  Hash,
  KeyRound,
  Shield,
} from 'lucide-react';
import { analyzeCookie, analyzeCsp, decodeJwt, diffLines, hashBytes, readSarif } from '../tools';
import { PageTitle, Panel } from './ui';
const tools = [
  {
    id: 'jwt',
    title: 'JWT decoder',
    icon: KeyRound,
    note: 'Decodificação local, sem verificar assinatura.',
  },
  {
    id: 'hash',
    title: 'Hash & integridade',
    icon: Hash,
    note: 'SHA-256 / SHA-512 para texto ou arquivo.',
  },
  {
    id: 'cookie',
    title: 'Cookie analyzer',
    icon: Cookie,
    note: 'Revisão estática de atributos de Set-Cookie.',
  },
  { id: 'csp', title: 'CSP viewer', icon: Shield, note: 'Diretivas, fontes e pontos de atenção.' },
  {
    id: 'diff',
    title: 'HTTP response diff',
    icon: GitCompareArrows,
    note: 'Compare conjuntos de linhas de duas respostas.',
  },
  {
    id: 'sarif',
    title: 'SARIF reader',
    icon: FileJson2,
    note: 'Relatórios SARIF 2.1.0, sem carregar recursos.',
  },
];
export function Tools() {
  const [tool, setTool] = useState('jwt');
  const [input, setInput] = useState('');
  const [other, setOther] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [algorithm, setAlgorithm] = useState<'SHA-256' | 'SHA-512'>('SHA-256');
  const [busy, setBusy] = useState(false);
  const [expected, setExpected] = useState('');
  const [digest, setDigest] = useState('');
  const active = tools.find((t) => t.id === tool)!;
  async function run() {
    setError('');
    setBusy(true);
    setOutput('');
    setDigest('');
    try {
      let result: unknown;
      if (tool === 'jwt') result = decodeJwt(input);
      else if (tool === 'cookie') result = analyzeCookie(input);
      else if (tool === 'csp') result = analyzeCsp(input);
      else if (tool === 'diff') result = diffLines(input, other);
      else if (tool === 'sarif') result = readSarif(input);
      else {
        const hash = await hashBytes(new TextEncoder().encode(input), algorithm);
        setDigest(hash);
        result = { algorithm, hash };
      }
      setOutput(JSON.stringify(result, null, 2));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function file(file?: File) {
    if (!file) return;
    setError('');
    setOutput('');
    setDigest('');
    setBusy(true);
    try {
      const max = tool === 'sarif' ? 5 * 1024 * 1024 : 25 * 1024 * 1024;
      if (file.size > max) throw new Error(`Arquivo excede ${max / 1024 / 1024} MiB.`);
      if (tool === 'sarif') setOutput(JSON.stringify(readSarif(await file.text()), null, 2));
      else {
        const hash = await hashBytes(new Uint8Array(await file.arrayBuffer()), algorithm);
        setDigest(hash);
        setOutput(JSON.stringify({ file: file.name, bytes: file.size, algorithm, hash }, null, 2));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        tag="FERRAMENTAS / UTILITÁRIOS LOCAIS"
        title="Utilitários locais"
        description="Processamento local e independente do scanner. Nenhum dado destes utilitários é salvo ou enviado à rede."
      />
      <div className="tool-grid">
        {tools.map(({ id, title, icon: Icon, note }) => (
          <button
            key={id}
            className={`tool-card ${tool === id ? 'selected' : ''}`}
            disabled={busy}
            aria-pressed={tool === id}
            onClick={() => {
              setTool(id);
              setInput('');
              setOther('');
              setOutput('');
              setDigest('');
              setExpected('');
              setError('');
            }}
          >
            <Icon size={20} />
            <strong>{title}</strong>
            <p>{note}</p>
          </button>
        ))}
      </div>
      <Panel title={active.title} meta={<Braces size={16} />}>
        <div className="tool-editor">
          {tool === 'hash' && (
            <label>
              Algoritmo
              <select
                value={algorithm}
                disabled={busy}
                onChange={(e) => {
                  setAlgorithm(e.target.value as 'SHA-256' | 'SHA-512');
                  setDigest('');
                  setOutput('');
                  setError('');
                }}
              >
                <option>SHA-256</option>
                <option>SHA-512</option>
              </select>
            </label>
          )}
          {tool === 'jwt' && (
            <div className="notice warning">
              <KeyRound size={18} />
              <p>
                A assinatura NÃO é verificada. Claims decodificadas são dados não confiáveis. Evite
                colar tokens de produção em capturas de tela.
              </p>
            </div>
          )}
          <label>
            {tool === 'diff'
              ? 'Resposta anterior'
              : tool === 'jwt'
                ? 'Token JWT'
                : tool === 'cookie'
                  ? 'Cabeçalho Set-Cookie'
                  : tool === 'csp'
                    ? 'Content-Security-Policy'
                    : tool === 'sarif'
                      ? 'Conteúdo SARIF (JSON)'
                      : 'Texto UTF-8'}
            <textarea
              value={input}
              disabled={busy}
              maxLength={tool === 'sarif' ? 5 * 1024 * 1024 : 100000}
              spellCheck={false}
              onChange={(e) => {
                setInput(e.target.value);
                setDigest('');
                setOutput('');
                setError('');
              }}
              placeholder={tool === 'jwt' ? 'eyJ…' : 'Cole o conteúdo para analisar…'}
              rows={6}
            />
          </label>
          {tool === 'diff' && (
            <label>
              Resposta atual
              <textarea
                value={other}
                disabled={busy}
                onChange={(e) => {
                  setOther(e.target.value);
                  setOutput('');
                  setError('');
                }}
                maxLength={100000}
                spellCheck={false}
                rows={6}
              />
            </label>
          )}
          <div className="button-row">
            <button
              className="button primary"
              disabled={busy || !input.trim()}
              onClick={() => void run()}
            >
              {busy ? 'Processando…' : 'Analisar localmente'}
            </button>
            {(tool === 'hash' || tool === 'sarif') && (
              <label className="button secondary file-button">
                <FileCheck2 size={16} />
                Escolher arquivo
                <input
                  aria-label="Escolher arquivo local"
                  type="file"
                  accept={tool === 'sarif' ? '.json,.sarif' : undefined}
                  disabled={busy}
                  onChange={(e) => {
                    const selected = e.target.files?.[0];
                    e.target.value = '';
                    void file(selected);
                  }}
                />
              </label>
            )}
          </div>
          {tool === 'hash' && (
            <label>
              Hash esperado (opcional)
              <input
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                placeholder="Compare o hash calculado com uma fonte confiável"
              />
              {digest && expected.trim() && (
                <small
                  className={
                    digest === expected.trim().toLowerCase() ? 'success-message' : 'error-text'
                  }
                >
                  {digest === expected.trim().toLowerCase()
                    ? 'Os hashes coincidem.'
                    : 'Os hashes NÃO coincidem.'}
                </small>
              )}
            </label>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {output && (
            <div className="tool-output">
              <div className="eyebrow">SAÍDA / LOCAL</div>
              <pre tabIndex={0}>{output}</pre>
            </div>
          )}
        </div>
      </Panel>
      <p className="footnote">
        O inspector HTTP e os certificados observados ficam nos detalhes de cada auditoria. Os
        utilitários acima não iniciam requisições.
      </p>
    </>
  );
}
