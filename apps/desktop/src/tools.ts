function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function decodeJwt(token: string) {
  if (token.length > 32768) throw new Error('JWT muito grande (máximo 32 KiB).');
  const parts = token.trim().split('.');
  if (parts.length !== 3) throw new Error('Informe um JWT compacto com três segmentos.');
  const decode = (part: string): Record<string, unknown> => {
    if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('Segmento base64url inválido.');
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(
      atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4)),
      (c) => c.charCodeAt(0),
    );
    const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!object(result)) throw new Error('Header e payload devem ser objetos JSON.');
    return result;
  };
  return {
    header: decode(parts[0]),
    payload: decode(parts[1]),
    signature: 'NÃO VERIFICADA — decodificação não valida autenticidade, algoritmo ou claims.',
  };
}
export async function hashBytes(
  bytes: Uint8Array<ArrayBuffer>,
  algorithm: 'SHA-256' | 'SHA-512' = 'SHA-256',
) {
  const digest = await crypto.subtle.digest(algorithm, bytes);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
export function analyzeCookie(input: string) {
  if (input.length > 16384) throw new Error('Cookie muito grande.');
  const [first, ...parts] = input
    .replace(/^set-cookie:\s*/i, '')
    .trim()
    .split(';');
  if (!first?.includes('=')) throw new Error('Informe um Set-Cookie válido.');
  const attributes = new Map(
    parts.map((p) => {
      const [name, ...value] = p.trim().split('=');
      return [name.toLowerCase(), value.join('=')];
    }),
  );
  return {
    name: first.split('=')[0],
    value: '[não exibido]',
    secure: attributes.has('secure'),
    httpOnly: attributes.has('httponly'),
    sameSite: attributes.get('samesite') ?? 'ausente',
    warnings: [
      ...(!attributes.has('secure') ? ['Secure ausente.'] : []),
      ...(!attributes.has('httponly') ? ['HttpOnly ausente; avalie a finalidade do cookie.'] : []),
      ...(!attributes.has('samesite') ? ['SameSite não declarado.'] : []),
      ...(attributes.get('samesite')?.toLowerCase() === 'none' && !attributes.has('secure')
        ? ['SameSite=None requer Secure.']
        : []),
    ],
  };
}
export function analyzeCsp(input: string) {
  if (input.length > 32768) throw new Error('CSP muito grande.');
  const directives = input
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [name, ...sources] = d.split(/\s+/);
      return { directive: name.toLowerCase(), sources };
    });
  return {
    directives,
    observations: [
      ...(!directives.some((d) => d.directive === 'default-src')
        ? ['default-src não declarado; revise os fallbacks.']
        : []),
      ...(directives.some((d) => d.sources.includes("'unsafe-inline'"))
        ? [
            'unsafe-inline observado. O efeito depende de nonces, hashes, diretiva e versão do navegador.',
          ]
        : []),
      ...(directives.some((d) => d.sources.includes("'unsafe-eval'"))
        ? ['unsafe-eval observado; revise a necessidade.']
        : []),
      ...(!directives.some((d) => d.directive === 'frame-ancestors')
        ? ['frame-ancestors não declarado; proteção de framing não avaliada.']
        : []),
    ],
    limitation:
      'Análise estática de texto. Não valida a política no navegador nem comprova vulnerabilidade.',
  };
}
export function diffLines(before: string, after: string) {
  if (before.length + after.length > 200000)
    throw new Error('Limite combinado de 200 mil caracteres.');
  const a = new Set(before.split(/\r?\n/));
  const b = new Set(after.split(/\r?\n/));
  return {
    removed: [...a].filter((l) => !b.has(l)),
    added: [...b].filter((l) => !a.has(l)),
    limitation: 'Diferenças por conjunto de linhas; ordem e repetições não são comparadas.',
  };
}
export function readSarif(input: string) {
  if (input.length > 5 * 1024 * 1024) throw new Error('SARIF excede 5 MiB.');
  const data: unknown = JSON.parse(input);
  if (!object(data) || data.version !== '2.1.0' || !Array.isArray(data.runs))
    throw new Error('Esperado um relatório SARIF 2.1.0 com runs.');
  const results: { rule: string; level: string; message: string }[] = [];
  for (const run of data.runs.slice(0, 100)) {
    if (!object(run) || !Array.isArray(run.results)) continue;
    for (const item of run.results) {
      if (results.length >= 1000) break;
      if (!object(item)) continue;
      results.push({
        rule: String(item.ruleId ?? 'sem regra').slice(0, 200),
        level: String(item.level ?? 'warning').slice(0, 50),
        message: (object(item.message) ? String(item.message.text ?? '') : '').slice(0, 4000),
      });
    }
  }
  return {
    version: '2.1.0',
    results,
    limitation:
      'Visualização local limitada a 100 runs e 1000 resultados; nenhum link ou artefato externo é carregado.',
  };
}
