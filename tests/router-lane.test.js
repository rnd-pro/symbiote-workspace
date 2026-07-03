import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRouter } from '../runtime/router-lane.js';
import { handlers } from '../runtime/tools/route-tools.js';

const allowSnapshot = {
  capabilities: {
    'orders.read': { auth: { policy: 'allow' } },
  },
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('router lane', () => {
  it('runs leave guards, enter guards, loaders, and route events in order', async () => {
    let order = [];
    let router = createRouter({
      views: [
        {
          id: 'home',
          route: {
            pattern: '/home',
            guards: [{ on: 'leave', hook: 'leave-home' }],
          },
        },
        {
          id: 'order',
          route: {
            pattern: '/orders/:id',
            params: [{ name: 'id', type: 'id' }],
            guards: [{ on: 'enter', requires: 'orders.read' }],
            data: [{ id: 'record', source: { resource: 'orders', op: 'get', args: { id: '$params.id' } } }],
          },
        },
      ],
    }, {
      mode: 'memory',
      capabilitySnapshot: allowSnapshot,
      guardHooks: {
        'leave-home': () => {
          order.push('leave');
          return 'allow';
        },
      },
      loaders: {
        record: ({ args }) => {
          order.push(`loader:${args.id}`);
          return { id: args.id };
        },
      },
    });
    router.on('*', ({ subject }) => order.push(subject));

    assert.equal((await router.navigate({ to: { url: '/home' } })).ok, true);
    assert.equal((await router.navigate({ to: { view: 'order', params: { id: 'abc-1' } } })).ok, true);

    assert.deepEqual(order, [
      'route:enter:home',
      'leave',
      'route:exit:home',
      'loader:abc-1',
      'route:enter:order',
    ]);
    assert.deepEqual(router.getState('state:route.data.record'), { id: 'abc-1' });
  });

  it('denies enter guards without a usable capability snapshot and preserves the target URL', async () => {
    let router = createRouter({
      views: [
        {
          id: 'admin',
          route: {
            pattern: '/admin',
            guards: [{ on: 'enter', requires: 'admin.read' }],
          },
        },
      ],
    }, { mode: 'memory', capabilitySnapshot: allowSnapshot });

    let result = await router.navigate({ to: { url: '/admin' } });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'denied');
    assert.equal(router.location, '/admin');
    assert.deepEqual(router.getState('state:route.denied'), {
      view: 'admin',
      reason: 'capability-unknown',
      requires: 'admin.read',
    });
    assert.equal(router.events.some((event) => event.subject === 'route:enter:admin'), false);
  });

  it('holds a departing view while its gate verdict is pendingApproval', async () => {
    let router = createRouter({
      views: [
        { id: 'edit', route: { pattern: '/edit' } },
        { id: 'done', route: { pattern: '/done' } },
      ],
    }, {
      mode: 'memory',
      gateVerdicts: { edit: 'pendingApproval' },
      parkExpiryMs: 200,
    });

    await router.navigate({ to: { url: '/edit' } });
    let settled = false;
    let pending = router.navigate({ to: { url: '/done' } }).then((result) => {
      settled = true;
      return result;
    });
    await wait(25);
    assert.equal(settled, false);
    assert.equal(router.events.some((event) => event.subject === 'route:hold:edit'), true);

    router.setGateVerdict('edit', 'accepted');
    let result = await pending;
    assert.equal(result.ok, true);
    assert.equal(router.getState('state:route.view'), 'done');
  });

  it("turns params[].binding sync:'two-way' writes into real navigations", async () => {
    let router = createRouter({
      views: [
        {
          id: 'item',
          route: {
            pattern: '/items/:id',
            params: [{ name: 'id', type: 'string', binding: 'state:selectedItem', sync: 'two-way' }],
          },
        },
      ],
    }, { mode: 'memory' });

    await router.navigate({ to: { view: 'item', params: { id: 'a' } } });
    let result = await router.writeBinding('state:selectedItem', 'b');
    assert.equal(result.ok, true);
    assert.equal(result.history, 'push');
    assert.equal(router.location, '/items/b');
    assert.equal(router.getState('state:route.params.id'), 'b');
  });

  it('reruns current enter guards on capability readiness changes', async () => {
    let snapshot = {
      capabilities: {
        'orders.read': { auth: { policy: 'allow' } },
      },
    };
    let router = createRouter({
      views: [
        {
          id: 'order',
          route: {
            pattern: '/orders/:id',
            params: [{ name: 'id', type: 'id' }],
            guards: [{ on: 'enter', requires: 'orders.read' }],
          },
        },
      ],
    }, { mode: 'memory', capabilitySnapshot: snapshot });

    assert.equal((await router.navigate({ to: { url: '/orders/abc' } })).ok, true);
    snapshot.capabilities['orders.read'] = { auth: { policy: 'deny' } };

    let denied = await router.handleRuntimeEvent('rt:workspace:capabilities', {
      type: 'readiness-changed',
      changed: ['orders.read'],
    });
    assert.equal(denied.status, 'denied');
    assert.equal(router.getState('state:route.denied.reason'), 'capability-denied');

    snapshot.capabilities['orders.read'] = { auth: { policy: 'allow' } };
    let accepted = await router.handleRuntimeEvent('rt:workspace:capabilities', {
      type: 'readiness-changed',
      changed: ['orders.read'],
    });
    assert.equal(accepted.status, 'accepted');
    assert.equal(router.getState('state:route.denied'), null);
  });

  it('resets route state when parameterized mount params change', async () => {
    let router = createRouter({
      views: [{ id: 'home', route: { pattern: '/home' } }],
    }, {
      mode: 'memory',
      basePath: '/p/:projectId',
      mount: { projectId: 'one' },
    });

    await router.navigate({ to: { url: '/p/one/home' } });
    await router.navigate({ to: { url: '/p/two/home' } });
    assert.equal(router.getState('state:route.mount.projectId'), 'two');
    assert.equal(router.events.some((event) => event.subject === 'route:reset'), true);
  });

  it('exports route tool handlers for navigate and resolve_route', async () => {
    let router = createRouter({
      views: [
        {
          id: 'item',
          route: {
            pattern: '/items/:id',
            params: [{ name: 'id', type: 'string' }],
          },
        },
      ],
    }, { mode: 'memory' });

    let session = { router, actor: { kind: 'agent' } };
    let nav = await handlers.navigate({ to: { view: 'item', params: { id: 'tool' } } }, session);
    assert.equal(nav.ok, true);
    assert.match(nav.intentId, /^navigate\.agent:/);

    let resolved = await handlers.resolve_route({ to: { view: 'item', params: { id: 'next' } } }, session);
    assert.equal(resolved.type, 'route');
    assert.equal(resolved.match.params.id, 'next');
  });
});
