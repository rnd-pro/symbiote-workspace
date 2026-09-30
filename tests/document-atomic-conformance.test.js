import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDocumentRuntime,
  createMemoryDocumentPersistence,
  supportsAtomicCommit,
} from '../runtime/documents.js';

// Conformance suite for atomic document persistence.
//
// This is deliberately not a test of the built-in memory adapter. It is a suite
// a host runs against its own adapter, so "the library's own adapter passes" is
// never mistaken for "every adapter is safe". It covers the create race and the
// retry-after-lost-response boundary, which are the two places a hand-written
// adapter most plausibly differs from the built-in one.

export function atomicConfig() {
  return {
    version: '1.0.0',
    name: 'documents',
    requires: { hostServices: { required: ['storage.collection.default'] } },
    data: {
      collections: [
        {
          id: 'notes',
          itemSchema: { kind: 'custom', schemaRef: 'note-schema' },
          persistence: 'storage.collection.default',
          history: { depth: 3, coalesceWindowMs: 300 },
        },
      ],
    },
  };
}

export function runAtomicPersistenceConformance(name, makeAdapter) {
  describe(`atomic persistence conformance: ${name}`, () => {
    it('declares the atomic capability rather than leaving it to be inferred', () => {
      let adapter = makeAdapter();
      assert.equal(
        supportsAtomicCommit(adapter),
        true,
        'the adapter must declare capabilities.atomicCommit and implement compareAndSet',
      );
    });

    it('commits exactly one of two concurrent writes and reports the other as a conflict', async () => {
      let runtime = createDocumentRuntime({ config: atomicConfig(), persistence: makeAdapter() });
      await runtime.createDocument('notes', { id: 'race', body: { title: 'A', count: 0 } });

      let results = await Promise.all([
        runtime.commit('doc:notes:race', [{ op: 'set', path: 'body.title', value: 'B' }], { baseRevision: 0 }),
        runtime.commit('doc:notes:race', [{ op: 'set', path: 'body.count', value: 1 }], { baseRevision: 0 }),
      ]);

      let conflicts = results.filter((result) => result?.conflict);
      let committed = results.filter((result) => !result?.conflict && !result?.rejected);
      assert.equal(committed.length, 1, 'exactly one concurrent commit may succeed');
      assert.equal(conflicts.length, 1, 'the other must be reported as a conflict');

      let record = await runtime.readRecord('doc:notes:race');
      assert.equal(record.revision, 1, 'a rejected commit must not advance the revision');
    });

    it('never reports two committed writes as the same revision', async () => {
      let runtime = createDocumentRuntime({ config: atomicConfig(), persistence: makeAdapter() });
      await runtime.createDocument('notes', { id: 'unique', body: { title: 'A', count: 0 } });

      let results = await Promise.all([
        runtime.commit('doc:notes:unique', [{ op: 'set', path: 'body.title', value: 'B' }], { baseRevision: 0 }),
        runtime.commit('doc:notes:unique', [{ op: 'set', path: 'body.count', value: 1 }], { baseRevision: 0 }),
      ]);

      // A conflict legitimately reports the current revision so the caller can
      // rebase; what must never happen is two successful commits claiming one
      // revision, which is how a caller is told its write landed when it did not.
      let committed = results
        .filter((result) => !result?.conflict && !result?.rejected)
        .map((result) => result.revision);

      assert.ok(committed.length > 0, 'at least one commit must succeed');
      assert.equal(
        new Set(committed).size,
        committed.length,
        'two committed writes must never claim the same revision',
      );
    });

    it('replays a retried mutation instead of applying it twice', async () => {
      let runtime = createDocumentRuntime({ config: atomicConfig(), persistence: makeAdapter() });
      await runtime.createDocument('notes', { id: 'retry', body: { title: 'A' } });

      let first = await runtime.commit(
        'doc:notes:retry',
        [{ op: 'set', path: 'body.title', value: 'Z' }],
        { baseRevision: 0, mutationId: 'm-1' },
      );
      let second = await runtime.commit(
        'doc:notes:retry',
        [{ op: 'set', path: 'body.title', value: 'Z' }],
        { baseRevision: 0, mutationId: 'm-1' },
      );

      assert.equal(first.revision, 1);
      assert.equal(second.revision, 1, 'a retry of the same mutation returns the same revision');
      assert.equal(second.replayed, true, 'a retry is marked as a replay, not a fresh commit');

      let record = await runtime.readRecord('doc:notes:retry');
      assert.equal(record.revision, 1, 'the mutation is applied exactly once');
    });

    it('refuses a write when the storage cannot commit atomically', async () => {
      let legacy = {
        get: async () => undefined,
        set: async () => {},
        delete: async () => false,
        list: async () => [],
      };
      assert.equal(supportsAtomicCommit(legacy), false);

      let runtime = createDocumentRuntime({ config: atomicConfig(), persistence: legacy });
      await runtime.createDocument('notes', { id: 'legacy', body: { title: 'A' } });
      let result = await runtime.commit(
        'doc:notes:legacy',
        [{ op: 'set', path: 'body.title', value: 'B' }],
        { baseRevision: 0 },
      );

      assert.equal(result.rejected, true, 'a non-atomic adapter must not be silently accepted');
      assert.equal(result.code, 'atomic_commit_unsupported');
    });
  });
}

runAtomicPersistenceConformance('built-in memory adapter', () => createMemoryDocumentPersistence());
