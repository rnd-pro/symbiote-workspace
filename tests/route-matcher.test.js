import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRouteMatcher,
  normalizeRoutePattern,
} from '../runtime/route-matcher.js';

describe('route matcher', () => {
  it('exposes the W1 normalized-pattern rule', () => {
    assert.equal(normalizeRoutePattern('/work/:id'), '/work/:param');
    assert.equal(normalizeRoutePattern('/files/:path+'), '/files/:param');
  });

  it('applies the normative precedence order and keeps fallback last', () => {
    let matcher = createRouteMatcher({
      views: [
        { id: 'fallback', route: { kind: 'fallback', pattern: '/*' } },
        { id: 'ordered-two', route: { pattern: '/ordered/:id', order: 2, params: [{ name: 'id', type: 'string' }] } },
        { id: 'static', route: { pattern: '/docs/static' } },
        { id: 'param', route: { pattern: '/docs/:slug', params: [{ name: 'slug', type: 'string' }] } },
        { id: 'ordered-one', route: { pattern: '/ordered/static', order: 1 } },
      ],
    });

    assert.deepEqual(
      matcher.entries.map((entry) => entry.viewId),
      ['ordered-one', 'ordered-two', 'static', 'param', 'fallback'],
    );
    assert.equal(matcher.match('/docs/static').viewId, 'static');
    assert.equal(matcher.match('/other/path').viewId, 'fallback');
  });

  it('falls through when typed params fail to decode', () => {
    let matcher = createRouteMatcher({
      views: [
        { id: 'item', route: { pattern: '/items/:id', params: [{ name: 'id', type: 'int' }] } },
        { id: 'fallback', route: { kind: 'fallback', pattern: '/*' } },
      ],
    });

    assert.equal(matcher.match('/items/42').params.id, 42);
    assert.equal(matcher.match('/items/not-an-int').viewId, 'fallback');
  });

  it("matches ':name+' only for type:'path' params", () => {
    let ok = createRouteMatcher({
      views: [
        { id: 'file', route: { pattern: '/files/:path+', params: [{ name: 'path', type: 'path' }] } },
      ],
    });
    assert.equal(ok.match('/files/a/b/c').params.path, 'a/b/c');

    let bad = createRouteMatcher({
      views: [
        { id: 'file', route: { pattern: '/files/:path+', params: [{ name: 'path', type: 'string' }] } },
        { id: 'fallback', route: { kind: 'fallback', pattern: '/*' } },
      ],
    });
    assert.equal(bad.match('/files/a/b').viewId, 'fallback');
  });

  it('resolves redirects in the same match table with SSR status signalling', () => {
    let matcher = createRouteMatcher({
      views: [
        { id: 'work-order', route: { pattern: '/work-orders/:id', params: [{ name: 'id', type: 'id' }] } },
      ],
      redirects: [
        { id: 'legacy-wo', pattern: '/wo/:id', to: '/work-orders/:id', permanent: true },
      ],
    });

    let result = matcher.resolve('/wo/abc-123?tab=summary');
    assert.equal(result.type, 'route');
    assert.equal(result.status, 301);
    assert.deepEqual(result.redirects, [{
      id: 'legacy-wo',
      from: '/wo/abc-123?tab=summary',
      to: '/work-orders/abc-123?tab=summary',
      permanent: true,
      status: 301,
    }]);
    assert.equal(result.match.viewId, 'work-order');
    assert.equal(result.match.params.id, 'abc-123');
  });

  it('reports redirect cycles and the runtime hop cap', () => {
    let cycle = createRouteMatcher({
      redirects: [
        { id: 'a', pattern: '/a', to: '/b' },
        { id: 'b', pattern: '/b', to: '/a' },
      ],
    });
    assert.equal(cycle.resolve('/a').type, 'redirect-cycle');

    let hops = createRouteMatcher({
      views: [{ id: 'done', route: { pattern: '/e' } }],
      redirects: [
        { id: 'a', pattern: '/a', to: '/b' },
        { id: 'b', pattern: '/b', to: '/c' },
        { id: 'c', pattern: '/c', to: '/d' },
        { id: 'd', pattern: '/d', to: '/e' },
      ],
    });
    let result = hops.resolve('/a');
    assert.equal(result.type, 'redirect-limit');
    assert.equal(result.error.code, 'route.redirect.hop_limit');
    assert.equal(result.redirects.length, 3);
  });
});
