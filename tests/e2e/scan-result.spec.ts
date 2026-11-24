import { test, expect } from './fixtures';

const finding = (id: string, severity: string, title: string) => ({
  id,
  detectorId: `det.${id}`,
  detectorVersion: '1.0.0',
  title,
  category: 'Cabeçalhos',
  severity,
  confidence: 'observed',
  classification: 'configuration',
  location: '/',
  evidence: 'content-type: text/html',
  impact: `Impacto de ${title}`,
  recommendation: `Correção de ${title}`,
  references: [],
  description: `Descrição de ${title}`,
});

const scan = {
  schemaVersion: 3,
  engineVersion: '0.1.3',
  id: 'result-scan',
  status: 'completed',
  config: {
    projectId: 'p1',
    url: 'https://site.example/',
    authorized: true,
    allowPrivate: false,
    pathPrefix: '/',
    maxRequests: 3,
    maxRedirects: 5,
    timeoutSeconds: 10,
  },
  startedAt: '2026-11-24T10:00:00Z',
  finishedAt: '2026-11-24T10:00:04Z',
  requestCount: 3,
  observations: [],
  checks: [
    {
      detectorId: 'det.a',
      detectorVersion: '1.0.0',
      resource: '/',
      status: 'finding',
      reason: 'x',
      findings: [],
    },
  ],
  findings: [
    finding('a', 'high', 'Cookie sem HttpOnly'),
    finding('b', 'low', 'CSP ausente'),
    finding('c', 'low', 'HSTS curto'),
  ],
  logs: [],
  error: null,
  risk: { score: 62, grade: 'C', high: 1, medium: 0, low: 2, info: 0 },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((s) => {
    Object.defineProperty(window, '__TAURI__', {
      value: {
        core: {
          invoke: async (command: string) => {
            if (command === 'snapshot')
              return {
                projects: [
                  { id: 'p1', name: 'site', url: 'https://site.example/', createdAt: s.startedAt },
                ],
                scans: [s],
              };
            if (command.endsWith('history')) return [];
            if (command === 'start_scan') return s.id;
            return null;
          },
        },
        event: { listen: async () => () => {} },
      },
    });
  }, scan);
  await page.goto('/');
  await page.getByLabel('Link do site').fill('site.example');
  await page.getByRole('checkbox', { name: 'O site é meu', exact: false }).check();
  await page.getByRole('button', { name: 'Analisar', exact: true }).click();
});

test('scan result summarizes, filters by severity and expands findings', async ({ page }) => {
  const summary = page.getByRole('region', { name: 'Resumo da análise' });
  await expect(summary.getByRole('img', { name: /Índice 62 de 100, nota C/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '3 achados' })).toBeVisible();

  await summary.getByRole('button', { name: /Baixa 2/ }).click();
  await expect(page.getByRole('heading', { name: '2 achados · Baixa' })).toBeVisible();
  await summary.getByRole('button', { name: /tudo 3/ }).click();

  const head = page.getByRole('button', { name: /Cookie sem HttpOnly/ });
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Correção de Cookie sem HttpOnly')).toBeVisible();
  const detail = page.locator('.rs-finding.open');
  await detail.getByRole('button', { name: 'Gerar prompt de correção com IA' }).click();
  await expect(detail.getByRole('region', { name: 'AI Fix Studio' })).toBeVisible();
});
