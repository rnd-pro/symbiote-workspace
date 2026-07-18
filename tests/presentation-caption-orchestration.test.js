import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeIntegrity } from '../schema/canonical-json.js';
import {
  PRESENTATION_CAPTION_COMPOSITION_SCHEMA_VERSION,
  PRESENTATION_CAPTION_TIMING_TOLERANCE_MS,
  bindCaptionCuesToAlignedSequence,
  createPresentationCompositionPlan,
  normalizePresentationOutputSpec,
  planCaptionPlacements,
} from '../runtime/presentation-output.js';
import {
  createPresentationAlignedSequence,
  createPresentationTimelineContract,
  createPresenterActionSchedule,
  PRESENTER_ACTION_SCHEDULE_VERSION,
} from '../runtime/presentation.js';

function fixture() {
  let timeline = createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'caption-test',
    title: 'Caption planning test',
    locale: 'en-US',
    profile: 'dialogue',
    personas: { guide: { name: 'Guide', role: 'lesson guide' } },
    grounding: { sources: [] },
    turns: [{
      id: 'turn-1',
      persona: 'guide',
      dialogueAct: 'explain',
      text: 'This exact timed sentence tests attention-aware caption placement.',
      sourceRefs: [],
      claims: [],
      cues: [
        {
          kind: 'focus',
          targetId: 'panel:home:queue-node',
          at: { anchor: 'turn-start' },
          until: { anchor: 'turn-end' },
          focus: { mode: 'cursor' },
        },
        {
          kind: 'interaction',
          targetId: 'panel:home:queue-node',
          at: { anchor: 'turn-start', offsetMs: 500 },
          interaction: { type: 'click', reversible: true },
        },
        {
          kind: 'annotation',
          targetId: 'panel:home:queue-node',
          at: { anchor: 'turn-start', offsetMs: 1000 },
          annotation: { intent: 'emphasize', marker: 'box' },
        },
      ],
    }],
  });
  let output = normalizePresentationOutputSpec({
    width: 1920,
    height: 1080,
    fps: 30,
    dpr: 1,
    captions: { enabled: true, mode: 'karaoke', placement: 'bottom' },
  });
  let alignedSequence = createPresentationAlignedSequence(timeline, {
    media: { hash: 'audio:test', durationMs: 3000, locale: 'en-US' },
    turns: [{
      startMs: 0,
      endMs: 3000,
      speaker: timeline.turns[0].persona,
      transcript: timeline.turns[0].text,
      words: [],
    }],
  });
  let compositionPlan = createPresentationCompositionPlan({
    output,
    structuralHash: 'snapshot:stable',
    sourceCompositionHash: 'composition:source',
    targetCompositionHash: 'composition:target',
    timelineHash: timeline.hash,
    lessonIntentHash: 'lesson:stable',
    measuredViewport: { width: 1920, height: 1080, visualWidth: 1920, visualHeight: 1080, dpr: 1 },
    baselineStructuralHash: 'snapshot:stable',
    restoredStructuralHash: 'snapshot:stable',
    simulationFrozen: true,
    steps: [
      {
        id: 'step-1',
        turnId: 'turn-1',
        targetId: 'panel:home:queue-node',
        cueId: '0.0',
        cueKind: 'focus',
        cueIndex: 0,
        measurement: {
          targetRect: { x: 54, y: 880, width: 1812, height: 146 },
          focusRect: { x: 54, y: 880, width: 1812, height: 146 },
          visibleRect: { x: 54, y: 880, width: 1812, height: 146 },
          criticalAttentionRect: { x: 900, y: 900, width: 120, height: 80 },
          visibleRatio: 1,
          visible: true,
          reachable: true,
          occluders: [],
          pointerTransparentOccluders: [],
        },
      },
      {
        id: 'step-2',
        turnId: 'turn-1',
        targetId: 'panel:home:queue-node',
        cueId: '0.1',
        cueKind: 'interaction',
        cueIndex: 1,
        measurement: {
          targetRect: { x: 54, y: 880, width: 1812, height: 146 },
          focusRect: { x: 54, y: 880, width: 1812, height: 146 },
          visibleRect: { x: 54, y: 880, width: 1812, height: 146 },
          criticalAttentionRect: { x: 900, y: 900, width: 120, height: 80 },
          visibleRatio: 1,
          visible: true,
          reachable: true,
          occluders: [],
          pointerTransparentOccluders: [],
        },
      },
      {
        id: 'step-3',
        turnId: 'turn-1',
        targetId: 'panel:home:queue-node',
        cueId: '0.2',
        cueKind: 'annotation',
        cueIndex: 2,
        measurement: {
          targetRect: { x: 54, y: 880, width: 1812, height: 146 },
          focusRect: { x: 54, y: 880, width: 1812, height: 146 },
          visibleRect: { x: 54, y: 880, width: 1812, height: 146 },
          visibleRatio: 1,
          visible: true,
          reachable: true,
          occluders: [],
          pointerTransparentOccluders: [],
        },
        annotation: {
          placement: 'above',
          rect: { x: 200, y: 800, width: 800, height: 60 },
        },
      },
    ],
  });
  let cues = [{
    cueId: 'caption-1',
    index: 0,
    speaker: 'guide',
    text: 'This exact timed sentence tests attention-aware caption placement.',
    startSec: 0,
    endSec: 3,
    wordTimings: [],
  }];
  let actionSchedule = createPresenterActionSchedule(timeline, alignedSequence);
  return {
    alignedSequence,
    compositionPlan,
    cues,
    output,
    timeline,
    actionSchedule,
    sourceCompositionHash: compositionPlan.sourceCompositionHash,
    targetCompositionHash: compositionPlan.targetCompositionHash,
  };
}

describe('planCaptionPlacements orchestration', () => {
  it('uses the engine track for one deterministic live and offline placement contract', () => {
    let input = fixture();
    let turns = [
      {
        ...input.timeline.turns[0],
        cues: [
          {
            ...input.timeline.turns[0].cues[0],
            until: { anchor: 'turn-start', offsetMs: 2000 },
          },
          input.timeline.turns[0].cues[1],
          {
            ...input.timeline.turns[0].cues[2],
            until: { anchor: 'turn-start', offsetMs: 3000 },
          },
        ],
      },
    ];
    input.timeline = createPresentationTimelineContract({
      ...input.timeline,
      turns,
    });
    input.alignedSequence = createPresentationAlignedSequence(input.timeline, {
      media: { hash: 'audio:test', durationMs: 6000, locale: 'en-US' },
      turns: [{
        startMs: 0,
        endMs: 6000,
        speaker: input.timeline.turns[0].persona,
        transcript: input.timeline.turns[0].text,
        words: [],
      }],
    });
    input.actionSchedule = createPresenterActionSchedule(input.timeline, input.alignedSequence);
    input.compositionPlan = createPresentationCompositionPlan({
      ...input.compositionPlan,
      timelineHash: input.timeline.hash,
    });
    input.cues[0].endSec = 6;
    let composition = planCaptionPlacements(input);
    let cue = composition.track.cues[0];

    assert.equal(composition.schemaVersion, PRESENTATION_CAPTION_COMPOSITION_SCHEMA_VERSION);
    assert.equal(composition.outputSpecHash, input.output.hash);
    assert.equal(composition.track.schemaVersion, 'caption-presentation-track-v2');
    assert.equal(cue.placement.zone, 'top');
    assert.ok(cue.decisionEvidence.activeAvoidRegionIds.includes('focus:0.0'));
    assert.ok(cue.decisionEvidence.activeAvoidRegionIds.includes('annotation:0.2'));
    let projection = { ...composition };
    delete projection.hash;
    assert.equal(composition.hash, `${PRESENTATION_CAPTION_COMPOSITION_SCHEMA_VERSION}:${computeIntegrity(projection)}`);
  });

  it('fails closed when every preferred caption zone intersects attention', () => {
    let input = fixture();
    input.reservedRegions = [{
      id: 'reserved-full-frame',
      kind: 'reserved-ui',
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      startSec: 0,
      endSec: 3,
    }];
    assert.throws(() => planCaptionPlacements(input), /No readable placement zone available/);
  });

  it('binds segmented caption display timing to the complete authored turn span', () => {
    let input = fixture();
    let segmented = [
      {
        cueId: 'caption-1a',
        cueIndex: 0,
        speaker: 'guide',
        text: 'This exact timed sentence',
        startSec: 0.2,
        endSec: 1.1,
      },
      {
        cueId: 'caption-1b',
        cueIndex: 0,
        speaker: 'guide',
        text: 'tests attention-aware caption placement.',
        startSec: 1.8,
        endSec: 2.5,
      },
    ];
    assert.throws(
      () => planCaptionPlacements({ ...input, cues: segmented }),
      /do not cover the authored timing|timing gap/,
    );

    input.cues = bindCaptionCuesToAlignedSequence(segmented, input.alignedSequence);
    assert.equal(input.cues[0].startSec, 0);
    assert.equal(input.cues[0].endSec, input.cues[1].startSec);
    assert.equal(input.cues[1].endSec, 3);
    assert.equal(planCaptionPlacements(input).track.cues.length, 2);
  });

  it('applies the published 50ms timing tolerance without floating-point boundary drift', () => {
    assert.equal(PRESENTATION_CAPTION_TIMING_TOLERANCE_MS, 50);
    let split = (deltaMs) => {
      let input = fixture();
      input.cues = [
        {
          cueId: 'caption-1a',
          cueIndex: 0,
          speaker: 'guide',
          text: 'This exact timed sentence',
          startSec: 0,
          endSec: 1.5,
        },
        {
          cueId: 'caption-1b',
          cueIndex: 0,
          speaker: 'guide',
          text: 'tests attention-aware caption placement.',
          startSec: 1.5 + deltaMs / 1000,
          endSec: 3,
        },
      ];
      return input;
    };
    assert.doesNotThrow(() => planCaptionPlacements(split(49)));
    assert.doesNotThrow(() => planCaptionPlacements(split(50)));
    assert.throws(() => planCaptionPlacements(split(51)), /timing gap or overlap/);
    assert.doesNotThrow(() => planCaptionPlacements(split(-50)));
    assert.throws(() => planCaptionPlacements(split(-51)), /timing gap or overlap/);
  });

  it('rejects stale aligned and composition evidence instead of estimating timing', () => {
    let staleAlignment = fixture();
    staleAlignment.alignedSequence.hash = 'stale';
    assert.throws(() => planCaptionPlacements(staleAlignment), /aligned sequence hash is stale/);

    let stalePlan = fixture();
    stalePlan.compositionPlan.hash = 'stale';
    assert.throws(() => planCaptionPlacements(stalePlan), /composition plan hash is stale/);

    let wrongTimeline = fixture();
    wrongTimeline.compositionPlan = createPresentationCompositionPlan({
      ...wrongTimeline.compositionPlan,
      timelineHash: 'presentation-timeline-v3:stale',
    });
    assert.throws(
      () => planCaptionPlacements(wrongTimeline),
      /targets a stale authored timeline/,
    );

    let missingLayoutEvidence = fixture();
    delete missingLayoutEvidence.sourceCompositionHash;
    assert.throws(
      () => planCaptionPlacements(missingLayoutEvidence),
      /requires external source and target composition identities/,
    );

    let forgedLayoutEvidence = fixture();
    forgedLayoutEvidence.compositionPlan = createPresentationCompositionPlan({
      ...forgedLayoutEvidence.compositionPlan,
      sourceCompositionHash: 'composition:forged-source',
      targetCompositionHash: 'composition:forged-target',
    });
    assert.throws(
      () => planCaptionPlacements(forgedLayoutEvidence),
      /targets stale source or target layout evidence/,
    );
  });

  it('rejects output drift and missing attention measurements', () => {
    let wrongOutput = fixture();
    wrongOutput.output = normalizePresentationOutputSpec({
      width: 1080,
      height: 1920,
      fps: 30,
      captions: { enabled: true },
    });
    assert.throws(
      () => planCaptionPlacements(wrongOutput),
      /output does not match the composition plan/,
    );

    let noMeasurements = fixture();
    noMeasurements.compositionPlan = createPresentationCompositionPlan({
      ...noMeasurements.compositionPlan,
      steps: [],
    });
    assert.throws(
      () => planCaptionPlacements(noMeasurements),
      /caption composition rejected layout evidence: composition-step-missing/,
    );
  });

  it('rejects every audited layout defect before signing caption composition', () => {
    let cases = [
      ['target-hidden', (step) => ({ ...step.measurement, visible: false })],
      ['target-unreachable', (step) => ({ ...step.measurement, reachable: false })],
      ['target-clipped', (step) => ({ ...step.measurement, focusRect: { x: 0, y: 0, width: 10, height: 10 } })],
      ['target-occluded', (step) => ({ ...step.measurement, occluders: ['blocking-overlay'] })],
      ['target-unreadable', (step) => ({ ...step.measurement, hasText: true, fontSizePx: 8 })],
    ];
    for (let [issueCode, mutateMeasurement] of cases) {
      let input = fixture();
      let step0 = input.compositionPlan.steps[0];
      input.compositionPlan = createPresentationCompositionPlan({
        ...input.compositionPlan,
        steps: [
          { ...step0, measurement: mutateMeasurement(step0) },
          input.compositionPlan.steps[1],
          input.compositionPlan.steps[2],
        ],
      });
      assert.throws(
        () => planCaptionPlacements(input),
        (error) => error.code === 'PRESENTATION_COMPOSITION_REJECTED'
          && error.review.issueCodes.includes(issueCode),
        issueCode,
      );
    }

    for (let [issueCode, planOverride] of [
      ['composition-restore-mismatch', { restoredStructuralHash: 'stale' }],
      ['composition-simulation-active', { simulationFrozen: false }],
      ['output-viewport-mismatch', {
        measuredViewport: { width: 1080, height: 1920, visualWidth: 1080, visualHeight: 1920, dpr: 1 },
      }],
    ]) {
      let input = fixture();
      input.compositionPlan = createPresentationCompositionPlan({
        ...input.compositionPlan,
        ...planOverride,
      });
      assert.throws(
        () => planCaptionPlacements(input),
        (error) => error.code === 'PRESENTATION_COMPOSITION_REJECTED'
          && error.review.issueCodes.includes(issueCode),
        issueCode,
      );
    }

    for (let [issueCode, mutateStep, stepIndex] of [
      ['composition-scroll-failed', (step) => ({
        ...step,
        scroll: [{ id: 'failed-scroll', before: { left: 0, top: 0 }, after: { left: 0, top: 120 }, changed: true, applied: false }],
      }), 0],
      ['annotation-placement-unavailable', (step) => ({ ...step, annotation: null }), 2],
    ]) {
      let input = fixture();
      let steps = [...input.compositionPlan.steps];
      steps[stepIndex] = mutateStep(steps[stepIndex]);
      input.compositionPlan = createPresentationCompositionPlan({
        ...input.compositionPlan,
        steps,
      });
      assert.throws(
        () => planCaptionPlacements(input),
        (error) => error.code === 'PRESENTATION_COMPOSITION_REJECTED'
          && error.review.issueCodes.includes(issueCode),
        issueCode,
      );
    }
  });

  it('rejects captions that are not authored by the current aligned timeline', () => {
    let unrelated = fixture();
    unrelated.cues[0].text = 'Unrelated narration from another lesson.';
    assert.throws(
      () => planCaptionPlacements(unrelated),
      /do not reproduce authored turn 0/,
    );

    let outsideSpan = fixture();
    outsideSpan.cues[0].startSec = 30;
    outsideSpan.cues[0].endSec = 31;
    assert.throws(
      () => planCaptionPlacements(outsideSpan),
      /falls outside authored turn 0/,
    );

    let partialSpan = fixture();
    partialSpan.cues[0].startSec = 1;
    partialSpan.cues[0].endSec = 2;
    assert.throws(
      () => planCaptionPlacements(partialSpan),
      /do not cover the authored timing of turn 0/,
    );

    let missingSpeaker = fixture();
    missingSpeaker.cues[0].speaker = '';
    assert.throws(
      () => planCaptionPlacements(missingSpeaker),
      /has no speaker identity/,
    );
  });

  it('allows one explicit narrator voice while preserving authored turn binding', () => {
    let input = fixture();
    input.output = normalizePresentationOutputSpec({
      width: 1920,
      height: 1080,
      fps: 30,
      speakerMode: 'single',
      speakerId: 'guide',
      captions: { enabled: true, mode: 'karaoke' },
    });
    input.compositionPlan = createPresentationCompositionPlan({
      ...input.compositionPlan,
      output: input.output,
    });
    input.sourceCompositionHash = input.compositionPlan.sourceCompositionHash;
    input.targetCompositionHash = input.compositionPlan.targetCompositionHash;
    input.alignedSequence = createPresentationAlignedSequence(input.timeline, {
      media: { hash: 'audio:single', durationMs: 3000, locale: 'en-US' },
      voice: { mode: 'single', speakerId: 'guide' },
      turns: [{
        startMs: 0,
        endMs: 3000,
        speaker: 'guide',
        transcript: input.timeline.turns[0].text,
        words: [],
      }],
    });
    input.actionSchedule = createPresenterActionSchedule(input.timeline, input.alignedSequence);
    input.cues[0].speaker = 'guide';

    assert.equal(planCaptionPlacements(input).output.voice.mode, 'single');
    input.cues[0].speaker = 'narrator';
    assert.throws(
      () => planCaptionPlacements(input),
      /does not match the declared single speaker/,
    );
    input.cues[0].speaker = 'guide';

    let secondText = 'The same narrator continues with the verified timeline.';
    input.timeline.turns[0].cues = input.timeline.turns[0].cues.slice(0, 1);
    input.timeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'single-narrator-test',
      title: 'Single narrator consistency',
      locale: 'en-US',
      profile: 'single',
      personas: { guide: { name: 'Guide', role: 'lesson guide' } },
      grounding: { sources: [] },
      turns: [
        input.timeline.turns[0],
        {
          ...input.timeline.turns[0],
          id: 'turn-2',
          text: secondText,
          cues: [{
            kind: 'focus',
            targetId: 'panel:home:timeline-node',
            at: { anchor: 'turn-start' },
            until: { anchor: 'turn-end' },
            focus: { mode: 'cursor' },
          }],
        },
      ],
    });
    input.alignedSequence = createPresentationAlignedSequence(input.timeline, {
      media: { hash: 'audio:single', durationMs: 6000, locale: 'en-US' },
      voice: { mode: 'single', speakerId: 'guide' },
      turns: [
        { startMs: 0, endMs: 3000, speaker: 'guide', transcript: input.timeline.turns[0].text, words: [] },
        { startMs: 3000, endMs: 6000, speaker: 'guide', transcript: input.timeline.turns[1].text, words: [] },
      ],
    });
    input.actionSchedule = createPresenterActionSchedule(input.timeline, input.alignedSequence);
    input.compositionPlan = createPresentationCompositionPlan({
      ...input.compositionPlan,
      output: input.output,
      timelineHash: input.timeline.hash,
      steps: [
        {
          ...input.compositionPlan.steps[0],
          cueId: '0.0',
          cueKind: 'focus',
          cueIndex: 0,
        },
        {
          ...input.compositionPlan.steps[0],
          id: 'step-2',
          turnId: 'turn-2',
          targetId: 'panel:home:timeline-node',
          cueId: '1.0',
          cueKind: 'focus',
          cueIndex: 0,
        },
      ],
    });
    input.cues = [
      { ...input.cues[0], cueIndex: 0, startSec: 0, endSec: 3, speaker: 'guide' },
      { cueId: 'caption-2', cueIndex: 1, speaker: 'intruder', text: secondText, startSec: 3, endSec: 6, wordTimings: [] },
    ];

    assert.throws(
      () => planCaptionPlacements(input),
      /does not match the declared single speaker/,
    );

    input.cues[1].speaker = '';
    assert.throws(
      () => planCaptionPlacements(input),
      /has no speaker identity/,
    );
  });

  it('allows narration and captions to overlap the serialized presenter action channel', () => {
    let input = fixture();
    let schedule = createPresenterActionSchedule(input.timeline, input.alignedSequence, {
      boundedGapMs: 100,
    });

    let narrationCue = input.cues[0];
    let narrationStartMs = narrationCue.startSec * 1000;
    let narrationEndMs = narrationCue.endSec * 1000;

    assert.equal(narrationStartMs, 0);
    assert.equal(narrationEndMs, 3000);

    let focusEvent = schedule.events.find((event) => event.kind === 'focus');
    let interactionEvent = schedule.events.find((event) => event.kind === 'interaction');

    assert.ok(focusEvent.endMs <= interactionEvent.startMs - 100);

    let overlapFocus = Math.max(narrationStartMs, focusEvent.startMs)
      < Math.min(narrationEndMs, focusEvent.endMs);
    assert.ok(overlapFocus, 'Narration/captions overlap the focus presenter action');
  });

  it('emits exactly one region per cue (zero cloned regions)', () => {
    let input = fixture();
    let turns = [
      {
        ...input.timeline.turns[0],
        cues: [
          {
            ...input.timeline.turns[0].cues[0],
            until: { anchor: 'turn-start', offsetMs: 2000 },
          },
          input.timeline.turns[0].cues[1],
          {
            ...input.timeline.turns[0].cues[2],
            until: { anchor: 'turn-start', offsetMs: 3000 },
          },
        ],
      },
    ];
    input.timeline = createPresentationTimelineContract({
      ...input.timeline,
      turns,
    });
    input.alignedSequence = createPresentationAlignedSequence(input.timeline, {
      media: { hash: 'audio:test', durationMs: 6000, locale: 'en-US' },
      turns: [{
        startMs: 0,
        endMs: 6000,
        speaker: input.timeline.turns[0].persona,
        transcript: input.timeline.turns[0].text,
        words: [],
      }],
    });
    input.actionSchedule = createPresenterActionSchedule(input.timeline, input.alignedSequence);
    input.compositionPlan = createPresentationCompositionPlan({
      ...input.compositionPlan,
      timelineHash: input.timeline.hash,
    });
    input.cues[0].endSec = 6;
    let composition = planCaptionPlacements(input);

    for (let cue of composition.track.cues) {
      let regionIds = cue.decisionEvidence.activeAvoidRegionIds;
      let uniqueIds = new Set(regionIds);
      assert.equal(regionIds.length, uniqueIds.size, 'No duplicate region IDs should exist');

      assert.ok(regionIds.includes('focus:0.0'), 'Should contain focus region');
      assert.ok(regionIds.includes('interaction:0.1'), 'Should contain interaction region');
      assert.ok(regionIds.includes('annotation:0.2'), 'Should contain annotation region');

      assert.ok(
        !regionIds.includes('annotation:0.0'),
        'Should not clone annotation region on focus step',
      );
      assert.ok(
        !regionIds.includes('focus:0.2'),
        'Should not clone focus region on annotation step',
      );
    }
  });

  function buildVerticalFixture(outputOverrides = {}) {
    let timeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'tiktok-safe-inset-test',
      title: 'TikTok caption safe inset regression test',
      locale: 'en-US',
      profile: 'dialogue',
      personas: { guide: { name: 'Guide', role: 'lesson guide' } },
      grounding: { sources: [] },
      turns: [{
        id: 'turn-1',
        persona: 'guide',
        dialogueAct: 'explain',
        text: 'This is a caption in TikTok style with margins and safe area.',
        sourceRefs: [],
        claims: [],
        cues: [
          {
            kind: 'focus',
            targetId: 'panel:home:queue-node',
            at: { anchor: 'turn-start' },
            until: { anchor: 'turn-end' },
            focus: { mode: 'cursor' },
          },
        ],
      }],
    });
    let output = normalizePresentationOutputSpec({
      width: 1080,
      height: 1920,
      fps: 30,
      dpr: 1,
      safeArea: { top: 54, right: 54, bottom: 54, left: 54 },
      captions: {
        enabled: true,
        stylePreset: 'tiktok',
      },
      ...outputOverrides,
    });
    let alignedSequence = createPresentationAlignedSequence(timeline, {
      media: { hash: 'audio:test', durationMs: 3000, locale: 'en-US' },
      turns: [{
        startMs: 0,
        endMs: 3000,
        speaker: timeline.turns[0].persona,
        transcript: timeline.turns[0].text,
        words: [],
      }],
    });

    let compositionPlan = createPresentationCompositionPlan({
      output,
      structuralHash: 'snapshot:stable',
      sourceCompositionHash: 'composition:source',
      targetCompositionHash: 'composition:target',
      timelineHash: timeline.hash,
      lessonIntentHash: 'lesson:stable',
      measuredViewport: {
        width: output.presentationViewport.width,
        height: output.presentationViewport.height,
        visualWidth: output.presentationViewport.width,
        visualHeight: output.presentationViewport.height,
        dpr: 1,
      },
      baselineStructuralHash: 'snapshot:stable',
      restoredStructuralHash: 'snapshot:stable',
      simulationFrozen: true,
      steps: [
        {
          id: 'step-1',
          turnId: 'turn-1',
          targetId: 'panel:home:queue-node',
          cueId: '0.0',
          cueKind: 'focus',
          cueIndex: 0,
          measurement: {
            targetRect: { x: 100, y: 700, width: 880, height: 200 },
            focusRect: { x: 100, y: 700, width: 880, height: 200 },
            visibleRect: { x: 100, y: 700, width: 880, height: 200 },
            criticalAttentionRect: { x: 480, y: 800, width: 120, height: 80 },
            visibleRatio: 1,
            visible: true,
            reachable: true,
            occluders: [],
            pointerTransparentOccluders: [],
          },
        },
      ],
    });
    let cues = [{
      cueId: 'caption-1',
      index: 0,
      speaker: 'guide',
      text: 'This is a caption in TikTok style with margins and safe area.',
      startSec: 0,
      endSec: 3,
      wordTimings: [],
    }];
    let actionSchedule = createPresenterActionSchedule(timeline, alignedSequence);
    let avoidRegions = [
      {
        id: 'persistent-top-chrome',
        kind: 'chrome',
        x: 0,
        y: 0,
        width: 1080,
        height: 100,
        startSec: 0,
        endSec: 3,
      },
      {
        id: 'persistent-chat-composer',
        kind: 'composer',
        x: 540,
        y: 1770,
        width: 540,
        height: 150,
        startSec: 0,
        endSec: 3,
      },
    ];

    return {
      timeline,
      output,
      alignedSequence,
      compositionPlan,
      cues,
      actionSchedule,
      sourceCompositionHash: 'composition:source',
      targetCompositionHash: 'composition:target',
      avoidRegions,
    };
  }

  it('respects both frame safe area and profile margins for TikTok vertical format to prevent chat composer collision', () => {
    let input = buildVerticalFixture();
    let composition = planCaptionPlacements(input);

    let track = composition.track;
    assert.ok(track, 'Caption placement track should be generated');
    assert.equal(track.hardCollisionCount, 0, 'No hard collisions with avoid regions');
    assert.equal(track.safeBoundsViolationCount, 0, 'No safe bounds violations');

    let firstCue = track.cues[0];
    assert.equal(firstCue.placement.zone, 'bottom', 'Caption should remain in the preferred bottom zone');
    let rect = firstCue.measuredRect;
    assert.equal(rect.y + rect.height, 1632, 'Caption bottom should be exactly at the bottom margin limit (1920 - 288 = 1632)');
    assert.ok(rect.x >= 86, `x (${rect.x}) must be >= 86 (left margin)`);
    assert.ok(rect.x + rect.width <= 994, `x + width (${rect.x + rect.width}) must be <= 994 (right margin)`);

    assert.ok(firstCue.decisionEvidence.activeAvoidRegionIds.includes('focus:0.0'), 'Focus region should be considered active');
    let focusRegion = track.avoidRegions.find((region) => region.id === 'focus:0.0');
    assert.deepEqual(
      { width: focusRegion.width, height: focusRegion.height },
      { width: 120, height: 80 },
    );
    let overlapsFocus = rect.x < focusRegion.x + focusRegion.width
      && rect.x + rect.width > focusRegion.x
      && rect.y < focusRegion.y + focusRegion.height
      && rect.y + rect.height > focusRegion.y;
    assert.equal(overlapsFocus, false, 'Caption must not intersect the compact focus avoid region');
  });

  it('respects stricter absolute output-edge inset when frameInsets plus safe-area bottom exceeds profile margin', () => {
    let input = buildVerticalFixture({
      frameInsets: { top: 0, right: 0, bottom: 300, left: 0 },
    });
    let composition = planCaptionPlacements(input);

    let track = composition.track;
    assert.ok(track, 'Caption placement track should be generated');
    assert.equal(track.hardCollisionCount, 0, 'No hard collisions with avoid regions');
    assert.equal(track.safeBoundsViolationCount, 0, 'No safe bounds violations');

    let firstCue = track.cues[0];
    assert.equal(firstCue.placement.zone, 'bottom', 'Caption should still select bottom zone given safe space');

    let rect = firstCue.measuredRect;
    assert.equal(rect.y + rect.height, 1566, 'Caption bottom should respect absolute output-edge inset of 354 (1920 - 300 - 54 = 1566)');
  });
});
