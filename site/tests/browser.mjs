import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const baseURL = process.env.SITE_BASE_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
});
const errors = [];
const summary = {};
const artifactDirectory = new URL('../../tmp/visual2/', import.meta.url);
await fs.mkdir(artifactDirectory, { recursive: true });
const artifact = (name) => new URL(name, artifactDirectory).pathname.replace(/^\/([A-Z]:)/, '$1');
const axeSource = await fs.readFile(
  new URL('../../node_modules/axe-core/axe.min.js', import.meta.url),
  'utf8',
);
async function axe(page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () =>
    (
      await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      })
    ).violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
    })),
  );
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.clock.install();
  assert.equal((await page.goto(baseURL)).status(), 200);
  await page.locator('.feature-icon').first().waitFor();
  await page.clock.runFor(2500);
  assert(Number(await page.locator('.blip-a').getAttribute('data-detections')) >= 1);
  assert.equal(await page.locator('#radar-panel').getAttribute('data-finding'), 'csp');
  assert.equal(await page.locator('#radar-feed [data-finding="csp"]').count(), 1);
  const cspPulse = await page.locator('.blip-a').getAttribute('data-detections');
  await page.locator('.blip-a').click();
  assert.equal(await page.locator('.blip-a').getAttribute('aria-pressed'), 'true');
  await page.mouse.move(10, 10);
  await page.clock.runFor(11000);
  assert.equal(await page.locator('#radar-panel').getAttribute('data-finding'), 'csp');
  assert.equal(await page.locator('#radar-panel').getAttribute('data-mode'), 'pinned');
  assert(Number(await page.locator('.blip-c').getAttribute('data-detections')) >= 1);
  assert(Number(await page.locator('.blip-b').getAttribute('data-detections')) >= 1);
  assert.equal(await page.locator('#radar-feed li[data-finding]').count(), 3);
  await page.locator('#radar-auto').click();
  await page.locator('.blip-c').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#radar-panel').getAttribute('data-finding'), 'env');
  assert.equal(await page.locator('.blip-c').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.blip-c').getAttribute('aria-pressed'), 'false');
  await page.locator('.blip-a').hover();
  await page.clock.runFor(2200);
  assert.equal(await page.locator('#radar-panel').getAttribute('data-finding'), 'csp');
  await page.mouse.move(10, 10);
  summary.radar = {
    scanSynchronization: 'passed',
    pinAcrossSweep: 'passed',
    keyboardSelection: 'passed',
    threeSharedEvents: 'passed',
    initialDetections: cspPulse,
  };

  await page.locator('#motion-toggle').click();
  const sweep = await page
    .locator('.radar-scene')
    .evaluate((el) => el.style.getPropertyValue('--sweep'));
  await page.clock.runFor(1500);
  assert.equal(
    await page.locator('.radar-scene').evaluate((el) => el.style.getPropertyValue('--sweep')),
    sweep,
  );
  await page.locator('#motion-toggle').click();
  await page.locator('#terminal-preview').scrollIntoViewIfNeeded();
  await page.clock.runFor(6500);
  assert.equal(await page.locator('.terminal-line.pending').count(), 0);
  await page.locator('[data-command="help"]').click();
  assert.match(await page.locator('#command-output').innerText(), /help.*comandos disponíveis/s);
  await page.locator('#demo-command').fill('<img src=x onerror=alert(1)>');
  await page.locator('#demo-form').evaluate((form) => form.requestSubmit());
  assert.match(await page.locator('#command-output').innerText(), /Comando indisponível/);
  assert.equal(await page.locator('#command-output img').count(), 0);
  await page.locator('[data-command="clear"]').click();
  assert.equal(
    await page
      .locator('#command-output')
      .innerText()
      .catch(() => ''),
    '',
  );
  assert.equal(await page.locator('.terminal-output').isHidden(), true);
  await page.locator('[data-command="about"]').click();
  assert.match(await page.locator('#command-output').innerText(), /QYPHER/);
  await page.locator('[data-command="demo"]').click();
  await page.clock.runFor(6500);
  assert.equal(await page.locator('.terminal-output').isVisible(), true);
  assert.equal(await page.locator('.terminal-line.pending').count(), 0);
  await page.locator('#crt-toggle').uncheck();
  assert.equal(await page.locator('#terminal-preview').getAttribute('data-crt'), 'off');
  await page.locator('#crt-toggle').check();
  summary.terminal = {
    guidedDemo: 'passed',
    fourCommands: 'passed',
    unsupportedInputRejected: 'passed',
    noInjectedElements: 'passed',
    crtSwitch: 'passed',
  };

  await page.locator('#tab-interface').click();
  assert.equal(await page.locator('#terminal-preview').isHidden(), true);
  await page.waitForFunction(
    () => document.querySelector('#interface-preview img').naturalWidth > 0,
  );
  assert.equal(
    await page.locator('#interface-preview img').evaluate((img) => img.naturalWidth),
    1440,
  );
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#tab-terminal').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#interface-preview').isHidden(), true);
  summary.gallery = 'real screenshot and keyboard tabs passed';
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenCanvas = await page.locator('#ambient').evaluate((el) => el.toDataURL());
  await page.clock.runFor(1200);
  assert.equal(await page.locator('#ambient').evaluate((el) => el.toDataURL()), hiddenCanvas);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  summary.visibility = 'animation suspension and resumption on visibilitychange passed';

  const links = await page
    .locator('a[href]')
    .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')));
  for (const hash of links.filter((link) => link.startsWith('#')))
    assert.equal(await page.locator(hash).count(), 1, hash);
  assert.equal(await page.locator('.get').count(), 3);
  for (const target of [
    'https://github.com/PQueirozDev/qypher',
    'https://github.com/PQueirozDev/qypher/releases/latest',
    'https://github.com/PQueirozDev/qypher#readme',
    'https://pqueirozdev.com.br/',
  ])
    assert(links.includes(target), target);
  summary.links = 'anchors, GitHub, three release links and portfolio preserved';

  summary.layouts = [];
  for (const width of [320, 360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.clock.runFor(150);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
      `Overflow at ${width}`,
    );
    // Every marker must remain reachable, rather than sit underneath the panel.
    for (const selector of ['.blip-a', '.blip-b', '.blip-c']) {
      const accessible = await page.locator(selector).evaluate((el) => {
        const box = el.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit === el || el.contains(hit);
      });
      // Mobile's orbit can be below the current viewport; scroll to it first.
      if (!accessible) {
        await page.locator(selector).scrollIntoViewIfNeeded();
        await page.clock.runFor(100);
        assert(
          await page.locator(selector).evaluate((el) => {
            const box = el.getBoundingClientRect();
            return el.contains(
              document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
            );
          }),
          `Marker obscured at ${width}: ${selector}`,
        );
      }
    }
    summary.layouts.push(width);
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.clock.runFor(300);
  summary.desktopAxe = await axe(page);
  await page.screenshot({ path: artifact('hero-desktop.png') });
  await page.locator('#produto').scrollIntoViewIfNeeded();
  await page.clock.runFor(6000);
  await page.screenshot({ path: artifact('terminal-desktop.png') });
  await page.locator('#tab-interface').click();
  await page.screenshot({ path: artifact('interface-desktop.png') });
  await page.locator('#tab-terminal').click();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.runFor(200);
  assert.equal(await page.locator('#motion-toggle').isDisabled(), true);
  assert.equal(await page.locator('.terminal-line.pending').count(), 0);
  const canvas = await page.locator('#ambient').evaluate((el) => el.toDataURL());
  await page.clock.runFor(1000);
  assert.equal(await page.locator('#ambient').evaluate((el) => el.toDataURL()), canvas);
  const ascii = await page.locator('#ascii-logo').textContent();
  await page.clock.runFor(1000);
  assert.equal(await page.locator('#ascii-logo').textContent(), ascii);
  summary.reducedMotion = 'static canvas, ASCII, complete terminal and readable panels passed';

  const touch = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  });
  touch.on('pageerror', (error) => errors.push(error.message));
  await touch.goto(baseURL);
  await touch.locator('#motion-toggle:disabled').waitFor();
  await touch.locator('.menu-toggle').tap();
  assert.equal(await touch.locator('#navigation').isVisible(), true);
  await touch.keyboard.press('Escape');
  assert.equal(await touch.locator('.menu-toggle').getAttribute('aria-expanded'), 'false');
  await touch.locator('.blip-c').tap();
  assert.equal(await touch.locator('#radar-panel').getAttribute('data-finding'), 'env');
  assert.equal(await touch.locator('#radar-panel').getAttribute('data-mode'), 'pinned');
  assert.equal(
    await touch.locator('.cursor-halo').evaluate((el) => getComputedStyle(el).display),
    'none',
  );
  const panelBox = await touch.locator('#radar-panel').boundingBox();
  const orbitBox = await touch.locator('.radar-parallax').boundingBox();
  assert(panelBox.y >= orbitBox.y + orbitBox.height, 'Mobile panel should follow the orbit');
  summary.mobileAxe = await axe(touch);
  await touch.evaluate(() => scrollTo(0, 0));
  await touch.screenshot({ path: artifact('mobile.png'), fullPage: true });
  summary.touch = 'menu, marker selection, panel positioning and native cursor passed';
  const nojs = await browser.newPage({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  await nojs.goto(baseURL);
  assert.equal(await nojs.locator('.terminal-line').count(), 7);
  assert.equal(await nojs.locator('.terminal-line.pending').count(), 0);
  assert.equal(await nojs.locator('#demo-form').isHidden(), true);
  summary.withoutJavaScript =
    'essential content and guided example visible; interactive commands hidden';
  summary.unexpectedRequests = [...new Set(requests)].filter(
    (url) => !url.startsWith(baseURL.replace(/\/$/, '')) && !url.startsWith('https://fonts.'),
  );
  summary.errors = errors;
  await fs.writeFile(new URL('results.json', artifactDirectory), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(summary.desktopAxe, []);
  assert.deepEqual(summary.mobileAxe, []);
  assert.deepEqual(summary.unexpectedRequests, []);
} finally {
  await browser.close();
}
