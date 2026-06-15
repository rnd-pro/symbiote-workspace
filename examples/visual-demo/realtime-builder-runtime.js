import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { exportConfig } from '../../sharing/index.js';
import { BROWSER_THEME_IMPORT } from '../../sharing/browser-contract.js';
import { buildRealtimeChatStateDemo } from './realtime-builder-state.js';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeScriptJson(value) {
  return JSON.stringify(value, null, 2).replaceAll('</script', '<\\/script');
}

function generateIndexHtml(title, imports) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" />
  <script type="importmap">
${escapeScriptJson({ imports })}
  <\/script>
</head>
<body>
  <script type="module" src="./app.js"><\/script>
</body>
</html>`;
}

function generateAppJs(demo) {
  return `import { mountWorkspace, validateWorkspaceConfig } from 'symbiote-workspace/browser';
import { applyCascadeTheme } from '${BROWSER_THEME_IMPORT}';

let demo = ${escapeScriptJson(demo)};
let stageIndex = 0;
let mounted = null;
let playTimer = null;

let styles = new CSSStyleSheet();
styles.replaceSync(\`
  :root {
    color-scheme: light;
    --demo-border: color-mix(in srgb, CanvasText 16%, transparent);
    --demo-muted: color-mix(in srgb, CanvasText 58%, transparent);
    --demo-soft: color-mix(in srgb, Canvas 92%, CanvasText 8%);
    --demo-accent: #2764d8;
    --demo-pass: #147a43;
    --demo-warn: #9a5b00;
  }
  html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: Canvas;
    color: CanvasText;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  button {
    font: inherit;
  }
  .demo-shell {
    display: grid;
    grid-template-columns: minmax(20rem, 25rem) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    width: 100vw;
    height: 100vh;
    min-width: 0;
    min-height: 0;
  }
  .demo-toolbar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--demo-border);
    background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  }
  .demo-title {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
    margin-right: auto;
  }
  .demo-title strong {
    font-size: 0.95rem;
    line-height: 1.25;
  }
  .demo-title span {
    color: var(--demo-muted);
    font-size: 0.78rem;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .demo-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    min-height: 2.25rem;
    padding: 0 0.875rem;
    border: 1px solid color-mix(in srgb, var(--demo-accent) 70%, CanvasText 20%);
    border-radius: 7px;
    background: var(--demo-accent);
    color: white;
    cursor: pointer;
  }
  .demo-icon {
    font-family: "Material Symbols Outlined";
    font-size: 1.2rem;
    line-height: 1;
    font-weight: normal;
  }
  .demo-stage-rail {
    display: flex;
    gap: 0.375rem;
    min-width: 0;
    overflow-x: auto;
  }
  .demo-stage-chip {
    flex: 0 0 auto;
    min-height: 2rem;
    padding: 0 0.625rem;
    border: 1px solid var(--demo-border);
    border-radius: 999px;
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .demo-stage-chip[aria-current="step"] {
    border-color: var(--demo-accent);
    color: var(--demo-accent);
  }
  .demo-chat {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 1rem;
    border-right: 1px solid var(--demo-border);
    background: color-mix(in srgb, Canvas 98%, CanvasText 2%);
  }
  .demo-chat h1,
  .demo-inspector h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    line-height: 1.25;
  }
  .demo-message {
    display: grid;
    gap: 0.25rem;
    margin: 0 0 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--demo-border);
    border-radius: 8px;
    background: Canvas;
  }
  .demo-message span {
    color: var(--demo-muted);
    font-size: 0.72rem;
    text-transform: uppercase;
  }
  .demo-message p {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.35;
  }
  .demo-questions {
    display: grid;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  .demo-question {
    display: grid;
    gap: 0.25rem;
    padding: 0.625rem;
    border: 1px solid var(--demo-border);
    border-radius: 8px;
    background: Canvas;
  }
  .demo-question[data-active="true"] {
    border-color: var(--demo-accent);
  }
  .demo-question strong {
    font-size: 0.82rem;
    line-height: 1.25;
  }
  .demo-question span {
    color: var(--demo-muted);
    font-size: 0.74rem;
  }
  .demo-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(18rem, 23rem);
    gap: 0;
    min-width: 0;
    min-height: 0;
  }
  .demo-workspace {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .demo-inspector {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 1rem;
    border-left: 1px solid var(--demo-border);
    background: var(--demo-soft);
  }
  .demo-metric-grid,
  .demo-report-list,
  .demo-contract-section {
    display: grid;
    gap: 0.5rem;
  }
  .demo-metric {
    display: grid;
    gap: 0.25rem;
    padding: 0.625rem;
    border: 1px solid var(--demo-border);
    border-radius: 8px;
    background: Canvas;
  }
  .demo-metric span {
    color: var(--demo-muted);
    font-size: 0.72rem;
    text-transform: uppercase;
  }
  .demo-metric strong {
    font-size: 0.88rem;
    line-height: 1.25;
  }
  .demo-report {
    padding: 0.625rem;
    border: 1px solid var(--demo-border);
    border-left: 4px solid var(--demo-pass);
    border-radius: 8px;
    background: Canvas;
    font-size: 0.82rem;
    line-height: 1.3;
  }
  .demo-report[data-status="warn"] {
    border-left-color: var(--demo-warn);
  }
  .demo-contract-section {
    margin-top: 1rem;
  }
  .demo-contract-section h3 {
    margin: 0.25rem 0;
    font-size: 0.82rem;
    line-height: 1.25;
  }
  .demo-contract-list {
    display: grid;
    gap: 0.375rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .demo-contract-list li {
    padding: 0.5rem;
    border: 1px solid var(--demo-border);
    border-radius: 7px;
    background: Canvas;
    color: CanvasText;
    font-size: 0.78rem;
    line-height: 1.3;
  }
  .demo-contract-list strong {
    display: block;
    font-size: 0.75rem;
    line-height: 1.25;
  }
  .demo-contract-list span {
    color: var(--demo-muted);
  }
  .symbiote-workspace__panel {
    transition: border-color 180ms ease, transform 180ms ease;
  }
  @media (max-width: 980px) {
    .demo-shell {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(13rem, 0.42fr) minmax(0, 1fr);
    }
    .demo-chat {
      border-right: 0;
      border-bottom: 1px solid var(--demo-border);
    }
    .demo-main {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(22rem, 1fr) auto;
    }
    .demo-inspector {
      border-left: 0;
      border-top: 1px solid var(--demo-border);
      max-height: 18rem;
    }
  }
  @media (max-width: 680px) {
    .demo-toolbar {
      align-items: stretch;
      flex-wrap: wrap;
    }
    .demo-title {
      flex: 1 1 100%;
    }
    .demo-action {
      flex: 0 0 auto;
    }
    .demo-stage-rail {
      flex: 1 1 100%;
    }
  }
\`);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, styles];

let shell = document.createElement('main');
shell.className = 'demo-shell';
shell.innerHTML = \`
  <header class="demo-toolbar">
    <div class="demo-title">
      <strong></strong>
      <span></span>
    </div>
    <button class="demo-action" type="button" data-action="play">
      <span class="demo-icon" aria-hidden="true">play_arrow</span>
      <span>Play</span>
    </button>
    <div class="demo-stage-rail" role="tablist" aria-label="Demo stages"></div>
  </header>
  <aside class="demo-chat" aria-label="Chat and questionnaire"></aside>
  <section class="demo-main">
    <div class="demo-workspace" aria-label="Generated workspace"></div>
    <aside class="demo-inspector" aria-label="Workspace metadata"></aside>
  </section>
\`;
document.body.appendChild(shell);

let title = shell.querySelector('.demo-title strong');
let subtitle = shell.querySelector('.demo-title span');
let playButton = shell.querySelector('[data-action="play"]');
let stageRail = shell.querySelector('.demo-stage-rail');
let chat = shell.querySelector('.demo-chat');
let workspace = shell.querySelector('.demo-workspace');
let inspector = shell.querySelector('.demo-inspector');

function plural(value, label) {
  return \`\${value} \${label}\`;
}

function appendContractSection(parent, title, rows) {
  let section = document.createElement('section');
  section.className = 'demo-contract-section';
  let heading = document.createElement('h3');
  heading.textContent = title;
  section.appendChild(heading);
  let list = document.createElement('ul');
  list.className = 'demo-contract-list';
  for (let row of rows.filter(Boolean)) {
    let item = document.createElement('li');
    if (typeof row === 'string') {
      item.textContent = row;
    } else {
      item.innerHTML = \`<strong>\${row.label}</strong><span>\${row.value}</span>\`;
    }
    list.appendChild(item);
  }
  section.appendChild(list);
  parent.appendChild(section);
}

function renderStageRail() {
  stageRail.textContent = '';
  demo.stages.forEach((stage, index) => {
    let button = document.createElement('button');
    button.className = 'demo-stage-chip';
    button.type = 'button';
    button.textContent = \`\${stage.clock} \${stage.title}\`;
    button.setAttribute('role', 'tab');
    if (index === stageIndex) button.setAttribute('aria-current', 'step');
    button.addEventListener('click', () => {
      stopPlayback();
      renderStage(index);
    });
    stageRail.appendChild(button);
  });
}

function renderChat(stage) {
  let questions = stage.config.construction?.questions || [];
  chat.textContent = '';
  let heading = document.createElement('h1');
  heading.textContent = 'Chat-state questionnaire';
  chat.appendChild(heading);

  for (let turn of stage.chat) {
    let message = document.createElement('article');
    message.className = 'demo-message';
    message.innerHTML = \`<span>\${turn.role}</span><p>\${turn.text}</p>\`;
    chat.appendChild(message);
  }

  let list = document.createElement('div');
  list.className = 'demo-questions';
  for (let item of questions) {
    let question = document.createElement('section');
    question.className = 'demo-question';
    question.dataset.active = String(item.id === stage.activeQuestionId);
    let value = Array.isArray(item.answer) ? item.answer.join(', ') : item.answer ?? item.status;
    question.innerHTML = \`<strong>\${item.title}</strong><span>\${item.status}: \${value}</span>\`;
    list.appendChild(question);
  }
  chat.appendChild(list);
}

function renderInspector(stage) {
  let config = stage.config;
  let chatState = stage.chatState || {};
  let validation = validateWorkspaceConfig(config, { strict: true });
  let bindings = config.data?.bindings || [];
  let events = config.events || [];
  let reports = config.validation?.reports || [];
  let panels = Object.keys(config.panelTypes || {});
  let roleEntries = Object.entries(chatState.layoutRoles || {});
  let registry = chatState.widgetRegistry || [];
  let adaptive = chatState.adaptiveBehavior || {};
  let theme = chatState.themeCascade || {};
  inspector.textContent = '';

  let heading = document.createElement('h2');
  heading.textContent = 'Builder contract';
  inspector.appendChild(heading);

  let metrics = document.createElement('div');
  metrics.className = 'demo-metric-grid';
  let metricValues = [
    ['Stage', stage.title],
    ['Panels', plural(panels.length, 'registered')],
    ['Bindings', plural(bindings.length, 'wired')],
    ['Events', plural(events.length, 'bridged')],
    ['Adaptive mode', config.rootBehavior?.responsiveMode || 'preserve'],
    ['Chat state', chatState.questionnaireStatus || 'pending'],
    ['Theme editor', panels.includes('theme-editor') ? 'required widget present' : 'missing'],
    ['Validation', validation.valid ? 'strict config pass' : 'strict config fail'],
  ];
  for (let [label, value] of metricValues) {
    let card = document.createElement('div');
    card.className = 'demo-metric';
    card.innerHTML = \`<span>\${label}</span><strong>\${value}</strong>\`;
    metrics.appendChild(card);
  }
  inspector.appendChild(metrics);

  appendContractSection(inspector, 'Service blueprint', [
    { label: 'Intent', value: chatState.activeIntent || 'pending' },
    { label: 'Entities', value: (chatState.serviceBlueprint?.entities || []).join(', ') || 'pending' },
    { label: 'Workflows', value: (chatState.serviceBlueprint?.workflows || []).join(' -> ') || 'pending' },
    { label: 'Next patch', value: chatState.nextPatch || 'none' },
  ]);

  appendContractSection(
    inspector,
    'Layout roles',
    roleEntries.map(([panel, role]) => ({ label: panel, value: role }))
  );

  appendContractSection(
    inspector,
    'Widget registry',
    registry.map((widget) => ({
      label: widget.id,
      value: \`\${widget.status} / \${widget.role}\`,
    }))
  );

  appendContractSection(inspector, 'Adaptive and theme state', [
    { label: 'Collapse order', value: (adaptive.collapseOrder || []).join(' -> ') || 'none' },
    { label: 'Pinned', value: (adaptive.pinned || []).join(', ') || 'none' },
    { label: 'Theme source', value: theme.source || 'pending' },
    { label: 'Theme editor', value: \`\${theme.editorWidget || 'missing'} / \${theme.status || 'pending'}\` },
  ]);

  let reportsList = document.createElement('div');
  reportsList.className = 'demo-report-list';
  reportsList.style.marginTop = '1rem';
  for (let item of reports) {
    let report = document.createElement('div');
    report.className = 'demo-report';
    report.dataset.status = item.status;
    report.textContent = \`\${item.check}: \${item.message}\`;
    reportsList.appendChild(report);
  }
  inspector.appendChild(reportsList);
}

function renderWorkspace(stage) {
  if (mounted) {
    mounted.destroy();
    mounted = null;
  }
  workspace.textContent = '';
  mounted = mountWorkspace(stage.config, workspace, {
    themeAdapter: { applyCascadeTheme },
    strictComponents: false,
  });
}

function renderStage(index) {
  stageIndex = index;
  let stage = demo.stages[stageIndex];
  title.textContent = demo.name;
  subtitle.textContent = \`\${stage.clock} - \${stage.title}\`;
  renderStageRail();
  renderChat(stage);
  renderWorkspace(stage);
  renderInspector(stage);
}

function stopPlayback() {
  if (!playTimer) return;
  clearInterval(playTimer);
  playTimer = null;
  playButton.querySelector('.demo-icon').textContent = 'play_arrow';
  playButton.querySelector('span:last-child').textContent = 'Play';
}

function startPlayback() {
  stopPlayback();
  playButton.querySelector('.demo-icon').textContent = 'pause';
  playButton.querySelector('span:last-child').textContent = 'Playing';
  renderStage(0);
  playTimer = setInterval(() => {
    if (stageIndex >= demo.stages.length - 1) {
      stopPlayback();
      return;
    }
    renderStage(stageIndex + 1);
  }, 1100);
}

playButton.addEventListener('click', () => {
  if (playTimer) {
    stopPlayback();
  } else {
    startPlayback();
  }
});

renderStage(0);
`;
}

export async function writeRealtimeChatStateDemo(options = {}) {
  let outputDir = resolve(options.outputDir || join(process.cwd(), 'tmp', 'realtime-builder-demo'));
  let port = Number(options.port || 4567);
  let imports = {
    'symbiote-workspace/browser': '/__workspace__/browser.js',
    [BROWSER_THEME_IMPORT]: '/__symbiote_ui__/themes/Theme.js',
  };
  let demo = buildRealtimeChatStateDemo();
  let finalStage = demo.stages.at(-1);
  let finalExport = exportConfig(finalStage.config, { strict: true });

  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'index.html'), generateIndexHtml(demo.name, imports));
  await writeFile(join(outputDir, 'app.js'), generateAppJs(demo));
  await writeFile(join(outputDir, 'mock-states.json'), JSON.stringify(demo, null, 2));
  await writeFile(join(outputDir, 'workspace.config.json'), finalExport.json);
  await writeFile(join(outputDir, 'demo.contract.json'), JSON.stringify({
    schemaVersion: demo.schemaVersion,
    name: demo.name,
    acceptanceMatrix: demo.acceptanceMatrix,
    playStages: demo.stages.map((stage) => stage.id),
    requiredWidgets: demo.requiredWidgets,
    chatStateTimeline: demo.stages.map((stage) => ({
      stage: stage.id,
      activeQuestionId: stage.chatState.activeQuestionId,
      questionnaireStatus: stage.chatState.questionnaireStatus,
      requiredElements: stage.chatState.requiredElements,
      nextPatch: stage.chatState.nextPatch,
    })),
    imports,
  }, null, 2));

  return {
    status: 'ok',
    url: `http://localhost:${port}/`,
    outputDir,
    stages: demo.stages.length,
    requiredWidgets: demo.requiredWidgets.length,
  };
}
