import { canonicalize, computeIntegrity } from '../../schema/canonical-json.js';
import {
  PRESENTATION_CONTRACT_VERSION,
  createPresentationTimelineContract,
} from './contract.js';

export const PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION = 'workspace-presentation-authoring-project-v2';
export const PRESENTATION_AUTHORING_PROJECT_LAYER_KINDS = Object.freeze([
  'narration',
  'focus',
  'annotation',
  'interaction',
  'state',
  'audio',
]);
export const PRESENTATION_AUTHORING_PROJECT_SETTLE_POLICIES = Object.freeze(['none', 'anchor']);

const PROJECT_KEYS = Object.freeze([
  'schemaVersion',
  'id',
  'revision',
  'script',
  'policy',
  'assets',
  'layers',
  'cells',
  'hash',
]);
const SCRIPT_KEYS = Object.freeze([
  'title',
  'locale',
  'profile',
  'personas',
  'grounding',
  'source',
  'metadata',
]);
const VISUAL_LAYER_KINDS = new Set(['focus', 'annotation', 'interaction']);
const DEFAULT_LAYER_KINDS = Object.freeze([
  'narration',
  'focus',
  'annotation',
  'interaction',
  'state',
]);
const RUNTIME_DATA_KEYS = new Set([
  'selector',
  'selectors',
  'domselector',
  'domselectors',
  'rect',
  'rectangle',
  'pixels',
  'pixel',
  'coordinates',
  'resolvedcoordinates',
  'boundingclientrect',
  'boundingrect',
  'viewportrect',
  'x',
  'y',
  'width',
  'height',
  'top',
  'right',
  'bottom',
  'left',
  'offsetx',
  'offsety',
  'scrollx',
  'scrolly',
  'devicepixelratio',
  'runtimereceipt',
  'runtimereceipts',
  'receipt',
  'receipts',
  'clientx',
  'clienty',
  'screenx',
  'screeny',
  'pagex',
  'pagey',
  'atms',
  'untilms',
  'startms',
  'endms',
]);
const DEFAULT_GESTURE_DURATIONS = Object.freeze({
  focus: 800,
  annotation: 800,
  interaction: 600,
  state: 0,
});

export class PresentationAuthoringProjectValidationError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PresentationAuthoringProjectValidationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new PresentationAuthoringProjectValidationError(code, message, details);
}

function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value, path) {
  if (!isObject(value)) fail('PRESENTATION_AUTHORING_PROJECT_INVALID', `${path} must be an object`, { path });
  return value;
}

function knownKeys(value, keys, path) {
  for (let key of Object.keys(value)) {
    if (!keys.includes(key)) {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_INVALID',
        `${path}.${key} is not supported by ${PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION}`,
        { path: `${path}.${key}` },
      );
    }
  }
}

function text(value, path, fallback) {
  let normalized = String(value ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized && fallback !== undefined) return fallback;
  if (!normalized) fail('PRESENTATION_AUTHORING_PROJECT_INVALID', `${path} must be nonempty text`, { path });
  return normalized;
}

function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(
      'PRESENTATION_AUTHORING_PROJECT_INVALID',
      `${path} must be an integer between ${min} and ${max}`,
      { path },
    );
  }
  return value;
}

function canonicalClone(value) {
  return JSON.parse(canonicalize(value));
}

function withoutKey(value, omittedKey) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== omittedKey));
}

function assertPortableId(value, path) {
  let id = text(value, path);
  if (!/^[a-z][a-z0-9./:_-]*$/i.test(id)) {
    fail(
      'PRESENTATION_AUTHORING_PROJECT_INVALID',
      `${path} must be a portable identifier`,
      { path, id },
    );
  }
  return id;
}

function isRuntimeDataKey(key) {
  let compact = key.toLowerCase().replace(/[-_]/g, '');
  if (RUNTIME_DATA_KEYS.has(compact)) return true;
  let tokens = key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((token) => (
    ['selector', 'selectors', 'pixel', 'pixels', 'coordinate', 'coordinates',
      'rect', 'rectangle', 'receipt', 'receipts'].includes(token)
  ));
}

function assertNoRuntimeData(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRuntimeData(item, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (let [key, child] of Object.entries(value)) {
    let normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
    if (isRuntimeDataKey(key)) {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_RUNTIME_DATA',
        `${path}.${key} is runtime-only data and cannot be authored in a presentation project`,
        { path: `${path}.${key}` },
      );
    }
    if (['targetid', 'tabid'].includes(normalizedKey) && child !== undefined) {
      try {
        assertPortableId(child, `${path}.${key}`);
      } catch (error) {
        fail(
          'PRESENTATION_AUTHORING_PROJECT_RUNTIME_DATA',
          `${path}.${key} must be a portable semantic identifier, not a runtime selector`,
          { path: `${path}.${key}`, value: child },
        );
      }
    }
    if (normalizedKey === 'targetrefs' && Array.isArray(child)) {
      child.forEach((targetId, index) => {
        try {
          assertPortableId(targetId, `${path}.${key}[${index}]`);
        } catch (error) {
          fail(
            'PRESENTATION_AUTHORING_PROJECT_RUNTIME_DATA',
            `${path}.${key}[${index}] must be a portable semantic identifier`,
            { path: `${path}.${key}[${index}]`, value: targetId },
          );
        }
      });
    }
    assertNoRuntimeData(child, `${path}.${key}`);
  }
}

function normalizePolicy(value, projectId) {
  let source = object(value || {}, 'project.policy');
  knownKeys(source, ['visualOwnerId', 'collisionDomains'], 'project.policy');
  let visualOwnerId = assertPortableId(
    source.visualOwnerId || `${projectId}:presenter`,
    'project.policy.visualOwnerId',
  );
  let domains = source.collisionDomains || [{
    id: `${projectId}:presenter-gesture`,
    name: 'Presenter gesture',
    exclusive: true,
  }];
  if (!Array.isArray(domains) || domains.length !== 1) {
    fail(
      'PRESENTATION_AUTHORING_PROJECT_COLLISION_DOMAIN_INVALID',
      'project.policy.collisionDomains must contain exactly one exclusive presenter domain',
      { path: 'project.policy.collisionDomains' },
    );
  }
  let seen = new Set();
  let collisionDomains = domains.map((valueItem, index) => {
    let path = `project.policy.collisionDomains[${index}]`;
    let item = object(valueItem, path);
    knownKeys(item, ['id', 'name', 'exclusive'], path);
    let id = assertPortableId(item.id, `${path}.id`);
    if (seen.has(id)) {
      fail('PRESENTATION_AUTHORING_PROJECT_INVALID', `${path}.id duplicates collision domain "${id}"`, {
        path: `${path}.id`,
        id,
      });
    }
    seen.add(id);
    if (item.exclusive !== undefined && item.exclusive !== true) {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_INVALID',
        `${path}.exclusive must be true for a named presenter collision domain`,
        { path: `${path}.exclusive` },
      );
    }
    return {
      id,
      name: text(item.name, `${path}.name`, id),
      exclusive: true,
    };
  });
  return { visualOwnerId, collisionDomains };
}

function normalizeLayers(value, policy) {
  if (!Array.isArray(value) || !value.length) {
    fail('PRESENTATION_AUTHORING_PROJECT_INVALID', 'project.layers must be a nonempty array', {
      path: 'project.layers',
    });
  }
  let domainIds = new Set(policy.collisionDomains.map((domain) => domain.id));
  let seen = new Set();
  let layers = value.map((valueItem, index) => {
    let path = `project.layers[${index}]`;
    let item = object(valueItem, path);
    knownKeys(
      item,
      ['id', 'kind', 'name', 'visualOwnerId', 'collisionDomainId'],
      path,
    );
    let id = assertPortableId(item.id, `${path}.id`);
    if (seen.has(id)) {
      fail('PRESENTATION_AUTHORING_PROJECT_INVALID', `${path}.id duplicates layer "${id}"`, {
        path: `${path}.id`,
        id,
      });
    }
    seen.add(id);
    let kind = text(item.kind, `${path}.kind`);
    if (!PRESENTATION_AUTHORING_PROJECT_LAYER_KINDS.includes(kind)) {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_INVALID',
        `${path}.kind must be one of ${PRESENTATION_AUTHORING_PROJECT_LAYER_KINDS.join(', ')}`,
        { path: `${path}.kind`, kind },
      );
    }
    let visual = VISUAL_LAYER_KINDS.has(kind);
    let visualOwnerId = item.visualOwnerId ?? (visual ? policy.visualOwnerId : null);
    let collisionDomainId = item.collisionDomainId
      ?? (visual ? policy.collisionDomains[0].id : null);
    if (visual && visualOwnerId !== policy.visualOwnerId) {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_INVALID',
        `${path}.visualOwnerId must use the project visual owner`,
        { path: `${path}.visualOwnerId`, visualOwnerId },
      );
    }
    if (visual && !domainIds.has(collisionDomainId)) {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_COLLISION_DOMAIN_INVALID',
        `${path}.collisionDomainId must use the project-wide presenter collision domain`,
        { path: `${path}.collisionDomainId`, collisionDomainId },
      );
    }
    if (!visual && (visualOwnerId !== null || collisionDomainId !== null)) {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_INVALID',
        `${path} is not visual and cannot own presenter collision state`,
        { path },
      );
    }
    return {
      id,
      kind,
      name: text(item.name, `${path}.name`, `${kind[0].toUpperCase()}${kind.slice(1)}`),
      visualOwnerId,
      collisionDomainId,
    };
  });
  if (!layers.some((layer) => layer.kind === 'narration')) {
    fail(
      'PRESENTATION_AUTHORING_PROJECT_INVALID',
      'project.layers requires a narration layer',
      { path: 'project.layers' },
    );
  }
  return layers;
}

function normalizeAssets(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    fail('PRESENTATION_AUTHORING_PROJECT_INVALID', 'project.assets must be an array', {
      path: 'project.assets',
    });
  }
  let seen = new Set();
  return value.map((valueItem, index) => {
    let path = `project.assets[${index}]`;
    let item = object(valueItem, path);
    knownKeys(
      item,
      [
        'id',
        'kind',
        'mediaType',
        'durationMs',
        'contentHash',
        'alignmentHash',
        'sourceTimelineHash',
      ],
      path,
    );
    let id = assertPortableId(item.id, `${path}.id`);
    if (seen.has(id)) {
      fail('PRESENTATION_AUTHORING_PROJECT_INVALID', `${path}.id duplicates asset "${id}"`, {
        path: `${path}.id`,
        id,
      });
    }
    seen.add(id);
    let kind = text(item.kind, `${path}.kind`);
    if (kind !== 'audio') {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_INVALID',
        `${path}.kind must be audio`,
        { path: `${path}.kind`, kind },
      );
    }
    return {
      id,
      kind,
      mediaType: text(item.mediaType, `${path}.mediaType`),
      durationMs: integer(item.durationMs, `${path}.durationMs`, { min: 1 }),
      contentHash: text(item.contentHash, `${path}.contentHash`),
      alignmentHash: text(item.alignmentHash, `${path}.alignmentHash`),
      sourceTimelineHash: text(item.sourceTimelineHash, `${path}.sourceTimelineHash`),
    };
  });
}

function normalizeDependencies(value, path) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    fail('PRESENTATION_AUTHORING_PROJECT_INVALID', `${path} must be an array`, { path });
  }
  let seen = new Set();
  return value.map((valueItem, index) => {
    let itemPath = `${path}[${index}]`;
    let item = object(valueItem, itemPath);
    knownKeys(item, ['cellId', 'barrier'], itemPath);
    let cellId = assertPortableId(item.cellId, `${itemPath}.cellId`);
    let barrier = text(item.barrier, `${itemPath}.barrier`);
    let key = `${cellId}:${barrier}`;
    if (seen.has(key)) {
      fail('PRESENTATION_AUTHORING_PROJECT_INVALID', `${itemPath} duplicates dependency "${key}"`, {
        path: itemPath,
      });
    }
    seen.add(key);
    return { cellId, barrier };
  });
}

function normalizeTiming(value, cueKind, path) {
  let source = object(value || {}, path);
  knownKeys(
    source,
    ['at', 'until', 'leadMs', 'gestureDurationMs', 'settleBy'],
    path,
  );
  let settleBy = text(source.settleBy, `${path}.settleBy`, 'none');
  if (!PRESENTATION_AUTHORING_PROJECT_SETTLE_POLICIES.includes(settleBy)) {
    fail(
      'PRESENTATION_AUTHORING_PROJECT_INVALID',
      `${path}.settleBy must be one of ${PRESENTATION_AUTHORING_PROJECT_SETTLE_POLICIES.join(', ')}`,
      { path: `${path}.settleBy`, settleBy },
    );
  }
  let gestureDurationMs = integer(
    source.gestureDurationMs,
    `${path}.gestureDurationMs`,
    { min: 0, max: 120000, fallback: DEFAULT_GESTURE_DURATIONS[cueKind] },
  );
  if (cueKind !== 'state' && gestureDurationMs === 0) {
    fail(
      'PRESENTATION_AUTHORING_PROJECT_INVALID',
      `${path}.gestureDurationMs must be positive for ${cueKind} cells`,
      { path: `${path}.gestureDurationMs` },
    );
  }
  if (cueKind === 'state' && gestureDurationMs !== 0) {
    fail(
      'PRESENTATION_AUTHORING_PROJECT_INVALID',
      `${path}.gestureDurationMs must be zero for state cells`,
      { path: `${path}.gestureDurationMs` },
    );
  }
  return {
    at: source.at,
    until: source.until ?? null,
    leadMs: integer(source.leadMs, `${path}.leadMs`, {
      min: 0,
      max: 120000,
      fallback: 0,
    }),
    gestureDurationMs,
    settleBy,
  };
}

function normalizeAudioClipTiming(value, path) {
  let source = object(value, path);
  knownKeys(source, ['at'], path);
  let atPath = `${path}.at`;
  let at = object(source.at, atPath);
  knownKeys(at, ['anchor', 'offsetMs'], atPath);
  let anchor = text(at.anchor, `${atPath}.anchor`);
  if (!['turn-start', 'turn-end'].includes(anchor)) {
    fail(
      'PRESENTATION_AUTHORING_PROJECT_INVALID',
      `${atPath}.anchor must be turn-start or turn-end`,
      { path: `${atPath}.anchor`, anchor },
    );
  }
  return {
    at: {
      anchor,
      offsetMs: integer(at.offsetMs, `${atPath}.offsetMs`, {
        min: Number.MIN_SAFE_INTEGER,
        max: Number.MAX_SAFE_INTEGER,
      }),
    },
  };
}

function parseCells(value, layers, assets) {
  if (!Array.isArray(value) || !value.length) {
    fail('PRESENTATION_AUTHORING_PROJECT_INVALID', 'project.cells must be a nonempty array', {
      path: 'project.cells',
    });
  }
  let layerById = new Map(layers.map((layer) => [layer.id, layer]));
  let assetById = new Map(assets.map((asset) => [asset.id, asset]));
  let seen = new Set();
  return value.map((valueItem, index) => {
    let path = `project.cells[${index}]`;
    let item = object(valueItem, path);
    knownKeys(
      item,
      ['id', 'kind', 'layerId', 'turnId', 'turn', 'cue', 'audio', 'timing', 'dependsOn'],
      path,
    );
    let id = assertPortableId(item.id, `${path}.id`);
    if (seen.has(id)) {
      fail('PRESENTATION_AUTHORING_PROJECT_INVALID', `${path}.id duplicates cell "${id}"`, {
        path: `${path}.id`,
        id,
      });
    }
    seen.add(id);
    let kind = text(item.kind, `${path}.kind`);
    if (!['narration', 'cue', 'audio-clip'].includes(kind)) {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_INVALID',
        `${path}.kind must be narration, cue, or audio-clip`,
        { path: `${path}.kind`, kind },
      );
    }
    let layerId = assertPortableId(item.layerId, `${path}.layerId`);
    let layer = layerById.get(layerId);
    if (!layer) {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_INVALID',
        `${path}.layerId names unknown layer "${layerId}"`,
        { path: `${path}.layerId`, layerId },
      );
    }
    let dependsOn = normalizeDependencies(item.dependsOn, `${path}.dependsOn`);
    if (kind === 'narration') {
      if (layer.kind !== 'narration') {
        fail(
          'PRESENTATION_AUTHORING_PROJECT_INVALID',
          `${path} narration cell must use a narration layer`,
          { path: `${path}.layerId`, layerId },
        );
      }
      let turn = object(item.turn, `${path}.turn`);
      if (turn.cues !== undefined) {
        fail(
          'PRESENTATION_AUTHORING_PROJECT_INVALID',
          `${path}.turn.cues is derived from cue cells and cannot be authored twice`,
          { path: `${path}.turn.cues` },
        );
      }
      let turnId = assertPortableId(item.turnId || turn.id, `${path}.turnId`);
      if (turn.id !== undefined && text(turn.id, `${path}.turn.id`) !== turnId) {
        fail(
          'PRESENTATION_AUTHORING_PROJECT_INVALID',
          `${path}.turnId must match ${path}.turn.id`,
          { path: `${path}.turnId`, turnId },
        );
      }
      return { id, kind, layerId, turnId, turn, dependsOn };
    }
    if (kind === 'audio-clip') {
      knownKeys(
        item,
        ['id', 'kind', 'layerId', 'turnId', 'audio', 'timing', 'dependsOn'],
        path,
      );
      if (layer.kind !== 'audio') {
        fail(
          'PRESENTATION_AUTHORING_PROJECT_INVALID',
          `${path} audio-clip cell must use an audio layer`,
          { path: `${path}.layerId`, layerId },
        );
      }
      let turnId = assertPortableId(item.turnId, `${path}.turnId`);
      let audioPath = `${path}.audio`;
      let audio = object(item.audio, audioPath);
      knownKeys(audio, ['assetId', 'sourceInMs', 'sourceOutMs'], audioPath);
      let assetId = assertPortableId(audio.assetId, `${audioPath}.assetId`);
      let asset = assetById.get(assetId);
      if (!asset) {
        fail(
          'PRESENTATION_AUTHORING_PROJECT_INVALID',
          `${audioPath}.assetId names unknown audio asset "${assetId}"`,
          { path: `${audioPath}.assetId`, assetId },
        );
      }
      let sourceInMs = integer(audio.sourceInMs, `${audioPath}.sourceInMs`);
      let sourceOutMs = integer(audio.sourceOutMs, `${audioPath}.sourceOutMs`, {
        max: asset.durationMs,
      });
      if (sourceOutMs <= sourceInMs) {
        fail(
          'PRESENTATION_AUTHORING_PROJECT_INVALID',
          `${audioPath} must define a nonempty half-open source range within the audio duration`,
          { path: audioPath, sourceInMs, sourceOutMs, durationMs: asset.durationMs },
        );
      }
      return {
        id,
        kind,
        layerId,
        turnId,
        audio: { assetId, sourceInMs, sourceOutMs },
        timing: normalizeAudioClipTiming(item.timing, `${path}.timing`),
        dependsOn,
      };
    }
    if (layer.kind === 'narration' || layer.kind === 'audio') {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_INVALID',
        `${path} cue cell cannot use a ${layer.kind} layer`,
        { path: `${path}.layerId`, layerId },
      );
    }
    let turnId = assertPortableId(item.turnId, `${path}.turnId`);
    let cue = object(item.cue, `${path}.cue`);
    if (cue.at !== undefined || cue.until !== undefined) {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_INVALID',
        `${path}.cue timing anchors belong in ${path}.timing`,
        { path: `${path}.cue` },
      );
    }
    if (cue.kind !== undefined && text(cue.kind, `${path}.cue.kind`) !== layer.kind) {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_INVALID',
        `${path}.cue.kind must match layer kind "${layer.kind}"`,
        { path: `${path}.cue.kind`, kind: cue.kind },
      );
    }
    return {
      id,
      kind,
      layerId,
      turnId,
      cue: { ...cue, kind: layer.kind },
      timing: normalizeTiming(item.timing, layer.kind, `${path}.timing`),
      dependsOn,
    };
  });
}

function normalizeScript(value) {
  let source = object(value || {}, 'project.script');
  knownKeys(source, SCRIPT_KEYS, 'project.script');
  return source;
}

function availableCellBarriers(cell) {
  if (cell.kind === 'narration' || cell.kind === 'audio-clip') return ['ended'];
  let barriers = [];
  if (cell.timing.until !== null) barriers.push('ended');
  if (cell.timing.gestureDurationMs > 0) barriers.push('settled');
  if (cell.cue.kind === 'interaction') barriers.push('acted');
  if (cell.cue.kind === 'state') barriers.push('ready');
  return barriers;
}

function validateCellDependencies(cells) {
  let cellById = new Map(cells.map((cell) => [cell.id, cell]));
  for (let cell of cells) {
    for (let dependency of cell.dependsOn) {
      if (dependency.cellId === cell.id) {
        fail(
          'PRESENTATION_AUTHORING_PROJECT_DEPENDENCY_SELF_REFERENCE',
          `cell "${cell.id}" cannot depend on itself`,
          { cellId: cell.id, dependency },
        );
      }
      let source = cellById.get(dependency.cellId);
      if (!source) {
        fail(
          'PRESENTATION_AUTHORING_PROJECT_UNKNOWN_DEPENDENCY',
          `cell "${cell.id}" depends on unknown cell "${dependency.cellId}"`,
          { cellId: cell.id, dependency },
        );
      }
      let availableBarriers = availableCellBarriers(source);
      if (!availableBarriers.includes(dependency.barrier)) {
        fail(
          'PRESENTATION_AUTHORING_PROJECT_BARRIER_UNAVAILABLE',
          `cell "${dependency.cellId}" does not expose barrier "${dependency.barrier}"`,
          { cellId: cell.id, dependency, availableBarriers },
        );
      }
    }
  }

  let states = new Map();
  let stack = [];
  let visit = (cell) => {
    let state = states.get(cell.id) || 'unvisited';
    if (state === 'visited') return;
    if (state === 'visiting') {
      let cycleStart = stack.indexOf(cell.id);
      let cellIds = [...stack.slice(cycleStart), cell.id];
      fail(
        'PRESENTATION_AUTHORING_PROJECT_DEPENDENCY_CYCLE',
        `presentation cell dependencies contain a cycle: ${cellIds.join(' -> ')}`,
        { cellIds },
      );
    }
    states.set(cell.id, 'visiting');
    stack.push(cell.id);
    for (let dependency of cell.dependsOn) visit(cellById.get(dependency.cellId));
    stack.pop();
    states.set(cell.id, 'visited');
  };
  for (let cell of cells) visit(cell);
}

function buildTimeline(projectId, script, cells) {
  let narrationCells = cells.filter((cell) => cell.kind === 'narration');
  let narrationByTurnId = new Map();
  for (let cell of narrationCells) {
    if (narrationByTurnId.has(cell.turnId)) {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_INVALID',
        `project.cells has multiple narration cells for turn "${cell.turnId}"`,
        { turnId: cell.turnId },
      );
    }
    narrationByTurnId.set(cell.turnId, cell);
  }
  for (let cell of cells.filter((item) => item.kind !== 'narration')) {
    if (!narrationByTurnId.has(cell.turnId)) {
      fail(
        'PRESENTATION_AUTHORING_PROJECT_INVALID',
        `${cell.kind} cell "${cell.id}" names unknown semantic narration turn "${cell.turnId}"`,
        { cellId: cell.id, turnId: cell.turnId },
      );
    }
  }
  let turns = narrationCells.map((cell) => ({
    ...cell.turn,
    id: cell.turnId,
    cues: cells
      .filter((item) => item.kind === 'cue' && item.turnId === cell.turnId)
      .map((item) => ({
        ...item.cue,
        at: item.timing.at,
        ...(item.timing.until === null ? {} : { until: item.timing.until }),
      })),
  }));
  try {
    return createPresentationTimelineContract({
      contractVersion: PRESENTATION_CONTRACT_VERSION,
      id: projectId,
      ...script,
      turns,
    });
  } catch (error) {
    fail(
      'PRESENTATION_AUTHORING_PROJECT_INVALID',
      `project cannot produce a valid ${PRESENTATION_CONTRACT_VERSION}: ${error.message}`,
      { cause: error.message },
    );
  }
}

function normalizedScriptFromTimeline(timeline) {
  let script = {
    title: timeline.title,
    locale: timeline.locale,
    profile: timeline.profile,
    personas: timeline.personas,
    grounding: timeline.grounding,
  };
  if (timeline.source !== undefined) script.source = timeline.source;
  if (timeline.metadata !== undefined) script.metadata = timeline.metadata;
  return script;
}

function normalizedCellsFromTimeline(cells, timeline) {
  let turnById = new Map(timeline.turns.map((turn) => [turn.id, turn]));
  let cueIndexes = new Map();
  return cells.map((cell) => {
    let turn = turnById.get(cell.turnId);
    if (cell.kind === 'narration') {
      let normalizedTurn = withoutKey(turn, 'cues');
      return {
        id: cell.id,
        kind: cell.kind,
        layerId: cell.layerId,
        turnId: turn.id,
        turn: normalizedTurn,
        dependsOn: cell.dependsOn,
      };
    }
    if (cell.kind === 'audio-clip') {
      return {
        id: cell.id,
        kind: cell.kind,
        layerId: cell.layerId,
        turnId: cell.turnId,
        audio: cell.audio,
        timing: cell.timing,
        dependsOn: cell.dependsOn,
      };
    }
    let cueIndex = cueIndexes.get(cell.turnId) || 0;
    cueIndexes.set(cell.turnId, cueIndex + 1);
    let cue = turn.cues[cueIndex];
    return {
      id: cell.id,
      kind: cell.kind,
      layerId: cell.layerId,
      turnId: cell.turnId,
      cue: withoutKey(withoutKey(cue, 'at'), 'until'),
      timing: {
        at: cue.at,
        until: cue.until ?? null,
        leadMs: cell.timing.leadMs,
        gestureDurationMs: cell.timing.gestureDurationMs,
        settleBy: cell.timing.settleBy,
      },
      dependsOn: cell.dependsOn,
    };
  });
}

function defaultLayers(timeline) {
  let visualOwnerId = `${timeline.id}:presenter`;
  let collisionDomainId = `${timeline.id}:presenter-gesture`;
  return DEFAULT_LAYER_KINDS.map((kind) => ({
    id: `${timeline.id}:layer:${kind}`,
    kind,
    name: `${kind[0].toUpperCase()}${kind.slice(1)}`,
    visualOwnerId: VISUAL_LAYER_KINDS.has(kind) ? visualOwnerId : null,
    collisionDomainId: VISUAL_LAYER_KINDS.has(kind) ? collisionDomainId : null,
  }));
}

function cueCellId(timelineId, turnId, cueIndex) {
  return `${timelineId}:cue:${turnId}:${cueIndex + 1}`;
}

/**
 * @param {object} input
 * @returns {object}
 */
export function createPresentationAuthoringProject(input = {}) {
  let source = object(input, 'project');
  knownKeys(source, PROJECT_KEYS, 'project');
  let schemaVersion = source.schemaVersion || PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION;
  if (schemaVersion !== PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION) {
    fail(
      'PRESENTATION_AUTHORING_PROJECT_INVALID',
      `unsupported presentation authoring project version: ${schemaVersion}`,
      { schemaVersion },
    );
  }
  let projectId = assertPortableId(source.id, 'project.id');
  let revision = integer(source.revision, 'project.revision', { fallback: 0 });
  let script = normalizeScript(source.script);
  let policy = normalizePolicy(source.policy, projectId);
  let assets = normalizeAssets(source.assets);
  let layers = normalizeLayers(source.layers, policy);
  let parsedCells = parseCells(source.cells, layers, assets);
  assertNoRuntimeData(script, 'project.script');
  assertNoRuntimeData(assets, 'project.assets');
  assertNoRuntimeData(parsedCells, 'project.cells');
  let timeline = buildTimeline(projectId, script, parsedCells);
  let cells = normalizedCellsFromTimeline(parsedCells, timeline);
  validateCellDependencies(cells);
  let project = {
    schemaVersion: PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION,
    id: timeline.id,
    revision,
    script: normalizedScriptFromTimeline(timeline),
    policy,
    assets,
    layers,
    cells,
  };
  return {
    ...project,
    hash: `${PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION}:${computeIntegrity(project)}`,
  };
}

/**
 * @param {object} timelineInput
 * @param {object} [options]
 * @returns {{project: object, mapping: object}}
 */
export function createPresentationAuthoringProjectFromTimeline(timelineInput = {}, options = {}) {
  let timeline = createPresentationTimelineContract(timelineInput);
  let layers = defaultLayers(timeline);
  let layerByKind = new Map(layers.map((layer) => [layer.kind, layer]));
  let cells = [];
  let turns = [];
  let cues = [];
  for (let [turnIndex, turn] of timeline.turns.entries()) {
    let turnCellId = `${timeline.id}:turn:${turn.id}`;
    cells.push({
      id: turnCellId,
      kind: 'narration',
      layerId: layerByKind.get('narration').id,
      turnId: turn.id,
      turn: withoutKey(turn, 'cues'),
      dependsOn: [],
    });
    turns.push({ turnIndex, turnId: turn.id, cellId: turnCellId });
    for (let [cueIndex, cue] of turn.cues.entries()) {
      let cellId = cueCellId(timeline.id, turn.id, cueIndex);
      cells.push({
        id: cellId,
        kind: 'cue',
        layerId: layerByKind.get(cue.kind).id,
        turnId: turn.id,
        cue: withoutKey(withoutKey(cue, 'at'), 'until'),
        timing: {
          at: cue.at,
          until: cue.until ?? null,
          leadMs: 0,
          gestureDurationMs: DEFAULT_GESTURE_DURATIONS[cue.kind],
          settleBy: 'none',
        },
        dependsOn: [],
      });
      cues.push({ cueId: `${turnIndex}.${cueIndex}`, turnId: turn.id, cellId });
    }
  }
  let project = createPresentationAuthoringProject({
    schemaVersion: PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION,
    id: timeline.id,
    revision: options.revision ?? 0,
    script: normalizedScriptFromTimeline(timeline),
    policy: {
      visualOwnerId: `${timeline.id}:presenter`,
      collisionDomains: [{
        id: `${timeline.id}:presenter-gesture`,
        name: 'Presenter gesture',
        exclusive: true,
      }],
    },
    assets: [],
    layers,
    cells,
  });
  return {
    project,
    mapping: {
      timelineHash: timeline.hash,
      layers: layers.map((layer, layerIndex) => ({
        layerIndex,
        kind: layer.kind,
        layerId: layer.id,
      })),
      turns,
      cues,
    },
  };
}

/**
 * @param {object} value
 * @returns {object}
 */
export function validatePresentationAuthoringProject(value = {}) {
  let expected = createPresentationAuthoringProject(value);
  if (canonicalize(value) !== canonicalize(expected)) {
    fail(
      'PRESENTATION_AUTHORING_PROJECT_STALE',
      'presentation authoring project does not match its canonical content or hash',
      { projectId: expected.id },
    );
  }
  return value;
}

/**
 * @param {object} projectInput
 * @returns {object}
 */
export function createPresentationAuthoringTimelineProjection(projectInput = {}) {
  let project = validatePresentationAuthoringProject(projectInput);
  return buildTimeline(project.id, project.script, project.cells);
}

/**
 * @param {object} projectInput
 * @returns {object}
 */
export function createPresentationAuthoringProjectHashes(projectInput = {}) {
  let project = validatePresentationAuthoringProject(projectInput);
  let timeline = createPresentationAuthoringTimelineProjection(project);
  let cellHashes = project.cells.map((cell) => ({
    cellId: cell.id,
    hash: `${PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION}:cell:${computeIntegrity(cell)}`,
  }));
  let cellHashById = new Map(cellHashes.map((item) => [item.cellId, item.hash]));
  let layerHashes = project.layers.map((layer) => ({
    layerId: layer.id,
    hash: `${PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION}:layer:${computeIntegrity({
      layer,
      cells: project.cells
        .filter((cell) => cell.layerId === layer.id)
        .map((cell) => ({ cellId: cell.id, hash: cellHashById.get(cell.id) })),
    })}`,
  }));
  return {
    authoringProjectHash: project.hash,
    timelineHash: timeline.hash,
    layerHashes,
    cellHashes,
  };
}

export function presentationAuthoringProjectCanonicalProjection(projectInput = {}) {
  let project = validatePresentationAuthoringProject(projectInput);
  return canonicalClone(withoutKey(project, 'hash'));
}
