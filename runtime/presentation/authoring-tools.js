import { canonicalize, computeIntegrity } from '../../schema/canonical-json.js';
import { validatePresentationAlignedSequence } from './align.js';
import {
  PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
  applyPresentationAuthoringProjectCommand,
  invertPresentationAuthoringProjectCommand,
  listPresentationAuthoringProjectCommandDescriptors,
} from './commands.js';
import { projectPresentationNle } from './nle-projection.js';
import {
  createPresentationAuthoringProjectHashes,
  createPresentationAuthoringTimelineProjection,
  validatePresentationAuthoringProject,
} from './project.js';
import { createPresentationScheduleV2 } from './schedule-v2.js';

const MEDIA_ANCESTRY_VERSION = 'workspace-presentation-media-ancestry-v1';
const MEDIA_COLLECTION_VERSION = 'workspace-presentation-media-collection-v1';
const MEDIA_INVALIDATION_VERSION = 'workspace-presentation-authoring-invalidation-v1';
const SCOPED_MEDIA_INVALIDATION_VERSION = 'workspace-presentation-authoring-invalidation-v2';
const NARRATION_PROJECTION_VERSION = 'workspace-presentation-narration-v1';
const REGENERATION_REQUEST_VERSION = 'workspace-presentation-regeneration-request-v1';
const REGENERATION_RECEIPT_VERSION = 'workspace-presentation-regeneration-receipt-v1';
const SCOPED_REGENERATION_REQUEST_VERSION = 'workspace-presentation-regeneration-request-v2';
const SCOPED_REGENERATION_RECEIPT_VERSION = 'workspace-presentation-regeneration-receipt-v2';
const MEDIA_DEPENDENCIES = Object.freeze(['narration-audio', 'alignment', 'render']);
const ARTIFACT_STATUSES = Object.freeze(['accepted', 'stale', 'missing']);
const RECEIPT_STATUSES = Object.freeze(['pending', 'accepted', 'failed', 'cancelled']);

const BASE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    revision: { type: 'integer', minimum: 0 },
    authoringProjectHash: { type: 'string', minLength: 1 },
  }),
  required: Object.freeze(['revision', 'authoringProjectHash']),
  additionalProperties: false,
});

const ARTIFACT_SCOPE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    collectionId: { type: 'string', minLength: 1 },
    manifestHash: { type: 'string', minLength: 1 },
    entryId: { type: 'string', minLength: 1 },
    narrationCellId: { type: 'string', minLength: 1 },
  }),
  required: Object.freeze([
    'collectionId',
    'manifestHash',
    'entryId',
    'narrationCellId',
  ]),
  additionalProperties: false,
});

function clone(value) {
  return JSON.parse(canonicalize(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (let child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(clone(value));
}

function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export class PresentationAuthoringToolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PresentationAuthoringToolError';
    this.code = code;
    this.details = immutable(details);
  }
}

function fail(code, message, details = {}) {
  throw new PresentationAuthoringToolError(code, message, details);
}

function object(value, path) {
  if (!isObject(value)) {
    fail('PRESENTATION_AUTHORING_TOOL_INPUT_INVALID', `${path} must be an object`, { path });
  }
  return value;
}

function knownKeys(value, keys, path) {
  for (let key of Object.keys(value)) {
    if (!keys.includes(key)) {
      fail(
        'PRESENTATION_AUTHORING_TOOL_INPUT_INVALID',
        `${path}.${key} is not supported`,
        { path: `${path}.${key}` },
      );
    }
  }
}

function text(value, path) {
  let normalized = String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    fail('PRESENTATION_AUTHORING_TOOL_INPUT_INVALID', `${path} must be nonempty text`, { path });
  }
  return normalized;
}

function assertRequired(value, keys, path) {
  for (let key of keys) {
    if (!Object.hasOwn(value, key)) {
      fail(
        'PRESENTATION_AUTHORING_TOOL_INPUT_INVALID',
        `${path}.${key} is required`,
        { path: `${path}.${key}` },
      );
    }
  }
}

function normalizeBase(value, path = 'input.base') {
  let base = object(value, path);
  knownKeys(base, ['revision', 'authoringProjectHash'], path);
  assertRequired(base, ['revision', 'authoringProjectHash'], path);
  if (!Number.isInteger(base.revision) || base.revision < 0) {
    fail(
      'PRESENTATION_AUTHORING_TOOL_INPUT_INVALID',
      `${path}.revision must be a non-negative integer`,
      { path: `${path}.revision` },
    );
  }
  return {
    revision: base.revision,
    authoringProjectHash: text(base.authoringProjectHash, `${path}.authoringProjectHash`),
  };
}

function sameBase(left, right) {
  return (
    left.revision === right.revision
    && left.authoringProjectHash === right.authoringProjectHash
  );
}

function projectBase(project) {
  return { revision: project.revision, authoringProjectHash: project.hash };
}

function assertCurrentBase(project, base) {
  let expected = projectBase(project);
  if (!sameBase(expected, base)) {
    fail(
      'PRESENTATION_AUTHORING_TOOL_STALE',
      'tool base does not match the current presentation authoring project',
      { expected, received: base },
    );
  }
}

function throwMapped(error, fallbackCode) {
  if (error instanceof PresentationAuthoringToolError) throw error;
  if (error?.name === 'AbortError') throw error;
  throw new PresentationAuthoringToolError(
    error?.code || fallbackCode,
    error?.message || 'presentation authoring operation failed',
    {
      ...(error?.code ? { causeCode: error.code } : {}),
      ...(isObject(error?.details) ? { causeDetails: error.details } : {}),
    },
  );
}

function throwIfAborted(signal) {
  if (!signal) return;
  if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
  if (signal.aborted) {
    let error = new Error('The presentation authoring operation was aborted.');
    error.name = 'AbortError';
    throw error;
  }
}

function createMutationInputSchema(payloadSchema) {
  return {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      base: clone(BASE_SCHEMA),
      payload: clone(payloadSchema),
    },
    required: ['id', 'base', 'payload'],
    additionalProperties: false,
  };
}

function descriptor(value) {
  return deepFreeze(value);
}

const COMMAND_TOOL_DESCRIPTORS = listPresentationAuthoringProjectCommandDescriptors()
  .map((commandDescriptor) => descriptor({
    name: commandDescriptor.toolName,
    description: commandDescriptor.description,
    commandType: commandDescriptor.type,
    mutates: true,
    inputSchema: createMutationInputSchema(commandDescriptor.payloadSchema),
  }));

const SUPPORT_TOOL_DESCRIPTORS = Object.freeze([
  descriptor({
    name: 'presentation_authoring_inspect',
    description: 'Inspect the current semantic presentation authoring state without mutation.',
    mutates: false,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  }),
  descriptor({
    name: 'presentation_authoring_inverse',
    description: 'Derive the canonical inverse bound to one exact command application.',
    mutates: false,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'object' },
        change: { type: 'object' },
        receipt: { type: 'object' },
      },
      required: ['command', 'change', 'receipt'],
      additionalProperties: false,
    },
  }),
  descriptor({
    name: 'presentation_authoring_regeneration_request',
    description: 'Request one host-owned media regeneration dependency for the current ancestry.',
    mutates: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1 },
        base: clone(BASE_SCHEMA),
        artifactScope: clone(ARTIFACT_SCOPE_SCHEMA),
        dependency: { enum: [...MEDIA_DEPENDENCIES] },
      },
      required: ['id', 'base', 'dependency'],
      additionalProperties: false,
    },
  }),
  descriptor({
    name: 'presentation_authoring_regeneration_inspect',
    description: 'Inspect one regeneration receipt and atomically accept exact current ancestry.',
    mutates: true,
    inputSchema: {
      type: 'object',
      properties: {
        receiptId: { type: 'string', minLength: 1 },
        base: clone(BASE_SCHEMA),
        artifactScope: clone(ARTIFACT_SCOPE_SCHEMA),
      },
      required: ['receiptId', 'base'],
      additionalProperties: false,
    },
  }),
]);

const TOOL_DESCRIPTORS = Object.freeze([
  ...COMMAND_TOOL_DESCRIPTORS,
  ...SUPPORT_TOOL_DESCRIPTORS,
]);
const TOOL_DESCRIPTOR_BY_NAME = new Map(TOOL_DESCRIPTORS.map((item) => [item.name, item]));
const COMMAND_DESCRIPTOR_BY_TOOL = new Map(
  COMMAND_TOOL_DESCRIPTORS.map((item) => [item.name, item]),
);

export function listPresentationAuthoringToolDescriptors() {
  return TOOL_DESCRIPTORS.map((item) => clone(item));
}

function canonicalNarration(timeline, turnId) {
  let narrationTurns = timeline.turns
    .filter((turn) => turnId === undefined || turn.id === turnId)
    .map(({ cues, ...turn }) => turn);
  let personaIds = new Set(narrationTurns.map((turn) => turn.persona));
  return {
    schemaVersion: NARRATION_PROJECTION_VERSION,
    locale: timeline.locale,
    profile: timeline.profile,
    personas: Object.fromEntries(
      Object.entries(timeline.personas).filter(([personaId]) => personaIds.has(personaId)),
    ),
    turns: narrationTurns,
  };
}

function narrationHash(timeline, turnId) {
  return `${NARRATION_PROJECTION_VERSION}:${computeIntegrity(canonicalNarration(timeline, turnId))}`;
}

function artifact(value, path) {
  let source = object(value, path);
  knownKeys(source, ['hash', 'status'], path);
  assertRequired(source, ['hash', 'status'], path);
  if (!ARTIFACT_STATUSES.includes(source.status)) {
    fail(
      'PRESENTATION_AUTHORING_MEDIA_ANCESTRY_INVALID',
      `${path}.status must be accepted, stale, or missing`,
      { path: `${path}.status`, status: source.status },
    );
  }
  let hash = source.hash === null ? null : text(source.hash, `${path}.hash`);
  if (source.status === 'accepted' && hash === null) {
    fail(
      'PRESENTATION_AUTHORING_MEDIA_ANCESTRY_INVALID',
      `${path}.hash must identify an accepted artifact`,
      { path: `${path}.hash` },
    );
  }
  return { hash, status: source.status };
}

function missingArtifact() {
  return { hash: null, status: 'missing' };
}

function deriveMediaAncestry(project, alignment) {
  let timeline = createPresentationAuthoringTimelineProjection(project);
  let currentNarrationHash = narrationHash(timeline);
  if (alignment) {
    try {
      let validated = validatePresentationAlignedSequence(alignment, timeline);
      return {
        schemaVersion: MEDIA_ANCESTRY_VERSION,
        narrationHash: currentNarrationHash,
        audio: { hash: validated.media.hash, status: 'accepted' },
        alignment: { hash: validated.hash, status: 'accepted' },
        render: missingArtifact(),
        playable: false,
      };
    } catch {
      // A stale optional alignment is reported by projections and is not accepted as ancestry.
    }
  }
  return {
    schemaVersion: MEDIA_ANCESTRY_VERSION,
    narrationHash: currentNarrationHash,
    audio: missingArtifact(),
    alignment: missingArtifact(),
    render: missingArtifact(),
    playable: false,
  };
}

function normalizeMediaAncestry(value, project, alignment, options = {}) {
  let path = options.path || 'authority snapshot.mediaAncestry';
  if (value === undefined) return deriveMediaAncestry(project, alignment);
  let source = object(value, path);
  knownKeys(
    source,
    ['schemaVersion', 'narrationHash', 'audio', 'alignment', 'render', 'playable'],
    path,
  );
  assertRequired(
    source,
    ['schemaVersion', 'narrationHash', 'audio', 'alignment', 'render', 'playable'],
    path,
  );
  if (source.schemaVersion !== MEDIA_ANCESTRY_VERSION) {
    fail(
      'PRESENTATION_AUTHORING_MEDIA_ANCESTRY_INVALID',
      `media ancestry must use ${MEDIA_ANCESTRY_VERSION}`,
      { schemaVersion: source.schemaVersion },
    );
  }
  let currentNarrationHash = options.narrationHash;
  if (currentNarrationHash === undefined) {
    let timeline = createPresentationAuthoringTimelineProjection(project);
    currentNarrationHash = narrationHash(timeline);
  }
  let normalized = {
    schemaVersion: MEDIA_ANCESTRY_VERSION,
    narrationHash: text(source.narrationHash, `${path}.narrationHash`),
    audio: artifact(source.audio, `${path}.audio`),
    alignment: artifact(source.alignment, `${path}.alignment`),
    render: artifact(source.render, `${path}.render`),
    playable: source.playable,
  };
  if (normalized.narrationHash !== currentNarrationHash) {
    fail(
      'PRESENTATION_AUTHORING_MEDIA_ANCESTRY_INVALID',
      'media ancestry narrationHash does not match the current semantic narration',
      { expected: currentNarrationHash, received: normalized.narrationHash },
    );
  }
  if (typeof normalized.playable !== 'boolean') {
    fail(
      'PRESENTATION_AUTHORING_MEDIA_ANCESTRY_INVALID',
      'media ancestry playable must be boolean',
      { path: `${path}.playable` },
    );
  }
  if (
    normalized.alignment.status === 'accepted'
    && normalized.audio.status !== 'accepted'
  ) {
    fail(
      'PRESENTATION_AUTHORING_MEDIA_ANCESTRY_INVALID',
      'accepted alignment ancestry requires accepted narration audio ancestry',
      {
        path,
        audioStatus: normalized.audio.status,
        alignmentStatus: normalized.alignment.status,
      },
    );
  }
  if (
    normalized.render.status === 'accepted'
    && (
      normalized.audio.status !== 'accepted'
      || normalized.alignment.status !== 'accepted'
    )
  ) {
    fail(
      'PRESENTATION_AUTHORING_MEDIA_ANCESTRY_INVALID',
      'accepted render ancestry requires accepted narration audio and alignment ancestry',
      {
        path,
        audioStatus: normalized.audio.status,
        alignmentStatus: normalized.alignment.status,
        renderStatus: normalized.render.status,
      },
    );
  }
  let accepted = ['audio', 'alignment', 'render']
    .every((key) => normalized[key].status === 'accepted');
  if (normalized.playable !== accepted) {
    fail(
      'PRESENTATION_AUTHORING_MEDIA_ANCESTRY_INVALID',
      'media ancestry playable must exactly reflect all accepted dependencies',
      { expected: accepted, received: normalized.playable },
    );
  }
  if (options.validateAlignment !== false && normalized.alignment.status === 'accepted') {
    if (!alignment) {
      fail(
        'PRESENTATION_AUTHORING_MEDIA_ANCESTRY_INVALID',
        'accepted alignment ancestry requires its immutable aligned-sequence evidence',
      );
    }
    if (
      alignment.hash !== normalized.alignment.hash
      || alignment.media.hash !== normalized.audio.hash
    ) {
      fail(
        'PRESENTATION_AUTHORING_MEDIA_ANCESTRY_INVALID',
        'accepted audio/alignment hashes do not match their immutable aligned-sequence evidence',
        {
          expectedAlignmentHash: alignment.hash,
          receivedAlignmentHash: normalized.alignment.hash,
          expectedAudioHash: alignment.media.hash,
          receivedAudioHash: normalized.audio.hash,
        },
      );
    }
  }
  return normalized;
}

function normalizeArtifactScope(value, path = 'input.artifactScope') {
  let source = object(value, path);
  let keys = ['collectionId', 'manifestHash', 'entryId', 'narrationCellId'];
  knownKeys(source, keys, path);
  assertRequired(source, keys, path);
  return Object.fromEntries(keys.map((key) => [key, text(source[key], `${path}.${key}`)]));
}

function scopeForEntry(collection, entry) {
  return {
    collectionId: collection.collectionId,
    manifestHash: collection.manifestHash,
    entryId: entry.entryId,
    narrationCellId: entry.narrationCellId,
  };
}

function normalizeMediaCollection(value, project) {
  let path = 'authority snapshot.mediaCollection';
  let source = object(value, path);
  let keys = ['schemaVersion', 'collectionId', 'manifestHash', 'entries'];
  knownKeys(source, keys, path);
  assertRequired(source, keys, path);
  if (source.schemaVersion !== MEDIA_COLLECTION_VERSION) {
    fail(
      'PRESENTATION_AUTHORING_MEDIA_COLLECTION_INVALID',
      `media collection must use ${MEDIA_COLLECTION_VERSION}`,
      { schemaVersion: source.schemaVersion },
    );
  }
  if (!Array.isArray(source.entries) || !source.entries.length) {
    fail(
      'PRESENTATION_AUTHORING_MEDIA_COLLECTION_INVALID',
      `${path}.entries must be a nonempty array`,
      { path: `${path}.entries` },
    );
  }
  let timeline = createPresentationAuthoringTimelineProjection(project);
  let narrationCells = project.cells.filter((cell) => cell.kind === 'narration');
  let narrationByCellId = new Map(narrationCells.map((cell) => [cell.id, cell]));
  let seenEntries = new Set();
  let seenCells = new Set();
  let entries = source.entries.map((valueItem, index) => {
    let entryPath = `${path}.entries[${index}]`;
    let item = object(valueItem, entryPath);
    let entryKeys = ['entryId', 'narrationCellId', 'mediaAncestry'];
    knownKeys(item, entryKeys, entryPath);
    assertRequired(item, entryKeys, entryPath);
    let entryId = text(item.entryId, `${entryPath}.entryId`);
    let narrationCellId = text(item.narrationCellId, `${entryPath}.narrationCellId`);
    if (seenEntries.has(entryId) || seenCells.has(narrationCellId)) {
      fail(
        'PRESENTATION_AUTHORING_MEDIA_COLLECTION_INVALID',
        `${entryPath} duplicates an entry or narration cell identity`,
        { entryId, narrationCellId },
      );
    }
    let cell = narrationByCellId.get(narrationCellId);
    if (!cell || cell.turnId !== entryId) {
      fail(
        'PRESENTATION_AUTHORING_MEDIA_COLLECTION_INVALID',
        `${entryPath} must bind one exact narration cell and its semantic turn entry`,
        {
          entryId,
          narrationCellId,
          expectedEntryId: cell?.turnId || null,
        },
      );
    }
    seenEntries.add(entryId);
    seenCells.add(narrationCellId);
    return {
      entryId,
      narrationCellId,
      mediaAncestry: normalizeMediaAncestry(item.mediaAncestry, project, undefined, {
        path: `${entryPath}.mediaAncestry`,
        narrationHash: narrationHash(timeline, cell.turnId),
        validateAlignment: false,
      }),
    };
  });
  if (entries.length !== narrationCells.length) {
    fail(
      'PRESENTATION_AUTHORING_MEDIA_COLLECTION_INVALID',
      'media collection entries must cover every narration cell exactly once',
      { expected: narrationCells.length, received: entries.length },
    );
  }
  return {
    schemaVersion: MEDIA_COLLECTION_VERSION,
    collectionId: text(source.collectionId, `${path}.collectionId`),
    manifestHash: text(source.manifestHash, `${path}.manifestHash`),
    entries,
  };
}

function normalizeLooseAlignment(value) {
  if (value === undefined) return undefined;
  let source = object(value, 'authority snapshot.alignment');
  let keys = ['contractVersion', 'timelineHash', 'media', 'turns', 'events', 'hash'];
  knownKeys(source, keys, 'authority snapshot.alignment');
  assertRequired(source, keys, 'authority snapshot.alignment');
  if (source.contractVersion !== 'workspace-aligned-sequence-v1') {
    fail(
      'PRESENTATION_AUTHORING_ALIGNMENT_INVALID',
      'authority alignment must use workspace-aligned-sequence-v1',
      { contractVersion: source.contractVersion },
    );
  }
  object(source.media, 'authority snapshot.alignment.media');
  knownKeys(source.media, ['hash', 'durationMs', 'locale'], 'authority snapshot.alignment.media');
  assertRequired(source.media, ['hash', 'durationMs'], 'authority snapshot.alignment.media');
  text(source.media.hash, 'authority snapshot.alignment.media.hash');
  if (!Number.isInteger(source.media.durationMs) || source.media.durationMs < 1) {
    fail(
      'PRESENTATION_AUTHORING_ALIGNMENT_INVALID',
      'authority snapshot.alignment.media.durationMs must be a positive integer',
      { path: 'authority snapshot.alignment.media.durationMs' },
    );
  }
  if (!Array.isArray(source.turns) || !Array.isArray(source.events)) {
    fail(
      'PRESENTATION_AUTHORING_ALIGNMENT_INVALID',
      'authority alignment turns and events must be arrays',
    );
  }
  let expectedHash = `workspace-aligned-sequence-v1:${computeIntegrity({
    contractVersion: source.contractVersion,
    timelineHash: source.timelineHash,
    media: source.media,
    turns: source.turns,
    events: source.events,
  })}`;
  if (source.hash !== expectedHash) {
    fail(
      'PRESENTATION_AUTHORING_ALIGNMENT_INVALID',
      'authority alignment hash is stale',
      { expected: expectedHash, received: source.hash },
    );
  }
  return clone(source);
}

function normalizeSnapshot(value) {
  let source = object(value, 'authority snapshot');
  knownKeys(
    source,
    ['project', 'alignment', 'mediaAncestry', 'mediaCollection'],
    'authority snapshot',
  );
  assertRequired(source, ['project'], 'authority snapshot');
  let project;
  try {
    project = validatePresentationAuthoringProject(source.project);
  } catch (error) {
    throwMapped(error, 'PRESENTATION_AUTHORING_PROJECT_INVALID');
  }
  if (source.mediaCollection !== undefined) {
    if (source.alignment !== undefined || source.mediaAncestry !== undefined) {
      fail(
        'PRESENTATION_AUTHORING_MEDIA_COLLECTION_INVALID',
        'collection authority cannot contain an aggregate alignment or media ancestry',
      );
    }
    return {
      project,
      mediaCollection: normalizeMediaCollection(source.mediaCollection, project),
    };
  }
  let alignment = normalizeLooseAlignment(source.alignment);
  let mediaAncestry = normalizeMediaAncestry(source.mediaAncestry, project, alignment);
  return {
    project,
    ...(alignment ? { alignment } : {}),
    mediaAncestry,
  };
}

function createProjections(project, alignment) {
  let timeline = createPresentationAuthoringTimelineProjection(project);
  if (!alignment) {
    return {
      timeline,
      projectionStatus: {
        status: 'missing',
        code: 'PRESENTATION_AUTHORING_ALIGNMENT_MISSING',
        timelineHash: timeline.hash,
      },
    };
  }
  try {
    let validatedAlignment = validatePresentationAlignedSequence(alignment, timeline);
    let schedule = createPresentationScheduleV2(project, validatedAlignment);
    let nle = projectPresentationNle(project, schedule);
    return {
      timeline,
      schedule,
      nle,
      projectionStatus: {
        status: 'ready',
        timelineHash: timeline.hash,
        alignmentHash: validatedAlignment.hash,
        scheduleHash: schedule.hash,
        nleHash: nle.hash,
      },
    };
  } catch (error) {
    return {
      timeline,
      projectionStatus: {
        status: 'stale',
        code: error.code || 'PRESENTATION_AUTHORING_ALIGNMENT_STALE',
        timelineHash: timeline.hash,
        alignmentHash: alignment.hash,
        message: error.message,
      },
    };
  }
}

function inspection(snapshot) {
  let projections = createProjections(snapshot.project, snapshot.alignment);
  return {
    project: clone(snapshot.project),
    layers: clone(snapshot.project.layers),
    cells: clone(snapshot.project.cells),
    hashes: createPresentationAuthoringProjectHashes(snapshot.project),
    descriptors: listPresentationAuthoringToolDescriptors(),
    ...(snapshot.mediaCollection
      ? { mediaCollection: clone(snapshot.mediaCollection) }
      : { mediaAncestry: clone(snapshot.mediaAncestry) }),
    ...projections,
  };
}

function invalidation(beforeProject, afterProject, beforeAncestry, fromNarrationHash, toNarrationHash) {
  let value = {
    schemaVersion: MEDIA_INVALIDATION_VERSION,
    fromAuthoringProjectHash: beforeProject.hash,
    toAuthoringProjectHash: afterProject.hash,
    fromNarrationHash,
    toNarrationHash,
    invalidates: [...MEDIA_DEPENDENCIES],
    preservedLineage: {
      narrationAudioHash: beforeAncestry.audio.hash,
      alignmentHash: beforeAncestry.alignment.hash,
      renderHash: beforeAncestry.render.hash,
    },
  };
  return {
    ...value,
    hash: `${MEDIA_INVALIDATION_VERSION}:${computeIntegrity(value)}`,
  };
}

function scopedInvalidation(
  beforeProject,
  afterProject,
  artifactScope,
  beforeAncestry,
  fromNarrationHash,
  toNarrationHash,
) {
  let value = {
    schemaVersion: SCOPED_MEDIA_INVALIDATION_VERSION,
    artifactScope: clone(artifactScope),
    fromAuthoringProjectHash: beforeProject.hash,
    toAuthoringProjectHash: afterProject.hash,
    fromNarrationHash,
    toNarrationHash,
    invalidates: [...MEDIA_DEPENDENCIES],
    preservedLineage: {
      narrationAudioHash: beforeAncestry.audio.hash,
      alignmentHash: beforeAncestry.alignment.hash,
      renderHash: beforeAncestry.render.hash,
    },
  };
  return {
    ...value,
    hash: `${SCOPED_MEDIA_INVALIDATION_VERSION}:${computeIntegrity(value)}`,
  };
}

function collectionMediaAfterMutation(beforeSnapshot, nextProject) {
  let mediaCollection = clone(beforeSnapshot.mediaCollection);
  let nextTimeline = createPresentationAuthoringTimelineProjection(nextProject);
  let nextCellById = new Map(nextProject.cells.map((cell) => [cell.id, cell]));
  let invalidations = [];
  for (let [index, beforeEntry] of beforeSnapshot.mediaCollection.entries.entries()) {
    let nextCell = nextCellById.get(beforeEntry.narrationCellId);
    if (!nextCell || nextCell.kind !== 'narration' || nextCell.turnId !== beforeEntry.entryId) {
      fail(
        'PRESENTATION_AUTHORING_MEDIA_COLLECTION_INVALID',
        'collection mutation cannot detach an entry from its narration cell',
        scopeForEntry(beforeSnapshot.mediaCollection, beforeEntry),
      );
    }
    let fromNarrationHash = beforeEntry.mediaAncestry.narrationHash;
    let toNarrationHash = narrationHash(nextTimeline, nextCell.turnId);
    if (fromNarrationHash === toNarrationHash) continue;
    let mediaAncestry = {
      schemaVersion: MEDIA_ANCESTRY_VERSION,
      narrationHash: toNarrationHash,
      audio: { hash: beforeEntry.mediaAncestry.audio.hash, status: 'stale' },
      alignment: { hash: beforeEntry.mediaAncestry.alignment.hash, status: 'stale' },
      render: { hash: beforeEntry.mediaAncestry.render.hash, status: 'stale' },
      playable: false,
    };
    let artifactScope = scopeForEntry(beforeSnapshot.mediaCollection, beforeEntry);
    mediaCollection.entries[index] = {
      ...mediaCollection.entries[index],
      mediaAncestry,
    };
    invalidations.push(scopedInvalidation(
      beforeSnapshot.project,
      nextProject,
      artifactScope,
      beforeEntry.mediaAncestry,
      fromNarrationHash,
      toNarrationHash,
    ));
  }
  return {
    mediaCollection,
    mediaDisposition: invalidations.length
      ? {
        status: 'invalidated',
        invalidations,
        mediaCollection: clone(mediaCollection),
      }
      : {
        status: 'preserved',
        mediaCollection: clone(mediaCollection),
      },
  };
}

function mediaAfterMutation(beforeSnapshot, nextProject) {
  if (beforeSnapshot.mediaCollection) {
    return collectionMediaAfterMutation(beforeSnapshot, nextProject);
  }
  let beforeTimeline = createPresentationAuthoringTimelineProjection(beforeSnapshot.project);
  let nextTimeline = createPresentationAuthoringTimelineProjection(nextProject);
  let fromNarrationHash = narrationHash(beforeTimeline);
  let toNarrationHash = narrationHash(nextTimeline);
  if (fromNarrationHash === toNarrationHash) {
    return {
      mediaAncestry: clone(beforeSnapshot.mediaAncestry),
      mediaDisposition: {
        status: 'preserved',
        narrationHash: toNarrationHash,
        mediaAncestry: clone(beforeSnapshot.mediaAncestry),
      },
    };
  }
  let mediaAncestry = {
    schemaVersion: MEDIA_ANCESTRY_VERSION,
    narrationHash: toNarrationHash,
    audio: { hash: beforeSnapshot.mediaAncestry.audio.hash, status: 'stale' },
    alignment: { hash: beforeSnapshot.mediaAncestry.alignment.hash, status: 'stale' },
    render: { hash: beforeSnapshot.mediaAncestry.render.hash, status: 'stale' },
    playable: false,
  };
  let record = invalidation(
    beforeSnapshot.project,
    nextProject,
    beforeSnapshot.mediaAncestry,
    fromNarrationHash,
    toNarrationHash,
  );
  return {
    mediaAncestry,
    mediaDisposition: {
      status: 'invalidated',
      invalidation: record,
      mediaAncestry: clone(mediaAncestry),
    },
  };
}

function normalizeMutationInput(input, commandDescriptor) {
  let source = object(input, 'input');
  knownKeys(source, ['id', 'base', 'payload'], 'input');
  assertRequired(source, ['id', 'base', 'payload'], 'input');
  let payload = object(source.payload, 'input.payload');
  let payloadKeys = Object.keys(commandDescriptor.inputSchema.properties.payload.properties);
  knownKeys(payload, payloadKeys, 'input.payload');
  assertRequired(
    payload,
    commandDescriptor.inputSchema.properties.payload.required || [],
    'input.payload',
  );
  let semanticId = payload.cellId || payload.layerId || payload.cell?.id || payload.layer?.id;
  if (
    String(semanticId || '').startsWith('generated:')
    || payload.cell?.generated === true
    || payload.cell?.editable === false
    || payload.layer?.generated === true
    || payload.layer?.editable === false
  ) {
    fail(
      'PRESENTATION_AUTHORING_TOOL_READ_ONLY',
      'generated or read-only presentation projections cannot be authored',
      { id: semanticId || null },
    );
  }
  return {
    id: text(source.id, 'input.id'),
    base: normalizeBase(source.base),
    payload: clone(payload),
  };
}

function mutationResult(application, snapshot, mediaDisposition) {
  let projections = createProjections(application.project, snapshot.alignment);
  return {
    command: application.command,
    project: application.project,
    change: application.change,
    receipt: application.receipt,
    hashes: createPresentationAuthoringProjectHashes(application.project),
    ...projections,
    mediaDisposition,
  };
}

function normalizeEmptyInput(input, path = 'input') {
  let source = object(input, path);
  knownKeys(source, [], path);
  return source;
}

function normalizeInverseInput(input) {
  let source = object(input, 'input');
  knownKeys(source, ['command', 'change', 'receipt'], 'input');
  assertRequired(source, ['command', 'change', 'receipt'], 'input');
  return {
    command: clone(object(source.command, 'input.command')),
    change: clone(object(source.change, 'input.change')),
    receipt: clone(object(source.receipt, 'input.receipt')),
  };
}

function normalizeDependency(value, path = 'input.dependency') {
  let dependency = text(value, path);
  if (!MEDIA_DEPENDENCIES.includes(dependency)) {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_INVALID',
      `${path} must be narration-audio, alignment, or render`,
      { path, dependency },
    );
  }
  return dependency;
}

function predecessorsFor(dependency, ancestry) {
  if (dependency === 'narration-audio') return {};
  if (ancestry.audio.status !== 'accepted') {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_ORDER',
      'alignment and render regeneration require accepted narration audio',
      { dependency, audioStatus: ancestry.audio.status },
    );
  }
  if (dependency === 'alignment') return { narrationAudioHash: ancestry.audio.hash };
  if (ancestry.alignment.status !== 'accepted') {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_ORDER',
      'render regeneration requires accepted alignment',
      { dependency, alignmentStatus: ancestry.alignment.status },
    );
  }
  return {
    narrationAudioHash: ancestry.audio.hash,
    alignmentHash: ancestry.alignment.hash,
  };
}

function resolveMediaTarget(snapshot, artifactScope, errorCode) {
  if (!snapshot.mediaCollection) {
    if (artifactScope !== undefined) {
      fail(
        errorCode,
        'artifactScope requires a collection-scoped media authority',
        { received: artifactScope },
      );
    }
    return { kind: 'single', mediaAncestry: snapshot.mediaAncestry };
  }
  if (artifactScope === undefined) {
    fail(
      errorCode,
      'collection-scoped media authority requires artifactScope',
      {
        collectionId: snapshot.mediaCollection.collectionId,
        manifestHash: snapshot.mediaCollection.manifestHash,
      },
    );
  }
  let collection = snapshot.mediaCollection;
  if (
    artifactScope.collectionId !== collection.collectionId
    || artifactScope.manifestHash !== collection.manifestHash
  ) {
    fail(
      errorCode,
      'artifactScope collection or manifest identity is stale',
      {
        expected: {
          collectionId: collection.collectionId,
          manifestHash: collection.manifestHash,
        },
        received: artifactScope,
      },
    );
  }
  let entry = collection.entries.find((item) => (
    item.entryId === artifactScope.entryId
    && item.narrationCellId === artifactScope.narrationCellId
  ));
  if (!entry) {
    fail(
      errorCode,
      'artifactScope does not identify one current collection entry',
      { received: artifactScope },
    );
  }
  return {
    kind: 'collection',
    artifactScope: scopeForEntry(collection, entry),
    entry,
    mediaAncestry: entry.mediaAncestry,
  };
}

function createRegenerationRequest(input, snapshot) {
  let target = resolveMediaTarget(
    snapshot,
    input.artifactScope,
    'PRESENTATION_AUTHORING_ARTIFACT_SCOPE_INVALID',
  );
  let schemaVersion = target.kind === 'collection'
    ? SCOPED_REGENERATION_REQUEST_VERSION
    : REGENERATION_REQUEST_VERSION;
  let value = {
    schemaVersion,
    id: input.id,
    base: clone(input.base),
    ...(target.artifactScope ? { artifactScope: clone(target.artifactScope) } : {}),
    dependency: input.dependency,
    narrationHash: target.mediaAncestry.narrationHash,
    predecessors: predecessorsFor(input.dependency, target.mediaAncestry),
  };
  return {
    ...value,
    hash: `${schemaVersion}:${computeIntegrity(value)}`,
  };
}

function normalizeRegenerationRequestInput(input) {
  let source = object(input, 'input');
  knownKeys(source, ['id', 'base', 'artifactScope', 'dependency'], 'input');
  assertRequired(source, ['id', 'base', 'dependency'], 'input');
  return {
    id: text(source.id, 'input.id'),
    base: normalizeBase(source.base),
    ...(source.artifactScope === undefined
      ? {}
      : { artifactScope: normalizeArtifactScope(source.artifactScope) }),
    dependency: normalizeDependency(source.dependency),
  };
}

function normalizeRegenerationInspectInput(input) {
  let source = object(input, 'input');
  knownKeys(source, ['receiptId', 'base', 'artifactScope'], 'input');
  assertRequired(source, ['receiptId', 'base'], 'input');
  return {
    receiptId: text(source.receiptId, 'input.receiptId'),
    base: normalizeBase(source.base),
    ...(source.artifactScope === undefined
      ? {}
      : { artifactScope: normalizeArtifactScope(source.artifactScope) }),
  };
}

function normalizePredecessors(value, dependency, path) {
  let source = object(value, path);
  let keys = dependency === 'narration-audio'
    ? []
    : dependency === 'alignment'
      ? ['narrationAudioHash']
      : ['narrationAudioHash', 'alignmentHash'];
  knownKeys(source, keys, path);
  assertRequired(source, keys, path);
  return Object.fromEntries(keys.map((key) => [key, text(source[key], `${path}.${key}`)]));
}

function normalizeRegenerationReceipt(value) {
  let source = object(value, 'regeneration receipt');
  let scoped = source.schemaVersion === SCOPED_REGENERATION_RECEIPT_VERSION;
  if (!scoped && source.schemaVersion !== REGENERATION_RECEIPT_VERSION) {
    let supportedVersions = [
      REGENERATION_RECEIPT_VERSION,
      SCOPED_REGENERATION_RECEIPT_VERSION,
    ].join(' or ');
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_INVALID',
      `regeneration receipt must use ${supportedVersions}`,
      { schemaVersion: source.schemaVersion },
    );
  }
  let keys = [
    'schemaVersion',
    'receiptId',
    'requestId',
    'requestHash',
    'status',
    'base',
    'dependency',
    'narrationHash',
    'predecessors',
    'artifactHash',
    'hash',
    ...(scoped ? ['artifactScope'] : []),
  ];
  knownKeys(source, keys, 'regeneration receipt');
  assertRequired(source, keys, 'regeneration receipt');
  let status = text(source.status, 'regeneration receipt.status');
  if (!RECEIPT_STATUSES.includes(status)) {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_INVALID',
      'regeneration receipt status is invalid',
      { status },
    );
  }
  let dependency = normalizeDependency(source.dependency, 'regeneration receipt.dependency');
  let artifactHash = source.artifactHash === null
    ? null
    : text(source.artifactHash, 'regeneration receipt.artifactHash');
  if (status === 'accepted' && artifactHash === null) {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_INVALID',
      'accepted regeneration receipt requires artifactHash',
    );
  }
  if (status !== 'accepted' && artifactHash !== null) {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_INVALID',
      'non-accepted regeneration receipt cannot publish artifactHash',
    );
  }
  let normalized = {
    schemaVersion: source.schemaVersion,
    receiptId: text(source.receiptId, 'regeneration receipt.receiptId'),
    requestId: text(source.requestId, 'regeneration receipt.requestId'),
    requestHash: text(source.requestHash, 'regeneration receipt.requestHash'),
    status,
    base: normalizeBase(source.base, 'regeneration receipt.base'),
    ...(scoped ? {
      artifactScope: normalizeArtifactScope(
        source.artifactScope,
        'regeneration receipt.artifactScope',
      ),
    } : {}),
    dependency,
    narrationHash: text(source.narrationHash, 'regeneration receipt.narrationHash'),
    predecessors: normalizePredecessors(
      source.predecessors,
      dependency,
      'regeneration receipt.predecessors',
    ),
    artifactHash,
  };
  let expectedHash = `${source.schemaVersion}:${computeIntegrity(normalized)}`;
  if (source.hash !== expectedHash) {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_INVALID',
      'regeneration receipt hash is stale',
      { expected: expectedHash, received: source.hash },
    );
  }
  let requestSchemaVersion = scoped
    ? SCOPED_REGENERATION_REQUEST_VERSION
    : REGENERATION_REQUEST_VERSION;
  let requestValue = {
    schemaVersion: requestSchemaVersion,
    id: normalized.requestId,
    base: normalized.base,
    ...(scoped ? { artifactScope: normalized.artifactScope } : {}),
    dependency: normalized.dependency,
    narrationHash: normalized.narrationHash,
    predecessors: normalized.predecessors,
  };
  let expectedRequestHash = `${requestSchemaVersion}:${computeIntegrity(requestValue)}`;
  if (normalized.requestHash !== expectedRequestHash) {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_INVALID',
      'regeneration receipt requestHash does not match its embedded request ancestry',
      { expected: expectedRequestHash, received: normalized.requestHash },
    );
  }
  return { ...normalized, hash: source.hash };
}

function assertReceiptMatchesRequest(receipt, request) {
  let expectedReceiptVersion = request.artifactScope
    ? SCOPED_REGENERATION_RECEIPT_VERSION
    : REGENERATION_RECEIPT_VERSION;
  let expected = {
    requestId: request.id,
    requestHash: request.hash,
    base: request.base,
    ...(request.artifactScope ? { artifactScope: request.artifactScope } : {}),
    dependency: request.dependency,
    narrationHash: request.narrationHash,
    predecessors: request.predecessors,
  };
  let received = Object.fromEntries(Object.keys(expected).map((key) => [key, receipt[key]]));
  if (
    receipt.schemaVersion !== expectedReceiptVersion
    || canonicalize(received) !== canonicalize(expected)
  ) {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_STALE',
      'regeneration receipt does not match its exact request ancestry',
      { expected, received },
    );
  }
}

function assertReceiptMatchesInspectInput(receipt, input) {
  let expected = input.artifactScope;
  let received = receipt.artifactScope;
  if (
    (expected === undefined) !== (received === undefined)
    || (expected !== undefined && canonicalize(expected) !== canonicalize(received))
  ) {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_STALE',
      'regeneration receipt does not match the requested artifactScope',
      { expected: expected || null, received: received || null },
    );
  }
}

function assertReceiptMatchesSnapshot(receipt, snapshot) {
  let expectedBase = projectBase(snapshot.project);
  if (!sameBase(expectedBase, receipt.base)) {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_STALE',
      'regeneration receipt Project base is stale',
      { expected: expectedBase, received: receipt.base },
    );
  }
  let target = resolveMediaTarget(
    snapshot,
    receipt.artifactScope,
    'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_STALE',
  );
  if (receipt.narrationHash !== target.mediaAncestry.narrationHash) {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_STALE',
      'regeneration receipt narration ancestry is stale',
      {
        expected: target.mediaAncestry.narrationHash,
        received: receipt.narrationHash,
      },
    );
  }
  let expectedPredecessors;
  try {
    expectedPredecessors = predecessorsFor(receipt.dependency, target.mediaAncestry);
  } catch (error) {
    if (error?.code !== 'PRESENTATION_AUTHORING_REGENERATION_ORDER') throw error;
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_STALE',
      'regeneration receipt predecessor ancestry is no longer admissible',
      { dependency: receipt.dependency, mediaAncestry: target.mediaAncestry },
    );
  }
  if (canonicalize(receipt.predecessors) !== canonicalize(expectedPredecessors)) {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_STALE',
      'regeneration receipt predecessor ancestry is stale',
      { expected: expectedPredecessors, received: receipt.predecessors },
    );
  }
  return target;
}

function acceptRegeneration(snapshot, receipt) {
  let target = assertReceiptMatchesSnapshot(receipt, snapshot);
  let key = receipt.dependency === 'narration-audio' ? 'audio' : receipt.dependency;
  if (target.mediaAncestry[key].status === 'accepted') {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_ALREADY_APPLIED',
      `regeneration dependency "${receipt.dependency}" is already accepted`,
      { dependency: receipt.dependency },
    );
  }
  if (receipt.dependency === 'alignment' && target.kind === 'single') {
    let projections = createProjections(snapshot.project, snapshot.alignment);
    if (
      projections.projectionStatus.status !== 'ready'
      || snapshot.alignment.hash !== receipt.artifactHash
    ) {
      fail(
        'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_INVALID',
        'accepted alignment receipt requires the exact current validated aligned sequence',
        {
          projectionStatus: projections.projectionStatus,
          expectedAlignmentHash: snapshot.alignment?.hash || null,
          receivedAlignmentHash: receipt.artifactHash,
        },
      );
    }
  }
  let mediaAncestry = clone(target.mediaAncestry);
  mediaAncestry[key] = { hash: receipt.artifactHash, status: 'accepted' };
  mediaAncestry.playable = ['audio', 'alignment', 'render']
    .every((dependency) => mediaAncestry[dependency].status === 'accepted');
  if (target.kind === 'single') return { mediaAncestry };
  let mediaCollection = clone(snapshot.mediaCollection);
  let entryIndex = mediaCollection.entries.findIndex((entry) => (
    entry.entryId === target.entry.entryId
    && entry.narrationCellId === target.entry.narrationCellId
  ));
  mediaCollection.entries[entryIndex] = {
    ...mediaCollection.entries[entryIndex],
    mediaAncestry,
  };
  return {
    artifactScope: target.artifactScope,
    mediaCollection,
  };
}

function commandFromTool(input, descriptorValue) {
  return {
    schemaVersion: PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
    id: input.id,
    base: clone(input.base),
    type: descriptorValue.commandType,
    payload: clone(input.payload),
  };
}

function createAuthorityAdapter(authority) {
  if (!isObject(authority) || typeof authority.read !== 'function' || typeof authority.transact !== 'function') {
    fail(
      'PRESENTATION_AUTHORING_AUTHORITY_INVALID',
      'authority must expose read() and transact({ base }, update)',
    );
  }
  return authority;
}

function createRegenerationAdapter(regeneration) {
  if (
    !isObject(regeneration)
    || typeof regeneration.request !== 'function'
    || typeof regeneration.inspect !== 'function'
  ) {
    fail(
      'PRESENTATION_AUTHORING_REGENERATION_INVALID',
      'regeneration must expose request(request, { signal }) and inspect(receiptId, { signal })',
    );
  }
  return regeneration;
}

export function createPresentationAuthoringToolPack({ authority, regeneration } = {}) {
  let sessionAuthority = createAuthorityAdapter(authority);
  let regenerationAdapter = createRegenerationAdapter(regeneration);

  async function read(base, signal) {
    throwIfAborted(signal);
    try {
      let snapshot = normalizeSnapshot(await sessionAuthority.read());
      if (base) assertCurrentBase(snapshot.project, base);
      throwIfAborted(signal);
      return snapshot;
    } catch (error) {
      throwMapped(error, 'PRESENTATION_AUTHORING_AUTHORITY_FAILURE');
    }
  }

  async function transact(base, update, signal) {
    throwIfAborted(signal);
    let result;
    let updated = false;
    try {
      await sessionAuthority.transact({ base: clone(base) }, (currentValue) => {
        if (updated) {
          fail(
            'PRESENTATION_AUTHORING_AUTHORITY_INVALID',
            'authority transaction update must be applied exactly once',
          );
        }
        let current = normalizeSnapshot(currentValue);
        assertCurrentBase(current.project, base);
        let next = update(current);
        let normalizedNext = normalizeSnapshot(next.snapshot);
        result = clone(next.result);
        updated = true;
        return normalizedNext;
      });
      if (!updated) {
        fail(
          'PRESENTATION_AUTHORING_AUTHORITY_INVALID',
          'authority transaction did not apply its update',
        );
      }
      return result;
    } catch (error) {
      throwMapped(error, 'PRESENTATION_AUTHORING_AUTHORITY_FAILURE');
    }
  }

  async function invokeMutation(name, input, signal) {
    let descriptorValue = COMMAND_DESCRIPTOR_BY_TOOL.get(name);
    let normalized = normalizeMutationInput(input, descriptorValue);
    return transact(normalized.base, (current) => {
      let command = commandFromTool(normalized, descriptorValue);
      let application;
      try {
        application = applyPresentationAuthoringProjectCommand(current.project, command);
      } catch (error) {
        throwMapped(error, 'PRESENTATION_AUTHORING_TOOL_MUTATION_FAILED');
      }
      let media = mediaAfterMutation(current, application.project);
      let nextSnapshot = {
        project: application.project,
        ...(current.alignment ? { alignment: current.alignment } : {}),
        ...(media.mediaCollection
          ? { mediaCollection: media.mediaCollection }
          : { mediaAncestry: media.mediaAncestry }),
      };
      return {
        snapshot: nextSnapshot,
        result: mutationResult(
          { ...application, command },
          nextSnapshot,
          media.mediaDisposition,
        ),
      };
    }, signal);
  }

  async function invokeInspect(input, signal) {
    normalizeEmptyInput(input);
    return inspection(await read(null, signal));
  }

  async function invokeInverse(input, signal) {
    let normalized = normalizeInverseInput(input);
    let current = await read(null, signal);
    try {
      let inverse = invertPresentationAuthoringProjectCommand(normalized.command, {
        project: current.project,
        change: normalized.change,
        receipt: normalized.receipt,
      });
      let inverseDescriptor = listPresentationAuthoringProjectCommandDescriptors()
        .find((item) => item.type === inverse.type);
      return { inverse, toolName: inverseDescriptor.toolName };
    } catch (error) {
      throwMapped(error, 'PRESENTATION_AUTHORING_COMMAND_INVERSE_UNAVAILABLE');
    }
  }

  async function invokeRegenerationRequest(input, signal) {
    let normalized = normalizeRegenerationRequestInput(input);
    let current = await read(normalized.base, signal);
    let request = createRegenerationRequest(normalized, current);
    let receipt;
    try {
      receipt = normalizeRegenerationReceipt(
        await regenerationAdapter.request(immutable(request), { signal }),
      );
      assertReceiptMatchesRequest(receipt, request);
      throwIfAborted(signal);
    } catch (error) {
      throwMapped(error, 'PRESENTATION_AUTHORING_REGENERATION_FAILURE');
    }
    return { request: immutable(request), receipt: immutable(receipt) };
  }

  async function invokeRegenerationInspect(input, signal) {
    let normalized = normalizeRegenerationInspectInput(input);
    let beforeInspect = await read(normalized.base, signal);
    resolveMediaTarget(
      beforeInspect,
      normalized.artifactScope,
      'PRESENTATION_AUTHORING_ARTIFACT_SCOPE_INVALID',
    );
    let receipt;
    try {
      receipt = normalizeRegenerationReceipt(
        await regenerationAdapter.inspect(normalized.receiptId, { signal }),
      );
      if (receipt.receiptId !== normalized.receiptId) {
        fail(
          'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_INVALID',
          'regeneration inspect returned a different receiptId',
          { expected: normalized.receiptId, received: receipt.receiptId },
        );
      }
      assertReceiptMatchesInspectInput(receipt, normalized);
      assertReceiptMatchesSnapshot(receipt, beforeInspect);
      throwIfAborted(signal);
    } catch (error) {
      throwMapped(error, 'PRESENTATION_AUTHORING_REGENERATION_FAILURE');
    }
    if (receipt.status !== 'accepted') {
      return { receipt: immutable(receipt), mediaDisposition: { status: 'unchanged' } };
    }
    return transact(normalized.base, (current) => {
      let media = acceptRegeneration(current, receipt);
      let nextSnapshot = {
        project: current.project,
        ...(current.alignment ? { alignment: current.alignment } : {}),
        ...(media.mediaCollection
          ? { mediaCollection: media.mediaCollection }
          : { mediaAncestry: media.mediaAncestry }),
      };
      return {
        snapshot: nextSnapshot,
        result: {
          receipt: immutable(receipt),
          mediaDisposition: {
            status: 'regenerated',
            dependency: receipt.dependency,
            ...(media.artifactScope ? { artifactScope: media.artifactScope } : {}),
            ...(media.mediaCollection
              ? { mediaCollection: media.mediaCollection }
              : { mediaAncestry: media.mediaAncestry }),
          },
          ...createProjections(current.project, current.alignment),
        },
      };
    }, signal);
  }

  async function invoke(name, input = {}, { signal } = {}) {
    let descriptorValue = TOOL_DESCRIPTOR_BY_NAME.get(name);
    if (!descriptorValue) {
      fail(
        'PRESENTATION_AUTHORING_TOOL_UNKNOWN',
        `unknown presentation authoring tool "${String(name)}"`,
        { name: String(name) },
      );
    }
    if (descriptorValue.commandType) return invokeMutation(name, input, signal);
    if (name === 'presentation_authoring_inspect') return invokeInspect(input, signal);
    if (name === 'presentation_authoring_inverse') return invokeInverse(input, signal);
    if (name === 'presentation_authoring_regeneration_request') {
      return invokeRegenerationRequest(input, signal);
    }
    return invokeRegenerationInspect(input, signal);
  }

  return Object.freeze({
    tools: Object.freeze(listPresentationAuthoringToolDescriptors().map(deepFreeze)),
    invoke,
  });
}
