/**
 * Host-neutral execution job runtime.
 *
 * Owns admission idempotency, durable-before-side-effect ordering, epoch-fenced
 * writes, capacity-group validation, cancel signals, monotonic run status, and
 * execution progress topics without importing a host product.
 *
 * @module symbiote-workspace/server/jobs
 */

import { createHash } from 'node:crypto';

import {
  EXECUTION_HISTORY_DEFAULTS,
  RUN_STATUSES,
  TRIGGER_KINDS,
  WORKSPACE_EXECUTION_CHANNELS,
} from '../schema/constants.js';

const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled', 'partial']);
const RUN_STATUS_SET = new Set(RUN_STATUSES);
const TRIGGER_KIND_SET = new Set(TRIGGER_KINDS);
const LEGAL_TRANSITIONS = Object.freeze({
  queued: new Set(['running', 'cancelled']),
  running: new Set(['done', 'failed', 'cancelled', 'partial']),
  done: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  partial: new Set(),
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function nowMs() {
  return Date.now();
}

function errorWithCode(message, code) {
  let error = new Error(message);
  error.code = code;
  return error;
}

function assertRunId(runId) {
  if (typeof runId !== 'string' || runId.length === 0) {
    throw errorWithCode('Execution runId is required.', 'execution_run_id_required');
  }
}

function declaredGroups(config) {
  let groups = config?.server?.jobs?.groups;
  if (!Array.isArray(groups)) return new Set();
  return new Set(groups
    .map((group) => group?.id)
    .filter((id) => typeof id === 'string' && id.length > 0));
}

function triggerFromRequest(request = {}) {
  let trigger = isObject(request.trigger) ? cloneJson(request.trigger) : {};
  let kind = trigger.kind || request.triggerKind || 'manual';
  if (!TRIGGER_KIND_SET.has(kind)) {
    throw errorWithCode(`Unknown execution trigger kind "${kind}".`, 'execution_trigger_unknown');
  }
  return { ...trigger, kind };
}

function targetFromRequest(request = {}) {
  if (isObject(request.target)) return cloneJson(request.target);
  let target = {};
  for (let key of ['graphId', 'graph', 'nodeId', 'node', 'doc', 'docAddress', 'pack', 'nodeType']) {
    if (request[key] !== undefined) target[key] = cloneJson(request[key]);
  }
  if (Object.keys(target).length === 0) {
    throw errorWithCode('execution.submit requires a target or graphId.', 'execution_target_required');
  }
  return target;
}

function graphIdForRecord(target) {
  return target.graphId || target.graph || target.pack || target.id || 'runtime';
}

function normalizeMode(mode, trigger) {
  if (trigger.kind !== 'manual') return 'job';
  if (mode === undefined || mode === null) return 'interactive';
  if (mode !== 'interactive' && mode !== 'job') {
    throw errorWithCode('execution mode must be "interactive" or "job".', 'execution_mode_invalid');
  }
  return mode;
}

function actorForRecord(request, trigger, target) {
  let supplied = isObject(request.actor) ? request.actor : {};
  let principal = isObject(request.principal)
    ? request.principal
    : (isObject(supplied.principal) ? supplied.principal : null);
  if (!principal) {
    principal = trigger.kind === 'ingress'
      ? { kind: 'daemon', id: trigger.endpointId || target.endpointId || 'ingress' }
      : { kind: 'human', id: 'user' };
  }
  let actor = supplied.actor || request.actorLane || (principal.kind === 'daemon' ? 'system' : 'user-direct');
  return {
    ...cloneJson(supplied),
    principal: cloneJson(principal),
    actor,
    trigger: trigger.kind,
  };
}

export function deterministicRunId({ jobKey, target, trigger }) {
  let key = typeof jobKey === 'string' && jobKey.length > 0
    ? jobKey
    : `${trigger.kind}:${trigger.registrationId || trigger.endpointId || trigger.firingId || 'manual'}`;
  return `run_${hashValue({ key, target, trigger }).slice(0, 32)}`;
}

export function createMemoryExecutionStore(initialRecords = []) {
  let records = new Map();
  let epoch = 0;
  for (let record of initialRecords) {
    if (record?.runId) records.set(record.runId, cloneJson(record));
  }

  function assertEpoch(expected) {
    if (expected !== epoch) {
      throw errorWithCode(
        `Execution epoch ${expected} is superseded by epoch ${epoch}.`,
        'execution_epoch_superseded',
      );
    }
  }

  return {
    claimEpoch() {
      epoch += 1;
      return epoch;
    },
    currentEpoch() {
      return epoch;
    },
    assertEpoch,
    async getRecord(runId) {
      return cloneJson(records.get(runId));
    },
    async putRecord(record, options = {}) {
      if (options.epoch !== undefined) assertEpoch(options.epoch);
      if (!record?.runId) throw errorWithCode('Execution record requires runId.', 'execution_record_invalid');
      records.set(record.runId, cloneJson(record));
      return cloneJson(record);
    },
    async listRecords() {
      return [...records.values()].map(cloneJson);
    },
    dump() {
      return Object.fromEntries([...records.entries()].map(([runId, record]) => [runId, cloneJson(record)]));
    },
  };
}

export class JobRuntime {
  constructor(options = {}) {
    this.config = options.config || {};
    this.store = options.store || createMemoryExecutionStore();
    this.epoch = typeof this.store.claimEpoch === 'function'
      ? this.store.claimEpoch(options.owner || 'execution-runtime')
      : (Number.isInteger(options.epoch) ? options.epoch : 1);
    this.runner = typeof options.runner === 'function' ? options.runner : async () => ({ status: 'done' });
    this.broadcast = options.broadcast;
    this.now = typeof options.now === 'function' ? options.now : nowMs;
    this.autoStart = options.autoStart !== false;
    this.capacityGroups = options.capacityGroups || {};
    this.historyDefaults = options.historyDefaults || EXECUTION_HISTORY_DEFAULTS;
    this.queue = [];
    this.jobs = new Map();
    this.controllers = new Map();
    this.activeByGroup = new Map();
    this.running = new Set();
  }

  assertEpoch() {
    if (typeof this.store.assertEpoch === 'function') this.store.assertEpoch(this.epoch);
  }

  capacityFor(groupId) {
    if (!groupId) return Infinity;
    let configured = this.capacityGroups[groupId];
    if (!Number.isInteger(configured) || configured < 0) return Infinity;
    return configured;
  }

  activeCount(groupId) {
    return this.activeByGroup.get(groupId || '') || 0;
  }

  setActiveCount(groupId, delta) {
    let key = groupId || '';
    let next = Math.max(0, this.activeCount(groupId) + delta);
    if (next === 0) this.activeByGroup.delete(key);
    else this.activeByGroup.set(key, next);
  }

  assertGroup(groupId) {
    if (!groupId) return;
    let groups = declaredGroups(this.config);
    if (!groups.has(groupId)) {
      throw errorWithCode(`Execution capacity group "${groupId}" is not declared in server.jobs.groups[].`, 'execution_group_unresolved');
    }
  }

  emit(channel, payload) {
    if (typeof this.broadcast !== 'function') return;
    this.broadcast({ type: channel, payload: { channel, ...cloneJson(payload) } });
  }

  emitQueue(runId, state) {
    let position = this.queue.indexOf(runId);
    this.emit(WORKSPACE_EXECUTION_CHANNELS.queue, {
      runId,
      position: position >= 0 ? position : null,
      state,
    });
  }

  emitNodeProgress(runId, nodeId, progress = {}) {
    this.emit(WORKSPACE_EXECUTION_CHANNELS.nodeProgress, { runId, nodeId, ...cloneJson(progress) });
  }

  emitNodeOutput(runId, nodeId, output = {}) {
    this.emit(WORKSPACE_EXECUTION_CHANNELS.nodeOutput, { runId, nodeId, output: cloneJson(output) });
  }

  async record(runId) {
    assertRunId(runId);
    return this.store.getRecord(runId);
  }

  async list(filter = {}) {
    let records = await this.store.listRecords();
    let filtered = records.filter((record) => {
      if (filter.status && record.status !== filter.status) return false;
      if (filter.groupId && record.groupId !== filter.groupId) return false;
      return true;
    });
    filtered.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0) || a.runId.localeCompare(b.runId));
    return { records: filtered, defaults: cloneJson(this.historyDefaults) };
  }

  async transition(runId, nextStatus, patch = {}) {
    if (!RUN_STATUS_SET.has(nextStatus)) {
      throw errorWithCode(`Unknown execution status "${nextStatus}".`, 'execution_status_unknown');
    }
    let current = await this.record(runId);
    if (!current) throw errorWithCode(`Execution run "${runId}" does not exist.`, 'execution_run_not_found');
    if (current.status === nextStatus) {
      let updated = { ...current, ...cloneJson(patch), status: current.status };
      return this.store.putRecord(updated, { epoch: this.epoch });
    }
    let allowed = LEGAL_TRANSITIONS[current.status];
    if (!allowed || !allowed.has(nextStatus)) {
      throw errorWithCode(
        `Illegal execution status transition ${current.status} -> ${nextStatus}.`,
        'execution_status_transition_illegal',
      );
    }

    let ended = TERMINAL_STATUSES.has(nextStatus);
    let next = {
      ...current,
      ...cloneJson(patch),
      status: nextStatus,
      ...(ended ? { endedAt: patch.endedAt || this.now() } : {}),
    };
    let written = await this.store.putRecord(next, { epoch: this.epoch });
    this.emitQueue(runId, nextStatus);
    return written;
  }

  async submit(request = {}) {
    let target = targetFromRequest(request);
    let trigger = triggerFromRequest(request);
    let mode = normalizeMode(request.mode, trigger);
    let groupId = request.groupId || target.groupId || request.capacityGroup;
    this.assertGroup(groupId);

    let runId = deterministicRunId({
      jobKey: request.jobKey,
      target,
      trigger,
    });
    let existing = await this.store.getRecord(runId);
    if (existing) {
      return { status: 'ok', runId, record: existing, idempotent: true, admitted: false };
    }

    let queuedAt = this.now();
    let controller = new AbortController();
    let record = {
      runId,
      graphId: graphIdForRecord(target),
      ...(target.doc || target.docAddress ? { doc: target.doc || target.docAddress } : {}),
      status: 'queued',
      mode,
      groupId,
      target: cloneJson(target),
      trigger: cloneJson(trigger),
      actor: actorForRecord(request, trigger, target),
      startedAt: queuedAt,
      queuedAt,
      epoch: this.epoch,
    };

    await this.store.putRecord(record, { epoch: this.epoch });

    let job = {
      runId,
      target,
      trigger,
      mode,
      groupId,
      controller,
      signal: controller.signal,
      cleanupLeash: null,
    };

    if (mode === 'interactive' && request.signal && typeof request.signal.addEventListener === 'function') {
      let onAbort = () => controller.abort(request.signal.reason || 'session-disconnected');
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener('abort', onAbort, { once: true });
      job.cleanupLeash = () => request.signal.removeEventListener('abort', onAbort);
    }

    this.jobs.set(runId, job);
    this.controllers.set(runId, controller);
    this.queue.push(runId);
    this.emitQueue(runId, 'queued');

    if (this.autoStart) {
      if (mode === 'interactive') {
        await this.startQueuedRun(runId);
        let terminal = await this.record(runId);
        return { status: 'ok', runId, record: terminal, admitted: true };
      }
      this.pump();
    }

    return { status: 'ok', runId, record: cloneJson(record), admitted: true };
  }

  canStart(job) {
    return this.activeCount(job.groupId) < this.capacityFor(job.groupId);
  }

  pump() {
    for (let runId of [...this.queue]) {
      let job = this.jobs.get(runId);
      if (!job || !this.canStart(job)) continue;
      let promise = this.startQueuedRun(runId);
      this.running.add(promise);
      promise
        .finally(() => this.running.delete(promise))
        .catch(() => {});
    }
  }

  async startQueuedRun(runId) {
    let job = this.jobs.get(runId);
    if (!job) return null;
    if (!this.canStart(job)) return null;
    let queueIndex = this.queue.indexOf(runId);
    if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
    this.setActiveCount(job.groupId, 1);

    try {
      await this.transition(runId, 'running', { runningAt: this.now() });
      let result = await this.runner({
        runId,
        target: cloneJson(job.target),
        trigger: cloneJson(job.trigger),
        mode: job.mode,
        groupId: job.groupId,
        signal: job.signal,
        emitNodeProgress: (nodeId, progress) => this.emitNodeProgress(runId, nodeId, progress),
        emitNodeOutput: (nodeId, output) => this.emitNodeOutput(runId, nodeId, output),
      });
      let terminalStatus = job.signal.aborted
        ? 'cancelled'
        : (TERMINAL_STATUSES.has(result?.status) ? result.status : 'done');
      return await this.transition(runId, terminalStatus, {
        ...(result?.nodes ? { nodes: cloneJson(result.nodes) } : {}),
        ...(result?.timing ? { timing: cloneJson(result.timing) } : {}),
        ...(result?.result !== undefined ? { result: cloneJson(result.result) } : {}),
      });
    } catch (err) {
      if (err?.code === 'execution_status_transition_illegal') return this.record(runId);
      let terminalStatus = job.signal.aborted ? 'cancelled' : 'failed';
      return this.transition(runId, terminalStatus, {
        error: { message: err?.message || String(err), code: err?.code },
      }).catch((transitionErr) => {
        if (transitionErr?.code === 'execution_status_transition_illegal') return this.record(runId);
        throw transitionErr;
      });
    } finally {
      if (typeof job.cleanupLeash === 'function') job.cleanupLeash();
      this.setActiveCount(job.groupId, -1);
      this.controllers.delete(runId);
      this.jobs.delete(runId);
      this.pump();
    }
  }

  async cancel(request = {}) {
    let { runId } = request;
    let record = await this.record(runId);
    if (!record) throw errorWithCode(`Execution run "${runId}" does not exist.`, 'execution_run_not_found');
    if (TERMINAL_STATUSES.has(record.status)) {
      return { status: 'ok', runId, record, idempotent: true };
    }

    let controller = this.controllers.get(runId);
    if (controller && !controller.signal.aborted) controller.abort(request.reason || 'execution.cancel');
    let queueIndex = this.queue.indexOf(runId);
    if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
    let cancelled = await this.transition(runId, 'cancelled', {
      cancelReason: request.reason || 'execution.cancel',
    });
    return { status: 'ok', runId, record: cancelled };
  }

  async reorder(request = {}) {
    let { runId } = request;
    let record = await this.record(runId);
    if (!record) throw errorWithCode(`Execution run "${runId}" does not exist.`, 'execution_run_not_found');
    if (record.status !== 'queued') {
      throw errorWithCode(`Only queued executions can be reordered; "${runId}" is ${record.status}.`, 'execution_reorder_not_queued');
    }
    this.assertEpoch();

    this.queue = this.queue.filter((id) => id !== runId);
    if (Number.isInteger(request.position)) {
      let index = Math.max(0, Math.min(request.position, this.queue.length));
      this.queue.splice(index, 0, runId);
    } else if (request.beforeRunId && this.queue.includes(request.beforeRunId)) {
      this.queue.splice(this.queue.indexOf(request.beforeRunId), 0, runId);
    } else if (request.afterRunId && this.queue.includes(request.afterRunId)) {
      this.queue.splice(this.queue.indexOf(request.afterRunId) + 1, 0, runId);
    } else {
      this.queue.push(runId);
    }

    for (let id of this.queue) this.emitQueue(id, 'queued');
    return {
      status: 'ok',
      runId,
      queue: this.queue.map((id, index) => ({ runId: id, position: index })),
    };
  }

  async attach(request = {}) {
    let record = await this.record(request.runId);
    if (!record) throw errorWithCode(`Execution run "${request.runId}" does not exist.`, 'execution_run_not_found');
    return {
      status: 'ok',
      runId: request.runId,
      record,
      snapshotTruth: true,
      streamAdvisory: true,
      topics: cloneJson(WORKSPACE_EXECUTION_CHANNELS),
    };
  }

  async drain() {
    this.pump();
    while (this.running.size > 0) {
      await Promise.allSettled([...this.running]);
      this.pump();
    }
  }
}

export function createJobRuntime(options = {}) {
  return new JobRuntime(options);
}

export default createJobRuntime;
