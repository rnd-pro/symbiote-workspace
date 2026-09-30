# Media Evidence and Artifact Invalidation

`symbiote-workspace/runtime` exports two exact-version portable contracts:

- `workspace-media-artifact-graph-v2` describes artifact instances and their
  dependencies (v1 is rejected outright).
- `workspace-media-evidence-v3` binds that graph to render settings, metrics,
  gates, provenance, an optional virtual sequence, and a publication verdict.

These contracts contain portable identity and evidence only. Capture processes,
frame files, provider queues, ffprobe execution, and resource sampling remain
owned by render engines and hosts.

## Artifact identity

Each graph node has four distinct identities:

- `logicalId` is a stable locator such as `audio:turn-4` or `frames:900-1799`.
- `cacheKey` is a canonical `sha256-<base64>` integrity over the node's declared
  inputs, dependency outputs, semantic range, and per-kind versions.
- `outputHash` identifies the produced content or deterministic proof output.
- `id` binds the logical locator, cache key, and output hash into one immutable
  artifact-instance identity.

Engine-local cache keys use provider-defined formats and remain opaque
`engineCacheKey` evidence. They are not workspace integrity hashes.
Worker counts and contiguous ranges are recorded as non-identity
`partitioning` evidence on frame nodes, so changing worker allocation does not
invalidate pixel-identical frame content.

`timing-profile` is a first-class artifact. Frame ranges depend on the timing
profile and action log rather than audio bytes, so a voice-only change can reuse
frames when authored timing remains unchanged.

Graph v2 adds a `virtual-sequence` artifact kind. When a manifest carries a
`virtualSequence`, the graph must contain exactly one ready `virtual-sequence`
node whose `outputHash` equals the sequence `contentHash`. A `virtual-sequence`
node with no manifest `virtualSequence` is rejected.

## Invalidation

`invalidateMediaArtifactGraph()` walks downstream dependencies from changed
logical IDs. A recomputed node whose `outputHash` is unchanged stops propagation,
which preserves valid descendants after an edit that does not alter produced
content.

Frame, encode, and final-output cache identity requires a `hostFingerprint`.
Threshold versions affect quality-proof and proof-manifest nodes, not pixel or
encode identity.

## Evidence manifests

`createMediaEvidenceManifest()` validates and canonicalizes:

- project and structured source identity;
- output settings and renderer identity;
- the artifact DAG;
- executable metric results and gate links;
- model, voice, and input provenance;
- the publication verdict and threshold profile.

A `pass` verdict requires every gate to pass. A blocked verdict must name every
failed or not-run gate. Metrics and gates may reference only existing graph nodes
and metric IDs.

The exact v3 schema rejects unknown fields, unsupported versions, cycles,
duplicate IDs, tampered cache identities, URL values, URL search/hash state,
absolute paths, parent traversal, credentials, session IDs, raw render state,
and false publication passes.

Audio-enabled manifests require `symbiote-audio-synthesis-receipt-v2` evidence
for every audio turn. Each receipt binds its canonical request and artifact
hashes to voice provenance, a provider attestation, strict acoustic-cluster
speaker-probe verdicts and thresholds, and portable loudness/true-peak
normalization evidence. The workspace validates receipt shape, coverage,
threshold relations, and canonical identity, but intentionally does not verify
the provider-owned receipt HMAC. Biometric labels and vector, embedding, raw, or
private provider fields are not portable and are rejected at any receipt depth.

```js
import {
  createMediaArtifactGraph,
  createMediaEvidenceManifest,
} from 'symbiote-workspace/runtime';

let artifactGraph = createMediaArtifactGraph({
  nodes: [
    {
      kind: 'context',
      logicalId: 'context:source',
      inputHashes: { source: 'sha256-BzFx9/XhQ4rmMsslK9qH0Z4b+rGgujCekb3WRYhvJOo=' },
      outputHash: 'sha256-S7sflEb/CCmQnS+p5x2V9sfffjCsFt35bpprQp1rPr8=',
    },
  ],
});

let evidence = createMediaEvidenceManifest({
  project: {
    id: 'lesson-a',
    schemaVersion: 'workspace-media-project-v1',
  },
  source: {
    surface: 'workbench',
    routePath: '/workspace',
    contextHash: 'sha256-S7sflEb/CCmQnS+p5x2V9sfffjCsFt35bpprQp1rPr8=',
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
    providerId: 'browser-screencast',
    version: 'renderer-v1',
    hostFingerprint: 'recorded-host-v1',
  },
  artifactGraph,
  metrics: [],
  gates: [],
  provenance: { models: [], voices: [], inputs: [] },
  publication: {
    verdict: 'not-run',
    blockedBy: [],
    thresholdProfileHash: 'sha256-iluu4uRVOLxS5G6tbA8jcoLea8zSaBFHeiWW8xyTGDk=',
  },
  createdAt: new Date().toISOString(),
});
```

## Virtual sequence

`runtime/media-sequence.js` exports the `workspace-virtual-sequence-v1` contract
(`createVirtualSequence`, `validateVirtualSequence`, `projectVirtualSequenceAt`,
`invalidateVirtualSequence`, plus `VIRTUAL_SEQUENCE_SCHEMA_VERSION`,
`VIRTUAL_SEQUENCE_EXECUTION_TIERS`, `VIRTUAL_SEQUENCE_LAYER_KINDS`, and
`VIRTUAL_SEQUENCE_INVALIDATION_MODES`). It is the indexed, portable
playback/scrub/rerender model for Media Studio, exported from
`symbiote-workspace`, `symbiote-workspace/runtime`, and
`symbiote-workspace/browser`.

Every sequence declares a required `executionTier`, exactly one of
`sequential-realtime`, `replayable-segment`, or `checkpointed-deterministic`
(`VIRTUAL_SEQUENCE_EXECUTION_TIERS`).

A virtual sequence carries:

- encoded master segments (video codecs and containers only), a playback proxy,
  a scrub proxy or bounded scrub chunks, and sparse sprites/thumbnails;
- keyframe and timestamp seek indexes;
- authored audio and waveform references;
- separately-invalidatable layers (`base`, `overlay`, `caption`, `audio`) with
  layer dependencies and affected ranges.

Content-addressed hashes are used throughout, timing uses a rational integer
timebase and `frameRate` (never floating-point equality as identity), and media
paths are root-relative.

A sequence has exactly one `base` layer covering the full declared duration. A
`sequential-realtime` base must be `opaque`: an arbitrary non-cooperative
surface invalidates its full declared base range and cannot claim partial
invalidation. Cooperative tiers (`replayable-segment`,
`checkpointed-deterministic`) may declare a partial base range as an
optimization declaration. This is not a parallelism claim; no parallelism is
promised for arbitrary or opaque surfaces.

Timing derives an integer `ticksPerFrame` from the timebase and `frameRate`.
Every master range boundary, every master keyframe, and every encoded
scrub-chunk boundary must align to that frame grid; caption, overlay, audio,
and layer ranges remain sub-frame-capable.

`index.timestamps` is a cheap PTS/timestamp index — a complete one-entry-per-frame
index is valid. It rejects duplicates, non-monotonic values, out-of-range
values, and values off the frame grid. A dense or complete timestamp index is
still just a seek index, not an image or frame sequence: the only
frame-sequence rejection is the image-codec rejection on encoded
master/proxy/scrub segments, which must use video codecs and containers.

Bounded scrub chunks declare a positive `maxChunkDurationTicks`; any chunk
longer than that explicit bound is rejected.

A sprite sheet's cue count must not exceed its tile capacity
(`columns * rows`), and cue ticks are globally unique across sprites.
`projectVirtualSequenceAt(sequence, tick)` returns the selected `cueIndex`,
`column`, and `row` so a Media Studio consumer can locate the thumbnail.

`projectVirtualSequenceAt(sequence, tick)` is a deterministic pure projection at
a media timestamp. It locates the master/proxy segment, the nearest prior
keyframe, the scrub segment, the nearest prior sprite/thumbnail cue with its
tile position, the active audio/waveform span, and the active layers and ranges.

`invalidateVirtualSequence(sequence, changedLayers, options)` is range-aware. It
returns the merged affected ranges and the required per-layer recomputations, and
downstream propagation stops when a recomputation preserves a layer's output hash
(`options.recomputedOutputHashes`).

The sequence exposes a canonical `contentHash`; its `id` is
`'virtual-sequence:' + contentHash`. Layer, sprite, and audio collections are
canonicalized so equivalent input order yields one identity.

Strict validation rejects absolute local paths, URLs, credentials, parent
traversal, unknown fields, duplicate identities or timestamps, non-monotonic
seek indexes, master-track gaps or overlaps, image-codec encoded segments, and
incompatible timebase/frameRate/duration data. Static scenes may repeat content
hashes; duplicate identity and tick-position remain invalid.

When a `virtualSequence` is present on a media evidence manifest, it is validated
and bound into the manifest's canonical `id`. Cross-object coherence requires the
sequence `frameRate` to match `settings.fps`, and if the sequence declares audio,
`settings.includeAudio` must be `true`. The `workspace-media-artifact-graph-v2`
graph must then contain exactly one ready `virtual-sequence` node whose
`outputHash` equals the sequence `contentHash`, and a passing publication's
proof/evidence dependency chain must transitively include that node — so a proof
for one output cannot publish a different sequence.

A passing publication additionally requires the Media Studio playback assets:
the playback proxy, scrub proxy or bounded chunks, and at least one sprite or
thumbnail sheet. Audio-enabled publications require sequence audio references
and a waveform for every reference. Publication evidence must cite a
`quality-proof` or `proof-manifest` node whose dependency closure contains the
exact `virtual-sequence` node; citing the sequence node itself is not proof.

Four read-only media dispatch tools project these pure contracts over both CLI
(kebab-case) and MCP: `media_sequence_validate` (validate a virtual sequence and
return its derived identity), `media_sequence_project` (project at a media tick),
`media_sequence_invalidate` (range-aware invalidation from changed layers), and
`media_evidence_validate` (validate a media evidence manifest).
