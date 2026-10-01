// Evidence retention in the v1 aligned sequence.
//
// The August work existed because v1 threw the evidence away: a sequence kept
// only the turn's span, so nothing downstream could show where a caption came
// from. These regressions state the six properties that retention has to hold,
// and one property it must not have: accepting more must not make an existing
// sequence's hash move.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeIntegrity } from '../schema/canonical-json.js';
import { createPresentationTimelineContract } from '../runtime/presentation/contract.js';
import { PRESENTATION_ALIGNED_SEQUENCE_VERSION } from '../runtime/presentation/align.js';
import {
  createPresentationAlignedSequence,
  validatePresentationAlignedSequence,
} from '../runtime/presentation/align.js';

const TEXT = 'Show the canonical authoring timeline.';

function timeline() {
  return createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'alignment-evidence',
    title: 'Alignment evidence',
    locale: 'en-US',
    profile: 'brief',
    personas: { guide: { name: 'Guide', role: 'guide', locale: 'en-US' } },
    grounding: { sources: [] },
    turns: [{
      id: 'intro',
      persona: 'guide',
      dialogueAct: 'open',
      text: TEXT,
      sourceRefs: [],
      claims: [],
      cues: [],
    }],
  });
}

const MEDIA = { hash: 'sha256-alignment-evidence', durationMs: 1200, locale: 'en-US' };
const SPAN = { startMs: 0, endMs: 1200 };
const WORDS = [{ text: 'canonical', startMs: 100, endMs: 400 }];

// The digest the published 2.0.0 produces for this exact minimal sequence,
// read back out of the installed package rather than computed from the code
// beside it. A turn that passes no evidence must produce the same bytes it always
// did, or every sequence a consumer already holds becomes stale — and a test
// comparing the builder only against its own validator would survive a change
// made consistently to both.
const MINIMAL_DIGEST_BEFORE_RETENTION = 'workspace-aligned-sequence-v1:sha256-7+bBZZA29gSBA9U5UAvszJGy/K1Tr5pr2B0IQiZ32+A=';

const minimal = () => createPresentationAlignedSequence(timeline(), { media: MEDIA, turns: [SPAN] });

const evidenced = (extra = {}) => createPresentationAlignedSequence(timeline(), {
  media: MEDIA,
  voice: { mode: 'single', speakerId: 'guide' },
  turns: [{ ...SPAN, speaker: 'guide', transcript: TEXT, words: WORDS }],
  ...extra,
});

describe('aligned sequence evidence', () => {
  it('a minimal sequence keeps the exact digest the previous contract produced', () => {
    // The digest is pinned to the value computed before evidence retention
    // existed. Asserting only that the builder and the validator agree would
    // survive a change made consistently to both — which is precisely the change
    // this contract must not make, because it would silently retarget every
    // sequence a 2.0.0 consumer already holds.
    let sequence = minimal();
    assert.deepEqual(Object.keys(sequence.turns[0]).sort(), ['endMs', 'startMs', 'turnIndex']);
    assert.equal('voice' in sequence, false, 'an undeclared voice must not be materialised');
    assert.equal(sequence.hash, MINIMAL_DIGEST_BEFORE_RETENTION);
    assert.doesNotThrow(() => validatePresentationAlignedSequence(sequence, timeline()));
  });

  it('refuses a word that starts before its turn, not merely one that overlaps it', () => {
    // A turn that does not start at zero is the case that separates containment
    // from overlap: with the turn at [500,1000], a word at [100,600] intersects it
    // and is still not evidence about it.
    let offsetTimeline = timeline();
    let offset = createPresentationAlignedSequence(offsetTimeline, {
      media: MEDIA,
      turns: [{
        startMs: 500,
        endMs: 1200,
        words: [{ text: 'inside', startMs: 500, endMs: 600 }],
      }],
    });
    assert.doesNotThrow(() => validatePresentationAlignedSequence(offset, offsetTimeline), 'a word inside the turn is accepted');

    for (let words of [[{ text: 'before', startMs: 100, endMs: 550 }], [{ text: 'after', startMs: 1100, endMs: 1300 }]]) {
      assert.throws(
        () => createPresentationAlignedSequence(offsetTimeline, {
          media: MEDIA,
          turns: [{ startMs: 500, endMs: 1200, words }],
        }),
        TypeError,
        `expected ${JSON.stringify(words)} to be refused as outside the turn`,
      );
    }
  });

  it('retains the evidence a turn carries', () => {
    let sequence = evidenced();
    assert.deepEqual(sequence.turns[0].speaker, 'guide');
    assert.equal(sequence.turns[0].transcript, TEXT);
    assert.equal(sequence.turns[0].words.length, 1);
    assert.equal(sequence.voice.mode, 'single');
    assert.doesNotThrow(() => validatePresentationAlignedSequence(sequence, timeline()));
  });

  it('refuses a speaker the declared voice did not name', () => {
    assert.throws(
      () => createPresentationAlignedSequence(timeline(), {
        media: MEDIA,
        voice: { mode: 'single', speakerId: 'guide' },
        turns: [{ ...SPAN, speaker: 'intruder' }],
      }),
      /does not match the declared voice ownership/,
    );
  });

  it('still checks the speaker when no voice is declared, so dropping it is not a bypass', () => {
    // The owner is then the authored persona. A sequence that removes the
    // declaration to escape the check is caught here instead of passing.
    assert.throws(
      () => createPresentationAlignedSequence(timeline(), {
        media: MEDIA,
        turns: [{ ...SPAN, speaker: 'intruder' }],
      }),
      /does not match the declared voice ownership/,
    );
    assert.doesNotThrow(() => createPresentationAlignedSequence(timeline(), {
      media: MEDIA,
      turns: [{ ...SPAN, speaker: 'guide' }],
    }), 'the authored persona owns the turn when nothing else is declared');
  });

  it('refuses word timings that are invalid, even where no anchor resolves them', () => {
    let bad = [
      { text: 'x', startMs: -10, endMs: 20 },
      { text: 'x', startMs: 200, endMs: 100 },
      { text: 'x', startMs: 5000, endMs: 6000 },
      { text: 'x', startMs: 0, endMs: Number.MAX_SAFE_INTEGER + 10 },
    ];
    for (const words of bad) {
      assert.throws(
        () => createPresentationAlignedSequence(timeline(), {
          media: MEDIA,
          turns: [{ ...SPAN, words: [words] }],
        }),
        TypeError,
        `expected ${JSON.stringify(words)} to be refused`,
      );
    }
    assert.throws(
      () => createPresentationAlignedSequence(timeline(), { media: MEDIA, turns: [{ ...SPAN, words: 'nope' }] }),
      /words must be an array/,
    );
  });

  it('refuses evidence swapped after the fact, on the original hash', () => {
    let sequence = evidenced();
    let tampered = { ...sequence, turns: [{ ...sequence.turns[0], speaker: 'narrator' }] };
    assert.throws(() => validatePresentationAlignedSequence(tampered, timeline()), TypeError);

    let stripped = { ...sequence, turns: [{ turnIndex: 0, ...SPAN }] };
    assert.throws(() => validatePresentationAlignedSequence(stripped, timeline()), /hash is stale/);
  });

  it('refuses a transcript that was rewritten, even with the hash recomputed to match', () => {
    // The digest is recomputed here for real, so the sequence is internally
    // consistent — the only thing wrong with it is what it claims the turn said.
    // This is the case the hash cannot catch on its own, and the reason the
    // transcript check exists beside it.
    let sequence = evidenced();
    let rehashed = {
      contractVersion: sequence.contractVersion,
      timelineHash: sequence.timelineHash,
      media: sequence.media,
      turns: [{ ...sequence.turns[0], transcript: 'Something the turn never said.' }],
      events: sequence.events,
      voice: sequence.voice,
    };
    rehashed.hash = `${PRESENTATION_ALIGNED_SEQUENCE_VERSION}:${computeIntegrity(rehashed)}`;

    // The digest is satisfied — what refuses is the evidence itself.
    assert.doesNotThrow(() => computeIntegrity(rehashed));
    assert.throws(() => validatePresentationAlignedSequence(rehashed, timeline()), /transcript does not match the authored turn/);
  });

  it('a speaker that matches the declared voice is accepted even when it is not the persona', () => {
    // The persona and the voice are different things: a narrator may speak every
    // turn. Refusing this would make the declaration unusable, so the declared
    // voice — not the persona — owns the turn when one is declared.
    assert.doesNotThrow(() => createPresentationAlignedSequence(timeline(), {
      media: MEDIA,
      voice: { mode: 'single', speakerId: 'narrator' },
      turns: [{ ...SPAN, speaker: 'narrator' }],
    }));
  });

  it('refuses a transcript that is not the authored turn', () => {
    assert.throws(
      () => createPresentationAlignedSequence(timeline(), {
        media: MEDIA,
        turns: [{ ...SPAN, transcript: 'something else' }],
      }),
      /transcript does not match the authored turn/,
    );
  });

  it('refuses a voice mode it does not know', () => {
    assert.throws(
      () => createPresentationAlignedSequence(timeline(), { media: MEDIA, voice: { mode: 'chorus' }, turns: [SPAN] }),
      /voice.mode is unsupported/,
    );
  });
});
