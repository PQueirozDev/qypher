import { useEffect, useRef, useState } from 'react';
import { Command, CornerDownLeft, Search, X } from 'lucide-react';
import { commandCatalog } from '../commands';
export function CommandPalette({
  close,
  execute,
}: {
  close: () => void;
  execute: (command: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const items = commandCatalog.filter((c) =>
    `${c.command} ${c.label}`.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function run(command: string) {
    execute(command);
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
            if (e.key === 'Enter' && items[selected]) {
              e.preventDefault();
              run(items[selected].command);
            }
          }}
          placeholder="Digite uma operação…"
        />
      </div>
      <div className="palette-list">
        {items.map((c, i) => (
          <button
            key={c.command}
            className={selected === i ? 'selected' : ''}
            onMouseEnter={() => setSelected(i)}
            onClick={() => run(c.command)}
          >
            <code>{c.command}</code>
            <span>{c.label}</span>
            <kbd>{c.shortcut}</kbd>
          </button>
        ))}
        {!items.length && <p>Nenhum comando interno corresponde à busca.</p>}
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
