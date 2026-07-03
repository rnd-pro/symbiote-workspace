import { createHash } from 'node:crypto';
import { pathToPointer, splitJsonPointer } from '../schema/config-path.js';
import {
  RUNTIME_ID_PATTERN,
  SESSION_GC_DEFAULTS,
  TASK_STATUSES,
} from '../schema/constants.js';
import {
  SESSION_DOCUMENT_KEYS,
  normalizeSessionDocument,
} from '../schema/session-document.js';

export const SESSION_DOCUMENT_VERSION = 1;
export const SESSION_LAST_WRITER_WINS = 'session-last-writer-wins';
export const SESSION_MEMORY_FALLBACK = 'session-memory-fallback';

const SESSION_DOC_PREFIX = 'workspace.session';
const SNAPSHOT_PREFIX = 'snapshot:';
const READ_WRITE_METHODS = Object.freeze(['load', 'commit']);
const SNAPSHOT_METHODS = Object.freeze(['save', 'load', 'list']);
const RESTORED_OVERLAY_CACHE_LIMIT = 100;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cloneJson = (value) => {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const nowMs = () => Date.now();

const emptySessionDocument = () => {
  let document = {};
  for (let key of SESSION_DOCUMENT_KEYS) {
    if (key === 'activeView') continue;
    document[key] = ['openViews', 'tasks', 'parked', 'grants'].includes(key) ? [] : {};
  }
  return document;
};

const compact = (value) => {
  let out = {};
  for (let [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out;
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (let key of Object.keys(value)) deepFreeze(value[key]);
  return value;
};

const warning = (path, code, message, extra = {}) => ({
  path,
  code,
  message,
  severity: 'warning',
  ...extra,
});

const normalizePrincipal = (principal = {}) => {
  let kind = typeof principal.kind === 'string' && principal.kind.length > 0 ? principal.kind : 'human';
  let id = typeof principal.id === 'string' && principal.id.length > 0 ? principal.id : 'default';
  return { ...principal, kind, id };
};

const safeKeyPart = (value) => encodeURIComponent(String(value)).replace(/%/g, '_');

export function sessionDocumentAddress(options = {}) {
  let workspaceId = typeof options.workspaceId === 'string' && options.workspaceId.length > 0
    ? options.workspaceId
    : 'workspace';
  let principal = normalizePrincipal(options.principal);
  return `${SESSION_DOC_PREFIX}:${safeKeyPart(workspaceId)}:${safeKeyPart(principal.kind)}:${safeKeyPart(principal.id)}`;
}

function normalizeEnvelope(raw) {
  if (raw === undefined || raw === null) {
    return { body: emptySessionDocument(), revision: 0 };
  }
  if (isObject(raw) && Object.prototype.hasOwnProperty.call(raw, 'body')) {
    return {
      body: cloneJson(raw.body),
      revision: Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
    };
  }
  return { body: cloneJson(raw), revision: 0 };
}

function normalizedPointer(path) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('Session operation requires a non-empty path.');
  }
  return pathToPointer(path);
}

function pointerSegments(pointer) {
  if (pointer === '/') return [];
  return splitJsonPointer(pointer);
}

function valueAtPath(root, pointer) {
  let current = root;
  for (let segment of pointerSegments(pointer)) {
    if (Array.isArray(current)) {
      let index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { exists: false, value: undefined };
      }
      current = current[index];
      continue;
    }
    if (!isObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { exists: false, value: undefined };
    }
    current = current[segment];
  }
  return { exists: true, value: cloneJson(current) };
}

function ensureParent(root, pointer, { create = true } = {}) {
  let segments = pointerSegments(pointer);
  if (segments.length === 0) return { parent: null, key: null };
  let current = root;
  for (let i = 0; i < segments.length - 1; i++) {
    let segment = segments[i];
    let next = segments[i + 1];
    if (Array.isArray(current)) {
      let index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error(`Session operation path "${pointer}" does not exist.`);
      }
      current = current[index];
    } else if (isObject(current)) {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        if (!create) throw new Error(`Session operation path "${pointer}" does not exist.`);
        current[segment] = /^\d+$/.test(next) || next === '-' ? [] : {};
      }
      current = current[segment];
    } else {
      throw new Error(`Session operation path "${pointer}" is not addressable.`);
    }
  }
  return { parent: current, key: segments[segments.length - 1] };
}

function setAtPath(root, pointer, value) {
  if (pointer === '/') return cloneJson(value);
  let { parent, key } = ensureParent(root, pointer);
  if (Array.isArray(parent)) {
    let index = key === '-' ? parent.length : Number(key);
    if (!Number.isInteger(index) || index < 0 || index > parent.length) {
      throw new Error(`Session operation array index "${key}" is out of range.`);
    }
    if (index === parent.length) parent.push(cloneJson(value));
    else parent[index] = cloneJson(value);
    return root;
  }
  if (!isObject(parent)) throw new Error(`Session operation path "${pointer}" is not addressable.`);
  parent[key] = cloneJson(value);
  return root;
}

function removeAtPath(root, pointer) {
  if (pointer === '/') return emptySessionDocument();
  let { parent, key } = ensureParent(root, pointer, { create: false });
  if (Array.isArray(parent)) {
    let index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new Error(`Session operation array index "${key}" is out of range.`);
    }
    parent.splice(index, 1);
    return root;
  }
  if (!isObject(parent) || !Object.prototype.hasOwnProperty.call(parent, key)) {
    throw new Error(`Session operation path "${pointer}" does not exist.`);
  }
  delete parent[key];
  return root;
}

function normalizeOperation(op) {
  if (!isObject(op) || typeof op.op !== 'string') {
    throw new Error('Session operations must be objects with an op field.');
  }
  if (!['add', 'replace', 'remove', 'set'].includes(op.op)) {
    throw new Error(`Unsupported session operation "${op.op}".`);
  }
  let pointer = normalizedPointer(op.path ?? op.pointer);
  let operation = op.op === 'set' ? 'replace' : op.op;
  let normalized = { op: operation, path: pointer };
  if (operation !== 'remove') normalized.value = cloneJson(op.value);
  return normalized;
}

function applySessionOperations(document, operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('Session commit requires a non-empty operations array.');
  }
  let next = cloneJson(document);
  let changedPaths = [];
  let applied = [];
  for (let raw of operations) {
    let op = normalizeOperation(raw);
    if (op.op === 'remove') {
      next = removeAtPath(next, op.path);
    } else if (op.op === 'add') {
      let before = valueAtPath(next, op.path);
      next = setAtPath(next, op.path, op.value);
      op.op = before.exists ? 'replace' : 'add';
    } else {
      next = setAtPath(next, op.path, op.value);
    }
    changedPaths.push(op.path);
    applied.push(op);
  }
  return { document: next, ops: applied, changedPaths: [...new Set(changedPaths)] };
}

function storageValue(value) {
  return {
    schemaVersion: SESSION_DOCUMENT_VERSION,
    body: cloneJson(value.body),
    revision: value.revision,
    updatedAt: value.updatedAt,
    actor: cloneJson(value.actor),
  };
}

export function createMemorySessionPersistence(initial = {}) {
  let records = new Map();
  let snapshots = new Map();
  for (let [key, value] of Object.entries(initial.records || initial)) {
    if (key.startsWith(SNAPSHOT_PREFIX)) continue;
    records.set(key, normalizeEnvelope(value));
  }
  for (let [key, value] of Object.entries(initial.snapshots || {})) {
    snapshots.set(key, cloneJson(value));
  }

  return {
    async load(address) {
      return cloneJson(records.get(address));
    },
    async commit(address, operations, options = {}) {
      let current = normalizeEnvelope(records.get(address));
      if (Number.isInteger(options.baseRevision) && options.baseRevision > current.revision) {
        let error = new Error('Session baseRevision cannot be greater than the current revision.');
        error.code = 'session_base_revision_ahead';
        throw error;
      }
      let applied = applySessionOperations(current.body, operations);
      let envelope = storageValue({
        body: applied.document,
        revision: current.revision + 1,
        updatedAt: options.now || nowMs(),
        actor: options.actor,
      });
      records.set(address, envelope);
      return cloneJson(envelope);
    },
    async save(address, envelope) {
      records.set(address, storageValue(normalizeEnvelope(envelope)));
      return cloneJson(records.get(address));
    },
    async get(address) {
      return cloneJson(records.get(address));
    },
    async set(address, envelope) {
      records.set(address, storageValue(normalizeEnvelope(envelope)));
      return cloneJson(records.get(address));
    },
    snapshot: {
      async save(address, snapshotId, value) {
        snapshots.set(`${address}:${snapshotId}`, cloneJson(value));
        return { snapshotId };
      },
      async load(address, snapshotId) {
        return cloneJson(snapshots.get(`${address}:${snapshotId}`));
      },
      async list(address) {
        let prefix = `${address}:`;
        return [...snapshots.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length))
          .sort();
      },
    },
    dump() {
      return {
        records: Object.fromEntries([...records.entries()].map(([key, value]) => [key, cloneJson(value)])),
        snapshots: Object.fromEntries([...snapshots.entries()].map(([key, value]) => [key, cloneJson(value)])),
      };
    },
  };
}

function adapterMethod(adapter, method) {
  return adapter && typeof adapter[method] === 'function';
}

function hasSnapshotAdapter(adapter) {
  return adapter?.snapshot && SNAPSHOT_METHODS.every((method) => typeof adapter.snapshot[method] === 'function');
}

function createPersistenceAdapter(adapter) {
  let readinessWarnings = [];
  let sessionReady = READ_WRITE_METHODS.every((method) => adapterMethod(adapter, method));
  let snapshotReady = hasSnapshotAdapter(adapter);
  let memory = createMemorySessionPersistence();

  if (!sessionReady) {
    readinessWarnings.push(warning(
      'workspace.session',
      SESSION_MEMORY_FALLBACK,
      'workspace.session load/commit persistence is unavailable; using in-memory session state.',
      { capability: 'workspace.session' },
    ));
  }
  if (!snapshotReady) {
    readinessWarnings.push(warning(
      'workspace.session.snapshot',
      SESSION_MEMORY_FALLBACK,
      'workspace.session snapshot persistence is unavailable; using in-memory snapshots.',
      { capability: 'workspace.session.snapshot' },
    ));
  }

  let sessionAdapter = sessionReady ? adapter : memory;
  let snapshotAdapter = snapshotReady ? adapter.snapshot : memory.snapshot;
  return { sessionAdapter, snapshotAdapter, readinessWarnings };
}

function asSet(value) {
  if (!value) return null;
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  if (isObject(value)) return new Set(Object.keys(value).filter((key) => value[key]));
  return null;
}

function knownViewsFromConfig(config) {
  let ids = [];
  for (let view of Array.isArray(config?.views) ? config.views : []) {
    if (typeof view?.id === 'string') ids.push(view.id);
  }
  return ids.length > 0 ? new Set(ids) : null;
}

function viewKey(entry) {
  if (!entry) return null;
  return entry.key ? `${entry.view}:${entry.key}` : entry.view;
}

function splitActiveView(value) {
  if (typeof value !== 'string') return { view: null, key: null };
  let [view, key] = value.split(':');
  return { view, key };
}

function stackView(address) {
  let [view] = String(address).split('/');
  return view?.startsWith('view:') ? view.slice('view:'.length) : null;
}

function grantReferencesTask(grant, taskId) {
  let stack = [grant];
  let seen = new Set();
  while (stack.length > 0) {
    let value = stack.pop();
    if (value === taskId) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let item of value) stack.push(item);
    } else {
      for (let item of Object.values(value)) stack.push(item);
    }
  }
  return false;
}

function overlayEntryKey(viewId, nodeId) {
  return `${viewId}/${nodeId}`;
}

function overlayKeys(overlay) {
  let keys = [];
  for (let [viewId, nodes] of Object.entries(overlay || {})) {
    if (!isObject(nodes)) continue;
    for (let nodeId of Object.keys(nodes)) keys.push(overlayEntryKey(viewId, nodeId));
  }
  return keys;
}

function cloneOverlaySubset(overlay, includeKey) {
  let out = {};
  for (let [viewId, nodes] of Object.entries(overlay || {})) {
    if (!isObject(nodes)) continue;
    for (let [nodeId, delta] of Object.entries(nodes)) {
      if (!includeKey(overlayEntryKey(viewId, nodeId))) continue;
      if (!out[viewId]) out[viewId] = {};
      out[viewId][nodeId] = cloneJson(delta);
    }
  }
  return out;
}

function isEmptyObject(value) {
  return !isObject(value) || Object.keys(value).length === 0;
}

function hashSubject(subjectKey) {
  return createHash('sha256').update(String(subjectKey)).digest('base64url').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 32);
}

function normalizeProjectionPath(path) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('Session projection path must be a non-empty string.');
  }
  let value = path.startsWith('state:') ? path.slice('state:'.length) : path;
  return value.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
}

function readBySegments(root, segments) {
  let current = root;
  for (let segment of segments) {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current)) current = current[Number(segment)];
    else current = current[segment];
  }
  return cloneJson(current);
}

function assertRuntimeId(value, label) {
  if (typeof value !== 'string' || !RUNTIME_ID_PATTERN.test(value)) {
    throw new Error(`${label} must match RUNTIME_ID_PATTERN.`);
  }
}

function snapshotBody(document) {
  return deepFreeze(cloneJson(compact({
    openViews: document.openViews,
    activeView: document.activeView,
    stacks: document.stacks,
    geometry: document.geometry,
    state: document.state,
  })));
}

export class SessionStore {
  constructor(options = {}) {
    this.workspaceId = options.workspaceId || 'workspace';
    this.principal = normalizePrincipal(options.principal);
    this.address = options.address || sessionDocumentAddress({
      workspaceId: this.workspaceId,
      principal: this.principal,
    });
    this.now = typeof options.now === 'function' ? options.now : nowMs;
    this.config = options.config || null;
    this.ephemeralViews = options.ephemeralViews || [];
    this.knownViews = asSet(options.knownViews) || knownViewsFromConfig(options.config);
    this.knownNodesByView = options.knownNodesByView || options.nodesByView || null;
    this.knownVerdictIds = asSet(options.knownVerdictIds);
    this.verdictExists = typeof options.verdictExists === 'function' ? options.verdictExists : null;
    this.gate = options.gate || null;
    this.documentPresentation = options.documentPresentation || null;
    this.taskAbandonMs = Number.isFinite(options.taskAbandonMs)
      ? options.taskAbandonMs
      : SESSION_GC_DEFAULTS.taskAbandonMs;
    this.parkedPendingApprovalMs = Number.isFinite(options.parkedPendingApprovalMs)
      ? options.parkedPendingApprovalMs
      : SESSION_GC_DEFAULTS.parkedPendingApprovalMs;

    let persistence = createPersistenceAdapter(options.persistence);
    this.persistence = persistence.sessionAdapter;
    this.snapshots = persistence.snapshotAdapter;
    this.readinessWarnings = persistence.readinessWarnings;
    this.document = emptySessionDocument();
    this.revision = 0;
    this.loaded = false;
    this.loadWarnings = [];
    this.resumeOffers = new Map();
    this.restoredOverlayByEntry = new Map();
  }

  readiness() {
    return {
      ready: this.readinessWarnings.length === 0,
      warnings: cloneJson(this.readinessWarnings),
    };
  }

  async load(options = {}) {
    let raw = await this.persistence.load(this.address);
    let envelope = normalizeEnvelope(raw);
    let normalized = this._normalizeAndPrune(envelope.body, options);
    this.document = normalized.document;
    this.revision = envelope.revision;
    this.loaded = true;
    this.loadWarnings = [...normalized.warnings, ...this.readinessWarnings];
    return {
      status: 'ok',
      revision: this.revision,
      warnings: cloneJson(this.loadWarnings),
      readiness: this.readiness(),
    };
  }

  async ensureLoaded() {
    if (!this.loaded) await this.load();
  }

  async commit(operations, options = {}) {
    await this.ensureLoaded();
    let baseRevision = options.baseRevision;
    if (Number.isInteger(baseRevision) && baseRevision > this.revision) {
      let error = new Error('Session baseRevision cannot be greater than the current revision.');
      error.code = 'session_base_revision_ahead';
      throw error;
    }
    let trace = Number.isInteger(baseRevision) && baseRevision < this.revision
      ? [SESSION_LAST_WRITER_WINS]
      : [];
    let applied = applySessionOperations(this.document, operations);
    let normalized = this._normalizeAndPrune(applied.document, options);
    let envelope = await this._persist(normalized.document, {
      actor: options.actor,
      baseRevision,
      now: options.now || this.now(),
    });
    let saved = normalizeEnvelope(envelope);
    let savedNormalized = this._normalizeAndPrune(saved.body, options);
    this.document = savedNormalized.document;
    this.revision = saved.revision;
    this.loaded = true;
    this.loadWarnings = savedNormalized.warnings;
    return {
      status: 'ok',
      revision: this.revision,
      baseRevision,
      changedPaths: applied.changedPaths,
      trace,
      warnings: cloneJson([...normalized.warnings, ...savedNormalized.warnings]),
    };
  }

  async _persist(document, options) {
    if (adapterMethod(this.persistence, 'commit')) {
      let currentRevision = this.revision;
      let op = currentRevision === 0
        ? { op: 'replace', path: '/', value: document }
        : { op: 'replace', path: '/', value: document };
      return this.persistence.commit(this.address, [op], {
        actor: options.actor,
        baseRevision: currentRevision,
        now: options.now,
      });
    }
    let envelope = storageValue({
      body: document,
      revision: this.revision + 1,
      actor: options.actor,
      updatedAt: options.now,
    });
    if (adapterMethod(this.persistence, 'save')) return this.persistence.save(this.address, envelope);
    if (adapterMethod(this.persistence, 'set')) return this.persistence.set(this.address, envelope);
    throw new Error('Session persistence adapter is missing commit/save/set.');
  }

  _normalizeAndPrune(rawDocument, options = {}) {
    let report = normalizeSessionDocument(rawDocument, {
      ephemeralViews: options.ephemeralViews || this.ephemeralViews,
    });
    let warnings = [...report.warnings];
    let document = cloneJson(report.document);
    this._dropDeadViewEntries(document, warnings, options);
    this._dropDanglingParked(document, warnings, options);
    this._dropExpiredConfirmPending(document, warnings, options);
    return { document, warnings };
  }

  _dropDeadViewEntries(document, warnings, options) {
    let knownViews = asSet(options.knownViews) || this.knownViews;
    if (!knownViews || knownViews.size === 0) return;

    let open = [];
    for (let entry of document.openViews) {
      if (knownViews.has(entry.view)) {
        open.push(entry);
      } else {
        warnings.push(warning('openViews', 'session.dead_view', `Dropped open view for unknown view "${entry.view}".`));
      }
    }
    document.openViews = open;

    if (document.activeView) {
      let active = splitActiveView(document.activeView);
      if (!knownViews.has(active.view)) {
        warnings.push(warning('activeView', 'session.dead_view', `Dropped activeView "${document.activeView}".`));
        delete document.activeView;
      }
    }

    for (let key of Object.keys(document.stacks)) {
      let view = stackView(key);
      if (!knownViews.has(view)) {
        warnings.push(warning(`stacks.${key}`, 'session.dead_view', `Dropped stack overlay for unknown view "${view}".`));
        delete document.stacks[key];
      }
    }

    for (let view of Object.keys(document.geometry)) {
      if (!knownViews.has(view)) {
        warnings.push(warning(`geometry.${view}`, 'session.dead_view', `Dropped geometry overlay for unknown view "${view}".`));
        delete document.geometry[view];
      }
    }

    this._dropDeadGeometryNodes(document, warnings, options);
  }

  _dropDeadGeometryNodes(document, warnings, options) {
    let nodesByView = options.knownNodesByView || options.nodesByView || this.knownNodesByView;
    if (!nodesByView) return;
    for (let [view, nodes] of Object.entries(document.geometry)) {
      let known = asSet(nodesByView instanceof Map ? nodesByView.get(view) : nodesByView[view]);
      if (!known || known.size === 0) continue;
      for (let nodeId of Object.keys(nodes)) {
        if (known.has(nodeId)) continue;
        warnings.push(warning(`geometry.${view}.${nodeId}`, 'session.dead_node', `Dropped geometry overlay for unknown node "${nodeId}".`));
        delete nodes[nodeId];
      }
      if (Object.keys(nodes).length === 0) delete document.geometry[view];
    }
  }

  _verdictKnown(verdictId, options) {
    let known = asSet(options.knownVerdictIds) || this.knownVerdictIds;
    if (known) return known.has(verdictId);
    if (this.verdictExists) return this.verdictExists(verdictId);
    return true;
  }

  _dropDanglingParked(document, warnings, options) {
    let kept = [];
    for (let parked of document.parked) {
      if (parked.stage !== 'pendingApproval') {
        kept.push(parked);
        continue;
      }
      if (!parked.verdictId || !this._verdictKnown(parked.verdictId, options)) {
        warnings.push(warning(
          `parked.${parked.parkId}.verdictId`,
          'session.parked.dangling_verdict',
          `Dropped pendingApproval parked item "${parked.parkId}" with no live verdict.`,
        ));
        continue;
      }
      kept.push(parked);
    }
    document.parked = kept;
  }

  _dropExpiredConfirmPending(document, warnings, options) {
    let at = Number.isFinite(options.now) ? options.now : this.now();
    let kept = [];
    for (let parked of document.parked) {
      if (parked.stage === 'confirmPending' && Number.isFinite(parked.expiresAt) && parked.expiresAt <= at) {
        warnings.push(warning(
          `parked.${parked.parkId}.expiresAt`,
          'session.parked.expired',
          `Dropped expired confirmPending parked item "${parked.parkId}".`,
          { notice: 'expired' },
        ));
        continue;
      }
      kept.push(parked);
    }
    document.parked = kept;
  }

  project(path) {
    if (!path) {
      return {
        revision: this.revision,
        readiness: this.readiness(),
        openViews: cloneJson(this.document.openViews),
        activeView: this.document.activeView,
        stacks: cloneJson(this.document.stacks),
        geometry: cloneJson(this.document.geometry),
        nav: cloneJson(this.document.nav),
        panelChrome: cloneJson(this.document.panelChrome),
        tasks: cloneJson(this.document.tasks),
        parked: cloneJson(this.document.parked),
        teach: cloneJson(this.document.teach),
      };
    }
    return this.readStateProjection(path);
  }

  readStateProjection(path) {
    let segments = normalizeProjectionPath(path);
    if (segments[0] !== 'session') {
      throw new Error(`Unsupported session projection "${path}".`);
    }
    let [, topic, ...rest] = segments;
    if (topic === 'presentation' && rest[0] === 'geometry') {
      return readBySegments(this.document.geometry, rest.slice(1));
    }
    if (topic === 'docPresentation') {
      return readBySegments(this.document.state?.docPresentation, rest);
    }
    if (!Object.prototype.hasOwnProperty.call(this.document, topic)) {
      return undefined;
    }
    return readBySegments(this.document[topic], rest);
  }

  async writeStateProjection(path, value, options = {}) {
    let segments = normalizeProjectionPath(path);
    if (segments[0] !== 'session') {
      throw new Error(`Unsupported session projection "${path}".`);
    }
    if (segments[1] !== 'docPresentation') {
      let error = new Error('state:session.* projection is read-only except state:session.docPresentation.*.');
      error.code = 'session_projection_read_only';
      throw error;
    }
    if (segments.length < 4) {
      throw new Error('state:session.docPresentation writes require collection id and document id.');
    }
    let [, , collectionId, docId, ...rest] = segments;
    if (this.documentPresentation && typeof this.documentPresentation.save === 'function') {
      return this.documentPresentation.save({ collectionId, docId, path: rest.join('.'), value: cloneJson(value), ...options });
    }
    return {
      status: 'redirect',
      target: 'document.presentation.save',
      collectionId,
      docId,
      path: rest.join('.'),
      value: cloneJson(value),
    };
  }

  resumeTasks() {
    return this.document.tasks
      .filter((task) => task.status === 'active' || task.status === 'interrupted')
      .map(cloneJson);
  }

  async checkpointTask(taskId, resume, options = {}) {
    assertRuntimeId(taskId, 'taskId');
    await this.ensureLoaded();
    let tasks = cloneJson(this.document.tasks);
    let index = tasks.findIndex((task) => task.taskId === taskId);
    let task = index >= 0
      ? tasks[index]
      : {
        taskId,
        kind: options.kind || 'construction',
        startedAt: options.startedAt || this.now(),
        status: 'active',
      };
    task = {
      ...task,
      status: options.status || task.status,
      resume: cloneJson(resume || {}),
    };
    if (index >= 0) tasks[index] = task;
    else tasks.push(task);
    return this.commit([{ op: 'replace', path: '/tasks', value: tasks }], {
      ...options,
      actor: options.actor || { principal: { kind: 'daemon', id: 'system' }, actor: 'system', reason: 'task.checkpoint' },
    });
  }

  async setTaskStatus(taskId, status, options = {}) {
    assertRuntimeId(taskId, 'taskId');
    if (!TASK_STATUSES.includes(status)) throw new Error(`Unsupported task status "${status}".`);
    await this.ensureLoaded();
    let tasks = cloneJson(this.document.tasks);
    let task = tasks.find((entry) => entry.taskId === taskId);
    if (!task) throw new Error(`Unknown task "${taskId}".`);
    task.status = status;
    return this.commit([{ op: 'replace', path: '/tasks', value: tasks }], options);
  }

  async gc(options = {}) {
    await this.ensureLoaded();
    let at = Number.isFinite(options.now) ? options.now : this.now();
    let notices = [];
    let grants = this.document.grants;
    let newlyAbandoned = new Set();
    let tasks = [];

    for (let task of this.document.tasks) {
      let next = cloneJson(task);
      if (next.status === 'interrupted' && next.startedAt + this.taskAbandonMs <= at) {
        if (!this.resumeOffers.has(next.taskId)) {
          this.resumeOffers.set(next.taskId, at);
          notices.push({ kind: 'resume-expiring', taskId: next.taskId, expiresAt: at });
        } else {
          next.status = 'abandoned';
          newlyAbandoned.add(next.taskId);
          notices.push({ kind: 'task-abandoned', taskId: next.taskId });
        }
      }

      let terminal = next.status === 'completed' || next.status === 'abandoned';
      let referenced = grants.some((grant) => grantReferencesTask(grant, next.taskId));
      if (terminal && !referenced && !newlyAbandoned.has(next.taskId)) {
        notices.push({ kind: 'task-dropped', taskId: next.taskId, status: next.status });
        continue;
      }
      tasks.push(next);
    }

    let parked = [];
    for (let item of this.document.parked) {
      if (item.stage === 'confirmPending' && item.expiresAt <= at) {
        notices.push({ kind: 'parked-expired', parkId: item.parkId });
        continue;
      }
      if (item.stage === 'pendingApproval' && item.createdAt + this.parkedPendingApprovalMs <= at) {
        let stale = { ...item, stale: true };
        parked.push(stale);
        notices.push({
          kind: 'parked-stale',
          parkId: item.parkId,
          verdictId: item.verdictId,
          affordance: { label: 'withdraw', intent: 'intent-withdraw', parkId: item.parkId },
        });
        continue;
      }
      parked.push(item);
    }

    let changes = [];
    if (JSON.stringify(tasks) !== JSON.stringify(this.document.tasks)) {
      changes.push({ op: 'replace', path: '/tasks', value: tasks });
    }
    if (JSON.stringify(parked) !== JSON.stringify(this.document.parked)) {
      changes.push({ op: 'replace', path: '/parked', value: parked });
    }
    if (changes.length > 0) {
      let result = await this.commit(changes, {
        ...options,
        actor: options.actor || { principal: { kind: 'daemon', id: 'system' }, actor: 'system', reason: 'session.gc' },
      });
      return { ...result, notices };
    }
    return { status: 'ok', revision: this.revision, notices };
  }

  async recordVerdict(verdictId, verdict, options = {}) {
    await this.ensureLoaded();
    let resumed = [];
    let kept = [];
    for (let parked of this.document.parked) {
      if (parked.stage === 'pendingApproval' && parked.verdictId === verdictId) {
        resumed.push({ ...cloneJson(parked), verdict: cloneJson(verdict) });
        continue;
      }
      kept.push(parked);
    }
    if (resumed.length === 0) return { status: 'empty', resumed };
    let result = await this.commit([{ op: 'replace', path: '/parked', value: kept }], options);
    return { ...result, resumed };
  }

  async withdrawParked(parkId, options = {}) {
    await this.ensureLoaded();
    let parked = this.document.parked.filter((item) => item.parkId !== parkId);
    if (parked.length === this.document.parked.length) return { status: 'empty', parkId };
    if (this.gate && typeof this.gate.submit === 'function') {
      await this.gate.submit({ intent: 'intent-withdraw', parkId, actor: options.actor });
    }
    let result = await this.commit([{ op: 'replace', path: '/parked', value: parked }], options);
    return { ...result, parkId, intent: 'intent-withdraw' };
  }

  teachKey(hookId, subjectKey) {
    if (typeof hookId !== 'string' || hookId.length === 0) throw new Error('hookId is required.');
    return subjectKey === undefined || subjectKey === null ? hookId : `${hookId}:${hashSubject(subjectKey)}`;
  }

  teachState(hookId, subjectKey) {
    return cloneJson(this.document.teach[this.teachKey(hookId, subjectKey)]);
  }

  shouldOfferTeach(hookId, subjectKey) {
    let entry = this.teachState(hookId, subjectKey);
    return !entry || entry.status === 'offered';
  }

  async recordTeach(hookId, status, options = {}) {
    if (!['offered', 'completed', 'dismissed'].includes(status)) {
      throw new Error(`Unsupported teach status "${status}".`);
    }
    await this.ensureLoaded();
    let key = this.teachKey(hookId, options.subjectKey);
    let teach = {
      ...this.document.teach,
      [key]: { status, updatedAt: options.updatedAt || this.now() },
    };
    let result = await this.commit([{ op: 'replace', path: '/teach', value: teach }], options);
    return { ...result, key };
  }

  grants() {
    return cloneJson(this.document.grants);
  }

  async addGrant(grant, options = {}) {
    await this.ensureLoaded();
    if (grant?.expiry === 'install') {
      throw new Error('Install grants are not stored in the session document.');
    }
    let grants = [...this.document.grants, cloneJson(grant)];
    return this.commit([{ op: 'replace', path: '/grants', value: grants }], options);
  }

  geometryDelta(viewId, nodeId, baseDelta) {
    return cloneJson(this.document.geometry?.[viewId]?.[nodeId] ?? baseDelta);
  }

  shadowedGeometryPaths(patch = {}) {
    let paths = [];
    for (let [viewId, nodes] of Object.entries(patch)) {
      if (!isObject(nodes)) continue;
      for (let nodeId of Object.keys(nodes)) {
        if (this.document.geometry?.[viewId]?.[nodeId]) paths.push(`geometry.${viewId}.${nodeId}`);
      }
    }
    return paths;
  }

  async setGeometryOverlay(viewId, nodeId, delta, options = {}) {
    await this.ensureLoaded();
    let geometry = cloneJson(this.document.geometry);
    if (!geometry[viewId]) geometry[viewId] = {};
    geometry[viewId][nodeId] = cloneJson(delta);
    return this.commit([{ op: 'replace', path: '/geometry', value: geometry }], options);
  }

  _clearOverlayEntries(overlay) {
    let geometry = cloneJson(this.document.geometry);
    let cleared = {};
    for (let [viewId, nodes] of Object.entries(overlay || {})) {
      if (!isObject(nodes) || !geometry[viewId]) continue;
      for (let [nodeId, delta] of Object.entries(nodes)) {
        if (!Object.prototype.hasOwnProperty.call(geometry[viewId], nodeId)) continue;
        if (!cleared[viewId]) cleared[viewId] = {};
        cleared[viewId][nodeId] = cloneJson(delta);
        delete geometry[viewId][nodeId];
      }
      if (isEmptyObject(geometry[viewId])) delete geometry[viewId];
    }
    return { geometry, cleared };
  }

  async promoteGeometry(options = {}) {
    await this.ensureLoaded();
    let overlay = options.overlay || options.restoreOverlay || this.document.geometry;
    let { geometry, cleared } = this._clearOverlayEntries(overlay);
    if (isEmptyObject(cleared)) {
      return { status: 'empty', revision: this.revision, restoreOverlay: {} };
    }

    let configResult;
    let configStack = options.configStack || options.workspaceState;
    if (configStack && typeof configStack.commit === 'function') {
      configResult = configStack.commit(options.ops || options.configOps || [], {
        principal: options.principal || options.actor?.principal || this.principal,
        actor: options.actor?.actor || options.actor || 'user',
        reason: options.reason || 'layout_promote_geometry',
        baseRevision: options.baseRevision,
        restoreOverlay: cleared,
      });
      if (configResult?.status === 'conflict') return configResult;
    }

    let sessionResult = await this.commit([{ op: 'replace', path: '/geometry', value: geometry }], {
      actor: options.actor,
      baseRevision: options.sessionBaseRevision,
    });
    return {
      ...sessionResult,
      configResult: cloneJson(configResult),
      restoreOverlay: cleared,
    };
  }

  async restoreOverlay(overlay, context = {}) {
    await this.ensureLoaded();
    let geometry = cloneJson(this.document.geometry);
    let restoredKeys = new Set();
    let skipped = [];

    for (let [viewId, nodes] of Object.entries(overlay || {})) {
      if (!isObject(nodes)) continue;
      if (!geometry[viewId]) geometry[viewId] = {};
      for (let [nodeId, delta] of Object.entries(nodes)) {
        if (geometry[viewId][nodeId]) {
          skipped.push({ viewId, nodeId, reason: 'redragged' });
          continue;
        }
        geometry[viewId][nodeId] = cloneJson(delta);
        restoredKeys.add(overlayEntryKey(viewId, nodeId));
      }
    }

    let result = await this.commit([{ op: 'replace', path: '/geometry', value: geometry }], {
      actor: context.actor || { principal: { kind: 'daemon', id: 'system' }, actor: 'system', reason: 'layout.restoreOverlay' },
    });
    this._rememberRestoredOverlay(context, restoredKeys);
    return {
      ...result,
      restored: cloneOverlaySubset(overlay, (key) => restoredKeys.has(key)),
      skipped,
    };
  }

  async clearOverlay(overlay, context = {}) {
    await this.ensureLoaded();
    let remembered = this._restoredKeysFor(context);
    let include = remembered
      ? (key) => remembered.has(key)
      : (key) => overlayKeys(overlay).includes(key);
    let subset = cloneOverlaySubset(overlay, include);
    let { geometry, cleared } = this._clearOverlayEntries(subset);
    let result = await this.commit([{ op: 'replace', path: '/geometry', value: geometry }], {
      actor: context.actor || { principal: { kind: 'daemon', id: 'system' }, actor: 'system', reason: 'layout.clearOverlay' },
    });
    return { ...result, cleared };
  }

  restoreOverlayExecutor() {
    return {
      restore: (overlay, context) => this.restoreOverlay(overlay, context),
      clear: (overlay, context) => this.clearOverlay(overlay, context),
    };
  }

  _overlayContextKey(context = {}) {
    return context.entry?.id || context.entry?.revision || context.revision || 'default';
  }

  _rememberRestoredOverlay(context, restoredKeys) {
    let key = this._overlayContextKey(context);
    this.restoredOverlayByEntry.set(key, new Set(restoredKeys));
    while (this.restoredOverlayByEntry.size > RESTORED_OVERLAY_CACHE_LIMIT) {
      let first = this.restoredOverlayByEntry.keys().next().value;
      this.restoredOverlayByEntry.delete(first);
    }
  }

  _restoredKeysFor(context) {
    return this.restoredOverlayByEntry.get(this._overlayContextKey(context));
  }

  async saveSnapshot(snapshotId, options = {}) {
    assertRuntimeId(snapshotId, 'snapshotId');
    await this.ensureLoaded();
    let body = snapshotBody(this.document);
    await this.snapshots.save(this.address, snapshotId, body, options);
    return { status: 'ok', snapshotId, revision: this.revision };
  }

  async loadSnapshot(snapshotId, options = {}) {
    if (typeof snapshotId !== 'string' || !RUNTIME_ID_PATTERN.test(snapshotId)) {
      return {
        status: 'notice',
        code: 'session.snapshot.foreign_id',
        message: 'Snapshot id does not match the runtime-minted id grammar.',
      };
    }
    let value = await this.snapshots.load(this.address, snapshotId, options);
    if (value === undefined || value === null) {
      return {
        status: 'notice',
        code: 'session.snapshot.unknown',
        snapshotId,
        message: `Snapshot "${snapshotId}" is not available.`,
      };
    }
    return { status: 'ok', snapshotId, snapshot: deepFreeze(cloneJson(value)) };
  }

  async listSnapshots(options = {}) {
    let snapshots = await this.snapshots.list(this.address, options);
    return { status: 'ok', snapshots: Array.isArray(snapshots) ? [...snapshots] : [] };
  }
}

export function createSessionStore(options = {}) {
  return new SessionStore(options);
}
