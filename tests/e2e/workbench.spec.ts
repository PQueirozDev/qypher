import { expect, navigate, test } from './fixtures';
test.describe('terminal-first startup', () => {
  test.use({ startInTerminal: true });
  test('startup terminal runs only internal commands, recalls history and unlocks the workspace', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const sidebar = page.getByRole('complementary', { name: 'Navegação do workspace' });
    await expect(sidebar).toHaveCount(0);
    const command = page.getByRole('textbox', { name: 'Terminal do Qypher' });
    await command.fill('help');
    await command.press('Enter');
    await expect(page.getByText('comandos disponíveis:', { exact: true })).toBeVisible();
    await command.fill('powershell -enc data');
    await command.press('Enter');
    await expect(
      page.getByText('comando não encontrado: powershell', { exact: true }),
    ).toBeVisible();
    await command.press('ArrowUp');
    await expect(command).toHaveValue('powershell -enc data');
    await command.press('ArrowUp');
    await expect(command).toHaveValue('help');
    await command.press('ArrowDown');
    await expect(command).toHaveValue('powershell -enc data');
    await command.press('ArrowDown');
    await expect(command).toHaveValue('');
    await command.fill('unl');
    await command.press('Tab');
    await expect(command).toHaveValue('unlock ');
    await command.press('Enter');
    await expect(sidebar).toBeVisible();
  });
});

test('command palette dispatches real navigation without a system shell', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command dispatch' })).toBeVisible();
  const search = page.getByLabel('Pesquisar comando');
  await search.fill('powershell -enc data');
  await expect(page.getByText('Nenhuma ação corresponde à busca.', { exact: true })).toBeVisible();
  await search.fill('código');
  await search.press('Enter');
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
  await navigate(page, 'Análise de código');
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
