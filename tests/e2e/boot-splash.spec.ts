import { test, expect } from './fixtures';

test.describe('boot splash', () => {
  test.use({ bootSplash: true });

  test('opens over the app once, then reveals the workspace', async ({ page }) => {
    await page.goto('/');
    const splash = page.locator('.boot-splash');
    await expect(splash).toBeVisible();
    await expect(splash).toContainText('motor local');
    await expect(splash).toContainText('modo navegador');
    await expect(splash).toBeHidden({ timeout: 6000 });
    await expect(page.locator('html')).not.toHaveAttribute('data-boot', 'reveal', {
      timeout: 2000,
    });
    await page.reload();
    await expect(page.locator('.boot-splash')).toHaveCount(0);
  });

  test('Escape skips the splash', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.boot-splash')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.boot-splash')).toBeHidden({ timeout: 1500 });
  });

  test('can be turned off in settings', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Escape');
    await page.evaluate(() => sessionStorage.clear());
    await page
      .getByRole('complementary', { name: 'Navegação do workspace', exact: true })
      .getByRole('button', { name: 'Configuração', exact: true })
      .click();
    await page.getByRole('checkbox', { name: 'Animação de abertura do aplicativo' }).uncheck();
    await page.reload();
    await expect(page.locator('.boot-splash')).toHaveCount(0);
  });
});
