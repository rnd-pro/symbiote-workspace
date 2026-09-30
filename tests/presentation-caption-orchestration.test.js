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
    steps: [{
      id: 'step-1',
      turnId: 'turn-1',
      targetId: 'panel:home:queue-node',
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
    }],
  });
  let cues = [{
    id: 'caption-1',
    index: 0,
    speaker: 'guide',
    text: 'This exact timed sentence tests attention-aware caption placement.',
    startSec: 0,
    endSec: 3,
    wordTimings: [],
  }];
  return {
    alignedSequence,
    compositionPlan,
    cues,
    output,
    timeline,
    sourceCompositionHash: compositionPlan.sourceCompositionHash,
    targetCompositionHash: compositionPlan.targetCompositionHash,
  };
}

describe('planCaptionPlacements orchestration', () => {
  it('uses the engine track for one deterministic live and offline placement contract', () => {
    let input = fixture();
    let composition = planCaptionPlacements(input);
    let cue = composition.track.cues[0];

    assert.equal(composition.schemaVersion, PRESENTATION_CAPTION_COMPOSITION_SCHEMA_VERSION);
    assert.equal(composition.outputSpecHash, input.output.hash);
    assert.equal(composition.track.schemaVersion, 'caption-presentation-track-v1');
    assert.equal(cue.placement.zone, 'top');
    assert.ok(cue.decisionEvidence.activeAvoidRegionIds.includes('focus:step-1'));
    assert.ok(cue.decisionEvidence.activeAvoidRegionIds.includes('annotation:step-1'));
    assert.ok(cue.decisionEvidence.activeAvoidRegionIds.includes('action:step-1'));
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
        id: 'caption-1a',
        cueIndex: 0,
        speaker: 'guide',
        text: 'This exact timed sentence',
        startSec: 0.2,
        endSec: 1.1,
      },
      {
        id: 'caption-1b',
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
          id: 'caption-1a',
          cueIndex: 0,
          speaker: 'guide',
          text: 'This exact timed sentence',
          startSec: 0,
          endSec: 1.5,
        },
        {
          id: 'caption-1b',
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
      let step = input.compositionPlan.steps[0];
      input.compositionPlan = createPresentationCompositionPlan({
        ...input.compositionPlan,
        steps: [{ ...step, measurement: mutateMeasurement(step) }],
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

    for (let [issueCode, mutateStep] of [
      ['composition-scroll-failed', (step) => ({
        ...step,
        scroll: [{ id: 'failed-scroll', before: { left: 0, top: 0 }, after: { left: 0, top: 120 }, changed: true, applied: false }],
      })],
      ['annotation-placement-unavailable', (step) => ({ ...step, annotation: null })],
    ]) {
      let input = fixture();
      input.compositionPlan = createPresentationCompositionPlan({
        ...input.compositionPlan,
        steps: [mutateStep(input.compositionPlan.steps[0])],
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
    input.cues[0].speaker = 'guide';

    assert.equal(planCaptionPlacements(input).output.voice.mode, 'single');
    input.cues[0].speaker = 'narrator';
    assert.throws(
      () => planCaptionPlacements(input),
      /does not match the declared single speaker/,
    );
    input.cues[0].speaker = 'guide';

    let secondText = 'The same narrator continues with the verified timeline.';
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
    input.compositionPlan = createPresentationCompositionPlan({
      ...input.compositionPlan,
      output: input.output,
      timelineHash: input.timeline.hash,
      steps: [
        input.compositionPlan.steps[0],
        {
          ...input.compositionPlan.steps[0],
          id: 'step-2',
          turnId: 'turn-2',
          targetId: 'panel:home:timeline-node',
        },
      ],
    });
    input.cues = [
      { ...input.cues[0], cueIndex: 0, startSec: 0, endSec: 3, speaker: 'guide' },
      { id: 'caption-2', cueIndex: 1, speaker: 'intruder', text: secondText, startSec: 3, endSec: 6, wordTimings: [] },
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
});
