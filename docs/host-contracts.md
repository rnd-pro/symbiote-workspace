# Host Contracts and Construction Protocol

## Portable Relaunch And Host Contract

Use strict export for configs that must be saved, shared, and relaunched by a
different host:

```javascript
import {
  createHostIntegrationContract,
  exportConfig,
  importConfig,
} from 'symbiote-workspace';

let exported = exportConfig(config, { strict: true });
if (!exported.json) {
  throw new Error(exported.errors.map((error) => error.message).join('; '));
}

let imported = importConfig(exported.json);
let contract = createHostIntegrationContract(imported.config);
```

Default export mode strips host/local and user identity fields from the exported
JSON. Strict mode rejects host-only state before sanitizing, so release and
relaunch flows cannot hide local paths, sessions, endpoints, user identity, or
host payloads.

`createHostIntegrationContract(config)` returns host-readable metadata for a
portable config:

- construction and config tools: `construction_classify`,
  `construction_questions_build`, `construction_question_answer`,
  `construction_plan`, `construction_construct`, `config_patch_validate`,
  `config_patch_apply`, `config_export`, and `config_import`;
- standalone browser requirements: import-map entries for
  `symbiote-workspace/browser`, `symbiote-ui/ui`, `symbiote-engine`, and
  `symbiote-engine/contracts`, plus `mountWorkspace()` and
  `symbiote-ui/ui.applyCascadeTheme`;
- persistence requirements from `requires.hostServices`;
- module, runtime-slot, and package requirements from `modules[]` and
  `requires{}`.

The contract is metadata only: it lists service IDs and import specifiers, never
credentials, user identity, URLs, local paths, or product code.

## MCP

Start as MCP server:

```bash
node cli.js mcp
```

The MCP transport exposes the same 89 tools as the CLI. Both are thin proxies
to `dispatch(toolName, args, session)`.

## Tools Reference

| Category | Tools |
|----------|-------|
| Discovery | `workspace_describe` `component_discover` `component_find` `component_tags_list` `component_categories_list` `component_usage_list` |
| Construction | `construction_template_list` `construction_scaffold` `construction_scaffold_blank` `construction_classify` `construction_questions_build` `construction_question_answer` `construction_plan` `construction_construct` |
| Structure | `layout_set` `panel_add` `panel_remove` `panel_resize` `module_register` `module_update` `module_unregister` `module_list` `layout_behavior_set` `layout_behavior_get` `layout_behavior_update` `panel_component_mount` `panel_component_unmount` `panel_component_swap` `module_workflow_kanban` |
| Config | `config_patch_propose` `config_patch_validate` `config_patch_apply` `preview_start` `config_validate` `config_save` `config_load` `config_export` `config_import` `config_diff` `config_merge` `config_guardrails_check` |
| Package | `pack_export` `pack_import` `pack_validate` `pack_inspect` `pack_context_create` `pack_contexts_create` `pack_handoff_create` `pack_plugin_modules_collect` `pack_plugin_templates_collect` |
| Route | `navigate` `resolve_route` |
| Document | `collection.list` `collection.query` `collection.create` `collection.delete` `document.load` `document.commit` `document.patches` `document.delete` `document.snapshot` `document.presentation.save` `document.presentation.load` |
| Session | `workspace.session.load` `workspace.session.commit` `workspace.session.snapshot.save` `workspace.session.snapshot.load` `workspace.session.snapshot.list` `layout_promote_geometry` `session.layout.undo` |
| Hook | `hook_add` `hook_update` `hook_remove` `hook_list` `preview_hook_matches` |
| Grant | `grant_list` `grant_revoke` |
| Execution | `execution_submit` `execution_cancel` `execution_reorder` `execution_attach` `execution_list` |
| Catalog | `catalog_search` `catalog_describe` `catalog_proof` |
| Media | `media_sequence_validate` `media_sequence_project` `media_sequence_invalidate` `media_evidence_validate` |

Mutating tools require `baseRevision`; dispatch rejects mutations that omit it
or race the current session revision.

## Target Workspace Config

The target schema version is `1.0.0`. The structural surface is a root stack of
`views[]`, named `layouts{}`, `panels{}`, `modules[]`, `requires{}`, `wires[]`,
`state`, `routes`, `behavior`, and optional `server` declarations.

```json
{
  "version": "1.0.0",
  "name": "Records",
  "requires": {
    "packages": [{ "id": "symbiote-ui", "version": "^4" }],
    "hostServices": {
      "required": ["storage.project"],
      "optional": []
    }
  },
  "modules": [
    {
      "id": "symbiote-ui:data-table",
      "source": { "kind": "package", "package": "symbiote-ui", "export": "DataTable" },
      "tagName": "sn-data-table",
      "title": "Records",
      "capabilities": ["data.table"],
      "actions": [
        { "id": "refresh", "label": "Refresh", "does": { "kind": "emit", "event": "refresh" } }
      ],
      "hostServices": {
        "required": ["storage.project"],
        "optional": []
      }
    }
  ],
  "panels": {
    "records": {
      "module": "symbiote-ui:data-table",
      "title": "Records",
      "menu": [{ "ref": "action:refresh" }]
    }
  },
  "layouts": {
    "records-main": {
      "kind": "bsp",
      "root": { "type": "panel", "id": "records-leaf", "panel": "records" }
    }
  },
  "views": [
    {
      "id": "records",
      "title": "Records",
      "layout": { "$layout": "records-main" },
      "lifecycle": "durable"
    }
  ],
  "state": {
    "fields": [
      { "id": "records.selection", "type": "object", "persistence": "ephemeral" }
    ]
  },
  "wires": [
    {
      "id": "select-record",
      "from": "panel:records:records-leaf#event:row-select",
      "to": "state:records.selection"
    }
  ],
  "validation": { "reports": [] }
}
```

Deleted top-level structure keys are rejected by validation. Module source
dependencies are declared in `requires.packages`, `requires.plugins`, and
`requires.packs`; aggregate host services are declared in
`requires.hostServices`.

## Construction Protocol

The constructor protocol is designed for agents that build workspaces from
declared modules instead of editing application code directly.

`construction_classify` returns the matched template, normalized intent, initial
questionnaire, and `nextAction`. `construction_questions_build` and
`construction_question_answer` expose the questionnaire step without creating a
plan or mutating session state.

`construction_plan` returns construction diagnostics, questionnaire state,
readiness, a normalized plan, verification reports, and a proposed config. It
does not mutate session state. `construction_construct` generates the same plan
and stores the executable config in the active session.

```javascript
import {
  buildConstructionQuestions,
  answerConstructionQuestion,
  planWorkspaceConstruction,
  extractConstructionPlan,
} from 'symbiote-workspace/constructor';

let questions = buildConstructionQuestions({
  brief: 'build an agent review workspace',
  requiredCapabilities: ['data.table', 'admin.bulk-actions'],
});
questions = answerConstructionQuestion(questions, 'theme-mode', 'dark');

let { config } = planWorkspaceConstruction({
  brief: 'build an agent review workspace',
  requiredCapabilities: ['data.table', 'admin.bulk-actions'],
}, {
  moduleCapabilities: [
    {
      tagName: 'sn-data-table',
      provider: 'symbiote-ui',
      capabilities: ['data.table', 'admin.bulk-actions'],
      actions: [
        { id: 'refresh', label: 'Refresh', does: { kind: 'emit', event: 'refresh' } }
      ],
      hostServices: { required: ['storage.project'], optional: [] },
      placement: {
        panel: 'records',
        title: 'Records',
        icon: 'table',
        behavior: { importance: 90, minInlineSize: 320 }
      }
    }
  ],
  answers: {
    'workspace-name': 'Review Desk',
    'target-register': 'agent-workspace'
  }
});

console.log(extractConstructionPlan(config));
```

The planner records normalized intent, questionnaire answers, module capability
coverage, selected modules, package context, execution model, host-service
requirements, and verification reports under `config.construction`. The
executable schema surface remains `views[]`, `layouts{}`, `panels{}`,
`modules[]`, `requires{}`, and `wires[]`.

## Catalog Protocol

`symbiote-workspace/catalog` provides module-id catalog entries and three
dispatch tools:

- `catalog_search` filters and ranks entries by text, capability, kind, mode,
  and fingerprint.
- `catalog_describe` returns summary, contract, or full-depth data for module
  ids.
- `catalog_proof` records a performed gap search before inline free creation.

Catalog entries are addressed by module id in `namespace:local-name` form.
Search, proof, and references do not expose activation tag names. Registry and
engine sources participate in search and proof through the same entry shape.
Entries marked `installed:false` route to installation before placement.
Development-only entries are visible in scratch mode and excluded from
production proof.

Fingerprints are deterministic. A caller can pass `knownFingerprint` to
`catalog_search`; unchanged fingerprints short-circuit the response. A
`catalogProof` must match the current production fingerprint, and stale proofs
fail.

## Package And Server Surfaces

Workspace package tools are the dispatch-facing equivalents of the sharing
helpers:

- `pack_export`, `pack_import`, `pack_validate`, and `pack_inspect` wrap strict
  portable configs with manifest metadata, host contracts, dependency lists, and
  readiness diagnostics.
- `pack_context_create`, `pack_contexts_create`, and `pack_handoff_create`
  project package data into construction-ready handoffs.
- `pack_plugin_modules_collect` and `pack_plugin_templates_collect` read plugin
  manifests without activating them.

`symbiote-workspace/server` exports `createWorkspaceServer()`, plugin loading,
ingress routing, trigger reconciliation, job runtime helpers, and data-change
broadcast helpers. Server mode is optional and Node-only.

## Browser Theme Mounting

`symbiote-workspace/browser` exports browser-safe schema, loader, constructor,
sharing, validation, and plugin APIs plus DOM mounting helpers. Node-only
runtime dispatch remains in `symbiote-workspace/runtime`.

```javascript
import { mountWorkspace } from 'symbiote-workspace/browser';
import { applyCascadeGeometryRegister, applyCascadeTheme } from 'symbiote-ui/ui';

let mounted = mountWorkspace(config, document.querySelector('#workspace'), {
  themeAdapter: { applyCascadeTheme, applyCascadeGeometryRegister },
  onThemeChange({ config }) {
    saveConfig(config);
  }
});
```

`theme.params` and `theme.relations` are passed to the cascade adapter. A
`theme.params.register` value is applied through `applyCascadeGeometryRegister`
instead of being forwarded as a color parameter. `theme.overrides` are applied
as CSS custom properties on the workspace root, and `theme.subtrees` apply scoped
params, relations, overrides, and geometry registers to matching descendants. If
params, relations, or registers are present without the matching theme adapter,
mounting throws instead of silently skipping the cascade.

Discrete cascade params such as `themeVariant` (`modern` or `classic`),
`tabShape` (`frame`, `ear`, or `classic-ear`), `tabRadius`, and `cellRadius`
stay in `theme.params` and are forwarded through `applyCascadeTheme`; workspace
does not model them as recipes, overrides, or geometry registers. `tabRadius` is
separate from the general `radius` control so hosts can round project tabs
independently from controls, cards, tables, graph chrome, chat surfaces, and
layout panels. `cellRadius` is also independent so animated `cell-bg` dot sizes
can remain stable when the UI chrome uses sharp corners.

`cascade-theme-change` events from `cascade-theme-widget` or
`cascade-theme-editor` write normalized params back into `config.theme.params`.
Events with `detail.targetSelector` update the matching `theme.subtrees[]`
entry so manual theme edits survive export/import as portable config.
`cascade-geometry-register-change` events write `detail.register` into the same
portable params object for the root or matching subtree.

For agent-facing presentation or guidance, the browser entrypoint also exports
`collectWorkspaceInterfaceContext(config, root, options)`. A mounted workspace
exposes the same data through `mounted.getInterfaceContext()`. The returned map
combines the active runtime view with the full portable config: all views, stack
tabs, panels, current visibility, rendered status, declared module actions,
declared WebMCP tools, and the `view.select` / `stack.select` reveal actions
needed to show hidden interface areas before an agent authors a narration or
tour timeline.

Hosts can pass `targetCollector` (or `collectComponentTargets`) to merge live
component targets discovered by `symbiote-ui/webmcp.js` or an equivalent host
collector. DOM references are stripped from the returned context, duplicate
target addresses are de-duplicated, and `targetEnrichment` can attach
product/domain metadata as portable data. `dataContext` adds selected records,
document presentation sidecars, retrieved context, mock/demo data, or other
presentation-safe state; route params/query/data are read from the mounted
router automatically.

Generated presentation artifacts live in `narration.timelines[]`. A semantic
timeline can carry `segments[]` with narration text, locale, stable WAS focus
targets, highlight/annotation cues, safe `webmcp` / host / workspace actions,
data references, timing hints, and required host services. Validation rejects
DOM selectors as targets, unsupported action/data sources, and timelines built
against an older `provenance.revision` unless they are explicitly marked
`freshness: "stale"`.

Presentation audio selection lives in `narration.audio`. The `live` slot can use
browser TTS for interactive playback, while `render` must use an
artifact-producing TTS provider and `alignment` must use a transcription provider.
Each slot carries portable ids such as `kind`, `profile`, `providerId`,
`modelClass`, `voiceRef`, and `hostService`; the referenced host service must be
declared in `requires.hostServices`. Portable configs never store provider
endpoints, credentials, local paths, or voice sample paths.

`createWorkspacePresentationTimeline(context, request)` turns the collected
interface context into a portable timeline draft. `request.prompt`,
`request.profile`, or `request.depth` select the prompt profile: `brief` keeps a
compact visible-target tour, `full` expands target coverage across hidden and
visible panels, and `data-grounded` prioritizes data-bearing targets and attaches
`sourceRefs` from route data, selected records, retrieved context, mock/demo data,
live data, or document presentation sidecars. Mounted workspaces expose this as
`mounted.createPresentationTimeline(request, contextOptions)`, so a host can
construct the workspace first, read the live WebMCP/interface context, generate a
prompt-specific timeline, and then play or export that same artifact.

`playWorkspacePresentationTimeline(timeline, mounted, options)` executes that
artifact against a mounted workspace. It reads `mounted.getInterfaceContext()`,
runs declared reveal actions before ordered cue and narration callbacks, uses
the mounted router for navigation, and requires the host to provide an action
executor for interaction cue bindings. WebMCP/host/workspace operations therefore
stay in the declared safe-action layer. Mounted workspaces expose the same helper
as `mounted.playPresentationTimeline(...)`.

Render-time lesson generation uses the exact `presentation-timeline-v3`
contract. Every turn declares a persona, dialogue act, narration text, optional
earlier-turn reply, source/claim grounding, delivery/transition intent, and an
ordered `cues[]` list. Focus, interaction, annotation, and state cues use semantic
turn or speech anchors; authored timelines cannot contain absolute media timing
or legacy `cue`, `actions`, `webmcp`, and `renderCue` fields. Personas carry
provider-neutral roles and delivery intent. The structural review rejects
unknown fields, target-mismatched sources, unregistered tools, unsafe spoken
tokens, and disconnected dialogue before exposing TTS items.

After synthesis/transcription, `createPresentationAlignedSequence()` produces a
separate `workspace-aligned-sequence-v1` artifact bound to the exact timeline and
media hashes. It contains complete turn spans and one deterministic event per cue
with absolute times and resolution provenance (`exact`, `occurrence`, `fuzzy`, or
`proportional`). Renderers consume this derived artifact; they never write timing
back into the authored timeline.

`createPresentationObservedAlignment(timeline, { media, voice, observations })`
is the distinct strict producer for observed recognition evidence. It requires a
current hash-bearing `presentation-timeline-v3`, exact media hash, duration, and
locale, optional `{ mode: 'single', speakerId }` voice identity, and exactly one
ordered `{ turnIndex, startMs, endMs, transcript, words }` observation per turn.
Every word has exact NFC text plus integer `startMs` and `endMs`. Transcript tokens
must exactly equal the flattened word tokens, and all word intervals must be real,
positive, in-range, monotonic, and non-overlapping. Missing or inconsistent
evidence throws `PresentationObservedAlignmentError`; there is no fuzzy,
proportional, character-derived, or fabricated timing fallback.

The result contains a canonical `workspace-aligned-sequence-v3` under `sequence`,
per-turn `workspace-transcript-word-anchoring-v1` records under `anchorings`, and
aggregate metrics. The sequence preserves exact observed transcript and word
values, carries optional single-speaker identity, has `events: []`, and hashes all
fields except `hash` with `computeIntegrity()`. Each anchoring records exact
authored and observed tokens, source word timing, deterministic
`match|substitute|delete|insert` operations, and authored, recognized, timed,
distance, WER, edit-similarity, exact-correspondence, and timing-coverage metrics.
Authored-token comparison is case- and diacritic-insensitive. Dynamic-programming
ties resolve in the fixed order `substitute`, `delete`, then `insert` after an
available `match`. `validatePresentationObservedAlignedSequence()` rejects stale
timeline or sequence hashes and the same incomplete or inconsistent observation
shape without changing the existing v1 API.
WER is edit distance divided by authored-token count, edit similarity is one
minus distance divided by the larger token count, and timing coverage is timed
recognized tokens divided by recognized-token count. Aggregate metrics sum the
per-turn counts and edit distances before applying the same formulas.

`createPresentationProject({ skeleton, projection })` creates an immutable
`workspace-presentation-project-v7` from the exact v7 semantic skeleton and
narration projection. `normalizePresentationProject()` reconstructs and verifies
the same hash. This provenance API and the mutable Authoring Project API have
distinct names and reject each other's schema instead of dispatching by shape.

`workspace-presentation-authoring-project-v2` is the sole mutable presentation
authoring aggregate. It is distinct from immutable presentation-provenance
contracts and owns stable layer/cell identities, semantic timing, dependencies,
immutable audio-asset identity, half-open audio source ranges, and one exclusive
presenter collision domain; timeline v3, schedule v2, and NLE
remain derived projections. Schedule v2 barrier times are deterministic planning
evidence, not runtime completion. A host must wait for the matching successful
settlement receipt before starting dependent attention. Late or cancelled work
must be cancelled or surfaced, never queued behind a later gesture and never
written back into Authoring Project, Schedule, NLE, or their hashes.

### Presentation authoring tool host contract

`createPresentationAuthoringToolPack({ authority, regeneration })` is the shared
semantic agent surface for Maximo, CV, or another host. Its descriptors come from
the Authoring Project command registry. They expose exactly one tool for each
`layer.*` / `cell.*` command, the bounded atomic `narration.replace` command,
plus `presentation_authoring_inspect`,
`presentation_authoring_inverse`, `presentation_authoring_regeneration_request`,
and `presentation_authoring_regeneration_inspect`. There is no generic apply,
batch, JSON Patch, raw-project replacement, absolute-time, DOM, pixel, scheduler,
or media-byte tool.

The injected authority is the only session/storage owner:

```javascript
let pack = createPresentationAuthoringToolPack({
  authority: {
    read: () => currentSnapshot,
    transact: ({ base }, update) => {
      // Atomically compare base.revision + base.authoringProjectHash, call update
      // once with the current snapshot, and commit the returned next snapshot.
    },
  },
  regeneration: {
    request: (request, { signal }) => provider.request(request, { signal }),
    inspect: (receiptId, { signal }) => provider.inspect(receiptId, { signal }),
  },
});
```

The command registry also exposes strict `audio-clip.split`, `audio-clip.trim`,
`audio-clip.move`, `audio-clip.link`, and `audio-clip.unlink` operations. Visual
NLE editing, an agent MCP/CLI host, and headless playback must all mutate or execute
this Project-derived graph; a host-specific audio-cut list is invalid.

For a file-backed agent workflow, the Node API
`createPresentationAuthoringFileHost({ projectFile })` supplies this authority
without introducing another document model. The file may contain the raw Project
or the authority snapshot envelope, and retains that shape after atomic updates.
The CLI invokes individual semantic commands with `--project <file>`; `mcp
--project <file>` publishes the identical descriptors and mutation path over MCP.
The browser NLE remains an isomorphic Project/command consumer and does not import
the Node-only filesystem adapter.

The browser bridge is explicit: `createPresentationTimelineEditorModel(project,
schedule)` derives the visual timeline model from the exact NLE hashes and keeps
Project layer IDs and cell/clip IDs intact. `bindPresentationNleTimelineEditor()`
loads that model into an `sn-timeline-editor`-compatible component and converts a
committed clip move into the same semantic Authoring Project command used by the
CLI/MCP tool pack. The callback does not mutate hidden state: the host must apply
the returned command to its canonical Project authority, regenerate Schedule/NLE,
and rebind. Audio, captions, focus/media presentation, annotations, interactions,
and state events are therefore parallel visual tracks derived from one graph, not
independent editor and player timelines.

The strict authority snapshot has one of two explicit forms. Single-artifact
hosts keep `{ project, alignment?, mediaAncestry? }`. Collection hosts use
`{ project, mediaCollection }` and cannot also supply an aggregate alignment or
aggregate ancestry. `mediaCollection` uses
`workspace-presentation-media-collection-v1`:

```javascript
{
  schemaVersion: 'workspace-presentation-media-collection-v1',
  collectionId: 'portable-collection-id',
  manifestHash: 'sha256-manifest-identity',
  entries: [{
    entryId: 'semantic-turn-id',
    narrationCellId: 'authoring-project:narration-cell-id',
    mediaAncestry: {
      schemaVersion: 'workspace-presentation-media-ancestry-v1',
      narrationHash: 'workspace-presentation-narration-v1:...',
      audio: { hash: 'sha256-audio', status: 'accepted' },
      alignment: { hash: 'sha256-alignment', status: 'accepted' },
      render: { hash: 'sha256-render', status: 'accepted' },
      playable: true,
    },
  }],
}
```

Entries cover every narration cell exactly once. `entryId` is the matching
semantic turn identity, and every entry carries its own one-turn narration
hash and audio/alignment/render ancestry. The collection contains identities
and status only. Media bytes, local paths, voice/model policy, service
credentials, transport, persistence, polling, retry, and scheduling remain
host-owned.

Both regeneration tools receive this exact structured scope for collection
authority:

```javascript
artifactScope: {
  collectionId,
  manifestHash,
  entryId,
  narrationCellId,
}
```

Scoped requests and receipts use
`workspace-presentation-regeneration-request-v2` and
`workspace-presentation-regeneration-receipt-v2`; the existing single-artifact
v1 request/receipt remains unchanged. Their immutable hashes cover the exact
Project base, complete `artifactScope`, scoped narration hash, dependency, and
predecessor hashes. `presentation_authoring_regeneration_inspect` requires the
same scope as the request, so a receipt cannot select a different current entry.
A wrong entry/cell pair, Project base, collection/manifest identity, narration
hash, or predecessor ancestry is rejected before authority mutation with a
typed stale or invalid error.

`mediaAncestry` uses `workspace-presentation-media-ancestry-v1` and carries
only generic audio/alignment/render hashes with `accepted`, `stale`, or
`missing` status plus `playable`. A narration mutation in collection mode emits
one `workspace-presentation-authoring-invalidation-v2` per changed narration
entry and preserves every unaffected entry byte-for-byte. Accepting a scoped
host receipt updates only that entry. It never constructs a multi-clip aligned
sequence, and aggregate Schedule/NLE projections remain unavailable.

Semantic mutations are atomic: cancellation observed after commit returns the
committed receipt rather than hiding state. An authority transaction may reject
only when it has not committed; after committing the returned snapshot it must
fulfill so the pack can return that receipt. Only external regeneration receives
an owned `AbortSignal`; the pack creates no queue, retry loop, or timer.

Every mutation supplies `{ id, base: { revision, authoringProjectHash }, payload }`.
The provider supplies the command schema/type, validates Project semantics before
commit, and returns the canonical command, immutable project revision, change,
receipt, hashes, timeline, and—when the supplied aligned sequence still validates—
Schedule v2 and NLE projections. A stale or missing alignment produces an explicit
projection status and omits Schedule/NLE rather than fabricating Whisper timing.
`presentation_authoring_narration_replace` accepts one complete narration `turn`
and a non-empty ordered `cueBindings` list of unique
`{ cueCellId, at, until }` records. The narration identity remains stable, every
cue belongs to that exact turn, and each binding has a current or replacement
speech anchor. The command replaces only the turn and each listed cue's `at` and
`until`; cue semantics, targets, dependencies, lead, gesture duration, and settle
policy remain unchanged. The authority validates and commits only the one final
Project, so unlisted anchors must also remain valid. Its inverse is another
atomic `narration.replace` bound to the exact final revision and receipt.
Narration-cell changes commit
`workspace-presentation-authoring-invalidation-v1`, preserve old lineage hashes,
mark exactly narration audio/alignment/render stale, and set `playable: false`.
Attention and timing changes preserve the entire media ancestry. Regeneration may
accept one dependency at a time in audio → alignment → render order only when the
receipt names the exact current project, narration, and predecessor hashes.
Collection mode applies the same order independently within the named
`artifactScope`; an accepted alignment receipt is the host's content-addressed
identity and is never adapted into a synthetic collection-wide alignment.

`createPresentationExecutionController({ project, alignedSequence, schedule,
adapter, onReceipt, signal })` validates the exact hash-bound tuple and owns the
runtime admission policy. Capacity is one active operation and zero pending
operations. `sample({ mediaTimeMs, reason })` may admit one current, non-expired
cell whose actual dependencies are open. Busy samples are diagnostic only, and
operation completion never starts another cell; the host must provide a fresh
sample. `seek()` advances the execution generation and clears generation-scoped
barriers, while `pause()`, `seek()`, `stop()`, `dispose()`, and external abort
cancel the active adapter signal.

Adapters implement only `playAudioClip`, `runInteraction`, `runAttention`, or
`waitForState`. Each receives the frozen operation context `{ operationId,
generation, scheduleCell, projectCell, signal, reportAdmission, reportReceipt }`.
Audio also receives immutable `sourceAsset` and `playback` evidence, including the
source position derived from the current presentation sample; its sole successful
receipt is `ended` and must bind the exact clip, asset content hash, and half-open
source range. Attention
and semantic `select` interactions must call `reportAdmission()` once at zero
progress, before reporting a visual milestone. Native scroll, navigation and
panel reveal have no geometry-plan admission because their provider settlement
is observed rather than estimated.

`reportAdmission()` accepts exactly `{ providerAdmission }`; flattened provider
plan fields are not a second input path. `providerAdmission` is the complete
`show-attention-admission-v2` object with `provider`, `effect`, `target`,
`budget`, `plan`, and structured `reason` namespaces. The controller validates
those namespaces, recursively clones and freezes every serializable value, and
returns `workspace-presentation-effect-admission-v2` with Workspace-owned
operation, generation, Project hash, Schedule hash, cell, kind, target and
authored budget outside the exact nested provider object. Admitted plans require
the target/layout/geometry/plan identities, a finite in-budget duration and a
path hash except for click. Rejected plans preserve explicit nulls for
unavailable evidence. In particular, `reason.code: 'provider-rejected'` and
`reason.provider.code: 'target-unresolved'` survive unchanged in the terminal
failure; an admitted over-budget shape is rejected defensively.

`reportReceipt()` accepts exactly `{ status, observedAt, providerReceipt }`.
Callers cannot supply Workspace identity. `observedAt` must be
`{ domain: 'performance', timeOriginMs, monotonicTimeMs }`; the controller
mechanically rebases it to `performance.timeOrigin` without epoch-time
substitution, timestamp clamping or fabrication. The emitted immutable
`workspace-presentation-effect-receipt-v2` binds operation, generation, Project
hash, Schedule hash, cell and kind, while preserving the exact recursively
cloned provider receipt. Attention reports `first-frame` then `settled`;
semantic select maps the provider's `first-frame` to Workspace `acted`, then
reports `settled`; native interaction reports actual `acted` then `settled`;
state reports `ready`. A reported provider `failed` terminal produces one
stable `PRESENTATION_EFFECT_PROVIDER_FAILED` Workspace outcome with its exact
provider receipt.

Every visual activation creates one `AbortSignal.timeout()` hard-deadline owner
from authored `gestureDurationMs`, or `state.timeoutMs` for state readiness. It
begins before the adapter is invoked, aborts the existing operation controller
once with `PRESENTATION_EFFECT_DEADLINE_MISSED`, and detaches its listener in
the operation `finally`. It therefore covers missing admission, an admitted
provider that never settles, and a milestone outside the activation-time
budget. Pause, seek, Stop, replacement, dispose and external abort free the
single active slot and suppress saved late reporters. Terminal receipts use
immutable `{ code, message, details }` reasons and retain exact provider
admission or receipt evidence. Each accepted milestone opens only its matching
barrier. The adapter promise owns lifecycle completion only and must fulfill
with `undefined` or `null`; `reportReceipt()` is the sole provider-evidence
ingress. There is still one active operation, no pending queue, no polling,
retry, drain, replay, media-time shift or second scheduler. Narration and
authored visibility expose `ended` only when an observed media sample crosses
their end.

`createPresentationContextSnapshot()` separates stable interface identity from
volatile live data. `identityHash` includes viewport, visible/rendered targets,
and declared safe actions, while `dataHash` tracks source content. Source URLs
are stripped of credentials, query strings, and fragments. Horizontal and
vertical snapshots therefore have different identities without invalidating an
identity solely because live values changed.

`prepareWorkspacePresentation(options)` owns the browser-side preflight loop.
The host rehydrates the requested viewport, waits for layout/fonts/WebMCP to
settle, collects a target snapshot, and calls its injected planner. The planner
may request at most one deepening round with at most three actions; the host
must execute only allowlisted safe actions, settle and recollect, then replan.
Hosts may set `reviewRepairAttempts: 1` to permit one review-guided planner
correction on the same target snapshot. That correction cannot request another
deepening round; a missing, non-ready, stale, or still-rejected result fails the
preflight.
The finalizer rejects a planner result unless its request hash, generation, and
snapshot hashes match the exact replan request, then returns one atomic
timeline/cache identity. Rendering and TTS must consume that finalized packet
rather than constructing a fallback timeline server-side.
