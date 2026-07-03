/**
 * Model-agnostic construction loop.
 *
 * Drives any ConstructionAgent adapter against a workspace session. The loop is
 * host-neutral: the board gate, grant store, and config-change subscription are
 * injected by the host. The runtime orders every tool step as board verdict
 * first, then optional human confirm, then dispatch.
 *
 * @module symbiote-workspace/runtime/agent-loop
 */

import { TOOLS, isMutating } from './dispatch.js';
import {
  commandFingerprintFor,
  evaluateToolIntent,
  mintConsentToken,
  normalizeFootprint,
} from './tool-policy.js';
import { buildToolResultEnvelope } from './tool-result.js';
import { broadcastDataChange } from './data-change.js';
import { buildCtx, assertStep } from './construction-agent.js';

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));
const DEFAULT_DATA_CHANGE_CHANNEL = 'workspace:config';
const DEFAULT_ORIGIN_CONTEXT = 'construction';

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

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function principalFromSession(session) {
  let principal = isObject(session?.principal) ? session.principal : {};
  let kind = ['human', 'agent', 'daemon'].includes(principal.kind) ? principal.kind : 'agent';
  return {
    ...cloneJson(principal),
    kind,
    id: typeof principal.id === 'string' && principal.id.length > 0 ? principal.id : kind,
  };
}

function originEnvelope(session, actor, reason, baseRevision, verdictId) {
  let origin = {
    principal: principalFromSession(session),
    actor: actor || session?.actor || 'agent-gated',
    reason,
    sessionId: session?.sessionId || 'default',
  };
  if (baseRevision !== undefined) origin.baseRevision = baseRevision;
  if (verdictId !== undefined) origin.verdictId = verdictId;
  return origin;
}

function withBaseRevision(toolName, args, session) {
  if (isMutating(toolName) !== true) return args;
  if (Number.isInteger(args.baseRevision)) return args;
  return { ...args, baseRevision: session?.revision ?? 0 };
}

function writeFootprint(toolName, args, result) {
  let explicit = normalizeFootprint(
    args.footprint || args.scope || args.changedPaths || result?.footprint || result?.changedPaths,
  );
  if (explicit.length > 0) return explicit;
  if (isMutating(toolName) || writesFiles(toolName)) return ['config'];
  return [];
}

function confirmIdFor(contextId, stepIndex, toolName) {
  return `${contextId}:confirm:${stepIndex}:${toolName}`;
}

function confirmAccepted(decision) {
  if (!decision) return false;
  if (decision.action === 'confirm' || decision.action === 'accepted') return true;
  if (decision.status === 'accepted') return true;
  return decision.accepted === true;
}

function normalizeGateVerdict(verdict) {
  if (verdict === undefined || verdict === null) return { status: 'accepted', verdictId: 'verdict:accepted' };
  if (typeof verdict === 'string') return { status: verdict, verdictId: `verdict:${verdict}` };
  if (!isObject(verdict)) return verdict === false
    ? { status: 'blocked', verdictId: 'verdict:blocked' }
    : { status: 'accepted', verdictId: 'verdict:accepted' };
  if (verdict.accepted === false) return { ...verdict, status: 'blocked' };
  if (verdict.accepted === true && verdict.status === undefined && verdict.verdict === undefined) {
    return { ...verdict, status: 'accepted' };
  }
  return {
    ...verdict,
    status: verdict.status || verdict.verdict || verdict.action || 'accepted',
    verdictId: verdict.verdictId || verdict.id || `verdict:${verdict.status || verdict.verdict || verdict.action || 'accepted'}`,
  };
}

function normalizeConfigChangeEvent(message, channel) {
  let payload = isObject(message?.payload) && message.payload.channel ? message.payload : message;
  if (!isObject(payload) || payload.channel !== channel) return null;
  let origin = isObject(payload.origin) ? payload.origin : {};
  let principal = isObject(origin.principal)
    ? origin.principal
    : { kind: 'daemon', id: 'unknown' };
  return {
    type: 'config-changed-under-you',
    revision: Number.isInteger(payload.revision) ? payload.revision : 0,
    changedPaths: normalizeFootprint(payload.changedPaths).length > 0
      ? normalizeFootprint(payload.changedPaths)
      : ['config'],
    principal: cloneJson(principal),
    reason: typeof origin.reason === 'string' && origin.reason.length > 0
      ? origin.reason
      : 'workspace:config changed',
    origin: cloneJson(origin),
  };
}

function emitProtocolEvent(trace, history, event) {
  let envelope = buildToolResultEnvelope({
    summary: `${event.type}: ${event.changedPaths.join(', ')}`,
    data: event,
  });
  history.push({ type: 'protocol', event, envelope, status: 'protocol' });
  trace.emit({
    role: 'system',
    parts: [{ type: 'protocol_event', event }],
    display: `Workspace config changed: ${event.changedPaths.join(', ')}`,
    llmContent: JSON.stringify(event),
  });
}

function emitGateHold(trace, step, policy) {
  let event = {
    type: 'tool-gate-verdict',
    toolName: step.toolName,
    verdict: policy.verdict.status,
    verdictId: policy.verdictId,
    intentId: policy.intentId,
    reason: policy.reason,
  };
  trace.emit({
    role: 'system',
    parts: [{ type: 'protocol_event', event }],
    display: `Tool ${step.toolName} held by gate: ${policy.verdict.status}`,
    llmContent: JSON.stringify(event),
  });
}

function changedPathsForBroadcast(toolName, args, result, footprint) {
  let paths = normalizeFootprint(result?.changedPaths || result?.footprint);
  if (paths.length > 0) return paths;
  if (footprint.length > 0) return footprint;
  if (isMutating(toolName) || writesFiles(toolName)) return ['config'];
  return [];
}

/**
 * Run the construction loop until the adapter signals done, a terminal tool
 * succeeds, or a loop-guard fires.
 *
 * @param {Object} options
 * @param {import('./construction-agent.js').ConstructionAgent} options.adapter
 * @param {import('./session.js').Session} options.session
 * @param {(toolName: string, args: Object, session: Object, options?: Object) => Promise<*>} options.dispatch
 * @param {Object} options.trace - { emit(msg), async confirm(req) }.
 * @param {(message: object) => void} [options.broadcast] - Optional data-change sink.
 * @param {(handler: (message: object) => void) => (() => void)} [options.subscribeConfigChanges]
 * @param {(intent: object, context: object) => Promise<object>|object} [options.evaluateIntent]
 * @param {string} [options.channel] - Data-change channel for mutating tools.
 * @param {number} [options.maxSteps=40]
 * @param {string|Object} [options.intent]
 * @param {string} [options.actor]
 * @param {Object} [options.principal]
 * @param {Object[]} [options.grants]
 * @param {string} [options.contextId]
 * @param {string} [options.originContext='construction']
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
  subscribeConfigChanges,
  evaluateIntent,
  channel = DEFAULT_DATA_CHANGE_CHANNEL,
  maxSteps = 40,
  intent,
  actor,
  principal,
  grants,
  contextId,
  originContext = DEFAULT_ORIGIN_CONTEXT,
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
  let pendingConfigEvents = [];
  let loopActor = actor || session?.actor || 'agent-gated';
  let loopPrincipal = principal || session?.principal || principalFromSession(session);
  let loopContextId = contextId || session?.contextId || session?.sessionId || 'default';
  let unsubscribe = null;

  if (typeof subscribeConfigChanges === 'function') {
    unsubscribe = subscribeConfigChanges((message) => {
      let event = normalizeConfigChangeEvent(message, channel);
      if (event) pendingConfigEvents.push(event);
    });
  }

  try {
    while (true) {
      while (pendingConfigEvents.length > 0) {
        emitProtocolEvent(trace, history, pendingConfigEvents.shift());
      }

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

      let { toolName } = step;
      let args = withBaseRevision(toolName, { ...(step.args || {}) }, session);
      let footprint = writeFootprint(toolName, args);
      let commandFingerprint = commandFingerprintFor(toolName, {
        args,
        footprint,
        baseRevision: args.baseRevision,
      });
      let preliminary = evaluateToolIntent(toolName, {
        actor: loopActor,
        principal: loopPrincipal,
        args,
        footprint,
        baseRevision: args.baseRevision,
        commandFingerprint,
        consentToken: args.consentToken,
        grants: grants || session?.grants,
      });
      let gateIntent = {
        toolName,
        intentId: preliminary.intentId,
        principal: preliminary.principal,
        actor: preliminary.actor,
        mutates: preliminary.mutates,
        footprint,
        baseRevision: args.baseRevision,
        commandFingerprint,
        originContext,
      };
      let gateVerdict;
      try {
        gateVerdict = normalizeGateVerdict(
          typeof evaluateIntent === 'function'
            ? await evaluateIntent(gateIntent, { grants: grants || session?.grants, consentToken: args.consentToken })
            : { status: 'accepted', verdictId: 'verdict:accepted' },
        );
      } catch (err) {
        stoppedReason = `gate-error: ${err.message}`;
        break;
      }

      let policy = evaluateToolIntent(toolName, {
        actor: loopActor,
        principal: loopPrincipal,
        args,
        footprint,
        baseRevision: args.baseRevision,
        commandFingerprint,
        consentToken: args.consentToken,
        grants: grants || session?.grants,
        gateVerdict,
      });
      if (policy.policy === 'blocked' || policy.policy === 'pendingApproval' || policy.policy === 'rolledBack') {
        stoppedReason = `gate-${policy.policy}: ${toolName}`;
        emitGateHold(trace, step, policy);
        break;
      }

      if (policy.needsConfirm) {
        if (typeof trace.confirm !== 'function') {
          throw new Error('runConstructionLoop requires trace.confirm() for confirmed tool calls.');
        }
        let confirmId = confirmIdFor(loopContextId, steps, toolName);
        let decision = await trace.confirm({
          confirmId,
          contextId: loopContextId,
          originContext,
          verdictId: policy.verdictId,
          intentId: policy.intentId,
          display: step.display,
          toolName,
          args,
          principal: policy.principal,
          footprint,
          baseRevision: args.baseRevision,
          commandFingerprint,
          origin: originEnvelope(session, policy.actor, `confirm:${toolName}`, args.baseRevision, policy.verdictId),
        });
        if (!confirmAccepted(decision)) {
          stoppedReason = `confirm-denied: ${toolName}`;
          trace.emit({
            role: 'agent',
            parts: [{ type: 'tool_call', name: toolName, args }],
            display: step.display,
            llmContent: `Skipped ${toolName}: confirm denied.`,
          });
          break;
        }
        let consentToken = decision.consentToken || decision.token || mintConsentToken({
          confirmId,
          commandFingerprint,
          baseRevision: args.baseRevision,
          footprint,
          originContext,
          verdictId: policy.verdictId,
        });
        args = { ...args, consentToken };
      }

      let configBefore = configFingerprint(session?.config);
      let result = await dispatch(toolName, args, session, { actor: policy.actor, principal: policy.principal });
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
        let changedPaths = changedPathsForBroadcast(toolName, args, result, footprint);
        let origin = isObject(result?.origin)
          ? result.origin
          : originEnvelope(session, policy.actor, `tool:${toolName}`, args.baseRevision, policy.verdictId);
        broadcastDataChange(broadcast, channel, {
          revision: Number.isInteger(result?.revision) ? result.revision : session?.revision ?? 0,
          baseRevision: Number.isInteger(result?.baseRevision) ? result.baseRevision : args.baseRevision,
          changedPaths,
          origin,
        });
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

      if (toolName === 'config_export' && status === 'ok') {
        stoppedReason = 'exported';
        break;
      }

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
  } finally {
    if (typeof unsubscribe === 'function') unsubscribe();
  }

  return { config: session?.config ?? null, history, stoppedReason };
}
