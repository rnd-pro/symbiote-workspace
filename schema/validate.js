import {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_REGISTER_VALUES,
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

  if (config.components !== undefined && !isObject(config.components)) {
    errors.push({ path: 'components', message: 'Field "components" must be an object.', severity: 'error' });
  }

  if (options.strict) {
    let knownKeys = new Set([
      'version', 'name', 'register', 'theme', 'layout',
      'components', 'data', 'engine',
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

let LAYOUT_TYPES = new Set(['split', 'tabs', 'sidebar', 'stack', 'single']);

function validateLayoutNode(node, path, errors, warnings) {
  if (!isObject(node)) return;

  if (node.type && !LAYOUT_TYPES.has(node.type)) {
    warnings.push({
      path: `${path}.type`,
      message: `Unknown layout type: "${node.type}".`,
      severity: 'warning',
    });
  }

  if (node.children && !Array.isArray(node.children)) {
    errors.push({
      path: `${path}.children`,
      message: 'Layout "children" must be an array.',
      severity: 'error',
    });
  }

  if (Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      validateLayoutNode(node.children[i], `${path}.children[${i}]`, errors, warnings);
    }
  }

  if (node.ratio && !Array.isArray(node.ratio)) {
    errors.push({
      path: `${path}.ratio`,
      message: 'Layout "ratio" must be an array of numbers.',
      severity: 'error',
    });
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
