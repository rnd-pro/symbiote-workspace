import { computeIntegrity, isIntegrityString } from '../schema/canonical-json.js';

export const VIRTUAL_SEQUENCE_SCHEMA_VERSION = 'workspace-virtual-sequence-v1';

export const VIRTUAL_SEQUENCE_EXECUTION_TIERS = Object.freeze(['sequential-realtime', 'replayable-segment', 'checkpointed-deterministic']);
export const VIRTUAL_SEQUENCE_LAYER_KINDS = Object.freeze(['base', 'overlay', 'caption', 'audio']);
export const VIRTUAL_SEQUENCE_INVALIDATION_MODES = Object.freeze(['opaque', 'partial']);
export const VIRTUAL_SEQUENCE_VIDEO_CODECS = Object.freeze(['h264', 'hevc', 'av1', 'vp9', 'vp8']);
export const VIRTUAL_SEQUENCE_VIDEO_CONTAINERS = Object.freeze(['mp4', 'webm', 'mkv', 'mov', 'ts']);
export const VIRTUAL_SEQUENCE_IMAGE_CODECS = Object.freeze(['png', 'webp', 'jpeg', 'jpg', 'avif', 'gif']);
export const VIRTUAL_SEQUENCE_SPRITE_CODECS = Object.freeze(['png', 'webp', 'jpeg', 'jpg', 'avif']);

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'id', 'contentHash', 'executionTier', 'timebase', 'frameRate',
  'duration', 'masters', 'playbackProxy', 'scrub', 'sprites', 'index', 'audio', 'layers',
]);
const RATIONAL_KEYS = new Set(['num', 'den']);
const RANGE_KEYS = new Set(['startTick', 'endTick']);
const MASTER_KEYS = new Set(['id', 'path', 'contentHash', 'codec', 'container', 'range', 'keyframes']);
const PROXY_KEYS = new Set(['path', 'contentHash', 'codec', 'container']);
const SCRUB_PROXY_KEYS = new Set(['mode', 'path', 'contentHash', 'codec', 'container']);
const SCRUB_CHUNKS_KEYS = new Set(['mode', 'maxChunkDurationTicks', 'chunks']);
const SCRUB_CHUNK_KEYS = new Set(['id', 'path', 'contentHash', 'codec', 'container', 'range']);
const SPRITE_KEYS = new Set(['id', 'path', 'contentHash', 'codec', 'cues', 'tile']);
const TILE_KEYS = new Set(['width', 'height', 'columns', 'rows']);
const INDEX_KEYS = new Set(['keyframes', 'timestamps']);
const AUDIO_KEYS = new Set(['id', 'path', 'contentHash', 'range', 'waveform']);
const WAVEFORM_KEYS = new Set(['path', 'contentHash']);
const LAYER_KEYS = new Set(['id', 'kind', 'invalidation', 'range', 'dependsOn', 'affectedRanges', 'outputHash']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

function byId(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function assertObject(value, path) {
  if (!isObject(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function assertKnownKeys(value, keys, path) {
  for (let key of Object.keys(assertObject(value, path))) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported`);
  }
}

function requiredString(value, path) {
  let text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw new TypeError(`${path} is required`);
  return text;
}

function positiveInteger(value, path) {
  let number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new TypeError(`${path} must be a positive integer`);
  return number;
}

function nonNegativeInteger(value, path) {
  let number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new TypeError(`${path} must be a non-negative integer`);
  return number;
}

function integrity(value, path, required = false) {
  if (value === undefined && !required) return undefined;
  let text = requiredString(value, path);
  if (!isIntegrityString(text)) throw new TypeError(`${path} must be a sha256 integrity string`);
  return text;
}

function stringList(value, path) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((item, index) => requiredString(item, `${path}[${index}]`));
}

function portablePath(value, path) {
  let text = requiredString(value, path);
  if (/\bBearer\s/i.test(text) || /(?:token|secret|api_key)=/i.test(text)) {
    throw new TypeError(`${path} must not contain credentials`);
  }
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(text)) throw new TypeError(`${path} must not contain a URL`);
  if (text.includes('\\')) throw new TypeError(`${path} must not contain backslashes`);
  if (text.startsWith('/')) throw new TypeError(`${path} must be root-relative`);
  if (/^[A-Za-z]:/.test(text)) throw new TypeError(`${path} must not contain a drive letter`);
  if (text.split('/').includes('..')) throw new TypeError(`${path} must not contain a parent traversal`);
  return text;
}

function rational(value, path) {
  assertKnownKeys(value, RATIONAL_KEYS, path);
  return {
    num: positiveInteger(value.num, `${path}.num`),
    den: positiveInteger(value.den, `${path}.den`),
  };
}

function range(value, path, duration) {
  assertKnownKeys(value, RANGE_KEYS, path);
  let startTick = nonNegativeInteger(value.startTick, `${path}.startTick`);
  let endTick = positiveInteger(value.endTick, `${path}.endTick`);
  if (startTick >= endTick) throw new TypeError(`${path} startTick must be less than endTick`);
  if (endTick > duration) throw new TypeError(`${path} endTick must not exceed duration`);
  return { startTick, endTick };
}

function assertFrameAligned(range, ticksPerFrame, path) {
  if (range.startTick % ticksPerFrame !== 0 || range.endTick % ticksPerFrame !== 0) {
    throw new TypeError(`${path} boundary is not aligned to the frame grid`);
  }
  return range;
}

function tickList(value, path) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((item, index) => nonNegativeInteger(item, `${path}[${index}]`));
}

function strictlyIncreasing(ticks, path) {
  for (let index = 1; index < ticks.length; index += 1) {
    if (ticks[index] <= ticks[index - 1]) throw new TypeError(`${path} must be strictly increasing`);
  }
}

function assertUnique(ids, label) {
  let seen = new Set();
  for (let id of ids) {
    if (seen.has(id)) throw new TypeError(`${label} contains duplicate id: ${id}`);
    seen.add(id);
  }
}

function assertVideoSegment(codec, container, path) {
  if (VIRTUAL_SEQUENCE_IMAGE_CODECS.includes(codec)) {
    throw new TypeError(`${path} models a frame sequence (image codec forbidden on encoded segments)`);
  }
  if (!VIRTUAL_SEQUENCE_VIDEO_CODECS.includes(codec)) throw new TypeError(`${path}.codec is not a supported video codec`);
  if (!VIRTUAL_SEQUENCE_VIDEO_CONTAINERS.includes(container)) throw new TypeError(`${path}.container is not a supported video container`);
}

function assertPartition(segments, duration, label) {
  let sorted = [...segments].sort((left, right) => left.range.startTick - right.range.startTick);
  if (sorted[0].range.startTick !== 0) throw new TypeError(`${label} track must start at tick 0`);
  for (let index = 1; index < sorted.length; index += 1) {
    let previousEnd = sorted[index - 1].range.endTick;
    let start = sorted[index].range.startTick;
    if (start < previousEnd) throw new TypeError(`${label} track segments overlap at tick ${start}`);
    if (start > previousEnd) throw new TypeError(`${label} track has a gap at tick ${previousEnd}`);
  }
  if (sorted[sorted.length - 1].range.endTick !== duration) {
    throw new TypeError(`${label} track must cover the full duration`);
  }
  return sorted;
}

function normalizeMaster(value, index, duration, ticksPerFrame) {
  let path = `masters[${index}]`;
  assertKnownKeys(value, MASTER_KEYS, path);
  let codec = requiredString(value.codec, `${path}.codec`);
  let container = requiredString(value.container, `${path}.container`);
  assertVideoSegment(codec, container, path);
  let segmentRange = assertFrameAligned(range(value.range, `${path}.range`, duration), ticksPerFrame, path);
  let keyframes = tickList(value.keyframes, `${path}.keyframes`);
  if (keyframes.length === 0) throw new TypeError(`${path}.keyframes must be non-empty`);
  strictlyIncreasing(keyframes, `${path}.keyframes`);
  keyframes.forEach((keyframe, keyframeIndex) => {
    if (keyframe % ticksPerFrame !== 0) {
      throw new TypeError(`${path}.keyframes[${keyframeIndex}] is not aligned to the frame grid`);
    }
  });
  if (keyframes[0] !== segmentRange.startTick) throw new TypeError(`${path} must start on a keyframe`);
  keyframes.forEach((keyframe, keyframeIndex) => {
    if (keyframe < segmentRange.startTick || keyframe >= segmentRange.endTick) {
      throw new TypeError(`${path}.keyframes[${keyframeIndex}] is outside the segment range`);
    }
  });
  return {
    id: requiredString(value.id, `${path}.id`),
    path: portablePath(value.path, `${path}.path`),
    contentHash: integrity(value.contentHash, `${path}.contentHash`, true),
    codec,
    container,
    range: segmentRange,
    keyframes,
  };
}

function normalizeProxy(value) {
  assertKnownKeys(value, PROXY_KEYS, 'playbackProxy');
  let codec = requiredString(value.codec, 'playbackProxy.codec');
  let container = requiredString(value.container, 'playbackProxy.container');
  assertVideoSegment(codec, container, 'playbackProxy');
  return {
    path: portablePath(value.path, 'playbackProxy.path'),
    contentHash: integrity(value.contentHash, 'playbackProxy.contentHash', true),
    codec,
    container,
  };
}

function normalizeScrubChunk(value, index, duration, ticksPerFrame) {
  let path = `scrub.chunks[${index}]`;
  assertKnownKeys(value, SCRUB_CHUNK_KEYS, path);
  let codec = requiredString(value.codec, `${path}.codec`);
  let container = requiredString(value.container, `${path}.container`);
  assertVideoSegment(codec, container, path);
  return {
    id: requiredString(value.id, `${path}.id`),
    path: portablePath(value.path, `${path}.path`),
    contentHash: integrity(value.contentHash, `${path}.contentHash`, true),
    codec,
    container,
    range: assertFrameAligned(range(value.range, `${path}.range`, duration), ticksPerFrame, path),
  };
}

function normalizeScrub(value, duration, ticksPerFrame) {
  let mode = requiredString(value.mode, 'scrub.mode');
  if (mode === 'proxy') {
    assertKnownKeys(value, SCRUB_PROXY_KEYS, 'scrub');
    let codec = requiredString(value.codec, 'scrub.codec');
    let container = requiredString(value.container, 'scrub.container');
    assertVideoSegment(codec, container, 'scrub');
    return {
      mode,
      path: portablePath(value.path, 'scrub.path'),
      contentHash: integrity(value.contentHash, 'scrub.contentHash', true),
      codec,
      container,
    };
  }
  if (mode === 'chunks') {
    assertKnownKeys(value, SCRUB_CHUNKS_KEYS, 'scrub');
    let maxChunkDurationTicks = positiveInteger(value.maxChunkDurationTicks, 'scrub.maxChunkDurationTicks');
    if (!Array.isArray(value.chunks) || value.chunks.length === 0) {
      throw new TypeError('scrub.chunks must be a non-empty array');
    }
    let chunks = value.chunks.map((chunk, index) => normalizeScrubChunk(chunk, index, duration, ticksPerFrame));
    assertUnique(chunks.map((chunk) => chunk.id), 'scrub.chunks');
    let sorted = assertPartition(chunks, duration, 'scrub');
    for (let chunk of sorted) {
      if (chunk.range.endTick - chunk.range.startTick > maxChunkDurationTicks) {
        throw new TypeError('scrub chunk exceeds maxChunkDurationTicks');
      }
    }
    return { mode, maxChunkDurationTicks, chunks: sorted };
  }
  throw new TypeError('scrub.mode must be proxy or chunks');
}

function normalizeTile(value, path) {
  assertKnownKeys(value, TILE_KEYS, path);
  return {
    width: positiveInteger(value.width, `${path}.width`),
    height: positiveInteger(value.height, `${path}.height`),
    columns: positiveInteger(value.columns, `${path}.columns`),
    rows: positiveInteger(value.rows, `${path}.rows`),
  };
}

function normalizeSprite(value, index, duration) {
  let path = `sprites[${index}]`;
  assertKnownKeys(value, SPRITE_KEYS, path);
  let codec = requiredString(value.codec, `${path}.codec`);
  if (!VIRTUAL_SEQUENCE_SPRITE_CODECS.includes(codec)) throw new TypeError(`${path}.codec is not a supported sprite codec`);
  let cues = tickList(value.cues, `${path}.cues`);
  strictlyIncreasing(cues, `${path}.cues`);
  cues.forEach((cue, cueIndex) => {
    if (cue >= duration) throw new TypeError(`${path}.cues[${cueIndex}] is out of range`);
  });
  let tile = normalizeTile(value.tile, `${path}.tile`);
  if (cues.length > tile.columns * tile.rows) throw new TypeError('sprite cues exceed tile capacity');
  return {
    id: requiredString(value.id, `${path}.id`),
    path: portablePath(value.path, `${path}.path`),
    contentHash: integrity(value.contentHash, `${path}.contentHash`, true),
    codec,
    cues,
    tile,
  };
}

function normalizeWaveform(value, path) {
  assertKnownKeys(value, WAVEFORM_KEYS, path);
  return {
    path: portablePath(value.path, `${path}.path`),
    contentHash: integrity(value.contentHash, `${path}.contentHash`, true),
  };
}

function normalizeAudio(value, index, duration) {
  let path = `audio[${index}]`;
  assertKnownKeys(value, AUDIO_KEYS, path);
  return compactObject({
    id: requiredString(value.id, `${path}.id`),
    path: portablePath(value.path, `${path}.path`),
    contentHash: integrity(value.contentHash, `${path}.contentHash`, true),
    range: range(value.range, `${path}.range`, duration),
    waveform: value.waveform === undefined ? undefined : normalizeWaveform(value.waveform, `${path}.waveform`),
  });
}

function normalizeIndex(value, unionKeyframes, duration, ticksPerFrame) {
  assertKnownKeys(value, INDEX_KEYS, 'index');
  let keyframes = tickList(value.keyframes, 'index.keyframes');
  let matchesUnion = keyframes.length === unionKeyframes.length
    && keyframes.every((keyframe, keyframeIndex) => keyframe === unionKeyframes[keyframeIndex]);
  if (!matchesUnion) throw new TypeError('keyframe index must equal the union of master keyframes');
  let timestamps = tickList(value.timestamps, 'index.timestamps');
  if (timestamps.length === 0 || timestamps[0] !== 0) throw new TypeError('index.timestamps must start at tick 0');
  for (let index = 0; index < timestamps.length; index += 1) {
    let timestamp = timestamps[index];
    if (timestamp % ticksPerFrame !== 0) throw new TypeError(`index.timestamps[${index}] is not aligned to the frame grid`);
    if (timestamp >= duration) throw new TypeError(`index.timestamps[${index}] is out of range`);
    if (index > 0) {
      if (timestamp === timestamps[index - 1]) throw new TypeError('duplicate timestamp');
      if (timestamp < timestamps[index - 1]) throw new TypeError('timestamp index is non-monotonic');
    }
  }
  return { keyframes, timestamps };
}

function normalizeLayer(value, index, duration) {
  let path = `layers[${index}]`;
  assertKnownKeys(value, LAYER_KEYS, path);
  let id = requiredString(value.id, `${path}.id`);
  let kind = requiredString(value.kind, `${path}.kind`);
  if (!VIRTUAL_SEQUENCE_LAYER_KINDS.includes(kind)) throw new TypeError(`${path}.kind is not supported`);
  let invalidation = requiredString(value.invalidation, `${path}.invalidation`);
  if (!VIRTUAL_SEQUENCE_INVALIDATION_MODES.includes(invalidation)) throw new TypeError(`${path}.invalidation is not supported`);
  let layerRange = range(value.range, `${path}.range`, duration);
  if (!Array.isArray(value.affectedRanges)) throw new TypeError(`${path}.affectedRanges must be an array`);
  if (value.affectedRanges.length === 0) throw new TypeError('layer affectedRanges must be non-empty');
  let affectedRanges = value.affectedRanges.map((entry, entryIndex) => range(entry, `${path}.affectedRanges[${entryIndex}]`, duration));
  if (invalidation === 'opaque') {
    let full = affectedRanges.length === 1
      && affectedRanges[0].startTick === layerRange.startTick
      && affectedRanges[0].endTick === layerRange.endTick;
    if (!full) throw new TypeError('opaque layer must invalidate its full declared range');
  } else {
    affectedRanges.forEach((entry, entryIndex) => {
      if (entry.startTick < layerRange.startTick || entry.endTick > layerRange.endTick) {
        throw new TypeError(`${path}.affectedRanges[${entryIndex}] is outside the layer range`);
      }
      if (entryIndex > 0 && entry.startTick < affectedRanges[entryIndex - 1].endTick) {
        throw new TypeError(`${path}.affectedRanges must be sorted and non-overlapping`);
      }
    });
  }
  let dependsOn = stringList(value.dependsOn, `${path}.dependsOn`).slice().sort();
  for (let entryIndex = 1; entryIndex < dependsOn.length; entryIndex += 1) {
    if (dependsOn[entryIndex] === dependsOn[entryIndex - 1]) throw new TypeError(`layer ${id} has a duplicate dependency`);
  }
  return compactObject({
    id,
    kind,
    invalidation,
    range: layerRange,
    dependsOn,
    affectedRanges,
    outputHash: integrity(value.outputHash, `${path}.outputHash`),
  });
}

function assertAcyclicLayers(layers) {
  let index = new Map(layers.map((layer) => [layer.id, layer]));
  let visiting = new Set();
  let visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new TypeError(`layer dependency cycle at ${id}`);
    visiting.add(id);
    for (let dependency of index.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (let layer of layers) visit(layer.id);
}

function buildVirtualSequence(input = {}) {
  assertKnownKeys(input, TOP_LEVEL_KEYS, 'sequence');
  let schemaVersion = requiredString(input.schemaVersion, 'sequence.schemaVersion');
  if (schemaVersion !== VIRTUAL_SEQUENCE_SCHEMA_VERSION) {
    throw new TypeError(`sequence.schemaVersion must equal ${VIRTUAL_SEQUENCE_SCHEMA_VERSION}`);
  }
  let executionTier = requiredString(input.executionTier, 'sequence.executionTier');
  if (!VIRTUAL_SEQUENCE_EXECUTION_TIERS.includes(executionTier)) {
    throw new TypeError('sequence.executionTier is not supported');
  }
  let timebase = rational(input.timebase, 'sequence.timebase');
  let frameRate = rational(input.frameRate, 'sequence.frameRate');
  let duration = positiveInteger(input.duration, 'sequence.duration');

  let ratioNumerator = frameRate.den * timebase.den;
  let ratioDenominator = frameRate.num * timebase.num;
  if (ratioNumerator % ratioDenominator !== 0) {
    throw new TypeError('incompatible frameRate/timebase (ticksPerFrame is not an integer)');
  }
  let ticksPerFrame = ratioNumerator / ratioDenominator;
  if (duration % ticksPerFrame !== 0) throw new TypeError('duration must be a whole number of frames');

  if (!Array.isArray(input.masters) || input.masters.length === 0) {
    throw new TypeError('sequence.masters must be a non-empty array');
  }
  let masters = input.masters.map((master, index) => normalizeMaster(master, index, duration, ticksPerFrame));
  assertUnique(masters.map((master) => master.id), 'masters');
  let sortedMasters = assertPartition(masters, duration, 'master');
  let unionKeyframes = [...new Set(sortedMasters.flatMap((master) => master.keyframes))].sort((left, right) => left - right);

  let index = normalizeIndex(assertObject(input.index, 'sequence.index'), unionKeyframes, duration, ticksPerFrame);

  let playbackProxy = input.playbackProxy === undefined
    ? undefined
    : normalizeProxy(assertObject(input.playbackProxy, 'playbackProxy'));

  let scrub = input.scrub === undefined
    ? undefined
    : normalizeScrub(assertObject(input.scrub, 'scrub'), duration, ticksPerFrame);

  let sprites;
  if (input.sprites !== undefined) {
    if (!Array.isArray(input.sprites)) throw new TypeError('sequence.sprites must be an array');
    sprites = input.sprites.map((sprite, spriteIndex) => normalizeSprite(sprite, spriteIndex, duration));
    assertUnique(sprites.map((sprite) => sprite.id), 'sprites');
    let seenCues = new Set();
    for (let sprite of sprites) {
      for (let cue of sprite.cues) {
        if (seenCues.has(cue)) throw new TypeError('duplicate sprite cue tick');
        seenCues.add(cue);
      }
    }
    sprites = sprites.slice().sort(byId);
  }

  let audio;
  if (input.audio !== undefined) {
    if (!Array.isArray(input.audio)) throw new TypeError('sequence.audio must be an array');
    audio = input.audio.map((entry, audioIndex) => normalizeAudio(entry, audioIndex, duration));
    assertUnique(audio.map((entry) => entry.id), 'audio');
    audio = audio.slice().sort(byId);
  }

  if (!Array.isArray(input.layers) || input.layers.length === 0) {
    throw new TypeError('sequence.layers must be a non-empty array');
  }
  let layers = input.layers.map((layer, layerIndex) => normalizeLayer(layer, layerIndex, duration));
  assertUnique(layers.map((layer) => layer.id), 'layers');
  let layerIds = new Set(layers.map((layer) => layer.id));
  for (let layer of layers) {
    for (let dependency of layer.dependsOn) {
      if (dependency === layer.id) throw new TypeError(`layer ${layer.id} cannot depend on itself`);
      if (!layerIds.has(dependency)) throw new TypeError(`layer ${layer.id} depends on unknown layer: ${dependency}`);
    }
    if (layer.kind === 'audio' && (!audio || audio.length === 0)) {
      throw new TypeError('audio layer requires audio references');
    }
  }
  assertAcyclicLayers(layers);
  layers = layers.slice().sort(byId);

  let baseLayers = layers.filter((layer) => layer.kind === 'base');
  if (baseLayers.length !== 1) throw new TypeError('sequence requires exactly one base layer');
  let audioLayers = layers.filter((layer) => layer.kind === 'audio');
  if (audio?.length > 0 && audioLayers.length === 0) {
    throw new TypeError('audio references require an audio layer');
  }
  let base = baseLayers[0];
  if (base.range.startTick !== 0 || base.range.endTick !== duration) {
    throw new TypeError('base layer must cover the full duration');
  }
  if (executionTier === 'sequential-realtime' && base.invalidation !== 'opaque') {
    throw new TypeError('sequential-realtime base layer must be opaque');
  }

  let normalized = compactObject({
    schemaVersion,
    executionTier,
    timebase,
    frameRate,
    duration,
    masters: sortedMasters,
    playbackProxy,
    scrub,
    sprites,
    index,
    audio,
    layers,
  });
  let contentHash = computeIntegrity(normalized);
  let id = `virtual-sequence:${contentHash}`;
  if (input.id !== undefined && requiredString(input.id, 'sequence.id') !== id) {
    throw new TypeError('id does not match canonical identity');
  }
  if (input.contentHash !== undefined && requiredString(input.contentHash, 'sequence.contentHash') !== contentHash) {
    throw new TypeError('contentHash does not match canonical identity');
  }
  return { ...normalized, id, contentHash };
}

/**
 * @param {object} input
 * @returns {object}
 */
export function createVirtualSequence(input = {}) {
  return buildVirtualSequence(input);
}

/**
 * @param {object} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateVirtualSequence(input = {}) {
  try {
    buildVirtualSequence(input);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error?.message || String(error)] };
  }
}

function containsTick(entryRange, tick) {
  return entryRange.startTick <= tick && tick < entryRange.endTick;
}

/**
 * @param {object} sequence
 * @param {number} tick
 * @returns {object}
 */
export function projectVirtualSequenceAt(sequence, tick) {
  let seq = buildVirtualSequence(sequence);
  if (!Number.isInteger(tick) || tick < 0 || tick >= seq.duration) throw new TypeError('tick out of range');

  let master = seq.masters.find((entry) => containsTick(entry.range, tick));

  let keyframe = null;
  for (let candidate of seq.index.keyframes) {
    if (candidate <= tick) keyframe = candidate;
  }

  let scrub = null;
  if (seq.scrub) {
    if (seq.scrub.mode === 'proxy') scrub = seq.scrub;
    else scrub = seq.scrub.chunks.find((chunk) => containsTick(chunk.range, tick)) || null;
  }

  let bestSprite = null;
  for (let entry of seq.sprites || []) {
    entry.cues.forEach((cue, cueIndex) => {
      if (cue <= tick && (bestSprite === null || cue > bestSprite.cue)) {
        bestSprite = { sprite: entry, cue, cueIndex };
      }
    });
  }
  let sprite = bestSprite
    ? {
      sprite: {
        id: bestSprite.sprite.id,
        path: bestSprite.sprite.path,
        contentHash: bestSprite.sprite.contentHash,
        tile: bestSprite.sprite.tile,
      },
      cue: bestSprite.cue,
      cueIndex: bestSprite.cueIndex,
      column: bestSprite.cueIndex % bestSprite.sprite.tile.columns,
      row: Math.floor(bestSprite.cueIndex / bestSprite.sprite.tile.columns),
    }
    : null;

  let audio = (seq.audio || []).filter((entry) => containsTick(entry.range, tick));

  let kindOrder = new Map(VIRTUAL_SEQUENCE_LAYER_KINDS.map((kind, order) => [kind, order]));
  let layers = seq.layers
    .filter((layer) => containsTick(layer.range, tick))
    .sort((left, right) => {
      let byKind = kindOrder.get(left.kind) - kindOrder.get(right.kind);
      if (byKind !== 0) return byKind;
      return byId(left, right);
    });

  return {
    tick,
    executionTier: seq.executionTier,
    master: { id: master.id, path: master.path, contentHash: master.contentHash, range: master.range },
    keyframe,
    playbackProxy: seq.playbackProxy || null,
    scrub,
    sprite,
    audio,
    layers,
  };
}

function mergeRanges(ranges) {
  let sorted = [...ranges].sort((left, right) => left.startTick - right.startTick || left.endTick - right.endTick);
  let merged = [];
  for (let entry of sorted) {
    let last = merged[merged.length - 1];
    if (last && entry.startTick <= last.endTick) {
      if (entry.endTick > last.endTick) last.endTick = entry.endTick;
    } else {
      merged.push({ startTick: entry.startTick, endTick: entry.endTick });
    }
  }
  return merged;
}

/**
 * @param {object} sequence
 * @param {string[]} changedLayerIds
 * @param {{ recomputedOutputHashes?: Record<string, string> }} [options]
 * @returns {object}
 */
export function invalidateVirtualSequence(sequence, changedLayerIds = [], options = {}) {
  let seq = buildVirtualSequence(sequence);
  let index = new Map(seq.layers.map((layer) => [layer.id, layer]));
  let changed = stringList(changedLayerIds, 'changedLayerIds');
  for (let id of changed) {
    if (!index.has(id)) throw new TypeError(`changed layer is unknown: ${id}`);
  }
  let recomputed = {};
  if (options.recomputedOutputHashes !== undefined) {
    assertObject(options.recomputedOutputHashes, 'recomputedOutputHashes');
    for (let key of Object.keys(options.recomputedOutputHashes)) {
      recomputed[key] = integrity(options.recomputedOutputHashes[key], `recomputedOutputHashes.${key}`, true);
    }
  }

  let children = new Map(seq.layers.map((layer) => [layer.id, []]));
  for (let layer of seq.layers) {
    for (let dependency of layer.dependsOn) children.get(dependency).push(layer.id);
  }

  let invalidated = new Set();
  let retained = new Set();
  let queue = [...changed];
  while (queue.length) {
    let id = queue.shift();
    let layer = index.get(id);
    if (recomputed[id] && layer.outputHash && recomputed[id] === layer.outputHash) {
      retained.add(id);
      continue;
    }
    if (invalidated.has(id)) continue;
    invalidated.add(id);
    queue.push(...children.get(id));
  }

  let invalidatedLayers = seq.layers.filter((layer) => invalidated.has(layer.id));
  let affectedRanges = mergeRanges(invalidatedLayers.flatMap((layer) => layer.affectedRanges));
  return {
    invalidatedLayers: invalidatedLayers.map((layer) => layer.id),
    retainedLayers: seq.layers.filter((layer) => retained.has(layer.id)).map((layer) => layer.id),
    affectedRanges,
    recompute: invalidatedLayers.map((layer) => ({
      layerId: layer.id,
      kind: layer.kind,
      ranges: layer.affectedRanges,
    })),
  };
}
