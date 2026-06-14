import {
  createHostIntegrationContract,
  exportConfig,
  importConfig,
} from './config-portability.js';

export const WORKSPACE_PACKAGE_SCHEMA_VERSION = '0.1.0';
export const WORKSPACE_PACKAGE_KIND = 'symbiote-workspace-package';

const PORTABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[./:_-][a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const ASSET_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const NON_PORTABLE_VALUE_PATTERNS = [
  /^file:\/\//i,
  /^https?:\/\//i,
  /^wss?:\/\//i,
  /^\/Users\//,
  /^\/home\//,
  /^\/tmp\//,
  /^\/var\/folders\//,
  /^\/private\/var\/folders\//,
  /^[a-z]:[\\/]/i,
];

const HOST_STATE_KEYS = new Set([
  'auth',
  'billing',
  'cookie',
  'credential',
  'email',
  'endpoint',
  'identity',
  'organization',
  'organizationid',
  'org',
  'orgid',
  'password',
  'profile',
  'secret',
  'serverurl',
  'session',
  'sessionid',
  'subscription',
  'tenant',
  'tenantid',
  'token',
  'user',
  'userid',
]);

const MARKETPLACE_STATE_KEYS = new Set([
  'licenseenforcement',
  'licensekey',
  'licenseserver',
  'listingaccess',
  'marketplace',
  'payout',
  'price',
  'privatelisting',
  'purchase',
  'purchaseid',
  'rating',
  'ratings',
  'seller',
  'sellerid',
]);

const DEPENDENCY_KEYS = Object.freeze(['plugins', 'components', 'packages']);
const ASSET_KEYS = Object.freeze(['docs', 'examples', 'previews']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizedKey(key) {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function isNonPortableString(value) {
  return NON_PORTABLE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function pushError(errors, path, message) {
  errors.push({ path, message, severity: 'error' });
}

function sortedStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))]
    .sort((a, b) => a.localeCompare(b));
}

function collectManifestStateErrors(value, path, errors) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectManifestStateErrors(value[i], `${path}[${i}]`, errors);
    }
    return;
  }
  if (!isObject(value)) {
    if (typeof value === 'string' && isNonPortableString(value)) {
      pushError(errors, path, `Package metadata value "${value.slice(0, 60)}" is not portable.`);
    }
    return;
  }

  for (let [key, child] of Object.entries(value)) {
    let childPath = `${path}.${key}`;
    let normalized = normalizedKey(key);
    if (HOST_STATE_KEYS.has(normalized) || MARKETPLACE_STATE_KEYS.has(normalized)) {
      pushError(
        errors,
        childPath,
        `Package manifest field "${childPath}" belongs to host, identity, or marketplace state.`,
      );
      continue;
    }
    collectManifestStateErrors(child, childPath, errors);
  }
}

function validatePortableId(value, path, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    pushError(errors, path, 'Value must be a non-empty portable identifier.');
    return;
  }
  if (!PORTABLE_ID_PATTERN.test(value)) {
    pushError(errors, path, `Value "${value}" must be a portable identifier.`);
  }
}

function validateStringField(value, path, errors) {
  if (value !== undefined && typeof value !== 'string') {
    pushError(errors, path, `${path} must be a string.`);
  }
}

function validateSemver(value, path, errors) {
  if (typeof value !== 'string' || !SEMVER_PATTERN.test(value)) {
    pushError(errors, path, `${path} must be a semantic version string.`);
  }
}

function validatePortableIdList(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`);
    return;
  }
  let seen = new Set();
  for (let i = 0; i < value.length; i++) {
    let itemPath = `${path}[${i}]`;
    validatePortableId(value[i], itemPath, errors);
    if (seen.has(value[i])) {
      pushError(errors, itemPath, `Duplicate portable identifier "${value[i]}".`);
    }
    seen.add(value[i]);
  }
}

function validateStringList(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`);
    return;
  }
  let seen = new Set();
  for (let i = 0; i < value.length; i++) {
    let item = value[i];
    let itemPath = `${path}[${i}]`;
    if (typeof item !== 'string' || !item.trim()) {
      pushError(errors, itemPath, `${itemPath} must be a non-empty string.`);
      continue;
    }
    if (isNonPortableString(item)) {
      pushError(errors, itemPath, `Package dependency "${item.slice(0, 60)}" is not portable.`);
    }
    if (seen.has(item)) {
      pushError(errors, itemPath, `Duplicate value "${item}".`);
    }
    seen.add(item);
  }
}

function validateAssetList(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`);
    return;
  }
  let seen = new Set();
  for (let i = 0; i < value.length; i++) {
    let item = value[i];
    let itemPath = `${path}[${i}]`;
    if (typeof item !== 'string' || !ASSET_REF_PATTERN.test(item) || item.includes('..')) {
      pushError(errors, itemPath, `${itemPath} must be a relative package asset reference.`);
      continue;
    }
    if (isNonPortableString(item)) {
      pushError(errors, itemPath, `Package asset "${item.slice(0, 60)}" is not portable.`);
    }
    if (seen.has(item)) {
      pushError(errors, itemPath, `Duplicate asset reference "${item}".`);
    }
    seen.add(item);
  }
}

function collectDescriptorPackages(config) {
  let packages = [];
  for (let descriptor of config.components?.modules || []) {
    if (!isObject(descriptor)) continue;
    if (typeof descriptor.provider === 'string') packages.push(descriptor.provider);
    if (typeof descriptor.descriptor?.package === 'string') {
      packages.push(descriptor.descriptor.package);
    }
  }
  for (let descriptor of config.construction?.plan?.modules || []) {
    if (!isObject(descriptor)) continue;
    if (typeof descriptor.provider === 'string') packages.push(descriptor.provider);
    if (typeof descriptor.descriptor?.package === 'string') {
      packages.push(descriptor.descriptor.package);
    }
  }
  return packages;
}

function normalizeDependencies(config, dependencies = {}) {
  let catalog = config.components?.catalog || [];
  return {
    plugins: sortedStrings([
      ...(dependencies.plugins || []),
      ...collectDescriptorPackages(config),
    ]),
    components: sortedStrings([
      ...catalog,
      ...(dependencies.components || []),
    ]),
    packages: sortedStrings(dependencies.packages || []),
  };
}

function normalizeAssets(assets = {}) {
  let normalized = {};
  for (let key of ASSET_KEYS) {
    normalized[key] = sortedStrings(assets[key] || []);
  }
  return normalized;
}

function normalizeManifest(config, manifest = {}) {
  let normalized = {
    id: manifest.id,
    name: manifest.name || config.name,
    version: manifest.version || config.exports?.package?.version || '0.1.0',
    compatibility: {
      ...(isObject(manifest.compatibility) ? manifest.compatibility : {}),
      workspaceSchema: config.version,
    },
    tags: sortedStrings(manifest.tags || []),
    permissions: sortedStrings(manifest.permissions || []),
    dependencies: normalizeDependencies(config, manifest.dependencies),
    assets: normalizeAssets(manifest.assets),
  };

  if (manifest.description !== undefined) normalized.description = manifest.description;
  if (isObject(manifest.support)) normalized.support = deepClone(manifest.support);

  return normalized;
}

function validateManifest(manifest, config, errors) {
  if (!isObject(manifest)) {
    pushError(errors, 'manifest', 'Package manifest must be an object.');
    return;
  }

  collectManifestStateErrors(manifest, 'manifest', errors);
  validatePortableId(manifest.id, 'manifest.id', errors);
  validateStringField(manifest.name, 'manifest.name', errors);
  validateStringField(manifest.description, 'manifest.description', errors);
  validateSemver(manifest.version, 'manifest.version', errors);
  validatePortableIdList(manifest.tags, 'manifest.tags', errors);
  validatePortableIdList(manifest.permissions, 'manifest.permissions', errors);

  if (!isObject(manifest.compatibility)) {
    pushError(errors, 'manifest.compatibility', 'manifest.compatibility must be an object.');
  } else if (manifest.compatibility.workspaceSchema !== config.version) {
    pushError(
      errors,
      'manifest.compatibility.workspaceSchema',
      'manifest.compatibility.workspaceSchema must match workspace.config.version.',
    );
  }

  if (!isObject(manifest.dependencies)) {
    pushError(errors, 'manifest.dependencies', 'manifest.dependencies must be an object.');
  } else {
    for (let key of DEPENDENCY_KEYS) {
      validateStringList(manifest.dependencies[key], `manifest.dependencies.${key}`, errors);
    }
  }

  if (!isObject(manifest.assets)) {
    pushError(errors, 'manifest.assets', 'manifest.assets must be an object.');
  } else {
    for (let key of ASSET_KEYS) {
      validateAssetList(manifest.assets[key], `manifest.assets.${key}`, errors);
    }
  }
}

function validatePackageShape(workspacePackage, errors) {
  if (!isObject(workspacePackage)) {
    pushError(errors, '', 'Workspace package must be an object.');
    return false;
  }
  if (workspacePackage.kind !== WORKSPACE_PACKAGE_KIND) {
    pushError(errors, 'kind', `Workspace package kind must be "${WORKSPACE_PACKAGE_KIND}".`);
  }
  if (workspacePackage.schemaVersion !== WORKSPACE_PACKAGE_SCHEMA_VERSION) {
    pushError(
      errors,
      'schemaVersion',
      `Workspace package schemaVersion must be "${WORKSPACE_PACKAGE_SCHEMA_VERSION}".`,
    );
  }
  if (!isObject(workspacePackage.workspace?.config)) {
    pushError(errors, 'workspace.config', 'Workspace package requires workspace.config.');
    return false;
  }
  if (!isObject(workspacePackage.host?.contract)) {
    pushError(errors, 'host.contract', 'Workspace package requires host.contract.');
  }
  return true;
}

/**
 * @param {Object} workspacePackage
 * @returns {{ valid: boolean, errors: Array }}
 */
export function validateWorkspacePackage(workspacePackage) {
  let errors = [];
  if (!validatePackageShape(workspacePackage, errors)) {
    return { valid: false, errors };
  }

  let configResult = importConfig(JSON.stringify(workspacePackage.workspace.config));
  if (!configResult.config) {
    return {
      valid: false,
      errors: [
        ...errors,
        ...configResult.errors.map((error) => ({
          ...error,
          path: error.path ? `workspace.config.${error.path}` : 'workspace.config',
        })),
      ],
    };
  }

  validateManifest(workspacePackage.manifest, configResult.config, errors);

  let contract = createHostIntegrationContract(configResult.config);
  if (contract.status !== 'ok') {
    errors.push(...contract.errors.map((error) => ({
      ...error,
      path: error.path ? `host.contract.${error.path}` : 'host.contract',
    })));
  } else if (JSON.stringify(workspacePackage.host.contract) !== JSON.stringify(contract.contract)) {
    pushError(errors, 'host.contract', 'Workspace package host.contract does not match workspace.config.');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * @param {import('../schema/workspace-schema.js').WorkspaceConfig} config
 * @param {Object} manifest
 * @param {Object} [options]
 * @returns {{ json: string|null, package: Object|null, errors: Array }}
 */
export function exportWorkspacePackage(config, manifest = {}, options = {}) {
  let exported = exportConfig(config, { strict: true });
  if (!exported.json) {
    return { json: null, package: null, errors: exported.errors };
  }

  if (!isObject(manifest)) {
    return {
      json: null,
      package: null,
      errors: [{ path: 'manifest', message: 'Package manifest must be an object.', severity: 'error' }],
    };
  }

  let stateErrors = [];
  collectManifestStateErrors(manifest, 'manifest', stateErrors);
  if (stateErrors.length > 0) {
    return { json: null, package: null, errors: stateErrors };
  }

  let contract = createHostIntegrationContract(exported.config);
  if (contract.status !== 'ok') {
    return { json: null, package: null, errors: contract.errors };
  }

  let workspacePackage = {
    kind: WORKSPACE_PACKAGE_KIND,
    schemaVersion: WORKSPACE_PACKAGE_SCHEMA_VERSION,
    manifest: normalizeManifest(exported.config, manifest),
    workspace: {
      config: exported.config,
    },
    host: {
      contract: contract.contract,
    },
  };

  let validation = validateWorkspacePackage(workspacePackage);
  if (!validation.valid) {
    return { json: null, package: null, errors: validation.errors };
  }

  let packageObject = deepClone(workspacePackage);
  let json = JSON.stringify(packageObject, null, 2);
  return {
    json,
    package: options.clone === false ? workspacePackage : packageObject,
    errors: [],
  };
}

/**
 * @param {string} json
 * @returns {{ package: Object|null, config: Object|null, errors: Array }}
 */
export function importWorkspacePackage(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      package: null,
      config: null,
      errors: [{ path: '', message: `Invalid JSON: ${err.message}`, severity: 'error' }],
    };
  }

  let validation = validateWorkspacePackage(parsed);
  if (!validation.valid) {
    return { package: null, config: null, errors: validation.errors };
  }

  return {
    package: deepClone(parsed),
    config: deepClone(parsed.workspace.config),
    errors: [],
  };
}

function normalizeForComparison(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForComparison(item)).sort((a, b) => {
      let aStr = typeof a === 'string' ? a : JSON.stringify(a);
      let bStr = typeof b === 'string' ? b : JSON.stringify(b);
      return aStr.localeCompare(bStr);
    });
  }
  if (isObject(value)) {
    let sorted = {};
    for (let key of Object.keys(value).sort()) {
      sorted[key] = normalizeForComparison(value[key]);
    }
    return sorted;
  }
  return value;
}

function semanticHostContractMatch(stored, computed) {
  let normalizedStored = normalizeForComparison(stored);
  let normalizedComputed = normalizeForComparison(computed);
  return JSON.stringify(normalizedStored) === JSON.stringify(normalizedComputed);
}

/**
 * @param {Object|string} input - Workspace package object or JSON string
 * @param {Object} [options]
 * @param {Object} [options.available] - Host-neutral available capabilities
 * @param {string[]} [options.available.components]
 * @param {string[]} [options.available.plugins]
 * @param {string[]} [options.available.packages]
 * @param {string[]} [options.available.hostServices]
 * @param {string[]} [options.available.runtimeSlots]
 * @returns {{
 *   valid: boolean,
 *   ready: boolean,
 *   package: Object|null,
 *   config: Object|null,
 *   summary: Object|null,
 *   compatibility: Object|null,
 *   requirements: Object|null,
 *   missing: Object|null,
 *   warnings: Array,
 *   errors: Array,
 * }}
 */
export function inspectWorkspacePackage(input, options = {}) {
  let result = {
    valid: false,
    ready: false,
    package: null,
    config: null,
    summary: null,
    compatibility: null,
    requirements: null,
    missing: null,
    warnings: [],
    errors: [],
  };

  let workspacePackage;
  if (typeof input === 'string') {
    try {
      workspacePackage = JSON.parse(input);
    } catch (err) {
      result.errors.push({ path: '', message: `Invalid JSON: ${err.message}`, severity: 'error' });
      return result;
    }
  } else {
    try {
      workspacePackage = deepClone(input);
    } catch (err) {
      result.errors.push({
        path: '',
        message: `Workspace package could not be cloned: ${err.message}`,
        severity: 'error',
      });
      return result;
    }
  }

  if (!isObject(workspacePackage)) {
    result.errors.push({ path: '', message: 'Workspace package must be an object.', severity: 'error' });
    return result;
  }

  let hasConfig = validatePackageShape(workspacePackage, result.errors);
  if (!hasConfig) return result;

  let schemaMajor = WORKSPACE_PACKAGE_SCHEMA_VERSION.split('.')[0];
  let pkgMajor = typeof workspacePackage.schemaVersion === 'string'
    ? workspacePackage.schemaVersion.split('.')[0]
    : null;
  let schemaCompatible = schemaMajor === pkgMajor;

  if (!schemaCompatible) {
    result.errors.push({
      path: 'schemaVersion',
      message: `Incompatible package schema major version "${workspacePackage.schemaVersion}". `
        + `Expected major: "${schemaMajor}".`,
      severity: 'error',
    });
  }

  let configResult = importConfig(JSON.stringify(workspacePackage.workspace.config));
  let validConfig = null;
  if (!configResult.config) {
    for (let error of configResult.errors) {
      result.errors.push({
        ...error,
        path: error.path ? `workspace.config.${error.path}` : 'workspace.config',
      });
    }
  } else {
    validConfig = configResult.config;
  }

  let manifestErrors = [];
  if (isObject(workspacePackage.manifest)) {
    validateManifest(
      workspacePackage.manifest,
      validConfig || workspacePackage.workspace?.config,
      manifestErrors,
    );
  }
  result.errors.push(...manifestErrors);

  if (validConfig) {
    let contract = createHostIntegrationContract(validConfig);
    if (contract.status !== 'ok') {
      for (let error of contract.errors) {
        result.errors.push({
          ...error,
          path: error.path ? `host.contract.${error.path}` : 'host.contract',
        });
      }
    } else if (
      isObject(workspacePackage.host?.contract)
      && !semanticHostContractMatch(workspacePackage.host.contract, contract.contract)
    ) {
      result.errors.push({
        path: 'host.contract',
        message: 'Workspace package host.contract does not match workspace.config.',
        severity: 'error',
      });
    }
  }

  let hasAvailable = isObject(options.available);
  let available = hasAvailable ? options.available : {};
  let availableComponents = new Set(available.components || []);
  let availablePlugins = new Set(available.plugins || []);
  let availablePackages = new Set(available.packages || []);
  let availableHostServices = new Set(available.hostServices || []);
  let availableRuntimeSlots = new Set(available.runtimeSlots || []);

  let missing = {
    components: [],
    plugins: [],
    packages: [],
    hostServices: [],
    runtimeSlots: [],
  };

  let manifest = workspacePackage.manifest || {};
  let deps = manifest.dependencies || {};

  let hostContract = workspacePackage.host?.contract || {};
  let services = hostContract.services || {};
  let runtimeSlots = hostContract.runtimeSlots || {};

  if (hasAvailable) {
    for (let component of deps.components || []) {
      if (!availableComponents.has(component)) missing.components.push(component);
    }
    for (let plugin of deps.plugins || []) {
      if (!availablePlugins.has(plugin)) missing.plugins.push(plugin);
    }
    for (let pkg of deps.packages || []) {
      if (!availablePackages.has(pkg)) missing.packages.push(pkg);
    }

    for (let service of services.required || []) {
      if (!availableHostServices.has(service)) missing.hostServices.push(service);
    }

    for (let slot of runtimeSlots.required || []) {
      let slotId = isObject(slot) ? slot.id : slot;
      if (typeof slotId === 'string' && !availableRuntimeSlots.has(slotId)) {
        missing.runtimeSlots.push(slotId);
      }
    }
  }

  let allMissing = [
    ...missing.components,
    ...missing.plugins,
    ...missing.packages,
    ...missing.hostServices,
    ...missing.runtimeSlots,
  ];

  if (allMissing.length > 0) {
    result.warnings.push({
      path: 'available',
      message: `Host is missing ${allMissing.length} required capabilities: ${allMissing.join(', ')}.`,
      severity: 'warning',
    });
  }

  result.valid = result.errors.length === 0;

  if (result.valid || validConfig) {
    result.package = deepClone(workspacePackage);
    result.config = validConfig ? deepClone(validConfig) : null;
    result.summary = {
      id: manifest.id || null,
      name: manifest.name || null,
      version: manifest.version || null,
      schemaVersion: workspacePackage.schemaVersion,
      kind: workspacePackage.kind,
    };
    result.compatibility = {
      workspaceSchema: validConfig ? validConfig.version : null,
      compatible: schemaCompatible,
      requiredMajor: schemaMajor,
      packageMajor: pkgMajor,
    };
    result.requirements = {
      components: deps.components || [],
      plugins: deps.plugins || [],
      packages: deps.packages || [],
      hostServices: services.required || [],
      runtimeSlots: (runtimeSlots.required || []).map((s) => (isObject(s) ? s.id : s)),
    };
    result.missing = missing;
  }

  result.ready = result.valid && result.warnings.length === 0;

  return result;
}
