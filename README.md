[![npm version](https://img.shields.io/npm/v/symbiote-workspace)](https://www.npmjs.com/package/symbiote-workspace) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org) [![ESM](https://img.shields.io/badge/ESM-only-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)

# symbiote-workspace

**symbiote-workspace turns chat intent into portable, executable Symbiote
workspaces. Fast.**

Build professional agent workspaces from plain JSON configs: views, layouts,
panels, modules, actions, wires, Cascade themes, plugin metadata, runtime
slots, host requirements, and browser assembly. The package
gives agents a direct path from user intent to a relaunchable workspace without
forking a product app, hardcoding a host, or generating one-off UI code first.

![Realtime Symbiote workspace builder demo](./docs/assets/realtime-builder-demo.png)

## Why symbiote-workspace?

- **One artifact for the whole workspace** — layouts, modules, theme, wires,
  host requirements, and validation reports live in portable JSON.
- **Agent construction without free-form app forks** — classify intent, ask the
  construction questions, select modules, validate the result, and assemble it
  in the browser.
- **Symbiote primitives first** — use `symbiote-ui` layouts, Web Components,
  Cascade theme, manifests, and plugin descriptors before creating new modules.
- **Same tools over CLI and MCP** — every registered tool goes through one
  dispatch registry, so local scripts and agent hosts see the same behavior.
- **Relaunchable by any compatible host** — exported configs exclude auth,
  secrets, user identity, local paths, and product-only runtime state.

## What is Symbiote Workspace?

Symbiote Workspace is the portable construction layer between provider UI
primitives and host applications. The host supplies chat, model routing, auth,
policy, secrets, storage, billing, and identity. `symbiote-workspace` supplies
the schema, constructor, plugin registry, config mutation tools, validation,
sharing contract, browser mounting, CLI, MCP transport, and optional server
mode.

> **Learn more**: [Host Contracts and Construction Protocol](./docs/host-contracts.md)

## Key Features

### Guided Workspace Construction

- **Construction protocol** — intent classification, questionnaire state,
  topology planning, module selection, execution model, host services, and
  package readiness.
- **Capability-driven modules** — module descriptors materialize panel types,
  actions, menus, toolbars, settings, events, slots, state fields, and wires
  into executable workspace surfaces.
- **Template and plugin inputs** — canonical templates and plugin-provided
  workspace templates feed the same planner instead of creating product forks.

### Portable Config Runtime

- **Strict export/import** — shareable workspace JSON strips host-only state and
  rejects auth, user identity, server URLs, local paths, and session data.
- **Host integration contracts** — exported metadata tells a compatible host
  which imports, components, services, runtime slots, and permissions are
  required to relaunch the workspace.
- **No-reload browser updates** — mounted workspaces can apply validated config
  updates and patches without replacing the browser runtime.
- **Portable media evidence** — versioned media evidence manifests bind a
  content-addressed artifact DAG to render metrics, provenance, quality gates,
  and a fail-closed publication verdict without storing host paths or secrets.
  The v3 identity binds an optional virtual sequence into the canonical manifest
  id, backed by a `workspace-media-artifact-graph-v2` `virtual-sequence` node
  that a passing publication proof must transitively depend on. See
  [Media Evidence and Artifact Invalidation](./docs/media-evidence.md).
- **Portable virtual media sequence** — an indexed playback model with a required
  `executionTier`, carrying encoded master segments (video codecs only), playback
  and scrub proxies, sparse sprites, keyframe/timestamp seek indexes,
  audio/waveform references, and separately-invalidatable
  `base`/`overlay`/`caption`/`audio` layers over a frame-aligned integer
  timebase, with deterministic timeline projection, range-aware invalidation, and
  a canonical content hash proof-linked into the v3 media-evidence identity.
- **Portable browser appearance** — `workspace-media-render-settings-v3` carries a
  normalized `browserAppearance` that independently controls browser chrome
  visibility (`hidden` default), chrome theme (`system`/`light`/`dark`/`tinted`
  with a required `#RRGGBB` tint only when tinted), and page `pageColorScheme`.
  Hidden chrome accepts only the `system` theme, invalid combinations fail with
  actionable errors, and any appearance change invalidates cached frames, the
  preview sequence, and the final output. Host-native chrome mechanics stay in the
  product layer.
- **Presentation viewport geometry** — `workspace-presentation-output-v2` adds
  neutral final-frame `frameInsets` and derives a positive `presentationViewport`.
  Content and captions are laid out inside that viewport, while
  `workspace-presentation-composition-v2` measurement is checked against the
  presentation viewport and translates page-local focus/annotation rectangles into
  final-frame coordinates before containment and collision checks.
- **Immutable Presentation Project v7** — `createPresentationProject({ skeleton,
  projection })` binds a `workspace-presentation-semantic-skeleton-v7` and
  `presentation-narration-projection-v7` to one reconstructed timeline and
  `workspace-presentation-project-v7` hash. This provenance contract is separate
  from the mutable Authoring Project API and rejects Authoring Project inputs.
- **Presentation Authoring Project authority** —
  `workspace-presentation-authoring-project-v2` is the
  sole mutable authoring aggregate for presentation scripts, layers, and stable
  cells. Immutable audio assets and editable `audio-clip` cells keep source ranges,
  timeline placement, and event dependencies in that same Project. The NLE,
  MCP/CLI tools, and headless playback all derive the same clip graph; there is no
  player-only segmentation timeline. It rejects runtime selectors, geometry, and receipts; validates dependency
  graphs and one exclusive presenter collision domain before publication; and
  applies same-base command batches as one atomic revision. Timeline v3, aligned
  sequence v1, presenter schedule v2, and NLE are derived projections. Schedule v2
  records deterministic planned barriers only: runtime consumers must wait for an
  actual completed settlement receipt before starting dependent attention, and a
  late or cancelled receipt must not queue work or rewrite Authoring
  Project/Schedule hashes.
  NLE frame edits are accepted only against the exact derived projection and map
  back to semantic anchors plus `leadMs`, never persisted absolute milliseconds.
  First-class clip commands split, trim, timeline-move, link, and unlink audio with
  exact revision/project-hash CAS while preserving approved source identity.
- **Stateless presentation authoring tools** —
  `createPresentationAuthoringToolPack({ authority, regeneration })` exposes one
  strict product-neutral tool per Authoring Project command, plus inspect,
  receipt-bound inverse, and abortable regeneration request/inspection. The host
  injects atomic session storage through exact revision/project-hash CAS; the pack
  keeps no project copy, queue, timer, DOM state, or media bytes. Narration-cell
  changes preserve immutable lineage evidence but mark narration audio, alignment,
  and render stale until exact ordered regeneration receipts restore playability;
  timing and attention-only edits preserve media ancestry.
- **Single-flight presentation execution** —
  `workspace-presentation-execution-v1` validates one exact Authoring Project,
  aligned-sequence, and Schedule v2 tuple, then admits one active effect and zero
  queued effects. Injected host adapters return ordered portable receipts:
  interaction `acted → settled`, attention `first-frame → settled`, or state
  `ready`. Only those actual receipts open dependency barriers; planned times do
  not. Completion never pumps another cell, so the next effect requires a fresh
  media sample, while expired cells are skipped without replay.
- **Shared presentation execution** — authored audio clips project into an editable
  NLE track and `workspace-presentation-playback-plan-v1`. The existing
  `PresentationExecutionController` admits audio, interaction, attention, and state
  cells from the same typed dependency graph, so `clip ended → event settled → next
  clip` has one receipt and lifecycle contract in visual-editor preview and
  hidden/headless playback.
- **Deterministic audio composition** —
  `workspace-presentation-audio-composition-v1` projects approved master ranges and
  word evidence into presentation time without rerunning TTS or transcription, and
  binds materialized delivery files back to the exact Project/composition hashes.

### Unified Agent Tooling

- **89 tools over CLI/MCP** — one `runtime/dispatch.js` registry drives CLI commands,
  MCP JSON-RPC, tests, and package-consumer verification.
- **Workflow kanban tool** — `module_workflow_kanban` registers portable workflow-board
  panels backed by provider-owned `symbiote-ui` board components.
- **Release proof harness** — package preflight verifies metadata, tests,
  package contents, browser demo proof, npm registry state, and clean git state
  without publishing.

## Quick Start

```sh
npm install symbiote-workspace symbiote-ui symbiote-engine
```

```js
import {
  exportConfig,
  planWorkspaceConstruction,
  validateWorkspaceConfig,
} from 'symbiote-workspace';

let { config } = planWorkspaceConstruction('build me a chat workspace', {
  name: 'My Chat',
  register: 'agent-workspace',
});

let validation = validateWorkspaceConfig(config);
if (!validation.valid) throw new Error('Workspace config is invalid');

let { json } = exportConfig(config, { strict: true });
console.log(json);
```

See [Getting Started and Preview](./docs/getting-started.md) for dispatch,
CLI, preview generation, and browser smoke workflows.

## Example: Unified Dispatch

```js
import { createSession, dispatch } from 'symbiote-workspace/runtime';

let session = createSession();
let planned = await dispatch('construction_plan', {
  intent: 'video editing studio for agentic media review',
  name: 'Launch Cut',
}, session);

await dispatch('config_import', {
  json: JSON.stringify(planned.config),
  baseRevision: session.revision,
}, session);

let result = await dispatch('config_validate', {}, session);
console.log(result.valid);
```

## CLI

```sh
node cli.js construction-classify "agent review workspace"
node cli.js construction-plan "agent review workspace" --name "Review Desk"
node cli.js config-validate workspace.json
node cli.js mcp
```

All CLI and MCP tools route through the same dispatch registry. The full tool
list and CLI command naming rule live in [Getting Started and Preview](./docs/getting-started.md)
and [Host Contracts and Construction Protocol](./docs/host-contracts.md).

## Evidence-backed Lessons

`symbiote-workspace/runtime` and the browser entrypoint export
`createPresentationLessonContext()`, `auditPresentationLessonContext()`, and
`reviewPresentationTimelineAgainstLessonContext()`. Hosts use these APIs to bind
a lesson plan to live targets, portable WebMCP descriptors, domain facts,
evidence, relations, prior actions, and bounded deepening results. Malformed,
stale, unsafe, ungrounded, generic, duplicate, or under-depth lessons fail
before a TTS projection is accepted.

## Visual Demo

```sh
npm run demo:realtime-builder
```

The realtime builder demo shows the chat-state construction loop: empty layouts,
validated patches, required UI modules, mounted Symbiote UI surfaces, Cascade
theme state, and no-reload workspace updates. See
[examples/visual-demo/README.md](./examples/visual-demo/README.md) for browser
smoke options and CI-friendly write-only mode.

## Documentation

- [Architecture and Entry Points](./docs/architecture.md) — package layers,
  dispatch architecture, and import boundaries.
- [Getting Started and Preview](./docs/getting-started.md) — programmatic setup,
  CLI commands, generated browser previews, and visual demo commands.
- [Host Contracts and Construction Protocol](./docs/host-contracts.md) — strict
  export/import, MCP tools, workspace config, construction planning, and theme
  mounting.
- [Plugins, Portability, and Templates](./docs/plugins-and-templates.md) —
  plugin format, module capabilities, portability rules, templates, and
  workspace packages.
- [Media Evidence and Artifact Invalidation](./docs/media-evidence.md) — strict
  evidence manifests, cache identity, DAG invalidation, and privacy rules.

## License

MIT © [RND-PRO.com](https://rnd-pro.com)

## Related Projects

- [symbiote-ui](https://github.com/RND-PRO/symbiote-ui) — Web Components,
  provider catalogs, layout metadata, Cascade theme, and WebMCP descriptors.
- [symbiote-engine](https://github.com/RND-PRO/symbiote-engine) — graph
  execution, runtime commands, server helpers, persistence, and handler loading.
- [symbiote-node](https://github.com/RND-PRO/symbiote-node) — terminal migration
  facade for older imports.
- [JSDA-Kit](https://github.com/rnd-pro/jsda-kit) — JavaScript ESM asset
  generation, SSR, and static output pipeline.
- [Symbiote.js](https://github.com/symbiotejs/symbiote.js) — isomorphic
  reactive Web Components framework.

Made with ❤️ by the RND-PRO team
