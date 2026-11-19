import { expect, navigate, test } from './fixtures';
// Test double for the IPC boundary only; this does not run or validate the Rust engine.
test('scan form requires fresh consent and sends bounded configuration to IPC', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const bridge = {
      core: {
        invoke: async (command: string, args?: unknown) => {
          if (command === 'lab_history') return [];
          if (command === 'source_history') return [];
          if (command === 'snapshot')
            return {
              projects: [
                {
                  id: 'fixture',
                  name: 'Projeto de teste IPC',
                  url: 'https://example.invalid/',
                  createdAt: '2026-01-01T00:00:00Z',
                },
              ],
              scans: [],
            };
          if (command === 'start_scan') {
            sessionStorage.setItem('test-invocation', JSON.stringify(args));
            return 'test-scan';
          }
          throw new Error(`Unsupported test command ${command}`);
        },
      },
      event: { listen: async () => () => {} },
    };
    Object.defineProperty(window, '__TAURI__', { value: bridge });
  });
  await page.goto('/');
  await navigate(page, 'Auditoria HTTP');
  const start = page.getByRole('button', { name: 'Iniciar auditoria' });
  await expect(start).toBeDisabled();
  await page.getByLabel('Confirmo minha autorização', { exact: false }).check();
  await expect(start).toBeEnabled();
  await page.getByLabel('URL do alvo', { exact: false }).fill('https://example.invalid/app');
  await expect(start).toBeDisabled();
  await page.getByLabel('Confirmo minha autorização', { exact: false }).check();
  await start.click();
  const call = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('test-invocation') ?? '{}'),
  );
  expect(call.config.authorized).toBe(true);
  expect(call.config.allowPrivate).toBe(false);
  expect(call.config.maxRequests).toBe(3);
  expect(call.config.url).toBe('https://example.invalid/app');
});
