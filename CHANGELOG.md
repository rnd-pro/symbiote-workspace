# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

## [1.1.0] - 2026-07-17

- Release preflight now verifies the resolved lockfile nodes for the required
  engine and UI versions, including the UI package's exact engine dependency.
- Reworked the realtime builder browser smoke to resolve installed package
  exports into contained opaque routes, so release verification exercises the
  published dependency graph instead of adjacent development checkouts.
- Passed the mounted workspace's current `baseRevision` through progressive
  realtime demo updates, preserving the atomic workspace commit contract.
- Updated the packaged visual-demo component contract to the released
  `symbiote-ui` coordinate used by this workspace version.
- Exported the presenter action schedule version, constructor, and validator from
  the Node-safe root, browser, runtime, and runtime presentation entrypoints, and
  added installed-package proof that the contract source ships in the npm package.
- Raised the public peer requirements to `symbiote-engine >=0.3.0-alpha.13` and
  `symbiote-ui >=0.3.0-alpha.63`, with matching exact development requirements
  for release verification.
- Restored output-spec schema to `v3` (`workspace-presentation-output-v3`).
  Bumped composition-plan schema to `v4`
  (`workspace-presentation-composition-v4`) and caption-composition schema to
  `v2` (`workspace-presentation-caption-composition-v2`).
- Implemented strict `validatePresenterActionSchedule` structural, temporal,
  and canonical-value validation, rejecting tampered fields even when the
  caller supplies a recomputed hash.
- Added structural, property-order-independent `semanticKey` values, authored
  effective spans (`[startMs, endMs)`), and final scheduled `duplicateKey`
  values to presenter events.
- Rejected exact and overlapping same-semantic authored effective occurrences
  while preserving legal later non-overlapping repeats.
- Persisted schedule policy (`pointDurationMs`, `gapMs`) in the hashed contract.
  Every active action retains at least the readable duration (1000 ms by
  default), scheduled actions retain positive gaps, and `totalDurationMs`
  extends to the final action instead of accelerating or truncating UI motion.
- Included authored turn identity in structural semantic keys and exported each
  caption avoid region with its exact cue ID, kind, and scheduled span.
- Required exact `cueId`, `cueIndex`, and `cueKind` composition-step identity
  and positive critical attention geometry for focus and interaction cues.
- Updated `planCaptionPlacements` to require and validate `actionSchedule`, bind
  its hash into caption composition, and derive avoid regions from exact
  scheduled event intervals.

- Added the final-clock presentation solver `solvePresentationClock` inside `runtime/presentation/solver.js` (exported from `runtime/presentation.js` and `runtime/index.js`). The solver consumes an immutable `presentation-timeline-v3` timeline contract, TTS speech turn durations with Whisper word timings, source replay events, and hard causality constraints (`not-before`, `coincident`, `min-gap`), and produces a deterministic clock projection (`presentation-clock-projection-v1`) that schedules all turns, source events, and cue events using longest-path constraint propagation. Cue intervals participate in the same graph and final duration, so late UI actions extend the frame clock, short spoken spans gain elastic dwell, and contradictory cue ranges fail closed instead of being clipped. Speech and real UI motion are never compressed to fit a preset duration.

- Added the portable `text-select` presentation interaction for real browser
  text-range emphasis. Planner inference distinguishes text/range selection
  actions from existing semantic record and control `select` actions while
  retaining portable quote/range parameters and reversible execution metadata.
- Added the portable `above` annotation placement so renderers can keep marker
  ink and its cursor clear of controls immediately below the annotated target.
- Hardened presentation identity across planning, audio alignment, and captions:
  replan requests are rehashed after bounded review feedback and rejected when
  their content is stale, and `presentation-planner-input-v2` plus planner
  results bind to the exact request hash.
  `workspace-aligned-sequence-v2` retains exact speaker and transcript identity
  with an explicit migration boundary from v1; single-speaker output declares
  one `speakerId`; caption timing uses
  a public inclusive 50 ms integer tolerance; and journey validation rejects
  bare standard HTML tag selectors while retaining portable custom-element and
  semantic target addresses.
- Added a strict opt-in lesson-arc review/policy in the presentation layer (`reviewPresentationTimeline` inside `runtime/presentation.js`) with issue codes `lesson-arc-start-invalid`, `lesson-arc-body-invalid`, `lesson-arc-closure-invalid`, and `lesson-arc-final-invalid` to verify the lesson subject introduction, fact coverage, transition ordering, and grounded closing turns.
- Added versioned portable readiness receipt validator and constructor (`createPortableReadinessReceipt` / `validatePortableReadinessReceipt` / `PORTABLE_READINESS_RECEIPT_VERSION`) to bind journeys to completed terminal outcomes, admitted resources, mounted surfaces, registered capabilities, and theme/layout/fonts/embed barriers without DOM selectors or product code dependencies.
- Portable readiness is now `workspace-presentation-readiness-v2`: every receipt
  must include the journey source as a structured semantic surface address, bare
  custom-element names and DOM selectors are rejected, and obsolete v1 receipts
  cannot be silently migrated.
- Added composition orchestration caption placement planner (`planCaptionPlacements`) integrating timing calculations and focus/annotation rectangle avoid regions using the public, required `symbiote-engine >=0.3.0-alpha.13` peer. Caption plans are signed only after the complete composition audit accepts visibility, reachability, clipping, occlusion, readability, viewport, restored state, frozen simulation, scroll application, annotation placement, and required target coverage.
- Centralized composition cue coverage in `listPresentationCompositionCueSlots()` so preflight, finalization, and caption placement require matching layout evidence for focus, interaction, and annotation targets.
- Added the exact-version `workspace-presentation-journey-v1` contract in
  `runtime/presentation-journey.js`, exported from `symbiote-workspace`,
  `symbiote-workspace/runtime`, and `symbiote-workspace/browser` as
  `createPresentationJourney`, `validatePresentationJourney`,
  `presentationJourneyReplayProjection`, `PRESENTATION_JOURNEY_SCHEMA_VERSION`,
  `PRESENTATION_JOURNEY_OUTCOMES`, and `PRESENTATION_JOURNEY_PROVENANCE`. A
  journey is the portable record of one live source execution: a portable source
  binding (surface id, path-only route, locale, context hash), one ordered event
  timeline that distinguishes operator-authored input (submitted text, relative
  typing cadence, submit offset), observed tool/action progress, content-addressed
  resource results, and gated assistant text, a terminal outcome
  (`completed`/`soft-timeout`/`hard-timeout`/`error`/`canceled`), and an explicit
  monotonic time map. Each event records observed `sourceOffsetMs` and
  independently declares `presentationOffsetMs`; the time-map segments may compress
  idle waits but never stretch, `presentationDurationMs` never exceeds
  `sourceDurationMs`, and every event offset must equal the time-map projection of
  its source offset, so any retiming is proven. Semantic action names are supplied
  by the consumer as an allowlist, keeping host tool vocabularies out of the
  package. The canonical `contentHash` is a `sha256-<base64>` integrity over the
  replay projection and its `id` is `presentation-journey:<contentHash>`, so the
  hash binds directly into the existing media-evidence `action-log` node without a
  second evidence graph, and a tampered `id`/`contentHash` fails validation.
- Extracted the portable-value scan shared by the evidence and journey contracts
  into `runtime/portable-value.js` (`assertPortableValue`,
  `assertPortableRoutePath`, `PORTABLE_SECRET_KEY_PATTERN`).
  `runtime/media-evidence.js` now consumes it instead of a private copy, so there
  is one implementation of the credential, URL, absolute-path, and private-key
  rejection. The journey contract layers a stricter private-key pattern (cookie,
  bearer, authorization, session id, reasoning/chain-of-thought, selector, xpath,
  element id) over the same scan.
- Moved media render settings to `workspace-media-render-settings-v3` with a
  normalized, portable `browserAppearance`. It independently controls browser
  `chrome.visibility` (`hidden` default), `chrome.theme`
  (`system`/`light`/`dark`/`tinted`), an optional `chrome.tint` that is required
  only for `tinted` and rejected otherwise, and an independent page
  `pageColorScheme` (`system`/`light`/`dark`). Defaults are hidden/system/system.
  Hidden chrome accepts only the `system` theme; any explicit non-system theme,
  malformed `#RRGGBB` tint, tint outside `tinted`, or unknown enum fails with an
  actionable error and no silent alias. Appearance is exported as
  `normalizeBrowserAppearance`, `BROWSER_CHROME_VISIBILITIES`,
  `BROWSER_CHROME_THEMES`, and `BROWSER_PAGE_COLOR_SCHEMES`; any appearance change
  invalidates the frame cache, preview sequence, and final output so render/cache
  identity tracks it. The `workspace-media-evidence-v3` manifest settings contract
  now normalizes and retains `browserAppearance` through the same normalizer, so an
  omitted value canonicalizes to hidden/system/system, invalid appearance fails
  manifest validation, and changing appearance changes the canonical manifest
  identity. Provider, Chromium, native-chrome, and product concerns stay out of the
  package.
- Moved the presentation output and composition contracts to
  `workspace-presentation-output-v3` and `workspace-presentation-composition-v3`.
  The output spec adds neutral, finite, non-negative final-frame `frameInsets`
  (zero defaults) and derives a positive `presentationViewport {x,y,width,height}`;
  frame insets that leave no positive viewport are rejected. Safe area, content
  rectangle, and captions are now derived inside the presentation viewport rather
  than the full output frame, so a zero-inset plan preserves the previous semantic
  geometry exactly while the spec hash changes when insets change. Composition
  `measuredViewport` must equal the presentation viewport (with the existing DPR
  rules), so a non-zero-inset plan measured at full output fails closed. The
  composition audit keeps browser DOM focus/annotation rectangles page-local and
  explicitly translates them by the presentation viewport origin before
  final-frame containment and caption-collision checks; output remains the final
  video coordinate system. Explicit obsolete schema versions are rejected instead
  of being normalized and re-signed as current artifacts. Presentation preparation, rehydration, settlement, and
  context snapshots receive the page-local presentation viewport while retaining
  the full output spec as the final-video identity.
- Presentation review now proves responsive dialogue handoffs primarily from
  structured turn relationships: after a speaker change, a valid `replyTo` must
  resolve to an earlier turn by the other persona. The existing lexical signal
  remains supplementary and is Unicode-aware for localized copy; malformed,
  forward, self, and same-persona references still fail closed.
- Added deterministic `presentation-dialogue-quality-v2` pre-TTS gates for
  cross-turn n-gram/content repetition and balanced per-persona contribution,
  with portable dependency, repetition, and contribution metrics for EN/RU/ES.
- Added strict `workspace-media-evidence-v3` synthesis receipt coverage. Audio
  turns now bind provider-attested receipts to artifact hashes, personas,
  unique voice provenance, locale, and `versions.voice`, while rejecting
  biometric claims, missing coverage, and private provider fields. Receipt
  evidence additionally requires bounded acoustic-cluster speaker-probe verdicts
  with enforced thresholds and portable loudness/true-peak normalization
  evidence.
- Added the portable `workspace-virtual-sequence-v1` contract
  (`runtime/media-sequence.js`), exported from `symbiote-workspace`,
  `symbiote-workspace/runtime`, and `symbiote-workspace/browser`. It is the
  indexed playback/scrub/rerender model and declares a required `executionTier`,
  exactly one of `sequential-realtime`, `replayable-segment`, or
  `checkpointed-deterministic` (`VIRTUAL_SEQUENCE_EXECUTION_TIERS`). It carries
  encoded master segments (video codecs/containers only), playback and scrub
  proxies or bounded scrub chunks, sparse sprites/thumbnails, keyframe and
  timestamp seek indexes, audio/waveform references, and separately-invalidatable
  `base`/`overlay`/`caption`/`audio` layers with dependencies and affected ranges
  over a rational integer timebase and frameRate. A sequence has exactly one
  `base` layer covering the full duration; a `sequential-realtime` base must be
  `opaque` and invalidates its full declared range, while the cooperative tiers
  may declare a partial base range as an optimization declaration (no parallelism
  is claimed for opaque surfaces). A derived integer `ticksPerFrame` aligns every
  master range boundary, master keyframe, and encoded scrub-chunk boundary, while
  caption/overlay/audio/layer ranges stay sub-frame-capable. `index.timestamps`
  is a cheap PTS index (a complete one-entry-per-frame index is valid) that
  rejects duplicate, non-monotonic, out-of-range, and off-grid values. Bounded
  scrub chunks declare a positive `maxChunkDurationTicks` and reject any longer
  chunk. Sprite cue counts may not exceed tile capacity (`columns * rows`), cue
  ticks are globally unique, and the projection returns the selected `cueIndex`,
  `column`, and `row`. The sequence exposes a canonical `contentHash` used by its
  `id`, with layer/sprite/audio collections canonicalized so equivalent input
  order yields one identity. `projectVirtualSequenceAt()` is a deterministic
  projection at a media tick, and `invalidateVirtualSequence()` is range-aware,
  returning merged affected ranges and per-layer recomputations with downstream
  propagation stopping when a recomputation preserves a layer's output hash.
  Strict validation rejects absolute paths, URLs, credentials, parent traversal,
  unknown fields, duplicate identities/timestamps, non-monotonic seek indexes,
  master-track gaps/overlaps, image-codec encoded segments, and incompatible
  timebase/frameRate/duration data, while allowing repeated content hashes for
  static scenes. When present on a manifest the sequence is validated and bound
  into the `workspace-media-evidence-v3` canonical identity, with `frameRate`
  matching `settings.fps` and audio requiring `settings.includeAudio`. Added the
  four read-only media dispatch tools `media_sequence_validate`,
  `media_sequence_project`, `media_sequence_invalidate`, and
  `media_evidence_validate` over CLI and MCP.
- Bumped the media artifact graph to `workspace-media-artifact-graph-v2`
  (v1 is rejected outright) and added a `virtual-sequence` artifact kind. When a
  media evidence manifest carries a `virtualSequence`, the graph must contain
  exactly one ready `virtual-sequence` node whose `outputHash` equals the
  sequence `contentHash`, and a passing publication's proof/evidence dependency
  chain must transitively include that node — so a proof for one output cannot
  publish a different sequence. Passing sequence publications also require
  playback, scrub, sprite/thumbnail, and conditional audio/waveform assets, and
  evidence must start from a `quality-proof` or `proof-manifest` node rather than
  treating the sequence itself as proof. A `virtual-sequence` node with no
  manifest `virtualSequence` is rejected.

- Added the frozen `presentation-dialogue-quality-v1` review profile with shared
  EN/RU tokenization, distinct-role and reply-cohesion checks, turn pacing,
  punctuation and pronounceability gates, delivery continuity, useful semantic
  handoffs, stable issue codes, and public Node/browser exports.
- Replaced the render-time lesson contract with strict
  `presentation-timeline-v3`: explicit provider-neutral personas, grounded
  dialogue turns, any-earlier replies, ordered focus/interaction/annotation/state
  cues, and semantic speech anchors. Legacy single cues/actions and authored
  media milliseconds now fail closed. Added `workspace-aligned-sequence-v2` as a
  separately hashed post-audio artifact with complete turn/cue coverage and
  alignment provenance, and migrated browser playback, lesson audits, media
  projects, and public Node/browser exports to the new contract.
- Added a bounded, privacy-checked planner projection for responsive model
  replanning without duplicated source and target snapshots.
- Added the browser-safe `workspace-lesson-context-v2` packet, typed lesson
  facts/claims/relations, normalized WebMCP descriptors and safety hints,
  deterministic EN/RU grounding and depth audits, lesson-context-bound replans,
  output constraints, and per-action safe deepening evidence before TTS.
- Added `workspace-presentation-output-v1` and
  `workspace-presentation-composition-v1`: horizontal, vertical, and square
  30 FPS/DPR 1 output specs now define safe content and caption regions,
  language, voice sequence, and duration bounds. Target-viewport preparation
  measures real target geometry, clipping, occlusion, readability, reversible
  UI state, and scroll projections; render adoption fails closed on stale or
  rejected composition evidence, and one bounded repair must preserve lesson
  intent.
- Added strict browser-safe `workspace-media-evidence-v1` and
  `workspace-media-artifact-graph-v2` contracts with canonical cache identity,
  host-sensitive frame/encode keys, explicit timing artifacts, transitive
  invalidation, early output-hash cutoff, provenance, metrics, publication
  gates, and fail-closed privacy validation.
- Documented and covered portable cascade `themeVariant`, `tabShape`,
  `tabRadius`, and `cellRadius` params so library theme variants, tab geometry,
  and animated `cell-bg` circle sizing round-trip through `cascade-theme-change`
  without a new workspace adapter.
- Added `collectWorkspaceInterfaceContext()` to the browser entrypoint and
  `mounted.getInterfaceContext()` on mounted workspaces. Hosts and agents can now
  read a full interface map before generating a presentation/tour timeline:
  active view, hidden views, stack tabs, hidden panels, rendered status,
  declared module actions, declared WebMCP tools, and reveal actions for showing
  non-visible UI. The helper also accepts an injected WebMCP/component target
  collector, strips DOM references, de-duplicates runtime targets, merges
  portable target enrichment, and includes route/data context for data-grounded
  presentations.
- Extended `narration.timelines[]` into a validated semantic presentation
  artifact: timeline segments can carry narration, locale, stable WAS targets,
  highlight/annotation cues, safe WebMCP/host/workspace actions, data refs,
  timing hints, and required host services. Validation rejects DOM-selector
  targets, unsupported action/data sources, and stale timelines that do not
  declare `freshness: "stale"` after `provenance.revision` advances.
- Added `narration.audio.live/render/alignment` provider-profile validation for
  presentation audio. Profiles carry portable ids only, require declared host
  services, keep browser TTS live-only, and reject endpoints, credentials, local
  paths, and voice sample paths from portable configs.
- Added `playWorkspacePresentationTimeline()` plus
  `mounted.playPresentationTimeline()` so hosts can execute generated
  presentation timelines against a mounted workspace. Playback reads the same
  interface context exposed to agents, runs declared reveal actions before
  narration/focus, uses the mounted router for `view.select`, and requires a host
  `executeAction` callback for safe WebMCP/host/workspace timeline actions.
- Added `createWorkspacePresentationTimeline()` plus
  `mounted.createPresentationTimeline()` for post-build prompt-depth
  customization. The same collected interface context can now produce brief,
  full, or data-grounded semantic timelines with different segment counts,
  target coverage, narration density, and data references, without hardcoded
  product tours.
- Added post-build presentation proof to the chat-builder visual demo. After a
  workspace is constructed, the demo now reads a live interface context from the
  rendered panels, generates a data-grounded semantic timeline, plays it through
  safe WebMCP actions, and exposes a real replay control plus
  `window.__chatBuilder.presentation` evidence. The WebKit smoke asserts the
  presentation strip is visible, non-overlapping, replayable, data-referenced,
  WebMCP-driven, and free of DOM action bypasses or stuck placeholder states.
- Fixed demo proof gates uncovered by the presentation smoke: root exports now
  include the Node-safe presentation timeline helpers, settled chat seeding clears
  lingering live-status indicators, theme smoke checks the actual
  mode/color-scheme contract instead of an unset CSS variable, and the known
  LayoutNode teardown race is classified without masking real console errors.
- Synced product docs with the Phase 1 target-schema implementation: README,
  agent resource map, local agent instructions, and product docs now describe
  schema `1.0.0`, the 85-tool dispatch registry, catalog tools, server and SSR
  entrypoints, package tools, `contributes.*` plugin manifests, and
  `requires.hostServices`.
- Polished the chat-builder demo UX (following a UX audit of the live demo).
  Responsive chrome: the demo header, class tabs, and theme control now reflow
  below `@media` breakpoints (900px wrap, 600px icon-only tabs) instead of
  overlapping/clipping at narrow widths, and the workspace panels stack vertically
  below 760px (root + per-panel `responsiveMode: stack`) instead of
  scroll-compressing — so the showcase demonstrates the adaptive layout it
  advertises. The WebKit smoke now asserts no chrome overlap and panel stacking at
  720px. False states removed: the chat board cards now carry explicit resolved
  statuses (no more "Queued" on answered cards), the assembled state clears its
  live-status so no perpetual "Processing…" spinner or typing caret lingers, and a
  CSS guard keeps `sn-data-table`'s loading overlay hidden once rows are seeded (a
  symbiote-ui `DataTable` overlay sets `display:flex` and so was painting "Loading…"
  over a fully-loaded table despite its `[hidden]` gate — worked around at the demo
  layer; the upstream fix belongs in `DataTable.css.js`). The smoke now checks the
  overlay's computed visibility, not just its `hidden` attribute. One clear first
  move: the opening menu's class cards are now the real control (clicking a card
  builds that class), each shows a derived questionnaire teaser ("N questions · M
  panels"), one class is marked the recommended first build, the empty canvas shows
  a "your panels will assemble here" hint, and selecting a class now mounts its
  declared default variant (matching the teaser's panel count). Unified the header:
  the three stacked bars collapse into one — the class tabs and the live theme
  control are relocated into the SSR topbar (filling its previously-orphan
  theme-widget slot), the redundant "Chat-First Workspace Builder" title is dropped,
  and the scenario header now leads with the Layout variant chips as its clear
  primary with a dimmed answer summary. Headline capabilities made discoverable and
  honest: a visible "Relaunch from export" button (with a completion toast) surfaces
  the portability story without devtools; the aliased customization module is
  honestly titled "… (demo stand-in)"; the customization trace chips read
  outcome-first as a pipeline ("Catalog can't build this" → "New module authored" →
  "Fits the workspace" → "Preview only — not applied") with the precise terms in
  tooltips; the built-scenario composer is honest about the read-only demo; and
  seed-by-identity stops the records seeder from overwriting the stand-in (both
  custom tables now render). Theming/a11y polish: the document `color-scheme` now
  follows the active theme mode (was hard-pinned dark, so light mode leaked dark
  native chrome), `:focus-visible` uses a distinct focus token instead of the
  selection accent (so a focused-and-selected control still shows focus), the
  selected tab/chip state is stronger, the geometry register starts initialized, and
  the wordmark uses a legible text token.
- Added the customization / free-creation path to the chat-builder demo as a
  fourth `Customization` class — the one place the agent free-creates, when the
  canonical catalog cannot satisfy a requested capability. The class runs the real
  flow on throwaway sessions: `component_discover` surfaces the catalog, a
  `construction_construct` with an uncovered `requiredCapabilities` is genuinely
  rejected (`construction_capabilities_missing`), a new module descriptor is
  hand-authored, `config_patch_validate` checks its organic fit on the modules
  surface, and `config_patch_propose` previews the overlay — preview only, never
  applied, no live writes. The demo header surfaces the gap → recipe → organic-fit
  → proposed-preview trace, and the free-created module renders beside the docked
  chat (aliased to `sn-data-table` as a visible demo stand-in). Covered by new
  headless tests over the construction protocol (the missing → provided-capability
  round trip, modules-surface patch routing) and the WebKit smoke.
- Proved workspace portability live in the chat-builder demo. A constructed
  variant can now be relaunched from its exported portable JSON: the runtime
  imports `variant.exportJson` in-browser via `importConfig`, cold-tears the live
  `panel-layout` (removes the node), and mounts a brand-new container seeded
  solely from that artifact — so "export → teardown → relaunch in a fresh host"
  is observable, not just covered headless. The WebKit smoke asserts the original
  layout is torn down, the panel set / chat-on-right / theme token survive the
  round-trip, and the relaunch is sourced from the export with no navigation. The
  headless round-trip test now asserts the imported config matches the in-memory
  build config's full layout tree (split direction/ratio/order at every node) and
  theme block, and the strict relaunch harness now covers every chat-builder
  variant.
- Hardened the SSR entry, the construction error surface, and the chat-builder
  demo. `renderWorkspaceShell()` is now serialized behind a single-flight lock so
  overlapping calls share one in-flight render instead of racing the shared Node
  SSR globals, and its `SSR.init`/`processHtml`/`SSR.destroy` sequence runs under
  `try`/`finally` so a failed render always tears the environment down and clears
  the lock (it remains build-time-only). The chat-builder class menu and variant
  chips are now a fully modelled tab pattern — `aria-selected` with roving
  `tabindex`, arrow-key/Home/End navigation, `aria-controls` to the stage
  `tabpanel`, and `:focus-visible` outlines — and the theme control exposes its
  hue value and is keyboard-operable; the demo runtime now throws on a missing
  stage host, surfaces unseeded component tags, and warns when the SSR host is
  absent instead of failing silently. Added headless coverage for the dispatch
  error paths (unknown tool, invalid construction question/answer, invalid and
  not-ready handoffs) and for SSR render serialization and failure recovery, and
  the WebKit smoke now asserts keyboard operability and a bounded teardown-error
  count.
- Added an opt-in SSR entry point, `symbiote-workspace/ssr`. `renderWorkspaceShell()`
  server-renders the workspace shell chrome (topbar + stage host) to HTML at
  build time via `@symbiotejs/symbiote/node/SSR.js`; the `workspace-shell`
  component hydrates that markup in place on the client through `isoMode`, so
  first paint shows the shell before the app boots and data-driven panels mount
  client-side (no double render). `@symbiotejs/symbiote` and `linkedom` are
  declared as optional peer dependencies (only needed for SSR). The chat-builder
  demo and its WebKit smoke prove SSR first paint and single-shell hydration.
- Added a chat-first, questionnaire-driven construction demo
  (`npm run demo:chat-builder`). It starts with a single chat that offers a
  workspace-class menu (Programming / Video / Automation); selecting a class
  drives the real construction protocol on one session — `construction_classify` →
  `construction_questions_build` → `construction_question_answer` →
  `construction_plan` → `construction_construct` — so the system places panels from the
  canonical template (the agent answers offered options, it does not decide
  placement). The chat is docked as a global right-hand panel at full height with
  full layout behavior (importance, min sizes, collapse, overflow, responsive
  mode), and the workspace renders real Symbiote UI components per template via
  the `panel-layout` runtime under the Cascade theme. Each class offers two or
  three constructed variants (different module selections) surfaced as a real
  interactive choice that re-mounts with no reload, and a live theme control
  (mode, hue, geometry register) re-applies the Cascade color/geometry/motion
  scales. Each class also answers `layout-topology` (programming → workbench,
  video → studio, automation → grid) so the workspace side is arranged to fit the
  class instead of the bare template default, and the demo header is a single tidy
  bar (layout chips + condensed answer summary + theme control). Covered by
  `tests/chat-builder-demo.test.js` and an opt-in WebKit smoke
  (`npm run test:chat-builder-browser`).
- Moved the served visual-demo import map into a shared `demoImportMap()` helper
  in `examples/visual-demo/server-utils.js`, with the direct browser specifiers
  sourced from the public browser contract.

## [1.0.0] - 2026-06-20

- Added `llms.txt` as a compact agent-facing resource map and included it in
  the published package.
- Split the public README reference material into focused docs, added a
  realtime-builder screenshot to the README, and included the docs assets in
  the published package.

- Aligned npm package metadata and README introduction with the RND-PRO package
  public-description style used by `rnd-pro/jsda-kit`: concise value
  proposition first, practical overview, `Why`, `What is`, and grouped
  `Key Features`, with no pre-publication status language in public docs.
- Hardened `npm run release:preflight` so stable release gates now verify both
  `package-lock.json` top-level version and root package version against
  `--target-version`.
- Extended `npm run release:preflight` with non-publishing npm identity and
  registry checks. Stable release gates now verify `npm whoami`, detect already
  published target versions, require explicit `--allow-new-package-name` for
  first-publication `E404`, and keep local/offline skips available through
  `--skip-npm-auth` and `--skip-npm-registry`.
- Added `npm run release:preflight` as a non-publishing stable-release gate. It
  verifies package metadata, dated changelog release headings, the live dispatch
  registry with `module_workflow_kanban`, project-owned `.mjs` absence, install/test
  gates, package-consumer proof, npm pack hygiene, realtime-builder browser
  proof, and clean git state before a stable tag or publish attempt.
- Added `module_workflow_kanban` as the workflow-board CLI/MCP dispatch tool. It
  registers a portable workflow board panel backed by provider-owned
  `symbiote-ui` `sn-kanban-board`, with board state, wires,
  select/action/drop event routes, optional layout upserts, and
  host-service portability validation.
- Hardened `module_workflow_kanban` and config validation so canonical provider module
  metadata cannot be overridden by stale descriptors, event mappings must be
  plain objects, and responsive behavior numeric fields respect the published
  layout contract.
- Added a portable lockfile-backed install gate for local verification through
  `npm ci --ignore-scripts` before package-consumer and browser proof checks.
- Added an opt-in Playwright driver for the visual/realtime browser smoke
  harness so CI can verify the same generated demo proof through WebKit,
  Firefox, or Chromium when local Chrome DevTools Protocol automation is not
  available.
- Extended the realtime builder demo from broad mock stages into the canonical
  9-question construction protocol, including visible execution model, host
  services, package readiness, and browser import-map evidence in both the
  runtime UI and generated contract.
- Added constructor-owned `construction.plan.layout.regions` evidence and a
  default chat dispatch proof that strict package export/import preserves the
  chat layout topology, selected Symbiote chat modules, and named regions.
- Added `mountWorkspace().updateConfig()` and `mountWorkspace().applyPatch()`
  browser APIs for validated no-reload workspace updates that preserve the
  mounted wrapper, reapply theme state, and delegate updates to runtime
  controllers when available.
- Updated the realtime builder demo to advance stages through atomic mounted
  updates while keeping a stable `panel-layout` instance and exposing
  `runtimeInstanceId`, `atomicUpdateCount`, and `lastUpdatedStage` DOM evidence.
- Updated realtime browser smoke assertions to verify the layout/chat/Cascade
  library primitives, reject old local demo surfaces, check app-level Shadow
  DOM drift, and validate atomic update evidence plus mobile drawer behavior.
- Extended realtime browser smoke evidence with explicit no-navigation history
  checks, per-stage atomic update counts, and mobile DOM identity preservation.
- Extended realtime builder smoke evidence with a mid-stream Cascade theme
  transition during mounted playback, proving theme writeback survives atomic
  stage updates without replacing the workspace runtime.
- Extended the realtime builder handoff with portable `symbiote-ui` module
  capability descriptors and `construction.plan` metadata for layout topology,
  regions, actions, toolbar items, settings, events, wires, slots, adaptive
  priorities, and dark Cascade theme handoff.
- Added a realtime chat-state visual demo that plays mock questionnaire state
  into service-builder workspace layouts, required widgets, wires, adaptive
  metadata, validation reports, and the required theme editor widget.
- Added an inspectable realtime demo contract with a chat-state timeline and
  acceptance matrix covering the required builder panels, adaptive behavior,
  validation checklist, and theme editor widget.
- Added a realtime build stream and progress indicator to the chat-state demo
  so Play visibly applies staged workspace patches from the mock chat state.
- Extended the opt-in browser smoke harness with a realtime-builder mode that
  clicks Play and verifies the final operation-level build state through CDP.
- Added construction lineage evidence to the realtime builder demo contract,
  including canonical questionnaire IDs, module capability coverage, decision
  traces, verification reports, and strict export/import evidence.
- Added adaptive viewport preview evidence to the realtime builder demo so
  wide, tablet, and mobile scenarios expose visible, docked, collapsed, and
  protected panels, including the required theme editor widget.
- Added stable adaptive/theme runtime evidence attributes and contract metadata
  for responsive mode, breakpoint, theme mode, theme editor state, and theme
  editor subtree binding.
- Updated the realtime builder demo runtime to mount the generated workspace
  through Symbiote UI `panel-layout` with chat-driven custom element modules
  and the default cascade theme instead of showing only fallback preview cards.
- Reworked the realtime builder demo shell to match the playground/studio
  pattern: compact header controls plus a full-viewport Symbiote UI layout
  built from library elements including `chat-workspace`,
  `cascade-theme-editor`, `sn-card`, `sn-description-list`, `sn-badge`,
  `sn-button`, and `sn-segmented-control`.
- Updated visual demo serving to prefer the canonical dev-plane
  `symbiote-ui`/`symbiote-engine` checkouts and to serve
  `@symbiotejs/symbiote` from a stable dependency route for browser imports.
- Added an opt-in visual-demo browser smoke script that launches the packaged
  demo through a Chrome-compatible DevTools Protocol session and verifies the
  mounted workspace DOM without changing the default test command.
- Bounded visual-demo browser smoke WebSocket handshakes and CDP commands with
  the configured timeout so unavailable or stalled browser automation exits
  with diagnostics and cleanup instead of hanging.
- Replaced pre-publication CLI help examples with local `node cli.js` commands,
  matching the current pack-based verification flow before npm publication.

### Added

- **Construction execution model** — constructor questions now include a
  portable `execution-model` choice (`ui-only`, `graph-execution`,
  `server-session`, `remote-provider`, `mobile-executor`, or
  `automation-bridge`). Plans and configs preserve the selected value in
  `plan.execution.model`, `config.intent.executionModel`, and
  `config.execution.model`. Constructor questions also include
  `required-host-services`, preserving portable host service IDs in
  `plan.answers.hostServices`, `plan.execution.hostServices`, and
  `requires.hostServices`, while keeping selected-module host service
  requirements visible in construction diagnostics.
- **Pre-publication package status** — README package instructions now describe
  the current pack-based consumer verification path and local `node cli.js`
  commands instead of presenting npm registry install or `npx` commands before
  the package is published.
- **Construction questionnaire tools** — `construction_classify` now returns the
  normalized intent, initial questionnaire, readiness, and next action, while
  `construction_questions_build` and `construction_question_answer` expose the
  questionnaire step directly through dispatch, CLI, and MCP without planning
  or mutating session state.
- **Workspace package format** — `exportWorkspacePackage(config, manifest)`,
  `importWorkspacePackage(json)`, and `validateWorkspacePackage(packageObject)`
  wrap portable workspace configs with manifest metadata, host integration
  contracts, dependency lists, and asset references for distribution and
  discovery. Manifest validation rejects host identity keys (token, secret,
  session, user, credential), marketplace state (price, seller, license key or
  server, purchase), and non-portable values (URLs, absolute paths) in
  dependency and asset fields.
- **Package inspection helper** — `inspectWorkspacePackage(input, options)`
  inspects a workspace package object or JSON string and returns `valid`,
  `ready`, structured summary, compatibility, dependency requirements, and
  missing items plus compact `readiness.nextAction` diagnostics. Accepts an
  optional host-neutral `options.available` inventory for capability gap
  detection without marketplace or install semantics. Exposed as
  `inspect_workspace_package` in the unified dispatch registry, CLI, and MCP
  surface.
- **Package construction context helper** —
  `createWorkspacePackageConstructionContext(input, options)` projects valid
  workspace packages into constructor-ready `workspaceTemplates`,
  `moduleCapabilities`, required capability tags, source metadata, and compact
  readiness diagnostics without installing packages, activating plugins, or
  applying marketplace semantics.
- **Package intent preparation helper** —
  `prepareConstructionIntentWithPackageContext(intent, context)` is now part of
  the root, sharing, and browser entrypoints so hosts can inspect the cloned
  constructor intent with package-required capabilities merged before creating a
  handoff.
- **Constructor capability diagnostics** — construction plans now include
  `capabilities.byCapability` with selected coverage and ranked unselected
  module alternatives for unmet required capabilities. Plans also include
  `capabilities.selectedModules` so explicit selected modules that do not cover
  a required capability remain visible to orchestration diagnostics.
- **Construction readiness alternatives** — `construction_plan` and
  `construction_construct` now include ranked module alternatives in top-level
  `readiness.recovery[]` entries when required module capabilities are missing.
  Failed construction responses also include the rejected construction
  `plan` for selected-module diagnostics.
- **Module capability schema exports** — module capability schema constants and
  validator helpers are now available from the schema, root, browser, and
  plugins entrypoints so consumers can validate plugin-provided descriptors
  without reaching into private files.
- **Module provider portability validation** — module descriptor `provider` and
  `descriptor.package` references now reject URL, file, and local path values
  before plugin-provided descriptors reach construction or package handoff
  surfaces.
- **Module action shell materialization** — generated constructor panel modules
  now expose descriptor actions, toolbar items, and menu items through
  module shell actions, preserving authored menu actions on existing panels
  while carrying command/event metadata for host shells.
- **Layout topology materialization** — constructor `layout-topology` answers
  now shape the executable BSP `config.layout` for selected module panels
  instead of living only in construction plan metadata.
- **Named layout cross-reference validation** — `validateWorkspaceConfig()`
  now applies panel cross-reference warnings to every `layouts.*` BSP tree,
  matching the root `layout` validation contract.
- **Module slot shell materialization** — workspace configs now define and
  validate panel slots; selected constructor module descriptors materialize
  portable `slots[]` onto generated and selected existing panels while
  preserving authored panel slots.
- **Module event and wire materialization** — selected constructor module
  descriptors now expose emitted events and selected event consumers as
  `wires[]` records for portable host/runtime handoff.
- **Module engine handoff metadata** — workspace configs now define and
  validate portable `engine.packs[]`, `engine.graphs[]`, and
  `wires[]`; selected descriptor actions, settings, events, and wire contracts
  can materialize engine handoff metadata without importing or
  executing `symbiote-engine`. Validation now checks referenced node IDs when
  they target authored graph JSON, while preserving external host-provided
  graph references.
- **Module state field contract** — workspace configs now define and validate
  portable top-level `state.fields[]` records. Selected descriptor `state[]`
  declarations materialize into executable config state fields, and optional
  state engine metadata materializes into `wires[]` with
  `surface: "state"`.
- **Scoped theme construction contract** — `validateWorkspaceConfig()` now
  validates cascade theme `params`, `relations`, token `overrides`, and scoped
  `subtrees[]`; construction plans carry subtree theme layers alongside root
  theme metadata for portable host mounting.
- **Construction verification reports** — `planWorkspaceConstruction()` now
  records verification reports under `plan.verification.reports` and mirrors
  them to `config.validation.reports`, composing existing portability, design
  guardrail, module capability, and package/host readiness checks.
- **Module setting materialization** — generated constructor panel modules and
  selected existing panels now expose descriptor settings while preserving
  authored panel settings.
- **Data wire contract validation** — workspace schema and
  `validateWorkspaceConfig()` now define and validate portable
  wire records with panel, component, direction, path, and value schema
  metadata.
- **Package readiness propagation** — package construction handoffs now carry
  `options.packageContext`, and construction plans preserve it as
  `plan.packageContext` plus `config.construction.packageContext` so agents can
  see source, readiness, missing capabilities, and warnings after planning.
- **Construction handoff readiness contract** —
  `pack_handoff_create` now mirrors package `readiness` and
  `nextAction` at the top level across dispatch, CLI, and MCP responses.
- **Package-derived handoff construction parity** — dispatch and MCP tests now
  cover real exported packages flowing through construction context, handoff,
  `construction_plan`, `construction_construct`, and exported config output while
  preserving package-provided templates and module descriptors.
- **Package readiness summary** — construction plans now include
  `plan.readiness.package` with validity, readiness, source count,
  missing/warning/error counts, and a next-action hint for package-driven
  workspace assembly.
- **CLI construction handoff ingestion** — `construction-plan` and
  `construction-construct` now accept a full `{ intent, options }` construction
  handoff object as a single positional JSON argument, matching dispatch and
  MCP behavior.
- **MCP UTF-8 framing** — the stdio MCP server now parses incoming
  `Content-Length` frames by byte length, preserving non-ASCII JSON-RPC
  payloads across tool calls.
- **Unknown tool session hygiene** — `dispatch()` now returns unknown-tool
  errors before any session initialization, so invalid tool calls cannot seed a
  blank workspace state.
- **Construction classifier error parity** — `construction_classify` now returns
  the same structured construction error envelope as adjacent construction
  tools for malformed intent objects instead of throwing before dispatch can
  respond.
- **Config load file error parity** — `config_load` now reports file-read
  failures as structured dispatch/MCP tool errors without initializing session
  state, keeping CLI/MCP recovery behavior aligned with normal tool failures.
- **Visual demo process** — packaged `examples/visual-demo/preview.js` builds
  the `video-studio` workspace through the public construction flow, verifies
  strict export/import relaunch, writes preview artifacts, and can serve a local
  browser preview URL. Browser mounting now renders portable layout/panel DOM by
  default when no host runtime controller is supplied, with styled split and
  panel fallback surfaces for the generated visual preview.
- **Construction handoff sentinel and ready gate** —
  `pack_handoff_create` now returns `_type: "workspace-construction-handoff"`
  and `construction_construct` rejects `ready: false` handoffs while
  `construction_plan` still returns diagnostics.
- **Ready-gate diagnostics** — not-ready construction handoff errors now include
  `code`, `nextAction`, and a structured `readiness` payload for agent recovery.
- **Stale handoff ready gate** — `construction_construct` now rejects older
  handoff payloads that omit `ready` but still carry missing capabilities or
  warning diagnostics.
- **Package validation transport errors** — invalid
  `pack_validate` results now include `status: "error"`, `code`,
  and `nextAction` while preserving `valid: false` and validation `errors`, so
  CLI and MCP transports can signal failure consistently. The validation tool
  now also accepts package JSON strings through the same `json` input used by
  related package inspection and construction-context tools.
- **Invalid handoff diagnostics** — invalid construction handoff errors now
  include `code`, `nextAction`, and a blocked `readiness` payload so agents can
  route recovery to package-context fixes instead of readiness review.
- **Invalid helper intent diagnostics** —
  `pack_handoff_create` now returns
  `code: "construction_handoff_intent_invalid"` and
  `nextAction: "fix-construction-intent"` across dispatch, CLI, and MCP when
  helper intent inputs are malformed.
- **Top-level construction readiness** — successful `construction_plan` and
  `construction_construct` responses expose the highest-priority recovery summary
  as top-level `readiness`: package readiness for package gaps, or required
  module capability readiness when a ready package still leaves unmatched
  capabilities. Not-ready package readiness now carries missing capability
  groups, recovery steps, diagnostics, and source metadata at the top level.
- **Construction readiness hardening** — package readiness is no longer marked
  ready when missing requirements, warnings, or errors are still present, and
  `construction_plan` now exposes blocked top-level readiness for missing required
  module capabilities when no package context owns the recovery route.
- **Selected-module materialization cleanup** — construction now removes
  unselected generated external modules from the executable panel surface and
  normalizes layout references after module selection prunes named layouts. It
  also prunes existing wires, state fields, and engine handoff records that
  reference unselected panels.
- **Top-level construction verification** — successful `construction_plan` and
  `construction_construct` dispatch, CLI, and MCP responses now expose
  `verification` as a top-level mirror of `plan.verification`.
- **Validation report shape** — `validation.reports` and
  `construction.plan.verification.reports` now reject malformed report entries,
  and package readiness verification reports use the same `pass | warn |
  blocked` status contract as other construction reports.
- **Missing-capability recovery hints** — readiness diagnostics now include
  deterministic `recovery` steps for missing package capabilities so agents can
  choose component, plugin, package, host-service, or runtime-slot remediation.
- **Package collection construction context helper** —
  `createWorkspacePackagesConstructionContext({ packages, available })`
  aggregates package objects and JSON entries into one constructor-ready context
  with duplicate template/module conflict detection. Exposed as
  `pack_contexts_create` in dispatch/MCP and `pack-contexts-create` in the CLI.
- **Package construction handoff helper** —
  `createWorkspaceConstructionHandoff(context, intent)` converts package
  construction contexts into the `{ intent, options }` pair consumed by
  `planWorkspaceConstruction()`, including required capability handoff.
  Exposed as `pack_handoff_create` in dispatch/MCP and `pack-handoff-create`
  in the CLI.
- **Plugin metadata dispatch tools** —
  `pack_plugin_modules_collect` and
  `pack_plugin_templates_collect` expose existing plugin metadata
  collectors through dispatch, CLI, and MCP without activating plugins or
  initializing workspace session state.
- **Construction protocol** — `intent`, `construction.questions`,
  `construction.plan`, `patches`, `validation.reports`, `runtime`, `exports`,
  and `design` are now accepted workspace config fields.
- **Construction workflow tools** — unified CLI/MCP dispatch now exposes
  construction and config-patch tools for agent-guided construction and
  mutation.
- **Patch validation bridge** — workspace patch validation can use the
  Node-safe `symbiote-ui/rules/design-policy.js` bridge for theme/design
  diagnostics, hard blocks, soft warnings, and suggested patches.
- **Expanded design registers** — `admin`, `editor`, `agent-workspace`, and
  `media-studio` join the existing `tool`, `brand`, and `presentation`
  registers, with density guardrails for each register.
- **Browser theme mounting** — `mountWorkspace()` now validates config, creates
  a workspace wrapper, applies root and subtree theme layers, and writes
  `cascade-theme-change` params, relations, and overrides back into workspace
  config.
- **Segmented browser preview** — `preview_start` now validates import maps,
  writes `preview.contract.json`, checks browser import-map support, passes
  `symbiote-ui/ui.applyCascadeTheme` into `mountWorkspace()`,
  renders loader warnings, writes sanitized portable config into preview
  runtime files, and preserves separate import-map, module-load, and mount
  error messages.
- **Host integration contract** — `createHostIntegrationContract()` describes
  chat construction tools, browser import-map requirements, derived
  engine-backed persistence services, module host services, and portable
  runtime slots for a portable workspace config.
- **Package-derived relaunch preservation** — constructing from package-derived
  templates now preserves source validation reports alongside newly generated
  construction verification reports.
- **Theme relations** — workspace config now carries portable
  `theme.relations` and subtree relations alongside params and token overrides.
- **Package consumer verification** — `npm run test:package-consumer` now packs
  `symbiote-workspace` and the installed `symbiote-ui` substitute into a
  temporary consumer, then verifies public entrypoints, CLI, construction,
  export, host contract, and MCP stdio behavior without npm publication.
- **External module materialization** — construction `moduleCapabilities` can
  now create missing panel types from placement metadata, place selected
  generated panels into BSP layout, validate executable placement metadata, and
  round-trip through CLI and MCP construction flows.
- **Plugin capability collection** — `collectPluginModuleCapabilities()` and
  `listPluginModuleCapabilities()` expose plugin-provided module descriptors
  as portable constructor inputs through the plugins, root, and browser
  entrypoints.
- **Plugin workspace template collection** —
  `collectPluginWorkspaceTemplates()` and `listPluginWorkspaceTemplates()`
  expose validated plugin template entries for plugin-provided
  workspace template catalogs.
- **External workspace template construction** — constructor APIs and unified
  dispatch can accept plugin-neutral `workspaceTemplates` inputs, validate them
  as strict portable workspace configs, classify by template metadata, and
  construct configs through `construction_plan`, `construction_construct`, and CLI
  `--workspace-templates` without importing plugin registry code.
- **Collaboration room template verification** — tests now cover portable
  command chat, team room, and voice/video room plugin templates through
  strict export/import/relaunch, host integration contracts, and packed
  consumer construction without npm publication.

### Changed

- **Unified dispatch surface** — CLI and MCP expose one shared tool registry
  from `runtime/dispatch.js`.
- **CLI help source** — CLI tool-command help is now generated from the
  unified `TOOLS` registry descriptions, with CLI command names documented from
  the command map.
- **Package consumer verification** — packed-consumer tests now assert the
  actual npm pack file list before install, including exported entrypoints and
  exclusion of tests, private coordination files, cache, temp, and tarball artifacts.
- **Construction handoff dispatch** — `construction_plan` and
  `construction_construct` now accept the full `{ intent, options }` handoff
  object returned by `pack_handoff_create`; CLI
  `construction-plan` and `construction-construct` also accept constructor
  `--options`.
- **Browser entrypoint boundary** — `symbiote-workspace/browser` now exports
  browser-safe APIs without statically pulling Node-only runtime dispatch code.
- **Export/import portability** — portable exports preserve construction
  metadata, validation reports, and theme relations while stripping host/local
  fields by default; strict exports now reject host-only state before
  sanitizing so relaunch flows cannot hide local paths, sessions, endpoints, or
  user identity. Imports and file loads reject host/local-only payloads,
  generic server URLs, and user identity fields.
- **CLI config loading** — stateful `--config` file loads now use the same
  strict portable import path as `config_load` before CLI tools run.

### Fixed

- **Package collection readiness** — empty multi-package construction context
  inputs now return blocked readiness diagnostics and `nextAction:
  "fix-package-context"` through the sharing helper, dispatch, and MCP instead
  of a raw invalid result without recovery guidance.
- **Export/import portability aliases** — strict export/import checks now
  reject normalized host/local field aliases such as `server_url`,
  `workspace_root`, `file_path`, and `apiEndpoint`, while preserving portable
  module `path` fields.
- **Test artifact hygiene** — package-consumer tests now isolate npm cache
  inside ignored per-test `tmp` directories, and CLI/dispatch file I/O tests
  no longer write scratch JSON files at the repository root.
- **Construction handoff validation** — `construction_plan` and
  `construction_construct` now reject invalid diagnostic handoff envelopes before
  planning, preserving session state and returning structured dispatch errors
  through both direct dispatch and MCP.
- **Package public surface metadata** — package metadata now marks executable
  CLI and MCP entrypoints as side-effectful while keeping library modules
  tree-shakeable; packed-consumer coverage verifies the handlers subpath and
  side-effect metadata, and README entrypoint docs now list all public subpath
  exports.
- **Workspace package validation** — `validateWorkspacePackage()` now returns
  structured `host.contract` errors when the contract is missing and compares
  equivalent host contracts independently of object key order.
- **MCP tool metadata** — `tools/list` now exposes `annotations.readOnlyHint`
  while keeping internal `mutates` and file-writing flags private.
- **CLI help** — removed the misleading global `--json` output flag from help;
  package commands keep their command-specific `--json <string>` input option.
- **Planning error surface** — `construction_plan` now returns structured
  dispatch errors for invalid constructor input instead of leaking planner
  exceptions to CLI/MCP callers.
- **Construction module validation** — direct `moduleCapabilities` constructor
  inputs now use the shared module descriptor validator and reject duplicate
  direct descriptors before materialization.
- **MCP test timing** — MCP protocol tests now wait for expected JSON-RPC
  responses instead of relying on short fixed timers.

## [0.3.0-alpha.2] - 2026-06-10

### Added

- **Unified Dispatch Layer** (`runtime/dispatch.js`) — single source of truth for the tool definitions and dispatch logic. Both CLI and MCP call the same `dispatch(toolName, args, session)` function.
- **Stateful Session** (`runtime/session.js`) — in-memory config session with `load()`, `save()`, `ensure()` lifecycle.
- **Input Validation** — dispatch validates required arguments before calling handlers. Returns `{ status: 'error', hint: 'Missing required arguments: ...' }` for invalid calls.
- **CLI `--config` flag** — stateful CLI mode. Loads config from file, dispatches tool, auto-saves on mutations.
- **Expanded MCP/CLI tools** — full handler coverage:
  - `reorder_groups`, `reorder_sections`
  - `update_panel_type`, `toggle_menu_action`
  - `get_behavior`, `update_behavior`
  - `mount_widget`, `unmount_widget`, `swap_widget`
  - `bridge_event`, `unbridge_event`, `list_bridges`
  - layout behavior update
  - config validation, save, and load
  - scaffold from scratch
  - config export, import, diff, and merge
  - `check_guardrails`
- **MCP Protocol Tests** (`tests/mcp.test.js`) — 6 tests covering JSON-RPC handshake, tools/list, tools/call, session persistence, error handling.
- **Discovery Caching** — 30s TTL cache for `findComponent`, `listComponentTags`, `listCategories` to avoid redundant FS scans.
- **`runtime` entry point** (`symbiote-workspace/runtime`) — exports `dispatch`, `TOOLS`, `isMutating`, `createSession`.

### Changed

- **MCP Server** — reduced from 671 to 136 lines (−80%). Now a pure JSON-RPC transport layer delegating to `runtime/dispatch.js`.
- **CLI** — rewritten as thin proxy to dispatch. All registered tools are available via kebab-case commands.
- **Layout readers** — use the current BSP format (`panel`/`split` with `first`/`second`) without `children[]` compatibility traversal.
- **`listUsedComponents()`** — now collects from layout and module surfaces. Returns `{ components, count }`.
- **`bridgeEvent()`** — config-derived ID generation instead of global counter (works across stateless CLI invocations).
- **`findComponent()`** — returns `{ status: 'not_found' }` for unknown tags instead of bare `null`.
- **`listCategories()`** — returns `{ categories, count }` wrapper for consistency.
- **Preview handler** — fixed `mountWorkspace` import (was `materializeWorkspace`).
- **README** — rewritten with unified architecture, 50-tool reference, BSP layout examples.

### Fixed

- Bridge ID collision in CLI stateless mode (global counter → config-derived).
- MCP `serverInfo.version` synced with `package.json`.

## [0.2.0] - 2026-06-09

### Added

- Plugin system (schema, registry, lifecycle)
- Config portability (export, import, diff, merge)
- Design guardrails (register density, panel limits)
- Server mode with plugin loader
- Component discovery (filesystem introspection)
- Event bridge system

## [0.1.0] - 2026-06-08

### Added

- Initial release
- Schema + validation
- BSP layout engine
- Template-based scaffolding
- CLI (scaffold, validate, serve, plan)
- MCP server (28 tools)
