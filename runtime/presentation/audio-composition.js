import { canonicalize, computeIntegrity } from '../../schema/canonical-json.js';
import { validatePresentationAuthoringProject } from './project.js';

export const PRESENTATION_AUDIO_COMPOSITION_VERSION = 'workspace-presentation-audio-composition-v1';
export const PRESENTATION_AUDIO_DELIVERY_MANIFEST_VERSION = 'workspace-presentation-audio-delivery-manifest-v1';
export const PRESENTATION_AUDIO_DELIVERY_DURATION_TOLERANCE_MS = 20;

export class PresentationAudioCompositionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PresentationAudioCompositionError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new PresentationAudioCompositionError(code, message, details);
}

function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value, path) {
  if (!isObject(value)) {
    fail('PRESENTATION_AUDIO_COMPOSITION_INVALID', `${path} must be an object`, { path });
  }
  return value;
}

function exactKeys(value, keys, path) {
  for (let key of Object.keys(value)) {
    if (!keys.includes(key)) {
      fail(
        'PRESENTATION_AUDIO_COMPOSITION_INVALID',
        `${path}.${key} is not supported`,
        { path: `${path}.${key}` },
      );
    }
  }
  for (let key of keys) {
    if (!Object.hasOwn(value, key)) {
      fail(
        'PRESENTATION_AUDIO_COMPOSITION_INVALID',
        `${path}.${key} is required`,
        { path: `${path}.${key}` },
      );
    }
  }
}

function text(value, path) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('PRESENTATION_AUDIO_COMPOSITION_INVALID', `${path} must be nonempty text`, { path });
  }
  return value;
}

function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_INVALID',
      `${path} must be a safe integer between ${min} and ${max}`,
      { path, value },
    );
  }
  return value;
}

function clone(value) {
  return JSON.parse(canonicalize(value));
}

function withoutHash(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'hash'));
}

function hashRecord(version, value) {
  return `${version}:${computeIntegrity(value)}`;
}

function validateSchedule(scheduleInput, project) {
  let schedule = object(scheduleInput, 'schedule');
  if (schedule.authoringProjectHash !== project.hash) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_SCHEDULE_STALE',
      'composition requires a schedule for the exact authoring project revision and hash',
      {
        expectedAuthoringProjectHash: project.hash,
        receivedAuthoringProjectHash: schedule.authoringProjectHash ?? null,
      },
    );
  }
  let contractVersion = text(schedule.contractVersion, 'schedule.contractVersion');
  let expectedHash = hashRecord(contractVersion, withoutHash(schedule));
  if (schedule.hash !== expectedHash) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_SCHEDULE_STALE',
      'composition requires an intact deterministic presentation schedule',
      { expectedHash, receivedHash: schedule.hash ?? null },
    );
  }
  if (!Array.isArray(schedule.cells)) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_INVALID',
      'schedule.cells must be an array',
      { path: 'schedule.cells' },
    );
  }
  return schedule;
}

function normalizeSourceWord(value, path, durationMs, priorEndMs) {
  let word = object(value, path);
  exactKeys(word, ['text', 'startMs', 'endMs'], path);
  let startMs = integer(word.startMs, `${path}.startMs`, { max: durationMs });
  let endMs = integer(word.endMs, `${path}.endMs`, { min: startMs + 1, max: durationMs });
  if (startMs < priorEndMs) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_INVALID',
      `${path} overlaps the prior approved source word`,
      { path, startMs, priorEndMs },
    );
  }
  return { text: text(word.text, `${path}.text`), startMs, endMs };
}

function normalizeSources(value, project) {
  if (!Array.isArray(value)) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_INVALID',
      'options.sources must be an array',
      { path: 'options.sources' },
    );
  }
  let assetById = new Map(project.assets.map((asset) => [asset.id, asset]));
  let seen = new Set();
  let sources = value.map((valueItem, sourceIndex) => {
    let path = `options.sources[${sourceIndex}]`;
    let source = object(valueItem, path);
    exactKeys(source, ['assetId', 'contentHash', 'alignmentHash', 'durationMs', 'words'], path);
    let assetId = text(source.assetId, `${path}.assetId`);
    if (seen.has(assetId)) {
      fail(
        'PRESENTATION_AUDIO_COMPOSITION_INVALID',
        `${path}.assetId duplicates source "${assetId}"`,
        { path: `${path}.assetId`, assetId },
      );
    }
    seen.add(assetId);
    let asset = assetById.get(assetId);
    if (!asset) {
      fail(
        'PRESENTATION_AUDIO_COMPOSITION_SOURCE_STALE',
        `${path}.assetId names an asset outside the authoring project`,
        { assetId },
      );
    }
    let contentHash = text(source.contentHash, `${path}.contentHash`);
    let alignmentHash = text(source.alignmentHash, `${path}.alignmentHash`);
    let durationMs = integer(source.durationMs, `${path}.durationMs`, { min: 1 });
    if (
      contentHash !== asset.contentHash
      || alignmentHash !== asset.alignmentHash
      || durationMs !== asset.durationMs
    ) {
      fail(
        'PRESENTATION_AUDIO_COMPOSITION_SOURCE_STALE',
        `approved source evidence for asset "${assetId}" does not match the Project asset`,
        {
          assetId,
          expected: {
            contentHash: asset.contentHash,
            alignmentHash: asset.alignmentHash,
            durationMs: asset.durationMs,
          },
          received: { contentHash, alignmentHash, durationMs },
        },
      );
    }
    if (!Array.isArray(source.words)) {
      fail(
        'PRESENTATION_AUDIO_COMPOSITION_INVALID',
        `${path}.words must be an array`,
        { path: `${path}.words` },
      );
    }
    let priorEndMs = 0;
    let words = source.words.map((word, wordIndex) => {
      let normalized = normalizeSourceWord(
        word,
        `${path}.words[${wordIndex}]`,
        durationMs,
        priorEndMs,
      );
      priorEndMs = normalized.endMs;
      return normalized;
    });
    return { assetId, contentHash, alignmentHash, durationMs, words };
  });
  for (let asset of project.assets) {
    if (!seen.has(asset.id)) {
      fail(
        'PRESENTATION_AUDIO_COMPOSITION_SOURCE_MISSING',
        `approved source evidence is missing for Project asset "${asset.id}"`,
        { assetId: asset.id },
      );
    }
  }
  return sources;
}

function assertLegalBoundary(words, boundaryMs, clipId, boundary) {
  let cutWord = words.find((word) => word.startMs < boundaryMs && boundaryMs < word.endMs);
  if (cutWord) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_WORD_CUT',
      `audio clip "${clipId}" ${boundary} falls inside approved word "${cutWord.text}"`,
      { clipId, boundary, boundaryMs, word: clone(cutWord) },
    );
  }
}

function composeClip(projectCell, scheduleCell, source) {
  if (!isObject(scheduleCell?.audio)) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_SCHEDULE_STALE',
      `schedule has no canonical audio span for clip "${projectCell.id}"`,
      { clipId: projectCell.id },
    );
  }
  let { sourceInMs, sourceOutMs } = projectCell.audio;
  let durationMs = sourceOutMs - sourceInMs;
  let timelineInMs = integer(scheduleCell.audio.startMs, `schedule clip "${projectCell.id}" startMs`);
  let timelineOutMs = integer(scheduleCell.audio.endMs, `schedule clip "${projectCell.id}" endMs`, {
    min: timelineInMs + 1,
  });
  if (
    scheduleCell.kind !== 'audio-clip'
    || scheduleCell.audio.assetId !== projectCell.audio.assetId
    || scheduleCell.audio.sourceInMs !== sourceInMs
    || scheduleCell.audio.sourceOutMs !== sourceOutMs
    || scheduleCell.audio.durationMs !== durationMs
    || timelineOutMs - timelineInMs !== durationMs
  ) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_SCHEDULE_STALE',
      `schedule audio span for clip "${projectCell.id}" does not match its canonical source range`,
      { clipId: projectCell.id },
    );
  }
  assertLegalBoundary(source.words, sourceInMs, projectCell.id, 'sourceInMs');
  assertLegalBoundary(source.words, sourceOutMs, projectCell.id, 'sourceOutMs');
  let words = source.words
    .filter((word) => word.startMs >= sourceInMs && word.endMs <= sourceOutMs)
    .map((word) => ({
      text: word.text,
      startMs: timelineInMs + word.startMs - sourceInMs,
      endMs: timelineInMs + word.endMs - sourceInMs,
    }));
  return {
    clipId: projectCell.id,
    turnId: projectCell.turnId,
    assetId: projectCell.audio.assetId,
    sourceContentHash: source.contentHash,
    sourceAlignmentHash: source.alignmentHash,
    sourceInMs,
    sourceOutMs,
    timelineInMs,
    timelineOutMs,
    durationMs,
    words,
  };
}

function validateCompositionWord(value, path, clip) {
  let word = object(value, path);
  exactKeys(word, ['text', 'startMs', 'endMs'], path);
  let startMs = integer(word.startMs, `${path}.startMs`, {
    min: clip.timelineInMs,
    max: clip.timelineOutMs,
  });
  let endMs = integer(word.endMs, `${path}.endMs`, {
    min: startMs + 1,
    max: clip.timelineOutMs,
  });
  return { text: text(word.text, `${path}.text`), startMs, endMs };
}

function validateCompositionClip(value, path, sourceById) {
  let clip = object(value, path);
  exactKeys(clip, [
    'clipId',
    'turnId',
    'assetId',
    'sourceContentHash',
    'sourceAlignmentHash',
    'sourceInMs',
    'sourceOutMs',
    'timelineInMs',
    'timelineOutMs',
    'durationMs',
    'words',
  ], path);
  let normalized = {
    clipId: text(clip.clipId, `${path}.clipId`),
    turnId: text(clip.turnId, `${path}.turnId`),
    assetId: text(clip.assetId, `${path}.assetId`),
    sourceContentHash: text(clip.sourceContentHash, `${path}.sourceContentHash`),
    sourceAlignmentHash: text(clip.sourceAlignmentHash, `${path}.sourceAlignmentHash`),
    sourceInMs: integer(clip.sourceInMs, `${path}.sourceInMs`),
    sourceOutMs: integer(clip.sourceOutMs, `${path}.sourceOutMs`, {
      min: clip.sourceInMs + 1,
    }),
    timelineInMs: integer(clip.timelineInMs, `${path}.timelineInMs`),
    timelineOutMs: integer(clip.timelineOutMs, `${path}.timelineOutMs`, {
      min: clip.timelineInMs + 1,
    }),
    durationMs: integer(clip.durationMs, `${path}.durationMs`, { min: 1 }),
    words: [],
  };
  if (
    normalized.sourceOutMs - normalized.sourceInMs !== normalized.durationMs
    || normalized.timelineOutMs - normalized.timelineInMs !== normalized.durationMs
  ) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_INVALID',
      `${path} source and timeline spans must equal durationMs`,
      { path },
    );
  }
  let source = sourceById.get(normalized.assetId);
  if (
    !source
    || normalized.sourceContentHash !== source.contentHash
    || normalized.sourceAlignmentHash !== source.alignmentHash
    || normalized.sourceOutMs > source.durationMs
  ) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_INVALID',
      `${path} does not bind its declared source evidence`,
      { path, assetId: normalized.assetId },
    );
  }
  if (!Array.isArray(clip.words)) {
    fail('PRESENTATION_AUDIO_COMPOSITION_INVALID', `${path}.words must be an array`, {
      path: `${path}.words`,
    });
  }
  normalized.words = clip.words.map((word, wordIndex) => (
    validateCompositionWord(word, `${path}.words[${wordIndex}]`, normalized)
  ));
  return normalized;
}

/**
 * Compose presentation-time clips from immutable approved audio and alignment evidence.
 * This function performs no synthesis, transcription, decoding, or filesystem I/O.
 * @param {object} projectInput
 * @param {object} scheduleInput
 * @param {{sources: object[]}} options
 * @returns {object}
 */
export function createPresentationAudioComposition(
  projectInput = {},
  scheduleInput = {},
  options = {},
) {
  let project = validatePresentationAuthoringProject(projectInput);
  let schedule = validateSchedule(scheduleInput, project);
  let input = object(options, 'options');
  exactKeys(input, ['sources'], 'options');
  let sources = normalizeSources(input.sources, project);
  let sourceById = new Map(sources.map((source) => [source.assetId, source]));
  let projectClipById = new Map(
    project.cells
      .filter((cell) => cell.kind === 'audio-clip')
      .map((cell) => [cell.id, cell]),
  );
  let scheduledClips = schedule.cells.filter((cell) => cell.kind === 'audio-clip');
  if (scheduledClips.length !== projectClipById.size) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_SCHEDULE_STALE',
      'schedule audio clip coverage does not match the authoring Project',
      { expectedClipCount: projectClipById.size, receivedClipCount: scheduledClips.length },
    );
  }
  let seen = new Set();
  let clips = scheduledClips.map((scheduled) => {
    let projectCell = projectClipById.get(scheduled.cellId);
    if (!projectCell || seen.has(scheduled.cellId)) {
      fail(
        'PRESENTATION_AUDIO_COMPOSITION_SCHEDULE_STALE',
        `schedule contains an unknown or duplicate audio clip "${scheduled.cellId}"`,
        { clipId: scheduled.cellId },
      );
    }
    seen.add(scheduled.cellId);
    return composeClip(projectCell, scheduled, sourceById.get(projectCell.audio.assetId));
  });
  let composition = {
    version: PRESENTATION_AUDIO_COMPOSITION_VERSION,
    authoringProjectHash: project.hash,
    scheduleHash: schedule.hash,
    sources: sources.map(({ assetId, contentHash, alignmentHash, durationMs }) => ({
      assetId,
      contentHash,
      alignmentHash,
      durationMs,
    })),
    clips,
  };
  return {
    ...composition,
    hash: hashRecord(PRESENTATION_AUDIO_COMPOSITION_VERSION, composition),
  };
}

/**
 * @param {object} value
 * @returns {object}
 */
export function validatePresentationAudioComposition(value = {}) {
  let composition = object(value, 'composition');
  exactKeys(composition, [
    'version',
    'authoringProjectHash',
    'scheduleHash',
    'sources',
    'clips',
    'hash',
  ], 'composition');
  if (composition.version !== PRESENTATION_AUDIO_COMPOSITION_VERSION) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_INVALID',
      `unsupported presentation audio composition version: ${composition.version}`,
      { version: composition.version },
    );
  }
  text(composition.authoringProjectHash, 'composition.authoringProjectHash');
  text(composition.scheduleHash, 'composition.scheduleHash');
  if (!Array.isArray(composition.sources) || !Array.isArray(composition.clips)) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_INVALID',
      'composition.sources and composition.clips must be arrays',
    );
  }
  let sourceById = new Map();
  for (let [sourceIndex, valueItem] of composition.sources.entries()) {
    let path = `composition.sources[${sourceIndex}]`;
    let source = object(valueItem, path);
    exactKeys(source, ['assetId', 'contentHash', 'alignmentHash', 'durationMs'], path);
    let normalized = {
      assetId: text(source.assetId, `${path}.assetId`),
      contentHash: text(source.contentHash, `${path}.contentHash`),
      alignmentHash: text(source.alignmentHash, `${path}.alignmentHash`),
      durationMs: integer(source.durationMs, `${path}.durationMs`, { min: 1 }),
    };
    if (sourceById.has(normalized.assetId)) {
      fail(
        'PRESENTATION_AUDIO_COMPOSITION_INVALID',
        `${path}.assetId duplicates source evidence`,
        { assetId: normalized.assetId },
      );
    }
    sourceById.set(normalized.assetId, normalized);
  }
  let clipIds = new Set();
  for (let [clipIndex, valueItem] of composition.clips.entries()) {
    let clip = validateCompositionClip(valueItem, `composition.clips[${clipIndex}]`, sourceById);
    if (clipIds.has(clip.clipId)) {
      fail(
        'PRESENTATION_AUDIO_COMPOSITION_INVALID',
        `composition.clips duplicates clip "${clip.clipId}"`,
        { clipId: clip.clipId },
      );
    }
    clipIds.add(clip.clipId);
  }
  let expectedHash = hashRecord(PRESENTATION_AUDIO_COMPOSITION_VERSION, withoutHash(composition));
  if (composition.hash !== expectedHash) {
    fail(
      'PRESENTATION_AUDIO_COMPOSITION_STALE',
      'presentation audio composition hash does not match its canonical content',
      { expectedHash, receivedHash: composition.hash },
    );
  }
  return clone(composition);
}

function normalizeArtifact(value, path) {
  let artifact = object(value, path);
  exactKeys(artifact, [
    'clipId',
    'sourceContentHash',
    'sourceInMs',
    'sourceOutMs',
    'deliveryHash',
    'decodedDurationMs',
    'mediaType',
  ], path);
  return {
    clipId: text(artifact.clipId, `${path}.clipId`),
    sourceContentHash: text(artifact.sourceContentHash, `${path}.sourceContentHash`),
    sourceInMs: integer(artifact.sourceInMs, `${path}.sourceInMs`),
    sourceOutMs: integer(artifact.sourceOutMs, `${path}.sourceOutMs`, {
      min: artifact.sourceInMs + 1,
    }),
    deliveryHash: text(artifact.deliveryHash, `${path}.deliveryHash`),
    decodedDurationMs: integer(artifact.decodedDurationMs, `${path}.decodedDurationMs`, { min: 1 }),
    mediaType: text(artifact.mediaType, `${path}.mediaType`),
  };
}

/**
 * Bind materialized clip artifacts to one immutable composition release.
 * @param {object} compositionInput
 * @param {{artifacts: object[]}} options
 * @returns {object}
 */
export function createPresentationAudioDeliveryManifest(compositionInput = {}, options = {}) {
  let composition = validatePresentationAudioComposition(compositionInput);
  let input = object(options, 'options');
  exactKeys(input, ['artifacts'], 'options');
  if (!Array.isArray(input.artifacts)) {
    fail(
      'PRESENTATION_AUDIO_DELIVERY_INVALID',
      'options.artifacts must be an array',
      { path: 'options.artifacts' },
    );
  }
  let artifactByClipId = new Map();
  input.artifacts.forEach((value, artifactIndex) => {
    let artifact = normalizeArtifact(value, `options.artifacts[${artifactIndex}]`);
    if (artifactByClipId.has(artifact.clipId)) {
      fail(
        'PRESENTATION_AUDIO_DELIVERY_INVALID',
        `options.artifacts duplicates clip "${artifact.clipId}"`,
        { clipId: artifact.clipId },
      );
    }
    artifactByClipId.set(artifact.clipId, artifact);
  });
  if (artifactByClipId.size !== composition.clips.length) {
    fail(
      'PRESENTATION_AUDIO_DELIVERY_ARTIFACT_MISSING',
      'delivery requires exactly one materialized artifact per composition clip',
      { expectedClipCount: composition.clips.length, receivedArtifactCount: artifactByClipId.size },
    );
  }
  let clips = composition.clips.map((clip) => {
    let artifact = artifactByClipId.get(clip.clipId);
    if (!artifact) {
      fail(
        'PRESENTATION_AUDIO_DELIVERY_ARTIFACT_MISSING',
        `delivery artifact is missing for clip "${clip.clipId}"`,
        { clipId: clip.clipId },
      );
    }
    if (
      artifact.sourceContentHash !== clip.sourceContentHash
      || artifact.sourceInMs !== clip.sourceInMs
      || artifact.sourceOutMs !== clip.sourceOutMs
    ) {
      fail(
        'PRESENTATION_AUDIO_DELIVERY_SOURCE_STALE',
        `delivery artifact for clip "${clip.clipId}" does not match its immutable source range`,
        { clipId: clip.clipId },
      );
    }
    if (Math.abs(artifact.decodedDurationMs - clip.durationMs)
      > PRESENTATION_AUDIO_DELIVERY_DURATION_TOLERANCE_MS) {
      fail(
        'PRESENTATION_AUDIO_DELIVERY_DURATION_MISMATCH',
        `decoded delivery duration for clip "${clip.clipId}" exceeds the 20ms tolerance`,
        {
          clipId: clip.clipId,
          expectedDurationMs: clip.durationMs,
          decodedDurationMs: artifact.decodedDurationMs,
          toleranceMs: PRESENTATION_AUDIO_DELIVERY_DURATION_TOLERANCE_MS,
        },
      );
    }
    return artifact;
  });
  let manifest = {
    version: PRESENTATION_AUDIO_DELIVERY_MANIFEST_VERSION,
    compositionHash: composition.hash,
    clips,
  };
  return {
    ...manifest,
    hash: hashRecord(PRESENTATION_AUDIO_DELIVERY_MANIFEST_VERSION, manifest),
  };
}
