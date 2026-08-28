import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESENTATION_SCHEDULE_V2_VERSION,
  createPresentationAlignedSequence,
  createPresentationAuthoringProject,
  createPresentationAuthoringProjectFromTimeline,
  createPresentationScheduleV2,
  createPresentationTimelineContract,
  createPresentationAuthoringTimelineProjection,
  validatePresentationScheduleV2,
} from '../index.js';

function timelineFixture() {
  return createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'settled-attention',
    title: 'Settled attention',
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
            binding: { source: 'webmcp', tool: 'panel.reveal', input: { id: 'result' } },
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

function alignedSequence(project) {
  let timeline = createPresentationAuthoringTimelineProjection(project);
  return createPresentationAlignedSequence(timeline, {
    media: { hash: 'sha256-audio', durationMs: 2000, locale: 'en-US' },
    turns: [{
      startMs: 0,
      endMs: 2000,
      transcript: timeline.turns[0].text,
      words: [
        { text: 'Open', startMs: 0, endMs: 180 },
        { text: 'the', startMs: 180, endMs: 260 },
        { text: 'panel', startMs: 260, endMs: 500 },
        { text: 'then', startMs: 700, endMs: 850 },
        { text: 'mark', startMs: 1000, endMs: 1180 },
        { text: 'the', startMs: 1180, endMs: 1260 },
        { text: 'result', startMs: 1260, endMs: 1550 },
      ],
    }],
  });
}

function configuredProject(overrides = {}) {
  let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
  let scroll = project.cells.find((cell) => (
    cell.kind === 'cue' && cell.cue.interaction?.type === 'scroll'
  ));
  let attention = project.cells.find((cell) => cell.kind === 'cue' && cell.cue.kind === 'annotation');
  let cells = project.cells.map((cell) => {
    if (cell.id === scroll.id) {
      return {
        ...cell,
        timing: {
          ...cell.timing,
          leadMs: 300,
          gestureDurationMs: overrides.scrollDurationMs ?? 500,
          settleBy: 'none',
        },
        dependsOn: overrides.scrollDependsOn ?? [],
      };
    }
    if (cell.id === attention.id) {
      return {
        ...cell,
        timing: {
          ...cell.timing,
          leadMs: 900,
          gestureDurationMs: 400,
          settleBy: overrides.attentionSettleBy ?? 'anchor',
        },
        dependsOn: overrides.attentionDependsOn ?? [{ cellId: scroll.id, barrier: 'settled' }],
      };
    }
    return cell;
  });
  return {
    project: createPresentationAuthoringProject({ ...project, cells }),
    scrollId: scroll.id,
    attentionId: attention.id,
  };
}

describe('workspace presenter action schedule v2', () => {
  it('adds deterministic pre-roll and settles scroll before attention begins', () => {
    let { project, scrollId, attentionId } = configuredProject();
    let alignment = alignedSequence(project);
    let first = createPresentationScheduleV2(project, alignment);
    let second = createPresentationScheduleV2(project, alignment);
    let scroll = first.cells.find((cell) => cell.cellId === scrollId);
    let attention = first.cells.find((cell) => cell.cellId === attentionId);

    assert.equal(first.contractVersion, PRESENTATION_SCHEDULE_V2_VERSION);
    assert.equal(first.presentationStartMs, 300);
    assert.deepEqual(first.audio, { startMs: 300, endMs: 2300, durationMs: 2000 });
    assert.deepEqual(scroll.gesture, { startMs: 0, endMs: 500 });
    assert.equal(scroll.plannedBarriers.settled, 500);
    assert.equal(attention.authoredStartMs, 400);
    assert.deepEqual(attention.gesture, { startMs: 500, endMs: 900 });
    assert.equal(attention.plannedDependencyReadyMs, 500);
    assert.equal(attention.plannedBarriers.settled, 900);
    assert.ok(scroll.gesture.endMs <= attention.gesture.startMs);
    assert.deepEqual(second, first);
    assert.equal(validatePresentationScheduleV2(first, project, alignment), first);
  });

  it('rejects overlapping half-open gestures instead of silently shifting either cell', () => {
    let { project, scrollId, attentionId } = configuredProject({ attentionDependsOn: [] });
    let alignment = alignedSequence(project);

    assert.throws(
      () => createPresentationScheduleV2(project, alignment),
      (error) => (
        error.code === 'PRESENTATION_SCHEDULE_EXCLUSIVE_COLLISION'
        && error.details.cellIds.includes(scrollId)
        && error.details.cellIds.includes(attentionId)
      ),
    );
  });

  it('orders equal-time cells by layer order, cell order, and stable identity', () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let schedule = createPresentationScheduleV2(project, alignedSequence(project));
    let equalTimeCells = schedule.cells.filter((cell) => cell.startMs === 0);
    let expected = [...equalTimeCells].sort((left, right) => (
      left.layerOrder - right.layerOrder
      || left.cellOrder - right.cellOrder
      || left.cellId.localeCompare(right.cellId)
    ));

    assert.equal(equalTimeCells.length >= 2, true);
    assert.deepEqual(equalTimeCells.map((cell) => cell.cellId), expected.map((cell) => cell.cellId));
  });

  it('keeps an equal-time prerequisite before its dependent after final ordering', () => {
    let timeline = structuredClone(timelineFixture());
    delete timeline.hash;
    timeline.turns[0].cues.push({
      kind: 'state',
      targetId: 'panel:result',
      at: { anchor: 'turn-start', offsetMs: 0 },
      state: { condition: 'paint-stable', timeoutMs: 5000 },
    });
    let { project: imported } = createPresentationAuthoringProjectFromTimeline(
      createPresentationTimelineContract(timeline),
    );
    let state = imported.cells.find((cell) => cell.cue?.kind === 'state');
    let scroll = imported.cells.find((cell) => cell.cue?.interaction?.type === 'scroll');
    let project = createPresentationAuthoringProject({
      ...imported,
      cells: imported.cells.map((cell) => (
        cell.id === scroll.id
          ? { ...cell, dependsOn: [{ cellId: state.id, barrier: 'ready' }] }
          : cell
      )),
    });
    let schedule = createPresentationScheduleV2(project, alignedSequence(project));
    let stateIndex = schedule.cells.findIndex((cell) => cell.cellId === state.id);
    let scrollIndex = schedule.cells.findIndex((cell) => cell.cellId === scroll.id);

    assert.equal(schedule.cells[stateIndex].startMs, schedule.cells[scrollIndex].startMs);
    assert.ok(stateIndex < scrollIndex);
  });

  it('does not defer invalid Authoring Project dependency graphs into scheduling', () => {
    assert.throws(
      () => configuredProject({
        attentionDependsOn: [{ cellId: 'missing-cell', barrier: 'settled' }],
      }),
      (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_UNKNOWN_DEPENDENCY',
    );

    let scrollId = configuredProject().scrollId;
    assert.throws(
      () => configuredProject({
        attentionDependsOn: [{ cellId: scrollId, barrier: 'ready' }],
      }),
      (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_BARRIER_UNAVAILABLE',
    );

    let baseline = configuredProject();
    let cyclicCells = baseline.project.cells.map((cell) => {
      if (cell.id === baseline.scrollId) {
        return {
          ...cell,
          dependsOn: [{ cellId: baseline.attentionId, barrier: 'settled' }],
        };
      }
      return cell;
    });
    assert.throws(
      () => createPresentationAuthoringProject({ ...baseline.project, cells: cyclicCells }),
      (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_DEPENDENCY_CYCLE',
    );
  });

  it('rejects a dependency push that makes an anchor settlement deadline impossible', () => {
    let { project } = configuredProject({ scrollDurationMs: 1300 });

    assert.throws(
      () => createPresentationScheduleV2(project, alignedSequence(project)),
      (error) => (
        error.code === 'PRESENTATION_SCHEDULE_HARD_DEADLINE'
        && error.details.settleBy === 'anchor'
      ),
    );
  });

  it('detects stale schedule content with a typed validation error', () => {
    let { project } = configuredProject();
    let alignment = alignedSequence(project);
    let schedule = createPresentationScheduleV2(project, alignment);

    assert.throws(
      () => validatePresentationScheduleV2({ ...schedule, presentationStartMs: 0 }, project, alignment),
      (error) => error.code === 'PRESENTATION_SCHEDULE_STALE',
    );
  });
});
