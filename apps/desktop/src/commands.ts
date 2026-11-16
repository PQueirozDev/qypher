export const commandCatalog = [
  { command: 'home', label: 'Abrir a configuração de análise', page: 'home', shortcut: '00' },
  { command: 'dashboard', label: 'Abrir painel de segurança', page: 'dashboard', shortcut: 'D' },
  { command: 'lab', label: 'Abrir laboratório autorizado', page: 'lab', shortcut: 'L' },
  { command: 'scan', label: 'Configurar auditoria HTTP / TLS', page: 'new', shortcut: '01' },
  { command: 'repo', label: 'Analisar código de uma cópia local', page: 'source', shortcut: '02' },
  { command: 'projects', label: 'Gerenciar alvos autorizados', page: 'projects', shortcut: '03' },
  { command: 'findings', label: 'Inspecionar evidências HTTP', page: 'findings', shortcut: '04' },
  { command: 'history', label: 'Abrir histórico de execuções', page: 'history', shortcut: '05' },
  { command: 'reports', label: 'Exportar artefatos HTTP', page: 'reports', shortcut: '06' },
  {
    command: 'tools',
    label: 'JWT, hashes, CSP e utilitários locais',
    page: 'tools',
    shortcut: '07',
  },
  {
    command: 'runtime',
    label: 'Inspecionar runtime e políticas',
    page: 'settings',
    shortcut: '08',
  },
  { command: 'help', label: 'Listar comandos internos', page: '', shortcut: '?' },
  { command: 'cancel', label: 'Cancelar a execução ativa', page: '', shortcut: 'Ctrl+C' },
  { command: 'clear', label: 'Limpar mensagens locais do console', page: '', shortcut: 'CLR' },
] as const;
export type InternalCommand =
  | { type: 'navigate'; page: string }
  | { type: 'configure'; url: string; mode: 'quick' | 'deep' }
  | { type: 'help' | 'cancel' | 'clear' }
  | { type: 'open'; id: string };
export function parseCommand(input: string): InternalCommand {
  if (input.length > 256) throw new Error('Comando excede 256 caracteres.');
  const text = input.trim().toLowerCase();
  const configure = /^(scan|quick|deep)\s+(\S+)$/i.exec(input.trim());
  if (configure) {
    let target: URL;
    try {
      target = new URL(configure[2]);
    } catch {
      throw new Error('Use scan https://seu-projeto.com/caminho');
    }
    if (
      !['http:', 'https:'].includes(target.protocol) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      configure[2].includes('\\') ||
      /[;`<>"']/.test(configure[2])
    ) {
      throw new Error(
        'Informe somente uma URL HTTP(S), sem credenciais, parâmetros ou comandos adicionais.',
      );
    }
    return {
      type: 'configure',
      url: target.toString(),
      mode: configure[1].toLowerCase() === 'deep' ? 'deep' : 'quick',
    };
  }
  const open = /^open ([a-f0-9-]{8,36})$/.exec(text);
  if (open) return { type: 'open', id: open[1] };
  const item = commandCatalog.find((c) => c.command === text);
  if (!item)
    throw new Error('Comando interno desconhecido. Digite help. Não há execução de shell.');
  if (item.command === 'help' || item.command === 'cancel' || item.command === 'clear')
    return { type: item.command };
  return { type: 'navigate', page: item.page };
}
