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

  test.describe('when the system asks for reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('plays a calm fade-only splash instead of a blank screen', async ({ page }) => {
      await page.goto('/');
      const splash = page.locator('.boot-splash');
      await expect(splash).toHaveClass(/calm/);
      // Fora de .t-shell: as regras globais de movimento do workspace não o desligam.
      await expect(page.locator('.t-shell .boot-splash')).toHaveCount(0);
      const letter = splash.locator('.boot-word span').first();
      await expect(letter).toHaveCSS('animation-name', 'boot-fade-in');
      await expect(letter).toHaveCSS('opacity', '1', { timeout: 3000 });
      await expect(splash.locator('.boot-lines li').last()).toHaveCSS('opacity', '1');
      await expect(splash).toBeHidden({ timeout: 6000 });
    });

    test('“Ativadas” in settings overrides the system preference', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('qypher.motion', 'on'));
      await page.goto('/');
      const splash = page.locator('.boot-splash');
      await expect(splash).not.toHaveClass(/calm/);
      await expect(splash.locator('.boot-word span').first()).toHaveCSS(
        'animation-name',
        'boot-rise',
      );
      await expect(splash).toBeHidden({ timeout: 6000 });
      await page
        .getByRole('complementary', { name: 'Navegação do workspace', exact: true })
        .getByRole('button', { name: 'Painel', exact: true })
        .click();
      await expect(page.locator('.t-inner')).toHaveCSS('animation-name', 'm-page');
    });
  });
});
