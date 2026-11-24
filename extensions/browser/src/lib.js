// Funções puras da extensão: sanitização e resumo. Sem acesso a APIs do navegador.

export const HOST_NAME = 'org.qypher.native';
export const MAX_HTML_BYTES = 1024 * 1024;

// Só estes cabeçalhos saem da extensão; os demais são descartados antes do host.
const ALLOWED_HEADERS = new Set([
  'content-type',
  'strict-transport-security',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'x-frame-options',
  'vary',
  'server',
  'x-powered-by',
  'x-aspnet-version',
  'x-aspnetmvc-version',
  'set-cookie',
]);

/** Remove o valor do cookie e mantém apenas nome e atributos. */
export function redactSetCookie(value) {
  const [pair = '', ...attrs] = String(value).split(';');
  const name = pair.split('=')[0].trim().slice(0, 64) || '[invalid]';
  return [`${name}=[redigido]`, ...attrs.map((part) => part.trim()).filter(Boolean)].join('; ');
}

/** Cabeçalhos do webRequest -> pares [nome, valor] permitidos e sanitizados. */
export function sanitizeHeaders(headers) {
  const out = [];
  for (const header of headers ?? []) {
    const name = String(header?.name ?? '').toLowerCase();
    if (!ALLOWED_HEADERS.has(name)) continue;
    const raw = header.value ?? '';
    // Set-Cookie pode chegar com várias linhas num só cabeçalho (Firefox).
    const values = name === 'set-cookie' ? String(raw).split('\n') : [String(raw)];
    for (const value of values) {
      if (!value.trim()) continue;
      out.push([name, name === 'set-cookie' ? redactSetCookie(value) : value.slice(0, 8192)]);
      if (out.length >= 200) return out;
    }
  }
  return out;
}

/** Mesma página, ignorando o fragmento (#...). */
export function samePage(a, b) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    x.hash = '';
    y.hash = '';
    return x.href === y.href;
  } catch {
    return false;
  }
}

export function isAnalyzable(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

/** Corta o HTML em no máximo `limit` bytes UTF-8 sem quebrar caracteres. */
export function truncateUtf8(text, limit = MAX_HTML_BYTES) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= limit) return { html: text, truncated: false };
  let end = limit;
  // Recua até o início de um caractere (bytes de continuação são 10xxxxxx).
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return { html: new TextDecoder().decode(bytes.slice(0, end)), truncated: true };
}

export const SEVERITIES = ['high', 'medium', 'low', 'info', 'unrated'];
export const SEVERITY_LABEL = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
  info: 'Informativa',
  unrated: 'Não pontuada',
};

export function countBySeverity(findings) {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const finding of findings ?? []) {
    const key = SEVERITIES.includes(finding?.severity) ? finding.severity : 'unrated';
    counts[key] += 1;
  }
  return counts;
}

const rank = (severity) => {
  const index = SEVERITIES.indexOf(severity);
  return index < 0 ? SEVERITIES.length - 1 : index;
};

export function sortFindings(findings) {
  return [...(findings ?? [])].sort((a, b) => rank(a.severity) - rank(b.severity));
}

/** Texto e cor do selo do ícone a partir das contagens. */
export function badgeFor(counts) {
  const total = SEVERITIES.reduce((sum, s) => sum + (counts?.[s] ?? 0), 0);
  if (!total) return { text: '', color: '#4fd1a5' };
  const color = counts.high ? '#ff5c7a' : counts.medium ? '#f5b14c' : '#6ea8ff';
  return { text: total > 99 ? '99+' : String(total), color };
}

/** Mensagem compreensível para erros do Native Messaging. */
export function explainNativeError(message) {
  const text = String(message ?? '');
  if (/not found|no such native application|host not found/i.test(text))
    return {
      kind: 'no-host',
      text: 'O app Qypher não está conectado a este navegador. Abra o Qypher, vá em Configuração e ative a integração com o navegador.',
    };
  if (/forbidden|access to the specified native messaging host is forbidden/i.test(text))
    return {
      kind: 'forbidden',
      text: 'O Qypher instalado não reconhece esta extensão. Atualize o app e ative a integração novamente.',
    };
  if (/exited|disconnected/i.test(text))
    return { kind: 'crashed', text: 'O Qypher encerrou a conexão. Tente novamente.' };
  return { kind: 'error', text: text || 'Falha desconhecida ao falar com o Qypher.' };
}
