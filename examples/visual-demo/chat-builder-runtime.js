/**
 * Chat-first demo runtime.
 *
 * Writes a self-contained browser bundle that replays the chat-builder step log
 * (built by `chat-builder-state.js` through real dispatch tools) and mounts each
 * intermediate workspace via the public `symbiote-workspace/browser` entry, so a
 * viewer watches the layout assemble around the pinned chat one real tool call at
 * a time — no page reload.
 *
 * @module examples/visual-demo/chat-builder-runtime
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { demoImportMap } from './server-utils.js';
import { buildChatFirstWorkspace, CHAT_PANEL } from './chat-builder-state.js';

function escapeScriptJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
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
    body { margin: 0; font-family: var(--sn-font-family, system-ui, sans-serif);
      background: var(--sn-color-bg, #0e1116); color: var(--sn-color-fg, #e6edf3); }
    .cb-shell { display: flex; flex-direction: column; height: 100vh; }
    .cb-bar { display: flex; align-items: center; gap: 12px; padding: 10px 16px;
      border-block-end: 1px solid var(--sn-color-border, #30363d); }
    .cb-bar h1 { font-size: 14px; font-weight: 600; margin: 0; }
    .cb-step { font-size: 13px; opacity: .85; flex: 1; }
    .cb-step b { font-variant-numeric: tabular-nums; opacity: .6; margin-inline-end: 8px; }
    .cb-bar button { font: inherit; padding: 4px 12px; border-radius: 6px; cursor: pointer;
      border: 1px solid var(--sn-color-border, #30363d); background: var(--sn-color-surface, #161b22);
      color: inherit; }
    .cb-tool { font-family: ui-monospace, monospace; font-size: 12px; opacity: .7; }
    #workspace { flex: 1; min-height: 0; padding: 12px; }
    #workspace .cb-symbiote-layout {
      display: block; width: 100%; height: 100%; min-width: 0; min-height: 0;
      --sn-layout-border: color-mix(in srgb, var(--sn-text, CanvasText) 14%, transparent);
      --sn-layout-gap-bg: color-mix(in srgb, var(--sn-bg) 86%, var(--sn-node-selected) 14%);
      --sn-layout-header-block-size: 32px;
    }
    #workspace .cb-symbiote-layout .layout-root,
    #workspace .cb-symbiote-layout .panel-view,
    #workspace .cb-symbiote-layout .panel-content { min-width: 0; min-height: 0; }
    #workspace .cb-symbiote-layout .panel-view { height: 100%; overflow: hidden; }
    chat-workspace.chat-workspace-view {
      display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; height: 100%;
    }
  </style>
</head>
<body>
  <div class="cb-shell">
    <div class="cb-bar">
      <h1>${title}</h1>
      <div class="cb-step"><b id="cb-count"></b><span id="cb-title"></span>
        <span class="cb-tool" id="cb-tool"></span></div>
      <button id="cb-prev" type="button">Prev</button>
      <button id="cb-play" type="button">Play</button>
      <button id="cb-next" type="button">Next</button>
    </div>
    <div id="workspace"></div>
  </div>
  <script type="module" src="./app.js"><\/script>
</body>
</html>`;
}

function generateAppJs(stages) {
  return `import { mountWorkspace } from 'symbiote-workspace/browser';
import { applyCascadeTheme, CASCADE_THEME_DEFAULTS, defineModule } from 'symbiote-ui/ui';
import 'symbiote-ui/board';

const stages = ${escapeScriptJson(stages)};
const CHAT_PANEL = ${JSON.stringify(CHAT_PANEL)};
const themeAdapter = { applyCascadeTheme };
const definedModuleTags = new Set();

applyCascadeTheme(document.documentElement, CASCADE_THEME_DEFAULTS, { notify: false, source: 'chat-builder' });

let workspace = document.getElementById('workspace');
let countEl = document.getElementById('cb-count');
let titleEl = document.getElementById('cb-title');
let toolEl = document.getElementById('cb-tool');
let index = 0;
let timer = null;

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

function defineWorkspaceModules(config) {
  let tags = Object.values(config.panelTypes || {}).map((panel) => panel?.component).filter(Boolean);
  for (let tag of tags) {
    if (customElements.get(tag)) { definedModuleTags.add(tag); continue; }
    if (definedModuleTags.has(tag)) continue;
    defineModule(tag, { includeInternal: true, includeExperimental: true });
    definedModuleTags.add(tag);
  }
}

function findPanelElement(root, selector) {
  if (root?.matches?.(selector)) return root;
  return root?.querySelector?.(selector) || null;
}

// A short mock agent transcript narrating the chat-first construction, mirroring
// the professionalChatState shape used by the realtime-builder demo.
function chatWorkspaceState(stage) {
  return {
    sidebar: 'hidden',
    chats: [
      { id: 'chat-builder', title: 'Chat-First Console', subtitle: 'Constructing workspace config' },
      { id: 'chat-builder-history', title: 'Earlier session', subtitle: 'Video studio layout' },
    ],
    activeChatId: 'chat-builder',
    messages: [
      {
        id: 'cb-user-0',
        role: 'user',
        text: 'Build a chat-first console with preview, inspector, graph and logs around the conversation.',
      },
      {
        id: 'cb-agent-0',
        role: 'agent',
        text: 'Pinning the chat as the persistent center, then splitting the supporting panels in around it with real construction tools.',
      },
      {
        id: 'cb-thinking-0',
        role: 'thinking',
        elapsedText: '00:03',
        status: 'planning layout',
        text: 'Resolve panel regions, event bridges, and pin behavior for the chat center.',
      },
      {
        id: 'cb-tool-0',
        role: 'tool',
        name: 'add_panel',
        input: { existingPanelType: 'chat', newPanelType: 'preview', direction: 'horizontal', ratio: 0.58 },
        result: { status: 'ok', panels: ['chat', 'preview'], reload: false },
        isLatestTool: true,
      },
      {
        id: 'cb-board-0',
        role: 'board',
        cardItems: [
          { id: 'pin', title: 'Chat pinned as center', status: 'done', icon: 'push_pin' },
          { id: 'split', title: 'Preview / graph / logs split in', status: 'running', icon: 'splitscreen' },
          { id: 'bridge', title: 'Event bridges wired', status: 'done', icon: 'cable' },
        ],
      },
      {
        id: 'cb-agent-1',
        role: 'agent',
        text: 'Validated the config and exported a portable workspace — no page reload.',
        isStreaming: true,
      },
    ],
    messagesOptions: { scrollToBottom: true },
    composer: {
      placeholder: 'Describe the next panel, split, bridge, or behavior...',
      value: '',
      attachedContext: [
        { id: 'stage', label: stage.title },
        { id: 'tool', label: stage.tool + '()' },
      ],
      footerControls: [
        { id: 'panels', kind: 'button', icon: 'view_quilt', label: 'Panels', value: String(stage.digest.panels.length) },
        { id: 'bridges', kind: 'button', icon: 'cable', label: 'Bridges', value: String(stage.digest.bridges) },
      ],
    },
    liveStatus: { phase: 'running', title: 'Chat-first builder', text: stage.title },
    backgroundState: 'activity',
  };
}

const PREVIEW_SNIPPET = [
  "// Chat-first construction, one real dispatch tool at a time.",
  "dispatch('register_panel_type', { name: 'chat', component: 'chat-workspace' });",
  "dispatch('set_layout', { layoutTree: { type: 'panel', panelType: 'chat' } });",
  "dispatch('set_behavior', { target: 'chat', behavior: { collapse: 'never' } });",
  "dispatch('add_panel', { existingPanelType: 'chat', newPanelType: 'preview', ratio: 0.58 });",
  "dispatch('bridge_event', { sourcePanel: 'chat', event: 'intent', targetPanel: 'preview' });",
].join('\\n');

const GRAPH_MODEL = {
  nodes: [
    { id: 'chat', label: 'chat', type: 'source', status: 'running' },
    { id: 'preview', label: 'preview', type: 'view', status: 'ready' },
    { id: 'graph', label: 'graph', type: 'view', status: 'ready' },
    { id: 'inspector', label: 'inspector', type: 'sidecar', status: 'ready' },
    { id: 'logs', label: 'logs', type: 'stream', status: 'ready' },
  ],
  connections: [
    { id: 'c-chat-preview', source: 'chat', target: 'preview' },
    { id: 'c-chat-graph', source: 'chat', target: 'graph' },
    { id: 'c-graph-inspector', source: 'graph', target: 'inspector' },
    { id: 'c-chat-logs', source: 'chat', target: 'logs' },
  ],
};

const LOG_EVENTS = [
  { id: 'log-pin', title: 'Chat pinned as persistent center', time: '00:01', variant: 'positive' },
  { id: 'log-preview', title: 'Preview panel added to the right', time: '00:02', variant: 'info' },
  { id: 'log-graph', title: 'Graph docked under the chat', time: '00:03', variant: 'info' },
  { id: 'log-bridge', title: 'Chat intent bridged to preview', time: '00:04', variant: 'neutral' },
  { id: 'log-validate', title: 'Config validated (strict)', time: '00:05', variant: 'positive' },
  { id: 'log-export', title: 'Portable workspace exported', time: '00:06', variant: 'positive' },
];

function seedPanel(root, panelType, component, stage) {
  if (component === 'chat-workspace') {
    let chat = findPanelElement(root, 'chat-workspace');
    chat?.classList?.add('chat-workspace-view');
    chat?.setWorkspaceState?.(chatWorkspaceState(stage));
  }
  if (component === 'code-block') {
    findPanelElement(root, 'code-block')?.setContent?.(PREVIEW_SNIPPET, 'javascript');
  }
  if (component === 'inspector-panel') {
    findPanelElement(root, 'inspector-panel')?.inspect?.({
      label: 'chat',
      inputs: { intent: { label: 'intent', socket: { name: 'event' } } },
      outputs: { render: { label: 'render', socket: { name: 'method' } } },
      controls: { pinned: { label: 'Pinned', value: 'never collapse', type: 'text' } },
    });
  }
  if (component === 'canvas-graph') {
    findPanelElement(root, 'canvas-graph')?.setGraphModel?.(GRAPH_MODEL);
  }
  if (component === 'sn-event-feed') {
    let feed = findPanelElement(root, 'sn-event-feed');
    feed?.setAttribute?.('title', 'Construction Log');
    feed?.setEvents?.(LOG_EVENTS);
  }
}

function render() {
  let stage = stages[index];
  workspace.replaceChildren();
  defineWorkspaceModules(stage.config);
  let layout = document.createElement('panel-layout');
  layout.className = 'cb-symbiote-layout';
  layout.setAttribute('responsive-mode', stage.config.rootBehavior?.responsiveMode || 'drawer');
  layout.setAttribute('responsive-breakpoint', String(stage.config.rootBehavior?.responsiveBreakpoint || 860));
  layout.setAttribute('swipe-control', stage.config.rootBehavior?.swipeControl || 'edge');
  workspace.appendChild(layout);
  requestAnimationFrame(() => {
    layout.$.panelTypes = stage.config.panelTypes || {};
    layout.$.layoutTree = normalizeLayoutNode(stage.config.layout);
    requestAnimationFrame(() => {
      for (let [panelType, panel] of Object.entries(stage.config.panelTypes || {})) {
        if (!panel.component) continue;
        for (let element of layout.querySelectorAll(panel.component)) {
          seedPanel(element, panelType, panel.component, stage);
        }
      }
    });
  });
  countEl.textContent = (index + 1) + ' / ' + stages.length;
  titleEl.textContent = stage.title;
  toolEl.textContent = stage.tool + '()';
  document.body.dataset.stageIndex = String(index);
  document.body.dataset.stagePanels = stage.digest.panels.join(',');
  document.body.dataset.pinnedChat = String(stage.digest.pinnedChat);
}

function go(next) {
  index = (next + stages.length) % stages.length;
  render();
}

function stop() { if (timer) { clearInterval(timer); timer = null; document.getElementById('cb-play').textContent = 'Play'; } }
function play() {
  if (timer) return stop();
  document.getElementById('cb-play').textContent = 'Pause';
  timer = setInterval(() => {
    if (index >= stages.length - 1) return stop();
    go(index + 1);
  }, 1100);
}

document.getElementById('cb-prev').addEventListener('click', () => { stop(); go(index - 1); });
document.getElementById('cb-next').addEventListener('click', () => { stop(); go(index + 1); });
document.getElementById('cb-play').addEventListener('click', play);

render();
// Expose for headless smoke assertions.
window.__chatBuilder = { stages, go, stageCount: stages.length, chatPanel: CHAT_PANEL };
`;
}

/**
 * Build the chat-first workspace via real tools and write its browser bundle.
 * @param {{outputDir?: string, port?: number}} [options]
 * @returns {Promise<{name: string, url: string, outputDir: string, stageCount: number, stepCount: number, panels: string[]}>}
 */
export async function writeChatBuilderDemo(options = {}) {
  let outputDir = resolve(options.outputDir || join(process.cwd(), 'tmp', 'chat-builder-demo'));
  let port = Number(options.port || 4568);
  let name = 'Chat-First Tool-Driven Construction';

  let built = await buildChatFirstWorkspace();

  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'index.html'), generateIndexHtml(name, demoImportMap()));
  await writeFile(join(outputDir, 'app.js'), generateAppJs(built.stages));
  await writeFile(join(outputDir, 'workspace.config.json'), built.exportJson);
  await writeFile(join(outputDir, 'steps.json'), JSON.stringify(built.steps, null, 2));

  return {
    name,
    url: `http://localhost:${port}/`,
    outputDir,
    stageCount: built.stages.length,
    stepCount: built.steps.length,
    panels: built.stages.at(-1).digest.panels,
  };
}
