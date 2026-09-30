import { canonicalize, computeIntegrity } from '../../schema/canonical-json.js';
import { projectPresentationNle } from './nle-projection.js';

export const PRESENTATION_TIMELINE_EDITOR_MODEL_VERSION =
  'workspace-presentation-timeline-editor-model-v1';

function clone(value) {
  return JSON.parse(canonicalize(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (let child of Object.values(value)) deepFreeze(child);
  return value;
}

function frameAt(ms, fps, edge) {
  let value = Math.max(0, Number(ms) || 0) * fps / 1000;
  return edge === 'end' ? Math.ceil(value) : Math.floor(value);
}

function editorTrackType(kind) {
  return {
    audio: 'audio',
    narration: 'captions',
    focus: 'video',
    annotation: 'effect',
    interaction: 'actions',
    state: 'actions',
  }[kind] || 'default';
}

function clipLabel(clip) {
  if (clip.audio?.assetId) return `${clip.turnId || clip.id} · audio`;
  if (clip.cue?.targetId) return `${clip.turnId || clip.id} · ${clip.cue.targetId}`;
  return clip.turnId || clip.id;
}

function editorClip(clip, fps, durationFrames) {
  let start = frameAt(clip.span?.startMs, fps, 'start');
  let end = frameAt(clip.span?.endMs, fps, 'end');
  start = Math.min(start, Math.max(0, durationFrames - 1));
  end = Math.max(start + 1, Math.min(end, durationFrames));
  return {
    id: clip.id,
    cellId: clip.cellId || null,
    start,
    end,
    label: clipLabel(clip),
    kind: clip.kind,
    semanticKind: clip.semanticKind || clip.kind,
    editable: clip.editable !== false,
    generated: clip.generated === true,
    commandTypes: clone(clip.commandTypes || []),
    sourceSpan: clone(clip.span),
    gestureSpan: clip.gesture ? clone(clip.gesture) : null,
    visibilitySpan: clip.visibility ? clone(clip.visibility) : null,
  };
}

/**
 * Adapts the exact Project-derived NLE projection to the public
 * `sn-timeline-editor.loadTimeline()` model. This is a view only: clip IDs,
 * layer IDs, timing, and edit authority remain owned by the Authoring Project.
 */
export function createPresentationTimelineEditorModel(
  projectInput = {},
  scheduleInput = {},
  { fps: fpsInput = 30 } = {},
) {
  let fps = Math.max(1, Math.round(Number(fpsInput) || 30));
  let nle = projectPresentationNle(projectInput, scheduleInput);
  let durationMs = Math.max(1, Number(scheduleInput.totalDurationMs) || 1);
  let duration = Math.max(1, Math.ceil(durationMs * fps / 1000));
  let tracks = [...nle.tracks, ...nle.generatedTracks].map((track) => ({
    id: track.id,
    layerId: track.layerId || null,
    type: editorTrackType(track.kind),
    kind: track.kind,
    label: track.name || track.id,
    editable: track.editable !== false,
    generated: track.generated === true,
    clips: track.clips.map((clip) => editorClip(clip, fps, duration)),
  }));
  let markers = nle.anchors.map((anchor) => ({
    id: anchor.id,
    frame: Math.min(duration, frameAt(anchor.timeMs, fps, 'start')),
    label: `${anchor.turnId}:${anchor.edge}`,
    anchorId: anchor.id,
    sourceCellId: anchor.sourceCellId,
  }));
  let model = {
    schemaVersion: PRESENTATION_TIMELINE_EDITOR_MODEL_VERSION,
    authoringProjectHash: nle.authoringProjectHash,
    timelineHash: nle.timelineHash,
    scheduleHash: nle.scheduleHash,
    nleHash: nle.hash,
    fps,
    duration,
    tracks,
    markers,
  };
  return deepFreeze({
    ...model,
    hash: `${PRESENTATION_TIMELINE_EDITOR_MODEL_VERSION}:${computeIntegrity(model)}`,
  });
}

export default createPresentationTimelineEditorModel;
