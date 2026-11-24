import { describe, expect, it } from 'vitest';
import {
  badgeFor,
  countBySeverity,
  explainNativeError,
  isAnalyzable,
  redactSetCookie,
  samePage,
  sanitizeHeaders,
  sortFindings,
  truncateUtf8,
} from '../../extensions/browser/src/lib.js';

describe('browser extension helpers', () => {
  it('never forwards cookie values or unrelated headers', () => {
    const out = sanitizeHeaders([
      { name: 'Set-Cookie', value: 'sessionid=SECRET123; Path=/; HttpOnly' },
      { name: 'Cookie', value: 'a=SECRET' },
      { name: 'Authorization', value: 'Bearer SECRET' },
      { name: 'X-Csrf-Token', value: 'SECRET' },
      { name: 'Content-Security-Policy', value: "default-src 'self'" },
    ]);
    expect(JSON.stringify(out)).not.toContain('SECRET');
    expect(out).toEqual([
      ['set-cookie', 'sessionid=[redigido]; Path=/; HttpOnly'],
      ['content-security-policy', "default-src 'self'"],
    ]);
  });

  it('splits multi-line Set-Cookie (Firefox) and caps header count', () => {
    const out = sanitizeHeaders([{ name: 'set-cookie', value: 'a=1; Secure\nb=2' }]);
    expect(out).toEqual([
      ['set-cookie', 'a=[redigido]; Secure'],
      ['set-cookie', 'b=[redigido]'],
    ]);
    const many = Array.from({ length: 300 }, () => ({ name: 'vary', value: 'x' }));
    expect(sanitizeHeaders(many)).toHaveLength(200);
    expect(redactSetCookie('')).toBe('[invalid]=[redigido]');
  });

  it('only accepts http(s) pages without credentials and ignores fragments', () => {
    expect(isAnalyzable('https://site.example/a')).toBe(true);
    expect(isAnalyzable('chrome://extensions')).toBe(false);
    expect(isAnalyzable('file:///C:/x.html')).toBe(false);
    expect(isAnalyzable('https://u:p@site.example/')).toBe(false);
    expect(samePage('https://a.example/x#1', 'https://a.example/x#2')).toBe(true);
    expect(samePage('https://a.example/x', 'https://a.example/y')).toBe(false);
  });

  it('truncates HTML on UTF-8 boundaries', () => {
    const text = 'ç'.repeat(10); // 2 bytes cada
    const cut = truncateUtf8(text, 5);
    expect(cut.truncated).toBe(true);
    expect(cut.html).toBe('çç');
    expect(truncateUtf8('abc', 10)).toEqual({ html: 'abc', truncated: false });
  });

  it('summarizes severities for the badge and sorts by risk', () => {
    const findings = [{ severity: 'low' }, { severity: 'high' }, { severity: 'weird' }];
    const counts = countBySeverity(findings);
    expect(counts).toMatchObject({ high: 1, low: 1, unrated: 1 });
    expect(badgeFor(counts)).toEqual({ text: '3', color: '#ff5c7a' });
    expect(badgeFor(countBySeverity([]))).toEqual({ text: '', color: '#4fd1a5' });
    expect(sortFindings(findings).map((f) => f.severity)).toEqual(['high', 'low', 'weird']);
  });

  it('explains missing native host in plain language', () => {
    expect(explainNativeError('Specified native messaging host not found.').kind).toBe('no-host');
    expect(
      explainNativeError('Access to the specified native messaging host is forbidden.').kind,
    ).toBe('forbidden');
  });
});
