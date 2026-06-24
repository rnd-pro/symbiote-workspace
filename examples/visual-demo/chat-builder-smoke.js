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
import { exportConfig } from '../../sharing/index.js';
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
 * workspace panels on the left. Variant ORDER is load-bearing for the keyboard a11y
 * check: the chips form a tablist where the default is `aria-selected`, so ArrowRight
 * from it must land on a sibling whose panel set differs (variant[0] vs variant[1]).
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
    // CUSTOMIZATION class: the only scenario where the agent free-creates a module
    // because the canonical catalog cannot satisfy the requested capability. The
    // free-created tag (sn-cohort-heatmap) has no real component, so the runtime
    // aliases it to sn-data-table for rendering. Both variants place the free-created
    // module beside the docked chat. The customization payload carries the CONTRACT
    // shape the driver populates from real dispatch; the specific capability/tag
    // strings here are arbitrary fixture stand-ins (the real driver picks its own,
    // e.g. geospatial.map / geo-situation-map) — the runtime aliases generically
    // over recipe.tagName, so no code path depends on these strings matching.
    fixtureScenario('custom', 'Custom', 'a cohort retention heatmap the catalog cannot build', 'custom',
      [{ id: 'capability', type: 'single-select', prompt: 'Missing capability',
        options: [{ value: 'cohort-heatmap', label: 'Cohort heatmap' }],
        chosen: 'cohort-heatmap' }],
      { mode: 'dark', hue: 24 },
      [
        { id: 'heatmap-inspector', label: 'Heatmap + Inspector', answers: { capability: 'cohort-heatmap' },
          panels: { heatmap: 'sn-cohort-heatmap', inspector: 'inspector-panel' } },
        { id: 'heatmap-table', label: 'Heatmap + Records', answers: { capability: 'cohort-heatmap' },
          panels: { heatmap: 'sn-cohort-heatmap', records: 'sn-tree-panel' } },
      ],
      {
        catalogDigest: {
          categories: ['editing', 'visualization', 'navigation', 'automation'],
          sampleTags: ['source-editor', 'sn-data-table', 'node-canvas', 'sn-timeline-editor'],
        },
        gap: {
          capability: 'cohort-heatmap',
          recovery: [{ kind: 'author-module', detail: 'Author a module descriptor for cohort-heatmap' }],
          alternatives: [{ tagName: 'sn-data-table', reason: 'tabular, but not a heatmap surface' }],
        },
        recipe: {
          tagName: 'sn-cohort-heatmap',
          capabilities: ['cohort-heatmap', 'retention-grid'],
          panelType: { title: 'Cohort Heatmap', icon: 'grid_on', component: 'sn-cohort-heatmap' },
        },
        organicFit: {
          accepted: true,
          surface: 'modules',
          summary: 'New module descriptor fits the workspace design policy',
          diagnostics: [{ level: 'info', message: 'panelTypes patch is organic' }],
        },
        patchPreview: {
          count: 1,
          changes: [{ op: 'add', surface: 'modules', tagName: 'sn-cohort-heatmap' }],
        },
      }),
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

function fixtureScenario(key, label, intent, template, questions, theme, variantSpecs, customization) {
  let variants = variantSpecs.map((spec) => {
    let config = fixtureConfig(label, spec.panels);
    // Mirror the driver contract: each variant carries the PORTABLE exportConfig JSON
    // its relaunchFromExport restore reads. exportConfig strips host/identity keys, so
    // the fixture round-trips through importConfig exactly as a real exported config.
    return {
      id: spec.id,
      label: spec.label,
      answers: spec.answers,
      config,
      exportJson: exportConfig(config).json,
      digest: { panelTypes: [...Object.keys(spec.panels), 'chat'] },
    };
  });
  return {
    key, label, intent, template, questions, stages: [], theme,
    variants,
    config: variants[0].config,
    exportJson: variants[0].exportJson,
    ...(customization ? { customization } : {}),
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
    // class, and the demo UI mounted INTO the hydrated shell — its dynamic stage into the
    // shell's #workspace-stage host, and (UX Slice 4) its class-tab nav into the shell's
    // topbar — so the server chrome was reused, not replaced.
    let singleHydratedShell = await page.evaluate(() => {
      let shells = document.querySelectorAll('workspace-shell');
      let shell = shells[0] || null;
      let host = shell?.querySelector('#workspace-stage[data-workspace-host]') || null;
      let demoStage = host?.querySelector('#stage') || null;
      // The class-tab nav is relocated into the shell's topbar (not the stage host) by
      // the unified-chrome restructure; it must still live inside the single hydrated shell.
      let demoMenu = shell?.querySelector('.workspace-topbar #cb-menu') || null;
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

    // Module-identity signature: drop Symbiote's auto-generated `sym-N` tags (anonymous
    // sub-components whose numeric suffix increments on every fresh registration) so the
    // signature reflects topology + module set, not render-instance counters. A cold
    // relaunch builds a brand-new node, so equivalence is module identity, not the
    // volatile auto-tag numbers.
    function stableSignature(components) {
      let keys = Object.keys(components).filter((name) => !/^sym-\d+$/.test(name)).sort();
      return keys.join(',') + '#' + keys.length;
    }

    // MENU first-move (UX Slice 3): while still in menu mode — BEFORE any class is
    // selected — prove the opening menu is ONE clear first move: (i) the in-chat class
    // board is the REAL control, so a real click on the card whose data-card-id is a
    // known scenario key leaves menu mode and mounts THAT scenario (body.dataset.seeded
    // starts with the key); (ii) every class card SHOWS the questionnaire teaser as its
    // sublabel ('N questions -> M panels'), not a bare 'Available'; (iii) the recommended
    // class card is visibly marked (data-recommended + a 'Recommended' badge), or — when
    // the driver flags no recommendation (e.g. the minimal fixture) — no card is marked,
    // which is the honest no-forced-default state. Runs once at the start; the menu is
    // restored afterwards so the per-scenario loop begins from a clean menu.
    let menuReady = await (async () => {
      let recommendedKey = await page.evaluate(() => window.__chatBuilder.recommendedKey);
      // (ii)/(iii) Read the rendered menu board: each class key's card, its sublabel,
      // and its recommended marking; plus the expected teaser line for each key.
      let board = await page.evaluate(({ tag, keyList }) => {
        let chat = document.querySelector(tag);
        let cardFor = (k) => chat?.querySelector('.status-card[data-card-id="' + k + '"]') || null;
        return keyList.map((k) => {
          let card = cardFor(k);
          let sub = card?.querySelector('.status-card-status');
          return {
            key: k,
            present: Boolean(card),
            sublabel: sub ? sub.textContent.trim() : '',
            marked: card?.dataset.recommended === 'true',
            hasBadge: Boolean(card?.querySelector('.cb-card-badge')),
            expectedTeaser: window.__chatBuilder.menuTeaser(k),
          };
        });
      }, { tag: chatComponent, keyList: keys });

      let allCardsPresent = board.every((c) => c.present);
      // Each card's sublabel SHOWS the teaser (matches the runtime-derived teaser line)
      // and is not the bare 'Available' fallback, so the value-prop is shown, not told.
      let cardsShowTeaser = board.every((c) =>
        c.sublabel.length > 0 && c.sublabel !== 'Available' && c.sublabel === c.expectedTeaser);
      // Recommended marking: when the driver names a recommendation, exactly that card is
      // marked (data-recommended + badge) and no other; when none is named, no card is.
      let markedKeys = board.filter((c) => c.marked).map((c) => c.key);
      let badgedKeys = board.filter((c) => c.hasBadge).map((c) => c.key);
      let recommendedMarked = recommendedKey
        ? (markedKeys.length === 1 && markedKeys[0] === recommendedKey &&
            badgedKeys.length === 1 && badgedKeys[0] === recommendedKey)
        : (markedKeys.length === 0 && badgedKeys.length === 0);

      // (i) The card IS the control: real-click the recommended card (or, when none is
      // recommended, the first class card) and assert the stage builds THAT class.
      let targetKey = recommendedKey || keys[0];
      // Use Playwright's real pointer click on the card element (not a JS show() call) so
      // the delegated click handler is what drives construction.
      await page.click(`${chatComponent} .status-card[data-card-id="${targetKey}"]`, { timeout });
      let built = await page.waitForFunction(
        ({ k }) => {
          let stage = document.getElementById('stage');
          let seeded = document.body.dataset.seeded || '';
          return Boolean(stage && !stage.classList.contains('cb-menu-mode') &&
            seeded.startsWith(k + ':') && document.querySelector('panel-layout'));
        },
        { k: targetKey },
        { timeout },
      ).then(() => true).catch(() => false);
      let afterClick = await page.evaluate(() => ({
        seeded: document.body.dataset.seeded || '',
        menuModeCleared: !document.getElementById('stage')?.classList.contains('cb-menu-mode'),
        activeScenario: document.body.dataset.activeScenario || '',
        url: location.href,
      }));
      let cardClickBuilds = built && afterClick.menuModeCleared &&
        afterClick.seeded.startsWith(targetKey + ':') && afterClick.activeScenario === targetKey;

      // Restore the clean menu for the per-scenario loop that follows.
      await page.evaluate(() => window.__chatBuilder.menu());
      await page.waitForFunction(
        () => document.getElementById('stage')?.classList.contains('cb-menu-mode') &&
          !document.querySelector('panel-layout'),
        undefined,
        { timeout },
      ).catch(() => {});

      let result = {
        recommendedKey,
        targetKey,
        allCardsPresent,
        cardsShowTeaser,
        recommendedMarked,
        cardClickBuilds,
        clickedSeeded: afterClick.seeded,
        noNavigation: afterClick.url === startUrl,
        board,
      };
      result.ok = Boolean(allCardsPresent && cardsShowTeaser && recommendedMarked &&
        cardClickBuilds && result.noNavigation);
      return result;
    })();

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

      // Header structure & density (UX Slice 4 — unified chrome): the scenario header is
      // present with the Layout (variant) chips as its LEAD element, laid out within the
      // header's own width and not overflowing horizontally. The live theme control no
      // longer lives in this header — it has moved to the topbar — so the Layout choice
      // is the uncontested primary; chromeUnified (below) checks the topbar placement.
      let header = await page.evaluate(() => {
        let head = document.querySelector('#stage .cb-scenario-head');
        if (!head) return { present: false };
        let headBox = head.getBoundingClientRect();
        let variants = head.querySelector('.cb-variants');
        let variantChips = head.querySelectorAll('.cb-variant').length;
        let choice = head.querySelector('.cb-choice');
        let within = (el) => {
          if (!el) return false;
          let box = el.getBoundingClientRect();
          return box.width > 0 && box.left >= headBox.left - 1 && box.right <= headBox.right + 1;
        };
        return {
          present: true,
          variantChips,
          hasVariants: Boolean(variants) && variantChips >= 1,
          // The theme control has been relocated out of the scenario header.
          themeInHead: Boolean(head.querySelector('.cb-theme')),
          // The Layout choice leads the header (it is the header's first child element).
          choiceIsLead: head.firstElementChild === choice,
          variantsWithin: within(variants),
          scrollWidth: head.scrollWidth,
          clientWidth: head.clientWidth,
          overflow: head.scrollWidth - head.clientWidth,
        };
      });
      header.ok = Boolean(
        header.present &&
        header.hasVariants &&
        header.choiceIsLead &&
        // The theme control is gone from the scenario header (moved to the topbar).
        !header.themeInHead &&
        header.variantsWithin &&
        // No horizontal overflow of the header bar (small tolerance for sub-pixel rounding).
        header.overflow <= 2,
      );

      // chromeUnified (UX Slice 4): the three stacked header bars are collapsed into one
      // coherent header. (a) exactly ONE product title (no separate redundant builder
      // title); (b) the live theme control lives in the SSR topbar and the orphan empty
      // <cascade-theme-widget> mount is gone/hidden; (c) the class-tab nav is hosted in
      // the topbar; (d) the scenario header's Layout chips lead. Read the live DOM.
      let chromeUnified = await page.evaluate(() => {
        let shell = document.querySelector('workspace-shell');
        let topbar = shell?.querySelector('.workspace-topbar') || null;
        let topbarRight = shell?.querySelector('.workspace-topbar-right') || null;
        let isVisible = (el) => {
          if (!el) return false;
          let cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          let box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        };
        // (a) ONE product title: the SSR topbar's .workspace-title, and no separate
        // builder <h1> title bar survives anywhere in the chrome.
        let titles = [...document.querySelectorAll('.workspace-title')];
        let builderTitleBars = document.querySelectorAll('.cb-bar').length;
        let h1Count = document.querySelectorAll('.cb-shell h1, .workspace-topbar h1').length;
        // (b) theme control in the topbar; orphan cascade-theme-widget gone or not visible.
        let themeInTopbar = Boolean(topbar && topbar.querySelector('.cb-theme'));
        let themeControls = document.querySelectorAll('.cb-theme').length;
        let orphanWidget = topbarRight?.querySelector('cascade-theme-widget') || null;
        let orphanGone = !orphanWidget || !isVisible(orphanWidget);
        // The theme sub-controls (mode | hue | register) are present and grouped.
        let themeGroups = topbar ? topbar.querySelectorAll('.cb-theme .cb-theme-group').length : 0;
        // (c) class-tab nav hosted in the topbar (relocated out of a second header bar).
        let menu = document.getElementById('cb-menu');
        let menuInTopbar = Boolean(topbar && menu && topbar.contains(menu));
        // (d) scenario header Layout chips lead.
        let head = document.querySelector('#stage .cb-scenario-head');
        let leadIsLayout = Boolean(head && head.firstElementChild &&
          head.firstElementChild.classList.contains('cb-choice') &&
          head.firstElementChild.querySelector('.cb-variant'));
        return {
          titleCount: titles.length,
          singleProductTitle: titles.length === 1 && builderTitleBars === 0 && h1Count === 0,
          themeInTopbar,
          singleThemeControl: themeControls === 1,
          orphanGone,
          themeGroupsGrouped: themeGroups >= 2,
          menuInTopbar,
          leadIsLayout,
        };
      });
      chromeUnified.ok = Boolean(
        chromeUnified.singleProductTitle &&
        chromeUnified.themeInTopbar &&
        chromeUnified.singleThemeControl &&
        chromeUnified.orphanGone &&
        chromeUnified.themeGroupsGrouped &&
        chromeUnified.menuInTopbar &&
        chromeUnified.leadIsLayout,
      );

      // #a11y Tab pattern + keyboard operability. The class menu is a tablist whose
      // tabs carry aria-selected + roving tabindex; the variant chips are keyboard-
      // operable (ArrowRight moves focus+selection and re-mounts); the theme controls
      // are key-operable and change a live --sn-* token; focused controls show a
      // non-zero focus outline; the teardown-race count stays bounded across re-mounts.
      let classTabs = await page.evaluate(() => {
        let menu = document.getElementById('cb-menu');
        let tabs = [...menu.querySelectorAll('.cb-class')];
        return {
          menuRole: menu.getAttribute('role'),
          total: tabs.length,
          usesAriaSelected: tabs.every((t) => t.hasAttribute('aria-selected')),
          usesAriaPressed: tabs.some((t) => t.hasAttribute('aria-pressed')),
          selectedCount: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length,
          selectedTabbable: tabs
            .filter((t) => t.getAttribute('aria-selected') === 'true')
            .every((t) => t.getAttribute('tabindex') === '0'),
          unselectedRoving: tabs
            .filter((t) => t.getAttribute('aria-selected') !== 'true')
            .every((t) => t.getAttribute('tabindex') === '-1'),
        };
      });
      classTabs.ok = classTabs.menuRole === 'tablist' &&
        classTabs.total >= 1 &&
        classTabs.usesAriaSelected &&
        !classTabs.usesAriaPressed &&
        classTabs.selectedCount === 1 &&
        classTabs.selectedTabbable &&
        classTabs.unselectedRoving;

      // Keyboard variant switch: focus the selected chip, press ArrowRight, and assert
      // focus+selection moved to the next chip, that chip re-mounted (panel set changed),
      // with no navigation/reload — only when the scenario offers >=2 variants.
      let teardownBeforeKeyNav = ignoredErrors.length;
      let keyVariant = await page.evaluate(() => {
        let chips = [...document.querySelectorAll('#stage .cb-variant')];
        let selected = chips.find((c) => c.getAttribute('aria-selected') === 'true') || chips[0];
        selected?.focus();
        let names = new Set();
        for (let el of document.querySelectorAll('panel-layout *')) {
          let name = el.tagName.toLowerCase();
          if (name === 'chat-workspace' || !name.includes('-')) continue;
          if (name.startsWith('layout-') || name === 'panel-layout' || name === 'split-node') continue;
          if (el.textContent.trim().length > 8) names.add(name);
        }
        return {
          chipCount: chips.length,
          focusedSelected: Boolean(selected && document.activeElement === selected),
          selectedId: selected?.dataset.variant || '',
          signature: [...names].sort().join(',') + '#' + names.size,
        };
      });
      let keyVariantResult = { applicable: keyVariant.chipCount >= 2, focusedSelected: keyVariant.focusedSelected };
      if (keyVariant.chipCount >= 2) {
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(
          ({ sig, prevId }) => {
            let chips = [...document.querySelectorAll('#stage .cb-variant')];
            let active = chips.find((c) => c.getAttribute('aria-selected') === 'true');
            if (!active || active.dataset.variant === prevId) return false;
            if (document.activeElement !== active) return false;
            let names = new Set();
            for (let el of document.querySelectorAll('panel-layout *')) {
              let name = el.tagName.toLowerCase();
              if (name === 'chat-workspace' || !name.includes('-')) continue;
              if (name.startsWith('layout-') || name === 'panel-layout' || name === 'split-node') continue;
              if (el.textContent.trim().length > 8) names.add(name);
            }
            let current = [...names].sort().join(',') + '#' + names.size;
            return names.size >= 1 && current !== sig;
          },
          { sig: keyVariant.signature, prevId: keyVariant.selectedId },
          { timeout },
        );
        let afterKey = await page.evaluate(() => {
          let chips = [...document.querySelectorAll('#stage .cb-variant')];
          let active = chips.find((c) => c.getAttribute('aria-selected') === 'true');
          return {
            movedSelection: Boolean(active),
            focusFollowsSelection: document.activeElement === active,
            url: location.href,
          };
        });
        keyVariantResult.movedSelection = afterKey.movedSelection;
        keyVariantResult.focusFollowsSelection = afterKey.focusFollowsSelection;
        keyVariantResult.noNavigation = afterKey.url === startUrl;
      }
      keyVariantResult.ok = keyVariantResult.applicable
        ? Boolean(keyVariantResult.focusedSelected && keyVariantResult.movedSelection &&
            keyVariantResult.focusFollowsSelection && keyVariantResult.noNavigation)
        : keyVariantResult.focusedSelected;

      // Keyboard-driven theme change: focus the inactive mode button and activate it by
      // key (Enter), then assert a live --sn-* token recomputed — same contract as the
      // pointer-driven themeTokenChanged check, driven via keyboard. The theme control now
      // lives in the topbar (UX Slice 4), so the controls are queried under .workspace-topbar.
      let keyThemeToken = '--sn-bg';
      let keyThemeBefore = await page.evaluate((t) => window.__chatBuilder.getThemeToken(t), keyThemeToken);
      let keyThemeFocus = await page.evaluate(() => {
        let mode = window.__chatBuilder.getThemeState().mode;
        let target = [...document.querySelectorAll('.workspace-topbar [data-theme-mode]')]
          .find((b) => b.dataset.themeMode !== mode);
        target?.focus();
        return { focusable: Boolean(target && document.activeElement === target) };
      });
      await page.keyboard.press('Enter');
      await page.waitForFunction(
        ({ t, prev }) => window.__chatBuilder.getThemeToken(t).trim() !== prev.trim(),
        { t: keyThemeToken, prev: keyThemeBefore },
        { timeout },
      ).catch(() => {});
      let keyThemeAfter = await page.evaluate((t) => window.__chatBuilder.getThemeToken(t), keyThemeToken);
      // Register buttons and hue range are keyboard-focusable (Tab-reachable: tabindex
      // not -1) and the hue range responds to an arrow key by changing its value.
      let keyControls = await page.evaluate(async () => {
        let register = document.querySelector('.workspace-topbar [data-theme-register]');
        let hue = document.querySelector('.workspace-topbar [data-theme-control="hue"]');
        register?.focus();
        let registerFocusable = Boolean(register && document.activeElement === register &&
          register.tabIndex !== -1);
        hue?.focus();
        let hueFocusable = Boolean(hue && document.activeElement === hue && hue.tabIndex !== -1);
        let hueBefore = hue ? hue.value : '';
        return { registerFocusable, hueFocusable, hueBefore };
      });
      await page.keyboard.press('ArrowLeft');
      let hueAfter = await page.evaluate(() =>
        document.querySelector('.workspace-topbar [data-theme-control="hue"]')?.value || '');
      let keyTheme = {
        modeButtonFocusable: keyThemeFocus.focusable,
        themeTokenChanged: keyThemeAfter.trim() !== keyThemeBefore.trim() && keyThemeAfter.trim().length > 0,
        registerFocusable: keyControls.registerFocusable,
        hueFocusable: keyControls.hueFocusable,
        hueRespondsToKey: hueAfter !== keyControls.hueBefore,
      };
      keyTheme.ok = keyTheme.modeButtonFocusable && keyTheme.themeTokenChanged &&
        keyTheme.registerFocusable && keyTheme.hueFocusable && keyTheme.hueRespondsToKey;

      // Focus outline: a :focus-visible-driven outline must be a non-zero width when a
      // control is focused (proves the keyboard focus affordance is present).
      let focusOutline = await page.evaluate(() => {
        let target = document.querySelector('#stage .cb-variant') ||
          document.getElementById('cb-menu')?.querySelector('.cb-class');
        if (!target) return { width: 0 };
        target.focus();
        let style = getComputedStyle(target);
        let width = parseFloat(style.outlineWidth) || 0;
        return { width, hasOutline: width > 0 && style.outlineStyle !== 'none' };
      });
      focusOutline.ok = Boolean(focusOutline.hasOutline);

      // The teardown-race count must stay bounded across the multiple variant re-mounts
      // run in this scenario (pointer switch + keyboard switch), not grow unbounded.
      let teardownDelta = ignoredErrors.length - teardownBeforeKeyNav;
      let a11y = {
        classTabs,
        keyVariant: keyVariantResult,
        keyTheme,
        focusOutline,
        teardownDelta,
        teardownBounded: teardownDelta <= 2,
      };
      a11y.ok = classTabs.ok && keyVariantResult.ok && keyTheme.ok && focusOutline.ok && a11y.teardownBounded;

      let screenshot = join(screenshotDir, `chat-builder-${key}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });

      // PORTABILITY relaunch: capture the live workspace, then rebuild it cold from the
      // active variant's exported portable JSON ONLY (relaunchFromExport reads exportJson,
      // never variant.config). The restored workspace must match in topology, theme, and
      // module set, the old node must be torn down, and nothing must navigate.
      let preRelaunch = await waitAndSnapshot();
      let preRelaunchSignature = panelSignature(preRelaunch.workspaceComponents);
      let preRelaunchStable = stableSignature(preRelaunch.workspaceComponents);
      let preRelaunchThemeBg = await page.evaluate(() => window.__chatBuilder.getThemeToken('--sn-bg'));
      let preRelaunchLayout = await page.$('panel-layout');
      let activeVariant = await page.evaluate(() => document.body.dataset.activeVariant || '');
      let relaunchTeardownBefore = ignoredErrors.length;
      let relaunched = await page.evaluate((k) => window.__chatBuilder.relaunchFromExport(k), key);
      await page.waitForFunction(
        ({ k, v }) => document.body.dataset.relaunched === k + ':' + v,
        { k: key, v: activeVariant },
        { timeout },
      );
      let relaunchSnap = await waitAndSnapshot();
      let relaunchSignature = panelSignature(relaunchSnap.workspaceComponents);
      let relaunchStable = stableSignature(relaunchSnap.workspaceComponents);
      let relaunchThemeBg = await page.evaluate(() => window.__chatBuilder.getThemeToken('--sn-bg'));
      let oldNodeGone = preRelaunchLayout ? !(await preRelaunchLayout.evaluate((el) => el.isConnected)) : false;
      // The exported JSON alone reconstructs the rendered component set: parse the active
      // variant's exportJson and check its panelTypes component tags match what rendered.
      let relaunchFromExportOnly = await page.evaluate(({ k, tag }) => {
        let variant = document.body.dataset.activeVariant || '';
        let scenario = window.__chatBuilder.scenarios.find((entry) => entry.key === k);
        let json = scenario?.variants?.find((v) => v.id === variant)?.exportJson || '';
        let parsed;
        try { parsed = JSON.parse(json); } catch { return false; }
        // Use the panel types actually PLACED in the exported layout — a config may
        // register more panelTypes than it lays out (available-but-unplaced panels),
        // and only the laid-out ones render. Walk the layout tree to collect them.
        let placed = [];
        (function walk(node) {
          if (!node) return;
          if (node.type === 'panel' && node.panelType) placed.push(node.panelType);
          walk(node.first); walk(node.second);
        })(parsed.layout);
        // Resolve each placed component through the render alias: a free-created
        // custom recipe tag (e.g. sn-cohort-heatmap) paints as its sn-data-table
        // stand-in, so the rendered tag is the alias, not the exported recipe tag.
        let exportedTags = placed
          .map((key) => parsed.panelTypes?.[key]?.component)
          .map((component) => window.__chatBuilder.resolveModuleTag(component))
          .filter((component) => component && component !== tag)
          .sort();
        let rendered = [...document.querySelectorAll('panel-layout *')]
          .map((el) => el.tagName.toLowerCase())
          .filter((name) => name !== tag && name.includes('-') &&
            !name.startsWith('layout-') && name !== 'panel-layout' && name !== 'split-node');
        return exportedTags.every((t) => rendered.includes(t)) && exportedTags.length >= 1;
      }, { k: key, tag: chatComponent });
      let relaunchTeardownDelta = ignoredErrors.length - relaunchTeardownBefore;

      let relaunch = {
        called: relaunched,
        activeVariant,
        signatureBefore: preRelaunchSignature,
        signatureAfter: relaunchSignature,
        stableBefore: preRelaunchStable,
        stableAfter: relaunchStable,
        themeBefore: preRelaunchThemeBg.trim(),
        themeAfter: relaunchThemeBg.trim(),
        teardownDelta: relaunchTeardownDelta,
        // The cold replace queues at most one extra benign LayoutNode teardown frame.
        teardownBounded: relaunchTeardownDelta <= 1,
        // Old node torn down cold.
        relaunchTearsDown: oldNodeGone,
        // Restored module set identical (topology + module identity preserved). Compared
        // on the stable signature: a cold rebuild necessarily renumbers Symbiote's
        // anonymous sym-N sub-components, which are not module identity.
        relaunchPanelsIdentical: relaunchStable === preRelaunchStable,
        // Chat still docked right at near-full height after the cold rebuild.
        relaunchChatStillRight: relaunchSnap.chatCenter > relaunchSnap.layoutWidth / 2 &&
          relaunchSnap.chatHeight >= relaunchSnap.layoutHeight * 0.85,
        // Theme token preserved across the relaunch.
        relaunchThemePreserved: relaunchThemeBg.trim() === preRelaunchThemeBg.trim(),
        // Reconstructed from exportJson alone.
        relaunchFromExportOnly,
        // No navigation/reload.
        relaunchNoNavigation: relaunchSnap.url === startUrl,
      };
      relaunch.ok = Boolean(
        relaunch.relaunchTearsDown &&
        relaunch.relaunchPanelsIdentical &&
        relaunch.relaunchChatStillRight &&
        relaunch.relaunchThemePreserved &&
        relaunch.relaunchFromExportOnly &&
        relaunch.relaunchNoNavigation &&
        relaunch.teardownBounded,
      );

      // CUSTOMIZATION (custom scenario only): the free-creation seam is surfaced as a
      // header strip and the free-created module renders beside the docked chat. The
      // strip carries data-customization-gap / data-organic-fit / data-patch-preview;
      // the aliased module element (sn-data-table) and the chat both live in the
      // mounted panel-layout, with the menu-mode class cleared.
      let isCustom = await page.evaluate((k) => {
        let scenario = window.__chatBuilder.scenarios.find((entry) => entry.key === k);
        return Boolean(scenario && scenario.customization);
      }, key);
      let customization = { applicable: isCustom };
      if (isCustom) {
        customization = await page.evaluate((tag) => {
          let strip = document.querySelector('#stage .cb-customization');
          let stage = document.getElementById('stage');
          let layout = document.querySelector('panel-layout');
          let aliased = layout?.querySelector('sn-data-table') || null;
          let chat = layout?.querySelector(tag) || null;
          let text = strip ? strip.textContent : '';
          let gap = strip?.dataset.customizationGap || '';
          return {
            applicable: true,
            stripPresent: Boolean(strip),
            gapHook: gap,
            showsGapText: Boolean(gap && text.includes('Gap: ' + gap)),
            organicFitAccepted: strip?.dataset.organicFit === 'accepted',
            patchPreviewCount: Number(strip?.dataset.patchPreview || '0'),
            showsPreviewBadge: Boolean(strip?.querySelector('.cb-cz-preview')),
            menuModeCleared: Boolean(stage && !stage.classList.contains('cb-menu-mode')),
            aliasedModuleRendered: Boolean(aliased),
            chatBesideModule: Boolean(aliased && chat),
          };
        }, chatComponent);
      }
      customization.ok = isCustom
        ? Boolean(
            customization.stripPresent &&
            customization.showsGapText &&
            customization.organicFitAccepted &&
            customization.patchPreviewCount > 0 &&
            customization.showsPreviewBadge &&
            customization.menuModeCleared &&
            customization.aliasedModuleRendered &&
            customization.chatBesideModule,
          )
        : true;

      // STATES (UX Slice 2): prove the demo no longer ships visibly FALSE states on a
      // finished, assembled workspace. Re-show the scenario for a canonical assembled
      // state (the relaunch above left the cold-rebuilt node active), then read the
      // rendered chat + workspace DOM: (a) no mounted sn-data-table shows a VISIBLE
      // 'Loading...' overlay (it renders real rows, not a permanent spinner); (b) the
      // chat live-status region is terminal — no 'Processing...'/'Running...' indicator
      // and no spinning icon — after assembly; (c) no settled chat message renders a
      // streaming/typing caret; (d) board cards show a resolved status, never the
      // in-flight 'Queued'/'Running...' sublabel fallback.
      await page.evaluate((k) => window.__chatBuilder.show(k), key);
      await waitAndSnapshot();
      let statesReady = await page.evaluate((tag) => {
        let layout = document.querySelector('panel-layout');
        let chat = layout?.querySelector(tag) || null;

        // (a) Data tables render rows, not a visible 'Loading...' overlay. The overlay
        // div stays in the DOM gated by `@hidden: '!loading'`, BUT its CSS sets
        // display:flex which overrides the UA `[hidden] { display:none }`, so the
        // `hidden` attribute alone does NOT mean invisible — check COMPUTED visibility.
        let isVisible = (el) => {
          if (!el) return false;
          let cs = getComputedStyle(el);
          return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
        };
        let tables = [...(layout?.querySelectorAll('sn-data-table') || [])];
        let tableState = tables.map((t) => ({
          loadingVisible: isVisible(t.querySelector('.sn-data-table-loading-overlay')),
          emptyVisible: isVisible(t.querySelector('.sn-data-table-empty')),
          rowCount: t.querySelectorAll('tbody tr:not(.sn-data-table-details-row)').length,
        }));
        let noTableLoading = tableState.every((t) => !t.loadingVisible);
        // Every mounted table renders real rows (and is therefore not stuck empty).
        let tablesHaveRows = tableState.every((t) => t.rowCount > 0);

        // (b) Live-status region is terminal: no indicator drawn at all (the component
        // draws its spinning 'Processing...' indicator for ANY non-null live status), so
        // the absence of the indicator node is the terminal, no-spinner state.
        let indicator = chat?.querySelector('.live-status-indicator') || null;
        let indicatorText = indicator ? indicator.textContent.trim() : '';
        let liveStatusTerminal = !indicator;
        let noSpinner = !indicator || !indicator.querySelector('.spin-icon');
        let noProcessingText = !/Processing\.\.\.|Running\.\.\./i.test(indicatorText);

        // (c) No settled message renders a streaming/typing caret. The chat marks a
        // streaming message via its reactive isStreaming flag / a streaming attribute /
        // a caret element; none must be present on the assembled transcript.
        let streamingMessages = [...(chat?.querySelectorAll('chat-message-item') || [])]
          .filter((m) => m.$?.isStreaming === true || m.hasAttribute('streaming') ||
            m.querySelector('.streaming-cursor, .typing-cursor, .text-cursor, [data-streaming="true"]'))
          .length;

        // (d) Board cards carry a resolved status, never the 'Queued'/'Running...'
        // in-flight fallback the component substitutes when statusText is absent.
        let cardStatuses = [...(chat?.querySelectorAll('.status-card-status') || [])]
          .map((c) => c.textContent.trim());
        let cardsResolved = cardStatuses.length > 0 &&
          cardStatuses.every((s) => s.length > 0 && !/^(Queued|Running\.\.\.)$/i.test(s));

        return {
          tableCount: tables.length,
          noTableLoading,
          tablesHaveRows,
          liveStatusTerminal,
          noSpinner,
          noProcessingText,
          streamingMessages,
          noStreamingCaret: streamingMessages === 0,
          cardCount: cardStatuses.length,
          cardsResolved,
        };
      }, chatComponent);
      statesReady.ok = Boolean(
        statesReady.noTableLoading &&
        statesReady.tablesHaveRows &&
        statesReady.liveStatusTerminal &&
        statesReady.noSpinner &&
        statesReady.noProcessingText &&
        statesReady.noStreamingCaret &&
        statesReady.cardsResolved,
      );

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
        // Header is a tidy bar led by the Layout variant chips, within its width, no
        // overflow, and the theme control no longer competes there.
        headerStructured: header.ok,
        // CHROME UNIFIED (UX Slice 4): the three stacked header bars collapse into one —
        // a single product title, the class-tab nav + live theme control hosted in the
        // SSR topbar (orphan empty widget gone), and the scenario header's Layout chips
        // leading.
        chromeUnified: chromeUnified.ok,
        // a11y: tab pattern (aria-selected + roving tabindex), keyboard variant switch,
        // keyboard-driven theme change, focus outline, bounded teardown-race count.
        a11yReady: a11y.ok,
        // PORTABILITY: cold relaunch from exported JSON restores topology + theme + chat.
        relaunchReady: relaunch.ok,
        // CUSTOMIZATION: free-creation seam strip + free-created module beside chat
        // (custom scenario only; trivially true for the canonical classes).
        customizationReady: customization.ok,
        // STATES: no visibly-false states on the assembled workspace — data tables show
        // rows (not 'Loading...'), the live status is terminal (no spinner), no settled
        // message shows a typing caret, and board cards show a resolved status.
        statesReady: statesReady.ok,
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
        chromeUnified,
        a11y,
        relaunch,
        customization,
        statesReady,
        screenshot,
      };
    }

    // RESPONSIVE (narrow viewport): the per-scenario header-overflow check above runs
    // only at 1440. Here we shrink to a 720x900 phone-ish width and assert the demo
    // chrome reflows instead of clipping/overprinting: (i) the scenario header and the
    // class-tab bar carry no horizontal overflow OR are explicitly scrollable, (ii) the
    // tab bar, scenario header, and theme control stack vertically with no row overlap,
    // and (iii) the workspace panels are no longer side-by-side (the chat spans ~full
    // width, the side-by-side splits collapse). The viewport is restored to 1440 after.
    let responsiveReady = { applicable: keys.length >= 1 };
    if (keys.length >= 1) {
      await page.evaluate((k) => window.__chatBuilder.show(k), keys[keys.length - 1]);
      await waitAndSnapshot();
      await page.setViewportSize({ width: 720, height: 900 });
      // Let the layout's ResizeObserver + the CSS media queries settle before measuring.
      await page.waitForFunction(() => window.innerWidth === 720, { timeout });
      await page.waitForFunction(() => {
        let layout = document.querySelector('panel-layout');
        let chat = layout?.querySelector('chat-workspace');
        if (!chat) return false;
        let lb = layout.getBoundingClientRect();
        let cb = chat.getBoundingClientRect();
        // Wait until the chat has reflowed to span ~full layout width (no longer docked
        // into a narrow right column), i.e. the responsive collapse has applied.
        return lb.width > 0 && cb.width >= lb.width * 0.9;
      }, { timeout }).catch(() => {});

      let narrow = await page.evaluate(() => {
        let round = (box) => ({
          left: box.left, right: box.right, top: box.top, bottom: box.bottom,
          width: box.width, height: box.height,
        });
        let scrollableX = (el) => {
          if (!el) return false;
          let overflowX = getComputedStyle(el).overflowX;
          return overflowX === 'auto' || overflowX === 'scroll';
        };
        let noOverflow = (el) => Boolean(el) && (el.scrollWidth - el.clientWidth <= 2 || scrollableX(el));

        let head = document.querySelector('#stage .cb-scenario-head');
        let menu = document.getElementById('cb-menu');
        let theme = document.querySelector('#stage .cb-theme');
        let layout = document.querySelector('panel-layout');
        let chat = layout?.querySelector('chat-workspace') || null;

        // (i) No horizontal overflow (or explicitly horizontally scrollable) for the
        // scenario header and the class-tab bar.
        let headNoOverflow = noOverflow(head);
        let menuNoOverflow = noOverflow(menu);

        // (ii) Rows stack vertically with no overprint. The class-tab bar sits above the
        // scenario header (sibling rows in the chrome), and WITHIN the header its direct
        // children — the Layout choice, the answer/customization summary, and the theme
        // control — each drop onto their own line (each child's bottom is at/above the
        // next child's top, within tolerance). A nested element (theme is a child of the
        // header) is checked against its siblings, not the header it lives in.
        let inOrder = (boxes) => {
          for (let i = 0; i < boxes.length - 1; i += 1) {
            if (boxes[i].bottom > boxes[i + 1].top + 2) return false;
          }
          return true;
        };
        let chromeRows = [menu, head].filter(Boolean).map((el) => round(el.getBoundingClientRect()));
        let chromeStacked = inOrder(chromeRows);
        let headChildren = head
          ? [...head.children].map((el) => round(el.getBoundingClientRect())).filter((b) => b.width > 0 && b.height > 0)
          : [];
        let headChildrenStacked = inOrder(headChildren);
        let stacked = chromeStacked && headChildrenStacked;

        // (iii) The workspace panels are not side-by-side: at this width the layout
        // collapses to a single column, so the chat spans ~full layout width and there
        // is no visible horizontal split holding two panels beside each other.
        let layoutBox = layout ? round(layout.getBoundingClientRect()) : null;
        let chatBox = chat ? round(chat.getBoundingClientRect()) : null;
        let chatFullWidth = Boolean(layoutBox && chatBox && layoutBox.width > 0 &&
          chatBox.width >= layoutBox.width * 0.9);
        // Any horizontal split that is visible AND holds two visibly-sized children
        // side by side would mean panels are still beside each other.
        let sideBySideSplit = [...document.querySelectorAll('panel-layout .split-view[direction="horizontal"]')]
          .some((split) => {
            if (split.hasAttribute('hidden')) return false;
            let box = split.getBoundingClientRect();
            if (box.width <= 0 || box.height <= 0) return false;
            let kids = [...split.children]
              .filter((kid) => kid.classList.contains('split-first') || kid.classList.contains('split-second'))
              .map((kid) => kid.getBoundingClientRect())
              .filter((b) => b.width > 24 && b.height > 24);
            return kids.length >= 2;
          });
        let panelsStacked = chatFullWidth || !sideBySideSplit;

        return {
          headNoOverflow,
          menuNoOverflow,
          headOverflow: head ? head.scrollWidth - head.clientWidth : null,
          menuOverflow: menu ? menu.scrollWidth - menu.clientWidth : null,
          menuScrollable: scrollableX(menu),
          rowsStacked: stacked,
          chromeStacked,
          headChildrenStacked,
          chromeRowCount: chromeRows.length,
          headChildCount: headChildren.length,
          chatFullWidth,
          sideBySideSplit,
          panelsStacked,
        };
      });

      // Restore the viewport so the function's contract (1440) holds for any later work.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForFunction(() => window.innerWidth === 1440, { timeout }).catch(() => {});

      responsiveReady = {
        ...narrow,
        applicable: true,
        ok: Boolean(
          narrow.headNoOverflow &&
          narrow.menuNoOverflow &&
          narrow.rowsStacked &&
          narrow.chromeRowCount >= 2 &&
          narrow.headChildCount >= 2 &&
          narrow.panelsStacked,
        ),
      };
    } else {
      responsiveReady.ok = true;
    }

    let ok = opensOnChat &&
      firstPaintSsr.ok &&
      singleHydratedShell.ok &&
      menuReady.ok &&
      responsiveReady.ok &&
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
      menuReady,
      responsiveReady,
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
