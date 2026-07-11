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

export {
  PRESENTATION_CONTRACT_VERSION,
  PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  PRESENTATION_LESSON_AUDIT_SCHEMA_VERSION,
  PRESENTATION_LESSON_REVIEW_CODES,
  PRESENTATION_PROMPT_PROFILES,
  PRESENTATION_REPLAN_REQUEST_SCHEMA_VERSION,
  PRESENTATION_REPLAN_RESULT_SCHEMA_VERSION,
  alignPresentationTimelineToAudio,
  createPresentationLessonAuditPacket,
  createPresentationContextSnapshot,
  createPresentationReplanRequest,
  createPresentationTimelineContract,
  createPresentationTimelineHash,
  createPresentationTtsProjection,
  createWorkspacePresentationTimeline,
  finalizePresentationReplan,
  normalizePresentationPrompt,
  normalizePresentationTimeline,
  presentationTimelineHasTurns,
  reviewPresentationTimeline,
  reviewPresentationTimelineAgainstSnapshot,
  summarizePresentationTimeline,
} from './runtime/presentation.js';
export {
  MEDIA_PROJECT_DEFAULT_SURFACE,
  MEDIA_PROJECT_ROUTE_JOB_PARAM,
  MEDIA_PROJECT_ROUTE_PREVIEW_FRAME_PARAM,
  MEDIA_PROJECT_ROUTE_PREVIEW_MODE_PARAM,
  MEDIA_PROJECT_ROUTE_REATTACH_PARAM,
  MEDIA_PROJECT_ROUTE_PARAM,
  MEDIA_PROJECT_ROUTE_SOURCE_URL_PARAM,
  MEDIA_PROJECT_ROUTE_SOURCE_SURFACE_PARAM,
  MEDIA_PROJECT_ROUTE_SOURCE_TAB_PARAM,
  MEDIA_PROJECT_ROUTE_WORKSPACE_SECTION_PARAM,
  MEDIA_PROJECT_ROUTE_TIMELINE_CURSOR_PARAM,
  MEDIA_PROJECT_ROUTE_TIMELINE_PARAM,
  MEDIA_PROJECT_SCHEMA_VERSION,
  MEDIA_RENDER_DIRTY_SCOPES,
  MEDIA_RENDER_EVENT_SCHEMA_VERSION,
  MEDIA_RENDER_EVENT_TYPES,
  MEDIA_RENDER_READINESS_SCHEMA_VERSION,
  MEDIA_RENDER_SETTINGS_SCHEMA_VERSION,
  applyMediaRenderEvent,
  createMediaProject,
  createMediaProjectId,
  createMediaProjectRouteSearch,
  createMediaRenderEvent,
  createMemoryMediaProjectStore,
  createStorageMediaProjectStore,
  invalidateMediaProjectArtifacts,
  isMediaRenderEventType,
  mapRenderJobEventToMediaRenderEvents,
  mapRenderJobStageToMediaRenderEventType,
  normalizeMediaProject,
  normalizeMediaRenderEvent,
  normalizeMediaRenderReadiness,
  normalizeMediaRenderRouteState,
  normalizeMediaRenderSettings,
  parseMediaProjectRouteSearch,
  selectMediaProjectTimeline,
  updateMediaProjectRenderSettings,
} from './runtime/media-projects.js';
export {
  MEDIA_ARTIFACT_GRAPH_SCHEMA_VERSION,
  MEDIA_ARTIFACT_KINDS,
  MEDIA_ARTIFACT_VERSION_INPUTS,
  MEDIA_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  createMediaArtifactCacheKey,
  createMediaArtifactGraph,
  createMediaEvidenceManifest,
  invalidateMediaArtifactGraph,
  validateMediaArtifactGraph,
  validateMediaEvidenceManifest,
} from './runtime/media-evidence.js';

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
import {
  createPresentationContextSnapshot,
  createPresentationReplanRequest,
  createWorkspacePresentationTimeline,
  finalizePresentationReplan,
} from './runtime/presentation.js';
import { createWorkspaceState } from './runtime/workspace-state.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function clonePortable(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'function') return undefined;
  if (typeof value !== 'object') return value;
  if (value.nodeType || value.ownerDocument || value.documentElement || value.defaultView) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => clonePortable(item))
      .filter((item) => item !== undefined);
  }
  let result = {};
  for (let [key, child] of Object.entries(value)) {
    if (['element', 'el', 'node', 'dom', 'ref', 'refs', 'targetElement'].includes(key)) continue;
    let next = clonePortable(child);
    if (next !== undefined) result[key] = next;
  }
  return result;
}

function compactObject(value) {
  let result = {};
  for (let [key, child] of Object.entries(value || {})) {
    if (child !== undefined) result[key] = child;
  }
  return result;
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
  if (options.themeAdapter?.applyCascadeTheme || options.themeAdapter?.applyCascadeGeometryRegister) return options.themeAdapter;
  let globalUi = globalThis?.SymbioteUI || globalThis?.symbioteUI;
  if (globalUi?.applyCascadeTheme || globalUi?.applyCascadeGeometryRegister) return globalUi;
  return null;
}

function buildThemeOptions(params = {}, relations = {}) {
  if (hasKeys(relations)) {
    return { ...params, relations: { ...relations } };
  }
  return { ...params };
}

function normalizeThemeRegister(register) {
  if (register === 'default' || register == null) return '';
  return typeof register === 'string' ? register : '';
}

function splitThemeParams(params = {}) {
  let next = { ...(params || {}) };
  let hasRegister = Object.hasOwn(next, 'register');
  let register = normalizeThemeRegister(next.register);
  delete next.register;
  return { params: next, register, hasRegister };
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
  let split = splitThemeParams(params);
  let theme = null;
  if (hasKeys(split.params) || hasKeys(relations)) {
    if (!adapter?.applyCascadeTheme) {
      throw new Error(
        'mountWorkspace requires options.themeAdapter.applyCascadeTheme or ' +
        'globalThis.SymbioteUI.applyCascadeTheme to apply cascade theme params.'
      );
    }
    theme = adapter.applyCascadeTheme(element, buildThemeOptions(split.params, relations), eventOptions);
  }
  if (split.hasRegister) {
    if (!adapter?.applyCascadeGeometryRegister) {
      throw new Error(
        'mountWorkspace requires options.themeAdapter.applyCascadeGeometryRegister or ' +
        'globalThis.SymbioteUI.applyCascadeGeometryRegister to apply cascade geometry registers.'
      );
    }
    adapter.applyCascadeGeometryRegister(element, split.register, eventOptions);
  }
  if (theme) return theme;
  if (split.hasRegister) return { state: { register: split.register }, tokens: {} };
  return null;
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

function updateThemeGeometryRegister(config, register, targetSelector) {
  updateThemeParams(config, { params: { register: normalizeThemeRegister(register) } }, targetSelector);
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

function listValue(value) {
  return Array.isArray(value) ? value : [];
}

function moduleDefinition(config, moduleId) {
  if (!isText(moduleId)) return {};
  return (config.modules || []).find((module) => (
    module?.id === moduleId || module?.tagName === moduleId
  )) || {};
}

function panelSafeActions(panel, module) {
  return [
    ...listValue(module.actions),
    ...listValue(panel.actions),
  ];
}

function panelWebMcpTools(panel, module) {
  return [
    ...listValue(module.webmcp?.tools),
    ...listValue(panel.webmcp?.tools),
  ];
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

function childElements(element) {
  return Array.from(element?.children || []);
}

function findElementByCtx(root, ctx) {
  if (!root || !ctx) return null;
  let queue = [root];
  while (queue.length > 0) {
    let current = queue.shift();
    if (current?.getAttribute?.('ctx') === ctx) return current;
    queue.push(...childElements(current));
  }
  return null;
}

function collectLayoutPanelNodes(node, visit, context) {
  if (!isObject(node)) return;
  if (node.kind === 'bsp') {
    collectLayoutPanelNodes(node.root, visit, context);
    return;
  }
  if (node.type === 'split') {
    collectLayoutPanelNodes(node.first, visit, context);
    collectLayoutPanelNodes(node.second, visit, context);
    return;
  }
  if (node.kind === 'stack' || node.type === 'stack') {
    let stackId = node.id || 'root';
    let children = Array.isArray(node.children) ? node.children : [];
    let active = node.active || children[0]?.id || '';
    let stackAddress = `stack:${context.viewId || 'workspace'}:${stackId}`;
    context.stacks.push({
      address: stackAddress,
      viewId: context.viewId,
      stackId,
      active,
      visible: context.visible,
      children: children
        .filter((child) => child?.type === 'panel')
        .map((child) => ({
          id: child.id || child.panel || 'panel',
          panel: child.panel || '',
          active: (child.id || child.panel) === active,
          address: panelCtx(context.viewId, child),
        })),
    });
    for (let child of children) {
      let childId = child?.id || child?.panel || '';
      let activeChild = !active || childId === active;
      let revealActions = context.revealActions;
      let hiddenReasons = context.hiddenReasons;
      if (!activeChild) {
        revealActions = [
          ...revealActions,
          {
            type: 'stack.select',
            target: stackAddress,
            input: { viewId: context.viewId, stackId, childId },
          },
        ];
        hiddenReasons = [...hiddenReasons, 'stack-inactive'];
      }
      collectLayoutPanelNodes(child, visit, {
        ...context,
        visible: context.visible && activeChild,
        revealActions,
        hiddenReasons,
      });
    }
    return;
  }
  if (node.type === 'panel') visit(node, context);
}

function workspaceViews(config) {
  if (Array.isArray(config?.views) && config.views.length > 0) return config.views;
  return [{ id: 'workspace', title: config?.name || 'Workspace', layout: firstLayout(config) }];
}

function viewAddress(view) {
  return `view:${view?.id || 'workspace'}`;
}

function normalizeRuntimeTarget(raw, enrichment = {}) {
  if (!isObject(raw)) return null;
  let portable = clonePortable(raw);
  if (!isObject(portable)) return null;
  let address = portable.address || portable.target || portable.targetRef || portable.id || '';
  if (!isText(address)) return null;
  let extra = enrichment[address] || enrichment[portable.id] || null;
  return {
    ...portable,
    address,
    kind: portable.kind || portable.type || 'component',
    source: 'runtime',
    enrichment: compactObject({
      ...(isObject(portable.enrichment) ? portable.enrichment : {}),
      ...(isObject(extra) ? extra : {}),
    }),
  };
}

function collectRuntimeTargets(root, options, baseContext) {
  let collector = options.targetCollector || options.collectComponentTargets;
  if (typeof collector !== 'function' || !root) return [];
  let result = collector(root, {
    config: baseContext.config,
    activeViewId: baseContext.activeViewId,
    views: baseContext.views,
    panels: baseContext.panels,
    stacks: baseContext.stacks,
  });
  let rawTargets = Array.isArray(result) ? result : result?.targets;
  return listValue(rawTargets)
    .map((target) => normalizeRuntimeTarget(target, options.targetEnrichment || options.enrichment || {}))
    .filter(Boolean);
}

function targetKey(target) {
  return target.address || `${target.kind || 'target'}:${target.id || target.target || ''}`;
}

function mergeTargets(configTargets, runtimeTargets) {
  let merged = new Map();
  for (let target of [...configTargets, ...runtimeTargets]) {
    let key = targetKey(target);
    if (!key) continue;
    let existing = merged.get(key);
    let source = target.source || 'config';
    if (!existing) {
      merged.set(key, {
        source,
        sources: [source],
        ...target,
      });
      continue;
    }
    let sources = new Set([...(existing.sources || [existing.source || 'config']), source]);
    merged.set(key, {
      ...existing,
      ...target,
      visible: Boolean(existing.visible || target.visible),
      revealActions: [
        ...listValue(existing.revealActions),
        ...listValue(target.revealActions),
      ],
      safeActions: [
        ...listValue(existing.safeActions),
        ...listValue(target.safeActions),
      ],
      webmcpTools: [
        ...listValue(existing.webmcpTools),
        ...listValue(target.webmcpTools),
      ],
      enrichment: compactObject({
        ...(isObject(existing.enrichment) ? existing.enrichment : {}),
        ...(isObject(target.enrichment) ? target.enrichment : {}),
      }),
      sources: [...sources],
    });
  }
  return [...merged.values()];
}

function routePresentationContext(router) {
  if (typeof router?.getState !== 'function') return undefined;
  return compactObject({
    view: router.getState('state:route.view'),
    params: router.getState('state:route.params'),
    query: router.getState('state:route.query'),
    mount: router.getState('state:route.mount'),
    data: router.getState('state:route.data'),
    denied: router.getState('state:route.denied'),
  });
}

function collectPresentationDataContext(options, router) {
  let provided = clonePortable(options.dataContext || options.presentationData || {});
  return compactObject({
    route: routePresentationContext(router),
    ...(isObject(provided) ? provided : {}),
  });
}

function timelineSegments(timeline) {
  if (Array.isArray(timeline?.segments)) return timeline.segments;
  if (Array.isArray(timeline)) return timeline;
  return [];
}

function segmentTarget(segment) {
  return segment?.target || segment?.focusTarget || segment?.cues?.find?.((cue) => cue?.target)?.target || '';
}

function findContextTarget(context, address) {
  if (!address) return null;
  return context.targets.find((target) => target.address === address) || null;
}

async function executeRevealAction(action, mounted, options, event) {
  if (action?.type === 'view.select' && action.input?.viewId && mounted.router?.navigate) {
    return mounted.router.navigate({
      to: { view: action.input.viewId },
      history: 'replace',
      source: 'presentation',
    });
  }
  if (typeof options.executeRevealAction === 'function') {
    return options.executeRevealAction(action, event);
  }
  throw new Error(`No presentation reveal executor for action type "${action?.type || 'unknown'}".`);
}

async function executeTimelineAction(action, mounted, options, event) {
  if (!['webmcp', 'host', 'workspace'].includes(action?.source)) {
    throw new Error(`Unsupported presentation action source "${action?.source || 'unknown'}".`);
  }
  let executor = options.executeAction || options.actionExecutor;
  if (typeof executor !== 'function') {
    throw new Error('playWorkspacePresentationTimeline requires executeAction for timeline actions.');
  }
  return executor(action, event);
}

/**
 * Execute a generated presentation timeline against a mounted workspace.
 *
 * The player deliberately uses the same interface context as agents: if a segment
 * targets a hidden view/panel, declared reveal actions run before narration or
 * focus callbacks. Timeline actions are never executed directly; hosts must supply
 * an action executor for declared `webmcp`, `host`, or `workspace` safe actions.
 *
 * @param {Object|Array} timeline
 * @param {{getInterfaceContext: function(Object=): Object, router?: Object}} mounted
 * @param {Object} [options]
 * @returns {Promise<Array<Object>>}
 */
export async function playWorkspacePresentationTimeline(timeline, mounted, options = {}) {
  if (!mounted || typeof mounted.getInterfaceContext !== 'function') {
    throw new Error('playWorkspacePresentationTimeline requires a mounted workspace with getInterfaceContext().');
  }
  let events = [];
  let contextOptions = {
    targetCollector: options.targetCollector || options.collectComponentTargets,
    collectComponentTargets: options.collectComponentTargets,
    targetEnrichment: options.targetEnrichment,
    dataContext: options.dataContext || options.presentationData,
  };
  let context = mounted.getInterfaceContext(contextOptions);

  for (let segment of timelineSegments(timeline)) {
    let targetAddress = segmentTarget(segment);
    let target = findContextTarget(context, targetAddress);
    for (let revealAction of target?.revealActions || []) {
      let event = { type: 'reveal', segment, action: revealAction, target, context };
      await executeRevealAction(revealAction, mounted, options, event);
      events.push({ type: 'reveal', segmentId: segment.id || '', action: clonePortable(revealAction) });
      context = mounted.getInterfaceContext(contextOptions);
      target = findContextTarget(context, targetAddress);
    }

    if (targetAddress) {
      let event = { type: 'focus', segment, target, context };
      await options.onFocus?.(event);
      events.push({ type: 'focus', segmentId: segment.id || '', target: targetAddress });
    }
    for (let cue of segment.cues || []) {
      let event = { type: 'cue', segment, cue, context };
      await options.onCue?.(event);
      events.push({ type: 'cue', segmentId: segment.id || '', cue: clonePortable(cue) });
    }
    for (let action of segment.actions || []) {
      let event = { type: 'action', segment, action, context };
      await executeTimelineAction(action, mounted, options, event);
      events.push({ type: 'action', segmentId: segment.id || '', action: clonePortable(action) });
    }
    if (segment.narration !== undefined) {
      let event = { type: 'narration', segment, context };
      await options.onNarration?.(event);
      events.push({ type: 'narration', segmentId: segment.id || '', narration: clonePortable(segment.narration) });
    }
  }
  return events;
}

function presentationPreparationError(code, message, cause) {
  let error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

/**
 * Prepare a presentation inside the target viewport before audio generation.
 * The host owns all effects; this function owns the bounded, fail-closed order.
 */
export async function prepareWorkspacePresentation(options = {}) {
  for (let name of ['rehydrate', 'collectContext', 'plan', 'executeSafeAction', 'waitForSettlement']) {
    if (typeof options[name] !== 'function') {
      throw presentationPreparationError('TOUR_REPLAN_UNAVAILABLE', `prepareWorkspacePresentation requires ${name}()`);
    }
  }
  let emit = async (type, detail = {}) => options.onEvent?.({ type, ...cloneJson(detail) });
  let collectSnapshot = async (generation) => {
    let context = await options.collectContext({ generation });
    return createPresentationContextSnapshot(context, {
      generation,
      viewport: options.viewport,
      source: options.source,
      stability: { settled: true, waitedFor: options.waitedFor || [] },
    });
  };

  await emit('tour.context.rehydrate.started');
  try {
    await options.rehydrate({ viewport: cloneJson(options.viewport), source: cloneJson(options.source) });
    await options.waitForSettlement({ phase: 'rehydrate' });
  } catch (cause) {
    if (cause?.code) throw cause;
    throw presentationPreparationError('TOUR_HYDRATION_TIMEOUT', 'target viewport did not finish rehydration', cause);
  }
  await emit('tour.context.rehydrate.done');

  let sourceSnapshot = await collectSnapshot(0);
  await emit('tour.context.collected', {
    generation: sourceSnapshot.generation,
    identityHash: sourceSnapshot.identityHash,
    dataHash: sourceSnapshot.dataHash,
    targetCount: sourceSnapshot.summary.targetCount,
  });
  let request = createPresentationReplanRequest({
    request: options.request,
    timeline: options.timeline,
    sourceSnapshot,
    targetSnapshot: sourceSnapshot,
    personaSpec: options.personaSpec,
    turnBudget: options.turnBudget,
    actionBudget: options.actionBudget,
  });
  let candidate;
  try {
    candidate = await options.plan(request, sourceSnapshot);
  } catch (cause) {
    throw presentationPreparationError('TOUR_REPLAN_UNAVAILABLE', 'presentation planner is unavailable', cause);
  }
  if (!candidate || !['ready', 'needs-context'].includes(candidate.status)) {
    throw presentationPreparationError('TOUR_REPLAN_REJECTED', 'presentation planner returned an invalid result');
  }

  let targetSnapshot = sourceSnapshot;
  let snapshotChain = [{ phase: 'source', generation: 0, identityHash: sourceSnapshot.identityHash, dataHash: sourceSnapshot.dataHash }];
  if (candidate.status === 'needs-context') {
    let actions = Array.isArray(candidate.requestedActions) ? candidate.requestedActions : [];
    if (request.actionBudget.remainingRounds < 1 || !actions.length || actions.length > request.actionBudget.remainingActions) {
      throw presentationPreparationError('DEEPENING_BUDGET_EXHAUSTED', 'presentation deepening request exceeds its action budget');
    }
    let allowed = new Set(request.allowedActions.map((action) => `${action.source || 'webmcp'}:${action.tool}:${action.target}`));
    for (let action of actions) {
      let source = String(action?.source || 'webmcp');
      let key = `${source}:${String(action?.tool || '')}:${String(action?.target || '')}`;
      if (!allowed.has(key)) {
        throw presentationPreparationError('DEEPENING_ACTION_UNSAFE', `presentation deepening action is not allowed: ${key}`);
      }
      await emit('tour.deepening.action.started', { generation: 0, source, tool: action.tool, target: action.target });
      try {
        await options.executeSafeAction(cloneJson(action), { snapshot: sourceSnapshot, request });
        await options.waitForSettlement({ phase: 'deepening', action: cloneJson(action) });
      } catch (cause) {
        throw presentationPreparationError('DEEPENING_ACTION_FAILED', `presentation deepening action failed: ${action.tool}`, cause);
      }
      await emit('tour.deepening.action.done', { generation: 0, source, tool: action.tool, target: action.target });
    }
    targetSnapshot = await collectSnapshot(1);
    if (targetSnapshot.identityHash === sourceSnapshot.identityHash && targetSnapshot.dataHash === sourceSnapshot.dataHash) {
      throw presentationPreparationError('DEEPENING_NO_EFFECT', 'presentation deepening actions did not change collected context');
    }
    snapshotChain.push({
      phase: 'target',
      generation: 1,
      identityHash: targetSnapshot.identityHash,
      dataHash: targetSnapshot.dataHash,
      actions: actions.map((action) => ({ source: action.source || 'webmcp', tool: action.tool, target: action.target })),
    });
    request = createPresentationReplanRequest({
      request: options.request,
      timeline: options.timeline,
      sourceSnapshot,
      targetSnapshot,
      personaSpec: options.personaSpec,
      turnBudget: options.turnBudget,
      actionBudget: { remainingRounds: 0, remainingActions: 0 },
    });
    try {
      candidate = await options.plan(request, targetSnapshot);
    } catch (cause) {
      throw presentationPreparationError('TOUR_REPLAN_UNAVAILABLE', 'final presentation planner call is unavailable', cause);
    }
    if (candidate?.status === 'needs-context') {
      throw presentationPreparationError('DEEPENING_BUDGET_EXHAUSTED', 'presentation planner requested another deepening round');
    }
  }

  let finalize = () => finalizePresentationReplan(candidate, request, {
    snapshot: targetSnapshot,
    snapshotChain,
    intent: options.reviewIntent || {},
  });
  let result;
  try {
    result = finalize();
  } catch (cause) {
    let repairLimit = Math.min(1, Math.max(0, Math.floor(Number(options.reviewRepairAttempts) || 0)));
    if (!repairLimit || cause?.code !== 'TOUR_REPLAN_REJECTED' || !cause?.review?.issues?.length) throw cause;
    request = {
      ...request,
      reviewFeedback: {
        attempt: 1,
        issues: cause.review.issues.map((issue) => ({
          code: issue.code,
          turnIndex: issue.turnIndex,
          turnId: issue.turnId,
          message: issue.message,
        })),
      },
    };
    await emit('tour.replan.review-repair.started', request.reviewFeedback);
    try {
      candidate = await options.plan(request, targetSnapshot);
    } catch (repairCause) {
      throw presentationPreparationError('TOUR_REPLAN_UNAVAILABLE', 'presentation review repair call is unavailable', repairCause);
    }
    if (candidate?.status !== 'ready') {
      throw presentationPreparationError(
        candidate?.status === 'needs-context' ? 'DEEPENING_BUDGET_EXHAUSTED' : 'TOUR_REPLAN_REJECTED',
        'presentation review repair did not return a ready timeline',
      );
    }
    result = finalize();
    await emit('tour.replan.review-repair.done', { timelineHash: result.timelineHash });
  }
  await emit('tour.replan.done', {
    generation: targetSnapshot.generation,
    identityHash: targetSnapshot.identityHash,
    timelineHash: result.timelineHash,
  });
  return {
    ...result,
    sourceSnapshot,
    targetSnapshot,
  };
}

/**
 * Build an agent-readable picture of the mounted workspace interface.
 *
 * The result intentionally combines current runtime visibility with full config
 * structure so an agent can explain what is visible, what is hidden, and which
 * safe UI action should reveal a hidden view, stack tab, or panel before it
 * authors a narration/tour timeline.
 *
 * @param {Object} config
 * @param {HTMLElement|null} [root]
 * @param {Object} [options]
 * @param {Object} [options.router]
 * @param {string} [options.viewId]
 * @param {function(HTMLElement, Object): (Array|{targets: Array})} [options.targetCollector]
 * @param {Object} [options.dataContext]
 * @returns {{workspace: Object, activeViewId: string, views: Array, stacks: Array, panels: Array, runtimeTargets: Array, targets: Array, dataContext: Object, summary: Object}}
 */
export function collectWorkspaceInterfaceContext(config, root = null, options = {}) {
  let views = workspaceViews(config);
  let activeView = options.viewId
    ? views.find((view) => view?.id === options.viewId)
    : routedView(config, options.router);
  if (!activeView) activeView = views[0] || { id: 'workspace' };
  let activeViewId = activeView?.id || 'workspace';
  let stacks = [];
  let panels = [];

  let viewRecords = views.map((view) => {
    let id = view?.id || 'workspace';
    let visible = id === activeViewId;
    return {
      id,
      address: viewAddress(view),
      title: localizeLabel(view?.title, id),
      visible,
      route: cloneJson(view?.route || null),
      revealActions: visible ? [] : [{
        type: 'view.select',
        target: viewAddress(view),
        input: { viewId: id },
      }],
    };
  });

  for (let view of views) {
    let viewId = view?.id || 'workspace';
    let visible = viewId === activeViewId;
    let layout = viewLayout(config, view);
    let viewRevealActions = visible ? [] : [{
      type: 'view.select',
      target: viewAddress(view),
      input: { viewId },
    }];
    let viewHiddenReasons = visible ? [] : ['view-inactive'];
    collectLayoutPanelNodes(layout, (node, context) => {
      let address = panelCtx(context.viewId, node);
      let element = findElementByCtx(root, address);
      let rendered = root ? Boolean(element) : undefined;
      let visibleByState = Boolean(context.visible);
      let hiddenReasons = [...context.hiddenReasons];
      if (root && visibleByState && !rendered) hiddenReasons.push('not-rendered');
      let panel = panelDefinition(config, node);
      let moduleId = panelComponent(panel);
      let module = moduleDefinition(config, moduleId);
      panels.push({
        address,
        viewId: context.viewId,
        nodeId: node.id || node.panel || 'panel',
        panelId: node.panel || '',
        title: localizeLabel(node.title, localizeLabel(panel.title, node.panel || 'Panel')),
        module: moduleId,
        visible: visibleByState && (!root || rendered),
        visibleByState,
        rendered,
        hiddenReasons,
        revealActions: cloneJson(context.revealActions),
        behavior: cloneJson(node.behavior || panel.behavior || null),
        safeActions: cloneJson(panelSafeActions(panel, module)),
        webmcpTools: cloneJson(panelWebMcpTools(panel, module)),
      });
    }, {
      viewId,
      visible,
      stacks,
      revealActions: viewRevealActions,
      hiddenReasons: viewHiddenReasons,
    });
  }

  let configTargets = [
    ...viewRecords.map((view) => ({
      address: view.address,
      kind: 'view',
      source: 'config',
      visible: view.visible,
      revealActions: view.revealActions,
    })),
    ...stacks.map((stack) => ({
      address: stack.address,
      kind: 'stack',
      source: 'config',
      visible: stack.visible,
      active: stack.active,
    })),
    ...panels.map((panel) => ({
      address: panel.address,
      kind: 'panel',
      source: 'config',
      visible: panel.visible,
      revealActions: panel.revealActions,
    })),
  ];
  let runtimeTargets = collectRuntimeTargets(root, options, {
    config,
    activeViewId,
    views: viewRecords,
    stacks,
    panels,
  });
  let targets = mergeTargets(configTargets, runtimeTargets);

  let visiblePanels = panels.filter((panel) => panel.visible).length;
  return {
    workspace: {
      name: config?.name || 'workspace',
      version: config?.version || '',
    },
    activeViewId,
    views: viewRecords,
    stacks,
    panels,
    runtimeTargets,
    targets,
    dataContext: collectPresentationDataContext(options, options.router),
    summary: {
      viewCount: viewRecords.length,
      stackCount: stacks.length,
      panelCount: panels.length,
      visiblePanelCount: visiblePanels,
      hiddenPanelCount: panels.length - visiblePanels,
      runtimeTargetCount: runtimeTargets.length,
    },
  };
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
    getInterfaceContext(contextOptions = {}) {
      return collectWorkspaceInterfaceContext(currentConfig, wrapper, {
        router,
        ...contextOptions,
      });
    },
    playPresentationTimeline(timeline, timelineOptions = {}) {
      return playWorkspacePresentationTimeline(timeline, mounted, timelineOptions);
    },
    createPresentationTimeline(request = {}, contextOptions = {}) {
      let input = typeof request === 'string' ? { prompt: request } : request || {};
      let options = isObject(input.contextOptions)
        ? { ...contextOptions, ...input.contextOptions }
        : contextOptions;
      return createWorkspacePresentationTimeline(mounted.getInterfaceContext(options), input);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      wrapper.removeEventListener('cascade-theme-change', onThemeChange);
      wrapper.removeEventListener('cascade-geometry-register-change', onGeometryRegisterChange);
      if (typeof routeUnsubscribe === 'function') routeUnsubscribe();
      router.destroy?.();
      if (typeof runtimeHandle?.destroy === 'function') runtimeHandle.destroy();
      wrapper.remove();
    },
  };

  function commitThemeMutation(mutator, reason) {
    if (!writeThemeChanges) return;
    let nextConfig = cloneJson(currentConfig);
    mutator(nextConfig);
    let nextLoaderResult = validateNextConfig(nextConfig, {
      baseRevision: workspaceState.revision,
    });
    let committed = commitNextConfig(nextLoaderResult.config, {
      baseRevision: workspaceState.revision,
      reason,
    }, reason);
    if (committed.accepted) {
      applyCommittedConfig(committed.config, nextLoaderResult, {}, committed.result, committed.origin);
    }
  }

  let onThemeChange = (event) => {
    let detail = event.detail || {};
    commitThemeMutation((nextConfig) => {
      updateThemeParams(nextConfig, detail.state, detail.targetSelector);
    }, 'themeChange');
    options.onThemeChange?.({
      config: currentConfig,
      theme,
      event,
      state: detail.state || null,
      targetSelector: detail.targetSelector || null,
    });
  };
  let onGeometryRegisterChange = (event) => {
    let detail = event.detail || {};
    commitThemeMutation((nextConfig) => {
      updateThemeGeometryRegister(nextConfig, detail.register, detail.targetSelector);
    }, 'themeGeometryChange');
    options.onThemeChange?.({
      config: currentConfig,
      theme,
      event,
      state: { register: normalizeThemeRegister(detail.register) },
      targetSelector: detail.targetSelector || null,
    });
  };
  wrapper.addEventListener('cascade-theme-change', onThemeChange);
  wrapper.addEventListener('cascade-geometry-register-change', onGeometryRegisterChange);
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
