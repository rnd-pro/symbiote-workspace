import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeIntegrity, isIntegrityString } from '../schema/canonical-json.js';
import {
  VIRTUAL_SEQUENCE_SCHEMA_VERSION,
  VIRTUAL_SEQUENCE_EXECUTION_TIERS,
  createVirtualSequence,
  validateVirtualSequence,
  projectVirtualSequenceAt,
  invalidateVirtualSequence,
} from '../runtime/media-sequence.js';

let hash = (label) => computeIntegrity(label);

function baseSequence() {
  return {
    schemaVersion: VIRTUAL_SEQUENCE_SCHEMA_VERSION,
    executionTier: 'sequential-realtime',
    timebase: { num: 1, den: 60 },
    frameRate: { num: 30, den: 1 },
    duration: 60,
    masters: [
      {
        id: 'master-a',
        path: 'media/master-a.mp4',
        contentHash: hash('master-a'),
        codec: 'h264',
        container: 'mp4',
        range: { startTick: 0, endTick: 30 },
        keyframes: [0, 10, 20],
      },
      {
        id: 'master-b',
        path: 'media/master-b.mp4',
        contentHash: hash('master-b'),
        codec: 'h264',
        container: 'mp4',
        range: { startTick: 30, endTick: 60 },
        keyframes: [30, 40, 50],
      },
    ],
    playbackProxy: {
      path: 'media/proxy.mp4',
      contentHash: hash('proxy'),
      codec: 'h264',
      container: 'mp4',
    },
    scrub: {
      mode: 'chunks',
      maxChunkDurationTicks: 30,
      chunks: [
        {
          id: 'scrub-a',
          path: 'media/scrub-a.webm',
          contentHash: hash('scrub-a'),
          codec: 'vp9',
          container: 'webm',
          range: { startTick: 0, endTick: 30 },
        },
        {
          id: 'scrub-b',
          path: 'media/scrub-b.webm',
          contentHash: hash('scrub-b'),
          codec: 'vp9',
          container: 'webm',
          range: { startTick: 30, endTick: 60 },
        },
      ],
    },
    sprites: [
      {
        id: 'sprite-sheet',
        path: 'media/sprites.webp',
        contentHash: hash('sprites'),
        codec: 'webp',
        cues: [0, 12, 24, 36, 48],
        tile: { width: 160, height: 90, columns: 5, rows: 5 },
      },
    ],
    index: {
      keyframes: [0, 10, 20, 30, 40, 50],
      timestamps: [0, 20, 40],
    },
    audio: [
      {
        id: 'audio-main',
        path: 'media/audio.mp4',
        contentHash: hash('audio'),
        range: { startTick: 0, endTick: 60 },
        waveform: { path: 'media/waveform.dat', contentHash: hash('waveform') },
      },
    ],
    layers: [
      {
        id: 'base',
        kind: 'base',
        invalidation: 'opaque',
        range: { startTick: 0, endTick: 60 },
        dependsOn: [],
        affectedRanges: [{ startTick: 0, endTick: 60 }],
        outputHash: hash('base-out'),
      },
      {
        id: 'overlay',
        kind: 'overlay',
        invalidation: 'partial',
        range: { startTick: 0, endTick: 30 },
        dependsOn: ['base'],
        affectedRanges: [
          { startTick: 0, endTick: 10 },
          { startTick: 20, endTick: 26 },
        ],
        outputHash: hash('overlay-out'),
      },
      {
        id: 'caption',
        kind: 'caption',
        invalidation: 'partial',
        range: { startTick: 0, endTick: 60 },
        dependsOn: ['overlay'],
        affectedRanges: [{ startTick: 0, endTick: 60 }],
        outputHash: hash('caption-out'),
      },
      {
        id: 'audio-layer',
        kind: 'audio',
        invalidation: 'opaque',
        range: { startTick: 0, endTick: 60 },
        dependsOn: [],
        affectedRanges: [{ startTick: 0, endTick: 60 }],
      },
    ],
  };
}

describe('media-sequence', () => {
  it('imports without DOM globals', () => {
    assert.equal(typeof createVirtualSequence, 'function');
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(typeof globalThis.document, 'undefined');
  });

  it('accepts a well-formed sequence', () => {
    assert.deepEqual(validateVirtualSequence(baseSequence()), { ok: true, errors: [] });
  });

  it('requires a supported executionTier', () => {
    assert.deepEqual([...VIRTUAL_SEQUENCE_EXECUTION_TIERS], ['sequential-realtime', 'replayable-segment', 'checkpointed-deterministic']);

    let missing = baseSequence();
    delete missing.executionTier;
    assert.throws(() => createVirtualSequence(missing), /executionTier is required/);

    let unknown = baseSequence();
    unknown.executionTier = 'turbo';
    assert.throws(() => createVirtualSequence(unknown), /executionTier is not supported/);
  });

  it('rejects a partial base on a non-cooperative surface policy', () => {
    let input = baseSequence();
    input.layers[0].invalidation = 'partial';
    assert.throws(() => createVirtualSequence(input), /sequential-realtime base layer must be opaque/);
  });

  it('accepts a partial base on a cooperative execution tier', () => {
    for (let tier of ['replayable-segment', 'checkpointed-deterministic']) {
      let input = baseSequence();
      input.executionTier = tier;
      input.layers[0].invalidation = 'partial';
      assert.equal(validateVirtualSequence(input).ok, true);
    }
  });

  it('requires exactly one base layer', () => {
    let none = baseSequence();
    none.layers[0].kind = 'caption';
    assert.throws(() => createVirtualSequence(none), /sequence requires exactly one base layer/);

    let two = baseSequence();
    two.layers[1].kind = 'base';
    assert.throws(() => createVirtualSequence(two), /sequence requires exactly one base layer/);
  });

  it('requires the base layer to cover the full duration', () => {
    let input = baseSequence();
    input.layers[0].range = { startTick: 0, endTick: 58 };
    input.layers[0].affectedRanges = [{ startTick: 0, endTick: 58 }];
    assert.throws(() => createVirtualSequence(input), /base layer must cover the full duration/);
  });

  it('rejects an off-grid master boundary', () => {
    let input = baseSequence();
    input.masters[0].range.endTick = 31;
    input.masters[1].range.startTick = 31;
    input.masters[1].keyframes = [31, 40, 50];
    assert.throws(() => createVirtualSequence(input), /masters\[0\] boundary is not aligned to the frame grid/);
  });

  it('rejects an off-grid master keyframe', () => {
    let input = baseSequence();
    input.masters[0].keyframes = [0, 11, 20];
    input.index.keyframes = [0, 11, 20, 30, 40, 50];
    assert.throws(() => createVirtualSequence(input), /masters\[0\]\.keyframes\[1\] is not aligned to the frame grid/);
  });

  it('rejects an off-grid scrub chunk boundary', () => {
    let input = baseSequence();
    input.scrub.chunks[0].range.endTick = 31;
    input.scrub.chunks[1].range.startTick = 31;
    assert.throws(() => createVirtualSequence(input), /scrub\.chunks\[0\] boundary is not aligned to the frame grid/);
  });

  it('rejects an off-grid timestamp', () => {
    let input = baseSequence();
    input.index.timestamps = [0, 21, 40];
    assert.throws(() => createVirtualSequence(input), /index\.timestamps\[1\] is not aligned to the frame grid/);
  });

  it('accepts sub-frame caption, overlay and audio ranges', () => {
    let input = baseSequence();
    input.layers[1].range = { startTick: 1, endTick: 29 };
    input.layers[1].affectedRanges = [{ startTick: 1, endTick: 9 }];
    input.layers[2].range = { startTick: 1, endTick: 59 };
    input.layers[2].affectedRanges = [{ startTick: 1, endTick: 59 }];
    input.audio[0].range = { startTick: 1, endTick: 59 };
    assert.equal(validateVirtualSequence(input).ok, true);
  });

  it('accepts a complete one-entry-per-frame timestamp index', () => {
    let input = baseSequence();
    input.index.timestamps = Array.from({ length: 30 }, (unused, frame) => frame * 2);
    assert.equal(input.index.timestamps.length, 60 / 2);
    assert.equal(validateVirtualSequence(input).ok, true);
  });

  it('rejects a non-monotonic, duplicate or out-of-range timestamp index', () => {
    let outOfOrder = baseSequence();
    outOfOrder.index.timestamps = [0, 40, 20];
    assert.throws(() => createVirtualSequence(outOfOrder), /non-monotonic/);

    let duplicate = baseSequence();
    duplicate.index.timestamps = [0, 20, 20, 40];
    assert.throws(() => createVirtualSequence(duplicate), /duplicate timestamp/);

    let outOfRange = baseSequence();
    outOfRange.index.timestamps = [0, 20, 60];
    assert.throws(() => createVirtualSequence(outOfRange), /index\.timestamps\[2\] is out of range/);
  });

  it('bounds scrub chunk durations', () => {
    let missing = baseSequence();
    delete missing.scrub.maxChunkDurationTicks;
    assert.throws(() => createVirtualSequence(missing), /maxChunkDurationTicks must be a positive integer/);

    let exceeded = baseSequence();
    exceeded.scrub.maxChunkDurationTicks = 20;
    assert.throws(() => createVirtualSequence(exceeded), /scrub chunk exceeds maxChunkDurationTicks/);
  });

  it('rejects sprite cues that exceed tile capacity', () => {
    let input = baseSequence();
    input.sprites[0].tile = { width: 160, height: 90, columns: 1, rows: 1 };
    assert.throws(() => createVirtualSequence(input), /sprite cues exceed tile capacity/);
  });

  it('rejects a cue tick shared across sprites', () => {
    let input = baseSequence();
    input.sprites.push({
      id: 'sprite-detail',
      path: 'media/sprites-detail.webp',
      contentHash: hash('sprites-detail'),
      codec: 'webp',
      cues: [24, 30, 42],
      tile: { width: 160, height: 90, columns: 5, rows: 5 },
    });
    assert.throws(() => createVirtualSequence(input), /duplicate sprite cue tick/);
  });

  it('rejects an encoded segment that models a frame sequence', () => {
    let imageMaster = baseSequence();
    imageMaster.masters[0].codec = 'png';
    assert.throws(() => createVirtualSequence(imageMaster), /models a frame sequence/);

    let imageProxy = baseSequence();
    imageProxy.playbackProxy.codec = 'webp';
    assert.throws(() => createVirtualSequence(imageProxy), /models a frame sequence/);

    let imageChunk = baseSequence();
    imageChunk.scrub.chunks[0].codec = 'jpeg';
    assert.throws(() => createVirtualSequence(imageChunk), /models a frame sequence/);
  });

  it('rejects incompatible timing data', () => {
    let badTicks = baseSequence();
    badTicks.frameRate = { num: 24000, den: 1001 };
    assert.throws(() => createVirtualSequence(badTicks), /ticksPerFrame is not an integer/);

    let partialFrame = baseSequence();
    partialFrame.duration = 61;
    assert.throws(() => createVirtualSequence(partialFrame), /whole number of frames/);

    let badRange = baseSequence();
    badRange.masters[1].range.endTick = 80;
    assert.throws(() => createVirtualSequence(badRange), /endTick must not exceed duration/);
  });

  it('enforces the master track partition and keyframe coherence', () => {
    let gapped = baseSequence();
    gapped.masters[1].range.startTick = 32;
    gapped.masters[1].keyframes = [32, 40, 50];
    assert.throws(() => createVirtualSequence(gapped), /master track has a gap/);

    let offKeyframe = baseSequence();
    offKeyframe.masters[0].keyframes = [10, 20];
    assert.throws(() => createVirtualSequence(offKeyframe), /must start on a keyframe/);

    let badIndex = baseSequence();
    badIndex.index.keyframes = [0, 10, 20, 30, 40];
    assert.throws(() => createVirtualSequence(badIndex), /keyframe index must equal the union/);
  });

  it('rejects non-portable paths and invalid hashes', () => {
    let cases = [
      ['/etc/master.mp4', /root-relative/],
      ['C:/master.mp4', /drive letter/],
      ['media\\master.mp4', /backslashes/],
      ['media/../master.mp4', /parent traversal/],
      ['https://host/master.mp4', /URL/],
      ['media/master.mp4?token=abc', /credentials/],
    ];
    for (let [path, pattern] of cases) {
      let input = baseSequence();
      input.masters[0].path = path;
      assert.throws(() => createVirtualSequence(input), pattern);
    }

    let badHash = baseSequence();
    badHash.masters[0].contentHash = 'not-a-hash';
    assert.throws(() => createVirtualSequence(badHash), /integrity string/);
  });

  it('enforces layer kind, invalidation and dependency policy', () => {
    let badKind = baseSequence();
    badKind.layers[0].kind = 'watermark';
    assert.throws(() => createVirtualSequence(badKind), /kind is not supported/);

    let badMode = baseSequence();
    badMode.layers[1].invalidation = 'lazy';
    assert.throws(() => createVirtualSequence(badMode), /invalidation is not supported/);

    let emptyAffected = baseSequence();
    emptyAffected.layers[1].affectedRanges = [];
    assert.throws(() => createVirtualSequence(emptyAffected), /layer affectedRanges must be non-empty/);

    let opaquePartial = baseSequence();
    opaquePartial.layers[0].affectedRanges = [{ startTick: 0, endTick: 10 }];
    assert.throws(() => createVirtualSequence(opaquePartial), /opaque layer must invalidate its full declared range/);

    let overlappingRanges = baseSequence();
    overlappingRanges.layers[1].affectedRanges = [
      { startTick: 0, endTick: 12 },
      { startTick: 10, endTick: 20 },
    ];
    assert.throws(() => createVirtualSequence(overlappingRanges), /sorted and non-overlapping/);

    let duplicateDependency = baseSequence();
    duplicateDependency.layers[2].dependsOn = ['overlay', 'overlay'];
    assert.throws(() => createVirtualSequence(duplicateDependency), /layer caption has a duplicate dependency/);

    let selfDependency = baseSequence();
    selfDependency.layers[1].dependsOn = ['overlay'];
    assert.throws(() => createVirtualSequence(selfDependency), /cannot depend on itself/);

    let cyclic = baseSequence();
    cyclic.layers[0].dependsOn = ['caption'];
    assert.throws(() => createVirtualSequence(cyclic), /layer dependency cycle/);

    let unknownDependency = baseSequence();
    unknownDependency.layers[1].dependsOn = ['ghost'];
    assert.throws(() => createVirtualSequence(unknownDependency), /depends on unknown layer/);

    let audioWithoutRefs = baseSequence();
    delete audioWithoutRefs.audio;
    assert.throws(() => createVirtualSequence(audioWithoutRefs), /audio layer requires audio references/);
  });

  it('requires an audio layer for audio references', () => {
    let input = baseSequence();
    input.layers = input.layers.filter((layer) => layer.kind !== 'audio');
    assert.throws(() => createVirtualSequence(input), /audio references require an audio layer/);
  });

  it('derives a stable content hash and identity independent of declaration order', () => {
    let canonical = createVirtualSequence(baseSequence());
    assert.equal(isIntegrityString(canonical.contentHash), true);
    assert.equal(canonical.id, `virtual-sequence:${canonical.contentHash}`);

    let ordered = baseSequence();
    ordered.audio.push({
      id: 'audio-b',
      path: 'media/audio-b.mp4',
      contentHash: hash('audio-b'),
      range: { startTick: 0, endTick: 60 },
    });
    ordered.sprites.push({
      id: 'sprite-detail',
      path: 'media/sprites-detail.webp',
      contentHash: hash('sprites-detail'),
      codec: 'webp',
      cues: [6, 18, 30, 42],
      tile: { width: 160, height: 90, columns: 5, rows: 5 },
    });
    let forward = createVirtualSequence(ordered);

    let reversed = createVirtualSequence({
      ...ordered,
      masters: [...ordered.masters].reverse(),
      sprites: [...ordered.sprites].reverse(),
      audio: [...ordered.audio].reverse(),
      layers: [...ordered.layers].reverse(),
    });
    assert.equal(reversed.id, forward.id);
    assert.equal(reversed.contentHash, forward.contentHash);

    assert.equal(createVirtualSequence(canonical).id, canonical.id);
    assert.equal(createVirtualSequence(canonical).contentHash, canonical.contentHash);
  });

  it('rebinds identity when any field changes', () => {
    let canonical = createVirtualSequence(baseSequence());
    let tampered = baseSequence();
    tampered.playbackProxy.path = 'media/proxy-alt.mp4';
    let rebuilt = createVirtualSequence(tampered);
    assert.notEqual(rebuilt.contentHash, canonical.contentHash);
    assert.notEqual(rebuilt.id, canonical.id);
  });

  it('rejects an explicit id or content hash that does not match the canonical identity', () => {
    let wrongId = baseSequence();
    wrongId.id = 'virtual-sequence:sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    assert.throws(() => createVirtualSequence(wrongId), /id does not match canonical identity/);

    let wrongHash = baseSequence();
    wrongHash.contentHash = 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    assert.throws(() => createVirtualSequence(wrongHash), /contentHash does not match canonical identity/);
  });

  it('accepts repeated content hashes for static scenes while keeping ids unique', () => {
    let input = baseSequence();
    input.masters[1].contentHash = input.masters[0].contentHash;
    assert.equal(validateVirtualSequence(input).ok, true);
  });

  it('projects a deterministic view at a media tick', () => {
    let sequence = createVirtualSequence(baseSequence());
    let projection = projectVirtualSequenceAt(sequence, 25);
    assert.equal(projection.tick, 25);
    assert.equal(projection.executionTier, 'sequential-realtime');
    assert.equal(projection.master.id, 'master-a');
    assert.equal(projection.keyframe, 20);
    assert.equal(Number.isInteger(projection.keyframe), true);
    assert.equal(projection.keyframe % 2, 0);
    assert.equal(projection.scrub.id, 'scrub-a');
    assert.equal(projection.sprite.sprite.id, 'sprite-sheet');
    assert.equal(projection.sprite.cue, 24);
    assert.equal(projection.sprite.cueIndex, 2);
    assert.equal(projection.sprite.column, 2);
    assert.equal(projection.sprite.row, 0);
    assert.deepEqual(projection.audio.map((entry) => entry.id), ['audio-main']);
    assert.deepEqual(projection.layers.map((layer) => layer.id), ['base', 'overlay', 'caption', 'audio-layer']);
    assert.equal(projection.playbackProxy.path, 'media/proxy.mp4');

    assert.throws(() => projectVirtualSequenceAt(sequence, 60), /tick out of range/);
    assert.throws(() => projectVirtualSequenceAt(sequence, -1), /tick out of range/);
    assert.throws(() => projectVirtualSequenceAt(sequence, 1.5), /tick out of range/);
  });

  it('computes range-aware invalidation in canonical order', () => {
    let sequence = createVirtualSequence(baseSequence());

    let opaque = invalidateVirtualSequence(sequence, ['base']);
    assert.deepEqual(opaque.affectedRanges, [{ startTick: 0, endTick: 60 }]);
    assert.deepEqual(opaque.invalidatedLayers, ['base', 'caption', 'overlay']);

    let recomputed = {};
    recomputed.overlay = sequence.layers.find((layer) => layer.id === 'overlay').outputHash;
    let retained = invalidateVirtualSequence(sequence, ['overlay'], { recomputedOutputHashes: recomputed });
    assert.deepEqual(retained.invalidatedLayers, []);
    assert.deepEqual(retained.retainedLayers, ['overlay']);
    assert.deepEqual(retained.affectedRanges, []);

    assert.throws(() => invalidateVirtualSequence(sequence, ['ghost']), /changed layer is unknown/);
  });

  it('reports structured validation results', () => {
    assert.deepEqual(validateVirtualSequence(baseSequence()), { ok: true, errors: [] });
    let malformed = baseSequence();
    malformed.duration = 0;
    let result = validateVirtualSequence(malformed);
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /duration must be a positive integer/);
  });
});
