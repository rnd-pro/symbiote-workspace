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

function progressPercent(index, total) {
  return Math.round(((index + 1) / total) * 100);
}

function buildStreamOperations(stage) {
  let chatState = stage.chatState || {};
  let required = chatState.requiredElements || [];
  let roles = Object.keys(chatState.layoutRoles || {});
  let adaptive = chatState.adaptiveBehavior?.collapseOrder || [];
  let latestDecision = chatState.decisionTrace?.at(-1);
  return [
    {
      label: 'Read chat state',
      value: chatState.questionnaireStatus || stage.activeQuestionId,
      status: 'done',
    },
    {
      label: 'Apply workspace patch',
      value: latestDecision
        ? `${latestDecision.questionId}: ${latestDecision.operations.join(' -> ')}`
        : chatState.nextPatch || 'Waiting for next questionnaire answer.',
      status: 'active',
    },
    {
      label: 'Resolve required UI',
      value: required.length ? required.join(', ') : 'Intent panels only',
      status: required.length >= 4 ? 'done' : 'active',
    },
    {
      label: 'Rank layout behavior',
      value: roles.length
        ? `${roles.length} roles, collapse: ${adaptive.join(' -> ') || 'pending'}`
        : 'Waiting for layout roles',
      status: adaptive.length >= 3 ? 'done' : 'active',
    },
  ];
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
import { applyCascadeTheme, CASCADE_THEME_DEFAULTS } from '${BROWSER_THEME_IMPORT}';

let demo = ${escapeScriptJson(demo)};
let stageIndex = 0;
let operationIndex = 0;
let viewportMode = 'wide';
let mounted = null;
let playTimer = null;
let demoModulesDefined = false;
let layoutInstanceSeq = 0;

applyCascadeTheme(document.documentElement, CASCADE_THEME_DEFAULTS, {
  notify: false,
  source: 'realtime-builder-default',
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function normalizeLayoutNode(node, path = 'root') {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'panel') {
    return {
      ...node,
      id: node.id || \`\${path}-\${node.panelType || 'panel'}\`,
    };
  }
  if (node.type === 'split') {
    return {
      ...node,
      id: node.id || \`\${path}-split\`,
      first: normalizeLayoutNode(node.first, \`\${path}-a\`),
      second: normalizeLayoutNode(node.second, \`\${path}-b\`),
    };
  }
  return node;
}

function moduleField(label, value) {
  let display = Array.isArray(value) ? value.join(', ') : value;
  return \`<sn-description-item label="\${escapeHtml(label)}">\${escapeHtml(display || 'pending')}</sn-description-item>\`;
}

function card(title, body, options = {}) {
  let icon = options.icon || 'widgets';
  let status = options.status ? \`<sn-badge>\${escapeHtml(options.status)}</sn-badge>\` : '';
  return \`
    <sn-card class="demo-library-card">
      <div class="demo-card-title">
        <span class="material-symbols-outlined">\${escapeHtml(icon)}</span>
        <strong>\${escapeHtml(title)}</strong>
        \${status}
      </div>
      \${body}
    </sn-card>
  \`;
}

function chatMessageItems(stage) {
  return (stage.chat || []).map((turn, index) => ({
    id: \`demo-\${stage.id}-\${index}\`,
    role: turn.role === 'assistant' || turn.speaker === 'agent' ? 'assistant' : 'user',
    text: turn.text,
  }));
}

function buildWorkspaceState(stage) {
  let chatState = stage.chatState || {};
  return {
    sidebar: 'hidden',
    chats: [{
      id: 'realtime-builder',
      title: demo.name,
      subtitle: chatState.questionnaireStatus || stage.title,
    }],
    activeChatId: 'realtime-builder',
    messages: chatMessageItems(stage),
    messagesOptions: { scrollToBottom: true },
    composer: {
      placeholder: chatState.nextPatch || 'Describe the workspace to build...',
      value: '',
      attachedContext: [
        { id: 'stage', label: stage.title },
        { id: 'question', label: chatState.activeQuestionId || 'questionnaire' },
      ],
      footerControls: [
        { id: 'layout', kind: 'button', icon: 'view_quilt', label: 'Layout', value: stage.config.layout?.type || 'split' },
        { id: 'theme', kind: 'button', icon: 'palette', label: 'Theme', value: stage.config.theme?.params?.mode || 'default' },
      ],
    },
    liveStatus: {
      phase: 'running',
      title: 'Realtime builder',
      text: chatState.nextPatch || stage.title,
    },
    backgroundState: 'activity',
  };
}

function hydratePanelContent(root, panelType, stage) {
  if (panelType === 'agent-chat') {
    let workspace = root.querySelector('chat-workspace');
    workspace?.setWorkspaceState?.(buildWorkspaceState(stage));
  }
  if (panelType === 'theme-editor') {
    let params = stage.config.theme?.params || CASCADE_THEME_DEFAULTS;
    let editor = root.querySelector('cascade-theme-editor');
    editor?.setThemeState?.(params);
  }
}

function buildModuleBody(panelType, context) {
  let stage = context.stage;
  let chatState = stage.chatState || {};
  let config = stage.config || {};
  if (panelType === 'agent-chat') {
    return \`
      <chat-workspace class="demo-chat-workspace" sidebar="hidden"></chat-workspace>
      <sn-description-list class="demo-panel-facts">
        \${moduleField('Question', chatState.activeQuestionId)}
        \${moduleField('Patch', chatState.nextPatch)}
      </sn-description-list>
    \`;
  }
  if (panelType === 'service-blueprint') {
    let blueprint = chatState.serviceBlueprint || {};
    return card('Service blueprint', \`
      <sn-description-list class="demo-panel-facts">
        \${moduleField('Intent', chatState.activeIntent)}
        \${moduleField('Entities', blueprint.entities)}
        \${moduleField('Workflows', blueprint.workflows)}
        \${moduleField('Outputs', blueprint.outputs)}
      </sn-description-list>
    \`, { icon: 'schema', status: chatState.questionnaireStatus });
  }
  if (panelType === 'layout-builder') {
    return card('Layout roles', \`
      <div class="sn-demo-layout-map" data-layout-kind="\${escapeHtml(config.layout?.type || 'panel')}">
        \${Object.entries(chatState.layoutRoles || {}).map(([id, role]) => \`
          <sn-card data-panel-role="\${escapeHtml(id)}"><strong>\${escapeHtml(id)}</strong><span>\${escapeHtml(role)}</span></sn-card>
        \`).join('')}
      </div>
      <sn-description-list class="demo-panel-facts">
        \${moduleField('Topology', config.construction?.answers?.['layout-topology'])}
        \${moduleField('Responsive', config.rootBehavior?.responsiveMode)}
      </sn-description-list>
    \`, { icon: 'view_quilt', status: config.rootBehavior?.responsiveMode || 'layout' });
  }
  if (panelType === 'widget-registry') {
    return card('Widget registry', \`
      <div class="sn-demo-widget-registry">
        \${(chatState.widgetRegistry || []).map((widget) => \`
          <sn-card data-widget-status="\${escapeHtml(widget.status)}">
            <i class="material-symbols-outlined">widgets</i>
            <strong>\${escapeHtml(widget.id)}</strong>
            <b>\${escapeHtml(widget.role)}</b>
            <sn-badge>\${escapeHtml(widget.status)}</sn-badge>
          </sn-card>
        \`).join('')}
      </div>
    \`, { icon: 'widgets', status: \`\${(chatState.widgetRegistry || []).length} modules\` });
  }
  if (panelType === 'bindings-inspector') {
    return card('Bindings', \`
      <div class="sn-demo-module-list">
        \${(config.data?.bindings || []).slice(0, 6).map((binding) => \`
          <sn-card><b>\${escapeHtml(binding.panelType)}</b><span>\${escapeHtml(binding.id)} -> \${escapeHtml(binding.path)}</span></sn-card>
        \`).join('')}
      </div>
    \`, { icon: 'hub', status: \`\${(config.data?.bindings || []).length} wired\` });
  }
  if (panelType === 'adaptive-rules') {
    let adaptive = chatState.adaptiveBehavior || {};
    return card('Adaptive rules', \`
      <sn-description-list class="demo-panel-facts">
        \${moduleField('Mode', adaptive.mode)}
        \${moduleField('Breakpoint', adaptive.breakpoint)}
        \${moduleField('Pinned', adaptive.pinned)}
        \${moduleField('Collapse order', adaptive.collapseOrder)}
      </sn-description-list>
    \`, { icon: 'responsive_layout', status: viewportMode });
  }
  if (panelType === 'validation-checklist') {
    let validation = validateWorkspaceConfig(config, { strict: true });
    return card('Builder contract', \`
      <div class="sn-demo-module-list">
        <sn-card class="demo-validation-row">
          <span class="demo-validation-label">Strict validation</span>
          <sn-badge>\${validation.valid ? 'pass' : 'fail'}</sn-badge>
        </sn-card>
        \${(chatState.validationChecklist || []).map((item) => \`
          <sn-card class="demo-validation-row" data-status="\${escapeHtml(item.status)}">
            <span class="demo-validation-label">\${escapeHtml(item.id)}</span>
            <sn-badge>\${escapeHtml(item.status)}</sn-badge>
          </sn-card>
        \`).join('')}
      </div>
    \`, { icon: 'fact_check', status: validation.valid ? 'strict pass' : 'strict fail' });
  }
  if (panelType === 'theme-editor') {
    let theme = chatState.themeCascade || {};
    return \`
      <cascade-theme-editor class="demo-theme-editor"></cascade-theme-editor>
      <sn-description-list class="demo-panel-facts">
          \${moduleField('Cascade', theme.source)}
          \${moduleField('Mode', theme.mode || config.theme?.params?.mode)}
          \${moduleField('State path', theme.statePath)}
      </sn-description-list>
    \`;
  }
  return card('Module', '<sn-badge>Waiting for chat-state patch</sn-badge>');
}

function defineDemoWorkspaceModules() {
  if (demoModulesDefined) return;
  demoModulesDefined = true;
  let finalPanelTypes = demo.stages.at(-1).config.panelTypes || {};
  for (let tagName of demo.requiredWidgets.map((id) => finalPanelTypes[id]?.component).filter(Boolean)) {
    if (customElements.get(tagName)) continue;
    customElements.define(tagName, class extends HTMLElement {
      set demoContext(value) {
        this._demoContext = value;
        this.render();
      }
      connectedCallback() {
        this.render();
      }
      render() {
        if (!this.isConnected || !this._demoContext) return;
        let panelType = this._demoContext.panelType;
        let panel = this._demoContext.stage.config.panelTypes[panelType] || {};
        this.dataset.panelType = panelType;
        this.innerHTML = \`
          <article class="sn-demo-module" data-module="\${escapeHtml(panelType)}">
            <header>
              <span class="material-symbols-outlined">\${escapeHtml(panel.icon || 'widgets')}</span>
              <strong>\${escapeHtml(panel.title || panelType)}</strong>
            </header>
            \${buildModuleBody(panelType, this._demoContext)}
          </article>
        \`;
        hydratePanelContent(this, panelType, this._demoContext.stage);
      }
    });
  }
}

function hydrateDemoModules(root, stage) {
  for (let [panelType, panel] of Object.entries(stage.config.panelTypes || {})) {
    if (!panel.component) continue;
    for (let component of root.querySelectorAll(panel.component)) {
      component.demoContext = { panelType, stage };
      hydratePanelContent(component, panelType, stage);
    }
  }
}

function createSymbioteLayoutRuntime(stage) {
  return {
    mountWorkspace({ config, element }) {
      let currentStage = stage;
      defineDemoWorkspaceModules();
      let layout = document.createElement('panel-layout');
      layout.className = 'demo-symbiote-layout';
      layout.dataset.runtimeInstanceId = \`layout-\${++layoutInstanceSeq}\`;
      layout.dataset.atomicUpdateCount = '0';
      layout.setAttribute('responsive-mode', config.rootBehavior?.responsiveMode || 'drawer');
      layout.setAttribute('responsive-breakpoint', String(config.rootBehavior?.responsiveBreakpoint || 860));
      layout.setAttribute('swipe-control', config.rootBehavior?.swipeControl || 'edge');
      element.appendChild(layout);
      element.dataset.runtimeInstanceId = layout.dataset.runtimeInstanceId;
      element.dataset.atomicUpdateCount = '0';
      requestAnimationFrame(() => {
        layout.$.panelTypes = config.panelTypes || {};
        layout.$.layoutTree = normalizeLayoutNode(config.layout);
        requestAnimationFrame(() => {
          hydrateDemoModules(layout, currentStage);
          applyAdaptiveScenario(currentStage);
        });
      });
      return {
        updateConfig(update) {
          currentStage = update.stage || currentStage;
          let nextConfig = update.config;
          let updateCount = Number(layout.dataset.atomicUpdateCount || '0') + 1;
          layout.dataset.atomicUpdateCount = String(updateCount);
          layout.dataset.lastUpdateReason = update.reason || 'updateConfig';
          layout.dataset.lastStage = currentStage.id || '';
          element.dataset.runtimeInstanceId = layout.dataset.runtimeInstanceId;
          element.dataset.atomicUpdateCount = String(updateCount);
          element.dataset.lastUpdatedStage = currentStage.id || '';
          layout.setAttribute('responsive-mode', nextConfig.rootBehavior?.responsiveMode || 'drawer');
          layout.setAttribute('responsive-breakpoint', String(nextConfig.rootBehavior?.responsiveBreakpoint || 860));
          layout.setAttribute('swipe-control', nextConfig.rootBehavior?.swipeControl || 'edge');
          layout.$.panelTypes = nextConfig.panelTypes || {};
          layout.$.layoutTree = normalizeLayoutNode(nextConfig.layout);
          requestAnimationFrame(() => {
            hydrateDemoModules(layout, currentStage);
            applyAdaptiveScenario(currentStage);
          });
        },
        destroy() {
          layout.remove();
        },
      };
    },
  };
}

let styles = new CSSStyleSheet();
styles.replaceSync(\`
  :root {
    color-scheme: dark;
    --demo-border: var(--sn-layout-border, var(--sn-outline-color));
    --demo-muted: var(--sn-text-dim);
    --demo-soft: var(--sn-panel-bg);
    --demo-accent: var(--sn-node-selected);
    --demo-pass: hsl(var(--sn-hue-success) var(--sn-theme-chroma) 46%);
    --demo-warn: hsl(var(--sn-hue-warning) var(--sn-theme-chroma) 52%);
  }
  html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: var(--sn-bg);
    color: var(--sn-text);
    font-family: var(--sn-font, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  }
  button {
    font: inherit;
  }
  .demo-shell {
    display: grid;
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
    gap: 0.5rem;
    min-width: 0;
    min-height: 2.25rem;
    padding: 0 0.5rem;
    border-bottom: 1px solid var(--demo-border);
    background: var(--sn-bg);
    overflow: hidden;
  }
  .demo-title {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
    flex: 0 1 18rem;
    min-width: 0;
  }
  .demo-title strong {
    flex: 0 0 auto;
    font-size: 0.82rem;
    line-height: 1.25;
    white-space: nowrap;
  }
  .demo-title span {
    color: var(--demo-muted);
    font-size: 0.72rem;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .demo-action,
  .demo-stage-chip,
  .demo-viewport-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
  }
  .demo-action {
    gap: 0.375rem;
    min-height: 2rem;
  }
  .demo-icon {
    font-family: "Material Symbols Outlined";
    font-size: 1.2rem;
    line-height: 1;
    font-weight: normal;
  }
  .demo-stage-rail {
    display: flex;
    gap: 0.25rem;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .demo-stage-rail::-webkit-scrollbar {
    display: none;
  }
  .demo-stage-chip {
    flex: 0 0 auto;
    max-width: 11rem;
    min-height: 1.75rem;
    --sn-button-padding: 2px 8px;
    --sn-button-font-size: 11px;
    --sn-button-active-bg: color-mix(in srgb, var(--sn-node-selected) 20%, transparent);
    --sn-button-active-color: var(--sn-text);
    --sn-button-active-border: var(--sn-node-selected);
  }
  .demo-stage-chip[aria-current="step"] {
    border-color: var(--demo-accent);
    color: var(--demo-accent);
  }
  .demo-theme-widget {
    flex: 0 0 auto;
  }
  .demo-viewport-controls {
    flex: 0 0 auto;
    --sn-segmented-padding: 2px 8px;
    --sn-segmented-item-min-height: 1.5rem;
    --sn-segmented-font-size: 11px;
  }
  .demo-viewport-button {
    min-height: 1.5rem;
    font-size: 0.78rem;
  }
  .demo-viewport-button[aria-pressed="true"] {
    background: var(--demo-accent);
    color: white;
  }
  .demo-build-progress {
    display: grid;
    gap: 0.25rem;
    flex: 0 1 10rem;
    min-width: 7rem;
  }
  .demo-build-progress span {
    color: var(--demo-muted);
    font-size: 0.72rem;
    line-height: 1.2;
    white-space: nowrap;
  }
  .demo-build-progress i {
    display: block;
    width: 100%;
    height: 0.4rem;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, CanvasText 12%, transparent);
  }
  .demo-build-progress i::before {
    content: "";
    display: block;
    width: var(--demo-progress, 0%);
    height: 100%;
    border-radius: inherit;
    background: var(--demo-accent);
    transition: width 240ms ease;
  }
  .demo-workspace {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .symbiote-workspace__panel {
    transition: border-color 180ms ease, transform 180ms ease;
  }
  .symbiote-workspace__panel[data-adaptive-state="collapsed"] {
    display: none;
  }
  .symbiote-workspace__panel[data-adaptive-state="docked"] {
    border-color: var(--demo-accent);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--demo-accent) 42%, transparent);
  }
  .demo-workspace > .symbiote-workspace {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .demo-symbiote-layout {
    display: block;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    --sn-layout-border: color-mix(in srgb, var(--sn-text, CanvasText) 14%, transparent);
    --sn-layout-gap-bg: color-mix(in srgb, var(--sn-bg) 86%, var(--sn-node-selected) 14%);
    --sn-layout-header-block-size: 32px;
  }
  .demo-symbiote-layout .layout-root {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .demo-symbiote-layout layout-node[data-adaptive-state="collapsed"] {
    display: none;
  }
  .demo-symbiote-layout layout-node[data-adaptive-state="docked"] {
    outline: 2px solid var(--sn-node-selected, var(--demo-accent));
    outline-offset: -2px;
  }
  .sn-demo-module {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 0.75rem;
    height: 100%;
    min-height: 0;
    padding: 0.75rem;
    box-sizing: border-box;
    background: var(--sn-panel-bg, color-mix(in srgb, Canvas 94%, CanvasText 6%));
    color: var(--sn-text, CanvasText);
    font: 12px/1.35 var(--sn-font, inherit);
    overflow: hidden;
  }
  .sn-demo-module > .demo-chat-workspace,
  .sn-demo-module > .demo-theme-editor {
    min-height: 0;
    height: 100%;
  }
  .demo-library-card,
  .demo-panel-facts,
  .demo-validation-row {
    min-width: 0;
  }
  .demo-validation-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .demo-validation-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .demo-card-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    margin-bottom: 0.625rem;
  }
  .demo-card-title strong {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sn-demo-module header {
    display: flex;
    gap: 0.625rem;
    align-items: center;
    min-width: 0;
  }
  .sn-demo-module header > span {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--sn-radius-md, 8px);
    background: color-mix(in srgb, var(--sn-node-selected, var(--demo-accent)) 16%, transparent);
    color: var(--sn-node-selected, var(--demo-accent));
  }
  .sn-demo-module strong,
  .sn-demo-module span,
  .sn-demo-module p {
    min-width: 0;
  }
  .sn-demo-module-list,
  .sn-demo-module-grid,
  .sn-demo-widget-registry,
  .sn-demo-layout-map {
    min-height: 0;
    overflow: auto;
  }
  .sn-demo-module-list {
    display: grid;
    align-content: start;
    gap: 0.5rem;
  }
  .sn-demo-module-list p {
    display: grid;
    gap: 0.25rem;
    margin: 0;
    padding: 0.5rem;
    border: 1px solid var(--sn-node-border, color-mix(in srgb, currentColor 12%, transparent));
    border-radius: var(--sn-radius-md, 8px);
    background: var(--sn-node-bg, color-mix(in srgb, Canvas 96%, CanvasText 4%));
  }
  .sn-demo-module-grid,
  .sn-demo-module-strip {
    display: grid;
    gap: 0.5rem;
  }
  .sn-demo-module-grid span,
  .sn-demo-module-strip span {
    display: grid;
    gap: 0.125rem;
    padding: 0.5rem;
    border-radius: var(--sn-radius-md, 8px);
    background: var(--sn-node-bg, color-mix(in srgb, Canvas 96%, CanvasText 4%));
  }
  .sn-demo-layout-map,
  .sn-demo-widget-registry {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    align-content: start;
    gap: 0.5rem;
  }
  .sn-demo-layout-map sn-card,
  .sn-demo-widget-registry sn-card {
    display: grid;
    gap: 0.25rem;
  }
  .sn-demo-theme-editor {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.75rem;
    align-items: start;
    min-height: 0;
  }
  .sn-demo-theme-editor > span {
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    background: hsl(var(--swatch-hue) 70% 52%);
    box-shadow: inset 0 0 0 6px color-mix(in srgb, Canvas 44%, transparent);
  }
  @media (max-width: 980px) {
    .demo-shell {
      grid-template-rows: auto minmax(0, 1fr);
    }
  }
  @media (max-width: 680px) {
    .demo-toolbar {
      align-items: stretch;
      flex-wrap: wrap;
      min-height: 0;
      padding: 0.5rem;
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
    .demo-viewport-controls {
      flex: 0 0 auto;
    }
    .demo-build-progress {
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
    <sn-button class="demo-action" data-action="play" variant="primary">
      <span class="demo-icon" aria-hidden="true">play_arrow</span>
      <span>Play</span>
    </sn-button>
    <div class="demo-build-progress" aria-label="Build progress">
      <span></span>
      <i aria-hidden="true"></i>
    </div>
    <sn-segmented-control class="demo-viewport-controls" role="group" aria-label="Adaptive preview"></sn-segmented-control>
    <cascade-theme-widget class="demo-theme-widget"></cascade-theme-widget>
    <div class="demo-stage-rail" role="tablist" aria-label="Demo stages"></div>
  </header>
  <div class="demo-workspace" aria-label="Generated workspace"></div>
\`;
document.body.appendChild(shell);

let title = shell.querySelector('.demo-title strong');
let subtitle = shell.querySelector('.demo-title span');
let playButton = shell.querySelector('[data-action="play"]');
let buildProgress = shell.querySelector('.demo-build-progress');
let viewportControls = shell.querySelector('.demo-viewport-controls');
let stageRail = shell.querySelector('.demo-stage-rail');
let workspace = shell.querySelector('.demo-workspace');

shell.addEventListener('cascade-theme-open-full', (event) => {
  event.preventDefault?.();
  let layout = workspace.querySelector('panel-layout');
  shell.dataset.themeEditorOpenRequest = 'theme-editor';
  shell.dataset.themeEditorOpenSource = 'cascade-theme-widget';
  layout?.openPanel?.('theme-editor', {
    uiInvoked: true,
    source: 'cascade-theme-widget',
  });
});

function buildProgressPercent(index) {
  let total = demo.stages.reduce((sum, stage) => sum + buildOperations(stage).length, 0);
  let previous = demo.stages
    .slice(0, index)
    .reduce((sum, stage) => sum + buildOperations(stage).length, 0);
  return Math.round(((previous + operationIndex + 1) / total) * 100);
}

function buildOperations(stage) {
  let chatState = stage.chatState || {};
  let required = chatState.requiredElements || [];
  let roles = Object.keys(chatState.layoutRoles || {});
  let adaptive = chatState.adaptiveBehavior?.collapseOrder || [];
  let latestDecision = chatState.decisionTrace?.at(-1);
  return [
    {
      label: 'Read chat state',
      value: chatState.questionnaireStatus || stage.activeQuestionId,
      status: 'done',
    },
    {
      label: 'Apply workspace patch',
      value: latestDecision
        ? \`\${latestDecision.questionId}: \${latestDecision.operations.join(' -> ')}\`
        : chatState.nextPatch || 'Waiting for next questionnaire answer.',
      status: 'active',
    },
    {
      label: 'Resolve required UI',
      value: required.length ? required.join(', ') : 'Intent panels only',
      status: required.length >= 4 ? 'done' : 'active',
    },
    {
      label: 'Rank layout behavior',
      value: roles.length
        ? \`\${roles.length} roles, collapse: \${adaptive.join(' -> ') || 'pending'}\`
        : 'Waiting for layout roles',
      status: adaptive.length >= 3 ? 'done' : 'active',
    },
  ];
}

function adaptiveScenario(stage) {
  let scenarios = stage.chatState?.adaptiveScenarios || [];
  return scenarios.find((item) => item.mode === viewportMode) || scenarios[0] || null;
}

function renderViewportControls(stage) {
  let scenarios = stage.chatState?.adaptiveScenarios || [];
  viewportControls.textContent = '';
  viewportControls.value = viewportMode;
  for (let scenario of scenarios) {
    let button = document.createElement('sn-button');
    button.className = 'demo-viewport-button';
    button.setAttribute('value', scenario.mode);
    button.dataset.viewportMode = scenario.mode;
    button.textContent = scenario.mode;
    button.setAttribute('aria-pressed', String(scenario.mode === viewportMode));
    button.addEventListener('click', () => {
      viewportMode = scenario.mode;
      renderStage(stageIndex);
    });
    viewportControls.appendChild(button);
  }
}

function renderStageRail() {
  stageRail.textContent = '';
  demo.stages.forEach((stage, index) => {
    let button = document.createElement('sn-button');
    button.className = 'demo-stage-chip';
    button.textContent = \`\${stage.clock} \${stage.title}\`;
    button.setAttribute('role', 'tab');
    button.setAttribute('size', 'sm');
    if (index === stageIndex) {
      button.setAttribute('aria-current', 'step');
      button.setAttribute('selected', '');
    }
    button.addEventListener('click', () => {
      stopPlayback();
      operationIndex = 0;
      renderStage(index);
    });
    stageRail.appendChild(button);
  });
}

function renderWorkspace(stage) {
  if (mounted) {
    mounted.updateConfig(stage.config, {
      stage,
      reason: 'realtime-stage',
    });
    applyAdaptiveScenario(stage);
    return;
  }
  mounted = mountWorkspace(stage.config, workspace, {
    runtimeController: createSymbioteLayoutRuntime(stage),
    themeAdapter: { applyCascadeTheme },
    strictComponents: false,
  });
  applyAdaptiveScenario(stage);
}

function applyAdaptiveScenario(stage) {
  let scenario = adaptiveScenario(stage);
  if (!scenario) return;
  let collapsed = new Set(scenario.collapsedPanels);
  let docked = new Set(scenario.dockedPanels);
  let visible = new Set();
  for (let panel of workspace.querySelectorAll('[data-panel-type], layout-node[node-type="panel"]')) {
    let panelType = panel.dataset.panelType;
    if (!panelType && panel.$?.panelType) panelType = panel.$.panelType;
    let state = collapsed.has(panelType) ? 'collapsed' : docked.has(panelType) ? 'docked' : 'visible';
    panel.dataset.adaptiveState = state;
    if (state !== 'collapsed' && panelType) visible.add(panelType);
  }
  workspace.dataset.visiblePanels = [...visible].join(',');
  workspace.dataset.collapsedPanels = scenario.collapsedPanels.join(',');
  workspace.dataset.dockedPanels = scenario.dockedPanels.join(',');
}

function renderStage(index) {
  stageIndex = index;
  let stage = demo.stages[stageIndex];
  let scenario = adaptiveScenario(stage);
  let adaptive = stage.chatState?.adaptiveBehavior || {};
  let theme = stage.chatState?.themeCascade || {};
  let progress = buildProgressPercent(stageIndex);
  let activeOperation = buildOperations(stage)[operationIndex];
  shell.dataset.stage = stage.id;
  shell.dataset.buildKind = activeOperation?.label.toLowerCase().replaceAll(' ', '-') || 'stage';
  shell.dataset.adaptiveMode = adaptive.mode || '';
  shell.dataset.adaptiveBreakpoint = String(adaptive.breakpoint || stage.config.rootBehavior?.responsiveBreakpoint || '');
  shell.dataset.themeMode = theme.mode || stage.config.theme?.params?.mode || '';
  shell.dataset.themeEditorState = theme.status || '';
  shell.dataset.viewportMode = scenario?.mode || viewportMode;
  shell.dataset.collapsedPanels = scenario?.collapsedPanels.join(',') || '';
  shell.dataset.dockedPanels = scenario?.dockedPanels.join(',') || '';
  workspace.dataset.viewportMode = scenario?.mode || viewportMode;
  title.textContent = demo.name;
  subtitle.textContent = \`\${stage.clock} - \${stage.title}\`;
  buildProgress.querySelector('span').textContent = \`Build \${progress}%\`;
  buildProgress.style.setProperty('--demo-progress', \`\${progress}%\`);
  renderViewportControls(stage);
  renderStageRail();
  renderWorkspace(stage);
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
  operationIndex = 0;
  renderStage(0);
  playTimer = setInterval(() => {
    let operations = buildOperations(demo.stages[stageIndex]);
    if (operationIndex < operations.length - 1) {
      operationIndex += 1;
      renderStage(stageIndex);
      return;
    }
    if (stageIndex >= demo.stages.length - 1) {
      stopPlayback();
      return;
    }
    operationIndex = 0;
    renderStage(stageIndex + 1);
  }, 620);
}

playButton.addEventListener('click', () => {
  if (playTimer) {
    stopPlayback();
  } else {
    startPlayback();
  }
});

operationIndex = buildOperations(demo.stages.at(-1)).length - 1;
renderStage(demo.stages.length - 1);
`;
}

export async function writeRealtimeChatStateDemo(options = {}) {
  let outputDir = resolve(options.outputDir || join(process.cwd(), 'tmp', 'realtime-builder-demo'));
  let port = Number(options.port || 4567);
  let imports = {
    'symbiote-workspace/browser': '/__workspace__/browser.js',
    [BROWSER_THEME_IMPORT]: '/__symbiote_ui__/ui/index.js',
    'symbiote-ui/': '/__symbiote_ui__/',
    'symbiote-engine': '/__symbiote_engine__/index.js',
    'symbiote-engine/': '/__symbiote_engine__/',
    '@symbiotejs/symbiote': '/__symbiote__/core/index.js',
    '@symbiotejs/symbiote/': '/__symbiote__/',
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
    constructionTrace: demo.constructionTrace,
    buildStreamTimeline: demo.stages.map((stage, index) => ({
      stage: stage.id,
      progress: progressPercent(index, demo.stages.length),
      operations: buildStreamOperations(stage),
    })),
    chatStateTimeline: demo.stages.map((stage) => ({
      stage: stage.id,
      activeQuestionId: stage.chatState.activeQuestionId,
      questionnaireStatus: stage.chatState.questionnaireStatus,
      requiredElements: stage.chatState.requiredElements,
      adaptiveScenarios: stage.chatState.adaptiveScenarios,
      decisionTrace: stage.chatState.decisionTrace,
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
