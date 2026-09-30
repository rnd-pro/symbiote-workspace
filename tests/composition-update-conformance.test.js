import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  UPDATE_STATUSES,
  applyCompositionUpdate,
  planCompositionUpdate,
} from '../runtime/composition-update.js';

// Conformance suite for the composition update guarantee.
//
// The guarantee under test: **before a successful switch the old coherent
// composition stays active; after it the new one is. A failed preparation
// destroys neither the old composition nor partially prepared state.** Plus the
// two properties that make a switch mean anything: a stale plan cannot overwrite
// newer state, and a switch reporting success while applying nothing is refused.
//
// This is a suite a host or a runtime author runs against its own update
// implementation, not a test of one implementation. Declaring that a runtime
// supports updates is a claim, not evidence, so the evidence has to come from
// injected failures.

function definition(overrides = {}) {
  return {
    id: 'documents.viewer',
    state: { slots: [{ id: 'body', kind: 'persistent' }] },
    dependencies: { required: ['storage.collection.default'], optional: [] },
    restoration: { version: 1, restore: async (saved) => ({ ...saved, restored: true }) },
    updates: { strategy: 'checkpoint' },
    ...overrides,
  };
}

function planFor(generation) {
  return planCompositionUpdate(definition(), definition(), {
    available: ['storage.collection.default'],
    dirtySlots: ['body'],
    checkpointableSlots: ['body'],
    currentGeneration: generation ?? null,
  });
}

export function runUpdateConformance(name, impl) {
  describe(`update conformance: ${name}`, () => {
    it('keeps the old composition active when preparation fails', async () => {
      const world = impl();
      let result = await world.attempt({ plan: planFor(1), failAt: 'prepare' });

      assert.equal(result.status, UPDATE_STATUSES.failed);
      assert.equal(result.previousStillMounted, true);
      assert.equal(world.active(), 'old', 'the old composition must still be the active one');
    });

    it('keeps the old composition active when restore fails', async () => {
      const world = impl();
      let result = await world.attempt({ plan: planFor(1), failAt: 'restore' });

      assert.equal(result.status, UPDATE_STATUSES.failed);
      assert.equal(result.stage, 'restore');
      assert.equal(world.active(), 'old');
    });

    it('keeps the old composition active when the switch itself fails', async () => {
      const world = impl();
      let result = await world.attempt({ plan: planFor(1), failAt: 'switch' });

      assert.equal(result.status, UPDATE_STATUSES.failed);
      assert.equal(world.active(), 'old');
    });

    it('hands back the candidate resources on every failure stage', async () => {
      for (let failAt of ['prepare', 'restore', 'switch']) {
        const world = impl();
        let result = await world.attempt({ plan: planFor(1), failAt });
        // The generation is re-read per attempt, so a fresh world per stage is
        // what makes this a real per-stage check rather than a single run.

        assert.equal(
          world.outstandingCandidateResources(),
          0,
          `a candidate that failed at ${failAt} must not keep resources`,
        );
        assert.notEqual(result.candidateReleased, undefined);
      }
    });

    it('never lets partially prepared state become active', async () => {
      const world = impl();
      await world.attempt({ plan: planFor(1), failAt: 'restore' });

      assert.equal(world.activeState(), undefined, 'no half-prepared state may surface');
      assert.equal(world.active(), 'old');
    });

    it('refuses a plan whose generation has moved on', async () => {
      const world = impl();
      let plan = planFor(1);
      world.advanceGenerationTo(2);

      let result = await world.attempt({ plan, failAt: null });

      assert.equal(result.status, UPDATE_STATUSES.stale);
      assert.equal(world.active(), 'old');
      assert.equal(world.prepareCalls(), 0, 'a stale plan must not start work');
    });

    it('refuses a switch that reports success while applying nothing', async () => {
      const world = impl();
      let result = await world.attempt({ plan: planFor(1), failAt: null, reportApplied: [] });

      assert.equal(result.status, UPDATE_STATUSES.notApplied);
      assert.equal(world.active(), 'old');
    });

    it('makes the new composition active only after a real switch', async () => {
      const world = impl();
      let result = await world.attempt({ plan: planFor(1), failAt: null, reportApplied: ['body'] });

      assert.equal(result.status, UPDATE_STATUSES.applied);
      assert.equal(world.active(), 'new');
    });

    it('distinguishes a refusal before the switch from a cleanup error after it', async () => {
      const world = impl();
      let cleanup = await world.attempt({
        plan: planFor(1),
        failAt: null,
        reportApplied: ['body'],
        failRelease: true,
      });

      assert.equal(cleanup.status, UPDATE_STATUSES.applied, 'the update itself did land');
      assert.equal(typeof cleanup.releaseFailure, 'string', 'the cleanup problem is reported, not hidden');
    });
  });
}

// The suite runs against the library's own contract surface using the public
// entry point, so a host implements `attempt` against the same statuses.
runUpdateConformance('library contract via applyCompositionUpdate', () => {
  let active = 'old';
  let generation = 1;
  let prepareCalls = 0;
  let held = 0;

  return {
    active: () => active,
    activeState: () => (active === 'new' ? { restored: true } : undefined),
    outstandingCandidateResources: () => held,
    prepareCalls: () => prepareCalls,
    advanceGenerationTo: (value) => { generation = value; },
    async attempt({ plan, failAt, reportApplied, failRelease }) {
      let result = await applyCompositionUpdate({
        plan,
        previous: definition(),
        next: definition({
          restoration: {
            version: 1,
            restore: async (saved) => {
              if (failAt === 'restore') throw new Error('restoration incompatible');
              return { ...saved, restored: true };
            },
          },
        }),
        currentGeneration: generation,
        prepare: async ({ registerRelease }) => {
          prepareCalls += 1;
          // Acquire first, then fail, so the cleanup path is genuinely exercised.
          // Registration happens at acquisition time, before the failure, which
          // is the only way cleanup can reach resources held by a prepare that
          // never returned.
          held += 1;
          registerRelease(async () => { held -= 1; });
          if (failAt === 'prepare') throw new Error('preparation refused');
          return { session: {} };
        },
        switchMount: async () => {
          if (failAt === 'switch') throw new Error('switch refused');
          // A switch that succeeds is followed by release; if the switch throws
          // the candidate must already have been handed back by the contract.
          if (reportApplied) return { applied: reportApplied };
          return { applied: ['body'] };
        },
        release: async () => {
          if (failRelease) throw new Error('teardown incomplete');
          active = 'new';
        },
      });
      return result;
    },
  };
});
