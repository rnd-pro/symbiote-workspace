import {
  ENDPOINT_KINDS,
  ENDPOINT_METHODS,
  PORTABLE_ID_PATTERN,
  CAPABILITY_ID_PATTERN,
} from '../constants.js';
import { nonPortableStringReason, isGrantObject } from '../value-classes.js';

/**
 * SERVER-PLANE section (Section 7 S1.1-S1.2, S2.3, S3.2 rule 4).
 *
 * Validates the config half of the server plane: `server.endpoints[]` ingress
 * declarations and `server.jobs.groups[]` capacity-group id declarations.
 *
 * Declaration-home split (S1.1): the endpoint DECLARATION is portable config;
 * WHERE it is reachable is deployment identity. The deployment-manifest exposure
 * map `{ <endpointId>: "exposed" | "disabled" }` is manifest-side (B7), never
 * portable config — so any exposure/exposed key on the server subtree is an
 * unknown-key ERROR here.
 *
 * Capacity groups (S3.2 rule 4): `server.jobs.groups[]` declares group IDS only
 * (`{ id, title? }`). Concurrency limits, slot ledgers, and admission ordering are
 * host policy and never serialized into config — any such key is an unknown-key
 * ERROR.
 *
 * Ingress principal rule (documented contract, host-side): ingress-minted
 * executions run as principal `{ kind: 'daemon', id: <endpointId> }`, actor
 * `system`, record `trigger: 'ingress'`. External callers are never `human`
 * principals; nothing here serializes the principal kind into config.
 *
 * Scope boundary (S2.3 "config validation covers the config half only"): the
 * driver-manifest half of the trigger binding — that `nodeType` exists in the
 * pack's driver manifests with `trigger.kind: 'ingress'` — is a host availability
 * (readiness) concern reported per-handler at activation, not a config check, so
 * this section enforces the config-local half (`pack` declared in `requires`).
 */

const SERVER_KEYS = new Set(['endpoints', 'jobs']);
const ENDPOINT_KEYS = new Set(['id', 'kind', 'methods', 'binding', 'auth']);
const TRIGGER_BINDING_KEYS = new Set(['pack', 'nodeType']);
const HANDLER_BINDING_KEYS = new Set(['hostService', 'method']);
const JOBS_KEYS = new Set(['groups']);
const GROUP_KEYS = new Set(['id', 'title']);

const BINDING_DISCRIMINANTS = Object.freeze(['trigger', 'graph', 'handler']);
const BINDING_ALLOWED_KEYS = Object.freeze({
  trigger: new Set(['trigger']),
  graph: new Set(['graph', 'node']),
  handler: new Set(['handler']),
});

const PUBLIC_AUTH = 'public';
const INGRESS_FAMILY = 'ingress';
const SCHEDULE_FAMILY = 'schedule';
const CROSS_CHECK_TRIGGER_KINDS = new Set([INGRESS_FAMILY, SCHEDULE_FAMILY]);

const VALID_METHODS = new Set(ENDPOINT_METHODS);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPortableId(value) {
  return typeof value === 'string' && PORTABLE_ID_PATTERN.test(value);
}

function unknownKeys(object, allowed) {
  return Object.keys(object).filter((key) => !allowed.has(key));
}

/**
 * Extracts declared ids from a `requires` list whose entries may be plain id
 * strings or objects keyed by id/name/pack. Foreign shapes are ignored; the
 * owning section reports their shape errors.
 */
function declaredIds(list) {
  let ids = new Set();
  if (!Array.isArray(list)) return ids;
  for (let entry of list) {
    if (typeof entry === 'string' && entry.trim()) {
      ids.add(entry);
    } else if (isObject(entry)) {
      for (let key of ['id', 'name', 'pack']) {
        if (typeof entry[key] === 'string' && entry[key].trim()) ids.add(entry[key]);
      }
    }
  }
  return ids;
}

function hasCapabilityFamily(hostServiceIds, family) {
  let prefix = `${family}.`;
  for (let id of hostServiceIds) {
    if (id === family || id.startsWith(prefix)) return true;
  }
  return false;
}

function nodeType(node) {
  if (!isObject(node)) return undefined;
  if (typeof node.nodeType === 'string') return node.nodeType;
  if (typeof node.type === 'string') return node.type;
  return undefined;
}

/** Reads the config-tier engine graphs as plain data (owned by another section). */
function engineGraphs(config) {
  let graphs = config?.engine?.graphs;
  return Array.isArray(graphs) ? graphs : [];
}

function scanPortability(value, path, context) {
  if (typeof value === 'string') {
    let reason = nonPortableStringReason({ path, value });
    if (reason) {
      context.error(
        path,
        'server.value.non_portable',
        `Server-plane value at "${path}" is not portable (${reason}); config carries capability ids, never URLs, host paths, or secrets.`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanPortability(entry, `${path}[${index}]`, context));
    return;
  }
  if (isObject(value)) {
    if (isGrantObject(value)) {
      context.error(path, 'server.value.grant', `Grant object at "${path}" is session/host state and must never appear in portable config.`);
      return;
    }
    for (let [key, entry] of Object.entries(value)) {
      scanPortability(entry, path ? `${path}.${key}` : key, context);
    }
  }
}

function validateEndpointBinding(binding, path, endpoint, context, graphIndex) {
  if (!isObject(binding)) {
    context.error(path, 'server.endpoint.binding.required', 'Endpoint binding must be an object with exactly one of trigger, graph, or handler.');
    return;
  }

  let present = BINDING_DISCRIMINANTS.filter((key) => key in binding);
  if (present.length === 0) {
    context.error(path, 'server.endpoint.binding.empty', 'Endpoint binding must declare exactly one of trigger, graph, or handler.');
    return;
  }
  if (present.length > 1) {
    context.error(path, 'server.endpoint.binding.ambiguous', `Endpoint binding declares more than one of trigger, graph, or handler (${present.join(', ')}); exactly one is allowed.`);
    return;
  }

  let discriminant = present[0];
  for (let key of unknownKeys(binding, BINDING_ALLOWED_KEYS[discriminant])) {
    context.error(`${path}.${key}`, 'server.endpoint.binding.unknown_key', `Endpoint ${discriminant} binding has unknown key "${key}".`);
  }

  if (discriminant === 'trigger') {
    validateTriggerBinding(binding.trigger, `${path}.trigger`, endpoint, context);
  } else if (discriminant === 'graph') {
    validateGraphBinding(binding, path, context, graphIndex);
  } else {
    validateHandlerBinding(binding.handler, `${path}.handler`, endpoint, context);
  }
}

function validateTriggerBinding(trigger, path, endpoint, context) {
  if (!isObject(trigger)) {
    context.error(path, 'server.endpoint.binding.trigger.type', 'Trigger binding must be an object { pack, nodeType }.');
    return;
  }
  for (let key of unknownKeys(trigger, TRIGGER_BINDING_KEYS)) {
    context.error(`${path}.${key}`, 'server.endpoint.binding.trigger.unknown_key', `Trigger binding has unknown key "${key}".`);
  }
  if (!isPortableId(trigger.pack)) {
    context.error(`${path}.pack`, 'server.endpoint.binding.trigger.pack.invalid', 'Trigger binding requires a portable-id "pack".');
  } else if (!endpoint.declaredPacks.has(trigger.pack)) {
    context.error(`${path}.pack`, 'server.endpoint.binding.trigger.pack.unresolved', `Trigger binding pack "${trigger.pack}" is not declared in requires.packs or requires.plugins.`);
  }
  if (!isPortableId(trigger.nodeType)) {
    context.error(`${path}.nodeType`, 'server.endpoint.binding.trigger.nodeType.invalid', 'Trigger binding requires a portable-id "nodeType".');
  }
}

function validateGraphBinding(binding, path, context, graphIndex) {
  if (!isPortableId(binding.graph)) {
    context.error(`${path}.graph`, 'server.endpoint.binding.graph.invalid', 'Graph binding requires a portable-id "graph".');
    return;
  }
  let graph = graphIndex.get(binding.graph);
  if (!graph) {
    context.error(`${path}.graph`, 'server.endpoint.binding.graph.unresolved', `Graph binding "${binding.graph}" does not resolve to a config engine.graphs entry.`);
    return;
  }
  if (typeof binding.node !== 'string' || !binding.node.trim()) {
    context.error(`${path}.node`, 'server.endpoint.binding.graph.node.required', 'Graph binding requires a "node" id.');
    return;
  }
  if (!graph.nodeIds.has(binding.node)) {
    context.error(`${path}.node`, 'server.endpoint.binding.graph.node.unresolved', `Graph binding node "${binding.node}" is not a node of graph "${binding.graph}".`);
  }
}

function validateHandlerBinding(handler, path, endpoint, context) {
  if (!isObject(handler)) {
    context.error(path, 'server.endpoint.binding.handler.type', 'Handler binding must be an object { hostService, method }.');
    return;
  }
  for (let key of unknownKeys(handler, HANDLER_BINDING_KEYS)) {
    context.error(`${path}.${key}`, 'server.endpoint.binding.handler.unknown_key', `Handler binding has unknown key "${key}".`);
  }
  if (typeof handler.hostService !== 'string' || !CAPABILITY_ID_PATTERN.test(handler.hostService)) {
    context.error(`${path}.hostService`, 'server.endpoint.binding.handler.hostService.invalid', 'Handler binding requires a dotted-capability "hostService".');
  } else if (!endpoint.declaredHostServices.has(handler.hostService)) {
    context.error(`${path}.hostService`, 'server.endpoint.binding.handler.hostService.unresolved', `Handler hostService "${handler.hostService}" is not declared in requires.hostServices.`);
  }
  if (typeof handler.method !== 'string' || !handler.method.trim()) {
    context.error(`${path}.method`, 'server.endpoint.binding.handler.method.required', 'Handler binding requires a "method" name.');
  }
}

function validateEndpointAuth(endpoint, auth, path, declaredHostServices, context) {
  if (auth === undefined || auth === null) {
    context.error(path, 'server.endpoint.auth.required', 'Endpoint requires an "auth" capability id or the reserved literal "public" (fail-closed: ingress is never default-open).');
    return;
  }
  if (auth === PUBLIC_AUTH) return;
  if (typeof auth !== 'string' || !CAPABILITY_ID_PATTERN.test(auth)) {
    context.error(path, 'server.endpoint.auth.invalid', 'Endpoint "auth" must be a dotted capability id or the reserved literal "public".');
    return;
  }
  if (!declaredHostServices.has(auth)) {
    context.error(path, 'server.endpoint.auth.unresolved', `Endpoint auth capability "${auth}" is not declared in requires.hostServices.`);
  }
}

function validateEndpoints(endpoints, context, shared) {
  if (!Array.isArray(endpoints)) {
    context.error('server.endpoints', 'server.endpoints.type', 'server.endpoints must be an array.');
    return;
  }

  let seenIds = new Set();
  endpoints.forEach((endpoint, index) => {
    let base = `server.endpoints[${index}]`;
    if (!isObject(endpoint)) {
      context.error(base, 'server.endpoint.type', 'Endpoint must be an object.');
      return;
    }

    for (let key of unknownKeys(endpoint, ENDPOINT_KEYS)) {
      context.error(`${base}.${key}`, 'server.endpoint.unknown_key', `Endpoint has unknown key "${key}"; exposure is deployment-manifest side, not config.`);
    }

    if (!isPortableId(endpoint.id)) {
      context.error(`${base}.id`, 'server.endpoint.id.invalid', 'Endpoint requires a portable-id "id".');
    } else if (seenIds.has(endpoint.id)) {
      context.error(`${base}.id`, 'server.endpoint.id.duplicate', `Endpoint id "${endpoint.id}" is declared more than once.`);
    } else {
      seenIds.add(endpoint.id);
    }

    if (!ENDPOINT_KINDS.includes(endpoint.kind)) {
      context.error(`${base}.kind`, 'server.endpoint.kind.unknown', `Endpoint kind "${endpoint.kind}" must be one of ${ENDPOINT_KINDS.join(', ')}.`);
    }

    validateEndpointMethods(endpoint, base, context);

    validateEndpointBinding(endpoint.binding, `${base}.binding`, {
      declaredPacks: shared.declaredPacks,
      declaredHostServices: shared.declaredHostServices,
    }, context, shared.graphIndex);

    validateEndpointAuth(endpoint, endpoint.auth, `${base}.auth`, shared.declaredHostServices, context);
  });
}

function validateEndpointMethods(endpoint, base, context) {
  let { methods, kind } = endpoint;
  if (methods === undefined) {
    if (kind !== 'webhook') {
      context.error(`${base}.methods`, 'server.endpoint.methods.required', 'Endpoint requires a non-empty "methods" list; only webhook endpoints default to ["POST"].');
    }
    return;
  }
  if (!Array.isArray(methods) || methods.length === 0) {
    context.error(`${base}.methods`, 'server.endpoint.methods.empty', 'Endpoint "methods" must be a non-empty array of HTTP verbs.');
    return;
  }
  methods.forEach((method, index) => {
    if (!VALID_METHODS.has(method)) {
      context.error(`${base}.methods[${index}]`, 'server.endpoint.methods.invalid', `Endpoint method "${method}" must be one of ${ENDPOINT_METHODS.join(', ')}.`);
    }
  });
}

function validateJobs(jobs, context) {
  if (!isObject(jobs)) {
    context.error('server.jobs', 'server.jobs.type', 'server.jobs must be an object.');
    return;
  }
  for (let key of unknownKeys(jobs, JOBS_KEYS)) {
    context.error(`server.jobs.${key}`, 'server.jobs.unknown_key', `server.jobs has unknown key "${key}".`);
  }
  if (jobs.groups === undefined) return;
  if (!Array.isArray(jobs.groups)) {
    context.error('server.jobs.groups', 'server.jobs.groups.type', 'server.jobs.groups must be an array.');
    return;
  }

  let seenIds = new Set();
  jobs.groups.forEach((group, index) => {
    let base = `server.jobs.groups[${index}]`;
    if (!isObject(group)) {
      context.error(base, 'server.jobs.group.type', 'Job group must be an object { id, title? }.');
      return;
    }
    for (let key of unknownKeys(group, GROUP_KEYS)) {
      context.error(`${base}.${key}`, 'server.jobs.group.unknown_key', `Job group has unknown key "${key}"; concurrency, limits, and admission are host policy, never config.`);
    }
    if (!isPortableId(group.id)) {
      context.error(`${base}.id`, 'server.jobs.group.id.invalid', 'Job group requires a portable-id "id".');
    } else if (seenIds.has(group.id)) {
      context.error(`${base}.id`, 'server.jobs.group.id.duplicate', `Job group id "${group.id}" is declared more than once.`);
    } else {
      seenIds.add(group.id);
    }
    if (group.title !== undefined && typeof group.title !== 'string' && !(isObject(group.title) && typeof group.title.$t === 'string')) {
      context.error(`${base}.title`, 'server.jobs.group.title.type', 'Job group "title" must be a text string or an i18n reference { $t }.');
    }
  });
}

/**
 * S2.3 config-graph trigger cross-checks. Config-tier engine.graphs trigger nodes
 * are always-on infrastructure. A node is classified only from an inline
 * `trigger.kind` (config-local); manifest-derived classification is runtime.
 */
function validateConfigGraphTriggers(config, endpoints, context, declaredHostServices) {
  let typeLevelNodeTypes = new Set();
  let instanceLevel = new Set();
  if (Array.isArray(endpoints)) {
    for (let endpoint of endpoints) {
      let binding = isObject(endpoint) ? endpoint.binding : undefined;
      if (!isObject(binding)) continue;
      if (isObject(binding.trigger) && typeof binding.trigger.nodeType === 'string') {
        typeLevelNodeTypes.add(binding.trigger.nodeType);
      }
      if (typeof binding.graph === 'string' && typeof binding.node === 'string') {
        instanceLevel.add(`${binding.graph}::${binding.node}`);
      }
    }
  }

  let sawSchedule = false;
  for (let graph of engineGraphs(config)) {
    let graphId = isObject(graph) ? graph.id : undefined;
    let nodes = isObject(graph) && Array.isArray(graph.nodes) ? graph.nodes : [];
    for (let node of nodes) {
      let kind = isObject(node) && isObject(node.trigger) ? node.trigger.kind : undefined;
      if (!CROSS_CHECK_TRIGGER_KINDS.has(kind)) continue;
      if (kind === SCHEDULE_FAMILY) {
        sawSchedule = true;
        continue;
      }
      let type = nodeType(node);
      let covered = (type !== undefined && typeLevelNodeTypes.has(type))
        || instanceLevel.has(`${graphId}::${node.id}`);
      if (!covered) {
        context.error(
          `engine.graphs.${graphId}.nodes.${node?.id}`,
          'server.ingress.trigger.uncovered',
          `Config-graph ingress trigger node "${node?.id}" is not covered by a type-level endpoint binding for its nodeType nor an instance-level binding naming it.`,
        );
      }
    }
  }

  if (sawSchedule && !hasCapabilityFamily(declaredHostServices, SCHEDULE_FAMILY)) {
    context.error('requires.hostServices', 'server.schedule.host_service.missing', 'Config-graph schedule trigger nodes are present but requires.hostServices declares no schedule.* capability.');
  }
}

/**
 * @param {unknown} config
 * @param {{ error: Function }} context
 */
function validate(config, context) {
  let server = config?.server;
  let declaredHostServices = declaredIds(config?.requires?.hostServices);
  let declaredPacks = new Set([
    ...declaredIds(config?.requires?.packs),
    ...declaredIds(config?.requires?.plugins),
  ]);
  let graphIndex = new Map();
  for (let graph of engineGraphs(config)) {
    if (isObject(graph) && typeof graph.id === 'string') {
      let nodeIds = new Set();
      if (Array.isArray(graph.nodes)) {
        for (let node of graph.nodes) {
          if (isObject(node) && typeof node.id === 'string') nodeIds.add(node.id);
        }
      }
      graphIndex.set(graph.id, { nodeIds });
    }
  }

  let endpoints = isObject(server) ? server.endpoints : undefined;
  validateConfigGraphTriggers(config, endpoints, context, declaredHostServices);

  if (server === undefined) return;
  if (!isObject(server)) {
    context.error('server', 'server.type', 'server must be an object.');
    return;
  }

  for (let key of unknownKeys(server, SERVER_KEYS)) {
    context.error(`server.${key}`, 'server.unknown_key', `server has unknown key "${key}"; the endpoint exposure map { endpointId: exposed|disabled } is deployment-manifest side, not config.`);
  }

  if (server.endpoints !== undefined) {
    validateEndpoints(server.endpoints, context, { declaredPacks, declaredHostServices, graphIndex });
    // Fail-closed (S2.3): declaring ingress endpoints requires the ingress host family.
    if (Array.isArray(server.endpoints) && server.endpoints.length > 0
      && !hasCapabilityFamily(declaredHostServices, INGRESS_FAMILY)) {
      context.error('requires.hostServices', 'server.ingress.host_service.missing', 'server.endpoints[] are declared but requires.hostServices declares no ingress.* capability.');
    }
  }

  if (server.jobs !== undefined) {
    validateJobs(server.jobs, context);
  }

  scanPortability(server, 'server', context);
}

/**
 * Publishes the portable job-group vocabulary so submit/graph declarations in
 * other sections resolve against `jobs.group:<id>` in the referential pass. The
 * server plane's own cross-references (graph/node, pack, hostService, auth) are
 * validated in the shape pass against config-local subtrees rather than the
 * cross-section reference registry.
 */
function refProviders(config) {
  let groups = config?.server?.jobs?.groups;
  if (!Array.isArray(groups)) return [];
  let seen = new Set();
  let providers = [];
  groups.forEach((group, index) => {
    let id = group?.id;
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) return;
    seen.add(id);
    providers.push({ id: `jobs.group:${id}`, path: `server.jobs.groups[${index}].id` });
  });
  return providers;
}

function refConsumers() {
  return [];
}

export const serverSection = Object.freeze({
  id: 'server',
  validate,
  refProviders,
  refConsumers,
});

export default serverSection;
