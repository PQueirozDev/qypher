import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../apps/desktop/src/commands';
describe('internal command dispatch', () => {
  it('routes to audited modules without starting scans implicitly', () => {
    expect(parseCommand(' repo ')).toEqual({ type: 'navigate', page: 'source' });
    expect(parseCommand('SCAN')).toEqual({ type: 'navigate', page: 'new' });
    expect(parseCommand('cancel')).toEqual({ type: 'cancel' });
  });
  it('rejects shell syntax, credentials and arbitrary file arguments', () => {
    for (const input of [
      'rm -rf /',
      'powershell -enc AAA',
      'scan https://user:password@example.com',
      'scan https://example.com?token=private',
      'deep javascript:alert(1)',
      'repo C:\\',
      'help; whoami',
      '$(curl host)',
      'open ../../private',
    ])
      expect(() => parseCommand(input)).toThrow();
  });
  it('only prepares an explicit URL and mode, without executing a scan', () => {
    expect(parseCommand('scan https://example.com/App')).toEqual({
      type: 'configure',
      url: 'https://example.com/App',
      mode: 'quick',
    });
    expect(parseCommand('deep https://example.com/App')).toEqual({
      type: 'configure',
      url: 'https://example.com/App',
      mode: 'deep',
    });
    expect(parseCommand('lab')).toEqual({ type: 'navigate', page: 'lab' });
  });
  it('bounds input and validates audit identifiers', () => {
    expect(() => parseCommand('x'.repeat(257))).toThrow();
    expect(parseCommand('open 1234abcd')).toEqual({ type: 'open', id: '1234abcd' });
  });
});
