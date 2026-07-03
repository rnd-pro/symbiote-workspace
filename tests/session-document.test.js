import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_DOCUMENT_KEYS,
  SESSION_DOCUMENT_SCHEMA,
  normalizeSessionDocument,
  validateSessionDocument,
} from '../schema/session-document.js';
import {
  PARK_STAGES,
  TASK_KINDS,
  TASK_STATUSES,
  WORKSPACE_SESSION_CAPABILITIES,
  WORKSPACE_STATE_CAPABILITIES,
} from '../schema/constants.js';

describe('SESSION_DOCUMENT_SCHEMA', () => {
  it('exports the S4 session document keys and constants', () => {
    assert.deepEqual(SESSION_DOCUMENT_KEYS, [
      'openViews',
      'activeView',
      'stacks',
      'geometry',
      'nav',
      'panelChrome',
      'state',
      'tasks',
      'parked',
      'grants',
      'teach',
    ]);
    assert.deepEqual(Object.keys(SESSION_DOCUMENT_SCHEMA.properties), SESSION_DOCUMENT_KEYS);
    assert.equal(SESSION_DOCUMENT_SCHEMA.failureMode, 'lenient-drop');
    assert.equal(SESSION_DOCUMENT_SCHEMA.constants.taskKinds, TASK_KINDS);
    assert.equal(SESSION_DOCUMENT_SCHEMA.constants.taskStatuses, TASK_STATUSES);
    assert.equal(SESSION_DOCUMENT_SCHEMA.constants.parkStages, PARK_STAGES);
    assert.equal(SESSION_DOCUMENT_SCHEMA.capabilities.session, WORKSPACE_SESSION_CAPABILITIES);
    assert.equal(SESSION_DOCUMENT_SCHEMA.capabilities.state, WORKSPACE_STATE_CAPABILITIES);
  });
});

describe('session document lenient-drop normalization', () => {
  it('keeps valid S4 records and returns warnings instead of errors for invalid entries', () => {
    let report = validateSessionDocument({
      openViews: [
        { view: 'records' },
        { view: 'editor', key: 'doc_1', params: { path: 'src/main.js' } },
        { view: 'editor', key: 'bad-key' },
      ],
      activeView: 'editor:doc_1',
      stacks: {
        'view:editor/stack:editors': { active: 'editors-doc_1', order: ['editors-doc_1'] },
        'bad-stack': { active: 'x' },
      },
      geometry: { editor: { split: { ratio: 0.5 }, bad: { ratio: 2 } } },
      nav: { sidebar: { order: ['operations'], hidden: ['debug'], width: 280 } },
      panelChrome: { 'panel:editor:main': { collapsed: false } },
      state: { 'workbench.open-files': [{ key: 'doc_1', path: 'src/main.js' }], 'Bad.Key': 'drop' },
      tasks: [
        {
          taskId: 'task_1',
          kind: 'construction',
          startedAt: 1751400000000,
          status: 'interrupted',
          resume: {
            phasePointer: 'place-panels:4/7',
            answers: { density: 'compact' },
            stagedRefs: ['park_1'],
            catalogFingerprint: 'sha256-abcd',
          },
        },
        { taskId: 'task-bad', kind: 'construction', startedAt: 1, status: 'active' },
      ],
      parked: [
        { parkId: 'park_1', stage: 'pendingApproval', payloadRef: 'sha256-abcd', createdAt: 1751400000000, verdictId: 'verdict-1' },
        { parkId: 'park_2', stage: 'confirmPending', payloadRef: 'sha256-abcd', createdAt: 1751400000000 },
      ],
      grants: [
        { scope: ['dispatch'], kinds: ['confirm'], expiry: 'task', principal: { kind: 'human', id: 'u1' } },
        { scope: ['install'], kinds: ['confirm'], expiry: 'install', principal: { kind: 'human', id: 'u1' } },
      ],
      teach: {
        'hook-onboarding': { status: 'offered', updatedAt: 1751400000000 },
        'hook-onboarding:subject_1': { status: 'completed', updatedAt: 1751400001000 },
        'bad key': { status: 'offered', updatedAt: 1 },
      },
    });

    assert.equal(report.ok, true);
    assert.deepEqual(report.errors, []);
    assert.ok(report.warnings.length >= 1);
    assert.equal(report.document.openViews.length, 2);
    assert.deepEqual(Object.keys(report.document.stacks), ['view:editor/stack:editors']);
    assert.deepEqual(Object.keys(report.document.geometry.editor), ['split']);
    assert.deepEqual(Object.keys(report.document.state), ['workbench.open-files']);
    assert.equal(report.document.tasks.length, 1);
    assert.equal(report.document.parked.length, 1);
    assert.equal(report.document.grants.length, 1);
    assert.deepEqual(Object.keys(report.document.teach), ['hook-onboarding', 'hook-onboarding:subject_1']);
  });

  it('requires runtime-id keys per R12 and can require keys for ephemeral views', () => {
    let report = normalizeSessionDocument({
      openViews: [
        { view: 'editor' },
        { view: 'editor', key: 'doc_1' },
      ],
      activeView: 'editor:bad-key',
    }, { ephemeralViews: ['editor'] });

    assert.equal(report.document.openViews.length, 1);
    assert.equal(report.document.openViews[0].key, 'doc_1');
    assert.equal(report.document.activeView, undefined);
    assert.ok(report.warnings.some((warning) => warning.code === 'session.openViews.ephemeral_key'));
    assert.ok(report.warnings.some((warning) => warning.code === 'session.activeView'));
  });

  it('drops a non-object document to an empty normalized document without errors', () => {
    let report = validateSessionDocument(null);
    assert.equal(report.ok, true);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.document.openViews, []);
    assert.ok(report.warnings.some((warning) => warning.code === 'session.document'));
  });
});
