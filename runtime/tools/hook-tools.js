/**
 * Hook dispatch-tool family.
 * @module symbiote-workspace/runtime/tools/hook-tools
 */

import { previewHookMatches } from '../hook-bridge.js';
import { defineToolFamily } from './registry.js';

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function hooksFromConfig(config) {
  return Array.isArray(config?.hooks) ? config.hooks : [];
}

function configWithHooks(config, hooks) {
  return { ...(config || {}), hooks };
}

function requireConfig(config, toolName) {
  if (!config) {
    return {
      status: 'error',
      tool: toolName,
      code: 'workspace_config_missing',
      hint: 'No active workspace config.',
    };
  }
  return null;
}

function requireHook(value, toolName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'error', tool: toolName, code: 'hook_invalid', hint: 'Hook must be an object.' };
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    return { status: 'error', tool: toolName, code: 'hook_id_missing', hint: 'Hook requires id.' };
  }
  return null;
}

export const hookTools = [
  {
    name: 'hook_add',
    description: 'Add a behavior hook to the workspace config.',
    inputSchema: {
      type: 'object',
      properties: {
        hook: { type: 'object', description: 'B1-shaped hooks[] entry.' },
      },
      required: ['hook'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'hook_update',
    description: 'Update a behavior hook by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Hook id.' },
        patch: { type: 'object', description: 'Partial hook overlay.' },
        hook: { type: 'object', description: 'Replacement hook object.' },
      },
      required: ['id'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'hook_remove',
    description: 'Remove a behavior hook by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Hook id.' },
      },
      required: ['id'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'hook_list',
    description: 'List behavior hooks in workspace order.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    requiresConfig: true,
  },
  {
    name: 'preview_hook_matches',
    description: 'Preview hooks that would match observer recent entries or a supplied subject.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Optional hook trigger subject to test.' },
        entry: { type: 'object', description: 'Optional $entry payload for a supplied subject.' },
      },
    },
    requiresConfig: true,
  },
];

async function hookAdd(args = {}, { config, toolName }) {
  let missing = requireConfig(config, toolName);
  if (missing) return missing;
  let invalid = requireHook(args.hook, toolName);
  if (invalid) return invalid;
  let hooks = hooksFromConfig(config);
  if (hooks.some((hook) => hook.id === args.hook.id)) {
    return { status: 'error', tool: toolName, code: 'hook_id_duplicate', hint: `Hook "${args.hook.id}" already exists.` };
  }
  let nextHooks = [...hooks.map(cloneJson), cloneJson(args.hook)];
  return { status: 'ok', config: configWithHooks(config, nextHooks), hook: cloneJson(args.hook) };
}

async function hookUpdate(args = {}, { config, toolName }) {
  let missing = requireConfig(config, toolName);
  if (missing) return missing;
  let hooks = hooksFromConfig(config);
  let index = hooks.findIndex((hook) => hook.id === args.id);
  if (index === -1) {
    return { status: 'error', tool: toolName, code: 'hook_not_found', hint: `Hook "${args.id}" was not found.` };
  }
  let overlay = args.hook || args.patch;
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
    return { status: 'error', tool: toolName, code: 'hook_patch_missing', hint: 'hook_update requires patch or hook.' };
  }
  let updated = { ...cloneJson(hooks[index]), ...cloneJson(overlay), id: args.id };
  let nextHooks = hooks.map((hook, hookIndex) => (hookIndex === index ? updated : cloneJson(hook)));
  return { status: 'ok', config: configWithHooks(config, nextHooks), hook: cloneJson(updated) };
}

async function hookRemove(args = {}, { config, toolName }) {
  let missing = requireConfig(config, toolName);
  if (missing) return missing;
  let hooks = hooksFromConfig(config);
  let nextHooks = hooks.filter((hook) => hook.id !== args.id).map(cloneJson);
  if (nextHooks.length === hooks.length) {
    return { status: 'error', tool: toolName, code: 'hook_not_found', hint: `Hook "${args.id}" was not found.` };
  }
  return { status: 'ok', config: configWithHooks(config, nextHooks), removed: args.id };
}

async function hookList(_args = {}, { config, toolName }) {
  let missing = requireConfig(config, toolName);
  if (missing) return missing;
  let hooks = hooksFromConfig(config).map(cloneJson);
  return { status: 'ok', count: hooks.length, hooks };
}

async function previewHookMatchesTool(args = {}, { config, session, toolName }) {
  let missing = requireConfig(config, toolName);
  if (missing) return missing;
  let wireObservation = args.wireObservation
    || session?.hookBridge?.wireObservation
    || session?.wireObservation
    || session?.wireObserver
    || null;
  return previewHookMatches(config, wireObservation, args);
}

export function createHookToolHandlers() {
  return {
    hook_add: hookAdd,
    hook_update: hookUpdate,
    hook_remove: hookRemove,
    hook_list: hookList,
    preview_hook_matches: previewHookMatchesTool,
  };
}

export const handlers = createHookToolHandlers();

export const hookToolFamily = defineToolFamily('hook', hookTools, handlers);

export default hookToolFamily;
