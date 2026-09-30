import { canonicalize, computeIntegrity } from '../schema/canonical-json.js';
import {
  PRESENTATION_REPLAN_REQUEST_SCHEMA_VERSION,
  presentationReplanRequestHash,
} from './presentation-output.js';

export const PRESENTATION_PLANNER_INPUT_SCHEMA_VERSION = 'presentation-planner-input-v2';
export const PRESENTATION_PLANNER_INPUT_MAX_BYTES = 96 * 1024;

const PRIVATE_KEY = /(?:authorization|cookie|credential|password|secret|session(?:id)?|access[_-]?token|api[_-]?key)/i;
const PRIVATE_VALUE = /(?:https?:\/\/|\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{12,}|(?:^|\s)(?:\/Users\/|\/home\/)[^\s]+)/i;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function selected(value, depth = 0) {
  if (depth > 12 || value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => selected(item, depth + 1)).filter((item) => item !== undefined);
  let result = {};
  for (let [key, child] of Object.entries(value)) {
    let normalized = selected(child, depth + 1);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => (
    child !== undefined && child !== '' && (!Array.isArray(child) || child.length > 0)
  )));
}

function uniqueRecords(values) {
  let records = new Map();
  for (let value of list(values).filter(isObject)) records.set(computeIntegrity(value), value);
  return [...records.values()].sort((left, right) => canonicalize(left).localeCompare(canonicalize(right)));
}

function assertPublic(value, path = 'plannerInput') {
  if (typeof value === 'string' && PRIVATE_VALUE.test(value)) {
    let error = new TypeError(`${path} contains a private URL, credential, or absolute local path`);
    error.code = 'PLANNER_INPUT_PRIVATE';
    throw error;
  }
  if (!value || typeof value !== 'object') return;
  for (let [key, child] of Object.entries(value)) {
    if (PRIVATE_KEY.test(key) && child !== undefined && child !== null && child !== '') {
      let error = new TypeError(`${path}.${key} is a private runtime field`);
      error.code = 'PLANNER_INPUT_PRIVATE';
      throw error;
    }
    assertPublic(child, `${path}.${key}`);
  }
}

function projectOutput(output = {}) {
  return compact({
    schemaVersion: text(output.schemaVersion),
    format: text(output.format),
    orientation: text(output.orientation),
    aspectRatio: text(output.aspectRatio),
    width: output.width,
    height: output.height,
    fps: output.fps,
    dpr: output.dpr,
    safeArea: selected(output.safeArea),
    contentRect: selected(output.contentRect),
    captions: selected(output.captions),
    voice: selected(output.voice),
    locale: text(output.locale),
    duration: selected(output.duration),
  });
}

function projectTarget(lessonTarget = {}, snapshotTarget = {}) {
  let address = text(snapshotTarget.address || lessonTarget.address || lessonTarget.id);
  if (!address) return null;
  return compact({
    id: text(lessonTarget.id || address),
    address,
    kind: text(snapshotTarget.kind || lessonTarget.kind),
    title: text(snapshotTarget.title || lessonTarget.title),
    tabId: text(snapshotTarget.tabId || lessonTarget.tabId),
    visible: snapshotTarget.visible === true,
    rendered: snapshotTarget.rendered === undefined ? undefined : snapshotTarget.rendered === true,
    hiddenReasons: [...new Set([...list(snapshotTarget.hiddenReasons), ...list(lessonTarget.hiddenReasons)].map(text).filter(Boolean))].sort(),
    safeActionNames: [...new Set(list(snapshotTarget.safeActionNames).map(text).filter(Boolean))].sort(),
    webmcpToolNames: [...new Set(list(snapshotTarget.webmcpToolNames).map(text).filter(Boolean))].sort(),
    revealRefs: [...new Set(list(lessonTarget.revealRefs).map(text).filter(Boolean))].sort(),
    toolRefs: [...new Set(list(lessonTarget.toolRefs).map(text).filter(Boolean))].sort(),
    composition: selected(snapshotTarget.composition || lessonTarget.composition || {}),
  });
}

function relevantTargetAddresses(request = {}, lessonContext = {}, snapshot = {}) {
  let relevant = new Set(list(lessonContext.lesson?.requiredTargetIds).map(text).filter(Boolean));
  for (let target of list(snapshot.targets)) if (target.visible === true) relevant.add(text(target.address || target.id));
  for (let record of [...list(lessonContext.facts), ...list(lessonContext.evidence)]) {
    for (let targetRef of list(record.targetRefs)) relevant.add(text(targetRef));
  }
  for (let relation of list(lessonContext.relations)) {
    if (relevant.has(text(relation.from)) || relevant.has(text(relation.to))) {
      relevant.add(text(relation.from));
      relevant.add(text(relation.to));
    }
  }
  return relevant;
}

function projectTargets(request = {}, lessonContext = {}, snapshot = {}) {
  let relevant = relevantTargetAddresses(request, lessonContext, snapshot);
  let lessonByAddress = new Map();
  for (let target of list(lessonContext.targets)) {
    let key = text(target.address || target.id);
    if (key) lessonByAddress.set(key, target);
  }
  let snapshotByAddress = new Map();
  for (let target of list(snapshot.targets)) {
    let key = text(target.address || target.id);
    if (key) snapshotByAddress.set(key, target);
  }
  let addresses = [...new Set([...lessonByAddress.keys(), ...snapshotByAddress.keys()])]
    .filter((address) => relevant.has(address))
    .sort();
  return addresses.map((address) => projectTarget(lessonByAddress.get(address), snapshotByAddress.get(address))).filter(Boolean);
}

function projectTools(allowedActions = [], lessonContext = {}, targets = []) {
  let ids = new Set(targets.flatMap((target) => list(target.toolRefs)).map(text).filter(Boolean));
  let names = new Set([
    ...targets.flatMap((target) => list(target.webmcpToolNames)),
    ...list(allowedActions).map((action) => action.tool || action.name),
  ].map(text).filter(Boolean));
  return list(lessonContext.toolDescriptors).map((tool) => compact({
    id: text(tool.id),
    name: text(tool.name),
    description: text(tool.description),
    inputSchema: selected(tool.inputSchema),
    targetRefs: [...new Set(list(tool.targetRefs).map(text).filter(Boolean))].sort(),
  })).filter((tool) => ids.has(tool.id) || names.has(tool.name)).sort((a, b) => `${a.id}:${a.name}`.localeCompare(`${b.id}:${b.name}`));
}

function projectEvidence(lessonContext = {}) {
  return list(lessonContext.evidence).map((item) => compact({
    id: text(item.id),
    source: text(item.source),
    value: selected(item.value),
    summary: text(item.summary),
    contentHash: text(item.contentHash),
    targetRefs: [...new Set(list(item.targetRefs).map(text).filter(Boolean))].sort(),
  })).filter((item) => item.id).sort((a, b) => a.id.localeCompare(b.id));
}

export function createPresentationPlannerInput(request = {}, snapshot = {}, options = {}) {
  if (!request.targetSnapshotHash || !snapshot.identityHash) throw new TypeError('presentation planner input requires a target snapshot basis');
  if (request.targetSnapshotHash !== snapshot.identityHash) throw new TypeError('presentation planner input snapshot basis is stale');
  if (request.schemaVersion !== PRESENTATION_REPLAN_REQUEST_SCHEMA_VERSION
    || request.hash !== presentationReplanRequestHash(request)) {
    throw new TypeError('presentation planner input requires an exact current replan request hash');
  }
  let lessonContext = isObject(request.lessonContext) ? request.lessonContext : {};
  let output = request.output || snapshot.output || {};
  let targets = projectTargets(request, lessonContext, snapshot);
  let targetAddresses = new Set(targets.map((target) => target.address));
  let allowedActions = uniqueRecords(request.allowedActions).filter((action) => targetAddresses.has(text(action.target)));
  let projection = {
    schemaVersion: PRESENTATION_PLANNER_INPUT_SCHEMA_VERSION,
    basis: compact({
      requestHash: text(request.hash),
      targetSnapshotHash: text(request.targetSnapshotHash),
      lessonContextHash: text(request.lessonContextHash),
      outputSpecHash: text(request.outputSpecHash),
      generation: Number.isInteger(request.generation) ? request.generation : 0,
    }),
    request: compact({
      prompt: text(request.prompt),
      profile: text(request.profile),
      personaSpec: selected(request.personaSpec || {}),
      turnBudget: selected(request.turnBudget || {}),
      actionBudget: selected(request.actionBudget || {}),
      reviewFeedback: selected(request.reviewFeedback),
      priorTimelineHash: request.reviewFeedback ? text(request.priorTimelineHash) : undefined,
    }),
    output: projectOutput(output),
    lesson: compact({
      type: text(lessonContext.lesson?.type),
      title: text(lessonContext.lesson?.title),
      objective: text(lessonContext.lesson?.objective),
      locale: text(lessonContext.lesson?.locale),
      brief: text(lessonContext.lesson?.brief),
      requiredFactIds: [...new Set(list(lessonContext.lesson?.requiredFactIds).map(text).filter(Boolean))].sort(),
      requiredTargetIds: [...new Set(list(lessonContext.lesson?.requiredTargetIds).map(text).filter(Boolean))].sort(),
    }),
    targets,
    tools: projectTools(allowedActions, lessonContext, targets),
    allowedActions,
    facts: selected(list(lessonContext.facts)),
    evidence: projectEvidence(lessonContext),
    relations: selected(list(lessonContext.relations)),
    deepening: selected(lessonContext.deepening || {}),
    dataSources: list(request.grounding?.sources || snapshot.dataSources).map((source) => compact({
      id: text(source.id),
      contentHash: text(source.contentHash),
    })).filter((source) => source.id).sort((a, b) => a.id.localeCompare(b.id)),
  };
  assertPublic(projection);
  let json = canonicalize(projection);
  let byteLength = new TextEncoder().encode(json).byteLength;
  let maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : PRESENTATION_PLANNER_INPUT_MAX_BYTES;
  if (byteLength > maxBytes) {
    let error = new RangeError(`presentation planner input is ${byteLength} bytes; limit is ${maxBytes}`);
    error.code = 'PLANNER_PROMPT_OVERSIZED';
    error.diagnosticCode = 'planner-prompt-oversized';
    error.byteLength = byteLength;
    error.maxBytes = maxBytes;
    throw error;
  }
  return {
    projection,
    json,
    byteLength,
    hash: `${PRESENTATION_PLANNER_INPUT_SCHEMA_VERSION}:${computeIntegrity(projection)}`,
  };
}
