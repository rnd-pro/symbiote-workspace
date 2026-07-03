function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function localize(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (isObject(value)) {
    if (typeof value.default === 'string') return value.default;
    if (typeof value.$t === 'string') return value.$t;
  }
  return fallback;
}

function panelCtx(viewId, node) {
  return `panel:${viewId || 'workspace'}:${node?.id || node?.panel || 'panel'}`;
}

function stackCtx(viewId, node) {
  return `stack:${viewId || 'workspace'}:${node?.id || 'root'}`;
}

function panelDefinition(config, node) {
  if (node?.panel && config?.panels?.[node.panel]) return config.panels[node.panel];
  return {};
}

function panelModule(config, panel) {
  let moduleId = panel.module || '';
  let descriptor = Array.isArray(config?.modules)
    ? config.modules.find((entry) => entry?.id === moduleId || entry?.tagName === moduleId)
    : null;
  return { moduleId, descriptor };
}

function renderPanel(config, node, viewId) {
  let panel = panelDefinition(config, node);
  let { moduleId, descriptor } = panelModule(config, panel);
  let inlineSkipped = descriptor?.source?.kind === 'inline';
  let title = localize(node.title, localize(panel.title, node.panel || 'Panel'));
  return /* html */ `
<section class="workspace-panel" data-panel-id="${escapeHtml(node.id || node.panel || 'panel')}" data-panel="${escapeHtml(node.panel || '')}"${moduleId ? ` data-module="${escapeHtml(moduleId)}"` : ''} ctx="${escapeHtml(panelCtx(viewId, node))}"${inlineSkipped ? ' data-ssr-skipped="inline-module"' : ''}>
  <header class="workspace-panel-header"><span>${escapeHtml(title)}</span></header>
  <div class="workspace-panel-body" data-panel-host></div>
</section>`;
}

function renderStack(config, node, viewId) {
  let children = Array.isArray(node.children) ? node.children : [];
  let active = node.active || children[0]?.id;
  let activeChildren = children.filter((child) => !active || child.id === active);
  return /* html */ `
<div class="workspace-stack" data-stack-id="${escapeHtml(node.id || 'stack')}" ctx="${escapeHtml(stackCtx(viewId, node))}">
  ${activeChildren.map((child) => renderLayoutNode(config, child, viewId)).join('')}
</div>`;
}

function renderLayoutNode(config, node, viewId) {
  if (!isObject(node)) return '';
  if (node.kind === 'bsp') return renderLayoutNode(config, node.root, viewId);
  if (node.kind === 'stack' || node.type === 'stack') return renderStack(config, node, viewId);
  if (node.type === 'panel') return renderPanel(config, node, viewId);
  if (node.type === 'split') {
    return /* html */ `
<div class="workspace-split" data-direction="${escapeHtml(node.direction || 'horizontal')}" data-node-id="${escapeHtml(node.id || 'split')}">
  <div class="workspace-split-pane" data-pane="first">${renderLayoutNode(config, node.first, viewId)}</div>
  <div class="workspace-split-pane" data-pane="second">${renderLayoutNode(config, node.second, viewId)}</div>
</div>`;
  }
  return '';
}

function resolveViewLayout(config, view) {
  if (isObject(view?.layout) && typeof view.layout.$layout === 'string') {
    return config.layouts?.[view.layout.$layout] || null;
  }
  if (isObject(view?.layout) && typeof view.layout.kind === 'string') return view.layout;
  return Object.values(config.layouts || {})[0] || null;
}

export function renderWorkspaceStage(context = {}) {
  let config = context.config || {};
  let view = context.view || null;
  let layout = resolveViewLayout(config, view);
  if (context.denied) {
    return `<div class="workspace-denied" data-route-denied="${escapeHtml(context.denied.view || '')}"></div>`;
  }
  if (context.omitPanels || !layout) return '';
  return renderLayoutNode(config, layout, view?.id || context.route?.view || 'workspace');
}

export function renderWorkspaceShellTemplate(context = {}) {
  let title = context.title || context.config?.name || 'Symbiote Workspace';
  let stage = renderWorkspaceStage(context);
  let dataPayload = context.dataPayload
    ? `<script type="application/json" data-workspace-route-data>${context.dataPayload}</script>`
    : '';
  return /* html */ `
<header class="workspace-topbar">
  <div class="workspace-topbar-left">
    <span class="workspace-title">${escapeHtml(title)}</span>
  </div>
  <div class="workspace-topbar-right">
    <cascade-theme-widget></cascade-theme-widget>
  </div>
</header>
<div id="workspace-stage" class="workspace-stage" data-workspace-host data-route-status="${escapeHtml(context.status || 200)}">
  ${stage}
  ${dataPayload}
</div>
`;
}

export default renderWorkspaceShellTemplate();
