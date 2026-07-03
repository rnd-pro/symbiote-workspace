/**
 * Unified dispatch composition root for symbiote-workspace.
 *
 * Tool behavior lives in runtime/tools/* families. This module owns only the
 * merged registry, shared argument validation, actor threading, and mutation
 * contract enforcement.
 *
 * @module symbiote-workspace/runtime/dispatch
 */

import { ORIGIN_ACTORS } from '../schema/sections/wiring.js';
import { configToolFamily } from './tools/config-tools.js';
import { constructionToolFamily } from './tools/construction-tools.js';
import { discoveryToolFamily } from './tools/discovery-tools.js';
import { documentToolFamily } from './tools/document-tools.js';
import { executionToolFamily } from './tools/execution-tools.js';
import { grantToolFamily } from './tools/grant-tools.js';
import { hookToolFamily } from './tools/hook-tools.js';
import { packageToolFamily } from './tools/package-tools.js';
import { createToolRegistry } from './tools/registry.js';
import { routeToolFamily } from './tools/route-tools.js';
import { sessionToolFamily } from './tools/session-tools.js';
import { structureToolFamily } from './tools/structure-tools.js';

export const TOOL_FAMILIES = Object.freeze([
  discoveryToolFamily,
  constructionToolFamily,
  structureToolFamily,
  configToolFamily,
  packageToolFamily,
  routeToolFamily,
  documentToolFamily,
  sessionToolFamily,
  hookToolFamily,
  grantToolFamily,
  executionToolFamily,
]);

export const TOOL_REGISTRY = createToolRegistry(TOOL_FAMILIES);
export const TOOLS = TOOL_REGISTRY.tools;

const DEFAULT_ACTOR = 'agent-gated';
const TOOL_CONTRACT_ERROR = 'tool-contract';
const ACTORS = new Set(ORIGIN_ACTORS);

let confirmPolicyModule = null;

async function getToolConfirmPolicy() {
  if (!confirmPolicyModule) confirmPolicyModule = await import('./tool-policy.js');
  return confirmPolicyModule.toolConfirmPolicy;
}

/**
 * Check if a tool mutates config or writes through a mutating lane.
 *
 * @param {string} toolName
 * @returns {boolean}
 */
export function isMutating(toolName) {
  return TOOL_REGISTRY.toolMap.get(toolName)?.mutates === true;
}

/**
 * Return the public definition for a dispatch tool.
 *
 * @param {string} toolName
 * @returns {Object|undefined}
 */
export function getToolDefinition(toolName) {
  return TOOL_REGISTRY.toolMap.get(toolName);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function compactObject(value) {
  let result = {};
  for (let [key, child] of Object.entries(value)) {
    if (child !== undefined) result[key] = child;
  }
  return result;
}

function normalizeActor(session, options = {}) {
  let actor = options.actor ?? session?.actor ?? DEFAULT_ACTOR;
  if (!ACTORS.has(actor)) {
    let err = new Error(`Invalid dispatch actor: ${String(actor)}.`);
    err.code = TOOL_CONTRACT_ERROR;
    throw err;
  }
  return actor;
}

function validateArgs(toolName, args) {
  let tool = TOOL_REGISTRY.toolMap.get(toolName);
  if (!tool) return { valid: true };
  let input = args || {};

  let required = tool.inputSchema?.required;
  let missing = (required || []).filter((key) => input[key] === undefined || input[key] === null);
  if (missing.length > 0) return { valid: false, missing };

  let alternatives = (tool.inputSchema?.anyOf || [])
    .map((schema) => schema?.required)
    .filter((items) => Array.isArray(items) && items.length > 0);
  if (alternatives.length > 0) {
    let matched = alternatives.some((items) => items.every((key) => {
      return input[key] !== undefined && input[key] !== null;
    }));
    if (!matched) {
      return {
        valid: false,
        missing: [alternatives.map((items) => items.join(', ')).join(' or ')],
      };
    }
  }

  return { valid: true };
}

function validateBaseRevision(tool, args = {}, session) {
  if (tool.mutates !== true) return null;
  if (args.baseRevision === undefined || args.baseRevision === null) {
    return {
      status: 'error',
      tool: tool.name,
      code: TOOL_CONTRACT_ERROR,
      hint: `Mutating tool "${tool.name}" requires baseRevision.`,
    };
  }
  if (!Number.isInteger(args.baseRevision)) {
    return {
      status: 'error',
      tool: tool.name,
      code: TOOL_CONTRACT_ERROR,
      hint: `Mutating tool "${tool.name}" requires integer baseRevision.`,
    };
  }
  if (tool.revisionScope && tool.revisionScope !== 'workspace') return null;
  let currentRevision = session?.revision ?? 0;
  if (args.baseRevision !== currentRevision) {
    return {
      status: 'error',
      tool: tool.name,
      code: 'revision_conflict',
      baseRevision: args.baseRevision,
      currentRevision,
      hint: `Revision conflict for "${tool.name}": baseRevision ${args.baseRevision} does not match current revision ${currentRevision}.`,
    };
  }
  return null;
}

function missingConfigResult(toolName) {
  return {
    status: 'error',
    tool: toolName,
    code: 'workspace_config_missing',
    hint: [
      'No active workspace config.',
      'Create or load one first with construction_scaffold, construction_scaffold_blank,',
      'construction_construct, config_load, config_import, or pack_import.',
    ].join(' '),
  };
}

function buildOrigin(session, actor, toolName) {
  return {
    principal: cloneJson(session?.principal || { kind: 'agent', id: 'dispatch' }),
    actor,
    reason: `tool:${toolName}`,
    sessionId: session?.sessionId || 'default',
  };
}

function resultIsError(result) {
  return result?.status === 'error';
}

function applyMutationResult(tool, args, session, result, actor) {
  if (!session || resultIsError(result)) return result;
  if (tool.revisionScope && tool.revisionScope !== 'workspace') return result;

  let next = result;
  if (tool.mutates === true && result?.status === 'ok') {
    if (result && typeof result === 'object') {
      if (result.config !== undefined) session.config = result.config;
      if (result.configFilePath !== undefined) session.configFilePath = result.configFilePath;
    }
    let mutation = typeof session.commitMutation === 'function'
      ? session.commitMutation({
        toolName: tool.name,
        actor,
        baseRevision: args.baseRevision,
        reason: `tool:${tool.name}`,
      })
      : {
        revision: (session.revision = (session.revision ?? 0) + 1),
        origin: buildOrigin(session, actor, tool.name),
      };
    next = {
      ...result,
      baseRevision: args.baseRevision,
      revision: mutation.revision,
      origin: mutation.origin,
    };
  }

  return next;
}

/**
 * Dispatch a tool call.
 *
 * @param {string} toolName
 * @param {Object} args
 * @param {import('./session.js').Session} session
 * @param {{actor?: string}} [options]
 * @returns {Promise<Object>}
 */
export async function dispatch(toolName, args = {}, session, options = {}) {
  let tool = TOOL_REGISTRY.toolMap.get(toolName);
  if (!tool) {
    return { status: 'error', code: 'unknown-tool', hint: `Unknown tool: ${toolName}` };
  }

  let actor;
  try {
    actor = normalizeActor(session, options);
  } catch (err) {
    return { status: 'error', tool: toolName, code: err.code || TOOL_CONTRACT_ERROR, hint: err.message };
  }

  let validation = validateArgs(toolName, args);
  if (!validation.valid) {
    return {
      status: 'error',
      tool: toolName,
      code: TOOL_CONTRACT_ERROR,
      hint: `Missing required arguments: ${validation.missing.join(', ')}`,
    };
  }

  let revisionError = validateBaseRevision(tool, args, session);
  if (revisionError) return revisionError;

  if (tool.requiresConfig === true && !session?.config) {
    return missingConfigResult(toolName);
  }

  let toolConfirmPolicy = await getToolConfirmPolicy();
  let confirmPolicy = toolConfirmPolicy(toolName, {
    actor,
    scope: args.scope,
    grants: session?.grants,
  });
  let handler = TOOL_REGISTRY.handlers.get(toolName);
  let context = {
    tool,
    toolName,
    session,
    config: session?.config,
    actor,
    baseRevision: args.baseRevision,
    confirmPolicy,
    origin: buildOrigin(session, actor, toolName),
  };

  try {
    let result = await handler(args, context);
    return applyMutationResult(tool, args, session, result, actor);
  } catch (err) {
    return compactObject({
      status: 'error',
      tool: toolName,
      code: err.code,
      hint: err.message || String(err),
    });
  }
}
