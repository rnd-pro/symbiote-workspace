import { canonicalize } from '../../schema/canonical-json.js';
import { validatePresentationAlignedSequence } from './align.js';
import {
  createPresentationAuthoringTimelineProjection,
  validatePresentationAuthoringProject,
} from './project.js';
import { validatePresentationScheduleV2 } from './schedule-v2.js';

export const PRESENTATION_EXECUTION_VERSION = 'workspace-presentation-execution-v1';
export const PRESENTATION_EFFECT_ADMISSION_VERSION =
  'workspace-presentation-effect-admission-v2';
export const PRESENTATION_EFFECT_RECEIPT_VERSION = 'workspace-presentation-effect-receipt-v2';

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
const ADMISSION_EFFECT_KINDS = new Set(['interaction', 'attention']);
const MILESTONE_STATUSES = new Set(['acted', 'ready', 'first-frame', 'settled']);
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
  'authoringProjectHash',
  'scheduleHash',
  'cellId',
  'kind',
  'status',
  'observedAt',
  'providerReceipt',
  'reason',
]);
const ADMISSION_KEYS = Object.freeze([
  'version',
  'operationId',
  'generation',
  'authoringProjectHash',
  'scheduleHash',
  'cellId',
  'kind',
  'targetId',
  'budgetMs',
  'providerAdmission',
]);
const ADMISSION_INPUT_KEYS = Object.freeze(['providerAdmission']);
const RECEIPT_INPUT_KEYS = Object.freeze(['status', 'observedAt', 'providerReceipt']);
const OBSERVATION_KEYS = Object.freeze(['domain', 'timeOriginMs', 'monotonicTimeMs']);
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

function finiteNonnegative(value, path, code) {
  if (!Number.isFinite(value) || value < 0) {
    fail(code, `${path} must be a finite nonnegative number`, { path, value });
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  for (let child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function immutableClone(value) {
  return deepFreeze(JSON.parse(canonicalize(value)));
}

function cloneProviderEvidence(value, path, code, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail(code, `${path} must contain only finite JSON numbers`, { path, value });
    }
    return value;
  }
  if (!value || typeof value !== 'object') {
    fail(code, `${path} must contain only portable JSON evidence`, {
      path,
      type: typeof value,
    });
  }
  if (!Array.isArray(value) && !isObject(value)) {
    fail(code, `${path} must contain only arrays and plain objects`, { path });
  }
  if (ancestors.has(value)) {
    fail(code, `${path} must not contain a circular reference`, { path });
  }
  ancestors.add(value);
  let clone;
  if (Array.isArray(value)) {
    clone = value.map((item, index) => cloneProviderEvidence(
      item,
      `${path}[${index}]`,
      code,
      ancestors,
    ));
  } else {
    clone = {};
    for (let [key, child] of Object.entries(value)) {
      Object.defineProperty(clone, key, {
        value: cloneProviderEvidence(child, `${path}.${key}`, code, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  ancestors.delete(value);
  return deepFreeze(clone);
}

function structuredReason(code, message, details = {}) {
  return deepFreeze({
    code: exactText(code, 'reason.code', 'PRESENTATION_EFFECT_RECEIPT_INVALID'),
    message: exactText(message, 'reason.message', 'PRESENTATION_EFFECT_RECEIPT_INVALID'),
    details: cloneProviderEvidence(
      details,
      'reason.details',
      'PRESENTATION_EFFECT_RECEIPT_INVALID',
    ),
  });
}

function terminalReasonFromError(error) {
  if (error instanceof PresentationExecutionError) {
    return structuredReason(error.code, error.message, error.details);
  }
  let message = typeof error?.message === 'string' && error.message
    ? error.message
    : String(error || 'presentation effect operation failed');
  let details = typeof error?.code === 'string' && error.code
    ? { causeCode: error.code }
    : {};
  return structuredReason('PRESENTATION_EFFECT_OPERATION_FAILED', message, details);
}

function cancellationReason(status, cause) {
  let code = status === 'stale'
    ? 'PRESENTATION_EFFECT_OPERATION_STALE'
    : 'PRESENTATION_EFFECT_OPERATION_CANCELLED';
  let message = status === 'stale'
    ? 'presentation effect operation belongs to a superseded generation'
    : 'presentation effect operation was cancelled';
  return structuredReason(code, message, { cause: String(cause || status) });
}

function validatePerformanceObservation(value, path, code) {
  if (!isObject(value)) {
    fail(code, `${path} must be a performance observation object`, { path });
  }
  knownKeys(value, OBSERVATION_KEYS, path, code);
  if (value.domain !== 'performance') {
    fail(code, `${path}.domain must be "performance"`, {
      path: `${path}.domain`,
      domain: value.domain,
    });
  }
  let timeOriginMs = finiteNonnegative(value.timeOriginMs, `${path}.timeOriginMs`, code);
  let monotonicTimeMs = finiteNonnegative(
    value.monotonicTimeMs,
    `${path}.monotonicTimeMs`,
    code,
  );
  let normalizedMonotonicTimeMs = (
    monotonicTimeMs + (timeOriginMs - performance.timeOrigin)
  );
  if (!Number.isFinite(normalizedMonotonicTimeMs) || normalizedMonotonicTimeMs < 0) {
    fail(
      code,
      `${path} resolves outside the Workspace performance timeline`,
      {
        path,
        timeOriginMs,
        monotonicTimeMs,
        workspaceTimeOriginMs: performance.timeOrigin,
        normalizedMonotonicTimeMs,
      },
    );
  }
  return deepFreeze({
    domain: 'performance',
    timeOriginMs: performance.timeOrigin,
    monotonicTimeMs: normalizedMonotonicTimeMs,
  });
}

function abortError(reason) {
  if (reason instanceof Error) return reason;
  let error = new Error(String(reason || 'presentation operation cancelled'));
  error.name = 'AbortError';
  return error;
}

function awaitWithAbort(value, signal) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let onAbort = () => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', onAbort);
      reject(abortError(signal.reason));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(value).then(
      (result) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

function createAdapterCompletion() {
  let resolve;
  let reject;
  let promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

function operationRequiresAdmission(kind, projectCell) {
  if (kind === 'attention') return true;
  return kind === 'interaction' && projectCell.cue.interaction?.type === 'select';
}

function operationBudgetMs(kind, scheduleCell, projectCell) {
  if (kind === 'state') return projectCell.cue.state.timeoutMs;
  return scheduleCell.gesture.endMs - scheduleCell.gesture.startMs;
}

function deadlineError(operation) {
  return new PresentationExecutionError(
    'PRESENTATION_EFFECT_DEADLINE_MISSED',
    'presentation effect operation missed its authored hard deadline',
    {
      budgetMs: operation.budgetMs,
      activatedAtMonotonicTimeMs: operation.activatedAtMonotonicTimeMs,
      deadlineMonotonicTimeMs: operation.deadlineMonotonicTimeMs,
      admissionRequired: operation.requiresAdmission,
      providerAdmission: operation.admission?.providerAdmission ?? null,
      reportedStatuses: operation.reportedReceipts.map((item) => item.status),
    },
  );
}

function cellExpiry(cell) {
  if (cell.visibility) return cell.visibility.endMs;
  if (cell.gesture) return cell.gesture.endMs;
  return Number.POSITIVE_INFINITY;
}

function createReceipt({
  operationId,
  generation: valueGeneration,
  authoringProjectHash,
  scheduleHash,
  cellId,
  kind,
  status,
  observedAt,
  providerReceipt,
  reason,
}) {
  let value = {
    version: PRESENTATION_EFFECT_RECEIPT_VERSION,
    operationId,
    generation: valueGeneration,
    authoringProjectHash,
    scheduleHash,
    cellId,
    kind,
    status,
    ...(observedAt === undefined ? {} : { observedAt }),
    ...(providerReceipt === undefined ? {} : { providerReceipt }),
    ...(reason === undefined ? {} : { reason }),
  };
  return validatePresentationEffectReceipt(value, {
    operationId,
    generation: valueGeneration,
    authoringProjectHash,
    scheduleHash,
    cellId,
    kind,
  });
}

function validateExpectedAdmissionContext(expected = {}) {
  let code = 'PRESENTATION_EFFECT_ADMISSION_INVALID';
  if (!isObject(expected)) {
    fail(code, 'expected presentation effect admission context must be an object');
  }
  knownKeys(
    expected,
    [
      'operationId',
      'generation',
      'authoringProjectHash',
      'scheduleHash',
      'cellId',
      'kind',
      'targetId',
      'budgetMs',
    ],
    'expected',
    code,
  );
  let context = {
    operationId: exactText(expected.operationId, 'expected.operationId', code),
    generation: generation(expected.generation, 'expected.generation', code),
    authoringProjectHash: exactText(
      expected.authoringProjectHash,
      'expected.authoringProjectHash',
      code,
    ),
    scheduleHash: exactText(expected.scheduleHash, 'expected.scheduleHash', code),
    cellId: exactText(expected.cellId, 'expected.cellId', code),
    kind: exactText(expected.kind, 'expected.kind', code),
    targetId: exactText(expected.targetId, 'expected.targetId', code),
    budgetMs: finiteNonnegative(expected.budgetMs, 'expected.budgetMs', code),
  };
  if (!ADMISSION_EFFECT_KINDS.has(context.kind)) {
    fail(
      code,
      'expected.kind must be interaction or attention for effect admission',
      { kind: context.kind },
    );
  }
  if (context.budgetMs <= 0) {
    fail(code, 'expected.budgetMs must be positive', { budgetMs: context.budgetMs });
  }
  return context;
}

/**
 * @param {object} admission
 * @param {object} expected
 * @returns {object}
 */
export function validatePresentationEffectAdmission(admission = {}, expected = {}) {
  let code = 'PRESENTATION_EFFECT_ADMISSION_INVALID';
  let context = validateExpectedAdmissionContext(expected);
  if (!isObject(admission)) {
    fail(code, 'presentation effect admission must be an object');
  }
  knownKeys(admission, ADMISSION_KEYS, 'admission', code);
  if (admission.version !== PRESENTATION_EFFECT_ADMISSION_VERSION) {
    fail(
      code,
      `unsupported presentation effect admission version: ${admission.version}`,
      { version: admission.version },
    );
  }
  let normalized = deepFreeze({
    version: admission.version,
    operationId: exactText(admission.operationId, 'admission.operationId', code),
    generation: generation(admission.generation, 'admission.generation', code),
    authoringProjectHash: exactText(
      admission.authoringProjectHash,
      'admission.authoringProjectHash',
      code,
    ),
    scheduleHash: exactText(admission.scheduleHash, 'admission.scheduleHash', code),
    cellId: exactText(admission.cellId, 'admission.cellId', code),
    kind: exactText(admission.kind, 'admission.kind', code),
    targetId: exactText(admission.targetId, 'admission.targetId', code),
    budgetMs: finiteNonnegative(admission.budgetMs, 'admission.budgetMs', code),
    providerAdmission: cloneProviderEvidence(
      admission.providerAdmission,
      'admission.providerAdmission',
      code,
    ),
  });
  let receivedContext = {
    operationId: normalized.operationId,
    generation: normalized.generation,
    authoringProjectHash: normalized.authoringProjectHash,
    scheduleHash: normalized.scheduleHash,
    cellId: normalized.cellId,
    kind: normalized.kind,
    targetId: normalized.targetId,
    budgetMs: normalized.budgetMs,
  };
  if (canonicalize(receivedContext) !== canonicalize(context)) {
    fail(
      'PRESENTATION_EFFECT_ADMISSION_CONTEXT_MISMATCH',
      'presentation effect admission does not match its active operation context',
      { expected: context, received: receivedContext },
    );
  }
  validateProviderAdmission(normalized.providerAdmission, context);
  return normalized;
}

function exactText(value, path, code, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    fail(code, `${path} must be nonempty text${nullable ? ' or null' : ''}`, {
      path,
      value,
    });
  }
  return value;
}

function exactNullableObject(value, path, code) {
  if (value === null) return null;
  if (!isObject(value)) fail(code, `${path} must be an object or null`, { path });
  return value;
}

function validateProviderAdmission(providerAdmission, context) {
  let code = 'PRESENTATION_EFFECT_ADMISSION_INVALID';
  if (!isObject(providerAdmission)) {
    fail(code, 'admission.providerAdmission must be an object');
  }
  knownKeys(
    providerAdmission,
    ['version', 'status', 'provider', 'effect', 'target', 'budget', 'plan', 'reason'],
    'admission.providerAdmission',
    code,
  );
  if (providerAdmission.version !== 'show-attention-admission-v2') {
    fail(
      code,
      `unsupported provider admission version: ${providerAdmission.version}`,
      { version: providerAdmission.version },
    );
  }
  if (!['admitted', 'rejected'].includes(providerAdmission.status)) {
    fail(code, 'admission.providerAdmission.status must be admitted or rejected', {
      status: providerAdmission.status,
    });
  }

  let provider = providerAdmission.provider;
  if (!isObject(provider)) fail(code, 'admission.providerAdmission.provider must be an object');
  knownKeys(provider, ['id', 'version'], 'admission.providerAdmission.provider', code);
  if (provider.id !== 'symbiote-ui/show-attention') {
    fail(
      code,
      'admission.providerAdmission.provider.id must identify symbiote-ui/show-attention',
      { providerId: provider.id },
    );
  }
  if (provider.version !== 'show-attention-provider-v1') {
    fail(
      code,
      'admission.providerAdmission.provider.version must be show-attention-provider-v1',
      { providerVersion: provider.version },
    );
  }

  let effect = providerAdmission.effect;
  if (!isObject(effect)) fail(code, 'admission.providerAdmission.effect must be an object');
  knownKeys(effect, ['mode', 'gestureId'], 'admission.providerAdmission.effect', code);
  exactText(effect.mode, 'admission.providerAdmission.effect.mode', code);
  if (typeof effect.gestureId !== 'string') {
    fail(code, 'admission.providerAdmission.effect.gestureId must be text');
  }

  let target = providerAdmission.target;
  if (!isObject(target)) fail(code, 'admission.providerAdmission.target must be an object');
  knownKeys(
    target,
    ['id', 'identity', 'layoutIdentity', 'geometryIdentity', 'geometry'],
    'admission.providerAdmission.target',
    code,
  );
  let providerTargetId = exactText(
    target.id,
    'admission.providerAdmission.target.id',
    code,
    true,
  );
  if (providerTargetId !== context.targetId) {
    fail(
      'PRESENTATION_EFFECT_ADMISSION_CONTEXT_MISMATCH',
      'provider admission target does not match its active operation context',
      { expectedTargetId: context.targetId, receivedTargetId: providerTargetId },
    );
  }
  exactNullableObject(target.geometry, 'admission.providerAdmission.target.geometry', code);

  let budget = providerAdmission.budget;
  if (!isObject(budget)) fail(code, 'admission.providerAdmission.budget must be an object');
  knownKeys(
    budget,
    ['limitMs', 'plannedDurationMs'],
    'admission.providerAdmission.budget',
    code,
  );
  let limitMs = finiteNonnegative(
    budget.limitMs,
    'admission.providerAdmission.budget.limitMs',
    code,
  );
  if (limitMs !== context.budgetMs) {
    fail(
      'PRESENTATION_EFFECT_ADMISSION_CONTEXT_MISMATCH',
      'provider admission budget does not match its active operation context',
      { expectedBudgetMs: context.budgetMs, receivedBudgetMs: limitMs },
    );
  }
  let plannedDurationMs = budget.plannedDurationMs === null
    ? null
    : finiteNonnegative(
        budget.plannedDurationMs,
        'admission.providerAdmission.budget.plannedDurationMs',
        code,
      );

  let plan = providerAdmission.plan;
  if (!isObject(plan)) fail(code, 'admission.providerAdmission.plan must be an object');
  knownKeys(
    plan,
    ['version', 'identity', 'normalizedPathHash', 'motion', 'evidence'],
    'admission.providerAdmission.plan',
    code,
  );
  exactNullableObject(plan.motion, 'admission.providerAdmission.plan.motion', code);
  exactNullableObject(plan.evidence, 'admission.providerAdmission.plan.evidence', code);

  let reason = providerAdmission.reason;
  if (!isObject(reason)) fail(code, 'admission.providerAdmission.reason must be an object');
  knownKeys(reason, ['code', 'message', 'provider'], 'admission.providerAdmission.reason', code);
  exactText(reason.code, 'admission.providerAdmission.reason.code', code);
  exactText(reason.message, 'admission.providerAdmission.reason.message', code);
  let providerReason = exactNullableObject(
    reason.provider,
    'admission.providerAdmission.reason.provider',
    code,
  );
  if (providerReason) {
    exactText(providerReason.code, 'admission.providerAdmission.reason.provider.code', code);
  }
  if (reason.code === 'provider-rejected' && !providerReason) {
    fail(
      code,
      'provider-rejected admission requires reason.provider evidence',
      { reasonCode: reason.code },
    );
  }
  if (reason.code === 'budget-exceeded' && providerReason !== null) {
    fail(
      code,
      'budget-exceeded admission requires reason.provider to be null',
      { reasonCode: reason.code },
    );
  }

  if (providerAdmission.status === 'admitted') {
    if (reason.code !== 'within-budget') {
      fail(code, 'admitted provider admission requires reason.code "within-budget"');
    }
    exactText(target.identity, 'admission.providerAdmission.target.identity', code);
    exactText(target.layoutIdentity, 'admission.providerAdmission.target.layoutIdentity', code);
    exactText(target.geometryIdentity, 'admission.providerAdmission.target.geometryIdentity', code);
    exactText(plan.version, 'admission.providerAdmission.plan.version', code);
    exactText(plan.identity, 'admission.providerAdmission.plan.identity', code);
    if (effect.mode === 'click') {
      if (typeof plan.normalizedPathHash !== 'string') {
        fail(code, 'click admission plan.normalizedPathHash must be text');
      }
    } else {
      exactText(
        plan.normalizedPathHash,
        'admission.providerAdmission.plan.normalizedPathHash',
        code,
      );
    }
    if (plannedDurationMs === null) {
      fail(code, 'admitted provider admission requires a planned duration');
    }
    if (plannedDurationMs > context.budgetMs) {
      fail(
        'PRESENTATION_EFFECT_ADMISSION_OVER_BUDGET',
        'presentation effect planned duration exceeds its authored hard budget',
        {
          budgetMs: context.budgetMs,
          plannedDurationMs,
          providerAdmission,
        },
      );
    }
    if (reason.provider !== null) {
      fail(code, 'admitted provider admission requires reason.provider to be null');
    }
    return;
  }

  if (reason.code === 'within-budget') {
    fail(code, 'rejected provider admission cannot use reason.code "within-budget"');
  }
  if (
    reason.code === 'budget-exceeded'
    && (plannedDurationMs === null || plannedDurationMs <= context.budgetMs)
  ) {
    fail(
      code,
      'budget-exceeded admission requires a planned duration above the hard budget',
      { budgetMs: context.budgetMs, plannedDurationMs },
    );
  }
  if (plannedDurationMs !== null && plannedDurationMs > context.budgetMs) {
    if (reason.code !== 'budget-exceeded') {
      fail(code, 'an over-budget rejected plan requires reason.code "budget-exceeded"');
    }
  }

  for (let [path, value] of [
    ['target.identity', target.identity],
    ['target.layoutIdentity', target.layoutIdentity],
    ['target.geometryIdentity', target.geometryIdentity],
    ['plan.version', plan.version],
    ['plan.identity', plan.identity],
    ['plan.normalizedPathHash', plan.normalizedPathHash],
  ]) {
    if (value !== null && (typeof value !== 'string' || !value.trim())) {
      fail(
        code,
        `admission.providerAdmission.${path} must be nonempty text or null`,
        { path: `admission.providerAdmission.${path}`, value },
      );
    }
  }
}

function validateExpectedReceiptContext(expected = {}) {
  let code = 'PRESENTATION_EFFECT_RECEIPT_INVALID';
  if (!isObject(expected)) {
    fail(
      code,
      'expected presentation effect receipt context must be an object',
    );
  }
  knownKeys(
    expected,
    [
      'operationId',
      'generation',
      'authoringProjectHash',
      'scheduleHash',
      'cellId',
      'kind',
    ],
    'expected',
    code,
  );
  let context = {
    operationId: exactText(expected.operationId, 'expected.operationId', code),
    generation: generation(expected.generation, 'expected.generation', code),
    authoringProjectHash: exactText(
      expected.authoringProjectHash,
      'expected.authoringProjectHash',
      code,
    ),
    scheduleHash: exactText(expected.scheduleHash, 'expected.scheduleHash', code),
    cellId: exactText(expected.cellId, 'expected.cellId', code),
    kind: exactText(expected.kind, 'expected.kind', code),
  };
  if (!EFFECT_KINDS.includes(context.kind)) {
    fail(
      code,
      `expected.kind must be one of ${EFFECT_KINDS.join(', ')}`,
      { kind: context.kind },
    );
  }
  return context;
}

function validateTerminalReason(value) {
  let code = 'PRESENTATION_EFFECT_RECEIPT_INVALID';
  if (!isObject(value)) {
    fail(code, 'receipt.reason must be a structured reason object');
  }
  knownKeys(value, ['code', 'message', 'details'], 'receipt.reason', code);
  if (!isObject(value.details)) {
    fail(code, 'receipt.reason.details must be an object');
  }
  return deepFreeze({
    code: exactText(value.code, 'receipt.reason.code', code),
    message: exactText(value.message, 'receipt.reason.message', code),
    details: cloneProviderEvidence(value.details, 'receipt.reason.details', code),
  });
}

/**
 * @param {object} receipt
 * @param {object} expected
 * @returns {object}
 */
export function validatePresentationEffectReceipt(receipt = {}, expected = {}) {
  let code = 'PRESENTATION_EFFECT_RECEIPT_INVALID';
  let context = validateExpectedReceiptContext(expected);
  if (!isObject(receipt)) {
    fail(code, 'presentation effect receipt must be an object');
  }
  knownKeys(receipt, RECEIPT_KEYS, 'receipt', code);
  if (receipt.version !== PRESENTATION_EFFECT_RECEIPT_VERSION) {
    fail(
      code,
      `unsupported presentation effect receipt version: ${receipt.version}`,
      { version: receipt.version },
    );
  }
  let normalized = {
    version: receipt.version,
    operationId: exactText(receipt.operationId, 'receipt.operationId', code),
    generation: generation(receipt.generation, 'receipt.generation', code),
    authoringProjectHash: exactText(
      receipt.authoringProjectHash,
      'receipt.authoringProjectHash',
      code,
    ),
    scheduleHash: exactText(receipt.scheduleHash, 'receipt.scheduleHash', code),
    cellId: exactText(receipt.cellId, 'receipt.cellId', code),
    kind: exactText(receipt.kind, 'receipt.kind', code),
    status: exactText(receipt.status, 'receipt.status', code),
  };
  if (!EFFECT_KINDS.includes(normalized.kind)) {
    fail(
      code,
      `receipt.kind must be one of ${EFFECT_KINDS.join(', ')}`,
      { kind: normalized.kind },
    );
  }
  if (!EFFECT_STATUSES.includes(normalized.status)) {
    fail(
      code,
      `receipt.status must be one of ${EFFECT_STATUSES.join(', ')}`,
      { status: normalized.status },
    );
  }
  if (!RECEIPT_STATUSES_BY_KIND[normalized.kind].has(normalized.status)) {
    fail(
      code,
      `receipt status "${normalized.status}" is unavailable for ${normalized.kind} effects`,
      { kind: normalized.kind, status: normalized.status },
    );
  }
  let receivedContext = {
    operationId: normalized.operationId,
    generation: normalized.generation,
    authoringProjectHash: normalized.authoringProjectHash,
    scheduleHash: normalized.scheduleHash,
    cellId: normalized.cellId,
    kind: normalized.kind,
  };
  if (canonicalize(receivedContext) !== canonicalize(context)) {
    fail(
      'PRESENTATION_EFFECT_RECEIPT_CONTEXT_MISMATCH',
      'presentation effect receipt does not match its active operation context',
      {
        expected: context,
        received: receivedContext,
      },
    );
  }
  if (MILESTONE_STATUSES.has(normalized.status)) {
    normalized.observedAt = validatePerformanceObservation(
      receipt.observedAt,
      'receipt.observedAt',
      code,
    );
    if (!isObject(receipt.providerReceipt)) {
      fail(code, 'receipt.providerReceipt must be an object for an actual milestone');
    }
    normalized.providerReceipt = cloneProviderEvidence(
      receipt.providerReceipt,
      'receipt.providerReceipt',
      code,
    );
    if (receipt.reason !== undefined) {
      fail(
        code,
        `receipt.reason is not allowed for actual status "${normalized.status}"`,
        { status: normalized.status },
      );
    }
  } else if (TERMINAL_REASON_STATUSES.has(normalized.status)) {
    if (receipt.observedAt !== undefined) {
      normalized.observedAt = validatePerformanceObservation(
        receipt.observedAt,
        'receipt.observedAt',
        code,
      );
    }
    if (receipt.providerReceipt !== undefined) {
      if (!isObject(receipt.providerReceipt)) {
        fail(code, 'receipt.providerReceipt must be an object when provided');
      }
      normalized.providerReceipt = cloneProviderEvidence(
        receipt.providerReceipt,
        'receipt.providerReceipt',
        code,
      );
    }
    normalized.reason = validateTerminalReason(receipt.reason);
  } else if (receipt.reason !== undefined) {
    fail(
      code,
      `receipt.reason is unavailable for status "${normalized.status}"`,
      { status: normalized.status },
    );
  }
  if (
    !MILESTONE_STATUSES.has(normalized.status)
    && !TERMINAL_REASON_STATUSES.has(normalized.status)
    && (receipt.observedAt !== undefined || receipt.providerReceipt !== undefined)
  ) {
    fail(
      code,
      `provider evidence is unavailable for status "${normalized.status}"`,
      { status: normalized.status },
    );
  }
  return deepFreeze(normalized);
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
        authoringProjectHash: this.#project.hash,
        scheduleHash: this.#schedule.hash,
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
        authoringProjectHash: this.#project.hash,
        scheduleHash: this.#schedule.hash,
        cellId: cell.cellId,
        kind,
        status: 'skipped',
        reason: structuredReason(
          'PRESENTATION_EFFECT_EXPIRED',
          'presentation effect cell expired before activation',
          { cause: 'expired', expiryMs, mediaTimeMs: mediaTimeMsValue },
        ),
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
    let projectCell = this.#projectCellById.get(scheduleCell.cellId);
    let budgetMs = operationBudgetMs(kind, scheduleCell, projectCell);
    let activatedAtMonotonicTimeMs = performance.now();
    let operation = {
      operationId,
      generation: this.#generation,
      kind,
      scheduleCell,
      projectCell,
      controller,
      requiresAdmission: operationRequiresAdmission(kind, projectCell),
      admission: null,
      budgetMs,
      activatedAtMonotonicTimeMs,
      deadlineMonotonicTimeMs: activatedAtMonotonicTimeMs + budgetMs,
      deadlineSignal: null,
      onDeadline: null,
      reportedReceipts: [],
    };
    operation.deadlineSignal = AbortSignal.timeout(budgetMs);
    operation.onDeadline = () => {
      if (!controller.signal.aborted) controller.abort(deadlineError(operation));
    };
    operation.deadlineSignal.addEventListener('abort', operation.onDeadline, { once: true });
    let adapterCompletion = createAdapterCompletion();
    operation.done = this.#execute(operation, adapterCompletion.promise);
    this.#active = operation;
    this.#maxInFlight = Math.max(this.#maxInFlight, 1);
    let input = Object.freeze({
      operationId,
      generation: operation.generation,
      scheduleCell,
      projectCell: operation.projectCell,
      signal: controller.signal,
      reportAdmission: (admission) => this.#reportAdmission(operation, admission),
      reportReceipt: (receipt) => this.#reportReceipt(operation, receipt),
    });
    try {
      adapterCompletion.resolve(method(input));
    } catch (error) {
      adapterCompletion.reject(error);
    }
  }

  async #execute(operation, result) {
    try {
      let completionValue = await awaitWithAbort(result, operation.controller.signal);
      if (!this.#operationIsCurrent(operation)) {
        this.#emitTerminal(
          operation,
          'stale',
          cancellationReason('stale', 'superseded-generation'),
        );
        return;
      }
      if (completionValue !== undefined && completionValue !== null) {
        fail(
          'PRESENTATION_EFFECT_RECEIPT_INVALID',
          `${operation.kind} adapter completion must not contain provider receipt evidence`,
          {
            kind: operation.kind,
            completionType: Array.isArray(completionValue)
              ? 'array'
              : typeof completionValue,
          },
        );
      }
      if (operation.requiresAdmission && !operation.admission) {
        fail(
          'PRESENTATION_EFFECT_ADMISSION_MISSING',
          `${operation.kind} adapter completed without an admitted effect plan`,
          { kind: operation.kind },
        );
      }
      let expectedStatuses = ACTUAL_RECEIPT_SEQUENCE[operation.kind];
      if (operation.reportedReceipts.length !== expectedStatuses.length) {
        fail(
          'PRESENTATION_EFFECT_RECEIPT_SEQUENCE_INVALID',
          `${operation.kind} adapter must report ${expectedStatuses.join(' then ')}`,
          {
            expectedStatuses,
            receivedStatuses: operation.reportedReceipts.map((item) => item.status),
          },
        );
      }
      this.#terminal.set(operation.scheduleCell.cellId, 'completed');
    } catch (error) {
      if (operation.controller.signal.aborted) {
        let abortReason = operation.controller.signal.reason;
        if (abortReason instanceof PresentationExecutionError) {
          this.#terminal.set(operation.scheduleCell.cellId, 'failed');
          this.#emitTerminal(operation, 'failed', terminalReasonFromError(abortReason));
        } else {
          let status = operation.generation === this.#generation ? 'cancelled' : 'stale';
          let reason = abortReason?.message || abortReason || 'cancelled';
          this.#emitTerminal(operation, status, cancellationReason(status, reason));
        }
      } else if (!this.#operationIsCurrent(operation)) {
        this.#emitTerminal(
          operation,
          'stale',
          cancellationReason('stale', 'superseded-generation'),
        );
      } else {
        this.#terminal.set(operation.scheduleCell.cellId, 'failed');
        this.#emitTerminal(operation, 'failed', terminalReasonFromError(error));
      }
    } finally {
      operation.deadlineSignal.removeEventListener('abort', operation.onDeadline);
      if (this.#active === operation) this.#active = null;
    }
  }

  #admissionContext(operation) {
    return {
      operationId: operation.operationId,
      generation: operation.generation,
      authoringProjectHash: this.#project.hash,
      scheduleHash: this.#schedule.hash,
      cellId: operation.scheduleCell.cellId,
      kind: operation.kind,
      targetId: operation.scheduleCell.targetId,
      budgetMs: operation.budgetMs,
    };
  }

  #reportAdmission(operation, value) {
    try {
      if (!this.#operationIsCurrent(operation) || operation.controller.signal.aborted) {
        fail(
          'PRESENTATION_EFFECT_ADMISSION_STALE',
          'presentation effect admission belongs to an inactive operation',
          { operationId: operation.operationId, generation: operation.generation },
        );
      }
      if (!operation.requiresAdmission) {
        fail(
          'PRESENTATION_EFFECT_ADMISSION_INVALID',
          `${operation.kind} operation does not have a provider-planned admission contract`,
          { kind: operation.kind, cellId: operation.scheduleCell.cellId },
        );
      }
      if (operation.admission) {
        fail(
          'PRESENTATION_EFFECT_ADMISSION_DUPLICATE',
          'presentation effect admission was already reported for this operation',
          { operationId: operation.operationId },
        );
      }
      if (!isObject(value)) {
        fail(
          'PRESENTATION_EFFECT_ADMISSION_INVALID',
          'reported presentation effect admission must be an object',
        );
      }
      knownKeys(
        value,
        ADMISSION_INPUT_KEYS,
        'admission',
        'PRESENTATION_EFFECT_ADMISSION_INVALID',
      );
      let context = this.#admissionContext(operation);
      let admission = validatePresentationEffectAdmission({
        version: PRESENTATION_EFFECT_ADMISSION_VERSION,
        operationId: context.operationId,
        generation: context.generation,
        authoringProjectHash: context.authoringProjectHash,
        scheduleHash: context.scheduleHash,
        cellId: context.cellId,
        kind: context.kind,
        targetId: context.targetId,
        budgetMs: context.budgetMs,
        ...value,
      }, context);
      operation.admission = admission;
      if (admission.providerAdmission.status === 'rejected') {
        fail(
          'PRESENTATION_EFFECT_ADMISSION_REJECTED',
          `presentation effect provider rejected admission: ${admission.providerAdmission.reason.code}`,
          { providerAdmission: admission.providerAdmission },
        );
      }
      return admission;
    } catch (error) {
      throw this.#rejectOperation(operation, error);
    }
  }

  #reportReceipt(operation, value) {
    try {
      if (!this.#operationIsCurrent(operation) || operation.controller.signal.aborted) {
        fail(
          'PRESENTATION_EFFECT_RECEIPT_STALE',
          'presentation effect receipt belongs to an inactive operation',
          { operationId: operation.operationId, generation: operation.generation },
        );
      }
      if (!isObject(value)) {
        fail(
          'PRESENTATION_EFFECT_RECEIPT_INVALID',
          'reported presentation effect receipt must be an object',
        );
      }
      knownKeys(
        value,
        RECEIPT_INPUT_KEYS,
        'receipt',
        'PRESENTATION_EFFECT_RECEIPT_INVALID',
      );
      if (typeof value.status !== 'string' || !value.status.trim()) {
        fail(
          'PRESENTATION_EFFECT_RECEIPT_INVALID',
          'receipt.status must be nonempty text',
          { status: value.status },
        );
      }
      if (
        operation.requiresAdmission
        && operation.admission?.providerAdmission.status !== 'admitted'
      ) {
        fail(
          'PRESENTATION_EFFECT_ADMISSION_MISSING',
          'presentation effect admission must be reported before provider evidence',
          { operationId: operation.operationId },
        );
      }
      if (value.status === 'failed') {
        let observedAt = validatePerformanceObservation(
          value.observedAt,
          'receipt.observedAt',
          'PRESENTATION_EFFECT_RECEIPT_INVALID',
        );
        if (!isObject(value.providerReceipt)) {
          fail(
            'PRESENTATION_EFFECT_RECEIPT_INVALID',
            'receipt.providerReceipt must be an object for a provider failure',
          );
        }
        let providerReceipt = cloneProviderEvidence(
          value.providerReceipt,
          'receipt.providerReceipt',
          'PRESENTATION_EFFECT_RECEIPT_INVALID',
        );
        let monotonicTimeMs = observedAt.monotonicTimeMs;
        if (
          monotonicTimeMs < operation.activatedAtMonotonicTimeMs
          || monotonicTimeMs > operation.deadlineMonotonicTimeMs
        ) {
          fail(
            'PRESENTATION_EFFECT_DEADLINE_MISSED',
            'provider failure falls outside its activation-time hard budget',
            {
              activatedAtMonotonicTimeMs: operation.activatedAtMonotonicTimeMs,
              deadlineMonotonicTimeMs: operation.deadlineMonotonicTimeMs,
              observedAt,
              providerReceipt,
            },
          );
        }
        fail(
          'PRESENTATION_EFFECT_PROVIDER_FAILED',
          'presentation effect provider reported a terminal failure',
          { observedAt, providerReceipt },
        );
      }
      let index = operation.reportedReceipts.length;
      let expectedStatuses = ACTUAL_RECEIPT_SEQUENCE[operation.kind];
      let expectedStatus = expectedStatuses[index];
      if (value.status !== expectedStatus) {
        fail(
          'PRESENTATION_EFFECT_RECEIPT_SEQUENCE_INVALID',
          `${operation.kind} receipt ${index} must have status "${expectedStatus}"`,
          { expectedStatus, receivedStatus: value.status, index },
        );
      }
      let validated = createReceipt({
        operationId: operation.operationId,
        generation: operation.generation,
        authoringProjectHash: this.#project.hash,
        scheduleHash: this.#schedule.hash,
        cellId: operation.scheduleCell.cellId,
        kind: operation.kind,
        status: value.status,
        observedAt: value.observedAt,
        providerReceipt: value.providerReceipt,
      });
      let previous = operation.reportedReceipts.at(-1);
      let monotonicTimeMs = validated.observedAt.monotonicTimeMs;
      if (previous && monotonicTimeMs < previous.observedAt.monotonicTimeMs) {
        fail(
          'PRESENTATION_EFFECT_RECEIPT_TIME_INVALID',
          'presentation effect receipt monotonic time moved backward',
          {
            previousMonotonicTimeMs: previous.observedAt.monotonicTimeMs,
            monotonicTimeMs,
            providerReceipt: validated.providerReceipt,
          },
        );
      }
      if (
        monotonicTimeMs < operation.activatedAtMonotonicTimeMs
        || monotonicTimeMs > operation.deadlineMonotonicTimeMs
      ) {
        fail(
          'PRESENTATION_EFFECT_DEADLINE_MISSED',
          'presentation effect milestone falls outside its activation-time hard budget',
          {
            activatedAtMonotonicTimeMs: operation.activatedAtMonotonicTimeMs,
            deadlineMonotonicTimeMs: operation.deadlineMonotonicTimeMs,
            monotonicTimeMs,
            providerReceipt: validated.providerReceipt,
          },
        );
      }
      operation.reportedReceipts.push(validated);
      this.#openBarrier(operation.scheduleCell.cellId, validated.status);
      this.#emit(validated);
      return validated;
    } catch (error) {
      throw this.#rejectOperation(operation, error);
    }
  }

  #rejectOperation(operation, error) {
    let failure = error instanceof PresentationExecutionError
      ? error
      : new PresentationExecutionError(
          'PRESENTATION_EFFECT_OPERATION_FAILED',
          error?.message || String(error),
        );
    if (this.#operationIsCurrent(operation) && !operation.controller.signal.aborted) {
      operation.controller.abort(failure);
    }
    return failure;
  }

  #operationIsCurrent(operation) {
    return this.#active === operation && operation.generation === this.#generation;
  }

  #emitTerminal(operation, status, reason) {
    let observedAt = reason?.details?.observedAt;
    let providerReceipt = reason?.details?.providerReceipt;
    this.#emit(createReceipt({
      operationId: operation.operationId,
      generation: operation.generation,
      authoringProjectHash: this.#project.hash,
      scheduleHash: this.#schedule.hash,
      cellId: operation.scheduleCell.cellId,
      kind: operation.kind,
      status,
      ...(observedAt === undefined ? {} : { observedAt }),
      ...(providerReceipt === undefined ? {} : { providerReceipt }),
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
