#!/usr/bin/env node

/**
 * Chat-first demo browser smoke.
 *
 * Serves the chat-builder bundle and drives it in a real browser (Playwright
 * WebKit by default) to prove the layout assembles around the pinned chat across
 * the tool-driven stages, with no page navigation and no console errors.
 *
 * Usage:
 *   node examples/visual-demo/chat-builder-smoke.js [--port N] [--browser webkit|chromium|firefox] [--timeout MS]
 */

import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  startStaticServer,
  symbioteEngineRoot,
  symbioteJsRoot,
  symbioteUiRoot,
  workspacePackageRoot,
} from './server-utils.js';
import { writeChatBuilderDemo } from './chat-builder-runtime.js';

function readArg(name, fallback) {
  let i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] || fallback);
}

const REQUIRED_REGIONS = ['chat', 'preview', 'inspector', 'graph', 'logs'];

async function run() {
  let port = Number(readArg('--port', '4577'));
  let browserName = readArg('--browser', 'webkit');
  let timeout = Number(readArg('--timeout', '60000'));
  let workspaceRoot = workspacePackageRoot(import.meta.url);
  let outputDir = resolve(join(workspaceRoot, 'tmp', 'chat-builder-smoke'));

  let summary = await writeChatBuilderDemo({ outputDir, port });
  let uiRoot = await symbioteUiRoot(workspaceRoot);
  let engineRoot = await symbioteEngineRoot(workspaceRoot);
  let symbioteRoot = await symbioteJsRoot(workspaceRoot);
  let server = await startStaticServer({ outputDir, workspaceRoot, uiRoot, engineRoot, symbioteRoot, port });

  let playwright = await import('playwright');
  let browser = await playwright[browserName].launch();
  let page = await browser.newPage();
  let errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  let result = { status: 'fail' };
  try {
    let startUrl = `http://localhost:${port}/`;
    await page.goto(startUrl, { waitUntil: 'networkidle', timeout });
    await page.waitForFunction(() => Boolean(window.__chatBuilder), { timeout });
    await page.waitForSelector('.symbiote-workspace', { timeout });

    let stageCount = await page.evaluate(() => window.__chatBuilder.stageCount);

    // Walk every stage; record rendered DOM size and panel presence.
    let progression = [];
    for (let i = 0; i < stageCount; i++) {
      await page.evaluate((idx) => window.__chatBuilder.go(idx), i);
      await page.waitForSelector('.symbiote-workspace', { timeout });
      let snap = await page.evaluate(() => {
        let ws = document.querySelector('.symbiote-workspace');
        return {
          panels: (document.body.dataset.stagePanels || '').split(',').filter(Boolean),
          pinnedChat: document.body.dataset.pinnedChat,
          domSize: ws ? ws.textContent.length : 0,
          hasChat: Boolean(ws && /chat/i.test(ws.textContent)),
          url: location.href,
        };
      });
      progression.push(snap);
    }

    let first = progression[0];
    let last = progression.at(-1);
    // The chat is introduced after the empty scaffold; once placed it must persist
    // as the center while every other region is added around it.
    let chatStart = progression.findIndex((s) => s.panels.includes('chat'));
    let assertions = {
      mounted: progression.every((s) => s.domSize > 0),
      noNavigation: progression.every((s) => s.url === startUrl),
      chatPersists: chatStart !== -1 && progression.slice(chatStart).every((s) => s.panels.includes('chat')),
      grows: last.domSize > first.domSize,
      finalHasAllRegions: REQUIRED_REGIONS.every((r) => last.panels.includes(r)),
      chatPinned: last.pinnedChat === 'true',
      noConsoleErrors: errors.length === 0,
    };
    let ok = Object.values(assertions).every(Boolean);
    result = {
      status: ok ? 'ok' : 'fail',
      browser: browserName,
      stageCount,
      firstPanels: first.panels,
      finalPanels: last.panels,
      domGrowth: [first.domSize, last.domSize],
      assertions,
      errors: errors.slice(0, 5),
    };
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    await rm(outputDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'ok') process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await run();
}
