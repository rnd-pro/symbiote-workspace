/**
 * symbiote-workspace/browser — Browser-only entry point.
 *
 * Re-exports browser-safe isomorphic APIs plus browser-specific assembly:
 * DOM mounting, theme application, runtime controller integration.
 *
 * Requires a DOM environment (document, customElements).
 */

export {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_REGISTER_VALUES,
  DATA_BINDING_DIRECTIONS,
  WORKSPACE_CONFIG_SCHEMA,
  MODULE_CAPABILITY_SCHEMA_VERSION,
  MODULE_CAPABILITY_DESCRIPTOR_SCHEMA,
  validateModuleCapabilityDescriptor,
  validatePortableStringArray,
  validateWorkspaceConfig,
  isCompatibleVersion,
} from './schema/index.js';

export {
  loadWorkspaceConfig,
  extractThemeParams,
  extractThemeRelations,
  extractThemeOverrides,
  extractThemeSubtrees,
} from './loader/index.js';

export {
  planWorkspace,
  matchTemplate,
  listTemplates,
  getTemplate,
  normalizeConstructionIntent,
  buildConstructionQuestions,
  answerConstructionQuestion,
  planWorkspaceConstruction,
  extractConstructionPlan,
} from './constructor/index.js';

export {
  WORKSPACE_PACKAGE_KIND,
  WORKSPACE_PACKAGE_SCHEMA_VERSION,
  BROWSER_ENGINE_CONTRACTS_IMPORT,
  BROWSER_ENGINE_IMPORT,
  BROWSER_REQUIRED_IMPORTS,
  BROWSER_THEME_IMPORT,
  exportConfig,
  exportWorkspacePackage,
  importConfig,
  importWorkspacePackage,
  diffConfigs,
  mergeConfigs,
  createBrowserRuntimeContract,
  createHostIntegrationContract,
  createWorkspaceConstructionHandoff,
  createWorkspacePackageConstructionContext,
  createWorkspacePackagesConstructionContext,
  inspectWorkspacePackage,
  prepareConstructionIntentWithPackageContext,
  validateWorkspacePackage,
} from './sharing/index.js';

export {
  checkDesignGuardrails,
  loadWorkspaceDesignPolicy,
  normalizeWorkspacePatchReport,
  proposeWorkspacePatch,
  validateWorkspaceDesignPatch,
  validateWorkspacePatch,
  validateWorkspaceThemePatch,
  applyWorkspacePatch,
} from './validation/index.js';

export {
  PLUGIN_SCHEMA,
  validatePluginDefinition,
  validatePluginWorkspaceTemplate,
  registerPlugin,
  activatePlugin,
  unregisterPlugin,
  listPlugins,
  getPlugin,
  getPluginStatus,
  clearPlugins,
  validatePlugin,
  collectPluginModuleCapabilities,
  listPluginModuleCapabilities,
  collectPluginWorkspaceTemplates,
  listPluginWorkspaceTemplates,
} from './plugins/index.js';

export {
  buildToolResultEnvelope,
  parseToolResultEnvelope,
  isToolResultEnvelope,
} from './runtime/tool-result.js';

export {
  DATA_CHANGE_MESSAGE_TYPE,
  buildDataChangeMessage,
  isDataChangeMessage,
} from './runtime/data-change.js';

export { subscribeDataChange } from './runtime/data-change-client.js';

import {
  extractThemeOverrides,
  extractThemeParams,
  extractThemeRelations,
  extractThemeSubtrees,
  loadWorkspaceConfig,
} from './loader/index.js';
import {
  applyWorkspacePatch as applyValidatedWorkspacePatch,
} from './validation/index.js';
import { WORKSPACE_CONFIG_CHANNEL } from './schema/constants.js';
import { broadcastDataChange } from './runtime/data-change.js';
import { createRouter } from './runtime/router-lane.js';
import { createWorkspaceState } from './runtime/workspace-state.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function hasKeys(value) {
  return isObject(value) && Object.keys(value).length > 0;
}

function isText(value) {
  return typeof value === 'string' && value.length > 0;
}

function localizeLabel(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (isObject(value)) {
    if (typeof value.default === 'string') return value.default;
    if (typeof value.$t === 'string') return value.$t;
  }
  return fallback;
}

function panelCtx(viewId, node) {
  let id = node?.id || node?.panel || 'panel';
  return `panel:${viewId || 'workspace'}:${id}`;
}

function ensureStyleTarget(element, label) {
  if (!element?.style || typeof element.style.setProperty !== 'function') {
    throw new Error(`${label} must be a DOM element with style.setProperty().`);
  }
}

function resolveThemeAdapter(options = {}) {
  if (options.themeAdapter?.applyCascadeTheme) return options.themeAdapter;
  let globalUi = globalThis?.SymbioteUI || globalThis?.symbioteUI;
  if (globalUi?.applyCascadeTheme) return globalUi;
  return null;
}

function buildThemeOptions(params = {}, relations = {}) {
  if (hasKeys(relations)) {
    return { ...params, relations: { ...relations } };
  }
  return { ...params };
}

function applyTokenOverrides(element, overrides = {}, label = 'theme.overrides') {
  ensureStyleTarget(element, label);
  for (let [name, value] of Object.entries(overrides || {})) {
    if (!name.startsWith('--')) {
      throw new Error(`${label} contains "${name}". Token override names must start with "--".`);
    }
    element.style.setProperty(name, String(value));
  }
}

function applyCascadeParams(element, params, relations, adapter, eventOptions) {
  if (!hasKeys(params) && !hasKeys(relations)) return null;
  if (!adapter?.applyCascadeTheme) {
    throw new Error(
      'mountWorkspace requires options.themeAdapter.applyCascadeTheme or ' +
      'globalThis.SymbioteUI.applyCascadeTheme to apply cascade theme params.'
    );
  }
  return adapter.applyCascadeTheme(element, buildThemeOptions(params, relations), eventOptions);
}

function collectScopedTargets(root, selector) {
  let targets = [];
  if (root.matches?.(selector)) targets.push(root);
  let found = root.querySelectorAll?.(selector) || [];
  for (let target of found) {
    if (!targets.includes(target)) targets.push(target);
  }
  return targets;
}

function normalizeThemeState(state) {
  if (!isObject(state)) return null;
  if (isObject(state.params) || isObject(state.relations) || isObject(state.overrides)) {
    return {
      params: isObject(state.params) ? state.params : {},
      relations: isObject(state.relations) ? state.relations : {},
      overrides: isObject(state.overrides) ? state.overrides : {},
    };
  }
  return { params: state, relations: {}, overrides: {} };
}

function updateThemeScope(scope, state) {
  let normalized = normalizeThemeState(state);
  if (!normalized) return;
  if (hasKeys(normalized.params)) {
    scope.params = { ...(scope.params || {}), ...normalized.params };
  }
  if (hasKeys(normalized.relations)) {
    scope.relations = { ...(scope.relations || {}), ...normalized.relations };
  }
  if (hasKeys(normalized.overrides)) {
    scope.overrides = { ...(scope.overrides || {}), ...normalized.overrides };
  }
}

function updateThemeParams(config, state, targetSelector) {
  if (!isObject(state)) return;
  if (!isObject(config.theme)) config.theme = {};
  if (targetSelector) {
    if (!Array.isArray(config.theme.subtrees)) config.theme.subtrees = [];
    let subtree = config.theme.subtrees.find((item) => item.selector === targetSelector);
    if (!subtree) {
      subtree = { selector: targetSelector };
      config.theme.subtrees.push(subtree);
    }
    updateThemeScope(subtree, state);
    return;
  }
  updateThemeScope(config.theme, state);
}

function appendTextElement(document, parent, tagName, className, text) {
  let element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function setStyles(element, styles) {
  for (let [name, value] of Object.entries(styles)) {
    element.style.setProperty(name, value);
  }
}

function firstLayout(config) {
  if (config.layout) return config.layout;
  let firstNamedLayout = Object.values(config.layouts || {})[0];
  return firstNamedLayout || null;
}

function routedView(config, router) {
  let active = router?.getState?.('state:route.view');
  if (isText(active)) {
    let matched = (config.views || []).find((view) => view?.id === active);
    if (matched) return matched;
  }
  return (
    (config.views || []).find((view) => view?.route?.default === true) ||
    (config.views || []).find((view) => view?.route) ||
    (config.views || [])[0] ||
    null
  );
}

function viewLayout(config, view) {
  if (!view) return firstLayout(config);
  if (isObject(view.layout) && isText(view.layout.$layout)) {
    return config.layouts?.[view.layout.$layout] || null;
  }
  if (isObject(view.layout) && isText(view.layout.kind)) return view.layout;
  return firstLayout(config);
}

function panelDefinition(config, node) {
  if (node.panel && config.panels?.[node.panel]) return config.panels[node.panel];
  return {};
}

function panelComponent(panel) {
  return panel.module || '';
}

function renderPreviewPanel(config, node, document, viewId = 'workspace') {
  let panel = panelDefinition(config, node);
  let element = document.createElement('section');
  element.className = 'symbiote-workspace__panel';
  element.dataset.panel = node.panel || 'unknown';
  element.dataset.panelId = node.id || node.panel || 'panel';
  element.setAttribute?.('ctx', panelCtx(viewId, node));
  let component = panelComponent(panel);
  if (component) element.dataset.component = component;
  setStyles(element, {
    display: 'flex',
    'flex-direction': 'column',
    gap: '0.5rem',
    'min-width': '0',
    'min-height': '8rem',
    padding: '1rem',
    border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
    'border-radius': '8px',
    background: 'color-mix(in srgb, Canvas 96%, currentColor 4%)',
    overflow: 'hidden',
  });

  let title = appendTextElement(document, element, 'h2', 'symbiote-workspace__panel-title', (
    localizeLabel(node.title, localizeLabel(panel.title, node.panel || 'Panel'))
  ));
  setStyles(title, {
    margin: '0',
    'font-size': '1rem',
    'font-weight': '650',
    'line-height': '1.25',
  });
  if (component) {
    let componentElement = appendTextElement(document, element, 'p', 'symbiote-workspace__panel-component', component);
    setStyles(componentElement, {
      margin: '0',
      'font-size': '0.8125rem',
      color: 'color-mix(in srgb, currentColor 62%, transparent)',
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
      'white-space': 'nowrap',
    });
  }

  let slots = Array.isArray(panel.slots) ? panel.slots : [];
  if (slots.length > 0) {
    let slotList = document.createElement('ul');
    slotList.className = 'symbiote-workspace__panel-slots';
    setStyles(slotList, {
      display: 'flex',
      gap: '0.375rem',
      margin: 'auto 0 0',
      padding: '0',
      'list-style': 'none',
      'flex-wrap': 'wrap',
    });
    for (let slot of slots) {
      let item = document.createElement('li');
      item.className = 'symbiote-workspace__panel-slot';
      item.dataset.slotId = slot.id || 'slot';
      item.textContent = slot.role ? `${slot.id || 'slot'} (${slot.role})` : slot.id || 'slot';
      setStyles(item, {
        padding: '0.25rem 0.5rem',
        'border-radius': '999px',
        background: 'color-mix(in srgb, currentColor 10%, transparent)',
        'font-size': '0.75rem',
      });
      slotList.appendChild(item);
    }
    element.appendChild(slotList);
  }

  return element;
}

function renderPreviewLayout(config, node, document, viewId = 'workspace') {
  if (!isObject(node)) return null;
  if (node.kind === 'bsp') return renderPreviewLayout(config, node.root, document, viewId);
  if (node.kind === 'stack' || node.type === 'stack') return renderPreviewStack(config, node, document, viewId);
  if (node.type === 'panel') return renderPreviewPanel(config, node, document, viewId);
  if (node.type !== 'split') return null;

  let element = document.createElement('div');
  element.className = 'symbiote-workspace__split';
  element.dataset.direction = node.direction || 'horizontal';
  let horizontal = (node.direction || 'horizontal') === 'horizontal';
  setStyles(element, {
    display: 'flex',
    'flex-direction': horizontal ? 'row' : 'column',
    gap: '0.75rem',
    width: '100%',
    height: '100%',
    'min-width': '0',
    'min-height': '0',
  });
  if (node.ratio !== undefined) {
    element.style.setProperty('--symbiote-workspace-preview-ratio', String(node.ratio));
  }

  let first = renderPreviewLayout(config, node.first, document, viewId);
  let second = renderPreviewLayout(config, node.second, document, viewId);
  if (first) first.style.setProperty('flex', `${Number(node.ratio) || 0.5} 1 0`);
  if (second) second.style.setProperty('flex', `${1 - (Number(node.ratio) || 0.5)} 1 0`);
  if (first) element.appendChild(first);
  if (second) element.appendChild(second);
  return element;
}

function renderPreviewStack(config, node, document, viewId) {
  let element = document.createElement('div');
  element.className = 'symbiote-workspace__stack';
  element.dataset.stackId = node.id || 'stack';
  element.setAttribute?.('ctx', `stack:${viewId || 'workspace'}:${node.id || 'root'}`);
  setStyles(element, {
    display: 'flex',
    width: '100%',
    height: '100%',
    'min-width': '0',
    'min-height': '0',
  });

  let children = Array.isArray(node.children) ? node.children : [];
  let active = node.active || children[0]?.id;
  for (let child of children) {
    if (active && child.id !== active) continue;
    let rendered = renderPreviewLayout(config, child, document, viewId);
    if (rendered) element.appendChild(rendered);
  }
  return element;
}

function renderDefaultWorkspacePreview(config, wrapper, router) {
  let view = routedView(config, router);
  let layout = viewLayout(config, view);
  if (!layout) return null;

  let document = wrapper.ownerDocument;
  let preview = document.createElement('div');
  preview.className = 'symbiote-workspace__preview';
  setStyles(wrapper, {
    display: 'block',
    height: '100%',
    padding: '1rem',
    'box-sizing': 'border-box',
    color: 'CanvasText',
    background: 'Canvas',
  });
  setStyles(preview, {
    display: 'flex',
    width: '100%',
    height: '100%',
    'min-height': '24rem',
    'box-sizing': 'border-box',
  });
  let renderedLayout = renderPreviewLayout(config, layout, document, view?.id || 'workspace');
  if (renderedLayout) preview.appendChild(renderedLayout);
  wrapper.appendChild(preview);
  return {
    destroy() {
      preview.remove();
    },
  };
}

function updateDefaultWorkspacePreview(config, wrapper, runtimeHandle, router) {
  if (typeof runtimeHandle?.destroy === 'function') runtimeHandle.destroy();
  return renderDefaultWorkspacePreview(config, wrapper, router);
}

function resolveRuntimeUpdate(runtimeController, runtimeHandle) {
  for (let name of ['updateConfig', 'updateWorkspace', 'applyConfig']) {
    if (typeof runtimeHandle?.[name] === 'function') {
      return { fn: runtimeHandle[name], target: runtimeHandle };
    }
    if (typeof runtimeController?.[name] === 'function') {
      return { fn: runtimeController[name], target: runtimeController };
    }
  }
  return null;
}

function assignMountedState(target, state) {
  target.config = state.config;
  target.loaderResult = state.loaderResult;
  target.theme = state.theme;
  if (state.router) target.router = state.router;
  if (state.workspaceState) target.workspaceState = state.workspaceState;
  if (Number.isInteger(state.revision)) target.revision = state.revision;
  if (state.lastCommit) target.lastCommit = state.lastCommit;
}

function normalizeOriginActor(value) {
  if (value === 'agent-gated' || value === 'system' || value === 'user-direct') return value;
  if (value === 'agent') return 'agent-gated';
  if (value === 'daemon') return 'system';
  return 'user-direct';
}

function normalizePrincipal(value) {
  if (isObject(value) && isText(value.kind) && isText(value.id)) return cloneJson(value);
  return { kind: 'human', id: 'browser-user' };
}

function originFromOptions(options = {}, reason = 'config-edit') {
  let principal = normalizePrincipal(options.principal || options.user || options.actorPrincipal);
  return {
    principal,
    actor: normalizeOriginActor(options.originActor || options.actor),
    reason: isText(options.reason) ? options.reason : reason,
    sessionId: isText(options.sessionId) ? options.sessionId : 'browser-mount',
    baseRevision: options.baseRevision,
  };
}

function commitOptions(updateOptions = {}, reason) {
  let origin = originFromOptions(updateOptions, reason);
  return {
    principal: origin.principal,
    actor: origin.actor,
    baseRevision: updateOptions.baseRevision,
    reason: origin.reason,
    confirmId: updateOptions.confirmId,
  };
}

function broadcastCommit(updateOptions, result, origin) {
  if (result.status !== 'ok' || typeof updateOptions.broadcast !== 'function') return null;
  return broadcastDataChange(updateOptions.broadcast, WORKSPACE_CONFIG_CHANNEL, {
    revision: result.revision,
    baseRevision: result.baseRevision,
    changedPaths: (result.changedPaths || []).map((path) => path || '/'),
    origin,
  });
}

function routerSignature(routerOptions = {}) {
  return JSON.stringify({
    mode: routerOptions.mode || 'memory',
    basePath: routerOptions.basePath || '',
    mount: routerOptions.mount || routerOptions.mountParams || {},
  });
}

function normalizeRouterOptions(raw = {}) {
  return {
    mode: raw.mode || 'memory',
    basePath: raw.basePath || '',
    mount: raw.mount || raw.mountParams || {},
    url: raw.url || raw.initialUrl,
    initial: raw.initial,
  };
}

function createWorkspaceRouter(config, options = {}) {
  let routerOptions = normalizeRouterOptions(options.router || {});
  let router = createRouter(config, {
    mode: routerOptions.mode,
    basePath: routerOptions.basePath,
    mount: routerOptions.mount,
    capabilitySnapshot: options.capabilitySnapshot,
    getGateVerdict: options.getGateVerdict,
    gateVerdicts: options.gateVerdicts,
    guardHooks: options.guardHooks,
    runGuard: options.runGuard,
    loaders: options.loaders,
    runLoader: options.runLoader,
  });
  let destroyed = false;
  router.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    router.emit?.('route:destroy', {});
  };
  return { router, signature: routerSignature(routerOptions), options: routerOptions };
}

function initialRouteRequest(config, routerOptions, container) {
  if (routerOptions.initial === false) return null;
  if (isText(routerOptions.url)) return { to: { url: routerOptions.url }, history: 'replace', source: 'user' };
  if (routerOptions.mode !== 'memory' && container?.ownerDocument?.defaultView?.location) {
    let location = container.ownerDocument.defaultView.location;
    let url = `${location.pathname || '/'}${location.search || ''}${location.hash || ''}`;
    return { to: { url }, history: 'replace', source: 'user' };
  }
  let view = (config.views || []).find((item) => item?.route?.default === true);
  if (view?.id) return { to: { view: view.id }, history: 'replace', source: 'user' };
  return null;
}

function publishContext(registry, name, value) {
  if (!registry || value === undefined) return;
  if (typeof registry.registerCtx === 'function') {
    registry.registerCtx(name, value);
  } else if (typeof registry.set === 'function') {
    registry.set(name, value);
  } else if (typeof registry.add === 'function') {
    registry.add(name, value, true);
  } else if (isObject(registry)) {
    registry[name] = value;
  }
}

function publishMountContexts(config, loaderResult, options = {}) {
  let registry = options.contextRegistry || options.namedContexts || options.contexts;
  let payload = { config, loaderResult };
  publishContext(registry, 'workspace', payload);
  publishContext(registry, 'narration', config.narration);
  publishContext(registry, 'enrichment', config.narration?.enrichment || config.enrichment);
  if (typeof options.publishContext === 'function') {
    options.publishContext('workspace', payload);
    if (config.narration !== undefined) options.publishContext('narration', config.narration);
    let enrichment = config.narration?.enrichment || config.enrichment;
    if (enrichment !== undefined) options.publishContext('enrichment', enrichment);
  }
}

/**
 * Applies workspace theme layers to a root element.
 * @param {import('./schema/workspace-schema.js').WorkspaceConfig} config
 * @param {HTMLElement} root
 * @param {Object} [options]
 * @param {Object} [options.themeAdapter]
 * @param {boolean} [options.strictThemeSubtrees]
 * @returns {{ rootTheme: any, subtreeThemes: Array, warnings: Array }}
 */
export function applyWorkspaceTheme(config, root, options = {}) {
  ensureStyleTarget(root, 'workspace theme root');

  let adapter = resolveThemeAdapter(options);
  let rootTheme = applyCascadeParams(
    root,
    extractThemeParams(config),
    extractThemeRelations(config),
    adapter,
    { notify: false, source: 'mountWorkspace' }
  );
  applyTokenOverrides(root, extractThemeOverrides(config));

  let subtreeThemes = [];
  let warnings = [];
  for (let [index, subtree] of extractThemeSubtrees(config).entries()) {
    if (!subtree?.selector) continue;
    let targets;
    try {
      targets = collectScopedTargets(root, subtree.selector);
    } catch (error) {
      throw new Error(`theme.subtrees[${index}].selector is invalid: ${subtree.selector}`);
    }
    if (targets.length === 0) {
      let message = `theme.subtrees[${index}] matched no elements: ${subtree.selector}`;
      if (options.strictThemeSubtrees) throw new Error(message);
      warnings.push({ path: `theme.subtrees.${index}`, message, severity: 'warning' });
      continue;
    }
    for (let target of targets) {
      let theme = applyCascadeParams(
        target,
        subtree.params || {},
        subtree.relations || {},
        adapter,
        { notify: false, source: 'mountWorkspace.subtree', targetSelector: subtree.selector }
      );
      applyTokenOverrides(target, subtree.overrides || {}, `theme.subtrees[${index}].overrides`);
      subtreeThemes.push({ selector: subtree.selector, target, theme });
    }
  }

  return { rootTheme, subtreeThemes, warnings };
}

/**
 * @param {import('./schema/workspace-schema.js').WorkspaceConfig} config
 * @param {HTMLElement} container
 * @param {Object} [options]
 * @param {Object} [options.catalog] - Component catalog
 * @param {Object} [options.runtimeController] - Optional symbiote-ui runtime controller
 * @param {boolean} [options.renderDefaultPreview] - Render portable layout/panel DOM when no runtime controller is supplied
 * @param {Object} [options.themeAdapter] - Object with applyCascadeTheme(element, options, eventOptions)
 * @param {function(Object): void} [options.onThemeChange] - Called after editor/widget theme changes
 * @param {boolean} [options.writeThemeChanges] - Persist cascade-theme-change state into config
 * @returns {{ destroy: function(): void, updateConfig: function(Object, Object=): Object, applyPatch: function(Object, Object=): Promise<Object>, element: HTMLElement, config: Object, loaderResult: Object, theme: Object }}
 */
export function mountWorkspace(config, container, options = {}) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new Error('mountWorkspace requires a DOM container element.');
  }

  let loader = options.loader || loadWorkspaceConfig;
  let loaderResult = loader(config, {
    catalog: options.catalog,
    strict: options.strictComponents,
  });
  if (!loaderResult?.valid) {
    let message = (loaderResult?.errors || [])
      .map((error) => `${error.path}: ${error.message}`)
      .join('; ');
    throw new Error(`mountWorkspace received invalid config: ${message || 'unknown validation error'}`);
  }
  let currentConfig = loaderResult.config;
  let workspaceState = options.workspaceState || createWorkspaceState(currentConfig, {
    revision: Number.isInteger(options.revision) ? options.revision : 0,
  });
  let routerBundle = createWorkspaceRouter(currentConfig, options);
  let router = routerBundle.router;
  let currentRouterSignature = routerBundle.signature;

  let fragment = container.ownerDocument.createDocumentFragment();
  let wrapper = container.ownerDocument.createElement('div');
  wrapper.className = 'symbiote-workspace';
  wrapper.dataset.workspaceName = currentConfig.name || 'workspace';
  wrapper.dataset.workspaceVersion = currentConfig.version || '0.1.0';
  wrapper.dataset.routerMode = router.mode;
  fragment.appendChild(wrapper);
  container.appendChild(fragment);

  let runtimeMount = options.runtimeController?.mountWorkspace || options.runtimeController?.mount;
  let runtimeHandle = runtimeMount?.call(options.runtimeController, {
    config: currentConfig,
    element: wrapper,
    loaderResult,
    router,
    workspaceState,
    revision: workspaceState.revision,
  });
  if (!runtimeMount && options.renderDefaultPreview !== false) {
    runtimeHandle = renderDefaultWorkspacePreview(currentConfig, wrapper, router);
  }

  let theme = applyWorkspaceTheme(currentConfig, wrapper, options);
  let writeThemeChanges = options.writeThemeChanges !== false;
  let destroyed = false;
  let ready = Promise.resolve();
  let routeUnsubscribe = router.on?.('*', ({ subject }) => {
    if (destroyed || runtimeMount || options.renderDefaultPreview === false) return;
    if (subject.startsWith('route:enter:') || subject === 'route:reset') {
      runtimeHandle = updateDefaultWorkspacePreview(currentConfig, wrapper, runtimeHandle, router);
    }
  });

  function validateNextConfig(nextConfig, updateOptions) {
    let nextLoaderResult = loader(nextConfig, {
      catalog: updateOptions.catalog || options.catalog,
      strict: updateOptions.strictComponents ?? options.strictComponents,
      fragments: updateOptions.fragments || options.fragments,
      fragmentMap: updateOptions.fragmentMap || options.fragmentMap,
      fragmentResolver: updateOptions.fragmentResolver || options.fragmentResolver,
      resolveFragment: updateOptions.resolveFragment || options.resolveFragment,
      packs: updateOptions.packs || options.packs,
    });
    if (!nextLoaderResult?.valid) {
      let message = (nextLoaderResult?.errors || [])
        .map((error) => `${error.path}: ${error.message}`)
        .join('; ');
      throw new Error(`mountWorkspace updateConfig received invalid config: ${message || 'unknown validation error'}`);
    }
    return nextLoaderResult;
  }

  function maybeResetRouter(nextConfig, updateOptions = {}) {
    if (!updateOptions.router) return;
    let nextSignature = routerSignature(normalizeRouterOptions(updateOptions.router));
    if (nextSignature === currentRouterSignature) return;
    router.destroy?.();
    if (typeof routeUnsubscribe === 'function') routeUnsubscribe();
    let nextBundle = createWorkspaceRouter(nextConfig, { ...options, ...updateOptions });
    router = nextBundle.router;
    currentRouterSignature = nextBundle.signature;
    wrapper.dataset.routerMode = router.mode;
    routeUnsubscribe = router.on?.('*', ({ subject }) => {
      if (destroyed || runtimeMount || options.renderDefaultPreview === false) return;
      if (subject.startsWith('route:enter:') || subject === 'route:reset') {
        runtimeHandle = updateDefaultWorkspacePreview(currentConfig, wrapper, runtimeHandle, router);
      }
    });
    assignMountedState(mounted, { router });
  }

  function applyCommittedConfig(nextConfig, nextLoaderResult, updateOptions, commitResult, origin) {
    maybeResetRouter(nextConfig, updateOptions);
    let runtimeUpdate = resolveRuntimeUpdate(options.runtimeController, runtimeHandle);
    if (runtimeUpdate) {
      runtimeUpdate.fn.call(runtimeUpdate.target, {
        ...updateOptions,
        config: nextConfig,
        previousConfig: currentConfig,
        element: wrapper,
        loaderResult: nextLoaderResult,
        previousLoaderResult: loaderResult,
        reason: updateOptions.reason || 'updateConfig',
        router,
        workspaceState,
        revision: commitResult.revision,
        commit: commitResult,
        origin,
      });
    } else if (!runtimeMount && options.renderDefaultPreview !== false) {
      runtimeHandle = updateDefaultWorkspacePreview(nextConfig, wrapper, runtimeHandle, router);
    } else if (runtimeMount) {
      if (typeof runtimeHandle?.destroy === 'function') runtimeHandle.destroy();
      runtimeHandle = runtimeMount.call(options.runtimeController, {
        config: nextConfig,
        element: wrapper,
        loaderResult: nextLoaderResult,
        router,
        workspaceState,
        revision: commitResult.revision,
      });
    }

    currentConfig = nextConfig;
    loaderResult = nextLoaderResult;
    wrapper.dataset.workspaceName = currentConfig.name || 'workspace';
    wrapper.dataset.workspaceVersion = currentConfig.version || '0.1.0';
    theme = applyWorkspaceTheme(currentConfig, wrapper, options);
    publishMountContexts(currentConfig, loaderResult, options);
    assignMountedState(mounted, {
      config: currentConfig,
      loaderResult,
      theme,
      router,
      workspaceState,
      revision: workspaceState.revision,
      lastCommit: commitResult,
    });
    return mounted;
  }

  function commitNextConfig(nextConfig, updateOptions, reason) {
    let mergedOptions = {
      ...options,
      ...updateOptions,
      broadcast: updateOptions.broadcast || options.broadcast,
      reason,
    };
    let origin = originFromOptions(mergedOptions, reason);
    let result = workspaceState.commit([
      { op: 'replace', path: '/', value: nextConfig },
    ], commitOptions(mergedOptions, reason));
    let commitResult = isObject(result) ? { ...result, reason: origin.reason, origin } : result;
    if (result.status !== 'ok') {
      assignMountedState(mounted, { lastCommit: commitResult, revision: workspaceState.revision });
      return { result: commitResult, origin, accepted: false };
    }
    let committedConfig = workspaceState.config;
    origin.baseRevision = result.baseRevision;
    broadcastCommit(mergedOptions, commitResult, origin);
    return { result: commitResult, origin, config: committedConfig, accepted: true };
  }

  let mounted = {
    element: wrapper,
    config: currentConfig,
    loaderResult,
    theme,
    router,
    workspaceState,
    revision: workspaceState.revision,
    ready,
    updateConfig(nextConfig, updateOptions = {}) {
      if (destroyed) {
        throw new Error('mountWorkspace updateConfig() called after destroy().');
      }
      let nextLoaderResult = validateNextConfig(nextConfig, updateOptions);
      let committed = commitNextConfig(nextLoaderResult.config, updateOptions, updateOptions.reason || 'updateConfig');
      if (!committed.accepted) return { ...committed.result, mounted };
      return applyCommittedConfig(committed.config, nextLoaderResult, updateOptions, committed.result, committed.origin);
    },
    async applyPatch(patch, patchOptions = {}) {
      if (destroyed) {
        throw new Error('mountWorkspace applyPatch() called after destroy().');
      }
      let result = await applyValidatedWorkspacePatch(currentConfig, patch, patchOptions);
      if (result.status === 'blocked' || !result.config) {
        let error = new Error('mountWorkspace applyPatch received a blocked workspace patch.');
        error.report = result;
        throw error;
      }
      let updateResult = mounted.updateConfig(result.config, {
        ...patchOptions,
        reason: patchOptions.reason || 'applyPatch',
      });
      return {
        ...result,
        commit: mounted.lastCommit,
        update: updateResult,
        mounted,
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      wrapper.removeEventListener('cascade-theme-change', onThemeChange);
      if (typeof routeUnsubscribe === 'function') routeUnsubscribe();
      router.destroy?.();
      if (typeof runtimeHandle?.destroy === 'function') runtimeHandle.destroy();
      wrapper.remove();
    },
  };
  let onThemeChange = (event) => {
    let detail = event.detail || {};
    if (writeThemeChanges) {
      let nextConfig = cloneJson(currentConfig);
      updateThemeParams(nextConfig, detail.state, detail.targetSelector);
      let nextLoaderResult = validateNextConfig(nextConfig, {
        baseRevision: workspaceState.revision,
      });
      let committed = commitNextConfig(nextLoaderResult.config, {
        baseRevision: workspaceState.revision,
        reason: 'themeChange',
      }, 'themeChange');
      if (committed.accepted) {
        applyCommittedConfig(committed.config, nextLoaderResult, {}, committed.result, committed.origin);
      }
    }
    options.onThemeChange?.({
      config: currentConfig,
      theme,
      event,
      state: detail.state || null,
      targetSelector: detail.targetSelector || null,
    });
  };
  wrapper.addEventListener('cascade-theme-change', onThemeChange);
  publishMountContexts(currentConfig, loaderResult, options);

  let initial = initialRouteRequest(currentConfig, routerBundle.options, container);
  if (initial) {
    ready = router.navigate(initial)
      .then((result) => {
        if (!destroyed && !runtimeMount && options.renderDefaultPreview !== false) {
          runtimeHandle = updateDefaultWorkspacePreview(currentConfig, wrapper, runtimeHandle, router);
        }
        return result;
      });
    mounted.ready = ready;
  }

  return mounted;
}
