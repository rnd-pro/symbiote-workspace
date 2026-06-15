import {
  createPackageReadinessProjection,
  inspectWorkspacePackage,
} from './workspace-package.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

const BUILT_IN_TEMPLATES = new Set([
  'admin',
  'agent-workspace',
  'chat',
  'dashboard',
  'editor',
  'graph',
  'social-automation',
  'video-studio',
]);

const WORKSPACE_CONSTRUCTION_HANDOFF_TYPE = 'workspace-construction-handoff';
const TEMPLATE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function isPortableTemplateName(name) {
  return typeof name === 'string'
    && TEMPLATE_NAME_PATTERN.test(name.trim())
    && !BUILT_IN_TEMPLATES.has(name.trim());
}

function sortedStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))]
    .sort((a, b) => a.localeCompare(b));
}

function requiredIntentCapabilities(intent) {
  if (intent.requiredCapabilities === undefined) return [];
  if (!Array.isArray(intent.requiredCapabilities)) {
    throw new Error('Workspace construction handoff intent.requiredCapabilities must be an array of strings.');
  }

  return intent.requiredCapabilities.map((value) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Workspace construction handoff intent.requiredCapabilities must contain non-empty strings.');
    }
    return value.trim();
  });
}

function normalizeHandoffIntent(intent) {
  if (intent === undefined || intent === null) return {};
  if (typeof intent === 'string') return { brief: intent };
  if (!isObject(intent)) {
    throw new Error('Workspace construction handoff intent must be a string or object.');
  }
  return deepClone(intent);
}

function appendStrings(target, values) {
  if (!Array.isArray(values)) return;
  for (let value of values) target.push(value);
}

function deriveTemplateName(manifestId) {
  if (typeof manifestId !== 'string' || !manifestId.trim()) return 'pkg-workspace';

  let base = manifestId.trim().toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^_+/, '')
    .replace(/^[^a-z]/, 'x$&');

  let candidate = 'pkg-' + base;

  if (BUILT_IN_TEMPLATES.has(base) || BUILT_IN_TEMPLATES.has(candidate)) {
    candidate = 'pkg-ext-' + base;
  }

  if (!TEMPLATE_NAME_PATTERN.test(candidate)) {
    return 'pkg-workspace';
  }

  return candidate;
}

function collectModuleCapabilities(config) {
  let modules = config.components?.modules;
  if (!Array.isArray(modules)) return [];
  return modules
    .filter((m) => isObject(m))
    .map((m) => deepClone(m))
    .sort((a, b) => a.tagName.localeCompare(b.tagName));
}

function collectRequiredCapabilities(config) {
  let required = [];
  appendStrings(required, config.intent?.requiredCapabilities);
  appendStrings(required, config.construction?.intent?.requiredCapabilities);
  appendStrings(required, config.construction?.plan?.target?.requiredCapabilities);
  appendStrings(required, config.construction?.plan?.capabilities?.required);
  return sortedStrings(required);
}

function createSource(inspection, templateName) {
  return {
    type: 'workspace-package',
    packageId: inspection.summary?.id || null,
    packageName: inspection.summary?.name || null,
    packageVersion: inspection.summary?.version || null,
    packageSchemaVersion: inspection.summary?.schemaVersion || null,
    workspaceSchema: inspection.compatibility?.workspaceSchema || null,
    templateName,
  };
}

function emptyCapabilityMap() {
  return {
    components: [],
    plugins: [],
    packages: [],
    hostServices: [],
    runtimeSlots: [],
  };
}

function appendCapabilityMap(target, source) {
  if (!isObject(source)) return;
  for (let key of Object.keys(target)) {
    appendStrings(target[key], source[key]);
  }
}

function sortedCapabilityMap(value) {
  let sorted = emptyCapabilityMap();
  appendCapabilityMap(sorted, value);
  for (let key of Object.keys(sorted)) {
    sorted[key] = sortedStrings(sorted[key]);
  }
  return sorted;
}

function normalizePackageEntries(input) {
  if (isObject(input) && Array.isArray(input.packages)) return input.packages;
  return [];
}

function collectionOptions(input, options) {
  let opts = isObject(options) ? options : {};
  if (opts.available !== undefined) return opts;
  if (isObject(input) && input.available !== undefined) {
    return { ...opts, available: input.available };
  }
  return opts;
}

function entryInput(entry) {
  if (typeof entry === 'string') return { value: entry, templateName: null };
  if (!isObject(entry)) return { value: entry, templateName: null };
  if (entry.package !== undefined || entry.json !== undefined) {
    return {
      value: entry.package !== undefined ? entry.package : entry.json,
      templateName: entry.templateName,
    };
  }
  return { value: entry, templateName: null };
}

function prefixedDiagnostic(index, diagnostic) {
  let path = diagnostic.path
    ? `packages[${index}].${diagnostic.path}`
    : `packages[${index}]`;
  return { ...diagnostic, path };
}

function conflictError(path, message) {
  return { path, message, severity: 'error' };
}

function packageOptionsForEntry(entry, opts) {
  let packageOptions = {};
  if (opts.available !== undefined) packageOptions.available = opts.available;
  if (entry.templateName !== undefined && entry.templateName !== null) {
    packageOptions.templateName = entry.templateName;
  }
  return packageOptions;
}

function addInvalidPackageDiagnostics(result, context, packageIndex) {
  result.errors.push(...context.errors.map((error) => prefixedDiagnostic(packageIndex, error)));
}

function addPackageRequirements(result, context, requiredCapabilities) {
  appendCapabilityMap(result.requirements, context.requirements);
  appendCapabilityMap(result.missing, context.missing);
  appendStrings(requiredCapabilities, context.requiredCapabilities);
}

function addTemplateConflict(result, template, context, packageIndex, templateIndex, first) {
  result.conflicts.push({
    type: 'workspace-template',
    name: template.name,
    firstPackageIndex: first.packageIndex,
    packageIndex,
    firstPackageId: first.packageId,
    packageId: context.source?.packageId || null,
  });
  result.errors.push(conflictError(
    `packages[${packageIndex}].workspaceTemplates[${templateIndex}].name`,
    `Workspace template "${template.name}" duplicates packages[${first.packageIndex}].workspaceTemplates[${first.templateIndex}].name.`,
  ));
}

function addTemplate(result, templates, templateNames, context, packageIndex, template, templateIndex) {
  let first = templateNames.get(template.name);
  if (first) {
    addTemplateConflict(result, template, context, packageIndex, templateIndex, first);
  } else {
    templateNames.set(template.name, {
      packageIndex,
      templateIndex,
      packageId: context.source?.packageId || null,
    });
  }
  templates.push(deepClone(template));
}

function addModuleConflict(result, descriptor, context, packageIndex, moduleIndex, first) {
  result.conflicts.push({
    type: 'module-capability',
    tagName: descriptor.tagName,
    firstPackageIndex: first.packageIndex,
    packageIndex,
    firstPackageId: first.packageId,
    packageId: context.source?.packageId || null,
  });
  result.errors.push(conflictError(
    `packages[${packageIndex}].moduleCapabilities[${moduleIndex}].tagName`,
    `Module capability "${descriptor.tagName}" duplicates packages[${first.packageIndex}].moduleCapabilities[${first.moduleIndex}].tagName.`,
  ));
}

function addModuleCapability(result, modules, moduleTagNames, context, packageIndex, descriptor, moduleIndex) {
  let first = moduleTagNames.get(descriptor.tagName);
  if (first) {
    addModuleConflict(result, descriptor, context, packageIndex, moduleIndex, first);
  } else {
    moduleTagNames.set(descriptor.tagName, {
      packageIndex,
      moduleIndex,
      packageId: context.source?.packageId || null,
    });
  }
  modules.push(deepClone(descriptor));
}

function addValidPackageContext(state, context, packageIndex) {
  state.source.validPackageCount += 1;
  if (context.source) state.result.sources.push(deepClone(context.source));
  addPackageRequirements(state.result, context, state.requiredCapabilities);

  for (let i = 0; i < context.workspaceTemplates.length; i++) {
    addTemplate(
      state.result,
      state.templates,
      state.templateNames,
      context,
      packageIndex,
      context.workspaceTemplates[i],
      i,
    );
  }

  for (let i = 0; i < context.moduleCapabilities.length; i++) {
    addModuleCapability(
      state.result,
      state.modules,
      state.moduleTagNames,
      context,
      packageIndex,
      context.moduleCapabilities[i],
      i,
    );
  }
}

function finalizeCollectionResult(result, templates, modules, requiredCapabilities) {
  result.requirements = sortedCapabilityMap(result.requirements);
  result.missing = sortedCapabilityMap(result.missing);
  result.sources = result.sources.sort((a, b) => {
    let nameOrder = String(a.templateName || '').localeCompare(String(b.templateName || ''));
    return nameOrder || String(a.packageId || '').localeCompare(String(b.packageId || ''));
  });
  result.requiredCapabilities = sortedStrings(requiredCapabilities);

  result.valid = result.errors.length === 0;
  result.ready = result.valid && result.warnings.length === 0;
  result.readiness = createPackageReadinessProjection(result);

  if (result.valid) {
    result.workspaceTemplates = templates.sort((a, b) => a.name.localeCompare(b.name));
    result.moduleCapabilities = modules.sort((a, b) => a.tagName.localeCompare(b.tagName));
  } else {
    result.workspaceTemplates = [];
    result.moduleCapabilities = [];
    result.requiredCapabilities = [];
  }

  return result;
}

function contextDiagnostics(context) {
  if (!isObject(context)) {
    return [{
      path: 'context',
      message: 'Workspace construction handoff requires a package construction context object.',
      severity: 'error',
    }];
  }

  if (Array.isArray(context.errors) && context.errors.length > 0) {
    return deepClone(context.errors);
  }

  if (context.valid !== true) {
    return [{
      path: 'context.valid',
      message: 'Workspace construction handoff requires a valid package construction context.',
      severity: 'error',
    }];
  }

  return [];
}

function optionalClone(context, key, fallback = null) {
  if (!isObject(context) || context[key] === undefined || context[key] === null) return fallback;
  return deepClone(context[key]);
}

function handoffSources(context) {
  if (!isObject(context)) return [];
  if (Array.isArray(context.sources)) return deepClone(context.sources);
  if (context.source) return [deepClone(context.source)];
  return [];
}

/**
 * @param {Object|string} input - Workspace package object or JSON string
 * @param {Object} [options]
 * @param {string} [options.templateName] - External template name override
 * @param {Object} [options.available] - Host-neutral available capabilities
 * @returns {{
 *   _type: string,
 *   valid: boolean,
 *   ready: boolean,
 *   workspaceTemplates: Array,
 *   moduleCapabilities: Array,
 *   requiredCapabilities: Array,
 *   requirements: Object|null,
 *   missing: Object|null,
 *   readiness: Object|null,
 *   source: Object|null,
 *   summary: Object|null,
 *   compatibility: Object|null,
 *   warnings: Array,
 *   errors: Array,
 * }}
 */
export function createWorkspacePackageConstructionContext(input, options = {}) {
  let opts = isObject(options) ? options : {};
  let inspection = inspectWorkspacePackage(input, opts);

  let templateName = isPortableTemplateName(opts.templateName)
    ? opts.templateName.trim()
    : null;

  let result = {
    valid: inspection.valid,
    ready: inspection.ready,
    workspaceTemplates: [],
    moduleCapabilities: [],
    requiredCapabilities: [],
    requirements: inspection.requirements ? deepClone(inspection.requirements) : null,
    missing: inspection.missing ? deepClone(inspection.missing) : null,
    readiness: inspection.readiness ? deepClone(inspection.readiness) : null,
    source: null,
    summary: inspection.summary ? deepClone(inspection.summary) : null,
    compatibility: inspection.compatibility ? deepClone(inspection.compatibility) : null,
    warnings: deepClone(inspection.warnings),
    errors: deepClone(inspection.errors),
  };

  if (!inspection.valid || !inspection.config || !inspection.package) {
    return result;
  }

  let config = inspection.config;

  let packageId = inspection.package.manifest?.id || null;
  if (!templateName && packageId) {
    templateName = deriveTemplateName(packageId);
  } else if (!templateName) {
    templateName = 'pkg-workspace';
  }

  let templateDescription = inspection.summary?.name
    ? `External workspace template from "${inspection.summary.name}" v${inspection.summary.version || '0.1.0'}.`
    : 'External workspace template.';

  result.source = createSource(inspection, templateName);
  result.readiness = createPackageReadinessProjection({
    ...result,
    source: result.source,
  });
  result.workspaceTemplates = [{
    name: templateName,
    description: templateDescription,
    source: {
      type: result.source.type,
      packageId: result.source.packageId,
      packageVersion: result.source.packageVersion,
      packageSchemaVersion: result.source.packageSchemaVersion,
    },
    config: deepClone(config),
  }];

  result.moduleCapabilities = collectModuleCapabilities(config);
  result.requiredCapabilities = collectRequiredCapabilities(config);

  return result;
}

/**
 * @param {Object} context - Result from createWorkspacePackageConstructionContext() or createWorkspacePackagesConstructionContext()
 * @param {string|Object} [intent] - Construction intent to enrich with package-required capabilities
 * @returns {{
 *   valid: boolean,
 *   ready: boolean,
 *   intent: Object,
 *   options: { workspaceTemplates: Array, moduleCapabilities: Array, packageContext: Object },
 *   requirements: Object|null,
 *   missing: Object|null,
 *   readiness: Object|null,
 *   source: Object|null,
 *   sources: Array,
 *   summary: Object|null,
 *   compatibility: Object|null,
 *   warnings: Array,
 *   errors: Array,
 * }}
 */
export function createWorkspaceConstructionHandoff(context, intent = {}) {
  let baseIntent = normalizeHandoffIntent(intent);
  let valid = isObject(context) && context.valid === true;
  let contextRequired = valid ? context.requiredCapabilities : [];
  let requiredCapabilities = sortedStrings([
    ...requiredIntentCapabilities(baseIntent),
    ...(Array.isArray(contextRequired) ? contextRequired : []),
  ]);
  let source = optionalClone(context, 'source');
  let sources = handoffSources(context);
  let requirements = optionalClone(context, 'requirements');
  let missing = optionalClone(context, 'missing');
  let summary = optionalClone(context, 'summary');
  let compatibility = optionalClone(context, 'compatibility');
  let warnings = isObject(context) && Array.isArray(context.warnings) ? deepClone(context.warnings) : [];
  let errors = contextDiagnostics(context);
  let ready = valid && context.ready === true;
  let readiness = optionalClone(context, 'readiness') || createPackageReadinessProjection({
    valid,
    ready,
    missing,
    source,
    sources,
    summary,
    warnings,
    errors,
  });
  let packageContext = {
    valid,
    ready,
    requirements,
    missing,
    readiness,
    source,
    sources,
    summary,
    compatibility,
    warnings,
    errors,
  };

  return {
    _type: WORKSPACE_CONSTRUCTION_HANDOFF_TYPE,
    valid,
    ready,
    intent: {
      ...baseIntent,
      requiredCapabilities,
    },
    options: {
      workspaceTemplates: valid && Array.isArray(context.workspaceTemplates)
        ? deepClone(context.workspaceTemplates)
        : [],
      moduleCapabilities: valid && Array.isArray(context.moduleCapabilities)
        ? deepClone(context.moduleCapabilities)
        : [],
      packageContext: deepClone(packageContext),
    },
    requirements,
    missing,
    readiness,
    source,
    sources,
    summary,
    compatibility,
    warnings,
    errors,
  };
}

/**
 * @param {{ packages: Array, available?: Object }} input
 * @param {Object} [options]
 * @param {Object} [options.available] - Host-neutral available capabilities
 * @returns {{
 *   valid: boolean,
 *   ready: boolean,
 *   workspaceTemplates: Array,
 *   moduleCapabilities: Array,
 *   requiredCapabilities: Array,
 *   requirements: Object,
 *   missing: Object,
 *   readiness: Object|null,
 *   summary: Object|null,
 *   compatibility: Object|null,
 *   source: Object,
 *   sources: Array,
 *   packageResults: Array,
 *   conflicts: Array,
 *   warnings: Array,
 *   errors: Array,
 * }}
 */
export function createWorkspacePackagesConstructionContext(input, options = {}) {
  let entries = normalizePackageEntries(input);
  let opts = collectionOptions(input, options);
  let source = {
    type: 'workspace-package-collection',
    packageCount: entries.length,
    validPackageCount: 0,
  };

  let result = {
    valid: false,
    ready: false,
    workspaceTemplates: [],
    moduleCapabilities: [],
    requiredCapabilities: [],
    requirements: emptyCapabilityMap(),
    missing: emptyCapabilityMap(),
    readiness: null,
    summary: null,
    compatibility: null,
    source,
    sources: [],
    packageResults: [],
    conflicts: [],
    warnings: [],
    errors: [],
  };

  if (!Array.isArray(entries) || entries.length === 0) {
    result.errors.push({
      path: 'packages',
      message: 'Workspace package collection requires a non-empty packages array.',
      severity: 'error',
    });
    return result;
  }

  let state = {
    result,
    source,
    templates: [],
    modules: [],
    requiredCapabilities: [],
    templateNames: new Map(),
    moduleTagNames: new Map(),
  };

  for (let i = 0; i < entries.length; i++) {
    let entry = entryInput(entries[i]);
    let context = createWorkspacePackageConstructionContext(entry.value, packageOptionsForEntry(entry, opts));
    let packageResult = { index: i, ...deepClone(context) };
    result.packageResults.push(packageResult);

    result.warnings.push(...context.warnings.map((warning) => prefixedDiagnostic(i, warning)));

    if (!context.valid) {
      addInvalidPackageDiagnostics(result, context, i);
      continue;
    }

    addValidPackageContext(state, context, i);
  }

  return finalizeCollectionResult(result, state.templates, state.modules, state.requiredCapabilities);
}
