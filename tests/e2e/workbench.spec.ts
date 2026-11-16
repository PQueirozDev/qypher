import { expect, test } from '@playwright/test';
test('command console and palette dispatch real navigation without a system shell', async ({
  page,
}) => {
  await page.goto('/');
  const command = page.getByRole('textbox', { name: 'Comando interno do Qypher' });
  await command.fill('help');
  await command.press('Enter');
  await expect(page.getByText('command.help', { exact: true })).toBeVisible();
  await command.fill('powershell -enc data');
  await command.press('Enter');
  await expect(page.getByText('Comando interno desconhecido.', { exact: false })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command dispatch' })).toBeVisible();
  await page.getByLabel('Pesquisar comando').fill('repo');
  await page.getByLabel('Pesquisar comando').press('Enter');
  await expect(page.getByRole('heading', { name: 'Análise de código', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Selecionar repositório local' })).toBeDisabled();
  await page.screenshot({
    path: 'test-results/source-lab.png',
    fullPage: true,
    animations: 'disabled',
  });
});
// IPC-only double: no repository file or antivirus process is opened by this test.
test('source scope is supplied by native selection and external lookup starts disabled', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI__', {
      value: {
        core: {
          invoke: async (command: string, args?: unknown) => {
            if (command === 'lab_history' || command === 'source_reviews') return [];
            if (command === 'snapshot') return { projects: [], scans: [] };
            if (command === 'source_history') return [];
            if (command === 'antivirus_status')
              return { engine: 'ClamAV', available: false, detail: 'Test fixture: not installed.' };
            if (command === 'pick_repository')
              return {
                token: 'native-selected-token',
                name: 'fixture-repo',
                path: 'C:\\fixture-repo',
              };
            if (command === 'start_source') {
              sessionStorage.setItem('test-source', JSON.stringify(args));
              return 'test-source-id';
            }
            throw new Error('Unsupported test command');
          },
        },
        event: { listen: async () => () => {} },
      },
    });
  });
  await page.goto('/');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Análise de código', exact: true })
    .click();
  const start = page.getByRole('button', { name: 'Iniciar análise de código' });
  await expect(start).toBeDisabled();
  await page.getByRole('button', { name: 'Selecionar repositório local' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'OSV advisory lookup', exact: false }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'ClamAV signature scan', exact: false }),
  ).toBeDisabled();
  await page
    .getByRole('checkbox', { name: 'Tenho autorização para analisar', exact: false })
    .check();
  await start.click();
  const args = await page.evaluate(() => JSON.parse(sessionStorage.getItem('test-source') ?? '{}'));
  expect(args.token).toBe('native-selected-token');
  expect(args.config.authorized).toBe(true);
  expect(args.config.osv).toBe(false);
  expect(args.config.antivirus).toBe(false);
  expect(args).not.toHaveProperty('path');
});
