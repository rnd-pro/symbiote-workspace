import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeIntegrity } from '../schema/canonical-json.js';
import {
  getDuplicateKey,
  getSemanticKey,
  stringifyDuplicateKey,
  stringifySemanticKey,
} from '../runtime/presentation/presenter-schedule.js';

import {
  PRESENTATION_COMPOSITION_CUE_KINDS,
  PRESENTATION_COMPOSITION_PLAN_SCHEMA_VERSION,
  PRESENTATION_OUTPUT_SPEC_SCHEMA_VERSION,
  auditPresentationCompositionPlan,
  createLessonIntentHash,
  createPresentationCompositionPlan,
  listPresentationCompositionCueSlots,
  normalizePresentationOutputSpec,
  planCaptionPlacements,
} from '../runtime/presentation-output.js';
import {
  createPresenterActionSchedule,
  validatePresenterActionSchedule,
  createPresentationAlignedSequence,
  createPresentationTimelineContract,
  PRESENTER_ACTION_SCHEDULE_VERSION,
} from '../runtime/index.js';

function validStep(overrides = {}) {
  let kind = overrides.cueKind || 'focus';
  return {
    turnId: 'turn-1',
    slotIndex: 0,
    cueId: '0.0',
    cueIndex: 0,
    cueKind: kind,
    targetId: 'panel:orders',
    stateActions: [{ name: 'select_window', reversible: true }],
    scroll: [{ id: 'orders-scroll', before: { left: 0, top: 0 }, after: { left: 0, top: 120 }, changed: true, applied: true }],
    measurement: {
      targetRect: { x: 80, y: 80, width: 600, height: 500 },
      focusRect: { x: 100, y: 100, width: 160, height: 48 },
      visibleRect: { x: 100, y: 100, width: 160, height: 48 },
      criticalAttentionRect: { x: 150, y: 112, width: 40, height: 24 },
      visibleRatio: 1,
      visible: true,
      reachable: true,
      hasText: true,
      fontSizePx: 14,
      textTruncated: false,
      occluders: [],
      pointerTransparentOccluders: [],
    },
    annotation: { placement: 'right', rect: { x: 280, y: 100, width: 120, height: 48 } },
    ...overrides,
  };
}

function validPlan(overrides = {}) {
  let output = normalizePresentationOutputSpec({ width: 1920, height: 1080, captionsMode: 'karaoke', locale: 'en-US' });
  return createPresentationCompositionPlan({
    output,
    structuralHash: 'snapshot-v2:structural',
    sourceCompositionHash: 'composition:source',
    targetCompositionHash: 'composition:target',
    timelineHash: 'timeline-v2:ready',
    lessonIntentHash: 'workspace-lesson-intent-v1:stable',
    measuredViewport: { width: 1920, height: 1080, visualWidth: 1920, visualHeight: 1080, dpr: 1 },
    baselineStructuralHash: 'snapshot-v2:structural',
    restoredStructuralHash: 'snapshot-v2:structural',
    simulationFrozen: true,
    steps: [validStep()],
    ...overrides,
  });
}

function compositionExpectations(plan, overrides = {}) {
  return {
    sourceCompositionHash: plan.sourceCompositionHash,
    targetCompositionHash: plan.targetCompositionHash,
    ...overrides,
  };
}

function resignSchedule(schedule) {
  let projection = { ...schedule };
  delete projection.hash;
  return {
    ...schedule,
    hash: `${PRESENTER_ACTION_SCHEDULE_VERSION}:${computeIntegrity(projection)}`,
  };
}

describe('presentation output and composition contracts', () => {
  it('uses one composition cue taxonomy for focus, interaction, and annotation evidence', () => {
    let slots = listPresentationCompositionCueSlots({
      turns: [{
        id: 'turn-1',
        cues: [
          { kind: 'state', targetId: 'state-only' },
          { kind: 'focus', targetId: 'panel:orders' },
          { kind: 'interaction', targetId: 'button:approve' },
          { kind: 'annotation', targetId: 'field:status' },
        ],
      }],
    });

    assert.deepEqual(PRESENTATION_COMPOSITION_CUE_KINDS, ['focus', 'interaction', 'annotation']);
    assert.deepEqual(slots.map(({ kind, targetId, slotIndex, cueIndex }) => ({ kind, targetId, slotIndex, cueIndex })), [
      { kind: 'focus', targetId: 'panel:orders', slotIndex: 0, cueIndex: 1 },
      { kind: 'interaction', targetId: 'button:approve', slotIndex: 1, cueIndex: 2 },
      { kind: 'annotation', targetId: 'field:status', slotIndex: 2, cueIndex: 3 },
    ]);
  });

  it('rejects obsolete output and composition identities instead of silently migrating them', () => {
    assert.equal(PRESENTATION_OUTPUT_SPEC_SCHEMA_VERSION, 'workspace-presentation-output-v3');
    assert.equal(PRESENTATION_COMPOSITION_PLAN_SCHEMA_VERSION, 'workspace-presentation-composition-v4');
    assert.throws(
      () => normalizePresentationOutputSpec({ schemaVersion: 'workspace-presentation-output-v2' }),
      /unsupported presentation output schema version/,
    );
    assert.throws(
      () => createPresentationCompositionPlan({ schemaVersion: 'workspace-presentation-composition-v3' }),
      /unsupported presentation composition schema version/,
    );
  });

  it('rejects post-signature measurement mutation and stale composition identity', () => {
    let mutated = validPlan();
    mutated.steps[0].measurement.focusRect.x += 1;
    let mutationAudit = auditPresentationCompositionPlan(mutated, compositionExpectations(mutated, {
      targetCompositionHash: 'composition:target',
    }));
    assert.equal(mutationAudit.verdict, 'reject');
    assert.ok(mutationAudit.issueCodes.includes('composition-repair-stale'));

    let stalePlan = validPlan();
    let staleTargetAudit = auditPresentationCompositionPlan(stalePlan, compositionExpectations(stalePlan, {
      targetCompositionHash: 'composition:new-target',
    }));
    assert.equal(staleTargetAudit.verdict, 'reject');
    assert.ok(staleTargetAudit.issueCodes.includes('output-context-stale'));

    let unboundAudit = auditPresentationCompositionPlan(validPlan());
    assert.equal(unboundAudit.verdict, 'reject');
    assert.ok(unboundAudit.issueCodes.includes('output-context-stale'));
  });

  it('normalizes all mandatory formats with explicit safe, caption, voice, language, and duration inputs', () => {
    let horizontal = normalizePresentationOutputSpec({ width: 1920, height: 1080, speakerMode: 'dialogue', locale: 'en-US', durationMs: 60000 });
    let vertical = normalizePresentationOutputSpec({ width: 1080, height: 1920, speakerMode: 'single', speakerId: 'guide', locale: 'ru-RU', durationMs: 30000 });
    let square = normalizePresentationOutputSpec({ width: 1080, height: 1080, captionsMode: 'off', durationMs: 90000 });

    assert.equal(horizontal.orientation, 'horizontal');
    assert.equal(horizontal.aspectRatio, '16:9');
    assert.equal(horizontal.safeArea.top, 54);
    assert.equal(horizontal.captions.profile.preset, 'youtube');
    assert.ok(horizontal.captions.profile.fontSize >= 30);
    assert.deepEqual(horizontal.captions.profile.preferredZones, ['bottom', 'top']);
    assert.equal(vertical.orientation, 'vertical');
    assert.equal(vertical.aspectRatio, '9:16');
    assert.equal(vertical.captions.profile.preset, 'tiktok');
    assert.deepEqual(vertical.captions.profile.preferredZones, ['bottom', 'top', 'middle']);
    assert.equal(vertical.voice.mode, 'single');
    assert.equal(vertical.locale, 'ru-RU');
    assert.equal(square.orientation, 'square');
    assert.equal(square.aspectRatio, '1:1');
    assert.equal(square.captions.enabled, false);
    assert.equal(square.captions.profile.preset, 'square');
    assert.notEqual(horizontal.hash, vertical.hash);
    assert.notEqual(vertical.hash, square.hash);
    assert.throws(() => normalizePresentationOutputSpec({ fps: 24 }), /constant 30 fps/);
    assert.throws(() => normalizePresentationOutputSpec({ dpr: 2 }), /DPR 1/);
  });

  it('overrides preset caption zones only when placement is explicit', () => {
    let top = normalizePresentationOutputSpec({
      width: 1080,
      height: 1920,
      captions: { placement: 'top' },
    });
    let explicit = normalizePresentationOutputSpec({
      width: 1080,
      height: 1920,
      captions: { preferredZones: ['middle', 'top'] },
    });

    assert.deepEqual(top.captions.profile.preferredZones, ['top', 'bottom']);
    assert.deepEqual(explicit.captions.profile.preferredZones, ['middle', 'top']);
  });

  it('preserves semantic output geometry when frame insets are zero', () => {
    let base = normalizePresentationOutputSpec({ width: 1920, height: 1080, captionsMode: 'karaoke', locale: 'en-US' });
    let explicitZero = normalizePresentationOutputSpec({ width: 1920, height: 1080, captionsMode: 'karaoke', locale: 'en-US', frameInsets: { top: 0, right: 0, bottom: 0, left: 0 } });

    assert.deepEqual(base.frameInsets, { top: 0, right: 0, bottom: 0, left: 0 });
    assert.deepEqual(base.presentationViewport, { x: 0, y: 0, width: 1920, height: 1080 });
    assert.deepEqual(base.contentRect, { x: 54, y: 54, width: 1812, height: 972 });
    assert.equal(base.hash, explicitZero.hash);
  });

  it('derives a positive presentation viewport and inset-local geometry from horizontal and vertical insets', () => {
    let horizontal = normalizePresentationOutputSpec({ width: 1920, height: 1080, captionsMode: 'karaoke', locale: 'en-US', frameInsets: { top: 200, left: 100 } });
    let vertical = normalizePresentationOutputSpec({ width: 720, height: 1280, captionsMode: 'karaoke', locale: 'en-US', frameInsets: { top: 87 } });

    assert.equal(horizontal.width, 1920);
    assert.equal(horizontal.height, 1080);
    assert.deepEqual(horizontal.presentationViewport, { x: 100, y: 200, width: 1820, height: 880 });
    assert.ok(horizontal.contentRect.x >= horizontal.presentationViewport.x);
    assert.ok(horizontal.contentRect.y >= horizontal.presentationViewport.y);
    assert.ok(horizontal.contentRect.x + horizontal.contentRect.width <= horizontal.presentationViewport.x + horizontal.presentationViewport.width);
    assert.equal(horizontal.captions.profile.width, 1920);
    assert.equal(horizontal.captions.profile.height, 1080);

    assert.deepEqual(vertical.presentationViewport, { x: 0, y: 87, width: 720, height: 1193 });
    assert.ok(vertical.contentRect.y >= 87);
    assert.notEqual(horizontal.hash, vertical.hash);
    assert.notEqual(horizontal.hash, normalizePresentationOutputSpec({ width: 1920, height: 1080, captionsMode: 'karaoke', locale: 'en-US' }).hash);
  });

  it('rejects excessive, negative, and non-finite frame insets', () => {
    assert.throws(() => normalizePresentationOutputSpec({ width: 1920, height: 1080, frameInsets: { left: 1920 } }), /no positive presentation viewport/);
    assert.throws(() => normalizePresentationOutputSpec({ width: 1920, height: 1080, frameInsets: { top: 700, bottom: 700 } }), /no positive presentation viewport/);
    assert.throws(() => normalizePresentationOutputSpec({ width: 1920, height: 1080, frameInsets: { top: -1 } }), /must not be negative/);
    assert.throws(() => normalizePresentationOutputSpec({ width: 1920, height: 1080, frameInsets: { right: Infinity } }), /must be a finite number/);
    assert.throws(() => normalizePresentationOutputSpec({ width: 1920, height: 1080, frameInsets: { bottom: 'x' } }), /must be a finite number/);
  });

  it('measures composition against the presentation viewport and rejects full-output measurement under non-zero insets', () => {
    let output = normalizePresentationOutputSpec({ width: 1920, height: 1080, captionsMode: 'karaoke', locale: 'en-US', frameInsets: { top: 200, left: 100 } });
    let pageLocalStep = validStep({
      measurement: { ...validStep().measurement, focusRect: { x: 44, y: 44, width: 200, height: 60 }, visibleRect: { x: 44, y: 44, width: 200, height: 60 } },
      annotation: { placement: 'right', rect: { x: 300, y: 44, width: 120, height: 60 } },
    });
    let accepted = createPresentationCompositionPlan({
      output,
      sourceCompositionHash: 'composition:source',
      targetCompositionHash: 'composition:target',
      structuralHash: 'snapshot-v2:structural',
      timelineHash: 'timeline-v2:ready',
      lessonIntentHash: 'workspace-lesson-intent-v1:stable',
      measuredViewport: { width: 1820, height: 880, visualWidth: 1820, visualHeight: 880, dpr: 1 },
      baselineStructuralHash: 'snapshot-v2:structural',
      restoredStructuralHash: 'snapshot-v2:structural',
      simulationFrozen: true,
      steps: [pageLocalStep],
    });
    let acceptAudit = auditPresentationCompositionPlan(accepted, compositionExpectations(accepted, { requiredTargetIds: ['panel:orders'] }));
    assert.equal(acceptAudit.verdict, 'accept', acceptAudit.issueCodes.join(', '));

    let fullOutputMeasure = createPresentationCompositionPlan({
      output,
      sourceCompositionHash: 'composition:source',
      targetCompositionHash: 'composition:target',
      measuredViewport: { width: 1920, height: 1080, visualWidth: 1920, visualHeight: 1080, dpr: 1 },
      baselineStructuralHash: 'snapshot-v2:structural',
      restoredStructuralHash: 'snapshot-v2:structural',
      simulationFrozen: true,
      steps: [pageLocalStep],
    });
    let rejectAudit = auditPresentationCompositionPlan(fullOutputMeasure, compositionExpectations(fullOutputMeasure, { requiredTargetIds: ['panel:orders'] }));
    assert.equal(rejectAudit.verdict, 'reject');
    assert.ok(rejectAudit.issueCodes.includes('output-viewport-mismatch'));
  });

  it('translates page-local rectangles into final-frame coordinates before containment checks', () => {
    let output = normalizePresentationOutputSpec({ width: 1920, height: 1080, captionsMode: 'karaoke', locale: 'en-US', frameInsets: { top: 200, left: 100 } });
    // A page-local focus at the page origin only fits final-frame content once translated by the viewport offset.
    let untranslatedWouldClip = createPresentationCompositionPlan({
      output,
      sourceCompositionHash: 'composition:source',
      targetCompositionHash: 'composition:target',
      measuredViewport: { width: 1820, height: 880, visualWidth: 1820, visualHeight: 880, dpr: 1 },
      baselineStructuralHash: 'snapshot-v2:structural',
      restoredStructuralHash: 'snapshot-v2:structural',
      simulationFrozen: true,
      steps: [validStep({
        measurement: { ...validStep().measurement, focusRect: { x: 44, y: 44, width: 200, height: 60 }, visibleRect: { x: 44, y: 44, width: 200, height: 60 } },
        annotation: { placement: 'right', rect: { x: 300, y: 44, width: 120, height: 60 } },
      })],
    });
    assert.equal(auditPresentationCompositionPlan(untranslatedWouldClip, compositionExpectations(untranslatedWouldClip, { requiredTargetIds: ['panel:orders'] })).verdict, 'accept');

    // A page-local focus near the bottom of the page falls outside final-frame content after translation.
    let translatedClips = createPresentationCompositionPlan({
      output,
      sourceCompositionHash: 'composition:source',
      targetCompositionHash: 'composition:target',
      measuredViewport: { width: 1820, height: 880, visualWidth: 1820, visualHeight: 880, dpr: 1 },
      baselineStructuralHash: 'snapshot-v2:structural',
      restoredStructuralHash: 'snapshot-v2:structural',
      simulationFrozen: true,
      steps: [validStep({
        measurement: { ...validStep().measurement, focusRect: { x: 44, y: 860, width: 200, height: 60 }, visibleRect: { x: 44, y: 860, width: 200, height: 60 } },
      })],
    });
    let clippedAudit = auditPresentationCompositionPlan(translatedClips, compositionExpectations(translatedClips, { requiredTargetIds: ['panel:orders'] }));
    assert.equal(clippedAudit.verdict, 'reject');
    assert.ok(clippedAudit.issueCodes.includes('target-clipped'));
  });

  it('translates page-local annotation rectangles before final-frame placement checks', () => {
    let output = normalizePresentationOutputSpec({ width: 1920, height: 1080, captionsMode: 'karaoke', locale: 'en-US', frameInsets: { top: 200, left: 100 } });
    // Focus stays valid after translation; only the annotation, once translated, overruns final-frame content.
    let plan = createPresentationCompositionPlan({
      output,
      sourceCompositionHash: 'composition:source',
      targetCompositionHash: 'composition:target',
      measuredViewport: { width: 1820, height: 880, visualWidth: 1820, visualHeight: 880, dpr: 1 },
      baselineStructuralHash: 'snapshot-v2:structural',
      restoredStructuralHash: 'snapshot-v2:structural',
      simulationFrozen: true,
      steps: [validStep({
        cueKind: 'annotation',
        measurement: { ...validStep().measurement, focusRect: { x: 44, y: 44, width: 200, height: 60 }, visibleRect: { x: 44, y: 44, width: 200, height: 60 } },
        annotation: { placement: 'below', rect: { x: 44, y: 860, width: 120, height: 60 } },
      })],
    });
    let audit = auditPresentationCompositionPlan(plan, compositionExpectations(plan, { requiredTargetIds: ['panel:orders'] }));
    assert.equal(audit.verdict, 'reject');
    assert.ok(audit.issueCodes.includes('annotation-placement-unavailable'));
    assert.ok(!audit.issueCodes.includes('target-clipped'), audit.issueCodes.join(', '));
  });

  it('accepts a restored, readable and collision-free per-turn composition plan', () => {
    let plan = validPlan();
    let audit = auditPresentationCompositionPlan(plan, compositionExpectations(plan, {
      outputSpecHash: plan.outputSpecHash,
      structuralHash: plan.structuralHash,
      timelineHash: plan.timelineHash,
      lessonIntentHash: plan.lessonIntentHash,
      requiredTargetIds: ['panel:orders'],
    }));

    assert.equal(audit.verdict, 'accept');
    assert.equal(audit.coverage.coveredCueCount, 1);
    assert.match(plan.hash, /^workspace-presentation-composition-v4:/);
  });

  it('rejects every output and target composition failure with stable issue codes', () => {
    let cases = [
      ['output-viewport-mismatch', { measuredViewport: { width: 1080, height: 1920, visualWidth: 1080, visualHeight: 1920, dpr: 1 } }],
      ['composition-restore-mismatch', { restoredStructuralHash: 'stale' }],
      ['composition-simulation-active', { simulationFrozen: false }],
      ['target-hidden', { steps: [validStep({ measurement: { ...validStep().measurement, visible: false } })] }],
      ['target-clipped', { steps: [validStep({ measurement: { ...validStep().measurement, focusRect: { x: 0, y: 0, width: 10, height: 10 } } })] }],
      ['target-occluded', { steps: [validStep({ measurement: { ...validStep().measurement, pointerTransparentOccluders: ['overlay'] } })] }],
      ['target-unreachable', { steps: [validStep({ measurement: { ...validStep().measurement, reachable: false } })] }],
      ['target-unreadable', { steps: [validStep({ measurement: { ...validStep().measurement, textTruncated: true } })] }],
      ['composition-scroll-failed', { steps: [validStep({ scroll: [{ id: 'scroll', before: {}, after: { top: 10 }, changed: true, applied: false }] })] }],
      ['annotation-placement-unavailable', {
        steps: [validStep({
          cueKind: 'annotation',
          annotation: {
            placement: 'right',
            rect: { x: 100, y: 100, width: 100, height: 40 },
          },
        })],
      }],
    ];

    for (let [expectedCode, overrides] of cases) {
      let plan = validPlan(overrides);
      let audit = auditPresentationCompositionPlan(plan, compositionExpectations(plan, { requiredTargetIds: ['panel:orders'] }));
      assert.equal(audit.verdict, 'reject', expectedCode);
      assert.ok(audit.issueCodes.includes(expectedCode), `${expectedCode}: ${audit.issueCodes.join(', ')}`);
    }
  });

  it('keeps lesson intent invariant across format-specific claim plans but rejects changed lesson requirements', () => {
    let context = {
      lesson: {
        type: 'data-analysis',
        objective: 'Compare queue status',
        locale: 'en-US',
        requiredFactIds: ['queued', 'approved'],
        requiredTargetIds: ['queue', 'summary'],
      },
    };
    let claims = [
      { kind: 'comparison', factRefs: ['queued', 'approved'] },
      { kind: 'conclusion', factRefs: ['approved'] },
    ];
    let first = { locale: 'en-US', turns: [{ text: 'First wording', claims: [claims[0]] }, { text: 'Second wording', claims: [claims[1]] }] };
    let second = { locale: 'en-US', turns: [{ text: 'Different conclusion', claims: [claims[1]] }, { text: 'Different comparison', claims: [claims[0]] }] };

    assert.equal(createLessonIntentHash(context, first), createLessonIntentHash(context, second));
    assert.notEqual(createLessonIntentHash(context, first), createLessonIntentHash({ lesson: { ...context.lesson, objective: 'Explain queue only' } }, first));
    assert.equal(createLessonIntentHash(context, first), createLessonIntentHash(context, { turns: [{ claims: [claims[0]] }] }));
    assert.notEqual(createLessonIntentHash(context), createLessonIntentHash({ lesson: { ...context.lesson, requiredFactIds: ['queued'] } }));
    assert.equal(
      createLessonIntentHash({ lesson: { type: 'overview', objective: 'Explain queue' } }, { locale: 'ru-RU' }),
      createLessonIntentHash({ lesson: { type: 'overview', objective: 'Explain queue', locale: 'ru-RU' } }),
    );
  });

  it('rejects duplicate cue schemas and verifies presenter action schedule version constraints', () => {
    let timeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'output-test-timeline',
      title: 'Output Test Timeline',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'lesson guide' } },
      grounding: { sources: [] },
      turns: [
        {
          id: 'turn-1',
          persona: 'guide',
          dialogueAct: 'explain',
          text: 'Wait for page load.',
          cues: [
            {
              kind: 'focus',
              targetId: 'panel:home',
              at: { anchor: 'turn-start', offsetMs: 0 },
              focus: { mode: 'cursor' },
            },
            {
              kind: 'focus',
              targetId: 'panel:home',
              at: { anchor: 'turn-start', offsetMs: 500 },
              focus: { mode: 'cursor' },
            },
          ],
        },
      ],
    });

    let alignedSequence = createPresentationAlignedSequence(timeline, {
      media: { hash: 'audio-1', durationMs: 2000, locale: 'en-US' },
      turns: [
        {
          startMs: 0,
          endMs: 2000,
          speaker: 'guide',
          transcript: 'Wait for page load.',
          words: [],
        },
      ],
    });

    assert.throws(
      () => createPresenterActionSchedule(timeline, alignedSequence),
      (err) => {
        assert.equal(err.name, 'PresenterDuplicateActionError');
        assert.equal(err.code, 'PRESENTER_DUPLICATE_ACTION');
        return true;
      },
    );

    let validTimeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'output-test-timeline-valid',
      title: 'Output Test Timeline Valid',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'lesson guide' } },
      grounding: { sources: [] },
      turns: [
        {
          id: 'turn-1',
          persona: 'guide',
          dialogueAct: 'explain',
          text: 'Wait for page load.',
          cues: [
            {
              kind: 'focus',
              targetId: 'panel:home',
              at: { anchor: 'turn-start', offsetMs: 0 },
              focus: { mode: 'cursor' },
            },
          ],
        },
      ],
    });

    let validAligned = createPresentationAlignedSequence(validTimeline, {
      media: { hash: 'audio-1', durationMs: 2000, locale: 'en-US' },
      turns: [
        {
          startMs: 0,
          endMs: 2000,
          speaker: 'guide',
          transcript: 'Wait for page load.',
          words: [],
        },
      ],
    });

    let schedule = createPresenterActionSchedule(validTimeline, validAligned);
    assert.equal(schedule.contractVersion, PRESENTER_ACTION_SCHEDULE_VERSION);
    assert.equal(schedule.events.length, 1);

    let validated = validatePresenterActionSchedule(schedule, validTimeline, validAligned);
    assert.equal(validated.contractVersion, PRESENTER_ACTION_SCHEDULE_VERSION);

    let wrongVersion = { ...schedule, contractVersion: 'wrong-version-v9' };
    assert.throws(
      () => validatePresenterActionSchedule(wrongVersion, validTimeline, validAligned),
      /unsupported presenter action schedule version/,
    );

    let wrongTimeline = { ...schedule, timelineHash: 'stale-timeline-hash' };
    assert.throws(
      () => validatePresenterActionSchedule(wrongTimeline, validTimeline, validAligned),
      /presenter action schedule timelineHash does not match/,
    );
  });

  it('rejects canonical schedule tampering even with a recomputed hash', () => {
    let timeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'tamper-test',
      title: 'Tamper Test',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'lesson guide' } },
      grounding: { sources: [] },
      turns: [
        {
          id: 'turn-1',
          persona: 'guide',
          dialogueAct: 'explain',
          text: 'Step one.',
          cues: [
            {
              kind: 'focus',
              targetId: 'panel:home',
              at: { anchor: 'turn-start', offsetMs: 0 },
              focus: { mode: 'cursor' },
            },
          ],
        },
      ],
    });

    let alignedSequence = createPresentationAlignedSequence(timeline, {
      media: { hash: 'audio-1', durationMs: 2000, locale: 'en-US' },
      turns: [{ startMs: 0, endMs: 2000, speaker: 'guide', transcript: 'Step one.', words: [] }],
    });

    let schedule = createPresenterActionSchedule(timeline, alignedSequence);

    let tampered = resignSchedule({
      ...schedule,
      events: [{ ...schedule.events[0], startMs: 500 }],
    });

    assert.throws(
      () => validatePresenterActionSchedule(tampered, timeline, alignedSequence),
      /startMs mismatch/,
    );

    let tamperedMeta = resignSchedule({
      ...schedule,
      events: [{
        ...schedule.events[0],
        semanticKey: { ...schedule.events[0].semanticKey, variant: 'tampered' },
      }],
    });

    assert.throws(
      () => validatePresenterActionSchedule(tamperedMeta, timeline, alignedSequence),
      /semanticKey.*mismatch/,
    );
  });

  it('calculates cue-owned composition coverage and audit per cue ID', () => {
    let timeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'coverage-test',
      title: 'Coverage Test',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'lesson guide' } },
      grounding: { sources: [] },
      turns: [
        {
          id: 'turn-1',
          persona: 'guide',
          dialogueAct: 'explain',
          text: 'Step one.',
          cues: [
            {
              kind: 'focus',
              targetId: 'panel:home',
              at: { anchor: 'turn-start', offsetMs: 0 },
              focus: { mode: 'cursor' },
            },
            {
              kind: 'focus',
              targetId: 'panel:home',
              at: { anchor: 'turn-start', offsetMs: 500 },
              focus: { mode: 'cursor' },
            },
          ],
        },
      ],
    });

    let slots = listPresentationCompositionCueSlots(timeline);
    assert.equal(slots.length, 2);
    assert.equal(slots[0].cueId, '0.0');
    assert.equal(slots[1].cueId, '0.1');

    let planWithOneStep = validPlan({
      steps: [
        validStep({ cueId: '0.0', cueIndex: 0, cueKind: 'focus', targetId: 'panel:home' }),
      ],
    });

    let audit = auditPresentationCompositionPlan(planWithOneStep, {
      requiredCueSlots: slots,
      requiredCueIds: slots.map((slot) => slot.cueId),
      requiredTargetIds: ['panel:home'],
    });

    assert.equal(audit.verdict, 'reject');
    assert.ok(audit.issueCodes.includes('composition-step-missing'));
    assert.equal(audit.coverage.requiredCueCount, 2);
    assert.equal(audit.coverage.coveredCueCount, 1);
  });

  it('enforces exact scheduled region spans from the action schedule', () => {
    let timeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'spans-test',
      title: 'Spans Test',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'lesson guide' } },
      grounding: { sources: [] },
      turns: [
        {
          id: 'turn-1',
          persona: 'guide',
          dialogueAct: 'explain',
          text: 'Step one.',
          cues: [
            {
              kind: 'focus',
              targetId: 'panel:home',
              at: { anchor: 'turn-start', offsetMs: 0 },
              until: { anchor: 'turn-start', offsetMs: 200 },
              focus: { mode: 'cursor' },
            },
            {
              kind: 'focus',
              targetId: 'panel:orders',
              at: { anchor: 'turn-start', offsetMs: 100 },
              until: { anchor: 'turn-start', offsetMs: 300 },
              focus: { mode: 'cursor' },
            },
          ],
        },
      ],
    });

    let alignedSequence = createPresentationAlignedSequence(timeline, {
      media: { hash: 'audio-1', durationMs: 2000, locale: 'en-US' },
      turns: [{ startMs: 0, endMs: 2000, speaker: 'guide', transcript: 'Step one.', words: [] }],
    });

    let schedule = createPresenterActionSchedule(timeline, alignedSequence, { gapMs: 150 });
    assert.equal(schedule.events[0].startMs, 0);
    assert.equal(schedule.events[0].endMs, 1000);
    assert.equal(schedule.events[1].startMs, 1150);
    assert.equal(schedule.events[1].endMs, 2150);

    let reordered = resignSchedule({
      ...schedule,
      events: [...schedule.events].reverse(),
    });
    assert.throws(
      () => validatePresenterActionSchedule(reordered, timeline, alignedSequence),
      /ordering|mismatch/,
    );

    let plan = validPlan({
      timelineHash: timeline.hash,
      steps: [
        validStep({ id: 'step-1', cueId: '0.0', cueIndex: 0, cueKind: 'focus', targetId: 'panel:home' }),
        validStep({ id: 'step-2', cueId: '0.1', cueIndex: 1, cueKind: 'focus', targetId: 'panel:orders' }),
      ],
    });

    let placementInput = {
      timeline,
      alignedSequence,
      compositionPlan: plan,
      actionSchedule: schedule,
      sourceCompositionHash: plan.sourceCompositionHash,
      targetCompositionHash: plan.targetCompositionHash,
      cues: [{
        cueId: 'cue-1',
        index: 0,
        speaker: 'guide',
        text: 'Step one.',
        startSec: 0,
        endSec: 2,
        wordTimings: [],
      }],
    };

    let result = planCaptionPlacements(placementInput);
    let focusAvoid = result.track.avoidRegions.find((region) => region.id === 'focus:0.1');
    assert.ok(focusAvoid);
    assert.equal(focusAvoid.kind, 'focus');
    assert.equal(focusAvoid.startSec, 1.15);
    assert.equal(focusAvoid.endSec, 2.15);
  });

  it('rejects duplicate cue steps in composition audit', () => {
    let plan = validPlan({
      steps: [
        validStep({ id: 'step-1', cueId: '0.0', cueIndex: 0, cueKind: 'focus', targetId: 'panel:orders' }),
        validStep({ id: 'step-2', cueId: '0.0', cueIndex: 0, cueKind: 'focus', targetId: 'panel:orders' }),
      ],
    });

    let audit = auditPresentationCompositionPlan(plan, {
      requiredTargetIds: ['panel:orders'],
    });

    assert.equal(audit.verdict, 'reject');
    assert.ok(audit.issueCodes.includes('composition-step-missing'));
  });

  it('extends total duration when schedule events push past media end time', () => {
    let timeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'extension-test',
      title: 'Extension Test',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'lesson guide' } },
      grounding: { sources: [] },
      turns: [
        {
          id: 'turn-1',
          persona: 'guide',
          dialogueAct: 'explain',
          text: 'First, second.',
          cues: [
            {
              kind: 'focus',
              targetId: 'panel:home',
              at: { anchor: 'turn-start', offsetMs: 0 },
              focus: { mode: 'cursor' },
            },
            {
              kind: 'focus',
              targetId: 'panel:orders',
              at: { anchor: 'turn-start', offsetMs: 500 },
              focus: { mode: 'cursor' },
            },
          ],
        },
      ],
    });

    let alignedSequence = createPresentationAlignedSequence(timeline, {
      media: { hash: 'audio-1', durationMs: 400, locale: 'en-US' },
      turns: [{ startMs: 0, endMs: 400, speaker: 'guide', transcript: 'First, second.', words: [] }],
    });

    let schedule = createPresenterActionSchedule(timeline, alignedSequence, { gapMs: 100 });
    assert.equal(schedule.pointDurationMs, 1000);
    assert.equal(schedule.totalDurationMs, 2100);
    assert.equal(schedule.extensionMs, 1700);
  });

  it('rejects unknown or omitted schedule fields even with a supplied hash', () => {
    let timeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'tamper-test',
      title: 'Tamper Test',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'lesson guide' } },
      grounding: { sources: [] },
      turns: [
        {
          id: 'turn-1',
          persona: 'guide',
          dialogueAct: 'explain',
          text: 'Step one.',
          cues: [
            {
              kind: 'focus',
              targetId: 'panel:home',
              at: { anchor: 'turn-start', offsetMs: 0 },
              focus: { mode: 'cursor' },
            },
          ],
        },
      ],
    });

    let alignedSequence = createPresentationAlignedSequence(timeline, {
      media: { hash: 'audio-1', durationMs: 2000, locale: 'en-US' },
      turns: [{ startMs: 0, endMs: 2000, speaker: 'guide', transcript: 'Step one.', words: [] }],
    });

    let schedule = createPresenterActionSchedule(timeline, alignedSequence);

    let tamperedTopLevel = resignSchedule({
      ...schedule,
      unknownField: 'tampered',
    });

    assert.throws(
      () => validatePresenterActionSchedule(tamperedTopLevel, timeline, alignedSequence),
      /presenter action schedule structural mismatch/,
    );

    let tamperedEvent = resignSchedule({
      ...schedule,
      events: [{
        ...schedule.events[0],
        unknownEventField: undefined,
      }],
    });

    assert.throws(
      () => validatePresenterActionSchedule(tamperedEvent, timeline, alignedSequence),
      /presenter action schedule structural mismatch/,
    );

    let omittedTopLevelField = structuredClone(schedule);
    delete omittedTopLevelField.extensionMs;
    omittedTopLevelField = resignSchedule(omittedTopLevelField);
    assert.throws(
      () => validatePresenterActionSchedule(omittedTopLevelField, timeline, alignedSequence),
      /extensionMs/,
    );

    let omittedEventField = structuredClone(schedule);
    delete omittedEventField.events[0].targetId;
    omittedEventField = resignSchedule(omittedEventField);
    assert.throws(
      () => validatePresenterActionSchedule(omittedEventField, timeline, alignedSequence),
      /targetId/,
    );
  });

  it('accepts reordered-key semantic equivalence and produces identical semantic/duplicate keys', () => {
    let cueA = {
      kind: 'interaction',
      targetId: 'panel:home',
      tabId: 'primary',
      interaction: {
        type: 'click',
        parameters: { x: 10, nested: { alpha: 1, beta: 2 } },
        binding: {
          source: 'webmcp',
          tool: 'action1',
          input: { first: true, second: false },
        },
      },
    };
    let cueB = {
      tabId: 'primary',
      targetId: 'panel:home',
      kind: 'interaction',
      interaction: {
        binding: {
          input: { second: false, first: true },
          tool: 'action1',
          source: 'webmcp',
        },
        parameters: { nested: { beta: 2, alpha: 1 }, x: 10 },
        type: 'click',
      },
    };
    let semanticKeyA = getSemanticKey(cueA, 'turn-1');
    let semanticKeyB = getSemanticKey(cueB, 'turn-1');
    let duplicateKeyA = getDuplicateKey('reorder-test', semanticKeyA, 0, 1000);
    let duplicateKeyB = getDuplicateKey('reorder-test', semanticKeyB, 0, 1000);

    assert.equal(typeof semanticKeyA.effect, 'object');
    assert.deepEqual(semanticKeyA, semanticKeyB);
    assert.equal(stringifySemanticKey(semanticKeyA), stringifySemanticKey(semanticKeyB));
    assert.deepEqual(duplicateKeyA, duplicateKeyB);
    assert.equal(stringifyDuplicateKey(duplicateKeyA), stringifyDuplicateKey(duplicateKeyB));
    assert.notDeepEqual(getSemanticKey(cueA, 'turn-2'), semanticKeyA);

    let timeline = createPresentationTimelineContract({
      contractVersion: 'presentation-timeline-v3',
      id: 'reorder-test',
      title: 'Reorder Test',
      locale: 'en-US',
      profile: 'brief',
      personas: { guide: { name: 'Guide', role: 'lesson guide' } },
      grounding: { sources: [] },
      turns: [
        {
          id: 'turn-1',
          persona: 'guide',
          dialogueAct: 'explain',
          text: 'Step one.',
          cues: [
            {
              kind: 'interaction',
              targetId: 'panel:home',
              at: { anchor: 'turn-start', offsetMs: 0 },
              interaction: {
                type: 'click',
                parameters: { x: 10, y: 20 },
                binding: { source: 'webmcp', tool: 'action1', input: {} },
              },
            },
          ],
        },
      ],
    });

    let alignedSequence = createPresentationAlignedSequence(timeline, {
      media: { hash: 'audio-1', durationMs: 2000, locale: 'en-US' },
      turns: [{ startMs: 0, endMs: 2000, speaker: 'guide', transcript: 'Step one.', words: [] }],
    });

    let schedule = createPresenterActionSchedule(timeline, alignedSequence);

    let reorderedEvents = [
      {
        ...schedule.events[0],
        semanticKey: {
          effect: schedule.events[0].semanticKey.effect,
          target: schedule.events[0].semanticKey.target,
          tab: schedule.events[0].semanticKey.tab,
          variant: schedule.events[0].semanticKey.variant,
          kind: schedule.events[0].semanticKey.kind,
          turn: schedule.events[0].semanticKey.turn,
          version: schedule.events[0].semanticKey.version,
        },
      },
    ];

    let reorderedSchedule = {
      ...schedule,
      events: reorderedEvents,
    };

    let validated = validatePresenterActionSchedule(reorderedSchedule, timeline, alignedSequence);
    assert.deepEqual(validated, reorderedSchedule);
  });

  it('prevents collisions for delimiter-containing text (delimiter safety)', () => {
    let semKey1 = {
      version: 'v1',
      turn: 'turn-1',
      kind: 'focus',
      variant: 'cursor',
      tab: 'a',
      target: 'b:c',
      effect: null,
    };
    let semKey2 = {
      version: 'v1',
      turn: 'turn-1',
      kind: 'focus',
      variant: 'cursor',
      tab: 'a:b',
      target: 'c',
      effect: null,
    };

    let str1 = stringifySemanticKey(semKey1);
    let str2 = stringifySemanticKey(semKey2);
    let dup1 = stringifyDuplicateKey(getDuplicateKey('timeline', semKey1, 10, 20));
    let dup2 = stringifyDuplicateKey(getDuplicateKey('timeline', semKey2, 10, 20));

    assert.notEqual(str1, str2);
    assert.notEqual(dup1, dup2);
  });

  it('fails closed when criticalAttentionRect is missing or non-positive for focus/interaction steps', () => {
    for (let cueKind of ['focus', 'interaction']) {
      let missingPlan = validPlan({
        steps: [validStep({
          cueKind,
          measurement: {
            ...validStep().measurement,
            criticalAttentionRect: null,
          },
        })],
      });
      let missingAudit = auditPresentationCompositionPlan(missingPlan, {
        requiredTargetIds: ['panel:orders'],
      });

      assert.equal(missingAudit.verdict, 'reject');
      assert.ok(missingAudit.issueCodes.includes('target-clipped'));
    }

    let nonPositivePlan = validPlan({
      steps: [validStep({
        cueKind: 'focus',
        measurement: {
          ...validStep().measurement,
          criticalAttentionRect: { x: 100, y: 100, width: 0, height: 48 },
        },
      })],
    });

    let nonPositiveAudit = auditPresentationCompositionPlan(nonPositivePlan, {
      requiredTargetIds: ['panel:orders'],
    });

    assert.equal(nonPositiveAudit.verdict, 'reject');
    assert.ok(nonPositiveAudit.issueCodes.includes('target-clipped'));

    let nonFinitePlan = validPlan({
      steps: [
        validStep({
          cueKind: 'interaction',
          measurement: {
            ...validStep().measurement,
            criticalAttentionRect: { x: 'invalid', y: 100, width: 40, height: 24 },
          },
        }),
      ],
    });
    let nonFiniteAudit = auditPresentationCompositionPlan(nonFinitePlan, {
      requiredTargetIds: ['panel:orders'],
    });

    assert.equal(nonFiniteAudit.verdict, 'reject');
    assert.ok(nonFiniteAudit.issueCodes.includes('target-clipped'));
  });
});
