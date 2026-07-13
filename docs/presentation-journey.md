# Presentation Journey

`runtime/presentation-journey.js` exports the exact-version
`workspace-presentation-journey-v1` contract: the portable record of one live
source execution, normalized so a renderer can replay it deterministically
without re-running the model. It is exported from `symbiote-workspace`,
`symbiote-workspace/runtime`, and `symbiote-workspace/browser` as
`createPresentationJourney`, `validatePresentationJourney`,
`presentationJourneyReplayProjection`, `PRESENTATION_JOURNEY_SCHEMA_VERSION`,
`PRESENTATION_JOURNEY_OUTCOMES`, and `PRESENTATION_JOURNEY_PROVENANCE`.

The contract carries portable identity and observed timing only. Event
collection, tool execution, HTTP streaming, and frame rendering stay owned by the
host that produced the session.

## One execution, two timelines

Every event records the observed `sourceOffsetMs` and independently declares a
watchable `presentationOffsetMs`. The two are bound by an explicit, monotonic
time map so any compression or retiming is proven rather than implied:

- `timing.segments` is a contiguous list of
  `{ sourceStartMs, sourceEndMs, presentationStartMs, presentationEndMs }`
  covering `[0, sourceDurationMs]` in source time and `[0, presentationDurationMs]`
  in presentation time.
- A segment may compress but never stretch: its presentation span is at most its
  source span, and `presentationDurationMs` never exceeds `sourceDurationMs`.
- A segment whose presentation span equals its source span is real-time. Idle
  backend waits are expressed as compressed segments; operator typing, workspace
  transitions, and UI animation stay in real-time segments.
- Each event's `presentationOffsetMs` must equal the time-map projection of its
  `sourceOffsetMs`. An event offset that lands strictly inside a compressed
  segment is rejected, because a compressed idle gap has no watchable position.

Rendering never re-runs the model; it replays this one accepted record pinned by
its canonical `contentHash`.

## Events and provenance

`events` is one ordered timeline with non-decreasing source and presentation
offsets. Each event declares a `provenance` that fixes its payload:

- `operator-input` — carries `input` with the submitted `text`, a relative
  typing `cadence` (`{ offsetMs, length }` steps ending at the full input
  length), and a `submitOffsetMs`.
- `tool-progress` — an allowlisted `action` with optional `resource` and
  optional portable `replayData`.
- `resource-result` — an allowlisted `action` and a content-addressed `resource`
  (`{ id, resultHash }`), with optional `replayData`.
- `assistant-text` — gated assistant `text` only.

Semantic `action` names are not defined here. The consumer supplies the
allowlist as the journey's `actionNames`; any event action outside that set is
rejected, so host-specific tool vocabularies never enter this package. A journey
must contain at least one `operator-input` event.

## Terminal outcome

`outcome` is exactly one of `completed`, `soft-timeout`, `hard-timeout`,
`error`, or `canceled` (`PRESENTATION_JOURNEY_OUTCOMES`).

## Identity

`createPresentationJourney()` normalizes and canonicalizes the record, then
derives a `contentHash` — a `sha256-<base64>` integrity over the replay-relevant
projection (everything except the self-referential `id` and `contentHash`) — and
an `id` of `presentation-journey:<contentHash>`. A provided `id` or `contentHash`
that does not match is rejected, so a tampered record fails validation.
`presentationJourneyReplayProjection()` returns exactly the projection the hash
is computed over. Because the media-evidence `action-log` node accepts a
`sha256-<base64>` `outputHash`, the journey `contentHash` binds directly into the
existing artifact graph; no second evidence graph is introduced.

## Fail-closed portability

Validation reuses the shared portable-value scan (`runtime/portable-value.js`,
also used by the media-evidence contract) and rejects forbidden or private
material anywhere in the payload: credential query strings and bearer tokens,
private keys (token, secret, password, credential, api key, cookie,
authorization, session id, reasoning/chain-of-thought, selector, xpath, element
id), absolute local paths, URLs and host addresses, non-finite numbers,
unsupported keys or types, non-monotonic offsets, invalid hashes, unknown
terminal outcomes, and inconsistent duration or time-map bounds. Path-only route
patterns are the single allowed path shape, following the existing
portable-value convention.

```js
import { createPresentationJourney } from 'symbiote-workspace/runtime';

let journey = createPresentationJourney({
  source: {
    surfaceId: 'workbench',
    routePath: '/workspace/new',
    locale: 'en-US',
    contextHash: 'sha256-S7sflEb/CCmQnS+p5x2V9sfffjCsFt35bpprQp1rPr8=',
  },
  actionNames: ['workspace.create'],
  events: [
    {
      provenance: 'operator-input',
      sourceOffsetMs: 0,
      presentationOffsetMs: 0,
      input: {
        text: 'build me a workspace',
        cadence: [{ offsetMs: 0, length: 1 }, { offsetMs: 400, length: 20 }],
        submitOffsetMs: 900,
      },
    },
    {
      provenance: 'tool-progress',
      sourceOffsetMs: 2000,
      presentationOffsetMs: 2000,
      action: 'workspace.create',
    },
  ],
  outcome: 'completed',
  timing: {
    sourceDurationMs: 8000,
    presentationDurationMs: 3000,
    segments: [
      { sourceStartMs: 0, sourceEndMs: 2000, presentationStartMs: 0, presentationEndMs: 2000 },
      { sourceStartMs: 2000, sourceEndMs: 8000, presentationStartMs: 2000, presentationEndMs: 3000 },
    ],
  },
});
```
