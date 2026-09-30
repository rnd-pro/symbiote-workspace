import { computeIntegrity, canonicalize } from '../../schema/canonical-json.js';
import { createPresentationTimelineContract } from './contract.js';
import { validatePresentationAlignedSequence } from './align.js';

export const PRESENTER_ACTION_SCHEDULE_VERSION = 'workspace-presenter-action-schedule-v1';

export class PresenterDuplicateActionError extends Error {
  constructor(message, diagnosticInfo) {
    super(message);
    this.name = 'PresenterDuplicateActionError';
    this.code = 'PRESENTER_DUPLICATE_ACTION';
    this.diagnosticInfo = diagnosticInfo;
  }
}

function canonicalStructure(value) {
  return JSON.parse(canonicalize(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertCanonicalShape(value, expected, path) {
  if (value === undefined || expected === undefined) {
    if (value !== expected) {
      throw new TypeError(`${path} mismatch against canonically reconstructed value`);
    }
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(value) || value.length !== expected.length) {
      throw new TypeError(`presenter action schedule structural mismatch at ${path}`);
    }
    let valueKeys = Object.keys(value).sort();
    let expectedKeys = Object.keys(expected).sort();
    if (canonicalize(valueKeys) !== canonicalize(expectedKeys)) {
      throw new TypeError(`presenter action schedule structural mismatch at ${path}`);
    }
    for (let index = 0; index < expected.length; index += 1) {
      assertCanonicalShape(value[index], expected[index], `${path}[${index}]`);
    }
    return;
  }

  if (isPlainObject(expected)) {
    if (!isPlainObject(value)) {
      throw new TypeError(`presenter action schedule structural mismatch at ${path}`);
    }
    let valueKeys = Object.keys(value).sort();
    let expectedKeys = Object.keys(expected).sort();
    if (canonicalize(valueKeys) !== canonicalize(expectedKeys)) {
      throw new TypeError(`presenter action schedule structural mismatch at ${path}`);
    }
    for (let key of expectedKeys) {
      assertCanonicalShape(value[key], expected[key], `${path}.${key}`);
    }
    return;
  }

  if (canonicalize(value) !== canonicalize(expected)) {
    throw new TypeError(`${path} mismatch against canonically reconstructed value`);
  }
}

function scheduleHashProjection(value) {
  let projection = {};
  for (let [key, child] of Object.entries(value)) {
    if (key !== 'hash') projection[key] = child;
  }
  return projection;
}

export function getSemanticKey(cue, turnId) {
  let turn = typeof turnId === 'string' ? turnId.trim() : '';
  if (!turn) throw new TypeError('semantic presenter action identity requires turnId');
  let kind = cue.kind || '';
  let target = cue.targetId || '';
  let tab = cue.tabId || '';
  let variant = '';
  let effect = null;

  if (kind === 'focus') {
    variant = cue.focus?.mode || 'cursor';
  } else if (kind === 'interaction') {
    variant = cue.interaction?.type || '';
    effect = canonicalStructure({
      binding: cue.interaction?.binding ?? null,
      parameters: cue.interaction?.parameters ?? null,
    });
  } else if (kind === 'annotation') {
    variant = cue.annotation?.intent || '';
    effect = canonicalStructure({
      marker: cue.annotation?.marker ?? null,
      symbol: cue.annotation?.symbol ?? null,
      placement: cue.annotation?.placement ?? null,
    });
  } else if (kind === 'state') {
    variant = cue.state?.condition || '';
    effect = canonicalStructure({
      path: cue.state?.path ?? null,
      value: cue.state?.value ?? null,
    });
  }

  return {
    version: 'v1',
    turn,
    kind,
    variant,
    tab,
    target,
    effect,
  };
}

export function stringifySemanticKey(semKey) {
  return `semkey:${canonicalize(semKey)}`;
}

export function getDuplicateKey(timelineId, semKey, startMs, endMs) {
  return {
    version: 'v1',
    timeline: timelineId,
    semanticKey: canonicalStructure(semKey),
    span: [startMs, endMs],
  };
}

export function stringifyDuplicateKey(dupKey) {
  return `dupkey:${canonicalize(dupKey)}`;
}

export function createPresenterActionSchedule(timelineInput, alignedSequenceInput, options = {}) {
  let timeline = createPresentationTimelineContract(timelineInput);
  let alignedSequence = validatePresentationAlignedSequence(alignedSequenceInput, timeline);

  let pointDurationMs = options.pointDurationMs !== undefined
    ? Number(options.pointDurationMs)
    : 1000;
  let gapMs = options.gapMs !== undefined
    ? Number(options.gapMs)
    : (options.boundedGapMs !== undefined ? Number(options.boundedGapMs) : 150);

  if (!Number.isInteger(pointDurationMs) || pointDurationMs <= 0) {
    throw new TypeError('pointDurationMs must be a positive integer');
  }
  if (!Number.isInteger(gapMs) || gapMs <= 0) {
    throw new TypeError('gapMs must be a positive integer');
  }

  let gestureEvents = alignedSequence.events.filter((event) => (
    ['focus', 'interaction', 'annotation'].includes(event.kind)
  ));

  let processed = [];
  for (let event of gestureEvents) {
    let [turnIdxStr, cueIdxStr] = event.cueId.split('.');
    let turnIndex = Number.parseInt(turnIdxStr, 10);
    let cueIndex = Number.parseInt(cueIdxStr, 10);
    let turn = timeline.turns[turnIndex];
    let cue = turn?.cues?.[cueIndex];
    if (!cue) {
      throw new TypeError(`aligned event ${event.cueId} has no authored presentation cue`);
    }

    let semKey = getSemanticKey(cue, turn.id);
    let semKeyStr = stringifySemanticKey(semKey);
    let startMs = event.startMs;
    let authDuration = event.endMs - event.startMs;
    let effectiveDuration = Math.max(authDuration, pointDurationMs);
    let endMs = startMs + effectiveDuration;

    for (let prev of processed) {
      if (prev.semanticKeyStr === semKeyStr) {
        let overlap = Math.max(startMs, prev.startMs) < Math.min(endMs, prev.endMs);
        if (overlap) {
          let equalSpans = (startMs === prev.startMs && endMs === prev.endMs);
          let dupKey1 = getDuplicateKey(timeline.id, semKey, prev.startMs, prev.endMs);
          let dupKey2 = getDuplicateKey(timeline.id, semKey, startMs, endMs);
          if (equalSpans) {
            throw new PresenterDuplicateActionError(
              `Exact authored duplicates with different cue IDs: "${prev.event.cueId}" vs "${event.cueId}"`,
              {
                duplicateKey1: dupKey1,
                duplicateKey2: dupKey2,
              },
            );
          } else {
            let spans = `[${prev.startMs}, ${prev.endMs}) vs [${startMs}, ${endMs})`;
            throw new PresenterDuplicateActionError(
              `Same-semantic unequal overlapping authored effective spans: ${spans}`,
              {
                duplicateKey1: dupKey1,
                duplicateKey2: dupKey2,
              },
            );
          }
        }
      }
    }

    processed.push({
      event,
      cue,
      semanticKey: semKey,
      semanticKeyStr: semKeyStr,
      span: [startMs, endMs],
      duration: effectiveDuration,
      startMs,
      endMs,
    });
  }

  let currentEndMs = 0;
  let scheduledEvents = [];

  for (let item of processed) {
    let { event, cue, semanticKey, span, duration } = item;
    let originalStart = event.startMs;

    let startMs = Math.max(originalStart, currentEndMs);
    let endMs = startMs + duration;

    let duplicateKey = getDuplicateKey(timeline.id, semanticKey, startMs, endMs);

    scheduledEvents.push({
      cueId: event.cueId,
      turnIndex: event.turnIndex,
      kind: event.kind,
      targetId: cue.targetId,
      semanticKey,
      span,
      duplicateKey,
      startMs,
      endMs,
    });

    currentEndMs = endMs + gapMs;
  }

  let maxScheduledEndMs = 0;
  if (scheduledEvents.length > 0) {
    maxScheduledEndMs = Math.max(...scheduledEvents.map((event) => event.endMs));
  }
  let totalDurationMs = Math.max(alignedSequence.media.durationMs, maxScheduledEndMs);
  let extensionMs = totalDurationMs - alignedSequence.media.durationMs;

  let schedule = {
    contractVersion: PRESENTER_ACTION_SCHEDULE_VERSION,
    timelineHash: timeline.hash,
    alignedSequenceHash: alignedSequence.hash,
    pointDurationMs,
    gapMs,
    events: scheduledEvents,
    totalDurationMs,
    extensionMs,
  };

  schedule.hash = `${PRESENTER_ACTION_SCHEDULE_VERSION}:${computeIntegrity(schedule)}`;
  return schedule;
}

export function validatePresenterActionSchedule(
  value = {},
  timelineInput = {},
  alignedSequenceInput = {},
) {
  let timeline = createPresentationTimelineContract(timelineInput);
  let alignedSequence = validatePresentationAlignedSequence(alignedSequenceInput, timeline);

  if (!isPlainObject(value)) {
    throw new TypeError('presenter action schedule must be an object');
  }

  if (value.contractVersion !== PRESENTER_ACTION_SCHEDULE_VERSION) {
    throw new TypeError(`unsupported presenter action schedule version: ${value.contractVersion}`);
  }

  if (value.timelineHash !== timeline.hash) {
    throw new TypeError('presenter action schedule timelineHash does not match authored timeline');
  }

  if (value.alignedSequenceHash !== alignedSequence.hash) {
    throw new TypeError('presenter action schedule alignedSequenceHash does not match aligned sequence');
  }

  if (!Array.isArray(value.events)) {
    throw new TypeError('presenter action schedule events must be an array');
  }

  if (value.pointDurationMs === undefined) {
    throw new TypeError('presenter action schedule pointDurationMs is required');
  }
  if (!Number.isInteger(value.pointDurationMs) || value.pointDurationMs <= 0) {
    throw new TypeError('presenter action schedule pointDurationMs must be a positive integer');
  }
  if (value.gapMs === undefined) {
    throw new TypeError('presenter action schedule gapMs is required');
  }
  if (!Number.isInteger(value.gapMs) || value.gapMs <= 0) {
    throw new TypeError('presenter action schedule gapMs must be a positive integer');
  }

  if (value.totalDurationMs === undefined) {
    throw new TypeError('presenter action schedule totalDurationMs is required');
  }
  if (!Number.isInteger(value.totalDurationMs) || value.totalDurationMs < 0) {
    throw new TypeError('presenter action schedule totalDurationMs must be a non-negative integer');
  }

  if (value.extensionMs === undefined) {
    throw new TypeError('presenter action schedule extensionMs is required');
  }
  if (!Number.isInteger(value.extensionMs) || value.extensionMs < 0) {
    throw new TypeError('presenter action schedule extensionMs must be a non-negative integer');
  }

  let lastEndMs = 0;
  for (let i = 0; i < value.events.length; i++) {
    let ev = value.events[i];
    if (!isPlainObject(ev)) {
      throw new TypeError(`event at index ${i} must be an object`);
    }
    if (typeof ev.cueId !== 'string' || !ev.cueId) {
      throw new TypeError(`event at index ${i} has invalid cueId`);
    }
    if (!Number.isInteger(ev.turnIndex) || ev.turnIndex < 0) {
      throw new TypeError(`event at index ${i} turnIndex must be a non-negative integer`);
    }
    if (typeof ev.kind !== 'string' || !ev.kind) {
      throw new TypeError(`event at index ${i} kind must be a string`);
    }
    if (typeof ev.targetId !== 'string' || !ev.targetId) {
      throw new TypeError(`event at index ${i} targetId must be a string`);
    }
    if (!Number.isInteger(ev.startMs) || ev.startMs < 0) {
      throw new TypeError(`event at index ${i} startMs must be a non-negative integer`);
    }
    if (!Number.isInteger(ev.endMs) || ev.endMs <= ev.startMs) {
      throw new TypeError(`event at index ${i} endMs must be an integer greater than startMs`);
    }
    if (
      !Array.isArray(ev.span)
      || ev.span.length !== 2
      || !Number.isInteger(ev.span[0])
      || !Number.isInteger(ev.span[1])
      || ev.span[1] <= ev.span[0]
    ) {
      throw new TypeError(`event at index ${i} span must be a valid interval [start, end)`);
    }
    if (!isPlainObject(ev.semanticKey)) {
      throw new TypeError(`event at index ${i} must have a semanticKey object`);
    }
    if (!isPlainObject(ev.duplicateKey)) {
      throw new TypeError(`event at index ${i} must have a duplicateKey object`);
    }

    if (ev.startMs < lastEndMs) {
      throw new TypeError(
        `event at index ${i} violates ordering/gap constraints: `
        + `starts at ${ev.startMs} before previous ends plus gap at ${lastEndMs}`,
      );
    }

    if (ev.startMs < ev.span[0]) {
      throw new TypeError(
        `event at index ${i} startMs ${ev.startMs} violates causality: `
        + `starts before original speech-aligned startMs ${ev.span[0]}`,
      );
    }

    lastEndMs = ev.endMs + value.gapMs;
  }

  let expected = createPresenterActionSchedule(timeline, alignedSequence, {
    pointDurationMs: value.pointDurationMs,
    gapMs: value.gapMs,
  });

  let valueWithoutHash = scheduleHashProjection(value);
  let expectedWithoutHash = scheduleHashProjection(expected);
  assertCanonicalShape(valueWithoutHash, expectedWithoutHash, 'schedule');
  if (canonicalize(valueWithoutHash) !== canonicalize(expectedWithoutHash)) {
    throw new TypeError(
      'presenter action schedule structural mismatch against canonically reconstructed value',
    );
  }

  let expectedHash = `${PRESENTER_ACTION_SCHEDULE_VERSION}:${computeIntegrity(valueWithoutHash)}`;
  if (value.hash !== expectedHash) {
    throw new TypeError('presenter action schedule hash is stale');
  }

  return value;
}
