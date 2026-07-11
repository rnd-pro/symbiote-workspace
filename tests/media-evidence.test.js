import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeIntegrity } from '../schema/index.js';
import {
  MEDIA_ARTIFACT_GRAPH_SCHEMA_VERSION,
  MEDIA_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  createMediaArtifactGraph,
  createMediaEvidenceManifest,
  invalidateMediaArtifactGraph,
  validateMediaArtifactGraph,
  validateMediaEvidenceManifest,
} from '../index.js';

const hash = (value) => computeIntegrity(value);

function graphNodes() {
  let hostFingerprint = 'mac14,7:m2:macos-26.5.2:chrome-test';
  return [
    { kind: 'context', logicalId: 'context:source', inputHashes: { source: hash('source') }, versions: { schema: 'context-v2' }, outputHash: hash('context') },
    { kind: 'plan', logicalId: 'plan:lesson', dependsOn: ['context:source'], versions: { planner: 'planner-v1' }, outputHash: hash('plan') },
    { kind: 'dialogue', logicalId: 'dialogue:lesson', dependsOn: ['plan:lesson'], versions: { dialogue: 'dialogue-v1' }, outputHash: hash('dialogue') },
    { kind: 'timing-profile', logicalId: 'timing:lesson', dependsOn: ['dialogue:lesson'], versions: { timeline: 'timeline-v3' }, outputHash: hash('timing') },
    { kind: 'audio-turn', logicalId: 'audio:turn-1', dependsOn: ['dialogue:lesson'], versions: { provider: 'tts-v1', voice: 'voice-a' }, outputHash: hash('audio') },
    { kind: 'caption-cue', logicalId: 'caption:turn-1', dependsOn: ['audio:turn-1', 'timing:lesson'], versions: { caption: 'caption-v1' }, outputHash: hash('caption') },
    { kind: 'action-log', logicalId: 'actions:lesson', dependsOn: ['plan:lesson', 'timing:lesson'], versions: { action: 'action-v1' }, outputHash: hash('actions') },
    {
      kind: 'frame-range',
      logicalId: 'frames:0-899',
      dependsOn: ['context:source', 'actions:lesson', 'timing:lesson'],
      versions: { renderer: 'renderer-v1', browser: 'chrome-test', assets: 'assets-v1', fonts: 'fonts-v1' },
      range: { startFrame: 0, endFrame: 899, fps: 30 },
      partitioning: {
        workerCount: 2,
        ranges: [
          { workerIndex: 0, startFrame: 0, endFrame: 449, frameCount: 450 },
          { workerIndex: 1, startFrame: 450, endFrame: 899, frameCount: 450 },
        ],
      },
      hostFingerprint,
      engineCacheKey: 'frame:opaque-engine-key',
      outputHash: hash('frames'),
    },
    {
      kind: 'encode-segment',
      logicalId: 'encode:0-899',
      dependsOn: ['frames:0-899', 'audio:turn-1', 'caption:turn-1'],
      versions: { encoder: 'webcodecs-v1', codec: 'h264' },
      range: { startFrame: 0, endFrame: 899 },
      hostFingerprint,
      outputHash: hash('segment'),
    },
    {
      kind: 'final-output',
      logicalId: 'output:main',
      dependsOn: ['encode:0-899'],
      versions: { container: 'mp4-v1', muxer: 'mux-v1' },
      hostFingerprint,
      outputHash: hash('output'),
    },
    {
      kind: 'quality-proof',
      logicalId: 'quality:locked-v1',
      dependsOn: ['output:main'],
      versions: { probe: 'probe-v1', thresholds: 'locked-v1' },
      outputHash: hash('quality'),
    },
    {
      kind: 'proof-manifest',
      logicalId: 'proof:main',
      dependsOn: ['quality:locked-v1'],
      versions: { manifest: 'evidence-v1', thresholds: 'locked-v1' },
      outputHash: hash('proof'),
    },
  ];
}

function graph() {
  return createMediaArtifactGraph({
    schemaVersion: MEDIA_ARTIFACT_GRAPH_SCHEMA_VERSION,
    nodes: graphNodes(),
  });
}

function manifestInput() {
  return {
    schemaVersion: MEDIA_EVIDENCE_MANIFEST_SCHEMA_VERSION,
    project: {
      id: 'maximo-api-tour',
      schemaVersion: 'workspace-media-project-v1',
      timelineHash: hash('timeline'),
      lessonAuditHash: hash('lesson-audit'),
    },
    source: {
      surface: 'maximo-workbench',
      tabId: 'api-graph',
      projectId: 'maximo-api-tour',
      routePath: '/workspace/api-graph',
      contextHash: hash('context'),
    },
    settings: {
      width: 1920,
      height: 1080,
      aspectRatio: '16:9',
      fps: 30,
      format: 'mp4',
      codec: 'h264',
      includeAudio: true,
      language: 'en',
      speakerMode: 'dialogue',
    },
    renderer: {
      providerId: 'browser-headless-screencast',
      version: 'renderer-v1',
      browserVersion: 'chrome-test',
      hostFingerprint: 'mac14,7:m2:macos-26.5.2:chrome-test',
      assetSetHash: hash('assets'),
      fontSetHash: hash('fonts'),
    },
    artifactGraph: graph(),
    metrics: [{
      id: 'frame-completeness',
      probeVersion: 'frame-completeness-v1',
      status: 'pass',
      value: { missing: 0, duplicated: 0, reordered: 0 },
      threshold: { missing: 0, duplicated: 0, reordered: 0 },
      evidenceRefs: ['proof:main'],
    }],
    gates: [{
      id: 'frames-complete',
      status: 'pass',
      metricIds: ['frame-completeness'],
      evidenceRefs: ['proof:main'],
    }],
    provenance: {
      models: [{ role: 'tts', providerId: 'symbiote-model-service', model: 'qwen3', version: '0.6b' }],
      voices: [{ persona: 'guide', voiceRef: 'voice-a', consent: 'recorded', license: 'project-approved' }],
      inputs: [{ kind: 'lesson', contentHash: hash('lesson'), relativePath: 'evidence/lesson.json' }],
    },
    publication: {
      verdict: 'pass',
      blockedBy: [],
      thresholdProfileHash: hash('locked-profile-v1'),
    },
    createdAt: '2026-07-11T00:00:00.000Z',
  };
}

describe('media evidence contract', () => {
  it('creates deterministic graph identities independent of node and object key order', () => {
    let first = graph();
    let reversed = createMediaArtifactGraph({
      nodes: graphNodes().reverse().map((node) => Object.fromEntries(Object.entries(node).reverse())),
      schemaVersion: MEDIA_ARTIFACT_GRAPH_SCHEMA_VERSION,
    });

    assert.deepEqual(reversed, first);
    assert.match(first.nodes[0].cacheKey, /^sha256-/);
    assert.equal(first.nodes.find((node) => node.kind === 'frame-range').engineCacheKey, 'frame:opaque-engine-key');
    assert.equal(first.nodes.find((node) => node.kind === 'frame-range').partitioning.workerCount, 2);
  });

  it('keeps threshold versions out of frame identity and rejects unsupported identity inputs', () => {
    let nodes = graphNodes();
    let frame = nodes.find((node) => node.kind === 'frame-range');
    frame.versions.thresholds = 'relaxed-v2';

    assert.throws(() => createMediaArtifactGraph({ nodes }), /thresholds is not an identity input for frame-range/);

    let changed = graphNodes();
    changed.find((node) => node.kind === 'quality-proof').versions.thresholds = 'locked-v2';
    assert.notEqual(
      createMediaArtifactGraph({ nodes: changed }).nodes.find((node) => node.kind === 'quality-proof').cacheKey,
      graph().nodes.find((node) => node.kind === 'quality-proof').cacheKey,
    );
  });

  it('invalidates only audio descendants while preserving timing and frame ranges', () => {
    let result = invalidateMediaArtifactGraph(graph(), ['audio:turn-1']);

    assert.deepEqual(result.invalidated, [
      'audio:turn-1',
      'caption:turn-1',
      'encode:0-899',
      'output:main',
      'quality:locked-v1',
      'proof:main',
    ]);
    assert.equal(result.invalidated.includes('timing:lesson'), false);
    assert.equal(result.invalidated.includes('frames:0-899'), false);
    assert.equal(result.invalidated.includes('actions:lesson'), false);
  });

  it('stops downstream invalidation when recomputation preserves output content', () => {
    let current = graph();
    let audio = current.nodes.find((node) => node.logicalId === 'audio:turn-1');
    let result = invalidateMediaArtifactGraph(current, ['audio:turn-1'], {
      recomputedOutputHashes: { 'audio:turn-1': audio.outputHash },
    });

    assert.deepEqual(result.invalidated, []);
    assert.deepEqual(result.retained, ['audio:turn-1']);
  });

  it('rejects duplicate, cyclic, unknown, and tampered graph identities', () => {
    assert.equal(validateMediaArtifactGraph({ nodes: [
      { kind: 'context', logicalId: 'a', dependsOn: ['b'] },
      { kind: 'plan', logicalId: 'b', dependsOn: ['a'] },
    ] }).ok, false);
    assert.equal(validateMediaArtifactGraph({ nodes: [
      { kind: 'context', logicalId: 'a', dependsOn: ['missing'] },
    ] }).ok, false);
    assert.throws(() => createMediaArtifactGraph({ nodes: [
      { kind: 'context', logicalId: 'a' },
      { kind: 'context', logicalId: 'a' },
    ] }), /duplicate artifact logicalId/);
    let current = graph();
    current.nodes[0].cacheKey = hash('tampered');
    assert.throws(() => createMediaArtifactGraph(current), /cacheKey does not match canonical inputs/);
  });

  it('creates a strict portable manifest with a stable identity', () => {
    let first = createMediaEvidenceManifest(manifestInput());
    let second = createMediaEvidenceManifest({ ...manifestInput(), createdAt: '2026-07-12T00:00:00.000Z' });

    assert.equal(first.id, second.id);
    assert.equal(first.publication.verdict, 'pass');
    assert.equal(validateMediaEvidenceManifest(first).ok, true);
    assert.doesNotMatch(JSON.stringify(first), /\/Users\/|\/tmp\/|\?token=|renderSeed/);
  });

  it('fails closed on private routes, paths, unknown fields, and false publication passes', () => {
    let withQuery = manifestInput();
    withQuery.source.routePath = '/workspace?token=secret';
    assert.match(validateMediaEvidenceManifest(withQuery).errors[0], /without URL search or hash/);

    let withPath = manifestInput();
    withPath.provenance.inputs[0].relativePath = '/private/evidence/voice.wav';
    assert.match(validateMediaEvidenceManifest(withPath).errors[0], /root-relative/);

    let withUnknown = manifestInput();
    withUnknown.renderSeed = { state: {} };
    assert.match(validateMediaEvidenceManifest(withUnknown).errors[0], /renderSeed is not supported/);

    let withFailedGate = manifestInput();
    withFailedGate.gates[0].status = 'fail';
    assert.match(validateMediaEvidenceManifest(withFailedGate).errors[0], /publication pass requires every gate to pass/);

    let withUnknownEvidence = manifestInput();
    withUnknownEvidence.metrics[0].evidenceRefs = ['frames:missing'];
    assert.match(validateMediaEvidenceManifest(withUnknownEvidence).errors[0], /references unknown evidence/);

    let withTamperedId = createMediaEvidenceManifest(manifestInput());
    withTamperedId.id = 'media-evidence:tampered';
    assert.match(validateMediaEvidenceManifest(withTamperedId).errors[0], /id does not match canonical identity/);

    let withEmbeddedUrl = manifestInput();
    withEmbeddedUrl.gates[0].message = 'fetch failed: https://internal.test/path?token=private';
    assert.match(validateMediaEvidenceManifest(withEmbeddedUrl).errors[0], /must not contain a URL/);

    let withPassingBlocker = manifestInput();
    withPassingBlocker.publication.blockedBy = ['frames-complete'];
    assert.match(validateMediaEvidenceManifest(withPassingBlocker).errors[0], /only unpassed gates/);
  });
});
