import { expect, navigate, test } from './fixtures';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
test('web preview is honest and has no fake scan results', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Painel');
  await expect(
    page.getByRole('banner').getByText('motor desconectado', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Nenhum alvo configurado.', { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/dashboard.png',
    fullPage: true,
    animations: 'disabled',
  });
  await navigate(page, 'Auditoria HTTP');
  await expect(page.getByRole('button', { name: 'Iniciar auditoria' })).toBeDisabled();
  await page.screenshot({
    path: 'test-results/new-scan.png',
    fullPage: true,
    animations: 'disabled',
  });
});
test('local hashing is usable without a native runtime', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Ferramentas locais');
  await page.getByRole('button', { name: 'Hash & integridade', exact: false }).click();
  await page.getByLabel('Texto UTF-8').fill('abc');
  await page.getByRole('button', { name: 'Analisar localmente' }).click();
  await expect(
    page.getByText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', {
      exact: false,
    }),
  ).toBeVisible();
});
test('dashboard has no automatically detectable WCAG A/AA violations', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Painel');
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const result = await page.evaluate(async () =>
    (
      window as unknown as { axe: { run(options: unknown): Promise<{ violations: unknown[] }> } }
    ).axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }),
  );
  expect(result.violations).toEqual([]);
});
