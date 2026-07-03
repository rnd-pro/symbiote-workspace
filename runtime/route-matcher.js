import { PORTABLE_ID_PATTERN } from '../schema/constants.js';

const LOCAL_ORIGIN = 'http://symbiote-workspace.local';
const PARAM_SEGMENT = /^:([A-Za-z_][A-Za-z0-9_]*)(\+)?$/;
const REDIRECT_HOP_LIMIT = 3;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasText(value) {
  return typeof value === 'string' && value.length > 0;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeDecodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function splitPattern(pattern) {
  if (pattern === '/') return [];
  return pattern.slice(1).split('/');
}

function splitPathname(pathname) {
  let path = hasText(pathname) ? pathname : '/';
  if (!path.startsWith('/')) path = `/${path}`;
  if (path === '/') return [];
  return path.slice(1).split('/');
}

function inputToUrl(input) {
  if (input instanceof URL) return input;
  if (isObject(input) && typeof input.url === 'string') return new URL(input.url, LOCAL_ORIGIN);
  if (typeof input === 'string') return new URL(input, LOCAL_ORIGIN);
  throw new Error('Route input must be a URL, URL string, or { url }.');
}

function pathWithSearch(url) {
  return `${url.pathname}${url.search}`;
}

function buildPlatformPattern(pattern) {
  if (typeof URLPattern !== 'function') return null;
  try {
    return new URLPattern({ pathname: pattern });
  } catch {
    return null;
  }
}

function compileSegments(pattern) {
  return splitPattern(pattern).map((segment) => {
    if (segment === '*') return { type: 'wildcard' };
    let param = PARAM_SEGMENT.exec(segment);
    if (param) {
      return { type: 'param', name: param[1], rest: param[2] === '+' };
    }
    return { type: 'static', value: safeDecodeSegment(segment) ?? segment };
  });
}

function patternMetrics(pattern) {
  let staticSegments = 0;
  let paramCount = 0;
  for (let segment of splitPattern(pattern)) {
    if (segment === '*' || segment === '') continue;
    if (PARAM_SEGMENT.test(segment)) {
      paramCount += 1;
    } else {
      staticSegments += 1;
    }
  }
  return { staticSegments, paramCount, patternLength: pattern.length };
}

function declaredParams(route) {
  let params = new Map();
  for (let param of asArray(route?.params)) {
    if (isObject(param) && hasText(param.name)) params.set(param.name, param);
  }
  return params;
}

function decodeTypedParam(value, param) {
  let type = param?.type ?? 'string';
  if (type === 'string') return { ok: true, value };
  if (type === 'path') return { ok: true, value };
  if (type === 'int') {
    if (!/^-?\d+$/.test(value)) return { ok: false };
    let number = Number(value);
    if (!Number.isSafeInteger(number)) return { ok: false };
    return { ok: true, value: number };
  }
  if (type === 'id') {
    return PORTABLE_ID_PATTERN.test(value) ? { ok: true, value } : { ok: false };
  }
  if (type === 'enum') {
    if (Array.isArray(param?.values)) {
      return param.values.includes(value) ? { ok: true, value } : { ok: false };
    }
    if (isObject(param?.values) && param.values.$resources === true) {
      return PORTABLE_ID_PATTERN.test(value) ? { ok: true, value } : { ok: false };
    }
    return { ok: false };
  }
  return { ok: false };
}

function matchCompiledSegments(entry, pathname) {
  if (entry.platformPattern && !entry.platformPattern.test({ pathname })) return null;

  let pathSegments = splitPathname(pathname);
  let params = {};
  let paramSpecs = declaredParams(entry.route);
  let pathIndex = 0;

  for (let segment of entry.segments) {
    if (segment.type === 'wildcard') {
      return params;
    }

    if (pathIndex >= pathSegments.length) return null;
    let raw = pathSegments[pathIndex];

    if (segment.type === 'static') {
      let decoded = safeDecodeSegment(raw);
      if (decoded === undefined || decoded !== segment.value) return null;
      pathIndex += 1;
      continue;
    }

    let param = paramSpecs.get(segment.name);
    if (segment.rest) {
      if (param?.type !== 'path') return null;
      let rest = pathSegments.slice(pathIndex);
      if (rest.length === 0 || rest.join('/').length === 0) return null;
      let decoded = [];
      for (let item of rest) {
        let value = safeDecodeSegment(item);
        if (value === undefined) return null;
        decoded.push(value);
      }
      let typed = decodeTypedParam(decoded.join('/'), param);
      if (!typed.ok) return null;
      params[segment.name] = typed.value;
      pathIndex = pathSegments.length;
      continue;
    }

    if (raw === '') return null;
    let decoded = safeDecodeSegment(raw);
    if (decoded === undefined) return null;
    let typed = decodeTypedParam(decoded, param);
    if (!typed.ok) return null;
    params[segment.name] = typed.value;
    pathIndex += 1;
  }

  return pathIndex === pathSegments.length ? params : null;
}

function decodeQueryValue(codec, value) {
  if (value == null) return undefined;
  if (codec === 'int') {
    if (!/^-?\d+$/.test(value)) return undefined;
    let number = Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
  }
  if (codec === 'csv') return value === '' ? [] : value.split(',');
  if (codec === 'json') {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (codec === 'sort-tuple') {
    let [field, direction] = value.split(':');
    return field ? { field, direction: direction || 'asc' } : undefined;
  }
  if (codec === 'date-range') {
    let [from, to] = value.split('..');
    return from || to ? { from: from || null, to: to || null } : undefined;
  }
  return value;
}

function decodeQuery(route, searchParams) {
  let query = {};
  for (let spec of asArray(route?.query)) {
    if (!isObject(spec) || !hasText(spec.name) || !searchParams.has(spec.name)) continue;
    let codec = spec.codec || 'string';
    let value = decodeQueryValue(codec, searchParams.get(spec.name));
    if (value !== undefined) query[spec.name] = value;
  }
  return query;
}

function encodeQueryValue(codec, value) {
  if (codec === 'int') {
    if (!Number.isInteger(value)) throw new Error(`Query value ${value} is not an integer.`);
    return String(value);
  }
  if (codec === 'csv') return Array.isArray(value) ? value.join(',') : String(value);
  if (codec === 'json') return JSON.stringify(value);
  if (codec === 'sort-tuple') {
    if (Array.isArray(value)) return value.join(':');
    if (isObject(value)) return `${value.field}:${value.direction ?? value.dir ?? 'asc'}`;
    return String(value);
  }
  if (codec === 'date-range') {
    if (Array.isArray(value)) return `${value[0] ?? ''}..${value[1] ?? ''}`;
    if (isObject(value)) return `${value.from ?? value.start ?? ''}..${value.to ?? value.end ?? ''}`;
    return String(value);
  }
  return String(value);
}

function equivalentJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function encodeRouteQuery(route, query = {}) {
  let search = new URLSearchParams();
  for (let spec of asArray(route?.query)) {
    if (!isObject(spec) || !hasText(spec.name)) continue;
    let value = query[spec.name];
    if (value == null) continue;
    if (spec.default !== undefined && equivalentJson(value, spec.default)) continue;
    search.set(spec.name, encodeQueryValue(spec.codec || 'string', value));
  }
  let text = search.toString();
  return text ? `?${text}` : '';
}

function encodePathValue(value, rest) {
  if (value == null) throw new Error('Route param value is required.');
  if (!rest) return encodeURIComponent(String(value));
  let parts = String(value).split('/');
  if (parts.length === 0 || parts.join('').length === 0) {
    throw new Error('Rest route param value must contain at least one path segment.');
  }
  return parts.map((part) => encodeURIComponent(part)).join('/');
}

function buildPathFromPattern(pattern, params = {}) {
  let parts = [];
  for (let segment of splitPattern(pattern)) {
    if (segment === '*') continue;
    let param = PARAM_SEGMENT.exec(segment);
    if (param) {
      parts.push(encodePathValue(params[param[1]], param[2] === '+'));
    } else {
      parts.push(segment);
    }
  }
  return `/${parts.join('/')}`;
}

function interpolateTemplate(template, params = {}) {
  let parts = [];
  for (let segment of splitPattern(template)) {
    if (segment === '*') continue;
    let param = PARAM_SEGMENT.exec(segment);
    if (param) {
      if (!(param[1] in params)) return null;
      parts.push(encodePathValue(params[param[1]], param[2] === '+'));
    } else {
      parts.push(segment);
    }
  }
  return `/${parts.join('/')}`;
}

function redirectTarget(entry, match, currentUrl) {
  let target = interpolateTemplate(entry.redirect.to, match.params);
  if (!target) return null;
  if (!target.includes('?') && currentUrl.search) return `${target}${currentUrl.search}`;
  return target;
}

function compileEntry(source, index) {
  let pattern = source.pattern;
  let metrics = patternMetrics(pattern);
  let isFallback = source.type === 'route' && source.route.kind === 'fallback';
  return {
    ...source,
    index,
    pattern,
    normalizedPattern: normalizeRoutePattern(pattern),
    segments: compileSegments(pattern),
    platformPattern: buildPlatformPattern(pattern),
    isFallback,
    order: Number.isFinite(source.route?.order) ? source.route.order : undefined,
    ...metrics,
  };
}

function compareEntries(left, right) {
  if (left.isFallback !== right.isFallback) return left.isFallback ? 1 : -1;
  let leftOrder = left.order === undefined ? Infinity : left.order;
  let rightOrder = right.order === undefined ? Infinity : right.order;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  if (left.staticSegments !== right.staticSegments) {
    return right.staticSegments - left.staticSegments;
  }
  if (left.paramCount !== right.paramCount) return left.paramCount - right.paramCount;
  if (left.patternLength !== right.patternLength) {
    return right.patternLength - left.patternLength;
  }
  if (left.pattern < right.pattern) return -1;
  if (left.pattern > right.pattern) return 1;
  return left.index - right.index;
}

function viewRouteEntries(config) {
  let entries = [];
  for (let view of asArray(config?.views)) {
    if (!isObject(view) || !hasText(view.id) || !isObject(view.route)) continue;
    let route = { kind: 'normal', ...view.route };
    if (!hasText(route.pattern)) continue;
    entries.push({
      type: 'route',
      viewId: view.id,
      route,
      view,
      pattern: route.pattern,
    });
  }
  return entries;
}

function redirectEntries(config) {
  let entries = [];
  for (let redirect of asArray(config?.redirects)) {
    if (!isObject(redirect) || !hasText(redirect.pattern) || !hasText(redirect.to)) continue;
    entries.push({
      type: 'redirect',
      redirect,
      redirectId: redirect.id,
      route: {},
      pattern: redirect.pattern,
    });
  }
  return entries;
}

function toMatch(entry, url, params) {
  let query = entry.type === 'route' ? decodeQuery(entry.route, url.searchParams) : {};
  let base = {
    type: entry.type,
    entry,
    pattern: entry.pattern,
    normalizedPattern: entry.normalizedPattern,
    params,
    query,
    pathname: url.pathname,
    search: url.search,
    url: pathWithSearch(url),
  };
  if (entry.type === 'redirect') {
    return {
      ...base,
      redirect: entry.redirect,
      redirectId: entry.redirectId,
      permanent: entry.redirect.permanent === true,
      status: entry.redirect.permanent === true ? 301 : 302,
    };
  }
  return {
    ...base,
    view: entry.view,
    viewId: entry.viewId,
    route: entry.route,
    kind: entry.route.kind,
  };
}

/**
 * Normalises a route pattern for duplicate detection using the W1 ROUTES rule:
 * parameter names collapse to a positional placeholder.
 */
export function normalizeRoutePattern(pattern) {
  if (typeof pattern !== 'string') {
    throw new Error('Route pattern must be a string.');
  }
  return pattern
    .split('/')
    .map((segment) => (segment.startsWith(':') ? ':param' : segment))
    .join('/');
}

/**
 * Compile the W1 `views[].route` and top-level `redirects[]` vocabulary into the
 * single shared route match table.
 */
export function createRouteMatcher(config = {}) {
  let entries = [...viewRouteEntries(config), ...redirectEntries(config)]
    .map((entry, index) => compileEntry(entry, index))
    .sort(compareEntries);
  let routeEntries = entries.filter((entry) => entry.type === 'route');

  function match(input) {
    let url = inputToUrl(input);
    for (let entry of entries) {
      let params = matchCompiledSegments(entry, url.pathname);
      if (params) return toMatch(entry, url, params);
    }
    return null;
  }

  function resolve(input, options = {}) {
    let hopLimit = Number.isInteger(options.hopLimit) ? options.hopLimit : REDIRECT_HOP_LIMIT;
    let current = inputToUrl(input);
    let redirects = [];
    let seen = new Set([pathWithSearch(current)]);

    while (true) {
      let found = match(current);
      if (!found) {
        return { type: 'none', match: null, redirects, url: pathWithSearch(current) };
      }
      if (found.type !== 'redirect') {
        return {
          type: 'route',
          match: found,
          redirects,
          status: redirects[0]?.status,
          url: pathWithSearch(current),
        };
      }
      if (redirects.length >= hopLimit) {
        return {
          type: 'redirect-limit',
          match: found,
          redirects,
          url: pathWithSearch(current),
          error: { code: 'route.redirect.hop_limit', hopLimit },
        };
      }
      let target = redirectTarget(found.entry, found, current);
      if (!target) {
        return {
          type: 'redirect-unresolved',
          match: found,
          redirects,
          url: pathWithSearch(current),
          error: { code: 'route.redirect.unresolved_target' },
        };
      }
      redirects.push({
        id: found.redirectId,
        from: pathWithSearch(current),
        to: target,
        permanent: found.permanent,
        status: found.status,
      });
      if (seen.has(target)) {
        return {
          type: 'redirect-cycle',
          match: found,
          redirects,
          url: target,
          error: { code: 'route.redirect.cycle' },
        };
      }
      seen.add(target);
      current = inputToUrl(target);
    }
  }

  function urlForView(viewId, params = {}, query = {}) {
    let entry = routeEntries.find((candidate) => candidate.viewId === viewId);
    if (!entry) throw new Error(`No routed view "${viewId}" exists.`);
    let path = buildPathFromPattern(entry.pattern, params);
    return `${path}${encodeRouteQuery(entry.route, query)}`;
  }

  return Object.freeze({
    entries: Object.freeze(entries.map((entry) => Object.freeze({ ...entry, segments: cloneJson(entry.segments) }))),
    match,
    resolve,
    urlForView,
    normalizePattern: normalizeRoutePattern,
  });
}

export {
  REDIRECT_HOP_LIMIT,
  buildPathFromPattern,
  encodeRouteQuery,
};
