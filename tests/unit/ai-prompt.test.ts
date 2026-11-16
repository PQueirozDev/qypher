import { expect, it } from 'vitest';
import { buildFixPrompt } from '../../apps/desktop/src/aiPrompt';
import type { Finding } from '../../apps/desktop/src/types';

const finding = (title: string, severity: Finding['severity']): Finding => ({
  id: title,
  detectorId: 'exposure.git-head',
  detectorVersion: '1.0.0',
  title,
  category: 'Exposição',
  severity,
  confidence: 'confirmed',
  classification: 'exposure',
  location: 'https://exemplo.com.br/.git/HEAD',
  evidence: 'GET /.git/HEAD respondeu 200.',
  impact: 'O código pode ser reconstruído.',
  recommendation: 'Bloqueie diretórios ocultos.',
  references: [],
  cwe: 'CWE-527',
  owasp: 'A05:2021 Configuração insegura',
});

it('lists every weakness with evidence, risk and suggested fix', () => {
  const prompt = buildFixPrompt('https://exemplo.com.br/', [
    finding('Repositório Git exposto', 'high'),
    finding('CSP fraca', 'medium'),
  ]);
  expect(prompt).toContain('https://exemplo.com.br/');
  expect(prompt).toContain('as 2 fraquezas abaixo');
  expect(prompt).toContain('1. [Alta] Repositório Git exposto');
  expect(prompt).toContain('2. [Média] CSP fraca');
  expect(prompt).toContain('Bloqueie diretórios ocultos.');
  expect(prompt).toContain('CWE-527');
});
it('uses the singular for a single weakness', () => {
  expect(buildFixPrompt('https://a.b/', [finding('X', 'low')])).toContain('a fraqueza abaixo');
});
