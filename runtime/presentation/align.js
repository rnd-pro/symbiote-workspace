import { computeIntegrity } from '../../schema/canonical-json.js';
import { createPresentationTimelineContract } from './contract.js';

export const PRESENTATION_ALIGNED_SEQUENCE_VERSION = 'workspace-aligned-sequence-v1';
export const PRESENTATION_ALIGNMENT_RESOLUTIONS = Object.freeze(['exact', 'occurrence', 'fuzzy', 'proportional']);

function text(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) throw new TypeError(`${path} must be an integer between ${min} and ${max}`);
  return value;
}

function quoteOffsets(haystack, needle) {
  let offsets = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    let offset = haystack.indexOf(needle, cursor);
    if (offset < 0) break;
    offsets.push(offset);
    cursor = offset + Math.max(1, needle.length);
  }
  return offsets;
}

function tokenList(value) {
  return text(value).toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function tokenSimilarity(left, right) {
  if (!left.length || !right.length) return 0;
  let same = left.reduce((count, token, index) => count + (token === right[index] ? 1 : 0), 0);
  return same / Math.max(left.length, right.length);
}

/**
 * The optional declaration of who is speaking.
 *
 * Absent is a legal state and answers null — never undefined and never an error.
 * It is read with `?.` everywhere below, because a null that gets dereferenced
 * turns a legal sequence into a TypeError instead of a verdict.
 */
function normalizeVoice(value, turnCount, path = 'aligned sequence voice') {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  let mode = text(value.mode);
  if (mode === 'single') {
    for (let key of Object.keys(value)) if (!['mode', 'speakerId'].includes(key)) throw new TypeError(`${path}.${key} is not supported`);
    let speakerId = text(value.speakerId);
    if (!speakerId) throw new TypeError(`${path}.speakerId must be nonempty`);
    return { mode, speakerId };
  }
  if (mode === 'dialogue') {
    for (let key of Object.keys(value)) if (!['mode', 'speakerIds'].includes(key)) throw new TypeError(`${path}.${key} is not supported`);
    if (!Array.isArray(value.speakerIds) || value.speakerIds.length !== turnCount) {
      throw new TypeError(`${path} dialogue voice requires one speakerId per turn`);
    }
    let speakerIds = value.speakerIds.map((speakerId, index) => {
      let normalized = text(speakerId);
      if (!normalized) throw new TypeError(`${path}.speakerIds[${index}] must be nonempty`);
      return normalized;
    });
    return { mode, speakerIds };
  }
  throw new TypeError(`${path}.mode is unsupported`);
}

/**
 * Who owns this turn's voice.
 *
 * A persona and a physical voice may differ, so the declared voice wins when it
 * is present: a single-speaker sequence is owned by that speaker, a dialogue by
 * the speaker listed for this turn. With no declaration the authored persona is
 * the owner. That last branch is what stops dropping `voice` from switching the
 * check off: without it the check would be skipped entirely.
 */
function expectedSpeaker(voice, turn, turnIndex) {
  if (voice?.mode === 'single') return voice.speakerId;
  if (voice?.mode === 'dialogue') return voice.speakerIds[turnIndex];
  return text(turn?.persona);
}

/**
 * The evidence a turn may carry, checked whenever it is carried and dropped
 * whenever it is not — so a sequence that never claimed evidence keeps the exact
 * shape and hash it had before evidence was retained.
 *
 * Word timings are validated here rather than where anchors resolve: an anchor
 * that happens to resolve proportionally must not turn an invalid `words` into an
 * accepted one.
 */
function normalizeTurnEvidence(alignment, { voice, turn, turnIndex, startMs, endMs, path }) {
  let evidence = {};

  if (alignment.speaker !== undefined) {
    let speaker = text(alignment.speaker);
    if (!speaker) throw new TypeError(`${path}.speaker must be nonempty`);
    let owner = expectedSpeaker(voice, turn, turnIndex);
    if (!owner) throw new TypeError(`${path}.speaker cannot be checked: neither a voice nor a persona is declared`);
    if (speaker !== owner) throw new TypeError(`${path}.speaker does not match the declared voice ownership`);
    evidence.speaker = speaker;
  }

  if (alignment.transcript !== undefined) {
    if (typeof alignment.transcript !== 'string') throw new TypeError(`${path}.transcript must be a string`);
    // Compared after the same normalisation the authored text gets, so a
    // difference in whitespace is not reported as different evidence.
    let transcript = text(alignment.transcript);
    if (transcript !== text(turn?.text)) throw new TypeError(`${path}.transcript does not match the authored turn`);
    evidence.transcript = alignment.transcript;
  }

  if (alignment.words !== undefined) {
    if (!Array.isArray(alignment.words)) throw new TypeError(`${path}.words must be an array`);
    evidence.words = alignment.words.map((word, wordIndex) => {
      if (!word || typeof word !== 'object' || Array.isArray(word)) throw new TypeError(`${path}.words[${wordIndex}] must be an object`);
      for (let key of Object.keys(word)) if (!['text', 'startMs', 'endMs'].includes(key)) throw new TypeError(`${path}.words[${wordIndex}].${key} is not supported`);
      // Containment, not overlap. A word is evidence about this turn, so it has
      // to sit inside the turn: bounding the start by the turn's own start is
      // what makes that true. Checking only that the two overlap accepted a word
      // beginning 400ms before the turn it claims to be evidence for.
      let wordStart = integer(word.startMs, `${path}.words[${wordIndex}].startMs`, { min: startMs, max: endMs });
      let wordEnd = integer(word.endMs, `${path}.words[${wordIndex}].endMs`, { min: wordStart, max: endMs });
      return { text: text(word.text), startMs: wordStart, endMs: wordEnd };
    });
  }

  return evidence;
}

function wordTimingIndex(turnAlignment) {
  let words = Array.isArray(turnAlignment.words) ? turnAlignment.words : [];
  return words.map((word, index) => ({
    text: text(word.text),
    startMs: integer(word.startMs, `alignment.words[${index}].startMs`),
    endMs: integer(word.endMs, `alignment.words[${index}].endMs`),
  }));
}

function resolveSpeechAnchor(anchor, authoredText, alignment, turnStartMs, turnEndMs) {
  let words = wordTimingIndex(alignment);
  let quoteTokens = tokenList(anchor.quote);
  let transcriptTokens = words.flatMap((word, wordIndex) => tokenList(word.text).map((token) => ({ token, wordIndex })));
  let matches = [];
  for (let index = 0; index <= transcriptTokens.length - quoteTokens.length; index += 1) {
    let candidate = transcriptTokens.slice(index, index + quoteTokens.length).map((item) => item.token);
    if (candidate.every((token, tokenIndex) => token === quoteTokens[tokenIndex])) matches.push(index);
  }
  let matchIndex = matches[anchor.occurrence - 1];
  if (matchIndex !== undefined) {
    let token = anchor.edge === 'end'
      ? transcriptTokens[matchIndex + quoteTokens.length - 1]
      : transcriptTokens[matchIndex];
    let word = words[token.wordIndex];
    return { timeMs: (anchor.edge === 'end' ? word.endMs : word.startMs) + anchor.offsetMs, resolution: matches.length === 1 ? 'exact' : 'occurrence' };
  }

  let best = null;
  for (let index = 0; index <= transcriptTokens.length - quoteTokens.length; index += 1) {
    let candidate = transcriptTokens.slice(index, index + quoteTokens.length).map((item) => item.token);
    let score = tokenSimilarity(quoteTokens, candidate);
    if (!best || score > best.score) best = { index, score };
  }
  if (best?.score >= 0.6 && words.length) {
    let token = anchor.edge === 'end'
      ? transcriptTokens[best.index + quoteTokens.length - 1]
      : transcriptTokens[best.index];
    let word = words[token.wordIndex];
    return { timeMs: (anchor.edge === 'end' ? word.endMs : word.startMs) + anchor.offsetMs, resolution: 'fuzzy' };
  }

  let normalizedAuthored = text(authoredText);
  let offsets = quoteOffsets(normalizedAuthored, text(anchor.quote));
  let sourceOffset = offsets[anchor.occurrence - 1] ?? 0;
  if (anchor.edge === 'end') sourceOffset += text(anchor.quote).length;
  let progress = normalizedAuthored.length ? sourceOffset / normalizedAuthored.length : 0;
  return {
    timeMs: Math.round(turnStartMs + (turnEndMs - turnStartMs) * progress) + anchor.offsetMs,
    resolution: 'proportional',
  };
}

function resolveAnchor(anchor, authoredText, alignment, turnStartMs, turnEndMs) {
  if (anchor.anchor === 'turn-start') return { timeMs: turnStartMs + anchor.offsetMs, resolution: 'exact' };
  if (anchor.anchor === 'turn-end') return { timeMs: turnEndMs + anchor.offsetMs, resolution: 'exact' };
  return resolveSpeechAnchor(anchor, authoredText, alignment, turnStartMs, turnEndMs);
}

function resolutionRank(value) {
  return PRESENTATION_ALIGNMENT_RESOLUTIONS.indexOf(value);
}

function normalizeMedia(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('aligned sequence media must be an object');
  for (let key of Object.keys(value)) if (!['hash', 'durationMs', 'locale'].includes(key)) throw new TypeError(`aligned sequence media.${key} is not supported`);
  let hash = text(value.hash);
  if (!hash) throw new TypeError('aligned sequence media.hash must be nonempty');
  return {
    hash,
    durationMs: integer(value.durationMs, 'aligned sequence media.durationMs', { min: 1 }),
    ...(value.locale ? { locale: text(value.locale) } : {}),
  };
}

export function createPresentationAlignedSequence(timelineInput = {}, input = {}) {
  let timeline = createPresentationTimelineContract(timelineInput);
  let media = normalizeMedia(input.media);
  let alignments = Array.isArray(input.turns) ? input.turns : [];
  if (alignments.length !== timeline.turns.length) throw new TypeError('aligned sequence requires one alignment for every authored turn');
  let voice = normalizeVoice(input.voice, alignments.length);
  let priorStartMs = -1;
  let turns = alignments.map((alignment, turnIndex) => {
    if (!alignment || typeof alignment !== 'object' || Array.isArray(alignment)) throw new TypeError(`aligned sequence turns[${turnIndex}] must be an object`);
    for (let key of Object.keys(alignment)) if (!['startMs', 'endMs', 'speaker', 'transcript', 'words'].includes(key)) throw new TypeError(`aligned sequence turns[${turnIndex}].${key} is not supported`);
    let startMs = integer(alignment.startMs, `aligned sequence turns[${turnIndex}].startMs`, { max: media.durationMs });
    let endMs = integer(alignment.endMs, `aligned sequence turns[${turnIndex}].endMs`, { min: startMs, max: media.durationMs });
    if (startMs < priorStartMs) throw new TypeError('aligned sequence turn spans must be monotonic');
    priorStartMs = startMs;
    // Same helper as the validator uses, so a sequence cannot be built here and
    // rejected there for the same field.
    let evidence = normalizeTurnEvidence(alignment, {
      voice,
      turn: timeline.turns[turnIndex],
      turnIndex,
      startMs,
      endMs,
      path: `aligned sequence turns[${turnIndex}]`,
    });
    // Absent evidence is left absent rather than materialised, so a sequence that
    // never claimed it keeps the shape and the hash it had before.
    return { turnIndex, startMs, endMs, ...evidence };
  });
  let events = [];
  for (let [turnIndex, turn] of timeline.turns.entries()) {
    let alignment = alignments[turnIndex];
    let span = turns[turnIndex];
    for (let [cueIndex, cue] of turn.cues.entries()) {
      let start = resolveAnchor(cue.at, turn.text, alignment, span.startMs, span.endMs);
      let end = cue.until
        ? resolveAnchor(cue.until, turn.text, alignment, span.startMs, span.endMs)
        : start;
      let startMs = Math.min(media.durationMs, Math.max(0, Math.round(start.timeMs)));
      let endMs = Math.min(media.durationMs, Math.max(startMs, Math.round(end.timeMs)));
      events.push({
        cueId: `${turnIndex}.${cueIndex}`,
        turnIndex,
        kind: cue.kind,
        startMs,
        endMs,
        resolution: resolutionRank(start.resolution) >= resolutionRank(end.resolution) ? start.resolution : end.resolution,
      });
    }
  }
  events.sort((left, right) => left.startMs - right.startMs || left.cueId.localeCompare(right.cueId));
  let sequence = {
    contractVersion: PRESENTATION_ALIGNED_SEQUENCE_VERSION,
    timelineHash: timeline.hash,
    media,
    turns,
    events,
    // Recorded only when one was declared, so a minimal sequence keeps the exact
    // shape and hash it had before evidence was retained.
    ...(voice ? { voice } : {}),
  };
  return { ...sequence, hash: `${PRESENTATION_ALIGNED_SEQUENCE_VERSION}:${computeIntegrity(sequence)}` };
}

export function validatePresentationAlignedSequence(value = {}, timelineInput = {}) {
  let timeline = createPresentationTimelineContract(timelineInput);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('aligned sequence must be an object');
  for (let key of Object.keys(value)) {
    if (!['contractVersion', 'timelineHash', 'media', 'voice', 'turns', 'events', 'hash'].includes(key)) {
      throw new TypeError(`aligned sequence.${key} is not supported`);
    }
  }
  if (value?.contractVersion !== PRESENTATION_ALIGNED_SEQUENCE_VERSION) throw new TypeError('unsupported aligned sequence version');
  if (value.timelineHash !== timeline.hash) throw new TypeError('aligned sequence timelineHash does not match authored timeline');
  let media = normalizeMedia(value.media);
  let voice = normalizeVoice(value.voice, timeline.turns.length);
  let expectedCueCount = timeline.turns.reduce((count, turn) => count + turn.cues.length, 0);
  if (!Array.isArray(value.turns) || value.turns.length !== timeline.turns.length) throw new TypeError('aligned sequence turn coverage is incomplete');
  if (!Array.isArray(value.events) || value.events.length !== expectedCueCount) throw new TypeError('aligned sequence cue coverage is incomplete');
  let priorStartMs = -1;
  for (let [index, span] of value.turns.entries()) {
    if (!span || typeof span !== 'object' || Array.isArray(span)) throw new TypeError(`aligned sequence turns[${index}] must be an object`);
    for (let key of Object.keys(span)) if (!['turnIndex', 'startMs', 'endMs', 'speaker', 'transcript', 'words'].includes(key)) throw new TypeError(`aligned sequence turns[${index}].${key} is not supported`);
    if (span.turnIndex !== index) throw new TypeError(`aligned sequence turns[${index}].turnIndex is invalid`);
    let startMs = integer(span.startMs, `aligned sequence turns[${index}].startMs`, { max: media.durationMs });
    let endMs = integer(span.endMs, `aligned sequence turns[${index}].endMs`, { min: startMs, max: media.durationMs });
    if (startMs < priorStartMs) throw new TypeError('aligned sequence turn spans must be monotonic');
    priorStartMs = startMs;
    normalizeTurnEvidence(span, {
      voice,
      turn: timeline.turns[index],
      turnIndex: index,
      startMs,
      endMs,
      path: `aligned sequence turns[${index}]`,
    });
  }
  let expectedEvents = new Map(timeline.turns.flatMap((turn, turnIndex) => turn.cues.map((cue, cueIndex) => [
    `${turnIndex}.${cueIndex}`,
    { turnIndex, kind: cue.kind },
  ])));
  let seen = new Set();
  let priorEvent = null;
  for (let [index, event] of value.events.entries()) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError(`aligned sequence events[${index}] must be an object`);
    for (let key of Object.keys(event)) if (!['cueId', 'turnIndex', 'kind', 'startMs', 'endMs', 'resolution'].includes(key)) throw new TypeError(`aligned sequence events[${index}].${key} is not supported`);
    let expected = expectedEvents.get(event.cueId);
    if (!expected || seen.has(event.cueId)) throw new TypeError(`aligned sequence events[${index}].cueId is invalid or duplicated`);
    if (event.turnIndex !== expected.turnIndex || event.kind !== expected.kind) throw new TypeError(`aligned sequence events[${index}] does not match its authored cue`);
    let startMs = integer(event.startMs, `aligned sequence events[${index}].startMs`, { max: media.durationMs });
    integer(event.endMs, `aligned sequence events[${index}].endMs`, { min: startMs, max: media.durationMs });
    if (!PRESENTATION_ALIGNMENT_RESOLUTIONS.includes(event.resolution)) throw new TypeError(`aligned sequence events[${index}].resolution is invalid`);
    if (priorEvent && (startMs < priorEvent.startMs || (startMs === priorEvent.startMs && event.cueId.localeCompare(priorEvent.cueId) < 0))) {
      throw new TypeError('aligned sequence events must be deterministically ordered');
    }
    priorEvent = event;
    seen.add(event.cueId);
  }
  // The declaration is part of what the hash covers, alongside the turns that
  // carry the evidence. A sequence whose evidence was swapped for evidence that
  // means the same thing still changes this digest, because the declaration
  // changes who owns the turn.
  let expectedHash = `${PRESENTATION_ALIGNED_SEQUENCE_VERSION}:${computeIntegrity({
    contractVersion: value.contractVersion,
    timelineHash: value.timelineHash,
    media,
    turns: value.turns,
    events: value.events,
    ...(value.voice === undefined ? {} : { voice: value.voice }),
  })}`;
  if (value.hash !== expectedHash) throw new TypeError('aligned sequence hash is stale');
  return value;
}
