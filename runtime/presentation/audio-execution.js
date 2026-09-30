import { canonicalize, computeIntegrity } from '../../schema/canonical-json.js';
import {
  createPresentationAuthoringTimelineProjection,
  validatePresentationAuthoringProject,
} from './project.js';
import { PRESENTATION_SCHEDULE_V2_VERSION } from './schedule-v2.js';

export const PRESENTATION_PLAYBACK_PLAN_VERSION = 'workspace-presentation-playback-plan-v1';

export class PresentationPlaybackPlanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PresentationPlaybackPlanError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new PresentationPlaybackPlanError(code, message, details);
}

function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  return JSON.parse(canonicalize(value));
}

function planCell(projectCell, scheduleCell) {
  if (projectCell.kind === 'audio-clip') {
    if (!scheduleCell?.audio) {
      fail(
        'PRESENTATION_AUDIO_SCHEDULE_INVALID',
        `schedule has no audio span for clip "${projectCell.id}"`,
        { cellId: projectCell.id },
      );
    }
    return {
      id: projectCell.id,
      cellId: projectCell.id,
      layerId: projectCell.layerId,
      turnId: projectCell.turnId,
      kind: 'audio-clip',
      audio: clone(projectCell.audio),
      timing: clone(projectCell.timing),
      span: {
        startMs: scheduleCell.audio.startMs,
        endMs: scheduleCell.audio.endMs,
      },
      dependsOn: clone(projectCell.dependsOn),
      order: scheduleCell.cellOrder,
    };
  }
  return {
    id: projectCell.id,
    cellId: projectCell.id,
    layerId: projectCell.layerId,
    turnId: projectCell.turnId,
    kind: projectCell.kind === 'cue' ? projectCell.cue.kind : projectCell.kind,
    span: {
      startMs: scheduleCell.startMs,
      endMs: scheduleCell.gesture?.endMs
        ?? scheduleCell.visibility?.endMs
        ?? scheduleCell.startMs,
    },
    dependsOn: clone(projectCell.dependsOn),
    order: scheduleCell.cellOrder,
  };
}

/**
 * Derive the immutable playback view shared by the NLE and headless controller.
 * @param {object} projectInput
 * @param {object} scheduleInput
 * @returns {object}
 */
export function createPresentationPlaybackPlan(projectInput = {}, scheduleInput = {}) {
  let project = validatePresentationAuthoringProject(projectInput);
  let timeline = createPresentationAuthoringTimelineProjection(project);
  let scheduleWithoutHash = isObject(scheduleInput)
    ? Object.fromEntries(Object.entries(scheduleInput).filter(([key]) => key !== 'hash'))
    : null;
  let expectedScheduleHash = scheduleWithoutHash
    ? `${PRESENTATION_SCHEDULE_V2_VERSION}:${computeIntegrity(scheduleWithoutHash)}`
    : null;
  if (
    !isObject(scheduleInput)
    || scheduleInput.contractVersion !== PRESENTATION_SCHEDULE_V2_VERSION
    || scheduleInput.authoringProjectHash !== project.hash
    || scheduleInput.timelineHash !== timeline.hash
    || scheduleInput.hash !== expectedScheduleHash
  ) {
    fail(
      'PRESENTATION_PLAYBACK_SCHEDULE_INVALID',
      'playback plan requires a schedule for the exact authoring project',
      { authoringProjectHash: project.hash },
    );
  }
  let scheduledCells = Array.isArray(scheduleInput.cells) ? scheduleInput.cells : [];
  let scheduleById = new Map(scheduledCells.map((cell) => [cell.cellId, cell]));
  if (
    scheduleById.size !== project.cells.length
    || scheduledCells.length !== project.cells.length
  ) {
    fail(
      'PRESENTATION_PLAYBACK_SCHEDULE_INVALID',
      'playback schedule cell identities must exactly cover the Project',
      { expectedCellCount: project.cells.length, receivedCellCount: scheduledCells.length },
    );
  }
  let cells = project.cells.map((cell) => {
    let scheduled = scheduleById.get(cell.id);
    if (!scheduled) {
      fail(
        'PRESENTATION_PLAYBACK_SCHEDULE_INVALID',
        `schedule does not cover Project cell "${cell.id}"`,
        { cellId: cell.id },
      );
    }
    return planCell(cell, scheduled);
  });
  cells.sort((left, right) => (
    left.span.startMs - right.span.startMs
    || left.order - right.order
    || left.id.localeCompare(right.id)
  ));
  let plan = {
    version: PRESENTATION_PLAYBACK_PLAN_VERSION,
    authoringProjectHash: project.hash,
    scheduleHash: scheduleInput.hash,
    clips: cells.filter((cell) => cell.kind === 'audio-clip'),
    narration: cells.filter((cell) => cell.kind === 'narration'),
    events: cells.filter((cell) => !['audio-clip', 'narration'].includes(cell.kind)),
    cells,
  };
  return {
    ...plan,
    hash: `${PRESENTATION_PLAYBACK_PLAN_VERSION}:${computeIntegrity(plan)}`,
  };
}

function validatePlan(value, project, schedule) {
  if (!isObject(value) || value.version !== PRESENTATION_PLAYBACK_PLAN_VERSION) {
    fail('PRESENTATION_PLAYBACK_PLAN_INVALID', 'unsupported presentation playback plan');
  }
  let expected = createPresentationPlaybackPlan(project, schedule);
  if (canonicalize(value) !== canonicalize(expected)) {
    fail(
      'PRESENTATION_PLAYBACK_PLAN_STALE',
      'presentation playback plan is stale',
      { expectedHash: expected.hash, receivedHash: value.hash },
    );
  }
  return expected;
}

export function validatePresentationPlaybackPlan(value, projectInput, scheduleInput) {
  let project = validatePresentationAuthoringProject(projectInput);
  return validatePlan(value, project, scheduleInput);
}
