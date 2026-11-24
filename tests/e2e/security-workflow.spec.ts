import { expect, navigate, test, type Page } from './fixtures';
import type { Scan } from '../../apps/desktop/src/types';

function fixture(): Scan {
  return {
    schemaVersion: 1,
    engineVersion: '0.1.0',
    id: 'fixture-home-scan',
    config: {
      projectId: 'fixture-project',
      url: 'https://example.invalid/app',
      authorized: true,
      allowPrivate: false,
      pathPrefix: '/app',
      maxRequests: 3,
      maxRedirects: 2,
      timeoutSeconds: 10,
      discovery: false,
      activeChecks: false,
    },
    startedAt: '2026-11-15T10:00:00Z',
    finishedAt: '2026-11-15T10:00:02Z',
    status: 'completed',
    requestCount: 1,
    observations: [],
    checks: [
      {
        detectorId: 'headers.csp',
        detectorVersion: '1.0.0',
        resource: 'https://example.invalid/app',
        status: 'finding',
        reason: 'Política permissiva.',
        findings: [],
      },
    ],
    findings: [
      {
        id: 'fixture-finding',
        detectorId: 'headers.csp',
        detectorVersion: '1.0.0',
        title: 'Política CSP permissiva',
        category: 'HTTP',
        severity: 'medium',
        confidence: 'observed',
        classification: 'configuration',
        location: 'https://example.invalid/app',
        evidence: 'Uma diretiva permissiva foi observada.',
        impact: 'Requer revisão do contexto.',
        recommendation: 'Restrinja as origens.',
        references: [],
        sample: 'LEGACY_RAW_CREDENTIAL_MUST_NOT_APPEAR',
      },
    ],
    logs: [
      {
        at: '2026-11-15T10:00:00Z',
        level: 'info',
        event: 'scan.start',
        message: 'Iniciando análise da fixture.',
      },
      {
        at: '2026-11-15T10:00:01Z',
        level: 'warn',
        event: 'headers.csp',
        message: 'CSP permissiva observada.',
      },
      {
        at: '2026-11-15T10:00:02Z',
        level: 'error',
        event: 'transport.error',
        message: 'Falha controlada da fixture; password=legacy-log-password',
      },
    ],
    error: null,
    risk: { score: 88, grade: 'B', high: 0, medium: 1, low: 0, info: 0 },
  };
}

// Only the renderer/IPC contract is doubled; no request reaches a scanned target.
async function workspace(page: Page, saved?: Scan) {
  await page.addInitScript((scan) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem('test-copy', text);
        },
      },
    });
    Object.defineProperty(window, '__TAURI__', {
      value: {
        core: {
          invoke: async (command: string, args?: unknown) => {
            if (command === 'source_history' || command === 'lab_history') return [];
            if (command === 'snapshot')
              return {
                projects: [
                  {
                    id: 'fixture-project',
                    name: 'Projeto de teste',
                    url: 'https://example.invalid/',
                    createdAt: '2026-11-15T00:00:00Z',
                  },
                ],
                scans: scan ? [scan] : [],
              };
            if (command === 'start_scan') {
              const calls = JSON.parse(sessionStorage.getItem('test-starts') ?? '[]');
              calls.push(args);
              sessionStorage.setItem('test-starts', JSON.stringify(calls));
              return 'fixture-home-scan';
            }
            if (command === 'export_scan') {
              sessionStorage.setItem('test-export', JSON.stringify(args));
              return 'C:\\reports\\fixture.json';
            }
            throw new Error(`Unsupported fixture command ${command}`);
          },
        },
        event: { listen: async () => () => {} },
      },
    });
  }, saved);
  await page.goto('/');
}

test('quick and deep scans keep consent, network permission and path scope explicit', async ({
  page,
}) => {
  await workspace(page);
  await navigate(page, 'Analisar site');
  await expect(page.getByLabel('Modo de análise')).toHaveValue('quick');
  const input = page.getByLabel('Link do site');
  const consent = page.getByRole('checkbox', { name: 'O site é meu', exact: false });
  const start = page.getByRole('button', { name: 'Analisar', exact: true });
  await input.fill('https://example.invalid/app?token=private-query');
  await expect(start).toBeDisabled();
  const privateNetwork = page.getByRole('checkbox', {
    name: 'Permito acesso a localhost',
    exact: false,
  });
  await privateNetwork.focus();
  await privateNetwork.press('Space');
  await expect(privateNetwork).toBeChecked();
  await privateNetwork.press('Space');
  await expect(privateNetwork).not.toBeChecked();
  await consent.focus();
  await consent.press('Space');
  await expect(consent).toBeChecked();
  await consent.press('Space');
  await expect(consent).not.toBeChecked();
  await expect(start).toBeDisabled();
  await page
    .locator('.hero-copy form')
    .screenshot({ path: 'test-results/scope-controls-unchecked.png', animations: 'disabled' });
  await consent.press('Space');
  await expect(start).toBeEnabled();
  await start.click();
  let calls = await page.evaluate(() => JSON.parse(sessionStorage.getItem('test-starts') ?? '[]'));
  expect(calls[0].config).toMatchObject({
    url: 'https://example.invalid/app',
    pathPrefix: '/app',
    authorized: true,
    allowPrivate: false,
    discovery: false,
    activeChecks: false,
    maxRequests: 3,
  });
  await expect(consent).not.toBeChecked();
  await consent.check();
  await page.getByLabel('Modo de análise').selectOption('deep');
  await expect(consent).not.toBeChecked();
  const active = page.getByRole('checkbox', { name: 'Autorizo sondagens ativas', exact: false });
  await expect(active).not.toBeChecked();
  await consent.check();
  await active.check();
  await expect(consent).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Permito acesso a localhost', exact: false }).check();
  await consent.check();
  await page
    .locator('.hero-copy form')
    .screenshot({ path: 'test-results/scope-controls-checked.png', animations: 'disabled' });
  await start.click();
  calls = await page.evaluate(() => JSON.parse(sessionStorage.getItem('test-starts') ?? '[]'));
  expect(calls[1].config).toMatchObject({
    pathPrefix: '/app',
    discovery: true,
    activeChecks: true,
    allowPrivate: true,
    maxRequests: 60,
  });
});

test('redirect failures never start a new origin, raw samples stay hidden and exports use redaction', async ({
  page,
}) => {
  const scan = fixture();
  scan.status = 'failed';
  scan.error = 'Alvo redireciona para https://other.invalid/private';
  await workspace(page, scan);
  await page.getByRole('button', { name: 'Analisar site', exact: true }).click();
  await page.getByLabel('Link do site').fill('https://example.invalid/app');
  await page.getByRole('checkbox', { name: 'O site é meu', exact: false }).check();
  await page.getByRole('button', { name: 'Analisar', exact: true }).click();
  await expect(page.getByText(scan.error, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem('test-starts') ?? '[]').length),
  ).toBe(1);
  expect(await page.content()).not.toContain('LEGACY_RAW_CREDENTIAL_MUST_NOT_APPEAR');
  await expect(page.getByRole('button', { name: 'Revelar', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem('test-export') ?? '{}')),
  ).toMatchObject({ id: scan.id, format: 'json', redact: true });
  await page.getByRole('button', { name: /Corrigir com IA/ }).click();
  const studio = page.getByRole('region', { name: 'AI Fix Studio' }).first();
  await studio.getByRole('button', { name: 'Revisar prompt', exact: true }).click();
  await studio.getByLabel('Assistente de destino').selectOption('codex');
  await expect(studio.getByLabel('Prévia do prompt')).toHaveValue(/Codex:/);
  await studio.getByRole('button', { name: 'Copiar prompt de correção', exact: true }).click();
  const copied = await page.evaluate(() => sessionStorage.getItem('test-copy'));
  expect(copied).toContain('testes de regressão');
  expect(copied).not.toContain('LEGACY_RAW_CREDENTIAL_MUST_NOT_APPEAR');
});

test('execution logs keep every real event sanitized while clearing the terminal only affects its view', async ({
  page,
}) => {
  await workspace(page, fixture());
  await navigate(page, 'Achados');
  await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
  const logs = page.getByRole('log', { name: 'Logs da execução' });
  await expect(logs.getByText('Iniciando análise da fixture.', { exact: false })).toBeVisible();
  await expect(logs.getByText('CSP permissiva observada.', { exact: false })).toBeVisible();
  await expect(logs.getByText('Falha controlada da fixture;', { exact: false })).toBeVisible();
  await expect(logs).toContainText('ERROR');
  await expect(logs).not.toContainText('legacy-log-password');

  await page
    .getByRole('complementary', { name: 'Navegação do workspace' })
    .getByRole('button', { name: 'Alternar terminal global', exact: true })
    .click();
  const dock = page.getByRole('region', { name: 'Terminal Qypher', exact: true });
  const command = dock.getByRole('textbox', { name: 'Terminal do Qypher' });
  await command.fill('history');
  await command.press('Enter');
  await expect(dock.getByText('ID        STATUS      ALVO', { exact: false })).toBeVisible();
  await dock.getByRole('button', { name: 'Limpar terminal', exact: true }).click();
  await expect(dock.getByText('ID        STATUS      ALVO', { exact: false })).toHaveCount(0);
  await expect(logs.getByText('Iniciando análise da fixture.', { exact: false })).toBeVisible();
});
