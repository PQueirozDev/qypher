import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import type { LabRequest, LabRun } from '../../apps/desktop/src/labTypes';

const require = createRequire(import.meta.url);

interface LabTestState {
  calls: { command: string; args?: Record<string, unknown> }[];
  emit: (event: string, payload: unknown) => void;
}
declare global {
  interface Window {
    __qypherLabTest: LabTestState;
  }
}

function savedRun(status: LabRun['status'] = 'completed'): LabRun {
  return {
    id: status === 'running' ? 'lab-running-fixture' : 'lab-history-fixture',
    projectId: 'lab-project-fixture',
    url: 'http://127.0.0.1:8878/app/fixture/private',
    pathPrefix: '/app',
    environment: 'local',
    scenario: 'protected_route',
    maxRequests: 4,
    timeoutSeconds: 5,
    startedAt: '2026-11-15T12:00:00Z',
    finishedAt: status === 'running' ? null : '2026-11-15T12:00:01Z',
    status,
    requestCount: status === 'running' ? 1 : 2,
    verdict: status === 'running' ? 'not_run' : 'not_reproduced',
    reason: 'Fixture de IPC: referência válida e rejeição esperada sem conteúdo privado.',
    requests: [
      {
        identity: 'owner',
        method: 'GET',
        url: 'http://127.0.0.1:8878/app/fixture/private',
        status: 200,
        expected: '2xx com marcador sintético',
        markerObserved: true,
        elapsedMs: 12,
        cookies: [],
      },
      ...(status === 'running'
        ? []
        : [
            {
              identity: 'anonymous',
              method: 'GET',
              url: 'http://127.0.0.1:8878/app/fixture/private',
              status: 403,
              expected: 'HTTP 403 sem marcador sintético',
              markerObserved: false,
              elapsedMs: 9,
              cookies: [],
            },
          ]),
    ],
    logs: [],
    error: null,
  };
}

// Test-only IPC double. No credential, request or result is produced by the app's scanner here.
// Captures remain in a private test object in memory; no browser storage is used by this double.
async function laboratory(page: Page, history: LabRun[] = []) {
  await page.addInitScript(
    ({ initialHistory, template }) => {
      const handlers = new Map<string, Set<(event: { payload: unknown }) => void>>();
      const state: LabTestState = {
        calls: [],
        emit: (event, payload) => handlers.get(event)?.forEach((handler) => handler({ payload })),
      };
      let runs = initialHistory;
      window.__qypherLabTest = state;
      Object.defineProperty(window, '__TAURI__', {
        value: {
          core: {
            invoke: async (command: string, args?: Record<string, unknown>) => {
              if (command === 'snapshot')
                return {
                  projects: [
                    {
                      id: 'lab-project-fixture',
                      name: 'Fixture local do laboratório',
                      url: 'http://127.0.0.1:8878/app',
                      createdAt: '2026-11-15T00:00:00Z',
                    },
                    {
                      id: 'lab-staging-fixture',
                      name: 'Fixture de homologação',
                      url: 'https://staging.example.invalid/app',
                      createdAt: '2026-11-15T00:00:00Z',
                    },
                  ],
                  scans: [],
                };
              if (command === 'source_history' || command === 'source_reviews') return [];
              if (command === 'lab_history') return runs;
              if (command === 'start_lab') {
                state.calls.push({ command, args });
                const input = args?.request as LabRequest;
                const run: LabRun = {
                  ...template,
                  id: 'lab-submitted-fixture',
                  projectId: input.projectId,
                  url: input.url,
                  pathPrefix: input.pathPrefix,
                  environment: input.environment,
                  scenario: input.scenario,
                  maxRequests: input.maxRequests,
                  timeoutSeconds: input.timeoutSeconds,
                };
                runs = [run, ...runs];
                state.emit('lab-finished', run);
                return run.id;
              }
              if (command === 'export_lab') {
                state.calls.push({ command, args });
                return 'C:\\reports\\lab-fixture.json';
              }
              if (command === 'cancel_scan') {
                state.calls.push({ command, args });
                const run = runs.find((item) => item.id === args?.id);
                if (run) {
                  const cancelled: LabRun = {
                    ...run,
                    status: 'cancelled',
                    verdict: 'inconclusive',
                    finishedAt: '2026-11-15T12:00:01Z',
                  };
                  runs = runs.map((item) => (item.id === cancelled.id ? cancelled : item));
                  state.emit('lab-finished', cancelled);
                }
                return;
              }
              throw new Error(`Unsupported Lab test command: ${command}`);
            },
          },
          event: {
            listen: async (event: string, handler: (event: { payload: unknown }) => void) => {
              const registered = handlers.get(event) ?? new Set();
              registered.add(handler);
              handlers.set(event, registered);
              return () => registered.delete(handler);
            },
          },
        },
      });
    },
    { initialHistory: history, template: savedRun() },
  );
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Laboratório', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Laboratório de autorização', exact: true }),
  ).toBeVisible();
}

async function consent(page: Page) {
  await page
    .getByRole('checkbox', { name: 'Permito acesso à rede local/privada', exact: false })
    .check();
  await page
    .getByRole('checkbox', {
      name: 'Confirmo uso exclusivo de contas e recursos fictícios',
      exact: false,
    })
    .check();
  await page.getByRole('checkbox', { name: 'Tenho autorização explícita', exact: false }).check();
}

test('Lab requires three local consents and sends input-only credentials before clearing them', async ({
  page,
}) => {
  await laboratory(page);
  const start = page.getByRole('button', { name: 'Executar cenário controlado', exact: true });
  await expect(start).toBeDisabled();
  await page.getByLabel('Projeto autorizado', { exact: true }).selectOption('lab-project-fixture');
  await expect(page.getByLabel('Prefixo de caminho autorizado')).toHaveValue('/app');
  await page
    .getByLabel('URL do recurso fictício')
    .fill('http://127.0.0.1:8878/app/fixture/private');
  await page.getByLabel('Cenário', { exact: true }).selectOption('account_isolation');
  const owner = page.getByLabel('Credencial da conta de referência', { exact: true });
  const challenger = page.getByLabel('Credencial da conta sem acesso', { exact: true });
  await expect(owner).toHaveAttribute('type', 'password');
  await expect(challenger).toHaveAttribute('type', 'password');
  await expect(owner).toHaveAttribute('autocomplete', 'off');
  await owner.fill('qypher-test-only-owner-token');
  await challenger.fill('qypher-test-only-other-token');
  await page.getByRole('checkbox', { name: 'Tenho autorização explícita', exact: false }).check();
  await expect(start).toBeDisabled();
  await page
    .getByRole('checkbox', {
      name: 'Confirmo uso exclusivo de contas e recursos fictícios',
      exact: false,
    })
    .check();
  await expect(start).toBeDisabled();
  await page
    .getByRole('checkbox', { name: 'Permito acesso à rede local/privada', exact: false })
    .check();
  await expect(start).toBeEnabled();
  await expect(page.getByLabel('Limite de requisições')).toHaveAttribute('min', '2');
  await expect(page.getByLabel('Limite de requisições')).toHaveAttribute('max', '8');
  await expect(page.getByLabel('Timeout por requisição (segundos)')).toHaveAttribute('max', '15');
  await start.click();
  const invocation = await page.evaluate(
    () => window.__qypherLabTest.calls.find((call) => call.command === 'start_lab')?.args,
  );
  expect(invocation).toEqual({
    request: {
      projectId: 'lab-project-fixture',
      url: 'http://127.0.0.1:8878/app/fixture/private',
      pathPrefix: '/app',
      authorized: true,
      syntheticDataConfirmed: true,
      environment: 'local',
      allowPrivate: true,
      scenario: 'account_isolation',
      marker: 'qypher-fixture-resource-owner',
      ownerCredential: { kind: 'bearer', value: 'qypher-test-only-owner-token' },
      challengerCredential: { kind: 'bearer', value: 'qypher-test-only-other-token' },
      expectedDeniedStatus: 403,
      maxRequests: 4,
      timeoutSeconds: 5,
    },
  });
  await expect(owner).toHaveValue('');
  await expect(challenger).toHaveValue('');
  await expect(
    page.getByRole('checkbox', { name: 'Tenho autorização explícita', exact: false }),
  ).not.toBeChecked();
  const persisted = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  );
  expect(persisted).not.toContain('qypher-test-only-owner-token');
  expect(persisted).not.toContain('qypher-test-only-other-token');
  await expect(page.locator('body')).not.toContainText('qypher-test-only-owner-token');
  await expect(page.locator('body')).not.toContainText('qypher-test-only-other-token');
});

test('changing Lab scope or environment requires fresh consent', async ({ page }) => {
  await laboratory(page);
  await page.getByLabel('Projeto autorizado', { exact: true }).selectOption('lab-project-fixture');
  await page
    .getByLabel('Credencial da conta de referência', { exact: true })
    .fill('qypher-test-only-owner-token');
  await consent(page);
  await page
    .getByLabel('URL do recurso fictício')
    .fill('http://127.0.0.1:8878/app/fixture/changed');
  for (const name of [
    'Tenho autorização explícita',
    'Confirmo uso exclusivo de contas e recursos fictícios',
    'Permito acesso à rede local/privada',
  ]) {
    await expect(page.getByRole('checkbox', { name, exact: false })).not.toBeChecked();
  }
  await consent(page);
  await page.getByLabel('Prefixo de caminho autorizado').fill('/app/fixture');
  await expect(
    page.getByRole('button', { name: 'Executar cenário controlado', exact: true }),
  ).toBeDisabled();
  await consent(page);
  await page.getByLabel('Ambiente', { exact: true }).selectOption('staging');
  await expect(
    page.getByRole('checkbox', { name: 'Tenho autorização explícita', exact: false }),
  ).not.toBeChecked();
  await page.getByLabel('Projeto autorizado', { exact: true }).selectOption('lab-staging-fixture');
  await expect(page.getByLabel('URL do recurso fictício')).toHaveValue(
    'https://staging.example.invalid/app',
  );
  await expect(page.getByLabel('Prefixo de caminho autorizado')).toHaveValue('/app');
  await page
    .getByLabel('Credencial da conta de referência', { exact: true })
    .fill('qypher-test-only-staging-token');
  await page
    .getByRole('checkbox', {
      name: 'Confirmo uso exclusivo de contas e recursos fictícios',
      exact: false,
    })
    .check();
  await page.getByRole('checkbox', { name: 'Tenho autorização explícita', exact: false }).check();
  await expect(
    page.getByRole('checkbox', { name: 'Permito acesso à rede local/privada', exact: false }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Executar cenário controlado', exact: true }),
  ).toBeEnabled();
});

test('saved Lab evidence renders sanitized metadata and exports with path redaction', async ({
  page,
}) => {
  await laboratory(page, [savedRun()]);
  await expect(page.getByRole('heading', { name: 'Não reproduzido', exact: true })).toBeVisible();
  const results = page.getByRole('region', { name: 'Resultados do laboratório' });
  await expect(results.getByRole('row')).toHaveCount(3);
  await expect(results.getByRole('cell', { name: 'owner', exact: true })).toBeVisible();
  await expect(results.getByRole('cell', { name: 'anonymous', exact: true })).toBeVisible();
  await results
    .getByRole('button', { name: 'Exportar evidências do laboratório', exact: true })
    .click();
  const invocation = await page.evaluate(
    () => window.__qypherLabTest.calls.find((call) => call.command === 'export_lab')?.args,
  );
  expect(invocation).toEqual({ id: 'lab-history-fixture', redactPaths: true });
  await expect(results.getByText('Relatório salvo em', { exact: false })).toBeVisible();
});

test('active Lab cancellation uses its run ID and updates the result to inconclusive', async ({
  page,
}) => {
  await laboratory(page, [savedRun('running')]);
  const stop = page.getByRole('button', { name: 'Interromper laboratório', exact: true });
  await expect(stop).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Exportar evidências do laboratório', exact: true }),
  ).toBeDisabled();
  await stop.click();
  const invocation = await page.evaluate(
    () => window.__qypherLabTest.calls.find((call) => call.command === 'cancel_scan')?.args,
  );
  expect(invocation).toEqual({ id: 'lab-running-fixture' });
  await expect(page.getByRole('heading', { name: 'Inconclusivo', exact: true })).toBeVisible();
  await expect(stop).toBeDisabled();
});

test('Lab controls and saved evidence have no automatically detected WCAG A/AA violations', async ({
  page,
}) => {
  await laboratory(page, [savedRun()]);
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(async () =>
    (
      window as unknown as { axe: { run(options: unknown): Promise<{ violations: unknown[] }> } }
    ).axe
      .run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })
      .then((result) => result.violations),
  );
  expect(violations).toEqual([]);
  await page.screenshot({
    path: 'test-results/lab-mode.png',
    fullPage: true,
    animations: 'disabled',
  });
});
