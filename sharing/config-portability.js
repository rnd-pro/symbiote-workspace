import { validateWorkspaceConfig } from '../validation/core.js';
import { isGrantObject, nonPortableStringReason } from '../schema/value-classes.js';
import { createBrowserRuntimeContract } from './browser-contract.js';

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

let USER_IDENTITY_KEYS = new Set([
  'user',
  'userid',
  'account',
  'accountid',
  'profile',
  'email',
  'identity',
  'owner',
  'ownerid',
  'tenant',
  'tenantid',
  'organization',
  'organizationid',
  'org',
  'orgid',
]);

let NORMALIZED_EXPORT_STRIP_KEYS = new Set([...EXPORT_STRIP_KEYS].map(normalizedKey));

const PORTABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[./:_-][a-z0-9]+)*$/;

const CHAT_CONSTRUCTION_TOOLS = Object.freeze([
  'construction_classify',
  'construction_plan',
  'construction_construct',
  'config_patch_validate',
  'config_patch_apply',
  'config_export',
  'config_import',
]);

const PERSISTENCE_TOOLS = Object.freeze([
  'config_export',
  'config_import',
]);

function normalizedKey(key) {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function isHostLocalFieldKey(key) {
  let normalized = normalizedKey(key);
  return NORMALIZED_EXPORT_STRIP_KEYS.has(normalized) || normalized.endsWith('endpoint');
}

function isNonPortableFieldKey(key) {
  return isHostLocalFieldKey(key) || USER_IDENTITY_KEYS.has(normalizedKey(key));
}

function sanitizeForExport(value, path = '') {
  if (Array.isArray(value)) {
    let result = [];
    for (let i = 0; i < value.length; i++) {
      let item = value[i];
      if (isGrantObject(item)) continue;
      let itemPath = `${path}[${i}]`;
      if (typeof item === 'string' && nonPortableStringReason({ path: itemPath, value: item })) continue;
      result.push(sanitizeForExport(item, itemPath));
    }
    return result;
  }
  if (!isObject(value)) return value;

  let result = {};
  for (let [key, child] of Object.entries(value)) {
    if (isNonPortableFieldKey(key)) continue;
    if (isGrantObject(child)) continue;
    let childPath = path ? `${path}.${key}` : key;
    if (typeof child === 'string' && nonPortableStringReason({ path: childPath, value: child })) continue;
    result[key] = sanitizeForExport(child, childPath);
  }
  return result;
}

function collectGrantErrors(value, path = '', result = []) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectGrantErrors(value[i], `${path}[${i}]`, result);
    }
    return result;
  }
  if (!isObject(value)) return result;
  if (isGrantObject(value)) {
    result.push({
      path: path || '(root)',
      message: 'Grant objects are session/host state and cannot appear in portable config.',
      severity: 'error',
    });
    return result;
  }
  for (let [key, child] of Object.entries(value)) {
    collectGrantErrors(child, path ? `${path}.${key}` : key, result);
  }
  return result;
}

function collectNonPortableFields(value, path = '', result = []) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectNonPortableFields(value[i], `${path}[${i}]`, result);
    }
    return result;
  }
  if (!isObject(value)) {
    if (typeof value === 'string') {
      let reason = nonPortableStringReason({ path, value });
      if (reason) {
        result.push({
          path: path || '(value)',
          message: `Non-portable ${reason} value "${value.slice(0, 60)}" at "${path || '(value)'}".`,
          severity: 'error',
        });
      }
    }
    return result;
  }
  if (isGrantObject(value)) return result;

  for (let [key, child] of Object.entries(value)) {
    let childPath = path ? `${path}.${key}` : key;
    if (isNonPortableFieldKey(key)) {
      result.push({
        path: childPath,
        message: `Non-portable host/local field "${childPath}" is not allowed in portable config.`,
        severity: 'error',
      });
      continue;
    }
    collectNonPortableFields(child, childPath, result);
  }
  return result;
}

function pushUnique(list, value) {
  if (typeof value === 'string' && value.trim() && !list.includes(value)) {
    list.push(value);
  }
}

function moduleDescriptorSource(kind, index) {
  return `${kind}[${index}]`;
}

function moduleName(descriptor) {
  return descriptor.tagName || descriptor.component || descriptor.panelType || 'workspace';
}

function collectModuleDescriptors(config) {
  let descriptors = [];
  let plan = config.construction?.plan;
  let planModules = plan?.modules;
  let hasSelectedPlanModules = Array.isArray(planModules)
    && Array.isArray(plan?.answers?.moduleSelection);
  if (hasSelectedPlanModules) {
    for (let [index, descriptor] of planModules.entries()) {
      if (isObject(descriptor)) {
        descriptors.push({ descriptor, source: moduleDescriptorSource('construction.plan.modules', index) });
      }
    }
    return descriptors;
  }

  for (let [index, descriptor] of (config.components?.modules || []).entries()) {
    if (isObject(descriptor)) {
      descriptors.push({ descriptor, source: moduleDescriptorSource('components.modules', index) });
    }
  }
  return descriptors;
}

function collectHostServices(config) {
  let required = [];
  let byModule = [];
  for (let { descriptor, source } of collectModuleDescriptors(config)) {
    let services = [];
    for (let service of descriptor.requiredHostServices || []) {
      pushUnique(required, service);
      pushUnique(services, service);
    }
    if (services.length > 0) {
      byModule.push({
        module: moduleName(descriptor),
        source,
        required: services.sort((a, b) => a.localeCompare(b)),
      });
    }
  }
  return {
    required: required.sort((a, b) => a.localeCompare(b)),
    byModule,
  };
}

function collectRuntimeSlots(config) {
  let required = [];
  let optional = [];
  for (let { descriptor, source } of collectModuleDescriptors(config)) {
    for (let [index, slot] of (descriptor.runtimeSlots || []).entries()) {
      if (!isObject(slot)) continue;
      let target = slot.required ? required : optional;
      target.push({
        id: slot.id,
        role: slot.role || '',
        module: moduleName(descriptor),
        source,
        path: `${source}.runtimeSlots[${index}]`,
      });
    }
  }
  return { required, optional };
}

function isPortableId(value) {
  return typeof value === 'string' && PORTABLE_ID_PATTERN.test(value);
}

function validateHostServices(services) {
  let errors = [];
  for (let service of services.required) {
    if (!isPortableId(service)) {
      errors.push({
        path: 'requiredHostServices',
        message: `Host service "${service}" must be a portable identifier, not a URL, path, `
          + 'or display label.',
        severity: 'error',
      });
    }
  }
  return errors;
}

function validateRuntimeSlots(runtimeSlots) {
  let errors = [];
  for (let slot of [...runtimeSlots.required, ...runtimeSlots.optional]) {
    if (!isPortableId(slot.id)) {
      errors.push({
        path: `${slot.path}.id`,
        message: `Runtime slot "${slot.id}" must be a portable identifier, not a URL, path, `
          + 'or display label.',
        severity: 'error',
      });
    }
  }
  return errors;
}

function collectPersistenceEngineServices(services) {
  return services.required
    .filter((service) => service.startsWith('storage.'))
    .sort((a, b) => a.localeCompare(b));
}

function collectEngineRequirements(config) {
  let engine = isObject(config.engine) ? config.engine : {};
  let packs = new Set();
  for (let pack of engine.packs || []) {
    if (typeof pack === 'string') packs.add(pack);
  }
  for (let binding of engine.bindings || []) {
    if (isObject(binding) && typeof binding.pack === 'string') packs.add(binding.pack);
  }
  return {
    packs: [...packs].sort((a, b) => a.localeCompare(b)),
    graphs: (engine.graphs || [])
      .filter((graph) => isObject(graph) && typeof graph.id === 'string')
      .map((graph) => ({
        id: graph.id,
        nodes: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
        connections: Array.isArray(graph.connections) ? graph.connections.length : 0,
      })),
    bindings: (engine.bindings || [])
      .filter((binding) => isObject(binding))
      .map((binding) => ({
        id: binding.id,
        panelType: binding.panelType,
        surface: binding.surface,
        sourceId: binding.sourceId,
        graphId: binding.graphId,
        nodeId: binding.nodeId,
      })),
  };
}

/**
 * @param {Object} config
 * @param {Object} [options]
 * @param {boolean} [options.strict] - Reject rather than silently strip non-portable source fields.
 * @returns {{ json: string|null, config: Object, errors: Array }}
 */
export function exportConfig(config, options = {}) {
  let grantErrors = collectGrantErrors(config);
  let sourceErrors = options.strict ? collectNonPortableFields(config) : [];
  let blocking = [...grantErrors, ...sourceErrors];
  let clean = sanitizeForExport(deepClone(config), '');

  if (blocking.length > 0) {
    return { json: null, config: clean, errors: blocking };
  }

  let validation = validateWorkspaceConfig(clean);
  if (!validation.ok) {
    return { json: null, config: clean, errors: validation.errors };
  }

  let json = JSON.stringify(clean, null, 2);
  return { json, config: clean, errors: [] };
}

/**
 * @param {Object} config
 * @returns {{ status: string, contract: Object|null, errors: Array }}
 */
export function createHostIntegrationContract(config) {
  let exported = exportConfig(config, { strict: true });
  if (!exported.json) {
    return {
      status: 'error',
      contract: null,
      errors: exported.errors,
    };
  }

  let services = collectHostServices(exported.config);
  let runtimeSlots = collectRuntimeSlots(exported.config);
  let engine = collectEngineRequirements(exported.config);
  let contractErrors = [
    ...validateHostServices(services),
    ...validateRuntimeSlots(runtimeSlots),
  ];
  if (contractErrors.length > 0) {
    return {
      status: 'error',
      contract: null,
      errors: contractErrors,
    };
  }

  return {
    status: 'ok',
    contract: {
      schemaVersion: '0.1.0',
      workspace: {
        name: exported.config.name,
        version: exported.config.version,
        register: exported.config.register || 'tool',
        template: exported.config.intent?.template || exported.config.construction?.plan?.template || null,
      },
      chatConstruction: {
        requiredTools: [...CHAT_CONSTRUCTION_TOOLS],
        sessionOwner: 'host',
        mutationBoundary: 'workspace session config',
      },
      browser: createBrowserRuntimeContract(),
      persistence: {
        portableConfig: true,
        requiredTools: [...PERSISTENCE_TOOLS],
        requiredEngineServices: collectPersistenceEngineServices(services),
        optionalEngineServices: [],
        exportFormat: 'workspace-json',
      },
      services,
      runtimeSlots,
      engine,
      prohibitedConfigFields: [...new Set([...EXPORT_STRIP_KEYS, ...USER_IDENTITY_KEYS])]
        .sort((a, b) => a.localeCompare(b)),
    },
    errors: [],
  };
}

/**
 * @param {string} json - JSON string of workspace config
 * @returns {{ config: Object | null, errors: Array }}
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

  let portabilityErrors = [...collectGrantErrors(parsed), ...collectNonPortableFields(parsed)];
  if (portabilityErrors.length > 0) {
    return { config: null, errors: portabilityErrors };
  }

  let validation = validateWorkspaceConfig(parsed);
  if (!validation.ok) {
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
 * @param {Object} base
 * @param {Object} overlay - Partial config to merge on top
 * @returns {Object}
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
