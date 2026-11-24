import { useEffect, useRef, useState } from 'react';
import { Command, CornerDownLeft, Search, X } from 'lucide-react';

export type PaletteAction = {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
};

export function CommandPalette({
  close,
  actions,
  dynamic,
}: {
  close: () => void;
  actions: PaletteAction[];
  dynamic?: (query: string) => PaletteAction[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const needle = query.trim().toLowerCase();
  const base = actions.filter((a) =>
    `${a.label} ${a.keywords ?? ''}`.toLowerCase().includes(needle),
  );
  const items = [...(dynamic ? dynamic(query) : []), ...base];
  const active = Math.min(selected, Math.max(0, items.length - 1));
  useEffect(() => {
    dialog.current?.showModal();
    // showModal() foca o primeiro botão; a busca é o ponto de partida.
    search.current?.focus();
  }, []);
  function run(action: PaletteAction) {
    action.run();
    close();
  }
  return (
    <dialog
      ref={dialog}
      className="command-palette"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby="palette-title"
    >
      <h2 id="palette-title">
        <Command size={15} />
        Command dispatch
        <button className="icon-button" aria-label="Fechar paleta" onClick={close}>
          <X size={15} />
        </button>
      </h2>
      <div className="palette-search">
        <Search size={16} />
        <input
          ref={search}
          autoFocus
          aria-label="Pesquisar comando"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, items.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((i) => Math.max(0, i - 1));
            }
            if (e.key === 'Enter' && items[active]) {
              e.preventDefault();
              run(items[active]);
            }
          }}
          placeholder="Navegar, analisar, abrir terminal…"
        />
      </div>
      <div className="palette-list">
        {items.map((action, i) => (
          <button
            key={action.id}
            className={active === i ? 'selected' : ''}
            onMouseEnter={() => setSelected(i)}
            onClick={() => run(action)}
          >
            <span>{action.label}</span>
            {action.hint && <kbd>{action.hint}</kbd>}
          </button>
        ))}
        {!items.length && <p>Nenhuma ação corresponde à busca.</p>}
      </div>
      <div className="palette-footer">
        <span>↑ ↓ navegar</span>
        <span>
          <CornerDownLeft size={12} /> executar
        </span>
        <span>ESC fechar</span>
      </div>
    </dialog>
  );
}
