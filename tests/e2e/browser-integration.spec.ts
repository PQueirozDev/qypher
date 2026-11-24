import { test, expect, navigate } from './fixtures';

test.use({ startInTerminal: true });

async function mockNative(page: import('@playwright/test').Page, pendingUrl: string | null) {
  await page.addInitScript((url) => {
    let pending = url;
    let enabled = false;
    Object.defineProperty(window, '__TAURI__', {
      value: {
        core: {
          invoke: async (command: string, args?: { enabled?: boolean }) => {
            const calls = JSON.parse(sessionStorage.getItem('calls') ?? '[]');
            calls.push(command);
            sessionStorage.setItem('calls', JSON.stringify(calls));
            if (command === 'snapshot') return { projects: [], scans: [] };
            if (command.endsWith('history')) return [];
            if (command === 'take_scan_url') {
              const value = pending;
              pending = null;
              return value;
            }
            if (command === 'browser_integration_status' || command === 'set_browser_integration') {
              if (command === 'set_browser_integration') enabled = Boolean(args?.enabled);
              return {
                enabled,
                browsers: enabled ? ['Chrome', 'Edge'] : [],
                chromeExtensionId: 'cnpaofiocpinipphkapcebfcmamffkif',
              };
            }
            return null;
          },
        },
        event: { listen: async () => () => {} },
      },
    });
  }, pendingUrl);
}

test('a URL sent by the extension only pre-fills a new scan and unlocks the workspace', async ({
  page,
}) => {
  await mockNative(page, 'https://loja.example/produtos');
  await page.goto('/');
  await expect(page.getByLabel('Link do site')).toHaveValue('https://loja.example/produtos');
  // Nada é iniciado sem a autorização explícita na tela.
  const calls = await page.evaluate(() => JSON.parse(sessionStorage.getItem('calls') ?? '[]'));
  expect(calls).not.toContain('start_scan');
  await expect(
    page.getByRole('checkbox', { name: 'O site é meu', exact: false }),
  ).not.toBeChecked();
});

test('settings enable and disable the browser integration explicitly', async ({ page }) => {
  await mockNative(page, null);
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir workspace' }).click();
  await navigate(page, 'Configuração');
  const enable = page.getByRole('button', { name: 'Ativar integração com o navegador' });
  await expect(enable).toBeVisible();
  await expect(page.getByText('cnpaofiocpinipphkapcebfcmamffkif')).toBeVisible();
  await enable.click();
  await expect(page.getByText('Ativa: Chrome, Edge')).toBeVisible();
  await page.getByRole('button', { name: 'Desativar integração' }).click();
  await expect(page.getByText('Desativada', { exact: true })).toBeVisible();
});
