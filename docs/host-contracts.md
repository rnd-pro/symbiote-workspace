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

The MCP transport exposes the same 85 tools as the CLI. Both are thin proxies
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
`dataRefs` from route data, selected records, retrieved context, mock/demo data,
live data, or document presentation sidecars. Mounted workspaces expose this as
`mounted.createPresentationTimeline(request, contextOptions)`, so a host can
construct the workspace first, read the live WebMCP/interface context, generate a
prompt-specific timeline, and then play or export that same artifact.

`playWorkspacePresentationTimeline(timeline, mounted, options)` executes that
artifact against a mounted workspace. It reads `mounted.getInterfaceContext()`,
runs declared reveal actions before focus/cue/action/narration callbacks, uses
the mounted router for `view.select`, and requires the host to provide
`executeAction` for timeline actions so WebMCP/host/workspace actions stay in
the declared safe-action layer. Mounted workspaces expose the same helper as
`mounted.playPresentationTimeline(...)`.
