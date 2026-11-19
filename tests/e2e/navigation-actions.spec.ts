import { expect, navigate, test, type Page } from './fixtures';
import type { Scan } from '../../apps/desktop/src/types';
import type { LabRun } from '../../apps/desktop/src/labTypes';
import { defaultSourceConfig, type SourceScan } from '../../apps/desktop/src/sourceTypes';

function savedScan(id: string, startedAt: string): Scan {
  return {
    schemaVersion: 1,
    engineVersion: '0.1.0',
    id,
    config: {
      projectId: 'fixture-project',
      url: 'https://example.invalid/',
      authorized: true,
      allowPrivate: false,
      pathPrefix: '/',
      maxRequests: 3,
      maxRedirects: 2,
      timeoutSeconds: 5,
    },
    startedAt,
    finishedAt: startedAt,
    status: 'completed',
    requestCount: 1,
    observations: [],
    checks: [],
    findings: [],
    logs: [],
    error: null,
    risk: null,
  };
}

async function nativeFixture(page: Page, active: 'source' | 'lab' | null = null) {
  const source: SourceScan = {
    schemaVersion: 1,
    id: 'source-running',
    rootName: 'fixture',
    startedAt: '2026-11-15T00:00:00Z',
    finishedAt: null,
    status: 'running',
    config: { ...defaultSourceConfig, authorized: true },
    stats: {
      files: 0,
      bytes: 0,
      skipped: 0,
      errors: 0,
      binaries: 0,
      directories: 0,
      truncated: false,
    },
    findings: [],
    dependencies: [],
    modules: [],
    logs: [],
    error: null,
  };
  const lab: LabRun = {
    id: 'lab-running',
    projectId: 'fixture-project',
    url: 'http://127.0.0.1/fixture',
    pathPrefix: '/fixture',
    environment: 'local',
    scenario: 'protected_route',
    maxRequests: 2,
    timeoutSeconds: 5,
    startedAt: '2026-11-15T00:00:00Z',
    finishedAt: null,
    status: 'running',
    requestCount: 0,
    verdict: 'not_run',
    reason: '',
    requests: [],
    logs: [],
    error: null,
  };
  await page.addInitScript(
    ({ scans, sourceRun, labRun }) => {
      Object.defineProperty(window, '__TAURI__', {
        value: {
          core: {
            invoke: async (command: string, args?: unknown) => {
              if (command === 'snapshot')
                return {
                  projects: [
                    {
                      id: 'fixture-project',
                      name: 'Projeto de navegação',
                      url: 'https://example.invalid/',
                      createdAt: '2026-11-15T00:00:00Z',
                    },
                  ],
                  scans,
                };
              if (command === 'source_history') return sourceRun ? [sourceRun] : [];
              if (command === 'lab_history') return labRun ? [labRun] : [];
              if (command === 'export_scan') {
                sessionStorage.setItem('navigation-export', JSON.stringify(args));
                return 'C:\\reports\\navigation.json';
              }
              if (command === 'delete_project') {
                sessionStorage.setItem('unexpected-delete', 'yes');
                return;
              }
              throw new Error(`Unexpected test-only IPC command: ${command}`);
            },
          },
          event: { listen: async () => () => {} },
        },
      });
    },
    {
      scans: [
        savedScan('newest-scan', '2026-11-15T10:00:00Z'),
        savedScan('older-scan', '2026-11-14T10:00:00Z'),
      ],
      sourceRun: active === 'source' ? source : null,
      labRun: active === 'lab' ? lab : null,
    },
  );
  await page.goto('/');
}

test('all primary and more-menu routes lead to their real content in the web preview', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  for (const [route, heading] of [
    ['Análise de código', 'Análise de código'],
    ['Achados', 'Inspetor de evidências HTTP'],
    ['Histórico', 'Histórico de execuções / comparação'],
    ['Laboratório', 'Laboratório de autorização'],
    ['Alvos', 'Alvos autorizados'],
    ['Auditoria HTTP', 'Auditoria HTTP / TLS'],
    ['Relatórios', 'Exportar relatórios'],
    ['Ferramentas locais', 'Utilitários locais'],
    ['Configuração', 'Configuração / política de segurança'],
    ['Sobre', 'Qypher / sobre esta versão'],
  ]) {
    await navigate(page, route);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await navigate(page, 'Análise de código');
  await expect(
    page.getByRole('button', { name: 'Selecionar repositório local', exact: true }),
  ).toBeDisabled();
  await navigate(page, 'Auditoria HTTP');
  await expect(page.getByRole('button', { name: 'Iniciar auditoria', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alvos autorizados', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('local tool buttons perform real processing and editing invalidates an earlier hash', async ({
  page,
}) => {
  await page.goto('/');
  await navigate(page, 'Ferramentas locais');
  const run = page.getByRole('button', { name: 'Analisar localmente', exact: true });
  const output = page.locator('.tool-output pre');
  await page.getByRole('button', { name: 'Hash & integridade', exact: false }).click();
  await page.getByLabel('Texto UTF-8').fill('abc');
  await run.click();
  const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  await expect(output).toContainText(abc);
  await page.getByLabel('Hash esperado (opcional)').fill(abc);
  await expect(page.getByText('Os hashes coincidem.', { exact: true })).toBeVisible();
  await page.getByLabel('Texto UTF-8').fill('changed');
  await expect(output).toHaveCount(0);
  await expect(page.getByText('Os hashes coincidem.', { exact: true })).toHaveCount(0);
  const file = page.getByLabel('Escolher arquivo local', { exact: true });
  const payload = { name: 'fixture.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') };
  await file.setInputFiles(payload);
  await expect(output).toContainText(abc);
  await page.getByLabel('Algoritmo').selectOption('SHA-512');
  await expect(output).toHaveCount(0);
  await file.setInputFiles(payload);
  await expect(output).toContainText('SHA-512');
  await page.getByRole('button', { name: 'Cookie analyzer', exact: false }).click();
  await page
    .getByLabel('Cabeçalho Set-Cookie')
    .fill('session=synthetic; Secure; HttpOnly; SameSite=Lax');
  await run.click();
  await expect(output).toContainText('"httpOnly": true');
  await expect(output).not.toContainText('synthetic');
  await page.getByRole('button', { name: 'CSP viewer', exact: false }).click();
  await page
    .getByLabel('Content-Security-Policy')
    .fill("default-src 'self'; script-src 'unsafe-eval'");
  await run.click();
  await expect(output).toContainText('unsafe-eval observado');
  await page.getByRole('button', { name: 'HTTP response diff', exact: false }).click();
  await page.getByLabel('Resposta anterior').fill('before\nshared');
  await page.getByLabel('Resposta atual').fill('after\nshared');
  await run.click();
  await expect(output).toContainText('before');
  await expect(output).toContainText('after');
  await page.getByRole('button', { name: 'SARIF reader', exact: false }).click();
  await page.getByLabel('Conteúdo SARIF (JSON)').fill('{"version":"2.1.0","runs":[]}');
  await run.click();
  await expect(output).toContainText('2.1.0');
  await page.getByRole('button', { name: 'JWT decoder', exact: false }).click();
  const jwt = [
    Buffer.from('{"alg":"none"}').toString('base64url'),
    Buffer.from('{"sub":"fixture-user"}').toString('base64url'),
    '',
  ].join('.');
  await page.getByLabel('Token JWT').fill(jwt);
  await run.click();
  await expect(output).toContainText('fixture-user');
  await expect(output).toContainText('NÃO VERIFICADA');
});

test('an in-flight local hash locks conflicting controls until the real digest completes', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const real = crypto.subtle.digest.bind(crypto.subtle);
    Object.defineProperty(crypto.subtle, 'digest', {
      value: async (...args: Parameters<SubtleCrypto['digest']>) => {
        await new Promise<void>((resolve) =>
          window.addEventListener('release-test-digest', () => resolve(), { once: true }),
        );
        return real(...args);
      },
    });
  });
  await page.goto('/');
  await navigate(page, 'Ferramentas locais');
  await page.getByRole('button', { name: 'Hash & integridade', exact: false }).click();
  await page.getByLabel('Texto UTF-8').fill('abc');
  await page.getByRole('button', { name: 'Analisar localmente', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cookie analyzer', exact: false })).toBeDisabled();
  await expect(page.getByLabel('Algoritmo')).toBeDisabled();
  await expect(page.getByLabel('Texto UTF-8')).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event('release-test-digest')));
  await expect(page.locator('.tool-output pre')).toContainText('ba7816bf8f01cfea');
  await expect(page.getByRole('button', { name: 'Cookie analyzer', exact: false })).toBeEnabled();
});

test('exporting the scan chosen in Results preserves that selection in Reports', async ({
  page,
}) => {
  await nativeFixture(page);
  await navigate(page, 'Achados');
  await expect(
    page.getByRole('heading', { name: 'Inspetor de evidências HTTP', exact: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Execução', exact: true }).selectOption('older-scan');
  await page.getByRole('button', { name: 'Exportar relatório', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Exportar relatórios', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Execução', exact: true })).toHaveValue(
    'older-scan',
  );
  await page.getByRole('button', { name: 'JSON', exact: false }).click();
  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem('navigation-export') ?? '{}')),
  ).toMatchObject({ id: 'older-scan', format: 'json', redact: true });
});

for (const active of ['source', 'lab'] as const) {
  test(`project deletion is disabled while a ${active} execution is active`, async ({ page }) => {
    await nativeFixture(page, active);
    await navigate(page, 'Alvos');
    await expect(
      page.getByRole('button', { name: 'Excluir Projeto de navegação', exact: true }),
    ).toBeDisabled();
    expect(await page.evaluate(() => sessionStorage.getItem('unexpected-delete'))).toBeNull();
  });
}
