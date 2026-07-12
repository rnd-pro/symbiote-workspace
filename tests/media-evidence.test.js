import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeIntegrity } from '../schema/index.js';
import {
  AUDIO_SYNTHESIS_RECEIPT_VERSION,
  MEDIA_ARTIFACT_GRAPH_SCHEMA_VERSION,
  MEDIA_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  MEDIA_SPEAKER_IDENTITY_CLAIMS,
  createMediaArtifactGraph,
  createMediaEvidenceManifest,
  createVirtualSequence,
  invalidateMediaArtifactGraph,
  validateMediaArtifactGraph,
  validateMediaEvidenceManifest,
} from '../index.js';

const hash = (value) => computeIntegrity(value);
const digest = (value) => Buffer.from(hash(value).slice('sha256-'.length), 'base64').toString('hex');

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

function virtualSequence() {
  return {
    schemaVersion: 'workspace-virtual-sequence-v1',
    executionTier: 'sequential-realtime',
    timebase: { num: 1, den: 30 },
    frameRate: { num: 30, den: 1 },
    duration: 30,
    masters: [
      { id: 'm0', path: 'masters/seg-0.mp4', contentHash: hash('m0'), codec: 'h264', container: 'mp4', range: { startTick: 0, endTick: 15 }, keyframes: [0] },
      { id: 'm1', path: 'masters/seg-1.mp4', contentHash: hash('m1'), codec: 'h264', container: 'mp4', range: { startTick: 15, endTick: 30 }, keyframes: [15] },
    ],
    playbackProxy: { path: 'proxy/playback.mp4', contentHash: hash('proxy'), codec: 'h264', container: 'mp4' },
    scrub: {
      mode: 'chunks',
      maxChunkDurationTicks: 15,
      chunks: [
        { id: 'c0', path: 'scrub/c0.mp4', contentHash: hash('c0'), codec: 'h264', container: 'mp4', range: { startTick: 0, endTick: 15 } },
        { id: 'c1', path: 'scrub/c1.mp4', contentHash: hash('c1'), codec: 'h264', container: 'mp4', range: { startTick: 15, endTick: 30 } },
      ],
    },
    sprites: [
      { id: 's0', path: 'sprites/s0.webp', contentHash: hash('s0'), codec: 'webp', cues: [0, 15], tile: { width: 160, height: 90, columns: 4, rows: 4 } },
    ],
    index: { keyframes: [0, 15], timestamps: [0, 10, 20] },
    audio: [
      { id: 'a0', path: 'audio/a0.opus', contentHash: hash('a0'), range: { startTick: 0, endTick: 30 }, waveform: { path: 'audio/a0-wave.json', contentHash: hash('wave') } },
    ],
    layers: [
      { id: 'base', kind: 'base', invalidation: 'opaque', range: { startTick: 0, endTick: 30 }, dependsOn: [], affectedRanges: [{ startTick: 0, endTick: 30 }] },
      { id: 'overlay', kind: 'overlay', invalidation: 'partial', range: { startTick: 0, endTick: 30 }, dependsOn: ['base'], affectedRanges: [{ startTick: 5, endTick: 10 }] },
      { id: 'captions', kind: 'caption', invalidation: 'partial', range: { startTick: 0, endTick: 30 }, dependsOn: [], affectedRanges: [{ startTick: 0, endTick: 5 }] },
      { id: 'audio', kind: 'audio', invalidation: 'partial', range: { startTick: 0, endTick: 30 }, dependsOn: [], affectedRanges: [{ startTick: 0, endTick: 30 }] },
    ],
  };
}

function sequenceNode(outputHash, logicalId = 'sequence:main') {
  return {
    kind: 'virtual-sequence',
    logicalId,
    dependsOn: ['encode:0-899', 'audio:turn-1'],
    versions: { contract: 'contract-v1', schema: 'workspace-virtual-sequence-v1', sequence: 'sequence-v1' },
    outputHash,
  };
}

function coherentManifest(options = {}) {
  let sequence = createVirtualSequence(virtualSequence());
  let outputHash = options.sequenceNodeOutputHash || sequence.contentHash;
  let nodes = graphNodes();
  if (options.duplicateSequenceNode) {
    nodes.push(sequenceNode(outputHash, 'sequence:main-0'), sequenceNode(outputHash, 'sequence:main-1'));
  } else if (!options.omitSequenceNode) {
    nodes.push(sequenceNode(outputHash));
    if (!options.detachProof) {
      let quality = nodes.find((node) => node.logicalId === 'quality:locked-v1');
      quality.dependsOn = [...quality.dependsOn, 'sequence:main'];
    }
  }
  return {
    ...manifestInput(),
    virtualSequence: virtualSequence(),
    artifactGraph: createMediaArtifactGraph({ nodes }),
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
    assert.equal(first.schemaVersion, 'workspace-media-evidence-v3');
    assert.equal(AUDIO_SYNTHESIS_RECEIPT_VERSION, 'symbiote-audio-synthesis-receipt-v2');
    assert.deepEqual(MEDIA_SPEAKER_IDENTITY_CLAIMS, ['provider-attested+acoustic-cluster']);
    assert.equal(validateMediaEvidenceManifest(first).ok, true);
    assert.doesNotMatch(JSON.stringify(first), /\/Users\/|\/tmp\/|\?token=|renderSeed/);
  });

  it('requires strict receipt v2 speaker probe and normalization evidence', () => {
    let mutations = [
      [input => { delete input.synthesisEvidence.receipts[0].speakerProbe; }, /speakerProbe must be an object/],
      [input => { delete input.synthesisEvidence.receipts[0].normalization; }, /normalization must be an object/],
      [input => { input.synthesisEvidence.receipts[0].receiptVersion = 'symbiote-audio-synthesis-receipt-v1'; }, /must equal symbiote-audio-synthesis-receipt-v2/],
      [input => { input.synthesisEvidence.receipts[0].speakerProbe.probeFamily = 'unsafe probe'; }, /must be a safe token/],
      [input => { input.synthesisEvidence.receipts[0].speakerProbe.probeVersionToken = 'ABC'; }, /lowercase SHA-256/],
      [input => { input.synthesisEvidence.receipts[0].speakerProbe.enrollmentRevision = hash('not-opaque-hex'); }, /lowercase SHA-256/],
      [input => { input.synthesisEvidence.receipts[0].speakerProbe.segmentCount = 0; }, /positive integer/],
      [input => { input.synthesisEvidence.receipts[0].normalization.applied = 'true'; }, /must be a boolean/],
      [input => { input.synthesisEvidence.receipts[0].normalization.version = '../normalizer'; }, /must be a safe token/],
      [input => { input.synthesisEvidence.receipts[0].speakerProbe.score = 0.2; }, /speakerProbe.score is not supported/],
      [input => { input.synthesisEvidence.receipts[0].speakerProbe.thresholds.profile = 'strict'; }, /thresholds.profile is not supported/],
      [input => { input.synthesisEvidence.receipts[0].normalization.integratedLufs = -16; }, /normalization.integratedLufs is not supported/],
    ];
    for (let [mutate, expected] of mutations) {
      let input = manifestInput();
      mutate(input);
      assert.match(validateMediaEvidenceManifest(input).errors[0], expected);
    }
  });

  it('rejects false speaker verdicts and observations that fail declared thresholds', () => {
    let mutations = [
      [input => { input.synthesisEvidence.receipts[0].speakerProbe.enrolledVoiceMatch = false; }, /enrolledVoiceMatch must be true/],
      [input => { input.synthesisEvidence.receipts[0].speakerProbe.segmentsConsistent = false; }, /segmentsConsistent must be true/],
      [input => { input.synthesisEvidence.receipts[0].speakerProbe.maxEnrolledDistance = 0.36; }, /must not exceed thresholds.enrolledDistanceMax/],
      [input => { input.synthesisEvidence.receipts[0].speakerProbe.minOtherVoiceMargin = 0.49; }, /must meet thresholds.otherVoiceMarginMin/],
      [input => { input.synthesisEvidence.receipts[0].speakerProbe.maxSegmentDistance = 0.41; }, /must not exceed thresholds.segmentDistanceMax/],
    ];
    for (let [mutate, expected] of mutations) {
      let input = manifestInput();
      mutate(input);
      assert.match(validateMediaEvidenceManifest(input).errors[0], expected);
    }
  });

  it('rejects out-of-range receipt v2 observations and thresholds', () => {
    let mutations = [
      input => { input.synthesisEvidence.receipts[0].speakerProbe.maxEnrolledDistance = 2.01; },
      input => { input.synthesisEvidence.receipts[0].speakerProbe.minOtherVoiceMargin = -2.01; },
      input => { input.synthesisEvidence.receipts[0].speakerProbe.maxSegmentDistance = -0.01; },
      input => { input.synthesisEvidence.receipts[0].speakerProbe.thresholds.enrolledDistanceMax = -0.01; },
      input => { input.synthesisEvidence.receipts[0].speakerProbe.thresholds.otherVoiceMarginMin = 2.01; },
      input => { input.synthesisEvidence.receipts[0].speakerProbe.thresholds.segmentDistanceMax = 2.01; },
      input => { input.synthesisEvidence.receipts[0].normalization.targetLufs = -40.01; },
      input => { input.synthesisEvidence.receipts[0].normalization.truePeakLimitDbfs = 0.01; },
    ];
    for (let mutate of mutations) {
      let input = manifestInput();
      mutate(input);
      assert.match(validateMediaEvidenceManifest(input).errors[0], /must be a finite number in/);
    }
  });

  it('binds receipt v2 evidence into canonical manifest identity', () => {
    let original = createMediaEvidenceManifest(manifestInput());
    let changedInput = manifestInput();
    changedInput.synthesisEvidence.receipts[0].normalization.targetLufs = -18;
    let changed = createMediaEvidenceManifest(changedInput);

    assert.notEqual(changed.id, original.id);
    original.synthesisEvidence.receipts[0].speakerProbe.segmentCount += 1;
    assert.match(validateMediaEvidenceManifest(original).errors[0], /id does not match canonical identity/);
  });

  it('requires exact per-turn receipt, artifact, persona, voice, and language coverage', () => {
    let mutations = [
      [input => { delete input.synthesisEvidence; }, /identityClaim is required/],
      [input => { input.synthesisEvidence.turns = []; }, /cover every audio-turn artifact/],
      [input => { input.synthesisEvidence.turns[0].receiptRef = digest('unknown'); }, /references unknown receipt/],
      [input => { input.synthesisEvidence.receipts[0].artifactHash = digest('wrong-audio'); }, /does not match audio outputHash/],
      [input => { input.synthesisEvidence.receipts[0].requestedVoiceRef = 'voice-b'; }, /does not match voice provenance/],
      [input => {
        let node = input.artifactGraph.nodes.find(candidate => candidate.kind === 'audio-turn');
        node.versions.voice = 'voice-b';
        delete node.cacheKey;
        delete node.id;
      }, /versions.voice does not match voice provenance/],
      [input => { input.synthesisEvidence.turns[0].persona = 'expert'; }, /has no voice provenance/],
      [input => { input.synthesisEvidence.receipts[0].language = 'ru'; }, /language does not match media settings/],
    ];
    for (let [mutate, expected] of mutations) {
      let input = manifestInput();
      mutate(input);
      assert.match(validateMediaEvidenceManifest(input).errors[0], expected);
    }
  });

  it('rejects audio-enabled evidence without audio-turn artifacts', () => {
    let input = manifestInput();
    input.artifactGraph = createMediaArtifactGraph({
      nodes: graphNodes().filter((node) => !['audio-turn', 'caption-cue', 'encode-segment', 'final-output', 'quality-proof', 'proof-manifest'].includes(node.kind)),
    });
    input.metrics = [];
    input.gates = [];
    input.publication = { verdict: 'not-run', blockedBy: [], thresholdProfileHash: hash('locked-profile-v1') };
    assert.match(validateMediaEvidenceManifest(input).errors[0], /requires at least one audio-turn artifact/);
  });

  it('rejects unknown or biometric identity labels and private provider fields', () => {
    for (let identityClaim of [undefined, 'biometric-verified', 'proxyOnly', 'provider-attested']) {
      let input = manifestInput();
      input.synthesisEvidence.identityClaim = identityClaim;
      assert.equal(validateMediaEvidenceManifest(input).ok, false, String(identityClaim));
    }

    for (let [field, value] of [
      ['backendSpeaker', 'private-speaker-42'],
      ['sourceVoiceRef', 'raw-provider-alias'],
      ['samplePath', '/private/voice.wav'],
      ['modelPath', '/private/model'],
    ]) {
      let input = manifestInput();
      input.synthesisEvidence.receipts[0][field] = value;
      assert.match(validateMediaEvidenceManifest(input).errors[0], /is not supported/, field);
    }

    for (let field of ['biometricScore', 'speakerVector', 'voiceEmbedding', 'privateMetadata', 'rawDistances']) {
      let input = manifestInput();
      input.synthesisEvidence.receipts[0].speakerProbe[field] = [0.1, 0.2];
      assert.match(validateMediaEvidenceManifest(input).errors[0], /private and not portable/, field);
    }
  });

  it('rejects incomplete, shared, or extraneous voice provenance', () => {
    let missing = manifestInput();
    missing.provenance.voices = [];
    assert.match(validateMediaEvidenceManifest(missing).errors[0], /has no voice provenance/);

    let extra = manifestInput();
    extra.provenance.voices.push({ persona: 'expert', voiceRef: 'voice-b', consent: 'recorded', license: 'project-approved' });
    assert.match(validateMediaEvidenceManifest(extra).errors[0], /spoken personas must equal/);

    let shared = manifestInput();
    shared.provenance.voices.push({ persona: 'expert', voiceRef: 'voice-a', consent: 'recorded', license: 'project-approved' });
    assert.match(validateMediaEvidenceManifest(shared).errors[0], /unique voiceRef/);
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

  it('binds a portable virtual sequence into the canonical identity with a proof-linked node', () => {
    let withSequence = createMediaEvidenceManifest(coherentManifest());
    let withoutSequence = createMediaEvidenceManifest(manifestInput());

    assert.equal(withSequence.schemaVersion, 'workspace-media-evidence-v3');
    assert.equal(withSequence.artifactGraph.schemaVersion, 'workspace-media-artifact-graph-v2');
    assert.match(withSequence.virtualSequence.id, /^virtual-sequence:/);
    let node = withSequence.artifactGraph.nodes.find((entry) => entry.kind === 'virtual-sequence');
    assert.equal(node.outputHash, withSequence.virtualSequence.contentHash);
    assert.notEqual(withSequence.id, withoutSequence.id);
    assert.equal(withSequence.publication.verdict, 'pass');
    assert.equal(validateMediaEvidenceManifest(withSequence).ok, true);
    assert.doesNotMatch(JSON.stringify(withSequence.virtualSequence), /\/Users\/|https?:\/\/|\?token=/);
  });

  it('detects tampering of a bound virtual sequence through manifest identity', () => {
    let manifest = createMediaEvidenceManifest(coherentManifest());
    manifest.virtualSequence.masters[0].contentHash = hash('tampered-master');
    assert.match(validateMediaEvidenceManifest(manifest).errors[0], /id does not match canonical identity/);
  });

  it('rejects a virtual sequence whose frameRate disagrees with settings.fps', () => {
    let input = coherentManifest();
    input.settings.fps = 60;
    assert.match(validateMediaEvidenceManifest(input).errors[0], /frameRate does not match settings.fps/);
  });

  it('rejects sequence-declared audio when settings.includeAudio is false', () => {
    let input = coherentManifest();
    input.settings.includeAudio = false;
    delete input.synthesisEvidence;
    assert.match(validateMediaEvidenceManifest(input).errors[0], /includeAudio/);
  });

  it('rejects the superseded v2 manifest schema version outright', () => {
    let input = { ...coherentManifest(), schemaVersion: 'workspace-media-evidence-v2' };
    assert.match(validateMediaEvidenceManifest(input).errors[0], /must equal workspace-media-evidence-v3/);
  });

  it('rejects the superseded artifact graph v1 outright', () => {
    let input = coherentManifest();
    input.artifactGraph = { ...input.artifactGraph, schemaVersion: 'workspace-media-artifact-graph-v1' };
    assert.match(validateMediaEvidenceManifest(input).errors[0], /must equal workspace-media-artifact-graph-v2/);
  });

  it('propagates virtual sequence contract rejections through the manifest', () => {
    let input = coherentManifest();
    input.virtualSequence.masters[0].codec = 'png';
    assert.match(validateMediaEvidenceManifest(input).errors[0], /frame sequence/);
  });

  it('rejects a virtual-sequence artifact node whose outputHash is not the sequence hash', () => {
    let input = coherentManifest({ sequenceNodeOutputHash: hash('some-other-sequence') });
    assert.match(validateMediaEvidenceManifest(input).errors[0], /outputHash does not match the sequence content hash/);
  });

  it('rejects a manifest virtualSequence with no virtual-sequence artifact node', () => {
    let input = coherentManifest({ omitSequenceNode: true });
    assert.match(validateMediaEvidenceManifest(input).errors[0], /exactly one virtual-sequence artifact node/);
  });

  it('rejects duplicate virtual-sequence artifact nodes', () => {
    let input = coherentManifest({ duplicateSequenceNode: true });
    assert.match(validateMediaEvidenceManifest(input).errors[0], /exactly one virtual-sequence artifact node/);
  });

  it('rejects a passing publication whose proof does not depend on the virtual sequence', () => {
    let input = coherentManifest({ detachProof: true });
    assert.match(validateMediaEvidenceManifest(input).errors[0], /publication proof does not transitively depend on the virtual sequence/);
  });

  it('rejects a passing publication that cites the sequence itself as proof', () => {
    let input = coherentManifest();
    input.metrics[0].evidenceRefs = ['sequence:main'];
    input.gates[0].evidenceRefs = ['sequence:main'];
    assert.match(
      validateMediaEvidenceManifest(input).errors[0],
      /requires quality-proof or proof-manifest evidence/,
    );
  });

  it('requires timeline and audio-index assets before a virtual sequence can publish pass', () => {
    let cases = [
      [input => { delete input.virtualSequence.playbackProxy; }, /requires a playback proxy/],
      [input => { delete input.virtualSequence.scrub; }, /requires a scrub proxy or bounded chunks/],
      [input => { delete input.virtualSequence.sprites; }, /requires sprites or thumbnails/],
      [input => { delete input.virtualSequence.audio[0].waveform; }, /requires a waveform/],
    ];
    for (let [mutate, expected] of cases) {
      let input = coherentManifest();
      mutate(input);
      assert.match(validateMediaEvidenceManifest(input).errors[0], expected);
    }
  });

  it('rejects a virtual-sequence artifact node without a manifest virtualSequence', () => {
    let sequence = createVirtualSequence(virtualSequence());
    let nodes = graphNodes();
    nodes.push(sequenceNode(sequence.contentHash));
    let input = { ...manifestInput(), artifactGraph: createMediaArtifactGraph({ nodes }) };
    assert.match(validateMediaEvidenceManifest(input).errors[0], /virtual-sequence artifact node requires a manifest virtualSequence/);
  });
});
