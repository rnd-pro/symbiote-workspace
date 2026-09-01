import { canonicalize } from '../../schema/canonical-json.js';
import {
  PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
  listPresentationAuthoringProjectCommandDescriptors,
} from './commands.js';
import {
  PRESENTATION_NLE_SCHEMA_VERSION,
  PresentationNleProjectionError,
  projectPresentationNle,
} from './nle-projection.js';
import { createPresentationTimelineEditorModel } from './nle-timeline-editor.js';
import { validatePresentationAuthoringProject } from './project.js';

const MAX_NLE_LEAD_MS = 120000;

function clone(value) {
  return JSON.parse(canonicalize(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (let child of Object.values(value)) deepFreeze(child);
  return value;
}

function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code, message, details = {}) {
  throw new PresentationNleProjectionError(code, message, details);
}

/**
 * Local-only adapter that verifies every public NLE action against the exact
 * command descriptors exposed by the MCP/CLI authoring tool pack.
 */
export function projectPresentationAuthoringNle(projectInput = {}, scheduleInput = {}) {
  let nle = projectPresentationNle(projectInput, scheduleInput);
  let available = new Set(
    listPresentationAuthoringProjectCommandDescriptors().map((descriptor) => descriptor.type),
  );
  let unavailable = nle.tracks
    .flatMap((track) => track.clips)
    .flatMap((clip) => clip.commandTypes)
    .filter((type, index, values) => !available.has(type) && values.indexOf(type) === index);
  if (unavailable.length) {
    fail(
      'PRESENTATION_NLE_COMMAND_UNAVAILABLE',
      'NLE projection exposes actions without matching local authoring commands',
      { commandTypes: unavailable },
    );
  }
  return nle;
}

function validateNle(value, project, schedule) {
  if (!isObject(value) || value.schemaVersion !== PRESENTATION_NLE_SCHEMA_VERSION) {
    fail(
      'PRESENTATION_NLE_INVALID',
      `NLE edit requires ${PRESENTATION_NLE_SCHEMA_VERSION}`,
    );
  }
  let expected = projectPresentationAuthoringNle(project, schedule);
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
  let schedule = scheduleInput;
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
  if (!cell || !['cue', 'audio-clip'].includes(cell.kind)) {
    fail(
      'PRESENTATION_NLE_EDIT_INVALID',
      `NLE frame drag clipId "${clipId}" must name an editable cue or audio-clip cell`,
      { clipId },
    );
  }
  if (cell.kind === 'audio-clip') {
    let turnAnchors = nle.anchors.filter((anchor) => (
      anchor.turnId === cell.turnId
      && ['turn-start', 'turn-end'].includes(anchor.edge)
    ));
    let choice = editInput.anchorId === undefined
      ? turnAnchors.find((anchor) => anchor.edge === cell.timing.at.anchor)
      : turnAnchors.find((anchor) => anchor.id === editInput.anchorId);
    if (!choice) {
      return {
        status: 'rejected',
        code: 'PRESENTATION_NLE_ANCHOR_INVALID',
        clipId,
        frameMs: editInput.frameMs,
        anchorId: editInput.anchorId ?? null,
        basis,
      };
    }
    let offsetMs = choice.anchor.offsetMs + editInput.frameMs - choice.timeMs;
    return {
      status: 'command',
      command: {
        schemaVersion: PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
        id,
        base: { revision: project.revision, authoringProjectHash: project.hash },
        type: 'audio-clip.move',
        payload: {
          cellId: cell.id,
          timing: { at: { anchor: choice.anchor.anchor, offsetMs } },
        },
      },
      anchor: clone(choice),
      basis,
    };
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

function nleBasis(nle) {
  return {
    authoringProjectHash: nle.authoringProjectHash,
    timelineHash: nle.timelineHash,
    scheduleHash: nle.scheduleHash,
    nleHash: nle.hash,
  };
}

/**
 * Binds a visual timeline component to the same semantic NLE edit translator
 * used by agent MCP/CLI commands. Hosts apply the returned semantic command to
 * their Project authority and then rebind with the resulting revision.
 */
export function bindPresentationNleTimelineEditor(editor, {
  project,
  schedule,
  fps = 30,
  onEdit,
  createEditId = ({ clipId, frame }) => `${clipId}:timeline-drag:${frame}`,
} = {}) {
  if (typeof editor?.loadTimeline !== 'function') {
    throw new TypeError('presentation NLE binding requires a timeline editor');
  }
  if (typeof editor?.addEventListener !== 'function'
    || typeof editor?.removeEventListener !== 'function') {
    throw new TypeError('presentation NLE binding requires editor event listeners');
  }
  if (typeof onEdit !== 'function') {
    throw new TypeError('presentation NLE binding requires an onEdit callback');
  }
  let nle = null;
  let model = null;
  let editableClips = new Set();
  let disposed = false;
  let load = (nextProject, nextSchedule) => {
    project = nextProject;
    schedule = nextSchedule;
    nle = projectPresentationAuthoringNle(project, schedule);
    model = createPresentationTimelineEditorModel(project, schedule, { fps });
    editableClips = new Set(model.tracks.flatMap(({ clips }) => (
      clips.filter(({ editable }) => editable).map(({ id }) => id)
    )));
    editor.loadTimeline(model);
    return model;
  };
  let handleMove = (event) => {
    if (disposed) return;
    let detail = event?.detail || {};
    if (detail.phase !== 'commit') return;
    let clipId = String(detail.clipId || '').trim();
    if (!editableClips.has(clipId)) return;
    if (!Number.isFinite(Number(detail.start))) return;
    let frame = Math.max(0, Math.round(Number(detail.start) || 0));
    let eventFps = detail.fps == null
      ? model.fps
      : Math.max(1, Math.round(Number(detail.fps) || 0));
    if (eventFps !== model.fps) {
      throw new TypeError('presentation NLE edit FPS does not match the bound editor model');
    }
    let result = createPresentationAuthoringCommandFromNleEdit(project, schedule, nle, {
      id: String(createEditId({ clipId, frame, fps: eventFps, detail })),
      type: 'clip.frame-drag',
      clipId,
      frameMs: Math.round(frame * 1000 / eventFps),
      basis: nleBasis(nle),
    });
    onEdit(result, deepFreeze({
      authoringProjectHash: nle.authoringProjectHash,
      scheduleHash: nle.scheduleHash,
      nleHash: nle.hash,
      clipId,
      frame,
      fps: eventFps,
    }));
  };
  editor.addEventListener('clip-move', handleMove);
  load(project, schedule);
  return Object.freeze({
    get authoringProjectHash() { return nle.authoringProjectHash; },
    get scheduleHash() { return nle.scheduleHash; },
    get nleHash() { return nle.hash; },
    get model() { return model; },
    rebind({ project: nextProject, schedule: nextSchedule } = {}) {
      if (disposed) throw new TypeError('presentation NLE binding is disposed');
      return load(nextProject, nextSchedule);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      editor.removeEventListener('clip-move', handleMove);
    },
  });
}
