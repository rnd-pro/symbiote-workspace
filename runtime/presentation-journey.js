/**
 * Portable presentation journey contract.
 *
 * A journey is the portable record of one live source execution, normalized so a
 * renderer can replay it deterministically without re-running the model. The
 * record preserves each observed `sourceOffsetMs` and independently declares a
 * watchable `presentationOffsetMs` through an explicit, monotonic time map: idle
 * backend waits may be compressed, while operator typing, workspace transitions,
 * and UI animation stay at real-time rate. Rendering replays this one accepted
 * record, pinned by its canonical `contentHash`.
 *
 * The contract is host-agnostic. Concrete event shapes, tool names, resource
 * types, and selectors are the consumer's concern: semantic action names are
 * supplied as an allowlist, resources are content-addressed, and every string is
 * scanned so credentials, session ids, URLs, host addresses, absolute paths, and
 * private keys cannot enter the payload.
 *
 * @module symbiote-workspace/runtime/presentation-journey
 */

import { computeIntegrity, isIntegrityString } from '../schema/canonical-json.js';
import { assertPortableValue } from './portable-value.js';

export const PRESENTATION_JOURNEY_SCHEMA_VERSION = 'workspace-presentation-journey-v1';

export const PRESENTATION_JOURNEY_PROVENANCE = Object.freeze([
  'operator-input',
  'tool-progress',
  'resource-result',
  'assistant-text',
]);

export const PRESENTATION_JOURNEY_OUTCOMES = Object.freeze([
  'completed',
  'soft-timeout',
  'hard-timeout',
  'error',
  'canceled',
]);

const PROVENANCE_SET = new Set(PRESENTATION_JOURNEY_PROVENANCE);
const OUTCOME_SET = new Set(PRESENTATION_JOURNEY_OUTCOMES);

// One local day bounds every offset and duration so overflow, drift, and absurd
// values fail closed instead of poisoning the time map.
const MAX_OFFSET_MS = 86_400_000;

// Superset of the shared private-key scan: a recorded chat journey must also
// reject cookies, bearer/authorization material, chain-of-thought/reasoning
// dumps, and private DOM selector or element identity anywhere in free values.
const JOURNEY_SECRET_KEY_PATTERN =
  /(?:token|secret|password|credential|api[-_]?key|samplePath|session[-_]?id|cookie|bearer|authorization|reasoning|chain[-_]?of[-_]?thought|scratchpad|selector|xpath|elementId)/i;

const TOP_LEVEL_KEYS = new Set(['schemaVersion', 'id', 'contentHash', 'source', 'actionNames', 'events', 'outcome', 'timing']);
const SOURCE_KEYS = new Set(['surfaceId', 'routePath', 'locale', 'contextHash']);
const EVENT_KEYS = new Set(['seq', 'provenance', 'sourceOffsetMs', 'presentationOffsetMs', 'action', 'resource', 'input', 'text', 'replayData']);
const INPUT_KEYS = new Set(['text', 'cadence', 'submitOffsetMs']);
const CADENCE_KEYS = new Set(['offsetMs', 'length']);
const RESOURCE_KEYS = new Set(['id', 'resultHash']);
const TIMING_KEYS = new Set(['sourceDurationMs', 'presentationDurationMs', 'segments']);
const SEGMENT_KEYS = new Set(['sourceStartMs', 'sourceEndMs', 'presentationStartMs', 'presentationEndMs']);

const ACTION_NAME_PATTERN = /^[a-z0-9]+(?:[-_.:][a-z0-9]+)*$/i;
const RESOURCE_ID_PATTERN = /^[a-z0-9]+(?:[-_.:/][a-z0-9]+)*$/i;

const PROVENANCE_PAYLOADS = Object.freeze({
  'operator-input': { required: ['input'], forbidden: ['action', 'resource', 'text', 'replayData'] },
  'tool-progress': { required: ['action'], forbidden: ['input', 'text'] },
  'resource-result': { required: ['action', 'resource'], forbidden: ['input', 'text'] },
  'assistant-text': { required: ['text'], forbidden: ['action', 'resource', 'input', 'replayData'] },
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function assertObject(value, path) {
  if (!isObject(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function assertKnownKeys(value, keys, path) {
  for (let key of Object.keys(assertObject(value, path))) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported by ${PRESENTATION_JOURNEY_SCHEMA_VERSION}`);
  }
}

function singleLineText(value, path) {
  let normalized = String(value ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) throw new TypeError(`${path} must be nonempty text`);
  return normalized;
}

function integer(value, path, { min = 0, max = MAX_OFFSET_MS } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${path} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function integrity(value, path) {
  if (!isIntegrityString(value)) throw new TypeError(`${path} must be a sha256 integrity string`);
  return value;
}

function portableToken(value, pattern, path) {
  let token = singleLineText(value, path);
  if (!pattern.test(token)) throw new TypeError(`${path} must be a portable identifier`);
  return token;
}

function normalizeActionNames(value, path) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  let names = value.map((item, index) => portableToken(item, ACTION_NAME_PATTERN, `${path}[${index}]`));
  return [...new Set(names)].sort();
}

function normalizeSource(value) {
  let source = assertObject(value, 'journey.source');
  assertKnownKeys(source, SOURCE_KEYS, 'journey.source');
  let routePath = singleLineText(source.routePath, 'journey.source.routePath');
  if (!routePath.startsWith('/') || routePath.includes('?') || routePath.includes('#') || routePath.includes('://')) {
    throw new TypeError('journey.source.routePath must be a path without URL search or hash');
  }
  return {
    surfaceId: portableToken(source.surfaceId, RESOURCE_ID_PATTERN, 'journey.source.surfaceId'),
    routePath,
    locale: singleLineText(source.locale, 'journey.source.locale'),
    contextHash: integrity(source.contextHash, 'journey.source.contextHash'),
  };
}

function normalizeCadence(value, textLength, path) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${path} must be a nonempty array`);
  let priorOffset = -1;
  let priorLength = 0;
  let cadence = value.map((raw, index) => {
    let stepPath = `${path}[${index}]`;
    let step = assertObject(raw, stepPath);
    assertKnownKeys(step, CADENCE_KEYS, stepPath);
    let offsetMs = integer(step.offsetMs, `${stepPath}.offsetMs`);
    let length = integer(step.length, `${stepPath}.length`, { min: 1, max: textLength });
    if (offsetMs < priorOffset) throw new TypeError(`${stepPath}.offsetMs must be monotonic`);
    if (length <= priorLength) throw new TypeError(`${stepPath}.length must strictly increase`);
    priorOffset = offsetMs;
    priorLength = length;
    return { offsetMs, length };
  });
  if (priorLength !== textLength) throw new TypeError(`${path} must end at the full input length`);
  return cadence;
}

function normalizeOperatorInput(value, path) {
  let input = assertObject(value, path);
  assertKnownKeys(input, INPUT_KEYS, path);
  let text = singleLineText(input.text, `${path}.text`);
  let cadence = normalizeCadence(input.cadence, Array.from(text).length, `${path}.cadence`);
  let submitOffsetMs = integer(input.submitOffsetMs, `${path}.submitOffsetMs`);
  if (submitOffsetMs < cadence[cadence.length - 1].offsetMs) {
    throw new TypeError(`${path}.submitOffsetMs must not precede the last keystroke`);
  }
  return { text, cadence, submitOffsetMs };
}

function normalizeResource(value, path) {
  let resource = assertObject(value, path);
  assertKnownKeys(resource, RESOURCE_KEYS, path);
  return {
    id: portableToken(resource.id, RESOURCE_ID_PATTERN, `${path}.id`),
    resultHash: integrity(resource.resultHash, `${path}.resultHash`),
  };
}

function assertProvenancePayload(provenance, source, path) {
  let rule = PROVENANCE_PAYLOADS[provenance];
  for (let key of rule.required) {
    if (source[key] === undefined) throw new TypeError(`${path}.${key} is required for ${provenance} events`);
  }
  for (let key of rule.forbidden) {
    if (source[key] !== undefined) throw new TypeError(`${path}.${key} is not supported for ${provenance} events`);
  }
}

function normalizeEvent(value, index, actionNameSet) {
  let path = `journey.events[${index}]`;
  let source = assertObject(value, path);
  assertKnownKeys(source, EVENT_KEYS, path);
  if (source.seq !== undefined && source.seq !== index) {
    throw new TypeError(`${path}.seq must equal its ordinal position`);
  }
  let provenance = singleLineText(source.provenance, `${path}.provenance`);
  if (!PROVENANCE_SET.has(provenance)) throw new TypeError(`${path}.provenance is not supported`);
  assertProvenancePayload(provenance, source, path);
  let action;
  if (source.action !== undefined) {
    action = portableToken(source.action, ACTION_NAME_PATTERN, `${path}.action`);
    if (!actionNameSet.has(action)) throw new TypeError(`${path}.action "${action}" is not in the allowlisted action set`);
  }
  return compact({
    seq: index,
    provenance,
    sourceOffsetMs: integer(source.sourceOffsetMs, `${path}.sourceOffsetMs`),
    presentationOffsetMs: integer(source.presentationOffsetMs, `${path}.presentationOffsetMs`),
    action,
    resource: source.resource === undefined ? undefined : normalizeResource(source.resource, `${path}.resource`),
    input: source.input === undefined ? undefined : normalizeOperatorInput(source.input, `${path}.input`),
    text: source.text === undefined ? undefined : singleLineText(source.text, `${path}.text`),
    replayData: source.replayData === undefined
      ? undefined
      : assertPortableValue(source.replayData, `${path}.replayData`, { secretKeyPattern: JOURNEY_SECRET_KEY_PATTERN }),
  });
}

function normalizeSegments(value, sourceDurationMs, presentationDurationMs) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('journey.timing.segments must be a nonempty array');
  let priorSourceEnd = 0;
  let priorPresentationEnd = 0;
  let segments = value.map((raw, index) => {
    let path = `journey.timing.segments[${index}]`;
    let segment = assertObject(raw, path);
    assertKnownKeys(segment, SEGMENT_KEYS, path);
    let sourceStartMs = integer(segment.sourceStartMs, `${path}.sourceStartMs`);
    let sourceEndMs = integer(segment.sourceEndMs, `${path}.sourceEndMs`);
    let presentationStartMs = integer(segment.presentationStartMs, `${path}.presentationStartMs`);
    let presentationEndMs = integer(segment.presentationEndMs, `${path}.presentationEndMs`);
    if (sourceStartMs !== priorSourceEnd) throw new TypeError(`${path}.sourceStartMs must be contiguous with the prior segment`);
    if (presentationStartMs !== priorPresentationEnd) throw new TypeError(`${path}.presentationStartMs must be contiguous with the prior segment`);
    if (sourceEndMs <= sourceStartMs) throw new TypeError(`${path} must cover a positive source span`);
    if (presentationEndMs < presentationStartMs) throw new TypeError(`${path} must not run backwards in presentation time`);
    if (presentationEndMs - presentationStartMs > sourceEndMs - sourceStartMs) {
      throw new TypeError(`${path} may compress but never stretch presentation time`);
    }
    priorSourceEnd = sourceEndMs;
    priorPresentationEnd = presentationEndMs;
    return { sourceStartMs, sourceEndMs, presentationStartMs, presentationEndMs };
  });
  if (priorSourceEnd !== sourceDurationMs) throw new TypeError('journey.timing.segments must end at sourceDurationMs');
  if (priorPresentationEnd !== presentationDurationMs) throw new TypeError('journey.timing.segments must end at presentationDurationMs');
  return segments;
}

function normalizeTiming(value) {
  let timing = assertObject(value, 'journey.timing');
  assertKnownKeys(timing, TIMING_KEYS, 'journey.timing');
  let sourceDurationMs = integer(timing.sourceDurationMs, 'journey.timing.sourceDurationMs');
  let presentationDurationMs = integer(timing.presentationDurationMs, 'journey.timing.presentationDurationMs');
  if (presentationDurationMs > sourceDurationMs) {
    throw new TypeError('journey.timing.presentationDurationMs must not exceed sourceDurationMs');
  }
  let segments = normalizeSegments(timing.segments, sourceDurationMs, presentationDurationMs);
  return { sourceDurationMs, presentationDurationMs, segments };
}

function mapSourceOffset(sourceMs, segments, path) {
  for (let segment of segments) {
    if (sourceMs < segment.sourceStartMs || sourceMs > segment.sourceEndMs) continue;
    let realtime = segment.presentationEndMs - segment.presentationStartMs === segment.sourceEndMs - segment.sourceStartMs;
    if (realtime) return segment.presentationStartMs + (sourceMs - segment.sourceStartMs);
    if (sourceMs === segment.sourceStartMs) return segment.presentationStartMs;
    if (sourceMs === segment.sourceEndMs) return segment.presentationEndMs;
    throw new TypeError(`${path} falls inside a compressed time-map segment and has no real-time position`);
  }
  throw new TypeError(`${path} is outside the declared time map`);
}

function assertEventsConsistent(events, timing) {
  let hasOperatorInput = false;
  let priorSourceOffset = 0;
  let priorPresentationOffset = 0;
  events.forEach((event, index) => {
    let path = `journey.events[${index}]`;
    if (event.provenance === 'operator-input') hasOperatorInput = true;
    if (event.sourceOffsetMs < priorSourceOffset) throw new TypeError(`${path}.sourceOffsetMs must be monotonic`);
    if (event.presentationOffsetMs < priorPresentationOffset) throw new TypeError(`${path}.presentationOffsetMs must be monotonic`);
    let mapped = mapSourceOffset(event.sourceOffsetMs, timing.segments, `${path}.sourceOffsetMs`);
    if (mapped !== event.presentationOffsetMs) {
      throw new TypeError(`${path}.presentationOffsetMs must equal the time-map projection of sourceOffsetMs`);
    }
    priorSourceOffset = event.sourceOffsetMs;
    priorPresentationOffset = event.presentationOffsetMs;
  });
  if (!hasOperatorInput) throw new TypeError('journey.events must include at least one operator-input event');
}

function buildJourney(input = {}) {
  let source = assertObject(input, 'journey');
  assertKnownKeys(source, TOP_LEVEL_KEYS, 'journey');
  let schemaVersion = singleLineText(source.schemaVersion ?? PRESENTATION_JOURNEY_SCHEMA_VERSION, 'journey.schemaVersion');
  if (schemaVersion !== PRESENTATION_JOURNEY_SCHEMA_VERSION) {
    throw new Error(`unsupported presentation journey schema version: ${schemaVersion}`);
  }
  let actionNames = normalizeActionNames(source.actionNames, 'journey.actionNames');
  let actionNameSet = new Set(actionNames);
  if (!Array.isArray(source.events) || source.events.length === 0) {
    throw new TypeError('journey.events must be a nonempty array');
  }
  let events = source.events.map((event, index) => normalizeEvent(event, index, actionNameSet));
  let outcome = singleLineText(source.outcome, 'journey.outcome');
  if (!OUTCOME_SET.has(outcome)) throw new TypeError('journey.outcome is not a supported terminal outcome');
  let timing = normalizeTiming(source.timing);
  assertEventsConsistent(events, timing);

  let record = {
    schemaVersion,
    source: normalizeSource(source.source),
    actionNames,
    events,
    outcome,
    timing,
  };
  assertPortableValue(record, 'journey', {
    allowPathAt: (path) => path === 'journey.source.routePath',
    secretKeyPattern: JOURNEY_SECRET_KEY_PATTERN,
  });
  let contentHash = computeIntegrity(record);
  let id = `presentation-journey:${contentHash}`;
  if (source.contentHash !== undefined && singleLineText(source.contentHash, 'journey.contentHash') !== contentHash) {
    throw new TypeError('journey.contentHash does not match the canonical replay projection');
  }
  if (source.id !== undefined && singleLineText(source.id, 'journey.id') !== id) {
    throw new TypeError('journey.id does not match canonical identity');
  }
  return { ...record, contentHash, id };
}

/**
 * Normalizes and canonicalizes a presentation journey, returning the portable
 * record with its derived `contentHash` and `id`.
 *
 * @param {object} [input]
 * @returns {object}
 */
export function createPresentationJourney(input = {}) {
  return buildJourney(input);
}

/**
 * The replay-relevant projection a journey's `contentHash` is computed over:
 * the normalized record without its self-referential identity fields.
 *
 * @param {object} [input]
 * @returns {object}
 */
export function presentationJourneyReplayProjection(input = {}) {
  let projection = { ...buildJourney(input) };
  delete projection.id;
  delete projection.contentHash;
  return projection;
}

/**
 * Independently validates an incoming journey, including any declared identity.
 *
 * @param {object} [input]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validatePresentationJourney(input = {}) {
  try {
    buildJourney(input);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error?.message || String(error)] };
  }
}
