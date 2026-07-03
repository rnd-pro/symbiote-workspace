import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_LAST_WRITER_WINS,
  createMemorySessionPersistence,
  createSessionStore,
  sessionDocumentAddress,
} from '../runtime/session-store.js';
import {
  createSessionToolHandlers,
  tools as sessionToolDefinitions,
} from '../runtime/tools/session-tools.js';
import { WorkspaceState } from '../runtime/workspace-state.js';
import { WORKSPACE_SCHEMA_VERSION } from '../schema/value-classes.js';

const USER = { kind: 'human', id: 'u1' };
const AGENT = { kind: 'agent', id: 'builder' };

function grant(overrides = {}) {
  return {
    scope: ['dispatch'],
    kinds: ['confirm'],
    expiry: 'task',
    principal: USER,
    ...overrides,
  };
}

describe('SessionStore load normalization', () => {
  it('leniently drops invalid and dead entries with warnings', async () => {
    let address = sessionDocumentAddress({ workspaceId: 'ws1', principal: USER });
    let persistence = createMemorySessionPersistence({
      [address]: {
        revision: 7,
        body: {
          openViews: [
            { view: 'main' },
            { view: 'dead' },
            { view: 'ephemeral' },
            { view: 'ephemeral', key: 'Key_1' },
          ],
          activeView: 'dead',
          stacks: {
            'view:main/stack:primary': { active: 'left', order: ['left'] },
            'view:dead/stack:primary': { active: 'x' },
          },
          geometry: {
            main: {
              left: { ratio: 0.4 },
              ghost: { ratio: 0.6 },
            },
            dead: {
              left: { ratio: 0.5 },
            },
          },
          nav: { sidebar: { width: 280 } },
          panelChrome: {},
          state: { 'Bad.Key': true },
          tasks: [{ taskId: 'task-bad', kind: 'construction', startedAt: 1, status: 'active' }],
          parked: [
            { parkId: 'park_1', stage: 'pendingApproval', payloadRef: 'sha256-aa', createdAt: 100, verdictId: 'missing' },
            { parkId: 'park_2', stage: 'confirmPending', payloadRef: 'sha256-aa', createdAt: 100, expiresAt: 150 },
            { parkId: 'park_3', stage: 'pendingApproval', payloadRef: 'sha256-aa', createdAt: 100, verdictId: 'live' },
          ],
          grants: [{ ...grant(), expiry: 'install' }],
          teach: { 'bad key': { status: 'offered', updatedAt: 1 } },
        },
      },
    });
    let store = createSessionStore({
      workspaceId: 'ws1',
      principal: USER,
      persistence,
      now: () => 200,
      ephemeralViews: ['ephemeral'],
      knownViews: ['main', 'ephemeral'],
      knownNodesByView: { main: ['left'] },
      knownVerdictIds: ['live'],
    });

    let result = await store.load();
    let projection = store.project();

    assert.equal(result.status, 'ok');
    assert.equal(result.revision, 7);
    assert.equal(projection.openViews.length, 2);
    assert.deepEqual(projection.openViews.map((entry) => entry.view), ['main', 'ephemeral']);
    assert.equal(projection.activeView, undefined);
    assert.deepEqual(projection.geometry, { main: { left: { ratio: 0.4 } } });
    assert.deepEqual(projection.parked.map((item) => item.parkId), ['park_3']);
    assert.equal(projection.grants, undefined);
    assert.ok(result.warnings.some((item) => item.code === 'session.dead_view'));
    assert.ok(result.warnings.some((item) => item.code === 'session.dead_node'));
    assert.ok(result.warnings.some((item) => item.code === 'session.parked.dangling_verdict'));
    assert.ok(result.warnings.some((item) => item.code === 'session.parked.expired'));
    assert.ok(result.warnings.some((item) => item.code === 'session.grants'));
  });
});

describe('SessionStore task, parked, grant, and teach stores', () => {
  it('lists resumable tasks and runs task GC after an expiring resume offer', async () => {
    let persistence = createMemorySessionPersistence();
    let store = createSessionStore({
      workspaceId: 'tasks',
      principal: USER,
      persistence,
      now: () => 1_000,
      taskAbandonMs: 100,
    });

    await store.load();
    await store.commit([
      {
        op: 'replace',
        path: '/tasks',
        value: [
          {
            taskId: 'task_1',
            kind: 'construction',
            startedAt: 800,
            status: 'interrupted',
            resume: {
              phasePointer: 'phase:1',
              answers: { density: 'compact' },
              stagedRefs: ['ref_1'],
              catalogFingerprint: 'sha256-abcd',
            },
          },
          { taskId: 'task_2', kind: 'construction', startedAt: 900, status: 'completed' },
          { taskId: 'task_3', kind: 'construction', startedAt: 900, status: 'completed' },
        ],
      },
      { op: 'replace', path: '/grants', value: [grant({ taskId: 'task_2' })] },
    ], { baseRevision: 0 });

    assert.deepEqual(store.resumeTasks().map((task) => task.taskId), ['task_1']);

    let first = await store.gc({ now: 1_000 });
    assert.ok(first.notices.some((notice) => notice.kind === 'resume-expiring' && notice.taskId === 'task_1'));
    assert.deepEqual(store.project().tasks.map((task) => task.taskId), ['task_1', 'task_2']);

    let second = await store.gc({ now: 1_001 });
    assert.ok(second.notices.some((notice) => notice.kind === 'task-abandoned' && notice.taskId === 'task_1'));
    assert.equal(store.project().tasks.find((task) => task.taskId === 'task_1').status, 'abandoned');

    let third = await store.gc({ now: 1_002 });
    assert.ok(third.notices.some((notice) => notice.kind === 'task-dropped' && notice.taskId === 'task_1'));
    assert.deepEqual(store.project().tasks.map((task) => task.taskId), ['task_2']);
  });

  it('marks stale pendingApproval parked work and withdraws through the gate intent', async () => {
    let submitted = [];
    let store = createSessionStore({
      workspaceId: 'parked',
      principal: USER,
      persistence: createMemorySessionPersistence(),
      parkedPendingApprovalMs: 100,
      now: () => 1_000,
      gate: { submit: (intent) => submitted.push(intent) },
    });

    await store.load();
    await store.commit([
      {
        op: 'replace',
        path: '/parked',
        value: [
          { parkId: 'park_1', stage: 'pendingApproval', payloadRef: 'sha256-aa', createdAt: 800, verdictId: 'verdict_1' },
          { parkId: 'park_2', stage: 'confirmPending', payloadRef: 'sha256-aa', createdAt: 800, expiresAt: 900 },
        ],
      },
    ], { baseRevision: 0 });

    let gc = await store.gc({ now: 1_000 });
    assert.deepEqual(store.project().parked, [
      { parkId: 'park_1', stage: 'pendingApproval', payloadRef: 'sha256-aa', createdAt: 800, verdictId: 'verdict_1', stale: true },
    ]);
    assert.ok(gc.notices.some((notice) => notice.affordance?.intent === 'intent-withdraw'));

    let withdrawn = await store.withdrawParked('park_1');
    assert.equal(withdrawn.intent, 'intent-withdraw');
    assert.deepEqual(store.project().parked, []);
    assert.equal(submitted[0].intent, 'intent-withdraw');
  });

  it('stores task/session grants across transport rekeys and keeps teach completion-keyed state', async () => {
    let persistence = createMemorySessionPersistence();
    let first = createSessionStore({ workspaceId: 'same-workspace', principal: USER, persistence });
    await first.load();
    await first.addGrant(grant({ taskId: 'task_1' }), { baseRevision: 0 });
    await first.recordTeach('hook-onboarding', 'offered', { subjectKey: 'record:1', updatedAt: 10 });
    assert.equal(first.shouldOfferTeach('hook-onboarding', 'record:1'), true);
    await first.recordTeach('hook-onboarding', 'completed', { subjectKey: 'record:1', updatedAt: 11 });
    assert.equal(first.shouldOfferTeach('hook-onboarding', 'record:1'), false);

    let rekeyed = createSessionStore({ workspaceId: 'same-workspace', principal: USER, persistence });
    await rekeyed.load();

    assert.equal(rekeyed.grants().length, 1);
    assert.equal(rekeyed.grants()[0].taskId, 'task_1');
    assert.equal(rekeyed.shouldOfferTeach('hook-onboarding', 'record:1'), false);
    await assert.rejects(
      () => rekeyed.addGrant(grant({ expiry: 'install' })),
      /Install grants/,
    );
  });
});

describe('SessionStore geometry overlay and snapshots', () => {
  it('lets session geometry win on reload and promotes with undo/redo restore symmetry', async () => {
    let persistence = createMemorySessionPersistence();
    let store = createSessionStore({ workspaceId: 'layout', principal: USER, persistence });
    await store.load();
    await store.setGeometryOverlay('main', 'left', { ratio: 0.35 }, { baseRevision: 0 });

    let reloaded = createSessionStore({ workspaceId: 'layout', principal: USER, persistence });
    await reloaded.load();
    assert.deepEqual(reloaded.geometryDelta('main', 'left', { ratio: 0.5 }), { ratio: 0.35 });
    assert.deepEqual(reloaded.shadowedGeometryPaths({ main: { left: { ratio: 0.9 } } }), ['geometry.main.left']);

    let configStack = new WorkspaceState({
      version: WORKSPACE_SCHEMA_VERSION,
      layout: { left: { ratio: 0.5 } },
    });
    let promoted = await reloaded.promoteGeometry({
      configStack,
      ops: [{ op: 'replace', path: 'layout.left.ratio', value: 0.35 }],
      baseRevision: 0,
      actor: { principal: USER, actor: 'user' },
    });

    assert.equal(promoted.status, 'ok');
    assert.deepEqual(promoted.restoreOverlay, { main: { left: { ratio: 0.35 } } });
    assert.deepEqual(reloaded.project().geometry, {});
    assert.deepEqual(configStack.getUndoStack()[0].restoreOverlay, promoted.restoreOverlay);

    let undo = configStack.undo({
      principal: USER,
      actor: 'undo',
      restoreOverlayExecutor: reloaded.restoreOverlayExecutor(),
    });
    let restoreResult = await undo.restoreOverlayResult;
    assert.deepEqual(restoreResult.restored, promoted.restoreOverlay);
    assert.deepEqual(reloaded.project().geometry, { main: { left: { ratio: 0.35 } } });

    let redo = configStack.redo({
      principal: USER,
      actor: 'redo',
      restoreOverlayExecutor: reloaded.restoreOverlayExecutor(),
    });
    let clearResult = await redo.clearOverlayResult;
    assert.deepEqual(clearResult.cleared, promoted.restoreOverlay);
    assert.deepEqual(reloaded.project().geometry, {});
  });

  it('skips redragged overlay entries on restore and degrades unknown snapshots with notices', async () => {
    let store = createSessionStore({ workspaceId: 'snapshots', principal: USER, persistence: createMemorySessionPersistence() });
    await store.load();
    await store.setGeometryOverlay('main', 'left', { ratio: 0.4 }, { baseRevision: 0 });

    let skipped = await store.restoreOverlay({ main: { left: { ratio: 0.3 }, right: { collapsed: true } } });
    assert.deepEqual(skipped.skipped, [{ viewId: 'main', nodeId: 'left', reason: 'redragged' }]);
    assert.deepEqual(store.project().geometry.main.right, { collapsed: true });

    let saved = await store.saveSnapshot('Snap_1');
    assert.equal(saved.status, 'ok');
    assert.deepEqual(await store.listSnapshots(), { status: 'ok', snapshots: ['Snap_1'] });
    let loaded = await store.loadSnapshot('Snap_1');
    assert.equal(loaded.status, 'ok');
    assert.deepEqual(loaded.snapshot.geometry.main.left, { ratio: 0.4 });
    assert.equal((await store.loadSnapshot('bad-id')).code, 'session.snapshot.foreign_id');
    assert.equal((await store.loadSnapshot('Missing_1')).code, 'session.snapshot.unknown');
  });
});

describe('SessionStore state projections and tools', () => {
  it('keeps state:session projections read-only except document presentation redirects', async () => {
    let store = createSessionStore({ workspaceId: 'projection', principal: USER, persistence: createMemorySessionPersistence() });
    await store.load();
    await store.checkpointTask('task_1', { phasePointer: 'phase:1' }, { baseRevision: 0 });

    assert.equal(store.readStateProjection('state:session.tasks.0.taskId'), 'task_1');
    await assert.rejects(
      () => store.writeStateProjection('state:session.tasks', []),
      /read-only/,
    );

    let redirect = await store.writeStateProjection('state:session.docPresentation.notes.Note_1.zoom', 1.5);
    assert.equal(redirect.target, 'document.presentation.save');
    assert.equal(redirect.collectionId, 'notes');
    assert.equal(redirect.docId, 'Note_1');
    assert.equal(redirect.path, 'zoom');
  });

  it('exports session tool handlers without requiring dispatch integration', async () => {
    let toolNames = sessionToolDefinitions.map((tool) => tool.name);
    assert.ok(toolNames.includes('layout_promote_geometry'));
    assert.ok(toolNames.includes('session.layout.undo'));
    assert.ok(toolNames.includes('workspace.session.snapshot.save'));

    let persistence = createMemorySessionPersistence();
    let session = {
      workspaceId: 'tools',
      principal: AGENT,
      sessionPersistence: persistence,
    };
    let handlers = createSessionToolHandlers();

    let loaded = await handlers['workspace.session.load']({}, { session });
    assert.equal(loaded.status, 'ok');
    let committed = await handlers['workspace.session.commit']({
      baseRevision: 0,
      ops: [{ op: 'replace', path: '/openViews', value: [{ view: 'main' }] }],
    }, { session });
    assert.equal(committed.status, 'ok');
    let stale = await handlers['workspace.session.commit']({
      baseRevision: 0,
      ops: [{ op: 'replace', path: '/activeView', value: 'main' }],
    }, { session });
    assert.deepEqual(stale.trace, [SESSION_LAST_WRITER_WINS]);

    assert.equal((await handlers['workspace.session.snapshot.save']({ snapshotId: 'Snap_1' }, { session })).status, 'ok');
    assert.deepEqual((await handlers['workspace.session.snapshot.list']({}, { session })).snapshots, ['Snap_1']);
  });
});
