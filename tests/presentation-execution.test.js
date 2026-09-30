import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as runtimeApi from '../runtime/index.js';
import * as presentationApi from '../runtime/presentation.js';

import {
  PRESENTATION_EFFECT_ADMISSION_VERSION,
  PRESENTATION_EFFECT_RECEIPT_VERSION,
  PRESENTATION_EXECUTION_VERSION,
  createPresentationAlignedSequence,
  createPresentationAuthoringProject,
  createPresentationAuthoringProjectFromTimeline,
  createPresentationExecutionController,
  createPresentationScheduleV2,
  createPresentationTimelineContract,
  createPresentationAuthoringTimelineProjection,
  validatePresentationEffectAdmission,
  validatePresentationEffectReceipt,
} from '../index.js';

function timelineFixture(interactionType = 'scroll') {
  return createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'execution-settlement',
    title: 'Execution settlement',
    locale: 'en-US',
    profile: 'brief',
    personas: {
      guide: { name: 'Guide', role: 'guide', locale: 'en-US' },
    },
    grounding: { sources: [] },
    turns: [{
      id: 'show-result',
      persona: 'guide',
      dialogueAct: 'explain',
      text: 'Open the panel, then mark the result.',
      sourceRefs: [],
      claims: [],
      cues: [
        {
          kind: 'interaction',
          targetId: 'panel:result',
          at: {
            anchor: 'speech',
            quote: 'Open the panel',
            occurrence: 1,
            edge: 'start',
            offsetMs: 0,
          },
          interaction: {
            type: interactionType,
            binding: {
              source: 'webmcp',
              tool: 'panel.reveal',
              input: { id: 'result' },
            },
            reversible: true,
          },
        },
        {
          kind: 'annotation',
          targetId: 'panel:result',
          at: {
            anchor: 'speech',
            quote: 'mark the result',
            occurrence: 1,
            edge: 'start',
            offsetMs: 0,
          },
          until: { anchor: 'turn-end', offsetMs: 0 },
          annotation: { intent: 'emphasize', marker: 'box', placement: 'over' },
        },
      ],
    }],
  });
}

function configuredFixture(interactionType = 'scroll', budgets = {}) {
  let interactionBudgetMs = budgets.interactionBudgetMs ?? 800;
  let attentionBudgetMs = budgets.attentionBudgetMs ?? 500;
  let { project: baseline } = createPresentationAuthoringProjectFromTimeline(
    timelineFixture(interactionType),
  );
  let scroll = baseline.cells.find((cell) => cell.kind === 'cue' && cell.cue.kind === 'interaction');
  let attention = baseline.cells.find((cell) => (
    cell.kind === 'cue' && cell.cue.kind === 'annotation'
  ));
  let cells = baseline.cells.map((cell) => {
    if (cell.id === scroll.id) {
      return {
        ...cell,
        timing: {
          ...cell.timing,
          leadMs: 300,
          gestureDurationMs: interactionBudgetMs,
        },
      };
    }
    if (cell.id === attention.id) {
      return {
        ...cell,
        timing: {
          ...cell.timing,
          leadMs: 800,
          gestureDurationMs: attentionBudgetMs,
        },
        dependsOn: [{ cellId: scroll.id, barrier: 'settled' }],
      };
    }
    return cell;
  });
  let project = createPresentationAuthoringProject({ ...baseline, cells });
  let timeline = createPresentationAuthoringTimelineProjection(project);
  let alignedSequence = createPresentationAlignedSequence(timeline, {
    media: { hash: 'sha256-audio', durationMs: 3000, locale: 'en-US' },
    turns: [{
      startMs: 300,
      endMs: 3000,
      transcript: timeline.turns[0].text,
      words: [
        { text: 'Open', startMs: 300, endMs: 420 },
        { text: 'the', startMs: 420, endMs: 500 },
        { text: 'panel', startMs: 500, endMs: 700 },
        { text: 'then', startMs: 1000, endMs: 1150 },
        { text: 'mark', startMs: 1600, endMs: 1780 },
        { text: 'the', startMs: 1780, endMs: 1860 },
        { text: 'result', startMs: 1860, endMs: 2200 },
      ],
    }],
  });
  let schedule = createPresentationScheduleV2(project, alignedSequence);
  return { project, alignedSequence, schedule, scrollId: scroll.id, attentionId: attention.id };
}

function stateConfiguredFixture() {
  let timelineInput = structuredClone(timelineFixture());
  delete timelineInput.hash;
  timelineInput.turns[0].cues.unshift({
    kind: 'state',
    targetId: 'panel:result',
    at: { anchor: 'turn-start', offsetMs: 0 },
    state: { condition: 'paint-stable', timeoutMs: 5000 },
  });
  let { project: baseline } = createPresentationAuthoringProjectFromTimeline(
    createPresentationTimelineContract(timelineInput),
  );
  let state = baseline.cells.find((cell) => cell.cue?.kind === 'state');
  let scroll = baseline.cells.find((cell) => cell.cue?.interaction?.type === 'scroll');
  let attention = baseline.cells.find((cell) => cell.cue?.kind === 'annotation');
  let cells = baseline.cells.map((cell) => {
    if (cell.id === scroll.id) {
      return {
        ...cell,
        timing: { ...cell.timing, leadMs: 300, gestureDurationMs: 800 },
        dependsOn: [{ cellId: state.id, barrier: 'ready' }],
      };
    }
    if (cell.id === attention.id) {
      return {
        ...cell,
        timing: { ...cell.timing, leadMs: 800, gestureDurationMs: 500 },
        dependsOn: [{ cellId: scroll.id, barrier: 'settled' }],
      };
    }
    return cell;
  });
  let project = createPresentationAuthoringProject({ ...baseline, cells });
  let timeline = createPresentationAuthoringTimelineProjection(project);
  let alignedSequence = createPresentationAlignedSequence(timeline, {
    media: { hash: 'sha256-audio-state', durationMs: 3000, locale: 'en-US' },
    turns: [{
      startMs: 300,
      endMs: 3000,
      transcript: timeline.turns[0].text,
      words: [
        { text: 'Open', startMs: 300, endMs: 420 },
        { text: 'the', startMs: 420, endMs: 500 },
        { text: 'panel', startMs: 500, endMs: 700 },
        { text: 'then', startMs: 1000, endMs: 1150 },
        { text: 'mark', startMs: 1600, endMs: 1780 },
        { text: 'the', startMs: 1780, endMs: 1860 },
        { text: 'result', startMs: 1860, endMs: 2200 },
      ],
    }],
  });
  let schedule = createPresentationScheduleV2(project, alignedSequence);
  return {
    project,
    alignedSequence,
    schedule,
    stateId: state.id,
    scrollId: scroll.id,
    attentionId: attention.id,
  };
}

function deferred() {
  let resolve;
  let reject;
  let promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function observation(monotonicTimeMs = performance.now(), timeOriginMs = performance.timeOrigin) {
  return {
    domain: 'performance',
    timeOriginMs,
    monotonicTimeMs,
  };
}

function receipt(input, kind, status, monotonicTimeMs = performance.now(), overrides = {}) {
  return {
    status,
    observedAt: observation(monotonicTimeMs),
    providerReceipt: {
      version: 'fixture-provider-receipt-v2',
      operationHint: input.operationId,
      effectKind: kind,
      milestone: status,
      evidence: {
        targetId: input.scheduleCell.targetId,
      },
    },
    ...overrides,
  };
}

function admission(input, overrides = {}) {
  let limitMs = input.scheduleCell.gesture.endMs - input.scheduleCell.gesture.startMs;
  let base = {
    version: 'show-attention-admission-v2',
    status: 'admitted',
    provider: {
      id: 'symbiote-ui/show-attention',
      version: 'show-attention-provider-v1',
    },
    effect: {
      mode: 'frame',
      gestureId: `gesture:${input.scheduleCell.cellId}`,
    },
    target: {
      id: input.scheduleCell.targetId,
      identity: `target:${input.scheduleCell.targetId}`,
      layoutIdentity: `layout:${input.scheduleCell.targetId}`,
      geometryIdentity: `geometry:${input.scheduleCell.targetId}`,
      geometry: {
        targetRect: { left: 10, top: 20, width: 300, height: 40 },
      },
    },
    budget: {
      limitMs,
      plannedDurationMs: Math.min(100, limitMs),
    },
    plan: {
      version: 'presenter-kinematics-v2',
      identity: `plan:${input.scheduleCell.cellId}`,
      normalizedPathHash: `path:${input.scheduleCell.cellId}`,
      motion: { easing: 'minimum-jerk', durationMs: Math.min(100, limitMs) },
      evidence: { sampledPoints: [0, 0.5, 1] },
    },
    reason: {
      code: 'within-budget',
      message: 'the provider plan fits the explicit hard budget',
      provider: null,
    },
  };
  return {
    providerAdmission: {
      ...base,
      ...overrides,
      provider: { ...base.provider, ...overrides.provider },
      effect: { ...base.effect, ...overrides.effect },
      target: { ...base.target, ...overrides.target },
      budget: { ...base.budget, ...overrides.budget },
      plan: { ...base.plan, ...overrides.plan },
      reason: { ...base.reason, ...overrides.reason },
    },
  };
}

function specialKeyEvidence(label) {
  return JSON.parse(`{
    "__proto__":{"label":"${label}:proto"},
    "constructor":{"prototype":{"label":"${label}:constructor"}},
    "prototype":{"label":"${label}:prototype"}
  }`);
}

function assertPortableEvidenceClone(actual, source) {
  let expectedJson = JSON.stringify(source);
  assert.notEqual(actual, source);
  assert.equal(Object.getPrototypeOf(actual), Object.prototype);
  for (let key of ['__proto__', 'constructor', 'prototype']) {
    assert.equal(Object.hasOwn(actual, key), true, key);
    assert.notEqual(actual[key], source[key], key);
    assert.equal(Object.isFrozen(actual[key]), true, key);
  }
  assert.notEqual(actual.constructor.prototype, source.constructor.prototype);
  assert.equal(Object.isFrozen(actual.constructor.prototype), true);
  assert.equal(JSON.stringify(actual), expectedJson);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(expectedJson));
  assert.equal({}.label, undefined);
}

async function waitForIdleDeadline(controller, waitMs = 500) {
  let timeout;
  try {
    await Promise.race([
      controller.whenIdle(),
      new Promise((resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`presentation operation remained active after ${waitMs}ms`)),
          waitMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function controllerInput(fixture, adapter, onReceipt = () => {}, signal) {
  return {
    project: fixture.project,
    alignedSequence: fixture.alignedSequence,
    schedule: fixture.schedule,
    adapter,
    onReceipt,
    ...(signal ? { signal } : {}),
  };
}

describe('workspace presentation execution v1', () => {
  it('is exposed from the presentation, runtime, and root entrypoints', () => {
    assert.equal(
      PRESENTATION_EFFECT_ADMISSION_VERSION,
      'workspace-presentation-effect-admission-v2',
    );
    assert.equal(
      PRESENTATION_EFFECT_RECEIPT_VERSION,
      'workspace-presentation-effect-receipt-v2',
    );
    for (let api of [presentationApi, runtimeApi]) {
      assert.equal(api.PRESENTATION_EXECUTION_VERSION, PRESENTATION_EXECUTION_VERSION);
      assert.equal(
        api.PRESENTATION_EFFECT_ADMISSION_VERSION,
        PRESENTATION_EFFECT_ADMISSION_VERSION,
      );
      assert.equal(
        api.PRESENTATION_EFFECT_RECEIPT_VERSION,
        PRESENTATION_EFFECT_RECEIPT_VERSION,
      );
      assert.equal(api.createPresentationExecutionController, createPresentationExecutionController);
      assert.equal(api.validatePresentationEffectAdmission, validatePresentationEffectAdmission);
      assert.equal(api.validatePresentationEffectReceipt, validatePresentationEffectReceipt);
    }
  });

  it('binds lossless select admission and first-frame evidence to Workspace identity', async () => {
    let fixture = configuredFixture('select');
    let receipts = [];
    let events = [];
    let sourceAdmission;
    let acceptedAdmission;
    let firstProviderReceipt;
    let controller = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (input) => {
          sourceAdmission = admission(input).providerAdmission;
          acceptedAdmission = input.reportAdmission({ providerAdmission: sourceAdmission });
          events.push('admission');
          let firstObservedAt = observation(
            performance.now() + 500,
            performance.timeOrigin - 500,
          );
          firstProviderReceipt = {
            version: 'show-attention-milestone-v2',
            milestone: 'first-frame',
            observedAt: firstObservedAt,
            admission: sourceAdmission,
            providerReceipt: {
              version: 'presenter-selection-receipt-v2',
              status: 'presenting',
              reason: {
                code: 'rendered',
                detail: { mode: 'native-selection', progressiveFrame: 1 },
              },
            },
          };
          input.reportReceipt({
            status: 'acted',
            observedAt: firstObservedAt,
            providerReceipt: firstProviderReceipt,
          });
          events.push('acted');
          let settledObservedAt = observation(performance.now());
          input.reportReceipt({
            status: 'settled',
            observedAt: settledObservedAt,
            providerReceipt: {
              version: 'show-attention-milestone-v2',
              milestone: 'settled',
              observedAt: settledObservedAt,
              admission: sourceAdmission,
              providerReceipt: {
                version: 'presenter-selection-receipt-v2',
                status: 'settled',
                timing: { elapsedMs: 80 },
              },
            },
          });
          events.push('settled');
          return Promise.resolve();
        },
        runAttention: () => Promise.resolve(),
      },
      (value) => receipts.push(value),
    ));

    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    await controller.whenIdle();

    assert.deepEqual(events, ['admission', 'acted', 'settled']);
    assert.equal(acceptedAdmission.authoringProjectHash, fixture.project.hash);
    assert.equal(acceptedAdmission.scheduleHash, fixture.schedule.hash);
    assert.equal(acceptedAdmission.operationId, receipts[0].operationId);
    assert.deepEqual(acceptedAdmission.providerAdmission, sourceAdmission);
    assert.notEqual(acceptedAdmission.providerAdmission, sourceAdmission);
    assert.notEqual(
      acceptedAdmission.providerAdmission.target.geometry,
      sourceAdmission.target.geometry,
    );
    assert.equal(Object.isFrozen(acceptedAdmission.providerAdmission.target.geometry), true);
    assert.deepEqual(receipts.map((value) => value.status), ['acted', 'settled']);
    assert.equal(receipts[0].authoringProjectHash, fixture.project.hash);
    assert.equal(receipts[0].scheduleHash, fixture.schedule.hash);
    assert.equal(receipts[0].providerReceipt.milestone, 'first-frame');
    assert.deepEqual(receipts[0].providerReceipt, firstProviderReceipt);
    assert.notEqual(receipts[0].providerReceipt, firstProviderReceipt);
    assert.equal(
      Object.isFrozen(receipts[0].providerReceipt.providerReceipt.reason.detail),
      true,
    );
    assert.equal(receipts[0].observedAt.domain, 'performance');
    assert.equal(receipts[0].observedAt.timeOriginMs, performance.timeOrigin);
    assert.equal(
      receipts[0].observedAt.monotonicTimeMs,
      firstProviderReceipt.observedAt.monotonicTimeMs - 500,
    );
    sourceAdmission.target.geometry.targetRect.left = 999;
    firstProviderReceipt.providerReceipt.reason.detail.mode = 'mutated';
    assert.equal(
      acceptedAdmission.providerAdmission.target.geometry.targetRect.left,
      10,
    );
    assert.equal(
      receipts[0].providerReceipt.providerReceipt.reason.detail.mode,
      'native-selection',
    );
  });

  it('records attention admission before normal, reduced, and hostless immediate milestones', async () => {
    for (let mode of ['frame', 'reduced-motion', 'hostless-immediate']) {
      let fixture = configuredFixture();
      let events = [];
      let receipts = [];
      let controller = createPresentationExecutionController(controllerInput(
        fixture,
        {
          runInteraction: (input) => {
            input.reportReceipt(receipt(input, 'interaction', 'acted'));
            input.reportReceipt(receipt(input, 'interaction', 'settled'));
            return Promise.resolve();
          },
          runAttention: (input) => {
            input.reportAdmission(admission(input, { effect: { mode } }));
            events.push('admission');
            let firstFrameAt = performance.now();
            input.reportReceipt(receipt(input, 'attention', 'first-frame', firstFrameAt));
            events.push('first-frame');
            input.reportReceipt(receipt(
              input,
              'attention',
              'settled',
              mode === 'frame' ? performance.now() : firstFrameAt,
            ));
            events.push('settled');
            return Promise.resolve();
          },
        },
        (value) => receipts.push(value),
      ));

      controller.sample({ mediaTimeMs: 0, reason: 'playing' });
      await controller.whenIdle();
      controller.sample({ mediaTimeMs: 900, reason: 'timeupdate' });
      await controller.whenIdle();

      assert.deepEqual(events, ['admission', 'first-frame', 'settled'], mode);
      assert.deepEqual(
        receipts.filter((value) => value.kind === 'attention').map((value) => value.status),
        ['first-frame', 'settled'],
        mode,
      );
      let attentionReceipts = receipts.filter((value) => value.kind === 'attention');
      assert.equal(
        attentionReceipts.every((value) => value.observedAt.domain === 'performance'),
        true,
        mode,
      );
      assert.equal(
        attentionReceipts.every((value) => (
          value.observedAt.monotonicTimeMs < value.observedAt.timeOriginMs
        )),
        true,
        mode,
      );
      if (mode !== 'frame') {
        assert.equal(
          attentionReceipts[0].observedAt.monotonicTimeMs,
          attentionReceipts[1].observedAt.monotonicTimeMs,
          mode,
        );
      }
    }
  });

  it('retains exact provider rejection and over-budget evidence in terminal failures', async () => {
    let cases = [
      {
        name: 'provider rejection',
        overrides: {
          status: 'rejected',
          reason: {
            code: 'provider-rejected',
            message: 'the provider rejected the zero-progress plan',
            provider: {
              code: 'target-unresolved',
              requestedTarget: 'panel:result',
              matches: [],
            },
          },
          target: {
            identity: null,
            layoutIdentity: null,
            geometryIdentity: null,
            geometry: null,
          },
          budget: {
            plannedDurationMs: null,
          },
          plan: {
            version: null,
            identity: null,
            normalizedPathHash: null,
            motion: null,
            evidence: null,
          },
        },
        code: 'PRESENTATION_EFFECT_ADMISSION_REJECTED',
      },
      {
        name: 'over budget',
        overrides: {
          status: 'rejected',
          budget: { plannedDurationMs: 801 },
          reason: {
            code: 'budget-exceeded',
            message: 'the provider plan exceeds the explicit hard budget',
            provider: null,
          },
        },
        code: 'PRESENTATION_EFFECT_ADMISSION_REJECTED',
      },
    ];

    for (let item of cases) {
      let fixture = configuredFixture('select');
      let providerAdmission;
      let receipts = [];
      let controller = createPresentationExecutionController(controllerInput(
        fixture,
        {
          runInteraction: (input) => {
            providerAdmission = admission(input, item.overrides).providerAdmission;
            input.reportAdmission({ providerAdmission });
            return Promise.resolve();
          },
          runAttention: () => Promise.resolve(),
        },
        (value) => receipts.push(value),
      ));

      controller.sample({ mediaTimeMs: 0, reason: 'playing' });
      await controller.whenIdle();

      assert.deepEqual(receipts.map((value) => value.status), ['failed'], item.name);
      assert.equal(receipts[0].reason.code, item.code, item.name);
      assert.deepEqual(
        receipts[0].reason.details.providerAdmission,
        providerAdmission,
        item.name,
      );
      assert.notEqual(receipts[0].reason.details.providerAdmission, providerAdmission, item.name);
      assert.equal(
        Object.isFrozen(receipts[0].reason.details.providerAdmission.reason),
        true,
        item.name,
      );
    }
  });

  it('preserves portable special keys in admission, receipt, and rejection evidence', async () => {
    let fixture = configuredFixture('select');
    let admissionEvidence = specialKeyEvidence('admission');
    let receiptEvidence = specialKeyEvidence('receipt');
    let acceptedAdmission;
    let receipts = [];
    let controller = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (input) => {
          acceptedAdmission = input.reportAdmission(admission(input, {
            plan: { evidence: admissionEvidence },
          }));
          input.reportReceipt({
            status: 'acted',
            observedAt: observation(),
            providerReceipt: receiptEvidence,
          });
          input.reportReceipt(receipt(input, 'interaction', 'settled'));
          return Promise.resolve();
        },
        runAttention: () => Promise.resolve(),
      },
      (value) => receipts.push(value),
    ));

    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    await controller.whenIdle();

    assertPortableEvidenceClone(
      acceptedAdmission.providerAdmission.plan.evidence,
      admissionEvidence,
    );
    assertPortableEvidenceClone(receipts[0].providerReceipt, receiptEvidence);

    let rejectionEvidence = specialKeyEvidence('rejection');
    rejectionEvidence.code = 'target-unresolved';
    let rejectedAdmission;
    let rejectedReceipts = [];
    let rejected = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (input) => {
          rejectedAdmission = admission(input, {
            status: 'rejected',
            target: {
              identity: null,
              layoutIdentity: null,
              geometryIdentity: null,
              geometry: null,
            },
            budget: { plannedDurationMs: null },
            plan: {
              version: null,
              identity: null,
              normalizedPathHash: null,
              motion: null,
              evidence: null,
            },
            reason: {
              code: 'provider-rejected',
              message: 'the provider rejected the zero-progress plan',
              provider: rejectionEvidence,
            },
          }).providerAdmission;
          input.reportAdmission({ providerAdmission: rejectedAdmission });
          return Promise.resolve();
        },
        runAttention: () => Promise.resolve(),
      },
      (value) => rejectedReceipts.push(value),
    ));

    rejected.sample({ mediaTimeMs: 0, reason: 'playing' });
    await rejected.whenIdle();

    assert.equal(rejectedReceipts[0].reason.code, 'PRESENTATION_EFFECT_ADMISSION_REJECTED');
    assertPortableEvidenceClone(
      rejectedReceipts[0].reason.details.providerAdmission.reason.provider,
      rejectionEvidence,
    );
  });

  it('retains an exact UI terminal failure receipt under one stable Workspace code', async () => {
    let fixture = configuredFixture('select');
    let terminal;
    let receipts = [];
    let controller = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (input) => {
          let providerAdmission = admission(input).providerAdmission;
          input.reportAdmission({ providerAdmission });
          let observedAt = observation(performance.now());
          terminal = {
            version: 'show-attention-terminal-v2',
            status: 'failed',
            observedAt,
            admission: providerAdmission,
            providerReceipt: {
              version: 'presenter-selection-receipt-v2',
              status: 'failed',
              reason: {
                code: 'provider-failed',
                provider: { code: 'selection-detached', rangeCount: 1 },
              },
            },
            timing: { elapsedMs: 12 },
          };
          input.reportReceipt({ status: 'failed', observedAt, providerReceipt: terminal });
          return Promise.resolve();
        },
        runAttention: () => Promise.resolve(),
      },
      (value) => receipts.push(value),
    ));

    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    await controller.whenIdle();

    assert.deepEqual(receipts.map((value) => value.status), ['failed']);
    assert.equal(receipts[0].reason.code, 'PRESENTATION_EFFECT_PROVIDER_FAILED');
    assert.deepEqual(receipts[0].providerReceipt, terminal);
    assert.notEqual(receipts[0].providerReceipt, terminal);
    assert.deepEqual(receipts[0].reason.details.providerReceipt, terminal);
    assert.notEqual(receipts[0].reason.details.providerReceipt, terminal);
    assert.equal(
      Object.isFrozen(
        receipts[0].reason.details.providerReceipt.providerReceipt.reason.provider,
      ),
      true,
    );
    assert.equal(controller.snapshot.barriers.length, 0);
  });

  it('times out silent operations, frees capacity, and suppresses late reports', async () => {
    for (let admissionMode of ['admitted', 'missing']) {
      let fixture = configuredFixture('select', { interactionBudgetMs: 20 });
      let pending = deferred();
      let input;
      let receipts = [];
      let controller = createPresentationExecutionController(controllerInput(
        fixture,
        {
          runInteraction: (value) => {
            input = value;
            if (admissionMode === 'admitted') {
              value.reportAdmission(admission(value, {
                budget: { plannedDurationMs: 5 },
                plan: { motion: { easing: 'minimum-jerk', durationMs: 5 } },
              }));
            }
            return pending.promise;
          },
          runAttention: () => Promise.resolve(),
        },
        (value) => receipts.push(value),
      ));

      controller.sample({ mediaTimeMs: 0, reason: 'playing' });
      await waitForIdleDeadline(controller, 2500);

      assert.equal(input.signal.aborted, true, admissionMode);
      assert.equal(controller.snapshot.activeCount, 0, admissionMode);
      assert.equal(controller.snapshot.pendingCount, 0, admissionMode);
      assert.deepEqual(receipts.map((value) => value.status), ['failed'], admissionMode);
      assert.equal(
        receipts[0].reason.code,
        'PRESENTATION_EFFECT_DEADLINE_MISSED',
        admissionMode,
      );
      assert.equal(
        receipts[0].reason.details.providerAdmission?.status || null,
        admissionMode === 'admitted' ? 'admitted' : null,
        admissionMode,
      );
      let beforeLateReport = structuredClone(receipts);
      assert.throws(
        () => input.reportReceipt(receipt(input, 'interaction', 'acted')),
        (error) => error.code === 'PRESENTATION_EFFECT_RECEIPT_STALE',
      );
      pending.resolve();
      await Promise.resolve();
      assert.deepEqual(receipts, beforeLateReport, admissionMode);
      assert.equal(Object.isFrozen(receipts[0]), true, admissionMode);
      assert.equal(Object.isFrozen(receipts[0].reason.details), true, admissionMode);
    }
  });

  it('exposes one pending idle promise during synchronous receipt reentrancy', async () => {
    let fixture = configuredFixture();
    let pending = deferred();
    let idlePromise;
    let idleSettled = false;
    let receipts = [];
    let controller;
    controller = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (input) => {
          input.reportReceipt(receipt(input, 'interaction', 'acted'));
          input.reportReceipt(receipt(input, 'interaction', 'settled'));
          return pending.promise;
        },
        runAttention: () => Promise.resolve(),
      },
      (value) => {
        receipts.push(value);
        if (value.status !== 'acted') return;
        idlePromise = controller.whenIdle();
        void idlePromise.then(() => {
          idleSettled = true;
        });
      },
    ));

    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    assert.equal(typeof idlePromise?.then, 'function');
    assert.equal(idleSettled, false);
    assert.equal(controller.snapshot.activeCount, 1);

    pending.resolve();
    let snapshot = await idlePromise;
    assert.equal(idleSettled, true);
    assert.equal(snapshot.activeCount, 0);
    assert.equal(controller.snapshot.activeCount, 0);
    assert.deepEqual(receipts.map((value) => value.status), ['acted', 'settled']);
  });

  it('waits for cleanup when pause or Stop re-enters from a synchronous receipt', async () => {
    for (let mode of ['pause', 'stop']) {
      let fixture = configuredFixture();
      let pending = deferred();
      let controlPromise;
      let receipts = [];
      let controller;
      controller = createPresentationExecutionController(controllerInput(
        fixture,
        {
          runInteraction: (input) => {
            input.reportReceipt(receipt(input, 'interaction', 'acted'));
            return pending.promise;
          },
          runAttention: () => Promise.resolve(),
        },
        (value) => {
          receipts.push(value);
          if (value.status === 'acted') controlPromise = controller[mode]();
        },
      ));

      controller.sample({ mediaTimeMs: 0, reason: 'playing' });
      assert.equal(typeof controlPromise?.then, 'function', mode);
      assert.equal(controller.snapshot.activeCount, 1, mode);

      let snapshot = await controlPromise;
      assert.equal(snapshot.activeCount, 0, mode);
      assert.equal(controller.snapshot.activeCount, 0, mode);
      assert.equal(snapshot.state, mode === 'pause' ? 'paused' : 'stopped', mode);
      assert.deepEqual(receipts.map((value) => value.status), ['acted', 'cancelled'], mode);
      pending.resolve();
      await Promise.resolve();
    }
  });

  it('cancels after select first-frame without settling or accepting a late milestone', async () => {
    let fixture = configuredFixture('select');
    let pending = deferred();
    let input;
    let receipts = [];
    let controller = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (value) => {
          input = value;
          let providerAdmission = admission(value).providerAdmission;
          value.reportAdmission({ providerAdmission });
          let observedAt = observation(performance.now());
          value.reportReceipt({
            status: 'acted',
            observedAt,
            providerReceipt: {
              version: 'show-attention-milestone-v2',
              milestone: 'first-frame',
              observedAt,
              admission: providerAdmission,
              providerReceipt: { status: 'presenting', progress: 0.1 },
            },
          });
          return pending.promise;
        },
        runAttention: () => Promise.resolve(),
      },
      (value) => receipts.push(value),
    ));

    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    await controller.pause();

    assert.equal(input.signal.aborted, true);
    assert.deepEqual(receipts.map((value) => value.status), ['acted', 'cancelled']);
    assert.deepEqual(
      controller.snapshot.barriers.find((item) => item.cellId === fixture.scrollId)?.barriers,
      ['acted'],
    );
    let beforeLateReport = structuredClone(receipts);
    assert.throws(
      () => input.reportReceipt(receipt(input, 'interaction', 'settled')),
      (error) => error.code === 'PRESENTATION_EFFECT_RECEIPT_STALE',
    );
    pending.resolve();
    await Promise.resolve();
    assert.deepEqual(receipts, beforeLateReport);
  });

  it('admits at zero progress and opens each reported milestone barrier online', async () => {
    let fixture = configuredFixture('select');
    let interaction = deferred();
    let calls = [];
    let receipts = [];
    let controller = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (input) => {
          calls.push(input);
          return interaction.promise;
        },
        runAttention: () => Promise.resolve(),
      },
      (value) => receipts.push(value),
    ));

    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    let input = calls[0];
    let accepted = input.reportAdmission(admission(input));
    assert.equal(accepted.version, PRESENTATION_EFFECT_ADMISSION_VERSION);
    assert.equal(accepted.authoringProjectHash, fixture.project.hash);
    assert.equal(accepted.scheduleHash, fixture.schedule.hash);
    assert.equal(accepted.operationId, input.operationId);
    assert.equal(Object.isFrozen(accepted), true);

    input.reportReceipt(receipt(input, 'interaction', 'acted'));
    assert.deepEqual(receipts.map((value) => value.status), ['acted']);
    assert.deepEqual(
      controller.snapshot.barriers.find((item) => item.cellId === fixture.scrollId)?.barriers,
      ['acted'],
    );
    assert.equal(controller.snapshot.activeCount, 1);

    input.reportReceipt(receipt(input, 'interaction', 'settled'));
    assert.deepEqual(receipts.map((value) => value.status), ['acted', 'settled']);
    assert.deepEqual(
      controller.snapshot.barriers.find((item) => item.cellId === fixture.scrollId)?.barriers,
      ['acted', 'settled'],
    );
    assert.equal(controller.snapshot.activeCount, 1);

    interaction.resolve();
    await controller.whenIdle();
    assert.equal(controller.snapshot.activeCount, 0);
  });

  it('rejects missing, rejected, stale, and over-budget admission before a milestone opens', async () => {
    let cases = [
      {
        name: 'missing',
        run: (input) => input.reportReceipt(receipt(input, 'interaction', 'acted')),
        code: 'PRESENTATION_EFFECT_ADMISSION_MISSING',
      },
      {
        name: 'rejected',
        run: (input) => assert.throws(
          () => input.reportAdmission(admission(input, {
            status: 'rejected',
            target: {
              identity: null,
              layoutIdentity: null,
              geometryIdentity: null,
              geometry: null,
            },
            budget: { plannedDurationMs: null },
            plan: {
              version: null,
              identity: null,
              normalizedPathHash: null,
              motion: null,
              evidence: null,
            },
            reason: {
              code: 'provider-rejected',
              message: 'the provider rejected the zero-progress plan',
              provider: { code: 'target-unresolved' },
            },
          })),
          (error) => (
            error.code === 'PRESENTATION_EFFECT_ADMISSION_REJECTED'
            && error.details.providerAdmission.reason.provider.code === 'target-unresolved'
          ),
        ),
        code: 'PRESENTATION_EFFECT_ADMISSION_REJECTED',
      },
      {
        name: 'stale target',
        run: (input) => input.reportAdmission(admission(input, {
          target: { id: 'panel:stale' },
        })),
        code: 'PRESENTATION_EFFECT_ADMISSION_CONTEXT_MISMATCH',
      },
      {
        name: 'over budget',
        run: (input) => input.reportAdmission(admission(input, {
          budget: { plannedDurationMs: 801 },
        })),
        code: 'PRESENTATION_EFFECT_ADMISSION_OVER_BUDGET',
      },
    ];

    for (let item of cases) {
      let fixture = configuredFixture('select');
      let receipts = [];
      let controller = createPresentationExecutionController(controllerInput(
        fixture,
        {
          runInteraction: (input) => {
            item.run(input);
            return Promise.resolve();
          },
          runAttention: () => Promise.resolve(),
        },
        (value) => receipts.push(value),
      ));

      controller.sample({ mediaTimeMs: 0, reason: 'playing' });
      await controller.whenIdle();
      assert.deepEqual(receipts.map((value) => value.status), ['failed'], item.name);
      assert.equal(receipts[0].reason.code, item.code, item.name);
      assert.equal(controller.snapshot.barriers.length, 0, item.name);
      assert.equal(controller.snapshot.activeCount, 0, item.name);
    }
  });

  it('admits one operation without a queue and opens actual settlement barriers only', async () => {
    let fixture = configuredFixture();
    let interaction = deferred();
    let attention = deferred();
    let interactionCalls = [];
    let attentionCalls = [];
    let receipts = [];
    let projectBefore = structuredClone(fixture.project);
    let alignmentBefore = structuredClone(fixture.alignedSequence);
    let scheduleBefore = structuredClone(fixture.schedule);
    let controller = createPresentationExecutionController({
      project: fixture.project,
      alignedSequence: fixture.alignedSequence,
      schedule: fixture.schedule,
      adapter: {
        runInteraction: (input) => {
          interactionCalls.push(input);
          return interaction.promise;
        },
        runAttention: (input) => {
          attentionCalls.push(input);
          input.reportAdmission(admission(input));
          return attention.promise;
        },
      },
      onReceipt: (value) => receipts.push(value),
    });

    assert.equal(controller.snapshot.version, PRESENTATION_EXECUTION_VERSION);
    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    assert.equal(interactionCalls.length, 1);
    assert.equal(attentionCalls.length, 0);
    assert.equal(controller.snapshot.activeCount, 1);
    assert.equal(controller.snapshot.pendingCount, 0);

    controller.sample({ mediaTimeMs: 900, reason: 'timeupdate' });
    controller.sample({ mediaTimeMs: 900, reason: 'playback-clock' });
    assert.equal(attentionCalls.length, 0);
    assert.equal(controller.snapshot.maxInFlight, 1);
    assert.equal(controller.snapshot.pendingCount, 0);

    let interactionInput = interactionCalls[0];
    interactionInput.reportReceipt(receipt(interactionInput, 'interaction', 'acted'));
    interactionInput.reportReceipt(receipt(interactionInput, 'interaction', 'settled'));
    interaction.resolve();
    await controller.whenIdle();
    assert.deepEqual(receipts.map((value) => value.status), ['acted', 'settled']);
    assert.equal(attentionCalls.length, 0);

    controller.sample({ mediaTimeMs: 900, reason: 'timeupdate' });
    assert.equal(attentionCalls.length, 1);
    let attentionInput = attentionCalls[0];
    attentionInput.reportReceipt(receipt(attentionInput, 'attention', 'first-frame'));
    attentionInput.reportReceipt(receipt(attentionInput, 'attention', 'settled'));
    attention.resolve();
    await controller.whenIdle();

    assert.deepEqual(
      receipts.map((value) => value.status),
      ['acted', 'settled', 'first-frame', 'settled'],
    );
    assert.equal(controller.snapshot.activeCount, 0);
    assert.equal(controller.snapshot.pendingCount, 0);
    assert.deepEqual(fixture.project, projectBefore);
    assert.deepEqual(fixture.alignedSequence, alignmentBefore);
    assert.deepEqual(fixture.schedule, scheduleBefore);
  });

  it('skips an expired dependent cell once and never drains it after late settlement', async () => {
    let fixture = configuredFixture();
    let interaction = deferred();
    let attentionCalls = [];
    let receipts = [];
    let interactionInput;
    let controller = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (input) => {
          interactionInput = input;
          return interaction.promise;
        },
        runAttention: (input) => {
          attentionCalls.push(input);
          return Promise.resolve();
        },
      },
      (value) => receipts.push(value),
    ));

    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    controller.sample({ mediaTimeMs: 3000, reason: 'timeupdate' });
    assert.equal(controller.snapshot.activeCount, 1);
    assert.equal(controller.snapshot.pendingCount, 0);
    assert.equal(attentionCalls.length, 0);
    assert.deepEqual(
      receipts
        .filter((value) => value.status === 'skipped')
        .map((value) => [value.cellId, value.reason.details.cause]),
      [[fixture.attentionId, 'expired']],
    );

    interactionInput.reportReceipt(receipt(interactionInput, 'interaction', 'acted'));
    interactionInput.reportReceipt(receipt(interactionInput, 'interaction', 'settled'));
    interaction.resolve();
    await controller.whenIdle();
    controller.sample({ mediaTimeMs: 3000, reason: 'timeupdate' });
    controller.sample({ mediaTimeMs: 3100, reason: 'playback-clock' });

    assert.equal(attentionCalls.length, 0);
    assert.equal(
      receipts.filter((value) => value.cellId === fixture.attentionId
        && value.status === 'skipped').length,
      1,
    );
    assert.equal(controller.snapshot.pendingCount, 0);
  });

  it('requires an actual state-ready receipt and a fresh sample before interaction', async () => {
    let fixture = stateConfiguredFixture();
    let state = deferred();
    let interaction = deferred();
    let stateCalls = [];
    let interactionCalls = [];
    let controller = createPresentationExecutionController(controllerInput(fixture, {
      waitForState: (input) => {
        stateCalls.push(input);
        return state.promise;
      },
      runInteraction: (input) => {
        interactionCalls.push(input);
        return interaction.promise;
      },
      runAttention: () => Promise.resolve(),
    }));

    controller.sample({ mediaTimeMs: 300, reason: 'playing' });
    assert.equal(stateCalls.length, 1);
    assert.equal(interactionCalls.length, 0);
    controller.sample({ mediaTimeMs: 900, reason: 'timeupdate' });
    assert.equal(interactionCalls.length, 0);

    let stateInput = stateCalls[0];
    stateInput.reportReceipt(receipt(stateInput, 'state', 'ready'));
    state.resolve();
    await controller.whenIdle();
    assert.equal(interactionCalls.length, 0);

    controller.sample({ mediaTimeMs: 900, reason: 'timeupdate' });
    assert.equal(interactionCalls.length, 1);
    let interactionInput = interactionCalls[0];
    interactionInput.reportReceipt(receipt(interactionInput, 'interaction', 'acted'));
    interactionInput.reportReceipt(receipt(interactionInput, 'interaction', 'settled'));
    interaction.resolve();
    await controller.whenIdle();
    assert.deepEqual(
      controller.snapshot.barriers.find((item) => item.cellId === fixture.stateId)?.barriers,
      ['ready'],
    );
  });

  it('enforces the authored state readiness timeout against a late ready receipt', async () => {
    let fixture = stateConfiguredFixture();
    let stateInput;
    let interactionCalls = 0;
    let receipts = [];
    let controller = createPresentationExecutionController(controllerInput(
      fixture,
      {
        waitForState: (input) => {
          stateInput = input;
          input.reportReceipt(receipt(
            input,
            'state',
            'ready',
            performance.now() + input.projectCell.cue.state.timeoutMs + 1000,
          ));
          return Promise.resolve();
        },
        runInteraction: () => {
          interactionCalls += 1;
          return Promise.resolve();
        },
        runAttention: () => Promise.resolve(),
      },
      (value) => receipts.push(value),
    ));

    controller.sample({ mediaTimeMs: 300, reason: 'playing' });
    await controller.whenIdle();

    assert.equal(stateInput.signal.aborted, true);
    assert.deepEqual(receipts.map((value) => value.status), ['failed']);
    assert.equal(receipts[0].reason.code, 'PRESENTATION_EFFECT_DEADLINE_MISSED');
    assert.equal(controller.snapshot.barriers.length, 0);
    controller.sample({ mediaTimeMs: 900, reason: 'timeupdate' });
    assert.equal(interactionCalls, 0);
  });

  it('rejects stale tuples, backward media time, and non-actual receipt sequences', async () => {
    let fixture = configuredFixture();
    let staleSchedule = structuredClone(fixture.schedule);
    staleSchedule.hash = `${staleSchedule.hash}-stale`;

    assert.throws(
      () => createPresentationExecutionController({
        ...controllerInput(fixture, {
          runInteraction: () => Promise.resolve(),
          runAttention: () => Promise.resolve(),
        }),
        schedule: staleSchedule,
      }),
      (error) => error.code === 'PRESENTATION_EXECUTION_TUPLE_INVALID',
    );

    let interactionInput;
    let receipts = [];
    let controller = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (input) => {
          interactionInput = input;
          input.reportReceipt(receipt(input, 'interaction', 'settled'));
          return Promise.resolve();
        },
        runAttention: () => Promise.resolve(),
      },
      (value) => receipts.push(value),
    ));
    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    await controller.whenIdle();

    assert.equal(interactionInput.scheduleCell.cellId, fixture.scrollId);
    assert.deepEqual(receipts.map((value) => value.status), ['failed']);
    assert.equal(receipts[0].reason.code, 'PRESENTATION_EFFECT_RECEIPT_SEQUENCE_INVALID');
    assert.equal(
      controller.snapshot.barriers.some((item) => item.cellId === fixture.scrollId),
      false,
    );
    controller.sample({ mediaTimeMs: 100, reason: 'timeupdate' });
    assert.throws(
      () => controller.sample({ mediaTimeMs: 99, reason: 'timeupdate' }),
      (error) => error.code === 'PRESENTATION_EXECUTION_BACKWARD_MEDIA_TIME',
    );
  });

  it('fails one late milestone without opening settled or launching its dependent', async () => {
    let fixture = configuredFixture();
    let interactionInput;
    let attentionCalls = [];
    let receipts = [];
    let controller = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (input) => {
          interactionInput = input;
          input.reportReceipt(receipt(input, 'interaction', 'acted'));
          input.reportReceipt(receipt(
            input,
            'interaction',
            'settled',
            performance.now() + input.scheduleCell.gesture.endMs + 2500,
          ));
          return Promise.resolve();
        },
        runAttention: (input) => {
          attentionCalls.push(input);
          return Promise.resolve();
        },
      },
      (value) => receipts.push(value),
    ));

    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    await controller.whenIdle();

    assert.equal(interactionInput.signal.aborted, true);
    assert.deepEqual(receipts.map((value) => value.status), ['acted', 'failed']);
    assert.equal(receipts.at(-1).reason.code, 'PRESENTATION_EFFECT_DEADLINE_MISSED');
    assert.deepEqual(
      controller.snapshot.barriers.find((item) => item.cellId === fixture.scrollId)?.barriers,
      ['acted'],
    );
    controller.sample({ mediaTimeMs: 900, reason: 'timeupdate' });
    assert.equal(attentionCalls.length, 0);
    assert.equal(controller.snapshot.pendingCount, 0);
  });

  it('accepts reporter-only terminal milestones and rejects duplicate or late reports', async () => {
    let fixture = configuredFixture();
    let firstInput;
    let receipts = [];
    let controller = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (input) => {
          firstInput = input;
          input.reportReceipt(receipt(input, 'interaction', 'acted'));
          input.reportReceipt(receipt(input, 'interaction', 'settled'));
          return Promise.resolve(null);
        },
        runAttention: () => Promise.resolve(),
      },
      (value) => receipts.push(value),
    ));

    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    await controller.whenIdle();
    assert.deepEqual(receipts.map((value) => value.status), ['acted', 'settled']);
    assert.throws(
      () => firstInput.reportReceipt(receipt(firstInput, 'interaction', 'settled')),
      (error) => error.code === 'PRESENTATION_EFFECT_RECEIPT_STALE',
    );
    assert.deepEqual(receipts.map((value) => value.status), ['acted', 'settled']);

    let duplicateReceipts = [];
    let duplicate = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (input) => {
          input.reportReceipt(receipt(input, 'interaction', 'acted'));
          input.reportReceipt(receipt(input, 'interaction', 'acted'));
          return Promise.resolve();
        },
        runAttention: () => Promise.resolve(),
      },
      (value) => duplicateReceipts.push(value),
    ));
    duplicate.sample({ mediaTimeMs: 0, reason: 'playing' });
    await duplicate.whenIdle();
    assert.deepEqual(duplicateReceipts.map((value) => value.status), ['acted', 'failed']);
    assert.equal(
      duplicateReceipts.at(-1).reason.code,
      'PRESENTATION_EFFECT_RECEIPT_SEQUENCE_INVALID',
    );
  });

  it('rejects adapter-returned receipt evidence without adding a second journal ingress', async () => {
    let fixture = configuredFixture();
    let receipts = [];
    let controller = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (input) => Promise.resolve(receipt(input, 'interaction', 'acted')),
        runAttention: () => Promise.resolve(),
      },
      (value) => receipts.push(value),
    ));

    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    await controller.whenIdle();

    assert.deepEqual(receipts.map((value) => value.status), ['failed']);
    assert.equal(receipts[0].reason.code, 'PRESENTATION_EFFECT_RECEIPT_INVALID');
    assert.equal(controller.snapshot.barriers.length, 0);
    assert.equal(controller.snapshot.activeCount, 0);
  });

  it('rejects caller-supplied Workspace identity in provider milestone inputs', async () => {
    let mutations = [
      ['operation', (value) => ({ ...value, operationId: `${value.operationId}:stale` })],
      ['generation', (value) => ({ ...value, generation: value.generation + 1 })],
      ['cell', (value) => ({ ...value, cellId: `${value.cellId}:stale` })],
    ];
    for (let [name, mutate] of mutations) {
      let fixture = configuredFixture('select');
      let receipts = [];
      let controller = createPresentationExecutionController(controllerInput(
        fixture,
        {
          runInteraction: (input) => {
            input.reportAdmission(admission(input));
            input.reportReceipt(mutate(receipt(input, 'interaction', 'acted')));
            return Promise.resolve();
          },
          runAttention: () => Promise.resolve(),
        },
        (value) => receipts.push(value),
      ));

      controller.sample({ mediaTimeMs: 0, reason: 'playing' });
      await controller.whenIdle();
      assert.deepEqual(receipts.map((value) => value.status), ['failed'], name);
      assert.equal(
        receipts[0].reason.code,
        'PRESENTATION_EFFECT_RECEIPT_INVALID',
        name,
      );
      assert.equal(controller.snapshot.barriers.length, 0, name);
    }
  });

  it('aborts active work on pause, seek, Stop, dispose, and external cancellation', async () => {
    for (let mode of ['pause', 'seek', 'stop', 'dispose', 'external-abort']) {
      let fixture = configuredFixture();
      let pending = deferred();
      let calls = [];
      let receipts = [];
      let external = new AbortController();
      let controller = createPresentationExecutionController(controllerInput(
        fixture,
        {
          runInteraction: (input) => {
            calls.push(input);
            return pending.promise;
          },
          runAttention: () => Promise.resolve(),
        },
        (value) => receipts.push(value),
        mode === 'external-abort' ? external.signal : undefined,
      ));

      controller.sample({ mediaTimeMs: 0, reason: 'playing' });
      let initialGeneration = controller.snapshot.generation;
      if (mode === 'external-abort') {
        external.abort(new Error('host-abort'));
        await controller.whenIdle();
      } else {
        await controller[mode]();
      }

      assert.equal(calls.length, 1, mode);
      assert.equal(calls[0].signal.aborted, true, mode);
      assert.equal(controller.snapshot.activeCount, 0, mode);
      assert.equal(controller.snapshot.pendingCount, 0, mode);
      assert.equal(
        controller.snapshot.generation,
        mode === 'seek' ? initialGeneration + 1 : initialGeneration,
        mode,
      );
      assert.deepEqual(
        receipts.map((value) => value.status),
        [mode === 'seek' ? 'stale' : 'cancelled'],
        mode,
      );
      let beforeLateReceipt = receipts.length;
      pending.resolve();
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(receipts.length, beforeLateReceipt, mode);
    }
  });

  it('resumes only through a fresh sample and exposes deeply immutable snapshots', async () => {
    let fixture = configuredFixture();
    let operations = [];
    let controller = createPresentationExecutionController(controllerInput(fixture, {
      runInteraction: (input) => {
        let operation = deferred();
        operations.push({ input, operation });
        return operation.promise;
      },
      runAttention: () => Promise.resolve(),
    }));

    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    await controller.pause();
    assert.equal(operations.length, 1);
    assert.equal(controller.snapshot.state, 'paused');
    controller.sample({ mediaTimeMs: 0, reason: 'paused-timeupdate' });
    assert.equal(operations.length, 1);
    controller.resume();
    assert.equal(operations.length, 1);
    controller.sample({ mediaTimeMs: 0, reason: 'resume-timeupdate' });
    assert.equal(operations.length, 2);

    let current = operations[1];
    current.input.reportReceipt(receipt(current.input, 'interaction', 'acted'));
    current.input.reportReceipt(receipt(current.input, 'interaction', 'settled'));
    current.operation.resolve();
    await controller.whenIdle();
    let snapshot = controller.snapshot;
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.barriers), true);
    assert.equal(Object.isFrozen(snapshot.barriers[0]), true);
    assert.equal(Object.isFrozen(snapshot.barriers[0].barriers), true);
  });

  it('validates one exact portable effect receipt shape', () => {
    let expected = {
      operationId: 'presentation-effect-0-1',
      generation: 0,
      authoringProjectHash: 'workspace-presentation-authoring-project-v1:project',
      scheduleHash: 'workspace-presenter-action-schedule-v2:schedule',
      cellId: 'execution-settlement:cue:show-result:1',
      kind: 'interaction',
    };
    let providerReceipt = {
      version: 'show-attention-milestone-v2',
      milestone: 'first-frame',
      evidence: { selectedText: 'result', ranges: [{ start: 0, end: 6 }] },
    };
    let value = {
      version: PRESENTATION_EFFECT_RECEIPT_VERSION,
      ...expected,
      status: 'acted',
      observedAt: observation(performance.now()),
      providerReceipt,
    };

    let validated = validatePresentationEffectReceipt(value, expected);
    assert.deepEqual(validated, value);
    assert.notEqual(validated, value);
    assert.notEqual(validated.providerReceipt, providerReceipt);
    assert.equal(Object.isFrozen(validated.providerReceipt.evidence.ranges[0]), true);
    assert.throws(
      () => validatePresentationEffectReceipt({ ...value, selector: '#result' }, expected),
      (error) => error.code === 'PRESENTATION_EFFECT_RECEIPT_INVALID',
    );
    assert.throws(
      () => validatePresentationEffectReceipt({ ...value, status: 'first-frame' }, expected),
      (error) => error.code === 'PRESENTATION_EFFECT_RECEIPT_INVALID',
    );
    assert.throws(
      () => validatePresentationEffectReceipt({ ...value, monotonicTimeMs: 10 }, expected),
      (error) => error.code === 'PRESENTATION_EFFECT_RECEIPT_INVALID',
    );
  });

  it('validates one immutable namespaced provider admission without a flat path', () => {
    let expected = {
      operationId: 'presentation-effect-3-7',
      generation: 3,
      authoringProjectHash: 'workspace-presentation-authoring-project-v1:project',
      scheduleHash: 'workspace-presenter-action-schedule-v2:schedule',
      cellId: 'presentation:cue:turn:1',
      kind: 'attention',
      targetId: 'panel:result',
      budgetMs: 500,
    };
    let operation = {
      operationId: expected.operationId,
      scheduleCell: {
        cellId: expected.cellId,
        targetId: expected.targetId,
        gesture: { startMs: 0, endMs: expected.budgetMs },
      },
    };
    let providerAdmission = admission(operation, {
      budget: { plannedDurationMs: 480 },
      plan: { motion: { easing: 'minimum-jerk', durationMs: 480 } },
    }).providerAdmission;
    let value = {
      version: PRESENTATION_EFFECT_ADMISSION_VERSION,
      ...expected,
      providerAdmission,
    };

    let validated = validatePresentationEffectAdmission(value, expected);
    assert.deepEqual(validated, value);
    assert.notEqual(validated.providerAdmission, providerAdmission);
    assert.equal(Object.isFrozen(validated), true);
    assert.equal(Object.isFrozen(validated.providerAdmission.plan.motion), true);
    assert.throws(
      () => validatePresentationEffectAdmission(
        {
          ...value,
          providerAdmission: {
            ...providerAdmission,
            budget: { ...providerAdmission.budget, plannedDurationMs: Number.POSITIVE_INFINITY },
          },
        },
        expected,
      ),
      (error) => error.code === 'PRESENTATION_EFFECT_ADMISSION_INVALID',
    );
    assert.throws(
      () => validatePresentationEffectAdmission({ ...value, generation: 4 }, expected),
      (error) => error.code === 'PRESENTATION_EFFECT_ADMISSION_CONTEXT_MISMATCH',
    );
    assert.throws(
      () => validatePresentationEffectAdmission({
        ...value,
        providerAdmission: {
          ...providerAdmission,
          provider: { ...providerAdmission.provider, id: 'another-provider' },
        },
      }, expected),
      (error) => error.code === 'PRESENTATION_EFFECT_ADMISSION_INVALID',
    );
    assert.throws(
      () => validatePresentationEffectAdmission({
        ...value,
        providerPlanId: providerAdmission.plan.identity,
      }, expected),
      (error) => error.code === 'PRESENTATION_EFFECT_ADMISSION_INVALID',
    );

    let rejectedProviderAdmission = admission(operation, {
      status: 'rejected',
      target: {
        identity: null,
        layoutIdentity: null,
        geometryIdentity: null,
        geometry: null,
      },
      budget: { plannedDurationMs: null },
      plan: {
        version: null,
        identity: null,
        normalizedPathHash: null,
        motion: null,
        evidence: null,
      },
      reason: {
        code: 'provider-rejected',
        message: 'the provider rejected the zero-progress plan',
        provider: { code: 'target-unresolved', selector: '#missing' },
      },
    }).providerAdmission;
    let rejected = validatePresentationEffectAdmission({
      version: PRESENTATION_EFFECT_ADMISSION_VERSION,
      ...expected,
      providerAdmission: rejectedProviderAdmission,
    }, expected);
    assert.deepEqual(rejected.providerAdmission, rejectedProviderAdmission);
    assert.equal(rejected.providerAdmission.reason.code, 'provider-rejected');
    assert.equal(rejected.providerAdmission.reason.provider.code, 'target-unresolved');
  });

  it('opens ended barriers only when an observed media sample crosses their end', async () => {
    let fixture = configuredFixture();
    let receipts = [];
    let controller = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (input) => {
          input.reportReceipt(receipt(input, 'interaction', 'acted'));
          input.reportReceipt(receipt(input, 'interaction', 'settled'));
          return Promise.resolve();
        },
        runAttention: (input) => {
          input.reportAdmission(admission(input));
          input.reportReceipt(receipt(input, 'attention', 'first-frame'));
          input.reportReceipt(receipt(input, 'attention', 'settled'));
          return Promise.resolve();
        },
      },
      (value) => receipts.push(value),
    ));

    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    await controller.whenIdle();
    controller.sample({ mediaTimeMs: 900, reason: 'timeupdate' });
    await controller.whenIdle();
    controller.sample({ mediaTimeMs: 2999, reason: 'timeupdate' });
    assert.equal(receipts.some((value) => value.status === 'ended'), false);

    controller.sample({ mediaTimeMs: 3000, reason: 'timeupdate' });
    let ended = receipts.filter((value) => value.status === 'ended');
    assert.equal(ended.length, 2);
    assert.equal(ended.every((value) => value.operationId === 'presentation-media-0'), true);
    assert.equal(
      controller.snapshot.barriers.filter((item) => item.barriers.includes('ended')).length,
      2,
    );
  });
});
