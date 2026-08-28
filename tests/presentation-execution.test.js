import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as runtimeApi from '../runtime/index.js';
import * as presentationApi from '../runtime/presentation.js';

import {
  PRESENTATION_EFFECT_RECEIPT_VERSION,
  PRESENTATION_EXECUTION_VERSION,
  createPresentationAlignedSequence,
  createPresentationAuthoringProject,
  createPresentationAuthoringProjectFromTimeline,
  createPresentationExecutionController,
  createPresentationScheduleV2,
  createPresentationTimelineContract,
  createPresentationAuthoringTimelineProjection,
  validatePresentationEffectReceipt,
} from '../index.js';

function timelineFixture() {
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
            type: 'scroll',
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

function configuredFixture() {
  let { project: baseline } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
  let scroll = baseline.cells.find((cell) => (
    cell.kind === 'cue' && cell.cue.interaction?.type === 'scroll'
  ));
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
          gestureDurationMs: 800,
        },
      };
    }
    if (cell.id === attention.id) {
      return {
        ...cell,
        timing: {
          ...cell.timing,
          leadMs: 800,
          gestureDurationMs: 500,
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

function receipt(input, kind, status) {
  return Object.freeze({
    version: PRESENTATION_EFFECT_RECEIPT_VERSION,
    operationId: input.operationId,
    generation: input.generation,
    cellId: input.scheduleCell.cellId,
    kind,
    status,
  });
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
    for (let api of [presentationApi, runtimeApi]) {
      assert.equal(api.PRESENTATION_EXECUTION_VERSION, PRESENTATION_EXECUTION_VERSION);
      assert.equal(
        api.PRESENTATION_EFFECT_RECEIPT_VERSION,
        PRESENTATION_EFFECT_RECEIPT_VERSION,
      );
      assert.equal(api.createPresentationExecutionController, createPresentationExecutionController);
      assert.equal(api.validatePresentationEffectReceipt, validatePresentationEffectReceipt);
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
    interaction.resolve([
      receipt(interactionInput, 'interaction', 'acted'),
      receipt(interactionInput, 'interaction', 'settled'),
    ]);
    await controller.whenIdle();
    assert.deepEqual(receipts.map((value) => value.status), ['acted', 'settled']);
    assert.equal(attentionCalls.length, 0);

    controller.sample({ mediaTimeMs: 900, reason: 'timeupdate' });
    assert.equal(attentionCalls.length, 1);
    let attentionInput = attentionCalls[0];
    attention.resolve([
      receipt(attentionInput, 'attention', 'first-frame'),
      receipt(attentionInput, 'attention', 'settled'),
    ]);
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
          return Promise.resolve([]);
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
        .map((value) => [value.cellId, value.reason]),
      [[fixture.attentionId, 'expired']],
    );

    interaction.resolve([
      receipt(interactionInput, 'interaction', 'acted'),
      receipt(interactionInput, 'interaction', 'settled'),
    ]);
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
      runAttention: () => Promise.resolve([]),
    }));

    controller.sample({ mediaTimeMs: 300, reason: 'playing' });
    assert.equal(stateCalls.length, 1);
    assert.equal(interactionCalls.length, 0);
    controller.sample({ mediaTimeMs: 900, reason: 'timeupdate' });
    assert.equal(interactionCalls.length, 0);

    let stateInput = stateCalls[0];
    state.resolve([receipt(stateInput, 'state', 'ready')]);
    await controller.whenIdle();
    assert.equal(interactionCalls.length, 0);

    controller.sample({ mediaTimeMs: 900, reason: 'timeupdate' });
    assert.equal(interactionCalls.length, 1);
    let interactionInput = interactionCalls[0];
    interaction.resolve([
      receipt(interactionInput, 'interaction', 'acted'),
      receipt(interactionInput, 'interaction', 'settled'),
    ]);
    await controller.whenIdle();
    assert.deepEqual(
      controller.snapshot.barriers.find((item) => item.cellId === fixture.stateId)?.barriers,
      ['ready'],
    );
  });

  it('rejects stale tuples, backward media time, and non-actual receipt sequences', async () => {
    let fixture = configuredFixture();
    let staleSchedule = structuredClone(fixture.schedule);
    staleSchedule.hash = `${staleSchedule.hash}-stale`;

    assert.throws(
      () => createPresentationExecutionController({
        ...controllerInput(fixture, {
          runInteraction: () => Promise.resolve([]),
          runAttention: () => Promise.resolve([]),
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
          return Promise.resolve([
            receipt(input, 'interaction', 'settled'),
            receipt(input, 'interaction', 'acted'),
          ]);
        },
        runAttention: () => Promise.resolve([]),
      },
      (value) => receipts.push(value),
    ));
    controller.sample({ mediaTimeMs: 0, reason: 'playing' });
    await controller.whenIdle();

    assert.equal(interactionInput.scheduleCell.cellId, fixture.scrollId);
    assert.deepEqual(receipts.map((value) => value.status), ['failed']);
    assert.match(receipts[0].reason, /must have status "acted"/);
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
          runAttention: () => Promise.resolve([]),
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
      pending.resolve([
        receipt(calls[0], 'interaction', 'acted'),
        receipt(calls[0], 'interaction', 'settled'),
      ]);
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
      runAttention: () => Promise.resolve([]),
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
    current.operation.resolve([
      receipt(current.input, 'interaction', 'acted'),
      receipt(current.input, 'interaction', 'settled'),
    ]);
    await controller.whenIdle();
    let snapshot = controller.snapshot;
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.barriers), true);
    assert.equal(Object.isFrozen(snapshot.barriers[0]), true);
    assert.equal(Object.isFrozen(snapshot.barriers[0].barriers), true);
  });

  it('validates one exact portable effect receipt shape', () => {
    let value = {
      version: PRESENTATION_EFFECT_RECEIPT_VERSION,
      operationId: 'presentation-effect-0-1',
      generation: 0,
      cellId: 'execution-settlement:cue:show-result:1',
      kind: 'interaction',
      status: 'acted',
    };
    let expected = {
      operationId: value.operationId,
      cellId: value.cellId,
      kind: value.kind,
    };

    assert.equal(validatePresentationEffectReceipt(value, expected), value);
    assert.throws(
      () => validatePresentationEffectReceipt({ ...value, selector: '#result' }, expected),
      (error) => error.code === 'PRESENTATION_EFFECT_RECEIPT_INVALID',
    );
    assert.throws(
      () => validatePresentationEffectReceipt({ ...value, status: 'first-frame' }, expected),
      (error) => error.code === 'PRESENTATION_EFFECT_RECEIPT_INVALID',
    );
  });

  it('opens ended barriers only when an observed media sample crosses their end', async () => {
    let fixture = configuredFixture();
    let receipts = [];
    let controller = createPresentationExecutionController(controllerInput(
      fixture,
      {
        runInteraction: (input) => Promise.resolve([
          receipt(input, 'interaction', 'acted'),
          receipt(input, 'interaction', 'settled'),
        ]),
        runAttention: (input) => Promise.resolve([
          receipt(input, 'attention', 'first-frame'),
          receipt(input, 'attention', 'settled'),
        ]),
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
