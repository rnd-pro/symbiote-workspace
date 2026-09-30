import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createDocumentRuntime, createMemoryDocumentPersistence } from '../runtime/documents.js';

// Reproduces the lost-update defect found in `DocumentRuntime.commit`: the
// revision is read, compared, and then written through a separate
// `adapter.set`, so two commits issued against the same revision can both
// pass the comparison and both assign themselves the next revision. One
// acknowledged write is then silently dropped.
//
// The persistence used here is the built-in memory adapter; the defect is in
// the read-check-write sequence, not in any particular backend.

function baseConfig() {
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

function runtimeFixture() {
  let persistence = createMemoryDocumentPersistence();
  let runtime = createDocumentRuntime({ config: baseConfig(), persistence });
  return { runtime, persistence };
}

describe('concurrent document commits', () => {
  it('rejects the second of two parallel commits that share a base revision', async () => {
    let { runtime } = runtimeFixture();
    await runtime.createDocument('notes', { id: 'note_1', body: { title: 'A', count: 0 } });

    let results = await Promise.all([
      runtime.commit('doc:notes:note_1', [{ op: 'set', path: 'body.title', value: 'B' }], { baseRevision: 0 }),
      runtime.commit('doc:notes:note_1', [{ op: 'set', path: 'body.count', value: 1 }], { baseRevision: 0 }),
    ]);

    let committed = results.filter((result) => !result?.conflict);
    let conflicted = results.filter((result) => result?.conflict);

    assert.equal(
      conflicted.length,
      1,
      'exactly one of two parallel commits on the same revision must be rejected as a conflict',
    );
    assert.equal(committed.length, 1);

    let record = await runtime.readRecord('doc:notes:note_1');
    assert.equal(
      record.revision,
      1,
      'a rejected commit must not advance the revision sequence',
    );
  });

  it('preserves both acknowledged writes instead of losing one', async () => {
    let { runtime } = runtimeFixture();
    await runtime.createDocument('notes', { id: 'note_2', body: { title: 'A', count: 0 } });

    await Promise.all([
      runtime.commit('doc:notes:note_2', [{ op: 'set', path: 'body.title', value: 'B' }], { baseRevision: 0 }),
      runtime.commit('doc:notes:note_2', [{ op: 'set', path: 'body.count', value: 1 }], { baseRevision: 0 }),
    ]);

    let record = await runtime.readRecord('doc:notes:note_2');
    let acknowledged = record.body.title === 'B';
    let alsoAcknowledged = record.body.count === 1;

    assert.ok(
      !(acknowledged && alsoAcknowledged) || record.revision === 2,
      'if both writes were reported successful, the revision must reflect both, not just the last writer',
    );
  });
});
