import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  solvePresentationClock,
  createPresentationTimelineContract,
  createPresenterActionSchedule,
  validatePresenterActionSchedule,
  createPresentationAlignedSequence,
  PRESENTER_ACTION_SCHEDULE_VERSION,
} from '../runtime/index.js';

function createTestTimeline() {
  return createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'test-timeline',
    title: 'Test Timeline',
    locale: 'en-US',
    profile: 'brief',
    personas: {
      guide: { name: 'Guide', role: 'lesson guide' },
    },
    grounding: { sources: [] },
    turns: [
      {
        id: 'turn-1',
        persona: 'guide',
        dialogueAct: 'explain',
        text: 'This is the first turn.',
        cues: [
          {
            kind: 'focus',
            targetId: 'panel:home',
            at: { anchor: 'turn-start', offsetMs: 100 },
            until: { anchor: 'turn-end', offsetMs: -100 },
          },
          {
            kind: 'focus',
            targetId: 'panel:home',
            at: { anchor: 'speech', quote: 'first turn', occurrence: 1, edge: 'start', offsetMs: 0 },
          }
        ]
      },
      {
        id: 'turn-2',
        persona: 'guide',
        dialogueAct: 'explain',
        text: 'This is the second turn.',
        transition: { pauseBeforeMs: 200 },
        cues: []
      }
    ]
  });
}

describe('solvePresentationClock solver', () => {
  it('throws on malformed inputs', () => {
    let timeline = createTestTimeline();

    // Missing options
    assert.throws(() => solvePresentationClock(timeline, null), /options must be an object/);

    // Missing turns
    assert.throws(() => solvePresentationClock(timeline, {}), /options.turns must be an array/);

    // Mismatched turns length
    assert.throws(() => solvePresentationClock(timeline, { turns: [] }), /length.*must match/);

    // Invalid turn properties
    assert.throws(
      () => solvePresentationClock(timeline, { turns: [{ durationMs: -5, words: [] }, { durationMs: 1000, words: [] }] }),
      /durationMs must be a non-negative integer/
    );

    // Invalid word properties
    assert.throws(
      () => solvePresentationClock(timeline, {
        turns: [
          { durationMs: 1000, words: [{ text: 'first', startMs: -10, endMs: 20 }] },
          { durationMs: 1000, words: [] }
        ]
      }),
      /startMs must be a non-negative integer/
    );
  });

  it('supports a source-only clock with zero authored turns and events', () => {
    let timeline = {
      contractVersion: 'presentation-timeline-v3',
      id: 'source-only',
      title: 'Source-only presentation',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'guide' } },
      grounding: { sources: [] },
      turns: [],
    };

    let result = solvePresentationClock(timeline, {
      turns: [],
      sourceEvents: [],
      sourceDurationMs: 2700,
    });

    assert.equal(result.totalDurationMs, 2700);
    assert.equal(result.sourceDurationMs, 2700);
    assert.equal(result.extensionMs, 0);
    assert.deepEqual(result.turns, []);
    assert.deepEqual(result.sourceEvents, []);
    assert.deepEqual(result.cueEvents, []);
  });

  it('rejects stale timeline hashes and duplicate source event identities', () => {
    let timeline = createTestTimeline();
    assert.throws(
      () => solvePresentationClock({ ...timeline, hash: 'presentation-timeline-v3:stale' }, {
        turns: timeline.turns.map(() => ({ durationMs: 1000, words: [] })),
      }),
      (error) => error.code === 'CLOCK_SOLVER_TIMELINE_HASH_MISMATCH',
    );
    assert.throws(
      () => solvePresentationClock(timeline, {
        turns: timeline.turns.map(() => ({ durationMs: 1000, words: [] })),
        sourceEvents: [
          { id: 'same', offsetMs: 0 },
          { id: 'same', offsetMs: 100 },
        ],
      }),
      /id must be unique/,
    );
  });

  it('solves simple timeline with no constraints or source events', () => {
    let timeline = createTestTimeline();
    let options = {
      turns: [
        {
          durationMs: 1000,
          words: [
            { text: 'This', startMs: 0, endMs: 200 },
            { text: 'is', startMs: 200, endMs: 400 },
            { text: 'the', startMs: 400, endMs: 600 },
            { text: 'first', startMs: 600, endMs: 800 },
            { text: 'turn.', startMs: 800, endMs: 1000 },
          ]
        },
        {
          durationMs: 2000,
          words: []
        }
      ],
      elasticPolicy: {
        defaultTurnGapMs: 100
      }
    };

    let result = solvePresentationClock(timeline, options);

    assert.equal(result.timelineHash, timeline.hash);
    assert.equal(result.turns.length, 2);

    // Turn 1 starts at 0, duration 1000
    assert.equal(result.turns[0].startMs, 0);
    assert.equal(result.turns[0].endMs, 1000);

    // Turn 2 transition: pauseBeforeMs is 200. So it starts at 1000 + 200 = 1200
    assert.equal(result.turns[1].startMs, 1200);
    assert.equal(result.turns[1].endMs, 3200);

    // Total duration should be 3200
    assert.equal(result.totalDurationMs, 3200);

    // Words should be shifted
    assert.deepEqual(result.turns[0].words[0], { text: 'This', startMs: 0, endMs: 200 });
    assert.deepEqual(result.turns[0].words[3], { text: 'first', startMs: 600, endMs: 800 });

    // Cues resolved correctly
    // Cue 0.0: turn-start + 100 = 100 to turn-end - 100 = 900
    assert.deepEqual(result.cueEvents[0], { cueId: '0.0', turnId: 'turn-1', startMs: 100, endMs: 900 });
    // Cue 0.1: speech anchor for "first turn" -> starts at word "first" (600) + 0 offset = 600.
    assert.deepEqual(result.cueEvents[1], { cueId: '0.1', turnId: 'turn-1', startMs: 600, endMs: 1000 });
  });

  it('respects transition overlapMs', () => {
    let timeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'overlap-timeline',
      title: 'Overlap Timeline',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'guide' } },
      grounding: { sources: [] },
      turns: [
        { id: 't1', persona: 'guide', dialogueAct: 'explain', text: 'One', cues: [] },
        { id: 't2', persona: 'guide', dialogueAct: 'explain', text: 'Two', transition: { overlapMs: 300 }, cues: [] }
      ]
    });

    let options = {
      turns: [
        { durationMs: 1000, words: [] },
        { durationMs: 1000, words: [] }
      ]
    };

    let result = solvePresentationClock(timeline, options);
    assert.equal(result.turns[0].startMs, 0);
    assert.equal(result.turns[0].endMs, 1000);
    // overlapMs is 300, so starts at 1000 - 300 = 700
    assert.equal(result.turns[1].startMs, 700);
    assert.equal(result.turns[1].endMs, 1700);
    assert.equal(result.totalDurationMs, 1700);
  });

  it('preserves source event ordering and minimum intervals', () => {
    let timeline = createTestTimeline();
    let options = {
      turns: [
        { durationMs: 500, words: [] },
        { durationMs: 500, words: [] }
      ],
      sourceEvents: [
        { id: 'click-btn', offsetMs: 200, minDwellMs: 100 },
        { id: 'type-name', offsetMs: 500, minDwellMs: 200 }
      ]
    };

    let result = solvePresentationClock(timeline, options);

    // Source event original offsets preserved/shifted appropriately
    let solvedClick = result.sourceEvents.find(e => e.id === 'click-btn');
    let solvedType = result.sourceEvents.find(e => e.id === 'type-name');

    assert.ok(solvedClick.offsetMs >= 200);
    assert.ok(solvedType.offsetMs >= 500);
    assert.ok(solvedType.offsetMs - solvedClick.offsetMs >= 300); // 500 - 200
  });

  it('stretches timeline elastically when constrained by source event dwell', () => {
    let timeline = createTestTimeline();
    let options = {
      turns: [
        { durationMs: 1000, words: [] },
        { durationMs: 1000, words: [] }
      ],
      sourceEvents: [
        { id: 'event-A', offsetMs: 100, minDwellMs: 800 },
        { id: 'event-B', offsetMs: 200, minDwellMs: 200 }
      ]
    };

    let result = solvePresentationClock(timeline, options);

    let solvedA = result.sourceEvents.find(e => e.id === 'event-A');
    let solvedB = result.sourceEvents.find(e => e.id === 'event-B');

    assert.equal(solvedA.offsetMs, 100);
    // B must be at least 800ms after A (since minDwellMs for A is 800, which exceeds original interval 100)
    assert.equal(solvedB.offsetMs, 900);
  });

  it('enforces hard constraints: not-before, min-gap, coincident', () => {
    let timeline = createTestTimeline();
    let options = {
      turns: [
        { durationMs: 1000, words: [] },
        { durationMs: 1000, words: [] }
      ],
      sourceEvents: [
        { id: 'event-A', offsetMs: 50 },
        { id: 'event-B', offsetMs: 200 }
      ],
      constraints: [
        // Event B cannot start before turn-1 ends
        { type: 'not-before', eventId: 'event-B', referenceId: 'turn-1-end' },
        // turn-2 cannot start before event-B plus 500ms
        { type: 'min-gap', eventId: 'turn-2', referenceId: 'event-B', gapMs: 500 },
        // event-A coincident with turn-1 start plus 50ms
        { type: 'coincident', eventId: 'event-A', referenceId: 'turn-1', gapMs: 50 }
      ]
    };

    let result = solvePresentationClock(timeline, options);

    let solvedA = result.sourceEvents.find(e => e.id === 'event-A');
    let solvedB = result.sourceEvents.find(e => e.id === 'event-B');

    // turn-1 starts at 0, ends at 1000.
    assert.equal(result.turns[0].startMs, 0);
    assert.equal(result.turns[0].endMs, 1000);

    // event-A coincident with turn-1 start + 50ms -> 50
    assert.equal(solvedA.offsetMs, 50);

    // event-B not-before turn-1-end -> >= 1000.
    // Also, original interval from A is 100, which is satisfied (1000 - 50 >= 100).
    assert.equal(solvedB.offsetMs, 1000);

    // turn-2 transition pauseBeforeMs is 200, so normally starts at 1200.
    // But constraint says turn-2 >= event-B + 500ms -> >= 1500.
    assert.equal(result.turns[1].startMs, 1500);
  });

  it('correctly resolves cue reference IDs in constraints', () => {
    let timeline = createTestTimeline();
    let options = {
      turns: [
        { durationMs: 1000, words: [] },
        { durationMs: 1000, words: [] }
      ],
      sourceEvents: [
        { id: 'event-A', offsetMs: 100 }
      ],
      constraints: [
        // Event A cannot start before cue 0.0 starts
        { type: 'not-before', eventId: 'event-A', referenceId: '0.0', gapMs: 200 }
      ]
    };

    let result = solvePresentationClock(timeline, options);

    let solvedA = result.sourceEvents.find(e => e.id === 'event-A');

    // Cue 0.0 is turn-start + 100ms -> starts at 100.
    // Event A not-before cue 0.0 + 200ms -> >= 300.
    assert.equal(solvedA.offsetMs, 300);
  });

  it('extends the final clock to include cues after measured speech', () => {
    let timeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'late-cue',
      title: 'Late cue',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'guide' } },
      grounding: { sources: [] },
      turns: [{
        id: 'turn-1',
        persona: 'guide',
        dialogueAct: 'explain',
        text: 'The result is visible.',
        cues: [{
          kind: 'interaction',
          targetId: 'panel:result',
          at: { anchor: 'turn-end', offsetMs: 500 },
          interaction: { type: 'click' },
        }],
      }],
    });

    let result = solvePresentationClock(timeline, {
      turns: [{ durationMs: 1000, words: [] }],
      sourceDurationMs: 400,
    });

    assert.equal(result.turns[0].endMs, 1000);
    assert.deepEqual(result.cueEvents, [{
      cueId: '0.0',
      turnId: 'turn-1',
      startMs: 1500,
      endMs: 1500,
    }]);
    assert.equal(result.totalDurationMs, 1500);
    assert.equal(result.extensionMs, 1100);
  });

  it('adds elastic dwell when a cue interval exceeds measured speech', () => {
    let timeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'cue-dwell',
      title: 'Cue dwell',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'guide' } },
      grounding: { sources: [] },
      turns: [{
        id: 'turn-1',
        persona: 'guide',
        dialogueAct: 'explain',
        text: 'Hold the focus frame.',
        cues: [{
          kind: 'focus',
          targetId: 'panel:result',
          at: { anchor: 'turn-start', offsetMs: 800 },
          until: { anchor: 'turn-end', offsetMs: -400 },
          focus: { mode: 'frame' },
        }],
      }],
    });

    let result = solvePresentationClock(timeline, {
      turns: [{ durationMs: 1000, words: [] }],
    });

    assert.equal(result.turns[0].endMs, 1200);
    assert.deepEqual(result.cueEvents, [{
      cueId: '0.0',
      turnId: 'turn-1',
      startMs: 800,
      endMs: 800,
    }]);
    assert.equal(result.totalDurationMs, 1200);
  });

  it('rejects a cue whose explicit end precedes its start on one anchor', () => {
    let timeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'backward-cue',
      title: 'Backward cue',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'guide' } },
      grounding: { sources: [] },
      turns: [{
        id: 'turn-1',
        persona: 'guide',
        dialogueAct: 'explain',
        text: 'This interval is invalid.',
        cues: [{
          kind: 'focus',
          targetId: 'panel:result',
          at: { anchor: 'turn-start', offsetMs: 500 },
          until: { anchor: 'turn-start', offsetMs: 100 },
          focus: { mode: 'frame' },
        }],
      }],
    });

    assert.throws(
      () => solvePresentationClock(timeline, {
        turns: [{ durationMs: 1000, words: [] }],
      }),
      (error) => error.code === 'CLOCK_SOLVER_UNSATISFIABLE',
    );
  });

  it('rejects unsatisfiable cyclic constraints', () => {
    let timeline = createTestTimeline();
    let options = {
      turns: [
        { durationMs: 1000, words: [] },
        { durationMs: 1000, words: [] }
      ],
      sourceEvents: [
        { id: 'event-A', offsetMs: 100 },
        { id: 'event-B', offsetMs: 200 }
      ],
      constraints: [
        { type: 'not-before', eventId: 'event-A', referenceId: 'event-B', gapMs: 100 },
        { type: 'not-before', eventId: 'event-B', referenceId: 'event-A', gapMs: 100 }
      ]
    };

    assert.throws(
      () => solvePresentationClock(timeline, options),
      (err) => err.code === 'CLOCK_SOLVER_UNSATISFIABLE'
    );
  });

  it('produces deterministic output and integrity hash', () => {
    let timeline = createTestTimeline();
    let options = {
      turns: [
        {
          durationMs: 1000,
          words: [
            { text: 'This', startMs: 0, endMs: 200 },
            { text: 'is', startMs: 200, endMs: 400 },
            { text: 'the', startMs: 400, endMs: 600 },
            { text: 'first', startMs: 600, endMs: 800 },
            { text: 'turn.', startMs: 800, endMs: 1000 },
          ]
        },
        { durationMs: 1000, words: [] }
      ],
      sourceEvents: [
        { id: 'event-A', offsetMs: 100 }
      ]
    };

    let result1 = solvePresentationClock(timeline, options);
    let result2 = solvePresentationClock(timeline, options);

    assert.deepEqual(result1, result2);
    assert.ok(result1.hash.startsWith('presentation-clock-projection-v1:'));
  });

  describe('presenter action schedule generation and validation', () => {
    it('throws PresenterDuplicateActionError on overlapping exact/semantic duplicates', () => {
      let timeline = createPresentationTimelineContract({
        contractVersion: 'presentation-timeline-v3',
        id: 'schedule-timeline-dup',
        title: 'Schedule Timeline Dup',
        locale: 'en-US',
        profile: 'brief',
        personas: {
          guide: { name: 'Guide', role: 'lesson guide' },
        },
        grounding: { sources: [] },
        turns: [
          {
            id: 'turn-1',
            persona: 'guide',
            dialogueAct: 'explain',
            text: 'Click here and see.',
            cues: [
              {
                kind: 'focus',
                targetId: 'button-ok',
                at: { anchor: 'turn-start', offsetMs: 100 },
                focus: { mode: 'cursor' },
              },
              {
                kind: 'focus',
                targetId: 'button-ok',
                at: { anchor: 'turn-start', offsetMs: 500 },
                focus: { mode: 'cursor' },
              },
            ],
          },
        ],
      });

      let alignedSequence = createPresentationAlignedSequence(timeline, {
        media: { hash: 'audio-1', durationMs: 3000, locale: 'en-US' },
        turns: [
          {
            startMs: 0,
            endMs: 3000,
            speaker: 'guide',
            transcript: 'Click here and see.',
            words: [],
          },
        ],
      });

      assert.throws(
        () => createPresenterActionSchedule(timeline, alignedSequence),
        (err) => {
          assert.equal(err.name, 'PresenterDuplicateActionError');
          assert.equal(err.code, 'PRESENTER_DUPLICATE_ACTION');
          assert.ok(err.diagnosticInfo.duplicateKey1);
          assert.ok(err.diagnosticInfo.duplicateKey2);
          return true;
        },
      );

      let exactTimeline = createPresentationTimelineContract({
        ...timeline,
        id: 'schedule-timeline-exact-dup',
        turns: [{
          ...timeline.turns[0],
          cues: timeline.turns[0].cues.map((cue) => ({
            ...cue,
            at: { anchor: 'turn-start', offsetMs: 100 },
          })),
        }],
      });
      let exactAlignedSequence = createPresentationAlignedSequence(exactTimeline, {
        media: { hash: 'audio-exact', durationMs: 3000, locale: 'en-US' },
        turns: [{
          startMs: 0,
          endMs: 3000,
          speaker: 'guide',
          transcript: 'Click here and see.',
          words: [],
        }],
      });
      assert.throws(
        () => createPresenterActionSchedule(exactTimeline, exactAlignedSequence),
        /Exact authored duplicates/,
      );
    });

    it('creates schedule for non-overlapping same-kind cues and legal later repeats', () => {
      let timeline = createPresentationTimelineContract({
        contractVersion: 'presentation-timeline-v3',
        id: 'schedule-timeline-legal',
        title: 'Schedule Timeline Legal',
        locale: 'en-US',
        profile: 'brief',
        personas: {
          guide: { name: 'Guide', role: 'lesson guide' },
        },
        grounding: { sources: [] },
        turns: [
          {
            id: 'turn-1',
            persona: 'guide',
            dialogueAct: 'explain',
            text: 'Click here then there.',
            cues: [
              {
                kind: 'focus',
                targetId: 'button-ok',
                at: { anchor: 'turn-start', offsetMs: 100 },
                until: { anchor: 'turn-start', offsetMs: 1100 },
                focus: { mode: 'cursor' },
              },
              {
                kind: 'focus',
                targetId: 'button-ok',
                at: { anchor: 'turn-start', offsetMs: 1200 },
                until: { anchor: 'turn-start', offsetMs: 2200 },
                focus: { mode: 'cursor' },
              },
            ],
          },
        ],
      });

      let alignedSequence = createPresentationAlignedSequence(timeline, {
        media: { hash: 'audio-2', durationMs: 3000, locale: 'en-US' },
        turns: [
          {
            startMs: 0,
            endMs: 3000,
            speaker: 'guide',
            transcript: 'Click here then there.',
            words: [],
          },
        ],
      });

      let schedule = createPresenterActionSchedule(timeline, alignedSequence, { boundedGapMs: 100 });
      assert.equal(schedule.timelineHash, timeline.hash);
      assert.equal(schedule.events.length, 2);
      assert.equal(schedule.events[0].startMs, 100);
      assert.equal(schedule.events[0].endMs, 1100);
      assert.equal(schedule.events[1].startMs, 1200);
      assert.equal(schedule.events[1].endMs, 2200);

      let validated = validatePresenterActionSchedule(schedule, timeline, alignedSequence);
      assert.deepEqual(validated, schedule);
    });

    it('serializes mixed kinds with a gap, point duration, and duration extension', () => {
      let timeline = createPresentationTimelineContract({
        contractVersion: 'presentation-timeline-v3',
        id: 'schedule-timeline-mixed',
        title: 'Schedule Timeline Mixed',
        locale: 'en-US',
        profile: 'brief',
        personas: {
          guide: { name: 'Guide', role: 'lesson guide' },
        },
        grounding: { sources: [] },
        turns: [
          {
            id: 'turn-1',
            persona: 'guide',
            dialogueAct: 'explain',
            text: 'First click, then highlight.',
            cues: [
              {
                kind: 'interaction',
                targetId: 'button-ok',
                at: { anchor: 'turn-start', offsetMs: 100 },
                interaction: { type: 'click', reversible: true },
              },
              {
                kind: 'annotation',
                targetId: 'panel-info',
                at: { anchor: 'turn-start', offsetMs: 200 },
                until: { anchor: 'turn-start', offsetMs: 400 },
                annotation: { intent: 'emphasize', marker: 'box' },
              },
            ],
          },
        ],
      });

      let alignedSequence = createPresentationAlignedSequence(timeline, {
        media: { hash: 'audio-3', durationMs: 500, locale: 'en-US' },
        turns: [
          {
            startMs: 0,
            endMs: 500,
            speaker: 'guide',
            transcript: 'First click, then highlight.',
            words: [],
          },
        ],
      });

      let schedule = createPresenterActionSchedule(timeline, alignedSequence, { boundedGapMs: 100 });
      assert.equal(schedule.events.length, 2);

      let interaction = schedule.events[0];
      let annotation = schedule.events[1];

      assert.equal(schedule.pointDurationMs, 1000);
      assert.equal(interaction.startMs, 100);
      assert.equal(interaction.endMs, 1100);
      assert.deepEqual(interaction.duplicateKey.span, [100, 1100]);

      assert.equal(annotation.startMs, 1200);
      assert.equal(annotation.endMs, 2200);
      assert.deepEqual(annotation.duplicateKey.span, [1200, 2200]);

      assert.equal(schedule.totalDurationMs, 2200);
      assert.equal(schedule.extensionMs, 1700);

      let validated = validatePresenterActionSchedule(schedule, timeline, alignedSequence);
      assert.deepEqual(validated, schedule);

      let configured = createPresenterActionSchedule(timeline, alignedSequence, {
        gapMs: 100,
        pointDurationMs: 1200,
      });
      assert.equal(configured.pointDurationMs, 1200);
      assert.equal(configured.events[0].endMs - configured.events[0].startMs, 1200);
      assert.deepEqual(
        validatePresenterActionSchedule(configured, timeline, alignedSequence),
        configured,
      );
    });
  });
});
