import { useLayoutEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Code2,
  Command,
  FileText,
  FlaskConical,
  History,
  Info,
  LayoutDashboard,
  Search,
  Settings,
  ShieldAlert,
  Target,
  Terminal,
  TerminalSquare,
  Wrench,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  terminal: Terminal,
  home: Search,
  source: Code2,
  findings: ShieldAlert,
  history: History,
  lab: FlaskConical,
  dashboard: LayoutDashboard,
  new: Activity,
  reports: FileText,
  projects: Target,
  tools: Wrench,
  settings: Settings,
  about: Info,
};

type NavItem = { id: string; label: string; accessible?: string };

// Sidebar compacta do Workspace 2.0: navegação à esquerda com ícones.
export function Sidebar({
  primary,
  more,
  page,
  navigate,
  onPalette,
  onToggleTerminal,
  terminalOpen,
}: {
  primary: NavItem[];
  more: NavItem[];
  page: string;
  navigate: (id: string) => void;
  onPalette: () => void;
  onToggleTerminal: () => void;
  terminalOpen: boolean;
}) {
  const nav = useRef<HTMLElement>(null);
  // Pílula do item ativo: posicionada por variáveis CSS e animada entre os itens.
  useLayoutEffect(() => {
    const root = nav.current;
    if (!root) return;
    const place = () => {
      const active = root.querySelector<HTMLElement>('.sb-item.active');
      root.style.setProperty('--sb-y', `${active?.offsetTop ?? 0}px`);
      root.style.setProperty('--sb-h', `${active?.offsetHeight ?? 0}px`);
      root.dataset.indicator = active ? 'on' : 'off';
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => observer.disconnect();
  }, [page]);
  const renderItem = (nav: NavItem) => {
    const Icon = ICONS[nav.id] ?? Activity;
    const active = page === nav.id;
    return (
      <button
        key={nav.id}
        className={`sb-item ${active ? 'active' : ''}`}
        aria-label={nav.accessible ?? nav.label}
        aria-current={active ? 'page' : undefined}
        onClick={() => navigate(nav.id)}
      >
        <Icon size={16} />
        <span>{nav.label}</span>
      </button>
    );
  };
  return (
    <aside className="sidebar" aria-label="Navegação do workspace">
      <nav className="sb-nav" ref={nav}>
        <span className="sb-indicator" aria-hidden="true" />
        <div className="sb-group">{primary.map(renderItem)}</div>
        <div className="sb-sep" />
        <div className="sb-group">{more.map(renderItem)}</div>
      </nav>
      <div className="sb-foot">
        <button className="sb-item" aria-label="Abrir paleta de comandos" onClick={onPalette}>
          <Command size={16} />
          <span>Comandos</span>
          <kbd>Ctrl+K</kbd>
        </button>
        <button
          className={`sb-item ${terminalOpen ? 'active' : ''}`}
          aria-label="Alternar terminal global"
          aria-pressed={terminalOpen}
          onClick={onToggleTerminal}
        >
          <TerminalSquare size={16} />
          <span>Terminal</span>
          <kbd>Ctrl+J</kbd>
        </button>
      </div>
    </aside>
  );
}
