import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESENTATION_CONTRACT_VERSION,
  PRESENTATION_OBSERVED_ALIGNED_SEQUENCE_VERSION,
  PRESENTATION_TRANSCRIPT_WORD_ANCHORING_VERSION,
  PresentationObservedAlignmentError,
  createPresentationObservedAlignment,
  createPresentationTimelineContract,
  validatePresentationObservedAlignedSequence,
} from '../index.js';

function fixture(text = 'Résumé 42') {
  return createPresentationTimelineContract({
    contractVersion: PRESENTATION_CONTRACT_VERSION,
    id: 'observed-alignment',
    title: 'Observed alignment',
    locale: 'en-US',
    profile: 'brief',
    personas: {
      guide: {
        name: 'Guide',
        role: 'narrator',
        locale: 'en-US',
        delivery: { emotion: 'warm', pace: 'normal' },
      },
    },
    grounding: { sources: [] },
    turns: [{
      id: 'intro',
      persona: 'guide',
      dialogueAct: 'explain',
      text,
      sourceRefs: [],
      claims: [],
      cues: [],
    }],
  });
}

function inputFor(transcript, words, overrides = {}) {
  return {
    media: {
      hash: 'sha256-observed-audio',
      durationMs: 900,
      locale: 'en-US',
    },
    voice: { mode: 'single', speakerId: 'guide-main' },
    observations: [{
      turnIndex: 0,
      startMs: 100,
      endMs: 700,
      transcript,
      words,
    }],
    ...overrides,
  };
}

function assertObservedError(action, code) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof PresentationObservedAlignmentError, true);
    assert.equal(error.code, code);
    assert.equal(typeof error.message, 'string');
    assert.equal(error.message.length > 0, true);
    return true;
  });
}

describe('presentation observed-word alignment', () => {
  it('creates a canonical exact v3 sequence while preserving observed values', () => {
    let timeline = fixture();
    let transcript = 'Résumé  42!';
    let words = [
      { text: 'Résumé', startMs: 100, endMs: 420 },
      { text: '42', startMs: 470, endMs: 700 },
    ];
    let input = inputFor(transcript, words);
    let observedSnapshot = structuredClone(input.observations[0]);
    let result = createPresentationObservedAlignment(timeline, input);

    assert.equal(
      PRESENTATION_OBSERVED_ALIGNED_SEQUENCE_VERSION,
      'workspace-aligned-sequence-v3',
    );
    assert.equal(
      PRESENTATION_TRANSCRIPT_WORD_ANCHORING_VERSION,
      'workspace-transcript-word-anchoring-v1',
    );
    assert.deepEqual(input.observations[0], observedSnapshot);
    assert.deepEqual(result.sequence, {
      contractVersion: 'workspace-aligned-sequence-v3',
      timelineHash: timeline.hash,
      media: {
        hash: 'sha256-observed-audio',
        durationMs: 900,
        locale: 'en-US',
      },
      voice: { mode: 'single', speakerId: 'guide-main' },
      turns: [{
        turnIndex: 0,
        startMs: 100,
        endMs: 700,
        speaker: 'guide-main',
        transcript,
        words,
      }],
      events: [],
      hash: 'sha256-S66NCb3gSSLu6CceYe0HW4Hn2k5JFee/YE9E3vYaoWo=',
    });
    assert.equal(result.anchorings.length, 1);
    assert.equal(
      result.anchorings[0].contractVersion,
      'workspace-transcript-word-anchoring-v1',
    );
    assert.deepEqual(result.anchorings[0].observed, {
      transcript,
      tokens: [
        { index: 0, text: 'Résumé', wordIndex: 0 },
        { index: 1, text: '42', wordIndex: 1 },
      ],
      words,
    });
    assert.deepEqual(result.anchorings[0].operations.map((item) => item.operation), [
      'match',
      'match',
    ]);
    assert.deepEqual(result.metrics, {
      authoredTokenCount: 2,
      recognizedTokenCount: 2,
      timedTokenCount: 2,
      editDistance: 0,
      wer: 0,
      editSimilarity: 1,
      exactCorrespondence: true,
      timingCoverage: 1,
    });
    assert.equal(validatePresentationObservedAlignedSequence(result.sequence, timeline), result.sequence);
  });

  it('compares case and diacritics without changing exact token or speaker evidence', () => {
    let result = createPresentationObservedAlignment(
      fixture('RESUME 42'),
      inputFor('Résumé 42', [
        { text: 'Résumé', startMs: 100, endMs: 420 },
        { text: '42', startMs: 470, endMs: 700 },
      ], { voice: undefined }),
    );

    assert.equal(Object.hasOwn(result.sequence, 'voice'), false);
    assert.equal(result.sequence.turns[0].speaker, 'guide');
    assert.equal(result.anchorings[0].authored.tokens[0].text, 'RESUME');
    assert.equal(result.anchorings[0].observed.tokens[0].text, 'Résumé');
    assert.deepEqual(result.anchorings[0].operations.map((item) => item.operation), [
      'match',
      'match',
    ]);
    assert.equal(result.metrics.exactCorrespondence, true);
  });

  it('records delete, substitute, and insert evidence without rewriting recognition', () => {
    let timeline = fixture('keep remove anchor old middle final');
    let transcript = 'keep anchor new middle final extra';
    let words = [
      { text: 'keep', startMs: 100, endMs: 180 },
      { text: 'anchor', startMs: 190, endMs: 280 },
      { text: 'new', startMs: 290, endMs: 380 },
      { text: 'middle', startMs: 390, endMs: 480 },
      { text: 'final', startMs: 490, endMs: 580 },
      { text: 'extra', startMs: 590, endMs: 700 },
    ];
    let result = createPresentationObservedAlignment(
      timeline,
      inputFor(transcript, words),
    );

    assert.equal(result.sequence.turns[0].transcript, transcript);
    assert.deepEqual(result.sequence.turns[0].words, words);
    assert.deepEqual(result.anchorings[0].operations.map((item) => item.operation), [
      'match',
      'delete',
      'match',
      'substitute',
      'match',
      'match',
      'insert',
    ]);
    assert.deepEqual(result.anchorings[0].metrics, {
      authoredTokenCount: 6,
      recognizedTokenCount: 6,
      timedTokenCount: 6,
      editDistance: 3,
      wer: 0.5,
      editSimilarity: 0.5,
      exactCorrespondence: false,
      timingCoverage: 1,
    });
    assert.deepEqual(result.metrics, result.anchorings[0].metrics);
  });

  it('pins substitute before delete before insert for dynamic-programming ties', () => {
    let result = createPresentationObservedAlignment(
      fixture('a b'),
      inputFor('b a', [
        { text: 'b', startMs: 100, endMs: 300 },
        { text: 'a', startMs: 400, endMs: 700 },
      ]),
    );

    assert.deepEqual(result.anchorings[0].operations.map((item) => item.operation), [
      'substitute',
      'substitute',
    ]);
  });

  it('rejects transcript and observed-word token disagreement', () => {
    let timeline = fixture();
    assertObservedError(
      () => createPresentationObservedAlignment(timeline, inputFor('Résumé 43', [
        { text: 'Résumé', startMs: 100, endMs: 420 },
        { text: '42', startMs: 470, endMs: 700 },
      ])),
      'PRESENTATION_OBSERVED_ALIGNMENT_TRANSCRIPT_WORD_MISMATCH',
    );
  });

  it('rejects incomplete, overlapping, and out-of-range observed timing', () => {
    let timeline = fixture();
    assertObservedError(
      () => createPresentationObservedAlignment(timeline, inputFor('Résumé 42', [
        { text: 'Résumé', startMs: 100, endMs: 420 },
        { text: '42', startMs: 470 },
      ])),
      'PRESENTATION_OBSERVED_ALIGNMENT_TIMING_INCOMPLETE',
    );
    assertObservedError(
      () => createPresentationObservedAlignment(timeline, inputFor('Résumé 42', [
        { text: 'Résumé', startMs: 100, endMs: 500 },
        { text: '42', startMs: 499, endMs: 700 },
      ])),
      'PRESENTATION_OBSERVED_ALIGNMENT_TIMING_OVERLAP',
    );
    assertObservedError(
      () => createPresentationObservedAlignment(timeline, inputFor('Résumé 42', [
        { text: 'Résumé', startMs: 99, endMs: 420 },
        { text: '42', startMs: 470, endMs: 700 },
      ])),
      'PRESENTATION_OBSERVED_ALIGNMENT_TIMING_OUT_OF_RANGE',
    );
  });

  it('rejects incomplete turn coverage and stale timeline or sequence hashes', () => {
    let timeline = fixture();
    let input = inputFor('Résumé 42', [
      { text: 'Résumé', startMs: 100, endMs: 420 },
      { text: '42', startMs: 470, endMs: 700 },
    ]);
    assertObservedError(
      () => createPresentationObservedAlignment(timeline, { ...input, observations: [] }),
      'PRESENTATION_OBSERVED_ALIGNMENT_TURN_COVERAGE',
    );
    assertObservedError(
      () => createPresentationObservedAlignment({ ...timeline, hash: 'stale' }, input),
      'PRESENTATION_OBSERVED_ALIGNMENT_TIMELINE_STALE',
    );

    let result = createPresentationObservedAlignment(timeline, input);
    assertObservedError(
      () => validatePresentationObservedAlignedSequence({
        ...result.sequence,
        hash: 'stale',
      }, timeline),
      'PRESENTATION_OBSERVED_ALIGNMENT_SEQUENCE_STALE',
    );
  });
});
