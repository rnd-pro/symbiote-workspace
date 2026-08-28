import { canonicalize } from '../../schema/canonical-json.js';
import { validatePresentationAlignedSequence } from './align.js';
import {
  createPresentationAuthoringTimelineProjection,
  validatePresentationAuthoringProject,
} from './project.js';
import { validatePresentationScheduleV2 } from './schedule-v2.js';

export const PRESENTATION_EXECUTION_VERSION = 'workspace-presentation-execution-v1';
export const PRESENTATION_EFFECT_RECEIPT_VERSION = 'workspace-presentation-effect-receipt-v1';

const EFFECT_KINDS = Object.freeze(['narration', 'interaction', 'attention', 'state']);
const EFFECT_STATUSES = Object.freeze([
  'acted',
  'ready',
  'first-frame',
  'settled',
  'ended',
  'skipped',
  'cancelled',
  'failed',
  'stale',
]);
const ACTUAL_RECEIPT_SEQUENCE = Object.freeze({
  interaction: Object.freeze(['acted', 'settled']),
  attention: Object.freeze(['first-frame', 'settled']),
  state: Object.freeze(['ready']),
});
const RECEIPT_STATUSES_BY_KIND = Object.freeze({
  narration: new Set(['ended', 'skipped', 'cancelled', 'failed', 'stale']),
  interaction: new Set(['acted', 'settled', 'ended', 'skipped', 'cancelled', 'failed', 'stale']),
  attention: new Set(['first-frame', 'settled', 'ended', 'skipped', 'cancelled', 'failed', 'stale']),
  state: new Set(['ready', 'ended', 'skipped', 'cancelled', 'failed', 'stale']),
});
const RECEIPT_KEYS = Object.freeze([
  'version',
  'operationId',
  'generation',
  'cellId',
  'kind',
  'status',
  'reason',
]);
const TERMINAL_REASON_STATUSES = new Set([
  'skipped',
  'cancelled',
  'failed',
  'stale',
]);

class PresentationExecutionError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PresentationExecutionError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new PresentationExecutionError(code, message, details);
}

function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function knownKeys(value, keys, path, code = 'PRESENTATION_EXECUTION_INVALID') {
  for (let key of Object.keys(value)) {
    if (!keys.includes(key)) {
      fail(
        code,
        `${path}.${key} is not supported by ${PRESENTATION_EXECUTION_VERSION}`,
        { path: `${path}.${key}` },
      );
    }
  }
}

function text(value, path, code = 'PRESENTATION_EXECUTION_INVALID') {
  let normalized = String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    fail(code, `${path} must be nonempty text`, { path });
  }
  return normalized;
}

function generation(value, path, code = 'PRESENTATION_EXECUTION_INVALID') {
  if (!Number.isInteger(value) || value < 0) {
    fail(
      code,
      `${path} must be a nonnegative integer`,
      { path, value },
    );
  }
  return value;
}

function mediaTime(value, path) {
  if (!Number.isFinite(value) || value < 0) {
    fail(
      'PRESENTATION_EXECUTION_INVALID',
      `${path} must be a finite nonnegative number`,
      { path, value },
    );
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (let child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableClone(value) {
  return deepFreeze(JSON.parse(canonicalize(value)));
}

function abortError(reason) {
  if (reason instanceof Error) return reason;
  let error = new Error(String(reason || 'presentation operation cancelled'));
  error.name = 'AbortError';
  return error;
}

function awaitWithAbort(value, signal) {
  if (signal.aborted) return Promise.reject(abortError(signal.reason));
  return new Promise((resolve, reject) => {
    let onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortError(signal.reason));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(value).then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function effectKindForCell(cell) {
  if (cell.kind === 'narration') return 'narration';
  if (cell.kind === 'interaction') return 'interaction';
  if (cell.kind === 'state') return 'state';
  return 'attention';
}

function operationMethodForKind(adapter, kind) {
  if (kind === 'interaction') return adapter.runInteraction;
  if (kind === 'attention') return adapter.runAttention;
  if (kind === 'state') return adapter.waitForState;
  return null;
}

function cellExpiry(cell) {
  if (cell.visibility) return cell.visibility.endMs;
  if (cell.gesture) return cell.gesture.endMs;
  return Number.POSITIVE_INFINITY;
}

function createReceipt({ operationId, generation: valueGeneration, cellId, kind, status, reason }) {
  let receipt = {
    version: PRESENTATION_EFFECT_RECEIPT_VERSION,
    operationId,
    generation: valueGeneration,
    cellId,
    kind,
    status,
    ...(reason ? { reason } : {}),
  };
  return deepFreeze(receipt);
}

function validateExpectedReceiptContext(expected = {}) {
  if (!isObject(expected)) {
    fail(
      'PRESENTATION_EFFECT_RECEIPT_INVALID',
      'expected presentation effect receipt context must be an object',
    );
  }
  knownKeys(
    expected,
    ['operationId', 'cellId', 'kind'],
    'expected',
    'PRESENTATION_EFFECT_RECEIPT_INVALID',
  );
  let operationId = text(
    expected.operationId,
    'expected.operationId',
    'PRESENTATION_EFFECT_RECEIPT_INVALID',
  );
  let cellId = text(
    expected.cellId,
    'expected.cellId',
    'PRESENTATION_EFFECT_RECEIPT_INVALID',
  );
  let kind = text(expected.kind, 'expected.kind', 'PRESENTATION_EFFECT_RECEIPT_INVALID');
  if (!EFFECT_KINDS.includes(kind)) {
    fail(
      'PRESENTATION_EFFECT_RECEIPT_INVALID',
      `expected.kind must be one of ${EFFECT_KINDS.join(', ')}`,
      { kind },
    );
  }
  return { operationId, cellId, kind };
}

/**
 * @param {object} receipt
 * @param {{operationId: string, cellId: string, kind: string}} expected
 * @returns {object}
 */
export function validatePresentationEffectReceipt(receipt = {}, expected = {}) {
  let context = validateExpectedReceiptContext(expected);
  if (!isObject(receipt)) {
    fail(
      'PRESENTATION_EFFECT_RECEIPT_INVALID',
      'presentation effect receipt must be an object',
    );
  }
  knownKeys(receipt, RECEIPT_KEYS, 'receipt', 'PRESENTATION_EFFECT_RECEIPT_INVALID');
  if (receipt.version !== PRESENTATION_EFFECT_RECEIPT_VERSION) {
    fail(
      'PRESENTATION_EFFECT_RECEIPT_INVALID',
      `unsupported presentation effect receipt version: ${receipt.version}`,
      { version: receipt.version },
    );
  }
  let operationId = text(
    receipt.operationId,
    'receipt.operationId',
    'PRESENTATION_EFFECT_RECEIPT_INVALID',
  );
  let cellId = text(receipt.cellId, 'receipt.cellId', 'PRESENTATION_EFFECT_RECEIPT_INVALID');
  let kind = text(receipt.kind, 'receipt.kind', 'PRESENTATION_EFFECT_RECEIPT_INVALID');
  let status = text(receipt.status, 'receipt.status', 'PRESENTATION_EFFECT_RECEIPT_INVALID');
  generation(
    receipt.generation,
    'receipt.generation',
    'PRESENTATION_EFFECT_RECEIPT_INVALID',
  );
  if (!EFFECT_KINDS.includes(kind)) {
    fail(
      'PRESENTATION_EFFECT_RECEIPT_INVALID',
      `receipt.kind must be one of ${EFFECT_KINDS.join(', ')}`,
      { kind },
    );
  }
  if (!EFFECT_STATUSES.includes(status)) {
    fail(
      'PRESENTATION_EFFECT_RECEIPT_INVALID',
      `receipt.status must be one of ${EFFECT_STATUSES.join(', ')}`,
      { status },
    );
  }
  if (!RECEIPT_STATUSES_BY_KIND[kind].has(status)) {
    fail(
      'PRESENTATION_EFFECT_RECEIPT_INVALID',
      `receipt status "${status}" is unavailable for ${kind} effects`,
      { kind, status },
    );
  }
  if (
    operationId !== context.operationId
    || cellId !== context.cellId
    || kind !== context.kind
  ) {
    fail(
      'PRESENTATION_EFFECT_RECEIPT_CONTEXT_MISMATCH',
      'presentation effect receipt does not match its active operation context',
      {
        expected: context,
        received: { operationId, cellId, kind },
      },
    );
  }
  if (TERMINAL_REASON_STATUSES.has(status)) {
    text(receipt.reason, 'receipt.reason', 'PRESENTATION_EFFECT_RECEIPT_INVALID');
  } else if (receipt.reason !== undefined) {
    fail(
      'PRESENTATION_EFFECT_RECEIPT_INVALID',
      `receipt.reason is not allowed for actual status "${status}"`,
      { status },
    );
  }
  return receipt;
}

class PresentationExecutionController {
  #project;
  #alignment;
  #schedule;
  #adapter;
  #onReceipt;
  #projectCellById;
  #scheduleCells;
  #visualCells;
  #barriers = new Map();
  #terminal = new Map();
  #active = null;
  #state = 'running';
  #generation = 0;
  #sequence = 0;
  #mediaTimeMs = null;
  #lastSampleReason = '';
  #sampleCount = 0;
  #busySampleCount = 0;
  #ignoredSampleCount = 0;
  #maxInFlight = 0;
  #receiptCount = 0;
  #lastReceipt = null;
  #externalSignal = null;
  #externalAbort = null;

  constructor(input = {}) {
    if (!isObject(input)) {
      fail('PRESENTATION_EXECUTION_INVALID', 'presentation execution input must be an object');
    }
    knownKeys(
      input,
      ['project', 'alignedSequence', 'schedule', 'adapter', 'onReceipt', 'signal'],
      'input',
    );
    try {
      this.#project = validatePresentationAuthoringProject(input.project);
      let timeline = createPresentationAuthoringTimelineProjection(this.#project);
      this.#alignment = validatePresentationAlignedSequence(input.alignedSequence, timeline);
      this.#schedule = validatePresentationScheduleV2(
        input.schedule,
        this.#project,
        this.#alignment,
      );
    } catch (error) {
      fail(
        'PRESENTATION_EXECUTION_TUPLE_INVALID',
        `presentation execution requires an exact project/alignment/schedule tuple: ${error.message}`,
        { cause: error.message, causeCode: error.code || '' },
      );
    }
    if (!isObject(input.adapter)) {
      fail('PRESENTATION_EXECUTION_INVALID', 'input.adapter must be an object');
    }
    knownKeys(
      input.adapter,
      ['runInteraction', 'runAttention', 'waitForState'],
      'input.adapter',
    );
    this.#adapter = Object.freeze({ ...input.adapter });
    this.#onReceipt = input.onReceipt ?? null;
    if (this.#onReceipt !== null && typeof this.#onReceipt !== 'function') {
      fail('PRESENTATION_EXECUTION_INVALID', 'input.onReceipt must be a function');
    }
    this.#projectCellById = new Map(
      this.#project.cells.map((cell) => [cell.id, immutableClone(cell)]),
    );
    this.#scheduleCells = this.#schedule.cells.map((cell) => immutableClone(cell));
    this.#visualCells = this.#scheduleCells.filter((cell) => cell.kind !== 'narration');
    let requiredKinds = new Set(this.#visualCells.map((cell) => effectKindForCell(cell)));
    for (let kind of requiredKinds) {
      let method = operationMethodForKind(this.#adapter, kind);
      if (typeof method !== 'function') {
        let methodName = kind === 'interaction'
          ? 'runInteraction'
          : kind === 'attention' ? 'runAttention' : 'waitForState';
        fail(
          'PRESENTATION_EXECUTION_ADAPTER_MISSING',
          `input.adapter.${methodName} is required for ${kind} cells`,
          { kind, methodName },
        );
      }
    }
    if (input.signal !== undefined) this.#attachExternalSignal(input.signal);
  }

  get snapshot() {
    let barrierEntries = this.#scheduleCells
      .filter((cell) => this.#barriers.has(cell.cellId))
      .map((cell) => Object.freeze({
        cellId: cell.cellId,
        barriers: Object.freeze([...this.#barriers.get(cell.cellId)]),
      }));
    let terminalEntries = this.#scheduleCells
      .filter((cell) => this.#terminal.has(cell.cellId))
      .map((cell) => Object.freeze({
        cellId: cell.cellId,
        status: this.#terminal.get(cell.cellId),
      }));
    return Object.freeze({
      version: PRESENTATION_EXECUTION_VERSION,
      state: this.#state,
      generation: this.#generation,
      mediaTimeMs: this.#mediaTimeMs,
      lastSampleReason: this.#lastSampleReason,
      activeCount: this.#active ? 1 : 0,
      pendingCount: 0,
      activeOperationId: this.#active?.operationId || '',
      activeCellId: this.#active?.scheduleCell.cellId || '',
      sampleCount: this.#sampleCount,
      busySampleCount: this.#busySampleCount,
      ignoredSampleCount: this.#ignoredSampleCount,
      maxInFlight: this.#maxInFlight,
      receiptCount: this.#receiptCount,
      lastReceipt: this.#lastReceipt,
      barriers: Object.freeze(barrierEntries),
      terminal: Object.freeze(terminalEntries),
    });
  }

  sample(input = {}) {
    if (!isObject(input)) {
      fail('PRESENTATION_EXECUTION_INVALID', 'sample input must be an object');
    }
    knownKeys(input, ['mediaTimeMs', 'reason'], 'sample');
    let nextMediaTimeMs = mediaTime(input.mediaTimeMs, 'sample.mediaTimeMs');
    let reason = text(input.reason, 'sample.reason');
    this.#sampleCount += 1;
    if (this.#state !== 'running') {
      this.#ignoredSampleCount += 1;
      return this.snapshot;
    }
    if (this.#mediaTimeMs !== null && nextMediaTimeMs < this.#mediaTimeMs) {
      fail(
        'PRESENTATION_EXECUTION_BACKWARD_MEDIA_TIME',
        'sample.mediaTimeMs moved backward without seek()',
        { previousMediaTimeMs: this.#mediaTimeMs, mediaTimeMs: nextMediaTimeMs },
      );
    }
    let previousMediaTimeMs = this.#mediaTimeMs;
    this.#mediaTimeMs = nextMediaTimeMs;
    this.#lastSampleReason = reason;
    this.#observeMediaEndings(previousMediaTimeMs, nextMediaTimeMs);
    this.#skipExpiredCells(nextMediaTimeMs);
    if (this.#active) {
      this.#busySampleCount += 1;
      return this.snapshot;
    }
    let candidate = this.#visualCells.find((cell) => (
      cell.startMs <= nextMediaTimeMs
      && !this.#terminal.has(cell.cellId)
      && nextMediaTimeMs < cellExpiry(cell)
      && this.#dependenciesSatisfied(cell)
    ));
    if (candidate) this.#start(candidate);
    return this.snapshot;
  }

  whenIdle() {
    let active = this.#active;
    return active ? active.done.then(() => this.snapshot) : Promise.resolve(this.snapshot);
  }

  pause() {
    if (this.#state === 'disposed' || this.#state === 'stopped') {
      return Promise.resolve(this.snapshot);
    }
    this.#state = 'paused';
    return this.#cancelActive('pause');
  }

  resume() {
    if (this.#state === 'disposed' || this.#state === 'stopped') {
      fail(
        'PRESENTATION_EXECUTION_TERMINAL',
        `cannot resume presentation execution after ${this.#state}`,
        { state: this.#state },
      );
    }
    this.#state = 'running';
    return this.snapshot;
  }

  seek() {
    if (this.#state === 'disposed' || this.#state === 'stopped') {
      fail(
        'PRESENTATION_EXECUTION_TERMINAL',
        `cannot seek presentation execution after ${this.#state}`,
        { state: this.#state },
      );
    }
    this.#generation += 1;
    this.#mediaTimeMs = null;
    this.#lastSampleReason = '';
    this.#barriers.clear();
    this.#terminal.clear();
    return this.#cancelActive('seek');
  }

  stop() {
    if (this.#state === 'disposed' || this.#state === 'stopped') {
      return Promise.resolve(this.snapshot);
    }
    this.#state = 'stopped';
    return this.#cancelActive('stop');
  }

  dispose() {
    if (this.#state === 'disposed') return Promise.resolve(this.snapshot);
    this.#state = 'disposed';
    this.#detachExternalSignal();
    return this.#cancelActive('dispose');
  }

  #attachExternalSignal(signal) {
    if (
      !signal
      || typeof signal.aborted !== 'boolean'
      || typeof signal.addEventListener !== 'function'
      || typeof signal.removeEventListener !== 'function'
    ) {
      fail('PRESENTATION_EXECUTION_INVALID', 'input.signal must be an AbortSignal');
    }
    this.#externalSignal = signal;
    this.#externalAbort = () => {
      if (this.#state === 'disposed' || this.#state === 'stopped') return;
      this.#state = 'stopped';
      void this.#cancelActive('external-abort');
    };
    signal.addEventListener('abort', this.#externalAbort, { once: true });
    if (signal.aborted) this.#externalAbort();
  }

  #detachExternalSignal() {
    if (this.#externalSignal && this.#externalAbort) {
      this.#externalSignal.removeEventListener('abort', this.#externalAbort);
    }
    this.#externalSignal = null;
    this.#externalAbort = null;
  }

  #observeMediaEndings(previousMediaTimeMs, nextMediaTimeMs) {
    let previous = previousMediaTimeMs ?? Number.NEGATIVE_INFINITY;
    for (let cell of this.#scheduleCells) {
      let endMs = cell.narration?.endMs ?? cell.visibility?.endMs ?? null;
      if (endMs === null || endMs <= previous || endMs > nextMediaTimeMs) continue;
      if (this.#hasBarrier(cell.cellId, 'ended')) continue;
      this.#openBarrier(cell.cellId, 'ended');
      if (cell.kind === 'narration') this.#terminal.set(cell.cellId, 'completed');
      this.#emit(createReceipt({
        operationId: `presentation-media-${this.#generation}`,
        generation: this.#generation,
        cellId: cell.cellId,
        kind: effectKindForCell(cell),
        status: 'ended',
      }));
    }
  }

  #skipExpiredCells(mediaTimeMsValue) {
    for (let cell of this.#visualCells) {
      if (cell.startMs > mediaTimeMsValue) continue;
      if (this.#terminal.has(cell.cellId)) continue;
      if (this.#active?.scheduleCell.cellId === cell.cellId) continue;
      let expiryMs = cellExpiry(cell);
      if (mediaTimeMsValue < expiryMs) continue;
      let kind = effectKindForCell(cell);
      let operationId = `presentation-effect-${this.#generation}-${++this.#sequence}`;
      this.#terminal.set(cell.cellId, 'skipped');
      this.#emit(createReceipt({
        operationId,
        generation: this.#generation,
        cellId: cell.cellId,
        kind,
        status: 'skipped',
        reason: 'expired',
      }));
    }
  }

  #dependenciesSatisfied(cell) {
    return cell.dependsOn.every((dependency) => (
      this.#hasBarrier(dependency.cellId, dependency.barrier)
    ));
  }

  #hasBarrier(cellId, barrier) {
    return this.#barriers.get(cellId)?.has(barrier) === true;
  }

  #openBarrier(cellId, barrier) {
    let barriers = this.#barriers.get(cellId);
    if (!barriers) {
      barriers = new Set();
      this.#barriers.set(cellId, barriers);
    }
    barriers.add(barrier);
  }

  #start(scheduleCell) {
    let kind = effectKindForCell(scheduleCell);
    let method = operationMethodForKind(this.#adapter, kind);
    let operationId = `presentation-effect-${this.#generation}-${++this.#sequence}`;
    let controller = new AbortController();
    let operation = {
      operationId,
      generation: this.#generation,
      kind,
      scheduleCell,
      projectCell: this.#projectCellById.get(scheduleCell.cellId),
      controller,
      done: null,
    };
    this.#active = operation;
    this.#maxInFlight = Math.max(this.#maxInFlight, 1);
    let input = Object.freeze({
      operationId,
      generation: operation.generation,
      scheduleCell,
      projectCell: operation.projectCell,
      signal: controller.signal,
    });
    let result;
    try {
      result = method(input);
    } catch (error) {
      result = Promise.reject(error);
    }
    operation.done = this.#execute(operation, result);
  }

  async #execute(operation, result) {
    try {
      let receipts = await awaitWithAbort(result, operation.controller.signal);
      if (!this.#operationIsCurrent(operation)) {
        this.#emitTerminal(operation, 'stale', 'superseded-generation');
        return;
      }
      let validated = this.#validateAdapterReceipts(operation, receipts);
      for (let receipt of validated) {
        if (!this.#operationIsCurrent(operation)) {
          this.#emitTerminal(operation, 'stale', 'superseded-generation');
          return;
        }
        this.#openBarrier(operation.scheduleCell.cellId, receipt.status);
        this.#emit(receipt);
      }
      this.#terminal.set(operation.scheduleCell.cellId, 'completed');
    } catch (error) {
      if (operation.controller.signal.aborted) {
        let status = operation.generation === this.#generation ? 'cancelled' : 'stale';
        let reason = operation.controller.signal.reason?.message
          || operation.controller.signal.reason
          || 'cancelled';
        this.#emitTerminal(operation, status, String(reason));
      } else if (!this.#operationIsCurrent(operation)) {
        this.#emitTerminal(operation, 'stale', 'superseded-generation');
      } else {
        this.#terminal.set(operation.scheduleCell.cellId, 'failed');
        this.#emitTerminal(operation, 'failed', error?.message || String(error));
      }
    } finally {
      if (this.#active === operation) this.#active = null;
    }
  }

  #validateAdapterReceipts(operation, receipts) {
    if (!Array.isArray(receipts)) {
      fail(
        'PRESENTATION_EFFECT_RECEIPT_INVALID',
        `${operation.kind} adapter must return an ordered receipt array`,
        { kind: operation.kind },
      );
    }
    let expectedStatuses = ACTUAL_RECEIPT_SEQUENCE[operation.kind];
    if (receipts.length !== expectedStatuses.length) {
      fail(
        'PRESENTATION_EFFECT_RECEIPT_SEQUENCE_INVALID',
        `${operation.kind} adapter must return ${expectedStatuses.join(' then ')}`,
        { expectedStatuses, receivedCount: receipts.length },
      );
    }
    return receipts.map((receipt, index) => {
      validatePresentationEffectReceipt(receipt, {
        operationId: operation.operationId,
        cellId: operation.scheduleCell.cellId,
        kind: operation.kind,
      });
      if (receipt.generation !== operation.generation) {
        fail(
          'PRESENTATION_EFFECT_RECEIPT_CONTEXT_MISMATCH',
          'presentation effect receipt generation does not match its active operation',
          {
            expectedGeneration: operation.generation,
            receivedGeneration: receipt.generation,
          },
        );
      }
      let expectedStatus = expectedStatuses[index];
      if (receipt.status !== expectedStatus) {
        fail(
          'PRESENTATION_EFFECT_RECEIPT_SEQUENCE_INVALID',
          `${operation.kind} receipt ${index} must have status "${expectedStatus}"`,
          { expectedStatus, receivedStatus: receipt.status, index },
        );
      }
      return immutableClone(receipt);
    });
  }

  #operationIsCurrent(operation) {
    return this.#active === operation && operation.generation === this.#generation;
  }

  #emitTerminal(operation, status, reason) {
    this.#emit(createReceipt({
      operationId: operation.operationId,
      generation: operation.generation,
      cellId: operation.scheduleCell.cellId,
      kind: operation.kind,
      status,
      reason,
    }));
  }

  #emit(receipt) {
    this.#receiptCount += 1;
    this.#lastReceipt = receipt;
    this.#onReceipt?.(receipt);
  }

  async #cancelActive(reason) {
    let operation = this.#active;
    if (!operation) return this.snapshot;
    if (!operation.controller.signal.aborted) {
      operation.controller.abort(abortError(reason));
    }
    await operation.done;
    return this.snapshot;
  }
}

/**
 * @param {object} input
 * @returns {PresentationExecutionController}
 */
export function createPresentationExecutionController(input = {}) {
  return new PresentationExecutionController(input);
}
