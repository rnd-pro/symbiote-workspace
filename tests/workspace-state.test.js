import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  REBASED_OVER_CONCURRENT_EDIT,
  WorkspaceState,
  createConfigFingerprint,
} from '../runtime/workspace-state.js';
import { WORKSPACE_SCHEMA_VERSION } from '../schema/value-classes.js';

const USER = { kind: 'human', id: 'u1' };
const OTHER_USER = { kind: 'human', id: 'u2' };
const AGENT = { kind: 'agent', id: 'builder' };

describe('WorkspaceState commits', () => {
  it('requires baseRevision on every config commit', () => {
    let state = new WorkspaceState({ version: WORKSPACE_SCHEMA_VERSION, name: 'Base' });

    assert.throws(() => state.commit([
      { op: 'replace', path: 'name', value: 'Next' },
    ], { principal: USER, actor: 'user' }), /baseRevision/);
  });

  it('records monotonic revisions, changed paths, inverse ops, snapshots, and fingerprints', () => {
    let state = new WorkspaceState({
      version: WORKSPACE_SCHEMA_VERSION,
      name: 'Base',
      views: [],
      modules: [{ id: 'mod.b' }, { id: 'mod.a' }],
    });
    let beforeFingerprint = state.fingerprint();

    let result = state.commit([
      { op: 'replace', path: 'name', value: 'Next' },
      { op: 'add', path: '/views/-', value: { id: 'main', root: 'root' } },
    ], {
      principal: USER,
      actor: 'user',
      baseRevision: 0,
      reason: 'rename',
    });

    assert.equal(result.status, 'ok');
    assert.equal(result.revision, 1);
    assert.deepEqual(result.changedPaths, ['name', 'views[0]']);
    assert.equal(state.revision, 1);
    assert.equal(state.config.name, 'Next');
    assert.equal(state.config.views[0].id, 'main');
    assert.deepEqual(result.entry.inverseOps, [
      { op: 'remove', path: '/views/0' },
      { op: 'replace', path: '/name', value: 'Base' },
    ]);

    let snapshot = state.snapshot();
    assert.equal(snapshot.revision, 1);
    assert.equal(snapshot.config.name, 'Next');
    assert.equal(snapshot.body.views[0].root, 'root');
    assert.notEqual(snapshot.fingerprint, beforeFingerprint);
    assert.equal(
      createConfigFingerprint({ modules: [{ id: 'mod.b' }, { id: 'mod.a' }] }),
      createConfigFingerprint({ modules: [{ id: 'mod.a' }, { id: 'mod.b' }] }),
    );
  });

  it('auto-rebases non-overlapping stale commits and rejects overlapping stale commits', () => {
    let state = new WorkspaceState({ version: WORKSPACE_SCHEMA_VERSION, name: 'Base', description: 'Tool' });

    state.commit([
      { op: 'replace', path: 'name', value: 'User edit' },
    ], {
      principal: USER,
      actor: 'user',
      baseRevision: 0,
    });

    let rebased = state.commit([
      { op: 'replace', path: 'description', value: 'Case' },
    ], {
      principal: AGENT,
      actor: 'agent',
      baseRevision: 0,
    });

    assert.equal(rebased.status, 'ok');
    assert.equal(rebased.revision, 2);
    assert.deepEqual(rebased.trace, [REBASED_OVER_CONCURRENT_EDIT]);
    assert.equal(state.config.description, 'Case');

    let conflict = state.commit([
      { op: 'replace', path: 'name', value: 'Stale name' },
    ], {
      principal: OTHER_USER,
      actor: 'user',
      baseRevision: 0,
    });

    assert.equal(conflict.status, 'conflict');
    assert.equal(conflict.conflict, true);
    assert.equal(conflict.currentRevision, 2);
    assert.deepEqual(conflict.changedPaths, ['name', 'description']);
    assert.deepEqual(conflict.principals, [USER, AGENT]);
    assert.equal(state.config.name, 'User edit');
  });

  it('returns delta patches that replay committed, undo, and redo changes', () => {
    let state = new WorkspaceState({ version: WORKSPACE_SCHEMA_VERSION, name: 'Base' });

    state.commit([
      { op: 'replace', path: 'name', value: 'Next' },
    ], {
      principal: USER,
      actor: 'user',
      baseRevision: 0,
    });
    assert.deepEqual(state.getPatches(0), [
      { op: 'replace', path: '/name', value: 'Next' },
    ]);

    let undone = state.undo({ principal: USER });
    assert.equal(undone.status, 'ok');
    assert.equal(undone.revision, 2);
    assert.equal(state.config.name, 'Base');
    assert.deepEqual(state.getPatches(1), [
      { op: 'replace', path: '/name', value: 'Base' },
    ]);

    let redone = state.redo({ principal: USER });
    assert.equal(redone.status, 'ok');
    assert.equal(redone.revision, 3);
    assert.equal(state.config.name, 'Next');
    assert.deepEqual(state.getPatches(2), [
      { op: 'replace', path: '/name', value: 'Next' },
    ]);
  });
});
