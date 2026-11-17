// Registro explícito de comandos do terminal (sem shell, sem execução arbitrária).
// Separado da apresentação para permitir testes do interpretador.
export const COMMANDS: { name: string; args?: string; hint: string }[] = [
  { name: 'scan', args: '<url> [--mode quick|deep]', hint: 'varre um site autorizado' },
  { name: 'findings', hint: 'abre os achados no workspace' },
  { name: 'history', hint: 'lista as análises recentes' },
  { name: 'code', hint: 'análise de código local (workspace)' },
  { name: 'report', hint: 'abre os relatórios (workspace)' },
  { name: 'lab', hint: 'laboratório de contas fictícias (workspace)' },
  { name: 'status', hint: 'estado real do aplicativo' },
  { name: 'version', hint: 'versão instalada' },
  { name: 'about', hint: 'sobre o Qypher' },
  { name: 'unlock', hint: 'abre a interface gráfica' },
  { name: 'lock', hint: 'volta ao terminal em tela cheia' },
  { name: 'clear', hint: 'limpa a tela' },
  { name: 'cancel', hint: 'interrompe a análise em andamento' },
  { name: 'help', hint: 'mostra esta lista' },
];

export const ALIASES: Record<string, string> = {
  ajuda: 'help',
  limpar: 'clear',
  analisar: 'scan',
  achados: 'findings',
  historico: 'history',
  código: 'code',
  codigo: 'code',
  cancelar: 'cancel',
  workspace: 'unlock',
  gui: 'unlock',
  sair: 'unlock',
  relatorios: 'report',
  relatórios: 'report',
  settings: 'report',
};

export const ALL_NAMES = [...COMMANDS.map((c) => c.name), ...Object.keys(ALIASES)];

/** Resolve um comando digitado (ou alias) para o nome canônico, em minúsculas. */
export function resolveCommand(raw: string): string {
  const key = raw.toLowerCase();
  return ALIASES[key] ?? key;
}

/** Lê os argumentos de `scan`: alvo e modo (quick por padrão). */
export function parseScanArgs(rest: string[]): { url?: string; deep: boolean } {
  const parts = rest.slice();
  let deep = false;
  const mi = parts.indexOf('--mode');
  if (mi >= 0) {
    const v = parts[mi + 1] ?? '';
    deep = /deep|profund/i.test(v);
    parts.splice(mi, v ? 2 : 1);
  }
  if (parts.some((a) => a === '--deep' || a === '--profundo')) deep = true;
  if (parts.some((a) => a === '--quick' || a === '--rapido')) deep = false;
  const url = parts.find((a) => !a.startsWith('--'));
  return { url, deep };
}

/** Sugestões de autocomplete para um prefixo (comando ainda sem argumentos). */
export function completions(prefix: string): string[] {
  const p = prefix.toLowerCase();
  if (!p) return [];
  return ALL_NAMES.filter((n) => n.startsWith(p));
}
