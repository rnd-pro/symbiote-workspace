import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeIntegrity } from '../schema/index.js';
import { VIRTUAL_SEQUENCE_SCHEMA_VERSION, createVirtualSequence } from '../runtime/media-sequence.js';
import {
  AUDIO_SYNTHESIS_RECEIPT_VERSION,
  MEDIA_ARTIFACT_GRAPH_SCHEMA_VERSION,
  MEDIA_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  createMediaArtifactGraph,
} from '../index.js';
import { handlers, mediaToolFamily, tools } from '../runtime/tools/media-tools.js';

const hash = (value) => computeIntegrity(value);
const digest = (value) => Buffer.from(hash(value).slice('sha256-'.length), 'base64').toString('hex');

function validSequence() {
  return {
    schemaVersion: VIRTUAL_SEQUENCE_SCHEMA_VERSION,
    executionTier: 'sequential-realtime',
    timebase: { num: 1, den: 30 },
    frameRate: { num: 30, den: 1 },
    duration: 30,
    masters: [
      { id: 'm0', path: 'masters/0.mp4', contentHash: hash('m0'), codec: 'h264', container: 'mp4', range: { startTick: 0, endTick: 15 }, keyframes: [0] },
      { id: 'm1', path: 'masters/1.mp4', contentHash: hash('m1'), codec: 'h264', container: 'mp4', range: { startTick: 15, endTick: 30 }, keyframes: [15] },
    ],
    playbackProxy: { path: 'proxy/playback.mp4', contentHash: hash('proxy'), codec: 'h264', container: 'mp4' },
    scrub: {
      mode: 'chunks',
      maxChunkDurationTicks: 15,
      chunks: [
        { id: 'c0', path: 'scrub/0.mp4', contentHash: hash('c0'), codec: 'h264', container: 'mp4', range: { startTick: 0, endTick: 15 } },
        { id: 'c1', path: 'scrub/1.mp4', contentHash: hash('c1'), codec: 'h264', container: 'mp4', range: { startTick: 15, endTick: 30 } },
      ],
    },
    sprites: [
      { id: 's0', path: 'sprites/0.webp', contentHash: hash('s0'), codec: 'webp', cues: [0, 15], tile: { width: 160, height: 90, columns: 4, rows: 4 } },
    ],
    index: { keyframes: [0, 15], timestamps: [0, 10, 20] },
    audio: [
      { id: 'a0', path: 'audio/0.opus', contentHash: hash('a0'), range: { startTick: 0, endTick: 30 }, waveform: { path: 'audio/0.json', contentHash: hash('w0') } },
    ],
    layers: [
      { id: 'base', kind: 'base', invalidation: 'opaque', range: { startTick: 0, endTick: 30 }, dependsOn: [], affectedRanges: [{ startTick: 0, endTick: 30 }] },
      { id: 'overlay', kind: 'overlay', invalidation: 'partial', range: { startTick: 0, endTick: 30 }, dependsOn: ['base'], affectedRanges: [{ startTick: 5, endTick: 10 }], outputHash: hash('overlay-out') },
      { id: 'captions', kind: 'caption', invalidation: 'partial', range: { startTick: 0, endTick: 30 }, dependsOn: [], affectedRanges: [{ startTick: 0, endTick: 5 }] },
      { id: 'audio', kind: 'audio', invalidation: 'partial', range: { startTick: 0, endTick: 30 }, dependsOn: [], affectedRanges: [{ startTick: 0, endTick: 30 }] },
    ],
  };
}

function graphNodes() {
  let hostFingerprint = 'mac14,7:m2:macos-26.5.2:chrome-test';
  return [
    { kind: 'context', logicalId: 'context:source', inputHashes: { source: hash('source') }, versions: { schema: 'context-v2' }, outputHash: hash('context') },
    { kind: 'plan', logicalId: 'plan:lesson', dependsOn: ['context:source'], versions: { planner: 'planner-v1' }, outputHash: hash('plan') },
    { kind: 'composition-plan', logicalId: 'composition:lesson', dependsOn: ['plan:lesson'], versions: { browser: 'chromium-v1', layout: 'layout-v1' }, hostFingerprint, outputHash: hash('composition') },
    { kind: 'dialogue', logicalId: 'dialogue:lesson', dependsOn: ['plan:lesson'], versions: { dialogue: 'dialogue-v1' }, outputHash: hash('dialogue') },
    { kind: 'timing-profile', logicalId: 'timing:lesson', dependsOn: ['dialogue:lesson'], versions: { timeline: 'timeline-v3' }, outputHash: hash('timing') },
    { kind: 'audio-turn', logicalId: 'audio:turn-1', dependsOn: ['dialogue:lesson', 'composition:lesson'], versions: { provider: 'tts-v1', voice: 'voice-a' }, outputHash: hash('audio') },
    { kind: 'caption-cue', logicalId: 'caption:turn-1', dependsOn: ['audio:turn-1', 'timing:lesson'], versions: { caption: 'caption-v1' }, outputHash: hash('caption') },
    { kind: 'action-log', logicalId: 'actions:lesson', dependsOn: ['composition:lesson', 'timing:lesson'], versions: { action: 'action-v1' }, outputHash: hash('actions') },
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

function validManifest() {
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
    artifactGraph: createMediaArtifactGraph({
      schemaVersion: MEDIA_ARTIFACT_GRAPH_SCHEMA_VERSION,
      nodes: graphNodes(),
    }),
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
    synthesisEvidence: {
      identityClaim: 'provider-attested+acoustic-cluster',
      turns: [{
        turnId: 'turn-1',
        persona: 'guide',
        artifactRef: 'audio:turn-1',
        receiptRef: digest('request-turn-1'),
      }],
      receipts: [{
        receiptVersion: AUDIO_SYNTHESIS_RECEIPT_VERSION,
        requestHash: digest('request-turn-1'),
        requestedVoiceRef: 'voice-a',
        resolvedVoiceRef: 'voice-a',
        speakerAttestation: 'attestation-v1:opaque-public-value',
        model: { family: 'qwen3-tts', versionToken: 'version-stable-1' },
        language: 'en',
        sampleRate: 24000,
        durationMs: 1400,
        artifactHash: digest('audio'),
        receiptHmac: digest('receipt'),
        speakerProbe: {
          probeFamily: 'speaker-cluster-v2',
          probeVersionToken: digest('speaker-probe-version'),
          enrollmentRevision: digest('opaque-enrollment-revision'),
          segmentationRevision: 'vad-segments-v2',
          segmentCount: 4,
          enrolledVoiceMatch: true,
          segmentsConsistent: true,
          maxEnrolledDistance: 0.24,
          minOtherVoiceMargin: 0.63,
          maxSegmentDistance: 0.31,
          thresholds: {
            enrolledDistanceMax: 0.35,
            otherVoiceMarginMin: 0.5,
            segmentDistanceMax: 0.4,
          },
        },
        normalization: {
          version: 'ebu-r128-v1',
          applied: true,
          targetLufs: -16,
          truePeakLimitDbfs: -1,
        },
      }],
    },
    publication: {
      verdict: 'pass',
      blockedBy: [],
      thresholdProfileHash: hash('locked-profile-v1'),
    },
    createdAt: '2026-07-11T00:00:00.000Z',
  };
}

describe('media-tools', () => {
  it('exposes a read-only family with schemas and handlers for every tool', () => {
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(typeof globalThis.document, 'undefined');
    assert.equal(mediaToolFamily.name, 'media');
    assert.equal(mediaToolFamily.tools.length, 4);
    for (let tool of tools) {
      assert.equal(tool.mutates, false);
      assert.equal(typeof tool.description, 'string');
      assert.ok(tool.description.length > 0);
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(Array.isArray(tool.inputSchema.required));
      assert.equal(typeof handlers[tool.name], 'function');
    }
  });

  it('names every tool in snake_case convention', () => {
    for (let tool of tools) {
      assert.match(tool.name, /^[a-z][a-z0-9_]*$/);
    }
  });

  it('validates a sequence and returns its derived identity', () => {
    let result = handlers.media_sequence_validate({ sequence: validSequence() }, {});
    assert.equal(result.status, 'ok');
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.match(result.id, /^virtual-sequence:/);
    let sequence = createVirtualSequence(validSequence());
    assert.equal(sequence.id, `virtual-sequence:${sequence.contentHash}`);
    assert.equal(result.id, sequence.id);
  });

  it('reports a sequence missing its execution tier as invalid without throwing', () => {
    let malformed = validSequence();
    delete malformed.executionTier;
    let result = handlers.media_sequence_validate({ sequence: malformed }, {});
    assert.equal(result.status, 'ok');
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.equal(result.id, undefined);
  });

  it('reports invalid sequences without throwing', () => {
    let malformed = validSequence();
    malformed.duration = 0;
    let result = handlers.media_sequence_validate({ sequence: malformed }, {});
    assert.equal(result.status, 'ok');
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.equal(result.id, undefined);
  });

  it('projects a sequence at a valid tick', () => {
    let result = handlers.media_sequence_project({ sequence: validSequence(), tick: 20 }, {});
    assert.equal(result.status, 'ok');
    assert.equal(result.projection.executionTier, 'sequential-realtime');
    assert.equal(result.projection.master.id, 'm1');
    assert.equal(Number.isInteger(result.projection.keyframe), true);
    assert.equal(result.projection.keyframe, 15);
    assert.equal(result.projection.sprite.sprite.id, 's0');
    assert.equal(Number.isInteger(result.projection.sprite.cueIndex), true);
    assert.equal(Number.isInteger(result.projection.sprite.column), true);
    assert.equal(Number.isInteger(result.projection.sprite.row), true);
    assert.equal(result.projection.sprite.cueIndex, 1);
    assert.equal(result.projection.sprite.column, 1);
    assert.equal(result.projection.sprite.row, 0);
    assert.deepEqual(result.projection.layers.map((layer) => layer.id), ['base', 'overlay', 'captions', 'audio']);
  });

  it('returns a media-contract error for malformed projection input', () => {
    let badTick = handlers.media_sequence_project({ sequence: validSequence(), tick: 9999 }, {});
    assert.equal(badTick.status, 'error');
    assert.equal(badTick.code, 'media-contract');

    let badSequence = handlers.media_sequence_project({ sequence: {}, tick: 0 }, {});
    assert.equal(badSequence.status, 'error');
    assert.equal(badSequence.code, 'media-contract');
  });

  it('invalidates the opaque base across its full range', () => {
    let result = handlers.media_sequence_invalidate({ sequence: validSequence(), changedLayers: ['base'] }, {});
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.affectedRanges, [{ startTick: 0, endTick: 30 }]);
    assert.deepEqual(result.invalidatedLayers, ['base', 'overlay']);
  });

  it('retains a layer when recomputation preserves its output hash', () => {
    let sequence = createVirtualSequence(validSequence());
    let overlayHash = sequence.layers.find((layer) => layer.id === 'overlay').outputHash;
    let result = handlers.media_sequence_invalidate({
      sequence: validSequence(),
      changedLayers: ['overlay'],
      recomputedOutputHashes: { overlay: overlayHash },
    }, {});
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.invalidatedLayers, []);
    assert.deepEqual(result.retainedLayers, ['overlay']);
    assert.deepEqual(result.affectedRanges, []);
  });

  it('returns a media-contract error for an unknown changed layer', () => {
    let result = handlers.media_sequence_invalidate({ sequence: validSequence(), changedLayers: ['ghost'] }, {});
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'media-contract');
  });

  it('validates a portable media evidence manifest', () => {
    let result = handlers.media_evidence_validate({ manifest: validManifest() }, {});
    assert.equal(result.status, 'ok');
    assert.equal(result.valid, true);
  });

  it('reports evidence manifests with unknown fields', () => {
    let manifest = validManifest();
    manifest.renderSeed = { state: {} };
    let result = handlers.media_evidence_validate({ manifest }, {});
    assert.equal(result.status, 'ok');
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });
});
