/**
 * Document collection runtime for document-plane state.
 *
 * Documents are stored through an injected async KV adapter. The runtime owns
 * CAS, patch replay, per-document undo history, envelope validation, and
 * document-channel broadcasts without importing host or product code.
 *
 * @module symbiote-workspace/runtime/documents
 */

import { pathToPointer, pointerToPath, splitJsonPointer } from '../schema/config-path.js';
import { validateEngineGraphImportBody } from '../schema/sections/data.js';
import { parseWorkspaceAddress, serializeWorkspaceAddress } from '../schema/was.js';
import { broadcastDataChange } from './data-change.js';

export const DOCUMENT_RECORD_VERSION = 1;
export const DEFAULT_DOCUMENT_HISTORY_DEPTH = 100;
export const DEFAULT_DOCUMENT_COALESCE_WINDOW_MS = 300;

const PRESENTATION_STORAGE_PREFIX = 'presentation:';
const WRITE_ENDPOINTS = Object.freeze(['get', 'set', 'delete', 'list']);
const READ_ENDPOINTS = Object.freeze(['get', 'list']);
const MUTATING_ACTIONS = new Set([
  'collection.create',
  'collection.delete',
  'document.commit',
  'document.delete',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nowMs() {
  return Date.now();
}

function assertAdapterMethod(adapter, method, collectionId) {
  if (!adapter || typeof adapter[method] !== 'function') {
    let suffix = collectionId ? ` for collection "${collectionId}"` : '';
    throw new Error(`Document persistence adapter is missing ${method}()${suffix}.`);
  }
}

function normalizeListResult(result) {
  let keys = [];
  for (let item of asArray(result)) {
    if (typeof item === 'string') {
      keys.push(item);
    } else if (Array.isArray(item) && typeof item[0] === 'string') {
      keys.push(item[0]);
    } else if (isObject(item) && typeof item.key === 'string') {
      keys.push(item.key);
    }
  }
  return keys;
}

function collectCollections(config) {
  let collections = new Map();
  for (let collection of asArray(config?.data?.collections)) {
    if (isObject(collection) && typeof collection.id === 'string' && collection.id.length > 0) {
      collections.set(collection.id, collection);
    }
  }
  return collections;
}

function collectionTitle(collection) {
  if (typeof collection.title === 'string') return collection.title;
  if (isObject(collection.title) && typeof collection.title.default === 'string') {
    return collection.title.default;
  }
  return collection.id;
}

function historyOptions(collection) {
  let history = isObject(collection?.history) ? collection.history : {};
  return {
    depth: Number.isInteger(history.depth) && history.depth > 0
      ? history.depth
      : DEFAULT_DOCUMENT_HISTORY_DEPTH,
    coalesceWindowMs: Number.isInteger(history.coalesceWindowMs) && history.coalesceWindowMs >= 0
      ? history.coalesceWindowMs
      : DEFAULT_DOCUMENT_COALESCE_WINDOW_MS,
  };
}

function parseDocumentAddress(docAddress) {
  let parsed = parseWorkspaceAddress(docAddress);
  if (parsed.className !== 'doc') {
    throw new Error(`Document address "${docAddress}" must use doc:<collection>:<id>.`);
  }
  if (parsed.path) {
    throw new Error(`Document address "${docAddress}" must not include a path fragment.`);
  }
  return {
    collectionId: parsed.collectionId,
    docId: parsed.docId,
    docAddress: serializeWorkspaceAddress(parsed),
  };
}

function buildDocumentAddress(collectionId, docId) {
  return parseDocumentAddress(`doc:${collectionId}:${docId}`).docAddress;
}

function validateEnvelope(envelope, { docId, revision }) {
  let errors = [];
  if (!isObject(envelope)) {
    return [{ path: 'envelope', code: 'document.envelope', message: 'Document envelope must be an object.' }];
  }
  if (envelope.id !== docId) {
    errors.push({ path: 'envelope.id', code: 'document.envelope.id', message: 'Document envelope id must match the document address.' });
  }
  if (typeof envelope.name !== 'string' || envelope.name.length === 0) {
    errors.push({ path: 'envelope.name', code: 'document.envelope.name', message: 'Document envelope name must be a non-empty string.' });
  }
  if (!Array.isArray(envelope.tags) || envelope.tags.some((tag) => typeof tag !== 'string')) {
    errors.push({ path: 'envelope.tags', code: 'document.envelope.tags', message: 'Document envelope tags must be a string array.' });
  }
  if (envelope.enabled !== undefined && typeof envelope.enabled !== 'boolean') {
    errors.push({ path: 'envelope.enabled', code: 'document.envelope.enabled', message: 'Document envelope enabled must be a boolean.' });
  }
  if (envelope.folder !== undefined && typeof envelope.folder !== 'string') {
    errors.push({ path: 'envelope.folder', code: 'document.envelope.folder', message: 'Document envelope folder must be a string.' });
  }
  if (!Number.isInteger(envelope.revision) || envelope.revision !== revision) {
    errors.push({ path: 'envelope.revision', code: 'document.envelope.revision', message: 'Document envelope revision must match the stored revision.' });
  }
  return errors;
}

function defaultEnvelope(docId, options = {}) {
  return {
    id: docId,
    name: typeof options.name === 'string' && options.name.length > 0 ? options.name : docId,
    tags: Array.isArray(options.tags) ? [...options.tags] : [],
    ...(options.enabled !== undefined ? { enabled: Boolean(options.enabled) } : {}),
    ...(typeof options.folder === 'string' ? { folder: options.folder } : {}),
    revision: Number.isInteger(options.revision) ? options.revision : 0,
  };
}

function normalizeRecord(raw, address, options = {}) {
  let revision = Number.isInteger(raw?.revision) && raw.revision >= 0 ? raw.revision : 0;
  let envelope = isObject(raw?.envelope)
    ? cloneJson(raw.envelope)
    : defaultEnvelope(address.docId, { revision, ...options.envelope });
  envelope.id = address.docId;
  envelope.revision = revision;
  if (!Array.isArray(envelope.tags)) envelope.tags = [];
  return {
    schemaVersion: DOCUMENT_RECORD_VERSION,
    envelope,
    body: raw?.body === undefined ? {} : cloneJson(raw.body),
    revision,
    log: asArray(raw?.log).map(cloneJson),
  };
}

function scopedPath(target, segments) {
  return pointerToPath([target, ...segments]);
}

function splitOperationPath(op) {
  if (!isObject(op)) throw new Error('Document operation must be an object.');
  let rawPath = op.path ?? op.pointer ?? '';
  let target = op.target;
  let segments = splitJsonPointer(pathToPointer(rawPath));
  if (target !== undefined && target !== 'body' && target !== 'envelope') {
    throw new Error(`Document operation target "${target}" must be "body" or "envelope".`);
  }
  if (target === undefined && (segments[0] === 'body' || segments[0] === 'envelope')) {
    target = segments[0];
    segments = segments.slice(1);
  }
  return { target: target || 'body', segments };
}

function normalizeOperation(op) {
  let operation = op.op || op.type;
  if (!['add', 'remove', 'replace', 'set'].includes(operation)) {
    throw new Error(`Unsupported document operation "${operation}".`);
  }
  let { target, segments } = splitOperationPath(op);
  if (target === 'envelope' && (segments[0] === 'id' || segments[0] === 'revision')) {
    throw new Error(`Document envelope "${segments[0]}" is runtime-owned and cannot be patched.`);
  }
  let normalized = {
    op: operation,
    path: scopedPath(target, segments),
    target,
    segments,
  };
  if (operation !== 'remove') normalized.value = cloneJson(op.value);
  return normalized;
}

function valueAt(root, segments) {
  let current = root;
  for (let segment of segments) {
    if (current === undefined || current === null) return { exists: false, value: undefined };
    if (Array.isArray(current)) {
      let index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { exists: false, value: undefined };
      }
      current = current[index];
      continue;
    }
    if (!isObject(current) || !hasOwn(current, segment)) {
      return { exists: false, value: undefined };
    }
    current = current[segment];
  }
  return { exists: true, value: cloneJson(current) };
}

function ensureParent(root, segments) {
  if (segments.length === 0) return { parent: null, key: null };
  let current = root;
  for (let i = 0; i < segments.length - 1; i++) {
    let segment = segments[i];
    let next = segments[i + 1];
    if (Array.isArray(current)) {
      let index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error(`Document operation path segment "${segment}" does not exist.`);
      }
      current = current[index];
    } else if (isObject(current)) {
      if (!hasOwn(current, segment) || current[segment] === undefined || current[segment] === null) {
        current[segment] = /^\d+$/.test(next) ? [] : {};
      }
      current = current[segment];
    } else {
      throw new Error(`Document operation path segment "${segment}" is not addressable.`);
    }
  }
  return { parent: current, key: segments[segments.length - 1] };
}

function setValue(root, segments, value) {
  if (segments.length === 0) return cloneJson(value);
  let { parent, key } = ensureParent(root, segments);
  if (Array.isArray(parent)) {
    let index = key === '-' ? parent.length : Number(key);
    if (!Number.isInteger(index) || index < 0 || index > parent.length) {
      throw new Error(`Document operation array index "${key}" is out of range.`);
    }
    if (index === parent.length) parent.push(cloneJson(value));
    else parent[index] = cloneJson(value);
    return root;
  }
  if (!isObject(parent)) throw new Error('Document operation parent is not addressable.');
  parent[key] = cloneJson(value);
  return root;
}

function removeValue(root, segments) {
  if (segments.length === 0) return undefined;
  let { parent, key } = ensureParent(root, segments);
  if (Array.isArray(parent)) {
    let index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new Error(`Document operation array index "${key}" is out of range.`);
    }
    parent.splice(index, 1);
    return root;
  }
  if (!isObject(parent) || !hasOwn(parent, key)) {
    throw new Error(`Document operation path "${pointerToPath(segments)}" does not exist.`);
  }
  delete parent[key];
  return root;
}

function publicOperation(op) {
  let result = { op: op.op, path: op.path };
  if (op.op !== 'remove') result.value = cloneJson(op.value);
  return result;
}

function applyOperations(record, operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('Document commit requires a non-empty operations array.');
  }

  let envelope = cloneJson(record.envelope);
  let body = cloneJson(record.body);
  let inverseOps = [];
  let changedPaths = [];
  let normalizedOps = [];

  for (let rawOp of operations) {
    let op = normalizeOperation(rawOp);
    let root = op.target === 'envelope' ? envelope : body;
    let before = valueAt(root, op.segments);
    let nextRoot;

    if (op.op === 'remove') {
      if (!before.exists) throw new Error(`Document remove path "${op.path}" does not exist.`);
      nextRoot = removeValue(root, op.segments);
      inverseOps.unshift({ op: 'add', path: op.path, value: before.value });
    } else {
      nextRoot = setValue(root, op.segments, op.value);
      inverseOps.unshift(before.exists
        ? { op: 'replace', path: op.path, value: before.value }
        : { op: 'remove', path: op.path });
    }

    if (op.target === 'envelope') envelope = nextRoot;
    else body = nextRoot;
    changedPaths.push(op.path);
    normalizedOps.push(publicOperation(op));
  }

  return {
    envelope,
    body,
    inverseOps,
    ops: normalizedOps,
    changedPaths: [...new Set(changedPaths)],
  };
}

function actorCapability(actor) {
  return actor?.principal?.kind === 'agent' ? 'document.write.agent' : 'document.write.user';
}

function originFromActor(actor) {
  let source = isObject(actor) ? cloneJson(actor) : {};
  let principal = isObject(source.principal) ? source.principal : {};
  let kind = ['human', 'agent', 'daemon'].includes(principal.kind) ? principal.kind : 'human';
  let id = typeof principal.id === 'string' && principal.id.length > 0
    ? principal.id
    : (kind === 'agent' ? 'agent' : kind === 'daemon' ? 'system' : 'user');
  let actorLane = typeof source.actor === 'string' && ['user-direct', 'agent-gated', 'system'].includes(source.actor)
    ? source.actor
    : (kind === 'agent' ? 'agent-gated' : kind === 'daemon' ? 'system' : 'user-direct');
  return {
    ...source,
    principal: { ...principal, kind, id },
    actor: actorLane,
    reason: typeof source.reason === 'string' && source.reason.length > 0 ? source.reason : 'document.commit',
    sessionId: typeof source.sessionId === 'string' && source.sessionId.length > 0 ? source.sessionId : 'default',
  };
}

function collectAssetRefs(value, refs = [], path = 'body') {
  if (typeof value === 'string' && value.startsWith('asset:')) {
    let id = value.slice('asset:'.length).split('#')[0];
    refs.push({ id, ref: value, path });
    return refs;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) collectAssetRefs(value[i], refs, `${path}[${i}]`);
    return refs;
  }
  if (isObject(value)) {
    for (let key of Object.keys(value)) collectAssetRefs(value[key], refs, `${path}.${key}`);
  }
  return refs;
}

function declaredAssetIds(config) {
  let ids = new Set();
  for (let asset of asArray(config?.assets)) {
    if (isObject(asset) && typeof asset.id === 'string') ids.add(asset.id);
  }
  return ids;
}

function repairEnvelope(reason, diagnostics) {
  return {
    status: 'rejected',
    reason,
    repair: {
      status: 'repair-required',
      diagnostics,
    },
  };
}

function missingPersistenceVerdict(action, missing) {
  return {
    status: 'blocked',
    verdict: {
      status: 'blocked',
      reason: 'document-persistence-missing',
      action,
      missing,
    },
  };
}

function readOnlyVerdict(action, collection, capability) {
  return {
    status: 'blocked',
    verdict: {
      status: 'blocked',
      reason: 'collection-read-only',
      action,
      collectionId: collection.id,
      capability,
    },
  };
}

function shouldFlushBoundary(options) {
  return Boolean(
    options.flush ||
    options.gestureBoundary ||
    options.pointerUp ||
    options.boundary === 'pointerup' ||
    options.boundary === 'gesture'
  );
}

function presentationKey(docAddress, scope = 'viewport') {
  return `${PRESENTATION_STORAGE_PREFIX}${docAddress}:${scope}`;
}

export function createMemoryDocumentPersistence(initial = {}) {
  let store = new Map(Object.entries(initial).map(([key, value]) => [key, cloneJson(value)]));
  return {
    async get(key) {
      return cloneJson(store.get(key));
    },
    async set(key, value) {
      store.set(key, cloneJson(value));
      return cloneJson(value);
    },
    async delete(key) {
      return store.delete(key);
    },
    async list(prefix = '') {
      return [...store.keys()].filter((key) => key.startsWith(prefix));
    },
    dump() {
      return Object.fromEntries([...store.entries()].map(([key, value]) => [key, cloneJson(value)]));
    },
  };
}

export class DocumentRuntime {
  constructor(options = {}) {
    this.config = options.config || {};
    this.collections = collectCollections(this.config);
    this.persistence = options.persistence || null;
    this.persistenceAdapters = options.persistenceAdapters || {};
    this.broadcast = options.broadcast;
    this.gate = options.gate || options.policyGate || null;
    this.now = typeof options.now === 'function' ? options.now : nowMs;
    this.history = new Map();
    this.pendingBroadcasts = new Map();
    this.assetIds = declaredAssetIds(this.config);
  }

  adapterFor(collection) {
    if (collection?.persistence && this.persistenceAdapters[collection.persistence]) {
      return this.persistenceAdapters[collection.persistence];
    }
    return this.persistence;
  }

  missingEndpoints(collection) {
    let adapter = this.adapterFor(collection);
    let required = collection?.readOnly ? READ_ENDPOINTS : WRITE_ENDPOINTS;
    return required.filter((method) => !adapter || typeof adapter[method] !== 'function');
  }

  collection(collectionId) {
    let collection = this.collections.get(collectionId);
    if (!collection) throw new Error(`Unknown document collection "${collectionId}".`);
    return collection;
  }

  documentContext(docAddress) {
    let address = parseDocumentAddress(docAddress);
    return {
      ...address,
      collection: this.collection(address.collectionId),
    };
  }

  async readRecord(docAddress) {
    let context = this.documentContext(docAddress);
    let adapter = this.adapterFor(context.collection);
    assertAdapterMethod(adapter, 'get', context.collectionId);
    let raw = await adapter.get(context.docAddress);
    if (raw === undefined || raw === null) return null;
    return normalizeRecord(raw, context);
  }

  async writeRecord(docAddress, record) {
    let context = this.documentContext(docAddress);
    let adapter = this.adapterFor(context.collection);
    assertAdapterMethod(adapter, 'set', context.collectionId);
    await adapter.set(context.docAddress, cloneJson(record));
  }

  async deleteRecord(docAddress) {
    let context = this.documentContext(docAddress);
    let adapter = this.adapterFor(context.collection);
    assertAdapterMethod(adapter, 'delete', context.collectionId);
    await adapter.delete(context.docAddress);
    if (typeof adapter.delete === 'function') {
      await adapter.delete(presentationKey(context.docAddress));
    }
  }

  readiness() {
    let collections = [];
    for (let collection of this.collections.values()) {
      let missing = this.missingEndpoints(collection);
      collections.push({
        id: collection.id,
        readOnly: Boolean(collection.readOnly || missing.length > 0),
        missingEndpoints: missing,
      });
    }
    return {
      ready: collections.every((collection) => collection.missingEndpoints.length === 0),
      collections,
    };
  }

  listCollections() {
    return {
      collections: [...this.collections.values()].map((collection) => ({
        id: collection.id,
        title: collectionTitle(collection),
        itemSchema: cloneJson(collection.itemSchema),
        readOnly: Boolean(collection.readOnly || this.missingEndpoints(collection).length > 0),
        missingEndpoints: this.missingEndpoints(collection),
      })),
      readiness: this.readiness(),
    };
  }

  async queryCollection(collectionId) {
    let collection = this.collection(collectionId);
    let adapter = this.adapterFor(collection);
    let missing = this.missingEndpoints({ ...collection, readOnly: true });
    if (missing.length > 0) return missingPersistenceVerdict('collection.query', missing);
    assertAdapterMethod(adapter, 'list', collectionId);
    let keys = normalizeListResult(await adapter.list(`doc:${collectionId}:`));
    let documents = [];
    for (let key of keys) {
      let record = await adapter.get(key);
      if (record) documents.push(normalizeRecord(record, parseDocumentAddress(key)).envelope);
    }
    return {
      collectionId,
      documents: documents.sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  async mutationBlock(action, collection, actor) {
    let capability = actorCapability(actor);
    if (collection.readOnly) return readOnlyVerdict(action, collection, capability);
    let missing = this.missingEndpoints(collection);
    if (missing.length > 0) return missingPersistenceVerdict(action, missing);
    if (capability === 'document.write.agent' && typeof this.gate === 'function') {
      let verdict = await this.gate({
        action,
        capability,
        actor: originFromActor(actor),
        collection: cloneJson(collection),
      });
      if (verdict && (verdict.status === 'blocked' || verdict.status === 'pendingApproval' || verdict.accepted === false)) {
        return { status: 'blocked', verdict };
      }
    }
    return null;
  }

  validateBodyForCollection(collection, body) {
    if (collection?.itemSchema?.kind === 'engine-graph') {
      let errors = validateEngineGraphImportBody(body);
      if (errors.length > 0) return repairEnvelope('document-body-import', errors);
    }

    let unresolved = collectAssetRefs(body)
      .filter((ref) => !this.assetIds.has(ref.id))
      .map((ref) => ({
        path: ref.path,
        code: 'document.asset.unresolved',
        message: `Asset reference "${ref.ref}" does not resolve to a declared assets[] id.`,
        severity: 'error',
      }));
    if (unresolved.length > 0) return repairEnvelope('unresolved-asset-ref', unresolved);
    return null;
  }

  async createDocument(collectionId, options = {}) {
    let collection = this.collection(collectionId);
    let block = await this.mutationBlock('collection.create', collection, options.actor);
    if (block) return block;

    let docId = options.id || options.docId;
    if (typeof docId !== 'string' || docId.length === 0) {
      throw new Error('collection.create requires a document id.');
    }
    let docAddress = buildDocumentAddress(collectionId, docId);
    let adapter = this.adapterFor(collection);
    assertAdapterMethod(adapter, 'get', collectionId);
    if (await adapter.get(docAddress)) {
      return { conflict: true, revision: normalizeRecord(await adapter.get(docAddress), parseDocumentAddress(docAddress)).revision };
    }

    let body = options.body === undefined ? {} : cloneJson(options.body);
    let bodyProblem = this.validateBodyForCollection(collection, body);
    if (bodyProblem) return bodyProblem;

    let envelope = {
      ...defaultEnvelope(docId, options),
      ...(isObject(options.envelope) ? cloneJson(options.envelope) : {}),
      id: docId,
      revision: 0,
    };
    let envelopeErrors = validateEnvelope(envelope, { docId, revision: 0 });
    if (envelopeErrors.length > 0) return repairEnvelope('document-envelope-invalid', envelopeErrors);

    let record = normalizeRecord({
      schemaVersion: DOCUMENT_RECORD_VERSION,
      envelope,
      body,
      revision: 0,
      log: [],
    }, parseDocumentAddress(docAddress));
    await adapter.set(docAddress, record);
    return { docAddress, envelope: cloneJson(record.envelope), revision: 0 };
  }

  async deleteDocument(docAddress, options = {}) {
    let context = this.documentContext(docAddress);
    let block = await this.mutationBlock('document.delete', context.collection, options.actor);
    if (block) return block;
    await this.deleteRecord(context.docAddress);
    this.history.delete(context.docAddress);
    this.pendingBroadcasts.delete(context.docAddress);
    return { deleted: true };
  }

  async load(docAddress) {
    let record = await this.readRecord(docAddress);
    if (!record) return null;
    return {
      envelope: cloneJson(record.envelope),
      body: cloneJson(record.body),
      revision: record.revision,
    };
  }

  async snapshot(docAddress) {
    let record = await this.readRecord(docAddress);
    if (!record) return null;
    return { body: cloneJson(record.body), revision: record.revision };
  }

  async getPatches(docAddress, sinceRevision) {
    let record = await this.readRecord(docAddress);
    if (!record) return null;
    let since = Number.isInteger(sinceRevision) ? sinceRevision : 0;
    if (since === record.revision) return [];
    if (since < 0 || since > record.revision) return null;
    let entries = record.log.filter((entry) => entry.revision > since);
    if (entries.length !== record.revision - since) return null;
    return entries.flatMap((entry) => cloneJson(entry.ops));
  }

  async commit(docAddress, operations, options = {}) {
    let context = this.documentContext(docAddress);
    let block = await this.mutationBlock('document.commit', context.collection, options.actor);
    if (block) return block;

    let record = await this.readRecord(context.docAddress);
    if (!record) {
      throw new Error(`Document "${context.docAddress}" does not exist.`);
    }

    let baseRevision = Number.isInteger(options.baseRevision) ? options.baseRevision : record.revision;
    if (baseRevision !== record.revision) {
      return { conflict: true, revision: record.revision };
    }

    let applied = applyOperations(record, operations);
    let nextRevision = record.revision + 1;
    applied.envelope.revision = nextRevision;
    let envelopeErrors = validateEnvelope(applied.envelope, { docId: context.docId, revision: nextRevision });
    if (envelopeErrors.length > 0) return repairEnvelope('document-envelope-invalid', envelopeErrors);

    let bodyProblem = this.validateBodyForCollection(context.collection, applied.body);
    if (bodyProblem) return bodyProblem;

    let nextRecord = {
      schemaVersion: DOCUMENT_RECORD_VERSION,
      envelope: applied.envelope,
      body: applied.body,
      revision: nextRevision,
      log: [
        ...record.log,
        {
          revision: nextRevision,
          baseRevision,
          ops: applied.ops,
          changedPaths: applied.changedPaths,
          actor: originFromActor(options.actor),
          at: this.now(),
        },
      ],
    };
    await this.writeRecord(context.docAddress, nextRecord);
    this.recordHistory(context.docAddress, context.collection, {
      ops: applied.ops,
      inverseOps: applied.inverseOps,
      actor: originFromActor(options.actor),
      at: this.now(),
      label: options.label,
      coalesceKey: options.coalesceKey,
    }, options);
    this.queueBroadcast(context.docAddress, {
      revision: nextRevision,
      baseRevision,
      changedPaths: applied.changedPaths,
      origin: originFromActor(options.actor),
    });
    if (!options.coalesceKey || shouldFlushBoundary(options)) this.flush(context.docAddress);
    return { revision: nextRevision };
  }

  recordHistory(docAddress, collection, entry, options = {}) {
    let opts = historyOptions(collection);
    let stack = this.history.get(docAddress) || [];
    let last = stack[stack.length - 1];
    let mayCoalesce = entry.coalesceKey &&
      last &&
      !last.closed &&
      last.coalesceKey === entry.coalesceKey &&
      entry.at - last.at <= opts.coalesceWindowMs;

    if (mayCoalesce) {
      last.ops.push(...cloneJson(entry.ops));
      last.inverseOps = [...cloneJson(entry.inverseOps), ...last.inverseOps];
      last.at = entry.at;
      if (entry.label) last.label = entry.label;
      if (shouldFlushBoundary(options)) last.closed = true;
    } else {
      stack.push({
        ops: cloneJson(entry.ops),
        inverseOps: cloneJson(entry.inverseOps),
        actor: cloneJson(entry.actor),
        at: entry.at,
        ...(entry.label ? { label: entry.label } : {}),
        ...(entry.coalesceKey ? { coalesceKey: entry.coalesceKey } : {}),
        ...(shouldFlushBoundary(options) ? { closed: true } : {}),
      });
    }

    while (stack.length > opts.depth) stack.shift();
    this.history.set(docAddress, stack);
  }

  undoStack(docAddress) {
    return cloneJson(this.history.get(parseDocumentAddress(docAddress).docAddress) || [])
      .map((entry) => {
        let copy = { ...entry };
        delete copy.closed;
        return copy;
      });
  }

  async undo(docAddress, options = {}) {
    let address = parseDocumentAddress(docAddress).docAddress;
    let stack = this.history.get(address) || [];
    let entry = stack.pop();
    if (!entry) return { status: 'empty' };
    this.history.set(address, stack);
    let snapshot = await this.snapshot(address);
    return this.commit(address, entry.inverseOps, {
      ...options,
      baseRevision: snapshot.revision,
      label: options.label || `Undo${entry.label ? ` ${entry.label}` : ''}`,
      coalesceKey: undefined,
    });
  }

  queueBroadcast(docAddress, change) {
    let pending = this.pendingBroadcasts.get(docAddress);
    if (!pending) {
      this.pendingBroadcasts.set(docAddress, {
        revision: change.revision,
        baseRevision: change.baseRevision,
        changedPaths: new Set(change.changedPaths),
        origin: cloneJson(change.origin),
      });
      return;
    }
    pending.revision = change.revision;
    for (let path of change.changedPaths) pending.changedPaths.add(path);
  }

  flush(docAddress) {
    let addresses = docAddress
      ? [parseDocumentAddress(docAddress).docAddress]
      : [...this.pendingBroadcasts.keys()];
    for (let address of addresses) {
      let pending = this.pendingBroadcasts.get(address);
      if (!pending) continue;
      this.pendingBroadcasts.delete(address);
      if (typeof this.broadcast !== 'function') continue;
      broadcastDataChange(this.broadcast, address, {
        revision: pending.revision,
        baseRevision: pending.baseRevision,
        changedPaths: [...pending.changedPaths],
        origin: cloneJson(pending.origin),
      });
    }
  }

  closeDocument(docAddress) {
    this.flush(docAddress);
  }

  handleVisibilityChange(state) {
    if (state === 'hidden') this.flush();
  }

  handleTransportDisconnect() {
    this.flush();
  }

  autosave(docAddress) {
    this.flush(docAddress);
  }

  async savePresentation(docAddress, value, options = {}) {
    let context = this.documentContext(docAddress);
    let adapter = this.adapterFor(context.collection);
    assertAdapterMethod(adapter, 'set', context.collectionId);
    let scope = options.scope || 'viewport';
    let record = {
      docAddress: context.docAddress,
      scope,
      value: cloneJson(value),
      updatedAt: this.now(),
    };
    await adapter.set(presentationKey(context.docAddress, scope), record);
    return { saved: true };
  }

  async loadPresentation(docAddress, options = {}) {
    let context = this.documentContext(docAddress);
    let adapter = this.adapterFor(context.collection);
    assertAdapterMethod(adapter, 'get', context.collectionId);
    let record = await adapter.get(presentationKey(context.docAddress, options.scope || 'viewport'));
    return record ? cloneJson(record.value) : null;
  }
}

export function createDocumentRuntime(options = {}) {
  return new DocumentRuntime(options);
}

export function isMutatingDocumentAction(action) {
  return MUTATING_ACTIONS.has(action);
}

export function documentWriteCapability(actor) {
  return actorCapability(actor);
}
