/**
 * WAS-to-PubSub wire compiler.
 *
 * Validated workspace wires compile to concrete PubSub context/property tokens.
 * Runtime installation uses only context subscriptions and publishes; it does
 * not wrap PubSub.pub globally and does not introduce a parallel event bus.
 *
 * @module symbiote-workspace/runtime/wire-compiler
 */

import {
  parseWorkspaceEndpoint,
  serializeWorkspaceAddress,
  serializeWorkspaceEndpoint,
  validateEndpointPair,
} from '../schema/was.js';
import { createRegistryObserver } from './registry-observer.js';

export const WIRE_OBSERVATION_CONTEXT = 'workspace:wires';
export const WIRE_OBSERVATION_EVENT_PREFIX = 'event:';
export const WIRE_OBSERVATION_BINDING_PREFIX = 'binding:';
export const WIRE_VALUE_PROP = 'value';

const PLACE_VARIABLES = Object.freeze({
  view: Object.freeze(['viewId']),
  panel: Object.freeze(['viewId', 'instanceId']),
  stack: Object.freeze(['viewId', 'stackId']),
  node: Object.freeze(['graphId', 'nodeId']),
  socket: Object.freeze(['graphId', 'nodeId', 'socketId']),
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.length > 0;
}

function endpointDirection(endpoint) {
  return endpoint.kind === 'place' ? endpoint.surface.direction : endpoint.direction;
}

function hasWildcard(value) {
  return typeof value === 'string' && value.includes('*');
}

function hasTemplate(value) {
  return typeof value === 'string' && /{[A-Za-z][A-Za-z0-9]*}/.test(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function variableNamesForAddress(address) {
  let names = PLACE_VARIABLES[address.className] || [];
  return names.filter((name) => address[name] === '*');
}

function templateNames(value) {
  let names = new Set();
  for (let match of String(value).matchAll(/{([A-Za-z][A-Za-z0-9]*)}/g)) {
    names.add(match[1]);
  }
  return [...names];
}

function compileContextPattern(token) {
  let variables = variableNamesForAddress(token.endpoint.address);
  let wildcardIndex = 0;
  let source = '';
  for (let char of token.ctxUid) {
    if (char !== '*') {
      source += escapeRegExp(char);
      continue;
    }
    let name = variables[wildcardIndex] || `wildcard${wildcardIndex + 1}`;
    wildcardIndex += 1;
    source += `(?<${name}>[^:]+)`;
  }
  return {
    variables,
    test: new RegExp(`^${source}$`),
  };
}

function interpolate(value, captures) {
  return String(value).replace(/{([A-Za-z][A-Za-z0-9]*)}/g, (match, name) => {
    if (!Object.hasOwn(captures, name)) {
      throw new Error(`Template variable "${name}" is not bound by the from endpoint.`);
    }
    return captures[name];
  });
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
  for (let i = 0; i < segments.length - 1; i++) {
    let segment = segments[i];
    if (!isObject(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment];
  }
  cursor[segments[segments.length - 1]] = value;
}

function stableEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (!isObject(a) && !Array.isArray(a)) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function invertMap(map) {
  if (!map) return null;
  let inverted = {};
  let targets = new Set();
  for (let [source, target] of Object.entries(map)) {
    if (targets.has(target)) {
      throw new Error(`Two-way wire map target "${target}" is not bijective.`);
    }
    targets.add(target);
    inverted[target] = source;
  }
  return inverted;
}

function schemaHasPath(schema, path) {
  if (!schema) return true;
  if (Array.isArray(schema)) return schema.includes(path);
  if (schema instanceof Set) return schema.has(path);
  if (!isObject(schema)) return true;
  if (Array.isArray(schema.paths)) return schema.paths.includes(path);
  if (Array.isArray(schema.fields)) return schema.fields.includes(path);
  if (isObject(schema.properties)) {
    let cursor = schema;
    for (let segment of path.split('.')) {
      if (!isObject(cursor.properties) || !Object.hasOwn(cursor.properties, segment)) return false;
      cursor = cursor.properties[segment];
    }
    return true;
  }
  return Object.hasOwn(schema, path);
}

function payloadSchemaForWire(wire, fromToken, options) {
  let schemas = options.payloadSchemas;
  if (!schemas) return null;
  if (schemas instanceof Map) {
    return schemas.get(wire.id) || schemas.get(wire.from) || schemas.get(fromToken.raw);
  }
  if (isObject(schemas)) {
    return schemas[wire.id] || schemas[wire.from] || schemas[fromToken.raw];
  }
  return null;
}

function validateMapSchema(wire, fromToken, options) {
  if (!wire.map) return;
  let sourceSchema = payloadSchemaForWire(wire, fromToken, options);
  if (!sourceSchema) return;
  for (let sourcePath of Object.keys(wire.map)) {
    if (!schemaHasPath(sourceSchema, sourcePath)) {
      throw new Error(`Wire "${wire.id}" map source "${sourcePath}" is not declared by the source payload schema.`);
    }
  }
}

function stateTierFor(config, fieldPath) {
  let fields = config?.state?.fields;
  let entries = Array.isArray(fields)
    ? fields
    : isObject(fields)
      ? Object.entries(fields).map(([id, value]) => ({ id, ...(isObject(value) ? value : {}) }))
      : [];
  for (let entry of entries) {
    if (!isObject(entry)) continue;
    let id = entry.id ?? entry.path ?? entry.field;
    if (id === fieldPath) return entry.persistence ?? entry.tier ?? null;
  }
  return null;
}

function validateRtTarget(from, to, config) {
  if (from.address.className !== 'rt' || to.kind !== 'value') return;
  if (to.address.className === 'doc') {
    throw new Error('rt: sources cannot target durable doc: values.');
  }
  if (to.address.className !== 'state') return;
  let tier = stateTierFor(config, to.address.fieldPath);
  if (tier === 'session' || tier === 'workspace') {
    throw new Error(`rt: sources cannot target ${tier}-tier state field "${to.address.fieldPath}".`);
  }
}

function endpointToToken(endpoint) {
  if (endpoint.kind === 'place') {
    let ctxUid = serializeWorkspaceAddress(endpoint.address);
    let prop = `${endpoint.surface.kind}:${endpoint.surface.id}`;
    return Object.freeze({
      raw: serializeWorkspaceEndpoint(endpoint),
      kind: 'place',
      className: endpoint.address.className,
      direction: endpoint.surface.direction,
      ctxUid,
      prop,
      endpoint,
      isPattern: hasWildcard(ctxUid),
      isTemplate: hasTemplate(ctxUid),
    });
  }

  let address = endpoint.address;
  if (address.className === 'state') {
    return Object.freeze({
      raw: serializeWorkspaceEndpoint(endpoint),
      kind: 'value',
      className: 'state',
      direction: endpoint.direction,
      ctxUid: 'state',
      prop: address.fieldPath,
      endpoint,
      isPattern: false,
      isTemplate: false,
    });
  }
  if (address.className === 'rt') {
    return Object.freeze({
      raw: serializeWorkspaceEndpoint(endpoint),
      kind: 'value',
      className: 'rt',
      direction: endpoint.direction,
      ctxUid: address.topic,
      prop: WIRE_VALUE_PROP,
      endpoint,
      isPattern: false,
      isTemplate: false,
    });
  }
  if (address.className === 'doc') {
    return Object.freeze({
      raw: serializeWorkspaceEndpoint(endpoint),
      kind: 'value',
      className: 'doc',
      direction: endpoint.direction,
      ctxUid: `doc:${address.collectionId}:${address.docId}`,
      prop: address.path || WIRE_VALUE_PROP,
      endpoint,
      isPattern: false,
      isTemplate: false,
    });
  }
  if (address.className === 'content') {
    return Object.freeze({
      raw: serializeWorkspaceEndpoint(endpoint),
      kind: 'value',
      className: 'content',
      direction: endpoint.direction,
      ctxUid: `content:${address.collectionId}:${address.entryId}`,
      prop: address.field || WIRE_VALUE_PROP,
      endpoint,
      isPattern: false,
      isTemplate: false,
    });
  }

  throw new Error(`Unsupported wire value endpoint class "${address.className}".`);
}

function createDescriptor(wire, direction, from, to, map) {
  return Object.freeze({
    wireId: wire.id,
    direction,
    mode: wire.mode ?? 'one-way',
    from,
    to,
    map: map || null,
  });
}

function createConcreteDescriptors(wire, from, to) {
  let descriptors = [createDescriptor(wire, 'forward', from, to, wire.map || null)];
  if ((wire.mode ?? 'one-way') === 'two-way') {
    descriptors.push(createDescriptor(wire, 'reverse', to, from, invertMap(wire.map || null)));
  }
  return descriptors;
}

function concreteTokenFromTemplate(token, captures) {
  if (!token.isTemplate) return token;
  let ctxUid = interpolate(token.ctxUid, captures);
  return Object.freeze({
    ...token,
    ctxUid,
    raw: interpolate(token.raw, captures),
    isTemplate: false,
  });
}

function concreteTokenFromPattern(token, ctxUid) {
  return Object.freeze({
    ...token,
    ctxUid,
    raw: token.raw.replace(token.ctxUid, String(ctxUid)),
    isPattern: false,
  });
}

function createWildcardSubscription(compiledWire) {
  let pattern = compileContextPattern(compiledWire.from);
  return Object.freeze({
    wireId: compiledWire.id,
    from: compiledWire.from,
    to: compiledWire.to,
    mode: compiledWire.mode,
    map: compiledWire.map,
    pattern,
    match(uid) {
      let matched = pattern.test.exec(String(uid));
      if (!matched) return null;
      return { ...(matched.groups || {}) };
    },
    materialize(uid) {
      let captures = this.match(uid);
      if (!captures) return [];
      let from = concreteTokenFromPattern(compiledWire.from, uid);
      let to = concreteTokenFromTemplate(compiledWire.to, captures);
      return createConcreteDescriptors(compiledWire.source, from, to);
    },
  });
}

/**
 * Apply a pure pick/rename wire map.
 *
 * @param {unknown} value
 * @param {Record<string, string>|null|undefined} map
 * @returns {unknown}
 */
export function applyWireMap(value, map) {
  if (!map) return value;
  let mapped = {};
  for (let [source, target] of Object.entries(map)) {
    let selected = readPath(value, source);
    if (selected !== undefined) writePath(mapped, target, selected);
  }
  return mapped;
}

/**
 * Compile one validated wire to endpoint tokens and subscription descriptors.
 *
 * @param {Object} wire
 * @param {number} [index]
 * @param {Object} [options]
 * @returns {Object}
 */
export function compileWire(wire, index = 0, options = {}) {
  if (!isObject(wire)) throw new Error('compileWire requires a wire object.');
  if (!hasText(wire.id)) throw new Error('compileWire requires wire.id.');

  let mode = wire.mode ?? 'one-way';
  if (mode !== 'one-way' && mode !== 'two-way') {
    throw new Error(`Wire "${wire.id}" mode must be one-way or two-way.`);
  }

  let fromEndpoint = parseWorkspaceEndpoint(wire.from, { position: 'from' });
  let toEndpoint = parseWorkspaceEndpoint(wire.to, { position: 'to' });
  validateEndpointPair(fromEndpoint, toEndpoint);

  if (mode === 'two-way') {
    if (endpointDirection(fromEndpoint) !== 'bidirectional') {
      throw new Error(`Wire "${wire.id}" two-way from endpoint must be bidirectional.`);
    }
    if (endpointDirection(toEndpoint) !== 'bidirectional') {
      throw new Error(`Wire "${wire.id}" two-way to endpoint must be bidirectional.`);
    }
    invertMap(wire.map || null);
  }

  validateRtTarget(fromEndpoint, toEndpoint, options.config);

  let from = endpointToToken(fromEndpoint);
  let to = endpointToToken(toEndpoint);
  validateMapSchema(wire, from, options);

  let compiled = {
    id: wire.id,
    index,
    mode,
    source: wire,
    from,
    to,
    map: wire.map || null,
    subscriptions: [],
    wildcardSubscriptions: [],
  };

  if (from.isPattern) {
    compiled.wildcardSubscriptions.push(createWildcardSubscription(compiled));
  } else {
    compiled.subscriptions.push(...createConcreteDescriptors(wire, from, to));
  }

  return Object.freeze({
    ...compiled,
    subscriptions: Object.freeze(compiled.subscriptions),
    wildcardSubscriptions: Object.freeze(compiled.wildcardSubscriptions),
  });
}

/**
 * Compile a config's wires[] array or a bare wires array.
 *
 * @param {Object|Array<Object>} configOrWires
 * @param {Object} [options]
 * @returns {Object}
 */
export function compileWires(configOrWires, options = {}) {
  let config = Array.isArray(configOrWires) ? options.config || {} : configOrWires || {};
  let wires = Array.isArray(configOrWires) ? configOrWires : config.wires || [];
  if (!Array.isArray(wires)) throw new Error('compileWires requires wires to be an array.');

  let compiledWires = wires.map((wire, index) => compileWire(wire, index, { ...options, config }));
  let subscriptions = compiledWires.flatMap((wire) => wire.subscriptions);
  let wildcardSubscriptions = compiledWires.flatMap((wire) => wire.wildcardSubscriptions);

  let compiled = {
    kind: 'symbiote-workspace:wires',
    observationContext: WIRE_OBSERVATION_CONTEXT,
    wires: Object.freeze(compiledWires),
    subscriptions: Object.freeze(subscriptions),
    wildcardSubscriptions: Object.freeze(wildcardSubscriptions),
    install(installOptions = {}) {
      return installCompiledWires(compiled, installOptions);
    },
  };

  return Object.freeze(compiled);
}

export const compileWorkspaceWires = compileWires;

function contextHas(ctx, prop) {
  if (!ctx) return false;
  if (typeof ctx.has === 'function') return Boolean(ctx.has(prop));
  if (isObject(ctx.store)) return Object.hasOwn(ctx.store, prop);
  return Object.hasOwn(ctx, prop);
}

function contextRead(ctx, prop) {
  if (!ctx) return undefined;
  if (typeof ctx.read === 'function') return ctx.read(prop);
  if (isObject(ctx.store)) return ctx.store[prop];
  return ctx[prop];
}

function contextPublish(ctx, prop, value) {
  if (!ctx) throw new Error(`Cannot publish "${prop}" without a target context.`);
  if (typeof ctx.pub === 'function' && contextHas(ctx, prop)) {
    ctx.pub(prop, value);
    return;
  }
  if (typeof ctx.add === 'function') {
    ctx.add(prop, value, true);
    return;
  }
  ctx[prop] = value;
}

function contextSubscribe(ctx, prop, callback) {
  if (!ctx || typeof ctx.sub !== 'function') return null;
  return ctx.sub(prop, callback, false);
}

function ensureObservationContext(observer) {
  let ctx = observer.get(WIRE_OBSERVATION_CONTEXT);
  if (ctx) return ctx;
  if (typeof observer.registerCtx === 'function') {
    return observer.registerCtx(WIRE_OBSERVATION_CONTEXT, {});
  }
  return null;
}

function emitCycleTelemetry(telemetry, descriptor) {
  let entry = {
    type: 'hook-activity',
    action: 'wire-disabled',
    reason: 'cycle',
    wireId: descriptor.wireId,
    direction: descriptor.direction,
  };
  if (typeof telemetry === 'function') telemetry(entry);
  else if (Array.isArray(telemetry)) telemetry.push(entry);
}

function createRuntimeState(options, observer) {
  return {
    observer,
    disabled: new Set(),
    errors: [],
    installed: new Map(),
    currentDispatch: null,
    equals: options.equals || stableEqual,
    telemetry: options.telemetry || null,
    onRuntimeError: options.onRuntimeError || null,
    throwRuntimeErrors: options.throwRuntimeErrors === true,
  };
}

function publishObservation(state, descriptor, value) {
  queueMicrotask(() => {
    let ctx = ensureObservationContext(state.observer);
    if (!ctx) return;
    let payload = {
      wireId: descriptor.wireId,
      direction: descriptor.direction,
      from: descriptor.from,
      to: descriptor.to,
      value,
    };
    contextPublish(ctx, `${WIRE_OBSERVATION_EVENT_PREFIX}${descriptor.wireId}`, payload);
    contextPublish(ctx, `${WIRE_OBSERVATION_BINDING_PREFIX}${descriptor.wireId}`, payload);
  });
}

function runDescriptor(state, descriptor, value, dispatch) {
  let targetCtx = state.observer.get(descriptor.to.ctxUid);
  let mapped = applyWireMap(value, descriptor.map);
  if (targetCtx && state.equals(contextRead(targetCtx, descriptor.to.prop), mapped)) return;

  if (dispatch.visited.has(descriptor.wireId)) {
    state.disabled.add(descriptor.wireId);
    emitCycleTelemetry(state.telemetry, descriptor);
    let error = new Error(`Wire "${descriptor.wireId}" revisited within one dispatch; disabled for this session.`);
    state.errors.push(error);
    state.onRuntimeError?.(error, descriptor);
    if (state.throwRuntimeErrors) throw error;
    return;
  }
  dispatch.visited.add(descriptor.wireId);

  if (!targetCtx) {
    throw new Error(`Wire "${descriptor.wireId}" target context "${String(descriptor.to.ctxUid)}" is not registered.`);
  }

  let previousDispatch = state.currentDispatch;
  state.currentDispatch = dispatch;
  try {
    contextPublish(targetCtx, descriptor.to.prop, mapped);
  } finally {
    state.currentDispatch = previousDispatch;
  }
  publishObservation(state, descriptor, mapped);
}

function createHandler(state, descriptor) {
  return (value) => {
    if (state.disabled.has(descriptor.wireId)) return;

    let existingDispatch = state.currentDispatch;
    if (existingDispatch) {
      queueMicrotask(() => {
        if (!state.disabled.has(descriptor.wireId)) runDescriptor(state, descriptor, value, existingDispatch);
      });
      return;
    }

    let dispatch = { visited: new Set() };
    runDescriptor(state, descriptor, value, dispatch);
  };
}

function subscriptionKey(descriptor) {
  return [
    descriptor.wireId,
    descriptor.direction,
    descriptor.from.ctxUid,
    descriptor.from.prop,
    descriptor.to.ctxUid,
    descriptor.to.prop,
  ].join('|');
}

function installDescriptor(state, descriptor) {
  let key = subscriptionKey(descriptor);
  if (state.installed.has(key)) return;
  let ctx = state.observer.get(descriptor.from.ctxUid);
  if (!ctx) return;
  let sub = contextSubscribe(ctx, descriptor.from.prop, createHandler(state, descriptor));
  if (!sub) return;
  state.installed.set(key, {
    remove: () => sub.remove?.(),
    fromCtxUid: descriptor.from.ctxUid,
  });
}

function removeDescriptorsForContext(state, uid) {
  for (let [key, record] of state.installed.entries()) {
    if (record.fromCtxUid !== uid) continue;
    record.remove();
    state.installed.delete(key);
  }
}

/**
 * Install compiled wires over an injected PubSub registry observer.
 *
 * @param {ReturnType<typeof compileWires>} compiled
 * @param {Object} [options]
 * @param {ReturnType<typeof createRegistryObserver>} [options.registryObserver]
 * @param {Map<string|symbol, object>} [options.registry]
 * @param {{ globalStore?: Map<string|symbol, object> }} [options.PubSub]
 * @param {Function|Array} [options.telemetry]
 * @returns {{ close: Function, disabled: Set<string>, observer: object }}
 */
export function installCompiledWires(compiled, options = {}) {
  if (!compiled || compiled.kind !== 'symbiote-workspace:wires') {
    throw new Error('installCompiledWires requires the result of compileWires().');
  }

  let observer = options.registryObserver || createRegistryObserver({
    registry: options.registry,
    PubSub: options.PubSub,
    pollIntervalMs: options.pollIntervalMs,
  });
  let state = createRuntimeState(options, observer);
  let removers = [];

  for (let descriptor of compiled.subscriptions) installDescriptor(state, descriptor);

  let materialize = (uid) => {
    for (let wildcard of compiled.wildcardSubscriptions) {
      for (let descriptor of wildcard.materialize(uid)) installDescriptor(state, descriptor);
    }
  };

  for (let entry of observer.entries()) materialize(entry.uid);

  removers.push(observer.onRegister((entry) => {
    for (let descriptor of compiled.subscriptions) {
      if (descriptor.from.ctxUid === entry.uid) installDescriptor(state, descriptor);
    }
    materialize(entry.uid);
  }));
  removers.push(observer.onDelete((entry) => removeDescriptorsForContext(state, entry.uid)));

  return {
    observer,
    disabled: state.disabled,
    errors: state.errors,
    close() {
      for (let remover of removers) remover.remove();
      for (let record of state.installed.values()) record.remove();
      state.installed.clear();
      if (!options.registryObserver) observer.close();
    },
  };
}

/**
 * Wrap an rt: producer with a throttle. The producer itself is wrapped; PubSub
 * publishing remains untouched.
 *
 * @param {Function} producer
 * @param {Object} [options]
 * @param {number} [options.minIntervalMs]
 * @param {Function} [options.now]
 * @param {Function} [options.schedule]
 * @returns {Function}
 */
export function createRtProducerThrottle(producer, options = {}) {
  if (typeof producer !== 'function') {
    throw new Error('createRtProducerThrottle requires a producer function.');
  }
  let minIntervalMs = Math.max(0, Number(options.minIntervalMs) || 0);
  let now = options.now || (() => Date.now());
  let schedule = options.schedule || ((fn, delay) => setTimeout(fn, delay));
  let lastAt = -Infinity;
  let timer = null;
  let pendingArgs = null;

  return (...args) => {
    if (minIntervalMs === 0 || now() - lastAt >= minIntervalMs) {
      lastAt = now();
      return producer(...args);
    }
    pendingArgs = args;
    if (!timer) {
      timer = schedule(() => {
        timer = null;
        lastAt = now();
        producer(...pendingArgs);
        pendingArgs = null;
      }, minIntervalMs - (now() - lastAt));
    }
    return undefined;
  };
}
