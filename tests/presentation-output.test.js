import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  auditPresentationCompositionPlan,
  createLessonIntentHash,
  createPresentationCompositionPlan,
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

describe('presentation output and composition contracts', () => {
  it('normalizes all mandatory formats with explicit safe, caption, voice, language, and duration inputs', () => {
    let horizontal = normalizePresentationOutputSpec({ width: 1920, height: 1080, speakerMode: 'dialogue', locale: 'en-US', durationMs: 60000 });
    let vertical = normalizePresentationOutputSpec({ width: 1080, height: 1920, speakerMode: 'single', locale: 'ru-RU', durationMs: 30000 });
    let square = normalizePresentationOutputSpec({ width: 1080, height: 1080, captionsMode: 'off', durationMs: 90000 });

    assert.equal(horizontal.orientation, 'horizontal');
    assert.equal(horizontal.aspectRatio, '16:9');
    assert.equal(horizontal.safeArea.top, 54);
    assert.equal(horizontal.captions.reservePx, 194);
    assert.equal(vertical.orientation, 'vertical');
    assert.equal(vertical.aspectRatio, '9:16');
    assert.equal(vertical.voice.mode, 'single');
    assert.equal(vertical.locale, 'ru-RU');
    assert.equal(square.orientation, 'square');
    assert.equal(square.aspectRatio, '1:1');
    assert.equal(square.captions.rect, null);
    assert.notEqual(horizontal.hash, vertical.hash);
    assert.notEqual(vertical.hash, square.hash);
    assert.throws(() => normalizePresentationOutputSpec({ fps: 24 }), /constant 30 fps/);
    assert.throws(() => normalizePresentationOutputSpec({ dpr: 2 }), /DPR 1/);
  });

  it('accepts a restored, readable and collision-free per-turn composition plan', () => {
    let plan = validPlan();
    let audit = auditPresentationCompositionPlan(plan, {
      outputSpecHash: plan.outputSpecHash,
      structuralHash: plan.structuralHash,
      timelineHash: plan.timelineHash,
      lessonIntentHash: plan.lessonIntentHash,
      requiredTargetIds: ['panel:orders'],
    });

    assert.equal(audit.verdict, 'accept');
    assert.equal(audit.coverage.coveredTargetCount, 1);
    assert.match(plan.hash, /^workspace-presentation-composition-v1:/);
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
      let audit = auditPresentationCompositionPlan(plan, { requiredTargetIds: ['panel:orders'] });
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
