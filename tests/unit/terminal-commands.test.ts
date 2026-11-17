import { describe, expect, it } from 'vitest';
import {
  resolveCommand,
  parseScanArgs,
  completions,
  COMMANDS,
} from '../../apps/desktop/src/terminalCommands';

describe('resolveCommand', () => {
  it('mapeia aliases em português para o nome canônico', () => {
    expect(resolveCommand('ajuda')).toBe('help');
    expect(resolveCommand('analisar')).toBe('scan');
    expect(resolveCommand('achados')).toBe('findings');
    expect(resolveCommand('workspace')).toBe('unlock');
    expect(resolveCommand('gui')).toBe('unlock');
    expect(resolveCommand('limpar')).toBe('clear');
  });
  it('é insensível a maiúsculas e mantém comandos desconhecidos', () => {
    expect(resolveCommand('HELP')).toBe('help');
    expect(resolveCommand('Scan')).toBe('scan');
    expect(resolveCommand('desconhecido')).toBe('desconhecido');
  });
});

describe('parseScanArgs', () => {
  it('usa quick scan por padrão', () => {
    expect(parseScanArgs(['https://exemplo.com'])).toEqual({
      url: 'https://exemplo.com',
      deep: false,
    });
  });
  it('entende --mode deep e --deep/--profundo', () => {
    expect(parseScanArgs(['https://x.com', '--mode', 'deep']).deep).toBe(true);
    expect(parseScanArgs(['https://x.com', '--deep']).deep).toBe(true);
    expect(parseScanArgs(['https://x.com', '--profundo']).deep).toBe(true);
  });
  it('entende --mode quick e --quick/--rapido', () => {
    expect(parseScanArgs(['https://x.com', '--mode', 'quick']).deep).toBe(false);
    expect(parseScanArgs(['https://x.com', '--quick']).deep).toBe(false);
  });
  it('não confunde o valor de --mode com o alvo', () => {
    expect(parseScanArgs(['--mode', 'deep', 'https://x.com'])).toEqual({
      url: 'https://x.com',
      deep: true,
    });
  });
  it('retorna url indefinida quando nenhum alvo é informado', () => {
    expect(parseScanArgs(['--deep']).url).toBeUndefined();
  });
});

describe('completions', () => {
  it('completa um prefixo para o comando correspondente', () => {
    expect(completions('sca')).toContain('scan');
    expect(completions('unl')).toContain('unlock');
  });
  it('não sugere nada para prefixo vazio', () => {
    expect(completions('')).toEqual([]);
  });
});

describe('COMMANDS', () => {
  it('inclui os comandos essenciais do Terminal First', () => {
    const names = COMMANDS.map((c) => c.name);
    for (const required of ['scan', 'unlock', 'lock', 'help', 'status', 'findings', 'history']) {
      expect(names).toContain(required);
    }
  });
});
