import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDocumentRuntime,
  createMemoryDocumentPersistence,
  documentWriteCapability,
} from '../runtime/documents.js';
import { DATA_CHANGE_MESSAGE_TYPE } from '../runtime/data-change.js';
import { handlers, tools } from '../runtime/tools/document-tools.js';

function baseConfig(options = {}) {
  return {
    version: '1.0.0',
    name: 'documents',
    requires: {
      hostServices: {
        required: ['storage.collection.default'],
      },
    },
    data: {
      collections: [
        {
          id: 'graphs',
          itemSchema: { kind: 'engine-graph' },
          persistence: 'storage.collection.default',
          readOnly: Boolean(options.graphsReadOnly),
          history: { depth: 3, coalesceWindowMs: 300 },
        },
        {
          id: 'notes',
          itemSchema: { kind: 'custom', schemaRef: 'note-schema' },
          persistence: 'storage.collection.default',
          readOnly: Boolean(options.notesReadOnly),
          history: { depth: 3, coalesceWindowMs: 300 },
        },
      ],
    },
    assets: [
      { id: 'hero', kind: 'image', integrity: 'sha384-abcDEF123+/456==', sizeBytes: 1024, source: { kind: 'registry', ref: 'acme/hero@1.0.0' } },
    ],
  };
}

function runtimeFixture(options = {}) {
  let persistence = options.persistence || createMemoryDocumentPersistence();
  let sent = [];
  let runtime = createDocumentRuntime({
    config: options.config || baseConfig(options),
    persistence,
    broadcast: options.broadcast || ((message) => sent.push(message)),
    gate: options.gate,
    now: options.now,
  });
  return { runtime, persistence, sent };
}

describe('document runtime CAS and envelope commits', () => {
  it('creates validated envelopes and commits body/envelope operations with monotonic revisions', async () => {
    let { runtime } = runtimeFixture();
    let created = await runtime.createDocument('graphs', {
      id: 'graph_1',
      name: 'Main Graph',
      tags: ['release'],
      body: { nodes: [], ui: { positions: {} } },
    });

    assert.equal(created.docAddress, 'doc:graphs:graph_1');
    assert.equal(created.envelope.revision, 0);

    let committed = await runtime.commit('doc:graphs:graph_1', [
      { op: 'set', path: 'envelope.enabled', value: true },
      { op: 'set', path: 'body.ui.positions.node_a', value: [10, 20] },
    ], {
      actor: { principal: { kind: 'human' } },
      baseRevision: 0,
      gestureBoundary: true,
    });

    assert.deepEqual(committed, { revision: 1 });

    let loaded = await runtime.load('doc:graphs:graph_1');
    assert.equal(loaded.envelope.enabled, true);
    assert.equal(loaded.envelope.revision, 1);
    assert.deepEqual(loaded.body.ui.positions.node_a, [10, 20]);

    let snapshot = await runtime.snapshot('doc:graphs:graph_1');
    assert.deepEqual(snapshot, { body: loaded.body, revision: 1 });

    let patches = await runtime.getPatches('doc:graphs:graph_1', 0);
    assert.deepEqual(patches.map((op) => op.path), [
      'envelope.enabled',
      'body.ui.positions.node_a',
    ]);
  });

  it('reports CAS conflicts and returns replay patches for a rebased client', async () => {
    let { runtime } = runtimeFixture();
    await runtime.createDocument('notes', { id: 'note_1', body: { title: 'A' } });
    await runtime.commit('doc:notes:note_1', [
      { op: 'set', path: 'body.title', value: 'B' },
    ], { baseRevision: 0 });

    let conflict = await runtime.commit('doc:notes:note_1', [
      { op: 'set', path: 'body.title', value: 'stale' },
    ], { baseRevision: 0 });
    assert.deepEqual(conflict, { conflict: true, revision: 1 });

    let patches = await runtime.getPatches('doc:notes:note_1', 0);
    assert.deepEqual(patches, [{ op: 'set', path: 'body.title', value: 'B' }]);

    let rebased = await runtime.commit('doc:notes:note_1', [
      { op: 'set', path: 'body.title', value: 'C' },
    ], { baseRevision: 1 });
    assert.deepEqual(rebased, { revision: 2 });
  });
});

describe('document runtime history and broadcasts', () => {
  it('coalesces undo history and broadcasts at the gesture boundary', async () => {
    let now = 1000;
    let { runtime, sent } = runtimeFixture({ now: () => now });
    await runtime.createDocument('notes', { id: 'note_2', body: { text: '' } });

    await runtime.commit('doc:notes:note_2', [
      { op: 'set', path: 'body.text', value: 'a' },
    ], { baseRevision: 0, coalesceKey: 'typing' });
    assert.equal(sent.length, 0);

    now += 20;
    await runtime.commit('doc:notes:note_2', [
      { op: 'set', path: 'body.text', value: 'ab' },
    ], { baseRevision: 1, coalesceKey: 'typing' });
    assert.equal(sent.length, 0);

    now += 20;
    await runtime.commit('doc:notes:note_2', [
      { op: 'set', path: 'body.title', value: 'Draft' },
    ], { baseRevision: 2, coalesceKey: 'typing', gestureBoundary: true });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, DATA_CHANGE_MESSAGE_TYPE);
    assert.equal(sent[0].payload.channel, 'doc:notes:note_2');
    assert.equal(sent[0].payload.revision, 3);
    assert.equal(sent[0].payload.baseRevision, 0);
    assert.deepEqual(new Set(sent[0].payload.changedPaths), new Set(['body.text', 'body.title']));

    let stack = runtime.undoStack('doc:notes:note_2');
    assert.equal(stack.length, 1);
    assert.equal(stack[0].coalesceKey, 'typing');
    assert.equal(stack[0].ops.length, 3);
    assert.equal(stack[0].inverseOps.length, 3);
  });
});

describe('document runtime rejection and sidecars', () => {
  it('rejects unresolved asset refs with a repair envelope and preserves the revision', async () => {
    let { runtime } = runtimeFixture();
    await runtime.createDocument('notes', {
      id: 'note_3',
      body: { image: 'asset:hero' },
    });

    let rejected = await runtime.commit('doc:notes:note_3', [
      { op: 'set', path: 'body.image', value: 'asset:missing' },
    ], { baseRevision: 0 });

    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.reason, 'unresolved-asset-ref');
    assert.equal(rejected.repair.diagnostics[0].code, 'document.asset.unresolved');

    let snapshot = await runtime.snapshot('doc:notes:note_3');
    assert.equal(snapshot.revision, 0);
    assert.equal(snapshot.body.image, 'asset:hero');
  });

  it('keeps engine-graph viewport in the presentation sidecar outside revisions', async () => {
    let { runtime } = runtimeFixture();
    let imported = await runtime.createDocument('graphs', {
      id: 'graph_2',
      body: { ui: { viewport: { zoom: 2 }, positions: {} } },
    });
    assert.equal(imported.status, 'rejected');
    assert.equal(imported.reason, 'document-body-import');

    await runtime.createDocument('graphs', {
      id: 'graph_2',
      body: { ui: { positions: { a: [0, 0] } } },
    });
    await runtime.savePresentation('doc:graphs:graph_2', { zoom: 2, pan: [10, 20] });
    assert.deepEqual(await runtime.loadPresentation('doc:graphs:graph_2'), { zoom: 2, pan: [10, 20] });

    let snapshot = await runtime.snapshot('doc:graphs:graph_2');
    assert.equal(snapshot.revision, 0);
    assert.equal(snapshot.body.ui.viewport, undefined);

    let rejected = await runtime.commit('doc:graphs:graph_2', [
      { op: 'set', path: 'body.ui.viewport', value: { zoom: 3 } },
    ], { baseRevision: 0 });
    assert.equal(rejected.status, 'rejected');
    assert.equal((await runtime.snapshot('doc:graphs:graph_2')).revision, 0);
  });
});

describe('document runtime capability lanes and tools', () => {
  it('blocks all writes for read-only collections', async () => {
    let persistence = createMemoryDocumentPersistence();
    let { runtime: writable } = runtimeFixture({ persistence });
    await writable.createDocument('notes', { id: 'note_4', body: { text: 'seed' } });

    let { runtime: readOnly } = runtimeFixture({
      persistence,
      config: baseConfig({ notesReadOnly: true }),
    });

    let createBlocked = await readOnly.createDocument('notes', { id: 'note_5', body: {} });
    assert.equal(createBlocked.status, 'blocked');
    assert.equal(createBlocked.verdict.reason, 'collection-read-only');

    let commitBlocked = await readOnly.commit('doc:notes:note_4', [
      { op: 'set', path: 'body.text', value: 'blocked' },
    ], { baseRevision: 0, actor: { principal: { kind: 'human' } } });
    assert.equal(commitBlocked.status, 'blocked');
    assert.equal(commitBlocked.verdict.reason, 'collection-read-only');
  });

  it('lets user writes bypass the gate and sends agent writes through it', async () => {
    let gateCalls = [];
    let { runtime } = runtimeFixture({
      gate: async (request) => {
        gateCalls.push(request);
        return { status: 'blocked', reason: 'agent-write-needs-confirm' };
      },
    });
    await runtime.createDocument('notes', { id: 'note_6', body: { text: 'seed' } });

    assert.equal(documentWriteCapability({ principal: { kind: 'human' } }), 'document.write.user');
    assert.equal(documentWriteCapability({ principal: { kind: 'agent' } }), 'document.write.agent');

    let userCommit = await runtime.commit('doc:notes:note_6', [
      { op: 'set', path: 'body.text', value: 'user' },
    ], { baseRevision: 0, actor: { principal: { kind: 'human' } } });
    assert.deepEqual(userCommit, { revision: 1 });
    assert.equal(gateCalls.length, 0);

    let agentCommit = await runtime.commit('doc:notes:note_6', [
      { op: 'set', path: 'body.text', value: 'agent' },
    ], { baseRevision: 1, actor: { principal: { kind: 'agent' } } });
    assert.equal(agentCommit.status, 'blocked');
    assert.equal(gateCalls.length, 1);
    assert.equal(gateCalls[0].capability, 'document.write.agent');
  });

  it('exports the document tool family and handlers', async () => {
    let names = tools.map((tool) => tool.name);
    assert.deepEqual(names, [
      'collection.list',
      'collection.query',
      'collection.create',
      'collection.delete',
      'document.load',
      'document.commit',
      'document.patches',
      'document.delete',
      'document.snapshot',
      'document.presentation.save',
      'document.presentation.load',
    ]);
    assert.equal(tools.find((tool) => tool.name === 'document.commit').mutates, true);
    assert.equal(typeof handlers['document.commit'], 'function');

    let { runtime } = runtimeFixture();
    let session = { documentRuntime: runtime };
    let created = await handlers['collection.create']({
      collectionId: 'notes',
      id: 'note_7',
      body: { text: 'tool' },
    }, session);
    assert.equal(created.docAddress, 'doc:notes:note_7');
    let snapshot = await handlers['document.snapshot']({ docAddress: created.docAddress }, session);
    assert.deepEqual(snapshot, { body: { text: 'tool' }, revision: 0 });
  });
});
