import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minus, ShieldAlert, X } from 'lucide-react';
import { api, native } from './api';
import { listen } from './bridge';
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
import { CommandPalette, type PaletteAction } from './components/CommandPalette';
import { StatusBar } from './components/StatusBar';
import { UnlockTransition } from './components/UnlockTransition';
import { BootSplash } from './components/BootSplash';
import { Sidebar } from './components/Sidebar';
import { PixelMark } from './components/PixelLogo';
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
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [revealing, setRevealing] = useState(false);
  const [locking, setLocking] = useState(false);
  const main = useRef<HTMLElement>(null);
  const navigate = useCallback(
    (id: string) => {
      setPage(id);
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
    // Animação de "power-off" (CRT desligando) antes de voltar ao terminal.
    setLocking(true);
    window.setTimeout(() => {
      setLocked(true);
      setPage('terminal');
      setLocking(false);
    }, 440);
  }, []);
  useEffect(() => {
    main.current?.scrollTo(0, 0);
  }, [page]);
  useEffect(() => {
    applyMotionPreference(readMotionPreference());
  }, []);
  // URL enviada pela extensão do navegador: só pré-preenche a nova análise;
  // a autorização continua sendo pedida na tela.
  useEffect(() => {
    if (!native) return;
    let stop: (() => void) | undefined;
    let active = true;
    const prefill = (url: string | null) => {
      // A URL já foi consumida no motor: aplica mesmo após o cleanup (StrictMode).
      if (!url) return;
      setScanDraft((old) => ({ url, mode: 'quick', revision: old.revision + 1 }));
      setLocked(false);
      setPage('home');
    };
    api.takeScanUrl().then(prefill, () => undefined);
    listen<string>('scan-url', () => {
      api.takeScanUrl().then(prefill, () => undefined);
    }).then(
      (unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      },
      () => undefined,
    );
    return () => {
      active = false;
      stop?.();
    };
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
  // Paleta de comandos unificada: navegação + ações do workspace/terminal.
  const paletteActions: PaletteAction[] = [
    ...[...navPrimary, ...navMore].map((item) => ({
      id: `nav:${item.id}`,
      label: `Ir para ${item.label}`,
      keywords: `${item.id} ${item.accessible ?? ''} navegar abrir`,
      run: () => navigate(item.id),
    })),
    {
      id: 'act:terminal',
      label: collapsed ? 'Abrir terminal global' : 'Fechar terminal global',
      hint: 'Ctrl+J',
      keywords: 'terminal console shell',
      run: () => setCollapsed((value) => !value),
    },
    {
      id: 'act:lock',
      label: 'Voltar ao terminal em tela cheia',
      hint: 'lock',
      keywords: 'lock bloquear travar sair',
      run: () => lock(),
    },
    {
      id: 'act:scan',
      label: 'Nova análise',
      hint: 'analisar',
      keywords: 'scan analisar auditar novo alvo',
      run: () => navigate('home'),
    },
  ];
  // Ação dinâmica: digitar "scan <url>" (ou "analisar <url>") configura a análise.
  const paletteDynamic = (query: string): PaletteAction[] => {
    const raw = query.trim().replace(/^analisar\b/i, 'scan');
    if (!/^(scan|quick|deep)\s+\S+$/i.test(raw)) return [];
    try {
      const command = parseCommand(raw);
      if (command.type === 'configure') {
        return [
          {
            id: 'dyn:scan',
            label: `Analisar ${command.url}`,
            hint: command.mode,
            run: () => void execute(raw),
          },
        ];
      }
    } catch {
      // Query ainda incompleta ou inválida: sem ação dinâmica.
    }
    return [];
  };
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
          <PixelMark className="t-brand-mark" /> qypher
        </button>
        <span className="t-path">{locked ? '~' : (paths[page] ?? '~')}</span>
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
      <div className="t-body">
        {!isTerminal && (
          <Sidebar
            primary={navPrimary}
            more={navMore}
            page={page}
            navigate={navigate}
            onPalette={() => setPalette(true)}
            onToggleTerminal={() => setCollapsed((value) => !value)}
            terminalOpen={!collapsed}
          />
        )}
        <main
          ref={main}
          id="main"
          className="t-main"
          tabIndex={-1}
          data-title={locked ? '~' : (paths[page] ?? '~')}
        >
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
            }${locking && !isTerminal ? ' q-lock-collapse' : ''}`}
            key={page}
          >
            {content}
          </div>
        </main>
      </div>
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
          actions={paletteActions}
          dynamic={paletteDynamic}
        />
      )}
      <BootSplash native={native} ready={w.ready} />
    </div>
  );
}
