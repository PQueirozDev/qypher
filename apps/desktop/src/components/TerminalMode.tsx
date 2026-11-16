import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, native } from '../api';
import { sanitizeTechnicalText } from '../aiPrompt';
import { usableScore } from '../assessment';
import { severityLabel, type ScanConfig, type Severity } from '../types';
import type { Workspace } from '../useWorkspace';
import { normalizeTarget } from './Home';

type Line = { text: string; cls?: string; pre?: boolean };
const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/;
const severityClass: Record<Severity, string> = {
  high: 't-bad',
  medium: 't-warn',
  low: 't-low',
  info: 't-info',
  unrated: 't-muted',
};

const BANNER = String.raw`
  ██████  ██    ██ ██████  ██   ██ ███████ ██████
 ██    ██  ██  ██  ██   ██ ██   ██ ██      ██   ██
 ██    ██   ████   ██████  ███████ █████   ██████
 ██ ▄▄ ██    ██    ██      ██   ██ ██      ██   ██
  ██████     ██    ██      ██   ██ ███████ ██   ██
    ▀▀`;

const HELP: Line[] = [
  { text: 'comandos disponíveis:', cls: 't-muted' },
  { text: '  analisar <url> [--rapido]   varre um site autorizado (profundo por padrão)' },
  { text: '  cancelar                    interrompe a análise em andamento' },
  { text: '  historico                   lista as últimas análises' },
  { text: '  limpar                      limpa a tela' },
  { text: '  gui                         abre o modo gráfico' },
  { text: '  ajuda                       mostra esta lista' },
];

export function TerminalMode({ workspace: w, exit }: { workspace: Workspace; exit: () => void }) {
  const [lines, setLines] = useState<Line[]>([
    { text: BANNER, cls: 't-accent', pre: true },
    { text: 'análise de segurança local · digite "ajuda" para começar', cls: 't-muted' },
    { text: '' },
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIndex, setHistIndex] = useState(-1);
  const [pending, setPending] = useState<{ target: URL; deep: boolean } | null>(null);
  const [scanId, setScanId] = useState('');
  const seenLogs = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scan = scanId ? w.scans.find((s) => s.id === scanId) : undefined;

  function push(...entries: Line[]) {
    setLines((old) => [...old.slice(-400), ...entries]);
  }

  useEffect(() => {
    bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight);
  }, [lines]);

  function finishScan() {
    if (!scan) return;
    const id = scanId;
    setScanId('');
    const score = usableScore(scan);
    const findings = [...scan.findings].sort(
      (a, b) =>
        ['high', 'medium', 'low', 'info', 'unrated'].indexOf(a.severity) -
        ['high', 'medium', 'low', 'info', 'unrated'].indexOf(b.severity),
    );
    push({ text: '' });
    if (scan.error) push({ text: `  ! ${sanitizeTechnicalText(scan.error)}`, cls: 't-warn' });
    push({
      text: `  ┌─ resultado ${id.slice(0, 8)} ${'─'.repeat(28)}`,
      cls: 't-muted',
    });
    push({
      text: `  │ nota de postura: ${score ?? '—'}/100`,
      cls: score !== null && score < 60 ? 't-bad' : 't-ok',
    });
    if (!findings.length) {
      push({ text: '  │ nenhuma fraqueza encontrada nas verificações executadas.', cls: 't-ok' });
    } else {
      push({ text: `  │ ${findings.length} achado(s):`, cls: 't-muted' });
      findings.slice(0, 40).forEach((f) => {
        push({
          text: `  │   [${severityLabel[f.severity].toUpperCase().padEnd(5)}] ${sanitizeTechnicalText(f.title)}`,
          cls: severityClass[f.severity],
        });
      });
    }
    push({ text: `  └${'─'.repeat(41)}`, cls: 't-muted' });
    push({ text: '  abra o modo gráfico ("gui") para evidências e correções.', cls: 't-muted' });
    push({ text: '' });
  }

  // Transmite os logs do motor enquanto a análise roda, como num terminal real.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!scan) return;
    const fresh = scan.logs.slice(seenLogs.current);
    if (fresh.length) {
      seenLogs.current = scan.logs.length;
      push(
        ...fresh.map((l) => ({
          text: `  ${l.at.slice(11, 19)}  ${sanitizeTechnicalText(l.message)}`,
          cls: l.level === 'warn' ? 't-warn' : l.level === 'error' ? 't-bad' : 't-muted',
        })),
      );
    }
    if (scan.status !== 'running' && scanId) {
      finishScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan?.logs.length, scan?.status]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function runScan(target: URL, deep: boolean) {
    const origin = target.origin;
    let project = w.projects.find((p) => {
      try {
        return new URL(p.url).origin === origin;
      } catch {
        return false;
      }
    });
    if (!project) {
      project = await api.createProject(target.hostname.slice(0, 80), `${origin}/`);
      await w.refresh();
    }
    const config: ScanConfig = {
      projectId: project.id,
      url: `${origin}${target.pathname}`,
      authorized: true,
      allowPrivate: privateHost.test(target.host),
      pathPrefix: target.pathname,
      maxRequests: deep ? 100 : 5,
      maxRedirects: 5,
      timeoutSeconds: 10,
      discovery: deep,
      activeChecks: deep,
    };
    seenLogs.current = 0;
    push({
      text: `  iniciando varredura ${deep ? 'profunda' : 'rápida'} de ${origin}…`,
      cls: 't-accent',
    });
    setScanId(await api.startScan(config));
  }

  async function handle(raw: string) {
    const line = raw.trim();
    push({ text: `qypher ❯ ${raw}`, cls: 't-prompt-echo' });
    if (!line) return;

    // Confirmação de autorização pendente.
    if (pending) {
      const yes = /^(s|sim|y|yes)$/i.test(line);
      const target = pending.target;
      const deep = pending.deep;
      setPending(null);
      if (!yes) {
        push({ text: '  análise cancelada.', cls: 't-muted' });
        return;
      }
      try {
        await runScan(target, deep);
      } catch (e) {
        push({ text: `  erro: ${String(e).replace(/^(TypeError|Error): /, '')}`, cls: 't-bad' });
      }
      return;
    }

    const [cmd, ...rest] = line.split(/\s+/);
    switch (cmd.toLowerCase()) {
      case 'ajuda':
      case 'help':
        push(...HELP, { text: '' });
        break;
      case 'limpar':
      case 'clear':
        setLines([]);
        break;
      case 'gui':
      case 'sair':
        exit();
        break;
      case 'historico':
      case 'history': {
        if (!w.scans.length) {
          push({ text: '  nenhuma análise no histórico.', cls: 't-muted' });
        } else {
          w.scans.slice(0, 10).forEach((s) => {
            const name = w.projects.find((p) => p.id === s.config.projectId)?.name ?? s.config.url;
            push({
              text: `  ${s.id.slice(0, 8)}  ${s.status.padEnd(10)} ${sanitizeTechnicalText(name)}`,
            });
          });
        }
        push({ text: '' });
        break;
      }
      case 'cancelar':
      case 'cancel':
        if (scan && scan.status === 'running') {
          await api.cancelScan(scan.id).catch(() => {});
          push({ text: '  cancelamento solicitado.', cls: 't-warn' });
        } else {
          push({ text: '  nenhuma análise ativa.', cls: 't-muted' });
        }
        break;
      case 'analisar':
      case 'scan': {
        if (!native || !w.ready) {
          push({ text: '  motor desconectado. abra o aplicativo desktop.', cls: 't-bad' });
          break;
        }
        if (scan && scan.status === 'running') {
          push({ text: '  já existe uma análise em andamento.', cls: 't-warn' });
          break;
        }
        const deep = !rest.includes('--rapido') && !rest.includes('--quick');
        const urlArg = rest.find((a) => !a.startsWith('--'));
        if (!urlArg) {
          push({ text: '  uso: analisar <url> [--rapido]', cls: 't-muted' });
          break;
        }
        try {
          const target = normalizeTarget(urlArg);
          setPending({ target, deep });
          push({
            text: `  confirme: você tem autorização para testar ${target.origin}? [s/n]`,
            cls: 't-warn',
          });
        } catch (e) {
          push({ text: `  ${String(e).replace(/^(TypeError|Error): /, '')}`, cls: 't-bad' });
        }
        break;
      }
      default:
        push({ text: `  comando desconhecido: ${cmd}. digite "ajuda".`, cls: 't-muted' });
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = input;
    setInput('');
    if (value.trim()) {
      setHistory((h) => [...h.slice(-50), value]);
      setHistIndex(-1);
    }
    void handle(value);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = histIndex < 0 ? history.length - 1 : Math.max(0, histIndex - 1);
      if (history[next] !== undefined) {
        setHistIndex(next);
        setInput(history[next]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIndex < 0) return;
      const next = histIndex + 1;
      if (next >= history.length) {
        setHistIndex(-1);
        setInput('');
      } else {
        setHistIndex(next);
        setInput(history[next]);
      }
    }
  }

  const running = scan?.status === 'running';
  return (
    <div className="tui" onClick={() => inputRef.current?.focus()}>
      <div className="tui-body" ref={bodyRef}>
        {lines.map((l, i) => (
          <div key={i} className={`tui-line ${l.cls ?? ''}`}>
            {l.pre ? <pre>{l.text}</pre> : l.text}
          </div>
        ))}
        <form className="tui-input" onSubmit={submit}>
          <span className="tui-ps">qypher ❯</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
            autoComplete="off"
            autoFocus
            aria-label="Terminal do Qypher"
          />
          <span className="tui-caret" />
        </form>
      </div>
      <div className="tui-status">
        <span>{native && w.ready ? '● motor conectado' : '○ motor desconectado'}</span>
        <span>
          {running ? `analisando… ${scan?.requestCount}/${scan?.config.maxRequests}` : 'pronto'}
        </span>
        <span>ajuda · analisar · historico · gui</span>
      </div>
    </div>
  );
}
