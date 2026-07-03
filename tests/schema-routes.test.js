import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerSection,
  clearRegisteredSections,
  validateWorkspaceConfig,
} from '../validation/core.js';
import {
  routesSection,
  ROUTE_KINDS,
  ROUTE_PARAM_TYPES,
  ROUTE_PARAM_SYNC_MODES,
  ROUTE_QUERY_HISTORY_MODES,
  ROUTE_GUARD_EVENTS,
  ROUTE_PRECEDENCE_KEYS,
} from '../schema/sections/routes.js';

const VERSION = '1.0.0';

function validate(views, extra = {}) {
  clearRegisteredSections();
  registerSection(routesSection);
  let config = { version: VERSION, name: 'Routes Workspace', views, ...extra };
  return validateWorkspaceConfig(config);
}

/** Single-view helper: mounts `route` on one view and validates. */
function route(routeObject, extra = {}) {
  return validate([{ id: 'view-a', route: routeObject }], extra);
}

function has(result, code) {
  return result.errors.some((error) => error.code === code);
}

function codesAt(result, path) {
  return result.errors.filter((error) => error.path === path).map((error) => error.code);
}

describe('routes section — contract', () => {
  it('is a registerable { id, validate, refProviders, refConsumers } section', () => {
    assert.equal(routesSection.id, 'routes');
    assert.equal(typeof routesSection.validate, 'function');
    assert.equal(typeof routesSection.refProviders, 'function');
    assert.equal(typeof routesSection.refConsumers, 'function');
    assert.ok(Object.isFrozen(routesSection));
  });

  it('registers into the S1.0 core and validates a clean config', () => {
    let result = route({ pattern: '/dashboard' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it('leaves views without a route untouched', () => {
    let result = validate([{ id: 'internal' }, { id: 'shown', route: { pattern: '/x' } }]);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it('exports the ROUTES vocabulary without a dropped redirect kind', () => {
    assert.deepEqual(ROUTE_KINDS, ['normal', 'fallback']);
    assert.ok(!ROUTE_KINDS.includes('redirect'));
    assert.deepEqual(ROUTE_PARAM_TYPES, ['string', 'int', 'id', 'enum', 'path']);
    assert.deepEqual(ROUTE_PARAM_SYNC_MODES, ['enter', 'two-way']);
    assert.deepEqual(ROUTE_QUERY_HISTORY_MODES, ['push', 'replace']);
    assert.deepEqual(ROUTE_GUARD_EVENTS, ['enter', 'leave']);
    assert.deepEqual(ROUTE_PRECEDENCE_KEYS, ['order', 'staticSegments', 'paramCount', 'patternLength', 'lexicographic']);
  });
});

describe('routes section — pattern grammar', () => {
  const ACCEPTED = ['/', '/dashboard', '/work-orders/:id', '/admin/:entity/:id', '/a/b/c'];
  for (let pattern of ACCEPTED) {
    it(`accepts pattern ${pattern}`, () => {
      let params = [...pattern.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => ({ name: m[1], type: 'string' }));
      let result = route({ pattern, params });
      assert.equal(result.ok, true, JSON.stringify(result.errors));
    });
  }

  it('rejects a pattern that does not start with /', () => {
    assert.ok(has(route({ pattern: 'dashboard' }), 'routes.pattern.leading_slash'));
  });

  it('rejects regex groups, braces, and unnamed captures', () => {
    assert.ok(has(route({ pattern: '/x/(\\d+)' }), 'routes.pattern.regex_group'));
    assert.ok(has(route({ pattern: '/x/{y}' }), 'routes.pattern.regex_group'));
  });

  it('rejects optional and greedy modifiers on named segments', () => {
    assert.ok(has(route({ pattern: '/x/:id?', params: [{ name: 'id', type: 'string' }] }), 'routes.pattern.param_syntax'));
    assert.ok(has(route({ pattern: '/x/:id*', params: [{ name: 'id', type: 'string' }] }), 'routes.pattern.param_syntax'));
  });

  it('rejects a mid-pattern wildcard even where a trailing one is allowed', () => {
    let result = route({ kind: 'fallback', pattern: '/*/x' });
    assert.ok(has(result, 'routes.pattern.mid_wildcard') || has(result, 'routes.fallback.pattern'));
  });

  it('rejects a trailing wildcard on a normal route', () => {
    assert.ok(has(route({ pattern: '/files/*' }), 'routes.pattern.wildcard_not_allowed'));
  });

  it('requires the pattern↔params bijection in both directions', () => {
    assert.ok(has(route({ pattern: '/x/:id' }), 'routes.pattern.param_mismatch'));
    assert.ok(has(route({ pattern: '/x', params: [{ name: 'id', type: 'string' }] }), 'routes.pattern.param_mismatch'));
  });

  it("allows ':name+' only when the param is type:'path' (C4)", () => {
    let ok = route({ pattern: '/files/:path+', params: [{ name: 'path', type: 'path' }] });
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    let bad = route({ pattern: '/files/:path+', params: [{ name: 'path', type: 'string' }] });
    assert.ok(has(bad, 'routes.pattern.rest_requires_path'));
  });

  it('rejects duplicate normalized patterns across routes', () => {
    let result = validate([
      { id: 'a', route: { pattern: '/x/:a', params: [{ name: 'a', type: 'string' }] } },
      { id: 'b', route: { pattern: '/x/:b', params: [{ name: 'b', type: 'string' }] } },
    ]);
    assert.ok(has(result, 'routes.pattern.duplicate'));
  });
});

describe('routes section — kind / default / fallback', () => {
  it('drops redirect-kind view routes (L1 ruling 3)', () => {
    assert.ok(has(route({ kind: 'redirect', pattern: '/old', to: { view: 'x' } }), 'routes.kind.redirect_dropped'));
  });

  it('rejects an unknown kind', () => {
    assert.ok(has(route({ kind: 'ghost', pattern: '/x' }), 'routes.kind.invalid'));
  });

  it('accepts exactly one fallback and rejects a second', () => {
    let ok = route({ kind: 'fallback', pattern: '/*' });
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    let two = validate([
      { id: 'a', route: { kind: 'fallback', pattern: '/*' } },
      { id: 'b', route: { kind: 'fallback', pattern: '/*' } },
    ]);
    assert.ok(has(two, 'routes.fallback.multiple'));
  });

  it("requires a fallback pattern of exactly '/*'", () => {
    assert.ok(has(route({ kind: 'fallback', pattern: '/not-found' }), 'routes.fallback.pattern'));
  });

  it('allows one default normal route and rejects a second or a non-normal default', () => {
    assert.equal(route({ pattern: '/home', default: true }).ok, true);
    let two = validate([
      { id: 'a', route: { pattern: '/home', default: true } },
      { id: 'b', route: { pattern: '/start', default: true } },
    ]);
    assert.ok(has(two, 'routes.default.multiple'));
    assert.ok(has(route({ kind: 'fallback', pattern: '/*', default: true }), 'routes.default.kind'));
  });
});

describe('routes section — params', () => {
  it('accepts every declared param type', () => {
    for (let type of ROUTE_PARAM_TYPES) {
      let values = type === 'enum' ? { values: ['a', 'b'] } : {};
      let result = route({ pattern: '/x/:p', params: [{ name: 'p', type, ...values }] });
      assert.equal(result.ok, true, `${type}: ${JSON.stringify(result.errors)}`);
    }
  });

  it('rejects an unknown param type', () => {
    assert.ok(has(route({ pattern: '/x/:p', params: [{ name: 'p', type: 'uuid' }] }), 'routes.param.type'));
  });

  it('requires values[] or {$resources:true} on an enum param', () => {
    assert.ok(has(route({ pattern: '/x/:p', params: [{ name: 'p', type: 'enum' }] }), 'routes.param.enum_values'));
    assert.equal(route({ pattern: '/x/:p', params: [{ name: 'p', type: 'enum', values: { $resources: true } }] }).ok, true);
  });

  it('validates the sync enum route-side (S8-S3)', () => {
    assert.equal(route({ pattern: '/x/:p', params: [{ name: 'p', type: 'string', binding: 'state:x', sync: 'two-way' }] }).ok, true);
    assert.ok(has(route({ pattern: '/x/:p', params: [{ name: 'p', type: 'string', sync: 'sideways' }] }), 'routes.param.sync'));
  });

  it('requires a state: binding address', () => {
    assert.ok(has(route({ pattern: '/x/:p', params: [{ name: 'p', type: 'string', binding: 'wo.tab' }] }), 'routes.param.binding'));
  });

  it('rejects duplicate param names', () => {
    let result = route({ pattern: '/x/:p', params: [{ name: 'p', type: 'string' }, { name: 'p', type: 'int' }] });
    assert.ok(has(result, 'routes.param.duplicate'));
  });

  it('resolves enumerate against data and content collections (C11)', () => {
    let base = { data: { collections: [{ id: 'work-orders' }] }, content: { collections: [{ id: 'pages' }] } };
    assert.equal(route({ pattern: '/x/:p', params: [{ name: 'p', type: 'id', enumerate: { collection: 'work-orders' } }] }, base).ok, true);
    assert.equal(route({ pattern: '/x/:p', params: [{ name: 'p', type: 'id', enumerate: { collection: 'pages' } }] }, base).ok, true);
    assert.ok(has(route({ pattern: '/x/:p', params: [{ name: 'p', type: 'id', enumerate: { collection: 'ghost' } }] }, base), 'routes.param.enumerate_unresolved'));
  });
});

describe('routes section — query', () => {
  const validQuery = { pattern: '/x', query: [{ name: 'tab', codec: 'csv', history: 'replace', binding: 'state:x' }] };

  it('accepts a well-formed query param', () => {
    assert.equal(route(validQuery).ok, true);
  });

  it('rejects an unknown codec', () => {
    assert.ok(has(route({ pattern: '/x', query: [{ name: 'tab', codec: 'yaml' }] }), 'routes.query.codec'));
  });

  it('rejects an invalid history mode', () => {
    assert.ok(has(route({ pattern: '/x', query: [{ name: 'tab', codec: 'csv', history: 'rewrite' }] }), 'routes.query.history'));
  });

  it('rejects reserved query names', () => {
    assert.ok(has(route({ pattern: '/x', query: [{ name: 'snap', codec: 'string' }] }), 'routes.query.reserved'));
    assert.ok(has(route({ pattern: '/x', query: [{ name: 'locale', codec: 'string' }] }), 'routes.query.reserved'));
  });

  it('rejects duplicate query names', () => {
    let result = route({ pattern: '/x', query: [{ name: 'tab', codec: 'string' }, { name: 'tab', codec: 'int' }] });
    assert.ok(has(result, 'routes.query.duplicate'));
  });
});

describe('routes section — guards', () => {
  const hooks = { hooks: [{ id: 'unsaved-guard', class: 'guard' }, { id: 'audit', class: 'automate' }] };

  it('accepts an enter capability guard and a leave guard hook', () => {
    let result = route({
      pattern: '/x',
      guards: [{ on: 'enter', requires: 'workorder.read' }, { on: 'leave', hook: 'unsaved-guard' }],
    }, hooks);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it('rejects an invalid guard edge', () => {
    assert.ok(has(route({ pattern: '/x', guards: [{ on: 'render', requires: 'x' }] }), 'routes.guard.on'));
  });

  it('requires exactly one of requires/hook', () => {
    assert.ok(has(route({ pattern: '/x', guards: [{ on: 'enter' }] }), 'routes.guard.one_of'));
    assert.ok(has(route({ pattern: '/x', guards: [{ on: 'enter', requires: 'a', hook: 'b' }] }, hooks), 'routes.guard.one_of'));
  });

  it('requires the hook to resolve to a guard-class hooks[] entry', () => {
    assert.ok(has(route({ pattern: '/x', guards: [{ on: 'leave', hook: 'missing' }] }, hooks), 'routes.guard.hook_unresolved'));
    assert.ok(has(route({ pattern: '/x', guards: [{ on: 'leave', hook: 'audit' }] }, hooks), 'routes.guard.hook_class'));
  });
});

describe('routes section — data loaders', () => {
  const data = {
    data: {
      resources: [{ id: 'work-orders', operations: ['list', 'get'] }],
      collections: [{ id: 'notes' }],
    },
    content: { collections: [{ id: 'pages' }] },
  };

  it('accepts each source union member', () => {
    let resource = route({ pattern: '/x/:id', params: [{ name: 'id', type: 'id' }], data: [{ id: 'wo', source: { resource: 'work-orders', op: 'get', args: { id: '$params.id' } }, bind: 'state:route.data.wo' }] }, data);
    assert.equal(resource.ok, true, JSON.stringify(resource.errors));
    assert.equal(route({ pattern: '/x', data: [{ id: 'n', source: { collection: 'notes', query: {} } }] }, data).ok, true);
    assert.equal(route({ pattern: '/x', data: [{ id: 'p', source: { content: 'pages' } }] }, data).ok, true);
  });

  it('requires exactly one source discriminator', () => {
    assert.ok(has(route({ pattern: '/x', data: [{ id: 'a', source: {} }] }, data), 'routes.data.source_union'));
    assert.ok(has(route({ pattern: '/x', data: [{ id: 'a', source: { resource: 'work-orders', collection: 'notes', op: 'get' } }] }, data), 'routes.data.source_union'));
  });

  it('rejects broken resource/collection/content refs and undeclared ops', () => {
    assert.ok(has(route({ pattern: '/x', data: [{ id: 'a', source: { resource: 'ghost', op: 'get' } }] }, data), 'routes.data.resource_unresolved'));
    assert.ok(has(route({ pattern: '/x', data: [{ id: 'a', source: { collection: 'ghost', query: {} } }] }, data), 'routes.data.collection_unresolved'));
    assert.ok(has(route({ pattern: '/x', data: [{ id: 'a', source: { content: 'ghost' } }] }, data), 'routes.data.content_unresolved'));
    assert.ok(has(route({ pattern: '/x', data: [{ id: 'a', source: { resource: 'work-orders', op: 'delete' } }] }, data), 'routes.data.op_undeclared'));
    assert.ok(has(route({ pattern: '/x', data: [{ id: 'a', source: { resource: 'work-orders', op: 'purge' } }] }, data), 'routes.data.op_invalid'));
  });

  it('restricts arg values to literals and $params/$query/$mount refs', () => {
    let bad = route({ pattern: '/x', data: [{ id: 'a', source: { resource: 'work-orders', op: 'get', args: { id: '$body.id' } } }] }, data);
    assert.ok(has(bad, 'routes.data.arg_form'));
    let undeclared = route({ pattern: '/x', data: [{ id: 'a', source: { resource: 'work-orders', op: 'get', args: { id: '$params.missing' } } }] }, data);
    assert.ok(has(undeclared, 'routes.data.param_undeclared'));
    let mount = route({ pattern: '/x', data: [{ id: 'a', source: { resource: 'work-orders', op: 'get', args: { id: '$mount.projectId', tag: 'literal' } } }] }, data);
    assert.equal(mount.ok, true, JSON.stringify(mount.errors));
  });

  it('rejects duplicate loader ids and required-on-non-critical loaders', () => {
    let dup = route({ pattern: '/x', data: [{ id: 'a', source: { content: 'pages' } }, { id: 'a', source: { content: 'pages' } }] }, data);
    assert.ok(has(dup, 'routes.data.duplicate_id'));
    let required = route({ pattern: '/x', data: [{ id: 'a', source: { content: 'pages' }, required: true }] }, data);
    assert.ok(has(required, 'routes.data.required_noncritical'));
  });

  it('accepts R7 $resources dynamic resource loaders when every member declares the op', () => {
    const r7 = { data: { resources: [{ id: 'orders', operations: ['list', 'get'] }, { id: 'users', operations: ['list', 'get'] }] } };
    let ok = route({
      pattern: '/admin/:entity',
      params: [{ name: 'entity', type: 'enum', values: { $resources: true } }],
      data: [{ id: 'rows', source: { resource: '$params.entity', op: 'list', args: {} } }],
    }, r7);
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  });

  it('rejects R7 loaders when the param is not a $resources enum', () => {
    const r7 = { data: { resources: [{ id: 'orders', operations: ['list'] }] } };
    let bad = route({
      pattern: '/admin/:entity',
      params: [{ name: 'entity', type: 'string' }],
      data: [{ id: 'rows', source: { resource: '$params.entity', op: 'list' } }],
    }, r7);
    assert.ok(has(bad, 'routes.data.dynamic_resource'));
  });

  it('rejects R7 loaders when a member resource omits the op', () => {
    const r7 = { data: { resources: [{ id: 'orders', operations: ['list', 'get'] }, { id: 'users', operations: ['list'] }] } };
    let bad = route({
      pattern: '/admin/:entity',
      params: [{ name: 'entity', type: 'enum', values: { $resources: true } }],
      data: [{ id: 'rows', source: { resource: '$params.entity', op: 'get' } }],
    }, r7);
    assert.ok(has(bad, 'routes.data.dynamic_resource'));
  });
});

describe('routes section — meta', () => {
  const assets = { assets: [{ id: 'og-workorder', kind: 'image' }] };

  it('accepts localizable strings, a resolvable og asset, canonical and hreflang', () => {
    let result = route({
      pattern: '/work-orders/:id',
      params: [{ name: 'id', type: 'id' }],
      meta: {
        title: { $t: 'routes.workOrder.title' },
        description: { default: 'Work order', locales: { ru: 'Заказ' } },
        og: 'asset:og-workorder',
        canonical: '/work-orders/:id',
        hreflang: 'auto',
      },
    }, assets);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it('rejects a non-localizable meta title', () => {
    assert.ok(has(route({ pattern: '/x', meta: { title: 'bare string' } }), 'routes.meta.localizable'));
  });

  it('rejects a non-asset or unresolved og ref', () => {
    assert.ok(has(route({ pattern: '/x', meta: { og: 'https://cdn/x.png' } }), 'routes.meta.og_shape'));
    assert.ok(has(route({ pattern: '/x', meta: { og: 'asset:missing' } }, assets), 'routes.meta.og_unresolved'));
  });

  it('resolves content refs in meta strings (C11)', () => {
    let content = { content: { collections: [{ id: 'pages' }] } };
    assert.equal(route({ pattern: '/x', meta: { title: 'content:pages:home#title' } }, content).ok, true);
    assert.ok(has(route({ pattern: '/x', meta: { title: 'content:ghost:home' } }, content), 'routes.meta.content_unresolved'));
  });

  it('accepts an explicit hreflang array and rejects a malformed one', () => {
    assert.equal(route({ pattern: '/x', meta: { hreflang: [{ locale: 'en', pattern: '/en/x' }] } }).ok, true);
    assert.ok(has(route({ pattern: '/x', meta: { hreflang: [{ locale: 'en' }] } }), 'routes.meta.hreflang'));
  });
});

describe('routes section — redirects[]', () => {
  it('accepts a well-formed redirect', () => {
    let result = validate([{ id: 'v', route: { pattern: '/x' } }], {
      redirects: [{ id: 'legacy-wo', pattern: '/wo/:id', to: '/work-orders/:id', permanent: true }],
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it('rejects a malformed redirect', () => {
    let result = validate([], { redirects: [{ pattern: '/wo', to: 'work-orders' }] });
    assert.ok(has(result, 'routes.redirect.id'));
    assert.ok(has(result, 'routes.redirect.to'));
  });

  it('detects a redirect cycle', () => {
    let result = validate([], {
      redirects: [
        { id: 'a', pattern: '/a', to: '/b' },
        { id: 'b', pattern: '/b', to: '/a' },
      ],
    });
    assert.ok(has(result, 'routes.redirect.cycle'));
  });

  it('shares the match table: a redirect duplicating a route pattern is an error', () => {
    let result = validate([{ id: 'v', route: { pattern: '/x' } }], {
      redirects: [{ id: 'r', pattern: '/x', to: '/y' }],
    });
    assert.ok(has(result, 'routes.pattern.duplicate'));
  });
});

describe('routes section — route:* subjects', () => {
  it('publishes route:enter/route:exit providers for routed views', () => {
    let providers = routesSection.refProviders({ views: [{ id: 'work-orders', route: { pattern: '/x' } }, { id: 'internal' }] });
    let ids = providers.map((provider) => provider.id);
    assert.deepEqual(ids, ['route:enter:work-orders', 'route:exit:work-orders']);
  });

  it('reports a hook/wire consuming a route:* subject of an unrouted view as unresolved', () => {
    clearRegisteredSections();
    registerSection(routesSection);
    registerSection({
      id: 'behavior',
      refConsumers: () => [{ id: 'route:enter:ghost', path: 'hooks[0].on', code: 'behavior.route.unresolved' }],
    });
    let result = validateWorkspaceConfig({ version: VERSION, name: 'W', views: [{ id: 'real', route: { pattern: '/x' } }] });
    assert.ok(has(result, 'behavior.route.unresolved'));

    let resolved = validateWorkspaceConfig({ version: VERSION, name: 'W', views: [{ id: 'ghost', route: { pattern: '/x' } }] });
    assert.ok(!has(resolved, 'behavior.route.unresolved'), JSON.stringify(resolved.errors));
  });

  it('consumes no cross-section provider addresses of its own', () => {
    assert.deepEqual(routesSection.refConsumers(), []);
  });
});

describe('routes section — error path precision', () => {
  it('reports errors under the owning view.route path', () => {
    let result = route({ pattern: 'bad' });
    assert.deepEqual(codesAt(result, 'views[0].route.pattern'), ['routes.pattern.leading_slash']);
  });
});
