# Media Evidence and Artifact Invalidation

`symbiote-workspace/runtime` exports two exact-version portable contracts:

- `workspace-media-artifact-graph-v1` describes artifact instances and their
  dependencies.
- `workspace-media-evidence-v1` binds that graph to render settings, metrics,
  gates, provenance, and a publication verdict.

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

The exact v1 schema rejects unknown fields, unsupported versions, cycles,
duplicate IDs, tampered cache identities, URL values, URL search/hash state,
absolute paths, parent traversal, credentials, session IDs, raw render state,
and false publication passes.

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
