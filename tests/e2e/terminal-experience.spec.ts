import { expect, navigate, settleAnimations, test } from './fixtures';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('browser preview explains native actions and links to real local tools', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem('test-terminal-copy', text);
        },
      },
    });
  });
  await page.goto('/');
  const runtime = page.getByRole('region', { name: 'Disponibilidade do motor' });
  await expect(
    runtime.getByText('Você está na prévia do navegador', { exact: true }),
  ).toBeVisible();
  await runtime.getByRole('button', { name: 'Como ativar o motor', exact: true }).click();
  await runtime.getByRole('button', { name: 'Copiar comando do desktop', exact: true }).click();
  expect(await page.evaluate(() => sessionStorage.getItem('test-terminal-copy'))).toBe(
    'npm.cmd run desktop:preview',
  );
  await runtime.getByRole('button', { name: 'Fechar instruções do motor' }).click();
  await runtime.getByRole('button', { name: 'Abrir ferramentas locais', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Utilitários locais', exact: true }),
  ).toBeVisible();
});

test('palette prepares URL scopes and the global terminal recalls commands without scanning', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.keyboard.press('Control+k');
  const search = page.getByLabel('Pesquisar comando');
  await search.fill('deep https://example.invalid/App');
  await search.press('Enter');
  await expect(page.getByLabel('Link do site')).toHaveValue('https://example.invalid/App');
  await expect(page.getByLabel('Modo de análise')).toHaveValue('deep');
  await expect(
    page.getByRole('checkbox', { name: 'O site é meu', exact: false }),
  ).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Analisar', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'scope.json', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'scope.json' })).toContainText(
    'https://example.invalid/App',
  );
  await page.getByRole('tab', { name: 'runtime', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'runtime' })).toContainText('unavailable');

  await page.keyboard.press('Control+j');
  const dock = page.getByRole('region', { name: 'Terminal Qypher', exact: true });
  const command = dock.getByRole('textbox', { name: 'Terminal do Qypher' });
  await command.fill('scan https://example.invalid/App');
  await command.press('Enter');
  await expect(
    dock.getByText('motor desconectado. abra o aplicativo desktop', { exact: false }),
  ).toBeVisible();
  await command.press('ArrowUp');
  await expect(command).toHaveValue('scan https://example.invalid/App');
  await command.press('ArrowDown');
  await expect(command).toHaveValue('');
  await command.fill('he');
  await command.press('Tab');
  await expect(command).toHaveValue('help ');
  await command.press('Enter');
  await expect(dock.getByText('comandos disponíveis:', { exact: true })).toBeVisible();
});

test('motion preferences work and terminal appearance remains accessible', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Configuração');
  await page.getByLabel('Animações da interface', { exact: false }).selectOption('off');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
  await navigate(page, 'Analisar site');
  const animation = await page
    .locator('.atmosphere-cursor')
    .evaluate((node) => getComputedStyle(node).animationName);
  expect(animation).toBe('none');
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
    path: 'test-results/terminal-experience.png',
    fullPage: true,
    animations: 'disabled',
  });
});

test('ASCII scenes animate locally, pause and respect reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const art = page.getByRole('complementary', { name: 'Arte ASCII do Qypher' });
  const frame = art.locator('.ascii-art');
  const initial = await frame.textContent();
  expect(initial?.trim().length).toBeGreaterThan(300);
  await expect.poll(() => frame.textContent()).not.toBe(initial);
  await art.getByRole('button', { name: 'Pausar arte ASCII' }).click();
  const paused = await frame.textContent();
  await page.waitForTimeout(300);
  expect(await frame.textContent()).toBe(paused);
  const gallery = art.getByRole('button', { name: 'Próxima arte ASCII', exact: true });
  await expect(gallery).toContainText('cadeado');
  await gallery.click();
  await expect(gallery).toContainText('órbita');
  expect(await frame.textContent()).not.toBe(paused);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await art.getByRole('button', { name: 'Retomar arte ASCII' }).click();
  const still = await frame.textContent();
  await page.waitForTimeout(300);
  expect(await frame.textContent()).toBe(still);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => frame.textContent()).not.toBe(still);
  await page.screenshot({
    path: 'test-results/ascii-orbit.png',
    fullPage: true,
    animations: 'disabled',
  });
});

test('reconnect reinstalls native event subscriptions after a connection failure', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI__', {
      value: {
        core: {
          invoke: async (command: string) => {
            if (command === 'snapshot') return { projects: [], scans: [] };
            if (command === 'source_history' || command === 'lab_history') return [];
            throw new Error(`Unexpected test-only IPC command: ${command}`);
          },
        },
        event: {
          listen: async (event: string) => {
            if (sessionStorage.getItem('allow-test-connection') !== 'yes')
              throw new Error('Fixture connection unavailable');
            const registered = JSON.parse(
              sessionStorage.getItem('test-native-events') || '[]',
            ) as string[];
            sessionStorage.setItem('test-native-events', JSON.stringify([...registered, event]));
            return () => {};
          },
        },
      },
    });
  });
  await page.goto('/');
  const reconnect = page.getByRole('button', { name: 'Reconectar', exact: true });
  await expect(reconnect).toBeEnabled();
  await page.evaluate(() => sessionStorage.setItem('allow-test-connection', 'yes'));
  await reconnect.click();
  await expect(
    page.getByRole('banner').getByText('motor conectado', { exact: true }),
  ).toBeVisible();
  const subscriptions = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('test-native-events') || '[]') as string[],
  );
  expect(subscriptions).toEqual(
    expect.arrayContaining([
      'scan-progress',
      'scan-finished',
      'source-progress',
      'source-finished',
      'lab-progress',
      'lab-finished',
      'storage-error',
    ]),
  );
  await page.getByLabel('Link do site').fill('https://example.invalid');
  await page.getByRole('checkbox', { name: 'O site é meu', exact: false }).check();
  await expect(page.getByRole('button', { name: 'Analisar', exact: true })).toBeEnabled();
});
