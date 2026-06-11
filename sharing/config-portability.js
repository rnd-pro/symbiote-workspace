import { validateWorkspaceConfig } from '../schema/validate.js';
import { WORKSPACE_SCHEMA_VERSION } from '../schema/workspace-schema.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

let EXPORT_STRIP_KEYS = new Set([
  'host',
  'session',
  'sessionId',
  'endpoint',
  'serverUrl',
  'serverURL',
  'previewUrl',
  'previewURL',
  'localFile',
  'localPath',
  'absolutePath',
  'filePath',
  'workspaceRoot',
  'cwd',
  'homeDir',
]);

let NON_PORTABLE_VALUE_PATTERNS = [
  /^file:\/\//i,
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i,
  /^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i,
  /^\/Users\//,
  /^\/tmp\//,
  /^\/var\/folders\//,
];

function sanitizeForExport(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForExport(item));
  }
  if (!isObject(value)) return value;

  let result = {};
  for (let [key, child] of Object.entries(value)) {
    if (EXPORT_STRIP_KEYS.has(key)) continue;
    if (typeof child === 'string' && isNonPortableString(child)) continue;
    result[key] = sanitizeForExport(child);
  }
  return result;
}

function isNonPortableString(value) {
  return NON_PORTABLE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function collectNonPortableFields(value, path = '', result = []) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectNonPortableFields(value[i], `${path}[${i}]`, result);
    }
    return result;
  }
  if (!isObject(value)) {
    if (typeof value === 'string' && isNonPortableString(value)) {
      result.push({
        path: path || '(value)',
        message: `Non-portable local or host-bound value: "${value.slice(0, 60)}".`,
        severity: 'error',
      });
    }
    return result;
  }

  for (let [key, child] of Object.entries(value)) {
    let childPath = path ? `${path}.${key}` : key;
    if (EXPORT_STRIP_KEYS.has(key)) {
      result.push({
        path: childPath,
        message: `Non-portable host/local field "${childPath}" is not allowed in imported configs.`,
        severity: 'error',
      });
      continue;
    }
    collectNonPortableFields(child, childPath, result);
  }
  return result;
}

function hasSensitiveWarning(warnings) {
  return warnings.some((warning) => /auth|secret|credential|cookie|token|password|apikey|api key/i.test(warning.message));
}

/**
 * @param {import('../schema/workspace-schema.js').WorkspaceConfig} config
 * @param {Object} [options]
 * @param {boolean} [options.strict] - Reject on validation warnings
 * @returns {{ json: string, config: import('../schema/workspace-schema.js').WorkspaceConfig, errors: Array }}
 */
export function exportConfig(config, options = {}) {
  let clean = sanitizeForExport(deepClone(config));
  let validation = validateWorkspaceConfig(clean, { strict: true });

  if (!validation.valid) {
    return { json: null, config: clean, errors: validation.errors };
  }

  if ((options.strict || hasSensitiveWarning(validation.warnings)) && validation.warnings.length > 0) {
    return {
      json: null,
      config: clean,
      errors: validation.warnings.map((w) => ({ ...w, severity: 'error' })),
    };
  }

  let json = JSON.stringify(clean, null, 2);
  return { json, config: clean, errors: [] };
}

/**
 * @param {string} json - JSON string of workspace config
 * @returns {{ config: import('../schema/workspace-schema.js').WorkspaceConfig | null, errors: Array }}
 */
export function importConfig(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      config: null,
      errors: [{ path: '', message: `Invalid JSON: ${err.message}`, severity: 'error' }],
    };
  }

  let portabilityErrors = collectNonPortableFields(parsed);
  if (portabilityErrors.length > 0) {
    return { config: null, errors: portabilityErrors };
  }

  let validation = validateWorkspaceConfig(parsed, { strict: true });
  if (!validation.valid) {
    return { config: null, errors: validation.errors };
  }

  return { config: parsed, errors: [] };
}

/**
 * @param {Object} a - First config
 * @param {Object} b - Second config
 * @param {string} [path] - Current path for recursion
 * @returns {Array<{ path: string, type: string, a?: any, b?: any }>}
 */
export function diffConfigs(a, b, path = '') {
  let diffs = [];

  if (a === b) return diffs;

  if (!isObject(a) || !isObject(b)) {
    if (a !== b) {
      diffs.push({ path: path || '(root)', type: 'changed', a, b });
    }
    return diffs;
  }

  let allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (let key of allKeys) {
    let childPath = path ? `${path}.${key}` : key;
    let aHas = key in a;
    let bHas = key in b;

    if (aHas && !bHas) {
      diffs.push({ path: childPath, type: 'removed', a: a[key] });
    } else if (!aHas && bHas) {
      diffs.push({ path: childPath, type: 'added', b: b[key] });
    } else if (Array.isArray(a[key]) || Array.isArray(b[key])) {
      let aJson = JSON.stringify(a[key]);
      let bJson = JSON.stringify(b[key]);
      if (aJson !== bJson) {
        diffs.push({ path: childPath, type: 'changed', a: a[key], b: b[key] });
      }
    } else {
      diffs.push(...diffConfigs(a[key], b[key], childPath));
    }
  }

  return diffs;
}

/**
 * @param {import('../schema/workspace-schema.js').WorkspaceConfig} base
 * @param {Object} overlay - Partial config to merge on top
 * @returns {import('../schema/workspace-schema.js').WorkspaceConfig}
 */
export function mergeConfigs(base, overlay) {
  let merged = deepClone(base);

  if (!isObject(overlay)) return merged;

  for (let key of Object.keys(overlay)) {
    if (key === 'layout') {
      merged.layout = deepClone(overlay.layout);
    } else if (key === 'theme' && isObject(merged.theme) && isObject(overlay.theme)) {
      if (overlay.theme.params) {
        merged.theme.params = { ...(merged.theme.params || {}), ...overlay.theme.params };
      }
      if (overlay.theme.relations) {
        merged.theme.relations = { ...(merged.theme.relations || {}), ...overlay.theme.relations };
      }
      if (overlay.theme.overrides) {
        merged.theme.overrides = { ...(merged.theme.overrides || {}), ...overlay.theme.overrides };
      }
      if (overlay.theme.subtrees) {
        merged.theme.subtrees = deepClone(overlay.theme.subtrees);
      }
    } else if (key === 'components' && isObject(merged.components) && isObject(overlay.components)) {
      if (overlay.components.catalog) {
        let existing = new Set(merged.components.catalog || []);
        for (let tag of overlay.components.catalog) existing.add(tag);
        merged.components.catalog = [...existing];
      }
      if (overlay.components.custom) {
        let existingCustom = merged.components.custom || [];
        let existingMap = new Map(existingCustom.map((c) => [c.tagName, c]));
        for (let custom of overlay.components.custom) {
          existingMap.set(custom.tagName, { ...existingMap.get(custom.tagName), ...custom });
        }
        merged.components.custom = [...existingMap.values()];
      }
    } else {
      merged[key] = deepClone(overlay[key]);
    }
  }

  return merged;
}
