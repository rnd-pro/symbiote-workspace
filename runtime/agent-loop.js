/**
 * Model-agnostic construction loop.
 *
 * Drives any {@link ConstructionAgent} adapter against a workspace session: each
 * turn the loop assembles a read-only context, asks the adapter for the next
 * step, validates it against the closed step union, and executes it through the
 * existing `dispatch` registry. Mutating tools pass through the confirm policy
 * before they run; tool results are wrapped in the standard envelope and pushed
 * to history so the adapter can self-correct from summary/warnings.
 *
 * The loop owns no model, key, endpoint, or provider concept — only the adapter
 * does, and the adapter is injected. It is fully offline-testable with a scripted
 * adapter and an in-memory trace sink.
 *
 * @module symbiote-workspace/runtime/agent-loop
 */

import { TOOLS, isMutating } from './dispatch.js';
import { toolConfirmPolicy } from './tool-policy.js';
import { buildToolResultEnvelope } from './tool-result.js';
import { broadcastDataChange } from './data-change.js';
import { buildCtx, assertStep } from './construction-agent.js';

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));
const DEFAULT_DATA_CHANGE_CHANNEL = 'workspace:config';

function writesFiles(toolName) {
  return TOOL_BY_NAME.get(toolName)?.writesFiles === true;
}

function configFingerprint(config) {
  if (config === undefined || config === null) return '';
  try {
    return JSON.stringify(config);
  } catch {
    return String(config);
  }
}

/**
 * Derive a compact summary line from a raw dispatch result when the tool did not
 * provide one. Falls back to a tool-name + status line.
 *
 * @param {string} toolName
 * @param {*} result
 * @returns {string}
 */
function deriveSummary(toolName, result) {
  if (result && typeof result === 'object') {
    if (typeof result.summary === 'string' && result.summary) return result.summary;
    if (typeof result.hint === 'string' && result.hint) return result.hint;
    let status = typeof result.status === 'string' ? result.status : 'ok';
    return `${toolName}: ${status}`;
  }
  return `${toolName}: ok`;
}

function resultStatus(result) {
  return (result && typeof result === 'object' && typeof result.status === 'string')
    ? result.status
    : 'ok';
}

function resultWarnings(result) {
  if (!result || typeof result !== 'object') return undefined;
  if (Array.isArray(result.warnings)) return result.warnings;
  if (resultStatus(result) === 'warning' && typeof result.hint === 'string') return [result.hint];
  return undefined;
}

/**
 * Run the construction loop until the adapter signals done, a terminal tool
 * succeeds, or a loop-guard fires.
 *
 * @param {Object} options
 * @param {import('./construction-agent.js').ConstructionAgent} options.adapter
 * @param {import('./session.js').Session} options.session
 * @param {(toolName: string, args: Object, session: Object) => Promise<*>} options.dispatch
 * @param {Object} options.trace - { emit(msg), async confirm({display,toolName,args}) }.
 * @param {(message: object) => void} [options.broadcast] - Optional data-change sink.
 * @param {string} [options.channel] - Data-change channel for mutating tools.
 * @param {number} [options.maxSteps=40]
 * @param {string|Object} [options.intent]
 * @param {number} [options.noProgressLimit=3] - Same tool + unchanged config repeats before abort.
 * @param {number} [options.errorLimit=3] - Consecutive error results before abort.
 * @returns {Promise<{ config: *, history: Array, stoppedReason: string }>}
 */
export async function runConstructionLoop({
  adapter,
  session,
  dispatch,
  trace,
  broadcast,
  channel = DEFAULT_DATA_CHANGE_CHANNEL,
  maxSteps = 40,
  intent,
  noProgressLimit = 3,
  errorLimit = 3,
} = {}) {
  if (!adapter || typeof adapter.nextStep !== 'function') {
    throw new Error('runConstructionLoop requires an adapter with an async nextStep(ctx).');
  }
  if (typeof dispatch !== 'function') {
    throw new Error('runConstructionLoop requires a dispatch function.');
  }
  if (!trace || typeof trace.emit !== 'function') {
    throw new Error('runConstructionLoop requires a trace sink with emit().');
  }

  /** @type {import('./construction-agent.js').HistoryEntry[]} */
  let history = [];
  let lastResult;
  let lastNextAction;
  let stoppedReason = 'completed';

  let steps = 0;
  let repeatToolName = null;
  let repeatArgs = null;
  let repeatCount = 0;
  let errorStreak = 0;

  while (true) {
    if (steps >= maxSteps) {
      stoppedReason = `max-steps (${maxSteps}) exceeded`;
      break;
    }
    steps += 1;

    let ctx = buildCtx(session, history, lastResult, lastNextAction, intent);
    let step;
    try {
      step = assertStep(await adapter.nextStep(ctx));
    } catch (err) {
      stoppedReason = `adapter error: ${err.message}`;
      break;
    }

    if (step.type === 'done') {
      stoppedReason = 'done';
      trace.emit({ role: 'agent', parts: [], display: step.display, llmContent: step.display });
      break;
    }

    if (step.type === 'message') {
      trace.emit({ role: 'agent', parts: [], display: step.display, llmContent: step.llmContent });
      lastResult = undefined;
      lastNextAction = undefined;
      continue;
    }

    // step.type === 'tool'
    let { toolName } = step;
    let args = step.args || {};

    if (toolConfirmPolicy(toolName) === 'confirm') {
      let decision = await trace.confirm({ display: step.display, toolName, args });
      if (!decision || decision.action !== 'confirm') {
        stoppedReason = `confirm-denied: ${toolName}`;
        trace.emit({
          role: 'agent',
          parts: [{ type: 'tool_call', name: toolName, args }],
          display: step.display,
          llmContent: `Skipped ${toolName}: confirm denied.`,
        });
        break;
      }
    }

    let configBefore = configFingerprint(session?.config);
    let result = await dispatch(toolName, args, session);
    let status = resultStatus(result);
    let nextAction = result && typeof result === 'object' ? result.nextAction : undefined;

    let envelope = buildToolResultEnvelope({
      summary: deriveSummary(toolName, result),
      warnings: resultWarnings(result),
      data: result,
    });

    history.push({ toolName, args, envelope, status, nextAction });
    lastResult = result;
    lastNextAction = nextAction;

    trace.emit({
      role: 'agent',
      parts: [
        { type: 'tool_call', name: toolName, args },
        { type: 'tool_result', result: envelope },
      ],
      display: step.display,
      llmContent: envelope.summary,
    });

    if ((writesFiles(toolName) || isMutating(toolName)) && status === 'ok' && typeof broadcast === 'function') {
      broadcastDataChange(broadcast, channel, { type: 'tool', payload: { tool: toolName } });
    }

    if (status === 'error') {
      errorStreak += 1;
      if (errorStreak >= errorLimit) {
        stoppedReason = `repeated-error (${errorStreak}x) on ${toolName}: ${envelope.summary}`;
        break;
      }
    } else {
      errorStreak = 0;
    }

    // Terminal success: an export_config that produced portable JSON ends the run.
    if (toolName === 'export_config' && status === 'ok') {
      stoppedReason = 'exported';
      break;
    }

    // No-progress guard: the SAME tool with the SAME args repeated while the
    // config stays unchanged. Re-calling a read-only tool with different args
    // (e.g. answering distinct construction questions) is progress and resets
    // the streak even though it never mutates config.
    let configAfter = configFingerprint(session?.config);
    let configUnchanged = configBefore === configAfter;
    let argsFingerprint = configFingerprint(args);
    if (toolName === repeatToolName && argsFingerprint === repeatArgs && configUnchanged) {
      repeatCount += 1;
    } else {
      repeatToolName = toolName;
      repeatArgs = argsFingerprint;
      repeatCount = 1;
    }
    if (repeatCount >= noProgressLimit) {
      stoppedReason = `no-progress: ${toolName} repeated ${repeatCount}x without config change`;
      break;
    }
  }

  return { config: session?.config ?? null, history, stoppedReason };
}
