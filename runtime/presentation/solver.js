import { computeIntegrity } from '../../schema/canonical-json.js';
import { normalizePresentationTimeline, PRESENTATION_CONTRACT_VERSION } from './contract.js';

function clockSolverError(code, message) {
  let error = new Error(message);
  error.code = code;
  return error;
}

function nonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) {
    throw clockSolverError('CLOCK_SOLVER_MALFORMED', `${path} must be a non-negative integer`);
  }
  return value;
}

function text(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function tokenList(value) {
  return text(value).toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function tokenSimilarity(left, right) {
  if (!left.length || !right.length) return 0;
  let same = left.reduce((count, token, index) => count + (token === right[index] ? 1 : 0), 0);
  return same / Math.max(left.length, right.length);
}

function quoteOffsets(haystack, needle) {
  let offsets = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    let offset = haystack.indexOf(needle, cursor);
    if (offset < 0) break;
    offsets.push(offset);
    cursor = offset + Math.max(1, needle.length);
  }
  return offsets;
}

function resolveSpeechAnchorOffset(anchor, turnText, turnWords, turnMinDuration) {
  let quoteTokens = tokenList(anchor.quote);
  let transcriptTokens = turnWords.flatMap((word, wordIndex) => tokenList(word.text).map((token) => ({ token, wordIndex })));
  let matches = [];
  for (let index = 0; index <= transcriptTokens.length - quoteTokens.length; index += 1) {
    let candidate = transcriptTokens.slice(index, index + quoteTokens.length).map((item) => item.token);
    if (candidate.every((token, tokenIndex) => token === quoteTokens[tokenIndex])) matches.push(index);
  }
  let matchIndex = matches[anchor.occurrence - 1];
  if (matchIndex !== undefined) {
    let token = anchor.edge === 'end'
      ? transcriptTokens[matchIndex + quoteTokens.length - 1]
      : transcriptTokens[matchIndex];
    let word = turnWords[token.wordIndex];
    return (anchor.edge === 'end' ? word.endMs : word.startMs) + anchor.offsetMs;
  }

  let best = null;
  for (let index = 0; index <= transcriptTokens.length - quoteTokens.length; index += 1) {
    let candidate = transcriptTokens.slice(index, index + quoteTokens.length).map((item) => item.token);
    let score = tokenSimilarity(quoteTokens, candidate);
    if (!best || score > best.score) best = { index, score };
  }
  if (best?.score >= 0.6 && turnWords.length) {
    let token = anchor.edge === 'end'
      ? transcriptTokens[best.index + quoteTokens.length - 1]
      : transcriptTokens[best.index];
    let word = turnWords[token.wordIndex];
    return (anchor.edge === 'end' ? word.endMs : word.startMs) + anchor.offsetMs;
  }

  let normalizedAuthored = text(turnText);
  let offsets = quoteOffsets(normalizedAuthored, text(anchor.quote));
  let sourceOffset = offsets[anchor.occurrence - 1] ?? 0;
  if (anchor.edge === 'end') sourceOffset += text(anchor.quote).length;
  let progress = normalizedAuthored.length ? sourceOffset / normalizedAuthored.length : 0;
  return Math.round(turnMinDuration * progress) + anchor.offsetMs;
}

export function solvePresentationClock(timeline, options) {
  let normalizedTimeline;
  try {
    normalizedTimeline = normalizePresentationTimeline(timeline);
  } catch (err) {
    throw clockSolverError('CLOCK_SOLVER_MALFORMED', `Timeline normalization failed: ${err.message}`);
  }

  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw clockSolverError('CLOCK_SOLVER_MALFORMED', 'options must be an object');
  }

  if (!Array.isArray(options.turns)) {
    throw clockSolverError('CLOCK_SOLVER_MALFORMED', 'options.turns must be an array');
  }

  let computedTimelineHash = `${PRESENTATION_CONTRACT_VERSION}:${computeIntegrity(normalizedTimeline)}`;
  if (timeline?.hash !== undefined && timeline.hash !== computedTimelineHash) {
    throw clockSolverError('CLOCK_SOLVER_TIMELINE_HASH_MISMATCH', 'timeline.hash does not match the normalized timeline');
  }

  if (options.turns.length !== normalizedTimeline.turns.length) {
    throw clockSolverError('CLOCK_SOLVER_MALFORMED', `options.turns length (${options.turns.length}) must match timeline.turns length (${normalizedTimeline.turns.length})`);
  }

  let validatedTurns = options.turns.map((turn, index) => {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
      throw clockSolverError('CLOCK_SOLVER_MALFORMED', `options.turns[${index}] must be an object`);
    }
    let durationMs = nonNegativeInteger(turn.durationMs, `options.turns[${index}].durationMs`);
    let words = Array.isArray(turn.words) ? turn.words : [];
    let priorEndMs = 0;
    let validatedWords = words.map((w, wIndex) => {
      if (!w || typeof w !== 'object' || Array.isArray(w)) {
        throw clockSolverError('CLOCK_SOLVER_MALFORMED', `options.turns[${index}].words[${wIndex}] must be an object`);
      }
      let startMs = nonNegativeInteger(w.startMs, `options.turns[${index}].words[${wIndex}].startMs`);
      let endMs = nonNegativeInteger(w.endMs, `options.turns[${index}].words[${wIndex}].endMs`);
      if (endMs < startMs || startMs < priorEndMs || endMs > durationMs) {
        throw clockSolverError('CLOCK_SOLVER_MALFORMED', `options.turns[${index}].words must be ordered inside the turn duration`);
      }
      priorEndMs = endMs;
      return {
        text: String(w.text || ''),
        startMs,
        endMs,
      };
    });
    return {
      durationMs,
      words: validatedWords,
    };
  });

  let sourceEventsInput = Array.isArray(options.sourceEvents) ? options.sourceEvents : [];
  let sourceEventIds = new Set();
  let validatedSourceEvents = sourceEventsInput.map((e, index) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      throw clockSolverError('CLOCK_SOLVER_MALFORMED', `options.sourceEvents[${index}] must be an object`);
    }
    if (typeof e.id !== 'string' || !e.id.trim()) {
      throw clockSolverError('CLOCK_SOLVER_MALFORMED', `options.sourceEvents[${index}].id must be a non-empty string`);
    }
    let id = e.id.trim();
    if (sourceEventIds.has(id)) {
      throw clockSolverError('CLOCK_SOLVER_MALFORMED', `options.sourceEvents[${index}].id must be unique`);
    }
    sourceEventIds.add(id);
    return {
      id,
      offsetMs: nonNegativeInteger(e.offsetMs, `options.sourceEvents[${index}].offsetMs`),
      minDwellMs: e.minDwellMs === undefined
        ? undefined
        : nonNegativeInteger(e.minDwellMs, `options.sourceEvents[${index}].minDwellMs`),
    };
  });

  let latestSourceOffsetMs = validatedSourceEvents.length
    ? Math.max(...validatedSourceEvents.map((event) => event.offsetMs))
    : 0;
  let sourceDurationMs = options.sourceDurationMs === undefined
    ? latestSourceOffsetMs
    : nonNegativeInteger(options.sourceDurationMs, 'options.sourceDurationMs');
  if (sourceDurationMs < latestSourceOffsetMs) {
    throw clockSolverError('CLOCK_SOLVER_MALFORMED', 'options.sourceDurationMs must cover every source event');
  }

  let constraintsInput = Array.isArray(options.constraints) ? options.constraints : [];
  let validatedConstraints = constraintsInput.map((c, index) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      throw clockSolverError('CLOCK_SOLVER_MALFORMED', `options.constraints[${index}] must be an object`);
    }
    if (!['not-before', 'coincident', 'min-gap'].includes(c.type)) {
      throw clockSolverError('CLOCK_SOLVER_MALFORMED', `options.constraints[${index}].type must be 'not-before', 'coincident', or 'min-gap'`);
    }
    if (typeof c.eventId !== 'string' || !c.eventId.trim()) {
      throw clockSolverError('CLOCK_SOLVER_MALFORMED', `options.constraints[${index}].eventId must be a non-empty string`);
    }
    if (typeof c.referenceId !== 'string' || !c.referenceId.trim()) {
      throw clockSolverError('CLOCK_SOLVER_MALFORMED', `options.constraints[${index}].referenceId must be a non-empty string`);
    }
    if (c.gapMs !== undefined && (typeof c.gapMs !== 'number' || !Number.isInteger(c.gapMs))) {
      throw clockSolverError('CLOCK_SOLVER_MALFORMED', `options.constraints[${index}].gapMs must be an integer`);
    }
    return {
      type: c.type,
      eventId: c.eventId,
      referenceId: c.referenceId,
      gapMs: c.gapMs || 0,
    };
  });

  let elasticPolicy = options.elasticPolicy || {};
  if (!elasticPolicy || typeof elasticPolicy !== 'object' || Array.isArray(elasticPolicy)) {
    throw clockSolverError('CLOCK_SOLVER_MALFORMED', 'options.elasticPolicy must be an object');
  }
  let defaultMinDwellMs = elasticPolicy.defaultMinDwellMs === undefined
    ? 0
    : nonNegativeInteger(elasticPolicy.defaultMinDwellMs, 'options.elasticPolicy.defaultMinDwellMs');
  let defaultTurnGapMs = elasticPolicy.defaultTurnGapMs === undefined
    ? 0
    : nonNegativeInteger(elasticPolicy.defaultTurnGapMs, 'options.elasticPolicy.defaultTurnGapMs');

  let N = normalizedTimeline.turns.length;
  let M = validatedSourceEvents.length;

  let nodeIndexMap = new Map();
  nodeIndexMap.set('START', 0);
  for (let i = 0; i < N; i++) {
    nodeIndexMap.set('turn_start_' + i, 1 + i);
    nodeIndexMap.set('turn_end_' + i, 1 + N + i);
  }
  for (let k = 0; k < M; k++) {
    nodeIndexMap.set('event_' + k, 1 + 2 * N + k);
  }
  let endNodeIndex = 1 + 2 * N + M;
  nodeIndexMap.set('END', endNodeIndex);
  let numNodes = endNodeIndex + 1;

  function resolveCueAnchor(turnIndex, anchor) {
    if (anchor.anchor === 'turn-start') {
      return { node: 'turn_start_' + turnIndex, offset: anchor.offsetMs || 0 };
    }
    if (anchor.anchor === 'turn-end') {
      return { node: 'turn_end_' + turnIndex, offset: anchor.offsetMs || 0 };
    }
    if (anchor.anchor === 'speech') {
      let turn = normalizedTimeline.turns[turnIndex];
      let measuredTurn = validatedTurns[turnIndex];
      return {
        node: 'turn_start_' + turnIndex,
        offset: resolveSpeechAnchorOffset(anchor, turn.text, measuredTurn.words, measuredTurn.durationMs),
      };
    }
    throw clockSolverError('CLOCK_SOLVER_MALFORMED', `Unsupported cue anchor: ${anchor.anchor}`);
  }

  function resolveReference(refId) {
    let eventIndex = validatedSourceEvents.findIndex(e => e.id === refId);
    if (eventIndex !== -1) {
      return { node: 'event_' + eventIndex, offset: 0 };
    }

    let turnIndex = normalizedTimeline.turns.findIndex(t => t.id === refId);
    if (turnIndex !== -1) {
      return { node: 'turn_start_' + turnIndex, offset: 0 };
    }

    if (refId.endsWith(':end') || refId.endsWith('-end')) {
      let baseId = refId.slice(0, -4);
      let tIdx = normalizedTimeline.turns.findIndex(t => t.id === baseId);
      if (tIdx !== -1) {
        return { node: 'turn_end_' + tIdx, offset: 0 };
      }
    }

    if (/^\d+\.\d+$/.test(refId)) {
      let [tIdxStr, cIdxStr] = refId.split('.');
      let tIdx = parseInt(tIdxStr, 10);
      let cIdx = parseInt(cIdxStr, 10);
      let turn = normalizedTimeline.turns[tIdx];
      if (turn && turn.cues && turn.cues[cIdx]) {
        return resolveCueAnchor(tIdx, turn.cues[cIdx].at);
      }
    }

    throw clockSolverError('CLOCK_SOLVER_INVALID_REFERENCE', `Could not resolve reference ID: ${refId}`);
  }

  let edges = [];
  function addEdge(fromName, toName, weight) {
    let fromIdx = nodeIndexMap.get(fromName);
    let toIdx = nodeIndexMap.get(toName);
    if (fromIdx === undefined || toIdx === undefined) {
      throw clockSolverError('CLOCK_SOLVER_MALFORMED', `Invalid node in graph: ${fromName} -> ${toName}`);
    }
    edges.push({ from: fromIdx, to: toIdx, weight });
  }

  addEdge('START', 'END', sourceDurationMs);

  for (let i = 0; i < N; i++) {
    addEdge('START', 'turn_start_' + i, 0);
    addEdge('turn_start_' + i, 'turn_end_' + i, validatedTurns[i].durationMs);
  }

  for (let i = 1; i < N; i++) {
    let turn = normalizedTimeline.turns[i];
    if (turn.transition?.pauseBeforeMs !== undefined) {
      addEdge('turn_end_' + (i - 1), 'turn_start_' + i, turn.transition.pauseBeforeMs);
    } else if (turn.transition?.overlapMs !== undefined) {
      addEdge('turn_end_' + (i - 1), 'turn_start_' + i, -turn.transition.overlapMs);
    } else {
      addEdge('turn_end_' + (i - 1), 'turn_start_' + i, defaultTurnGapMs);
    }
  }

  let sortedEvents = validatedSourceEvents.map((e, index) => ({ e, index }))
    .sort((a, b) => a.e.offsetMs - b.e.offsetMs || a.index - b.index);

  for (let k = 0; k < M; k++) {
    let curr = sortedEvents[k];
    addEdge('START', 'event_' + curr.index, curr.e.offsetMs);
    if (k < M - 1) {
      let next = sortedEvents[k + 1];
      let interval = next.e.offsetMs - curr.e.offsetMs;
      let dwell = curr.e.minDwellMs !== undefined ? curr.e.minDwellMs : defaultMinDwellMs;
      let minGap = Math.max(interval, dwell);
      addEdge('event_' + curr.index, 'event_' + next.index, minGap);
    }
  }

  for (let i = 0; i < N; i++) {
    addEdge('turn_end_' + i, 'END', 0);
  }
  for (let k = 0; k < M; k++) {
    let dwell = validatedSourceEvents[k].minDwellMs !== undefined ? validatedSourceEvents[k].minDwellMs : defaultMinDwellMs;
    addEdge('event_' + k, 'END', dwell);
  }

  for (let i = 0; i < N; i++) {
    for (let cue of normalizedTimeline.turns[i].cues) {
      let start = resolveCueAnchor(i, cue.at);
      let end = cue.until ? resolveCueAnchor(i, cue.until) : start;
      addEdge('START', start.node, -start.offset);
      addEdge(start.node, 'END', start.offset);
      addEdge('START', end.node, -end.offset);
      addEdge(end.node, 'END', end.offset);
      if (cue.until) {
        addEdge(start.node, end.node, start.offset - end.offset);
      }
    }
  }

  for (let c of validatedConstraints) {
    let resEvent = resolveReference(c.eventId);
    let resRef = resolveReference(c.referenceId);
    let gap = c.gapMs;
    if (c.type === 'not-before' || c.type === 'min-gap') {
      addEdge(resRef.node, resEvent.node, gap + resRef.offset - resEvent.offset);
    } else if (c.type === 'coincident') {
      addEdge(resRef.node, resEvent.node, gap + resRef.offset - resEvent.offset);
      addEdge(resEvent.node, resRef.node, -gap - resRef.offset + resEvent.offset);
    }
  }

  let d = new Array(numNodes).fill(-Infinity);
  d[0] = 0;

  for (let iter = 0; iter < numNodes; iter++) {
    let updated = false;
    for (let { from, to, weight } of edges) {
      if (d[from] !== -Infinity && d[from] + weight > d[to]) {
        d[to] = d[from] + weight;
        updated = true;
      }
    }
    if (!updated) break;
    if (iter === numNodes - 1) {
      throw clockSolverError('CLOCK_SOLVER_UNSATISFIABLE', 'Temporal constraints are unsatisfiable due to a contradictory cycle');
    }
  }

  let totalDurationMs = Math.round(d[endNodeIndex]);

  let solvedTurns = validatedTurns.map((turn, i) => {
    let startMs = Math.round(d[nodeIndexMap.get('turn_start_' + i)]);
    let endMs = Math.round(d[nodeIndexMap.get('turn_end_' + i)]);
    let words = turn.words.map(w => ({
      text: w.text,
      startMs: Math.round(startMs + w.startMs),
      endMs: Math.round(startMs + w.endMs),
    }));
    return {
      id: normalizedTimeline.turns[i].id,
      startMs,
      endMs,
      words,
    };
  });

  let solvedSourceEvents = validatedSourceEvents.map((e, k) => {
    let offsetMs = Math.round(d[nodeIndexMap.get('event_' + k)]);
    return {
      id: e.id,
      offsetMs,
    };
  });

  let cueEvents = [];
  for (let i = 0; i < N; i++) {
    let turn = normalizedTimeline.turns[i];
    for (let j = 0; j < turn.cues.length; j++) {
      let cue = turn.cues[j];
      let start = resolveCueAnchor(i, cue.at);
      let end = cue.until ? resolveCueAnchor(i, cue.until) : start;
      let startMs = Math.round(d[nodeIndexMap.get(start.node)] + start.offset);
      let endMs = Math.round(d[nodeIndexMap.get(end.node)] + end.offset);
      if (startMs < 0 || endMs < startMs || endMs > totalDurationMs) {
        throw clockSolverError('CLOCK_SOLVER_UNSATISFIABLE', `Cue ${i}.${j} is outside the solved presentation clock`);
      }

      cueEvents.push({
        cueId: `${i}.${j}`,
        turnId: turn.id,
        startMs,
        endMs,
      });
    }
  }

  cueEvents.sort((left, right) => left.startMs - right.startMs || left.cueId.localeCompare(right.cueId));

  let extensionMs = Math.max(0, totalDurationMs - sourceDurationMs);

  let projection = {
    contractVersion: 'presentation-clock-projection-v1',
    timelineHash: computedTimelineHash,
    sourceDurationMs,
    totalDurationMs,
    turns: solvedTurns,
    sourceEvents: solvedSourceEvents,
    cueEvents,
    extensionMs,
  };

  projection.hash = `presentation-clock-projection-v1:${computeIntegrity(projection)}`;
  return projection;
}
