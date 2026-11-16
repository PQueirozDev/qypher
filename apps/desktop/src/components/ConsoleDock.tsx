import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp, Copy, Search, Terminal, Trash2 } from 'lucide-react';
import { native } from '../api';
import { copyText, sanitizeTechnicalText } from '../aiPrompt';
import type { Workspace } from '../useWorkspace';
import { commandCatalog } from '../commands';
export interface ConsoleMessage {
  id: number;
  at: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  message: string;
}
export function ConsoleDock({
  workspace: w,
  messages,
  execute,
  collapsed,
  toggle,
  clear,
  clearedAt,
}: {
  workspace: Workspace;
  messages: ConsoleMessage[];
  execute: (command: string) => void;
  collapsed: boolean;
  toggle: () => void;
  clear: () => void;
  clearedAt: string | null;
}) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyPosition, setHistoryPosition] = useState(-1);
  const draft = useRef('');
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('all');
  const [message, setMessage] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const http = w.scans[0];
  const source = w.sourceScans[0];
  const latest = [source, http, w.labRuns[0]]
    .filter((run) => run !== undefined)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  const needle = query.toLocaleLowerCase('pt-BR');
  const entries = [...(latest?.logs ?? []), ...messages]
    .filter((entry) => !clearedAt || Date.parse(entry.at) > Date.parse(clearedAt))
    .map((entry) => ({
      ...entry,
      event: sanitizeTechnicalText(entry.event, 100),
      message: sanitizeTechnicalText(entry.message),
    }))
    .filter(
      (entry) =>
        (level === 'all' || entry.level === level) &&
        `${entry.event} ${entry.message}`.toLocaleLowerCase('pt-BR').includes(needle),
    )
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-300);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [entries.length]);
  async function copy() {
    try {
      await copyText(
        entries
          .map(
            (entry) => `[${entry.at}] ${entry.level.toUpperCase()} ${entry.event} ${entry.message}`,
          )
          .join('\n'),
      );
      setMessage('Logs visíveis copiados.');
    } catch {
      setMessage('Não foi possível copiar os logs.');
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (input.trim()) {
      const command = input.trim();
      const safe = sanitizeTechnicalText(command, 256);
      setHistory((old) => (old.at(-1) === safe ? old : [...old, safe].slice(-40)));
      setHistoryPosition(-1);
      draft.current = '';
      execute(command);
      setInput('');
    }
  }
  return (
    <section className={`console-dock ${collapsed ? 'collapsed' : ''}`} aria-label="Console Qypher">
      <div className="console-tabs">
        <button className="console-tab" onClick={toggle}>
          <Terminal size={14} />
          Terminal <span>{w.busy ? 'EXECUTANDO' : native && w.ready ? 'LOCAL' : 'SEM IPC'}</span>
        </button>
        <span className="console-session">
          {latest ? `Execução ${latest.id.slice(0, 8)} · UTC` : 'Aguardando eventos reais'}
        </span>
        <button
          className="icon-button"
          onClick={() => void copy()}
          disabled={!entries.length}
          aria-label="Copiar logs visíveis"
        >
          <Copy size={14} />
        </button>
        <button
          className="icon-button"
          onClick={() => {
            clear();
            setMessage('Visualização limpa. O histórico foi preservado.');
          }}
          aria-label="Limpar visualização do terminal"
        >
          <Trash2 size={14} />
        </button>
        <button
          className="icon-button"
          onClick={toggle}
          aria-label={collapsed ? 'Expandir console' : 'Recolher console'}
        >
          {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="console-filters">
            <label>
              <Search size={13} />
              <input
                aria-label="Pesquisar eventos do terminal"
                placeholder="Pesquisar eventos…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              aria-label="Nível dos eventos do terminal"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
            >
              <option value="all">Todos os níveis</option>
              <option value="info">INFO</option>
              <option value="warn">WARN</option>
              <option value="error">ERROR</option>
            </select>
            <span aria-live="polite">{entries.length} eventos</span>
          </div>
          <div
            className="console-output"
            role="log"
            aria-label="Saída do motor"
            aria-relevant="additions"
          >
            {!entries.length && (
              <p className="console-empty">
                {native && w.ready
                  ? 'Nenhum evento nesta visualização.'
                  : 'Prévia web: use o aplicativo desktop para conectar o motor.'}
              </p>
            )}
            {entries.map((entry, index) => (
              <div
                className={`console-log ${entry.level}`}
                key={`${entry.at}-${entry.event}-${index}`}
              >
                <time title={entry.at}>[{entry.at.slice(11, 19)}]</time>
                <b>{entry.level.toUpperCase()}</b>
                <span>{entry.event}</span>
                <p>{entry.message}</p>
              </div>
            ))}
            <div ref={end} />
          </div>
          <form className="console-prompt" onSubmit={submit}>
            <span>qypher</span>
            <b>›</b>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp' && history.length) {
                  event.preventDefault();
                  if (historyPosition === -1) draft.current = input;
                  const next = Math.min(historyPosition + 1, history.length - 1);
                  setHistoryPosition(next);
                  setInput(history[history.length - 1 - next]);
                } else if (event.key === 'ArrowDown' && historyPosition >= 0) {
                  event.preventDefault();
                  const next = historyPosition - 1;
                  setHistoryPosition(next);
                  setInput(next < 0 ? draft.current : history[history.length - 1 - next]);
                } else if (event.key === 'Tab' && input.trim() && !input.trim().includes(' ')) {
                  const matches = commandCatalog.filter((item) =>
                    item.command.startsWith(input.trim().toLowerCase()),
                  );
                  if (matches.length) {
                    event.preventDefault();
                    setInput(matches[0].command);
                    if (matches.length > 1)
                      setMessage(`Comandos: ${matches.map((item) => item.command).join(' · ')}`);
                  }
                } else if (event.key === 'Escape') {
                  setInput('');
                  setHistoryPosition(-1);
                } else if (
                  event.ctrlKey &&
                  !event.shiftKey &&
                  event.key.toLowerCase() === 'c' &&
                  !window.getSelection()?.toString()
                ) {
                  event.preventDefault();
                  execute('cancel');
                  setInput('');
                }
              }}
              maxLength={256}
              spellCheck={false}
              autoComplete="off"
              aria-label="Comando interno do Qypher"
              placeholder="help · scan https://seu-projeto.com · repo · lab"
            />
            <span className="prompt-key">↑ ↓ HISTÓRICO · TAB · ENTER</span>
          </form>
          {message && (
            <p className="console-message" role="status">
              {message}
            </p>
          )}
        </>
      )}
    </section>
  );
}
