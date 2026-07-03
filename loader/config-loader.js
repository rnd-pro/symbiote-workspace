import { FRAGMENT_SLOTS } from '../schema/constants.js';
import { computeIntegrity } from '../schema/canonical-json.js';
import { validateWorkspaceConfig } from '../validation/core.js';

/**
 * @typedef {Object} LoaderResult
 * @property {boolean} valid - Whether config validation passed
 * @property {import('../validation/core.js').ValidationError[]} errors
 * @property {import('../validation/core.js').ValidationError[]} warnings
 * @property {import('../schema/workspace-schema.js').WorkspaceConfig} config
 * @property {ResolvedComponent[]} resolvedComponents
 * @property {string[]} missingComponents
 * @property {ResolvedFragment[]} fragments
 */

/**
 * @typedef {Object} ResolvedComponent
 * @property {string} tagName - Component tag name
 * @property {string} source - 'catalog' | 'custom' | 'fallback'
 */

/**
 * @typedef {Object} ResolvedFragment
 * @property {string} path
 * @property {Object} ref
 * @property {string} integrity
 */

/**
 * @typedef {Object} ComponentCatalog
 * @property {function(string): boolean} has - Check if tag exists in catalog
 * @property {function(): string[]} list - List available tags
 */

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function loaderError(path, code, message) {
  return { path, code, message, severity: 'error' };
}

function slotTemplateToRegExp(template) {
  let pattern = template
    .split(/(<id>|\[\*\])/)
    .map((part) => {
      if (part === '<id>') return '[^.\\[\\]]+';
      if (part === '[*]') return '\\[\\d+\\]';
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${pattern}$`);
}

const FRAGMENT_SLOT_PATTERNS = FRAGMENT_SLOTS.map(slotTemplateToRegExp);
const SRI_INTEGRITY_PATTERN = /^(?:sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/;

function isFragmentSlot(path) {
  return FRAGMENT_SLOT_PATTERNS.some((pattern) => pattern.test(path));
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isFragmentHolder(value) {
  return isObject(value) && hasOwn(value, '$fragment');
}

function hasNestedFragment(value) {
  if (Array.isArray(value)) return value.some(hasNestedFragment);
  if (!isObject(value)) return false;
  if (hasOwn(value, '$fragment')) return true;
  return Object.values(value).some(hasNestedFragment);
}

export function computeFragmentIntegrity(value) {
  return computeIntegrity(value);
}

function normalizeFragmentResolverResult(result) {
  if (isObject(result) && hasOwn(result, 'body')) return result.body;
  if (isObject(result) && hasOwn(result, 'value') && hasOwn(result, 'integrity')) return result.value;
  return result;
}

function fragmentKeyCandidates(ref) {
  let keys = [];
  if (typeof ref.ref === 'string') keys.push(ref.ref);
  if (typeof ref.pack === 'string' && typeof ref.path === 'string') {
    keys.push(`${ref.pack}:${ref.path}`, `${ref.pack}/${ref.path}`, `${ref.pack}@${ref.path}`, ref.path);
  }
  return keys;
}

function resolveFragmentFromMaps(ref, options) {
  let stores = [
    options.fragments,
    options.fragmentMap,
    options.fragmentStore,
  ].filter(Boolean);
  for (let store of stores) {
    for (let key of fragmentKeyCandidates(ref)) {
      if (store instanceof Map && store.has(key)) return store.get(key);
      if (isObject(store) && hasOwn(store, key)) return store[key];
    }
  }

  if (isObject(options.packs) && typeof ref.pack === 'string' && typeof ref.path === 'string') {
    let pack = options.packs[ref.pack];
    if (pack instanceof Map && pack.has(ref.path)) return pack.get(ref.path);
    if (isObject(pack) && hasOwn(pack, ref.path)) return pack[ref.path];
  }

  return undefined;
}

function resolveFragmentValue(ref, path, options) {
  let resolver = options.resolveFragment || options.fragmentResolver;
  if (typeof resolver === 'function') {
    return normalizeFragmentResolverResult(resolver(ref, { path }));
  }
  return normalizeFragmentResolverResult(resolveFragmentFromMaps(ref, options));
}

function validateFragmentRef(ref, path, errors, insideFragment) {
  if (insideFragment) {
    errors.push(loaderError(path, 'loader.fragment.nested', 'Nested $fragment is forbidden (fragments resolve at depth 1).'));
    return false;
  }
  if (!isFragmentSlot(path)) {
    errors.push(loaderError(path, 'loader.fragment.slot', `$fragment is not permitted at "${path}".`));
  }
  if (!isObject(ref)) {
    errors.push(loaderError(path, 'loader.fragment.ref', '$fragment must be an object.'));
    return false;
  }
  if (hasOwn(ref, '$fragment')) {
    errors.push(loaderError(`${path}.$fragment`, 'loader.fragment.nested', 'Nested $fragment is forbidden (fragments resolve at depth 1).'));
  }
  if (typeof ref.integrity !== 'string' || !SRI_INTEGRITY_PATTERN.test(ref.integrity)) {
    errors.push(loaderError(`${path}.$fragment.integrity`, 'loader.fragment.integrity', '$fragment requires a mandatory SRI integrity string.'));
  }
  let hasPack = typeof ref.pack === 'string' && typeof ref.path === 'string';
  let hasRegistry = typeof ref.ref === 'string';
  if (!hasPack && !hasRegistry) {
    errors.push(loaderError(`${path}.$fragment`, 'loader.fragment.ref', '$fragment must carry { pack, path } or { ref }.'));
  }
  return errors.length === 0;
}

function resolveFragmentNode(node, path, options, report, insideFragment = false) {
  if (Array.isArray(node)) {
    return node.map((item, index) => resolveFragmentNode(item, `${path}[${index}]`, options, report, insideFragment));
  }
  if (!isObject(node)) return node;

  if (isFragmentHolder(node)) {
    let before = report.errors.length;
    let ref = node.$fragment;
    validateFragmentRef(ref, path, report.errors, insideFragment);
    if (report.errors.length > before) return node;

    let value = resolveFragmentValue(ref, path, options);
    if (value === undefined) {
      report.errors.push(loaderError(path, 'loader.fragment.missing', `No fragment body found for "${fragmentKeyCandidates(ref)[0] || path}".`));
      return node;
    }
    if (hasNestedFragment(value)) {
      report.errors.push(loaderError(path, 'loader.fragment.nested', 'Resolved fragment body contains a nested $fragment.'));
      return node;
    }
    if (ref.integrity.startsWith('sha256-')) {
      let actual = computeFragmentIntegrity(value);
      if (actual !== ref.integrity) {
        report.errors.push(loaderError(path, 'loader.fragment.integrity_mismatch', `Fragment integrity mismatch at "${path}".`));
        return node;
      }
    } else {
      report.errors.push(loaderError(path, 'loader.fragment.integrity_unsupported', 'Only sha256 fragment integrity can be verified by the synchronous loader.'));
      return node;
    }

    report.fragments.push({ path, ref: cloneJson(ref), integrity: ref.integrity });
    return resolveFragmentNode(cloneJson(value), path, options, report, true);
  }

  let next = {};
  for (let [key, value] of Object.entries(node)) {
    let childPath = path ? `${path}.${key}` : key;
    next[key] = resolveFragmentNode(value, childPath, options, report, insideFragment);
  }
  return next;
}

export function resolveWorkspaceFragments(config, options = {}) {
  let report = { errors: [], fragments: [] };
  let resolved = resolveFragmentNode(config, '', options, report, false);
  return {
    valid: report.errors.length === 0,
    errors: report.errors,
    fragments: report.fragments,
    config: resolved,
  };
}

function collectPanelPlacementModules(panels, tags = new Set()) {
  if (!isObject(panels)) return tags;
  for (let panel of Object.values(panels)) {
    if (panel?.module) tags.add(panel.module);
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
  let fragments = resolveWorkspaceFragments(config, options);
  if (!fragments.valid) {
    return {
      valid: false,
      errors: fragments.errors,
      warnings: [],
      config: fragments.config,
      resolvedComponents: [],
      missingComponents: [],
      fragments: fragments.fragments,
    };
  }

  let resolvedConfig = fragments.config;
  let validation = validateWorkspaceConfig(resolvedConfig);
  if (!validation.ok) {
    return {
      valid: false,
      errors: validation.errors,
      warnings: validation.warnings,
      config: resolvedConfig,
      resolvedComponents: [],
      missingComponents: [],
      fragments: fragments.fragments,
    };
  }

  let panelModuleTags = collectPanelPlacementModules(resolvedConfig.panels);
  let catalogTags = resolvedConfig.components?.catalog || [];
  let customTags = (resolvedConfig.components?.custom || []).map((c) => c.tagName).filter(Boolean);

  let allTags = new Set([...panelModuleTags, ...catalogTags, ...customTags]);
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
      config: resolvedConfig,
      resolvedComponents,
      missingComponents,
      fragments: fragments.fragments,
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
    config: resolvedConfig,
    resolvedComponents,
    missingComponents,
    fragments: fragments.fragments,
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
 * @returns {Object} - Relative theme relation modifiers
 */
export function extractThemeRelations(config) {
  if (!isObject(config?.theme)) return {};
  return {
    ...(config.theme.relations || {}),
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
