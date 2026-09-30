import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createConnectionManager } from '../plugins/connection-manager.js';

// Lifecycle of running connections, as distinct from the definition catalog.
// The invariants here are the ones a shared registry cannot express: activation
// happens once no matter how many consumers arrive, a consumer leaving does not
// destroy a resource another consumer still holds, and a failed activation owns
// nothing.

function probePlugin(name, hooks = {}) {
  return {
    name,
    version: '1.0.0',
    ...hooks,
  };
}

describe('plugin connection manager', () => {
  it('activates once no matter how many consumers acquire concurrently', async () => {
    let manager = createConnectionManager();
    let activations = 0;
    manager.define(
      probePlugin('busy', {
        activate: async () => {
          activations += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return async () => {};
        },
      }),
    );

    let results = await Promise.all(
      Array.from({ length: 20 }, () => manager.acquire('busy')),
    );

    assert.equal(activations, 1, 'twenty concurrent acquires must run activation once');
    for (let result of results) assert.equal(result.ok, true, 'every consumer gets a lease');
    assert.equal(manager.getConnection('busy').leaseCount, 20);
  });

  it('keeps the connection alive while any consumer still holds a lease', async () => {
    let manager = createConnectionManager();
    let closes = 0;
    manager.define(
      probePlugin('shared', {
        activate: async () => async () => {
          closes += 1;
        },
      }),
    );

    let first = await manager.acquire('shared');
    let second = await manager.acquire('shared');
    assert.equal(manager.getConnection('shared').leaseCount, 2);

    let released = await first.lease.release();
    assert.equal(released.stillActive, true, 'one consumer leaving must not close a shared connection');
    assert.equal(closes, 0, 'the connection is still in use');

    let last = await second.lease.release();
    assert.equal(last.stillActive, false, 'the last lease out closes the connection');
    assert.equal(closes, 1, 'the connection closes exactly once');
    assert.equal(manager.getConnection('shared'), null);
  });

  it('leaves nothing behind when activation fails, and allows a clean retry', async () => {
    let errors = [];
    let manager = createConnectionManager({ onError: (err, name) => errors.push({ name, err }) });
    let attempts = 0;
    manager.define(
      probePlugin('flaky', {
        activate: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('activation refused');
          return async () => {};
        },
      }),
    );

    let failed = await manager.acquire('flaky');
    assert.equal(failed.ok, false, 'a failed activation grants no lease');
    assert.equal(failed.error, 'activation refused');
    assert.equal(manager.getConnection('flaky'), null, 'a failed activation leaves no connection behind');
    assert.equal(errors.length, 1, 'the failure is reported to the owner');

    let retried = await manager.acquire('flaky');
    assert.equal(retried.ok, true, 'a failed activation must not poison later attempts');
    assert.equal(attempts, 2);
  });

  it('refuses to redefine a plugin while consumers still hold leases on it', async () => {
    let manager = createConnectionManager();
    manager.define(probePlugin('held', { activate: async () => async () => {} }));
    let lease = await manager.acquire('held');

    let result = manager.define(probePlugin('held', { activate: async () => async () => {} }));
    assert.equal(result.ok, false, 'redefining a running plugin would strand its consumers');
    assert.match(result.errors[0].message, /lease/);

    await lease.lease.release();
    assert.equal(
      manager.define(probePlugin('held', { activate: async () => async () => {} })).ok,
      true,
      'once the last lease is released the name can be redefined',
    );
  });

  it('does not hand the same connection to a redefinition after a clean release', async () => {
    let manager = createConnectionManager();
    let activations = 0;
    manager.define(probePlugin('revived', { activate: async () => { activations += 1; return async () => {}; } }));
    let first = await manager.acquire('revived');
    await first.lease.release();

    manager.define(probePlugin('revived', { activate: async () => { activations += 1; return async () => {}; } }));
    await manager.acquire('revived');

    assert.equal(activations, 2, 'a redefined plugin activates its new definition, not the old one');
  });
});
