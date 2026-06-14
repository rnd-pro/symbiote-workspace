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
| `symbiote-workspace/plugins` | Isomorphic | Plugin schema, validation, registry |
| `symbiote-workspace/server` | Node | Workspace server + plugin loader |
| `symbiote-workspace/schema` | Node | Schema definitions, validators |

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

# Server
npx symbiote-workspace serve --port 3100 --plugins-dir ./plugins

# MCP mode (for AI agents)
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
await startPreview(config, {
  outputDir: '.workspace-preview',
  imports: {
    'symbiote-workspace/browser': './mock-workspace-browser.js',
    'symbiote-ui': './mock-symbiote-ui.js',
  },
});
```

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

Start as MCP server for AI agent integration:

```bash
npx symbiote-workspace mcp
```

Exposes all registered tools via JSON-RPC over stdio. Agents can classify, plan,
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
returned by `create_workspace_construction_handoff`.

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
`config.construction.plan.capabilities.missing`.

External descriptors that do not already have a matching `panelTypes` entry are
materialized from `placement.panelType` or `tagName`. The constructor copies
placement title, icon, and behavior into the generated panel type, and selected
generated panels are added to the root BSP layout when they are not present in
any existing layout.

The constructor copies matching descriptor capabilities, actions, settings,
events, bindings, runtime slots, placement hints, and required host service IDs
into `config.construction.plan.modules`. Selected modules also expose
`matchedCapabilities` and `selectionReason`; aggregate coverage is stored in
`config.construction.plan.capabilities`.
`validation.reports` and `patches` can persist machine-readable review results
from patch validation.

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
      toolbarItems: [{ id: 'filter', label: 'Filter' }],
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
  registerPlugin,
  activatePlugin,
  unregisterPlugin,
  listPlugins,
  validatePlugin,
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
portable capabilities, actions, bindings, runtime slots, placement hints, and
required host services.

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
JSON serialization.

`inspectWorkspacePackage(input, options)` inspects a workspace package
object or JSON string without requiring a full host. Returns `valid` (no
structural errors), `ready` (`valid` and no missing-dependency warnings),
`package`, `config`, `summary`, `compatibility`, `requirements`, and
`missing`. Pass an optional `options.available` host-neutral inventory
(`components`, `plugins`, `packages`, `hostServices`, `runtimeSlots`) to
detect missing capabilities; missing items lower `ready` to `false` through
warnings. No marketplace or product-install semantics are applied.

`createWorkspacePackageConstructionContext(input, options)` projects a valid
workspace package into constructor-ready data without installing or activating
anything. It reuses package inspection and returns external `workspaceTemplates`,
package `moduleCapabilities`, explicit `requiredCapabilities`, package
requirements, readiness gaps, and source metadata. Pass the returned
`workspaceTemplates`, `moduleCapabilities`, and `requiredCapabilities` to
`planWorkspaceConstruction()` or the construction dispatch tools.

`createWorkspacePackagesConstructionContext({ packages, available })` aggregates
multiple package entries (`{ package, templateName }` or `{ json, templateName }`)
into one constructor-ready context. Duplicate workspace template names or module
`tagName` descriptors are blocking conflicts; host availability gaps remain
warnings and keep the context structurally valid but not ready. The same helper
is exposed through dispatch/MCP as `create_workspace_packages_construction_context`
and through the CLI as `create-workspace-packages-construction-context`.

`createWorkspaceConstructionHandoff(context, intent)` converts a single-package
or package-collection construction context into the exact `{ intent, options }`
shape consumed by `planWorkspaceConstruction(handoff.intent, handoff.options)`.
It merges package `requiredCapabilities` into the supplied construction intent
and passes only valid package templates and module descriptors through.
It is exposed through dispatch/MCP as `create_workspace_construction_handoff`
and through the CLI as `create-workspace-construction-handoff`.

```javascript
let context = createWorkspacePackageConstructionContext(packageJson, {
  templateName: 'review-package',
});

let handoff = createWorkspaceConstructionHandoff(context, {
  brief: 'Build a review queue workspace',
  template: 'review-package',
});

let { config, plan } = planWorkspaceConstruction(handoff.intent, handoff.options);
```

The dispatch/MCP tools accept the same handoff object directly:

```javascript
await dispatch('plan_workspace', handoff, session);
await dispatch('construct_workspace', handoff, session);
```

The CLI exposes constructor options with `--options <json-object>` for cases
where agents pass a handoff options object through shell arguments.

The manifest rejects host, identity, and marketplace state:

- **host/identity keys**: `token`, `secret`, `session`, `user`, `credential`,
  `endpoint`, `password`, `profile`, `organization`, `tenant`, `billing`,
  `subscription`
- **marketplace keys**: `price`, `seller`, `marketplace`, `licenseKey`,
  `licenseServer`, `purchase`, `rating`, `payout`, `listing`
- **non-portable values**: `file://` URIs, absolute paths (`/Users/`,
  `/home/`, `/tmp/`), HTTP/WS URLs in dependency and asset fields

## Related Packages

- [`symbiote-ui`](https://github.com/RND-PRO/symbiote-ui) - Web Components, provider catalogs, layout metadata, and WebMCP descriptors.
- [`symbiote-engine`](https://github.com/RND-PRO/symbiote-engine) - runtime execution, CLI commands, server helpers, persistence, and handlers.
- [`symbiote-node`](https://github.com/RND-PRO/symbiote-node) - terminal migration facade for older imports.

## License

MIT
