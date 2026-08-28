import { canonicalize, computeIntegrity } from '../../schema/canonical-json.js';
import { validatePresentationAlignedSequence } from './align.js';
import {
  createPresentationAuthoringTimelineProjection,
  validatePresentationAuthoringProject,
} from './project.js';

export const PRESENTATION_SCHEDULE_V2_VERSION = 'workspace-presenter-action-schedule-v2';

export class PresentationScheduleV2Error extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PresentationScheduleV2Error';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new PresentationScheduleV2Error(code, message, details);
}

function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  return JSON.parse(canonicalize(value));
}

function compareCells(left, right) {
  return (
    left.layerOrder - right.layerOrder
    || left.cellOrder - right.cellOrder
    || left.cellId.localeCompare(right.cellId)
  );
}

function cellStart(cell) {
  return cell.startMs;
}

function availableBarriers(record) {
  let barriers = [];
  if (record.kind === 'narration' || record.visibility) barriers.push('ended');
  if (record.gestureDurationMs > 0) barriers.push('settled');
  if (record.kind === 'interaction') barriers.push('acted');
  if (record.kind === 'state') barriers.push('ready');
  return barriers;
}

function plannedBarrierTimes(record, startMs) {
  if (record.kind === 'narration') return { ended: record.narration.endMs };
  let gestureEndMs = startMs + record.gestureDurationMs;
  let barriers = {};
  if (record.visibility) barriers.ended = record.visibility.endMs;
  if (record.gestureDurationMs > 0) barriers.settled = gestureEndMs;
  if (record.kind === 'interaction') barriers.acted = gestureEndMs;
  if (record.kind === 'state') barriers.ready = startMs;
  return barriers;
}

function topoOrder(records, recordById) {
  let incoming = new Map(records.map((record) => [record.cellId, 0]));
  let outgoing = new Map(records.map((record) => [record.cellId, []]));
  for (let record of records) {
    for (let dependency of record.dependsOn) {
      let source = recordById.get(dependency.cellId);
      if (!source) {
        fail(
          'PRESENTATION_SCHEDULE_UNKNOWN_DEPENDENCY',
          `cell "${record.cellId}" depends on unknown cell "${dependency.cellId}"`,
          { cellId: record.cellId, dependency },
        );
      }
      let barriers = availableBarriers(source);
      if (!barriers.includes(dependency.barrier)) {
        fail(
          'PRESENTATION_SCHEDULE_BARRIER_UNAVAILABLE',
          `cell "${dependency.cellId}" does not expose barrier "${dependency.barrier}"`,
          {
            cellId: record.cellId,
            dependency,
            availableBarriers: barriers,
          },
        );
      }
      incoming.set(record.cellId, incoming.get(record.cellId) + 1);
      outgoing.get(source.cellId).push(record.cellId);
    }
  }
  let ready = records.filter((record) => incoming.get(record.cellId) === 0).sort(compareCells);
  let ordered = [];
  while (ready.length) {
    let current = ready.shift();
    ordered.push(current);
    for (let dependentId of outgoing.get(current.cellId)) {
      let nextCount = incoming.get(dependentId) - 1;
      incoming.set(dependentId, nextCount);
      if (nextCount === 0) {
        ready.push(recordById.get(dependentId));
        ready.sort(compareCells);
      }
    }
  }
  if (ordered.length !== records.length) {
    let cellIds = records
      .filter((record) => incoming.get(record.cellId) > 0)
      .map((record) => record.cellId)
      .sort();
    fail(
      'PRESENTATION_SCHEDULE_DEPENDENCY_CYCLE',
      `presentation cell dependencies contain a cycle: ${cellIds.join(', ')}`,
      { cellIds },
    );
  }
  return ordered;
}

function createBaseRecords(project, alignment, presentationStartMs) {
  let layerOrder = new Map(project.layers.map((layer, index) => [layer.id, index]));
  let layerById = new Map(project.layers.map((layer) => [layer.id, layer]));
  let narrationCells = project.cells.filter((cell) => cell.kind === 'narration');
  let turnIndexById = new Map(narrationCells.map((cell, index) => [cell.turnId, index]));
  let eventByCueId = new Map(alignment.events.map((event) => [event.cueId, event]));
  let cueIndexes = new Map();
  return project.cells.map((cell, cellOrder) => {
    let layer = layerById.get(cell.layerId);
    let turnIndex = turnIndexById.get(cell.turnId);
    if (cell.kind === 'narration') {
      let turn = alignment.turns[turnIndex];
      let narration = {
        startMs: turn.startMs + presentationStartMs,
        endMs: turn.endMs + presentationStartMs,
      };
      return {
        cellId: cell.id,
        layerId: cell.layerId,
        turnId: cell.turnId,
        kind: 'narration',
        layerOrder: layerOrder.get(cell.layerId),
        cellOrder,
        targetId: null,
        visualOwnerId: null,
        collisionDomainId: null,
        anchorMs: narration.startMs,
        authoredStartMs: narration.startMs,
        gestureDurationMs: 0,
        narration,
        visibility: null,
        dependsOn: cell.dependsOn,
        settleBy: 'none',
      };
    }
    let cueIndex = cueIndexes.get(cell.turnId) || 0;
    cueIndexes.set(cell.turnId, cueIndex + 1);
    let cueId = `${turnIndex}.${cueIndex}`;
    let event = eventByCueId.get(cueId);
    if (!event) {
      fail(
        'PRESENTATION_SCHEDULE_ALIGNMENT_MISSING',
        `aligned sequence has no event for cue cell "${cell.id}"`,
        { cellId: cell.id, cueId },
      );
    }
    let anchorMs = event.startMs + presentationStartMs;
    let visibility = cell.timing.until === null
      ? null
      : {
          startMs: event.startMs - cell.timing.leadMs + presentationStartMs,
          endMs: event.endMs + presentationStartMs,
        };
    return {
      cellId: cell.id,
      layerId: cell.layerId,
      turnId: cell.turnId,
      cueId,
      kind: cell.cue.kind,
      layerOrder: layerOrder.get(cell.layerId),
      cellOrder,
      targetId: cell.cue.targetId ?? null,
      visualOwnerId: layer.visualOwnerId,
      collisionDomainId: layer.collisionDomainId,
      anchorMs,
      authoredStartMs: event.startMs - cell.timing.leadMs + presentationStartMs,
      gestureDurationMs: cell.timing.gestureDurationMs,
      narration: null,
      visibility,
      dependsOn: cell.dependsOn,
      settleBy: cell.timing.settleBy,
    };
  });
}

function scheduleRecords(records) {
  let recordById = new Map(records.map((record) => [record.cellId, record]));
  let ordered = topoOrder(records, recordById);
  let scheduledById = new Map();
  for (let record of ordered) {
    let plannedDependencyReadyMs = record.dependsOn.reduce((latest, dependency) => {
      let source = scheduledById.get(dependency.cellId);
      return Math.max(latest, source.plannedBarriers[dependency.barrier]);
    }, 0);
    let startMs = Math.max(record.authoredStartMs, plannedDependencyReadyMs);
    if (record.kind === 'narration' && startMs !== record.authoredStartMs) {
      fail(
        'PRESENTATION_SCHEDULE_HARD_DEADLINE',
        `narration cell "${record.cellId}" cannot move behind a dependency`,
        {
          cellId: record.cellId,
          authoredStartMs: record.authoredStartMs,
          plannedDependencyReadyMs,
          settleBy: 'narration',
        },
      );
    }
    let gesture = record.gestureDurationMs > 0
      ? { startMs, endMs: startMs + record.gestureDurationMs }
      : null;
    let visibility = record.visibility
      ? { ...record.visibility, startMs }
      : null;
    let plannedEndMs = gesture?.endMs ?? startMs;
    if (record.settleBy === 'anchor' && plannedEndMs > record.anchorMs) {
      fail(
        'PRESENTATION_SCHEDULE_HARD_DEADLINE',
        `cell "${record.cellId}" cannot settle by its semantic anchor`,
        {
          cellId: record.cellId,
          settleBy: 'anchor',
          anchorMs: record.anchorMs,
          authoredStartMs: record.authoredStartMs,
          plannedDependencyReadyMs,
          plannedEndMs,
        },
      );
    }
    if (visibility && plannedEndMs > visibility.endMs) {
      fail(
        'PRESENTATION_SCHEDULE_HARD_DEADLINE',
        `cell "${record.cellId}" gesture exceeds its authored visibility end`,
        {
          cellId: record.cellId,
          settleBy: 'visibility',
          visibilityEndMs: visibility.endMs,
          authoredStartMs: record.authoredStartMs,
          plannedDependencyReadyMs,
          plannedEndMs,
        },
      );
    }
    let plannedBarriers = plannedBarrierTimes(record, startMs);
    let scheduled = {
      cellId: record.cellId,
      layerId: record.layerId,
      turnId: record.turnId,
      ...(record.cueId ? { cueId: record.cueId } : {}),
      kind: record.kind,
      layerOrder: record.layerOrder,
      cellOrder: record.cellOrder,
      targetId: record.targetId,
      visualOwnerId: record.visualOwnerId,
      collisionDomainId: record.collisionDomainId,
      anchorMs: record.anchorMs,
      authoredStartMs: record.authoredStartMs,
      plannedDependencyReadyMs,
      startMs,
      narration: record.narration,
      gesture,
      visibility,
      dependsOn: record.dependsOn,
      plannedBarriers,
    };
    scheduledById.set(record.cellId, scheduled);
  }
  return [...scheduledById.values()];
}

function assertExclusiveCollisions(cells, project) {
  let exclusiveDomains = new Set(
    project.policy.collisionDomains
      .filter((domain) => domain.exclusive)
      .map((domain) => domain.id),
  );
  for (let domainId of exclusiveDomains) {
    let gestures = cells
      .filter((cell) => cell.collisionDomainId === domainId && cell.gesture)
      .sort((left, right) => (
        left.gesture.startMs - right.gesture.startMs
        || compareCells(left, right)
      ));
    for (let index = 1; index < gestures.length; index += 1) {
      let prior = gestures[index - 1];
      let current = gestures[index];
      if (current.gesture.startMs < prior.gesture.endMs) {
        fail(
          'PRESENTATION_SCHEDULE_EXCLUSIVE_COLLISION',
          `exclusive presenter gestures overlap for cells "${prior.cellId}" and "${current.cellId}"`,
          {
            collisionDomainId: domainId,
            cellIds: [prior.cellId, current.cellId],
            spans: [prior.gesture, current.gesture],
          },
        );
      }
    }
  }
}

function scheduleHashProjection(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'hash'));
}

/**
 * @param {object} projectInput
 * @param {object} alignedSequenceInput
 * @param {object} [options]
 * @returns {object}
 */
export function createPresentationScheduleV2(
  projectInput = {},
  alignedSequenceInput = {},
  options = {},
) {
  if (!isObject(options) || Object.keys(options).length) {
    fail(
      'PRESENTATION_SCHEDULE_INVALID',
      'schedule v2 does not accept runtime receipts or scheduling overrides',
      { path: 'options' },
    );
  }
  let project = validatePresentationAuthoringProject(projectInput);
  let timeline = createPresentationAuthoringTimelineProjection(project);
  let alignment;
  try {
    alignment = validatePresentationAlignedSequence(alignedSequenceInput, timeline);
  } catch (error) {
    fail(
      'PRESENTATION_SCHEDULE_ALIGNMENT_INVALID',
      `schedule v2 requires the exact aligned sequence: ${error.message}`,
      { cause: error.message },
    );
  }
  let cueCells = project.cells.filter((cell) => cell.kind === 'cue');
  let eventByCueId = new Map(alignment.events.map((event) => [event.cueId, event]));
  let narrationCells = project.cells.filter((cell) => cell.kind === 'narration');
  let turnIndexById = new Map(narrationCells.map((cell, index) => [cell.turnId, index]));
  let cueIndexes = new Map();
  let earliestSourceStartMs = 0;
  for (let cell of cueCells) {
    let turnIndex = turnIndexById.get(cell.turnId);
    let cueIndex = cueIndexes.get(cell.turnId) || 0;
    cueIndexes.set(cell.turnId, cueIndex + 1);
    let event = eventByCueId.get(`${turnIndex}.${cueIndex}`);
    earliestSourceStartMs = Math.min(
      earliestSourceStartMs,
      event.startMs - cell.timing.leadMs,
    );
  }
  let presentationStartMs = Math.max(0, -earliestSourceStartMs);
  let records = createBaseRecords(project, alignment, presentationStartMs);
  let cells = scheduleRecords(records);
  assertExclusiveCollisions(cells, project);
  let topologicalOrder = new Map(cells.map((cell, index) => [cell.cellId, index]));
  cells.sort((left, right) => (
    cellStart(left) - cellStart(right)
    || topologicalOrder.get(left.cellId) - topologicalOrder.get(right.cellId)
  ));
  let audio = {
    startMs: presentationStartMs,
    endMs: presentationStartMs + alignment.media.durationMs,
    durationMs: alignment.media.durationMs,
  };
  let totalDurationMs = Math.max(
    audio.endMs,
    ...cells.map((cell) => Math.max(
      cell.narration?.endMs ?? 0,
      cell.gesture?.endMs ?? 0,
      cell.visibility?.endMs ?? 0,
      cell.startMs,
    )),
  );
  let schedule = {
    contractVersion: PRESENTATION_SCHEDULE_V2_VERSION,
    authoringProjectHash: project.hash,
    timelineHash: timeline.hash,
    alignedSequenceHash: alignment.hash,
    visualOwnerId: project.policy.visualOwnerId,
    collisionDomains: clone(project.policy.collisionDomains),
    presentationStartMs,
    audio,
    cells,
    totalDurationMs,
  };
  return {
    ...schedule,
    hash: `${PRESENTATION_SCHEDULE_V2_VERSION}:${computeIntegrity(schedule)}`,
  };
}

/**
 * @param {object} value
 * @param {object} projectInput
 * @param {object} alignedSequenceInput
 * @returns {object}
 */
export function validatePresentationScheduleV2(
  value = {},
  projectInput = {},
  alignedSequenceInput = {},
) {
  if (!isObject(value)) {
    fail('PRESENTATION_SCHEDULE_INVALID', 'schedule v2 must be an object');
  }
  if (value.contractVersion !== PRESENTATION_SCHEDULE_V2_VERSION) {
    fail(
      'PRESENTATION_SCHEDULE_INVALID',
      `unsupported presentation schedule version: ${value.contractVersion}`,
      { contractVersion: value.contractVersion },
    );
  }
  let expected = createPresentationScheduleV2(projectInput, alignedSequenceInput);
  if (canonicalize(scheduleHashProjection(value)) !== canonicalize(scheduleHashProjection(expected))) {
    fail(
      'PRESENTATION_SCHEDULE_STALE',
      'presentation schedule does not match its deterministic authoring project projection',
      { authoringProjectHash: expected.authoringProjectHash },
    );
  }
  if (value.hash !== expected.hash) {
    fail(
      'PRESENTATION_SCHEDULE_STALE',
      'presentation schedule hash is stale',
      { expectedHash: expected.hash, receivedHash: value.hash },
    );
  }
  return value;
}
