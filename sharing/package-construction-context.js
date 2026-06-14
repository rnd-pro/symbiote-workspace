import { inspectWorkspacePackage } from './workspace-package.js';

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

/**
 * @param {Object|string} input - Workspace package object or JSON string
 * @param {Object} [options]
 * @param {string} [options.templateName] - External template name override
 * @param {Object} [options.available] - Host-neutral available capabilities
 * @returns {{
 *   valid: boolean,
 *   ready: boolean,
 *   workspaceTemplates: Array,
 *   moduleCapabilities: Array,
 *   requiredCapabilities: Array,
 *   requirements: Object|null,
 *   missing: Object|null,
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
