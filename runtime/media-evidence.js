import { computeIntegrity, isIntegrityString } from '../schema/canonical-json.js';
import { createMediaSynthesisEvidence } from './media-evidence/synthesis-receipts.js';

export {
  AUDIO_SYNTHESIS_RECEIPT_VERSION,
  MEDIA_SPEAKER_IDENTITY_CLAIMS,
  createMediaSynthesisEvidence,
  validateMediaSynthesisEvidence,
} from './media-evidence/synthesis-receipts.js';

export const MEDIA_EVIDENCE_MANIFEST_SCHEMA_VERSION = 'workspace-media-evidence-v2';
export const MEDIA_ARTIFACT_GRAPH_SCHEMA_VERSION = 'workspace-media-artifact-graph-v1';

export const MEDIA_ARTIFACT_KINDS = Object.freeze([
  'context',
  'plan',
  'composition-plan',
  'dialogue',
  'timing-profile',
  'audio-turn',
  'caption-cue',
  'action-log',
  'frame-range',
  'encode-segment',
  'final-output',
  'quality-proof',
  'proof-manifest',
]);

export const MEDIA_ARTIFACT_VERSION_INPUTS = Object.freeze({
  context: Object.freeze(['contract', 'schema', 'collector', 'webMcp', 'source']),
  plan: Object.freeze(['contract', 'schema', 'planner', 'model', 'prompt', 'lessonAudit']),
  'composition-plan': Object.freeze(['contract', 'schema', 'renderer', 'browser', 'layout', 'presenter']),
  dialogue: Object.freeze(['contract', 'schema', 'planner', 'model', 'prompt', 'dialogue']),
  'timing-profile': Object.freeze(['contract', 'schema', 'timeline', 'alignment']),
  'audio-turn': Object.freeze(['contract', 'schema', 'provider', 'model', 'voice', 'audio']),
  'caption-cue': Object.freeze(['contract', 'schema', 'transcriber', 'model', 'caption', 'alignment']),
  'action-log': Object.freeze(['contract', 'schema', 'renderer', 'presenter', 'action']),
  'frame-range': Object.freeze(['contract', 'schema', 'renderer', 'browser', 'presenter', 'assets', 'fonts', 'theme']),
  'encode-segment': Object.freeze(['contract', 'schema', 'encoder', 'codec', 'muxer']),
  'final-output': Object.freeze(['contract', 'schema', 'encoder', 'codec', 'muxer', 'container']),
  'quality-proof': Object.freeze(['contract', 'schema', 'probe', 'thresholds']),
  'proof-manifest': Object.freeze(['contract', 'schema', 'manifest', 'probe', 'thresholds']),
});

const HOST_SENSITIVE_KINDS = new Set(['composition-plan', 'frame-range', 'encode-segment', 'final-output']);
const NODE_KEYS = new Set([
  'kind', 'logicalId', 'dependsOn', 'inputHashes', 'versions', 'range',
  'hostFingerprint', 'outputHash', 'engineCacheKey', 'status', 'id', 'cacheKey',
  'partitioning',
]);
const GRAPH_KEYS = new Set(['schemaVersion', 'nodes']);
const MANIFEST_KEYS = new Set([
  'schemaVersion', 'id', 'project', 'source', 'settings', 'renderer',
  'artifactGraph', 'metrics', 'gates', 'provenance', 'synthesisEvidence',
  'publication', 'createdAt',
]);
const PROJECT_KEYS = new Set(['id', 'schemaVersion', 'timelineHash', 'lessonAuditHash']);
const SOURCE_KEYS = new Set(['surface', 'tabId', 'projectId', 'routePath', 'contextHash']);
const SETTINGS_KEYS = new Set([
  'width', 'height', 'aspectRatio', 'fps', 'format', 'codec', 'includeAudio',
  'language', 'speakerMode',
]);
const RENDERER_KEYS = new Set([
  'providerId', 'version', 'browserVersion', 'hostFingerprint',
  'assetSetHash', 'fontSetHash',
]);
const METRIC_KEYS = new Set(['id', 'probeVersion', 'status', 'value', 'unit', 'threshold', 'evidenceRefs']);
const GATE_KEYS = new Set(['id', 'status', 'metricIds', 'evidenceRefs', 'message']);
const PROVENANCE_KEYS = new Set(['models', 'voices', 'inputs']);
const MODEL_KEYS = new Set(['role', 'providerId', 'model', 'version']);
const VOICE_KEYS = new Set(['persona', 'voiceRef', 'consent', 'license']);
const INPUT_KEYS = new Set(['kind', 'contentHash', 'relativePath']);
const PUBLICATION_KEYS = new Set(['verdict', 'blockedBy', 'thresholdProfileHash']);
const ARTIFACT_STATUS = new Set(['pending', 'ready', 'invalid', 'failed']);
const PROOF_STATUS = new Set(['pass', 'fail', 'not-run']);
const PUBLICATION_VERDICTS = new Set(['pass', 'blocked', 'not-run']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, fallback = '') {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

function assertObject(value, path) {
  if (!isObject(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function assertKnownKeys(value, keys, path) {
  for (let key of Object.keys(assertObject(value, path))) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported`);
  }
}

function requiredString(value, path) {
  let text = cleanString(value);
  if (!text) throw new TypeError(`${path} is required`);
  return text;
}

function optionalString(value) {
  let text = cleanString(value);
  return text || undefined;
}

function positiveInteger(value, path) {
  let number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new TypeError(`${path} must be a positive integer`);
  return number;
}

function integrity(value, path, required = false) {
  let text = optionalString(value);
  if (!text && !required) return undefined;
  if (!isIntegrityString(text)) throw new TypeError(`${path} must be a sha256 integrity string`);
  return text;
}

function stringList(value, path) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((item, index) => requiredString(item, `${path}[${index}]`));
}

function strictVersion(value, expected, path) {
  let version = requiredString(value, path);
  if (version !== expected) throw new TypeError(`${path} must equal ${expected}`);
  return version;
}

function plainValue(value, path) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`${path} must be finite`);
    return value;
  }
  if (typeof value === 'string') {
    let text = value.trim();
    let routeField = path === 'manifest.source.routePath';
    if (!routeField && /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|\/[A-Za-z0-9._-]+(?:\/|$))/.test(text)) {
      throw new TypeError(`${path} must not contain an absolute local path`);
    }
    if (/[a-z][a-z0-9+.-]*:\/\//i.test(text)) throw new TypeError(`${path} must not contain a URL`);
    if (/[#?&](?:token|access_token|auth|api_key|key|secret)=/i.test(text) || /\bBearer\s+\S+/i.test(text)) {
      throw new TypeError(`${path} must not contain credentials`);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => plainValue(item, `${path}[${index}]`));
  if (isObject(value)) {
    let result = {};
    for (let [key, child] of Object.entries(value)) {
      if (!['versionToken', 'probeVersionToken'].includes(key) && /(?:token|secret|password|credential|api[-_]?key|samplePath|sessionId)/i.test(key)) {
        throw new TypeError(`${path}.${key} is private and not portable`);
      }
      result[key] = plainValue(child, `${path}.${key}`);
    }
    return result;
  }
  throw new TypeError(`${path} must be JSON-compatible`);
}

function routePath(value) {
  let path = requiredString(value, 'manifest.source.routePath');
  if (!path.startsWith('/') || path.includes('?') || path.includes('#') || path.includes('://')) {
    throw new TypeError('manifest.source.routePath must be a path without URL search or hash');
  }
  return path;
}

function relativePath(value, path) {
  let text = requiredString(value, path).replace(/\\/g, '/');
  if (text.startsWith('/') || /^[A-Za-z]:\//.test(text) || text.split('/').includes('..')) {
    throw new TypeError(`${path} must be root-relative without parent traversal`);
  }
  return text;
}

function normalizeStringMap(value, path, valueNormalizer = requiredString) {
  if (value === undefined) return {};
  assertObject(value, path);
  let result = {};
  for (let key of Object.keys(value).sort()) {
    let safeKey = requiredString(key, `${path} key`);
    result[safeKey] = valueNormalizer(value[key], `${path}.${safeKey}`);
  }
  return result;
}

function versionsForKind(kind, versions = {}) {
  assertObject(versions, 'node.versions');
  let allowed = new Set(MEDIA_ARTIFACT_VERSION_INPUTS[kind]);
  let result = {};
  for (let key of Object.keys(versions).sort()) {
    if (!allowed.has(key)) throw new TypeError(`node.versions.${key} is not an identity input for ${kind}`);
    result[key] = requiredString(versions[key], `node.versions.${key}`);
  }
  return result;
}

function dependencyProjection(dependencies) {
  return dependencies
    .map((node) => ({ logicalId: node.logicalId, outputHash: node.outputHash || node.cacheKey }))
    .sort((left, right) => left.logicalId.localeCompare(right.logicalId));
}

export function createMediaArtifactCacheKey(input = {}, dependencies = []) {
  let kind = requiredString(input.kind, 'node.kind');
  if (!MEDIA_ARTIFACT_KINDS.includes(kind)) throw new TypeError(`node.kind is not supported: ${kind}`);
  let logicalId = requiredString(input.logicalId, 'node.logicalId');
  let inputHashes = normalizeStringMap(input.inputHashes, 'node.inputHashes', (value, path) => integrity(value, path, true));
  let hostFingerprint = optionalString(input.hostFingerprint);
  if (HOST_SENSITIVE_KINDS.has(kind) && !hostFingerprint) {
    throw new TypeError(`node.hostFingerprint is required for ${kind}`);
  }
  let projection = compactObject({
    schemaVersion: MEDIA_ARTIFACT_GRAPH_SCHEMA_VERSION,
    kind,
    logicalId,
    range: input.range === undefined ? undefined : plainValue(input.range, 'node.range'),
    inputHashes,
    dependencies: dependencyProjection(dependencies),
    versions: versionsForKind(kind, input.versions || {}),
    hostFingerprint,
  });
  return computeIntegrity(projection);
}

function topologicalLogicalIds(rawNodes) {
  let byLogicalId = new Map();
  for (let [index, raw] of rawNodes.entries()) {
    assertKnownKeys(raw, NODE_KEYS, `graph.nodes[${index}]`);
    let logicalId = requiredString(raw.logicalId, `graph.nodes[${index}].logicalId`);
    if (byLogicalId.has(logicalId)) throw new TypeError(`duplicate artifact logicalId: ${logicalId}`);
    byLogicalId.set(logicalId, raw);
  }
  let visiting = new Set();
  let visited = new Set();
  let ordered = [];
  function visit(logicalId) {
    if (visited.has(logicalId)) return;
    if (visiting.has(logicalId)) throw new TypeError(`artifact graph contains a cycle at ${logicalId}`);
    let node = byLogicalId.get(logicalId);
    if (!node) throw new TypeError(`artifact graph dependency is unknown: ${logicalId}`);
    visiting.add(logicalId);
    for (let dependencyId of stringList(node.dependsOn, `${logicalId}.dependsOn`).sort()) visit(dependencyId);
    visiting.delete(logicalId);
    visited.add(logicalId);
    ordered.push(logicalId);
  }
  for (let logicalId of [...byLogicalId.keys()].sort()) visit(logicalId);
  return { byLogicalId, ordered };
}

export function createMediaArtifactGraph(input = {}) {
  assertKnownKeys(input, GRAPH_KEYS, 'graph');
  let schemaVersion = strictVersion(
    input.schemaVersion || MEDIA_ARTIFACT_GRAPH_SCHEMA_VERSION,
    MEDIA_ARTIFACT_GRAPH_SCHEMA_VERSION,
    'graph.schemaVersion',
  );
  if (!Array.isArray(input.nodes)) throw new TypeError('graph.nodes must be an array');
  let { byLogicalId, ordered } = topologicalLogicalIds(input.nodes);
  let nodes = [];
  let normalizedByLogicalId = new Map();
  for (let logicalId of ordered) {
    let raw = byLogicalId.get(logicalId);
    let kind = requiredString(raw.kind, `${logicalId}.kind`);
    if (!MEDIA_ARTIFACT_KINDS.includes(kind)) throw new TypeError(`${logicalId}.kind is not supported: ${kind}`);
    let dependsOn = stringList(raw.dependsOn, `${logicalId}.dependsOn`).sort();
    let dependencies = dependsOn.map((id) => normalizedByLogicalId.get(id));
    let cacheKey = createMediaArtifactCacheKey(raw, dependencies);
    if (raw.cacheKey !== undefined && raw.cacheKey !== cacheKey) {
      throw new TypeError(`${logicalId}.cacheKey does not match canonical inputs`);
    }
    let outputHash = integrity(raw.outputHash, `${logicalId}.outputHash`);
    let status = optionalString(raw.status) || (outputHash ? 'ready' : 'pending');
    if (!ARTIFACT_STATUS.has(status)) throw new TypeError(`${logicalId}.status is not supported`);
    if (status === 'ready' && !outputHash) throw new TypeError(`${logicalId}.outputHash is required when ready`);
    let id = `${kind}:${computeIntegrity({ logicalId, cacheKey, outputHash: outputHash || null })}`;
    if (raw.id !== undefined && raw.id !== id) throw new TypeError(`${logicalId}.id does not match canonical identity`);
    let node = compactObject({
      id,
      kind,
      logicalId,
      dependsOn,
      inputHashes: normalizeStringMap(raw.inputHashes, `${logicalId}.inputHashes`, (value, path) => integrity(value, path, true)),
      versions: versionsForKind(kind, raw.versions || {}),
      range: raw.range === undefined ? undefined : plainValue(raw.range, `${logicalId}.range`),
      partitioning: raw.partitioning === undefined ? undefined : plainValue(raw.partitioning, `${logicalId}.partitioning`),
      hostFingerprint: optionalString(raw.hostFingerprint),
      cacheKey,
      outputHash,
      engineCacheKey: optionalString(raw.engineCacheKey),
      status,
    });
    nodes.push(node);
    normalizedByLogicalId.set(logicalId, node);
  }
  return { schemaVersion, nodes };
}

export function validateMediaArtifactGraph(input = {}) {
  try {
    createMediaArtifactGraph(input);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error?.message || String(error)] };
  }
}

export function invalidateMediaArtifactGraph(graphInput = {}, changedLogicalIds = [], options = {}) {
  let graph = createMediaArtifactGraph(graphInput);
  let changed = new Set(stringList(changedLogicalIds, 'changedLogicalIds'));
  let recomputed = normalizeStringMap(options.recomputedOutputHashes, 'recomputedOutputHashes', (value, path) => integrity(value, path, true));
  let byLogicalId = new Map(graph.nodes.map((node) => [node.logicalId, node]));
  for (let logicalId of changed) {
    if (!byLogicalId.has(logicalId)) throw new TypeError(`changed artifact is unknown: ${logicalId}`);
  }
  let children = new Map(graph.nodes.map((node) => [node.logicalId, []]));
  for (let node of graph.nodes) {
    for (let dependency of node.dependsOn) children.get(dependency).push(node.logicalId);
  }
  let invalidated = new Set();
  let retained = new Set();
  let queue = [...changed];
  while (queue.length) {
    let logicalId = queue.shift();
    let node = byLogicalId.get(logicalId);
    if (recomputed[logicalId] && recomputed[logicalId] === node.outputHash) {
      retained.add(logicalId);
      continue;
    }
    if (invalidated.has(logicalId)) continue;
    invalidated.add(logicalId);
    queue.push(...children.get(logicalId));
  }
  return {
    invalidated: graph.nodes.map((node) => node.logicalId).filter((id) => invalidated.has(id)),
    retained: graph.nodes.map((node) => node.logicalId).filter((id) => retained.has(id)),
  };
}

function normalizeProject(value = {}) {
  assertKnownKeys(value, PROJECT_KEYS, 'manifest.project');
  return compactObject({
    id: requiredString(value.id, 'manifest.project.id'),
    schemaVersion: requiredString(value.schemaVersion, 'manifest.project.schemaVersion'),
    timelineHash: integrity(value.timelineHash, 'manifest.project.timelineHash'),
    lessonAuditHash: integrity(value.lessonAuditHash, 'manifest.project.lessonAuditHash'),
  });
}

function normalizeSource(value = {}) {
  assertKnownKeys(value, SOURCE_KEYS, 'manifest.source');
  return compactObject({
    surface: requiredString(value.surface, 'manifest.source.surface'),
    tabId: optionalString(value.tabId),
    projectId: optionalString(value.projectId),
    routePath: value.routePath === undefined ? undefined : routePath(value.routePath),
    contextHash: integrity(value.contextHash, 'manifest.source.contextHash', true),
  });
}

function normalizeSettings(value = {}) {
  assertKnownKeys(value, SETTINGS_KEYS, 'manifest.settings');
  return compactObject({
    width: positiveInteger(value.width, 'manifest.settings.width'),
    height: positiveInteger(value.height, 'manifest.settings.height'),
    aspectRatio: requiredString(value.aspectRatio, 'manifest.settings.aspectRatio'),
    fps: positiveInteger(value.fps, 'manifest.settings.fps'),
    format: requiredString(value.format, 'manifest.settings.format'),
    codec: requiredString(value.codec, 'manifest.settings.codec'),
    includeAudio: Boolean(value.includeAudio),
    language: requiredString(value.language, 'manifest.settings.language'),
    speakerMode: requiredString(value.speakerMode, 'manifest.settings.speakerMode'),
  });
}

function normalizeRenderer(value = {}) {
  assertKnownKeys(value, RENDERER_KEYS, 'manifest.renderer');
  return compactObject({
    providerId: requiredString(value.providerId, 'manifest.renderer.providerId'),
    version: requiredString(value.version, 'manifest.renderer.version'),
    browserVersion: optionalString(value.browserVersion),
    hostFingerprint: requiredString(value.hostFingerprint, 'manifest.renderer.hostFingerprint'),
    assetSetHash: integrity(value.assetSetHash, 'manifest.renderer.assetSetHash'),
    fontSetHash: integrity(value.fontSetHash, 'manifest.renderer.fontSetHash'),
  });
}

function normalizeMetric(value, index) {
  let path = `manifest.metrics[${index}]`;
  assertKnownKeys(value, METRIC_KEYS, path);
  let status = requiredString(value.status, `${path}.status`);
  if (!PROOF_STATUS.has(status)) throw new TypeError(`${path}.status is not supported`);
  return compactObject({
    id: requiredString(value.id, `${path}.id`),
    probeVersion: requiredString(value.probeVersion, `${path}.probeVersion`),
    status,
    value: value.value === undefined ? undefined : plainValue(value.value, `${path}.value`),
    unit: optionalString(value.unit),
    threshold: value.threshold === undefined ? undefined : plainValue(value.threshold, `${path}.threshold`),
    evidenceRefs: stringList(value.evidenceRefs, `${path}.evidenceRefs`),
  });
}

function normalizeGate(value, index) {
  let path = `manifest.gates[${index}]`;
  assertKnownKeys(value, GATE_KEYS, path);
  let status = requiredString(value.status, `${path}.status`);
  if (!PROOF_STATUS.has(status)) throw new TypeError(`${path}.status is not supported`);
  return compactObject({
    id: requiredString(value.id, `${path}.id`),
    status,
    metricIds: stringList(value.metricIds, `${path}.metricIds`),
    evidenceRefs: stringList(value.evidenceRefs, `${path}.evidenceRefs`),
    message: optionalString(value.message),
  });
}

function normalizeProvenance(value = {}) {
  assertKnownKeys(value, PROVENANCE_KEYS, 'manifest.provenance');
  let models = (value.models || []).map((item, index) => {
    let path = `manifest.provenance.models[${index}]`;
    assertKnownKeys(item, MODEL_KEYS, path);
    return {
      role: requiredString(item.role, `${path}.role`),
      providerId: requiredString(item.providerId, `${path}.providerId`),
      model: requiredString(item.model, `${path}.model`),
      version: requiredString(item.version, `${path}.version`),
    };
  });
  let voices = (value.voices || []).map((item, index) => {
    let path = `manifest.provenance.voices[${index}]`;
    assertKnownKeys(item, VOICE_KEYS, path);
    return {
      persona: requiredString(item.persona, `${path}.persona`),
      voiceRef: requiredString(item.voiceRef, `${path}.voiceRef`),
      consent: requiredString(item.consent, `${path}.consent`),
      license: requiredString(item.license, `${path}.license`),
    };
  });
  let inputs = (value.inputs || []).map((item, index) => {
    let path = `manifest.provenance.inputs[${index}]`;
    assertKnownKeys(item, INPUT_KEYS, path);
    return compactObject({
      kind: requiredString(item.kind, `${path}.kind`),
      contentHash: integrity(item.contentHash, `${path}.contentHash`, true),
      relativePath: item.relativePath === undefined ? undefined : relativePath(item.relativePath, `${path}.relativePath`),
    });
  });
  return { models, voices, inputs };
}

function normalizePublication(value = {}, gates = []) {
  assertKnownKeys(value, PUBLICATION_KEYS, 'manifest.publication');
  let verdict = requiredString(value.verdict, 'manifest.publication.verdict');
  if (!PUBLICATION_VERDICTS.has(verdict)) throw new TypeError('manifest.publication.verdict is not supported');
  let blockedBy = stringList(value.blockedBy, 'manifest.publication.blockedBy');
  let gateIds = new Set(gates.map((gate) => gate.id));
  let unpassed = gates.filter((gate) => gate.status !== 'pass').map((gate) => gate.id);
  if (blockedBy.some((id) => !gateIds.has(id))) throw new TypeError('publication blockedBy contains an unknown gate');
  if (blockedBy.some((id) => !unpassed.includes(id))) throw new TypeError('publication blockedBy may contain only unpassed gates');
  if (verdict === 'pass' && (gates.length === 0 || gates.some((gate) => gate.status !== 'pass'))) {
    throw new TypeError('publication pass requires every gate to pass');
  }
  if (verdict === 'pass' && blockedBy.length) throw new TypeError('publication pass requires empty blockedBy');
  if (verdict === 'blocked' && unpassed.some((id) => !blockedBy.includes(id))) {
    throw new TypeError('publication blockedBy must include every unpassed gate');
  }
  return {
    verdict,
    blockedBy,
    thresholdProfileHash: integrity(value.thresholdProfileHash, 'manifest.publication.thresholdProfileHash', true),
  };
}

function assertUniqueIds(items, path) {
  let ids = new Set();
  for (let item of items) {
    if (ids.has(item.id)) throw new TypeError(`${path} contains duplicate id: ${item.id}`);
    ids.add(item.id);
  }
  return ids;
}

function buildMediaEvidenceManifest(input = {}) {
  assertKnownKeys(input, MANIFEST_KEYS, 'manifest');
  let schemaVersion = strictVersion(
    input.schemaVersion || MEDIA_EVIDENCE_MANIFEST_SCHEMA_VERSION,
    MEDIA_EVIDENCE_MANIFEST_SCHEMA_VERSION,
    'manifest.schemaVersion',
  );
  let artifactGraph = createMediaArtifactGraph(input.artifactGraph || {});
  let metrics = (input.metrics || []).map(normalizeMetric);
  let gates = (input.gates || []).map(normalizeGate);
  let artifactIds = new Set(artifactGraph.nodes.map((node) => node.logicalId));
  let metricIds = assertUniqueIds(metrics, 'manifest.metrics');
  assertUniqueIds(gates, 'manifest.gates');
  for (let metric of metrics) {
    for (let ref of metric.evidenceRefs) {
      if (!artifactIds.has(ref)) throw new TypeError(`manifest metric ${metric.id} references unknown evidence: ${ref}`);
    }
  }
  for (let gate of gates) {
    for (let metricId of gate.metricIds) {
      if (!metricIds.has(metricId)) throw new TypeError(`manifest gate ${gate.id} references unknown metric: ${metricId}`);
    }
    for (let ref of gate.evidenceRefs) {
      if (!artifactIds.has(ref)) throw new TypeError(`manifest gate ${gate.id} references unknown evidence: ${ref}`);
    }
  }
  let provenance = normalizeProvenance(input.provenance || {});
  let settings = normalizeSettings(input.settings);
  let synthesisEvidence = settings.includeAudio
    ? createMediaSynthesisEvidence(input.synthesisEvidence, {
      artifactGraph,
      voices: provenance.voices,
      language: settings.language,
    })
    : undefined;
  if (!settings.includeAudio && input.synthesisEvidence !== undefined) {
    throw new TypeError('manifest.synthesisEvidence is supported only when settings.includeAudio is true');
  }
  let manifest = {
    schemaVersion,
    project: normalizeProject(input.project),
    source: normalizeSource(input.source),
    settings,
    renderer: normalizeRenderer(input.renderer),
    artifactGraph,
    metrics,
    gates,
    provenance,
    ...(synthesisEvidence ? { synthesisEvidence } : {}),
    publication: normalizePublication(input.publication, gates),
    createdAt: requiredString(input.createdAt, 'manifest.createdAt'),
  };
  plainValue(manifest, 'manifest');
  let identity = computeIntegrity({
    schemaVersion,
    project: manifest.project,
    source: manifest.source,
    settings: manifest.settings,
    renderer: manifest.renderer,
    artifactGraph,
    metrics,
    gates,
    provenance: manifest.provenance,
    synthesisEvidence: manifest.synthesisEvidence,
    publication: manifest.publication,
  });
  let id = `media-evidence:${identity}`;
  if (input.id !== undefined && requiredString(input.id, 'manifest.id') !== id) {
    throw new TypeError('manifest.id does not match canonical identity');
  }
  return { ...manifest, id };
}

export function createMediaEvidenceManifest(input = {}) {
  return buildMediaEvidenceManifest(input);
}

export function validateMediaEvidenceManifest(input = {}) {
  try {
    buildMediaEvidenceManifest(input);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error?.message || String(error)] };
  }
}
