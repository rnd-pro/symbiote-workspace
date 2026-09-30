import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createPresentationAlignedSequence,
  createPresentationAuthoringProject,
  createPresentationAuthoringProjectFromTimeline,
  createPresentationAuthoringTimelineProjection,
  createPresentationScheduleV2,
  createPresentationTimelineContract,
} from '../index.js';

describe('presentation cue visibility authoring', () => {
  it('keeps explicit until:null canonical across normalization, projection, and scheduling', () => {
    const first = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'canonical-explicit-visibility',
      title: 'Canonical explicit visibility',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'guide', locale: 'en-US' } },
      grounding: { sources: [] },
      turns: [{
        id: 'overview',
        persona: 'guide',
        dialogueAct: 'explain',
        text: 'Show the result.',
        sourceRefs: [],
        claims: [],
        cues: [{
          kind: 'focus',
          targetId: 'result',
          at: { anchor: 'turn-start', offsetMs: 0 },
          until: null,
          focus: { mode: 'frame' },
        }],
      }],
    });
    const second = createPresentationTimelineContract(first);

    assert.equal(first.turns[0].cues[0].until, null);
    assert.deepEqual(second, first);
    assert.equal(second.hash, first.hash);

    const { project } = createPresentationAuthoringProjectFromTimeline(first);
    const cueCell = project.cells.find((cell) => cell.kind === 'cue');
    assert.equal(cueCell.timing.until, null);

    const projected = createPresentationAuthoringTimelineProjection(project);
    assert.equal(projected.turns[0].cues[0].until, null);
    assert.equal(projected.hash, first.hash);

    const alignment = createPresentationAlignedSequence(projected, {
      media: { hash: 'sha256-audio', durationMs: 1000, locale: 'en-US' },
      turns: [{ startMs: 0, endMs: 1000, transcript: 'Show the result.', words: [] }],
    });
    const schedule = createPresentationScheduleV2(project, alignment);
    assert.equal(schedule.cells.find((cell) => cell.cellId === cueCell.id).visibility, null);
  });

  it('treats an own until:undefined as omission on the first canonical pass', () => {
    const first = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'undefined-visibility',
      title: 'Undefined visibility',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'guide', locale: 'en-US' } },
      grounding: { sources: [] },
      turns: [{
        id: 'overview',
        persona: 'guide',
        dialogueAct: 'explain',
        text: 'Show the result.',
        sourceRefs: [],
        claims: [],
        cues: [{
          kind: 'focus',
          targetId: 'result',
          at: { anchor: 'turn-start', offsetMs: 0 },
          until: undefined,
          focus: { mode: 'frame' },
        }],
      }],
    });
    const second = createPresentationTimelineContract(first);

    assert.deepEqual(first.turns[0].cues[0].until, { anchor: 'turn-end', offsetMs: 0 });
    assert.deepEqual(second, first);
    assert.equal(second.hash, first.hash);
  });

  it('preserves an explicit null visibility end instead of restoring the marker default', () => {
    const timeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'explicit-visibility',
      title: 'Explicit visibility',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'guide', locale: 'en-US' } },
      grounding: { sources: [] },
      turns: [{
        id: 'overview',
        persona: 'guide',
        dialogueAct: 'explain',
        text: 'Show the result.',
        sourceRefs: [],
        claims: [],
        cues: [],
      }],
    });
    const project = createPresentationAuthoringProject({
      schemaVersion: 'workspace-presentation-authoring-project-v2',
      id: timeline.id,
      revision: 1,
      script: {
        title: timeline.title,
        locale: timeline.locale,
        profile: timeline.profile,
        personas: timeline.personas,
        grounding: timeline.grounding,
      },
      policy: {
        visualOwnerId: 'presenter',
        collisionDomains: [{ id: 'presenter', name: 'Presenter', exclusive: true }],
      },
      assets: [],
      layers: [
        {
          id: 'narration',
          kind: 'narration',
          name: 'Narration',
          visualOwnerId: null,
          collisionDomainId: null,
        },
        {
          id: 'focus',
          kind: 'focus',
          name: 'Focus',
          visualOwnerId: 'presenter',
          collisionDomainId: 'presenter',
        },
      ],
      cells: [
        {
          id: 'narration:overview',
          kind: 'narration',
          layerId: 'narration',
          turnId: 'overview',
          turn: Object.fromEntries(
            Object.entries(timeline.turns[0]).filter(([key]) => key !== 'cues'),
          ),
          dependsOn: [],
        },
        {
          id: 'focus:result',
          kind: 'cue',
          layerId: 'focus',
          turnId: 'overview',
          cue: { kind: 'focus', targetId: 'result', focus: { mode: 'frame' } },
          timing: {
            at: { anchor: 'speech', quote: 'result', occurrence: 1, edge: 'start', offsetMs: 0 },
            until: null,
            leadMs: 0,
            gestureDurationMs: 500,
            settleBy: 'none',
          },
          dependsOn: [],
        },
      ],
    });

    assert.equal(project.cells.find(({ id }) => id === 'focus:result').timing.until, null);
  });
});
