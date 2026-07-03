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

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasKeys(value) {
  return isObject(value) && Object.keys(value).length > 0;
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

function renderPreviewPanel(config, node, document) {
  let panel = config.panelTypes?.[node.panelType] || {};
  let element = document.createElement('section');
  element.className = 'symbiote-workspace__panel';
  element.dataset.panelType = node.panelType || 'unknown';
  if (panel.component) element.dataset.component = panel.component;
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
    panel.title || node.panelType || 'Panel'
  ));
  setStyles(title, {
    margin: '0',
    'font-size': '1rem',
    'font-weight': '650',
    'line-height': '1.25',
  });
  if (panel.component) {
    let component = appendTextElement(document, element, 'p', 'symbiote-workspace__panel-component', panel.component);
    setStyles(component, {
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

function renderPreviewLayout(config, node, document) {
  if (!isObject(node)) return null;
  if (node.type === 'panel') return renderPreviewPanel(config, node, document);
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

  let first = renderPreviewLayout(config, node.first, document);
  let second = renderPreviewLayout(config, node.second, document);
  if (first) first.style.setProperty('flex', `${Number(node.ratio) || 0.5} 1 0`);
  if (second) second.style.setProperty('flex', `${1 - (Number(node.ratio) || 0.5)} 1 0`);
  if (first) element.appendChild(first);
  if (second) element.appendChild(second);
  return element;
}

function renderDefaultWorkspacePreview(config, wrapper) {
  let layout = firstLayout(config);
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
  let renderedLayout = renderPreviewLayout(config, layout, document);
  if (renderedLayout) preview.appendChild(renderedLayout);
  wrapper.appendChild(preview);
  return {
    destroy() {
      preview.remove();
    },
  };
}

function updateDefaultWorkspacePreview(config, wrapper, runtimeHandle) {
  if (typeof runtimeHandle?.destroy === 'function') runtimeHandle.destroy();
  return renderDefaultWorkspacePreview(config, wrapper);
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
  let currentConfig = config;
  let loaderResult = loader(currentConfig, {
    catalog: options.catalog,
    strict: options.strictComponents,
  });
  if (!loaderResult?.valid) {
    let message = (loaderResult?.errors || [])
      .map((error) => `${error.path}: ${error.message}`)
      .join('; ');
    throw new Error(`mountWorkspace received invalid config: ${message || 'unknown validation error'}`);
  }

  let fragment = container.ownerDocument.createDocumentFragment();
  let wrapper = container.ownerDocument.createElement('div');
  wrapper.className = 'symbiote-workspace';
  wrapper.dataset.workspaceName = currentConfig.name || 'workspace';
  wrapper.dataset.workspaceVersion = currentConfig.version || '0.1.0';
  fragment.appendChild(wrapper);
  container.appendChild(fragment);

  let runtimeMount = options.runtimeController?.mountWorkspace || options.runtimeController?.mount;
  let runtimeHandle = runtimeMount?.call(options.runtimeController, {
    config: currentConfig,
    element: wrapper,
    loaderResult,
  });
  if (!runtimeMount && options.renderDefaultPreview !== false) {
    runtimeHandle = renderDefaultWorkspacePreview(currentConfig, wrapper);
  }

  let theme = applyWorkspaceTheme(currentConfig, wrapper, options);
  let writeThemeChanges = options.writeThemeChanges !== false;
  let destroyed = false;
  let mounted = {
    element: wrapper,
    config: currentConfig,
    loaderResult,
    theme,
    updateConfig(nextConfig, updateOptions = {}) {
      if (destroyed) {
        throw new Error('mountWorkspace updateConfig() called after destroy().');
      }
      let nextLoaderResult = loader(nextConfig, {
        catalog: updateOptions.catalog || options.catalog,
        strict: updateOptions.strictComponents ?? options.strictComponents,
      });
      if (!nextLoaderResult?.valid) {
        let message = (nextLoaderResult?.errors || [])
          .map((error) => `${error.path}: ${error.message}`)
          .join('; ');
        throw new Error(`mountWorkspace updateConfig received invalid config: ${message || 'unknown validation error'}`);
      }

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
        });
      } else if (!runtimeMount && options.renderDefaultPreview !== false) {
        runtimeHandle = updateDefaultWorkspacePreview(nextConfig, wrapper, runtimeHandle);
      } else if (runtimeMount) {
        if (typeof runtimeHandle?.destroy === 'function') runtimeHandle.destroy();
        runtimeHandle = runtimeMount.call(options.runtimeController, {
          config: nextConfig,
          element: wrapper,
          loaderResult: nextLoaderResult,
        });
      }

      currentConfig = nextConfig;
      loaderResult = nextLoaderResult;
      wrapper.dataset.workspaceName = currentConfig.name || 'workspace';
      wrapper.dataset.workspaceVersion = currentConfig.version || '0.1.0';
      theme = applyWorkspaceTheme(currentConfig, wrapper, options);
      assignMountedState(mounted, { config: currentConfig, loaderResult, theme });
      return mounted;
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
      mounted.updateConfig(result.config, {
        ...patchOptions,
        reason: patchOptions.reason || 'applyPatch',
      });
      return {
        ...result,
        mounted,
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      wrapper.removeEventListener('cascade-theme-change', onThemeChange);
      if (typeof runtimeHandle?.destroy === 'function') runtimeHandle.destroy();
      wrapper.remove();
    },
  };
  let onThemeChange = (event) => {
    let detail = event.detail || {};
    if (writeThemeChanges) {
      updateThemeParams(currentConfig, detail.state, detail.targetSelector);
      theme = applyWorkspaceTheme(currentConfig, wrapper, options);
      assignMountedState(mounted, { config: currentConfig, loaderResult, theme });
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

  return mounted;
}
