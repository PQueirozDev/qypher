import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp, Terminal, Trash2 } from 'lucide-react';
import { api, native } from '../api';
import { sanitizeTechnicalText } from '../aiPrompt';
import { usableScore } from '../assessment';
import { severityLabel, type ScanConfig, type Severity } from '../types';
import type { Workspace } from '../useWorkspace';
import { APP_VERSION } from '../startup';
import { COMMANDS, resolveCommand, parseScanArgs, completions } from '../terminalCommands';
import { normalizeTarget } from './Home';

type Line = { text: string; cls?: string; pre?: boolean };
const PROMPT = 'qypher@local:~$';
const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/;
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const severityClass: Record<Severity, string> = {
  high: 't-bad',
  medium: 't-warn',
  low: 't-low',
  info: 't-info',
  unrated: 't-muted',
};
const order: Severity[] = ['high', 'medium', 'low', 'info', 'unrated'];

const BANNER = String.raw`
  ██████  ██    ██ ██████  ██   ██ ███████ ██████
 ██    ██  ██  ██  ██   ██ ██   ██ ██      ██   ██
 ██    ██   ████   ██████  ███████ █████   ██████
 ██ ▄▄ ██    ██    ██      ██   ██ ██      ██   ██
  ██████     ██    ██      ██   ██ ███████ ██   ██
    ▀▀`;

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function TerminalMode({
  workspace: w,
  locked,
  navigate,
  unlock,
  lock,
  variant = 'full',
  collapsed = false,
  onToggle,
}: {
  workspace: Workspace;
  locked: boolean;
  navigate: (id: string) => void;
  unlock: () => void;
  lock: () => void;
  variant?: 'full' | 'dock';
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const isDock = variant === 'dock';
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIndex, setHistIndex] = useState(-1);
  const [pending, setPending] = useState<{ target: URL; deep: boolean } | null>(null);
  const [scanId, setScanId] = useState('');
  const [spin, setSpin] = useState(0);
  const [clock, setClock] = useState('');
  const seenLogs = useRef(0);
  const didBoot = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scan = scanId ? w.scans.find((s) => s.id === scanId) : undefined;

  function push(...entries: Line[]) {
    setLines((old) => [...old.slice(-500), ...entries]);
  }

  // Sequência de inicialização (apresentação da interface, não verificações do motor).
  useEffect(() => {
    if (didBoot.current) return;
    didBoot.current = true;
    const seq: Line[] = isDock
      ? [
          { text: `qypher terminal · v${APP_VERSION} · sessão local`, cls: 't-accent' },
          { text: "mesmo motor da tela cheia · digite 'ajuda' · 'lock' abre em tela cheia", cls: 't-muted' },
          { text: '' },
        ]
      : [
          { text: BANNER, cls: 't-accent', pre: true },
          { text: 'QYPHER SECURITY WORKSPACE', cls: 't-accent' },
          { text: '━'.repeat(42), cls: 't-muted' },
          { text: '[BOOT] inicializando ambiente…', cls: 't-muted' },
          { text: '[ OK ] interface de terminal', cls: 't-ok' },
          { text: '[ OK ] registro de comandos', cls: 't-ok' },
          { text: '[ OK ] motor de ascii', cls: 't-ok' },
          { text: '[ OK ] preparando workspace', cls: 't-ok' },
          { text: '[ OK ] configuração local', cls: 't-ok' },
          { text: '[ OK ] pronto', cls: 't-ok' },
          { text: '' },
          { text: `QYPHER v${APP_VERSION} · local-first · sem telemetria`, cls: 't-accent' },
          { text: 'De VibeCoders para VibeCoders.', cls: 't-dim' },
          { text: '' },
          {
            text: "digite 'ajuda' para ver os comandos · 'unlock' para abrir o workspace",
            cls: 't-muted',
          },
          { text: '' },
        ];
    if (reduceMotion()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLines(seq);
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      const item = seq[i];
      if (!item) {
        clearInterval(id);
        return;
      }
      setLines((old) => [...old, item]);
      i++;
    }, 85);
    return () => clearInterval(id);
  }, [isDock]);

  useEffect(() => {
    bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight);
  }, [lines]);

  // Relógio ao vivo do HUD (informação, não animação decorativa).
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('pt-BR'));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // No dock, foca o input ao expandir (sem roubar foco ao montar recolhido).
  useEffect(() => {
    if (isDock && !collapsed) inputRef.current?.focus();
  }, [isDock, collapsed]);

  const running = scan?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setSpin((s) => s + 1), 90);
    return () => clearInterval(timer);
  }, [running]);

  function finishScan() {
    if (!scan) return;
    const id = scanId;
    setScanId('');
    const score = usableScore(scan);
    const findings = [...scan.findings].sort(
      (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
    );
    push({ text: '' });
    if (scan.error) push({ text: `  ! ${sanitizeTechnicalText(scan.error)}`, cls: 't-warn' });
    push({ text: `  ┌─ resultado ${id.slice(0, 8)} ${'─'.repeat(26)}`, cls: 't-muted' });
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
    push({ text: `  └${'─'.repeat(39)}`, cls: 't-muted' });
    push({
      text: "  'findings' abre os achados no workspace para evidências e correções.",
      cls: 't-muted',
    });
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
      text: `  [+] varredura ${deep ? 'profunda' : 'rápida'} de ${origin}…`,
      cls: 't-accent',
    });
    setScanId(await api.startScan(config));
  }

  function openGui(page: string) {
    if (locked) {
      push({ text: '  [+] abrindo workspace…', cls: 't-ok' });
      unlock();
      setTimeout(() => navigate(page), reduceMotion() ? 0 : 80);
    } else {
      navigate(page);
    }
  }

  function doUnlock() {
    if (!locked) {
      push({ text: '  workspace já está aberto.', cls: 't-muted' });
      navigate('home');
      return;
    }
    push({ text: '  [+] preparando workspace…', cls: 't-ok' });
    push({ text: '  [+] restaurando navegação…', cls: 't-ok' });
    push({ text: '  ACCESS GRANTED', cls: 't-accent' });
    setTimeout(() => unlock(), reduceMotion() ? 0 : 600);
  }

  async function handle(raw: string) {
    const line = raw.trim();
    push({ text: `${PROMPT} ${raw}`, cls: 't-prompt-echo' });
    if (!line) return;

    // Confirmação de autorização pendente.
    if (pending) {
      const yes = /^(s|sim|y|yes)$/i.test(line);
      const { target, deep } = pending;
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

    const [rawCmd, ...rest] = line.split(/\s+/);
    const cmd = resolveCommand(rawCmd);

    switch (cmd) {
      case 'help':
        push({ text: 'comandos disponíveis:', cls: 't-muted' });
        COMMANDS.forEach((c) =>
          push({ text: `  ${(c.name + ' ' + (c.args ?? '')).padEnd(26)} ${c.hint}` }),
        );
        push({ text: '' });
        break;
      case 'clear':
        setLines([]);
        break;
      case 'version':
        push({ text: `  QYPHER v${APP_VERSION}`, cls: 't-accent' }, { text: '' });
        break;
      case 'about':
        push(
          { text: '  QYPHER — análise de segurança local', cls: 't-accent' },
          { text: '  Encontra arquivos expostos, falhas de HTTP/TLS e segredos vazados' },
          { text: '  em sites autorizados e em código local. Rust + Tauri + React.' },
          { text: '  De VibeCoders para VibeCoders.', cls: 't-dim' },
          { text: '  github.com/PQueirozDev/qypher', cls: 't-info' },
          { text: '' },
        );
        break;
      case 'status':
        push(
          { text: '  QYPHER / STATUS', cls: 't-accent' },
          {
            text: `  motor      ${native && w.ready ? 'conectado' : 'desconectado — abra o app desktop'}`,
            cls: native && w.ready ? 't-ok' : 't-warn',
          },
          { text: `  análise    ${running ? 'em execução' : 'ociosa'}` },
          { text: `  interface  ${locked ? 'terminal (bloqueada)' : 'workspace (desbloqueada)'}` },
          { text: `  análises   ${w.scans.length} no histórico local` },
          { text: `  versão     ${APP_VERSION} · local-first · sem telemetria`, cls: 't-dim' },
          { text: '' },
        );
        break;
      case 'unlock':
        doUnlock();
        break;
      case 'lock':
        if (locked) push({ text: '  já está no modo terminal.', cls: 't-muted' });
        else {
          push({ text: '  [+] recolhendo interface…', cls: 't-ok' });
          setTimeout(() => lock(), reduceMotion() ? 0 : 300);
        }
        break;
      case 'findings':
        openGui('findings');
        break;
      case 'code':
        openGui('source');
        break;
      case 'report':
        openGui('reports');
        break;
      case 'lab':
        openGui('lab');
        break;
      case 'history': {
        if (!w.scans.length) {
          push({ text: '  nenhuma análise no histórico.', cls: 't-muted' });
        } else {
          push({ text: '  ID        STATUS      ALVO', cls: 't-muted' });
          w.scans.slice(0, 12).forEach((s) => {
            const name = w.projects.find((p) => p.id === s.config.projectId)?.name ?? s.config.url;
            push({
              text: `  ${s.id.slice(0, 8)}  ${s.status.padEnd(10)} ${sanitizeTechnicalText(name)}`,
            });
          });
          push({ text: "  'unlock' abre o histórico completo no workspace.", cls: 't-muted' });
        }
        push({ text: '' });
        break;
      }
      case 'cancel':
        if (running && scan) {
          await api.cancelScan(scan.id).catch(() => {});
          push({ text: '  cancelamento solicitado.', cls: 't-warn' });
        } else {
          push({ text: '  nenhuma análise ativa.', cls: 't-muted' });
        }
        break;
      case 'scan': {
        if (!native || !w.ready) {
          push({
            text: '  motor desconectado. abra o aplicativo desktop para executar varreduras.',
            cls: 't-bad',
          });
          break;
        }
        if (running) {
          push({ text: '  já existe uma análise em andamento.', cls: 't-warn' });
          break;
        }
        // Parsing do modo: --mode quick|deep, --deep/--profundo, --quick/--rapido.
        const { url: urlArg, deep } = parseScanArgs(rest);
        if (!urlArg) {
          push({ text: '  uso: scan <url> [--mode quick|deep]', cls: 't-muted' });
          break;
        }
        try {
          const target = normalizeTarget(urlArg);
          setPending({ target, deep });
          push(
            { text: '  QYPHER / AUTORIZAÇÃO DO ALVO', cls: 't-accent' },
            { text: `  alvo:  ${target.origin}` },
            { text: `  modo:  ${deep ? 'varredura profunda' : 'quick scan'}` },
            {
              text: '  Analise apenas sistemas seus ou que você tem autorização explícita para testar.',
              cls: 't-dim',
            },
            { text: '  confirmar autorização? [s/N]', cls: 't-warn' },
          );
        } catch (e) {
          push({ text: `  ${String(e).replace(/^(TypeError|Error): /, '')}`, cls: 't-bad' });
        }
        break;
      }
      default:
        push(
          { text: `  comando não encontrado: ${rawCmd}`, cls: 't-bad' },
          { text: "  digite 'ajuda' para a lista de comandos.", cls: 't-muted' },
        );
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = input;
    setInput('');
    if (value.trim()) {
      setHistory((h) => [...h.slice(-80), value]);
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
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const cur = input.trimStart();
      if (!cur || cur.includes(' ')) return;
      const matches = completions(cur);
      if (matches.length === 1) {
        setInput(matches[0] + ' ');
      } else if (matches.length > 1) {
        push({ text: `${PROMPT} ${cur}`, cls: 't-prompt-echo' });
        push({ text: '  ' + matches.join('   '), cls: 't-muted' });
      }
    }
  }

  const engineOn = native && w.ready;
  const body = (
    <div className="tui-body" ref={bodyRef}>
      {lines.map((l, i) => (
        <div key={i} className={`tui-line ${l.cls ?? ''}`}>
          {l.pre ? <pre>{l.text}</pre> : l.text}
        </div>
      ))}
      <form className="tui-input" onSubmit={submit}>
        <span className="tui-ps">
          <span className="ps-user">qypher</span>
          <span className="ps-at">@local</span>
          <span className="ps-path">:~$</span>
        </span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
          autoComplete="off"
          autoFocus={!isDock}
          placeholder={running ? '' : "digite 'ajuda' e pressione enter"}
          aria-label="Terminal do Qypher"
        />
      </form>
    </div>
  );

  // Variante encaixada (terminal global retrátil, Ctrl+J) — mesmo motor, outra moldura.
  if (isDock) {
    return (
      <section
        className={`term-dock ${collapsed ? 'collapsed' : ''}`}
        aria-label="Terminal Qypher"
        onClick={() => !collapsed && inputRef.current?.focus()}
      >
        <div className="term-dock-bar">
          <button className="term-dock-tab" onClick={onToggle} aria-expanded={!collapsed}>
            <Terminal size={13} />
            <b>terminal</b>
            <span className={`hud-dot ${engineOn ? 'on' : ''}`} />
            <span className="term-dock-state">{engineOn ? 'local' : 'sem ipc'}</span>
          </button>
          <span className="term-dock-host">qypher@local</span>
          {running && (
            <span className="term-dock-run">
              {SPIN[spin % SPIN.length]} {scan?.requestCount}/{scan?.config.maxRequests}
            </span>
          )}
          <span className="term-dock-spacer" />
          <span className="term-dock-clock">{clock}</span>
          <button
            className="icon-button"
            onClick={(e) => {
              e.stopPropagation();
              setLines([]);
            }}
            aria-label="Limpar terminal"
          >
            <Trash2 size={14} />
          </button>
          <button
            className="icon-button"
            onClick={onToggle}
            aria-label={collapsed ? 'Expandir terminal' : 'Recolher terminal'}
          >
            {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
        {!collapsed && body}
      </section>
    );
  }

  return (
    <div className="tui" onClick={() => inputRef.current?.focus()}>
      <div className="tui-scan" aria-hidden="true" />
      <div className="tui-hud" aria-hidden="true">
        <b className="hud-tag">QYPHER</b>
        <span className="hud-sep">//</span>
        <span className="hud-host">qypher@local</span>
        <span className="hud-pill">
          node <b>v{APP_VERSION}</b>
        </span>
        <span className="hud-pill">local-first</span>
        <span className="hud-pill">sem telemetria</span>
        <span className="hud-spacer" />
        <span className="hud-pill">
          <span className={`hud-dot ${engineOn ? 'on' : ''}`} />
          {engineOn ? 'motor online' : 'motor offline'}
        </span>
        <span className="hud-clock">{clock}</span>
      </div>
      {body}
      <div className="tui-status">
        <span>{engineOn ? '● motor conectado' : '○ motor desconectado'}</span>
        <span>
          {running
            ? `${SPIN[spin % SPIN.length]} analisando… ${scan?.requestCount}/${scan?.config.maxRequests}`
            : locked
              ? 'terminal · bloqueado'
              : 'pronto'}
          {!running && <span className="tui-cursor" aria-hidden="true" />}
        </span>
        <span>help · scan · findings · unlock</span>
      </div>
    </div>
  );
}
