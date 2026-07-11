import {
  createPresentationTimelineContract,
  createPresentationTimelineHash,
  presentationTimelineHasTurns,
  validatePresentationAlignedSequence,
} from './presentation.js';
import { presentationOutputOrientation } from './presentation-output.js';

export const MEDIA_PROJECT_SCHEMA_VERSION = 'workspace-media-project-v1';
export const MEDIA_PROJECT_ROUTE_PARAM = 'mediaProject';
export const MEDIA_PROJECT_DEFAULT_SURFACE = 'media-studio';
export const MEDIA_PROJECT_ROUTE_REATTACH_PARAM = 'mediaProjectReattach';
export const MEDIA_PROJECT_ROUTE_SOURCE_SURFACE_PARAM = 'mediaProjectSourceSurface';
export const MEDIA_PROJECT_ROUTE_SOURCE_TAB_PARAM = 'mediaProjectSourceTab';
export const MEDIA_PROJECT_ROUTE_WORKSPACE_SECTION_PARAM = 'mediaProjectSection';
export const MEDIA_PROJECT_ROUTE_PREVIEW_FRAME_PARAM = 'mediaProjectPreviewFrame';
export const MEDIA_PROJECT_ROUTE_PREVIEW_MODE_PARAM = 'mediaProjectPreviewMode';
export const MEDIA_PROJECT_ROUTE_JOB_PARAM = 'mediaProjectJob';
export const MEDIA_PROJECT_ROUTE_SOURCE_URL_PARAM = 'mediaProjectSourceUrl';
export const MEDIA_PROJECT_ROUTE_TIMELINE_CURSOR_PARAM = 'mediaProjectCursorMs';
export const MEDIA_PROJECT_ROUTE_TIMELINE_PARAM = 'mediaProjectTimeline';
export const MEDIA_RENDER_SETTINGS_SCHEMA_VERSION = 'workspace-media-render-settings-v2';
export const MEDIA_RENDER_EVENT_SCHEMA_VERSION = 'workspace-media-render-event-v1';
export const MEDIA_RENDER_READINESS_SCHEMA_VERSION = 'workspace-media-render-readiness-v1';

export const MEDIA_RENDER_EVENT_TYPES = Object.freeze([
  'media.project.created',
  'tour.context.rehydrate.started',
  'tour.context.rehydrate.done',
  'tour.context.rehydrate.failed',
  'tour.context.collected',
  'tour.deepening.action.started',
  'tour.deepening.action.done',
  'tour.deepening.action.failed',
  'tour.replan.started',
  'tour.replan.done',
  'tour.replan.failed',
  'tour.skeleton.review.started',
  'tour.skeleton.review.done',
  'tour.lesson.review.started',
  'tour.lesson.review.done',
  'tour.lesson.review.failed',
  'preview.firstFrame.requested',
  'preview.firstFrame.ready',
  'preview.firstFrame.failed',
  'audio.turn.queued',
  'audio.turn.rendering',
  'audio.turn.ready',
  'audio.turn.failed',
  'audio.turn.rerender.requested',
  'audio.turn.rerender.ready',
  'audio.turn.rerender.failed',
  'caption.whisper.started',
  'caption.whisper.ready',
  'caption.whisper.failed',
  'timeline.clip.upserted',
  'timeline.clip.invalidated',
  'capture.started',
  'capture.frame.ready',
  'capture.done',
  'capture.failed',
  'preview.sequence.ready',
  'preview.sequence.invalidated',
  'encode.waiting',
  'encode.started',
  'encode.progress',
  'encode.done',
  'encode.failed',
  'artifact.ready',
]);

export const MEDIA_RENDER_DIRTY_SCOPES = Object.freeze([
  'audio',
  'captions',
  'action-timing',
  'frame-cache',
  'preview-sequence',
  'final-output',
]);

const MEDIA_RENDER_EVENT_TYPE_SET = new Set(MEDIA_RENDER_EVENT_TYPES);
const MEDIA_RENDER_DIRTY_SCOPE_SET = new Set(MEDIA_RENDER_DIRTY_SCOPES);
const MEDIA_PROJECT_PREVIEW_MODE_SET = new Set(['sequence', 'output']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clonePortable(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'function') return undefined;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => clonePortable(item)).filter((item) => item !== undefined);
  }
  let result = {};
  for (let [key, child] of Object.entries(value)) {
    let next = clonePortable(child);
    if (next !== undefined) result[key] = next;
  }
  return result;
}

function compactObject(value = {}) {
  let result = {};
  for (let [key, child] of Object.entries(value)) {
    if (child !== undefined) result[key] = child;
  }
  return result;
}

function cleanString(value, fallback = '') {
  let text = String(value ?? fallback ?? '').replace(/\s+/g, ' ').trim();
  return text && text !== 'undefined' && text !== 'null' ? text : String(fallback || '').trim();
}

function previewMode(value) {
  let text = cleanString(value);
  return MEDIA_PROJECT_PREVIEW_MODE_SET.has(text) ? text : undefined;
}

function safeId(value, fallback = 'media-project') {
  return cleanString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || fallback;
}

function timestamp(value, fallback = new Date().toISOString()) {
  let text = cleanString(value);
  if (!text) return fallback;
  let date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function normalizeProgress(value) {
  let number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(1, Math.max(0, number > 1 ? number / 100 : number));
}

function finiteNumber(value, fallback = undefined) {
  let number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback = undefined) {
  let number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function listStrings(value) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => cleanString(item))
    .filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(listStrings(values))];
}

function normalizeCaptionStyle(input = {}) {
  let source = isObject(input) ? input : {};
  return compactObject({
    mode: cleanString(source.mode, 'karaoke'),
    emphasis: cleanString(source.emphasis, 'word'),
    placement: cleanString(source.placement, 'bottom'),
    preset: cleanString(source.preset, 'tiktok'),
    maxLines: positiveInteger(source.maxLines, 2),
    fontSize: positiveInteger(source.fontSize),
    color: cleanString(source.color),
    highlightColor: cleanString(source.highlightColor),
  });
}

export function normalizeMediaRenderSettings(input = {}) {
  let source = isObject(input) ? input : {};
  let requestedVertical = source.vertical === true ||
    source.orientation === 'vertical' ||
    source.aspectRatio === '9:16' ||
    source.aspectRatio === 'vertical';
  let requestedSquare = source.orientation === 'square' || source.aspectRatio === '1:1' || source.aspectRatio === 'square';
  let resolution = isObject(source.resolution) ? source.resolution : {};
  let width = positiveInteger(source.width ?? resolution.width, requestedSquare ? 1080 : requestedVertical ? 1080 : 1920);
  let height = positiveInteger(source.height ?? resolution.height, requestedSquare ? 1080 : requestedVertical ? 1920 : 1080);
  let orientation = presentationOutputOrientation(width, height);
  let captionsMode = cleanString(source.captionsMode, source.captionsEnabled === false ? 'off' : 'karaoke');
  return compactObject({
    schemaVersion: cleanString(source.schemaVersion, MEDIA_RENDER_SETTINGS_SCHEMA_VERSION),
    autoRender: source.autoRender !== false,
    orientation,
    aspectRatio: orientation === 'square' ? '1:1' : orientation === 'vertical' ? '9:16' : '16:9',
    width,
    height,
    fps: positiveInteger(source.fps ?? source.frameRate, 30),
    format: cleanString(source.format, 'mp4'),
    codec: cleanString(source.codec, 'h264'),
    includeAudio: source.includeAudio !== false,
    captionsEnabled: source.captionsEnabled !== undefined ? Boolean(source.captionsEnabled) : captionsMode !== 'off',
    captionsMode,
    captionStyle: normalizeCaptionStyle(source.captionStyle || source.captionsStyle),
    safeArea: clonePortable(source.safeArea),
    language: cleanString(source.language || source.locale),
    durationMs: positiveInteger(source.durationMs || source.duration?.targetMs),
    minDurationMs: positiveInteger(source.minDurationMs || source.duration?.minMs),
    maxDurationMs: positiveInteger(source.maxDurationMs || source.duration?.maxMs),
    outputSpecHash: cleanString(source.outputSpecHash),
    speakerMode: cleanString(source.speakerMode, 'single'),
    sequenceMode: cleanString(source.sequenceMode, 'sequential'),
    providerId: cleanString(source.providerId || source.audioProvider || source.provider),
    voiceRefs: clonePortable(source.voiceRefs || source.voices),
  });
}

export function normalizeMediaRenderRouteState(input = {}) {
  let source = isObject(input) ? input : {};
  let shouldReattach = source.reattachStream !== undefined
    ? source.reattachStream !== false
    : Boolean(source.jobId || source.renderJobId || source.sourceSurface || source.activeSurface || source.sourceTabId || source.activeSourceTabId || source.sourceUrl || source.url);
  return compactObject({
    mediaProjectId: safeId(source.mediaProjectId || source.projectId, ''),
    jobId: cleanString(source.jobId || source.renderJobId),
    surface: cleanString(source.surface),
    sourceSurface: cleanString(source.sourceSurface || source.activeSurface),
    sourceTabId: cleanString(source.sourceTabId || source.activeSourceTabId),
    workspaceSection: cleanString(source.workspaceSection || source.activeWorkspaceSection || source.section),
    sourceUrl: cleanString(source.sourceUrl || source.url),
    timelineId: cleanString(source.timelineId || source.presentationId || source.tourId),
    previewFrame: finiteNumber(source.previewFrame ?? source.currentFrame),
    previewMode: previewMode(source.previewMode || source.mediaProjectPreviewMode || source.previewSource),
    timelineCursorMs: finiteNumber(source.timelineCursorMs ?? source.cursorMs),
    reattachStream: shouldReattach || undefined,
  });
}

function normalizeRenderArtifact(input = {}) {
  let source = isObject(input) ? input : {};
  return compactObject({
    id: cleanString(source.id),
    kind: cleanString(source.kind || source.type),
    label: cleanString(source.label || source.name),
    url: cleanString(source.url || source.href || source.src),
    path: cleanString(source.path),
    turnId: cleanString(source.turnId),
    persona: cleanString(source.persona),
    durationMs: finiteNumber(source.durationMs),
    frame: finiteNumber(source.frame),
    frameCount: positiveInteger(source.frameCount),
    bytes: positiveInteger(source.bytes || source.size),
    hash: cleanString(source.hash || source.digest),
  });
}

function normalizeRenderFailure(input = {}) {
  let source = isObject(input) ? input : {};
  return compactObject({
    type: cleanString(source.type || source.eventType),
    stage: cleanString(source.stage),
    turnId: cleanString(source.turnId),
    recoverable: source.recoverable !== false,
    message: cleanString(source.message || source.error, 'stage failed'),
  });
}

function timelineMsRange(input = {}, fallbackStartMs = 0, fallbackDurationMs = 1000) {
  let startMs = Math.max(0, finiteNumber(input.startMs ?? input.start ?? input.from, fallbackStartMs) || 0);
  let endMs = finiteNumber(input.endMs ?? input.end, undefined);
  let durationMs = Math.max(1, finiteNumber(input.durationMs ?? input.duration, endMs !== undefined ? endMs - startMs : fallbackDurationMs) || 1);
  if (endMs === undefined) endMs = startMs + durationMs;
  endMs = Math.max(startMs + 1, endMs);
  return { startMs, durationMs: endMs - startMs, endMs };
}

function timelineMsClip(input = {}, fallback = {}) {
  let timing = timelineMsRange(input, fallback.startMs || 0, fallback.durationMs || 1000);
  return compactObject({
    id: cleanString(input.id || input.clipId || fallback.id),
    lane: cleanString(input.lane || input.track || fallback.lane, 'actions'),
    label: cleanString(input.label || input.title || input.text || fallback.label, 'workspace action'),
    startMs: timing.startMs,
    durationMs: timing.durationMs,
    endMs: timing.endMs,
    turnId: cleanString(input.turnId || fallback.turnId),
    persona: cleanString(input.persona || fallback.persona),
    kind: cleanString(input.kind || fallback.kind),
    artifact: input.artifact ? normalizeRenderArtifact(input.artifact) : undefined,
  });
}

function timelineFrameClip(input = {}, fallback = {}) {
  let startFrame = Math.max(0, Math.round(finiteNumber(input.startFrame ?? input.frameStart ?? input.start, fallback.startFrame || 0) || 0));
  let endFrame = Math.max(startFrame + 1, Math.round(finiteNumber(input.endFrame ?? input.end, fallback.endFrame || startFrame + 1) || startFrame + 1));
  return compactObject({
    id: cleanString(input.id || input.clipId || fallback.id),
    lane: cleanString(input.lane || input.track || fallback.lane, 'video'),
    label: cleanString(input.label || input.title || fallback.label, 'Captured frames'),
    startFrame,
    endFrame,
    kind: cleanString(input.kind || fallback.kind),
    frameCount: positiveInteger(input.frameCount ?? fallback.frameCount, 0) || undefined,
    sampleCount: positiveInteger(input.sampleCount ?? fallback.sampleCount, 0) || undefined,
    sequenceFormat: cleanString(input.sequenceFormat || fallback.sequenceFormat),
    samples: Array.isArray(input.samples) ? input.samples : fallback.samples,
    artifact: input.artifact ? normalizeRenderArtifact(input.artifact) : undefined,
  });
}

function frameSequenceFormat(frames = []) {
  let source = (Array.isArray(frames) ? frames : [])
    .map((frame) => cleanString(frame?.mimeType || frame?.url || frame?.src || frame?.path))
    .find(Boolean);
  if (/webp/i.test(source)) return 'WebP';
  if (/png/i.test(source)) return 'PNG';
  if (/jpe?g/i.test(source)) return 'JPEG';
  return 'frame';
}

function frameSequenceSamples(frames = [], frameCount = 0) {
  let source = Array.isArray(frames) ? frames : [];
  if (!source.length) return [];
  let maxSamples = Math.min(16, source.length);
  let samples = [];
  for (let index = 0; index < maxSamples; index += 1) {
    let sourceIndex = maxSamples === 1 ? 0 : Math.round((index / (maxSamples - 1)) * (source.length - 1));
    let frame = source[sourceIndex] || {};
    samples.push(compactObject({
      index: positiveInteger(frame.index ?? frame.frame ?? frame.frameNumber, sourceIndex),
      url: cleanString(frame.url || frame.src || frame.href || frame.path),
      mimeType: cleanString(frame.mimeType),
    }));
  }
  return samples;
}

function presentationActionTimelineClips(timeline = {}, alignedSequence = null) {
  let turns = Array.isArray(timeline?.turns) ? timeline.turns : [];
  let cursorMs = 0;
  return turns.map((turn = {}, index) => {
    let aligned = alignedSequence?.turns?.[index];
    let startMs = aligned ? aligned.startMs : cursorMs;
    let durationMs = aligned ? Math.max(1, aligned.endMs - aligned.startMs) : 1000;
    cursorMs = Math.max(cursorMs, startMs + durationMs);
    return timelineMsClip({
      id: `action:${turn.id || turn.turnId || index + 1}`,
      lane: 'actions',
      label: turn.title || turn.text || `workspace action ${index + 1}`,
      startMs,
      durationMs,
      turnId: turn.id || turn.turnId || `turn-${index + 1}`,
      persona: turn.persona,
      kind: 'timeline-action',
    }, { lane: 'actions' });
  });
}

function voiceItemTiming(item = {}, alignedTurn = null, cursorMs = 0) {
  let startMs = finiteNumber(item.startMs ?? alignedTurn?.startMs, cursorMs);
  let durationMs = Math.max(1, finiteNumber(item.durationMs ?? (alignedTurn ? alignedTurn.endMs - alignedTurn.startMs : undefined), 1000) || 1000);
  let endMs = finiteNumber(item.endMs ?? alignedTurn?.endMs, startMs + durationMs);
  endMs = Math.max(startMs + 1, endMs);
  return { startMs, durationMs: endMs - startMs, endMs };
}

function voiceItemTimelineClips(renderJob = {}, timeline = {}, alignedSequence = null) {
  let items = Array.isArray(renderJob.audio?.items) ? renderJob.audio.items : [];
  let turns = Array.isArray(timeline?.turns) ? timeline.turns : [];
  let cursorMs = 0;
  return items.map((item = {}, index) => {
    let turn = turns[index] || {};
    let timing = voiceItemTiming(item, alignedSequence?.turns?.[index], cursorMs);
    cursorMs = Math.max(cursorMs, timing.endMs);
    let persona = cleanString(item.persona || turn.persona || (index % 2 ? 'ops' : 'guide'), 'guide');
    let lane = `voice:${persona}`;
    return timelineMsClip({
      id: `voice:${index + 1}:${persona}`,
      lane,
      label: item.text || turn.text || `${persona} voice`,
      startMs: timing.startMs,
      endMs: timing.endMs,
      durationMs: timing.durationMs,
      turnId: item.turnId || turn.id || turn.turnId || `voice-${index + 1}`,
      persona,
      kind: 'voice',
      artifact: item.artifact || item.file,
    }, { lane, label: lane, kind: 'voice' });
  });
}

function voiceClipIndexKey(clip = {}, fallbackIndex = 0) {
  let itemIndex = finiteNumber(clip.itemIndex ?? clip.cueIndex ?? clip.index, undefined);
  return Number.isFinite(itemIndex) ? Math.max(1, Math.round(itemIndex) + 1) : fallbackIndex + 1;
}

function voiceTimelineClips(renderJob = {}, timeline = {}, alignedSequence = null) {
  let layers = Array.isArray(renderJob.audio?.speakerLayers) ? renderJob.audio.speakerLayers : [];
  if (!layers.length) return voiceItemTimelineClips(renderJob, timeline, alignedSequence);
  return layers.flatMap((layer = {}) => {
    let lane = `voice:${cleanString(layer.persona || layer.speaker, 'speaker')}`;
    return (Array.isArray(layer.clips) ? layer.clips : []).map((clip = {}, index) => timelineMsClip({
      id: `voice:${voiceClipIndexKey(clip, index)}:${cleanString(layer.persona || layer.speaker || clip.persona, 'speaker')}`,
      lane,
      label: clip.text || layer.label || lane,
      startMs: clip.startMs,
      endMs: clip.endMs,
      durationMs: clip.durationMs,
      turnId: clip.turnId || clip.id || `voice-${index + 1}`,
      persona: layer.persona || layer.speaker || clip.persona,
      kind: 'voice',
      artifact: clip.artifact || clip.file,
    }, { lane, label: lane, kind: 'voice' }));
  });
}

function captionTimelineClips(renderJob = {}) {
  let cues = Array.isArray(renderJob.captions?.cues) ? renderJob.captions.cues : [];
  return cues.map((cue = {}, index) => {
    let startMs = finiteNumber(cue.startMs, finiteNumber(cue.startSec, 0) * 1000);
    let endMs = finiteNumber(cue.endMs, finiteNumber(cue.endSec, startMs / 1000 + 0.5) * 1000);
    return timelineMsClip({
      id: `caption:${cue.turnId || cue.id || index + 1}`,
      lane: 'captions',
      label: cue.speaker ? `${cue.speaker}: ${cue.text || ''}` : cue.text,
      startMs,
      endMs,
      turnId: cue.turnId || cue.id || `caption-${index + 1}`,
      persona: cue.speaker,
      kind: 'caption',
    }, { lane: 'captions', label: 'Caption', kind: 'caption' });
  });
}

function timelineClipEndFrame(clip = {}, fps = 30) {
  if (clip.endFrame !== undefined) return Math.max(0, Math.round(Number(clip.endFrame) || 0));
  if (clip.endMs !== undefined) return Math.max(0, Math.ceil((Number(clip.endMs) / 1000) * fps));
  if (clip.startMs !== undefined || clip.durationMs !== undefined) {
    let endMs = (Number(clip.startMs) || 0) + (Number(clip.durationMs) || 0);
    return Math.max(0, Math.ceil((endMs / 1000) * fps));
  }
  return 0;
}

export function selectMediaProjectTimeline(projectInput = {}, options = {}) {
  let project = normalizeMediaProject(projectInput);
  let renderJob = project.renderJob || {};
  let fps = positiveInteger(options.fps ?? project.renderSettings?.fps, 30);
  let clips = [
    ...presentationActionTimelineClips(project.timeline, project.alignedSequence),
  ];
  let frameCount = positiveInteger(renderJob.frameCount, 0) || (Array.isArray(renderJob.frames) ? renderJob.frames.length : 0);
  if (frameCount > 0) {
    let frameSamples = frameSequenceSamples(renderJob.frames, frameCount);
    let sequenceFormat = frameSequenceFormat(renderJob.frames);
    clips.push(timelineFrameClip({
      id: 'video:frame-sequence',
      lane: 'video',
      label: `${sequenceFormat === 'frame' ? 'FrameSource cache' : `${sequenceFormat} sequence`} · ${frameCount}f`,
      startFrame: 0,
      endFrame: frameCount,
      kind: 'frame-sequence',
      frameCount,
      sampleCount: frameSamples.length || frameCount,
      sequenceFormat,
      samples: frameSamples,
    }));
  }
  clips.push(...voiceTimelineClips(renderJob, project.timeline, project.alignedSequence));
  clips.push(...captionTimelineClips(renderJob));
  let durationFrames = positiveInteger(options.durationFrames, 0) || clips.reduce((max, clip) => Math.max(max, timelineClipEndFrame(clip, fps)), 0);
  return {
    fps,
    durationFrames,
    durationMs: durationFrames > 0 ? Math.round((durationFrames / fps) * 1000) : 0,
    clips,
  };
}

export function normalizeMediaRenderReadiness(input = {}) {
  let source = isObject(input) ? input : {};
  let failures = (Array.isArray(source.failures) ? source.failures : source.recoverableFailures || [])
    .map(normalizeRenderFailure)
    .filter((failure) => failure.message);
  let pending = uniqueStrings(source.pending || source.pendingStages);
  let dirty = uniqueStrings(source.dirty || source.dirtyScopes)
    .filter((scope) => MEDIA_RENDER_DIRTY_SCOPE_SET.has(scope));
  let expectedFiles = positiveInteger(source.expectedFiles ?? source.expected, 0);
  let completedFiles = positiveInteger(source.completedFiles ?? source.completed, 0);
  let progress = normalizeProgress(source.progress ?? (expectedFiles ? completedFiles / expectedFiles : undefined));
  let settled = source.settled !== undefined
    ? Boolean(source.settled)
    : pending.length === 0 && dirty.length === 0 && failures.length === 0;
  return compactObject({
    schemaVersion: cleanString(source.schemaVersion, MEDIA_RENDER_READINESS_SCHEMA_VERSION),
    status: cleanString(source.status, settled ? 'ready' : 'preparing'),
    stage: cleanString(source.stage),
    progress,
    expectedFiles,
    completedFiles,
    pending,
    dirty,
    failures,
    settled,
    autoRenderReady: source.autoRenderReady !== undefined ? Boolean(source.autoRenderReady) : settled,
    updatedAt: timestamp(source.updatedAt, new Date().toISOString()),
  });
}

export function isMediaRenderEventType(type) {
  return MEDIA_RENDER_EVENT_TYPE_SET.has(cleanString(type));
}

export function normalizeMediaRenderEvent(input = {}, options = {}) {
  let source = typeof input === 'string' ? { type: input } : isObject(input) ? input : {};
  let type = cleanString(source.type || options.type);
  if (!MEDIA_RENDER_EVENT_TYPE_SET.has(type)) {
    throw new Error(`unknown media render event type: ${type || 'missing'}`);
  }
  let rawArtifact = source.artifact || source.file;
  let artifact = rawArtifact ? normalizeRenderArtifact(rawArtifact) : {};
  let hasArtifact = Boolean(artifact.id || artifact.kind || artifact.label || artifact.url || artifact.path || artifact.hash);
  return compactObject({
    schemaVersion: cleanString(source.schemaVersion, MEDIA_RENDER_EVENT_SCHEMA_VERSION),
    type,
    projectId: safeId(source.projectId || source.mediaProjectId || options.projectId, ''),
    jobId: cleanString(source.jobId || source.renderJobId || options.jobId),
    turnId: cleanString(source.turnId),
    persona: cleanString(source.persona),
    stage: cleanString(source.stage),
    status: cleanString(source.status),
    progress: normalizeProgress(source.progress),
    expectedFiles: positiveInteger(source.expectedFiles),
    completedFiles: positiveInteger(source.completedFiles),
    artifact: hasArtifact ? artifact : undefined,
    route: Object.keys(normalizeMediaRenderRouteState(source.route || {})).length
      ? normalizeMediaRenderRouteState(source.route)
      : undefined,
    settings: source.settings ? normalizeMediaRenderSettings(source.settings) : undefined,
    payload: clonePortable(source.payload || source.detail),
    error: cleanString(source.error),
    createdAt: timestamp(source.createdAt, new Date().toISOString()),
  });
}

export function createMediaRenderEvent(type, detail = {}, options = {}) {
  return normalizeMediaRenderEvent({ ...clonePortable(detail), type }, options);
}

const IGNORED_RENDER_JOB_STAGES = new Set([
  'queued',
  'audio:check',
  'audio:ready',
  'audio:concat',
  'audio:mix-overlap',
  'browser:boot',
  'browser:ready',
  'browser:launch',
  'browser:page',
  'browser:navigate',
  'browser:navigated',
  'setup:start',
  'setup:done',
  'fonts:wait',
  'fonts:ready',
  'captions-overlay:ready',
  'probe:start',
  'probe:done',
  'proof:write',
  'done',
  'cleanup:start',
  'cleanup:done',
  'cleanup:failed',
  'cancel:requested',
]);

function renderJobEventSource(input = {}) {
  return typeof input === 'string' ? { stage: input } : isObject(input) ? input : {};
}

function renderJobProgressSource(source = {}) {
  return isObject(source.progress) ? source.progress : {};
}

function renderJobStage(source = {}) {
  let progress = renderJobProgressSource(source);
  let stage = cleanString(
    progress.stage ||
    source.stage ||
    source.status ||
    (typeof source.type === 'string' ? source.type.replace(/^render-job:/, '') : ''),
  );
  return stage;
}

function renderJobEventProgress(source = {}) {
  let progress = renderJobProgressSource(source);
  return normalizeProgress(progress.progress ?? (isObject(source.progress) ? undefined : source.progress));
}

export function mapRenderJobStageToMediaRenderEventType(stageInput, detail = {}, options = {}) {
  let stage = cleanString(stageInput || detail.stage);
  if (!stage) {
    if (options.strict) throw new Error('missing render job stage');
    return '';
  }
  if (MEDIA_RENDER_EVENT_TYPE_SET.has(stage)) return stage;
  if (stage === 'audio:synthesize') {
    return detail.cacheHit !== undefined || detail.artifactId || detail.audioUrl
      ? 'audio.turn.ready'
      : 'audio.turn.rendering';
  }
  if (stage === 'audio.turn.rerender.requested') return 'audio.turn.rerender.requested';
  if (stage === 'audio.turn.rerender.ready') return 'audio.turn.rerender.ready';
  if (stage === 'audio.turn.rerender.failed') return 'audio.turn.rerender.failed';
  if (stage === 'tour:replan') return detail.status === 'done' || detail.done === true ? 'tour.replan.done' : 'tour.replan.started';
  if (stage === 'lesson:review') return detail.status === 'done' || detail.done === true ? 'tour.lesson.review.done' : 'tour.lesson.review.started';
  if (stage === 'whisper:transcribe' || stage === 'whisper:clip-transcribe') return 'caption.whisper.started';
  if (stage === 'whisper:ready' || stage === 'whisper:clip-ready' || stage === 'captions:write') return 'caption.whisper.ready';
  if (stage === 'timeline:build') return 'timeline.clip.upserted';
  if (stage === 'capture:start') return 'capture.started';
  if (stage === 'capture:frame' || (stage === 'capture' && finiteNumber(detail.frame) !== undefined)) return 'capture.frame.ready';
  if (stage === 'capture:done' || stage === 'frame-sequence:done') return 'capture.done';
  if (stage === 'encode.waiting') return 'encode.waiting';
  if (stage === 'encode:start') return 'encode.started';
  if (stage === 'encode:done') return 'encode.done';
  if (stage === 'timeout' || stage === 'failed' || stage === 'canceled') {
    let failureStage = cleanString(detail.failureStage || detail.stage);
    if (failureStage.startsWith('audio')) return 'audio.turn.failed';
    if (failureStage.startsWith('tour.replan') || failureStage === 'tour:replan') return 'tour.replan.failed';
    if (failureStage.startsWith('tour.lesson.review') || failureStage === 'lesson:review') return 'tour.lesson.review.failed';
    if (failureStage.startsWith('whisper') || failureStage.startsWith('caption')) return 'caption.whisper.failed';
    if (failureStage.startsWith('capture') || failureStage.startsWith('browser') || failureStage.startsWith('setup') || failureStage.startsWith('fonts')) return 'capture.failed';
    return 'encode.failed';
  }
  if (IGNORED_RENDER_JOB_STAGES.has(stage)) return '';
  if (options.strict) throw new Error(`unsupported render job stage: ${stage}`);
  return '';
}

function renderJobEventPayload(source = {}, progress = {}) {
  return compactObject({
    sourceType: cleanString(source.type),
    sourceStage: renderJobStage(source),
    sourceStatus: cleanString(source.status),
    renderJobId: cleanString(source.renderJobId || source.jobId || progress.renderJobId),
    audioJobId: cleanString(source.audioJobId || progress.audioJobId),
    item: finiteNumber(source.item ?? progress.item),
    items: finiteNumber(source.items ?? progress.items),
    frame: finiteNumber(source.frame ?? progress.frame),
    frames: finiteNumber(source.frames ?? progress.frames),
    cacheHit: source.cacheHit !== undefined ? Boolean(source.cacheHit) : undefined,
    previewUpdated: source.previewUpdated !== undefined ? Boolean(source.previewUpdated) : undefined,
    scope: cleanString(source.scope),
    message: cleanString(source.message || source.error || source.renderError || source.timeoutReason || source.cancelReason),
  });
}

export function mapRenderJobEventToMediaRenderEvents(input = {}, options = {}) {
  let source = renderJobEventSource(input);
  let progress = renderJobProgressSource(source);
  let stage = renderJobStage(source);
  let detail = {
    ...clonePortable(progress),
    ...clonePortable(source),
    progress: renderJobEventProgress(source),
    stage,
  };
  let type = mapRenderJobStageToMediaRenderEventType(stage, detail, options);
  if (!type) return [];
  let payload = renderJobEventPayload(source, progress);
  return [createMediaRenderEvent(type, compactObject({
    projectId: options.projectId || source.projectId || source.mediaProjectId,
    jobId: options.jobId || source.jobId || source.renderJobId || progress.jobId || progress.renderJobId,
    turnId: source.turnId || progress.turnId,
    persona: source.persona || progress.persona,
    stage,
    status: source.status,
    progress: detail.progress,
    expectedFiles: options.expectedFiles ?? source.expectedFiles,
    completedFiles: options.completedFiles ?? source.completedFiles,
    artifact: options.artifact || source.artifact || source.file,
    route: options.route || source.route,
    settings: options.settings || source.settings,
    payload: Object.keys(payload).length ? payload : undefined,
    error: source.error || source.renderError || source.timeoutReason || source.cancelReason,
    createdAt: source.createdAt || source.at || options.createdAt,
  }), options)];
}

function normalizeRenderJob(input = {}) {
  let source = isObject(input) ? input : {};
  let id = cleanString(source.id || source.jobId);
  return compactObject({
    id,
    renderMode: cleanString(source.renderMode || source.mode),
    status: cleanString(source.status),
    stage: cleanString(source.stage),
    progress: normalizeProgress(source.progress),
    finalOutputStale: source.finalOutputStale === true ? true : undefined,
    outputUrl: cleanString(source.outputUrl),
    manifestUrl: cleanString(source.manifestUrl || source.proofUrl),
    proofUrl: cleanString(source.proofUrl || source.manifestUrl),
    captionsUrl: cleanString(source.captionsUrl),
    error: cleanString(source.error),
    audio: clonePortable(source.audio),
    captions: clonePortable(source.captions),
    frames: clonePortable(source.frames),
    frameCount: Number.isFinite(Number(source.frameCount)) ? Number(source.frameCount) : undefined,
    updatedAt: timestamp(source.updatedAt, new Date().toISOString()),
  });
}

function mergeReadiness(readiness, patch = {}) {
  return normalizeMediaRenderReadiness({
    ...readiness,
    ...patch,
    pending: patch.pending !== undefined ? patch.pending : readiness.pending,
    dirty: patch.dirty !== undefined ? patch.dirty : readiness.dirty,
    failures: patch.failures !== undefined ? patch.failures : readiness.failures,
  });
}

function uniqueArtifacts(artifacts = []) {
  let seen = new Set();
  let result = [];
  for (let artifact of artifacts.map(normalizeRenderArtifact).filter((item) => item.kind || item.url || item.path)) {
    let key = artifact.id || artifact.url || artifact.path || `${artifact.kind}:${artifact.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(artifact);
  }
  return result;
}

function portableEqual(left, right) {
  return JSON.stringify(clonePortable(left)) === JSON.stringify(clonePortable(right));
}

function appendArtifact(project, artifact) {
  let normalized = normalizeRenderArtifact(artifact);
  if (!Object.keys(normalized).length) return project.artifacts;
  return uniqueArtifacts([...(Array.isArray(project.artifacts) ? project.artifacts : []), normalized]);
}

export function invalidateMediaProjectArtifacts(projectInput = {}, reason = 'final-output', options = {}) {
  let project = normalizeMediaProject(projectInput);
  let reasons = uniqueStrings(reason);
  let scopes = new Set(project.renderState?.dirty || []);
  for (let item of reasons) {
    if (MEDIA_RENDER_DIRTY_SCOPE_SET.has(item)) scopes.add(item);
    if (item === 'format' || item === 'resolution' || item === 'geometry') {
      scopes.add('frame-cache');
      scopes.add('preview-sequence');
      scopes.add('final-output');
    }
    if (item === 'voice-rerender' || item === 'audio') {
      scopes.add('captions');
      scopes.add('action-timing');
      scopes.add('preview-sequence');
      scopes.add('final-output');
    }
  }
  let renderState = mergeReadiness(project.renderState || {}, {
    status: 'dirty',
    dirty: [...scopes],
    settled: false,
    autoRenderReady: false,
    updatedAt: options.updatedAt,
  });
  return normalizeMediaProject({
    ...project,
    status: 'dirty',
    renderState,
    preview: {
      ...(project.preview || {}),
      status: scopes.has('preview-sequence') || scopes.has('frame-cache') ? 'dirty' : project.preview?.status,
    },
    updatedAt: options.updatedAt || new Date().toISOString(),
  });
}

export function updateMediaProjectRenderSettings(projectInput = {}, settings = {}, options = {}) {
  let project = normalizeMediaProject(projectInput);
  let previous = normalizeMediaRenderSettings(project.renderSettings || {});
  let next = normalizeMediaRenderSettings({ ...previous, ...(isObject(settings) ? settings : {}) });
  let geometryChanged = previous.width !== next.width ||
    previous.height !== next.height ||
    previous.aspectRatio !== next.aspectRatio ||
    previous.orientation !== next.orientation ||
    previous.fps !== next.fps;
  let audioChanged = previous.includeAudio !== next.includeAudio ||
    previous.captionsEnabled !== next.captionsEnabled ||
    previous.captionsMode !== next.captionsMode ||
    previous.speakerMode !== next.speakerMode ||
    previous.providerId !== next.providerId ||
    !portableEqual(previous.voiceRefs || {}, next.voiceRefs || {});
  let updated = normalizeMediaProject({
    ...project,
    renderSettings: next,
    updatedAt: options.updatedAt || new Date().toISOString(),
  });
  let dirtyReasons = [];
  if (geometryChanged) dirtyReasons.push('format');
  if (audioChanged) dirtyReasons.push('audio');
  return dirtyReasons.length ? invalidateMediaProjectArtifacts(updated, dirtyReasons, options) : updated;
}

export function applyMediaRenderEvent(projectInput = {}, eventInput = {}, options = {}) {
  let event = normalizeMediaRenderEvent(eventInput, { projectId: projectInput?.id });
  let project = normalizeMediaProject(projectInput);
  let renderState = normalizeMediaRenderReadiness(project.renderState || {});
  let preview = { ...(project.preview || {}) };
  let renderJob = { ...(project.renderJob || {}) };
  let artifacts = Array.isArray(project.artifacts) ? project.artifacts : [];
  let routeState = project.routeState;
  let status = project.status;
  let dirty = new Set(renderState.dirty || []);
  let failures = [...(renderState.failures || [])];

  if (event.expectedFiles !== undefined || event.completedFiles !== undefined || event.progress !== undefined) {
    renderState = mergeReadiness(renderState, {
      expectedFiles: event.expectedFiles ?? renderState.expectedFiles,
      completedFiles: event.completedFiles ?? renderState.completedFiles,
      progress: event.progress ?? renderState.progress,
      stage: event.stage || renderState.stage,
      status: event.status || renderState.status,
      updatedAt: event.createdAt,
    });
  }
  if (event.route) routeState = event.route;

  if (event.type.endsWith('.failed')) {
    failures.push(normalizeRenderFailure({
      type: event.type,
      stage: event.stage,
      turnId: event.turnId,
      message: event.error || event.payload?.message || 'stage failed',
    }));
    renderState = mergeReadiness(renderState, {
      status: 'failed',
      failures,
      settled: false,
      autoRenderReady: false,
      updatedAt: event.createdAt,
    });
    status = 'failed';
  }

  if (event.type === 'audio.turn.rerender.requested') {
    return invalidateMediaProjectArtifacts({
      ...project,
      renderEvents: options.keepEvents === false ? project.renderEvents : [
        ...(Array.isArray(project.renderEvents) ? project.renderEvents : []),
        event,
      ].slice(-20),
    }, 'voice-rerender', { updatedAt: event.createdAt });
  }

  if (event.type === 'timeline.clip.invalidated' || event.type === 'preview.sequence.invalidated') {
    dirty.add(event.payload?.scope || 'preview-sequence');
    renderState = mergeReadiness(renderState, {
      status: 'dirty',
      dirty: [...dirty].filter((scope) => MEDIA_RENDER_DIRTY_SCOPE_SET.has(scope)),
      settled: false,
      autoRenderReady: false,
      updatedAt: event.createdAt,
    });
    status = 'dirty';
  }

  if (event.type === 'preview.firstFrame.ready' || event.type === 'capture.frame.ready') {
    let artifact = event.artifact || normalizeRenderArtifact(event.payload?.frame || {});
    preview = compactObject({
      ...preview,
      status: 'ready',
      currentFrame: artifact.url || artifact.path || preview.currentFrame,
      frames: uniqueArtifacts([...(Array.isArray(preview.frames) ? preview.frames : []), artifact]),
      progress: event.progress ?? preview.progress,
    });
  }

  if (event.type === 'preview.sequence.ready' || event.type === 'capture.done') {
    dirty.delete('frame-cache');
    dirty.delete('preview-sequence');
    let finalOnlyDirty = dirty.size === 0 || [...dirty].every((scope) => scope === 'final-output');
    preview = compactObject({
      ...preview,
      status: 'ready',
      progress: event.progress ?? 1,
      frameCount: event.artifact?.frameCount || preview.frameCount,
    });
    renderState = mergeReadiness(renderState, {
      dirty: [...dirty],
      status: finalOnlyDirty ? 'ready' : 'dirty',
      settled: finalOnlyDirty && failures.length === 0,
      autoRenderReady: finalOnlyDirty && failures.length === 0,
      updatedAt: event.createdAt,
    });
  }

  if (event.type.startsWith('encode.')) {
    renderJob = normalizeRenderJob({
      ...renderJob,
      id: event.jobId || renderJob.id,
      status: event.type === 'encode.done' ? 'complete' : event.type === 'encode.failed' ? 'failed' : 'running',
      stage: event.type,
      progress: event.progress ?? (event.type === 'encode.done' ? 1 : renderJob.progress),
      outputUrl: event.artifact?.url || renderJob.outputUrl,
      updatedAt: event.createdAt,
    });
    if (event.type === 'encode.done') {
      dirty.delete('final-output');
      renderState = mergeReadiness(renderState, {
        status: 'complete',
        stage: event.type,
        progress: 1,
        pending: [],
        settled: true,
        autoRenderReady: false,
        updatedAt: event.createdAt,
      });
      status = 'complete';
    } else if (event.type === 'encode.failed') {
      renderState = mergeReadiness(renderState, {
        status: 'failed',
        stage: event.type,
        settled: false,
        autoRenderReady: false,
        updatedAt: event.createdAt,
      });
      status = 'failed';
    } else {
      renderState = mergeReadiness(renderState, {
        status: 'running',
        stage: event.type,
        progress: event.progress ?? renderState.progress,
        settled: false,
        updatedAt: event.createdAt,
      });
    }
  }

  if (event.type === 'artifact.ready' || event.artifact) {
    artifacts = appendArtifact({ artifacts }, event.artifact);
  }

  return normalizeMediaProject({
    ...project,
    status,
    preview,
    artifacts,
    renderJob,
    renderState: mergeReadiness(renderState, {
      dirty: [...dirty],
      failures,
      updatedAt: event.createdAt,
    }),
    routeState,
    renderEvents: options.keepEvents === false ? project.renderEvents : [
      ...(Array.isArray(project.renderEvents) ? project.renderEvents : []),
      event,
    ].slice(-20),
    updatedAt: event.createdAt,
  });
}

export function createMediaProjectId(input = {}) {
  let source = isObject(input) ? input : {};
  let title = safeId(source.title || source.name || 'media-project');
  let suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return safeId(`${title}-${suffix}`);
}

export function normalizeMediaProject(input = {}, options = {}) {
  let source = isObject(input) ? input : {};
  let now = new Date().toISOString();
  let timeline = undefined;
  if (presentationTimelineHasTurns(source.timeline)) {
    timeline = createPresentationTimelineContract(source.timeline);
  } else if (options.requireTimeline) {
    throw new Error('media project requires a presentation timeline');
  }
  let renderJob = normalizeRenderJob(source.renderJob || source.job || {});
  let renderSettings = source.renderSettings || source.render
    ? normalizeMediaRenderSettings(source.renderSettings || source.render)
    : undefined;
  let renderState = source.renderState || source.readiness
    ? normalizeMediaRenderReadiness(source.renderState || source.readiness)
    : undefined;
  let routeState = source.routeState || source.route
    ? normalizeMediaRenderRouteState(source.routeState || source.route)
    : undefined;
  let id = safeId(source.id || options.id || createMediaProjectId(source));
  let timelineHash = timeline
    ? createPresentationTimelineHash(timeline)
    : cleanString(source.timelineHash || source.hash);
  if (source.alignedSequence && !timeline) throw new Error('media project aligned sequence requires its authored timeline');
  let alignedSequence = source.alignedSequence
    ? validatePresentationAlignedSequence(source.alignedSequence, timeline)
    : undefined;
  if (routeState && timeline?.id && !routeState.timelineId) {
    routeState = normalizeMediaRenderRouteState({ ...routeState, timelineId: timeline.id });
  }
  return compactObject({
    schemaVersion: cleanString(source.schemaVersion, MEDIA_PROJECT_SCHEMA_VERSION),
    id,
    title: cleanString(source.title || timeline?.title, 'Media project'),
    surface: cleanString(source.surface, MEDIA_PROJECT_DEFAULT_SURFACE),
    status: cleanString(source.status || renderJob.status, timeline ? 'draft' : 'empty'),
    timeline,
    timelineHash,
    alignedSequence,
    renderSettings,
    renderJob: Object.keys(renderJob).length ? renderJob : undefined,
    renderRequest: clonePortable(source.renderRequest || source.request),
    renderState,
    preview: clonePortable(source.preview),
    artifacts: clonePortable(source.artifacts),
    routeState,
    renderEvents: Array.isArray(source.renderEvents)
      ? source.renderEvents.map((event) => normalizeMediaRenderEvent(event, { projectId: id })).slice(-20)
      : undefined,
    source: clonePortable(source.source),
    metadata: clonePortable(source.metadata),
    createdAt: timestamp(source.createdAt, now),
    updatedAt: timestamp(source.updatedAt, now),
  });
}

export function createMediaProject(input = {}) {
  return normalizeMediaProject(input, { requireTimeline: true });
}

function projectId(value) {
  if (typeof value === 'string') return safeId(value, '');
  return safeId(value?.id || value?.projectId, '');
}

export function createMediaProjectRouteSearch(project, options = {}) {
  let id = projectId(project);
  if (!id) throw new Error('media project route requires a project id');
  let params = new URLSearchParams(cleanString(options.search));
  let surfaceParam = cleanString(options.surfaceParam, 'surface');
  let projectParam = cleanString(options.projectParam, MEDIA_PROJECT_ROUTE_PARAM);
  let routeState = normalizeMediaRenderRouteState(options.routeState || project.routeState || project.route || {});
  for (let name of [
    MEDIA_PROJECT_ROUTE_REATTACH_PARAM,
    MEDIA_PROJECT_ROUTE_SOURCE_SURFACE_PARAM,
    MEDIA_PROJECT_ROUTE_SOURCE_TAB_PARAM,
    MEDIA_PROJECT_ROUTE_WORKSPACE_SECTION_PARAM,
    MEDIA_PROJECT_ROUTE_PREVIEW_FRAME_PARAM,
    MEDIA_PROJECT_ROUTE_PREVIEW_MODE_PARAM,
    MEDIA_PROJECT_ROUTE_JOB_PARAM,
    MEDIA_PROJECT_ROUTE_SOURCE_URL_PARAM,
    MEDIA_PROJECT_ROUTE_TIMELINE_CURSOR_PARAM,
    MEDIA_PROJECT_ROUTE_TIMELINE_PARAM,
  ]) {
    params.delete(name);
  }
  params.set(surfaceParam, cleanString(options.surface, MEDIA_PROJECT_DEFAULT_SURFACE));
  params.set(projectParam, id);
  if (routeState.reattachStream) params.set(MEDIA_PROJECT_ROUTE_REATTACH_PARAM, '1');
  if (routeState.jobId) params.set(MEDIA_PROJECT_ROUTE_JOB_PARAM, routeState.jobId);
  if (routeState.sourceSurface) params.set(MEDIA_PROJECT_ROUTE_SOURCE_SURFACE_PARAM, routeState.sourceSurface);
  if (routeState.sourceTabId) params.set(MEDIA_PROJECT_ROUTE_SOURCE_TAB_PARAM, routeState.sourceTabId);
  if (routeState.workspaceSection) params.set(MEDIA_PROJECT_ROUTE_WORKSPACE_SECTION_PARAM, routeState.workspaceSection);
  if (routeState.sourceUrl) params.set(MEDIA_PROJECT_ROUTE_SOURCE_URL_PARAM, routeState.sourceUrl);
  if (routeState.timelineId || project.timeline?.id) params.set(MEDIA_PROJECT_ROUTE_TIMELINE_PARAM, routeState.timelineId || project.timeline.id);
  if (Number.isFinite(routeState.previewFrame)) params.set(MEDIA_PROJECT_ROUTE_PREVIEW_FRAME_PARAM, String(routeState.previewFrame));
  if (routeState.previewMode) params.set(MEDIA_PROJECT_ROUTE_PREVIEW_MODE_PARAM, routeState.previewMode);
  if (Number.isFinite(routeState.timelineCursorMs)) params.set(MEDIA_PROJECT_ROUTE_TIMELINE_CURSOR_PARAM, String(routeState.timelineCursorMs));
  for (let name of Array.isArray(options.removeParams) ? options.removeParams : []) {
    params.delete(name);
  }
  let text = params.toString();
  return text ? `?${text}` : '';
}

function mediaProjectRouteParamError(name, value) {
  let error = new Error(`invalid media project route parameter ${name}: ${value}`);
  error.code = 'MEDIA_PROJECT_ROUTE_PARAM_INVALID';
  error.param = name;
  error.value = value;
  return error;
}

function routeNumberParam(params, name) {
  if (!params.has(name)) return undefined;
  let raw = params.get(name);
  let text = cleanString(raw);
  if (!text) throw mediaProjectRouteParamError(name, raw ?? '');
  let number = Number(text);
  if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) {
    throw mediaProjectRouteParamError(name, text);
  }
  return number;
}

export function parseMediaProjectRouteSearch(search = '', options = {}) {
  let params = new URLSearchParams(cleanString(search));
  let projectParam = cleanString(options.projectParam, MEDIA_PROJECT_ROUTE_PARAM);
  let surfaceParam = cleanString(options.surfaceParam, 'surface');
  let mediaProjectId = safeId(params.get(projectParam), '');
  let previewFrame = routeNumberParam(params, MEDIA_PROJECT_ROUTE_PREVIEW_FRAME_PARAM);
  let timelineCursorMs = routeNumberParam(params, MEDIA_PROJECT_ROUTE_TIMELINE_CURSOR_PARAM);
  let routeState = normalizeMediaRenderRouteState({
    mediaProjectId,
    jobId: params.get(MEDIA_PROJECT_ROUTE_JOB_PARAM),
    surface: cleanString(params.get(surfaceParam)),
    sourceSurface: params.get(MEDIA_PROJECT_ROUTE_SOURCE_SURFACE_PARAM),
    sourceTabId: params.get(MEDIA_PROJECT_ROUTE_SOURCE_TAB_PARAM),
    workspaceSection: params.get(MEDIA_PROJECT_ROUTE_WORKSPACE_SECTION_PARAM),
    sourceUrl: params.get(MEDIA_PROJECT_ROUTE_SOURCE_URL_PARAM),
    timelineId: params.get(MEDIA_PROJECT_ROUTE_TIMELINE_PARAM),
    previewFrame,
    previewMode: params.get(MEDIA_PROJECT_ROUTE_PREVIEW_MODE_PARAM),
    timelineCursorMs,
    reattachStream: params.get(MEDIA_PROJECT_ROUTE_REATTACH_PARAM) === '1',
  });
  return {
    projectId: mediaProjectId,
    surface: routeState.surface,
    routeState,
  };
}

export function createMemoryMediaProjectStore(initialProjects = []) {
  let projects = new Map();
  for (let item of Array.isArray(initialProjects) ? initialProjects : []) {
    let project = normalizeMediaProject(item);
    projects.set(project.id, project);
  }
  return {
    save(project) {
      let normalized = normalizeMediaProject(project);
      projects.set(normalized.id, normalized);
      return normalized;
    },
    create(project) {
      return this.save(createMediaProject(project));
    },
    load(id) {
      let project = projects.get(projectId(id));
      return project ? clonePortable(project) : null;
    },
    update(id, patch = {}) {
      let current = this.load(id);
      if (!current) return null;
      return this.save({ ...current, ...clonePortable(patch), id: current.id, updatedAt: new Date().toISOString() });
    },
    remove(id) {
      return projects.delete(projectId(id));
    },
    list() {
      return [...projects.values()].map((project) => clonePortable(project));
    },
  };
}

export function createStorageMediaProjectStore(storage, options = {}) {
  let namespace = cleanString(options.namespace, 'workspace:media-projects');
  let indexKey = `${namespace}:index`;
  let memory = createMemoryMediaProjectStore(options.initialProjects || []);

  function hasStorage() {
    return Boolean(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function');
  }

  function key(id) {
    return `${namespace}:${projectId(id)}`;
  }

  function readIndex() {
    if (!hasStorage()) return memory.list().map((project) => project.id);
    try {
      let parsed = JSON.parse(storage.getItem(indexKey) || '[]');
      return Array.isArray(parsed) ? parsed.map((id) => projectId(id)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function writeIndex(ids) {
    if (!hasStorage()) return;
    storage.setItem(indexKey, JSON.stringify([...new Set(ids.map((id) => projectId(id)).filter(Boolean))]));
  }

  function saveStored(project) {
    let normalized = normalizeMediaProject(project);
    if (!hasStorage()) return memory.save(normalized);
    storage.setItem(key(normalized.id), JSON.stringify(normalized));
    writeIndex([...readIndex(), normalized.id]);
    return normalized;
  }

  return {
    save: saveStored,
    create(project) {
      return saveStored(createMediaProject(project));
    },
    load(id) {
      let normalizedId = projectId(id);
      if (!normalizedId) return null;
      if (!hasStorage()) return memory.load(normalizedId);
      try {
        let raw = storage.getItem(key(normalizedId));
        return raw ? normalizeMediaProject(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    update(id, patch = {}) {
      let current = this.load(id);
      if (!current) return null;
      return saveStored({ ...current, ...clonePortable(patch), id: current.id, updatedAt: new Date().toISOString() });
    },
    remove(id) {
      let normalizedId = projectId(id);
      if (!normalizedId) return false;
      if (!hasStorage()) return memory.remove(normalizedId);
      try { storage.removeItem?.(key(normalizedId)); } catch {}
      writeIndex(readIndex().filter((item) => item !== normalizedId));
      return true;
    },
    list() {
      if (!hasStorage()) return memory.list();
      return readIndex().map((id) => this.load(id)).filter(Boolean);
    },
  };
}
