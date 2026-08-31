import { canonicalize, computeIntegrity } from '../../schema/canonical-json.js';
import {
  PRESENTATION_ANNOTATION_INTENTS,
  PRESENTATION_ANNOTATION_PLACEMENTS,
  PRESENTATION_CUE_KINDS,
  PRESENTATION_DELIVERY_EMOTIONS,
  PRESENTATION_DELIVERY_PACES,
  PRESENTATION_DIALOGUE_ACTS,
  PRESENTATION_INTERACTION_TYPES,
  PRESENTATION_MARKERS,
  PRESENTATION_STATE_CONDITIONS,
  PRESENTATION_SYMBOLS,
  PRESENTATION_SYNC_ANCHORS,
} from './contract.js';
import {
  PRESENTATION_AUTHORING_PROJECT_LAYER_KINDS,
  PRESENTATION_AUTHORING_PROJECT_SETTLE_POLICIES,
  createPresentationAuthoringProject,
  validatePresentationAuthoringProject,
} from './project.js';

export const PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION = 'workspace-presentation-authoring-command-v1';
export const PRESENTATION_AUTHORING_COMMAND_RECEIPT_VERSION = 'workspace-presentation-authoring-command-receipt-v1';

function payloadSchema(properties, required = Object.keys(properties)) {
  return Object.freeze({
    type: 'object',
    properties: Object.freeze(properties),
    required: Object.freeze(required),
    additionalProperties: false,
  });
}

const LAYER_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    id: { type: 'string', minLength: 1 },
    kind: { enum: [...PRESENTATION_AUTHORING_PROJECT_LAYER_KINDS] },
    name: { type: 'string', minLength: 1 },
    visualOwnerId: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
    collisionDomainId: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
  }),
  required: Object.freeze(['id', 'kind']),
  additionalProperties: false,
});

const DEPENDENCY_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    cellId: { type: 'string', minLength: 1 },
    barrier: { enum: ['ended', 'settled', 'acted', 'ready'] },
  }),
  required: Object.freeze(['cellId', 'barrier']),
  additionalProperties: false,
});

const SYNC_ANCHOR_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    anchor: { enum: [...PRESENTATION_SYNC_ANCHORS] },
    quote: { type: 'string', minLength: 1 },
    occurrence: { type: 'integer', minimum: 1 },
    edge: { enum: ['start', 'end'] },
    offsetMs: { type: 'integer', minimum: -5000, maximum: 5000 },
  }),
  required: Object.freeze(['anchor']),
  additionalProperties: false,
});

const TIMING_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    at: SYNC_ANCHOR_SCHEMA,
    until: { anyOf: [SYNC_ANCHOR_SCHEMA, { type: 'null' }] },
    leadMs: { type: 'integer', minimum: 0 },
    gestureDurationMs: { type: 'integer', minimum: 0 },
    settleBy: { enum: [...PRESENTATION_AUTHORING_PROJECT_SETTLE_POLICIES] },
  }),
  required: Object.freeze(['at', 'until', 'leadMs', 'gestureDurationMs', 'settleBy']),
  additionalProperties: false,
});

const AUDIO_CLIP_ANCHOR_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    anchor: { enum: ['turn-start', 'turn-end'] },
    offsetMs: {
      type: 'integer',
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    },
  }),
  required: Object.freeze(['anchor', 'offsetMs']),
  additionalProperties: false,
});

const AUDIO_CLIP_TIMING_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    at: AUDIO_CLIP_ANCHOR_SCHEMA,
  }),
  required: Object.freeze(['at']),
  additionalProperties: false,
});

const AUDIO_CLIP_SOURCE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    assetId: { type: 'string', minLength: 1 },
    sourceInMs: { type: 'integer', minimum: 0 },
    sourceOutMs: { type: 'integer', minimum: 1 },
  }),
  required: Object.freeze(['assetId', 'sourceInMs', 'sourceOutMs']),
  additionalProperties: false,
});

const CUE_BINDING_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    cueCellId: { type: 'string', minLength: 1 },
    at: SYNC_ANCHOR_SCHEMA,
    until: { anyOf: [SYNC_ANCHOR_SCHEMA, { type: 'null' }] },
  }),
  required: Object.freeze(['cueCellId', 'at', 'until']),
  additionalProperties: false,
});

const DELIVERY_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    emotion: { enum: [...PRESENTATION_DELIVERY_EMOTIONS] },
    pace: { enum: [...PRESENTATION_DELIVERY_PACES] },
    tone: { type: 'string' },
  }),
  additionalProperties: false,
});

const TRANSITION_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    pauseBeforeMs: { type: 'integer', minimum: 0, maximum: 10000 },
    overlapMs: { type: 'integer', minimum: 0, maximum: 5000 },
  }),
  additionalProperties: false,
});

const SOURCE_REF_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    sourceId: { type: 'string', minLength: 1 },
    path: { type: 'string' },
    hash: { type: 'string' },
    targetId: { type: 'string' },
  }),
  required: Object.freeze(['sourceId']),
  additionalProperties: false,
});

const STRING_ARRAY_SCHEMA = Object.freeze({
  type: 'array',
  items: { type: 'string', minLength: 1 },
});

const CLAIM_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    id: { type: 'string', minLength: 1 },
    kind: { type: 'string', minLength: 1 },
    text: { type: 'string', minLength: 1 },
    factRefs: STRING_ARRAY_SCHEMA,
    evidenceRefs: STRING_ARRAY_SCHEMA,
    targetRefs: STRING_ARRAY_SCHEMA,
  }),
  required: Object.freeze(['id', 'kind', 'text', 'factRefs', 'evidenceRefs', 'targetRefs']),
  additionalProperties: false,
});

const TURN_CONTENT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    id: { type: 'string', minLength: 1 },
    persona: { type: 'string', minLength: 1 },
    addressee: { type: 'string', minLength: 1 },
    dialogueAct: { enum: [...PRESENTATION_DIALOGUE_ACTS] },
    replyTo: { type: 'string', minLength: 1 },
    text: { type: 'string', minLength: 1 },
    sourceRefs: { type: 'array', items: SOURCE_REF_SCHEMA },
    claims: { type: 'array', items: CLAIM_SCHEMA },
    delivery: DELIVERY_SCHEMA,
    transition: TRANSITION_SCHEMA,
  }),
  required: Object.freeze(['id', 'persona', 'dialogueAct', 'text', 'sourceRefs', 'claims']),
  additionalProperties: false,
});

const BINDING_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    source: { enum: ['webmcp', 'workspace', 'host'] },
    tool: { type: 'string', minLength: 1 },
    input: {},
  }),
  required: Object.freeze(['source', 'tool']),
  additionalProperties: false,
});

const FOCUS_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({ mode: { enum: ['cursor', 'frame'] } }),
  additionalProperties: false,
});

const INTERACTION_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    type: { enum: [...PRESENTATION_INTERACTION_TYPES] },
    binding: BINDING_SCHEMA,
    parameters: {},
    reversible: { type: 'boolean' },
  }),
  required: Object.freeze(['type']),
  additionalProperties: false,
});

const ANNOTATION_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    intent: { enum: [...PRESENTATION_ANNOTATION_INTENTS] },
    marker: { enum: [...PRESENTATION_MARKERS] },
    symbol: { enum: [...PRESENTATION_SYMBOLS] },
    placement: { enum: [...PRESENTATION_ANNOTATION_PLACEMENTS] },
  }),
  required: Object.freeze(['intent']),
  additionalProperties: false,
});

const STATE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    condition: { enum: [...PRESENTATION_STATE_CONDITIONS] },
    path: { type: 'string' },
    value: {},
    timeoutMs: { type: 'integer', minimum: 1, maximum: 120000 },
  }),
  required: Object.freeze(['condition']),
  additionalProperties: false,
});

const CUE_CONTENT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    kind: { enum: [...PRESENTATION_CUE_KINDS] },
    targetId: { type: 'string', minLength: 1 },
    tabId: { type: 'string', minLength: 1 },
    focus: FOCUS_SCHEMA,
    interaction: INTERACTION_SCHEMA,
    annotation: ANNOTATION_SCHEMA,
    state: STATE_SCHEMA,
  }),
  required: Object.freeze(['kind']),
  additionalProperties: false,
});

const AUDIO_CLIP_CELL_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    id: { type: 'string', minLength: 1 },
    kind: { enum: ['audio-clip'] },
    layerId: { type: 'string', minLength: 1 },
    turnId: { type: 'string', minLength: 1 },
    audio: AUDIO_CLIP_SOURCE_SCHEMA,
    timing: AUDIO_CLIP_TIMING_SCHEMA,
    dependsOn: { type: 'array', items: DEPENDENCY_SCHEMA },
  }),
  required: Object.freeze(['id', 'kind', 'layerId', 'turnId', 'audio', 'timing', 'dependsOn']),
  additionalProperties: false,
});

const CELL_SCHEMA = Object.freeze({
  oneOf: Object.freeze([
    {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1 },
        kind: { enum: ['narration'] },
        layerId: { type: 'string', minLength: 1 },
        turnId: { type: 'string', minLength: 1 },
        turn: TURN_CONTENT_SCHEMA,
        dependsOn: { type: 'array', items: DEPENDENCY_SCHEMA },
      },
      required: ['id', 'kind', 'layerId', 'turnId', 'turn', 'dependsOn'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1 },
        kind: { enum: ['cue'] },
        layerId: { type: 'string', minLength: 1 },
        turnId: { type: 'string', minLength: 1 },
        cue: CUE_CONTENT_SCHEMA,
        timing: TIMING_SCHEMA,
        dependsOn: { type: 'array', items: DEPENDENCY_SCHEMA },
      },
      required: ['id', 'kind', 'layerId', 'turnId', 'cue', 'timing', 'dependsOn'],
      additionalProperties: false,
    },
    AUDIO_CLIP_CELL_SCHEMA,
  ]),
});

const COMMAND_DESCRIPTORS = Object.freeze([
  {
    type: 'layer.add',
    toolName: 'presentation_authoring_layer_add',
    description: 'Add one ordered presentation layer.',
    payloadKeys: ['layer', 'index'],
    payloadSchema: payloadSchema({
      layer: LAYER_SCHEMA,
      index: { type: 'integer', minimum: 0 },
    }, ['layer']),
    invertible: true,
  },
  {
    type: 'layer.update',
    toolName: 'presentation_authoring_layer_update',
    description: 'Update bounded presentation layer metadata.',
    payloadKeys: ['layerId', 'changes'],
    payloadSchema: payloadSchema({
      layerId: { type: 'string', minLength: 1 },
      changes: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          visualOwnerId: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
          collisionDomainId: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
        },
        minProperties: 1,
        additionalProperties: false,
      },
    }),
    invertible: true,
  },
  {
    type: 'layer.remove',
    toolName: 'presentation_authoring_layer_remove',
    description: 'Remove one empty presentation layer.',
    payloadKeys: ['layerId'],
    payloadSchema: payloadSchema({ layerId: { type: 'string', minLength: 1 } }),
    invertible: true,
  },
  {
    type: 'layer.move',
    toolName: 'presentation_authoring_layer_move',
    description: 'Move one presentation layer in canonical track order.',
    payloadKeys: ['layerId', 'index'],
    payloadSchema: payloadSchema({
      layerId: { type: 'string', minLength: 1 },
      index: { type: 'integer', minimum: 0 },
    }),
    invertible: true,
  },
  {
    type: 'cell.add',
    toolName: 'presentation_authoring_cell_add',
    description: 'Add one authored presentation cell.',
    payloadKeys: ['cell', 'index'],
    payloadSchema: payloadSchema({
      cell: CELL_SCHEMA,
      index: { type: 'integer', minimum: 0 },
    }, ['cell']),
    invertible: true,
  },
  {
    type: 'cell.remove',
    toolName: 'presentation_authoring_cell_remove',
    description: 'Remove one authored presentation cell.',
    payloadKeys: ['cellId'],
    payloadSchema: payloadSchema({ cellId: { type: 'string', minLength: 1 } }),
    invertible: true,
  },
  {
    type: 'cell.move',
    toolName: 'presentation_authoring_cell_move',
    description: 'Move one cell in canonical authored order.',
    payloadKeys: ['cellId', 'index'],
    payloadSchema: payloadSchema({
      cellId: { type: 'string', minLength: 1 },
      index: { type: 'integer', minimum: 0 },
    }),
    invertible: true,
  },
  {
    type: 'cell.set-content',
    toolName: 'presentation_authoring_cell_set_content',
    description: 'Replace bounded narration or cue semantic content.',
    payloadKeys: ['cellId', 'content'],
    payloadSchema: payloadSchema({
      cellId: { type: 'string', minLength: 1 },
      content: { oneOf: [TURN_CONTENT_SCHEMA, CUE_CONTENT_SCHEMA] },
    }),
    invertible: true,
  },
  {
    type: 'cell.set-timing',
    toolName: 'presentation_authoring_cell_set_timing',
    description: 'Replace semantic cue timing without resolved milliseconds.',
    payloadKeys: ['cellId', 'timing'],
    payloadSchema: payloadSchema({
      cellId: { type: 'string', minLength: 1 },
      timing: TIMING_SCHEMA,
    }),
    invertible: true,
  },
  {
    type: 'cell.set-dependencies',
    toolName: 'presentation_authoring_cell_set_dependencies',
    description: 'Replace typed cell dependency barriers.',
    payloadKeys: ['cellId', 'dependsOn'],
    payloadSchema: payloadSchema({
      cellId: { type: 'string', minLength: 1 },
      dependsOn: {
        type: 'array',
        items: DEPENDENCY_SCHEMA,
      },
    }),
    invertible: true,
  },
  {
    type: 'narration.replace',
    toolName: 'presentation_authoring_narration_replace',
    description: 'Atomically replace one narration turn and its bounded speech cue bindings.',
    payloadKeys: ['narrationCellId', 'turn', 'cueBindings'],
    payloadSchema: payloadSchema({
      narrationCellId: { type: 'string', minLength: 1 },
      turn: TURN_CONTENT_SCHEMA,
      cueBindings: {
        type: 'array',
        minItems: 1,
        items: CUE_BINDING_SCHEMA,
      },
    }),
    invertible: true,
  },
  {
    type: 'audio-clip.split',
    toolName: 'presentation_authoring_audio_clip_split',
    description: 'Split one audio clip at a source-media boundary.',
    payloadKeys: ['cellId', 'sourceAtMs', 'rightCellId'],
    payloadSchema: payloadSchema({
      cellId: { type: 'string', minLength: 1 },
      sourceAtMs: { type: 'integer', minimum: 1 },
      rightCellId: { type: 'string', minLength: 1 },
    }),
    invertible: true,
  },
  {
    type: 'audio-clip.trim',
    toolName: 'presentation_authoring_audio_clip_trim',
    description: 'Trim one audio clip to a half-open source-media range.',
    payloadKeys: ['cellId', 'sourceInMs', 'sourceOutMs'],
    payloadSchema: payloadSchema({
      cellId: { type: 'string', minLength: 1 },
      sourceInMs: { type: 'integer', minimum: 0 },
      sourceOutMs: { type: 'integer', minimum: 1 },
    }),
    invertible: true,
  },
  {
    type: 'audio-clip.move',
    toolName: 'presentation_authoring_audio_clip_move',
    description: 'Move one audio clip by replacing its semantic timing anchor.',
    payloadKeys: ['cellId', 'timing'],
    payloadSchema: payloadSchema({
      cellId: { type: 'string', minLength: 1 },
      timing: AUDIO_CLIP_TIMING_SCHEMA,
    }),
    invertible: true,
  },
  {
    type: 'audio-clip.link',
    toolName: 'presentation_authoring_audio_clip_link',
    description: 'Link one audio clip to an event barrier.',
    payloadKeys: ['clipCellId', 'eventCellId', 'barrier'],
    payloadSchema: payloadSchema({
      clipCellId: { type: 'string', minLength: 1 },
      eventCellId: { type: 'string', minLength: 1 },
      barrier: { enum: ['ended', 'settled', 'acted', 'ready'] },
    }),
    invertible: true,
  },
  {
    type: 'audio-clip.unlink',
    toolName: 'presentation_authoring_audio_clip_unlink',
    description: 'Remove one exact audio-clip event-barrier link.',
    payloadKeys: ['clipCellId', 'eventCellId', 'barrier'],
    payloadSchema: payloadSchema({
      clipCellId: { type: 'string', minLength: 1 },
      eventCellId: { type: 'string', minLength: 1 },
      barrier: { enum: ['ended', 'settled', 'acted', 'ready'] },
    }),
    invertible: true,
  },
]);

// Split restoration must update the retained left cell and remove the generated right cell
// atomically. Keep that receipt-only operation out of the public MCP/CLI tool surface.
const INTERNAL_COMMAND_DESCRIPTORS = Object.freeze([
  {
    type: 'audio-clip.restore-split',
    payloadKeys: ['leftCell', 'rightCellId'],
    payloadSchema: payloadSchema({
      leftCell: AUDIO_CLIP_CELL_SCHEMA,
      rightCellId: { type: 'string', minLength: 1 },
    }),
    invertible: false,
  },
  {
    type: 'audio-clip.restore-link',
    payloadKeys: ['clipCellId', 'eventCellId', 'barrier', 'index'],
    payloadSchema: payloadSchema({
      clipCellId: { type: 'string', minLength: 1 },
      eventCellId: { type: 'string', minLength: 1 },
      barrier: { enum: ['ended', 'settled', 'acted', 'ready'] },
      index: { type: 'integer', minimum: 0 },
    }),
    invertible: false,
  },
]);

const ALL_COMMAND_DESCRIPTORS = Object.freeze([
  ...COMMAND_DESCRIPTORS,
  ...INTERNAL_COMMAND_DESCRIPTORS,
]);
const DESCRIPTOR_BY_TYPE = new Map(ALL_COMMAND_DESCRIPTORS.map((item) => [item.type, item]));

export class PresentationAuthoringProjectCommandError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PresentationAuthoringProjectCommandError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new PresentationAuthoringProjectCommandError(code, message, details);
}

function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value, path) {
  if (!isObject(value)) fail('PRESENTATION_AUTHORING_COMMAND_INVALID', `${path} must be an object`, { path });
  return value;
}

function knownKeys(value, keys, path) {
  for (let key of Object.keys(value)) {
    if (!keys.includes(key)) {
      fail(
        'PRESENTATION_AUTHORING_COMMAND_INVALID',
        `${path}.${key} is not supported by ${PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION}`,
        { path: `${path}.${key}` },
      );
    }
  }
}

function text(value, path) {
  let normalized = String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!normalized) fail('PRESENTATION_AUTHORING_COMMAND_INVALID', `${path} must be nonempty text`, { path });
  return normalized;
}

function index(value, path, max, fallback = max) {
  let normalized = value === undefined ? fallback : value;
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > max) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVALID',
      `${path} must be an integer between 0 and ${max}`,
      { path, index: normalized },
    );
  }
  return normalized;
}

function clone(value) {
  return JSON.parse(canonicalize(value));
}

function findIndex(records, id, path) {
  let found = records.findIndex((item) => item.id === id);
  if (found < 0) {
    fail('PRESENTATION_AUTHORING_COMMAND_TARGET_MISSING', `${path} names unknown id "${id}"`, {
      path,
      id,
    });
  }
  return found;
}

function integerValue(value, path, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVALID',
      `${path} must be a safe integer between ${min} and ${max}`,
      { path, value },
    );
  }
  return value;
}

function audioClipAt(draft, value, path) {
  let cellId = text(value, path);
  let cellIndex = findIndex(draft.cells, cellId, path);
  let cell = draft.cells[cellIndex];
  if (cell.kind !== 'audio-clip') {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVALID',
      `${path} must name an audio-clip cell`,
      { path, cellId, kind: cell.kind },
    );
  }
  return { cellId, cellIndex, cell };
}

function eventCellAt(draft, value, path) {
  let cellId = text(value, path);
  let cellIndex = findIndex(draft.cells, cellId, path);
  let cell = draft.cells[cellIndex];
  if (cell.kind !== 'cue') {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVALID',
      `${path} must name a cue event cell`,
      { path, cellId, kind: cell.kind },
    );
  }
  return { cellId, cellIndex, cell };
}

function dependencyBarrier(value, path) {
  let barrier = text(value, path);
  if (!['ended', 'settled', 'acted', 'ready'].includes(barrier)) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVALID',
      `${path} must be ended, settled, acted, or ready`,
      { path, barrier },
    );
  }
  return barrier;
}

function splitAudioClip(leftCell, sourceAtMs, rightCellId) {
  let left = clone(leftCell);
  let deltaMs = sourceAtMs - left.audio.sourceInMs;
  left.audio.sourceOutMs = sourceAtMs;
  let right = {
    ...clone(leftCell),
    id: rightCellId,
    audio: {
      ...clone(leftCell.audio),
      sourceInMs: sourceAtMs,
    },
    timing: {
      ...clone(leftCell.timing),
      at: {
        ...clone(leftCell.timing.at),
        offsetMs: leftCell.timing.at.offsetMs + deltaMs,
      },
    },
    dependsOn: [
      ...clone(leftCell.dependsOn),
      { cellId: leftCell.id, barrier: 'ended' },
    ],
  };
  return { left, right };
}

function normalizeCommand(value) {
  let command = object(value, 'command');
  knownKeys(command, ['schemaVersion', 'id', 'base', 'type', 'payload'], 'command');
  if (command.schemaVersion !== PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVALID',
      `unsupported presentation command version: ${command.schemaVersion}`,
      { schemaVersion: command.schemaVersion },
    );
  }
  let id = text(command.id, 'command.id');
  let type = text(command.type, 'command.type');
  let descriptor = DESCRIPTOR_BY_TYPE.get(type);
  if (!descriptor) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVALID',
      `command.type must be one of ${COMMAND_DESCRIPTORS.map((item) => item.type).join(', ')}`,
      { type },
    );
  }
  let base = object(command.base, 'command.base');
  knownKeys(base, ['revision', 'authoringProjectHash'], 'command.base');
  if (!Number.isInteger(base.revision) || base.revision < 0) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVALID',
      'command.base.revision must be a non-negative integer',
      { path: 'command.base.revision' },
    );
  }
  let authoringProjectHash = text(base.authoringProjectHash, 'command.base.authoringProjectHash');
  let payload = object(command.payload, 'command.payload');
  knownKeys(payload, descriptor.payloadKeys, 'command.payload');
  return {
    schemaVersion: PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
    id,
    base: { revision: base.revision, authoringProjectHash },
    type,
    payload: clone(payload),
  };
}

function assertCurrentBase(project, command) {
  if (
    command.base.revision !== project.revision
    || command.base.authoringProjectHash !== project.hash
  ) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_STALE',
      `command "${command.id}" base does not match the current authoring project`,
      {
        commandId: command.id,
        expected: { revision: project.revision, authoringProjectHash: project.hash },
        received: command.base,
      },
    );
  }
}

function applyAdd(records, item, requestedIndex, key) {
  if (records.some((record) => record.id === item.id)) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_DUPLICATE_ID',
      `${key} id "${item.id}" already exists`,
      { id: item.id },
    );
  }
  let toIndex = index(requestedIndex, `command.payload.index`, records.length);
  records.splice(toIndex, 0, clone(item));
  return toIndex;
}

function applyMove(records, id, requestedIndex, key) {
  let fromIndex = findIndex(records, id, `command.payload.${key}Id`);
  let [item] = records.splice(fromIndex, 1);
  let toIndex = index(requestedIndex, 'command.payload.index', records.length);
  records.splice(toIndex, 0, item);
  return { fromIndex, toIndex, item: clone(item) };
}

function isSpeechAnchor(value) {
  return isObject(value) && value.anchor === 'speech';
}

function applyNarrationReplacement(draft, payload) {
  let narrationCellId = text(payload.narrationCellId, 'command.payload.narrationCellId');
  let narrationCellIndex = findIndex(
    draft.cells,
    narrationCellId,
    'command.payload.narrationCellId',
  );
  let narrationCell = draft.cells[narrationCellIndex];
  if (narrationCell.kind !== 'narration') {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVALID',
      `narration.replace requires a narration cell, received "${narrationCellId}"`,
      { narrationCellId, kind: narrationCell.kind },
    );
  }
  let turn = object(payload.turn, 'command.payload.turn');
  let turnId = text(turn.id, 'command.payload.turn.id');
  if (turnId !== narrationCell.turnId) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVALID',
      `command.payload.turn.id must remain "${narrationCell.turnId}"`,
      { narrationCellId, expectedTurnId: narrationCell.turnId, receivedTurnId: turnId },
    );
  }
  if (!Array.isArray(payload.cueBindings) || !payload.cueBindings.length) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVALID',
      'command.payload.cueBindings must be a nonempty array',
      { path: 'command.payload.cueBindings' },
    );
  }

  let seen = new Set();
  let updates = payload.cueBindings.map((value, bindingIndex) => {
    let path = `command.payload.cueBindings[${bindingIndex}]`;
    let binding = object(value, path);
    knownKeys(binding, ['cueCellId', 'at', 'until'], path);
    let cueCellId = text(binding.cueCellId, `${path}.cueCellId`);
    if (seen.has(cueCellId)) {
      fail(
        'PRESENTATION_AUTHORING_COMMAND_DUPLICATE_ID',
        `${path}.cueCellId duplicates cue cell "${cueCellId}"`,
        { cueCellId, path: `${path}.cueCellId` },
      );
    }
    seen.add(cueCellId);
    let cueCellIndex = findIndex(draft.cells, cueCellId, `${path}.cueCellId`);
    let cueCell = draft.cells[cueCellIndex];
    if (cueCell.kind !== 'cue') {
      fail(
        'PRESENTATION_AUTHORING_COMMAND_INVALID',
        `${path}.cueCellId must name a cue cell`,
        { cueCellId, kind: cueCell.kind },
      );
    }
    if (cueCell.turnId !== narrationCell.turnId) {
      fail(
        'PRESENTATION_AUTHORING_COMMAND_INVALID',
        `${path}.cueCellId must belong to turn "${narrationCell.turnId}"`,
        { cueCellId, expectedTurnId: narrationCell.turnId, receivedTurnId: cueCell.turnId },
      );
    }
    let at = object(binding.at, `${path}.at`);
    let until = binding.until === null ? null : object(binding.until, `${path}.until`);
    if (![
      cueCell.timing.at,
      cueCell.timing.until,
      at,
      until,
    ].some(isSpeechAnchor)) {
      fail(
        'PRESENTATION_AUTHORING_COMMAND_INVALID',
        `${path} must replace a current or replacement speech anchor`,
        { cueCellId },
      );
    }
    return {
      cueCellIndex,
      before: {
        cueCellId,
        at: clone(cueCell.timing.at),
        until: clone(cueCell.timing.until),
      },
      after: { cueCellId, at: clone(at), until: clone(until) },
    };
  });

  let before = {
    turn: clone(narrationCell.turn),
    cueBindings: updates.map((update) => update.before),
  };
  narrationCell.turn = clone(turn);
  for (let update of updates) {
    let cueCell = draft.cells[update.cueCellIndex];
    cueCell.timing = {
      ...cueCell.timing,
      at: clone(update.after.at),
      until: clone(update.after.until),
    };
  }
  return {
    draft,
    change: {
      type: 'narration.replace',
      narrationCellId,
      turnId: narrationCell.turnId,
      before,
      after: {
        turn: clone(turn),
        cueBindings: updates.map((update) => update.after),
      },
    },
  };
}

function applyAudioClipMutation(draft, command) {
  let payload = command.payload;
  if (command.type === 'audio-clip.split') {
    let { cellId, cellIndex, cell } = audioClipAt(
      draft,
      payload.cellId,
      'command.payload.cellId',
    );
    let sourceAtMs = integerValue(payload.sourceAtMs, 'command.payload.sourceAtMs', {
      min: cell.audio.sourceInMs + 1,
      max: cell.audio.sourceOutMs - 1,
    });
    let rightCellId = text(payload.rightCellId, 'command.payload.rightCellId');
    if (draft.cells.some((candidate) => candidate.id === rightCellId)) {
      fail(
        'PRESENTATION_AUTHORING_COMMAND_DUPLICATE_ID',
        `cell id "${rightCellId}" already exists`,
        { id: rightCellId },
      );
    }
    let before = clone(cell);
    let { left, right } = splitAudioClip(before, sourceAtMs, rightCellId);
    integerValue(right.timing.at.offsetMs, 'command.payload.sourceAtMs');
    draft.cells.splice(cellIndex, 1, left, right);
    return {
      draft,
      change: {
        type: command.type,
        cellId,
        rightCellId,
        before,
        left: clone(left),
        right: clone(right),
      },
    };
  }
  if (command.type === 'audio-clip.trim') {
    let { cellId, cell } = audioClipAt(draft, payload.cellId, 'command.payload.cellId');
    let sourceInMs = integerValue(payload.sourceInMs, 'command.payload.sourceInMs', { min: 0 });
    let sourceOutMs = integerValue(payload.sourceOutMs, 'command.payload.sourceOutMs', {
      min: sourceInMs + 1,
    });
    let before = clone(cell.audio);
    cell.audio = { ...cell.audio, sourceInMs, sourceOutMs };
    return {
      draft,
      change: { type: command.type, cellId, before, after: clone(cell.audio) },
    };
  }
  if (command.type === 'audio-clip.move') {
    let { cellId, cell } = audioClipAt(draft, payload.cellId, 'command.payload.cellId');
    let timing = object(payload.timing, 'command.payload.timing');
    let before = clone(cell.timing);
    cell.timing = clone(timing);
    return {
      draft,
      change: { type: command.type, cellId, before, after: clone(timing) },
    };
  }
  if (command.type === 'audio-clip.restore-split') {
    let leftCell = object(payload.leftCell, 'command.payload.leftCell');
    let { cellIndex, cell } = audioClipAt(draft, leftCell.id, 'command.payload.leftCell.id');
    let rightCellId = text(payload.rightCellId, 'command.payload.rightCellId');
    let rightIndex = findIndex(draft.cells, rightCellId, 'command.payload.rightCellId');
    if (rightIndex !== cellIndex + 1) {
      fail(
        'PRESENTATION_AUTHORING_COMMAND_INVALID',
        'split restoration requires the generated right clip immediately after the retained left clip',
        { leftCellId: cell.id, rightCellId },
      );
    }
    let { left: expectedLeft, right: expectedRight } = splitAudioClip(
      leftCell,
      cell.audio.sourceOutMs,
      rightCellId,
    );
    if (
      canonicalize(cell) !== canonicalize(expectedLeft)
      || canonicalize(draft.cells[rightIndex]) !== canonicalize(expectedRight)
    ) {
      fail(
        'PRESENTATION_AUTHORING_COMMAND_INVALID',
        'split restoration target no longer matches the exact generated split pair',
        { leftCellId: cell.id, rightCellId },
      );
    }
    draft.cells.splice(cellIndex, 2, clone(leftCell));
    return {
      draft,
      change: {
        type: command.type,
        leftCellId: leftCell.id,
        rightCellId,
        before: [clone(cell), clone(expectedRight)],
        after: clone(leftCell),
      },
    };
  }

  let { cellId: clipCellId, cell: clip } = audioClipAt(
    draft,
    payload.clipCellId,
    'command.payload.clipCellId',
  );
  let { cellId: eventCellId } = eventCellAt(
    draft,
    payload.eventCellId,
    'command.payload.eventCellId',
  );
  let barrier = dependencyBarrier(payload.barrier, 'command.payload.barrier');
  let dependency = { cellId: eventCellId, barrier };
  let dependencyIndex = clip.dependsOn.findIndex((candidate) => (
    candidate.cellId === eventCellId && candidate.barrier === barrier
  ));
  if (command.type === 'audio-clip.link' || command.type === 'audio-clip.restore-link') {
    if (dependencyIndex >= 0) {
      fail(
        'PRESENTATION_AUTHORING_COMMAND_DUPLICATE_ID',
        `audio clip "${clipCellId}" already has the exact dependency "${eventCellId}:${barrier}"`,
        { clipCellId, eventCellId, barrier },
      );
    }
    let toIndex = command.type === 'audio-clip.restore-link'
      ? index(payload.index, 'command.payload.index', clip.dependsOn.length)
      : clip.dependsOn.length;
    clip.dependsOn.splice(toIndex, 0, dependency);
    return {
      draft,
      change: {
        type: command.type,
        clipCellId,
        eventCellId,
        barrier,
        index: toIndex,
      },
    };
  }
  if (dependencyIndex < 0) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_TARGET_MISSING',
      `audio clip "${clipCellId}" has no exact dependency "${eventCellId}:${barrier}"`,
      { clipCellId, eventCellId, barrier },
    );
  }
  clip.dependsOn.splice(dependencyIndex, 1);
  return {
    draft,
    change: {
      type: command.type,
      clipCellId,
      eventCellId,
      barrier,
      index: dependencyIndex,
    },
  };
}

function applyMutation(project, command) {
  let draft = clone(project);
  delete draft.hash;
  let payload = command.payload;

  if (command.type === 'layer.add') {
    let layer = object(payload.layer, 'command.payload.layer');
    let toIndex = applyAdd(draft.layers, layer, payload.index, 'layer');
    return { draft, change: { type: command.type, layer: clone(layer), toIndex } };
  }
  if (command.type === 'layer.update') {
    let layerId = text(payload.layerId, 'command.payload.layerId');
    let layerIndex = findIndex(draft.layers, layerId, 'command.payload.layerId');
    let changes = object(payload.changes, 'command.payload.changes');
    knownKeys(changes, ['name', 'visualOwnerId', 'collisionDomainId'], 'command.payload.changes');
    if (!Object.keys(changes).length) {
      fail(
        'PRESENTATION_AUTHORING_COMMAND_INVALID',
        'command.payload.changes must update at least one bounded layer field',
        { path: 'command.payload.changes' },
      );
    }
    let before = clone(draft.layers[layerIndex]);
    draft.layers[layerIndex] = { ...draft.layers[layerIndex], ...clone(changes) };
    return {
      draft,
      change: {
        type: command.type,
        layerId,
        before,
        after: clone(draft.layers[layerIndex]),
      },
    };
  }
  if (command.type === 'layer.remove') {
    let layerId = text(payload.layerId, 'command.payload.layerId');
    let layerIndex = findIndex(draft.layers, layerId, 'command.payload.layerId');
    if (draft.cells.some((cell) => cell.layerId === layerId)) {
      fail(
        'PRESENTATION_AUTHORING_COMMAND_LAYER_NOT_EMPTY',
        `layer "${layerId}" cannot be removed while it owns cells`,
        { layerId },
      );
    }
    let [layer] = draft.layers.splice(layerIndex, 1);
    return { draft, change: { type: command.type, layer: clone(layer), fromIndex: layerIndex } };
  }
  if (command.type === 'layer.move') {
    let layerId = text(payload.layerId, 'command.payload.layerId');
    let moved = applyMove(draft.layers, layerId, payload.index, 'layer');
    return {
      draft,
      change: {
        type: command.type,
        layerId,
        fromIndex: moved.fromIndex,
        toIndex: moved.toIndex,
      },
    };
  }
  if (command.type === 'cell.add') {
    let cell = object(payload.cell, 'command.payload.cell');
    let toIndex = applyAdd(draft.cells, cell, payload.index, 'cell');
    return { draft, change: { type: command.type, cell: clone(cell), toIndex } };
  }
  if (command.type === 'cell.remove') {
    let cellId = text(payload.cellId, 'command.payload.cellId');
    let cellIndex = findIndex(draft.cells, cellId, 'command.payload.cellId');
    let [cell] = draft.cells.splice(cellIndex, 1);
    return { draft, change: { type: command.type, cell: clone(cell), fromIndex: cellIndex } };
  }
  if (command.type === 'cell.move') {
    let cellId = text(payload.cellId, 'command.payload.cellId');
    let moved = applyMove(draft.cells, cellId, payload.index, 'cell');
    return {
      draft,
      change: {
        type: command.type,
        cellId,
        fromIndex: moved.fromIndex,
        toIndex: moved.toIndex,
      },
    };
  }
  if (command.type === 'narration.replace') {
    return applyNarrationReplacement(draft, payload);
  }
  if (command.type.startsWith('audio-clip.')) {
    return applyAudioClipMutation(draft, command);
  }

  let cellId = text(payload.cellId, 'command.payload.cellId');
  let cellIndex = findIndex(draft.cells, cellId, 'command.payload.cellId');
  let cell = draft.cells[cellIndex];
  if (command.type === 'cell.set-content') {
    let content = object(payload.content, 'command.payload.content');
    let before = clone(cell.kind === 'narration' ? cell.turn : cell.cue);
    if (cell.kind === 'narration') cell.turn = clone(content);
    else cell.cue = clone(content);
    return {
      draft,
      change: { type: command.type, cellId, before, after: clone(content) },
    };
  }
  if (command.type === 'cell.set-timing') {
    if (cell.kind !== 'cue') {
      fail(
        'PRESENTATION_AUTHORING_COMMAND_INVALID',
        `cell.set-timing requires a cue cell, received "${cellId}"`,
        { cellId },
      );
    }
    let timing = object(payload.timing, 'command.payload.timing');
    let before = clone(cell.timing);
    cell.timing = clone(timing);
    return {
      draft,
      change: { type: command.type, cellId, before, after: clone(timing) },
    };
  }
  let dependsOn = payload.dependsOn;
  if (!Array.isArray(dependsOn)) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVALID',
      'command.payload.dependsOn must be an array',
      { path: 'command.payload.dependsOn' },
    );
  }
  let before = clone(cell.dependsOn);
  cell.dependsOn = clone(dependsOn);
  return {
    draft,
    change: { type: command.type, cellId, before, after: clone(dependsOn) },
  };
}

function createReceipt(command, project, change) {
  let receipt = {
    schemaVersion: PRESENTATION_AUTHORING_COMMAND_RECEIPT_VERSION,
    commandId: command.id,
    commandType: command.type,
    commandHash: `${PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION}:${computeIntegrity(command)}`,
    base: clone(command.base),
    revision: project.revision,
    authoringProjectHash: project.hash,
    changeHash: `${PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION}:change:${computeIntegrity(change)}`,
  };
  return {
    ...receipt,
    hash: `${PRESENTATION_AUTHORING_COMMAND_RECEIPT_VERSION}:${computeIntegrity(receipt)}`,
  };
}

function applyCommandTransaction(projectInput, commandInputs) {
  let project = validatePresentationAuthoringProject(projectInput);
  let ids = new Set();
  let commands = commandInputs.map((commandInput) => {
    let command = normalizeCommand(commandInput);
    if (ids.has(command.id)) {
      fail(
        'PRESENTATION_AUTHORING_COMMAND_DUPLICATE_ID',
        `command id "${command.id}" is duplicated in the command batch`,
        { commandId: command.id },
      );
    }
    ids.add(command.id);
    assertCurrentBase(project, command);
    return command;
  });
  if (!commands.length) return { project, changes: [], receipts: [] };

  let draft = clone(project);
  delete draft.hash;
  let changes = [];
  for (let command of commands) {
    let mutation = applyMutation(draft, command);
    draft = mutation.draft;
    changes.push(mutation.change);
  }
  let nextProject = createPresentationAuthoringProject({
    ...draft,
    revision: project.revision + 1,
  });
  let receipts = commands.map((command, commandIndex) => (
    createReceipt(command, nextProject, changes[commandIndex])
  ));
  return { project: nextProject, changes, receipts };
}

function assertInverseApplication(command, application) {
  if (!isObject(application) || !isObject(application.change) || !isObject(application.receipt)) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVERSE_UNAVAILABLE',
      'inverse requires the exact project, change, and receipt returned by command application',
      { commandId: command.id },
    );
  }
  let project;
  try {
    project = validatePresentationAuthoringProject(application.project);
  } catch (error) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVERSE_UNAVAILABLE',
      'inverse application authoring project is invalid or stale',
      { commandId: command.id, cause: error.message },
    );
  }
  let expectedReceipt = createReceipt(command, project, application.change);
  if (canonicalize(application.receipt) !== canonicalize(expectedReceipt)) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVERSE_UNAVAILABLE',
      `application receipt does not belong to command "${command.id}" and its exact change`,
      {
        commandId: command.id,
        expectedReceiptHash: expectedReceipt.hash,
        receivedReceiptHash: application.receipt.hash,
      },
    );
  }
  return { project, change: application.change };
}

/**
 * @returns {object[]}
 */
export function listPresentationAuthoringProjectCommandDescriptors() {
  return COMMAND_DESCRIPTORS.map((descriptor) => clone(descriptor));
}

/**
 * @param {object} projectInput
 * @param {object} commandInput
 * @returns {{project: object, change: object, receipt: object}}
 */
export function applyPresentationAuthoringProjectCommand(projectInput, commandInput) {
  let result = applyCommandTransaction(projectInput, [commandInput]);
  return {
    project: result.project,
    change: result.changes[0],
    receipt: result.receipts[0],
  };
}

/**
 * @param {object} projectInput
 * @param {object[]} commandInputs
 * @returns {{project: object, changes: object[], receipts: object[]}}
 */
export function applyPresentationAuthoringProjectCommands(projectInput, commandInputs = []) {
  if (!Array.isArray(commandInputs)) {
    fail('PRESENTATION_AUTHORING_COMMAND_INVALID', 'commands must be an array', { path: 'commands' });
  }
  return applyCommandTransaction(projectInput, commandInputs);
}

/**
 * @param {object} commandInput
 * @param {{project: object, change: object}} application
 * @returns {object}
 */
export function invertPresentationAuthoringProjectCommand(commandInput, application = {}) {
  let command = normalizeCommand(commandInput);
  let { project, change } = assertInverseApplication(command, application);
  if (change.type !== command.type) {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVERSE_UNAVAILABLE',
      'application.change does not describe the supplied command type',
      { commandType: command.type, changeType: change.type },
    );
  }
  let inverseType;
  let payload;
  if (command.type === 'layer.add') {
    inverseType = 'layer.remove';
    payload = { layerId: change.layer.id };
  } else if (command.type === 'layer.remove') {
    inverseType = 'layer.add';
    payload = { layer: change.layer, index: change.fromIndex };
  } else if (command.type === 'layer.update') {
    inverseType = 'layer.update';
    payload = {
      layerId: change.layerId,
      changes: {
        name: change.before.name,
        visualOwnerId: change.before.visualOwnerId,
        collisionDomainId: change.before.collisionDomainId,
      },
    };
  } else if (command.type === 'layer.move') {
    inverseType = 'layer.move';
    payload = { layerId: change.layerId, index: change.fromIndex };
  } else if (command.type === 'cell.add') {
    inverseType = 'cell.remove';
    payload = { cellId: change.cell.id };
  } else if (command.type === 'cell.remove') {
    inverseType = 'cell.add';
    payload = { cell: change.cell, index: change.fromIndex };
  } else if (command.type === 'cell.move') {
    inverseType = 'cell.move';
    payload = { cellId: change.cellId, index: change.fromIndex };
  } else if (command.type === 'cell.set-content') {
    inverseType = command.type;
    payload = { cellId: change.cellId, content: change.before };
  } else if (command.type === 'cell.set-timing') {
    inverseType = command.type;
    payload = { cellId: change.cellId, timing: change.before };
  } else if (command.type === 'cell.set-dependencies') {
    inverseType = command.type;
    payload = { cellId: change.cellId, dependsOn: change.before };
  } else if (command.type === 'narration.replace') {
    inverseType = command.type;
    payload = {
      narrationCellId: change.narrationCellId,
      turn: change.before.turn,
      cueBindings: change.before.cueBindings,
    };
  } else if (command.type === 'audio-clip.split') {
    inverseType = 'audio-clip.restore-split';
    payload = { leftCell: change.before, rightCellId: change.rightCellId };
  } else if (command.type === 'audio-clip.trim') {
    inverseType = command.type;
    payload = {
      cellId: change.cellId,
      sourceInMs: change.before.sourceInMs,
      sourceOutMs: change.before.sourceOutMs,
    };
  } else if (command.type === 'audio-clip.move') {
    inverseType = command.type;
    payload = { cellId: change.cellId, timing: change.before };
  } else if (command.type === 'audio-clip.link') {
    inverseType = 'audio-clip.unlink';
    payload = {
      clipCellId: change.clipCellId,
      eventCellId: change.eventCellId,
      barrier: change.barrier,
    };
  } else if (command.type === 'audio-clip.unlink') {
    inverseType = 'audio-clip.restore-link';
    payload = {
      clipCellId: change.clipCellId,
      eventCellId: change.eventCellId,
      barrier: change.barrier,
      index: change.index,
    };
  } else {
    fail(
      'PRESENTATION_AUTHORING_COMMAND_INVERSE_UNAVAILABLE',
      `command type "${command.type}" has no inverse`,
      { commandType: command.type },
    );
  }
  return {
    schemaVersion: PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
    id: `${command.id}:inverse:${project.revision}`,
    base: { revision: project.revision, authoringProjectHash: project.hash },
    type: inverseType,
    payload,
  };
}
