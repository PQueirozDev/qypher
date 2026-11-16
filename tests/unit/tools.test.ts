import { describe, expect, it } from 'vitest';
import {
  analyzeCookie,
  analyzeCsp,
  decodeJwt,
  diffLines,
  hashBytes,
  readSarif,
} from '../../apps/desktop/src/tools';
describe('local utilities', () => {
  it('decodes Unicode claims without claiming signature verification', () => {
    const b64 = (v: unknown) =>
      btoa(unescape(encodeURIComponent(JSON.stringify(v))))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    const result = decodeJwt(`${b64({ alg: 'none' })}.${b64({ name: 'João' })}.`);
    expect(result.payload.name).toBe('João');
    expect(result.signature).toContain('NÃO VERIFICADA');
  });
  it('rejects invalid JWT, huge input and non-object JSON', () => {
    expect(() => decodeJwt('invalid')).toThrow();
    expect(() => decodeJwt('x'.repeat(32769))).toThrow();
    expect(() => decodeJwt('bnVsbA.bnVsbA.')).toThrow();
  });
  it('hashes the standard SHA-256 abc vector', async () => {
    expect(await hashBytes(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('does not expose cookie values and flags SameSite=None without Secure', () => {
    const result = analyzeCookie('session=very-secret; SameSite=None');
    expect(JSON.stringify(result)).not.toContain('very-secret');
    expect(result.warnings).toContain('SameSite=None requer Secure.');
  });
  it('parses CSP without executing or loading sources', () => {
    const result = analyzeCsp(
      "default-src 'self'; script-src 'unsafe-eval'; frame-ancestors 'none'",
    );
    expect(result.directives).toHaveLength(3);
    expect(result.observations.some((o) => o.includes('unsafe-eval'))).toBe(true);
  });
  it('compares line sets with bounded input', () => {
    expect(diffLines('a\r\nb', 'b\nc').removed).toEqual(['a']);
    expect(diffLines('a\nb', 'b\nc').added).toEqual(['c']);
    expect(() => diffLines('x'.repeat(200001), '')).toThrow();
  });
  it('validates SARIF and keeps malicious messages as text', () => {
    expect(() => readSarif('{"version":"2.0.0"}')).toThrow();
    const r = readSarif(
      JSON.stringify({
        version: '2.1.0',
        runs: [{ results: [{ ruleId: 'x', message: { text: '<script>bad()</script>' } }] }],
      }),
    );
    expect(r.results[0].message).toBe('<script>bad()</script>');
  });
});
