import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESENTATION_PLANNER_INPUT_SCHEMA_VERSION,
  createPresentationPlannerInput,
} from '../runtime/presentation-planner.js';

function fixture(overrides = {}) {
  let snapshot = {
    identityHash: 'presentation-context-snapshot-v2:target',
    generation: 2,
    output: {
      schemaVersion: 'workspace-presentation-output-v1',
      format: 'horizontal',
      width: 1920,
      height: 1080,
      fps: 30,
      dpr: 1,
      contentRect: { x: 96, y: 54, width: 1728, height: 778 },
      captions: { enabled: true, rect: { x: 96, y: 832, width: 1728, height: 194 } },
      voice: { mode: 'dialogue', sequenceMode: 'sequential' },
      locale: 'ru-RU',
      duration: { targetMs: 60000, minMs: 48000, maxMs: 72000 },
    },
    targets: [{
      address: 'panel:orders',
      title: 'Orders',
      visible: true,
      safeActionNames: ['focus'],
      webmcpToolNames: ['orders.reveal'],
      composition: { visible: true, reachable: true, focusRect: { x: 100, y: 100, width: 800, height: 500 } },
    }],
    dataSources: [{ id: 'orders', path: '/private/source', contentHash: 'sha256-orders', summary: 'omitted' }],
    ...overrides.snapshot,
  };
  let request = {
    targetSnapshotHash: snapshot.identityHash,
    lessonContextHash: 'workspace-lesson-context-v2:lesson',
    outputSpecHash: 'workspace-presentation-output-v1:horizontal',
    generation: snapshot.generation,
    prompt: 'Explain the current orders.',
    profile: 'dialogue',
    personaSpec: { guide: {}, ops: {} },
    turnBudget: { minTurns: 4, maxTurns: 8 },
    actionBudget: { remainingRounds: 1, remainingActions: 3 },
    allowedActions: [
      { source: 'webmcp', tool: 'orders.reveal', target: 'panel:orders' },
      { target: 'panel:orders', source: 'webmcp', tool: 'orders.reveal' },
    ],
    grounding: { sources: snapshot.dataSources },
    lessonContext: {
      lesson: {
        type: 'operational-task',
        title: 'Orders',
        objective: 'Explain status handling.',
        locale: 'ru-RU',
        requiredFactIds: ['status'],
        requiredTargetIds: ['panel:orders'],
      },
      sourceSnapshot: { source: { url: 'https://private.example.test' }, targets: [{ metadata: 'omitted' }] },
      targetSnapshot: { source: { absolutePath: '/Users/private/project' }, targets: [{ metadata: 'omitted' }] },
      targets: [
        { id: 'panel:orders', title: 'Orders', toolRefs: ['tool:orders.reveal'] },
        { id: 'panel:irrelevant', title: 'Irrelevant', toolRefs: ['tool:irrelevant'] },
      ],
      toolDescriptors: [
        { id: 'tool:orders.reveal', name: 'orders.reveal', description: 'Reveal orders.', inputSchema: { type: 'object' } },
        { id: 'tool:irrelevant', name: 'irrelevant.read', description: 'Irrelevant tool.', inputSchema: { type: 'object' } },
      ],
      facts: [{ id: 'status', kind: 'enum', label: 'Status', value: 'WAPPR', evidenceRefs: ['e-status'], targetRefs: ['panel:orders'] }],
      evidence: [{ id: 'e-status', source: 'context', value: 'WAPPR', contentHash: 'sha256-status', path: '/private/path', targetRefs: ['panel:orders'] }],
      relations: [{ id: 'rel-1', kind: 'affects', from: 'status', to: 'panel:orders', evidenceRefs: ['e-status'] }],
      priorActions: [{ sessionId: 'private-session', result: 'omitted' }],
      deepening: { remainingRounds: 0, remainingActions: 0, requestedGaps: [], actions: [{ tool: 'orders.reveal', evidenceRefs: ['e-status'] }] },
    },
    ...overrides.request,
  };
  return { request, snapshot };
}

describe('presentation planner input projection', () => {
  it('is canonical, deduplicated, grounded, and omits embedded snapshots and private runtime records', () => {
    let { request, snapshot } = fixture();
    let first = createPresentationPlannerInput(request, snapshot);
    let second = createPresentationPlannerInput(structuredClone(request), structuredClone(snapshot));

    assert.equal(first.projection.schemaVersion, PRESENTATION_PLANNER_INPUT_SCHEMA_VERSION);
    assert.equal(first.hash, second.hash);
    assert.equal(first.json, second.json);
    assert.equal(first.projection.allowedActions.length, 1);
    assert.equal(first.projection.targets.length, 1);
    assert.equal(first.projection.tools.length, 1);
    assert.equal(first.projection.tools[0].name, 'orders.reveal');
    assert.equal(first.projection.facts[0].value, 'WAPPR');
    assert.equal(first.projection.deepening.actions[0].tool, 'orders.reveal');
    assert.equal(first.projection.evidence[0].contentHash, 'sha256-status');
    assert.doesNotMatch(first.json, /"(?:sourceSnapshot|targetSnapshot|priorActions)"|private\.example|\/Users\//);
    assert.doesNotMatch(first.json, /"path"/);
  });

  it('preserves repair feedback and only includes prior timeline identity for repair', () => {
    let { request, snapshot } = fixture({ request: {
      reviewFeedback: { attempt: 1, issues: [{ code: 'target-clipped', targetId: 'panel:orders' }] },
      priorTimelineHash: 'presentation-timeline-v2:prior',
    } });
    let input = createPresentationPlannerInput(request, snapshot);
    assert.equal(input.projection.request.reviewFeedback.issues[0].code, 'target-clipped');
    assert.equal(input.projection.request.priorTimelineHash, 'presentation-timeline-v2:prior');
  });

  it('changes identity when responsive target composition changes', () => {
    let horizontal = fixture();
    let vertical = fixture({ snapshot: {
      identityHash: 'presentation-context-snapshot-v2:vertical',
      targets: [{
        address: 'panel:orders',
        title: 'Orders',
        visible: false,
        hiddenReasons: ['mobile-dock'],
        composition: { visible: false, reachable: true, revealable: true, focusRect: { x: 54, y: 180, width: 972, height: 640 } },
      }],
    }, request: { outputSpecHash: 'workspace-presentation-output-v1:vertical' } });
    let left = createPresentationPlannerInput(horizontal.request, horizontal.snapshot);
    let right = createPresentationPlannerInput(vertical.request, vertical.snapshot);
    assert.notEqual(left.hash, right.hash);
    assert.notEqual(left.projection.targets[0].visible, right.projection.targets[0].visible);
  });

  it('rejects missing or stale target snapshot basis', () => {
    let { request, snapshot } = fixture();
    assert.throws(
      () => createPresentationPlannerInput({ ...request, targetSnapshotHash: '' }, snapshot),
      /requires a target snapshot basis/,
    );
    assert.throws(
      () => createPresentationPlannerInput({ ...request, targetSnapshotHash: 'presentation-context-snapshot-v2:stale' }, snapshot),
      /snapshot basis is stale/,
    );
  });

  it('rejects private selected values and oversized prompts before provider submission', () => {
    let privateFixture = fixture({ request: { prompt: 'Use https://private.example.test/data' } });
    assert.throws(
      () => createPresentationPlannerInput(privateFixture.request, privateFixture.snapshot),
      (error) => error.code === 'PLANNER_INPUT_PRIVATE',
    );

    let largeFixture = fixture({ request: { prompt: 'x'.repeat(2048) } });
    assert.throws(
      () => createPresentationPlannerInput(largeFixture.request, largeFixture.snapshot, { maxBytes: 512 }),
      (error) => error.code === 'PLANNER_PROMPT_OVERSIZED' && error.diagnosticCode === 'planner-prompt-oversized',
    );
  });
});
