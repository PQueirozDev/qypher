import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Maximize2, Minus, ShieldAlert, X } from 'lucide-react';
import { api, native } from './api';
import { useWorkspace } from './useWorkspace';
import { Home } from './components/Home';
import { Projects } from './components/Projects';
import { NewScan } from './components/NewScan';
import { Results } from './components/Results';
import { History } from './components/History';
import { Reports } from './components/Reports';
import { Tools } from './components/Tools';
import { About, Settings } from './components/InfoPages';
import { SourceLab } from './components/SourceLab';
import { TerminalMode } from './components/TerminalMode';
import { Dashboard } from './components/Dashboard';
import { LabMode } from './components/LabMode';
import { CommandPalette } from './components/CommandPalette';
import { StatusBar } from './components/StatusBar';
import { UnlockTransition } from './components/UnlockTransition';
import { parseCommand } from './commands';
import { PreviewNotice } from './components/PreviewNotice';
import { applyMotionPreference, readMotionPreference } from './appearance';
import { startInTerminal } from './startup';

const navPrimary = [
  { id: 'terminal', label: 'terminal', accessible: 'Modo terminal' },
  { id: 'home', label: 'analisar', accessible: 'Analisar site' },
  { id: 'source', label: 'código', accessible: 'Análise de código' },
  { id: 'findings', label: 'achados', accessible: 'Achados' },
  { id: 'history', label: 'histórico', accessible: 'Histórico' },
  { id: 'lab', label: 'lab', accessible: 'Laboratório' },
];
const navMore = [
  { id: 'dashboard', label: 'Painel', accessible: 'Painel' },
  { id: 'new', label: 'Auditoria avançada', accessible: 'Auditoria HTTP' },
  { id: 'reports', label: 'Relatórios' },
  { id: 'projects', label: 'Alvos' },
  { id: 'tools', label: 'Ferramentas locais' },
  { id: 'settings', label: 'Configuração' },
  { id: 'about', label: 'Sobre' },
];

const paths: Record<string, string> = {
  terminal: '~',
  dashboard: '~/dashboard',
  lab: '~/lab',
  home: '~/scan',
  source: '~/code',
  findings: '~/findings',
  history: '~/history',
  new: '~/scan/advanced',
  reports: '~/reports',
  projects: '~/targets',
  tools: '~/tools',
  settings: '~/config',
  about: '~/about',
};

export default function App() {
  const w = useWorkspace();
  const { setError } = w;
  const [locked, setLocked] = useState(() => startInTerminal());
  const [page, setPage] = useState(() => (startInTerminal() ? 'terminal' : 'home'));
  const [scanDraft, setScanDraft] = useState({
    url: '',
    mode: 'quick' as 'quick' | 'deep',
    revision: 0,
  });
  const [projectId, setProjectId] = useState('');
  const [scanId, setScanId] = useState('');
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [revealing, setRevealing] = useState(false);
  const main = useRef<HTMLElement>(null);
  const navigate = useCallback(
    (id: string) => {
      setPage(id);
      setMenu(false);
      setError('');
    },
    [setError],
  );
  const openScan = useCallback(
    (id: string) => {
      setScanId(id);
      navigate('findings');
    },
    [navigate],
  );
  const unlock = useCallback(() => {
    setLocked(false);
    setPage((p) => (p === 'terminal' ? 'home' : p));
    setError('');
    // Animação de "power-on" (CRT ligando) ao revelar o workspace.
    setRevealing(true);
    window.setTimeout(() => setRevealing(false), 1500);
  }, [setError]);
  const lock = useCallback(() => {
    setLocked(true);
    setPage('terminal');
  }, []);
  useEffect(() => {
    main.current?.scrollTo(0, 0);
  }, [page]);
  useEffect(() => {
    applyMotionPreference(readMotionPreference());
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((value) => !value);
      }
      // Ctrl+J (ou Ctrl+`) abre/fecha o terminal global retrátil.
      if (
        (event.ctrlKey || event.metaKey) &&
        (event.key.toLowerCase() === 'j' || event.key === '`')
      ) {
        event.preventDefault();
        setCollapsed((value) => !value);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  async function execute(input: string) {
    try {
      const command = parseCommand(input);
      if (command.type === 'navigate') navigate(command.page);
      else if (command.type === 'configure') {
        setScanDraft((old) => ({
          url: command.url,
          mode: command.mode,
          revision: old.revision + 1,
        }));
        navigate('home');
      } else if (command.type === 'open') openScan(command.id);
      else if (command.type === 'cancel') {
        const active = w.activeLab ?? w.activeSource ?? w.active;
        if (active) await api.cancelScan(active.id);
      }
      // 'clear' e 'help' são tratados pela paleta e pelo terminal.
    } catch (error) {
      setError(String(error));
    }
  }
  async function windowAction(action: 'minimize' | 'maximize' | 'close') {
    try {
      await api.windowAction(action);
    } catch (error) {
      setError(String(error));
    }
  }

  let content;
  if (locked || page === 'terminal')
    content = (
      <TerminalMode workspace={w} locked={locked} navigate={navigate} unlock={unlock} lock={lock} />
    );
  else if (page === 'home')
    content = (
      <Home
        key={scanDraft.revision}
        workspace={w}
        initialTarget={scanDraft.url}
        initialMode={scanDraft.mode}
        navigate={navigate}
      />
    );
  else if (page === 'dashboard')
    content = <Dashboard workspace={w} navigate={navigate} openScan={openScan} />;
  else if (page === 'lab') content = <LabMode workspace={w} />;
  else if (page === 'source') content = <SourceLab workspace={w} />;
  else if (page === 'history') content = <History workspace={w} openScan={openScan} />;
  else if (page === 'findings')
    content = (
      <Results
        key={scanId}
        workspace={w}
        selectedId={scanId}
        reports={(id) => {
          setScanId(id);
          navigate('reports');
        }}
      />
    );
  else if (page === 'reports') content = <Reports workspace={w} selectedId={scanId} />;
  else if (page === 'projects')
    content = (
      <Projects
        workspace={w}
        scanProject={(id) => {
          setProjectId(id);
          navigate('new');
        }}
      />
    );
  else if (page === 'new')
    content = (
      <NewScan
        key={projectId}
        workspace={w}
        projectId={projectId}
        openScan={openScan}
        createProject={() => navigate('projects')}
      />
    );
  else if (page === 'tools') content = <Tools />;
  else if (page === 'settings') content = <Settings />;
  else content = <About />;

  const isHome = page === 'home' && !locked;
  const isTerminal = page === 'terminal' || locked;
  return (
    <div className="t-shell">
      <a className="skip-link" href="#main">
        Pular para o conteúdo
      </a>
      <header className="t-topbar" data-tauri-drag-region>
        <div className="t-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <button className="t-brand" onClick={() => navigate('home')}>
          <b>❯_</b> qypher
        </button>
        <span className="t-path">{locked ? '~' : (paths[page] ?? '~')}</span>
        {!locked && (
          <>
            <nav className="t-nav" aria-label="Navegação principal">
              {navPrimary.map((item) => (
                <button
                  key={item.id}
                  aria-label={item.accessible}
                  className={page === item.id ? 'active' : ''}
                  aria-current={page === item.id ? 'page' : undefined}
                  onClick={() => navigate(item.id)}
                >
                  {item.label}
                </button>
              ))}
              <div className="t-more">
                <button
                  className={navMore.some((m) => m.id === page) ? 'active' : ''}
                  aria-expanded={menu}
                  onClick={() => setMenu((value) => !value)}
                >
                  mais <ChevronDown size={12} />
                </button>
                {menu && (
                  <div className="t-menu">
                    {navMore.map((item) => (
                      <button
                        key={item.id}
                        aria-label={item.accessible ?? item.label}
                        onClick={() => navigate(item.id)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </nav>
            <button
              className="t-command"
              aria-label="Abrir comandos"
              onClick={() => setPalette(true)}
            >
              Ctrl+K
            </button>
            <button
              className="t-command"
              aria-label="Alternar terminal"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((value) => !value)}
            >
              terminal
            </button>
          </>
        )}
        {locked && (
          <button className="t-command" aria-label="Abrir workspace" onClick={unlock}>
            unlock
          </button>
        )}
        <div className="t-spacer" data-tauri-drag-region />
        <span className="t-status">
          <span className={`t-led ${native && w.ready ? 'on' : ''}`} />
          {w.busy ? 'executando' : native && w.ready ? 'motor conectado' : 'motor desconectado'}
        </span>
        {native && (
          <div className="t-win">
            <button aria-label="Minimizar janela" onClick={() => void windowAction('minimize')}>
              <Minus size={14} />
            </button>
            <button
              aria-label="Maximizar ou restaurar janela"
              onClick={() => void windowAction('maximize')}
            >
              <Maximize2 size={12} />
            </button>
            <button
              className="close"
              aria-label="Fechar aplicativo"
              onClick={() => void windowAction('close')}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </header>
      <PreviewNotice workspace={w} navigate={navigate} />
      <main ref={main} id="main" className="t-main" tabIndex={-1}>
        {w.error && (
          <div className="t-wrap">
            <div className="t-error" role="alert">
              <ShieldAlert size={16} />
              <p>{w.error}</p>
              <button aria-label="Dispensar erro" onClick={() => setError('')}>
                <X size={14} />
              </button>
            </div>
          </div>
        )}
        <div
          className={`${isTerminal ? 'tui-host' : isHome ? '' : 'q-page t-inner'}${
            revealing && !isTerminal ? ' q-unlock-reveal' : ''
          }`}
          key={page}
        >
          {content}
        </div>
      </main>
      {revealing && !isTerminal && <UnlockTransition />}
      {revealing && !isTerminal && <div className="q-unlock-sweep" aria-hidden="true" />}
      {!isTerminal && (
        <TerminalMode
          workspace={w}
          locked={false}
          navigate={navigate}
          unlock={unlock}
          lock={lock}
          variant="dock"
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
        />
      )}
      {!isTerminal && (
        <StatusBar
          workspace={w}
          path={paths[page] ?? '~'}
          onPalette={() => setPalette(true)}
          onToggleTerminal={() => setCollapsed((value) => !value)}
          terminalOpen={!collapsed}
        />
      )}
      {palette && (
        <CommandPalette
          close={() => setPalette(false)}
          execute={(command) => void execute(command)}
        />
      )}
    </div>
  );
}
