import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { UndoRouter } from '../runtime/undo-router.js';
import { WorkspaceState } from '../runtime/workspace-state.js';
import { WORKSPACE_SCHEMA_VERSION } from '../schema/value-classes.js';

const USER = { kind: 'human', id: 'u1' };
const OTHER_USER = { kind: 'human', id: 'u2' };
const AGENT = { kind: 'agent', id: 'builder' };

class FakeDocumentStack {
  constructor(entries = []) {
    this.undoStack = [...entries];
    this.redoStack = [];
    this.calls = [];
  }

  peekUndo() {
    if (this.undoStack.length === 0) return { status: 'empty' };
    return { status: 'ready', entry: this.undoStack[this.undoStack.length - 1] };
  }

  peekRedo() {
    if (this.redoStack.length === 0) return { status: 'empty' };
    return { status: 'ready', entry: this.redoStack[this.redoStack.length - 1] };
  }

  undo() {
    this.calls.push('undo');
    let entry = this.undoStack.pop();
    this.redoStack.push(entry);
    return { status: 'ok', stack: 'document', entry };
  }

  redo() {
    this.calls.push('redo');
    let entry = this.redoStack.pop();
    this.undoStack.push(entry);
    return { status: 'ok', stack: 'document', entry };
  }
}

function entry(revision, principal = USER) {
  return {
    revision,
    at: revision,
    actor: { principal, actor: principal.kind },
    ops: [],
    inverseOps: [],
  };
}

describe('UndoRouter focus dispatch', () => {
  it('routes doc focus to the injected document stack and non-doc focus to config', async () => {
    let configStack = new WorkspaceState({ version: WORKSPACE_SCHEMA_VERSION, name: 'Base' });
    configStack.commit([
      { op: 'replace', path: 'name', value: 'Next' },
    ], {
      principal: USER,
      actor: 'user',
      baseRevision: 0,
    });
    let docStack = new FakeDocumentStack([entry(7)]);
    let focus = { docAddress: 'doc:orders:one' };
    let router = new UndoRouter({
      configStack,
      documentStacks: new Map([['doc:orders:one', docStack]]),
      getFocus: () => focus,
    });

    let docResult = await router.undo({ principal: USER });
    assert.equal(docResult.status, 'ok');
    assert.equal(docResult.stack, 'document');
    assert.equal(docResult.docAddress, 'doc:orders:one');
    assert.deepEqual(docStack.calls, ['undo']);
    assert.equal(configStack.config.name, 'Next');

    focus = { kind: 'chat' };
    let configResult = await router.undo({ principal: USER });
    assert.equal(configResult.status, 'ok');
    assert.equal(configResult.stack, 'config');
    assert.equal(configStack.config.name, 'Base');
  });

  it('resolves focus after a microtask before choosing the stack', async () => {
    let configStack = new WorkspaceState({ version: WORKSPACE_SCHEMA_VERSION, name: 'Base' });
    configStack.commit([
      { op: 'replace', path: 'name', value: 'Next' },
    ], {
      principal: USER,
      actor: 'user',
      baseRevision: 0,
    });
    let docStack = new FakeDocumentStack([entry(4)]);
    let focus = { docAddress: 'doc:orders:one' };
    let router = new UndoRouter({
      configStack,
      documentStacks: new Map([['doc:orders:one', docStack]]),
      getFocus: () => focus,
    });

    let pending = router.undo({ principal: USER });
    focus = null;
    let result = await pending;

    assert.equal(result.stack, 'config');
    assert.deepEqual(docStack.calls, []);
    assert.equal(configStack.config.name, 'Base');
  });

  it('blocks implicit session-layout undo', async () => {
    let router = new UndoRouter({
      configStack: new WorkspaceState({ version: WORKSPACE_SCHEMA_VERSION, name: 'Base' }),
      getFocus: () => ({ kind: 'session-layout' }),
    });

    let result = await router.undo({ principal: USER });

    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'session_layout_not_implicit');
  });
});

describe('UndoRouter actor traversal', () => {
  it('stops at a foreign-principal config entry', async () => {
    let configStack = new WorkspaceState({ version: WORKSPACE_SCHEMA_VERSION, name: 'Base' });
    configStack.commit([
      { op: 'replace', path: 'name', value: 'Other edit' },
    ], {
      principal: OTHER_USER,
      actor: 'user',
      baseRevision: 0,
    });
    let router = new UndoRouter({ configStack });

    let result = await router.undo({ principal: USER });

    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'foreign_principal');
    assert.equal(result.attribution.principal.id, 'u2');
    assert.equal(configStack.config.name, 'Other edit');
  });

  it('allows agent entries carrying a consent token minted by the user', async () => {
    let configStack = new WorkspaceState({ version: WORKSPACE_SCHEMA_VERSION, name: 'Base' });
    configStack.commit([
      { op: 'replace', path: 'name', value: 'Agent edit' },
    ], {
      principal: AGENT,
      actor: 'agent',
      baseRevision: 0,
      confirmId: 'confirm-1',
    });
    let router = new UndoRouter({ configStack });

    let result = await router.undo({
      principal: USER,
      consentTokens: [{ confirmId: 'confirm-1', mintedBy: USER }],
    });

    assert.equal(result.status, 'ok');
    assert.equal(configStack.config.name, 'Base');
  });
});

describe('UndoRouter collection focus', () => {
  it('targets the most recent actor-allowed commit across bound documents', async () => {
    let first = new FakeDocumentStack([entry(3)]);
    let second = new FakeDocumentStack([entry(8)]);
    let foreign = new FakeDocumentStack([entry(12, OTHER_USER)]);
    let router = new UndoRouter({
      documentStacks: new Map([
        ['doc:tasks:a', first],
        ['doc:tasks:b', second],
        ['doc:tasks:c', foreign],
      ]),
      getFocus: () => ({
        docAddress: 'doc:tasks:*',
        docAddresses: ['doc:tasks:a', 'doc:tasks:b', 'doc:tasks:c'],
      }),
    });

    let result = await router.undo({ principal: USER });

    assert.equal(result.status, 'ok');
    assert.equal(result.docAddress, 'doc:tasks:b');
    assert.deepEqual(first.calls, []);
    assert.deepEqual(second.calls, ['undo']);
    assert.deepEqual(foreign.calls, []);
  });
});

describe('UndoRouter restoreOverlay hook', () => {
  it('restores overlay entries on undo and clears the same entries on redo', async () => {
    let overlay = { viewMain: { nodeA: { x: 10, y: 20 } } };
    let calls = [];
    let configStack = new WorkspaceState({
      version: WORKSPACE_SCHEMA_VERSION,
      layout: { nodeA: { x: 0, y: 0 } },
    });
    configStack.commit([
      { op: 'replace', path: 'layout.nodeA.x', value: 10 },
    ], {
      principal: USER,
      actor: 'user',
      baseRevision: 0,
      restoreOverlay: overlay,
    });
    let router = new UndoRouter({
      configStack,
      restoreOverlay: (restored, context) => calls.push(['restore', restored, context.direction]),
      clearOverlay: (cleared, context) => calls.push(['clear', cleared, context.direction]),
    });

    let undo = await router.undo({ principal: USER });
    let redo = await router.redo({ principal: USER });

    assert.equal(undo.status, 'ok');
    assert.equal(redo.status, 'ok');
    assert.deepEqual(calls, [
      ['restore', overlay, 'undo'],
      ['clear', overlay, 'redo'],
    ]);
  });
});
