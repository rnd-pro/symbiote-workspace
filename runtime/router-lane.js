import { RT_WORKSPACE_CAPABILITIES } from '../schema/constants.js';
import { createRouteMatcher, buildPathFromPattern, encodeRouteQuery } from './route-matcher.js';

const DEFAULT_GUARD_TIMEOUT_MS = 10000;
const DEFAULT_PARK_EXPIRY_MS = 10000;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function hasText(value) {
  return typeof value === 'string' && value.length > 0;
}

function emptyRouteState() {
  return {
    view: null,
    params: {},
    query: {},
    mount: {},
    denied: null,
    data: {},
  };
}

function readAddress(root, address) {
  let path = address.startsWith('state:') ? address.slice('state:'.length) : address;
  let cursor = root;
  for (let segment of path.split('.')) {
    if (!segment) continue;
    if (!isObject(cursor) && !Array.isArray(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sourceKind(source) {
  if (source === 'agent') return 'agent';
  if (source === 'user' || source === 'human') return 'user';
  if (isObject(source)) {
    if (source.kind === 'agent' || source.principal === 'agent') return 'agent';
    if (source.kind === 'user' || source.kind === 'human' || source.principal === 'human') return 'user';
  }
  return 'user';
}

function normalizeGuardVerdict(value, fallbackDenyReason = 'guard-denied') {
  if (value === undefined || value === null || value === true || value === 'allow') {
    return { action: 'allow' };
  }
  if (value === false || value === 'deny') {
    return { action: 'deny', reason: fallbackDenyReason };
  }
  if (typeof value === 'string') {
    if (value.startsWith('redirect:')) return { action: 'redirect', view: value.slice('redirect:'.length) };
    return { action: 'redirect', view: value };
  }
  if (isObject(value)) {
    let verdict = value.verdict ?? value.action ?? value.status;
    if (verdict === 'allow' || verdict === true) return { action: 'allow' };
    if (verdict === 'redirect') {
      return { action: 'redirect', view: value.view ?? value.viewId ?? value.to };
    }
    if (verdict === 'deny' || verdict === 'denied' || verdict === false) {
      return {
        action: 'deny',
        reason: value.reason ?? fallbackDenyReason,
        requires: value.requires,
      };
    }
  }
  return { action: 'deny', reason: fallbackDenyReason };
}

function withTimeout(promise, ms) {
  let timer;
  let timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ action: 'cancel', reason: 'guard-timeout' }), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function compileMountPattern(basePath) {
  if (!hasText(basePath)) {
    return {
      names: [],
      build: () => '',
      strip: (urlPath) => ({ ok: true, routePath: urlPath, mount: {} }),
    };
  }

  let parts = basePath.split('/').filter(Boolean);
  let names = [];
  for (let part of parts) {
    if (part.startsWith(':')) names.push(part.slice(1));
  }

  function build(mount = {}) {
    if (parts.length === 0) return '';
    let built = parts.map((part) => {
      if (!part.startsWith(':')) return part;
      let name = part.slice(1);
      if (mount[name] == null) throw new Error(`Mount param "${name}" is required.`);
      return encodeURIComponent(String(mount[name]));
    });
    return `/${built.join('/')}`;
  }

  function strip(urlPath) {
    let path = hasText(urlPath) ? urlPath : '/';
    let pathParts = path.split('/').filter(Boolean);
    if (pathParts.length < parts.length) return { ok: false };
    let mount = {};
    for (let index = 0; index < parts.length; index++) {
      let expected = parts[index];
      let actual = pathParts[index];
      if (expected.startsWith(':')) {
        mount[expected.slice(1)] = decodeURIComponent(actual);
      } else if (expected !== actual) {
        return { ok: false };
      }
    }
    let rest = pathParts.slice(parts.length).join('/');
    return {
      ok: true,
      mount,
      routePath: rest ? `/${rest}` : '/',
    };
  }

  return { names, build, strip };
}

function splitRouteUrl(routeUrl) {
  let [path, search = ''] = routeUrl.split('?');
  return { path: path || '/', search: search ? `?${search}` : '' };
}

function routeGuards(route, edge) {
  return asArray(route?.guards).filter((guard) => isObject(guard) && guard.on === edge);
}

function guardRequires(route) {
  return routeGuards(route, 'enter')
    .map((guard) => guard.requires)
    .filter((requires) => typeof requires === 'string');
}

function capabilityRecord(snapshot, capability) {
  if (!isObject(snapshot)) return undefined;
  if (isObject(snapshot.capabilities)) return snapshot.capabilities[capability];
  return snapshot[capability];
}

function isAllowedCapability(record) {
  return isObject(record) && record.auth?.policy === 'allow';
}

function loaderArgs(source = {}, params, query, mount) {
  let args = {};
  for (let [key, value] of Object.entries(source.args || {})) {
    if (typeof value !== 'string' || !value.startsWith('$')) {
      args[key] = cloneJson(value);
      continue;
    }
    let [, kind, name] = /^\$(params|query|mount)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(value) || [];
    if (kind === 'params') args[key] = params[name];
    if (kind === 'query') args[key] = query[name];
    if (kind === 'mount') args[key] = mount[name];
  }
  return args;
}

/**
 * Create a per-workspace router lane. The lane is Node-safe and owns only
 * runtime route state/events; it does not install a browser singleton router.
 */
export function createRouter(config = {}, options = {}) {
  let matcher = options.matcher || createRouteMatcher(config);
  let mode = options.mode || 'memory';
  let mountPattern = compileMountPattern(options.basePath || '');
  let mountParams = options.mount ? cloneJson(options.mount) : {};
  let state = emptyRouteState();
  let current = null;
  let location = null;
  let listeners = new Map();
  let eventLog = [];
  let gateVerdicts = new Map(Object.entries(options.gateVerdicts || {}));
  let gateWaiters = new Map();
  let counters = { user: 0, agent: 0 };
  state.mount = cloneJson(mountParams);

  function emit(subject, payload = {}) {
    let event = { subject, payload: cloneJson(payload) };
    eventLog.push(event);
    for (let handler of listeners.get(subject) || []) handler(event);
    for (let handler of listeners.get('*') || []) handler(event);
    return event;
  }

  function on(subject, handler) {
    if (!listeners.has(subject)) listeners.set(subject, new Set());
    listeners.get(subject).add(handler);
    return () => listeners.get(subject)?.delete(handler);
  }

  function nextIntentId(source) {
    let kind = sourceKind(source);
    counters[kind] += 1;
    return `navigate.${kind}:${counters[kind]}`;
  }

  function routePathFromUrl(url) {
    if (mode === 'hash') {
      let hash = String(url).startsWith('#') ? String(url).slice(1) : new URL(String(url), 'http://router.local').hash.slice(1);
      return { routeUrl: hash || '/', mount: mountParams };
    }

    let parsed = new URL(String(url), 'http://router.local');
    let stripped = mountPattern.strip(parsed.pathname);
    if (!stripped.ok) {
      return { routeUrl: `${parsed.pathname}${parsed.search}`, mount: mountParams, baseMismatch: true };
    }
    return {
      routeUrl: `${stripped.routePath}${parsed.search}`,
      mount: stripped.mount,
      baseMismatch: false,
    };
  }

  function locationFromRouteUrl(routeUrl, mount = mountParams) {
    let { path, search } = splitRouteUrl(routeUrl);
    let base = mountPattern.build(mount);
    if (mode === 'hash') return `${base}#${path}${search}`;
    if (!base) return `${path}${search}`;
    return `${base}${path === '/' ? '/' : path}${search}`;
  }

  function resetForMount(nextMount) {
    current = null;
    state = emptyRouteState();
    state.mount = cloneJson(nextMount);
    emit('route:reset', { mount: cloneJson(nextMount) });
  }

  function applyMount(nextMount) {
    if (sameJson(mountParams, nextMount)) return;
    mountParams = cloneJson(nextMount);
    resetForMount(mountParams);
  }

  function publishRoute(match, data) {
    state.view = match.viewId;
    state.params = cloneJson(match.params);
    state.query = cloneJson(match.query);
    state.mount = cloneJson(mountParams);
    state.denied = null;
    state.data = cloneJson(data || {});
  }

  function publishDenied(denied) {
    state.denied = cloneJson(denied);
    emit(`route:denied:${denied.view}`, denied);
  }

  function snapshot() {
    if (typeof options.capabilitySnapshot === 'function') {
      let value = options.capabilitySnapshot();
      return value && typeof value.then === 'function' ? null : value;
    }
    return options.capabilitySnapshot;
  }

  async function evaluateCapabilityGuard(guard) {
    let snap = snapshot();
    let record = capabilityRecord(snap, guard.requires);
    if (!record) {
      return { action: 'deny', reason: 'capability-unknown', requires: guard.requires };
    }
    if (!isAllowedCapability(record)) {
      return { action: 'deny', reason: 'capability-denied', requires: guard.requires };
    }
    return { action: 'allow' };
  }

  async function evaluateHookGuard(guard, context, edge) {
    let runner = options.runGuard || options.guardHooks?.[guard.hook];
    if (typeof runner !== 'function') {
      return { action: edge === 'leave' ? 'cancel' : 'deny', reason: 'guard-hook-missing' };
    }
    let value = await runner({ ...context, guard, hook: guard.hook, edge });
    return normalizeGuardVerdict(value, edge === 'leave' ? 'guard-cancelled' : 'guard-denied');
  }

  async function evaluateGuard(guard, context, edge) {
    if (hasText(guard.requires)) return evaluateCapabilityGuard(guard);
    if (hasText(guard.hook)) return evaluateHookGuard(guard, context, edge);
    return { action: edge === 'leave' ? 'cancel' : 'deny', reason: 'guard-invalid' };
  }

  async function runEnterGuards(match, intentId, from) {
    let context = {
      intentId,
      from,
      to: match.viewId,
      params: cloneJson(match.params),
      query: cloneJson(match.query),
      mount: cloneJson(mountParams),
      route: match.route,
    };
    for (let guard of routeGuards(match.route, 'enter')) {
      let verdict = await evaluateGuard(guard, context, 'enter');
      if (verdict.action === 'allow') continue;
      if (verdict.action === 'redirect') return verdict;
      return {
        action: 'deny',
        denied: {
          view: match.viewId,
          reason: verdict.reason || 'guard-denied',
          requires: verdict.requires ?? guard.requires,
        },
      };
    }
    return { action: 'allow' };
  }

  async function runLeaveGuards(target, intentId) {
    if (!current) return { action: 'allow' };
    let context = {
      intentId,
      from: current.viewId,
      to: target.viewId,
      params: cloneJson(current.params),
      query: cloneJson(current.query),
      mount: cloneJson(mountParams),
      route: current.route,
    };
    for (let guard of routeGuards(current.route, 'leave')) {
      let verdict;
      try {
        verdict = await withTimeout(
          Promise.resolve(evaluateGuard(guard, context, 'leave')),
          options.guardTimeoutMs || DEFAULT_GUARD_TIMEOUT_MS,
        );
      } catch (error) {
        return { action: 'cancel', reason: error.message || 'guard-error' };
      }
      if (verdict.action === 'allow') continue;
      if (verdict.action === 'redirect') return verdict;
      return { action: 'cancel', reason: verdict.reason || 'guard-cancelled' };
    }
    return { action: 'allow' };
  }

  function gateVerdictFor(viewId) {
    let direct = gateVerdicts.get(viewId);
    if (direct !== undefined) return direct;
    if (typeof options.getGateVerdict !== 'function') return undefined;
    let verdict = options.getGateVerdict({ viewId, route: current?.route });
    return isObject(verdict) ? verdict.status : verdict;
  }

  async function waitForGateRelease(intentId) {
    if (!current) return;
    let verdict = gateVerdictFor(current.viewId);
    if (verdict !== 'pendingApproval') return;
    emit(`route:hold:${current.viewId}`, { intentId, view: current.viewId });
    let expiryMs = options.parkExpiryMs || DEFAULT_PARK_EXPIRY_MS;
    await new Promise((resolve) => {
      let timer = setTimeout(resolve, expiryMs);
      if (!gateWaiters.has(current.viewId)) gateWaiters.set(current.viewId, new Set());
      let waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      gateWaiters.get(current.viewId).add(waiter);
    });
  }

  async function runLoaders(match, intentId) {
    let data = {};
    for (let loader of asArray(match.route?.data)) {
      if (!isObject(loader) || !hasText(loader.id)) continue;
      let runner = options.runLoader || options.loaders?.[loader.id];
      if (typeof runner !== 'function') continue;
      data[loader.id] = await runner({
        intentId,
        loader,
        source: loader.source,
        args: loaderArgs(loader.source, match.params, match.query, mountParams),
        params: cloneJson(match.params),
        query: cloneJson(match.query),
        mount: cloneJson(mountParams),
      });
    }
    return data;
  }

  function targetFromInput(to) {
    if (isObject(to) && isObject(to.to)) return targetFromInput(to.to);
    if (isObject(to) && hasText(to.url)) return routePathFromUrl(to.url);
    if (isObject(to) && hasText(to.view)) {
      return {
        routeUrl: matcher.urlForView(to.view, to.params || {}, to.query || {}),
        mount: mountParams,
      };
    }
    throw new Error('navigate requires to:{ view, params?, query? } or to:{ url }.');
  }

  function resolveTarget(to) {
    let target = targetFromInput(to);
    applyMount(target.mount || {});
    let resolved = matcher.resolve(target.routeUrl);
    return { target, resolved };
  }

  async function finishNavigation(match, routeUrl, history, intentId, from) {
    location = locationFromRouteUrl(routeUrl);
    if (current) {
      emit(`route:exit:${current.viewId}`, { to: match.viewId });
      current = null;
    }

    let enter = await runEnterGuards(match, intentId, from);
    if (enter.action === 'redirect') {
      return navigate({ to: { view: enter.view }, history: 'replace', source: 'agent' });
    }
    if (enter.action === 'deny') {
      publishDenied(enter.denied);
      return { ok: false, status: 'denied', reason: enter.denied.reason, denied: cloneJson(enter.denied), intentId };
    }

    let data = await runLoaders(match, intentId);
    current = {
      viewId: match.viewId,
      route: match.route,
      params: cloneJson(match.params),
      query: cloneJson(match.query),
      url: routeUrl,
    };
    publishRoute(match, data);
    emit(`route:enter:${match.viewId}`, {
      params: cloneJson(match.params),
      query: cloneJson(match.query),
      from,
    });
    return {
      ok: true,
      status: 'navigated',
      intentId,
      history,
      view: match.viewId,
      params: cloneJson(match.params),
      query: cloneJson(match.query),
      url: location,
    };
  }

  async function navigate(request, optionsForNavigation = {}) {
    let to = request?.to ? request.to : request;
    let history = request?.history || optionsForNavigation.history || 'push';
    let source = request?.source ?? optionsForNavigation.source;
    let intentId = nextIntentId(source);
    let { resolved } = resolveTarget({ to });
    if (resolved.type !== 'route') {
      return {
        ok: false,
        status: 'cancelled',
        reason: resolved.error?.code || 'route-not-found',
        intentId,
        redirects: cloneJson(resolved.redirects),
      };
    }

    let match = resolved.match;
    let from = current?.viewId ?? null;
    await waitForGateRelease(intentId);
    let leave = await runLeaveGuards(match, intentId);
    if (leave.action === 'redirect') {
      let redirected = resolveTarget({ to: { view: leave.view } });
      if (redirected.resolved.type !== 'route') {
        return { ok: false, status: 'cancelled', reason: 'leave-redirect-unresolved', intentId };
      }
      match = redirected.resolved.match;
      resolved = redirected.resolved;
    } else if (leave.action !== 'allow') {
      return { ok: false, status: 'cancelled', reason: leave.reason, intentId };
    }

    return finishNavigation(match, resolved.url, history, intentId, from);
  }

  async function rerunCurrentEnterGuards() {
    if (!current) return { ok: true, status: 'idle' };
    let match = matcher.match(current.url);
    if (!match || match.type !== 'route') return { ok: false, status: 'cancelled', reason: 'route-not-found' };
    let verdict = await runEnterGuards(match, 'capabilities.readiness', current.viewId);
    if (verdict.action === 'allow') {
      state.denied = null;
      return { ok: true, status: 'accepted' };
    }
    if (verdict.action === 'deny') {
      publishDenied(verdict.denied);
      return { ok: false, status: 'denied', denied: cloneJson(verdict.denied) };
    }
    return navigate({ to: { view: verdict.view }, history: 'replace', source: 'agent' });
  }

  function readinessChangedIntersects(payload = {}) {
    if (!current) return false;
    let changed = new Set(asArray(payload.changed || payload.capabilities || payload.requires));
    if (changed.has('*')) return true;
    let requires = guardRequires(current.route);
    return requires.some((item) => item === '*' || changed.has(item));
  }

  async function handleRuntimeEvent(subject, payload) {
    if (subject !== RT_WORKSPACE_CAPABILITIES && subject !== 'rt:workspace:capabilities') {
      return { ok: true, status: 'ignored' };
    }
    if (payload?.type !== 'readiness-changed' && payload?.event !== 'readiness-changed') {
      return { ok: true, status: 'ignored' };
    }
    if (!readinessChangedIntersects(payload)) return { ok: true, status: 'ignored' };
    return rerunCurrentEnterGuards();
  }

  async function writeBinding(address, value, writeOptions = {}) {
    if (!current) return { ok: false, status: 'idle' };
    if (address.startsWith('state:route.')) {
      return { ok: false, status: 'read-only', address };
    }
    let param = asArray(current.route?.params).find((entry) => (
      entry?.binding === address && entry?.sync === 'two-way'
    ));
    if (param) {
      return navigate({
        to: {
          view: current.viewId,
          params: { ...current.params, [param.name]: value },
          query: current.query,
        },
        history: writeOptions.history || 'push',
        source: writeOptions.source || 'user',
      });
    }
    let query = asArray(current.route?.query).find((entry) => entry?.binding === address);
    if (query) {
      return navigate({
        to: {
          view: current.viewId,
          params: current.params,
          query: { ...current.query, [query.name]: value },
        },
        history: writeOptions.history || query.history || 'replace',
        source: writeOptions.source || 'user',
      });
    }
    return { ok: false, status: 'unhandled', address };
  }

  function setGateVerdict(viewId, verdict) {
    gateVerdicts.set(viewId, isObject(verdict) ? verdict.status : verdict);
    for (let waiter of gateWaiters.get(viewId) || []) waiter();
    gateWaiters.delete(viewId);
  }

  function resolve(to) {
    let { target, resolved } = resolveTarget({ to });
    return {
      ...resolved,
      location: resolved.type === 'route' ? locationFromRouteUrl(resolved.url, target.mount) : null,
    };
  }

  function routeUrlForView(view, params = {}, query = {}) {
    let match = matcher.entries.find((entry) => entry.type === 'route' && entry.viewId === view);
    if (!match) throw new Error(`No routed view "${view}" exists.`);
    return `${buildPathFromPattern(match.pattern, params)}${encodeRouteQuery(match.route, query)}`;
  }

  return {
    mode,
    matcher,
    on,
    emit,
    navigate,
    resolve,
    writeBinding,
    handleRuntimeEvent,
    rerunCurrentEnterGuards,
    setGateVerdict,
    routeUrlForView,
    get location() {
      return location;
    },
    get current() {
      return current ? cloneJson(current) : null;
    },
    get events() {
      return cloneJson(eventLog);
    },
    getState(address) {
      let root = { route: state };
      return address ? cloneJson(readAddress(root, address)) : cloneJson(state);
    },
  };
}

export default createRouter;
