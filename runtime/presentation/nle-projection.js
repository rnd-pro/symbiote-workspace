import { canonicalize, computeIntegrity } from '../../schema/canonical-json.js';
import {
  createPresentationAuthoringTimelineProjection,
  validatePresentationAuthoringProject,
} from './project.js';
import { PRESENTATION_SCHEDULE_V2_VERSION } from './schedule-v2.js';

export const PRESENTATION_NLE_SCHEMA_VERSION = 'workspace-presentation-nle-v1';
const CELL_COMMAND_TYPES = Object.freeze([
  'cell.remove',
  'cell.move',
  'cell.set-content',
  'cell.set-dependencies',
]);
const CUE_COMMAND_TYPES = Object.freeze([...CELL_COMMAND_TYPES, 'cell.set-timing']);
const AUDIO_CLIP_COMMAND_TYPES = Object.freeze([
  ...CELL_COMMAND_TYPES,
  'audio-clip.split',
  'audio-clip.trim',
  'audio-clip.move',
  'audio-clip.link',
  'audio-clip.unlink',
]);

export class PresentationNleProjectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PresentationNleProjectionError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new PresentationNleProjectionError(code, message, details);
}

function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  return JSON.parse(canonicalize(value));
}

function hashProjection(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'hash'));
}

function validateScheduleProjection(schedule, project, timeline) {
  if (!isObject(schedule)) {
    fail('PRESENTATION_NLE_SCHEDULE_INVALID', 'NLE projection requires schedule v2');
  }
  if (schedule.contractVersion !== PRESENTATION_SCHEDULE_V2_VERSION) {
    fail(
      'PRESENTATION_NLE_SCHEDULE_INVALID',
      `NLE projection requires ${PRESENTATION_SCHEDULE_V2_VERSION}`,
      { contractVersion: schedule.contractVersion },
    );
  }
  if (schedule.authoringProjectHash !== project.hash || schedule.timelineHash !== timeline.hash) {
    fail(
      'PRESENTATION_NLE_STALE',
      'NLE schedule does not match the current authoring project and timeline hashes',
      {
        authoringProjectHash: project.hash,
        scheduleAuthoringProjectHash: schedule.authoringProjectHash,
        timelineHash: timeline.hash,
        scheduleTimelineHash: schedule.timelineHash,
      },
    );
  }
  if (
    schedule.visualOwnerId !== project.policy.visualOwnerId
    || canonicalize(schedule.collisionDomains) !== canonicalize(project.policy.collisionDomains)
  ) {
    fail(
      'PRESENTATION_NLE_STALE',
      'NLE schedule presenter ownership does not match the current authoring project',
      { authoringProjectHash: project.hash, scheduleHash: schedule.hash },
    );
  }
  let expectedHash = `${PRESENTATION_SCHEDULE_V2_VERSION}:${computeIntegrity(hashProjection(schedule))}`;
  if (schedule.hash !== expectedHash) {
    fail(
      'PRESENTATION_NLE_STALE',
      'NLE schedule hash is stale',
      { expectedHash, receivedHash: schedule.hash },
    );
  }
  if (!Array.isArray(schedule.cells) || schedule.cells.length !== project.cells.length) {
    fail(
      'PRESENTATION_NLE_SCHEDULE_INVALID',
      'NLE schedule must cover every presentation authoring project cell',
      { expectedCells: project.cells.length },
    );
  }
  let scheduledIds = new Set(schedule.cells.map((cell) => cell.cellId));
  if (
    scheduledIds.size !== project.cells.length
    || project.cells.some((cell) => !scheduledIds.has(cell.id))
  ) {
    fail(
      'PRESENTATION_NLE_SCHEDULE_INVALID',
      'NLE schedule cell identities do not match the presentation authoring project',
    );
  }
  return schedule;
}

function commandTypesForCell(cell) {
  if (cell.kind === 'cue') return [...CUE_COMMAND_TYPES];
  if (cell.kind === 'audio-clip') return [...AUDIO_CLIP_COMMAND_TYPES];
  return [...CELL_COMMAND_TYPES];
}

function clipSpan(scheduled) {
  if (scheduled.audio) return { startMs: scheduled.audio.startMs, endMs: scheduled.audio.endMs };
  if (scheduled.narration) return clone(scheduled.narration);
  if (scheduled.gesture || scheduled.visibility) {
    let spans = [scheduled.gesture, scheduled.visibility].filter(Boolean);
    return {
      startMs: Math.min(...spans.map(({ startMs }) => startMs)),
      endMs: Math.max(...spans.map(({ endMs }) => endMs)),
    };
  }
  return { startMs: scheduled.startMs, endMs: scheduled.startMs };
}

function createAnchors(project, scheduleById) {
  let anchors = [];
  for (let cell of project.cells) {
    let scheduled = scheduleById.get(cell.id);
    if (cell.kind === 'narration') {
      anchors.push({
        id: `${cell.id}:turn-start`,
        turnId: cell.turnId,
        sourceCellId: cell.id,
        edge: 'turn-start',
        anchor: { anchor: 'turn-start', offsetMs: 0 },
        timeMs: scheduled.narration.startMs,
      });
      anchors.push({
        id: `${cell.id}:turn-end`,
        turnId: cell.turnId,
        sourceCellId: cell.id,
        edge: 'turn-end',
        anchor: { anchor: 'turn-end', offsetMs: 0 },
        timeMs: scheduled.narration.endMs,
      });
      continue;
    }
    if (cell.kind === 'audio-clip') {
      anchors.push({
        id: `${cell.id}:start`,
        turnId: cell.turnId,
        sourceCellId: cell.id,
        edge: 'start',
        anchor: clone(cell.timing.at),
        timeMs: scheduled.audio.startMs,
      });
      anchors.push({
        id: `${cell.id}:end`,
        turnId: cell.turnId,
        sourceCellId: cell.id,
        edge: 'end',
        anchor: clone(cell.timing.at),
        timeMs: scheduled.audio.endMs,
      });
      continue;
    }
    anchors.push({
      id: `${cell.id}:at`,
      turnId: cell.turnId,
      sourceCellId: cell.id,
      edge: 'at',
      anchor: clone(cell.timing.at),
      timeMs: scheduled.anchorMs,
    });
    if (cell.timing.until !== null) {
      anchors.push({
        id: `${cell.id}:until`,
        turnId: cell.turnId,
        sourceCellId: cell.id,
        edge: 'until',
        anchor: clone(cell.timing.until),
        timeMs: scheduled.visibility.endMs,
      });
    }
  }
  return anchors;
}

/**
 * @param {object} projectInput
 * @param {object} scheduleInput
 * @returns {object}
 */
export function projectPresentationNle(projectInput = {}, scheduleInput = {}) {
  let project = validatePresentationAuthoringProject(projectInput);
  let timeline = createPresentationAuthoringTimelineProjection(project);
  let schedule = validateScheduleProjection(scheduleInput, project, timeline);
  let scheduleById = new Map(schedule.cells.map((cell) => [cell.cellId, cell]));
  let tracks = project.layers.map((layer, order) => {
    let clips = project.cells
      .filter((cell) => cell.layerId === layer.id)
      .map((cell) => {
        let scheduled = scheduleById.get(cell.id);
        let editable = ['cue', 'audio-clip'].includes(cell.kind);
        return {
          id: cell.id,
          cellId: cell.id,
          layerId: cell.layerId,
          turnId: cell.turnId,
          kind: cell.kind,
          semanticKind: cell.kind === 'cue' ? cell.cue.kind : cell.kind,
          editable,
          generated: false,
          commandTypes: commandTypesForCell(cell),
          timing: cell.kind === 'cue' || cell.kind === 'audio-clip' ? clone(cell.timing) : null,
          ...(cell.kind === 'cue' ? { cue: clone(cell.cue) } : {}),
          ...(cell.kind === 'audio-clip' ? { audio: clone(cell.audio) } : {}),
          span: clipSpan(scheduled),
          gesture: scheduled.gesture,
          visibility: scheduled.visibility,
        };
      });
    return {
      id: layer.id,
      layerId: layer.id,
      kind: layer.kind,
      name: layer.name,
      order,
      editable: clips.some((clip) => clip.editable),
      generated: false,
      clips,
    };
  });
  let authoredAudioClips = project.cells.filter((cell) => cell.kind === 'audio-clip');
  let generatedTracks = authoredAudioClips.length ? [] : [{
    id: 'generated:narration-audio',
    kind: 'audio',
    name: 'Narration audio',
    order: 0,
    editable: false,
    generated: true,
    clips: [{
      id: 'generated:narration-audio:master',
      kind: 'audio',
      editable: false,
      generated: true,
      sourceHash: schedule.alignedSequenceHash,
      span: { startMs: schedule.audio.startMs, endMs: schedule.audio.endMs },
    }],
  }];
  let nle = {
    schemaVersion: PRESENTATION_NLE_SCHEMA_VERSION,
    authoringProjectHash: project.hash,
    timelineHash: timeline.hash,
    scheduleHash: schedule.hash,
    presentationStartMs: schedule.presentationStartMs,
    tracks,
    generatedTracks,
    anchors: createAnchors(project, scheduleById),
  };
  return {
    ...nle,
    hash: `${PRESENTATION_NLE_SCHEMA_VERSION}:${computeIntegrity(nle)}`,
  };
}
