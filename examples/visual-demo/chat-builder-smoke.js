#!/usr/bin/env node

/**
 * Chat-first demo browser smoke.
 *
 * Serves the chat-builder bundle and drives it in a real browser (Playwright WebKit by
 * default) to prove the questionnaire-driven, multi-scenario demo: it opens on the chat,
 * and selecting each workspace class mounts that scenario's constructed config through
 * `panel-layout` with the chat docked on the RIGHT and real workspace components seeded
 * with non-trivial content — no navigation, no console errors. A full-page screenshot is
 * captured per scenario.
 *
 * Usage:
 *   node examples/visual-demo/chat-builder-smoke.js [--port N] [--browser webkit|chromium|firefox]
 *     [--timeout MS] [--screenshot-dir DIR] [--fixture]
 */

import { mkdir, rm } from 'node:fs/promises';
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

function hasArg(name) {
  return process.argv.includes(name);
}

/**
 * Minimal contract-shaped fixture covering all three classes, used to self-test the
 * runtime while the real questionnaire driver lands. Each `config` is a real workspace
 * whose root is a horizontal split with the chat panel as the SECOND child (chat on the
 * right, full height) and the workspace panels on the left.
 */
const FIXTURE = {
  chatPanel: 'chat',
  chatComponent: 'chat-workspace',
  scenarios: [
    fixtureScenario('programming', 'Programming', 'agent programming', 'editor', [
      { id: 'module-selection', type: 'multi-select', prompt: 'Modules',
        options: [{ value: 'source', label: 'Source' }, { value: 'preview', label: 'Preview' }],
        chosen: ['source', 'preview'] },
    ], { source: 'source-editor', preview: 'sn-canvas-viewport' }),
    fixtureScenario('video', 'Video', 'video editing studio', 'video', [
      { id: 'tracks', type: 'multi-select', prompt: 'Timeline tracks',
        options: [{ value: 'video', label: 'Video' }, { value: 'audio', label: 'Audio' }],
        chosen: ['video', 'audio'] },
    ], { stage: 'sn-canvas-viewport', timeline: 'sn-timeline-editor' }),
    fixtureScenario('automation', 'Automation', 'workflow automation', 'flow', [
      { id: 'trigger', type: 'single-select', prompt: 'Trigger',
        options: [{ value: 'webhook', label: 'Webhook' }, { value: 'schedule', label: 'Schedule' }],
        chosen: 'webhook' },
    ], { flow: 'node-canvas', inspector: 'inspector-panel' }),
  ],
};

function fixtureScenario(key, label, intent, template, questions, panels) {
  let [firstType, firstComponent] = Object.entries(panels)[0];
  let [secondType, secondComponent] = Object.entries(panels)[1];
  let panelTypes = {
    [firstType]: { title: firstComponent, icon: 'code', component: firstComponent,
      behavior: { importance: 95, minInlineSize: 480, minBlockSize: 300, collapse: 'auto', overflow: 'scroll-block', responsiveMode: 'stack', responsiveBreakpoint: 760 } },
    [secondType]: { title: secondComponent, icon: 'preview', component: secondComponent,
      behavior: { importance: 68, minInlineSize: 320, minBlockSize: 260, collapse: 'auto', overflow: 'scroll-block', responsiveMode: 'stack', responsiveBreakpoint: 760 } },
    chat: { title: 'Chat', icon: 'chat', component: 'chat-workspace',
      behavior: { collapse: 'never', importance: 100, minInlineSize: 360, minBlockSize: 320, overflow: 'scroll-block', responsiveMode: 'stack', responsiveBreakpoint: 760 } },
  };
  return {
    key, label, intent, template, questions, stages: [],
    config: {
      version: '0.2.0', name: label, register: 'tool', groups: [], sections: [],
      panelTypes, layouts: {},
      layout: {
        type: 'split', direction: 'horizontal', ratio: 0.64,
        first: { type: 'split', direction: 'vertical', ratio: 0.6,
          first: { type: 'panel', panelType: firstType, panelState: {} },
          second: { type: 'panel', panelType: secondType, panelState: {} } },
        second: { type: 'panel', panelType: 'chat', panelState: {} },
      },
      events: [], components: { catalog: [firstComponent, secondComponent, 'chat-workspace'] },
    },
    exportJson: '',
  };
}

async function run() {
  let port = Number(readArg('--port', '4577'));
  let browserName = readArg('--browser', 'webkit');
  let timeout = Number(readArg('--timeout', '60000'));
  let useFixture = hasArg('--fixture');
  let workspaceRoot = workspacePackageRoot(import.meta.url);
  let outputDir = resolve(join(workspaceRoot, 'tmp', 'chat-builder-smoke'));
  let screenshotDir = resolve(readArg('--screenshot-dir', join(workspaceRoot, 'tmp')));

  let summary = await writeChatBuilderDemo({
    outputDir,
    port,
    scenarios: useFixture ? FIXTURE.scenarios : undefined,
  });
  let uiRoot = await symbioteUiRoot(workspaceRoot);
  let engineRoot = await symbioteEngineRoot(workspaceRoot);
  let symbioteRoot = await symbioteJsRoot(workspaceRoot);
  let server = await startStaticServer({ outputDir, workspaceRoot, uiRoot, engineRoot, symbioteRoot, port });

  let playwright = await import('playwright');
  let browser = await playwright[browserName].launch();
  let page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  let errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  await mkdir(screenshotDir, { recursive: true });

  let result = { status: 'fail' };
  try {
    let startUrl = `http://localhost:${port}/`;
    await page.goto(startUrl, { waitUntil: 'networkidle', timeout });
    await page.waitForFunction(() => Boolean(window.__chatBuilder), { timeout });

    let keys = await page.evaluate(() => window.__chatBuilder.keys);
    let chatComponent = await page.evaluate(() => window.__chatBuilder.chatComponent);

    // The page must open on the chat (menu mode), not a constructed workspace.
    let opensOnChat = await page.evaluate((tag) => {
      let stage = document.getElementById('stage');
      let hasLayout = Boolean(document.querySelector('panel-layout'));
      let chat = document.querySelector(tag);
      return Boolean(stage && stage.classList.contains('cb-menu-mode') && chat && !hasLayout);
    }, chatComponent);

    let scenarioResults = {};
    for (let key of keys) {
      await page.evaluate((k) => window.__chatBuilder.show(k), key);
      await page.waitForSelector('panel-layout', { timeout });
      await page.waitForFunction(
        () => Boolean(document.querySelector('panel-layout .layout-root, panel-layout layout-node')),
        { timeout },
      );
      // Wait until the chat-workspace and at least two workspace components hold content.
      await page.waitForFunction(
        ({ tag }) => {
          let layout = document.querySelector('panel-layout');
          if (!layout) return false;
          let chat = layout.querySelector(tag);
          if (!chat || chat.textContent.trim().length < 8) return false;
          let workspace = [...layout.querySelectorAll('*')].filter((el) => {
            let name = el.tagName.toLowerCase();
            return name !== tag && name.includes('-') && !name.startsWith('layout-') &&
              name !== 'panel-layout' && name !== 'split-node' && el.textContent.trim().length > 8;
          });
          return workspace.length >= 2;
        },
        { tag: chatComponent },
        { timeout },
      );

      let snap = await page.evaluate((tag) => {
        let layout = document.querySelector('panel-layout');
        let layoutBox = layout.getBoundingClientRect();
        let chat = layout.querySelector(tag);
        let chatBox = chat.getBoundingClientRect();
        // Collect non-chat custom-element workspace components with real content.
        let components = {};
        for (let el of layout.querySelectorAll('*')) {
          let name = el.tagName.toLowerCase();
          if (name === tag || !name.includes('-')) continue;
          if (name.startsWith('layout-') || name === 'panel-layout' || name === 'split-node') continue;
          let len = el.textContent.trim().length;
          if (len > 8 && !(name in components)) components[name] = len;
        }
        return {
          layoutWidth: layoutBox.width,
          chatX: chatBox.x - layoutBox.x,
          chatWidth: chatBox.width,
          chatHeight: chatBox.height,
          layoutHeight: layoutBox.height,
          chatCenter: (chatBox.x - layoutBox.x) + chatBox.width / 2,
          workspaceComponents: components,
          url: location.href,
        };
      }, chatComponent);

      let workspaceTags = Object.keys(snap.workspaceComponents);
      let screenshot = join(screenshotDir, `chat-builder-${key}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });

      let assertions = {
        layoutMounted: snap.layoutWidth > 0,
        chatPresent: snap.chatWidth > 0,
        // Chat docked on the RIGHT: its horizontal center is past the layout midpoint.
        chatOnRight: snap.chatCenter > snap.layoutWidth / 2,
        // Chat at full height: covers most of the layout's block size.
        chatFullHeight: snap.chatHeight >= snap.layoutHeight * 0.85,
        realComponentsRendered: workspaceTags.length >= 2,
        noNavigation: snap.url === startUrl,
      };

      scenarioResults[key] = {
        ...assertions,
        ok: Object.values(assertions).every(Boolean),
        layoutWidth: Math.round(snap.layoutWidth),
        chatX: Math.round(snap.chatX),
        chatCenter: Math.round(snap.chatCenter),
        chatWidth: Math.round(snap.chatWidth),
        chatHeight: Math.round(snap.chatHeight),
        layoutHeight: Math.round(snap.layoutHeight),
        workspaceComponents: snap.workspaceComponents,
        screenshot,
      };
    }

    let ok = opensOnChat &&
      errors.length === 0 &&
      keys.length >= 1 &&
      Object.values(scenarioResults).every((entry) => entry.ok);

    result = {
      status: ok ? 'ok' : 'fail',
      browser: browserName,
      mode: useFixture ? 'fixture' : 'driver',
      keys,
      opensOnChat,
      scenarios: scenarioResults,
      noConsoleErrors: errors.length === 0,
      errors: errors.slice(0, 5),
    };
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    // Clean only the served bundle dir; keep the captured screenshots.
    await rm(outputDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'ok') process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await run();
}
