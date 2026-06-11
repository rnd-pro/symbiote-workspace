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
  WORKSPACE_CONFIG_SCHEMA,
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
  exportConfig,
  importConfig,
  diffConfigs,
  mergeConfigs,
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
  PLUGIN_CATEGORIES,
  validatePluginDefinition,
  registerPlugin,
  activatePlugin,
  unregisterPlugin,
  listPlugins,
  getPlugin,
  getPluginStatus,
  clearPlugins,
  validatePlugin,
} from './plugins/index.js';

import {
  extractThemeOverrides,
  extractThemeParams,
  extractThemeRelations,
  extractThemeSubtrees,
  loadWorkspaceConfig,
} from './loader/index.js';

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
 * @param {Object} [options.themeAdapter] - Object with applyCascadeTheme(element, options, eventOptions)
 * @param {function(Object): void} [options.onThemeChange] - Called after editor/widget theme changes
 * @param {boolean} [options.writeThemeChanges] - Persist cascade-theme-change state into config
 * @returns {{ destroy: function(): void, element: HTMLElement, config: Object, loaderResult: Object, theme: Object }}
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

  let fragment = container.ownerDocument.createDocumentFragment();
  let wrapper = container.ownerDocument.createElement('div');
  wrapper.className = 'symbiote-workspace';
  wrapper.dataset.workspaceName = config.name || 'workspace';
  wrapper.dataset.workspaceVersion = config.version || '0.1.0';
  fragment.appendChild(wrapper);
  container.appendChild(fragment);

  let runtimeMount = options.runtimeController?.mountWorkspace || options.runtimeController?.mount;
  let runtimeHandle = runtimeMount?.call(options.runtimeController, {
    config,
    element: wrapper,
    loaderResult,
  });

  let theme = applyWorkspaceTheme(config, wrapper, options);
  let writeThemeChanges = options.writeThemeChanges !== false;
  let onThemeChange = (event) => {
    let detail = event.detail || {};
    if (writeThemeChanges) {
      updateThemeParams(config, detail.state, detail.targetSelector);
    }
    options.onThemeChange?.({
      config,
      event,
      state: detail.state || null,
      targetSelector: detail.targetSelector || null,
    });
  };
  wrapper.addEventListener('cascade-theme-change', onThemeChange);

  return {
    element: wrapper,
    config,
    loaderResult,
    theme,
    destroy() {
      wrapper.removeEventListener('cascade-theme-change', onThemeChange);
      if (typeof runtimeHandle?.destroy === 'function') runtimeHandle.destroy();
      wrapper.remove();
    },
  };
}
