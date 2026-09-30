import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  UPDATE_STATUSES,
  applyCompositionUpdate,
  planCompositionUpdate,
  planSlotMigration,
} from '../runtime/composition-update.js';

// Update without losing state. The order of operations is the guarantee: the old
// mount stays live until a new one has been prepared and restored, so any
// failure leaves the previous composition working rather than replacing it with
// nothing.

function descriptor(overrides = {}) {
  return {
    id: 'documents.viewer',
    state: { slots: [{ id: 'body', kind: 'persistent' }, { id: 'scroll', kind: 'view-local' }] },
    dependencies: { required: ['storage.collection.default'], optional: [] },
    restoration: {
      version: 1,
      restore: async (saved) => ({ ...saved, restored: true }),
    },
    updates: { strategy: 'checkpoint' },
    ...overrides,
  };
}

describe('slot migration plan', () => {
  it('preserves, migrates, re-acquires, and reports what disappeared', () => {
    let plan = planSlotMigration(
      [{ id: 'body', kind: 'persistent' }, { id: 'scroll', kind: 'view-local' }, { id: 'gone', kind: 'session' }],
      [{ id: 'body', kind: 'persistent' }, { id: 'scroll', kind: 'persistent' }, { id: 'new', kind: 'cache' }],
    );

    assert.deepEqual(plan.preserve, ['body']);
    assert.deepEqual(plan.migrate, [{ id: 'scroll', from: 'view-local', to: 'persistent' }]);
    assert.deepEqual(plan.reacquire, ['new']);
    assert.deepEqual(plan.dropped, ['gone'], 'a disappearing slot must be reported, not silently lost');
  });
});

describe('update plan', () => {
  it('plans a clean update when nothing is dirty', () => {
    let plan = planCompositionUpdate(descriptor(), descriptor(), {
      available: ['storage.collection.default'],
    });
    assert.equal(plan.status, 'ready');
    assert.equal(plan.requiresMigration, false);
  });

  it('blocks rather than discarding dirty work it cannot checkpoint', () => {
    let plan = planCompositionUpdate(descriptor(), descriptor(), {
      available: ['storage.collection.default'],
      dirtySlots: ['body'],
      checkpointableSlots: [],
    });

    assert.equal(plan.status, UPDATE_STATUSES.blocked);
    assert.equal(plan.reason, 'unsavable-dirty-state');
    assert.deepEqual(plan.unsavable, ['body']);
    assert.equal(plan.strategy, 'deferred');
  });

  it('carries dirty work that can be checkpointed', () => {
    let plan = planCompositionUpdate(descriptor(), descriptor(), {
      available: ['storage.collection.default'],
      dirtySlots: ['body'],
      checkpointableSlots: ['body'],
    });
    assert.equal(plan.status, 'ready', 'checkpointable dirty state is safe to carry across');
  });

  it('blocks a switch that would destroy ephemeral dirty state even if checkpointable', () => {
    let previous = descriptor({ state: { slots: [{ id: 'scratch', kind: 'ephemeral' }] } });
    let next = descriptor({ state: { slots: [{ id: 'scratch', kind: 'ephemeral' }] } });
    let plan = planCompositionUpdate(previous, next, {
      available: ['storage.collection.default'],
      dirtySlots: ['scratch'],
      checkpointableSlots: ['scratch'],
    });
    assert.equal(plan.status, UPDATE_STATUSES.blocked, 'ephemeral state cannot be carried by definition');
  });

  it('blocks on a missing required dependency instead of half-updating', () => {
    let plan = planCompositionUpdate(descriptor(), descriptor(), { available: [] });
    assert.equal(plan.status, UPDATE_STATUSES.blocked);
    assert.equal(plan.reason, 'missing-dependency');
    assert.equal(plan.retryable, true);
  });

  it('treats a different composition as not an update', () => {
    let plan = planCompositionUpdate(
      descriptor(),
      descriptor({ id: 'other.thing' }),
      { available: ['storage.collection.default'] },
    );
    assert.equal(plan.status, UPDATE_STATUSES.blocked);
    assert.equal(plan.reason, 'different-composition');
  });

  it('blocks an unauthorised restoration-version change', () => {
    let plan = planCompositionUpdate(
      descriptor({ restoration: { version: 1, restore: async () => ({}) } }),
      descriptor({ restoration: { version: 2, restore: async () => ({}) } }),
      { available: ['storage.collection.default'] },
    );
    assert.equal(plan.status, UPDATE_STATUSES.blocked);
    assert.equal(plan.reason, 'restoration-version-changed');
  });
});

describe('applying an update', () => {
  it('prepares, restores, switches, then releases — in that order', async () => {
    let order = [];
    let plan = planCompositionUpdate(descriptor(), descriptor(), {
      available: ['storage.collection.default'],
    });

    let result = await applyCompositionUpdate({
      plan,
      previous: descriptor(),
      next: descriptor(),
      prepare: async (context) => {
        order.push('prepare');
        assert.equal(context.replayEffects, false, 'preparation must not replay external effects');
        return { session: { body: 'carried' } };
      },
      switchMount: async () => order.push('switch'),
      release: async () => order.push('release'),
    });

    assert.equal(result.status, UPDATE_STATUSES.applied);
    assert.deepEqual(order, ['prepare', 'switch', 'release']);
  });

  it('leaves the previous mount live when preparation fails', async () => {
    let released = false;
    let plan = planCompositionUpdate(descriptor(), descriptor(), {
      available: ['storage.collection.default'],
    });

    let result = await applyCompositionUpdate({
      plan,
      previous: descriptor(),
      next: descriptor(),
      prepare: async () => { throw new Error('module incompatible'); },
      switchMount: async () => { throw new Error('must not switch'); },
      release: async () => { released = true; },
    });

    assert.equal(result.status, UPDATE_STATUSES.failed);
    assert.equal(result.stage, 'prepare');
    assert.equal(result.previousStillMounted, true);
    assert.equal(released, false, 'the working mount must not be released on failure');
  });

  it('leaves the previous mount live when restore fails after a successful prepare', async () => {
    let released = false;
    let switched = false;
    let plan = planCompositionUpdate(descriptor(), descriptor(), {
      available: ['storage.collection.default'],
    });

    let result = await applyCompositionUpdate({
      plan,
      previous: descriptor(),
      next: descriptor({
        restoration: { version: 1, restore: async () => { throw new Error('state shape changed'); } },
      }),
      prepare: async () => ({ session: {} }),
      switchMount: async () => { switched = true; },
      release: async () => { released = true; },
    });

    assert.equal(result.status, UPDATE_STATUSES.failed);
    assert.equal(result.stage, 'restore');
    assert.equal(switched, false);
    assert.equal(released, false, 'release happens last, and only after a successful switch');
  });

  it('reports a release failure without undoing a successful switch', async () => {
    let plan = planCompositionUpdate(descriptor(), descriptor(), {
      available: ['storage.collection.default'],
    });
    let result = await applyCompositionUpdate({
      plan,
      previous: descriptor(),
      next: descriptor(),
      prepare: async () => ({ session: {} }),
      switchMount: async () => {},
      release: async () => { throw new Error('teardown incomplete'); },
    });

    assert.equal(result.status, UPDATE_STATUSES.applied, 'the new composition is live');
    assert.equal(result.releaseFailure, 'teardown incomplete', 'the leak is reported, not hidden');
  });

  it('does nothing at all without a ready plan', async () => {
    let prepared = false;
    let plan = planCompositionUpdate(descriptor(), descriptor(), { available: [] });
    let result = await applyCompositionUpdate({
      plan,
      previous: descriptor(),
      next: descriptor(),
      prepare: async () => { prepared = true; },
    });

    assert.equal(result.status, UPDATE_STATUSES.blocked);
    assert.equal(prepared, false, 'a blocked update must not touch the live mount');
  });
});

describe('a switch that applies nothing is not an applied update', () => {
  // The Maximo demo's runtimeController returns `{ updateConfig() {}, destroy() {...} }`.
  // That reports success while changing nothing, which is the exact outcome the
  // contract must refuse to call an applied update.
  it('refuses a switch that returns nothing while work was declared', async () => {
    let plan = planCompositionUpdate(descriptor(), descriptor({
      state: { slots: [{ id: 'body', kind: 'persistent' }] },
    }), {
      available: ['storage.collection.default'],
      dirtySlots: ['body'],
      checkpointableSlots: ['body'],
    });
    assert.equal(plan.status, 'ready');

    let released = false;
    let result = await applyCompositionUpdate({
      plan,
      previous: descriptor(),
      next: descriptor({ state: { slots: [{ id: 'body', kind: 'persistent' }] } }),
      prepare: async () => ({ session: { body: 'carried' } }),
      // The empty stub: reports nothing at all.
      switchMount: async () => undefined,
      release: async () => { released = true; },
    });

    assert.equal(result.status, UPDATE_STATUSES.notApplied);
    assert.match(result.reason, /applied no declared change/);
    assert.equal(released, false, 'a switch that applied nothing must not release the old mount');
  });

  it('refuses a switch that explicitly reports zero applied items', async () => {
    let plan = planCompositionUpdate(descriptor(), descriptor({
      state: { slots: [{ id: 'body', kind: 'persistent' }] },
    }), {
      available: ['storage.collection.default'],
      dirtySlots: ['body'],
      checkpointableSlots: ['body'],
    });

    let result = await applyCompositionUpdate({
      plan,
      previous: descriptor(),
      next: descriptor({ state: { slots: [{ id: 'body', kind: 'persistent' }] } }),
      prepare: async () => ({ session: {} }),
      switchMount: async () => ({ applied: [] }),
    });

    assert.equal(result.status, UPDATE_STATUSES.notApplied);
  });

  it('accepts a switch that reports what it applied', async () => {
    let plan = planCompositionUpdate(descriptor(), descriptor({
      state: { slots: [{ id: 'body', kind: 'persistent' }] },
    }), {
      available: ['storage.collection.default'],
      dirtySlots: ['body'],
      checkpointableSlots: ['body'],
    });

    let result = await applyCompositionUpdate({
      plan,
      previous: descriptor(),
      next: descriptor({ state: { slots: [{ id: 'body', kind: 'persistent' }] } }),
      prepare: async () => ({ session: {} }),
      switchMount: async () => ({ applied: ['body'] }),
    });

    assert.equal(result.status, UPDATE_STATUSES.applied, 'a switch that says what it applied is trusted');
  });

  it('tolerates a silent switch when no change was declared', async () => {
    let plan = planCompositionUpdate(descriptor(), descriptor(), {
      available: ['storage.collection.default'],
    });
    assert.equal(plan.slots.migrate.length, 0, 'the plan declares no work in this case');
    assert.equal(plan.dirty.length, 0);

    let result = await applyCompositionUpdate({
      plan,
      previous: descriptor(),
      next: descriptor(),
      prepare: async () => ({ session: {} }),
      switchMount: async () => undefined,
    });

    assert.equal(
      result.status,
      UPDATE_STATUSES.applied,
      'a no-op update is legitimate when the plan genuinely declares no work',
    );
  });
});

describe('a plan from an old generation must not overwrite newer state', () => {
  function planAt(generation) {
    return planCompositionUpdate(descriptor(), descriptor({
      state: { slots: [{ id: 'body', kind: 'persistent' }] },
    }), {
      available: ['storage.collection.default'],
      dirtySlots: ['body'],
      checkpointableSlots: ['body'],
      currentGeneration: generation,
    });
  }

  it('refuses a plan whose generation has moved on, before doing any work', async () => {
    let prepared = false;
    let switched = false;
    let released = false;
    let plan = planAt(4);

    let result = await applyCompositionUpdate({
      plan,
      previous: descriptor(),
      next: descriptor({ state: { slots: [{ id: 'body', kind: 'persistent' }] } }),
      currentGeneration: 5,
      prepare: async () => { prepared = true; return { session: {} }; },
      switchMount: async () => { switched = true; },
      release: async () => { released = true; },
    });

    assert.equal(result.status, UPDATE_STATUSES.stale);
    assert.equal(result.plannedAgainst, 4);
    assert.equal(result.currentGeneration, 5);
    assert.equal(prepared, false, 'a stale plan must cost nothing');
    assert.equal(switched, false);
    assert.equal(released, false, 'the previous composition keeps its mount');
  });

  it('applies a plan whose generation is still current', async () => {
    let plan = planAt(5);
    let result = await applyCompositionUpdate({
      plan,
      previous: descriptor(),
      next: descriptor({ state: { slots: [{ id: 'body', kind: 'persistent' }] } }),
      currentGeneration: 5,
      prepare: async () => ({ session: {} }),
      switchMount: async () => ({ applied: ['body'] }),
    });

    assert.equal(result.status, UPDATE_STATUSES.applied);
  });

  it('applies a plan with no generation constraint at all', async () => {
    let plan = planCompositionUpdate(descriptor(), descriptor({
      state: { slots: [{ id: 'body', kind: 'persistent' }] },
    }), {
      available: ['storage.collection.default'],
      dirtySlots: ['body'],
      checkpointableSlots: ['body'],
    });
    assert.equal(plan.baseGeneration, null, 'an unconstrained plan opts out of the guard');

    let result = await applyCompositionUpdate({
      plan,
      previous: descriptor(),
      next: descriptor({ state: { slots: [{ id: 'body', kind: 'persistent' }] } }),
      currentGeneration: 99,
      prepare: async () => ({ session: {} }),
      switchMount: async () => ({ applied: ['body'] }),
    });

    assert.equal(result.status, UPDATE_STATUSES.applied);
  });
});

describe('a half-built candidate does not keep its resources', () => {
  it('releases what the candidate acquired when preparation fails', async () => {
    let freed = 0;
    let plan = planCompositionUpdate(descriptor(), descriptor(), {
      available: ['storage.collection.default'],
    });

    let result = await applyCompositionUpdate({
      plan,
      previous: descriptor(),
      next: descriptor(),
      prepare: async () => ({ session: {}, releases: [async () => { freed += 1; }] }),
      switchMount: async () => { throw new Error('must not switch'); },
    });

    assert.equal(result.status, UPDATE_STATUSES.failed);
    assert.equal(freed, 1, 'resources acquired by the failed candidate are handed back');
    assert.equal(result.candidateReleased, true);
  });

  it('releases the candidate when restore fails after a successful prepare', async () => {
    let freed = 0;
    let plan = planCompositionUpdate(descriptor(), descriptor(), {
      available: ['storage.collection.default'],
    });

    let result = await applyCompositionUpdate({
      plan,
      previous: descriptor(),
      next: descriptor({
        restoration: { version: 1, restore: async () => { throw new Error('incompatible'); } },
      }),
      prepare: async () => ({ session: {}, releases: [async () => { freed += 1; }] }),
    });

    assert.equal(result.stage, 'restore');
    assert.equal(freed, 1);
  });
});
