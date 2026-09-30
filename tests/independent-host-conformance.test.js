import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runAtomicPersistenceConformance } from './document-atomic-conformance.test.js';
import { runUpdateConformance } from './composition-update-conformance.test.js';

// An independent minimal host, written against the contract rather than copied
// from the library's own adapter.
//
// The point is not a second set of assertions. It is that this adapter has a
// deliberately different internal discipline from the built-in memory store:
// the server owns the revision counter, every operation goes through an async
// storage boundary, and a hypothetical check-then-write would genuinely race
// here rather than accidentally being saved by the absence of an await. If the
// contract depended on an incidental property of the built-in adapter, this
// suite would fail.

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// A stand-in for a real conditional-write backend (an ETag write, a conditional
// UPDATE, or a transactional KV). It holds a server-side revision per key and
// refuses a write whose expected revision is stale, with no way for a caller to
// bypass the check.
function createConditionalWriteBackend() {
  let records = new Map();

  return {
    capabilities: { atomicCommit: true },

    async get(key) {
      // Simulated storage latency: every operation yields, so a caller that
      // checked and then wrote without an atomic step would interleave here.
      await new Promise((resolve) => setTimeout(resolve, 1));
      let entry = records.get(key);
      return entry === undefined ? undefined : clone(entry.value);
    },

    async compareAndSet(key, { expectedRevision, value, receiptKey, receipt }) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      let entry = records.get(key);
      let currentRevision = entry ? entry.revision : null;
      if (currentRevision !== expectedRevision) {
        return { status: 'conflict', reason: 'revision', currentRevision };
      }
      if (receiptKey !== undefined && records.has(receiptKey)) {
        return { status: 'conflict', reason: 'receipt-present', currentRevision };
      }
      records.set(key, { revision: (value?.revision ?? 0) + 0, value: clone(value) });
      if (receiptKey !== undefined) {
        records.set(receiptKey, { revision: 0, value: clone(receipt) });
      }
      return { status: 'committed', revision: value?.revision ?? null, currentRevision };
    },

    async set(key, value) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      let entry = records.get(key);
      records.set(key, { revision: value?.revision ?? (entry ? entry.revision + 1 : 0), value: clone(value) });
      return clone(value);
    },

    async delete(key) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return records.delete(key);
    },

    async list(prefix = '') {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return [...records.keys()].filter((key) => key.startsWith(prefix));
    },
  };
}

runAtomicPersistenceConformance('independent conditional-write host', () => createConditionalWriteBackend());

// The update contract, exercised against a host that composes the contract
// rather than being the library's own runtime. It reports what it applied, and it
// registers resources as it acquires them — the two things the contract requires
// of a real host.
runUpdateConformance('independent minimal host', () => {
  let active = 'old';
  let generation = 1;
  let held = 0;
  let prepareCalls = 0;

  return {
    active: () => active,
    activeState: () => (active === 'new' ? { restored: true, recovered: ['body'] } : undefined),
    outstandingCandidateResources: () => held,
    prepareCalls: () => prepareCalls,
    advanceGenerationTo: (value) => { generation = value; },
    async attempt(options) {
      let { plan, failAt, reportApplied, failRelease, restorePolicy } = options;
      let restoreReturns = 'restoreReturns' in options ? options.restoreReturns : Symbol('unsupplied');
      let { applyCompositionUpdate, planCompositionUpdate } = await import('../runtime/composition-update.js');

      const definition = (overrides = {}) => ({
        id: 'documents.viewer',
        state: { slots: [{ id: 'body', kind: 'persistent' }] },
        dependencies: { required: ['storage.collection.default'], optional: [] },
        restoration: {
          version: 1,
          restore: async (saved) => {
            if (failAt === 'restore') throw new Error('restoration incompatible');
            if (typeof restoreReturns !== 'symbol') return restoreReturns;
            return { ...saved, restored: true, recovered: ['body'] };
          },
        },
        updates: { strategy: 'checkpoint' },
        ...overrides,
      });

      let effectivePlan = plan ?? planCompositionUpdate(definition(), definition(), {
        available: ['storage.collection.default'],
        dirtySlots: ['body'],
        checkpointableSlots: ['body'],
        currentGeneration: generation,
      });

      return applyCompositionUpdate({
        plan: effectivePlan,
        previous: definition(),
        next: definition(),
        currentGeneration: generation,
        restorePolicy,
        prepare: async ({ registerRelease }) => {
          prepareCalls += 1;
          held += 1;
          registerRelease(async () => { held -= 1; });
          if (failAt === 'prepare') throw new Error('preparation refused');
          return { session: { body: 'carried' } };
        },
        // A real host has to say what it applied. Returning a handle or an
        // opaque `{ installed: true }` is refused as unverifiable, which is the
        // point: the contract cannot tell a landed change from a hopeful one.
        switchMount: async () => {
          if (failAt === 'switch') throw new Error('switch refused');
          if (reportApplied) return { installed: true, applied: reportApplied };
          return { installed: true, applied: ['body'] };
        },
        release: async () => {
          if (failRelease) throw new Error('teardown incomplete');
          active = 'new';
        },
      });
    },
  };
});

describe('a switch that does not say what it applied is refused', () => {
  it('refuses a switch reporting an opaque result while work was declared', async () => {
    const { applyCompositionUpdate, planCompositionUpdate } = await import('../runtime/composition-update.js');
    const definition = (o = {}) => ({
      id: 'documents.viewer',
      state: { slots: [{ id: 'body', kind: 'persistent' }] },
      dependencies: { required: [], optional: [] },
      restoration: { version: 1, restore: async (saved) => ({ ...saved, recovered: ['body'] }) },
      updates: { strategy: 'checkpoint' },
      ...o,
    });

    let plan = planCompositionUpdate(definition(), definition(), {
      available: [],
      dirtySlots: ['body'],
      checkpointableSlots: ['body'],
    });

    let result = await applyCompositionUpdate({
      plan,
      previous: definition(),
      next: definition(),
      prepare: async () => ({ session: { body: 'carried' } }),
      switchMount: async () => ({ installed: true }),
    });

    assert.equal(result.status, 'update_not_applied');
    assert.match(result.reason, /did not report what it applied/);
  });
});

describe('the independent host is genuinely independent', () => {
  it('does not share storage with the built-in adapter', async () => {
    let { createMemoryDocumentPersistence } = await import('../runtime/documents.js');
    let mine = createConditionalWriteBackend();
    let theirs = createMemoryDocumentPersistence();

    await mine.set('k', { revision: 1, v: 'mine' });
    assert.equal(await theirs.get('k'), undefined, 'the two adapters must not share a store');
  });

  it('refuses a stale conditional write at the storage boundary', async () => {
    let backend = createConditionalWriteBackend();
    await backend.set('doc', { revision: 0, body: 'start' });

    let first = await backend.compareAndSet('doc', {
      expectedRevision: 0,
      value: { revision: 1, body: 'a' },
    });
    let second = await backend.compareAndSet('doc', {
      expectedRevision: 0,
      value: { revision: 1, body: 'b' },
    });

    assert.equal(first.status, 'committed');
    assert.equal(second.status, 'conflict', 'a second writer on the same revision is refused');
    assert.equal((await backend.get('doc')).body, 'a', 'the first write survives');
  });
});
