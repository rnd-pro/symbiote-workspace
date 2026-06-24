/**
 * Chat-first demo runtime.
 *
 * Writes a self-contained browser bundle for the questionnaire-driven, multi-scenario
 * chat-first demo. The page opens as a full-screen chat (`chat-workspace`) showing a
 * CLASS MENU — Programming / Video / Automation. Selecting a class mounts that
 * scenario's constructed `config` through the symbiote-ui `panel-layout` runtime, so the
 * built workspace appears with the chat docked on the RIGHT at full height and the real
 * workspace panels on the left. Each panel is seeded with attractive mock content using
 * the public per-component setters, and the chat is seeded with a transcript/board that
 * replays the answered questionnaire for the scenario.
 *
 * The rendered scenario surfaces the questionnaire as a REAL interactive choice: the
 * scenario's `variants` are shown as selectable chips and selecting one re-mounts that
 * variant's `config` into the same `panel-layout` stage with no page reload, so a
 * different choice visibly produces a different left-panel set while the chat stays
 * docked right. A compact live THEME CONTROL (mode, hue, geometry register) re-applies
 * the cascade theme through `applyCascadeTheme` without reload, exercising the color and
 * geometry scales; the scenario's `theme` is applied on mount.
 *
 * @module examples/visual-demo/chat-builder-runtime
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { renderWorkspaceShell, WORKSPACE_SHELL_PLACEHOLDER } from '../../ssr/index.js';
import { demoImportMap } from './server-utils.js';
import { buildChatFirstWorkspace, CHAT_PANEL, CHAT_COMPONENT } from './chat-builder-state.js';

function escapeScriptJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
}

// Build-time SSG: render the workspace shell chrome (Node-only) and inject it into
// the served HTML, mirroring agent-portal's build-web.js injectSsrShell — replace the
// WORKSPACE_SHELL_PLACEHOLDER with the rendered <workspace-shell> so the served page
// already contains the topbar + #workspace-stage host before app.js runs.
async function injectSsrShell(html) {
  if (!html.includes(WORKSPACE_SHELL_PLACEHOLDER)) {
    throw new Error('Failed to locate <workspace-shell> placeholder in chat-builder index.html');
  }
  let shellHtml = await renderWorkspaceShell();
  return html.replace(WORKSPACE_SHELL_PLACEHOLDER, shellHtml);
}

function generateIndexHtml(title, imports) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" />
  <script type="importmap">
${escapeScriptJson({ imports })}
  <\/script>
  <style>
    :root { color-scheme: dark; }
    html, body { height: 100%; }
    body { margin: 0; font-family: var(--sn-font, system-ui, sans-serif);
      background: var(--sn-bg, #0e1116); color: var(--sn-text, #e6edf3); }
    /* SSR'd shell chrome (server-rendered <workspace-shell>, hydrated via isoMode). */
    workspace-shell.workspace-shell { display: flex; flex-direction: column; height: 100vh; min-height: 0; }
    .workspace-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      flex: 0 0 auto; padding: 8px 16px;
      border-block-end: 1px solid color-mix(in srgb, var(--sn-text, #fff) 14%, transparent); }
    .workspace-topbar-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .workspace-title { font-size: 13px; font-weight: 600; color: var(--sn-text-dim, #8b949e); }
    .workspace-topbar-right { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
    .workspace-stage { flex: 1 1 auto; min-height: 0; display: flex; }
    /* The demo UI mounts into the shell's stage host and fills it. */
    .workspace-stage > .cb-shell { flex: 1 1 auto; }
    .cb-shell { display: flex; flex-direction: column; min-height: 0; width: 100%; }
    .cb-bar { display: flex; align-items: center; gap: 12px; padding: 10px 16px;
      border-block-end: 1px solid color-mix(in srgb, var(--sn-text, #fff) 14%, transparent); }
    .cb-bar h1 { font-size: 14px; font-weight: 600; margin: 0; flex: 0 0 auto; }
    .cb-menu { display: flex; gap: 8px; flex: 1; min-width: 0; }
    .cb-bar button { font: inherit; padding: 5px 14px; border-radius: 7px; cursor: pointer;
      border: 1px solid color-mix(in srgb, var(--sn-text, #fff) 16%, transparent);
      background: var(--sn-panel-bg, #161b22); color: inherit; line-height: 1.1; }
    .cb-bar button.cb-class { display: inline-flex; align-items: center; gap: 6px; }
    .cb-bar button.cb-class[aria-selected="true"] {
      border-color: var(--sn-node-selected, #58a6ff);
      background: color-mix(in srgb, var(--sn-node-selected, #58a6ff) 22%, transparent);
      color: var(--sn-text, #fff); }
    .cb-bar .cb-icon { font-family: "Material Symbols Outlined"; font-size: 18px; line-height: 1; }
    .cb-back { margin-inline-start: auto; flex: 0 0 auto; }
    #stage { flex: 1; min-height: 0; padding: 12px; box-sizing: border-box;
      display: flex; flex-direction: column; gap: 10px; }
    #stage.cb-menu-mode > .cb-scenario-head { display: none; }
    /* Scenario header: a single tidy bar — the Layout (variant) choice on the left,
       a compact answered-questionnaire summary in the middle, the live theme control
       on the right. No wrapping option-chip strip; the chat already shows the full
       answered questionnaire as a board, so the header keeps only a condensed summary. */
    .cb-scenario-head { flex: 0 0 auto; display: flex; flex-wrap: nowrap; align-items: center;
      gap: 16px; padding: 8px 14px; border-radius: 9px; min-width: 0;
      border: 1px solid color-mix(in srgb, var(--sn-text, #fff) 12%, transparent);
      background: color-mix(in srgb, var(--sn-panel-bg, #161b22) 80%, transparent); }
    .cb-choice { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 0 1 auto; }
    .cb-choice-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--sn-text-dim, #8b949e); flex: 0 0 auto; }
    .cb-variants { display: flex; gap: 6px; flex-wrap: wrap; min-width: 0; }
    .cb-variant { font: inherit; font-size: 12px; padding: 4px 12px; border-radius: 999px; cursor: pointer;
      line-height: 1.2; color: inherit; white-space: nowrap;
      border: 1px solid color-mix(in srgb, var(--sn-text, #fff) 18%, transparent);
      background: color-mix(in srgb, var(--sn-bg, #0e1116) 70%, transparent);
      transition: border-color 150ms ease, background 150ms ease, color 150ms ease; }
    .cb-variant[aria-selected="true"] {
      border-color: var(--sn-node-selected, #58a6ff);
      background: color-mix(in srgb, var(--sn-node-selected, #58a6ff) 24%, transparent);
      color: var(--sn-text, #fff); }
    /* Compact answered-questionnaire summary: one truncating line, no chip grid. */
    .cb-answers { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto;
      overflow: hidden; }
    .cb-answers-icon { font-family: "Material Symbols Outlined"; font-size: 15px; line-height: 1;
      color: var(--sn-text-dim, #8b949e); flex: 0 0 auto; }
    .cb-answers-text { font-size: 11px; line-height: 1.3; min-width: 0; flex: 1 1 auto;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      color: var(--sn-text-dim, #8b949e); }
    .cb-answer-q { color: color-mix(in srgb, var(--sn-text, #fff) 78%, transparent); font-weight: 600; }
    .cb-answer-v { color: var(--sn-text-dim, #8b949e); }
    .cb-answer-sep { color: color-mix(in srgb, var(--sn-text, #fff) 22%, transparent);
      margin: 0 8px; }
    /* Customization strip (custom scenario only): the discover -> gap -> recipe ->
       organic-fit -> preview seam as a compact row of chips. */
    .cb-customization { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      min-width: 0; flex: 1 1 auto; }
    .cb-cz-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px;
      line-height: 1.2; padding: 4px 10px; border-radius: 999px; white-space: nowrap;
      border: 1px solid color-mix(in srgb, var(--sn-text, #fff) 18%, transparent);
      background: color-mix(in srgb, var(--sn-bg, #0e1116) 70%, transparent);
      color: var(--sn-text-dim, #8b949e); }
    .cb-cz-chip .cb-icon { font-family: "Material Symbols Outlined"; font-size: 14px; line-height: 1; }
    .cb-cz-gap { color: var(--sn-text, #fff);
      border-color: color-mix(in srgb, var(--sn-danger, #f85149) 60%, transparent);
      background: color-mix(in srgb, var(--sn-danger, #f85149) 18%, transparent); }
    .cb-cz-recipe { color: var(--sn-text, #fff);
      border-color: color-mix(in srgb, var(--sn-success, #3fb950) 60%, transparent);
      background: color-mix(in srgb, var(--sn-success, #3fb950) 18%, transparent); }
    .cb-cz-fit { color: var(--sn-text, #fff);
      border-color: color-mix(in srgb, var(--sn-success, #3fb950) 50%, transparent);
      background: color-mix(in srgb, var(--sn-success, #3fb950) 12%, transparent); }
    .cb-cz-preview { color: var(--sn-text, #fff);
      border-color: var(--sn-node-selected, #58a6ff);
      background: color-mix(in srgb, var(--sn-node-selected, #58a6ff) 18%, transparent); }
    /* Live theme control. */
    .cb-theme { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; margin-inline-start: auto;
      padding-inline-start: 14px; border-inline-start: 1px solid color-mix(in srgb, var(--sn-text, #fff) 12%, transparent); }
    .cb-theme-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--sn-text-dim, #8b949e); display: inline-flex; align-items: center; gap: 4px; }
    .cb-theme-label .cb-icon { font-family: "Material Symbols Outlined"; font-size: 15px; }
    .cb-theme-group { display: inline-flex; align-items: center; gap: 5px; }
    .cb-theme-modes, .cb-theme-registers { display: inline-flex;
      border: 1px solid color-mix(in srgb, var(--sn-text, #fff) 18%, transparent);
      border-radius: 7px; overflow: hidden; }
    .cb-theme-modes button, .cb-theme-registers button { border: 0; border-radius: 0; padding: 4px 9px;
      font: inherit; font-size: 11px; cursor: pointer; line-height: 1.2; color: var(--sn-text-dim, #8b949e);
      background: transparent; }
    .cb-theme-modes button[aria-pressed="true"], .cb-theme-registers button[aria-pressed="true"] {
      background: var(--sn-node-selected, #58a6ff); color: #fff; }
    .cb-theme input[type="range"] { width: 96px; accent-color: var(--sn-node-selected, #58a6ff); }
    .cb-theme-swatch { width: 18px; height: 18px; border-radius: 50%;
      background: var(--sn-node-selected, #58a6ff);
      box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--sn-bg, #0e1116) 55%, transparent); }
    .cb-theme-value { font-size: 11px; color: var(--sn-text-dim, #8b949e);
      min-width: 28px; text-align: end; font-variant-numeric: tabular-nums; }
    /* Keyboard focus affordance for the interactive controls: a visible, non-zero
       outline only on keyboard focus (:focus-visible), so mouse use stays clean. */
    .cb-class:focus-visible, .cb-variant:focus-visible, .cb-theme button:focus-visible,
    .cb-theme input[type="range"]:focus-visible {
      outline: 2px solid var(--sn-node-selected, #58a6ff); outline-offset: 2px; }
    #stage > panel-layout, #stage > .cb-symbiote-layout { flex: 1 1 auto; min-height: 0; }
    #stage .cb-symbiote-layout {
      display: block; width: 100%; height: 100%; min-width: 0; min-height: 0;
      --sn-layout-border: color-mix(in srgb, var(--sn-text, CanvasText) 14%, transparent);
      --sn-layout-gap-bg: color-mix(in srgb, var(--sn-bg) 86%, var(--sn-node-selected) 14%);
      --sn-layout-header-block-size: 32px;
    }
    #stage .cb-symbiote-layout .layout-root,
    #stage .cb-symbiote-layout .split-view,
    #stage .cb-symbiote-layout .split-first,
    #stage .cb-symbiote-layout .split-second,
    #stage .cb-symbiote-layout .panel-view,
    #stage .cb-symbiote-layout .panel-content { min-width: 0; min-height: 0; }
    #stage .cb-symbiote-layout .panel-view { height: 100%; overflow: hidden; }
    #stage .cb-symbiote-layout .panel-content { display: flex; flex-direction: column; overflow: hidden; }
    chat-workspace.chat-workspace-view {
      display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; height: 100%;
    }
  </style>
</head>
<body>
  ${WORKSPACE_SHELL_PLACEHOLDER}
  <template id="cb-demo-template">
    <div class="cb-shell">
      <div class="cb-bar">
        <h1>${title}</h1>
        <div class="cb-menu" id="cb-menu" role="tablist" aria-label="Workspace classes"></div>
        <button id="cb-back" class="cb-back" type="button">Back to menu</button>
      </div>
      <div id="stage"></div>
    </div>
  </template>
  <script type="module" src="./app.js"><\/script>
</body>
</html>`;
}

function generateAppJs(scenarios, chatComponent) {
  return `import { applyCascadeTheme, CASCADE_THEME_DEFAULTS, defineModule } from 'symbiote-ui/ui';
import { geometrySpacePrimitives, GEOMETRY_PROFILE_NAMES } from 'symbiote-ui/tokens/scale.js';
import { importConfig } from 'symbiote-workspace/browser';
import 'symbiote-ui/board';
// Register <workspace-shell>; isoMode hydrates the build-time SSR markup in <body>
// instead of re-rendering it. The bare '@symbiotejs/symbiote' import it pulls in is
// resolved by the served import map. The shell chrome is the only SSR'd surface; the
// data-driven demo UI mounts into its stage host and is rendered fully on the client.
import '/__workspace__/ssr/WorkspaceShell.js';

const scenarios = ${escapeScriptJson(scenarios)};
const CHAT_PANEL = ${JSON.stringify(CHAT_PANEL)};
const CHAT_COMPONENT = ${JSON.stringify(chatComponent)};
const definedModuleTags = new Set();
// Component tags a variant config places that seedPanel has no seeder for. Recorded
// (not silently swallowed) so an unseeded panel is visible to diagnostics/smoke.
const unseededComponents = [];

// Mount the demo UI (class-menu bar + dynamic stage) INTO the hydrated SSR shell's
// stage host. The shell is server-rendered and present at first paint; here we only
// move the client-rendered demo chrome into its [data-workspace-host] mount point.
const shellEl = document.querySelector('workspace-shell');
const ssrHost = shellEl?.querySelector('[data-workspace-host]');
if (!ssrHost) {
  console.warn('chat-builder: SSR shell stage host ([data-workspace-host]) missing; falling back to <body>. This indicates an SSR/hydration regression.');
}
const hostEl = ssrHost || document.body;
const demoTemplate = document.getElementById('cb-demo-template');
if (demoTemplate) hostEl.appendChild(demoTemplate.content.cloneNode(true));

const stageEl = document.getElementById('stage');
const menuEl = document.getElementById('cb-menu');
const backEl = document.getElementById('cb-back');

// The stage host is the tabpanel each tab (class / variant) controls.
const STAGE_HOST_ID = 'stage';

// Roving-tabindex + arrow-key navigation for a role=tablist. ArrowLeft/Right move
// selection+focus to the prev/next tab, Home/End to the first/last; each move runs
// onSelect(button), which re-mounts that class/variant (same effect as a click).
function enableTablistKeys(listEl, tabSelector, onSelect) {
  listEl.addEventListener('keydown', (event) => {
    let tabs = [...listEl.querySelectorAll(tabSelector)];
    if (!tabs.length) return;
    let current = tabs.indexOf(document.activeElement);
    if (current === -1) current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    let next = current === -1 ? 0 : current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    let target = tabs[next];
    target.focus();
    onSelect(target);
  });
}

// Apply aria-selected + roving tabindex over a tablist's tabs: the tab matching
// isActive is selected and tabbable (tabindex 0), the rest are tabindex -1. Also
// labels the stage tabpanel by the active tab so the tab/tabpanel pair is complete.
function syncRovingTabs(tabs, isActive) {
  let selectedId = '';
  tabs.forEach((tab, index) => {
    let active = isActive(tab, index);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active) {
      if (!tab.id) tab.id = 'cb-tab-' + (tab.dataset.key || tab.dataset.variant || index);
      selectedId = tab.id;
    }
  });
  if (selectedId && stageEl) {
    stageEl.setAttribute('role', 'tabpanel');
    stageEl.setAttribute('aria-labelledby', selectedId);
  }
}

const CLASS_ICONS = { programming: 'code', video: 'movie', automation: 'hub', custom: 'auto_awesome' };
const REGISTERS = (GEOMETRY_PROFILE_NAMES || []).filter((name) => name === 'tool' || name === 'product');

// Live theme state, applied to the document root via the cascade theme so every
// --sn-* token recomputes without a reload. Seeded from the active scenario's
// theme on mount and mutated by the header theme control.
let themeState = { ...CASCADE_THEME_DEFAULTS };
let geometryRegister = '';

// Re-apply the cascade theme (color/geometry/motion scales) plus the geometry
// register primitives, so a control change recomputes the live --sn-* tokens.
function applyTheme() {
  applyCascadeTheme(document.documentElement, themeState, { notify: false, source: 'chat-builder' });
  let primitives = geometryRegister ? geometrySpacePrimitives(geometryRegister) : null;
  for (let [token, value] of Object.entries(geometrySpacePrimitives('product'))) {
    document.documentElement.style.setProperty(token, (primitives && primitives[token]) || value);
  }
  document.documentElement.dataset.geometryRegister = geometryRegister || 'default';
}

// Merge a partial theme update ({mode, hue, register, ...}) and re-apply live.
function setTheme(partial = {}) {
  let next = partial || {};
  if (next.register !== undefined) {
    geometryRegister = REGISTERS.includes(next.register) ? next.register : '';
  }
  for (let [key, value] of Object.entries(next)) {
    if (key === 'register') continue;
    if (key in CASCADE_THEME_DEFAULTS) themeState[key] = value;
  }
  applyTheme();
  syncThemeControl();
  return getThemeState();
}

function getThemeState() {
  return { ...themeState, register: geometryRegister || 'default' };
}

function getThemeToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}

applyTheme();

// Some real symbiote-ui components self-register on import instead of being in the
// defineModule catalog; import their module to trigger the .reg() side effect.
const SELF_REGISTERING_MODULES = {
  'sn-canvas-viewport': 'symbiote-ui/viewport/CanvasViewport/CanvasViewport.js',
  'sn-timeline-editor': 'symbiote-ui/timeline/TimelineEditor/TimelineEditor.js',
};

// Demo stand-in for the custom scenario's FREE-CREATED module: its hand-authored
// recipe tag has no .reg() in symbiote-ui, so for RENDERING we alias every custom
// recipe tagName to the real sn-data-table component. The alias is collected from
// each scenario's customization.recipe so a defined custom element actually paints.
const MODULE_ALIASES = Object.create(null);
for (let scenario of scenarios) {
  let tagName = scenario.customization?.recipe?.tagName;
  if (tagName && tagName !== 'sn-data-table') MODULE_ALIASES[tagName] = 'sn-data-table';
}
function resolveModuleTag(tag) {
  return MODULE_ALIASES[tag] || tag;
}

// Rewrite a config's panelTypes component tags through the render alias so the
// free-created custom module renders as its sn-data-table stand-in. Returns the
// original config untouched when no panel uses an aliased tag.
function aliasConfig(config) {
  let panelTypes = config?.panelTypes;
  if (!panelTypes) return config;
  let aliased = null;
  for (let [type, panel] of Object.entries(panelTypes)) {
    let resolved = resolveModuleTag(panel?.component);
    if (resolved === panel?.component) continue;
    if (!aliased) aliased = { ...config, panelTypes: { ...panelTypes } };
    aliased.panelTypes[type] = { ...panel, component: resolved, aliasedFrom: panel.component };
  }
  return aliased || config;
}

let activeKey = null;
let activeVariantId = null;
let activeLayout = null;
// The active variant's exported portable JSON string, captured on mount so a relaunch
// can rebuild the workspace from exportConfig output alone (never from variant.config).
let activeVariantExportJson = '';

// Resolve a scenario's selectable variants. The contract carries
// scenario.variants = [{ id, label, answers, config, exportJson, digest }] with
// the top-level config equal to the default variant; if a scenario predates the
// variant contract, synthesize a single variant from its config so the choice
// surface always has at least one option.
function variantsOf(scenario) {
  if (Array.isArray(scenario.variants) && scenario.variants.length) return scenario.variants;
  return [{ id: 'default', label: scenario.label || scenario.key, answers: {}, config: scenario.config }];
}

function variantById(scenario, variantId) {
  let list = variantsOf(scenario);
  return list.find((variant) => variant.id === variantId) || list[0];
}

// Read a scenario's questionnaire-derived theme ({mode, hue}); fall back to the
// cascade defaults so theme readiness works before the driver ships themes.
function themeOf(scenario) {
  let theme = scenario.theme || {};
  return {
    mode: theme.mode === 'light' || theme.mode === 'dark' ? theme.mode : CASCADE_THEME_DEFAULTS.mode,
    hue: Number.isFinite(theme.hue) ? theme.hue : CASCADE_THEME_DEFAULTS.hue,
  };
}

// Count the panel components (non-chat custom elements) the variant's config
// places, so the choice surface and smoke can see the left-panel set differ.
function panelComponentsOf(config) {
  return Object.entries(config?.panelTypes || {})
    .filter(([type, panel]) => type !== CHAT_PANEL && panel?.component)
    .map(([, panel]) => panel.component);
}

// Copy of the realtime-builder layout-node normalizer: panel-layout expects every
// node to carry a stable id, so derive one from its path when the config omits it.
function normalizeLayoutNode(node, path = 'root') {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'panel') {
    return { ...node, id: node.id || (path + '-' + (node.panelType || 'panel')) };
  }
  if (node.type === 'split') {
    return {
      ...node,
      id: node.id || (path + '-split'),
      first: normalizeLayoutNode(node.first, path + '-a'),
      second: normalizeLayoutNode(node.second, path + '-b'),
    };
  }
  return node;
}

async function defineWorkspaceModules(config) {
  let tags = Object.values(config?.panelTypes || {})
    .map((panel) => resolveModuleTag(panel?.component))
    .filter(Boolean);
  for (let tag of tags) {
    if (customElements.get(tag)) { definedModuleTags.add(tag); continue; }
    if (definedModuleTags.has(tag)) continue;
    if (SELF_REGISTERING_MODULES[tag]) {
      await import(SELF_REGISTERING_MODULES[tag]);
      await customElements.whenDefined(tag);
    } else {
      defineModule(tag, { includeInternal: true, includeExperimental: true });
    }
    definedModuleTags.add(tag);
  }
}

function findPanelElement(root, selector) {
  if (root?.matches?.(selector)) return root;
  return root?.querySelector?.(selector) || null;
}

function scenarioByKey(key) {
  return scenarios.find((scenario) => scenario.key === key) || null;
}

// Build a chat-workspace transcript that replays the answered questionnaire as a
// board of decisions plus a short agent narration, so the chat shows the offered
// questions and the chosen options for the scenario.
function chatWorkspaceState(scenario, config = scenario.config) {
  let questions = scenario.questions || [];
  let messages = [
    {
      id: 'cb-user-intent',
      role: 'user',
      text: 'Build me a ' + (scenario.label || scenario.key) + ' workspace: ' + (scenario.intent || 'a focused tool console') + '.',
    },
    {
      id: 'cb-agent-plan',
      role: 'agent',
      text: 'I will ask a few questions, then assemble the panels around this chat and keep the conversation docked on the right.',
    },
  ];
  for (let question of questions) {
    let options = question.options || [];
    let chosen = Array.isArray(question.chosen) ? question.chosen : (question.chosen != null ? [question.chosen] : []);
    let labelFor = (value) => (options.find((option) => option.value === value)?.label) || String(value);
    messages.push({
      id: 'cb-q-' + question.id,
      role: 'agent',
      text: question.prompt + (question.type === 'multi-select' ? ' (choose any that apply)' : ''),
    });
    messages.push({
      id: 'cb-board-' + question.id,
      role: 'board',
      cardItems: options.map((option) => ({
        id: question.id + ':' + option.value,
        title: option.label,
        status: chosen.includes(option.value) ? 'done' : 'todo',
        icon: chosen.includes(option.value) ? 'check_circle' : 'radio_button_unchecked',
      })),
    });
    messages.push({
      id: 'cb-a-' + question.id,
      role: 'user',
      text: chosen.length ? chosen.map(labelFor).join(', ') : 'Use the defaults.',
    });
  }
  messages.push({
    id: 'cb-agent-done',
    role: 'agent',
    text: 'Assembled the ' + (scenario.label || scenario.key) + ' workspace from your answers. The conversation stays pinned on the right while you work the panels on the left.',
    isStreaming: true,
  });
  return {
    sidebar: 'hidden',
    chats: scenarios.map((entry) => ({
      id: 'chat-' + entry.key,
      title: entry.label || entry.key,
      subtitle: entry.intent || 'workspace class',
    })),
    activeChatId: 'chat-' + scenario.key,
    messages,
    messagesOptions: { scrollToBottom: true },
    composer: {
      placeholder: 'Refine the ' + (scenario.label || scenario.key) + ' workspace...',
      value: '',
      attachedContext: [
        { id: 'class', label: scenario.label || scenario.key },
        { id: 'template', label: (scenario.template || 'workspace') + ' template' },
      ],
      footerControls: [
        { id: 'questions', kind: 'button', icon: 'quiz', label: 'Answered', value: String(questions.length) },
        { id: 'panels', kind: 'button', icon: 'view_quilt', label: 'Panels', value: String(Object.keys(config?.panelTypes || {}).length) },
      ],
    },
    liveStatus: { phase: 'running', title: scenario.label || scenario.key, text: scenario.intent || 'workspace ready' },
    backgroundState: 'activity',
  };
}

// Deterministic mock content keyed by component tag, so every real workspace panel
// renders attractive, non-trivial content through its public setter.
function seedPanel(root, panelType, panel, scenario, config = scenario.config) {
  let component = panel.component;
  let title = panel.title || panelType;

  if (component === CHAT_COMPONENT) {
    let chat = findPanelElement(root, CHAT_COMPONENT);
    chat?.classList?.add('chat-workspace-view');
    chat?.setWorkspaceState?.(chatWorkspaceState(scenario, config));
    return;
  }
  if (component === 'source-editor') {
    let editor = findPanelElement(root, 'source-editor');
    editor?.setSourceDocument?.({
      name: scenario.key + '/agent.js',
      language: 'javascript',
      content: [
        "// " + title + " — generated by the chat-first builder.",
        "import { defineAgent } from '@workspace/runtime';",
        "",
        "export default defineAgent({",
        "  intent: " + JSON.stringify(scenario.intent || scenario.label) + ",",
        "  async run(ctx) {",
        "    let plan = await ctx.plan(ctx.message);",
        "    return ctx.apply(plan);",
        "  },",
        "});",
      ].join('\\n'),
    });
    return;
  }
  if (component === 'sn-canvas-viewport') {
    let viewport = findPanelElement(root, 'sn-canvas-viewport');
    viewport?.setAttribute?.('aspect', '16:9');
    viewport?.setFrame?.(48);
    return;
  }
  if (component === 'sn-timeline-editor') {
    let timeline = findPanelElement(root, 'sn-timeline-editor');
    timeline?.loadTimeline?.({
      fps: 30,
      duration: 300,
      tracks: [
        { id: 'video', type: 'video', label: 'Main cut', clips: [
          { id: 'v1', start: 0, end: 120, label: 'Intro' },
          { id: 'v2', start: 130, end: 260, label: 'B-roll' },
        ] },
        { id: 'audio', type: 'audio', label: 'Voiceover', clips: [
          { id: 'a1', start: 10, end: 150, label: 'Narration' },
          { id: 'a2', start: 170, end: 290, label: 'Music bed' },
        ] },
        { id: 'fx', type: 'effect', label: 'Effects', clips: [
          { id: 'f1', start: 60, end: 110, label: 'Zoom' },
          { id: 'f2', start: 200, end: 250, label: 'Color' },
        ] },
      ],
      markers: [{ frame: 130, label: 'Scene 2' }],
    });
    return;
  }
  if (component === 'node-canvas') {
    let canvas = findPanelElement(root, 'node-canvas');
    canvas?.setEditorModel?.({
      nodes: [
        { id: 'trigger', name: 'Trigger', type: 'trigger', outputs: [{ name: 'event', label: 'event' }] },
        { id: 'transform', name: 'Transform', type: 'transform', inputs: [{ name: 'in', label: 'in' }], outputs: [{ name: 'out', label: 'out' }] },
        { id: 'deliver', name: 'Deliver', type: 'deliver', inputs: [{ name: 'payload', label: 'payload' }] },
      ],
      connections: [
        { id: 'c1', from: 'trigger', out: 'event', to: 'transform', in: 'in' },
        { id: 'c2', from: 'transform', out: 'out', to: 'deliver', in: 'payload' },
      ],
      positions: { trigger: [40, 120], transform: [320, 120], deliver: [600, 120] },
    });
    canvas?.setAllFlowing?.(true);
    canvas?.setPathStyle?.('pcb');
    return;
  }
  if (component === 'inspector-panel') {
    let inspector = findPanelElement(root, 'inspector-panel');
    inspector?.inspect?.({
      label: title,
      inputs: { signal: { label: 'signal', socket: { name: 'event' } } },
      outputs: { result: { label: 'result', socket: { name: 'method' } } },
      controls: {
        importance: { label: 'Importance', value: String(panel.behavior?.importance ?? 'auto'), type: 'text' },
        collapse: { label: 'Collapse', value: panel.behavior?.collapse || 'auto', type: 'text' },
      },
    });
    return;
  }
  // Free-created custom module: it has no real component, so it was aliased to
  // sn-data-table for rendering. Seed it through the same sn-data-table setter as
  // a clearly-mocked heatmap of the requested capability's signal intensity.
  if (component === 'sn-data-table' && panel.aliasedFrom) {
    let table = findPanelElement(root, 'sn-data-table');
    let capability = scenario.customization?.recipe?.capabilities?.[0] || 'signal';
    let bands = ['Cold', 'Low', 'Warm', 'High', 'Peak'];
    table?.setData?.({
      columns: [
        { key: 'segment', label: 'Segment', sortable: true },
        ...bands.map((band) => ({ key: band.toLowerCase(), label: band })),
      ],
      rows: ['Acquisition', 'Activation', 'Retention', 'Revenue'].map((segment, row) => ({
        id: segment,
        segment,
        ...Object.fromEntries(bands.map((band, col) =>
          [band.toLowerCase(), String(((row * 7 + col * 13) % 9) * 11 + 5) + '%'])),
      })),
      emptyText: 'No ' + capability + ' signal',
    });
    table?.setAttribute?.('selection-mode', 'single');
    table?.setAttribute?.('title', panel.title || (panel.aliasedFrom + ' (demo stand-in)'));
    return;
  }
  if (component === 'sn-data-table') {
    let table = findPanelElement(root, 'sn-data-table');
    table?.setData?.({
      columns: [
        { key: 'panel', label: 'Panel', sortable: true },
        { key: 'role', label: 'Role' },
        { key: 'status', label: 'Status', sortable: true },
      ],
      rows: Object.entries(config?.panelTypes || {}).map(([type, info]) => ({
        id: type,
        panel: info.title || type,
        role: info.component,
        status: type === CHAT_PANEL ? 'pinned' : 'ready',
      })),
      emptyText: 'No panels',
    });
    table?.setAttribute?.('selection-mode', 'single');
    return;
  }
  if (component === 'sn-rich-text-editor') {
    let rich = findPanelElement(root, 'sn-rich-text-editor');
    if (rich) {
      rich.value = [
        '<h2>' + (scenario.label || scenario.key) + ' brief</h2>',
        '<p>' + (scenario.intent || 'A focused workspace assembled from the questionnaire.') + '</p>',
        '<ul>' + (scenario.questions || []).map((question) => {
          let chosen = Array.isArray(question.chosen) ? question.chosen : [question.chosen].filter(Boolean);
          let labels = chosen.map((value) => (question.options || []).find((option) => option.value === value)?.label || value);
          return '<li><strong>' + question.prompt + ':</strong> ' + (labels.join(', ') || 'defaults') + '</li>';
        }).join('') + '</ul>',
      ].join('');
    }
    return;
  }
  if (component === 'sn-file-upload') {
    let upload = findPanelElement(root, 'sn-file-upload');
    upload?.setAttribute?.('label', 'Drop assets for ' + (scenario.label || scenario.key));
    upload?.setAttribute?.('accept', 'image/*,video/*');
    upload?.setAttribute?.('multiple', '');
    return;
  }
  if (component === 'sn-tree-panel') {
    let tree = findPanelElement(root, 'sn-tree-panel');
    if (tree) {
      tree.setAttribute('title', title);
      tree.setAttribute('title-icon', panel.icon || 'account_tree');
      tree.setItems?.((scenario.questions || []).map((question) => ({
        id: question.id,
        label: question.prompt,
        children: (question.options || []).map((option) => ({
          id: question.id + ':' + option.value,
          label: option.label,
        })),
      })));
      tree.showTree?.();
    }
    return;
  }
  if (component === 'sn-event-feed') {
    let feed = findPanelElement(root, 'sn-event-feed');
    feed?.setAttribute?.('title', title);
    feed?.setEvents?.((scenario.stages || []).map((stage, index) => ({
      id: 'stage-' + index,
      title: stage.title || ('Step ' + (index + 1)),
      time: String(index + 1).padStart(2, '0'),
      variant: 'info',
    })));
    return;
  }
  if (component === 'code-block') {
    findPanelElement(root, 'code-block')?.setContent?.(
      (config?.exportJson || scenario.exportJson || JSON.stringify(config, null, 2)).slice(0, 2000),
      'json',
    );
    return;
  }
  if (component === 'canvas-graph') {
    findPanelElement(root, 'canvas-graph')?.setGraphModel?.({
      nodes: Object.keys(config?.panelTypes || {}).map((type) => ({
        id: type, label: type, type: type === CHAT_PANEL ? 'source' : 'view', status: 'ready',
      })),
      connections: Object.keys(config?.panelTypes || {})
        .filter((type) => type !== CHAT_PANEL)
        .map((type) => ({ id: 'c-' + type, source: CHAT_PANEL, target: type })),
    });
    return;
  }
  // No seeder matched this tag: record it instead of silently leaving the panel
  // empty, so an unseeded component surfaces in diagnostics rather than passing
  // unnoticed.
  if (!unseededComponents.includes(component)) {
    unseededComponents.push(component);
    console.warn('chat-builder: no seeder for component', component, '(panel ' + panelType + ')');
  }
}

// Drive a panel-layout's config in over a double rAF: the outer frame sets panelTypes
// + layoutTree so the node renders its panels, the inner frame seeds each rendered
// component through its public setter and marks document.body.dataset.seeded. Shared by
// the variant mount and the portable-JSON relaunch so both run one identical seed path.
// onSeeded runs inside the inner frame after seeding, before the promise resolves.
function seedLayout(layout, config, scenario, variantId, onSeeded) {
  document.body.dataset.seeded = '';
  return new Promise((done) => {
    requestAnimationFrame(() => {
      layout.$.panelTypes = config.panelTypes || {};
      layout.$.layoutTree = normalizeLayoutNode(config.layout);
      requestAnimationFrame(() => {
        for (let [panelType, panel] of Object.entries(config.panelTypes || {})) {
          if (!panel.component) continue;
          for (let element of layout.querySelectorAll(panel.component)) {
            seedPanel(element, panelType, panel, scenario, config);
          }
        }
        document.body.dataset.seeded = scenario.key + ':' + variantId;
        document.body.dataset.activeVariant = variantId;
        if (onSeeded) onSeeded();
        done();
      });
    });
  });
}

// Mount (or re-mount) one variant's config into the scenario's single panel-layout
// instance. Re-mounting swaps panelTypes + layoutTree in place — no page reload — so
// selecting a different variant visibly produces a different left-panel set while the
// chat stays docked on the right.
async function mountVariant(scenario, variant) {
  if (!stageEl) throw new Error('chat-builder: stage host (#' + STAGE_HOST_ID + ') is missing; cannot mount a variant');
  let config = aliasConfig(variant.config || scenario.config);
  activeVariantId = variant.id;
  activeVariantExportJson = typeof variant.exportJson === 'string' ? variant.exportJson : '';
  await defineWorkspaceModules(config);

  let layout = activeLayout;
  if (!layout || !layout.isConnected) {
    layout = document.createElement('panel-layout');
    layout.className = 'cb-symbiote-layout';
    stageEl.appendChild(layout);
    activeLayout = layout;
  }
  let rootBehavior = config.rootBehavior || {};
  layout.setAttribute('responsive-mode', rootBehavior.responsiveMode || 'drawer');
  layout.setAttribute('responsive-breakpoint', String(rootBehavior.responsiveBreakpoint || 860));
  layout.setAttribute('swipe-control', rootBehavior.swipeControl || 'edge');
  layout.dataset.variant = variant.id;

  await seedLayout(layout, config, scenario, variant.id);
}

// PORTABILITY relaunch: rebuild the active variant in a genuinely fresh panel-layout
// node sourced ONLY from the variant's exported portable JSON, proving the demo can be
// reconstructed from exportConfig output alone. The original node is torn down cold and
// replaced; restored topology + theme + module set must match the live workspace.
async function relaunchFromExport(key) {
  let scenario = scenarioByKey(key);
  if (!scenario || !stageEl) return false;
  let variantId = activeVariantId;
  let imported = importConfig(activeVariantExportJson);
  let config2 = aliasConfig(imported.config);
  if (!config2) return false;

  // COLD teardown: drop the live node and its reference, then build a brand-new
  // panel-layout under the stage so the relaunch starts from an empty container.
  if (activeLayout && activeLayout.isConnected) activeLayout.remove();
  activeLayout = null;
  let layout = document.createElement('panel-layout');
  layout.className = 'cb-symbiote-layout';
  stageEl.appendChild(layout);
  activeLayout = layout;

  await defineWorkspaceModules(config2);
  let rootBehavior = config2.rootBehavior || {};
  layout.setAttribute('responsive-mode', rootBehavior.responsiveMode || 'drawer');
  layout.setAttribute('responsive-breakpoint', String(rootBehavior.responsiveBreakpoint || 860));
  layout.setAttribute('swipe-control', rootBehavior.swipeControl || 'edge');
  layout.dataset.variant = variantId;

  await seedLayout(layout, config2, scenario, variantId, () => {
    document.body.dataset.relaunched = key + ':' + variantId;
  });
  // Re-apply E's tab wiring so the fresh stage tabpanel stays labelled by the active tab.
  syncVariantButtons();
  return true;
}

// Build the scenario header as a single tidy bar: the Layout (variant) CHOICE chips
// on the left, a compact one-line answered-questionnaire SUMMARY in the middle, and
// the live THEME control on the right. Selecting a chip re-mounts that variant; the
// theme control re-applies the cascade theme without reload. The verbose per-option
// chip grid is intentionally dropped here — the chat transcript already replays the
// full answered questionnaire as a board, so the header keeps only a condensed recap.
function renderScenarioHead(scenario) {
  let head = document.createElement('div');
  head.className = 'cb-scenario-head';

  let variants = variantsOf(scenario);
  let choice = document.createElement('div');
  choice.className = 'cb-choice';
  let choiceLabel = document.createElement('span');
  choiceLabel.className = 'cb-choice-label';
  choiceLabel.textContent = 'Layout';
  let variantWrap = document.createElement('div');
  variantWrap.className = 'cb-variants';
  variantWrap.setAttribute('role', 'tablist');
  variantWrap.setAttribute('aria-label', 'Workspace layout variants');
  for (let variant of variants) {
    let button = document.createElement('button');
    button.type = 'button';
    button.className = 'cb-variant';
    button.dataset.variant = variant.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', STAGE_HOST_ID);
    button.textContent = variant.label || variant.id;
    button.title = panelComponentsOf(variant.config).join(', ') || 'variant';
    button.addEventListener('click', () => selectVariant(scenario.key, variant.id));
    variantWrap.appendChild(button);
  }
  enableTablistKeys(variantWrap, '.cb-variant', (button) => selectVariant(scenario.key, button.dataset.variant));
  choice.append(choiceLabel, variantWrap);
  head.appendChild(choice);

  // The custom scenario surfaces the free-creation seam (discover -> gap -> recipe
  // -> organic-fit -> preview) as a compact strip in place of the answered-summary
  // recap; every other class keeps its condensed questionnaire summary.
  let strip = scenario.customization ? renderCustomizationStrip(scenario) : renderAnswerSummary(scenario);
  if (strip) head.appendChild(strip);

  head.appendChild(buildThemeControl());
  return head;
}

// Render the customization strip for the custom scenario: a discover/catalog chip,
// a red gap badge for the capability the canonical catalog could not satisfy, a green
// recipe chip naming the hand-authored module tag, an organic-fit chip, and a
// preview badge with the proposed-patch change count. Carries the data-* hooks the
// smoke reads: data-customization-gap, data-organic-fit, data-patch-preview.
function renderCustomizationStrip(scenario) {
  let customization = scenario.customization || {};
  let gap = customization.gap || {};
  let recipe = customization.recipe || {};
  let organicFit = customization.organicFit || {};
  let preview = customization.patchPreview || {};
  let catalog = customization.catalogDigest || {};
  let capability = gap.capability || 'capability';
  let accepted = organicFit.accepted === true;
  let count = Number.isFinite(preview.count) ? preview.count : (preview.changes || []).length;

  let strip = document.createElement('div');
  strip.className = 'cb-customization';
  strip.dataset.customizationGap = capability;
  strip.dataset.organicFit = accepted ? 'accepted' : 'rejected';
  strip.dataset.patchPreview = String(count);

  let chip = (className, icon, text, title) => {
    let el = document.createElement('span');
    el.className = 'cb-cz-chip ' + className;
    el.innerHTML = '<span class="cb-icon" aria-hidden="true">' + icon + '</span>';
    let label = document.createElement('span');
    label.textContent = text;
    el.appendChild(label);
    if (title) el.title = title;
    return el;
  };

  let categories = Array.isArray(catalog.categories) ? catalog.categories.length : 0;
  strip.appendChild(chip('cb-cz-catalog', 'travel_explore',
    'Catalog: ' + categories + ' categories',
    (catalog.sampleTags || []).join(', ') || 'discovered component catalog'));
  strip.appendChild(chip('cb-cz-gap', 'block', 'Gap: ' + capability,
    'No canonical module covers "' + capability + '"'));
  strip.appendChild(chip('cb-cz-recipe', 'auto_awesome', 'Recipe: ' + (recipe.tagName || 'module'),
    (recipe.capabilities || []).join(', ') || 'hand-authored module descriptor'));
  strip.appendChild(chip('cb-cz-fit', accepted ? 'verified' : 'error',
    'Organic-fit: ' + (accepted ? 'accepted' : 'rejected') + ' (' + (organicFit.surface || 'modules') + ')',
    organicFit.summary || 'workspace-level design-policy validation'));
  strip.appendChild(chip('cb-cz-preview', 'difference', 'Proposed (preview): ' + count,
    'propose_workspace_patch preview, not applied'));

  return strip;
}

// Condense the answered questionnaire into one compact line for the header. Returns
// null when the scenario carries no questions, so the bar stays clean.
function renderAnswerSummary(scenario) {
  let questions = scenario.questions || [];
  if (!questions.length) return null;
  let answers = document.createElement('div');
  answers.className = 'cb-answers';
  let icon = document.createElement('span');
  icon.className = 'cb-answers-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'quiz';
  let line = document.createElement('span');
  line.className = 'cb-answers-text';
  let plainParts = [];
  questions.forEach((question, index) => {
    let chosen = Array.isArray(question.chosen)
      ? question.chosen
      : (question.chosen != null ? [question.chosen] : []);
    let labels = chosen.map((value) =>
      (question.options || []).find((option) => option.value === value)?.label || value);
    let chosenText = labels.join(', ') || 'defaults';
    if (index > 0) {
      let sep = document.createElement('span');
      sep.className = 'cb-answer-sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '·';
      line.appendChild(sep);
    }
    let q = document.createElement('span');
    q.className = 'cb-answer-q';
    q.textContent = (question.prompt || question.id) + ': ';
    let v = document.createElement('span');
    v.className = 'cb-answer-v';
    v.textContent = chosenText;
    line.append(q, v);
    plainParts.push((question.prompt || question.id) + ': ' + chosenText);
  });
  answers.title = 'Answered — ' + plainParts.join('  ·  ');
  answers.append(icon, line);
  return answers;
}

// A compact theme control: mode light/dark, accent hue, and the geometry register
// (tool/product) toggle. Each control calls setTheme, which re-applies the cascade
// theme to document.documentElement so the computed --sn-* tokens change live.
function buildThemeControl() {
  let theme = document.createElement('div');
  theme.className = 'cb-theme';

  let label = document.createElement('span');
  label.className = 'cb-theme-label';
  label.innerHTML = '<span class="cb-icon" aria-hidden="true">palette</span><span>Theme</span>';
  theme.appendChild(label);

  let modeGroup = document.createElement('div');
  modeGroup.className = 'cb-theme-group';
  let modes = document.createElement('div');
  modes.className = 'cb-theme-modes';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Theme mode');
  for (let mode of ['dark', 'light']) {
    let button = document.createElement('button');
    button.type = 'button';
    button.dataset.themeMode = mode;
    button.textContent = mode;
    button.addEventListener('click', () => setTheme({ mode }));
    modes.appendChild(button);
  }
  modeGroup.appendChild(modes);
  theme.appendChild(modeGroup);

  let hueGroup = document.createElement('div');
  hueGroup.className = 'cb-theme-group';
  let swatch = document.createElement('span');
  swatch.className = 'cb-theme-swatch';
  let hue = document.createElement('input');
  hue.type = 'range';
  hue.min = '0';
  hue.max = '360';
  hue.step = '1';
  hue.dataset.themeControl = 'hue';
  hue.setAttribute('aria-label', 'Accent hue');
  hue.addEventListener('input', () => setTheme({ hue: Number(hue.value) }));
  // Expose the current hue both to assistive tech (aria-valuetext) and visually,
  // via an adjacent live value that syncThemeControl keeps in step.
  let hueValue = document.createElement('span');
  hueValue.className = 'cb-theme-value';
  hueValue.dataset.themeValue = 'hue';
  hueValue.setAttribute('aria-hidden', 'true');
  hueGroup.append(swatch, hue, hueValue);
  theme.appendChild(hueGroup);

  if (REGISTERS.length >= 2) {
    let registers = document.createElement('div');
    registers.className = 'cb-theme-registers';
    registers.setAttribute('role', 'group');
    registers.setAttribute('aria-label', 'Geometry register');
    for (let register of REGISTERS) {
      let button = document.createElement('button');
      button.type = 'button';
      button.dataset.themeRegister = register;
      button.textContent = register;
      button.addEventListener('click', () => setTheme({ register }));
      registers.appendChild(button);
    }
    theme.appendChild(registers);
  }

  return theme;
}

// Reflect the live theme state into the header control widgets.
function syncThemeControl() {
  for (let button of stageEl.querySelectorAll('[data-theme-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.themeMode === themeState.mode));
  }
  for (let button of stageEl.querySelectorAll('[data-theme-register]')) {
    let active = (geometryRegister || 'product') === button.dataset.themeRegister;
    button.setAttribute('aria-pressed', String(active));
  }
  for (let input of stageEl.querySelectorAll('[data-theme-control="hue"]')) {
    input.value = String(themeState.hue);
    input.setAttribute('aria-valuetext', themeState.hue + ' degrees');
  }
  for (let value of stageEl.querySelectorAll('[data-theme-value="hue"]')) {
    value.textContent = themeState.hue + '°';
  }
}

async function renderScenario(scenario) {
  if (!stageEl) throw new Error('chat-builder: stage host (#' + STAGE_HOST_ID + ') is missing; cannot render a scenario');
  stageEl.classList.remove('cb-menu-mode');
  stageEl.replaceChildren();
  activeLayout = null;

  // Apply the scenario's questionnaire-derived theme on mount.
  let theme = themeOf(scenario);
  themeState = { ...CASCADE_THEME_DEFAULTS, mode: theme.mode, hue: theme.hue };
  geometryRegister = '';
  applyTheme();

  stageEl.appendChild(renderScenarioHead(scenario));
  syncThemeControl();

  let variant = variantById(scenario, activeVariantId) || variantsOf(scenario)[0];
  await mountVariant(scenario, variant);
  syncVariantButtons();

  document.body.dataset.activeScenario = scenario.key;
}

function syncVariantButtons() {
  syncRovingTabs(
    [...stageEl.querySelectorAll('.cb-variant')],
    (button) => button.dataset.variant === activeVariantId,
  );
}

// Re-mount a different variant of the active scenario in place, with no reload.
async function selectVariant(key, variantId) {
  let scenario = scenarioByKey(key);
  if (!scenario) return false;
  if (key !== activeKey) await show(key);
  let variant = variantById(scenario, variantId);
  await mountVariant(scenario, variant);
  syncVariantButtons();
  return true;
}

// The opening view: a full-screen chat with the class menu seeded into its transcript,
// so the demo literally starts with the conversation before any workspace is built.
function renderMenu() {
  stageEl.classList.add('cb-menu-mode');
  stageEl.replaceChildren();
  if (!customElements.get(CHAT_COMPONENT)) {
    defineModule(CHAT_COMPONENT, { includeInternal: true, includeExperimental: true });
    definedModuleTags.add(CHAT_COMPONENT);
  }
  let chat = document.createElement(CHAT_COMPONENT);
  chat.classList.add('chat-workspace-view');
  stageEl.appendChild(chat);
  requestAnimationFrame(() => {
    chat.setWorkspaceState?.({
      sidebar: 'hidden',
      chats: scenarios.map((entry) => ({ id: 'chat-' + entry.key, title: entry.label || entry.key, subtitle: entry.intent || '' })),
      activeChatId: scenarios[0] ? 'chat-' + scenarios[0].key : 'chat',
      messages: [
        { id: 'menu-user', role: 'user', text: 'What kind of workspace can you build for me?' },
        { id: 'menu-agent', role: 'agent', text: 'Pick a class and I will run its questionnaire, then assemble the workspace around this chat.' },
        {
          id: 'menu-board',
          role: 'board',
          cardItems: scenarios.map((entry) => ({
            id: entry.key,
            title: entry.label || entry.key,
            status: 'todo',
            icon: CLASS_ICONS[entry.key] || 'dashboard',
          })),
        },
      ],
      messagesOptions: { scrollToBottom: true },
      composer: { placeholder: 'Choose a class above, or describe your own...', value: '' },
      liveStatus: { phase: 'idle', title: 'Chat-first builder', text: 'Choose a workspace class' },
      backgroundState: 'idle',
    });
  });
  document.body.dataset.activeScenario = '';
  document.body.dataset.seeded = '';
  activeKey = null;
  activeVariantId = null;
  activeLayout = null;
  syncMenu();
}

function syncMenu() {
  let tabs = [...menuEl.querySelectorAll('.cb-class')];
  let hasActive = tabs.some((button) => button.dataset.key === activeKey);
  if (hasActive) {
    syncRovingTabs(tabs, (button) => button.dataset.key === activeKey);
  } else {
    // Menu mode: no class is chosen yet, so announce none as selected. Keep the
    // first tab tabbable so the tablist still has a single keyboard tab stop.
    tabs.forEach((button, index) => {
      button.setAttribute('aria-selected', 'false');
      button.tabIndex = index === 0 ? 0 : -1;
    });
  }
  backEl.hidden = activeKey == null;
}

function show(key) {
  let scenario = scenarioByKey(key);
  if (!scenario) return Promise.resolve(false);
  activeKey = key;
  // Start every scenario on its default (first) variant.
  activeVariantId = variantsOf(scenario)[0].id;
  let done = renderScenario(scenario).then(() => true);
  syncMenu();
  return done;
}

function buildMenu() {
  menuEl.replaceChildren();
  for (let scenario of scenarios) {
    let button = document.createElement('button');
    button.type = 'button';
    button.className = 'cb-class';
    button.dataset.key = scenario.key;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', STAGE_HOST_ID);
    button.innerHTML = '<span class="cb-icon" aria-hidden="true">' + (CLASS_ICONS[scenario.key] || 'dashboard') + '</span>' +
      '<span>' + (scenario.label || scenario.key) + '</span>';
    button.addEventListener('click', () => show(scenario.key));
    menuEl.appendChild(button);
  }
  enableTablistKeys(menuEl, '.cb-class', (button) => show(button.dataset.key));
}

buildMenu();
backEl.addEventListener('click', () => renderMenu());
renderMenu();

// Expose for headless smoke assertions.
window.__chatBuilder = {
  scenarios,
  keys: scenarios.map((scenario) => scenario.key),
  show,
  selectVariant,
  relaunchFromExport,
  setTheme,
  getThemeState,
  getThemeToken,
  variants: (key) => variantsOf(scenarioByKey(key) || {}).map((variant) => ({
    id: variant.id,
    label: variant.label,
    panels: panelComponentsOf(variant.config),
  })),
  menu: renderMenu,
  chatComponent: CHAT_COMPONENT,
  chatPanel: CHAT_PANEL,
  unseededComponents,
  // Render alias for free-created custom modules (recipe tag -> sn-data-table stand-in),
  // so smoke can resolve an exported recipe tag to the element that actually paints.
  resolveModuleTag,
};
`;
}

/**
 * Build the chat-first multi-scenario workspace bundle and write it to disk.
 *
 * @param {{outputDir?: string, port?: number, scenarios?: Array<Object>}} [options]
 *   When `scenarios` is omitted it defaults to `buildChatFirstWorkspace()`. Pass an
 *   injected contract-shaped scenarios array to self-test against a fixture.
 * @returns {Promise<{name: string, url: string, outputDir: string, scenarioCount: number, keys: string[]}>}
 */
export async function writeChatBuilderDemo(options = {}) {
  let outputDir = resolve(options.outputDir || join(process.cwd(), 'tmp', 'chat-builder-demo'));
  let port = Number(options.port || 4568);
  let name = 'Chat-First Workspace Builder';

  let built = options.scenarios
    ? { scenarios: options.scenarios, chatComponent: CHAT_COMPONENT }
    : await buildChatFirstWorkspace();
  let scenarios = built.scenarios || [];
  let chatComponent = built.chatComponent || CHAT_COMPONENT;

  await mkdir(outputDir, { recursive: true });
  let indexHtml = await injectSsrShell(generateIndexHtml(name, demoImportMap()));
  await writeFile(join(outputDir, 'index.html'), indexHtml);
  await writeFile(join(outputDir, 'app.js'), generateAppJs(scenarios, chatComponent));
  await writeFile(join(outputDir, 'scenarios.json'), JSON.stringify(scenarios, null, 2));

  return {
    name,
    url: `http://localhost:${port}/`,
    outputDir,
    scenarioCount: scenarios.length,
    keys: scenarios.map((scenario) => scenario.key),
  };
}
