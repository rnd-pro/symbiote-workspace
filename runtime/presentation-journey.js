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

export const PORTABLE_READINESS_RECEIPT_VERSION = 'workspace-presentation-readiness-v2';

const READINESS_RECEIPT_KEYS = new Set([
  'receiptVersion',
  'journeyHash',
  'terminalOutcome',
  'expectations',
  'observations',
  'barriers',
  'hash',
]);
const READINESS_EXPECTATION_KEYS = new Set(['resources', 'surfaces', 'capabilities', 'embeds']);
const READINESS_OBSERVATION_KEYS = new Set(['admittedResources', 'mountedSurfaces', 'registeredCapabilities']);
const READINESS_BARRIER_KEYS = new Set(['route', 'fonts', 'layout', 'theme', 'pendingWork', 'embeds', 'stablePaint']);
const READINESS_SURFACE_ID_PATTERN = /^(?:surface|window|workspace|panel|view|region):[a-z0-9]+(?:[-_.:/][a-z0-9]+)*$/i;
const READINESS_EMBED_ID_PATTERN = /^embed:[a-z0-9]+(?:[-_.:/][a-z0-9]+)*$/i;
const CUSTOM_ELEMENT_SELECTOR_TAG = '(?:[a-z][\\w]*-[\\w-]+)';
const BARE_ELEMENT_SELECTOR = '(?:[a-z][a-z0-9]*)';
const BARE_DOM_ELEMENT_TAGS = new Set(`
  a abbr acronym address animate animatemotion animatetransform annotation applet area article aside audio
  b base basefont bdi bdo bgsound big blink blockquote body br button canvas caption center circle cite clippath
  code col colgroup content data datalist dd defs del desc details dfn dialog dir div dl dt ellipse em embed
  feblend fecolormatrix fecomponenttransfer fecomposite feconvolvematrix fediffuselighting fedisplacementmap
  fedistantlight fedropshadow feflood fefunca fefuncb fefuncg fefuncr fegaussianblur feimage femerge femergenode
  femorphology feoffset fepointlight fespecularlighting fespotlight fetile feturbulence fieldset figcaption figure
  filter font footer foreignobject form frame frameset g h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe image
  img input ins kbd keygen label legend li line lineargradient link main map mark marker marquee mask math menu
  menuitem meta metadata meter mi mn mo mpath ms mtext nav nobr noembed noframes noscript object ol optgroup option
  output p param path pattern picture plaintext polygon polyline portal pre progress q radialgradient rb rect rp rt rtc
  ruby s samp script search section select set shadow slot small source spacer span stop strike strong style sub summary
  sup svg switch symbol table tbody td template text textarea textpath tfoot th thead time title tr track tspan tt u ul
  use var video view wbr xmp
`.trim().split(/\s+/));
const DOM_SELECTOR_PATTERN = new RegExp(
  `(?:^|[\\s,>+~])(?:[#.][a-z_][\\w-]*|\\[[^\\]]+\\]|${CUSTOM_ELEMENT_SELECTOR_TAG}(?:[#.:][a-z_][\\w-]*|\\[[^\\]]+\\]))|(?:queryselector|dataset|classname|innerhtml|xpath)\\b`,
  'i',
);
const ELEMENT_SELECTOR_TOKEN_PATTERN = /(?:^|[\s,>+~])([a-z][a-z0-9]*)(?=[#.:]|\[)/gi;

function hasKnownElementSelector(value) {
  ELEMENT_SELECTOR_TOKEN_PATTERN.lastIndex = 0;
  for (let match = ELEMENT_SELECTOR_TOKEN_PATTERN.exec(value); match; match = ELEMENT_SELECTOR_TOKEN_PATTERN.exec(value)) {
    if (BARE_DOM_ELEMENT_TAGS.has(match[1].toLowerCase())) return true;
  }
  return false;
}

function findDomSelector(value) {
  if (typeof value === 'string') {
    return DOM_SELECTOR_PATTERN.test(value) ? value : '';
  }
  if (Array.isArray(value)) {
    for (let item of value) {
      let selector = findDomSelector(item);
      if (selector) return selector;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    for (let item of Object.values(value)) {
      let selector = findDomSelector(item);
      if (selector) return selector;
    }
  }
  return '';
}

function normalizeReadinessTokens(value, path, { requireNonempty = false } = {}) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  let result = value.map((item, index) => portableToken(item, RESOURCE_ID_PATTERN, `${path}[${index}]`));
  result = [...new Set(result)].sort();
  if (requireNonempty && result.length === 0) throw new TypeError(`${path} must not be empty`);
  return result;
}

function normalizeReadinessSemanticTokens(value, path, pattern, kind, options = {}) {
  let result = normalizeReadinessTokens(value, path, options);
  for (let token of result) {
    if (!pattern.test(token)) throw new TypeError(`${path} must contain structured semantic ${kind} addresses`);
  }
  return result;
}

function journeyReadinessSurfaceId(journey) {
  let surfaceId = journey.source.surfaceId;
  return surfaceId.startsWith('surface:') ? surfaceId : `surface:${surfaceId}`;
}

function normalizeReadinessResources(value, path, { requireNonempty = false } = {}) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  let byId = new Map();
  for (let [index, raw] of value.entries()) {
    let itemPath = `${path}[${index}]`;
    let source = assertObject(raw, itemPath);
    assertKnownKeys(source, new Set(['id', 'hash']), itemPath);
    let resource = {
      id: portableToken(source.id, RESOURCE_ID_PATTERN, `${itemPath}.id`),
      hash: integrity(source.hash, `${itemPath}.hash`),
    };
    if (byId.has(resource.id) && byId.get(resource.id).hash !== resource.hash) {
      throw new TypeError(`${path} has conflicting hashes for resource "${resource.id}"`);
    }
    byId.set(resource.id, resource);
  }
  let result = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (requireNonempty && result.length === 0) throw new TypeError(`${path} must not be empty`);
  return result;
}

function normalizeReadinessExpectations(value, path = 'receipt.expectations') {
  let source = assertObject(value, path);
  assertKnownKeys(source, READINESS_EXPECTATION_KEYS, path);
  return {
    resources: normalizeReadinessResources(source.resources, `${path}.resources`, { requireNonempty: true }),
    surfaces: normalizeReadinessSemanticTokens(
      source.surfaces,
      `${path}.surfaces`,
      READINESS_SURFACE_ID_PATTERN,
      'surface',
      { requireNonempty: true },
    ),
    capabilities: normalizeReadinessTokens(source.capabilities, `${path}.capabilities`, { requireNonempty: true }),
    embeds: normalizeReadinessSemanticTokens(source.embeds, `${path}.embeds`, READINESS_EMBED_ID_PATTERN, 'embed'),
  };
}

function normalizeReadinessObservations(value, path = 'receipt.observations') {
  let source = assertObject(value, path);
  assertKnownKeys(source, READINESS_OBSERVATION_KEYS, path);
  return {
    admittedResources: normalizeReadinessResources(source.admittedResources, `${path}.admittedResources`),
    mountedSurfaces: normalizeReadinessSemanticTokens(
      source.mountedSurfaces,
      `${path}.mountedSurfaces`,
      READINESS_SURFACE_ID_PATTERN,
      'surface',
    ),
    registeredCapabilities: normalizeReadinessTokens(source.registeredCapabilities, `${path}.registeredCapabilities`),
  };
}

function booleanBarrier(source, key, path) {
  if (source[key] !== true) throw new TypeError(`${path}.${key} must be true`);
  return true;
}

function normalizeReadinessBarriers(value, expectations, journey) {
  let path = 'receipt.barriers';
  let source = assertObject(value, path);
  assertKnownKeys(source, READINESS_BARRIER_KEYS, path);

  let routeSource = assertObject(source.route, `${path}.route`);
  assertKnownKeys(routeSource, new Set(['path', 'settled']), `${path}.route`);
  let routePath = singleLineText(routeSource.path, `${path}.route.path`);
  if (routePath !== journey.source.routePath) throw new TypeError('receipt.barriers.route.path must match journey.source.routePath');

  let fontsSource = assertObject(source.fonts, `${path}.fonts`);
  assertKnownKeys(fontsSource, new Set(['ready']), `${path}.fonts`);
  let layoutSource = assertObject(source.layout, `${path}.layout`);
  assertKnownKeys(layoutSource, new Set(['ready', 'fingerprint']), `${path}.layout`);
  let themeSource = assertObject(source.theme, `${path}.theme`);
  assertKnownKeys(themeSource, new Set(['ready', 'name']), `${path}.theme`);
  let pendingSource = assertObject(source.pendingWork, `${path}.pendingWork`);
  assertKnownKeys(pendingSource, new Set(['count', 'drained']), `${path}.pendingWork`);
  let embedsSource = assertObject(source.embeds, `${path}.embeds`);
  assertKnownKeys(embedsSource, new Set(['expectedIds', 'mountedIds', 'readyIds']), `${path}.embeds`);
  let paintSource = assertObject(source.stablePaint, `${path}.stablePaint`);
  assertKnownKeys(paintSource, new Set(['samples', 'fingerprint', 'consecutive']), `${path}.stablePaint`);

  let count = integer(pendingSource.count, `${path}.pendingWork.count`);
  if (count !== 0) throw new TypeError('receipt.barriers.pendingWork.count must be zero');
  let samples = integer(paintSource.samples, `${path}.stablePaint.samples`, { min: 2 });
  let expectedIds = normalizeReadinessTokens(embedsSource.expectedIds, `${path}.embeds.expectedIds`);
  if (expectedIds.length !== expectations.embeds.length
    || expectedIds.some((id, index) => id !== expectations.embeds[index])) {
    throw new TypeError('receipt.barriers.embeds.expectedIds must equal receipt.expectations.embeds');
  }

  return {
    route: { path: routePath, settled: booleanBarrier(routeSource, 'settled', `${path}.route`) },
    fonts: { ready: booleanBarrier(fontsSource, 'ready', `${path}.fonts`) },
    layout: {
      ready: booleanBarrier(layoutSource, 'ready', `${path}.layout`),
      fingerprint: integrity(layoutSource.fingerprint, `${path}.layout.fingerprint`),
    },
    theme: {
      ready: booleanBarrier(themeSource, 'ready', `${path}.theme`),
      name: portableToken(themeSource.name, RESOURCE_ID_PATTERN, `${path}.theme.name`),
    },
    pendingWork: { count, drained: booleanBarrier(pendingSource, 'drained', `${path}.pendingWork`) },
    embeds: {
      expectedIds,
      mountedIds: normalizeReadinessSemanticTokens(
        embedsSource.mountedIds,
        `${path}.embeds.mountedIds`,
        READINESS_EMBED_ID_PATTERN,
        'embed',
      ),
      readyIds: normalizeReadinessSemanticTokens(
        embedsSource.readyIds,
        `${path}.embeds.readyIds`,
        READINESS_EMBED_ID_PATTERN,
        'embed',
      ),
    },
    stablePaint: {
      samples,
      fingerprint: integrity(paintSource.fingerprint, `${path}.stablePaint.fingerprint`),
      consecutive: booleanBarrier(paintSource, 'consecutive', `${path}.stablePaint`),
    },
  };
}

function journeyReadinessResources(journey) {
  return normalizeReadinessResources(
    journey.events
      .filter((event) => event.provenance === 'resource-result')
      .map((event) => ({ id: event.resource.id, hash: event.resource.resultHash })),
    'journey resource evidence',
    { requireNonempty: true },
  );
}

function missingResourceEvidence(expected, observed) {
  let observedById = new Map(observed.map((item) => [item.id, item.hash]));
  return expected
    .filter((item) => observedById.get(item.id) !== item.hash)
    .map((item) => item.id);
}

function missingTokens(expected, observed) {
  let observedSet = new Set(observed);
  return expected.filter((item) => !observedSet.has(item));
}

function assertReadinessCoverage(expectations, observations, barriers) {
  let missing = {
    resources: missingResourceEvidence(expectations.resources, observations.admittedResources),
    surfaces: missingTokens(expectations.surfaces, observations.mountedSurfaces),
    capabilities: missingTokens(expectations.capabilities, observations.registeredCapabilities),
    mountedEmbeds: missingTokens(expectations.embeds, barriers.embeds.mountedIds),
    readyEmbeds: missingTokens(expectations.embeds, barriers.embeds.readyIds),
  };
  let failures = Object.entries(missing).filter(([, values]) => values.length > 0);
  if (failures.length) {
    let error = new TypeError(`readiness evidence is incomplete: ${failures.map(([key, values]) => `${key}=[${values.join(', ')}]`).join('; ')}`);
    error.missingEvidence = missing;
    throw error;
  }
}

function normalizeReadinessReceipt(input, journey) {
  let receipt = assertObject(input, 'receipt');
  assertKnownKeys(receipt, READINESS_RECEIPT_KEYS, 'receipt');
  let rawSurfaceIds = [
    ...(Array.isArray(receipt.expectations?.surfaces) ? receipt.expectations.surfaces : []),
    ...(Array.isArray(receipt.observations?.mountedSurfaces) ? receipt.observations.mountedSurfaces : []),
  ].filter((value) => typeof value === 'string');
  let rawSelector = findDomSelector(receipt)
    || rawSurfaceIds.find((id) => BARE_DOM_ELEMENT_TAGS.has(id.toLowerCase()) || hasKnownElementSelector(id));
  if (rawSelector) throw new TypeError(`receipt must not contain DOM selectors: ${rawSelector}`);
  let receiptVersion = singleLineText(receipt.receiptVersion, 'receipt.receiptVersion');
  if (receiptVersion !== PORTABLE_READINESS_RECEIPT_VERSION) {
    throw new TypeError(`receipt.receiptVersion must equal ${PORTABLE_READINESS_RECEIPT_VERSION}`);
  }
  let journeyHash = integrity(receipt.journeyHash, 'receipt.journeyHash');
  if (journeyHash !== journey.contentHash) throw new TypeError('receipt.journeyHash must match the validated journey');
  let terminalOutcome = singleLineText(receipt.terminalOutcome, 'receipt.terminalOutcome');
  if (terminalOutcome !== 'completed' || journey.outcome !== 'completed') {
    throw new TypeError('receipt and journey terminal outcomes must be completed');
  }

  let expectations = normalizeReadinessExpectations(receipt.expectations);
  let sourceSurfaceId = journeyReadinessSurfaceId(journey);
  if (!expectations.surfaces.includes(sourceSurfaceId)) {
    throw new TypeError(`receipt.expectations.surfaces must include journey surface ${sourceSurfaceId}`);
  }
  let journeyResources = journeyReadinessResources(journey);
  if (computeIntegrity(expectations.resources) !== computeIntegrity(journeyResources)) {
    throw new TypeError('receipt.expectations.resources must exactly match journey resource-result evidence');
  }
  let observations = normalizeReadinessObservations(receipt.observations);
  let barriers = normalizeReadinessBarriers(receipt.barriers, expectations, journey);
  assertReadinessCoverage(expectations, observations, barriers);

  let normalized = { receiptVersion, journeyHash, terminalOutcome, expectations, observations, barriers };
  let surfaceIds = [...expectations.surfaces, ...observations.mountedSurfaces];
  let selector = findDomSelector(normalized)
    || surfaceIds.find((id) => BARE_DOM_ELEMENT_TAGS.has(id.toLowerCase()) || hasKnownElementSelector(id));
  if (selector) {
    throw new TypeError(`receipt must not contain DOM selectors: ${selector}`);
  }
  assertPortableValue(normalized, 'receipt', {
    allowPathAt: (path) => path === 'receipt.barriers.route.path',
    secretKeyPattern: JOURNEY_SECRET_KEY_PATTERN,
  });
  return normalized;
}

export function validatePortableReadinessReceipt(input = {}, options = {}) {
  try {
    if (!options.journey) throw new TypeError('readiness receipt validation requires its presentation journey');
    let journey = buildJourney(options.journey);
    let normalized = normalizeReadinessReceipt(input, journey);
    let hash = integrity(input.hash, 'receipt.hash');
    if (hash !== computeIntegrity(normalized)) throw new TypeError('receipt.hash does not match computed integrity');
    return { ok: true, errors: [], missingEvidence: null };
  } catch (error) {
    return {
      ok: false,
      errors: [error?.message || String(error)],
      missingEvidence: error?.missingEvidence || null,
    };
  }
}

export function createPortableReadinessReceipt(input = {}) {
  let journey = buildJourney(input.journey);
  let journeyResources = journeyReadinessResources(journey);
  let receiptInput = {
    receiptVersion: PORTABLE_READINESS_RECEIPT_VERSION,
    journeyHash: journey.contentHash,
    terminalOutcome: journey.outcome,
    expectations: {
      ...(input.expectations || {}),
      resources: input.expectations?.resources ?? journeyResources,
    },
    observations: {
      admittedResources: input.observations?.admittedResources,
      mountedSurfaces: input.observations?.mountedSurfaces,
      registeredCapabilities: input.observations?.registeredCapabilities,
    },
    barriers: input.observations?.barriers ?? input.barriers,
  };
  let normalized = normalizeReadinessReceipt(receiptInput, journey);
  let receipt = { ...normalized, hash: computeIntegrity(normalized) };
  let validation = validatePortableReadinessReceipt(receipt, { journey });
  if (!validation.ok) throw new TypeError(validation.errors[0]);
  return receipt;
}
