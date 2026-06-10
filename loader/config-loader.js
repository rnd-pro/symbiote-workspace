import { validateWorkspaceConfig } from '../schema/validate.js';

/**
 * @typedef {Object} LoaderResult
 * @property {boolean} valid - Whether config validation passed
 * @property {import('../schema/validate.js').ValidationError[]} errors
 * @property {import('../schema/validate.js').ValidationError[]} warnings
 * @property {import('../schema/workspace-schema.js').WorkspaceConfig} config
 * @property {ResolvedComponent[]} resolvedComponents
 * @property {string[]} missingComponents
 */

/**
 * @typedef {Object} ResolvedComponent
 * @property {string} tagName - Component tag name
 * @property {string} source - 'catalog' | 'custom' | 'fallback'
 */

/**
 * @typedef {Object} ComponentCatalog
 * @property {function(string): boolean} has - Check if tag exists in catalog
 * @property {function(): string[]} list - List available tags
 */

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectComponentTags(layout, tags = new Set()) {
  if (!isObject(layout)) return tags;
  // BSP format: panelType in panels, recurse into first/second
  if (layout.component) tags.add(layout.component);
  if (layout.type === 'panel' && layout.panelType) {
    // Tag will be resolved from panelTypes later
  }
  if (layout.type === 'split') {
    if (layout.first) collectComponentTags(layout.first, tags);
    if (layout.second) collectComponentTags(layout.second, tags);
  }
  // Legacy children[] format
  if (Array.isArray(layout.children)) {
    for (let child of layout.children) {
      collectComponentTags(child, tags);
    }
  }
  return tags;
}

/**
 * Collect component tags from panelTypes definitions.
 * @param {Object} panelTypes
 * @param {Set<string>} tags
 * @returns {Set<string>}
 */
function collectPanelTypeComponents(panelTypes, tags = new Set()) {
  if (!isObject(panelTypes)) return tags;
  for (let pt of Object.values(panelTypes)) {
    if (pt.component) tags.add(pt.component);
  }
  return tags;
}

/**
 * @param {import('../schema/workspace-schema.js').WorkspaceConfig} config
 * @param {Object} [options]
 * @param {ComponentCatalog} [options.catalog] - Component catalog for resolution
 * @param {boolean} [options.strict] - Fail on missing components
 * @returns {LoaderResult}
 */
export function loadWorkspaceConfig(config, options = {}) {
  let validation = validateWorkspaceConfig(config);
  if (!validation.valid) {
    return {
      valid: false,
      errors: validation.errors,
      warnings: validation.warnings,
      config,
      resolvedComponents: [],
      missingComponents: [],
    };
  }

  let layoutTags = collectComponentTags(config.layout);
  let panelTypeTags = collectPanelTypeComponents(config.panelTypes);
  let catalogTags = config.components?.catalog || [];
  let customTags = (config.components?.custom || []).map((c) => c.tagName).filter(Boolean);

  let allTags = new Set([...layoutTags, ...panelTypeTags, ...catalogTags, ...customTags]);
  let customSet = new Set(customTags);
  let catalog = options.catalog || { has: () => false, list: () => [] };

  let resolvedComponents = [];
  let missingComponents = [];

  for (let tag of allTags) {
    if (customSet.has(tag)) {
      resolvedComponents.push({ tagName: tag, source: 'custom' });
    } else if (catalog.has(tag)) {
      resolvedComponents.push({ tagName: tag, source: 'catalog' });
    } else {
      missingComponents.push(tag);
      resolvedComponents.push({ tagName: tag, source: 'fallback' });
    }
  }

  if (options.strict && missingComponents.length > 0) {
    validation.errors.push({
      path: 'components',
      message: `Missing components: ${missingComponents.join(', ')}. No fallback in strict mode.`,
      severity: 'error',
    });
    return {
      valid: false,
      errors: validation.errors,
      warnings: validation.warnings,
      config,
      resolvedComponents,
      missingComponents,
    };
  }

  if (missingComponents.length > 0) {
    validation.warnings.push({
      path: 'components',
      message: `Components not found in catalog (will use fallback): ${missingComponents.join(', ')}.`,
      severity: 'warning',
    });
  }

  return {
    valid: true,
    errors: validation.errors,
    warnings: validation.warnings,
    config,
    resolvedComponents,
    missingComponents,
  };
}

/**
 * @param {import('../schema/workspace-schema.js').WorkspaceConfig} config
 * @returns {Object} - Theme params ready for createCascadeTheme()
 */
export function extractThemeParams(config) {
  if (!isObject(config?.theme)) return {};
  return {
    ...(config.theme.params || {}),
  };
}

/**
 * @param {import('../schema/workspace-schema.js').WorkspaceConfig} config
 * @returns {Object} - Token overrides map
 */
export function extractThemeOverrides(config) {
  if (!isObject(config?.theme)) return {};
  return { ...(config.theme.overrides || {}) };
}

/**
 * @param {import('../schema/workspace-schema.js').WorkspaceConfig} config
 * @returns {Array} - Subtree theme scoping
 */
export function extractThemeSubtrees(config) {
  if (!isObject(config?.theme)) return [];
  return Array.isArray(config.theme.subtrees) ? [...config.theme.subtrees] : [];
}
