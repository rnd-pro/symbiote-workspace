import {
  ROUTE_QUERY_CODECS,
  ROUTE_RESERVED_QUERY,
  RESOURCE_OPERATIONS,
} from '../constants.js';

/**
 * ROUTES section — the schema/validation half of Section 5 (ROUTES & SSR).
 *
 * Owns the full shape of `views[].route`, the top-level `redirects[]`, and the
 * `route:*` WAS subject space. The matcher/router runtime (runtime/route-matcher.js,
 * per-workspace router, dataLoader executor, restoration queue) is a later wave —
 * this module only declares and validates the portable route vocabulary.
 *
 * Routing is a property OF views, not a parallel noun: routes live at
 * `config.views[i].route` and there is no `routes[]` array. `redirects[]` is the
 * ONLY redirect carrier — redirect-kind view routes are dropped (L1 ruling 3), so
 * `kind ∈ normal | fallback` and a redirect never has view identity, nav
 * participation, or a lifecycle.
 *
 * Outbound references (view routing subjects excepted) are resolved here against
 * the declared portable config the validator already receives — `data.resources`,
 * `data.collections`, `content.collections`, `assets`, and `hooks`. Existence
 * alone is never sufficient for these checks (resource op availability, guard hook
 * class, the R7 `$resources` contract all need the sibling declaration's
 * attributes), so they run in the shape pass rather than the id-only referential
 * pass. The `route:*` subject space that OTHER sections consume (hooks/wires firing
 * on `route:enter`/`route:exit`) is the one thing this section publishes, through
 * {@link routesSection.refProviders}; a hook/wire naming a `route:*` subject of an
 * unrouted view resolves to nothing and is reported by the core referential pass.
 */

/** Route kinds — `redirect` is intentionally absent (L1 ruling 3). */
export const ROUTE_KINDS = Object.freeze(['normal', 'fallback']);

/** `params[].type` — `path` unlocks the `:name+` rest segment (C4). */
export const ROUTE_PARAM_TYPES = Object.freeze(['string', 'int', 'id', 'enum', 'path']);

/** `params[].sync` — URL⇄field synchronisation mode (S8-S3), default `enter`. */
export const ROUTE_PARAM_SYNC_MODES = Object.freeze(['enter', 'two-way']);

/** `query[].history` — URL write discipline, default `replace`. */
export const ROUTE_QUERY_HISTORY_MODES = Object.freeze(['push', 'replace']);

/** `guards[].on` — lifecycle edge a guard evaluates on. */
export const ROUTE_GUARD_EVENTS = Object.freeze(['enter', 'leave']);

/** Guard hook class required for a `guards[].hook` reference. */
export const ROUTE_GUARD_HOOK_CLASS = 'guard';

/** `meta.hreflang: 'auto'` derives alternates from the i18n locale strategy. */
export const ROUTE_HREFLANG_AUTO = 'auto';

/**
 * Normative precedence total order (§3), recorded as schema documentation for the
 * single future matcher (runtime/route-matcher.js). Candidates are ordered by these
 * keys; the FIRST route whose pattern matches AND whose typed params decode wins.
 * `kind:'fallback'` always sorts last. Identical normalized patterns are a
 * validation error because order cannot disambiguate an exact duplicate.
 */
export const ROUTE_PRECEDENCE_KEYS = Object.freeze([
  'order', // explicit `order` ascending; unset sorts after all set values
  'staticSegments', // static-segment count descending
  'paramCount', // param count ascending
  'patternLength', // pattern length descending
  'lexicographic', // codepoint-lexicographic pattern — final total-order tiebreak
]);

const PARAM_SEGMENT = /^:([A-Za-z_][A-Za-z0-9_]*)(\+)?$/;
const STATIC_SEGMENT_RESERVED = /[:*?+(){}\[\]\\]/;
const ARG_REFERENCE = /^\$(params|query|mount)\.([A-Za-z_][A-Za-z0-9_]*)$/;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isStateAddress(value) {
  return typeof value === 'string' && value.startsWith('state:');
}

function isResourcesToken(value) {
  return isObject(value) && value.$resources === true;
}

/**
 * Builds the read-only index of sibling declarations this section resolves its
 * references against. Reads declared portable config only — never imports a
 * sibling module.
 */
function buildReferenceIndex(config) {
  let resourceOps = new Map();
  for (let resource of asArray(config?.data?.resources)) {
    if (isObject(resource) && isNonEmptyString(resource.id)) {
      let ops = asArray(resource.operations).filter((op) => typeof op === 'string');
      resourceOps.set(resource.id, new Set(ops));
    }
  }
  let collectionIds = new Set(
    asArray(config?.data?.collections)
      .filter((entry) => isObject(entry) && isNonEmptyString(entry.id))
      .map((entry) => entry.id),
  );
  let contentCollectionIds = new Set(
    asArray(config?.content?.collections)
      .filter((entry) => isObject(entry) && isNonEmptyString(entry.id))
      .map((entry) => entry.id),
  );
  let assetIds = new Set(
    asArray(config?.assets)
      .filter((entry) => isObject(entry) && isNonEmptyString(entry.id))
      .map((entry) => entry.id),
  );
  let hookClasses = new Map();
  for (let hook of asArray(config?.hooks)) {
    if (isObject(hook) && isNonEmptyString(hook.id)) hookClasses.set(hook.id, hook.class);
  }
  return { resourceOps, collectionIds, contentCollectionIds, assetIds, hookClasses };
}

/**
 * Normalises a pattern for duplicate detection: parameter names collapse to a
 * positional placeholder so `/x/:a` and `/x/:b` are the same normalized pattern.
 */
function normalizePattern(pattern) {
  return pattern
    .split('/')
    .map((segment) => (segment.startsWith(':') ? ':param' : segment))
    .join('/');
}

/**
 * Validates a URLPattern-compatible pathname (§1.1). Collects the parameter names
 * so pattern↔params reconciliation and rest-segment typing can run afterwards.
 *
 * @returns {{ paramNames: string[], restNames: Set<string> }}
 */
function validatePattern(pattern, allowTrailingWildcard, context, path) {
  let paramNames = [];
  let restNames = new Set();
  if (!isNonEmptyString(pattern)) {
    context.error(path, 'routes.pattern.required', 'A route pattern must be a non-empty string.');
    return { paramNames, restNames };
  }
  if (!pattern.startsWith('/')) {
    context.error(path, 'routes.pattern.leading_slash', `Route pattern "${pattern}" must be basePath-relative and start with "/".`);
  }
  if (/[()]/.test(pattern)) {
    context.error(path, 'routes.pattern.regex_group', `Route pattern "${pattern}" must not use regex capture groups.`);
  }
  if (/[{}]/.test(pattern)) {
    context.error(path, 'routes.pattern.regex_group', `Route pattern "${pattern}" must not use URLPattern group braces.`);
  }

  let segments = pattern.split('/');
  for (let index = 1; index < segments.length; index++) {
    let segment = segments[index];
    let isLast = index === segments.length - 1;
    if (segment === '') {
      if (!isLast) {
        context.error(path, 'routes.pattern.empty_segment', `Route pattern "${pattern}" has an empty path segment.`);
      }
      continue;
    }
    if (segment === '*') {
      if (!allowTrailingWildcard) {
        context.error(path, 'routes.pattern.wildcard_not_allowed', `A trailing "/*" wildcard is only allowed on kind:'fallback' routes and redirects[]; "${pattern}" may not use it.`);
      } else if (!isLast) {
        context.error(path, 'routes.pattern.mid_wildcard', `Route pattern "${pattern}" may use only a single trailing "/*" wildcard.`);
      }
      continue;
    }
    if (segment.startsWith(':')) {
      let match = PARAM_SEGMENT.exec(segment);
      if (!match) {
        context.error(path, 'routes.pattern.param_syntax', `Route pattern segment "${segment}" in "${pattern}" is not a plain ":name" (or ":name+" rest) parameter; regex, optional modifiers, and unnamed captures are not portable.`);
        continue;
      }
      if (paramNames.includes(match[1])) {
        context.error(path, 'routes.pattern.duplicate_param', `Route pattern "${pattern}" declares ":${match[1]}" more than once.`);
      }
      paramNames.push(match[1]);
      if (match[2]) restNames.add(match[1]);
      continue;
    }
    if (STATIC_SEGMENT_RESERVED.test(segment)) {
      context.error(path, 'routes.pattern.param_syntax', `Route pattern static segment "${segment}" in "${pattern}" contains reserved pattern syntax.`);
    }
  }
  return { paramNames, restNames };
}

/**
 * Validates `params[]` and returns a map of declared name → `{ type, values }`
 * used downstream by pattern reconciliation, R7, and `$params` argument checks.
 */
function validateParams(params, context, basePath, refs) {
  let declared = new Map();
  if (params === undefined) return declared;
  if (!Array.isArray(params)) {
    context.error(basePath, 'routes.param.shape', 'Route "params" must be an array.');
    return declared;
  }
  for (let index = 0; index < params.length; index++) {
    let param = params[index];
    let path = `${basePath}[${index}]`;
    if (!isObject(param)) {
      context.error(path, 'routes.param.shape', 'Each route param must be an object.');
      continue;
    }
    if (!isNonEmptyString(param.name)) {
      context.error(path, 'routes.param.name', 'Each route param requires a non-empty name.');
      continue;
    }
    if (declared.has(param.name)) {
      context.error(path, 'routes.param.duplicate', `Route param "${param.name}" is declared more than once.`);
    }
    if (!ROUTE_PARAM_TYPES.includes(param.type)) {
      context.error(path, 'routes.param.type', `Route param "${param.name}" type must be one of ${ROUTE_PARAM_TYPES.join(', ')}.`);
    }
    if (param.type === 'enum' && !isResourcesToken(param.values) && !(Array.isArray(param.values) && param.values.length > 0)) {
      context.error(path, 'routes.param.enum_values', `Enum route param "${param.name}" requires a non-empty values[] or { "$resources": true }.`);
    }
    if (param.sync !== undefined && !ROUTE_PARAM_SYNC_MODES.includes(param.sync)) {
      context.error(path, 'routes.param.sync', `Route param "${param.name}" sync must be one of ${ROUTE_PARAM_SYNC_MODES.join(', ')}.`);
    }
    if (param.binding !== undefined && !isStateAddress(param.binding)) {
      context.error(path, 'routes.param.binding', `Route param "${param.name}" binding must be a state: address.`);
    }
    if (param.enumerate !== undefined) {
      validateEnumerate(param.enumerate, `${path}.enumerate`, context, refs);
    }
    declared.set(param.name, { type: param.type, values: param.values });
  }
  return declared;
}

/** Validates `params[].enumerate` — a build-time enumeration source (§1.3, C11). */
function validateEnumerate(enumerate, path, context, refs) {
  if (!isObject(enumerate)) {
    context.error(path, 'routes.param.enumerate_shape', 'enumerate must be an object of { collection, field? }.');
    return;
  }
  if (!isNonEmptyString(enumerate.collection)) {
    context.error(path, 'routes.param.enumerate_shape', 'enumerate requires a collection id.');
    return;
  }
  if (!refs.collectionIds.has(enumerate.collection) && !refs.contentCollectionIds.has(enumerate.collection)) {
    context.error(path, 'routes.param.enumerate_unresolved', `enumerate collection "${enumerate.collection}" does not resolve to a declared data.collections or content.collections id.`);
  }
}

/** Validates `query[]` and returns the set of declared query names. */
function validateQuery(query, context, basePath) {
  let declared = new Set();
  if (query === undefined) return declared;
  if (!Array.isArray(query)) {
    context.error(basePath, 'routes.query.shape', 'Route "query" must be an array.');
    return declared;
  }
  for (let index = 0; index < query.length; index++) {
    let entry = query[index];
    let path = `${basePath}[${index}]`;
    if (!isObject(entry)) {
      context.error(path, 'routes.query.shape', 'Each route query entry must be an object.');
      continue;
    }
    if (!isNonEmptyString(entry.name)) {
      context.error(path, 'routes.query.name', 'Each route query entry requires a non-empty name.');
      continue;
    }
    if (declared.has(entry.name)) {
      context.error(path, 'routes.query.duplicate', `Route query "${entry.name}" is declared more than once.`);
    }
    if (ROUTE_RESERVED_QUERY.includes(entry.name)) {
      context.error(path, 'routes.query.reserved', `Route query name "${entry.name}" is reserved (${ROUTE_RESERVED_QUERY.join(', ')}) and cannot be declared.`);
    }
    if (!ROUTE_QUERY_CODECS.includes(entry.codec)) {
      context.error(path, 'routes.query.codec', `Route query "${entry.name}" codec must be one of ${ROUTE_QUERY_CODECS.join(', ')}.`);
    }
    if (entry.history !== undefined && !ROUTE_QUERY_HISTORY_MODES.includes(entry.history)) {
      context.error(path, 'routes.query.history', `Route query "${entry.name}" history must be one of ${ROUTE_QUERY_HISTORY_MODES.join(', ')}.`);
    }
    if (entry.binding !== undefined && !isStateAddress(entry.binding)) {
      context.error(path, 'routes.query.binding', `Route query "${entry.name}" binding must be a state: address.`);
    }
    declared.add(entry.name);
  }
  return declared;
}

/** Validates `guards[]` (§1.5). */
function validateGuards(guards, context, basePath, refs) {
  if (guards === undefined) return;
  if (!Array.isArray(guards)) {
    context.error(basePath, 'routes.guard.shape', 'Route "guards" must be an array.');
    return;
  }
  for (let index = 0; index < guards.length; index++) {
    let guard = guards[index];
    let path = `${basePath}[${index}]`;
    if (!isObject(guard)) {
      context.error(path, 'routes.guard.shape', 'Each route guard must be an object.');
      continue;
    }
    if (!ROUTE_GUARD_EVENTS.includes(guard.on)) {
      context.error(path, 'routes.guard.on', `Route guard "on" must be one of ${ROUTE_GUARD_EVENTS.join(', ')}.`);
    }
    let hasRequires = guard.requires !== undefined;
    let hasHook = guard.hook !== undefined;
    if (hasRequires === hasHook) {
      context.error(path, 'routes.guard.one_of', 'Each route guard needs exactly one of "requires" or "hook".');
    }
    if (hasRequires && !isNonEmptyString(guard.requires)) {
      context.error(path, 'routes.guard.requires', 'Route guard "requires" must be a capability id.');
    }
    if (hasHook) {
      if (!isNonEmptyString(guard.hook)) {
        context.error(path, 'routes.guard.hook_shape', 'Route guard "hook" must be a hooks[] id.');
      } else if (!refs.hookClasses.has(guard.hook)) {
        context.error(path, 'routes.guard.hook_unresolved', `Route guard hook "${guard.hook}" does not resolve to a declared hooks[] entry.`);
      } else if (refs.hookClasses.get(guard.hook) !== ROUTE_GUARD_HOOK_CLASS) {
        context.error(path, 'routes.guard.hook_class', `Route guard hook "${guard.hook}" must be class '${ROUTE_GUARD_HOOK_CLASS}'.`);
      }
    }
  }
}

/** Validates a single `route.data[]` argument value (§5). */
function validateArgValue(value, path, name, context, declaredParams, declaredQuery) {
  if (typeof value !== 'string' || !value.startsWith('$')) return;
  let match = ARG_REFERENCE.exec(value);
  if (!match) {
    context.error(path, 'routes.data.arg_form', `Loader arg "${name}" may only be a literal or $params.<n>/$query.<n>/$mount.<n>; "${value}" is neither.`);
    return;
  }
  let [, kind, reference] = match;
  if (kind === 'params' && !declaredParams.has(reference)) {
    context.error(path, 'routes.data.param_undeclared', `Loader arg "${name}" references $params.${reference}, which is not a declared route param.`);
  }
  if (kind === 'query' && !declaredQuery.has(reference)) {
    context.error(path, 'routes.data.query_undeclared', `Loader arg "${name}" references $query.${reference}, which is not a declared route query param.`);
  }
}

/** Validates a `route.data[]` source union and its arguments (§5, C11, R7). */
function validateDataSource(source, context, path, declaredParams, declaredQuery, refs) {
  if (!isObject(source)) {
    context.error(path, 'routes.data.source_union', 'Loader "source" must be one of { resource, op, args } | { collection, query } | { content }.');
    return;
  }
  let present = ['resource', 'collection', 'content'].filter((key) => source[key] !== undefined);
  if (present.length !== 1) {
    context.error(path, 'routes.data.source_union', 'Loader "source" must name exactly one of resource, collection, or content.');
    return;
  }
  let [kind] = present;
  if (kind === 'collection') {
    if (!refs.collectionIds.has(source.collection)) {
      context.error(`${path}.collection`, 'routes.data.collection_unresolved', `Loader collection "${source.collection}" does not resolve to a declared data.collections id.`);
    }
    return;
  }
  if (kind === 'content') {
    if (!refs.contentCollectionIds.has(source.content)) {
      context.error(`${path}.content`, 'routes.data.content_unresolved', `Loader content "${source.content}" does not resolve to a declared content.collections id.`);
    }
    return;
  }
  validateResourceSource(source, context, path, declaredParams, declaredQuery, refs);
}

/** Validates a `{ resource, op, args }` loader source, including the R7 contract. */
function validateResourceSource(source, context, path, declaredParams, declaredQuery, refs) {
  let resource = source.resource;
  let dynamic = typeof resource === 'string' && resource.startsWith('$');
  if (dynamic) {
    validateDynamicResource(resource, source.op, context, path, declaredParams, refs);
  } else if (!isNonEmptyString(resource) || !refs.resourceOps.has(resource)) {
    context.error(`${path}.resource`, 'routes.data.resource_unresolved', `Loader resource "${resource}" does not resolve to a declared data.resources id.`);
  } else if (!RESOURCE_OPERATIONS.includes(source.op)) {
    context.error(`${path}.op`, 'routes.data.op_invalid', `Loader op "${source.op}" is not one of ${RESOURCE_OPERATIONS.join(', ')}.`);
  } else if (!refs.resourceOps.get(resource).has(source.op)) {
    context.error(`${path}.op`, 'routes.data.op_undeclared', `Resource "${resource}" does not declare the "${source.op}" operation.`);
  }

  if (source.args !== undefined) {
    if (!isObject(source.args)) {
      context.error(`${path}.args`, 'routes.data.args_shape', 'Loader "args" must be an object.');
    } else {
      for (let [name, value] of Object.entries(source.args)) {
        validateArgValue(value, `${path}.args.${name}`, name, context, declaredParams, declaredQuery);
      }
    }
  }
}

/** R7: a `$params.<p>` resource id is legal only under the `$resources` enum contract. */
function validateDynamicResource(resource, op, context, path, declaredParams, refs) {
  let match = /^\$params\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(resource);
  if (!match) {
    context.error(`${path}.resource`, 'routes.data.dynamic_resource', `Dynamic loader resource "${resource}" must be of the form $params.<name>.`);
    return;
  }
  let param = declaredParams.get(match[1]);
  if (!param) {
    context.error(`${path}.resource`, 'routes.data.param_undeclared', `Dynamic loader resource references $params.${match[1]}, which is not a declared route param.`);
    return;
  }
  if (!(param.type === 'enum' && isResourcesToken(param.values))) {
    context.error(`${path}.resource`, 'routes.data.dynamic_resource', `Dynamic loader resource $params.${match[1]} requires that param to be an enum over { "$resources": true } (R7).`);
    return;
  }
  if (!RESOURCE_OPERATIONS.includes(op)) {
    context.error(`${path}.op`, 'routes.data.op_invalid', `Loader op "${op}" is not one of ${RESOURCE_OPERATIONS.join(', ')}.`);
    return;
  }
  for (let [id, ops] of refs.resourceOps) {
    if (!ops.has(op)) {
      context.error(`${path}.op`, 'routes.data.dynamic_resource', `Dynamic $resources loader op "${op}" requires every resource to declare it; "${id}" does not (R7).`);
      return;
    }
  }
}

/** Validates `route.data[]` (§5). */
function validateData(data, context, basePath, declaredParams, declaredQuery, refs) {
  if (data === undefined) return;
  if (!Array.isArray(data)) {
    context.error(basePath, 'routes.data.shape', 'Route "data" must be an array.');
    return;
  }
  let seen = new Set();
  for (let index = 0; index < data.length; index++) {
    let loader = data[index];
    let path = `${basePath}[${index}]`;
    if (!isObject(loader)) {
      context.error(path, 'routes.data.shape', 'Each route data loader must be an object.');
      continue;
    }
    if (!isNonEmptyString(loader.id)) {
      context.error(path, 'routes.data.id', 'Each route data loader requires a non-empty id.');
    } else if (seen.has(loader.id)) {
      context.error(path, 'routes.data.duplicate_id', `Route data loader id "${loader.id}" is declared more than once in this route.`);
    } else {
      seen.add(loader.id);
    }
    if (loader.bind !== undefined && !isStateAddress(loader.bind)) {
      context.error(`${path}.bind`, 'routes.data.bind', 'Loader "bind" must be a state: address.');
    }
    if (loader.required === true && loader.critical !== true) {
      context.error(path, 'routes.data.required_noncritical', `Loader "${loader.id}" sets required:true but is not critical; a post-paint loader cannot set an HTTP status.`);
    }
    validateDataSource(loader.source, context, `${path}.source`, declaredParams, declaredQuery, refs);
  }
}

/** Validates a localizable meta string — C1 ({$t}|inline default) or a C11 content: ref. */
function validateLocalizable(value, context, path, refs) {
  if (isObject(value)) {
    if (isNonEmptyString(value.$t) || isNonEmptyString(value.default)) return;
    context.error(path, 'routes.meta.localizable', 'Localizable meta strings must be { "$t": <key> } or { default, locales? }.');
    return;
  }
  if (typeof value === 'string' && value.startsWith('content:')) {
    let collection = value.slice('content:'.length).split(':')[0];
    if (!refs.contentCollectionIds.has(collection)) {
      context.error(path, 'routes.meta.content_unresolved', `Meta content ref "${value}" names collection "${collection}", which is not a declared content.collections id.`);
    }
    return;
  }
  context.error(path, 'routes.meta.localizable', 'Localizable meta strings must be { "$t": <key> } or { default, locales? }.');
}

/** Validates `route.meta` (§1.6, C1, C2 informs canonical/hreflang). */
function validateMeta(meta, context, basePath, refs) {
  if (meta === undefined) return;
  if (!isObject(meta)) {
    context.error(basePath, 'routes.meta.shape', 'Route "meta" must be an object.');
    return;
  }
  if (meta.title !== undefined) validateLocalizable(meta.title, context, `${basePath}.title`, refs);
  if (meta.description !== undefined) validateLocalizable(meta.description, context, `${basePath}.description`, refs);
  if (meta.og !== undefined) {
    if (!isNonEmptyString(meta.og) || !meta.og.startsWith('asset:')) {
      context.error(`${basePath}.og`, 'routes.meta.og_shape', 'Meta "og" must be an asset: reference.');
    } else if (!refs.assetIds.has(meta.og.slice('asset:'.length))) {
      context.error(`${basePath}.og`, 'routes.meta.og_unresolved', `Meta og "${meta.og}" does not resolve to a declared assets[] id.`);
    }
  }
  if (meta.canonical !== undefined && (!isNonEmptyString(meta.canonical) || !meta.canonical.startsWith('/') || /[()]/.test(meta.canonical))) {
    context.error(`${basePath}.canonical`, 'routes.meta.canonical', 'Meta "canonical" must be a basePath-relative pattern-template starting with "/".');
  }
  if (meta.hreflang !== undefined) validateHreflang(meta.hreflang, context, `${basePath}.hreflang`);
}

/** Validates `meta.hreflang` — the literal `'auto'` or an explicit alternates array. */
function validateHreflang(hreflang, context, path) {
  if (hreflang === ROUTE_HREFLANG_AUTO) return;
  if (!Array.isArray(hreflang)) {
    context.error(path, 'routes.meta.hreflang', `Meta "hreflang" must be '${ROUTE_HREFLANG_AUTO}' or an array of { locale, pattern }.`);
    return;
  }
  for (let index = 0; index < hreflang.length; index++) {
    let entry = hreflang[index];
    if (!isObject(entry) || !isNonEmptyString(entry.locale) || !isNonEmptyString(entry.pattern) || !entry.pattern.startsWith('/')) {
      context.error(`${path}[${index}]`, 'routes.meta.hreflang', 'Each hreflang alternate must be { locale, pattern } with a basePath-relative pattern.');
    }
  }
}

/**
 * Validates one `views[i].route` object and folds its aggregate facts (fallback
 * count, default count, normalized patterns) into the shared `tally`.
 */
function validateViewRoute(route, viewIndex, context, refs, tally) {
  let basePath = `views[${viewIndex}].route`;
  if (!isObject(route)) {
    context.error(basePath, 'routes.route.shape', 'A view "route" must be an object.');
    return;
  }

  let kind = route.kind === undefined ? 'normal' : route.kind;
  if (kind === 'redirect') {
    context.error(`${basePath}.kind`, 'routes.kind.redirect_dropped', "Redirect-kind view routes are dropped; use top-level redirects[] (kind ∈ 'normal' | 'fallback').");
  } else if (!ROUTE_KINDS.includes(kind)) {
    context.error(`${basePath}.kind`, 'routes.kind.invalid', `Route kind must be one of ${ROUTE_KINDS.join(', ')}.`);
  }
  let isFallback = kind === 'fallback';

  if (isFallback) {
    tally.fallbackCount += 1;
    if (tally.fallbackCount === 2) {
      context.error(`${basePath}.kind`, 'routes.fallback.multiple', 'A workspace config may declare at most one kind:\'fallback\' route.');
    }
    if (route.pattern !== '/*') {
      context.error(`${basePath}.pattern`, 'routes.fallback.pattern', "A kind:'fallback' route pattern must be exactly '/*'.");
    }
  }

  if (route.default === true) {
    if (kind !== 'normal') {
      context.error(`${basePath}.default`, 'routes.default.kind', "default:true is only valid on a kind:'normal' route.");
    } else {
      tally.defaultCount += 1;
      if (tally.defaultCount === 2) {
        context.error(`${basePath}.default`, 'routes.default.multiple', "At most one kind:'normal' route may set default:true.");
      }
    }
  }

  let { paramNames, restNames } = validatePattern(route.pattern, isFallback, context, `${basePath}.pattern`);
  let declaredParams = validateParams(route.params, context, `${basePath}.params`, refs);
  reconcileParams(paramNames, restNames, declaredParams, context, `${basePath}.pattern`);

  let declaredQuery = validateQuery(route.query, context, `${basePath}.query`);
  validateGuards(route.guards, context, `${basePath}.guards`, refs);
  validateData(route.data, context, `${basePath}.data`, declaredParams, declaredQuery, refs);
  validateMeta(route.meta, context, `${basePath}.meta`, refs);

  if (isNonEmptyString(route.pattern)) {
    registerPattern(normalizePattern(route.pattern), `${basePath}.pattern`, context, tally);
  }
}

/** Enforces the pattern↔params bijection and rest-segment typing (§1.1, C4). */
function reconcileParams(paramNames, restNames, declaredParams, context, path) {
  for (let name of paramNames) {
    if (!declaredParams.has(name)) {
      context.error(path, 'routes.pattern.param_mismatch', `Pattern parameter ":${name}" has no matching params[] entry.`);
    }
  }
  for (let name of declaredParams.keys()) {
    if (!paramNames.includes(name)) {
      context.error(path, 'routes.pattern.param_mismatch', `params[] entry "${name}" has no matching ":${name}" pattern segment.`);
    }
  }
  for (let name of restNames) {
    let param = declaredParams.get(name);
    if (param && param.type !== 'path') {
      context.error(path, 'routes.pattern.rest_requires_path', `Rest segment ":${name}+" is only legal when param "${name}" is type:'path' (C4).`);
    }
  }
}

/** Registers a normalized pattern into the shared match table, flagging duplicates. */
function registerPattern(normalized, path, context, tally) {
  if (tally.patterns.has(normalized)) {
    context.error(path, 'routes.pattern.duplicate', `Normalized pattern "${normalized}" is declared more than once; order cannot disambiguate an exact duplicate.`);
    return;
  }
  tally.patterns.set(normalized, path);
}

/** Validates top-level `redirects[]` and the redirect graph for cycles (§2). */
function validateRedirects(redirects, context, refs, tally) {
  if (redirects === undefined) return;
  if (!Array.isArray(redirects)) {
    context.error('redirects', 'routes.redirect.shape', 'Top-level "redirects" must be an array.');
    return;
  }
  let edges = new Map();
  let ids = new Set();
  for (let index = 0; index < redirects.length; index++) {
    let redirect = redirects[index];
    let path = `redirects[${index}]`;
    if (!isObject(redirect)) {
      context.error(path, 'routes.redirect.shape', 'Each redirect must be an object.');
      continue;
    }
    if (!isNonEmptyString(redirect.id)) {
      context.error(`${path}.id`, 'routes.redirect.id', 'Each redirect requires a non-empty id.');
    } else if (ids.has(redirect.id)) {
      context.error(`${path}.id`, 'routes.redirect.duplicate_id', `Redirect id "${redirect.id}" is declared more than once.`);
    } else {
      ids.add(redirect.id);
    }
    validatePattern(redirect.pattern, true, context, `${path}.pattern`);
    if (!isNonEmptyString(redirect.to) || !redirect.to.startsWith('/')) {
      context.error(`${path}.to`, 'routes.redirect.to', 'Redirect "to" must be a basePath-relative pattern-template starting with "/".');
    }
    if (redirect.permanent !== undefined && typeof redirect.permanent !== 'boolean') {
      context.error(`${path}.permanent`, 'routes.redirect.permanent', 'Redirect "permanent" must be a boolean.');
    }
    if (isNonEmptyString(redirect.pattern)) {
      let from = normalizePattern(redirect.pattern);
      registerPattern(from, `${path}.pattern`, context, tally);
      if (isNonEmptyString(redirect.to)) {
        edges.set(from, { to: normalizePattern(redirect.to), path });
      }
    }
  }
  detectRedirectCycles(edges, context);
}

/** Cycle-checks the redirect graph: an edge is from → to when `to` matches another pattern. */
function detectRedirectCycles(edges, context) {
  let state = new Map();
  let reported = new Set();

  function walk(node) {
    state.set(node, 'active');
    let edge = edges.get(node);
    if (edge && edges.has(edge.to)) {
      let next = edge.to;
      if (state.get(next) === 'active') {
        if (!reported.has(edge.path)) {
          reported.add(edge.path);
          context.error(edge.path, 'routes.redirect.cycle', `Redirect "${node}" → "${next}" closes a redirect cycle.`);
        }
      } else if (state.get(next) !== 'done') {
        walk(next);
      }
    }
    state.set(node, 'done');
  }

  for (let node of edges.keys()) {
    if (!state.has(node)) walk(node);
  }
}

/**
 * Shape pass: validates every `views[].route` and the top-level `redirects[]`
 * against the ROUTES vocabulary and the declared sibling config.
 */
function validate(config, context) {
  if (!isObject(config)) return;
  let refs = buildReferenceIndex(config);
  let tally = { fallbackCount: 0, defaultCount: 0, patterns: new Map() };

  let views = asArray(config.views);
  for (let index = 0; index < views.length; index++) {
    let view = views[index];
    if (!isObject(view) || view.route === undefined) continue;
    validateViewRoute(view.route, index, context, refs, tally);
  }

  validateRedirects(config.redirects, context, refs, tally);
}

/**
 * Publishes the `route:*` WAS subject space this section owns. Every routed view
 * provides `route:enter:<viewId>` and `route:exit:<viewId>`; a hook/wire (other
 * sections) that consumes such a subject for a view without a route resolves to
 * nothing and is reported unresolved by the core referential pass (§8).
 */
function refProviders(config) {
  let providers = [];
  for (let view of asArray(config?.views)) {
    if (!isObject(view) || view.route === undefined || !isNonEmptyString(view.id)) continue;
    let path = `views[].route`;
    providers.push({ id: `route:enter:${view.id}`, path });
    providers.push({ id: `route:exit:${view.id}`, path });
  }
  return providers;
}

/**
 * ROUTES section consumes no cross-section provider addresses: its outbound
 * references need the sibling declaration's attributes (resource ops, guard hook
 * class, the R7 `$resources` contract) and are resolved in the shape pass against
 * the declared config. The subject space it owns is published via refProviders.
 */
function refConsumers() {
  return [];
}

/** @type {import('../../validation/core.js').ValidationSection} */
export const routesSection = Object.freeze({
  id: 'routes',
  validate,
  refProviders,
  refConsumers,
});

export default routesSection;
