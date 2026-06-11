# symbiote-workspace

Agent-driven workspace orchestration with plugin system: **intent → plan → build → serve**.

Portable workspace configs over [symbiote-ui](https://github.com/RND-PRO/symbiote-ui) primitives. Optional server mode via [symbiote-engine](https://github.com/RND-PRO/symbiote-engine).

## Install

```bash
npm install symbiote-workspace
```

For server mode (optional):

```bash
npm install symbiote-workspace symbiote-engine
```

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Dispatch                   │
│            50 tools, 1 registry             │
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
| `symbiote-workspace/browser` | Browser | DOM mounting + isomorphic APIs |
| `symbiote-workspace/plugins` | Node | Plugin schema, validation, registry |
| `symbiote-workspace/server` | Node | Workspace server + plugin loader |
| `symbiote-workspace/schema` | Node | Schema definitions, validators |

## Quick Start

### Programmatic

```javascript
import {
  planWorkspace,
  validateWorkspaceConfig,
  exportConfig,
  checkDesignGuardrails,
} from 'symbiote-workspace';

// 1. Plan from intent
let config = planWorkspace('build me a chat workspace', {
  name: 'My Chat',
  register: 'tool',
});

// 2. Validate
let validation = validateWorkspaceConfig(config);
console.log(validation.valid); // true

// 3. Check design guardrails
let guardrails = checkDesignGuardrails(config);
console.log(guardrails.pass); // true

// 4. Export for sharing
let { json } = exportConfig(config);
console.log(json); // portable JSON, no auth/server data
```

### Unified Dispatch

```javascript
import { dispatch, createSession, TOOLS } from 'symbiote-workspace/runtime';

let session = createSession();

// Scaffold
await dispatch('scaffold_workspace', { template: 'chat', name: 'My Chat' }, session);

// Mutate
await dispatch('add_group', { id: 'main', name: 'Main' }, session);
await dispatch('register_panel_type', {
  name: 'viewport', title: 'Viewport', component: 'sn-canvas-viewport',
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

All 50 tools available as CLI commands:

```bash
# Scaffold
npx symbiote-workspace scaffold chat --name "My Chat"
npx symbiote-workspace scaffold-from-scratch --name "Blank WS"
npx symbiote-workspace list-templates

# Stateful mode (--config auto-saves on mutations)
npx symbiote-workspace scaffold dashboard --config ws.json
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
| `plan` | `scaffold_workspace` |
| `describe` | `describe_workspace` |
| `discover` | `discover_components` |
| `validate` | `validate_config` |
| `preview` | `start_preview` |

## MCP (Model Context Protocol)

Start as MCP server for AI agent integration:

```bash
npx symbiote-workspace mcp
```

Exposes 50 tools via JSON-RPC over stdio. Agents can scaffold, mutate, query, and validate workspaces programmatically.

## Tools Reference

| Category | Tools |
|----------|-------|
| **Discovery** | `describe_workspace` `discover_components` `find_component` `list_component_tags` `list_categories` `list_used_components` |
| **Scaffold** | `list_templates` `scaffold_workspace` `scaffold_from_scratch` |
| **Groups** | `add_group` `remove_group` `update_group` `reorder_groups` `list_groups` |
| **Sections** | `add_section` `remove_section` `update_section` `reorder_sections` `list_sections` |
| **Layout** | `set_layout` `add_panel` `remove_panel` `resize_panel` `update_layout_behavior` |
| **Panel Types** | `register_panel_type` `update_panel_type` `unregister_panel_type` `list_panel_types` |
| **Menu Actions** | `add_menu_action` `remove_menu_action` `toggle_menu_action` `list_menu_actions` |
| **Behaviors** | `set_behavior` `get_behavior` `update_behavior` |
| **Widgets** | `mount_widget` `unmount_widget` `swap_widget` |
| **Events** | `bridge_event` `unbridge_event` `list_bridges` |
| **Sharing** | `export_config` `import_config` `diff_configs` `merge_configs` |
| **Preview** | `start_preview` |
| **Validation** | `validate_config` `check_guardrails` |
| **File I/O** | `save_config` `load_config` |

## Workspace Config

```json
{
  "version": "0.2.0",
  "name": "My Workspace",
  "register": "tool",
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
| `brand` | 6 | 0.2 | Marketing, landing pages |
| `presentation` | 4 | 0.25 | Slides, demos, showcases |

## Browser Theme Mounting

`symbiote-workspace/browser` applies workspace theme config when mounting:

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

Everything beyond core libraries is a plugin: tunnel providers, handler packs, UI components, marketplace, enterprise features.

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

  // UI components (tag names for symbiote-ui catalog)
  components: ['sn-my-widget'],

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
} from 'symbiote-workspace/plugins';

let result = registerPlugin(myPlugin);
console.log(result.ok); // true

await activatePlugin('my-plugin', { server, graph });

console.log(listPlugins());
// [{ name: 'my-plugin', version: '1.0.0', category: 'handler', status: 'active' }]
```

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
# chat, editor, graph, dashboard, video-studio
```

```javascript
import { listTemplates, getTemplate } from 'symbiote-workspace/constructor';

listTemplates(); // ['chat', 'editor', 'graph', 'dashboard', 'video-studio']

let template = getTemplate('chat');
console.log(template.config); // Full workspace config
```

## Related Packages

- [`symbiote-ui`](https://github.com/RND-PRO/symbiote-ui) - Web Components, provider catalogs, layout metadata, and WebMCP descriptors.
- [`symbiote-engine`](https://github.com/RND-PRO/symbiote-engine) - runtime execution, CLI commands, server helpers, persistence, and handlers.
- [`symbiote-node`](https://github.com/RND-PRO/symbiote-node) - terminal migration facade for older imports.

## License

MIT
