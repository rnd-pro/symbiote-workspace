/**
 * Config, validation, sharing, and preview dispatch-tool family.
 * @module symbiote-workspace/runtime/tools/config-tools
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { startPreview } from '../../handlers/preview.js';
import { defineToolFamily } from './registry.js';

const WORKSPACE_PATCH_INPUT_ANY_OF = Object.freeze([
  { required: ['overlay'] },
  { required: ['patch'] },
]);

export const configTools = [
  {
    name: 'config_patch_propose',
    description: 'Preview a workspace overlay or construction patch without mutating the active session.',
    inputSchema: {
      type: 'object',
      properties: {
        overlay: { type: 'object', description: 'Partial config overlay.' },
        patch: { type: 'object', description: 'Structured construction patch.' },
      },
      anyOf: WORKSPACE_PATCH_INPUT_ANY_OF,
    },
    requiresConfig: true,
  },
  {
    name: 'config_patch_validate',
    description: 'Validate a workspace overlay or construction patch before applying it.',
    inputSchema: {
      type: 'object',
      properties: {
        overlay: { type: 'object', description: 'Partial config overlay.' },
        patch: { type: 'object', description: 'Structured construction patch.' },
      },
      anyOf: WORKSPACE_PATCH_INPUT_ANY_OF,
    },
    requiresConfig: true,
  },
  {
    name: 'config_patch_apply',
    description: 'Validate and apply a workspace overlay or construction patch to the active session.',
    inputSchema: {
      type: 'object',
      properties: {
        overlay: { type: 'object', description: 'Partial config overlay.' },
        patch: { type: 'object', description: 'Structured construction patch.' },
      },
      anyOf: WORKSPACE_PATCH_INPUT_ANY_OF,
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'preview_start',
    description: 'Generate preview files from current workspace config.',
    inputSchema: {
      type: 'object',
      properties: {
        outputDir: { type: 'string' },
        port: { type: 'number' },
        imports: { type: 'object' },
        serveRoot: { type: 'string' },
      },
    },
    writesFiles: true,
    requiresConfig: true,
  },
  {
    name: 'config_validate',
    description: 'Validate the current workspace config.',
    inputSchema: {
      type: 'object',
      properties: { strict: { type: 'boolean' } },
    },
    requiresConfig: true,
  },
  {
    name: 'config_save',
    description: 'Save workspace config to a JSON file.',
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string' } },
      required: ['filePath'],
    },
    mutates: true,
    writesFiles: true,
    requiresConfig: true,
  },
  {
    name: 'config_load',
    description: 'Load a portable workspace config from a JSON file.',
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string' } },
      required: ['filePath'],
    },
    mutates: true,
  },
  {
    name: 'config_export',
    description: 'Export workspace config as portable JSON.',
    inputSchema: {
      type: 'object',
      properties: { strict: { type: 'boolean', description: 'Reject on validation warnings.' } },
    },
    requiresConfig: true,
  },
  {
    name: 'config_import',
    description: 'Import workspace config from portable JSON string.',
    inputSchema: {
      type: 'object',
      properties: { json: { type: 'string', description: 'JSON string of workspace config.' } },
      required: ['json'],
    },
    mutates: true,
  },
  {
    name: 'config_diff',
    description: 'Compare another workspace config against the current config.',
    inputSchema: {
      type: 'object',
      properties: {
        otherJson: { type: 'string', description: 'JSON string of config to compare against current.' },
      },
      required: ['otherJson'],
    },
    requiresConfig: true,
  },
  {
    name: 'config_merge',
    description: 'Merge partial config overlay onto current workspace config.',
    inputSchema: {
      type: 'object',
      properties: {
        overlay: { type: 'object', description: 'Partial config to merge.' },
      },
      required: ['overlay'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'config_guardrails_check',
    description: 'Check design guardrails.',
    inputSchema: { type: 'object', properties: {} },
    requiresConfig: true,
  },
];

async function configPatchPropose(args, { config, toolName }) {
  let patch = args.patch || args.overlay;
  if (!patch) return { status: 'error', tool: toolName, hint: 'Missing required arguments: overlay or patch' };
  let { proposeWorkspacePatch } = await import('../../validation/index.js');
  let result = await proposeWorkspacePatch(config, args.patch || { overlay: args.overlay });
  return { ...result, status: result.accepted ? 'ok' : 'invalid' };
}

async function configPatchValidate(args, { config, toolName }) {
  let patch = args.patch || args.overlay;
  if (!patch) return { status: 'error', tool: toolName, hint: 'Missing required arguments: overlay or patch' };
  let { validateWorkspacePatch } = await import('../../validation/index.js');
  let result = await validateWorkspacePatch(config, args.patch || { overlay: args.overlay });
  return { ...result, valid: result.accepted, status: result.accepted ? 'ok' : 'invalid' };
}

async function configPatchApply(args, { config, toolName }) {
  let patch = args.patch || args.overlay;
  if (!patch) return { status: 'error', tool: toolName, hint: 'Missing required arguments: overlay or patch' };
  let { applyWorkspacePatch } = await import('../../validation/index.js');
  let result = await applyWorkspacePatch(config, args.patch || { overlay: args.overlay });
  if (!result.config) {
    return { ...result, status: 'error', hint: 'Patch rejected: workspace validation failed.' };
  }
  return { ...result, status: 'ok', hint: 'Workspace patch applied.' };
}

function previewStart(args, { config }) {
  return startPreview(config, args);
}

async function configValidate(args, { config }) {
  let { validateWorkspaceConfig } = await import('../../validation/core.js');
  return validateWorkspaceConfig(config, { strict: args.strict });
}

async function configSave(args, { config }) {
  let filePath = resolve(args.filePath);
  await writeFile(filePath, JSON.stringify(config, null, 2));
  return { status: 'ok', filePath, configFilePath: filePath, hint: `Config saved to ${filePath}.` };
}

async function configLoad(args, { toolName }) {
  let filePath = resolve(args.filePath);
  let json;
  try {
    json = await readFile(filePath, 'utf-8');
  } catch (err) {
    return {
      status: 'error',
      tool: toolName,
      filePath,
      code: 'workspace_config_read_failed',
      errors: [{ path: 'filePath', message: `Cannot read config file: ${err.message}`, severity: 'error' }],
      hint: `Load failed: cannot read ${filePath}.`,
    };
  }
  let { importConfig } = await import('../../sharing/index.js');
  let result = importConfig(json);
  if (!result.config) {
    return {
      status: 'error',
      tool: toolName,
      filePath,
      errors: result.errors,
      code: 'workspace_config_invalid',
      hint: 'Load failed: file does not contain a portable workspace config.',
    };
  }
  return { status: 'ok', filePath, configFilePath: filePath, config: result.config, hint: `Config loaded from ${filePath}.` };
}

async function configExport(args, { config }) {
  let { exportConfig } = await import('../../sharing/index.js');
  let result = exportConfig(config, { strict: args.strict });
  if (!result.json) {
    return { status: 'error', errors: result.errors, hint: 'Export failed: config has validation errors.' };
  }
  return { status: 'ok', json: result.json, hint: 'Config exported as portable JSON.' };
}

async function configImport(args) {
  let { importConfig } = await import('../../sharing/index.js');
  let result = importConfig(args.json);
  if (!result.config) {
    return { status: 'error', errors: result.errors, hint: 'Import failed: invalid config.' };
  }
  return { status: 'ok', config: result.config, hint: `Imported workspace "${result.config.name}".` };
}

async function configDiff(args, { config }) {
  let { diffConfigs } = await import('../../sharing/index.js');
  let other = JSON.parse(args.otherJson);
  let diffs = diffConfigs(config, other);
  return { changes: diffs, count: diffs.length, hint: `${diffs.length} difference(s) found.` };
}

async function configMerge(args, { config }) {
  let { mergeConfigs } = await import('../../sharing/index.js');
  let merged = mergeConfigs(config, args.overlay);
  return { status: 'ok', config: merged, hint: 'Overlay merged into workspace config.' };
}

async function configGuardrailsCheck(_args, { config }) {
  let { checkDesignGuardrails } = await import('../../validation/index.js');
  return checkDesignGuardrails(config);
}

const handlers = {
  config_patch_propose: configPatchPropose,
  config_patch_validate: configPatchValidate,
  config_patch_apply: configPatchApply,
  preview_start: previewStart,
  config_validate: configValidate,
  config_save: configSave,
  config_load: configLoad,
  config_export: configExport,
  config_import: configImport,
  config_diff: configDiff,
  config_merge: configMerge,
  config_guardrails_check: configGuardrailsCheck,
};

export const configToolFamily = defineToolFamily('config', configTools, handlers);
