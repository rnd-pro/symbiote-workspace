import { canonicalize, computeIntegrity } from '../../schema/canonical-json.js';
import {
  PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
  listPresentationAuthoringProjectCommandDescriptors,
} from './commands.js';
import {
  createPresentationAuthoringTimelineProjection,
  validatePresentationAuthoringProject,
} from './project.js';
import { PRESENTATION_SCHEDULE_V2_VERSION } from './schedule-v2.js';

export const PRESENTATION_NLE_SCHEMA_VERSION = 'workspace-presentation-nle-v1';
const MAX_NLE_LEAD_MS = 120000;

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
  let available = new Set(
    listPresentationAuthoringProjectCommandDescriptors().map((descriptor) => descriptor.type),
  );
  let requested = [
    'cell.remove',
    'cell.move',
    'cell.set-content',
    'cell.set-dependencies',
  ];
  if (cell.kind === 'cue') requested.push('cell.set-timing');
  return requested.filter((type) => available.has(type));
}

function clipSpan(scheduled) {
  if (scheduled.narration) return clone(scheduled.narration);
  if (scheduled.gesture) return clone(scheduled.gesture);
  if (scheduled.visibility) return clone(scheduled.visibility);
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

function validateNle(value, project, schedule) {
  if (!isObject(value) || value.schemaVersion !== PRESENTATION_NLE_SCHEMA_VERSION) {
    fail(
      'PRESENTATION_NLE_INVALID',
      `NLE edit requires ${PRESENTATION_NLE_SCHEMA_VERSION}`,
    );
  }
  let expected = projectPresentationNle(project, schedule);
  if (canonicalize(value) !== canonicalize(expected)) {
    fail(
      'PRESENTATION_NLE_STALE',
      'NLE must exactly match the canonical authoring project and schedule projection',
      {
        expectedHash: expected.hash,
        receivedHash: value.hash,
        authoringProjectHash: project.hash,
        scheduleHash: schedule.hash,
      },
    );
  }
  return expected;
}

function editBasis(project, schedule, nle) {
  return {
    authoringProjectHash: project.hash,
    timelineHash: nle.timelineHash,
    scheduleHash: schedule.hash,
    nleHash: nle.hash,
  };
}

function validateEditBasis(value, expected) {
  if (!isObject(value)) {
    fail(
      'PRESENTATION_NLE_EDIT_INVALID',
      'NLE frame drag requires an authoring-project/timeline/schedule/NLE basis',
      { path: 'edit.basis' },
    );
  }
  let keys = ['authoringProjectHash', 'timelineHash', 'scheduleHash', 'nleHash'];
  for (let key of Object.keys(value)) {
    if (!keys.includes(key)) {
      fail(
        'PRESENTATION_NLE_EDIT_INVALID',
        `NLE edit basis field "${key}" is not supported`,
        { path: `edit.basis.${key}` },
      );
    }
  }
  if (canonicalize(value) !== canonicalize(expected)) {
    fail(
      'PRESENTATION_NLE_STALE',
      'NLE edit basis does not match the exact authoring project, timeline, schedule, and NLE',
      { expected, received: clone(value) },
    );
  }
}

function anchorChoice(anchor, frameMs) {
  return { ...clone(anchor), leadMs: anchor.timeMs - frameMs };
}

function leadIsValid(choice) {
  return choice.leadMs >= 0 && choice.leadMs <= MAX_NLE_LEAD_MS;
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
  let tracks = project.layers.map((layer, order) => ({
    id: layer.id,
    layerId: layer.id,
    kind: layer.kind,
    name: layer.name,
    order,
    editable: true,
    generated: false,
    clips: project.cells
      .filter((cell) => cell.layerId === layer.id)
      .map((cell) => {
        let scheduled = scheduleById.get(cell.id);
        return {
          id: cell.id,
          cellId: cell.id,
          layerId: cell.layerId,
          turnId: cell.turnId,
          kind: cell.kind,
          semanticKind: cell.kind === 'cue' ? cell.cue.kind : 'narration',
          editable: true,
          generated: false,
          commandTypes: commandTypesForCell(cell),
          timing: cell.kind === 'cue' ? clone(cell.timing) : null,
          span: clipSpan(scheduled),
          gesture: scheduled.gesture,
          visibility: scheduled.visibility,
        };
      }),
  }));
  let generatedTracks = [{
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

/**
 * @param {object} projectInput
 * @param {object} scheduleInput
 * @param {object} nleInput
 * @param {object} editInput
 * @returns {object}
 */
export function createPresentationAuthoringCommandFromNleEdit(
  projectInput = {},
  scheduleInput = {},
  nleInput = {},
  editInput = {},
) {
  let project = validatePresentationAuthoringProject(projectInput);
  let timeline = createPresentationAuthoringTimelineProjection(project);
  let schedule = validateScheduleProjection(scheduleInput, project, timeline);
  let nle = validateNle(nleInput, project, schedule);
  let basis = editBasis(project, schedule, nle);
  if (!isObject(editInput)) {
    fail('PRESENTATION_NLE_EDIT_INVALID', 'NLE edit must be an object');
  }
  let allowedKeys = ['id', 'type', 'clipId', 'frameMs', 'anchorId', 'basis'];
  for (let key of Object.keys(editInput)) {
    if (!allowedKeys.includes(key)) {
      fail(
        'PRESENTATION_NLE_EDIT_INVALID',
        `NLE edit field "${key}" is not supported`,
        { path: `edit.${key}` },
      );
    }
  }
  validateEditBasis(editInput.basis, basis);
  if (editInput.type !== 'clip.frame-drag') {
    fail(
      'PRESENTATION_NLE_EDIT_INVALID',
      'NLE edit type must be clip.frame-drag',
      { type: editInput.type },
    );
  }
  let id = String(editInput.id ?? '').trim();
  let clipId = String(editInput.clipId ?? '').trim();
  if (!id || !clipId) {
    fail(
      'PRESENTATION_NLE_EDIT_INVALID',
      'NLE frame drag requires nonempty id and clipId',
    );
  }
  if (
    !Number.isInteger(editInput.frameMs)
    || editInput.frameMs < 0
    || editInput.frameMs > schedule.totalDurationMs
  ) {
    fail(
      'PRESENTATION_NLE_EDIT_INVALID',
      `NLE frame drag frameMs must be an integer between 0 and ${schedule.totalDurationMs}`,
      { frameMs: editInput.frameMs, totalDurationMs: schedule.totalDurationMs },
    );
  }
  let cell = project.cells.find((item) => item.id === clipId);
  if (!cell || cell.kind !== 'cue') {
    fail(
      'PRESENTATION_NLE_EDIT_INVALID',
      `NLE frame drag clipId "${clipId}" must name an editable semantic cue cell`,
      { clipId },
    );
  }
  let turnChoices = nle.anchors
    .filter((anchor) => anchor.turnId === cell.turnId)
    .map((anchor) => anchorChoice(anchor, editInput.frameMs));
  let validChoices = turnChoices.filter(leadIsValid);
  let choice;
  if (editInput.anchorId !== undefined) {
    let selected = turnChoices.find((anchor) => anchor.id === editInput.anchorId);
    if (!selected) {
      return {
        status: 'rejected',
        code: 'PRESENTATION_NLE_ANCHOR_INVALID',
        clipId,
        frameMs: editInput.frameMs,
        anchorId: editInput.anchorId,
        basis,
      };
    }
    if (!leadIsValid(selected)) {
      return {
        status: 'rejected',
        code: 'PRESENTATION_NLE_LEAD_INVALID',
        clipId,
        frameMs: editInput.frameMs,
        anchorId: selected.id,
        leadMs: selected.leadMs,
        allowedLeadMs: { min: 0, max: MAX_NLE_LEAD_MS },
        basis,
      };
    }
    choice = selected;
  } else {
    let exactChoices = validChoices.filter((anchor) => anchor.leadMs === 0);
    let automaticChoices = exactChoices.length ? exactChoices : validChoices;
    if (automaticChoices.length === 1) [choice] = automaticChoices;
  }
  if (!choice && !validChoices.length) {
    return {
      status: 'rejected',
      code: 'PRESENTATION_NLE_LEAD_INVALID',
      clipId,
      frameMs: editInput.frameMs,
      allowedLeadMs: { min: 0, max: MAX_NLE_LEAD_MS },
      basis,
    };
  }
  if (!choice) {
    return {
      status: 'anchor-choices',
      code: 'PRESENTATION_NLE_ANCHOR_CHOICES',
      clipId,
      frameMs: editInput.frameMs,
      choices: clone(validChoices),
      basis,
    };
  }
  return {
    status: 'command',
    command: {
      schemaVersion: PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
      id,
      base: { revision: project.revision, authoringProjectHash: project.hash },
      type: 'cell.set-timing',
      payload: {
        cellId: cell.id,
        timing: {
          ...clone(cell.timing),
          at: clone(choice.anchor),
          leadMs: choice.leadMs,
        },
      },
    },
    anchor: clone(choice),
    basis,
  };
}
