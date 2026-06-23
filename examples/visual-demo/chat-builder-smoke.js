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
 * runtime while the real questionnaire driver lands. Each scenario carries 2 `variants`
 * with DIFFERENT left-panel sets (so a variant switch visibly changes the workspace) and
 * a questionnaire-derived `theme` ({mode, hue}). The top-level `config` equals the first
 * (default) variant. Every `config` is a real workspace whose root is a horizontal split
 * with the chat panel as the SECOND child (chat on the right, full height) and the
 * workspace panels on the left.
 */
const FIXTURE = {
  chatPanel: 'chat',
  chatComponent: 'chat-workspace',
  scenarios: [
    fixtureScenario('programming', 'Programming', 'agent programming', 'editor',
      [{ id: 'module-selection', type: 'multi-select', prompt: 'Modules',
        options: [{ value: 'source', label: 'Source' }, { value: 'preview', label: 'Preview' }, { value: 'graph', label: 'Graph' }],
        chosen: ['source', 'preview'] }],
      { mode: 'dark', hue: 218 },
      [
        { id: 'editor-preview', label: 'Editor + Preview', answers: { 'module-selection': ['source', 'preview'] },
          panels: { source: 'source-editor', preview: 'sn-canvas-viewport' } },
        { id: 'editor-graph-inspector', label: 'Editor + Graph + Inspector', answers: { 'module-selection': ['source', 'graph', 'inspector'] },
          panels: { source: 'source-editor', graph: 'canvas-graph', inspector: 'inspector-panel' } },
      ]),
    fixtureScenario('video', 'Video', 'video editing studio', 'video',
      [{ id: 'tracks', type: 'multi-select', prompt: 'Timeline tracks',
        options: [{ value: 'video', label: 'Video' }, { value: 'audio', label: 'Audio' }],
        chosen: ['video', 'audio'] }],
      { mode: 'dark', hue: 286 },
      [
        { id: 'stage-timeline', label: 'Stage + Timeline', answers: { tracks: ['video', 'audio'] },
          panels: { stage: 'sn-canvas-viewport', timeline: 'sn-timeline-editor' } },
        { id: 'stage-table-feed', label: 'Stage + Shots + Events', answers: { tracks: ['video'] },
          panels: { stage: 'sn-canvas-viewport', shots: 'sn-data-table', events: 'sn-event-feed' } },
      ]),
    fixtureScenario('automation', 'Automation', 'workflow automation', 'flow',
      [{ id: 'trigger', type: 'single-select', prompt: 'Trigger',
        options: [{ value: 'webhook', label: 'Webhook' }, { value: 'schedule', label: 'Schedule' }],
        chosen: 'webhook' }],
      { mode: 'light', hue: 142 },
      [
        { id: 'flow-inspector', label: 'Flow + Inspector', answers: { trigger: 'webhook' },
          panels: { flow: 'node-canvas', inspector: 'inspector-panel' } },
        { id: 'flow-table-tree', label: 'Flow + Runs + Steps', answers: { trigger: 'schedule' },
          panels: { flow: 'node-canvas', runs: 'sn-data-table', steps: 'sn-tree-panel' } },
      ]),
  ],
};

function panelBehavior(index) {
  return index === 0
    ? { importance: 95, minInlineSize: 480, minBlockSize: 300, collapse: 'auto', overflow: 'scroll-block', responsiveMode: 'stack', responsiveBreakpoint: 760 }
    : { importance: 68, minInlineSize: 320, minBlockSize: 240, collapse: 'auto', overflow: 'scroll-block', responsiveMode: 'stack', responsiveBreakpoint: 760 };
}

/** Build a real workspace config (chat docked right) from a {type: component} map. */
function fixtureConfig(label, panels) {
  let entries = Object.entries(panels);
  let panelTypes = {};
  entries.forEach(([type, component], index) => {
    panelTypes[type] = { title: component, icon: index === 0 ? 'code' : 'preview', component, behavior: panelBehavior(index) };
  });
  panelTypes.chat = { title: 'Chat', icon: 'chat', component: 'chat-workspace',
    behavior: { collapse: 'never', importance: 100, minInlineSize: 360, minBlockSize: 320, overflow: 'scroll-block', responsiveMode: 'stack', responsiveBreakpoint: 760 } };
  let workspaceLayout = buildLayoutTree(entries.map(([type]) => type));
  return {
    version: '0.2.0', name: label, register: 'tool', groups: [], sections: [],
    panelTypes, layouts: {},
    layout: {
      type: 'split', direction: 'horizontal', ratio: 0.64,
      first: workspaceLayout,
      second: { type: 'panel', panelType: 'chat', panelState: {} },
    },
    events: [], components: { catalog: [...entries.map(([, component]) => component), 'chat-workspace'] },
  };
}

/** Recursive BSP layout over the workspace panel types (chat is added separately). */
function buildLayoutTree(types, depth = 0) {
  if (types.length <= 1) return { type: 'panel', panelType: types[0], panelState: {} };
  let mid = Math.ceil(types.length / 2);
  return {
    type: 'split', direction: depth % 2 === 0 ? 'vertical' : 'horizontal', ratio: 0.6,
    first: buildLayoutTree(types.slice(0, mid), depth + 1),
    second: buildLayoutTree(types.slice(mid), depth + 1),
  };
}

function fixtureScenario(key, label, intent, template, questions, theme, variantSpecs) {
  let variants = variantSpecs.map((spec) => ({
    id: spec.id,
    label: spec.label,
    answers: spec.answers,
    config: fixtureConfig(label, spec.panels),
    exportJson: '',
    digest: { panelTypes: [...Object.keys(spec.panels), 'chat'] },
  }));
  return {
    key, label, intent, template, questions, stages: [], theme,
    variants,
    config: variants[0].config,
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

  // Known-benign, third-party teardown race in symbiote-ui's LayoutNode: a
  // `requestAnimationFrame` queued by `_schedulePanelMenuActionStateSync` is not
  // cancelled when the node is destroyed, so it can fire after Symbiote nulls the
  // node's reactive context, throwing `panelMenuActions` is null. It surfaces only
  // when a second active component (here the SSR shell's `cascade-theme-widget`)
  // drives extra render frames during a `panel-layout` variant re-mount; it does not
  // reflect a demo or SSR defect (the original demo reproduces it the moment any
  // extra active component is added). We collect it separately so the console-error
  // gate stays strict for real errors while not failing on a teardown race we cannot
  // fix from this package. Tracked for a fix in symbiote-ui's LayoutNode.
  const IGNORED_TEARDOWN_ERROR = /panelMenuActions(['"\]]*\s*)?(\.map|is null)|evaluating '.*panelMenuActions/;
  let errors = [];
  let ignoredErrors = [];
  let recordError = (text) => {
    if (IGNORED_TEARDOWN_ERROR.test(text)) ignoredErrors.push(text);
    else errors.push(text);
  };
  page.on('pageerror', (err) => recordError(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') recordError(msg.text()); });

  await mkdir(screenshotDir, { recursive: true });

  let result = { status: 'fail' };
  try {
    let startUrl = `http://localhost:${port}/`;

    // SSR first-paint proof: fetch the RAW served index.html over HTTP, before any JS
    // runs, and assert the shell chrome is already in the response body. This proves the
    // <workspace-shell> (topbar + #workspace-stage host) is server-rendered at build
    // time, not added by app.js. The empty SSR placeholder must NOT survive (it was
    // replaced by the rendered shell).
    let rawHtml = await (await page.request.get(startUrl)).text();
    let firstPaintSsr = {
      hasShellElement: rawHtml.includes('<workspace-shell'),
      hasShellClass: rawHtml.includes('workspace-shell class="workspace-shell"') ||
        /<workspace-shell[^>]*class="[^"]*workspace-shell/.test(rawHtml),
      hasTopbar: rawHtml.includes('workspace-topbar') && rawHtml.includes('cascade-theme-widget'),
      hasStageHost: rawHtml.includes('id="workspace-stage"') && rawHtml.includes('data-workspace-host'),
      placeholderReplaced: !rawHtml.includes('<workspace-shell class="workspace-shell"></workspace-shell>'),
    };
    firstPaintSsr.ok = Object.values(firstPaintSsr).every(Boolean);

    await page.goto(startUrl, { waitUntil: 'networkidle', timeout });
    await page.waitForFunction(() => Boolean(window.__chatBuilder), { timeout });

    // SSR hydration proof: after the page boots, assert there is EXACTLY ONE
    // <workspace-shell> in the DOM (Symbiote hydrated the server markup via isoMode
    // instead of duplicating/re-creating it), it still carries the SSR `workspace-shell`
    // class, and the demo UI mounted INTO the shell's #workspace-stage host (so the
    // server chrome was reused, not replaced).
    let singleHydratedShell = await page.evaluate(() => {
      let shells = document.querySelectorAll('workspace-shell');
      let shell = shells[0] || null;
      let host = shell?.querySelector('#workspace-stage[data-workspace-host]') || null;
      let demoStage = host?.querySelector('#stage') || null;
      let demoMenu = host?.querySelector('#cb-menu') || null;
      return {
        shellCount: shells.length,
        exactlyOneShell: shells.length === 1,
        hasSsrClass: Boolean(shell && shell.classList.contains('workspace-shell')),
        stageHostPresent: Boolean(host),
        demoMountedInStage: Boolean(demoStage && demoMenu),
      };
    });
    singleHydratedShell.ok = singleHydratedShell.exactlyOneShell &&
      singleHydratedShell.hasSsrClass &&
      singleHydratedShell.stageHostPresent &&
      singleHydratedShell.demoMountedInStage;

    let keys = await page.evaluate(() => window.__chatBuilder.keys);
    let chatComponent = await page.evaluate(() => window.__chatBuilder.chatComponent);

    // The page must open on the chat (menu mode), not a constructed workspace.
    let opensOnChat = await page.evaluate((tag) => {
      let stage = document.getElementById('stage');
      let hasLayout = Boolean(document.querySelector('panel-layout'));
      let chat = document.querySelector(tag);
      return Boolean(stage && stage.classList.contains('cb-menu-mode') && chat && !hasLayout);
    }, chatComponent);

    // Wait for the active panel-layout to hold the chat plus >=2 real workspace
    // components, then snapshot geometry + the workspace component set.
    async function waitAndSnapshot() {
      await page.waitForSelector('panel-layout', { timeout });
      await page.waitForFunction(
        () => Boolean(document.querySelector('panel-layout .layout-root, panel-layout layout-node')),
        { timeout },
      );
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
      return page.evaluate((tag) => {
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
          variant: layout.dataset.variant || '',
          url: location.href,
        };
      }, chatComponent);
    }

    function panelSignature(components) {
      return Object.keys(components).sort().join(',') + '#' + Object.keys(components).length;
    }

    let scenarioResults = {};
    for (let key of keys) {
      await page.evaluate((k) => window.__chatBuilder.show(k), key);
      let snap = await waitAndSnapshot();
      let workspaceTags = Object.keys(snap.workspaceComponents);

      // #2 Real choice: switch to a DIFFERENT variant and assert the left-panel set
      // changed (different workspace components/count), with no navigation/reload.
      let variantList = await page.evaluate((k) => window.__chatBuilder.variants(k), key);
      let otherVariant = variantList.find((variant) => variant.id !== snap.variant) || variantList[1] || variantList[0];
      let beforeSignature = panelSignature(snap.workspaceComponents);
      await page.evaluate(
        ({ k, v }) => window.__chatBuilder.selectVariant(k, v),
        { k: key, v: otherVariant.id },
      );
      await page.waitForFunction(
        ({ sig }) => {
          let layout = document.querySelector('panel-layout');
          if (!layout) return false;
          let names = new Set();
          for (let el of layout.querySelectorAll('*')) {
            let name = el.tagName.toLowerCase();
            if (name === 'chat-workspace' || !name.includes('-')) continue;
            if (name.startsWith('layout-') || name === 'panel-layout' || name === 'split-node') continue;
            if (el.textContent.trim().length > 8) names.add(name);
          }
          let current = [...names].sort().join(',') + '#' + names.size;
          return names.size >= 1 && current !== sig;
        },
        { sig: beforeSignature },
        { timeout },
      );
      let variantSnap = await waitAndSnapshot();
      let afterSignature = panelSignature(variantSnap.workspaceComponents);

      // #3 Theme readiness: read a color token, flip the mode control, assert it
      // changed live (no reload). --sn-bg recomputes between dark and light modes.
      let themeToken = '--sn-bg';
      let themeBefore = await page.evaluate((t) => window.__chatBuilder.getThemeToken(t), themeToken);
      let currentMode = await page.evaluate(() => window.__chatBuilder.getThemeState().mode);
      let targetMode = currentMode === 'light' ? 'dark' : 'light';
      await page.evaluate((m) => window.__chatBuilder.setTheme({ mode: m }), targetMode);
      await page.waitForFunction(
        ({ t, prev }) => window.__chatBuilder.getThemeToken(t).trim() !== prev.trim(),
        { t: themeToken, prev: themeBefore },
        { timeout },
      );
      let themeAfter = await page.evaluate((t) => window.__chatBuilder.getThemeToken(t), themeToken);
      // Also exercise the geometry register (tool vs product) on a geometry token.
      let geometryToken = '--sn-step-1';
      let geometryBefore = await page.evaluate((t) => window.__chatBuilder.getThemeToken(t), geometryToken);
      await page.evaluate(() => window.__chatBuilder.setTheme({ register: 'tool' }));
      let geometryAfter = await page.evaluate((t) => window.__chatBuilder.getThemeToken(t), geometryToken);

      // Header structure & density: the scenario header is present with the Layout
      // (variant) control and the live theme control both laid out within the header's
      // own width, and the bar does not overflow horizontally (scrollWidth ~= clientWidth).
      let header = await page.evaluate(() => {
        let head = document.querySelector('#stage .cb-scenario-head');
        if (!head) return { present: false };
        let headBox = head.getBoundingClientRect();
        let variants = head.querySelector('.cb-variants');
        let variantChips = head.querySelectorAll('.cb-variant').length;
        let theme = head.querySelector('.cb-theme');
        let within = (el) => {
          if (!el) return false;
          let box = el.getBoundingClientRect();
          return box.width > 0 && box.left >= headBox.left - 1 && box.right <= headBox.right + 1;
        };
        return {
          present: true,
          variantChips,
          hasVariants: Boolean(variants) && variantChips >= 1,
          hasTheme: Boolean(theme),
          variantsWithin: within(variants),
          themeWithin: within(theme),
          scrollWidth: head.scrollWidth,
          clientWidth: head.clientWidth,
          overflow: head.scrollWidth - head.clientWidth,
        };
      });
      header.ok = Boolean(
        header.present &&
        header.hasVariants &&
        header.hasTheme &&
        header.variantsWithin &&
        header.themeWithin &&
        // No horizontal overflow of the header bar (small tolerance for sub-pixel rounding).
        header.overflow <= 2,
      );

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
        // Switching variants produced a different left-panel set, chat still right.
        variantSwitchChangesPanels: afterSignature !== beforeSignature,
        chatStillRightAfterSwitch: variantSnap.chatCenter > variantSnap.layoutWidth / 2,
        // Live theme: the color token recomputed when the mode control toggled.
        themeTokenChanged: themeAfter.trim() !== themeBefore.trim() && themeAfter.trim().length > 0,
        // Live geometry: the register toggle recomputed a geometry primitive.
        geometryTokenChanged: geometryAfter.trim() !== geometryBefore.trim(),
        // Header is a tidy single bar: variant control + theme control both present
        // and within the header, and the bar does not overflow its width.
        headerStructured: header.ok,
        noNavigation: snap.url === startUrl && variantSnap.url === startUrl,
      };

      scenarioResults[key] = {
        ...assertions,
        ok: Object.values(assertions).every(Boolean),
        layoutWidth: Math.round(snap.layoutWidth),
        chatCenter: Math.round(snap.chatCenter),
        chatWidth: Math.round(snap.chatWidth),
        chatHeight: Math.round(snap.chatHeight),
        layoutHeight: Math.round(snap.layoutHeight),
        defaultVariant: snap.variant,
        switchedVariant: variantSnap.variant,
        panelsBefore: beforeSignature,
        panelsAfter: afterSignature,
        workspaceComponents: snap.workspaceComponents,
        switchedComponents: variantSnap.workspaceComponents,
        themeToken,
        themeBefore: themeBefore.trim(),
        themeAfter: themeAfter.trim(),
        geometryToken,
        geometryBefore: geometryBefore.trim(),
        geometryAfter: geometryAfter.trim(),
        header,
        screenshot,
      };
    }

    let ok = opensOnChat &&
      firstPaintSsr.ok &&
      singleHydratedShell.ok &&
      errors.length === 0 &&
      keys.length >= 1 &&
      Object.values(scenarioResults).every((entry) => entry.ok);

    result = {
      status: ok ? 'ok' : 'fail',
      browser: browserName,
      mode: useFixture ? 'fixture' : 'driver',
      keys,
      opensOnChat,
      firstPaintSsr,
      singleHydratedShell,
      scenarios: scenarioResults,
      noConsoleErrors: errors.length === 0,
      errors: errors.slice(0, 5),
      // Non-fatal symbiote-ui LayoutNode teardown-race messages, reported for
      // visibility but excluded from the console-error gate (see note above).
      ignoredTeardownErrors: ignoredErrors.slice(0, 5),
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
