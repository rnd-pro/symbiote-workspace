/**
 * Construction-agent adapter contract.
 *
 * The construction loop is model-agnostic: it drives any adapter that can decide
 * the next step from a read-only context. This module owns the contract — the
 * `ctx` the runner assembles each turn, the closed `Step` union an adapter may
 * return, the `validateStep` gate that rejects anything off-contract, and the
 * `buildCtx` helper the loop uses to assemble the per-turn context.
 *
 * The contract carries NO model, key, endpoint, or provider concept. A scripted
 * adapter, an LLM-backed adapter, or a record/replay adapter all satisfy it the
 * same way: implement `async nextStep(ctx): Step`.
 *
 * @module symbiote-workspace/runtime/construction-agent
 */

import { TOOLS } from './dispatch.js';

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/**
 * @typedef {Object} ConstructionAgent
 * @property {(ctx: ConstructionCtx) => Promise<Step>} nextStep
 *   Decide the next step from the read-only per-turn context.
 */

/**
 * @typedef {Object} ToolView
 * @property {string} name
 * @property {string} description
 * @property {Object} inputSchema
 * @property {boolean} [mutates]
 */

/**
 * @typedef {Object} HistoryEntry
 * @property {string} toolName
 * @property {Object} args
 * @property {{ summary: string, warnings: string[], data: * }} envelope
 * @property {string} [status]
 * @property {string} [nextAction]
 */

/**
 * @typedef {Object} ConstructionCtx
 * @property {string|Object} [intent] - The construction intent for this run.
 * @property {Object|null} config - A safe (cloned) view of session.config.
 * @property {ToolView[]} tools - The TOOLS slice {name,description,inputSchema,mutates}.
 * @property {HistoryEntry[]} history - Tool-call history with envelope-wrapped results.
 * @property {*} [lastResult] - The raw result of the last dispatched tool.
 * @property {string} [lastNextAction] - The last tool's suggested nextAction, if any.
 */

/**
 * @typedef {(
 *   { type: 'tool', toolName: string, args?: Object, display?: string }
 *   | { type: 'message', display: string, llmContent?: string }
 *   | { type: 'done', display?: string }
 * )} Step
 */

const STEP_TYPES = new Set(['tool', 'message', 'done']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * The read-only tool slice exposed to an adapter: name, description, inputSchema,
 * and the mutates flag. Cloned so an adapter cannot mutate the live registry.
 *
 * @returns {ToolView[]}
 */
export function toolViews() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: cloneJson(tool.inputSchema),
    mutates: tool.mutates === true,
  }));
}

/**
 * Assemble the read-only per-turn context handed to an adapter's nextStep.
 *
 * @param {import('./session.js').Session} session
 * @param {HistoryEntry[]} history
 * @param {*} [lastResult]
 * @param {string} [lastNextAction]
 * @param {string|Object} [intent]
 * @returns {ConstructionCtx}
 */
export function buildCtx(session, history, lastResult, lastNextAction, intent) {
  return {
    intent: cloneJson(intent),
    config: cloneJson(session?.config ?? null),
    tools: toolViews(),
    history: cloneJson(Array.isArray(history) ? history : []),
    lastResult: cloneJson(lastResult),
    lastNextAction: typeof lastNextAction === 'string' ? lastNextAction : undefined,
  };
}

/**
 * Validate a step against the closed union and the live TOOLS registry.
 *
 * Rejects any unknown `type`, a `tool` step whose `toolName` is not a real
 * dispatch tool or whose `args` is not a plain object, a `message` step without a
 * string `display`, and any non-object step.
 *
 * @param {*} step
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateStep(step) {
  if (!isObject(step)) return { valid: false, reason: 'step must be an object' };
  if (!STEP_TYPES.has(step.type)) {
    return { valid: false, reason: `unknown step type: ${String(step.type)}` };
  }

  if (step.type === 'tool') {
    if (typeof step.toolName !== 'string' || !TOOL_BY_NAME.has(step.toolName)) {
      return { valid: false, reason: `unknown toolName: ${String(step.toolName)}` };
    }
    if (step.args !== undefined && !isObject(step.args)) {
      return { valid: false, reason: 'tool args must be a plain object' };
    }
    if (step.display !== undefined && typeof step.display !== 'string') {
      return { valid: false, reason: 'tool display must be a string' };
    }
    return { valid: true };
  }

  if (step.type === 'message') {
    if (typeof step.display !== 'string') {
      return { valid: false, reason: 'message step requires a string display' };
    }
    if (step.llmContent !== undefined && typeof step.llmContent !== 'string') {
      return { valid: false, reason: 'message llmContent must be a string' };
    }
    return { valid: true };
  }

  // step.type === 'done'
  if (step.display !== undefined && typeof step.display !== 'string') {
    return { valid: false, reason: 'done display must be a string' };
  }
  return { valid: true };
}

/**
 * Assert a step is valid, throwing a descriptive Error otherwise.
 *
 * @param {*} step
 * @returns {Step}
 */
export function assertStep(step) {
  let result = validateStep(step);
  if (!result.valid) {
    let err = new Error(`Invalid construction step: ${result.reason}`);
    err.code = 'construction_step_invalid';
    throw err;
  }
  return step;
}
