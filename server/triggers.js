/**
 * Trigger registration reconciler.
 *
 * Reconciles envelope.enabled and config graph trigger declarations with
 * injected ingress/schedule host registration seams. The store is a host-side
 * cache, not source of truth; desired state is always recomputed from config
 * graphs and document envelopes.
 *
 * @module symbiote-workspace/server/triggers
 */

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function nowMs() {
  return Date.now();
}

function errorWithCode(message, code) {
  let error = new Error(message);
  error.code = code;
  return error;
}

function nodeType(node) {
  return node?.nodeType || node?.type || node?.kind || 'trigger';
}

function graphNodes(graph) {
  if (Array.isArray(graph?.nodes)) return graph.nodes;
  if (Array.isArray(graph?.body?.nodes)) return graph.body.nodes;
  return [];
}

function triggerKind(node) {
  return isObject(node?.trigger) ? node.trigger.kind : undefined;
}

function configGraphTriggers(config) {
  let graphs = Array.isArray(config?.engine?.graphs) ? config.engine.graphs : [];
  let desired = [];
  for (let graph of graphs) {
    if (!isObject(graph) || typeof graph.id !== 'string') continue;
    for (let node of graphNodes(graph)) {
      let kind = triggerKind(node);
      if (kind !== 'ingress' && kind !== 'schedule') continue;
      desired.push({
        source: 'config',
        kind,
        graphId: graph.id,
        nodeId: node.id,
        nodeType: nodeType(node),
      });
    }
  }
  return desired;
}

function documentGraphFromEntry(entry) {
  if (isObject(entry.body?.graph)) return entry.body.graph;
  if (Array.isArray(entry.body?.nodes)) return entry.body;
  if (Array.isArray(entry.graph?.nodes)) return entry.graph;
  return entry.body || {};
}

function docAddressFor(collectionId, docId) {
  return `doc:${collectionId}:${docId}`;
}

export function createMemoryTriggerRegistrationStore(initial = []) {
  let records = new Map();
  let epoch = 0;
  for (let record of initial) {
    if (record?.registrationId) records.set(record.registrationId, cloneJson(record));
  }

  function assertEpoch(expected) {
    if (expected !== epoch) {
      throw errorWithCode(`Trigger epoch ${expected} is superseded by epoch ${epoch}.`, 'trigger_epoch_superseded');
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
    async get(registrationId) {
      return cloneJson(records.get(registrationId));
    },
    async set(record, options = {}) {
      if (options.epoch !== undefined) assertEpoch(options.epoch);
      if (!record?.registrationId) throw errorWithCode('Trigger registration requires registrationId.', 'trigger_registration_invalid');
      records.set(record.registrationId, cloneJson(record));
      return cloneJson(record);
    },
    async delete(registrationId, options = {}) {
      if (options.epoch !== undefined) assertEpoch(options.epoch);
      return records.delete(registrationId);
    },
    async list() {
      return [...records.values()].map(cloneJson);
    },
    dump() {
      return Object.fromEntries([...records.entries()].map(([key, value]) => [key, cloneJson(value)]));
    },
  };
}

export class TriggerReconciler {
  constructor(options = {}) {
    this.config = options.config || {};
    this.documentRuntime = options.documentRuntime || options.documents;
    this.listDocuments = options.listDocuments;
    this.ingressHost = options.ingressHost || options.ingress;
    this.scheduleHost = options.scheduleHost || options.schedule;
    this.subscribe = options.subscribe;
    this.store = options.store || createMemoryTriggerRegistrationStore();
    this.now = typeof options.now === 'function' ? options.now : nowMs;
    this.epoch = typeof this.store.claimEpoch === 'function'
      ? this.store.claimEpoch(options.owner || 'trigger-reconciler')
      : (Number.isInteger(options.epoch) ? options.epoch : 1);
    this.unsubscribe = null;
  }

  assertEpoch() {
    if (typeof this.store.assertEpoch === 'function') this.store.assertEpoch(this.epoch);
  }

  async activate() {
    if (typeof this.subscribe === 'function') {
      this.unsubscribe = this.subscribe((message) => this.handleDocumentChange(message));
    }
    return this.reconcile({ replay: true });
  }

  async deactivate() {
    let records = await this.store.list();
    let results = [];
    for (let record of records.reverse()) {
      results.push(await this.unregister(record));
    }
    if (typeof this.unsubscribe === 'function') this.unsubscribe();
    this.unsubscribe = null;
    return results;
  }

  hostFor(kind) {
    if (kind === 'ingress') return this.ingressHost;
    if (kind === 'schedule') return this.scheduleHost;
    throw errorWithCode(`Unsupported trigger kind "${kind}".`, 'trigger_kind_unsupported');
  }

  async callHost(kind, method, record) {
    let host = this.hostFor(kind);
    if (typeof host === 'function') return host(method, cloneJson(record));
    if (host && typeof host[method] === 'function') return host[method](cloneJson(record));
    throw errorWithCode(`Trigger host for "${kind}" is missing ${method}().`, 'trigger_host_missing');
  }

  registrationId(item) {
    let scope = item.docAddress || item.graphId;
    return `${item.kind}:${scope}:${item.nodeId}`;
  }

  registrationRecord(item, previous) {
    return {
      ...(previous || {}),
      registrationId: this.registrationId(item),
      kind: item.kind,
      source: item.source,
      ...(item.docAddress ? { docAddress: item.docAddress } : {}),
      ...(item.graphId ? { graphId: item.graphId } : {}),
      nodeId: item.nodeId,
      nodeType: item.nodeType,
      status: 'pending',
      epoch: this.epoch,
      updatedAt: this.now(),
      createdAt: previous?.createdAt || this.now(),
    };
  }

  async desiredFromDocuments() {
    if (typeof this.listDocuments === 'function') {
      return this.desiredFromDocumentEntries(await this.listDocuments());
    }
    if (!this.documentRuntime) return [];

    let desired = [];
    let collections = Array.isArray(this.config?.data?.collections) ? this.config.data.collections : [];
    for (let collection of collections) {
      if (collection?.itemSchema?.kind !== 'engine-graph') continue;
      let queried = await this.documentRuntime.queryCollection(collection.id);
      for (let envelope of queried?.documents || []) {
        if (envelope?.enabled !== true) continue;
        let docAddress = docAddressFor(collection.id, envelope.id);
        let loaded = await this.documentRuntime.load(docAddress);
        desired.push(...this.desiredFromDocumentEntries([{
          docAddress,
          envelope,
          body: loaded?.body || {},
        }]));
      }
    }
    return desired;
  }

  desiredFromDocumentEntries(entries = []) {
    let desired = [];
    for (let entry of entries || []) {
      if (entry?.envelope?.enabled !== true) continue;
      let docAddress = entry.docAddress;
      if (typeof docAddress !== 'string') continue;
      let graph = documentGraphFromEntry(entry);
      let graphId = graph.id || entry.envelope.id || docAddress;
      for (let node of graphNodes(graph)) {
        let kind = triggerKind(node);
        if (kind !== 'ingress' && kind !== 'schedule') continue;
        desired.push({
          source: 'document',
          kind,
          docAddress,
          graphId,
          nodeId: node.id,
          nodeType: nodeType(node),
        });
      }
    }
    return desired;
  }

  async desiredRegistrations() {
    let all = [
      ...configGraphTriggers(this.config),
      ...(await this.desiredFromDocuments()),
    ];
    let byId = new Map();
    for (let item of all) {
      if (typeof item.nodeId !== 'string' || item.nodeId.length === 0) continue;
      byId.set(this.registrationId(item), item);
    }
    return byId;
  }

  async ensureRegistered(item, options = {}) {
    let registrationId = this.registrationId(item);
    let previous = await this.store.get(registrationId);
    let record = this.registrationRecord(item, previous);

    if (!previous) {
      await this.store.set(record, { epoch: this.epoch });
    }

    if (previous?.status === 'registered' && options.replay !== true) {
      return { status: 'ok', registrationId, idempotent: true, record: previous };
    }

    let transport = await this.callHost(item.kind, 'register', previous || record);
    let registered = {
      ...(previous || record),
      status: 'registered',
      transport: cloneJson(transport),
      epoch: this.epoch,
      updatedAt: this.now(),
    };
    await this.store.set(registered, { epoch: this.epoch });
    return { status: 'ok', registrationId, record: registered };
  }

  async unregister(record) {
    if (!record?.registrationId) return { status: 'ok', idempotent: true };
    await this.callHost(record.kind, 'unregister', record);
    await this.store.delete(record.registrationId, { epoch: this.epoch });
    return { status: 'ok', registrationId: record.registrationId };
  }

  async reconcile(options = {}) {
    this.assertEpoch();
    let desired = await this.desiredRegistrations();
    let existing = new Map((await this.store.list()).map((record) => [record.registrationId, record]));
    let registered = [];
    let unregistered = [];

    for (let [registrationId, item] of desired) {
      registered.push(await this.ensureRegistered(item, { replay: options.replay }));
      existing.delete(registrationId);
    }

    for (let record of [...existing.values()].reverse()) {
      unregistered.push(await this.unregister(record));
    }

    return { registered, unregistered };
  }

  async handleDocumentChange(message = {}) {
    let channel = message?.payload?.channel || message?.channel;
    if (typeof channel === 'string' && channel.startsWith('doc:')) {
      return this.reconcile();
    }
    return null;
  }
}

export function createTriggerReconciler(options = {}) {
  return new TriggerReconciler(options);
}

export function createTriggerReconcilerPlugin(options = {}) {
  let reconciler = null;
  return {
    name: options.name || 'symbiote.workspace.triggers',
    version: options.version || '0.3.0-alpha.2',
    async activate(context = {}) {
      reconciler = createTriggerReconciler({ ...options, ...context, config: options.config || context.config || {} });
      await reconciler.activate();
      if (context && isObject(context.serverPlane)) context.serverPlane.triggers = reconciler;
      return reconciler;
    },
    async deactivate() {
      let result = reconciler ? await reconciler.deactivate() : [];
      reconciler = null;
      return result;
    },
    reconciler() {
      return reconciler;
    },
  };
}

export default createTriggerReconciler;
