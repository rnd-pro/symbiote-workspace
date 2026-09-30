import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  askCloseDecision,
  assertRouteRoundTrip,
  disposeOnce,
  validateCompositionDefinition,
} from '../schema/composition-descriptor.js';
import { createCompositionRegistry, RESOLUTION_STATUSES } from '../runtime/composition-registry.js';

// The descriptor contract. The point of these is not that the shape exists, but
// that the shell can act on the answers without knowing the product: an address
// either resolves to a runnable composition or says why it cannot, and closing
// either happens or is explained.

function documentViewer(overrides = {}) {
  return {
    id: 'documents.viewer',
    version: '1.0.0',
    configSchemaVersion: 1,
    route: {
      parseRoute: (url) => {
        let match = /^\/docs\/([^/?#]+)/.exec(String(url));
        return match ? { status: 'match', target: { documentRef: `doc:notes:${match[1]}` } } : { status: 'no-match' };
      },
      serializeRoute: (target) => `/docs/${String(target.documentRef).split(':').pop()}`,
    },
    dependencies: { required: ['storage.collection.default'], optional: ['presence'] },
    instances: { reuseKey: (params) => `doc:${params.documentRef}`, allowMultiple: true },
    state: {
      slots: [
        { id: 'body', kind: 'persistent' },
        { id: 'selection', kind: 'view-local' },
        { id: 'overlay', kind: 'ephemeral' },
      ],
    },
    resources: { acquisitions: [{ kind: 'document', ref: 'documentRef' }] },
    lifecycle: {
      prepare: async (context) => ({ context }),
      mount: async (prepared) => ({ ...prepared, mounted: true }),
      beforeClose: async () => 'allow',
      dispose: async () => {},
    },
    restoration: {
      version: 1,
      serialize: async () => ({ version: 1, refs: ['doc:notes:n1'] }),
      migrate: async (saved) => saved,
      restore: async (saved) => ({ restored: true, saved }),
    },
    updates: { strategy: 'checkpoint' },
    ...overrides,
  };
}

describe('composition descriptor contract', () => {
  it('accepts a complete descriptor and names every problem of an incomplete one', () => {
    assert.equal(validateCompositionDefinition(documentViewer()).valid, true);

    let broken = validateCompositionDefinition({ id: 'x', version: '1.0.0' });
    assert.equal(broken.valid, false);
    let paths = broken.errors.map((error) => error.path);
    for (let path of ['route', 'lifecycle', 'restoration']) {
      assert.ok(paths.includes(path), `an incomplete descriptor must report ${path}`);
    }
  });

  it('refuses a state slot that cannot name its owner', () => {
    let broken = validateCompositionDefinition(
      documentViewer({
        state: { slots: [{ id: 'body', kind: 'persistent', owner: 'currentTab' }] },
      }),
    );
    assert.equal(broken.valid, false);
    assert.ok(
      broken.errors.some((error) => error.path.endsWith('.owner')),
      'a slot owned by a non-axis must be rejected',
    );
  });

  it('refuses a persistent slot owned by an ephemeral axis', () => {
    let broken = validateCompositionDefinition(
      documentViewer({
        state: { slots: [{ id: 'body', kind: 'persistent', owner: 'mountId' }] },
      }),
    );
    assert.equal(broken.valid, false, 'a remount must not be able to erase durable state');
  });

  it('requires parseRoute(serializeRoute(target)) to return the same target', () => {
    let roundTrip = assertRouteRoundTrip(documentViewer(), { documentRef: 'doc:notes:n1' });
    assert.equal(roundTrip.ok, true);
    assert.equal(roundTrip.url, '/docs/n1');

    let lying = documentViewer({
      route: {
        parseRoute: (url) => ({ status: 'match', target: { documentRef: 'doc:notes:other' } }),
        serializeRoute: (target) => '/docs/n1',
      },
    });
    let broken = assertRouteRoundTrip(lying, { documentRef: 'doc:notes:n1' });
    assert.equal(broken.ok, false, 'a route that does not round-trip cannot carry restoration');
  });

  it('normalises an unknown decision rather than inventing a fourth outcome', async () => {
    let decided = await askCloseDecision(documentViewer(), {});
    assert.equal(decided.decision, 'allow');

    let odd = documentViewer({ lifecycle: { ...documentViewer().lifecycle, beforeClose: async () => 'maybe' } });
    let normalized = await askCloseDecision(odd, {});
    assert.equal(
      normalized.decision,
      'needs-decision',
      'an unknown decision must fall back to asking the user, not to closing silently',
    );
  });

  it('disposes once and still releases everything when user cleanup throws', async () => {
    let released = 0;
    let state = {
      instance: {
        dispose: async () => {
          throw new Error('user cleanup failed');
        },
      },
      releases: [async () => { released += 1; }, async () => { released += 1; }],
    };

    let first = await disposeOnce(state);
    assert.equal(first.ok, false, 'the failure is reported');
    assert.equal(first.failures[0].source, 'instance.dispose');
    assert.equal(released, 2, 'accounted resources are released even after user cleanup throws');

    let second = await disposeOnce(state);
    assert.equal(second.alreadyDisposed, true, 'dispose is idempotent');
    assert.equal(released, 2, 'a second dispose must not release anything again');
  });
});

describe('composition registry', () => {
  it('resolves an address to the composition that claims it', () => {
    let registry = createCompositionRegistry();
    registry.register(documentViewer());

    let resolved = registry.resolveRoute('/docs/n1');
    assert.equal(resolved.status, RESOLUTION_STATUSES.ready);
    assert.equal(resolved.compositionId, 'documents.viewer');
    assert.deepEqual(resolved.target, { documentRef: 'doc:notes:n1' });
  });

  it('reports an unmatched address instead of returning null', () => {
    let registry = createCompositionRegistry();
    registry.register(documentViewer());

    let resolved = registry.resolveRoute('/nowhere');
    assert.equal(resolved.status, RESOLUTION_STATUSES.noMatch);
    assert.equal(resolved.url, '/nowhere', 'the address is preserved so the caller can show it');
  });

  it('resolves without touching the network or creating an instance', () => {
    let calls = [];
    let registry = createCompositionRegistry();
    registry.register(
      documentViewer({
        lifecycle: {
          ...documentViewer().lifecycle,
          prepare: async () => { calls.push('prepare'); return {}; },
          mount: async () => { calls.push('mount'); return {}; },
        },
      }),
    );

    registry.resolveRoute('/docs/n1');
    assert.deepEqual(calls, [], 'routing is pure; creating is a separate, explicit step');
  });

  it('opens an addressable blocked state when a required dependency is missing', () => {
    let blockedEvents = [];
    let registry = createCompositionRegistry({ onBlocked: (event) => blockedEvents.push(event) });
    registry.register(documentViewer());

    let preflight = registry.preflight('documents.viewer', { documentRef: 'doc:notes:n1' }, []);
    assert.equal(preflight.status, RESOLUTION_STATUSES.blocked);
    assert.deepEqual(preflight.missing, ['storage.collection.default']);
    assert.equal(preflight.retryable, true, 'a later retry must still be able to resolve the address');
    assert.equal(blockedEvents.length, 1, 'the blocked state is observable, not silent');
  });

  it('reports a declared degraded mode for a missing optional dependency', () => {
    let registry = createCompositionRegistry();
    registry.register(documentViewer());

    let preflight = registry.preflight('documents.viewer', { documentRef: 'doc:notes:n1' }, [
      'storage.collection.default',
    ]);
    assert.equal(preflight.status, RESOLUTION_STATUSES.ready);
    assert.deepEqual(preflight.degraded, ['presence']);
  });

  it('rejects a route that does not round-trip before any instance exists', () => {
    let registry = createCompositionRegistry();
    registry.register(
      documentViewer({
        route: {
          parseRoute: () => ({ status: 'match', target: { documentRef: 'doc:notes:other' } }),
          serializeRoute: () => '/docs/n1',
        },
      }),
    );

    let preflight = registry.preflight('documents.viewer', { documentRef: 'doc:notes:n1' }, [
      'storage.collection.default',
    ]);
    assert.equal(preflight.status, RESOLUTION_STATUSES.invalid);
  });
});
