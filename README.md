# symbiote-workspace

Agent-driven workspace orchestration with plugin system:
**intent → questions → plan → validate → build → export**.

Portable workspace configs over [symbiote-ui](https://github.com/RND-PRO/symbiote-ui) primitives. Optional server mode via [symbiote-engine](https://github.com/RND-PRO/symbiote-engine).

## Product Thesis

`symbiote-workspace` turns chat intent into executable workspace configs. The
host provides the chat surface, model routing, auth, transport, and runtime
services; this package owns construction, module selection, validation,
browser assembly, export, and relaunch portability.

Construction uses existing `symbiote-ui` primitives, canonical templates,
module capability descriptors, and plugin packs first. Custom components or
new modules are fallback outputs only when discovery shows that the requested
capability is missing from the available catalog.

Selected module descriptors are materialized into executable workspace
surfaces: placement creates panel types, actions/menus/toolbars become panel
shell actions, `events.emits` become portable broadcast event bridges, and
bindings are copied into validated `data.bindings` records for host/runtime
handoff.

## Install

```bash
npm install symbiote-workspace
```

For server mode (optional):

```bash
npm install symbiote-workspace symbiote-engine
```

## Local Package Verification

For pre-publication development, verify the packed package through a temporary
consumer instead of publishing to npm:

```bash
npm run test:package-consumer
```

The test packs this workspace and the currently installed `symbiote-ui`
substitute, installs both tarballs into a gitignored `tmp/` consumer, then
checks public entry points, the CLI bin, construction/export/host-contract
flow, and MCP stdio behavior. It does not publish or require registry writes.

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Dispatch                   │
│          registered tools, 1 registry       │
│             runtime/dispatch.js             │
├──────────────────┬──────────────────────────┤
│   CLI (argv)     │      MCP (JSON-RPC)      │
│   cli.js         │      mcp/index.js        │
│   thin proxy     │      thin proxy          │
├──────────────────┴──────────────────────────┤
│  handlers/* (12 modules)  constructor/*     │
│  schema/*  validation/*   loader/*          │
│  plugins/*  sharing/*     server/*          │
└─────────────────────────────────────────────┘
```

CLI and MCP share the same dispatch layer — every tool available via MCP is also available via CLI, and vice versa. No code duplication.

## Entry Points

| Entry Point | Env | Purpose |
|------------|-----|---------|
| `symbiote-workspace` | Node | Schema, loader, constructor, sharing, validation, plugins, runtime |
| `symbiote-workspace/runtime` | Node | Dispatch, session, tool registry |
| `symbiote-workspace/browser` | Browser | DOM mounting + browser-safe isomorphic APIs |
| `symbiote-workspace/loader` | Node | Workspace config loading and theme extraction helpers |
| `symbiote-workspace/constructor` | Node | Construction planning, templates, questions, handoff consumption |
| `symbiote-workspace/sharing` | Node | Package export/import, host contracts, construction context projection |
| `symbiote-workspace/validation` | Node | Design guardrails and construction patch validation |
| `symbiote-workspace/plugins` | Isomorphic | Plugin schema, validation, registry |
| `symbiote-workspace/handlers` | Node | Config mutation and discovery handler functions |
| `symbiote-workspace/server` | Node | Workspace server + plugin loader |
| `symbiote-workspace/mcp` | Node | MCP stdio transport entrypoint |
| `symbiote-workspace/schema` | Node | Schema definitions, validators |
| `symbiote-workspace/schema/*` | Node | Direct schema module imports for validators and schema constants |
| `symbiote-workspace/package.json` | Node | Package metadata for consumer tooling |

## Quick Start

### Programmatic

```javascript
import {
  planWorkspaceConstruction,
  proposeWorkspacePatch,
  applyWorkspacePatch,
  validateWorkspaceConfig,
  exportConfig,
  createHostIntegrationContract,
  checkDesignGuardrails,
} from 'symbiote-workspace';

// 1. Plan from intent through the construction protocol
let construction = planWorkspaceConstruction('build me a chat workspace', {
  name: 'My Chat',
  register: 'tool',
});
let { config, questions, plan } = construction;

// 2. Validate the generated config and design density guardrails
let validation = validateWorkspaceConfig(config);
console.log(validation.valid); // true

let guardrails = checkDesignGuardrails(config);
console.log(guardrails.pass); // true

// 3. Preview and apply accepted workspace patches
let proposal = await proposeWorkspacePatch(config, {
  theme: { params: { mode: 'dark', hue: 220 } },
});
if (proposal.accepted) {
  config = (await applyWorkspacePatch(config, proposal.overlay)).config;
}

// 4. Export for sharing after validation
let { json } = exportConfig(config, { strict: true });
console.log(json); // portable JSON, no auth/server data

// 5. Ask the host what it must provide to relaunch the workspace
let contract = createHostIntegrationContract(config);
console.log(contract.contract.browser.requiredImports);
```

### Unified Dispatch

```javascript
import { dispatch, createSession, TOOLS } from 'symbiote-workspace/runtime';

let session = createSession();

// Plan without mutating session state
let planned = await dispatch('plan_workspace', {
  intent: 'chat workspace',
  name: 'My Chat',
}, session);

// Create session config from the planned workspace
await dispatch('import_config', { json: JSON.stringify(planned.config) }, session);

// Mutate
await dispatch('add_group', { id: 'main', name: 'Main' }, session);
await dispatch('register_panel_type', {
  name: 'viewport', title: 'Viewport', component: 'sn-canvas-viewport',
}, session);

// Validate and apply patch proposals before mutation
await dispatch('apply_workspace_patch', {
  overlay: { theme: { params: { mode: 'dark', hue: 220 } } },
}, session);

// Query
let groups = await dispatch('list_groups', {}, session);
let desc = await dispatch('describe_workspace', {}, session);

// Validate
let result = await dispatch('validate_config', {}, session);
console.log(result.valid); // true

// Save
await dispatch('save_config', { filePath: './workspace.json' }, session);
```

## CLI

All registered tools are available as CLI commands:

```bash
# Scaffold
npx symbiote-workspace scaffold chat --name "My Chat"
npx symbiote-workspace scaffold-from-scratch --name "Blank WS"
npx symbiote-workspace list-templates

# Stateful mode (--config auto-saves on mutations)
npx symbiote-workspace scaffold dashboard --config ws.json
npx symbiote-workspace classify-workspace "agent review workspace"
npx symbiote-workspace plan-workspace "agent review workspace" --name "Review Desk"
npx symbiote-workspace propose-workspace-patch --config ws.json --overlay '{"theme":{"params":{"mode":"dark","hue":220}}}'
npx symbiote-workspace validate-workspace-patch --config ws.json --overlay '{"register":"editor"}'
npx symbiote-workspace apply-workspace-patch --config ws.json --overlay '{"name":"Review Desk"}'
npx symbiote-workspace export-workspace --config ws.json
npx symbiote-workspace add-group --config ws.json --id analytics --name Analytics
npx symbiote-workspace add-section --config ws.json --groupId analytics --id overview --label Overview
npx symbiote-workspace register-panel-type --config ws.json --name chart --title Chart --component sn-chart
npx symbiote-workspace set-layout --config ws.json --layoutTree '{"type":"split","direction":"horizontal","ratio":0.3,"first":{"type":"panel","panelType":"sidebar"},"second":{"type":"panel","panelType":"chart"}}'

# Discovery (auto-detects symbiote-ui)
npx symbiote-workspace discover
npx symbiote-workspace find-component --tagName sn-data-table
npx symbiote-workspace list-component-tags
npx symbiote-workspace list-categories

# Validation
npx symbiote-workspace validate workspace.json
npx symbiote-workspace describe workspace.json
npx symbiote-workspace preview workspace.json --output-dir .workspace-preview

# Server
npx symbiote-workspace serve --port 3100 --plugins-dir ./plugins

# MCP mode
npx symbiote-workspace mcp
```

### CLI Aliases

| Alias | Tool |
|-------|------|
| `scaffold` | `scaffold_workspace` |
| `plan` | `plan_workspace` |
| `construct` | `construct_workspace` |
| `describe` | `describe_workspace` |
| `discover` | `discover_components` |
| `validate` | `validate_config` |
| `preview` | `start_preview` |

## Browser Preview

`start_preview` writes `index.html`, `app.js`, `workspace.config.json`, and
`preview.contract.json`. The generated HTML declares an import map before
loading `app.js`, so browser bare imports resolve through an explicit host
contract:

```javascript
import { startPreview } from 'symbiote-workspace/handlers';

await startPreview(config, {
  outputDir: '.workspace-preview',
  imports: {
    'symbiote-workspace/browser': './mock-workspace-browser.js',
    'symbiote-ui': './mock-symbiote-ui.js',
  },
});
```

The generated `app.js` and `workspace.config.json` use the same portable config
sanitizer as export/import flows, so host/session fields and local paths are not
copied into preview runtime state.

When `imports` is omitted, preview defaults to local workspace paths and the
returned `hint` serves the repository root so `symbiote-workspace/browser` and
`symbiote-ui` can resolve from the generated import map.

The generated runtime imports `applyCascadeTheme` from `symbiote-ui`, passes it
as `themeAdapter` to `mountWorkspace()`, verifies import-map support before
loading bare modules, renders loader warnings with `data-preview-warning`, and
reports import-map, module-load, and mount failures separately. Runtime errors
include the original error message instead of a broad fallback.

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
  `symbiote-workspace/browser` and `symbiote-ui`, `<script type="importmap">`
  ordering, `mountWorkspace()`, and `symbiote-ui.applyCascadeTheme`;
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
npx symbiote-workspace mcp
```

Exposes all 66 tools from the unified runtime registry via JSON-RPC over stdio.
Agents can classify, plan,
propose, validate, apply, export, mutate, and query workspaces
programmatically.

## Tools Reference

| Category | Tools |
|----------|-------|
| **Discovery** | `describe_workspace` `discover_components` `find_component` `list_component_tags` `list_categories` `list_used_components` |
| **Scaffold** | `list_templates` `scaffold_workspace` `scaffold_from_scratch` |
| **Construction** | `classify_workspace` `plan_workspace` `construct_workspace` `propose_workspace_patch` `validate_workspace_patch` `apply_workspace_patch` `export_workspace` |
| **Groups** | `add_group` `remove_group` `update_group` `reorder_groups` `list_groups` |
| **Sections** | `add_section` `remove_section` `update_section` `reorder_sections` `list_sections` |
| **Layout** | `set_layout` `add_panel` `remove_panel` `resize_panel` `update_layout_behavior` |
| **Panel Types** | `register_panel_type` `update_panel_type` `unregister_panel_type` `list_panel_types` |
| **Menu Actions** | `add_menu_action` `remove_menu_action` `toggle_menu_action` `list_menu_actions` |
| **Behaviors** | `set_behavior` `get_behavior` `update_behavior` |
| **Widgets** | `mount_widget` `unmount_widget` `swap_widget` |
| **Events** | `bridge_event` `unbridge_event` `list_bridges` |
| **Sharing** | `export_config` `import_config` `diff_configs` `merge_configs` |
| **Workspace Package** | `export_workspace_package` `import_workspace_package` `validate_workspace_package` `inspect_workspace_package` `create_workspace_package_construction_context` `create_workspace_packages_construction_context` `create_workspace_construction_handoff` |
| **Plugin Metadata** | `collect_plugin_module_capabilities` `collect_plugin_workspace_templates` |
| **Preview** | `start_preview` |
| **Validation** | `validate_config` `check_guardrails` |
| **File I/O** | `save_config` `load_config` |

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
descriptor settings. Existing panel type menu actions and settings are
preserved, so templates can keep authored shell commands and controls while
external descriptors still expose executable declarations when they create
panels.

The constructor copies matching descriptor capabilities, actions, settings,
state fields, events, bindings, runtime slots, placement hints, and required
host service IDs into `config.construction.plan.modules`. Selected modules
also expose `matchedCapabilities` and `selectionReason`; aggregate coverage is
stored in `config.construction.plan.capabilities`.
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

## Browser Theme Mounting

`symbiote-workspace/browser` exports browser-safe schema, loader, constructor,
sharing, validation, and plugin APIs plus DOM mounting helpers. Node-only
runtime dispatch remains in `symbiote-workspace/runtime`.

The browser entrypoint applies workspace theme config when mounting:

```javascript
import { mountWorkspace } from 'symbiote-workspace/browser';
import { applyCascadeTheme } from 'symbiote-ui';

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

## Plugin System

Everything beyond core libraries is a plugin: provider bridges, handler packs,
UI components, themes, and integrations.

### Plugin Format

```javascript
// my-plugin.plugin.js
export default {
  name: '@symbiote/my-plugin',
  version: '1.0.0',
  category: 'handler',            // handler | provider | component | theme | integration

  // Engine handlers (registered in symbiote-engine Registry)
  handlers: [
    {
      type: 'my/action',
      driver: {
        inputs: [{ name: 'data', type: 'any' }],
        outputs: [{ name: 'result', type: 'any' }],
      },
      lifecycle: {
        execute: async (inputs, params) => { /* ... */ },
      },
    },
  ],

  // UI components as tag names or module capability descriptors
  components: [
    'sn-my-widget',
    {
      tagName: 'sn-data-table',
      provider: 'symbiote-ui',
      capabilities: ['data.table'],
      toolbarItems: [{
        id: 'filter',
        label: 'Filter',
        engine: { graphId: 'table-flow', nodeId: 'filter', input: 'rows' },
      }],
      bindings: [{
        id: 'rows',
        direction: 'input',
        path: 'data.rows',
        engine: { graphId: 'table-flow', nodeId: 'rows', output: 'rows', pack: 'table-pack' },
      }],
      requiredHostServices: ['storage.project'],
    },
  ],

  // Plugin-level portable requirements
  capabilities: ['admin.table'],
  requiredHostServices: ['storage.project'],

  // Workspace integration
  workspace: {
    configSchema: { myParam: { type: 'string' } },
  },

  // Lifecycle hooks
  activate: (ctx) => { /* ctx.server, ctx.graph, ctx.wss, ctx.broadcast */ },
  deactivate: () => { /* cleanup */ },
};
```

### Plugin API

```javascript
import {
  MODULE_CAPABILITY_DESCRIPTOR_SCHEMA,
  MODULE_CAPABILITY_SCHEMA_VERSION,
  registerPlugin,
  activatePlugin,
  unregisterPlugin,
  listPlugins,
  validatePlugin,
  validateModuleCapabilityDescriptor,
  validatePortableStringArray,
  collectPluginModuleCapabilities,
  collectPluginWorkspaceTemplates,
} from 'symbiote-workspace/plugins';

let result = registerPlugin(myPlugin);
console.log(result.ok); // true

await activatePlugin('@symbiote/my-plugin', { server, graph });

console.log(listPlugins());
// [{ name: '@symbiote/my-plugin', version: '1.0.0', category: 'handler', status: 'active' }]

let capabilities = collectPluginModuleCapabilities([myPlugin]);
if (!capabilities.ok) {
  throw new Error(JSON.stringify(capabilities.errors));
}

// Pass plugin-provided module descriptors into constructor or dispatch APIs.
console.log(capabilities.moduleCapabilities);
console.log(MODULE_CAPABILITY_SCHEMA_VERSION);
validateModuleCapabilityDescriptor(
  capabilities.moduleCapabilities[0],
  'moduleCapabilities[0]',
  []
);
validatePortableStringArray(['analysis.sentiment'], 'capabilities', []);

let templates = collectPluginWorkspaceTemplates([myPlugin]);
if (!templates.ok) {
  throw new Error(JSON.stringify(templates.errors));
}

console.log(templates.templates);
```

`collectPluginModuleCapabilities()` returns only object entries from
`plugin.components`. String component tags remain valid registry/catalog
entries, but they are not converted into module capability descriptors.
Plugin-level `capabilities` and `requiredHostServices` describe the plugin
itself and are not copied onto individual components.
The same module capability schema helpers are exported from
`symbiote-workspace/schema`, the root entrypoint, the browser entrypoint, and
`symbiote-workspace/plugins` for consumers that validate descriptors at package
boundaries, including `validatePortableStringArray()` for portable capability
and service ID lists.

`collectPluginWorkspaceTemplates()` returns validated entries from
`plugin.workspace.templates`. Each entry uses `{ name, description?, config }`,
where `name` is a portable template identifier and `config` is a strict
workspace config. Pass `templates.templates` to constructor or dispatch APIs as
`workspaceTemplates`; the constructor stays plugin-neutral and only consumes the
plain portable entries.

The same metadata collectors are exposed through dispatch/MCP as
`collect_plugin_module_capabilities` and `collect_plugin_workspace_templates`,
and through the CLI as `collect-plugin-module-capabilities` and
`collect-plugin-workspace-templates`. These tools validate and collect metadata
only; they do not activate plugins or initialize workspace session state.

## Portability Rules

Workspace configs are **portable JSON** — shareable like ComfyUI projects:

- ❌ No auth tokens, API keys, secrets
- ❌ No server URLs or endpoints
- ❌ No user identity or session data
- ✅ Theme params, layout trees, component references
- ✅ Host-agnostic: any compliant host assembles from config

## Templates

Built-in workspace templates for quick start:

```bash
npx symbiote-workspace list-templates
# chat, editor, graph, dashboard, admin, agent-workspace, social-automation, video-studio
```

```javascript
import { listTemplates, getTemplate } from 'symbiote-workspace/constructor';

listTemplates();
// ['chat', 'editor', 'graph', 'dashboard', 'admin', 'agent-workspace', 'social-automation', 'video-studio']

let template = getTemplate('chat');
console.log(template.config); // Full workspace config
```

Canonical templates include module capability descriptors in
`config.components.modules`, so construction plans can map selected panels to
portable capabilities, actions, state fields, bindings, runtime slots, placement
hints, and required host services.

Constructor and dispatch APIs also accept external templates as plain data:

```javascript
import { planWorkspaceConstruction } from 'symbiote-workspace/constructor';
import { collectPluginWorkspaceTemplates } from 'symbiote-workspace/plugins';

let templates = collectPluginWorkspaceTemplates([myPlugin]);
let { config } = planWorkspaceConstruction({
  brief: 'build a team room',
  template: 'team-ai-room',
}, {
  workspaceTemplates: templates.templates,
});
```

CLI construction commands accept the same input with
`--workspace-templates <json-array>`.

External templates can model collaboration products such as command chats, team
rooms, and voice/video rooms with neutral capability tags, for example
`room.command`, `room.transcript`, `room.video`, `call.controls`, and
`presence.roster`. Required services and runtime providers stay declarative in
`requiredHostServices` and `runtimeSlots`; the host supplies actual realtime
media, agent runtime, presence, and storage implementations.

### Workspace Package

The workspace package format wraps a portable workspace config with manifest
metadata, a host integration contract, dependency lists, and asset references
for distribution and discovery.

```javascript
import {
  exportWorkspacePackage,
  importWorkspacePackage,
  createWorkspaceConstructionHandoff,
  createWorkspacePackageConstructionContext,
  createWorkspacePackagesConstructionContext,
  inspectWorkspacePackage,
  prepareConstructionIntentWithPackageContext,
  validateWorkspacePackage,
  WORKSPACE_PACKAGE_KIND,
  WORKSPACE_PACKAGE_SCHEMA_VERSION,
} from 'symbiote-workspace';
```

`exportWorkspacePackage(config, manifest)` exports the workspace config in
strict mode, collects host contract requirements, normalizes the manifest
(id, version, tags, permissions, dependencies, assets), and returns a
validated package object with JSON output. A successful package requires a
portable manifest `id`; name, version, compatibility, tags, permissions,
dependencies, and asset lists are normalized from the manifest and config.

`importWorkspacePackage(json)` parses a workspace package JSON string,
validates it against the package schema, and returns both the parsed package
and its workspace config as separate objects.

`validateWorkspacePackage(packageObject)` validates a workspace package object
in isolation, checking the package kind and schema version, workspace config
validity, manifest portability, and host contract integrity, without requiring
JSON serialization. Dispatch/MCP `validate_workspace_package` returns
`status: "ok"` for valid packages and accepts either a `package` object or a
`json` package string; the CLI exposes those forms as `--package` and `--json`.
Invalid packages keep `valid: false` and `errors`, and also return
`status: "error"`, `code: "workspace_package_invalid"`, and
`nextAction: "fix-workspace-package"` so transports can signal failure.

`inspectWorkspacePackage(input, options)` inspects a workspace package
object or JSON string without requiring a full host. Returns `valid` (no
structural errors), `ready` (`valid` and no missing-dependency warnings),
`package`, `config`, `summary`, `compatibility`, `requirements`, and
`missing`. Pass an optional `options.available` host-neutral inventory
(`components`, `plugins`, `packages`, `hostServices`, `runtimeSlots`) to
detect missing capabilities; missing items lower `ready` to `false` through
warnings. Dispatch/MCP `inspect_workspace_package` returns the transport-safe
inspection summary, readiness, `nextAction`, warnings, and errors without
echoing the full package or config. No marketplace or product-install semantics
are applied.

`createWorkspacePackageConstructionContext(input, options)` projects a valid
workspace package into constructor-ready data without installing or activating
anything. It reuses package inspection and returns external `workspaceTemplates`,
package `moduleCapabilities`, explicit `requiredCapabilities`, package
requirements, readiness gaps, and source metadata. Pass the returned
`workspaceTemplates`, `moduleCapabilities`, and `requiredCapabilities` to
`planWorkspaceConstruction()` or the construction dispatch tools.
Dispatch and MCP handoff flows preserve those package-provided templates and
module descriptors through `plan_workspace`, `construct_workspace`, and exported
workspace config output.

`createWorkspacePackagesConstructionContext({ packages, available })` aggregates
multiple package entries (`{ package, templateName }` or `{ json, templateName }`)
into one constructor-ready context. Duplicate workspace template names or module
`tagName` descriptors are blocking conflicts; host availability gaps remain
warnings and keep the context structurally valid but not ready. Package
inspection and construction-context helpers expose a compact `readiness` summary
with `status`, counts, and `nextAction` so agents can choose construct, review,
or fix flows before creating a handoff. The same helper is exposed through
dispatch/MCP as `create_workspace_packages_construction_context` and through the
CLI as `create-workspace-packages-construction-context`.

`prepareConstructionIntentWithPackageContext(intent, context)` returns a cloned
constructor intent with package-required capabilities merged and sorted into
`requiredCapabilities`. Use it when a host wants to inspect or route the prepared
intent before creating a handoff.

`createWorkspaceConstructionHandoff(context, intent)` converts a single-package
or package-collection construction context into a handoff envelope with
`_type: "workspace-construction-handoff"` plus the exact `{ intent, options }`
shape consumed by `planWorkspaceConstruction(handoff.intent, handoff.options)`.
It uses `prepareConstructionIntentWithPackageContext()` to merge package
`requiredCapabilities` into the supplied construction intent and passes only
valid package templates and module descriptors through. The
handoff also carries `options.packageContext`, which construction plans copy to
`plan.packageContext` and `config.construction.packageContext` so agents can see
package source, requirements, missing capability gaps, warnings, and readiness
without re-inspecting the package.
Dispatch/MCP/CLI handoff responses mirror the same package decision data as
top-level `readiness` and `nextAction`, so agents can route immediately after
creating a handoff without parsing nested `options.packageContext`.
Plans also include `plan.readiness.package`, a compact summary with package
validity, readiness status, source count, missing/warning/error counts, and the
next action (`construct`, `review-package-readiness`, or
`fix-package-context`). Dispatch/MCP responses expose the highest-priority
recovery summary as top-level `readiness`: package readiness when package
context is invalid or not ready, and required-module-capability readiness when a
ready package context still leaves unmatched required capabilities.
Package readiness is only `ready` when the package context is valid, explicitly
ready, and has no missing requirements, warnings, or errors. `plan_workspace`
exposes top-level blocked readiness for missing required module capabilities so
agents can recover before calling `construct_workspace`.
`plan_workspace` accepts not-ready handoffs for diagnostics, but
`construct_workspace` rejects `ready: false` handoffs so agents cannot
materialize a degraded package workspace without resolving readiness gaps first.
The construct gate also rejects stale handoffs that omit `ready` while still
carrying missing capabilities or warning diagnostics, and rejects contradictory
`ready: true` handoffs that still carry missing capabilities or warnings.
Invalid handoff errors include `code: "construction_handoff_invalid"` and
`nextAction: "fix-package-context"`; not-ready errors include
`code: "construction_handoff_not_ready"` and
`nextAction: "review-package-readiness"`. Both error paths return a structured
`readiness` payload with missing capabilities, diagnostics, counts, status, and
package source metadata. Missing capability entries also include `recovery`
steps such as `register-component`, `install-plugin`, or `provide-host-service`
so agents can route the next action without parsing prose.
Invalid helper intent inputs in `create_workspace_construction_handoff` return
`code: "construction_handoff_intent_invalid"` and
`nextAction: "fix-construction-intent"` across dispatch, CLI, and MCP.
It is exposed through dispatch/MCP as `create_workspace_construction_handoff`
and through the CLI as `create-workspace-construction-handoff`.

```javascript
let context = createWorkspacePackageConstructionContext(packageJson, {
  templateName: 'review-package',
});

let handoff = createWorkspaceConstructionHandoff(context, {
  brief: 'Build a review queue workspace',
  template: 'dashboard',
});

let { config, plan } = planWorkspaceConstruction(handoff.intent, handoff.options);
```

The dispatch/MCP tools accept the same handoff object directly:

```javascript
await dispatch('plan_workspace', handoff, session);
await dispatch('construct_workspace', handoff, session);
```

The CLI accepts the same handoff object as a single positional JSON argument,
or constructor options with `--options <json-object>` when agents pass only the
handoff options through shell arguments:

```bash
npx symbiote-workspace plan-workspace '{"_type":"workspace-construction-handoff","valid":true,"ready":true,"intent":{"brief":"Build a review queue workspace","template":"dashboard"},"options":{"workspaceTemplates":[],"moduleCapabilities":[]}}'
```

The manifest rejects host, identity, and marketplace state:

- **host/identity keys**: `token`, `secret`, `session`, `user`, `credential`,
  `endpoint`, `password`, `profile`, `organization`, `tenant`, `billing`,
  `subscription`
- **marketplace keys**: `price`, `seller`, `marketplace`, `licenseKey`,
  `licenseServer`, `purchase`, `rating`, `payout`, `listing`
- **non-portable values**: `file://` URIs, absolute paths (`/Users/`,
  `/home/`, `/tmp/`), HTTP/WS URLs in dependency and asset fields

## Related Packages

- [`symbiote-ui`](https://github.com/RND-PRO/symbiote-ui) - Web Components, provider catalogs, layout metadata, and component descriptors.
- [`symbiote-engine`](https://github.com/RND-PRO/symbiote-engine) - runtime execution, CLI commands, server helpers, persistence, and handlers.
- [`symbiote-node`](https://github.com/RND-PRO/symbiote-node) - terminal migration facade for older imports.

## License

MIT
