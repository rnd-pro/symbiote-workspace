/**
 * Runtime bridge for config hooks over the S2.1 wire-observation seam.
 *
 * The bridge consumes injected governor, gate, agent-channel, and teach-store
 * interfaces. It intentionally does not implement the symbiote-ui governor.
 *
 * @module symbiote-workspace/runtime/hook-bridge
 */

import { createHash } from 'node:crypto';

import {
  MUTATING_HOOK_ACTION_KINDS,
  compareHookSchedule,
} from '../schema/sections/behavior.js';
import { WIRE_OBSERVATION_CONTEXT } from './wire-compiler.js';

export const HOOK_ACTIVITY_TYPE = 'hook-activity';
export const HOOK_ACTIVITY_ACTIONS = Object.freeze(['fire', 'deny', 'park', 'retract']);
export const ASK_AGENT_QUEUE_DEFAULT = 'queued';

const GUARD_CLASS = 'guard';
const POLICY_MODES = new Set(['silent', 'auto', 'confirm']);
const READ_OR_FLUSH_EFFECTS = new Set(['read', 'flush']);
const ENTRY_PATH_PATTERN = /^\$entry\.[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function titleText(value, fallback) {
  if (typeof value === 'string') return value;
  if (isObject(value) && typeof value.default === 'string') return value.default;
  if (isObject(value) && typeof value.$t === 'string') return value.$t;
  return fallback;
}

function readPath(value, path) {
  let cursor = value;
  for (let segment of path.split('.')) {
    if (!isObject(cursor) && !Array.isArray(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function writePath(target, path, value) {
  let segments = path.split('.');
  let cursor = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    let segment = segments[index];
    if (!isObject(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment];
  }
  cursor[segments[segments.length - 1]] = value;
}

function readEntryPath(entry, allowPath) {
  if (typeof allowPath !== 'string' || !allowPath.startsWith('$entry.')) return undefined;
  return readPath(entry, allowPath.slice('$entry.'.length));
}

function toEntryPath(allowPath) {
  return allowPath.slice('$entry.'.length);
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function normalizeAllow(context = {}) {
  let allow = context.allow || [];
  if (!Array.isArray(allow)) {
    throw new Error('Hook context.allow must be an array.');
  }
  for (let item of allow) {
    if (typeof item !== 'string' || !ENTRY_PATH_PATTERN.test(item)) {
      throw new Error(`Hook context.allow entry "${String(item)}" must be a $entry. path.`);
    }
  }
  return allow;
}

/**
 * Apply the hook context.allow/maxBytes exfiltration boundary.
 *
 * @param {Object} entry
 * @param {Object} [context]
 * @returns {{entry: Object}}
 */
export function filterHookContext(entry = {}, context = {}) {
  let allow = normalizeAllow(context);
  let filteredEntry = {};

  for (let allowPath of allow) {
    let value = readEntryPath(entry, allowPath);
    if (value !== undefined) writePath(filteredEntry, toEntryPath(allowPath), cloneJson(value));
  }

  let filtered = { entry: filteredEntry };
  if (context.maxBytes !== undefined && jsonBytes(filtered) > context.maxBytes) {
    let err = new Error(`Hook context exceeds maxBytes (${context.maxBytes}).`);
    err.code = 'hook-context-max-bytes';
    throw err;
  }
  return filtered;
}

function hookPriority(hook) {
  return Number.isInteger(hook?.priority) ? hook.priority : 0;
}

function compareGuardSchedule(a, b) {
  let priorityDelta = hookPriority(b) - hookPriority(a);
  if (priorityDelta !== 0) return priorityDelta;
  return String(a.id).localeCompare(String(b.id));
}

function policyMode(value, fallback = 'confirm') {
  return POLICY_MODES.has(value) ? value : fallback;
}

function hookActionMutates(hook, options = {}) {
  let action = hook?.action || {};
  if (options.dispatchMutates === true || options.toolMutates === true || action.mutates === true) return true;
  if (!MUTATING_HOOK_ACTION_KINDS.includes(action.kind)) return false;
  if (action.kind === 'invoke' && READ_OR_FLUSH_EFFECTS.has(action.effect)) return false;
  return true;
}

/**
 * Compose hook policy with downstream gate state without weakening the gate.
 *
 * @param {Object} hook
 * @param {Object} [options]
 * @param {'silent'|'auto'|'confirm'} [options.downstreamPolicy]
 * @param {boolean} [options.dispatchMutates]
 * @param {boolean} [options.toolMutates]
 * @param {boolean} [options.grantCovered]
 * @returns {{mode: 'silent'|'auto'|'confirm', hookMode: string, downstreamPolicy: string, mutating: boolean, grantCovered: boolean}}
 */
export function composeHookPolicy(hook, options = {}) {
  let hookMode = policyMode(hook?.policy?.mode, 'auto');
  let action = hook?.action || {};
  if (action.kind === 'ask-agent' && hookMode === 'silent') hookMode = 'auto';

  let downstreamPolicy = policyMode(options.downstreamPolicy, 'auto');
  let grantCovered = options.grantCovered === true;
  let mutating = hookActionMutates(hook, options);
  let confirmRequired = hookMode === 'confirm'
    || downstreamPolicy === 'confirm'
    || (mutating && !grantCovered);
  let mode = confirmRequired
    ? 'confirm'
    : hookMode === 'silent' || downstreamPolicy === 'silent'
      ? 'silent'
      : 'auto';

  if (action.kind === 'ask-agent' && mode === 'silent') mode = 'auto';
  if (action.kind === 'invoke' && !READ_OR_FLUSH_EFFECTS.has(action.effect) && !grantCovered && mode !== 'confirm') {
    mode = 'confirm';
  }

  return { mode, hookMode, downstreamPolicy, mutating, grantCovered };
}

function hashDismissalParts(hookId, subjectValue) {
  let hash = createHash('sha256')
    .update(String(hookId))
    .update('\0')
    .update(JSON.stringify(subjectValue))
    .digest('hex')
    .slice(0, 16);
  return `sha256-${hash}`;
}

/**
 * Compute the completion/dismissal key stored in the injected teach store.
 *
 * @param {Object} hook
 * @param {Object} entry
 * @returns {string}
 */
export function dismissalKeyForHook(hook, entry = {}) {
  if (hook?.dismissal?.scope !== 'subject') return hook?.id;
  let subjectKey = hook.dismissal.subjectKey;
  if (typeof subjectKey !== 'string' || !ENTRY_PATH_PATTERN.test(subjectKey)) {
    throw new Error(`Hook "${hook.id}" subject dismissal requires a $entry. subjectKey.`);
  }
  let subjectValue = readEntryPath(entry, subjectKey);
  if (subjectValue === undefined) {
    throw new Error(`Hook "${hook.id}" subject dismissal key "${subjectKey}" is missing from the entry.`);
  }
  return `${hook.id}:${hashDismissalParts(hook.id, subjectValue)}`;
}

async function readTeachState(store, key) {
  if (!store || !key) return undefined;
  if (typeof store.read === 'function') return store.read(key);
  if (typeof store.get === 'function') return store.get(key);
  if (isObject(store.teach)) return store.teach[key];
  return store[key];
}

async function writeTeachState(store, key, value) {
  if (!store || !key) return;
  if (typeof store.write === 'function') {
    await store.write(key, value);
    return;
  }
  if (typeof store.set === 'function') {
    store.set(key, value);
    return;
  }
  if (isObject(store.teach)) {
    store.teach[key] = value;
    return;
  }
  store[key] = value;
}

function completionSuppresses(hook, record) {
  if (!record) return false;
  if (record.status === 'dismissed') return true;
  return hook?.trigger?.once === true && record.status === 'completed';
}

function cooldownMsForHook(hook) {
  return hook?.cooldown?.ms ?? hook?.cooldownMs ?? hook?.policy?.cooldownMs ?? 0;
}

async function isSuppressedByTeachStore(state, hook, entry, now) {
  let key = dismissalKeyForHook(hook, entry);
  let record = await readTeachState(state.teachStore, key);
  if (completionSuppresses(hook, record)) {
    return { suppressed: true, key, record, reason: record.status };
  }
  if (Number.isFinite(record?.cooldownUntil) && record.cooldownUntil > now) {
    return { suppressed: true, key, record, reason: 'cooldown' };
  }
  return { suppressed: false, key, record };
}

async function markOffered(state, key, record, hook, now) {
  if (!state.teachStore || !key) return;
  if (record?.status === 'completed' || record?.status === 'dismissed') return;
  let cooldownMs = cooldownMsForHook(hook);
  let next = {
    ...(isObject(record) ? record : {}),
    status: record?.status || 'offered',
    updatedAt: new Date(now).toISOString(),
  };
  if (cooldownMs > 0) next.cooldownUntil = now + cooldownMs;
  await writeTeachState(state.teachStore, key, next);
}

function emitTelemetry(state, entry) {
  let next = { type: HOOK_ACTIVITY_TYPE, ...entry };
  state.activity.push(next);
  let sink = state.telemetry;
  if (typeof sink === 'function') sink(next);
  else if (Array.isArray(sink)) sink.push(next);
  else if (sink && typeof sink.emit === 'function') sink.emit(next);
}

function governorEpoch(governor) {
  if (!governor) return 0;
  if (typeof governor.getEpoch === 'function') return governor.getEpoch();
  if (typeof governor.currentEpoch === 'function') return governor.currentEpoch();
  if (Number.isInteger(governor.currentEpoch)) return governor.currentEpoch;
  if (Number.isInteger(governor.epoch)) return governor.epoch;
  return 0;
}

function epochIsCurrent(governor, epoch) {
  if (!governor) return true;
  if (typeof governor.isEpochActive === 'function') return governor.isEpochActive(epoch) === true;
  return governorEpoch(governor) === epoch;
}

async function governorAllows(state, hook, event, key) {
  let governor = state.governor;
  if (!governor) return { allowed: true };
  let request = { hook, event, key, subject: event.subject };
  let result;
  if (typeof governor.shouldRun === 'function') result = await governor.shouldRun(request);
  else if (typeof governor.allow === 'function') result = await governor.allow(request);
  else if (typeof governor.check === 'function') result = await governor.check(request);
  else return { allowed: true };

  if (result === false) return { allowed: false, reason: 'governor' };
  if (isObject(result) && result.allowed === false) return { allowed: false, reason: result.reason || 'governor' };
  return { allowed: true };
}

function removeHandle(value) {
  if (!value) return { remove() {} };
  if (typeof value === 'function') return { remove: value };
  if (typeof value.remove === 'function') return value;
  if (typeof value.unsubscribe === 'function') return { remove: () => value.unsubscribe() };
  return { remove() {} };
}

function subscribeEmitter(emitter, eventName, callback) {
  if (!emitter) return null;
  if (typeof emitter.onRetract === 'function') return removeHandle(emitter.onRetract(callback));
  if (typeof emitter.on === 'function') return removeHandle(emitter.on(eventName, callback));
  if (typeof emitter.addEventListener === 'function') {
    emitter.addEventListener(eventName, callback);
    return { remove: () => emitter.removeEventListener?.(eventName, callback) };
  }
  return null;
}

function bindGovernorRetractions(state) {
  let remover = subscribeEmitter(state.governor, 'retract', (event = {}) => {
    emitTelemetry(state, {
      action: 'retract',
      hookId: event.hookId,
      subject: event.subject,
      correlationId: event.correlationId,
      epoch: event.epoch ?? governorEpoch(state.governor),
    });
  });
  if (remover) state.removers.push(remover);
}

function contextFromObservation(wireObservation) {
  if (!wireObservation) return null;
  if (typeof wireObservation.get === 'function') {
    return wireObservation.get(WIRE_OBSERVATION_CONTEXT) || null;
  }
  if (wireObservation.observer && typeof wireObservation.observer.get === 'function') {
    return wireObservation.observer.get(WIRE_OBSERVATION_CONTEXT) || null;
  }
  if (wireObservation.context) return wireObservation.context;
  return null;
}

function onObservationContextRegister(wireObservation, callback) {
  if (!wireObservation) return null;
  if (typeof wireObservation.onRegister === 'function') return removeHandle(wireObservation.onRegister(callback));
  if (wireObservation.observer && typeof wireObservation.observer.onRegister === 'function') {
    return removeHandle(wireObservation.observer.onRegister(callback));
  }
  return null;
}

function subscribeObservation(wireObservation, subject, callback) {
  if (!wireObservation) return null;
  if (typeof wireObservation.subscribe === 'function') {
    return removeHandle(wireObservation.subscribe(subject, callback));
  }
  if (typeof wireObservation.on === 'function') {
    return removeHandle(wireObservation.on(subject, callback));
  }
  if (typeof wireObservation.sub === 'function') {
    return removeHandle(wireObservation.sub(subject, callback, false));
  }
  let ctx = contextFromObservation(wireObservation);
  if (ctx && typeof ctx.sub === 'function') return removeHandle(ctx.sub(subject, callback, false));
  let deferred = null;
  let register = onObservationContextRegister(wireObservation, (entry) => {
    if (entry.uid !== WIRE_OBSERVATION_CONTEXT || !entry.ctx || typeof entry.ctx.sub !== 'function') return;
    deferred = removeHandle(entry.ctx.sub(subject, callback, false));
  });
  if (!register) return null;
  return {
    remove() {
      register.remove();
      deferred?.remove();
    },
  };
}

function recentFromObservation(wireObservation) {
  if (!wireObservation) return [];
  if (typeof wireObservation.recent === 'function') return wireObservation.recent();
  if (typeof wireObservation.getRecent === 'function') return wireObservation.getRecent();
  if (Array.isArray(wireObservation.recent)) return wireObservation.recent;
  let ctx = contextFromObservation(wireObservation);
  if (ctx) {
    if (typeof ctx.recent === 'function') return ctx.recent();
    if (Array.isArray(ctx.recent)) return ctx.recent;
  }
  return [];
}

function normalizeEntry(payload) {
  if (isObject(payload) && Object.hasOwn(payload, 'entry')) return payload.entry;
  if (isObject(payload) && Object.hasOwn(payload, 'value')) return payload.value;
  return payload;
}

function normalizeEvent(subject, payload = {}, options = {}) {
  let entry = normalizeEntry(payload);
  if (!isObject(entry)) entry = { value: entry };
  return {
    ...options,
    ...(isObject(payload) ? payload : {}),
    subject: options.subject || payload.subject || subject,
    entry,
    payload,
  };
}

function subjectMatches(pattern, subject, event = {}) {
  if (pattern === subject) return true;
  if (typeof pattern === 'string' && pattern.endsWith('*')) return String(subject).startsWith(pattern.slice(0, -1));
  if (event.wireId && (pattern === `event:${event.wireId}` || pattern === `binding:${event.wireId}`)) return true;
  return false;
}

function matchingHooks(config, subject, event, classFilter) {
  let hooks = Array.isArray(config?.hooks) ? config.hooks : [];
  return hooks.filter((hook) => {
    if (!isObject(hook) || !isObject(hook.trigger)) return false;
    if (!subjectMatches(hook.trigger.subject, subject, event)) return false;
    if (classFilter === GUARD_CLASS) return hook.class === GUARD_CLASS;
    if (classFilter === 'non-guard') return hook.class !== GUARD_CLASS;
    return true;
  });
}

function sortedGuards(hooks) {
  return [...hooks].sort(compareGuardSchedule);
}

function sortedNonGuards(hooks) {
  return [...hooks].sort(compareHookSchedule);
}

async function resolveGrantCoverage(state, request) {
  let gate = state.gate;
  if (!gate) return false;
  if (typeof gate.hasGrantCoverage === 'function') return Boolean(await gate.hasGrantCoverage(request));
  if (typeof gate.hasGrant === 'function') return Boolean(await gate.hasGrant(request));
  if (typeof gate.grantCovers === 'function') return Boolean(await gate.grantCovers(request));
  return false;
}

function normalizeGateVerdict(result, fallback = 'accepted') {
  if (result === true || result === undefined || result === null) return { verdict: 'accepted' };
  if (result === false) return { verdict: 'blocked', reason: 'gate-denied' };
  if (typeof result === 'string') return { verdict: result };
  if (isObject(result)) {
    return {
      ...result,
      verdict: result.verdict || result.status || result.action || fallback,
    };
  }
  return { verdict: fallback };
}

async function runGate(state, request) {
  if (request.policy.mode !== 'confirm') return { verdict: 'accepted' };
  let gate = state.gate;
  if (!gate) return { verdict: 'pendingApproval', reason: 'confirm-required' };
  if (typeof gate === 'function') return normalizeGateVerdict(await gate(request));
  if (typeof gate.decide === 'function') return normalizeGateVerdict(await gate.decide(request));
  if (typeof gate.evaluate === 'function') return normalizeGateVerdict(await gate.evaluate(request));
  if (typeof gate.confirm === 'function') return normalizeGateVerdict(await gate.confirm(request));
  return { verdict: 'pendingApproval', reason: 'confirm-required' };
}

function isPackProvenance(event) {
  return event?.pack === true
    || event?.source === 'pack'
    || event?.provenance === 'pack'
    || event?.provenance?.kind === 'pack'
    || event?.provenance?.source === 'pack';
}

function gateBlocks(verdict) {
  return ['blocked', 'pendingApproval', 'rolledBack', 'deny', 'denied', 'cancel'].includes(verdict);
}

function ensureAbortSignal(event = {}) {
  if (event.signal && typeof event.signal.aborted === 'boolean') return event.signal;
  let controller = new AbortController();
  return controller.signal;
}

function constructionLoopRunning(state, event) {
  if (event.constructionLoopRunning === true) return true;
  let option = state.options.constructionLoopRunning;
  if (typeof option === 'function') return option(event) === true;
  return option === true;
}

function resolveActionArgs(action, entry, allow) {
  let args = {};
  for (let [name, value] of Object.entries(action.args || {})) {
    if (typeof value === 'string' && value.startsWith('$')) {
      if (!allow.includes(value)) {
        throw new Error(`Hook invoke arg "${name}" references "${value}" outside context.allow.`);
      }
      args[name] = cloneJson(readEntryPath(entry, value));
    } else {
      args[name] = cloneJson(value);
    }
  }
  return args;
}

async function runAskAgent(state, hook, event, filteredContext) {
  let action = hook.action || {};
  let contextId = action.contextId || event.contextId || state.options.contextId;
  if (typeof contextId !== 'string' || contextId.length === 0) {
    throw new Error(`Hook "${hook.id}" ask-agent requires contextId.`);
  }

  let prompt = action.prompt || hook.prompt || titleText(hook.title, `Hook ${hook.id}`);
  let request = {
    hookId: hook.id,
    contextId,
    prompt,
    context: filteredContext,
    signal: ensureAbortSignal(event),
  };

  if (constructionLoopRunning(state, event) && hook.concurrent !== true) {
    state.askAgentQueue.push({ hook, event, request });
    return { status: ASK_AGENT_QUEUE_DEFAULT, queue: 'ask-agent', hookId: hook.id, contextId };
  }

  if (!state.agentChannel || typeof state.agentChannel.invoke !== 'function') {
    state.askAgentQueue.push({ hook, event, request });
    return { status: ASK_AGENT_QUEUE_DEFAULT, queue: 'ask-agent', reason: 'agent-channel-missing', hookId: hook.id, contextId };
  }

  return state.agentChannel.invoke(request);
}

async function runInvoke(state, hook, event, filteredContext) {
  let action = hook.action || {};
  let target = action.target || {};
  let allow = normalizeAllow(hook.context || {});
  let args = resolveActionArgs(action, event.entry, allow);
  let hostServices = state.options.hostServices || {};
  let service = target.hostService ? hostServices[target.hostService] : null;
  let request = {
    hookId: hook.id,
    target,
    args,
    context: filteredContext,
    signal: ensureAbortSignal(event),
  };

  if (typeof service === 'function') return service(request);
  if (service && typeof service.invoke === 'function') return service.invoke(request);
  if (state.gate && typeof state.gate.invoke === 'function') return state.gate.invoke(request);
  return { status: 'ok', kind: 'invoke', target, args, dryRun: true };
}

async function runHookAction(state, hook, event, filteredContext) {
  if (typeof state.options.runHook === 'function') {
    return state.options.runHook({ hook, event, context: filteredContext, policy: event.policy });
  }
  if (typeof hook.action?.run === 'function') {
    return hook.action.run({ hook, event, context: filteredContext, policy: event.policy });
  }

  let action = hook.action || {};
  if (action.kind === 'ask-agent') return runAskAgent(state, hook, event, filteredContext);
  if (action.kind === 'invoke') return runInvoke(state, hook, event, filteredContext);
  if (action.kind === 'annotate') return { status: 'ok', kind: 'annotate', annotation: cloneJson(action.annotation) };
  if (action.kind === 'suggest') return { status: 'ok', kind: 'suggest', suggestion: cloneJson(action.suggestion || action) };
  if (action.kind === 'propose-safe-action') return { status: 'ok', kind: 'propose-safe-action', proposal: cloneJson(action) };
  return { status: 'ok', kind: action.kind || 'noop' };
}

function normalizeHookOutcome(result) {
  if (result === false) return { verdict: 'blocked', reason: 'hook-denied' };
  if (result === true || result === undefined) return { verdict: 'accepted' };
  if (isObject(result)) {
    if (result.allow === false) return { verdict: 'blocked', reason: result.reason || 'hook-denied', result };
    if (gateBlocks(result.verdict || result.status || result.action)) {
      return { verdict: result.verdict || result.status || result.action, reason: result.reason, result };
    }
    return { verdict: 'accepted', result };
  }
  return { verdict: 'accepted', result };
}

async function executeHook(state, hook, event) {
  let epoch = event.epoch ?? governorEpoch(state.governor);
  if (!epochIsCurrent(state.governor, epoch)) return { status: 'dropped', reason: 'epoch', hookId: hook.id };

  let now = state.now();
  let suppression = await isSuppressedByTeachStore(state, hook, event.entry, now);
  if (suppression.suppressed) return { status: 'suppressed', reason: suppression.reason, hookId: hook.id };

  let governorVerdict = await governorAllows(state, hook, event, suppression.key);
  if (!governorVerdict.allowed) {
    return { status: 'suppressed', reason: governorVerdict.reason, hookId: hook.id };
  }

  let filteredContext = filterHookContext(event.entry, hook.context || {});
  let gateRequest = { hook, action: hook.action || {}, event, context: filteredContext, subject: event.subject };
  let grantCovered = await resolveGrantCoverage(state, gateRequest);
  let policy = composeHookPolicy(hook, {
    downstreamPolicy: event.downstreamPolicy || event.confirmPolicy,
    dispatchMutates: event.mutates === true || event.dispatchMutates === true,
    toolMutates: event.toolMutates === true,
    grantCovered,
  });
  gateRequest.policy = policy;
  event.policy = policy;

  emitTelemetry(state, {
    action: 'fire',
    hookId: hook.id,
    hookClass: hook.class,
    subject: event.subject,
    epoch,
  });

  let gateVerdict = await runGate(state, gateRequest);
  if (gateBlocks(gateVerdict.verdict)) {
    let activity = isPackProvenance(event) && ['blocked', 'pendingApproval'].includes(gateVerdict.verdict)
      ? 'park'
      : 'deny';
    emitTelemetry(state, {
      action: activity,
      hookId: hook.id,
      hookClass: hook.class,
      subject: event.subject,
      reason: gateVerdict.reason,
      verdict: gateVerdict.verdict,
      provenance: event.provenance,
      epoch,
    });
    return {
      status: activity === 'park' ? 'parked' : 'denied',
      verdict: gateVerdict.verdict,
      reason: gateVerdict.reason,
      hookId: hook.id,
    };
  }

  let result = await runHookAction(state, hook, event, filteredContext);
  if (!epochIsCurrent(state.governor, epoch)) return { status: 'dropped', reason: 'epoch', hookId: hook.id };
  await markOffered(state, suppression.key, suppression.record, hook, now);

  let outcome = normalizeHookOutcome(result);
  if (gateBlocks(outcome.verdict)) {
    emitTelemetry(state, {
      action: 'deny',
      hookId: hook.id,
      hookClass: hook.class,
      subject: event.subject,
      reason: outcome.reason,
      verdict: outcome.verdict,
      epoch,
    });
    return { status: 'denied', hookId: hook.id, reason: outcome.reason, result: outcome.result };
  }

  return {
    status: 'ok',
    hookId: hook.id,
    policy,
    consentToken: gateVerdict.consentToken,
    result,
  };
}

async function runGuardHooks(state, subject, entry = {}, options = {}) {
  let event = normalizeEvent(subject, { entry, ...options }, options);
  let hooks = sortedGuards(matchingHooks(state.config, subject, event, GUARD_CLASS));
  let results = [];
  for (let hook of hooks) {
    let result = await executeHook(state, hook, event);
    results.push(result);
    if (result.status === 'denied' || result.status === 'parked') {
      return { status: result.status, accepted: false, hookId: hook.id, result, results };
    }
  }
  return { status: 'accepted', accepted: true, results };
}

function trackPending(state, promise) {
  state.pending.add(promise);
  promise.finally(() => state.pending.delete(promise));
  return promise;
}

function scheduleThroughGovernor(state, task, meta) {
  let governor = state.governor;
  if (governor && typeof governor.schedule === 'function') return governor.schedule(task, meta);
  return task();
}

function scheduleNonGuardHooks(state, subject, entry = {}, options = {}) {
  let event = normalizeEvent(subject, { entry, ...options }, options);
  let epoch = event.epoch ?? governorEpoch(state.governor);
  let actionPromise = options.after || options.actionResult || Promise.resolve();
  let task = Promise.resolve(actionPromise).then(() => {
    if (!epochIsCurrent(state.governor, epoch)) return [];
    let hooks = sortedNonGuards(matchingHooks(state.config, subject, event, 'non-guard'));
    return scheduleThroughGovernor(state, async () => {
      let results = [];
      for (let hook of hooks) results.push(await executeHook(state, hook, { ...event, epoch }));
      return results;
    }, { subject, epoch, hooks });
  });
  return trackPending(state, task);
}

async function fireSubject(state, subject, entry = {}, options = {}) {
  let guard = await runGuardHooks(state, subject, entry, options);
  if (!guard.accepted) return { status: guard.status, guard, scheduled: null };

  let actionResult;
  if (typeof options.action === 'function') actionResult = await options.action();
  else actionResult = options.actionResult;

  let scheduled = scheduleNonGuardHooks(state, subject, entry, { ...options, after: Promise.resolve(actionResult) });
  let results = await scheduled;
  return { status: 'ok', guard, actionResult, results };
}

function triggerSubjects(config) {
  let subjects = new Set();
  for (let hook of Array.isArray(config?.hooks) ? config.hooks : []) {
    if (typeof hook?.trigger?.subject === 'string') subjects.add(hook.trigger.subject);
  }
  return [...subjects];
}

function bindObservationSubjects(state) {
  for (let subject of triggerSubjects(state.config)) {
    let remover = subscribeObservation(state.wireObservation, subject, (payload = {}) => {
      if (state.closed) return;
      let event = normalizeEvent(subject, payload);
      state.observedRecent.push(event);
      if (payload.phase === 'guard' || payload.beforeAction === true) {
        state.lastObservation = runGuardHooks(state, subject, event.entry, event);
      } else {
        state.lastObservation = scheduleNonGuardHooks(state, subject, event.entry, event);
      }
    });
    if (remover) state.removers.push(remover);
  }
}

function makeState(config, options) {
  return {
    config,
    options,
    governor: options.governor || null,
    wireObservation: options.wireObservation || null,
    teachStore: options.teachStore || null,
    gate: options.gate || null,
    agentChannel: options.agentChannel || null,
    telemetry: options.telemetry || null,
    now: options.now || (() => Date.now()),
    activity: [],
    askAgentQueue: [],
    observedRecent: [],
    pending: new Set(),
    removers: [],
    closed: false,
    lastObservation: null,
  };
}

/**
 * Bind a workspace config's hooks[] to the reserved wire-observation context.
 *
 * @param {Object} config
 * @param {Object} [options]
 * @returns {Object}
 */
export function bindConfigHooks(config = {}, options = {}) {
  if (!isObject(config)) throw new Error('bindConfigHooks requires a workspace config object.');
  let state = makeState(config, options);
  bindGovernorRetractions(state);
  bindObservationSubjects(state);

  let handle = {
    activity: state.activity,
    askAgentQueue: state.askAgentQueue,
    subscriptions: triggerSubjects(config),

    get pendingCount() {
      return state.pending.size;
    },

    get lastObservation() {
      return state.lastObservation;
    },

    async runGuards(subject, entry = {}, eventOptions = {}) {
      return runGuardHooks(state, subject, entry, eventOptions);
    },

    scheduleHooks(subject, entry = {}, eventOptions = {}) {
      return scheduleNonGuardHooks(state, subject, entry, eventOptions);
    },

    fire(subject, entry = {}, eventOptions = {}) {
      return fireSubject(state, subject, entry, eventOptions);
    },

    async flushAskAgentQueue() {
      if (!state.agentChannel || typeof state.agentChannel.invoke !== 'function') return [];
      let results = [];
      while (state.askAgentQueue.length > 0 && !constructionLoopRunning(state, {})) {
        let item = state.askAgentQueue.shift();
        if (!epochIsCurrent(state.governor, item.event.epoch ?? governorEpoch(state.governor))) continue;
        results.push(await state.agentChannel.invoke(item.request));
      }
      return results;
    },

    previewMatches(args = {}) {
      return previewHookMatches(config, state.wireObservation, args);
    },

    async dismiss(hookId, entry = {}) {
      let hook = (config.hooks || []).find((item) => item.id === hookId);
      if (!hook) throw new Error(`Unknown hook "${hookId}".`);
      let key = dismissalKeyForHook(hook, entry);
      await writeTeachState(state.teachStore, key, {
        status: 'dismissed',
        updatedAt: new Date(state.now()).toISOString(),
      });
      return key;
    },

    async complete(hookId, entry = {}) {
      let hook = (config.hooks || []).find((item) => item.id === hookId);
      if (!hook) throw new Error(`Unknown hook "${hookId}".`);
      let key = dismissalKeyForHook(hook, entry);
      await writeTeachState(state.teachStore, key, {
        status: 'completed',
        updatedAt: new Date(state.now()).toISOString(),
      });
      return key;
    },

    close() {
      state.closed = true;
      for (let remover of state.removers) remover.remove();
      state.removers.length = 0;
      state.pending.clear();
    },
  };

  return handle;
}

/**
 * Replay recent observer entries without mutating bridge state.
 *
 * @param {Object} config
 * @param {Object} wireObservation
 * @param {Object} [args]
 * @returns {{status: string, count: number, matches: Array}}
 */
export function previewHookMatches(config = {}, wireObservation = null, args = {}) {
  let inputs = [];
  if (typeof args.subject === 'string') {
    inputs.push(normalizeEvent(args.subject, { entry: args.entry || {}, ...args }));
  } else {
    for (let item of recentFromObservation(wireObservation)) {
      if (typeof item.subject === 'string') {
        inputs.push(normalizeEvent(item.subject, item));
      } else if (item.wireId) {
        inputs.push(normalizeEvent(`event:${item.wireId}`, item));
        inputs.push(normalizeEvent(`binding:${item.wireId}`, item));
      }
    }
  }

  let matches = [];
  for (let event of inputs) {
    for (let hook of matchingHooks(config, event.subject, event, null)) {
      matches.push({
        hookId: hook.id,
        hookClass: hook.class,
        subject: event.subject,
        triggerSubject: hook.trigger.subject,
      });
    }
  }

  return { status: 'ok', count: matches.length, matches };
}

export const hookBridgeInterfaces = Object.freeze({
  governor: [
    'getEpoch()|currentEpoch',
    'isEpochActive(epoch)',
    'schedule(task, meta)',
    'shouldRun({hook,event,key})',
    'onRetract(callback)|on("retract", callback)',
  ],
  wireObservation: [
    'subscribe(subject, callback)|sub(subject, callback)',
    'recent()|recent[]',
    `PubSub context at ${WIRE_OBSERVATION_CONTEXT}`,
  ],
  teachStore: [
    'read(key)|get(key)',
    'write(key, record)|set(key, record)',
  ],
  gate: [
    'hasGrantCoverage(request)',
    'decide(request)|evaluate(request)|confirm(request)',
  ],
  agentChannel: [
    'invoke({contextId, prompt, context, signal})',
  ],
  filterHookContext: [
    'context.allow $entry. paths only',
    'context.maxBytes enforced before agent or host-service calls',
  ],
});

export default Object.freeze({
  bindConfigHooks,
  composeHookPolicy,
  dismissalKeyForHook,
  filterHookContext,
  previewHookMatches,
});
