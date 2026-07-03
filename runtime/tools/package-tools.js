/**
 * Workspace package dispatch-tool family.
 * @module symbiote-workspace/runtime/tools/package-tools
 */

import { defineToolFamily } from './registry.js';

const availableCapabilitiesSchema = {
  type: 'object',
  description: 'Host-neutral available capabilities map.',
  properties: {
    components: { type: 'array', items: { type: 'string' } },
    plugins: { type: 'array', items: { type: 'string' } },
    packages: { type: 'array', items: { type: 'string' } },
    hostServices: { type: 'array', items: { type: 'string' } },
    runtimeSlots: { type: 'array', items: { type: 'string' } },
  },
};

export const packageTools = [
  {
    name: 'pack_export',
    description: 'Export the workspace as a portable package with config, manifest, and host contract.',
    inputSchema: {
      type: 'object',
      properties: {
        manifest: { type: 'object', description: 'Package manifest with id, name, version, tags, permissions, support, and dependencies.' },
        strict: { type: 'boolean', description: 'Reject on validation warnings.' },
      },
    },
    requiresConfig: true,
  },
  {
    name: 'pack_import',
    description: 'Import a portable workspace package JSON and restore the session config.',
    inputSchema: {
      type: 'object',
      properties: {
        json: { type: 'string', description: 'JSON string of the workspace package.' },
      },
      required: ['json'],
    },
    mutates: true,
  },
  {
    name: 'pack_validate',
    description: 'Validate a workspace package object or JSON string without mutating session state.',
    inputSchema: {
      type: 'object',
      properties: {
        package: { type: 'object', description: 'Workspace package object to validate.' },
        json: { type: 'string', description: 'JSON string of the workspace package to validate.' },
      },
      anyOf: [
        { required: ['package'] },
        { required: ['json'] },
      ],
    },
  },
  {
    name: 'pack_inspect',
    description: 'Inspect a workspace package object or JSON string for validity, readiness, and host-neutral capability requirements.',
    inputSchema: {
      type: 'object',
      properties: {
        package: { type: 'object', description: 'Workspace package object to inspect.' },
        json: { type: 'string', description: 'JSON string of the workspace package to inspect.' },
        available: availableCapabilitiesSchema,
      },
      anyOf: [
        { required: ['package'] },
        { required: ['json'] },
      ],
    },
  },
  {
    name: 'pack_context_create',
    description: 'Create a construction context from a workspace package for guided workspace assembly.',
    inputSchema: {
      type: 'object',
      properties: {
        package: { type: 'object', description: 'Workspace package object.' },
        json: { type: 'string', description: 'JSON string of the workspace package.' },
        available: availableCapabilitiesSchema,
        templateName: { type: 'string', description: 'External template name override.' },
      },
      anyOf: [
        { required: ['package'] },
        { required: ['json'] },
      ],
    },
  },
  {
    name: 'pack_contexts_create',
    description: 'Create a construction context from multiple workspace packages for guided workspace assembly.',
    inputSchema: {
      type: 'object',
      properties: {
        packages: {
          type: 'array',
          description: 'Workspace package entries: [{ package, json, templateName }].',
          items: {
            type: 'object',
            properties: {
              package: { type: 'object', description: 'Workspace package object.' },
              json: { type: 'string', description: 'JSON string of the workspace package.' },
              templateName: { type: 'string', description: 'External template name override.' },
            },
          },
        },
        available: availableCapabilitiesSchema,
      },
      required: ['packages'],
    },
  },
  {
    name: 'pack_handoff_create',
    description: 'Create a workspace construction handoff from a package construction context and intent.',
    inputSchema: {
      type: 'object',
      properties: {
        context: {
          type: 'object',
          description: 'Package construction context object from pack_context_create or pack_contexts_create.',
        },
        intent: {
          anyOf: [
            { type: 'string' },
            { type: 'object' },
          ],
          description: 'Construction intent to enrich with package-required capabilities.',
        },
      },
      required: ['context'],
    },
  },
  {
    name: 'pack_plugin_modules_collect',
    description: 'Collect portable module capability descriptors from plugin definitions without activating plugins.',
    inputSchema: {
      type: 'object',
      properties: {
        plugins: {
          description: 'Plugin definition object or array of plugin definitions.',
          anyOf: [
            { type: 'object' },
            { type: 'array', items: { type: 'object' } },
          ],
        },
      },
      required: ['plugins'],
    },
  },
  {
    name: 'pack_plugin_templates_collect',
    description: 'Collect portable workspace templates from plugin definitions without activating plugins.',
    inputSchema: {
      type: 'object',
      properties: {
        plugins: {
          description: 'Plugin definition object or array of plugin definitions.',
          anyOf: [
            { type: 'object' },
            { type: 'array', items: { type: 'object' } },
          ],
        },
      },
      required: ['plugins'],
    },
  },
];

function parseJsonInput(value) {
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function toJsonString(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

async function packExport(args, { config }) {
  let { exportWorkspacePackage } = await import('../../sharing/index.js');
  let result = exportWorkspacePackage(config, args.manifest || {}, { strict: args.strict });
  if (!result.json) {
    return { status: 'error', errors: result.errors, hint: 'Workspace package export failed: validation errors.' };
  }
  return { status: 'ok', json: result.json, package: result.package, hint: 'Workspace exported as portable package.' };
}

async function packImport(args) {
  let { importWorkspacePackage } = await import('../../sharing/index.js');
  let result = importWorkspacePackage(toJsonString(args.json));
  if (!result.config) {
    return { status: 'error', errors: result.errors, hint: 'Workspace package import failed: invalid package.' };
  }
  return { status: 'ok', config: result.config, package: result.package, hint: `Imported workspace package "${result.config.name}".` };
}

async function packValidate(args, { toolName }) {
  let { validateWorkspacePackage } = await import('../../sharing/index.js');
  let input;
  try {
    input = args.package || parseJsonInput(args.json);
  } catch (err) {
    return {
      status: 'error',
      tool: toolName,
      valid: false,
      errors: [{ path: '', message: `Invalid JSON: ${err.message}`, severity: 'error' }],
      code: 'workspace_package_invalid',
      nextAction: 'fix-workspace-package',
      hint: 'Workspace package has validation errors.',
    };
  }
  if (!input) return { status: 'error', tool: toolName, hint: 'Missing required arguments: package or json' };
  let result = validateWorkspacePackage(input);
  return {
    status: result.valid ? 'ok' : 'error',
    ...(result.valid ? {} : { tool: toolName }),
    valid: result.valid,
    errors: result.errors,
    ...(result.valid ? {} : { code: 'workspace_package_invalid', nextAction: 'fix-workspace-package' }),
    hint: result.valid ? 'Workspace package is valid.' : 'Workspace package has validation errors.',
  };
}

async function packInspect(args, { toolName }) {
  let input = args.package || args.json;
  if (!input) return { status: 'error', tool: toolName, hint: 'Missing required arguments: package or json' };
  let { inspectWorkspacePackage } = await import('../../sharing/index.js');
  let raw = args.available === undefined
    ? inspectWorkspacePackage(input)
    : inspectWorkspacePackage(input, { available: args.available });
  return {
    status: 'ok',
    valid: raw.valid,
    ready: raw.ready,
    summary: raw.summary,
    compatibility: raw.compatibility,
    requirements: raw.requirements,
    missing: raw.missing,
    readiness: raw.readiness,
    nextAction: raw.readiness?.nextAction,
    warnings: raw.warnings,
    errors: raw.errors,
  };
}

async function packContextCreate(args, { toolName }) {
  let input = args.package || args.json;
  if (!input) return { status: 'error', tool: toolName, hint: 'Missing required arguments: package or json' };
  let { createWorkspacePackageConstructionContext } = await import('../../sharing/index.js');
  let options = {};
  if (args.available !== undefined) options.available = args.available;
  if (args.templateName !== undefined) options.templateName = args.templateName;
  let result = createWorkspacePackageConstructionContext(input, options);
  return {
    status: 'ok',
    valid: result.valid,
    ready: result.ready,
    workspaceTemplates: result.workspaceTemplates,
    moduleCapabilities: result.moduleCapabilities,
    requiredCapabilities: result.requiredCapabilities,
    requirements: result.requirements,
    missing: result.missing,
    readiness: result.readiness,
    nextAction: result.readiness?.nextAction,
    source: result.source,
    summary: result.summary,
    compatibility: result.compatibility,
    warnings: result.warnings,
    errors: result.errors,
  };
}

async function packContextsCreate(args) {
  let { createWorkspacePackagesConstructionContext } = await import('../../sharing/index.js');
  let input = { packages: args.packages };
  if (args.available !== undefined) input.available = args.available;
  let result = createWorkspacePackagesConstructionContext(input);
  return {
    status: 'ok',
    valid: result.valid,
    ready: result.ready,
    workspaceTemplates: result.workspaceTemplates,
    moduleCapabilities: result.moduleCapabilities,
    requiredCapabilities: result.requiredCapabilities,
    requirements: result.requirements,
    missing: result.missing,
    readiness: result.readiness,
    nextAction: result.readiness?.nextAction,
    source: result.source,
    sources: result.sources,
    summary: result.summary,
    compatibility: result.compatibility,
    packageResults: result.packageResults,
    conflicts: result.conflicts,
    warnings: result.warnings,
    errors: result.errors,
  };
}

async function packHandoffCreate(args, { toolName }) {
  if (!args.context) return { status: 'error', tool: toolName, hint: 'Missing required arguments: context' };
  let { createWorkspaceConstructionHandoff } = await import('../../sharing/index.js');
  let raw;
  try {
    raw = createWorkspaceConstructionHandoff(args.context, args.intent);
  } catch (err) {
    if (err.code !== 'construction_handoff_intent_invalid') throw err;
    return {
      status: 'error',
      tool: toolName,
      hint: err.message,
      code: err.code,
      nextAction: err.nextAction,
      readiness: err.readiness,
    };
  }
  return {
    status: 'ok',
    _type: 'workspace-construction-handoff',
    intent: raw.intent,
    options: raw.options,
    valid: raw.valid,
    ready: raw.ready,
    requirements: raw.requirements,
    missing: raw.missing,
    readiness: raw.readiness,
    nextAction: raw.readiness?.nextAction,
    source: raw.source,
    sources: raw.sources,
    summary: raw.summary,
    compatibility: raw.compatibility,
    warnings: raw.warnings,
    errors: raw.errors,
  };
}

async function packPluginModulesCollect(args) {
  let { collectPluginModuleCapabilities } = await import('../../plugins/index.js');
  let result = collectPluginModuleCapabilities(args.plugins);
  return {
    status: result.ok ? 'ok' : 'error',
    ok: result.ok,
    moduleCapabilities: result.moduleCapabilities,
    errors: result.errors,
  };
}

async function packPluginTemplatesCollect(args) {
  let { collectPluginWorkspaceTemplates } = await import('../../plugins/index.js');
  let result = collectPluginWorkspaceTemplates(args.plugins);
  return {
    status: result.ok ? 'ok' : 'error',
    ok: result.ok,
    templates: result.templates,
    errors: result.errors,
  };
}

const handlers = {
  pack_export: packExport,
  pack_import: packImport,
  pack_validate: packValidate,
  pack_inspect: packInspect,
  pack_context_create: packContextCreate,
  pack_contexts_create: packContextsCreate,
  pack_handoff_create: packHandoffCreate,
  pack_plugin_modules_collect: packPluginModulesCollect,
  pack_plugin_templates_collect: packPluginTemplatesCollect,
};

export const packageToolFamily = defineToolFamily('package', packageTools, handlers);
