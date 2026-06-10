import {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_REGISTER_VALUES,
  COLLAPSE_POLICIES,
  OVERFLOW_POLICIES,
  RESPONSIVE_MODES,
  MOBILE_DOCKS,
  SWIPE_CONTROLS,
} from './workspace-schema.js';

/** @type {Set<string>} */
let BLOCKED_CONFIG_PATTERNS = new Set([
  'token',
  'apikey',
  'api_key',
  'secret',
  'password',
  'cookie',
  'session',
  'authorization',
  'auth',
  'credential',
]);

/** @type {Set<string>} */
let BLOCKED_VALUE_PATTERNS = new Set([
  'http://',
  'https://',
  'ws://',
  'wss://',
  'localhost',
  '127.0.0.1',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectKeys(obj, prefix = '', result = []) {
  if (!isObject(obj)) return result;
  for (let key of Object.keys(obj)) {
    let fullKey = prefix ? `${prefix}.${key}` : key;
    result.push(fullKey);
    collectKeys(obj[key], fullKey, result);
  }
  return result;
}

function collectStringValues(obj, result = []) {
  if (typeof obj === 'string') {
    result.push(obj);
    return result;
  }
  if (Array.isArray(obj)) {
    for (let item of obj) collectStringValues(item, result);
    return result;
  }
  if (isObject(obj)) {
    for (let value of Object.values(obj)) collectStringValues(value, result);
  }
  return result;
}

/**
 * @typedef {Object} ValidationError
 * @property {string} path - JSON path to the problematic field
 * @property {string} message - Description of the error
 * @property {string} severity - 'error' | 'warning'
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the config passed validation
 * @property {ValidationError[]} errors
 * @property {ValidationError[]} warnings
 */

/**
 * @param {import('./workspace-schema.js').WorkspaceConfig} config
 * @param {Object} [options]
 * @param {boolean} [options.strict] - Reject unknown top-level keys
 * @returns {ValidationResult}
 */
export function validateWorkspaceConfig(config, options = {}) {
  let errors = [];
  let warnings = [];

  if (!isObject(config)) {
    errors.push({ path: '', message: 'Config must be a plain object.', severity: 'error' });
    return { valid: false, errors, warnings };
  }

  if (!config.version) {
    errors.push({ path: 'version', message: 'Missing required field: version.', severity: 'error' });
  } else if (typeof config.version !== 'string') {
    errors.push({ path: 'version', message: 'Field "version" must be a string.', severity: 'error' });
  }

  if (!config.name) {
    errors.push({ path: 'name', message: 'Missing required field: name.', severity: 'error' });
  } else if (typeof config.name !== 'string') {
    errors.push({ path: 'name', message: 'Field "name" must be a string.', severity: 'error' });
  }

  if (config.register !== undefined) {
    if (!WORKSPACE_REGISTER_VALUES.includes(config.register)) {
      errors.push({
        path: 'register',
        message: `Invalid register value: "${config.register}". Allowed: ${WORKSPACE_REGISTER_VALUES.join(', ')}.`,
        severity: 'error',
      });
    }
  }

  if (config.theme !== undefined && !isObject(config.theme)) {
    errors.push({ path: 'theme', message: 'Field "theme" must be an object.', severity: 'error' });
  }

  if (config.layout !== undefined && !isObject(config.layout)) {
    errors.push({ path: 'layout', message: 'Field "layout" must be an object.', severity: 'error' });
  }

  if (config.layout && isObject(config.layout)) {
    validateLayoutNode(config.layout, 'layout', errors, warnings);
  }

  // Validate named layouts
  if (config.layouts !== undefined) {
    if (!isObject(config.layouts)) {
      errors.push({ path: 'layouts', message: 'Field "layouts" must be an object.', severity: 'error' });
    } else {
      for (let [layoutId, layoutNode] of Object.entries(config.layouts)) {
        validateLayoutNode(layoutNode, `layouts.${layoutId}`, errors, warnings);
      }
    }
  }

  // Validate groups
  if (config.groups !== undefined) {
    if (!Array.isArray(config.groups)) {
      errors.push({ path: 'groups', message: 'Field "groups" must be an array.', severity: 'error' });
    } else {
      validateGroups(config.groups, errors, warnings);
    }
  }

  // Validate sections
  if (config.sections !== undefined) {
    if (!Array.isArray(config.sections)) {
      errors.push({ path: 'sections', message: 'Field "sections" must be an array.', severity: 'error' });
    } else {
      let groupIds = new Set((config.groups || []).map((g) => g.id));
      validateSections(config.sections, groupIds, errors, warnings);
    }
  }

  // Validate panelTypes
  if (config.panelTypes !== undefined) {
    if (!isObject(config.panelTypes)) {
      errors.push({ path: 'panelTypes', message: 'Field "panelTypes" must be an object.', severity: 'error' });
    } else {
      validatePanelTypes(config.panelTypes, errors, warnings);
    }
  }

  // Validate events
  if (config.events !== undefined) {
    if (!Array.isArray(config.events)) {
      errors.push({ path: 'events', message: 'Field "events" must be an array.', severity: 'error' });
    } else {
      validateEvents(config.events, errors, warnings);
    }
  }

  // Validate rootBehavior
  if (config.rootBehavior !== undefined) {
    validateBehavior(config.rootBehavior, 'rootBehavior', errors, warnings);
  }

  // Cross-reference: layout panelTypes → panelTypes definitions
  if (config.panelTypes && config.layout) {
    crossReferenceLayout(config.layout, config.panelTypes, 'layout', errors, warnings);
  }

  if (config.components !== undefined && !isObject(config.components)) {
    errors.push({ path: 'components', message: 'Field "components" must be an object.', severity: 'error' });
  }

  if (options.strict) {
    let knownKeys = new Set([
      'version', 'name', 'register', 'theme', 'layout', 'layouts',
      'components', 'data', 'engine', 'groups', 'sections', 'panelTypes',
      'events', 'rootBehavior',
    ]);
    for (let key of Object.keys(config)) {
      if (!knownKeys.has(key)) {
        errors.push({
          path: key,
          message: `Unknown top-level key: "${key}".`,
          severity: 'error',
        });
      }
    }
  }

  checkPortability(config, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

let LAYOUT_TYPES = new Set(['panel', 'split']);

function validateLayoutNode(node, path, errors, warnings) {
  if (!isObject(node)) return;

  if (!node.type) {
    errors.push({
      path: `${path}.type`,
      message: 'Layout node requires a "type" field.',
      severity: 'error',
    });
    return;
  }

  if (!LAYOUT_TYPES.has(node.type)) {
    warnings.push({
      path: `${path}.type`,
      message: `Unknown layout type: "${node.type}". Expected: panel or split.`,
      severity: 'warning',
    });
  }

  if (node.type === 'panel') {
    if (!node.panelType || typeof node.panelType !== 'string') {
      warnings.push({
        path: `${path}.panelType`,
        message: 'Panel node should have a "panelType" string.',
        severity: 'warning',
      });
    }
  }

  if (node.type === 'split') {
    if (!node.direction || !['horizontal', 'vertical'].includes(node.direction)) {
      errors.push({
        path: `${path}.direction`,
        message: 'Split node requires direction: "horizontal" or "vertical".',
        severity: 'error',
      });
    }

    if (node.ratio !== undefined) {
      if (typeof node.ratio !== 'number' || node.ratio < 0.05 || node.ratio > 0.95) {
        errors.push({
          path: `${path}.ratio`,
          message: 'Split ratio must be a number between 0.05 and 0.95.',
          severity: 'error',
        });
      }
    }

    if (!node.first) {
      errors.push({
        path: `${path}.first`,
        message: 'Split node requires a "first" child.',
        severity: 'error',
      });
    } else {
      validateLayoutNode(node.first, `${path}.first`, errors, warnings);
    }

    if (!node.second) {
      errors.push({
        path: `${path}.second`,
        message: 'Split node requires a "second" child.',
        severity: 'error',
      });
    } else {
      validateLayoutNode(node.second, `${path}.second`, errors, warnings);
    }
  }

  if (node.behavior) {
    validateBehavior(node.behavior, `${path}.behavior`, errors, warnings);
  }
}

function validateBehavior(behavior, path, errors, warnings) {
  if (!isObject(behavior)) {
    errors.push({ path, message: 'Behavior must be an object.', severity: 'error' });
    return;
  }
  if (behavior.collapse && !COLLAPSE_POLICIES.includes(behavior.collapse)) {
    errors.push({ path: `${path}.collapse`, message: `Invalid collapse: "${behavior.collapse}". Valid: ${COLLAPSE_POLICIES.join(', ')}`, severity: 'error' });
  }
  if (behavior.overflow && !OVERFLOW_POLICIES.includes(behavior.overflow)) {
    errors.push({ path: `${path}.overflow`, message: `Invalid overflow: "${behavior.overflow}". Valid: ${OVERFLOW_POLICIES.join(', ')}`, severity: 'error' });
  }
  if (behavior.responsiveMode && !RESPONSIVE_MODES.includes(behavior.responsiveMode)) {
    errors.push({ path: `${path}.responsiveMode`, message: `Invalid responsiveMode: "${behavior.responsiveMode}". Valid: ${RESPONSIVE_MODES.join(', ')}`, severity: 'error' });
  }
  if (behavior.mobileDock && !MOBILE_DOCKS.includes(behavior.mobileDock)) {
    errors.push({ path: `${path}.mobileDock`, message: `Invalid mobileDock: "${behavior.mobileDock}". Valid: ${MOBILE_DOCKS.join(', ')}`, severity: 'error' });
  }
  if (behavior.swipeControl && !SWIPE_CONTROLS.includes(behavior.swipeControl)) {
    errors.push({ path: `${path}.swipeControl`, message: `Invalid swipeControl: "${behavior.swipeControl}". Valid: ${SWIPE_CONTROLS.join(', ')}`, severity: 'error' });
  }
}

function validateGroups(groups, errors, warnings) {
  let ids = new Set();
  for (let i = 0; i < groups.length; i++) {
    let g = groups[i];
    let path = `groups[${i}]`;
    if (!g.id) errors.push({ path: `${path}.id`, message: 'Group requires an "id".', severity: 'error' });
    if (!g.name) errors.push({ path: `${path}.name`, message: 'Group requires a "name".', severity: 'error' });
    if (g.id && ids.has(g.id)) {
      errors.push({ path: `${path}.id`, message: `Duplicate group ID: "${g.id}".`, severity: 'error' });
    }
    if (g.id) ids.add(g.id);
  }
}

function validateSections(sections, groupIds, errors, warnings) {
  let ids = new Set();
  for (let i = 0; i < sections.length; i++) {
    let s = sections[i];
    let path = `sections[${i}]`;
    if (!s.id) errors.push({ path: `${path}.id`, message: 'Section requires an "id".', severity: 'error' });
    if (!s.label) errors.push({ path: `${path}.label`, message: 'Section requires a "label".', severity: 'error' });
    if (s.id && ids.has(s.id)) {
      errors.push({ path: `${path}.id`, message: `Duplicate section ID: "${s.id}".`, severity: 'error' });
    }
    if (s.id) ids.add(s.id);
    if (s.groupId && groupIds.size > 0 && !groupIds.has(s.groupId)) {
      warnings.push({ path: `${path}.groupId`, message: `Section references unknown group: "${s.groupId}".`, severity: 'warning' });
    }
  }
}

function validatePanelTypes(panelTypes, errors, warnings) {
  for (let [name, pt] of Object.entries(panelTypes)) {
    let path = `panelTypes.${name}`;
    if (!pt.title) errors.push({ path: `${path}.title`, message: 'PanelType requires a "title".', severity: 'error' });
    if (!pt.component) errors.push({ path: `${path}.component`, message: 'PanelType requires a "component".', severity: 'error' });
    if (pt.component && !/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(pt.component)) {
      warnings.push({ path: `${path}.component`, message: `Component tag "${pt.component}" should be a valid custom element name (lowercase with hyphens).`, severity: 'warning' });
    }
    if (pt.behavior) {
      validateBehavior(pt.behavior, `${path}.behavior`, errors, warnings);
    }
    if (pt.menuActions) {
      if (!Array.isArray(pt.menuActions)) {
        errors.push({ path: `${path}.menuActions`, message: 'menuActions must be an array.', severity: 'error' });
      } else {
        let actionIds = new Set();
        for (let j = 0; j < pt.menuActions.length; j++) {
          let action = pt.menuActions[j];
          if (!action.id) errors.push({ path: `${path}.menuActions[${j}].id`, message: 'Menu action requires an "id".', severity: 'error' });
          if (!action.label) errors.push({ path: `${path}.menuActions[${j}].label`, message: 'Menu action requires a "label".', severity: 'error' });
          if (action.id && actionIds.has(action.id)) {
            errors.push({ path: `${path}.menuActions[${j}].id`, message: `Duplicate action ID: "${action.id}".`, severity: 'error' });
          }
          if (action.id) actionIds.add(action.id);
        }
      }
    }
  }
}

function validateEvents(events, errors, warnings) {
  let ids = new Set();
  for (let i = 0; i < events.length; i++) {
    let ev = events[i];
    let path = `events[${i}]`;
    if (!ev.sourcePanel) errors.push({ path: `${path}.sourcePanel`, message: 'Event bridge requires a "sourcePanel".', severity: 'error' });
    if (!ev.event) errors.push({ path: `${path}.event`, message: 'Event bridge requires an "event".', severity: 'error' });
    if (ev.id) {
      if (ids.has(ev.id)) {
        errors.push({ path: `${path}.id`, message: `Duplicate event bridge ID: "${ev.id}".`, severity: 'error' });
      }
      ids.add(ev.id);
    }
  }
}

function crossReferenceLayout(node, panelTypes, path, errors, warnings) {
  if (!isObject(node)) return;
  if (node.type === 'panel' && node.panelType) {
    if (!panelTypes[node.panelType] && node.panelType !== 'default') {
      warnings.push({
        path: `${path}.panelType`,
        message: `Panel references unregistered type: "${node.panelType}". Register it via panelTypes.`,
        severity: 'warning',
      });
    }
  }
  if (node.type === 'split') {
    if (node.first) crossReferenceLayout(node.first, panelTypes, `${path}.first`, errors, warnings);
    if (node.second) crossReferenceLayout(node.second, panelTypes, `${path}.second`, errors, warnings);
  }
}

function checkPortability(config, errors, warnings) {
  let keys = collectKeys(config);
  for (let key of keys) {
    let lowerKey = key.split('.').pop().toLowerCase();
    for (let blocked of BLOCKED_CONFIG_PATTERNS) {
      if (lowerKey === blocked || lowerKey.includes(blocked)) {
        warnings.push({
          path: key,
          message: `Potentially non-portable key "${key}": workspace configs must not contain auth, secrets, or server-specific data.`,
          severity: 'warning',
        });
      }
    }
  }

  let values = collectStringValues(config);
  for (let value of values) {
    let lower = value.toLowerCase();
    for (let pattern of BLOCKED_VALUE_PATTERNS) {
      if (lower.startsWith(pattern) || lower.includes(pattern)) {
        warnings.push({
          path: '(value)',
          message: `Potentially non-portable value "${value.slice(0, 60)}": workspace configs must not contain server URLs or endpoints.`,
          severity: 'warning',
        });
        break;
      }
    }
  }
}

/**
 * @param {string} version
 * @returns {boolean}
 */
export function isCompatibleVersion(version) {
  if (typeof version !== 'string') return false;
  let [major] = version.split('.');
  let [schemaMajor] = WORKSPACE_SCHEMA_VERSION.split('.');
  return major === schemaMajor;
}
