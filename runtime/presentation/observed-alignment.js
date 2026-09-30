import { computeIntegrity } from '../../schema/canonical-json.js';
import { createPresentationTimelineContract } from './contract.js';

export const PRESENTATION_OBSERVED_ALIGNED_SEQUENCE_VERSION = 'workspace-aligned-sequence-v3';
export const PRESENTATION_TRANSCRIPT_WORD_ANCHORING_VERSION = 'workspace-transcript-word-anchoring-v1';

const ALIGNMENT_INPUT_KEYS = Object.freeze(['media', 'voice', 'observations']);
const MEDIA_KEYS = Object.freeze(['hash', 'durationMs', 'locale']);
const VOICE_KEYS = Object.freeze(['mode', 'speakerId']);
const OBSERVATION_KEYS = Object.freeze([
  'turnIndex',
  'startMs',
  'endMs',
  'transcript',
  'words',
]);
const WORD_KEYS = Object.freeze(['text', 'startMs', 'endMs']);
const SEQUENCE_KEYS = Object.freeze([
  'contractVersion',
  'timelineHash',
  'media',
  'voice',
  'turns',
  'events',
  'hash',
]);
const SEQUENCE_TURN_KEYS = Object.freeze([
  'turnIndex',
  'startMs',
  'endMs',
  'speaker',
  'transcript',
  'words',
]);

export class PresentationObservedAlignmentError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PresentationObservedAlignmentError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new PresentationObservedAlignmentError(code, message, details);
}

function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value, path) {
  if (!isObject(value)) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_INVALID',
      `${path} must be an object`,
      { path },
    );
  }
  return value;
}

function knownKeys(value, keys, path) {
  for (let key of Object.keys(value)) {
    if (!keys.includes(key)) {
      fail(
        'PRESENTATION_OBSERVED_ALIGNMENT_INVALID',
        `${path}.${key} is not supported by the observed-word alignment contract`,
        { path: `${path}.${key}` },
      );
    }
  }
}

function exactText(value, path, { identity = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_INVALID',
      `${path} must be nonempty text`,
      { path },
    );
  }
  if (value !== value.normalize('NFC')) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_INVALID',
      `${path} must already be NFC-normalized so its exact observed value can be retained`,
      { path },
    );
  }
  if (identity && value !== value.trim()) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_INVALID',
      `${path} must not contain leading or trailing whitespace`,
      { path },
    );
  }
  return value;
}

function completeInteger(value, path) {
  if (value === undefined || value === null) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_TIMING_INCOMPLETE',
      `${path} is required; observed timing cannot be synthesized`,
      { path },
    );
  }
  if (!Number.isInteger(value)) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_INVALID',
      `${path} must be an integer number of milliseconds`,
      { path, value },
    );
  }
  return value;
}

function tokenize(value) {
  return [...value.matchAll(/[\p{L}\p{N}]+/gu)].map((match, index) => ({
    index,
    text: match[0],
  }));
}

function comparisonKey(value) {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

function validateTimeline(timelineInput) {
  let timeline;
  try {
    timeline = createPresentationTimelineContract(timelineInput);
  } catch (error) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_TIMELINE_INVALID',
      `observed-word alignment requires a valid presentation-timeline-v3: ${error.message}`,
      { reason: error.message },
    );
  }
  if (typeof timelineInput?.hash !== 'string' || timelineInput.hash !== timeline.hash) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_TIMELINE_STALE',
      'observed-word alignment requires the current canonical timeline hash',
      {
        expectedHash: timeline.hash,
        receivedHash: timelineInput?.hash ?? null,
      },
    );
  }
  return timeline;
}

function normalizeMedia(value) {
  let source = object(value, 'observed alignment media');
  knownKeys(source, MEDIA_KEYS, 'observed alignment media');
  let hash = exactText(source.hash, 'observed alignment media.hash', { identity: true });
  let durationMs = completeInteger(source.durationMs, 'observed alignment media.durationMs');
  if (durationMs < 1) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_TIMING_OUT_OF_RANGE',
      'observed alignment media.durationMs must be greater than zero',
      { path: 'observed alignment media.durationMs', durationMs },
    );
  }
  let locale = exactText(source.locale, 'observed alignment media.locale', { identity: true });
  return { hash, durationMs, locale };
}

function normalizeVoice(value) {
  if (value === undefined) return null;
  let source = object(value, 'observed alignment voice');
  knownKeys(source, VOICE_KEYS, 'observed alignment voice');
  if (source.mode !== 'single') {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_INVALID',
      'observed alignment voice.mode must be "single" when voice identity is supplied',
      { path: 'observed alignment voice.mode', value: source.mode ?? null },
    );
  }
  let speakerId = exactText(
    source.speakerId,
    'observed alignment voice.speakerId',
    { identity: true },
  );
  return { mode: 'single', speakerId };
}

function normalizeWord(value, wordIndex, turnIndex, turnStartMs, turnEndMs, priorEndMs) {
  let path = `observed alignment observations[${turnIndex}].words[${wordIndex}]`;
  let source = object(value, path);
  knownKeys(source, WORD_KEYS, path);
  let wordText = exactText(source.text, `${path}.text`);
  let startMs = completeInteger(source.startMs, `${path}.startMs`);
  let endMs = completeInteger(source.endMs, `${path}.endMs`);
  if (startMs < turnStartMs || endMs > turnEndMs || endMs <= startMs) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_TIMING_OUT_OF_RANGE',
      `${path} must have a positive interval inside its observed turn`,
      { path, startMs, endMs, turnStartMs, turnEndMs },
    );
  }
  if (priorEndMs !== null && startMs < priorEndMs) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_TIMING_OVERLAP',
      `${path} overlaps the previous observed word interval`,
      { path, startMs, previousEndMs: priorEndMs },
    );
  }
  let tokens = tokenize(wordText);
  if (!tokens.length) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_TRANSCRIPT_WORD_MISMATCH',
      `${path}.text must contain at least one Unicode letter or number token`,
      { path: `${path}.text`, wordText },
    );
  }
  return {
    word: { text: wordText, startMs, endMs },
    tokens,
  };
}

function createOperation(operation, authoredToken, recognizedToken, words) {
  let observedWord = recognizedToken === null
    ? null
    : { index: recognizedToken.wordIndex, ...words[recognizedToken.wordIndex] };
  return {
    operation,
    authoredToken: authoredToken === null
      ? null
      : { index: authoredToken.index, text: authoredToken.text },
    recognizedToken: recognizedToken === null
      ? null
      : {
          index: recognizedToken.index,
          text: recognizedToken.text,
          wordIndex: recognizedToken.wordIndex,
        },
    observedWord,
  };
}

function createOperations(authoredTokens, recognizedTokens, words) {
  let rows = authoredTokens.length + 1;
  let columns = recognizedTokens.length + 1;
  let distances = Array.from({ length: rows }, () => new Array(columns).fill(0));
  for (let row = 0; row < rows; row += 1) distances[row][0] = row;
  for (let column = 0; column < columns; column += 1) distances[0][column] = column;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      let authored = authoredTokens[row - 1];
      let recognized = recognizedTokens[column - 1];
      if (authored.comparison === recognized.comparison) {
        distances[row][column] = distances[row - 1][column - 1];
      } else {
        distances[row][column] = Math.min(
          distances[row - 1][column - 1] + 1,
          distances[row - 1][column] + 1,
          distances[row][column - 1] + 1,
        );
      }
    }
  }

  let row = authoredTokens.length;
  let column = recognizedTokens.length;
  let operations = [];
  while (row > 0 || column > 0) {
    let authored = row > 0 ? authoredTokens[row - 1] : null;
    let recognized = column > 0 ? recognizedTokens[column - 1] : null;
    if (
      authored
      && recognized
      && authored.comparison === recognized.comparison
      && distances[row][column] === distances[row - 1][column - 1]
    ) {
      operations.push(createOperation('match', authored, recognized, words));
      row -= 1;
      column -= 1;
    } else if (
      authored
      && recognized
      && distances[row][column] === distances[row - 1][column - 1] + 1
    ) {
      operations.push(createOperation('substitute', authored, recognized, words));
      row -= 1;
      column -= 1;
    } else if (authored && distances[row][column] === distances[row - 1][column] + 1) {
      operations.push(createOperation('delete', authored, null, words));
      row -= 1;
    } else {
      operations.push(createOperation('insert', null, recognized, words));
      column -= 1;
    }
  }
  return operations.reverse();
}

function createMetrics(authoredTokenCount, recognizedTokenCount, timedTokenCount, editDistance) {
  let denominator = Math.max(authoredTokenCount, recognizedTokenCount);
  return {
    authoredTokenCount,
    recognizedTokenCount,
    timedTokenCount,
    editDistance,
    wer: authoredTokenCount === 0
      ? (recognizedTokenCount === 0 ? 0 : 1)
      : editDistance / authoredTokenCount,
    editSimilarity: denominator === 0 ? 1 : 1 - (editDistance / denominator),
    exactCorrespondence: editDistance === 0,
    timingCoverage: recognizedTokenCount === 0 ? 1 : timedTokenCount / recognizedTokenCount,
  };
}

function normalizeObservation(
  value,
  turn,
  turnIndex,
  media,
  voice,
  priorTurnEndMs,
) {
  let path = `observed alignment observations[${turnIndex}]`;
  let source = object(value, path);
  knownKeys(source, OBSERVATION_KEYS, path);
  if (source.turnIndex !== turnIndex) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_TURN_COVERAGE',
      `${path}.turnIndex must equal ${turnIndex}; observations must cover authored turns in order`,
      { path: `${path}.turnIndex`, expected: turnIndex, received: source.turnIndex ?? null },
    );
  }
  let startMs = completeInteger(source.startMs, `${path}.startMs`);
  let endMs = completeInteger(source.endMs, `${path}.endMs`);
  if (startMs < 0 || endMs > media.durationMs || endMs <= startMs) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_TIMING_OUT_OF_RANGE',
      `${path} must have a positive interval inside the exact media duration`,
      { path, startMs, endMs, mediaDurationMs: media.durationMs },
    );
  }
  if (priorTurnEndMs !== null && startMs < priorTurnEndMs) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_TIMING_OVERLAP',
      `${path} overlaps the previous observed turn interval`,
      { path, startMs, previousEndMs: priorTurnEndMs },
    );
  }
  let transcript = exactText(source.transcript, `${path}.transcript`);
  if (!Array.isArray(source.words) || source.words.length === 0) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_TIMING_INCOMPLETE',
      `${path}.words must contain every timed observed word`,
      { path: `${path}.words` },
    );
  }
  let words = [];
  let recognizedTokens = [];
  let priorWordEndMs = null;
  for (let [wordIndex, wordInput] of source.words.entries()) {
    let normalized = normalizeWord(
      wordInput,
      wordIndex,
      turnIndex,
      startMs,
      endMs,
      priorWordEndMs,
    );
    words.push(normalized.word);
    for (let token of normalized.tokens) {
      recognizedTokens.push({
        index: recognizedTokens.length,
        text: token.text,
        comparison: comparisonKey(token.text),
        wordIndex,
      });
    }
    priorWordEndMs = normalized.word.endMs;
  }
  let transcriptTokens = tokenize(transcript);
  let mismatchIndex = Math.max(transcriptTokens.length, recognizedTokens.length);
  for (let index = 0; index < mismatchIndex; index += 1) {
    if (transcriptTokens[index]?.text !== recognizedTokens[index]?.text) {
      fail(
        'PRESENTATION_OBSERVED_ALIGNMENT_TRANSCRIPT_WORD_MISMATCH',
        `${path}.transcript tokens must exactly equal the flattened observed-word tokens`,
        {
          path,
          tokenIndex: index,
          transcriptToken: transcriptTokens[index]?.text ?? null,
          observedWordToken: recognizedTokens[index]?.text ?? null,
        },
      );
    }
  }
  let authoredTokens = tokenize(turn.text).map((token) => ({
    ...token,
    comparison: comparisonKey(token.text),
  }));
  let operations = createOperations(authoredTokens, recognizedTokens, words);
  let editDistance = operations.reduce(
    (count, operation) => count + (operation.operation === 'match' ? 0 : 1),
    0,
  );
  let metrics = createMetrics(
    authoredTokens.length,
    recognizedTokens.length,
    recognizedTokens.length,
    editDistance,
  );
  let speaker = voice?.speakerId ?? turn.persona;
  return {
    sequenceTurn: {
      turnIndex,
      startMs,
      endMs,
      speaker,
      transcript,
      words,
    },
    anchoring: {
      contractVersion: PRESENTATION_TRANSCRIPT_WORD_ANCHORING_VERSION,
      turnIndex,
      authored: {
        text: turn.text,
        tokens: authoredTokens.map((token) => ({ index: token.index, text: token.text })),
      },
      observed: {
        transcript,
        tokens: recognizedTokens.map((token) => ({
          index: token.index,
          text: token.text,
          wordIndex: token.wordIndex,
        })),
        words,
      },
      operations,
      metrics,
    },
    metrics,
  };
}

function aggregateMetrics(anchorings) {
  let totals = anchorings.reduce((result, anchoring) => ({
    authoredTokenCount: result.authoredTokenCount + anchoring.metrics.authoredTokenCount,
    recognizedTokenCount: result.recognizedTokenCount + anchoring.metrics.recognizedTokenCount,
    timedTokenCount: result.timedTokenCount + anchoring.metrics.timedTokenCount,
    editDistance: result.editDistance + anchoring.metrics.editDistance,
  }), {
    authoredTokenCount: 0,
    recognizedTokenCount: 0,
    timedTokenCount: 0,
    editDistance: 0,
  });
  return createMetrics(
    totals.authoredTokenCount,
    totals.recognizedTokenCount,
    totals.timedTokenCount,
    totals.editDistance,
  );
}

export function createPresentationObservedAlignment(timelineInput, input) {
  let timeline = validateTimeline(timelineInput);
  let source = object(input, 'observed alignment');
  knownKeys(source, ALIGNMENT_INPUT_KEYS, 'observed alignment');
  let media = normalizeMedia(source.media);
  let voice = normalizeVoice(source.voice);
  if (!Array.isArray(source.observations) || source.observations.length !== timeline.turns.length) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_TURN_COVERAGE',
      'observed alignment requires exactly one ordered observation for every authored turn',
      {
        expectedCount: timeline.turns.length,
        receivedCount: Array.isArray(source.observations) ? source.observations.length : null,
      },
    );
  }
  let turns = [];
  let anchorings = [];
  let priorTurnEndMs = null;
  for (let [turnIndex, observation] of source.observations.entries()) {
    let normalized = normalizeObservation(
      observation,
      timeline.turns[turnIndex],
      turnIndex,
      media,
      voice,
      priorTurnEndMs,
    );
    turns.push(normalized.sequenceTurn);
    anchorings.push(normalized.anchoring);
    priorTurnEndMs = normalized.sequenceTurn.endMs;
  }
  let sequenceProjection = {
    contractVersion: PRESENTATION_OBSERVED_ALIGNED_SEQUENCE_VERSION,
    timelineHash: timeline.hash,
    media,
    ...(voice ? { voice } : {}),
    turns,
    events: [],
  };
  return {
    sequence: { ...sequenceProjection, hash: computeIntegrity(sequenceProjection) },
    anchorings,
    metrics: aggregateMetrics(anchorings),
  };
}

export function validatePresentationObservedAlignedSequence(value, timelineInput) {
  let timeline = validateTimeline(timelineInput);
  let source = object(value, 'observed aligned sequence');
  knownKeys(source, SEQUENCE_KEYS, 'observed aligned sequence');
  if (source.contractVersion !== PRESENTATION_OBSERVED_ALIGNED_SEQUENCE_VERSION) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_INVALID',
      `observed aligned sequence.contractVersion must be ${PRESENTATION_OBSERVED_ALIGNED_SEQUENCE_VERSION}`,
      { value: source.contractVersion ?? null },
    );
  }
  if (source.timelineHash !== timeline.hash) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_TIMELINE_STALE',
      'observed aligned sequence targets a stale authored timeline',
      { expectedHash: timeline.hash, receivedHash: source.timelineHash ?? null },
    );
  }
  let media = normalizeMedia(source.media);
  let voice = normalizeVoice(source.voice);
  if (!Array.isArray(source.turns) || source.turns.length !== timeline.turns.length) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_TURN_COVERAGE',
      'observed aligned sequence requires exactly one turn for every authored turn',
      {
        expectedCount: timeline.turns.length,
        receivedCount: Array.isArray(source.turns) ? source.turns.length : null,
      },
    );
  }
  let turns = [];
  let priorTurnEndMs = null;
  for (let [turnIndex, turnValue] of source.turns.entries()) {
    let path = `observed aligned sequence.turns[${turnIndex}]`;
    let turnSource = object(turnValue, path);
    knownKeys(turnSource, SEQUENCE_TURN_KEYS, path);
    let expectedSpeaker = voice?.speakerId ?? timeline.turns[turnIndex].persona;
    if (turnSource.speaker !== expectedSpeaker) {
      fail(
        'PRESENTATION_OBSERVED_ALIGNMENT_INVALID',
        `${path}.speaker does not match the declared voice or authored persona`,
        { path: `${path}.speaker`, expected: expectedSpeaker, received: turnSource.speaker ?? null },
      );
    }
    let normalized = normalizeObservation(
      {
        turnIndex: turnSource.turnIndex,
        startMs: turnSource.startMs,
        endMs: turnSource.endMs,
        transcript: turnSource.transcript,
        words: turnSource.words,
      },
      timeline.turns[turnIndex],
      turnIndex,
      media,
      voice,
      priorTurnEndMs,
    );
    turns.push(normalized.sequenceTurn);
    priorTurnEndMs = normalized.sequenceTurn.endMs;
  }
  if (!Array.isArray(source.events) || source.events.length !== 0) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_INVALID',
      'observed aligned sequence.events must be an empty array; cue timing is not pre-resolved',
      { path: 'observed aligned sequence.events' },
    );
  }
  let sequenceProjection = {
    contractVersion: source.contractVersion,
    timelineHash: source.timelineHash,
    media,
    ...(voice ? { voice } : {}),
    turns,
    events: [],
  };
  let expectedHash = computeIntegrity(sequenceProjection);
  if (source.hash !== expectedHash) {
    fail(
      'PRESENTATION_OBSERVED_ALIGNMENT_SEQUENCE_STALE',
      'observed aligned sequence hash is stale; regenerate it from exact observed evidence',
      { expectedHash, receivedHash: source.hash ?? null },
    );
  }
  return value;
}
