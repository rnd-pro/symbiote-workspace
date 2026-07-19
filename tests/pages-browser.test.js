import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import mime from 'mime';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_DIR = join(ROOT, '_site');
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '/');

function normalizeBasePath(value) {
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

async function fileForRequest(pathname) {
  if (!pathname.startsWith(BASE_PATH)) return null;
  let relativePath = decodeURIComponent(pathname.slice(BASE_PATH.length));
  if (!relativePath || relativePath.endsWith('/')) relativePath += 'index.html';
  const file = resolve(SITE_DIR, relativePath);
  if (file !== SITE_DIR && !file.startsWith(`${SITE_DIR}${sep}`)) return null;
  try {
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

async function startPagesServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://pages.test');
      const file = await fileForRequest(url.pathname);
      if (!file) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': mime.getType(extname(file)) || 'application/octet-stream',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Pages test server did not expose a TCP port.');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}

function installFailureGate(page, label) {
  const failures = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`${label} console: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`${label} pageerror: ${error.stack || error.message}`));
  page.on('requestfailed', (request) => {
    failures.push(`${label} requestfailed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${label} HTTP ${response.status()}: ${response.url()}`);
  });
  return async () => {
    await page.waitForTimeout(100);
    assert.deepEqual(failures, []);
  };
}

async function openPage(browser, origin, path, contextOptions, label) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const assertClean = installFailureGate(page, label);
  const response = await page.goto(`${origin}${BASE_PATH}${path}`, { waitUntil: 'networkidle' });
  assert.equal(response?.status(), 200);
  return { context, page, assertClean };
}

test('the built Pages artifact passes Chromium acceptance under a project path', async (t) => {
  const server = await startPagesServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await server.close();
  });

  await t.test('desktop landing supports theme persistence and keyboard navigation', async () => {
    const { context, page, assertClean } = await openPage(
      browser,
      server.origin,
      '',
      { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
      'desktop landing',
    );
    assert.equal(await page.locator('h1').isVisible(), true);
    assert.equal(await page.locator('ol[data-pipeline] > li').count(), 4);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
    await page.locator('[data-theme-toggle]').click();
    assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('lp-skip-link')), true);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content');
    await page.locator('[data-search-trigger]').click();
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await assertClean();
    await context.close();
  });

  await t.test('mobile landing has no horizontal overflow', async () => {
    const { context, page, assertClean } = await openPage(
      browser,
      server.origin,
      '',
      { viewport: { width: 390, height: 844 }, isMobile: true },
      'mobile landing',
    );
    assert.equal(await page.locator('h1').isVisible(), true);
    assert.equal(await page.locator('.lp-header-nav summary').isVisible(), true);
    await page.locator('.lp-header-nav summary').click();
    assert.equal(await page.locator('.lp-header-nav-menu a[href*="/docs/"]').first().isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await assertClean();
    await context.close();
  });

  await t.test('docs pages constrain embedded media and never scroll horizontally', async () => {
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    for (const path of ['docs/', 'docs/getting-started/', 'docs/reference/']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.route('**/*', (route) => {
        if (route.request().url().startsWith(server.origin)) return route.continue();
        return route.fulfill({ contentType: 'image/gif', body: pixel });
      });
      const response = await page.goto(`${server.origin}${BASE_PATH}${path}`, { waitUntil: 'load' });
      assert.equal(response?.status(), 200);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        true,
        `${path} must not scroll horizontally`,
      );
      assert.equal(
        await page.evaluate(() => [...document.querySelectorAll('.prose img')].every((img) => getComputedStyle(img).maxWidth === '100%')),
        true,
        `${path} must cap article images at the article width`,
      );
      await context.close();
    }
  });

  await t.test('reduced motion disables landing animations', async () => {
    const { context, page, assertClean } = await openPage(
      browser,
      server.origin,
      '',
      { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' },
      'reduced-motion landing',
    );
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('js-active')), true);
    const durations = await page
      .locator('.ill-stage, .motion-surface .lp-anim-dash, .motion-surface .lp-anim-pulse, .motion-surface .lp-anim-float')
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).animationDuration));
    assert.ok(durations.length >= 4);
    for (const duration of durations) {
      assert.match(duration, /^0(?:\.001)?s$/, `reduced motion left a running animation: ${duration}`);
    }
    await assertClean();
    await context.close();
  });

  await t.test('landing remains useful with JavaScript disabled', async () => {
    const { context, page, assertClean } = await openPage(
      browser,
      server.origin,
      '',
      { viewport: { width: 1280, height: 800 }, javaScriptEnabled: false },
      'no-JavaScript landing',
    );
    assert.equal(await page.locator('h1').isVisible(), true);
    assert.equal(await page.locator('.lp-story-row').first().isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('js-active')), false);
    assert.deepEqual(
      await page.locator('.ill-stage').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).opacity)),
      ['1', '1', '1', '1'],
    );
    await assertClean();
    await context.close();
  });

  await t.test('generated visual demo boots a constructed scenario from _site', async () => {
    const { context, page, assertClean } = await openPage(
      browser,
      server.origin,
      'demo/',
      { viewport: { width: 1440, height: 960 }, colorScheme: 'dark' },
      'visual demo',
    );
    await page.waitForFunction(() => Array.isArray(window.__chatBuilder?.keys) && window.__chatBuilder.keys.length > 0);
    assert.equal(await page.locator('workspace-shell').count(), 1);
    assert.equal(await page.locator('.cb-class').count(), await page.evaluate(() => window.__chatBuilder.keys.length));
    const scenarioKey = await page.evaluate(() => window.__chatBuilder.recommendedKey || window.__chatBuilder.keys[0]);
    await page.evaluate((key) => {
      window.__pagesDemoBoot = { key, status: 'pending' };
      window.__chatBuilder.show(key, false).then(
        (result) => { window.__pagesDemoBoot = { key, status: 'fulfilled', result }; },
        (error) => { window.__pagesDemoBoot = { key, status: 'rejected', error: String(error?.stack || error) }; },
      );
    }, scenarioKey);
    await page.waitForFunction(() => window.__pagesDemoBoot?.status !== 'pending', null, { timeout: 15_000 });
    assert.deepEqual(
      await page.evaluate(() => window.__pagesDemoBoot),
      { key: scenarioKey, status: 'fulfilled', result: true },
    );
    assert.equal(await page.locator('panel-layout').count() > 0, true);
    assert.equal(await page.locator('chat-workspace').count() > 0, true);
    await assertClean();
    await context.close();
  });
});
