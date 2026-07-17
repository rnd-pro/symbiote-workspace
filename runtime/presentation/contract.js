import { computeIntegrity } from '../../schema/canonical-json.js';

export const PRESENTATION_CONTRACT_VERSION = 'presentation-timeline-v3';
export const PRESENTATION_DIALOGUE_ACTS = Object.freeze([
  'open',
  'explain',
  'ask',
  'respond',
  'clarify',
  'confirm',
  'acknowledge',
  'challenge',
  'disagree',
  'handoff',
  'summarize',
  'conclude',
  'close',
]);
export const PRESENTATION_CUE_KINDS = Object.freeze(['focus', 'interaction', 'annotation', 'state']);
export const PRESENTATION_INTERACTION_TYPES = Object.freeze([
  'click',
  'double-click',
  'hover',
  'drag',
  'scroll',
  'zoom',
  'input',
  'select',
  'text-select',
  'panel-reveal',
  'navigate',
]);
export const PRESENTATION_ANNOTATION_INTENTS = Object.freeze([
  'emphasize',
  'detail',
  'group',
  'risk',
  'question',
  'success',
  'affinity',
  'flourish',
]);
export const PRESENTATION_MARKERS = Object.freeze(['box', 'circle', 'oval', 'underline', 'freehand', 'bracket', 'slash']);
export const PRESENTATION_SYMBOLS = Object.freeze(['question', 'cross', 'check', 'heart', 'flourish']);
export const PRESENTATION_ANNOTATION_PLACEMENTS = Object.freeze(['over', 'after', 'before', 'corner', 'below', 'above']);
export const PRESENTATION_STATE_CONDITIONS = Object.freeze([
  'visible',
  'hidden',
  'enabled',
  'disabled',
  'value-equals',
  'navigation-settled',
  'paint-stable',
]);
export const PRESENTATION_SYNC_ANCHORS = Object.freeze(['turn-start', 'turn-end', 'speech']);
export const PRESENTATION_DELIVERY_EMOTIONS = Object.freeze([
  'neutral',
  'warm',
  'curious',
  'thoughtful',
  'confident',
  'concerned',
  'skeptical',
  'surprised',
  'amused',
  'emphatic',
]);
export const PRESENTATION_DELIVERY_PACES = Object.freeze(['slow', 'normal', 'brisk']);

const DIALOGUE_ACT_SET = new Set(PRESENTATION_DIALOGUE_ACTS);
const CUE_KIND_SET = new Set(PRESENTATION_CUE_KINDS);
const INTERACTION_TYPE_SET = new Set(PRESENTATION_INTERACTION_TYPES);
const ANNOTATION_INTENT_SET = new Set(PRESENTATION_ANNOTATION_INTENTS);
const MARKER_SET = new Set(PRESENTATION_MARKERS);
const SYMBOL_SET = new Set(PRESENTATION_SYMBOLS);
const PLACEMENT_SET = new Set(PRESENTATION_ANNOTATION_PLACEMENTS);
const STATE_CONDITION_SET = new Set(PRESENTATION_STATE_CONDITIONS);
const SYNC_ANCHOR_SET = new Set(PRESENTATION_SYNC_ANCHORS);
const EMOTION_SET = new Set(PRESENTATION_DELIVERY_EMOTIONS);
const PACE_SET = new Set(PRESENTATION_DELIVERY_PACES);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '') {
  let normalized = String(value ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
}

function portableId(value, fallback = 'presentation') {
  let normalized = text(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9./:_-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/[-_.:/]+$/g, '')
    .replace(/[-_.:/]{2,}/g, '-');
  if (!normalized) normalized = fallback;
  if (!/^[a-z]/.test(normalized)) normalized = `${fallback}-${normalized}`;
  return normalized;
}

function portableValue(value, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => portableValue(item, `${path}[${index}]`));
  if (!isObject(value)) throw new TypeError(`${path} must contain portable JSON values`);
  let result = {};
  for (let [key, item] of Object.entries(value)) result[key] = portableValue(item, `${path}.${key}`);
  return result;
}

function assertObject(value, path) {
  if (!isObject(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function assertKnownKeys(value, allowed, path) {
  for (let key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${path}.${key} is not supported by ${PRESENTATION_CONTRACT_VERSION}`);
  }
}

function enumValue(value, allowed, path, { required = false, fallback } = {}) {
  let normalized = text(value, fallback);
  if (!normalized && !required) return undefined;
  if (!allowed.has(normalized)) throw new TypeError(`${path} has unsupported value "${normalized}"`);
  return normalized;
}

function integer(value, path, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${path} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function normalizeStringList(value, path) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return [...new Set(value.map((item, index) => {
    let normalized = text(item);
    if (!normalized) throw new TypeError(`${path}[${index}] must be nonempty text`);
    return normalized;
  }))];
}

function normalizeDelivery(value = {}, path = 'delivery') {
  let source = assertObject(value, path);
  assertKnownKeys(source, ['emotion', 'pace', 'tone'], path);
  return compact({
    emotion: enumValue(source.emotion, EMOTION_SET, `${path}.emotion`),
    pace: enumValue(source.pace, PACE_SET, `${path}.pace`),
    tone: source.tone === undefined ? undefined : text(source.tone),
  });
}

function normalizeTransition(value = {}, path = 'transition') {
  let source = assertObject(value, path);
  assertKnownKeys(source, ['pauseBeforeMs', 'overlapMs'], path);
  return compact({
    pauseBeforeMs: source.pauseBeforeMs === undefined ? undefined : integer(source.pauseBeforeMs, `${path}.pauseBeforeMs`, { min: 0, max: 10000 }),
    overlapMs: source.overlapMs === undefined ? undefined : integer(source.overlapMs, `${path}.overlapMs`, { min: 0, max: 5000 }),
  });
}

function quoteOccurrences(haystack, needle) {
  let count = 0;
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    let found = haystack.indexOf(needle, offset);
    if (found < 0) break;
    count += 1;
    offset = found + Math.max(1, needle.length);
  }
  return count;
}

export function normalizePresentationSyncAnchor(value = {}, turnText = '', path = 'sync') {
  let source = assertObject(value, path);
  assertKnownKeys(source, ['anchor', 'quote', 'occurrence', 'edge', 'offsetMs'], path);
  let anchor = enumValue(source.anchor, SYNC_ANCHOR_SET, `${path}.anchor`, { required: true });
  let offsetMs = source.offsetMs === undefined
    ? 0
    : integer(source.offsetMs, `${path}.offsetMs`, { min: -5000, max: 5000 });
  if (anchor !== 'speech') {
    if (source.quote !== undefined || source.occurrence !== undefined || source.edge !== undefined) {
      throw new TypeError(`${path} only supports quote, occurrence, and edge for speech anchors`);
    }
    return { anchor, offsetMs };
  }
  let quote = text(source.quote);
  if (!quote) throw new TypeError(`${path}.quote must be nonempty for a speech anchor`);
  let occurrence = integer(source.occurrence ?? 1, `${path}.occurrence`, { min: 1, max: 1000 });
  let edge = enumValue(source.edge ?? 'start', new Set(['start', 'end']), `${path}.edge`, { required: true });
  let available = quoteOccurrences(text(turnText), quote);
  if (available < occurrence) {
    throw new TypeError(`${path}.quote occurrence ${occurrence} is absent from normalized turn text`);
  }
  return { anchor, quote, occurrence, edge, offsetMs };
}

function normalizeBinding(value, path) {
  if (value === undefined) return undefined;
  let source = assertObject(value, path);
  assertKnownKeys(source, ['source', 'tool', 'input'], path);
  let bindingSource = enumValue(source.source, new Set(['webmcp', 'workspace', 'host']), `${path}.source`, { required: true });
  let tool = text(source.tool);
  if (!tool) throw new TypeError(`${path}.tool must be nonempty`);
  return compact({
    source: bindingSource,
    tool,
    input: source.input === undefined ? undefined : portableValue(source.input, `${path}.input`),
  });
}

function normalizeCuePayload(kind, source, path) {
  if (kind === 'focus') {
    let payload = assertObject(source.focus || {}, `${path}.focus`);
    assertKnownKeys(payload, ['mode'], `${path}.focus`);
    return { focus: { mode: enumValue(payload.mode ?? 'cursor', new Set(['cursor', 'frame']), `${path}.focus.mode`, { required: true }) } };
  }
  if (kind === 'interaction') {
    let payload = assertObject(source.interaction, `${path}.interaction`);
    assertKnownKeys(payload, ['type', 'binding', 'parameters', 'reversible'], `${path}.interaction`);
    return { interaction: compact({
      type: enumValue(payload.type, INTERACTION_TYPE_SET, `${path}.interaction.type`, { required: true }),
      binding: normalizeBinding(payload.binding, `${path}.interaction.binding`),
      parameters: payload.parameters === undefined ? undefined : portableValue(payload.parameters, `${path}.interaction.parameters`),
      reversible: payload.reversible === undefined ? undefined : Boolean(payload.reversible),
    }) };
  }
  if (kind === 'annotation') {
    let payload = assertObject(source.annotation, `${path}.annotation`);
    assertKnownKeys(payload, ['intent', 'marker', 'symbol', 'placement'], `${path}.annotation`);
    let marker = enumValue(payload.marker, MARKER_SET, `${path}.annotation.marker`);
    let symbol = enumValue(payload.symbol, SYMBOL_SET, `${path}.annotation.symbol`);
    if (marker && symbol) throw new TypeError(`${path}.annotation cannot select both marker and symbol`);
    return { annotation: compact({
      intent: enumValue(payload.intent, ANNOTATION_INTENT_SET, `${path}.annotation.intent`, { required: true }),
      marker,
      symbol,
      placement: enumValue(payload.placement, PLACEMENT_SET, `${path}.annotation.placement`),
    }) };
  }
  let payload = assertObject(source.state, `${path}.state`);
  assertKnownKeys(payload, ['condition', 'path', 'value', 'timeoutMs'], `${path}.state`);
  let condition = enumValue(payload.condition, STATE_CONDITION_SET, `${path}.state.condition`, { required: true });
  if (condition === 'value-equals' && !text(payload.path)) throw new TypeError(`${path}.state.path is required for value-equals`);
  return { state: compact({
    condition,
    path: payload.path === undefined ? undefined : text(payload.path),
    value: payload.value === undefined ? undefined : portableValue(payload.value, `${path}.state.value`),
    timeoutMs: integer(payload.timeoutMs, `${path}.state.timeoutMs`, { min: 1, max: 120000 }),
  }) };
}

export function normalizePresentationCue(value = {}, turnText = '', path = 'cue') {
  let source = assertObject(value, path);
  assertKnownKeys(source, ['kind', 'targetId', 'tabId', 'at', 'until', 'focus', 'interaction', 'annotation', 'state'], path);
  let kind = enumValue(source.kind, CUE_KIND_SET, `${path}.kind`, { required: true });
  for (let payloadKey of PRESENTATION_CUE_KINDS) {
    if (payloadKey !== kind && source[payloadKey] !== undefined) throw new TypeError(`${path}.${payloadKey} does not match cue kind ${kind}`);
  }
  let targetId = text(source.targetId);
  if (!targetId && kind !== 'state') throw new TypeError(`${path}.targetId is required for ${kind} cues`);
  let at = normalizePresentationSyncAnchor(source.at || { anchor: 'turn-start' }, turnText, `${path}.at`);
  let untilSource = source.until || ((kind === 'focus' || kind === 'annotation') ? { anchor: 'turn-end' } : undefined);
  return compact({
    kind,
    targetId: targetId || undefined,
    tabId: source.tabId === undefined ? undefined : text(source.tabId),
    at,
    until: untilSource ? normalizePresentationSyncAnchor(untilSource, turnText, `${path}.until`) : undefined,
    ...normalizeCuePayload(kind, source, path),
  });
}

function normalizeSourceRef(value, path) {
  let source = assertObject(value, path);
  assertKnownKeys(source, ['sourceId', 'path', 'hash', 'targetId'], path);
  let sourceId = text(source.sourceId);
  if (!sourceId) throw new TypeError(`${path}.sourceId must be nonempty`);
  return compact({
    sourceId,
    path: source.path === undefined ? undefined : text(source.path),
    hash: source.hash === undefined ? undefined : text(source.hash),
    targetId: source.targetId === undefined ? undefined : text(source.targetId),
  });
}

function normalizeClaim(value, path) {
  let source = assertObject(value, path);
  assertKnownKeys(source, ['id', 'kind', 'text', 'factRefs', 'evidenceRefs', 'targetRefs'], path);
  let id = text(source.id);
  let kind = text(source.kind);
  let claimText = text(source.text);
  if (!id || !kind || !claimText) throw new TypeError(`${path} requires id, kind, and text`);
  return {
    id,
    kind,
    text: claimText,
    factRefs: normalizeStringList(source.factRefs, `${path}.factRefs`),
    evidenceRefs: normalizeStringList(source.evidenceRefs, `${path}.evidenceRefs`),
    targetRefs: normalizeStringList(source.targetRefs, `${path}.targetRefs`),
  };
}

function normalizeTurn(value, index, personaIds, priorTurnIds) {
  let path = `turns[${index}]`;
  let source = assertObject(value, path);
  assertKnownKeys(source, [
    'id', 'persona', 'addressee', 'dialogueAct', 'replyTo', 'text', 'sourceRefs',
    'claims', 'delivery', 'transition', 'cues',
  ], path);
  let id = text(source.id, `turn-${index + 1}`);
  if (priorTurnIds.has(id)) throw new TypeError(`${path}.id duplicates an earlier turn`);
  let persona = text(source.persona);
  if (!personaIds.has(persona)) throw new TypeError(`${path}.persona must name a declared persona`);
  let addressee = source.addressee === undefined ? undefined : text(source.addressee);
  if (addressee && !personaIds.has(addressee)) throw new TypeError(`${path}.addressee must name a declared persona`);
  let replyTo = source.replyTo === undefined ? undefined : text(source.replyTo);
  if (replyTo && !priorTurnIds.has(replyTo)) throw new TypeError(`${path}.replyTo must name an earlier turn`);
  let turnText = text(source.text);
  if (!turnText) throw new TypeError(`${path}.text must be nonempty`);
  let sourceRefs = source.sourceRefs === undefined ? [] : source.sourceRefs;
  let claims = source.claims === undefined ? [] : source.claims;
  let cues = source.cues === undefined ? [] : source.cues;
  if (!Array.isArray(sourceRefs)) throw new TypeError(`${path}.sourceRefs must be an array`);
  if (!Array.isArray(claims)) throw new TypeError(`${path}.claims must be an array`);
  if (!Array.isArray(cues)) throw new TypeError(`${path}.cues must be an array`);
  return compact({
    id,
    persona,
    addressee,
    dialogueAct: enumValue(source.dialogueAct, DIALOGUE_ACT_SET, `${path}.dialogueAct`, { required: true }),
    replyTo,
    text: turnText,
    sourceRefs: sourceRefs.map((item, refIndex) => normalizeSourceRef(item, `${path}.sourceRefs[${refIndex}]`)),
    claims: claims.map((item, claimIndex) => normalizeClaim(item, `${path}.claims[${claimIndex}]`)),
    delivery: source.delivery === undefined ? undefined : normalizeDelivery(source.delivery, `${path}.delivery`),
    transition: source.transition === undefined ? undefined : normalizeTransition(source.transition, `${path}.transition`),
    cues: cues.map((item, cueIndex) => normalizePresentationCue(item, turnText, `${path}.cues[${cueIndex}]`)),
  });
}

function normalizePersonas(value = {}, locale) {
  let source = assertObject(value, 'personas');
  let result = {};
  for (let [id, raw] of Object.entries(source)) {
    let personaId = text(id);
    if (!personaId) throw new TypeError('personas keys must be nonempty');
    let persona = assertObject(raw, `personas.${personaId}`);
    assertKnownKeys(persona, ['name', 'role', 'locale', 'delivery'], `personas.${personaId}`);
    let role = text(persona.role);
    if (!role) throw new TypeError(`personas.${personaId}.role must be nonempty`);
    result[personaId] = compact({
      name: text(persona.name, personaId),
      role,
      locale: text(persona.locale, locale),
      delivery: persona.delivery === undefined ? undefined : normalizeDelivery(persona.delivery, `personas.${personaId}.delivery`),
    });
  }
  if (!Object.keys(result).length) throw new TypeError('presentation timeline requires at least one persona');
  return result;
}

function normalizeGrounding(value = {}) {
  let source = assertObject(value, 'grounding');
  assertKnownKeys(source, ['sources'], 'grounding');
  if (!Array.isArray(source.sources || [])) throw new TypeError('grounding.sources must be an array');
  return {
    sources: (source.sources || []).map((raw, index) => {
      let path = `grounding.sources[${index}]`;
      let item = assertObject(raw, path);
      assertKnownKeys(item, ['id', 'kind', 'path', 'targetId', 'contentHash', 'length', 'generation', 'summary'], path);
      let id = text(item.id);
      if (!id) throw new TypeError(`${path}.id must be nonempty`);
      return compact({
        id,
        kind: item.kind === undefined ? undefined : text(item.kind),
        path: item.path === undefined ? undefined : text(item.path),
        targetId: item.targetId === undefined ? undefined : text(item.targetId),
        contentHash: item.contentHash === undefined ? undefined : text(item.contentHash),
        length: item.length === undefined ? undefined : integer(item.length, `${path}.length`, { min: 0 }),
        generation: item.generation === undefined ? undefined : integer(item.generation, `${path}.generation`, { min: 0 }),
        summary: item.summary === undefined ? undefined : text(item.summary),
      });
    }),
  };
}

export function normalizePresentationTimeline(input = {}, options = {}) {
  let source = assertObject(input, 'timeline');
  assertKnownKeys(source, [
    'contractVersion', 'id', 'title', 'locale', 'profile', 'personas', 'grounding',
    'turns', 'source', 'metadata', 'hash',
  ], 'timeline');
  let contractVersion = text(options.contractVersion || source.contractVersion, PRESENTATION_CONTRACT_VERSION);
  if (contractVersion !== PRESENTATION_CONTRACT_VERSION) throw new Error(`unsupported presentation contract version: ${contractVersion}`);
  let locale = text(source.locale, 'en-US');
  let title = text(source.title, 'Workspace presentation');
  let personas = normalizePersonas(source.personas || {}, locale);
  let turnsSource = source.turns || [];
  if (!Array.isArray(turnsSource)) throw new TypeError('timeline.turns must be an array');
  let priorTurnIds = new Set();
  let personaIds = new Set(Object.keys(personas));
  let turns = turnsSource.map((turn, index) => {
    let normalized = normalizeTurn(turn, index, personaIds, priorTurnIds);
    priorTurnIds.add(normalized.id);
    return normalized;
  });
  return compact({
    contractVersion,
    id: portableId(source.id || title),
    title,
    locale,
    profile: text(source.profile, 'brief'),
    personas,
    grounding: normalizeGrounding(source.grounding || { sources: [] }),
    turns,
    source: source.source === undefined ? undefined : text(source.source),
    metadata: source.metadata === undefined ? undefined : portableValue(source.metadata, 'timeline.metadata'),
  });
}

export function presentationTimelineHashProjection(input = {}) {
  let timeline = normalizePresentationTimeline(input);
  return { ...timeline };
}

export function createPresentationTimelineHash(input = {}, options = {}) {
  let timeline = normalizePresentationTimeline(input, options);
  if (!timeline.turns.length) throw new Error('presentation timeline requires at least one narrated turn');
  return `${PRESENTATION_CONTRACT_VERSION}:${computeIntegrity(timeline)}`;
}

export function createPresentationTimelineContract(input = {}, options = {}) {
  let timeline = normalizePresentationTimeline(input, options);
  if (!timeline.turns.length) throw new Error('presentation timeline requires at least one narrated turn');
  return { ...timeline, hash: `${PRESENTATION_CONTRACT_VERSION}:${computeIntegrity(timeline)}` };
}

export function presentationTimelineHasTurns(input = {}) {
  try {
    return normalizePresentationTimeline(input).turns.length > 0;
  } catch {
    return false;
  }
}
