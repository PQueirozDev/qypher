import { expect, test } from '@playwright/test';

test('presentation site is independent from the desktop and exposes honest release information', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI__', {
      value: {
        core: {
          invoke: () => {
            throw new Error('The presentation must never invoke the native engine');
          },
        },
      },
    });
  });
  const response = await page.goto('http://127.0.0.1:1421/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Você cria com IA.');
  await expect(page.locator('form,input,textarea')).toHaveCount(0);
  await page.getByRole('link', { name: 'Conhecer o app', exact: false }).click();
  await expect(page).toHaveURL(/#app$/);
  expect(
    await page
      .locator('.app-preview img')
      .evaluate((node) => (node as HTMLImageElement).naturalWidth),
  ).toBe(1440);
  await page.getByRole('link', { name: 'Versão desktop', exact: false }).click();
  await expect(page).toHaveURL(/#download$/);
  await expect(
    page.getByText('v0.1.0 em desenvolvimento · download ainda indisponível', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('a[download],a[href$=".exe"],a[href$=".msi"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('mobile presentation menu, FAQ and reduced-motion preview remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:1421/');
  const frame = page.locator('#ascii-frame');
  const still = await frame.textContent();
  expect(still?.trim().length).toBeGreaterThan(300);
  await page.waitForTimeout(200);
  expect(await frame.textContent()).toBe(still);
  const menu = page.getByRole('button', { name: 'Menu', exact: false });
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('navigation').getByRole('link', { name: 'Perguntas', exact: true }).click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await page.getByText('O Qypher é um site ou um aplicativo?', { exact: false }).click();
  await expect(page.locator('details').first()).toHaveAttribute('open', '');
  await expect(page.locator('details').first()).toContainText(
    'É um aplicativo desktop com Tauri e Rust.',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
