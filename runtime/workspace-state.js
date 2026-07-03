import { computeIntegrity } from '../schema/canonical-json.js';
import {
  escapePointerSegment,
  pathToPointer,
  pointerToPath,
  splitJsonPointer,
} from '../schema/config-path.js';
import { normalizeForComparison } from '../sharing/workspace-package.js';

export const REBASED_OVER_CONCURRENT_EDIT = 'rebased-over-concurrent-edit';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const deepClone = (value) => {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const principalKey = (principal) => {
  if (!isObject(principal)) return '';
  return `${principal.kind || ''}:${principal.id || ''}`;
};

const samePrincipal = (a, b) => principalKey(a) !== '' && principalKey(a) === principalKey(b);

export function createConfigFingerprint(config) {
  return computeIntegrity(normalizeForComparison(config));
}

function assertPrincipal(principal) {
  if (!isObject(principal) || typeof principal.kind !== 'string' || !principal.kind.trim()) {
    throw new Error('WorkspaceState commit requires principal.kind.');
  }
  if (typeof principal.id !== 'string' || !principal.id.trim()) {
    throw new Error('WorkspaceState commit requires principal.id.');
  }
}

function actorFromOptions(options, fallbackReason) {
  assertPrincipal(options.principal);
  if (typeof options.actor !== 'string' || !options.actor.trim()) {
    throw new Error('WorkspaceState commit requires actor.');
  }
  return {
    principal: deepClone(options.principal),
    actor: options.actor,
    reason: typeof options.reason === 'string' && options.reason.trim()
      ? options.reason
      : fallbackReason,
    confirmId: typeof options.confirmId === 'string' && options.confirmId.trim()
      ? options.confirmId
      : undefined,
  };
}

function assertBaseRevision(baseRevision) {
  if (!Number.isInteger(baseRevision)) {
    let err = new Error('WorkspaceState commit requires baseRevision.');
    err.code = 'workspace_base_revision_required';
    throw err;
  }
}

function normalizePointer(path) {
  return pathToPointer(path);
}

function pointerSegments(pointer) {
  return splitJsonPointer(pointer);
}

function valueAtPointer(root, pointer) {
  if (pointer === '/') return root;
  let current = root;
  for (let segment of pointerSegments(pointer)) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) {
        throw new Error(`Invalid array index in patch path "${pointer}".`);
      }
      let index = Number(segment);
      if (index < 0 || index >= current.length) {
        throw new Error(`Patch path "${pointer}" does not exist.`);
      }
      current = current[index];
      continue;
    }
    if (!isObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new Error(`Patch path "${pointer}" does not exist.`);
    }
    current = current[segment];
  }
  return current;
}

function pathExists(root, pointer) {
  try {
    valueAtPointer(root, pointer);
    return true;
  } catch {
    return false;
  }
}

function parentAtPointer(root, pointer) {
  let segments = pointerSegments(pointer);
  if (segments.length === 0) return { parent: null, key: null };
  let key = segments[segments.length - 1];
  let parentPointer = segments.length === 1
    ? '/'
    : `/${segments.slice(0, -1).map(escapePointerSegment).join('/')}`;
  return { parent: valueAtPointer(root, parentPointer), key };
}

function normalizeArrayIndex(parent, key, pointer, { allowEnd = false, allowAppend = false } = {}) {
  if (key === '-' && allowAppend) return parent.length;
  if (!/^\d+$/.test(key)) {
    throw new Error(`Invalid array index in patch path "${pointer}".`);
  }
  let index = Number(key);
  let max = allowEnd ? parent.length : parent.length - 1;
  if (index < 0 || index > max) {
    throw new Error(`Array index out of bounds in patch path "${pointer}".`);
  }
  return index;
}

function pointerWithFinalSegment(pointer, segment) {
  let segments = pointerSegments(pointer);
  segments[segments.length - 1] = String(segment);
  return `/${segments.map(escapePointerSegment).join('/')}`;
}

function normalizeOperationForApply(root, op) {
  if (!isObject(op) || typeof op.op !== 'string') {
    throw new Error('WorkspaceState patch operations must be objects with an op field.');
  }
  if (!['add', 'replace', 'remove'].includes(op.op)) {
    throw new Error(`Unsupported WorkspaceState patch operation "${op.op}".`);
  }
  if (typeof op.path !== 'string' || !op.path.trim()) {
    throw new Error('WorkspaceState patch operations require a non-empty path.');
  }
  if ((op.op === 'add' || op.op === 'replace') && !Object.prototype.hasOwnProperty.call(op, 'value')) {
    throw new Error(`WorkspaceState "${op.op}" operation requires value.`);
  }

  let pointer = normalizePointer(op.path);
  let normalized = { op: op.op, path: pointer };
  if (op.op === 'add' || op.op === 'replace') normalized.value = deepClone(op.value);

  if (op.op === 'add' && pointer !== '/') {
    let { parent, key } = parentAtPointer(root, pointer);
    if (Array.isArray(parent)) {
      let index = normalizeArrayIndex(parent, key, pointer, { allowEnd: true, allowAppend: true });
      normalized.path = pointerWithFinalSegment(pointer, index);
    }
  }
  return normalized;
}

function inverseForOperation(root, op) {
  let pointer = op.path;
  if (op.op === 'add') {
    let existed = pathExists(root, pointer);
    if (existed) {
      return { op: 'replace', path: pointer, value: deepClone(valueAtPointer(root, pointer)) };
    }
    return { op: 'remove', path: pointer };
  }
  if (op.op === 'replace') {
    return { op: 'replace', path: pointer, value: deepClone(valueAtPointer(root, pointer)) };
  }
  if (op.op === 'remove') {
    return { op: 'add', path: pointer, value: deepClone(valueAtPointer(root, pointer)) };
  }
  throw new Error(`Unsupported WorkspaceState patch operation "${op.op}".`);
}

function applyOperation(root, op) {
  if (op.path === '/') {
    if (op.op === 'remove') {
      throw new Error('WorkspaceState cannot remove the root config.');
    }
    return deepClone(op.value);
  }

  let { parent, key } = parentAtPointer(root, op.path);
  if (Array.isArray(parent)) {
    if (op.op === 'add') {
      let index = normalizeArrayIndex(parent, key, op.path, { allowEnd: true });
      parent.splice(index, 0, deepClone(op.value));
      return root;
    }
    let index = normalizeArrayIndex(parent, key, op.path);
    if (op.op === 'replace') parent[index] = deepClone(op.value);
    if (op.op === 'remove') parent.splice(index, 1);
    return root;
  }

  if (!isObject(parent)) {
    throw new Error(`Patch path "${op.path}" does not point to an object or array.`);
  }
  if (op.op !== 'add' && !Object.prototype.hasOwnProperty.call(parent, key)) {
    throw new Error(`Patch path "${op.path}" does not exist.`);
  }
  if (op.op === 'remove') {
    delete parent[key];
  } else {
    parent[key] = deepClone(op.value);
  }
  return root;
}

function applyOps(config, ops) {
  let next = deepClone(config);
  for (let raw of ops) {
    let op = normalizeOperationForApply(next, raw);
    next = applyOperation(next, op);
  }
  return next;
}

function applyOpsWithInverse(config, rawOps) {
  let next = deepClone(config);
  let ops = [];
  let inverseOps = [];

  for (let raw of rawOps) {
    let op = normalizeOperationForApply(next, raw);
    let inverse = inverseForOperation(next, op);
    next = applyOperation(next, op);
    ops.push(op);
    inverseOps.push(inverse);
  }

  return { config: next, ops, inverseOps: inverseOps.reverse() };
}

function changedPointersFromOps(ops) {
  return [...new Set(ops.map((op) => normalizePointer(op.path)))];
}

function changedPathsFromPointers(pointers) {
  return [...new Set(pointers.map((pointer) => pointerToPath(pointer)))];
}

function pointersOverlap(a, b) {
  if (a === '/' || b === '/') return true;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function hasOverlap(aPointers, bPointers) {
  return aPointers.some((a) => bPointers.some((b) => pointersOverlap(a, b)));
}

function uniquePrincipals(entries) {
  let seen = new Set();
  let principals = [];
  for (let entry of entries) {
    let principal = entry.actor?.principal;
    let key = principalKey(principal);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    principals.push(deepClone(principal));
  }
  return principals;
}

function hasConsentForEntry(entry, principal, consentTokens) {
  if (!entry.confirmId || !Array.isArray(consentTokens)) return false;
  for (let token of consentTokens) {
    if (typeof token === 'string' && token === entry.confirmId) return true;
    if (!isObject(token) || token.confirmId !== entry.confirmId) continue;
    let mintedBy = token.mintedBy || token.principal;
    if (mintedBy === undefined || samePrincipal(mintedBy, principal)) return true;
  }
  return false;
}

export function canTraverseHistoryEntry(entry, options = {}) {
  let principal = options.principal;
  if (!isObject(principal)) return { ok: true };
  let entryPrincipal = entry?.actor?.principal || entry?.principal;
  if (!isObject(entryPrincipal) || samePrincipal(entryPrincipal, principal)) return { ok: true };
  if (hasConsentForEntry(entry, principal, options.consentTokens || options.confirmTokens)) {
    return { ok: true, via: 'consent-token' };
  }
  return {
    ok: false,
    reason: 'foreign_principal',
    attribution: {
      principal: deepClone(entryPrincipal),
      actor: entry?.actor?.actor || entry?.actor,
      message: `made by ${entryPrincipal.id || entryPrincipal.kind} - undo it?`,
    },
  };
}

function resultEntry(entry) {
  return deepClone({
    id: entry.id,
    revision: entry.revision,
    baseRevision: entry.baseRevision,
    ops: entry.ops,
    inverseOps: entry.inverseOps,
    changedPaths: entry.changedPaths,
    actor: entry.actor,
    reason: entry.reason,
    confirmId: entry.confirmId,
    restoreOverlay: entry.restoreOverlay,
    trace: entry.trace,
    at: entry.at,
  });
}

function overlayRestoreFn(options) {
  if (typeof options.restoreOverlay === 'function') return options.restoreOverlay;
  if (typeof options.restoreOverlayExecutor?.restore === 'function') return options.restoreOverlayExecutor.restore;
  if (typeof options.overlayExecutor?.restore === 'function') return options.overlayExecutor.restore;
  return null;
}

function overlayClearFn(options) {
  if (typeof options.clearRestoredOverlay === 'function') return options.clearRestoredOverlay;
  if (typeof options.clearOverlay === 'function') return options.clearOverlay;
  if (typeof options.restoreOverlayExecutor?.clear === 'function') return options.restoreOverlayExecutor.clear;
  if (typeof options.overlayExecutor?.clear === 'function') return options.overlayExecutor.clear;
  return null;
}

function runOverlayHook(entry, direction, options, revision) {
  if (!entry.restoreOverlay) return undefined;
  let fn = direction === 'undo' ? overlayRestoreFn(options) : overlayClearFn(options);
  if (!fn) return undefined;
  return fn(deepClone(entry.restoreOverlay), {
    direction,
    revision,
    entry: resultEntry(entry),
  });
}

export class WorkspaceState {
  constructor(config = {}, options = {}) {
    this._config = deepClone(config);
    this._revision = Number.isInteger(options.revision) ? options.revision : 0;
    this._timeline = [];
    this._undoStack = [];
    this._redoStack = [];
  }

  get revision() {
    return this._revision;
  }

  get config() {
    return deepClone(this._config);
  }

  currentConfig() {
    return deepClone(this._config);
  }

  fingerprint() {
    return createConfigFingerprint(this._config);
  }

  snapshot() {
    let config = deepClone(this._config);
    return {
      body: deepClone(config),
      config,
      revision: this._revision,
      fingerprint: this.fingerprint(),
    };
  }

  commit(rawOps, options = {}) {
    if (!Array.isArray(rawOps) || rawOps.length === 0) {
      throw new Error('WorkspaceState commit requires a non-empty ops array.');
    }
    assertBaseRevision(options.baseRevision);
    if (options.baseRevision > this._revision) {
      throw new Error('WorkspaceState baseRevision cannot be greater than the current revision.');
    }

    let requestedPointers = changedPointersFromOps(rawOps);
    let trace = [];
    if (options.baseRevision < this._revision) {
      let concurrent = this._changesSince(options.baseRevision);
      if (hasOverlap(requestedPointers, concurrent.changedPointers)) {
        return {
          status: 'conflict',
          conflict: true,
          currentRevision: this._revision,
          changedPaths: concurrent.changedPaths,
          principals: concurrent.principals,
        };
      }
      trace.push(REBASED_OVER_CONCURRENT_EDIT);
    }

    let applied = applyOpsWithInverse(this._config, rawOps);
    let changedPointers = changedPointersFromOps(applied.ops);
    let changedPaths = changedPathsFromPointers(changedPointers);
    let revision = this._revision + 1;
    let actor = actorFromOptions(options, 'config-edit');
    let entry = {
      id: `config:${revision}`,
      stack: 'config',
      kind: 'commit',
      revision,
      baseRevision: options.baseRevision,
      ops: applied.ops,
      inverseOps: applied.inverseOps,
      changedPointers,
      changedPaths,
      actor,
      reason: actor.reason,
      confirmId: actor.confirmId,
      restoreOverlay: options.restoreOverlay ? deepClone(options.restoreOverlay) : undefined,
      trace,
      at: Date.now(),
    };

    this._config = applied.config;
    this._revision = revision;
    this._timeline.push(entry);
    this._undoStack.push(entry);
    this._redoStack = [];

    return {
      status: 'ok',
      revision,
      baseRevision: options.baseRevision,
      changedPaths: deepClone(changedPaths),
      trace: deepClone(trace),
      entry: resultEntry(entry),
      fingerprint: this.fingerprint(),
    };
  }

  getPatches(sinceRevision) {
    if (!Number.isInteger(sinceRevision) || sinceRevision < 0 || sinceRevision > this._revision) {
      return null;
    }
    return this._timeline
      .filter((entry) => entry.revision > sinceRevision)
      .flatMap((entry) => deepClone(entry.ops));
  }

  history() {
    return this._timeline.map(resultEntry);
  }

  getUndoStack() {
    return this._undoStack.map(resultEntry);
  }

  getRedoStack() {
    return this._redoStack.map(resultEntry);
  }

  peekUndo(options = {}) {
    return this._peekStack(this._undoStack, options);
  }

  peekRedo(options = {}) {
    return this._peekStack(this._redoStack, options);
  }

  undo(options = {}) {
    let readiness = this.peekUndo(options);
    if (readiness.status !== 'ready') return readiness;
    let entry = this._undoStack[this._undoStack.length - 1];
    let nextConfig = applyOps(this._config, entry.inverseOps);
    let revision = this._revision + 1;
    let actor = actorFromOptions({
      principal: options.principal || entry.actor.principal,
      actor: options.actor || 'undo',
      reason: options.reason || 'undo',
    }, 'undo');

    this._config = nextConfig;
    this._revision = revision;
    this._undoStack.pop();
    this._redoStack.push(entry);
    this._timeline.push({
      id: `config:${revision}`,
      stack: 'config',
      kind: 'undo',
      revision,
      baseRevision: revision - 1,
      sourceRevision: entry.revision,
      ops: deepClone(entry.inverseOps),
      inverseOps: deepClone(entry.ops),
      changedPointers: deepClone(entry.changedPointers),
      changedPaths: deepClone(entry.changedPaths),
      actor,
      reason: actor.reason,
      trace: [],
      at: Date.now(),
    });

    let overlayResult = runOverlayHook(entry, 'undo', options, revision);
    return {
      status: 'ok',
      action: 'undo',
      stack: 'config',
      revision,
      undoneRevision: entry.revision,
      changedPaths: deepClone(entry.changedPaths),
      entry: resultEntry(entry),
      restoreOverlayResult: overlayResult,
      fingerprint: this.fingerprint(),
    };
  }

  redo(options = {}) {
    let readiness = this.peekRedo(options);
    if (readiness.status !== 'ready') return readiness;
    let entry = this._redoStack[this._redoStack.length - 1];
    let nextConfig = applyOps(this._config, entry.ops);
    let revision = this._revision + 1;
    let actor = actorFromOptions({
      principal: options.principal || entry.actor.principal,
      actor: options.actor || 'redo',
      reason: options.reason || 'redo',
    }, 'redo');

    this._config = nextConfig;
    this._revision = revision;
    this._redoStack.pop();
    this._undoStack.push(entry);
    this._timeline.push({
      id: `config:${revision}`,
      stack: 'config',
      kind: 'redo',
      revision,
      baseRevision: revision - 1,
      sourceRevision: entry.revision,
      ops: deepClone(entry.ops),
      inverseOps: deepClone(entry.inverseOps),
      changedPointers: deepClone(entry.changedPointers),
      changedPaths: deepClone(entry.changedPaths),
      actor,
      reason: actor.reason,
      trace: [],
      at: Date.now(),
    });

    let overlayResult = runOverlayHook(entry, 'redo', options, revision);
    return {
      status: 'ok',
      action: 'redo',
      stack: 'config',
      revision,
      redoneRevision: entry.revision,
      changedPaths: deepClone(entry.changedPaths),
      entry: resultEntry(entry),
      clearOverlayResult: overlayResult,
      fingerprint: this.fingerprint(),
    };
  }

  _changesSince(baseRevision) {
    let entries = this._timeline.filter((entry) => entry.revision > baseRevision);
    let changedPointers = [...new Set(entries.flatMap((entry) => entry.changedPointers))];
    return {
      changedPointers,
      changedPaths: changedPathsFromPointers(changedPointers),
      principals: uniquePrincipals(entries),
    };
  }

  _peekStack(stack, options) {
    if (stack.length === 0) {
      return { status: 'empty', stack: 'config', revision: this._revision };
    }
    let entry = stack[stack.length - 1];
    let access = canTraverseHistoryEntry(entry, options);
    if (!access.ok) {
      return {
        status: 'blocked',
        blocked: true,
        stack: 'config',
        reason: access.reason,
        attribution: access.attribution,
        entry: resultEntry(entry),
        revision: this._revision,
      };
    }
    return {
      status: 'ready',
      stack: 'config',
      entry: resultEntry(entry),
      revision: this._revision,
      via: access.via,
    };
  }
}

export function createWorkspaceState(config, options) {
  return new WorkspaceState(config, options);
}
