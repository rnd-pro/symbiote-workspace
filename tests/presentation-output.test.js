import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PRESENTATION_COMPOSITION_CUE_KINDS,
  PRESENTATION_COMPOSITION_PLAN_SCHEMA_VERSION,
  PRESENTATION_OUTPUT_SPEC_SCHEMA_VERSION,
  auditPresentationCompositionPlan,
  createLessonIntentHash,
  createPresentationCompositionPlan,
  listPresentationCompositionCueSlots,
  normalizePresentationOutputSpec,
} from '../runtime/presentation-output.js';

function validStep(overrides = {}) {
  return {
    turnId: 'turn-1',
    slotIndex: 0,
    targetId: 'panel:orders',
    stateActions: [{ name: 'select_window', reversible: true }],
    scroll: [{ id: 'orders-scroll', before: { left: 0, top: 0 }, after: { left: 0, top: 120 }, changed: true, applied: true }],
    measurement: {
      targetRect: { x: 80, y: 80, width: 600, height: 500 },
      focusRect: { x: 100, y: 100, width: 160, height: 48 },
      visibleRect: { x: 100, y: 100, width: 160, height: 48 },
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
    assert.equal(PRESENTATION_COMPOSITION_PLAN_SCHEMA_VERSION, 'workspace-presentation-composition-v3');
    assert.throws(
      () => normalizePresentationOutputSpec({ schemaVersion: 'workspace-presentation-output-v2' }),
      /unsupported presentation output schema version/,
    );
    assert.throws(
      () => createPresentationCompositionPlan({ schemaVersion: 'workspace-presentation-composition-v2' }),
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
    assert.equal(audit.coverage.coveredTargetCount, 1);
    assert.match(plan.hash, /^workspace-presentation-composition-v3:/);
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
      ['annotation-placement-unavailable', { steps: [validStep({ annotation: { placement: 'right', rect: { x: 100, y: 100, width: 100, height: 40 } } })] }],
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
});
