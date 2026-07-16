import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESENTATION_ALIGNED_SEQUENCE_VERSION,
  PRESENTATION_CONTRACT_VERSION,
  PRESENTATION_DIALOGUE_ACTS,
  PRESENTATION_INTERACTION_TYPES,
  createPresentationAlignedSequence,
  createPresentationTimelineContract,
  normalizePresentationTimeline,
  reviewPresentationTimeline,
  validatePresentationAlignedSequence,
} from '../index.js';

function fixture(overrides = {}) {
  return {
    contractVersion: PRESENTATION_CONTRACT_VERSION,
    id: 'maximo-v3',
    title: 'Maximo V3',
    locale: 'ru-RU',
    profile: 'dialogue',
    personas: {
      guide: { name: 'Guide', role: 'lesson guide', locale: 'ru-RU', delivery: { emotion: 'warm', pace: 'normal' } },
      ops: { name: 'Operator', role: 'domain operator', locale: 'ru-RU', delivery: { emotion: 'curious', pace: 'normal' } },
    },
    grounding: { sources: [{ id: 'graph', contentHash: 'sha256-graph', targetId: 'panel:graph' }] },
    turns: [
      {
        id: 'open',
        persona: 'guide',
        addressee: 'ops',
        dialogueAct: 'ask',
        text: 'Где начинается поток адаптера?',
        sourceRefs: [{ sourceId: 'graph', hash: 'sha256-graph', targetId: 'panel:graph' }],
        claims: [],
        cues: [{
          kind: 'focus',
          targetId: 'panel:graph',
          at: { anchor: 'speech', quote: 'поток адаптера', occurrence: 1, edge: 'start', offsetMs: 0 },
          until: { anchor: 'turn-end', offsetMs: 0 },
          focus: { mode: 'cursor' },
        }],
      },
      {
        id: 'answer',
        persona: 'ops',
        addressee: 'guide',
        dialogueAct: 'respond',
        replyTo: 'open',
        text: 'Поток начинается в диспетчере и проходит через адаптер.',
        sourceRefs: [{ sourceId: 'graph', hash: 'sha256-graph', targetId: 'panel:graph' }],
        claims: [{ id: 'flow', kind: 'state', text: 'Поток проходит через адаптер.', factRefs: ['flow'], evidenceRefs: ['graph'], targetRefs: ['panel:graph'] }],
        transition: { pauseBeforeMs: 120, overlapMs: 0 },
        cues: [
          {
            kind: 'annotation',
            targetId: 'panel:graph',
            at: { anchor: 'speech', quote: 'через адаптер', occurrence: 1, edge: 'start', offsetMs: 0 },
            until: { anchor: 'turn-end', offsetMs: 0 },
            annotation: { intent: 'emphasize', marker: 'underline', placement: 'over' },
          },
          {
            kind: 'interaction',
            targetId: 'panel:graph',
            at: { anchor: 'turn-end', offsetMs: 0 },
            interaction: { type: 'click', binding: { source: 'webmcp', tool: 'graph.focus', input: { id: 'adapter' } }, reversible: true },
          },
          {
            kind: 'state',
            targetId: 'panel:graph',
            at: { anchor: 'turn-end', offsetMs: 0 },
            state: { condition: 'paint-stable', timeoutMs: 5000 },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('presentation timeline v3 contract', () => {
  it('pins dialogue and interaction vocabularies without wait as an interaction', () => {
    assert.equal(PRESENTATION_CONTRACT_VERSION, 'presentation-timeline-v3');
    assert.deepEqual(PRESENTATION_DIALOGUE_ACTS, [
      'open', 'explain', 'ask', 'respond', 'clarify', 'confirm', 'acknowledge',
      'challenge', 'disagree', 'handoff', 'summarize', 'conclude', 'close',
    ]);
    assert.deepEqual(PRESENTATION_INTERACTION_TYPES, [
      'click', 'double-click', 'hover', 'drag', 'scroll', 'zoom', 'input',
      'select', 'panel-reveal', 'navigate',
    ]);
  });

  it('normalizes multilingual quote anchors and hashes every cue mutation', () => {
    let first = createPresentationTimelineContract(fixture());
    let changed = structuredClone(fixture());
    changed.turns[1].cues[0].annotation.marker = 'box';
    let second = createPresentationTimelineContract(changed);

    assert.match(first.hash, /^presentation-timeline-v3:/);
    assert.notEqual(first.hash, second.hash);
    assert.equal(first.turns[0].cues[0].at.quote, 'поток адаптера');
  });

  it('rejects v2, authored milliseconds, unknown fields, invalid enums, and missing quotes', () => {
    assert.throws(() => normalizePresentationTimeline({ ...fixture(), contractVersion: 'presentation-timeline-v2' }), /unsupported presentation contract version/);
    let absolute = structuredClone(fixture());
    absolute.turns[0].renderCue = { startMs: 0 };
    assert.throws(() => normalizePresentationTimeline(absolute), /renderCue is not supported/);
    let unknown = structuredClone(fixture());
    unknown.turns[0].cues[0].mystery = true;
    assert.throws(() => normalizePresentationTimeline(unknown), /mystery is not supported/);
    let invalid = structuredClone(fixture());
    invalid.turns[1].cues[1].interaction.type = 'wait';
    assert.throws(() => normalizePresentationTimeline(invalid), /unsupported value "wait"/);
    let missing = structuredClone(fixture());
    missing.turns[0].cues[0].at.quote = 'несуществующая цитата';
    assert.throws(() => normalizePresentationTimeline(missing), /is absent from normalized turn text/);
  });

  it('supports non-adjacent prior replies and grades bounded closure', () => {
    let input = fixture();
    input.turns.push({
      id: 'summary',
      persona: 'guide',
      addressee: 'ops',
      dialogueAct: 'summarize',
      replyTo: 'open',
      text: 'Итак, поток начинается в диспетчере.',
      sourceRefs: [{ sourceId: 'graph', hash: 'sha256-graph', targetId: 'panel:graph' }],
      claims: [{ id: 'summary-flow', kind: 'conclusion', text: 'Поток начинается в диспетчере.', factRefs: ['flow'], evidenceRefs: ['graph'], targetRefs: ['panel:graph'] }],
      cues: [],
    });
    let timeline = createPresentationTimelineContract(input);
    let review = reviewPresentationTimeline(timeline, { requireDialogue: true, requireGrounding: true });
    assert.equal(timeline.turns[2].replyTo, 'open');
    assert.equal(review.issues.some((issue) => issue.code === 'dialogue-reply-missing'), false);
  });

  it('allows thread-initiating turns without reply links and requires cross-persona closure', () => {
    let input = fixture();
    input.turns = [
      { ...input.turns[0], id: 'intro', dialogueAct: 'open', text: 'Начнем с потока адаптера.', cues: [] },
      { ...input.turns[0], id: 'question', persona: 'ops', addressee: 'guide', text: 'Где начинается поток адаптера?', cues: [] },
      { ...input.turns[1], id: 'response', persona: 'guide', addressee: 'ops', replyTo: 'question', cues: [] },
    ];
    let review = reviewPresentationTimeline(createPresentationTimelineContract(input), { requireDialogue: true });
    assert.equal(review.issues.some((issue) => issue.code === 'dialogue-reply-missing'), false);
    assert.equal(review.issues.some((issue) => issue.code === 'dialogue-question-unanswered'), false);

    input.turns[2].persona = 'ops';
    let selfAnswer = reviewPresentationTimeline(createPresentationTimelineContract(input), { requireDialogue: true });
    assert.equal(selfAnswer.issues.some((issue) => issue.code === 'dialogue-question-unanswered'), true);
  });
});

describe('workspace aligned sequence v2', () => {
  it('resolves every turn and cue against one media identity with provenance', () => {
    let timeline = createPresentationTimelineContract(fixture());
    let sequence = createPresentationAlignedSequence(timeline, {
      media: { hash: 'sha256-audio', durationMs: 4200, locale: 'ru-RU' },
      turns: [
        {
          startMs: 0,
          endMs: 1800,
          speaker: timeline.turns[0].persona,
          transcript: timeline.turns[0].text,
          words: [
            { text: 'Где', startMs: 0, endMs: 250 },
            { text: 'начинается', startMs: 250, endMs: 700 },
            { text: 'поток', startMs: 700, endMs: 1000 },
            { text: 'адаптера', startMs: 1000, endMs: 1500 },
          ],
        },
        {
          startMs: 1900,
          endMs: 4200,
          speaker: timeline.turns[1].persona,
          transcript: timeline.turns[1].text,
          words: [
            { text: 'Поток', startMs: 1900, endMs: 2200 },
            { text: 'начинается', startMs: 2200, endMs: 2600 },
            { text: 'в', startMs: 2600, endMs: 2700 },
            { text: 'диспетчере', startMs: 2700, endMs: 3200 },
            { text: 'и', startMs: 3200, endMs: 3300 },
            { text: 'проходит', startMs: 3300, endMs: 3600 },
            { text: 'через', startMs: 3600, endMs: 3800 },
            { text: 'адаптер', startMs: 3800, endMs: 4100 },
          ],
        },
      ],
    });

    assert.equal(PRESENTATION_ALIGNED_SEQUENCE_VERSION, 'workspace-aligned-sequence-v2');
    assert.equal(sequence.contractVersion, PRESENTATION_ALIGNED_SEQUENCE_VERSION);
    assert.equal(sequence.timelineHash, timeline.hash);
    assert.equal(sequence.turns.length, timeline.turns.length);
    assert.equal(sequence.events.length, timeline.turns.reduce((count, turn) => count + turn.cues.length, 0));
    assert.equal(sequence.events[0].cueId, '0.0');
    assert.equal(sequence.events.every((event) => ['exact', 'occurrence', 'fuzzy', 'proportional'].includes(event.resolution)), true);
    assert.equal(validatePresentationAlignedSequence(sequence, timeline), sequence);
    assert.throws(
      () => validatePresentationAlignedSequence({ ...sequence, contractVersion: 'workspace-aligned-sequence-v1' }, timeline),
      /unsupported aligned sequence version/,
    );
    assert.throws(() => validatePresentationAlignedSequence({ ...sequence, timelineHash: 'stale' }, timeline), /timelineHash/);
    assert.throws(
      () => validatePresentationAlignedSequence({ ...sequence, events: [{ ...sequence.events[0], cueId: '9.9' }, ...sequence.events.slice(1)] }, timeline),
      /cueId is invalid/,
    );
    assert.throws(
      () => validatePresentationAlignedSequence({ ...sequence, turns: [{ ...sequence.turns[0], extra: true }, ...sequence.turns.slice(1)] }, timeline),
      /extra is not supported/,
    );
    assert.throws(
      () => createPresentationAlignedSequence(timeline, {
        media: { hash: 'sha256-audio', durationMs: 4200, locale: 'ru-RU' },
        turns: [
          { startMs: 0, endMs: 1800, speaker: '', transcript: timeline.turns[0].text, words: [] },
          { startMs: 1900, endMs: 4200, speaker: timeline.turns[1].persona, transcript: timeline.turns[1].text, words: [] },
        ],
      }),
      /speaker must be nonempty/,
    );
    assert.throws(
      () => createPresentationAlignedSequence(timeline, {
        media: { hash: 'sha256-audio', durationMs: 4200, locale: 'ru-RU' },
        turns: [
          { startMs: 0, endMs: 1800, speaker: timeline.turns[0].persona, transcript: 'Подменённый текст.', words: [] },
          { startMs: 1900, endMs: 4200, speaker: timeline.turns[1].persona, transcript: timeline.turns[1].text, words: [] },
        ],
      }),
      /transcript does not match the authored turn/,
    );
  });
});
