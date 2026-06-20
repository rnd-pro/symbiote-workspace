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

`createHostIntegrationContract(config)` returns the implemented host contract
for a portable config:

- chat construction tools: `classify_workspace`, `plan_workspace`,
  `construct_workspace`, patch validation/application, import, and export;
- standalone browser requirements: import-map entries for
  `symbiote-workspace/browser`, `symbiote-ui/ui`, `symbiote-engine`, and
  `symbiote-engine/contracts`, `<script type="importmap">` ordering,
  `mountWorkspace()`, and
  `symbiote-ui/ui.applyCascadeTheme`;
- persistence requirements: `export_config`, `import_config`, and
  `requiredEngineServices` derived from module-declared host services such as
  `storage.project`;
- module-required host services and runtime slots collected from
  `components.modules` and `construction.plan.modules`, with portable ID
  validation for those contract IDs.

The contract is metadata only: it lists service IDs and import specifiers, never
credentials, user identity, URLs, local paths, or product code.

## MCP (Model Context Protocol)

Start as MCP server:

```bash
node cli.js mcp
```

Exposes all 69 tools from the unified runtime registry via JSON-RPC over stdio.
Agents can classify, plan,
propose, validate, apply, export, mutate, and query workspaces
programmatically.

## Tools Reference

| Category | Tools |
|----------|-------|
| **Discovery** | `describe_workspace` `discover_components` `find_component` `list_component_tags` `list_categories` `list_used_components` |
| **Scaffold** | `list_templates` `scaffold_workspace` `scaffold_from_scratch` |
| **Construction** | `classify_workspace` `build_construction_questions` `answer_construction_question` `plan_workspace` `construct_workspace` `propose_workspace_patch` `validate_workspace_patch` `apply_workspace_patch` `export_workspace` |
| **Groups** | `add_group` `remove_group` `update_group` `reorder_groups` `list_groups` |
| **Sections** | `add_section` `remove_section` `update_section` `reorder_sections` `list_sections` |
| **Layout** | `set_layout` `add_panel` `remove_panel` `resize_panel` `update_layout_behavior` |
| **Panel Types** | `register_panel_type` `update_panel_type` `unregister_panel_type` `list_panel_types` |
| **Menu Actions** | `add_menu_action` `remove_menu_action` `toggle_menu_action` `list_menu_actions` |
| **Behaviors** | `set_behavior` `get_behavior` `update_behavior` |
| **Widgets** | `mount_widget` `unmount_widget` `swap_widget` |
| **Events** | `bridge_event` `unbridge_event` `list_bridges` |
| **Workflow Modules** | `workflow_kanban` |
| **Sharing** | `export_config` `import_config` `diff_configs` `merge_configs` |
| **Workspace Package** | `export_workspace_package` `import_workspace_package` `validate_workspace_package` `inspect_workspace_package` `create_workspace_package_construction_context` `create_workspace_packages_construction_context` `create_workspace_construction_handoff` |
| **Plugin Metadata** | `collect_plugin_module_capabilities` `collect_plugin_workspace_templates` |
| **Preview** | `start_preview` |
| **Validation** | `validate_config` `check_guardrails` |
| **File I/O** | `save_config` `load_config` |

### Workflow Kanban

`workflow_kanban` registers a portable workflow board panel backed by the
provider-owned `symbiote-ui` `sn-kanban-board` module. It requires a portable
`panelType` and a plain JSON `board` with an `id` and non-empty `columns`.

```bash
node cli.js workflow-kanban --config ws.json \
  --panel-type approvals \
  --board '{"id":"release-flow","columns":[{"id":"todo","title":"Todo","cards":[{"id":"task-1","title":"Review package"}]}]}' \
  --layout-id workflow \
  --set-default-layout
```

The tool upserts the panel type, module descriptor, board state field, data
bindings, select/action/drop event bridges, and optional group/section/layout
metadata.
`behavior`, `eventTarget.mapping`, and `requiredHostServices` are validated as
portable JSON before the active config is mutated.

## Workspace Config

```json
{
  "version": "0.2.0",
  "name": "My Workspace",
  "register": "tool",
  "intent": {
    "brief": "Build a media review workspace",
    "template": "video-studio",
    "targetRegister": "media-studio",
    "audience": ["operators"],
    "constraints": ["portable-config"],
    "requiredCapabilities": ["timeline", "preview"]
  },
  "construction": {
    "questions": [],
    "plan": {
      "name": "My Workspace",
      "template": "video-studio",
      "register": "media-studio"
    }
  },
  "theme": {
    "params": { "mode": "dark", "hue": 220 },
    "relations": { "surfaceStep": 1.15 },
    "overrides": { "--sn-gap": "8px" },
    "subtrees": [
      {
        "selector": "[data-region='preview']",
        "params": { "hue": 180 },
        "relations": { "radiusScale": 0.8 },
        "overrides": { "--sn-node-radius": "4px" }
      }
    ]
  },
  "layout": {
    "type": "split",
    "direction": "horizontal",
    "ratio": 0.3,
    "first": { "type": "panel", "panelType": "sidebar" },
    "second": {
      "type": "split",
      "direction": "vertical",
      "ratio": 0.6,
      "first": { "type": "panel", "panelType": "viewport" },
      "second": { "type": "panel", "panelType": "timeline" }
    }
  },
  "panelTypes": {
    "sidebar": { "title": "Sidebar", "component": "sn-tree-panel", "icon": "folder" },
    "viewport": { "title": "Viewport", "component": "sn-canvas-viewport", "icon": "tv" },
    "timeline": { "title": "Timeline", "component": "sn-timeline-editor", "icon": "schedule" }
  },
  "groups": [{ "id": "main", "name": "Main", "icon": "home" }],
  "sections": [{ "id": "overview", "label": "Overview", "groupId": "main" }],
  "events": [
    { "id": "bridge_1", "sourcePanel": "timeline", "event": "frameChange", "targetPanel": "viewport" }
  ],
  "components": { "catalog": ["sn-tree-panel", "sn-canvas-viewport", "sn-timeline-editor"] }
}
```

### Register Values

| Register | Max Panels | Min Ratio | Use Case |
|----------|-----------|-----------|----------|
| `tool` | 12 | 0.1 | Dense professional UI (IDE, studio) |
| `admin` | 14 | 0.08 | Operations/admin consoles |
| `editor` | 10 | 0.1 | Code, content, and data editors |
| `agent-workspace` | 12 | 0.1 | Agent control rooms and review desks |
| `media-studio` | 10 | 0.08 | Timeline, preview, and media production UI |
| `brand` | 6 | 0.2 | Marketing, landing pages |
| `presentation` | 4 | 0.25 | Slides, demos, showcases |

## Construction Protocol

The constructor protocol is designed for agents that build workspaces from
declared modules instead of editing application code directly.

The read-only `classify_workspace` tool returns the matched template,
normalized intent, initial questionnaire, and `nextAction: "plan-workspace"`.
The read-only `build_construction_questions` and
`answer_construction_question` tools expose the questionnaire step directly
through dispatch, CLI, and MCP without creating a plan or mutating session
state.

The read-only `plan_workspace` tool returns the same construction plan without
changing session state. The mutating `construct_workspace` tool writes the
planned executable config into the active CLI/MCP session and participates in
the same `--config` auto-save flow as other mutating tools. Both tools accept
constructor `options` directly, including the `{ intent, options }` object
returned by `create_workspace_construction_handoff`. Successful responses also
expose `verification` at the top level, matching `plan.verification` for CLI and
MCP consumers that need transport-stable construction diagnostics.

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
      actions: [{ id: 'refresh', label: 'Refresh' }],
      requiredHostServices: ['storage.project'],
      placement: {
        panelType: 'records',
        title: 'Records',
        icon: 'table',
        behavior: { importance: 90, minInlineSize: 320 },
      },
    },
  ],
  answers: {
    'workspace-name': 'Review Desk',
    'target-register': 'agent-workspace',
  },
});

console.log(extractConstructionPlan(config));
```

`config.intent` stores the normalized brief and target register.
`config.construction.questions` stores the questionnaire state, including
defaults, answers, dependencies, and skipped reasons.
`config.construction.plan` stores the normalized construction plan.
`components.modules` stores module capability descriptors for catalog or custom
components. When the intent includes `requiredCapabilities` and no explicit
`module-selection` answer is provided, the constructor derives the module
selection from declared descriptor capabilities. Explicit answers are preserved,
and any uncovered requirements are reported in
`config.construction.plan.capabilities.missing`. The plan also records
`capabilities.byCapability` so agents can see which selected modules cover each
requirement and which ranked unselected modules are available as alternatives.
`capabilities.selectedModules` lists every selected module, including explicit
selections that matched none of the required capabilities, with matched and
missing capability diagnostics plus the module selection reason.
The `execution-model` question records how the workspace should execute:
`ui-only`, `graph-execution`, `server-session`, `remote-provider`,
`mobile-executor`, or `automation-bridge`. The selected value is preserved in
`config.intent.executionModel`, `config.execution.model`, and
`config.construction.plan.execution.model`. The same plan section summarizes
selected-module `requiredHostServices`, `runtimeSlots`, and `enginePacks` so
hosts can decide whether they can execute the workspace without embedding host
URLs, credentials, or runtime handles in the portable config.
Descriptor `provider` and `descriptor.package` references must be portable
package or registry identifiers such as `symbiote-ui` or `@acme/workspace-pack`;
URLs, file references, and local paths are rejected before descriptors reach
construction or plugin handoff surfaces.
When `plan_workspace` or `construct_workspace` report missing module
capabilities, top-level `readiness.recovery[]` entries include those ranked
alternatives when the planner found compatible unselected modules. Failed
`construct_workspace` responses also include the rejected construction `plan`
so callers can inspect selected-module diagnostics without re-planning.

External descriptors that do not already have a matching `panelTypes` entry are
materialized from `placement.panelType` or `tagName`. The constructor copies
placement title, icon, and behavior into the generated panel type, and selected
generated panels are added to the root BSP layout when they are not present in
any existing layout. Generated panel types that are not selected are removed
from the executable `config.panelTypes` surface; their descriptors can remain
in `components.modules` as catalog metadata and capability alternatives.
When module selection prunes a named layout, section `layoutId` references are
normalized back to the surviving root layout. Existing event bridges, data
bindings, state fields, and engine bindings that reference unselected panels
are pruned from the executable config in the same cleanup pass.

Generated panel types also receive shell `menuActions` from descriptor
`actions`, `toolbarItems`, and `menus[].items`, plus portable `settings` from
descriptor settings and portable child `slots` from descriptor slots. Existing
panel type menu actions, settings, and slots are
preserved, so templates can keep authored shell commands and controls while
external descriptors still expose executable declarations when they create
panels.

The selected `layout-topology` answer is applied to the executable BSP
`config.layout` for the selected module panels. Topologies remain portable
constructor semantics; the emitted workspace layout still uses the stable
`panel` and `split` node types required by the runtime schema.
The construction plan also records `layout.regions`, mapping descriptor
`placement.regions` hints to selected panel types. When a descriptor does not
declare regions, the selected panel type is used as the portable region name.

The constructor records portable runtime policy through `execution-model` and
`required-host-services` questions. Selected host services are written to
`config.intent.hostServices`, `config.execution.hostServices`, and
`config.construction.plan.execution.requiredHostServices`; module-declared
requirements remain visible as `moduleHostServices` for host readiness review.

The constructor copies matching descriptor capabilities, actions, settings,
state fields, events, bindings, slots, runtime slots, placement hints, and
required host service IDs into `config.construction.plan.modules`. Selected
modules also expose `matchedCapabilities` and `selectionReason`; aggregate
coverage is stored in `config.construction.plan.capabilities`.
`validation.reports` and `patches` can persist machine-readable review results
from patch validation.

Construction also writes verification reports to
`config.construction.plan.verification.reports` and mirrors them to
`config.validation.reports`. Reports compose existing portability export,
design guardrail, module capability, and package/host readiness checks, so
agents can inspect construction readiness without invoking separate validators
or host-specific services. Dispatch, CLI, and MCP construction responses expose
the same payload as top-level `verification`. Report entries use stable
`pass`, `warn`, or `blocked` status values with `info`, `warning`, or `error`
severity, and both report locations are validated against the same shape. Each
report entry requires `id`, `check`, `status`, `severity`, and `message`; it may
also include `version`, `diagnostics`, and `suggestedPatches`.

Selected descriptor bindings are also materialized into `config.data.bindings`.
Each binding record carries `panelType`, `component`, `id`, `direction`, and
optional `path`/`schema`; `direction` must be `input`, `output`, or `two-way`.
This is a portable declaration for host/runtime handoff, not an embedded server
endpoint or execution engine.

Selected descriptor event declarations are materialized into `config.events`.
Emitted events create broadcast bridges from the source panel, and matching
selected descriptor consumers create targeted bridges with optional
`targetMethod`, `targetProperty`, and `mapping` metadata. Authored bridges are
preserved, and unselected panels do not receive generated event routes.

Selected descriptor state declarations are materialized into
`config.state.fields`. Each state field record carries `panelType`, `component`,
`id`, `type`, a portable `path`, and optional `default`, `schema`, and
`persistence`. This is a portable field contract and default declaration; live
component/session values stay outside workspace configs.

Selected descriptor actions, settings, state fields, events, and bindings may also carry
portable `engine` metadata with `graphId`, `nodeId`, and optional
`input`/`output`/`param`/`pack`. The constructor materializes those references
into `config.engine.bindings[]` and aggregates pack identifiers into
`config.engine.packs[]`; authored `config.engine.graphs[]` records stay plain
serializable graph JSON. When a binding targets a graph authored in the
workspace, validation checks the referenced node ID when that graph lists nodes.
Bindings to undeclared graph IDs remain portable host handoff references that a
host/runtime may resolve externally. This layer describes host/engine handoff
metadata only and does not import or execute `symbiote-engine`.

Selected descriptor settings are materialized into `panelTypes.*.settings` when
the selected panel type does not already define settings. Each setting carries a
portable `id`, `label`, `type`, optional `default`, enum `options`, and optional
binding identifier for host/UI configuration surfaces.

Selected descriptor slots are materialized into `panelTypes.*.slots` when the
selected panel type does not already define slots. Each slot carries a portable
`id`, optional `role`, accepted component/capability identifiers, and an optional
`required` flag for host shell composition surfaces. Runtime slots stay in
descriptor/package readiness metadata and are not converted into panel slots.

## Browser Theme Mounting

`symbiote-workspace/browser` exports browser-safe schema, loader, constructor,
sharing, validation, and plugin APIs plus DOM mounting helpers. Node-only
runtime dispatch remains in `symbiote-workspace/runtime`.

The browser entrypoint applies workspace theme config when mounting:

```javascript
import { mountWorkspace } from 'symbiote-workspace/browser';
import { applyCascadeTheme } from 'symbiote-ui/ui';

let mounted = mountWorkspace(config, document.querySelector('#workspace'), {
  themeAdapter: { applyCascadeTheme },
  onThemeChange({ config }) {
    saveConfig(config);
  },
});
```

`theme.params` and `theme.relations` are passed to the adapter. `theme.overrides`
are applied as CSS custom properties on the workspace root, and `theme.subtrees`
apply scoped params, relations, and overrides to matching descendants. If params
or relations are present without a theme adapter, mounting throws instead of
silently skipping the cascade.

`cascade-theme-change` events from `cascade-theme-widget` or
`cascade-theme-editor` write normalized params back into `config.theme.params`.
Events with `detail.targetSelector` update the matching `theme.subtrees[]`
entry so manual theme edits can survive export/import as portable config.
