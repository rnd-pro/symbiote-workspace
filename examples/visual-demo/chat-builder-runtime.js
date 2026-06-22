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
    #workspace .symbiote-workspace { height: 100%; }
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
import { applyCascadeTheme, CASCADE_THEME_DEFAULTS } from 'symbiote-ui/ui';

const stages = ${escapeScriptJson(stages)};
const CHAT_PANEL = ${JSON.stringify(CHAT_PANEL)};
const themeAdapter = { applyCascadeTheme };

applyCascadeTheme(document.documentElement, CASCADE_THEME_DEFAULTS, { notify: false, source: 'chat-builder' });

let workspace = document.getElementById('workspace');
let countEl = document.getElementById('cb-count');
let titleEl = document.getElementById('cb-title');
let toolEl = document.getElementById('cb-tool');
let index = 0;
let timer = null;

function render() {
  let stage = stages[index];
  workspace.replaceChildren();
  mountWorkspace(stage.config, workspace, { renderDefaultPreview: true, themeAdapter });
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
