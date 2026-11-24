import { expect, navigate, settleAnimations, test, type Page } from './fixtures';
import { createRequire } from 'node:module';
import { defaultSourceConfig, type SourceScan } from '../../apps/desktop/src/sourceTypes';

const require = createRequire(import.meta.url);

// Test-only IPC snapshots exercise the UI contract; Rust tests validate exports.
async function sourceWorkspace(page: Page, status: SourceScan['status'] = 'completed') {
  const scan: SourceScan = {
    scopeId: 'source-fixture-scope',
    schemaVersion: 1,
    id: 'source-export-fixture',
    rootName: 'authorized-fixture',
    startedAt: '2026-11-14T00:00:00Z',
    finishedAt: status === 'running' ? null : '2026-11-14T00:01:00Z',
    status,
    config: { ...defaultSourceConfig, authorized: true },
    stats: {
      files: 305,
      bytes: 1024,
      skipped: 0,
      errors: 0,
      binaries: 0,
      directories: 1,
      truncated: false,
    },
    findings: Array.from({ length: 205 }, (_, index) => ({
      id: `finding-${index + 1}`,
      ruleId: index === 204 ? 'secrets.possible-credential' : 'js.eval',
      detectorVersion: '1.0.0',
      title: `Achado ${index + 1}`,
      category: index === 204 ? 'secrets' : 'sast',
      severity: index === 204 ? 'high' : 'medium',
      confidence: 'heuristic',
      path: `src/file-${index + 1}.ts`,
      line: index + 1,
      evidence: 'Somente metadados; nenhum valor secreto.',
      impact: 'Revisão necessária.',
      recommendation: 'Revise o fluxo de dados.',
      reference: 'CWE-95',
    })),
    dependencies: Array.from({ length: 305 }, (_, index) => ({
      ecosystem: 'npm',
      name: `package-${index + 1}`,
      version: '1.0.0',
      path: 'package-lock.json',
    })),
    modules: [
      { id: 'source.sast', version: '1.0.0', status: 'completed', detail: 'Fixture de teste.' },
    ],
    logs: [],
    error: null,
  };
  await page.addInitScript((fixture) => {
    let reviews: { scanId: string; findingId: string; disposition: string; reviewedAt: string }[] =
      [];
    Object.defineProperty(window, '__TAURI__', {
      value: {
        core: {
          invoke: async (command: string, args?: unknown) => {
            if (command === 'lab_history') return [];
            if (command === 'source_reviews') return reviews;
            if (command === 'review_source') {
              const review = args as { id: string; findingId: string; falsePositive: boolean };
              reviews = reviews.filter((item) => item.findingId !== review.findingId);
              if (review.falsePositive)
                reviews.push({
                  scanId: review.id,
                  findingId: review.findingId,
                  disposition: 'false_positive',
                  reviewedAt: '2026-11-15T12:00:00Z',
                });
              return;
            }
            if (command === 'source_predeploy')
              return {
                status: reviews.some((item) => item.findingId === 'finding-205')
                  ? 'review_required'
                  : 'blocked',
                reason: 'Política da fixture: revisar cobertura e achados.',
                blockers: reviews.length ? 0 : 1,
                reviewed: reviews.length,
                checksNotCompleted: ['dependencies.osv'],
                comparison: null,
              };
            if (command === 'snapshot') return { projects: [], scans: [] };
            if (command === 'source_history') return [fixture];
            if (command === 'antivirus_status')
              return { engine: 'ClamAV', available: false, detail: 'Fixture.' };
            if (command === 'export_source') {
              sessionStorage.setItem('test-source-export', JSON.stringify(args));
              if (sessionStorage.getItem('test-export-outcome') === 'error')
                throw new Error('Falha de gravação da fixture.');
              return sessionStorage.getItem('test-export-outcome') === 'cancel'
                ? null
                : 'C:\\reports\\source.sarif';
            }
            throw new Error(`Unsupported test command: ${command}`);
          },
        },
        event: { listen: async () => () => {} },
      },
    });
  }, scan);
  await page.goto('/');
  await navigate(page, 'Análise de código');
  await expect(page.getByRole('heading', { name: 'authorized-fixture' })).toBeVisible();
}

test('all source findings and dependencies remain reachable beyond the former display limits', async ({
  page,
}) => {
  await sourceWorkspace(page);
  const findings = page.getByRole('navigation', {
    name: 'Páginas de achados de código',
    exact: true,
  });
  await expect(findings.getByRole('status')).toHaveText('Página 1 de 5 · 205 itens');
  await expect(page.locator('.source-finding')).toHaveCount(50);
  for (let index = 0; index < 4; index++)
    await findings.getByRole('button', { name: /próxima/ }).click();
  await expect(page.getByText('Achado 205', { exact: true })).toBeVisible();
  await expect(findings.getByRole('button', { name: /próxima/ })).toBeDisabled();
  await page.getByLabel('Pesquisar achados de código').fill('205');
  await expect(findings.getByRole('status')).toHaveText('Página 1 de 1 · 1 itens');
  await page.getByLabel('Severidade dos achados de código').selectOption('medium');
  await expect(page.locator('.source-finding')).toHaveCount(0);
  await page.getByLabel('Severidade dos achados de código').selectOption('high');
  await page.getByLabel('Categoria de código').selectOption('secrets');
  await expect(page.getByText('Achado 205', { exact: true })).toBeVisible();
  await page.locator('.dependency-inventory > summary').click();
  const dependencies = page.getByRole('navigation', {
    name: 'Páginas de dependências',
    exact: true,
  });
  for (let index = 0; index < 3; index++)
    await dependencies.getByRole('button', { name: /próxima/ }).click();
  await expect(page.getByText('package-305', { exact: true })).toBeVisible();
  await expect(dependencies.getByRole('status')).toHaveText('Página 4 de 4 · 305 itens');
});

test('exports the saved scan with explicit format and path privacy independent of filters', async ({
  page,
}) => {
  await sourceWorkspace(page);
  const button = page.getByRole('button', { name: 'Exportar relatório de código', exact: true });
  await expect(page.getByLabel('Ocultar nomes e caminhos no relatório')).toBeChecked();
  await button.click();
  const exportArgs = () =>
    page.evaluate(() => JSON.parse(sessionStorage.getItem('test-source-export') ?? '{}'));
  expect(await exportArgs()).toEqual({
    id: 'source-export-fixture',
    redactPaths: true,
    format: 'json',
  });
  await page.getByLabel('Pesquisar achados de código').fill('not-found');
  await page.getByLabel('Formato do relatório de código').selectOption('sarif');
  await page.getByLabel('Ocultar nomes e caminhos no relatório').uncheck();
  await button.click();
  expect(await exportArgs()).toEqual({
    id: 'source-export-fixture',
    redactPaths: false,
    format: 'sarif',
  });
  await expect(page.getByText('Artefato salvo em', { exact: false })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('test-export-outcome', 'cancel'));
  await button.click();
  await expect(page.getByText('Exportação cancelada.', { exact: true })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('test-export-outcome', 'error'));
  await button.click();
  await expect(page.getByText('Falha de gravação da fixture.', { exact: false })).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(page.getByText('Artefato salvo em', { exact: false })).toHaveCount(0);
});

test('running source scans cannot be exported', async ({ page }) => {
  await sourceWorkspace(page, 'running');
  await expect(
    page.getByRole('button', { name: 'Exportar relatório de código', exact: true }),
  ).toBeDisabled();
});

test('false positives are reversible and pre-deploy uses the saved run without hiding coverage gaps', async ({
  page,
}) => {
  await sourceWorkspace(page);
  await page.getByLabel('Pesquisar achados de código').fill('205');
  await page.locator('.source-finding > summary').click();
  await page.getByRole('button', { name: 'Verificar antes do deploy', exact: true }).click();
  await expect(page.getByText('Bloqueado pela política local', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Marcar como falso positivo', exact: true }).click();
  await expect(page.locator('.source-finding')).toHaveCount(0);
  await page.getByLabel('Revisão dos achados de código').selectOption('false_positive');
  await expect(page.getByText('Achado 205', { exact: true })).toBeVisible();
  await page.locator('.source-finding > summary').click();
  await page.getByRole('button', { name: 'Verificar antes do deploy', exact: true }).click();
  await expect(page.getByText('Revisão necessária', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Verificações incompletas: dependencies.osv.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar achado pendente', exact: true }).click();
  await expect(page.locator('.source-finding')).toHaveCount(0);
  await page.getByLabel('Revisão dos achados de código').selectOption('open');
  await expect(page.getByText('Achado 205', { exact: true })).toBeVisible();
});

test('source results and export controls have no automatically detected WCAG A/AA violations', async ({
  page,
}) => {
  await sourceWorkspace(page);
  await settleAnimations(page);
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
    path: 'test-results/source-results.png',
    fullPage: true,
    animations: 'disabled',
  });
});
