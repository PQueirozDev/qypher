import { Command, TerminalSquare } from 'lucide-react';
import { native } from '../api';
import { APP_VERSION } from '../startup';
import type { Workspace } from '../useWorkspace';

// Barra de status global do workspace (parte do Workspace 2.0).
export function StatusBar({
  workspace: w,
  path,
  onPalette,
  onToggleTerminal,
  terminalOpen,
}: {
  workspace: Workspace;
  path: string;
  onPalette: () => void;
  onToggleTerminal: () => void;
  terminalOpen: boolean;
}) {
  const engineOn = native && w.ready;
  const active = w.active;
  const label = w.busy ? 'executando' : engineOn ? 'motor conectado' : 'motor desconectado';
  return (
    <footer className="statusbar" aria-label="Barra de status">
      <span className="sb-seg sb-engine">
        <span className={`sb-led ${w.busy ? 'busy' : engineOn ? 'on' : ''}`} />
        {label}
      </span>
      <span className="sb-seg sb-path">{path}</span>
      {active && (
        <span className="sb-seg sb-scan">
          varredura {active.requestCount}/{active.config.maxRequests}
        </span>
      )}
      <span className="sb-spacer" />
      <span className="sb-seg sb-count">
        {w.scans.length} {w.scans.length === 1 ? 'análise' : 'análises'}
      </span>
      <button className="sb-btn" onClick={onPalette} aria-label="Abrir paleta de comandos">
        <Command size={12} /> Ctrl+K
      </button>
      <button
        className={`sb-btn ${terminalOpen ? 'active' : ''}`}
        onClick={onToggleTerminal}
        aria-label="Alternar terminal global"
        aria-pressed={terminalOpen}
      >
        <TerminalSquare size={12} /> Ctrl+J
      </button>
      <span className="sb-seg sb-ver">v{APP_VERSION}</span>
    </footer>
  );
}
