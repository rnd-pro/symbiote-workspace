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

## Entry Points

- `symbiote-workspace` — Node-safe root: schema, loader, constructor, sharing, validation, plugins
- `symbiote-workspace/browser` — Browser-only: DOM mounting + all isomorphic APIs
- `symbiote-workspace/plugins` — Plugin schema, validation, and registry
- `symbiote-workspace/server` — Node-only: workspace server + plugin loader
- `symbiote-workspace/schema` — Schema definitions and validators only

### Modules

| Module | Entry point | Responsibility |
|--------|------------|---------------|
| **Schema** | `symbiote-workspace/schema` | Config JSON Schema, validation, versioning |
| **Loader** | `symbiote-workspace/loader` | Config → component resolution, theme extraction |
| **Constructor** | `symbiote-workspace/constructor` | Intent → workspace plan, template matching |
| **Sharing** | `symbiote-workspace/sharing` | Export, import, diff, merge configs |
| **Validation** | `symbiote-workspace/validation` | Design guardrails, register density checks |
| **Plugins** | `symbiote-workspace/plugins` | Plugin format, validation, registry with lifecycle |
| **Server** | `symbiote-workspace/server` | Plugin loader + workspace server wrapper |

## Quick Start

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

## Server Mode

Start a workspace server with plugins. Requires `symbiote-engine` as a peer dependency.

### Programmatic

```javascript
import { createWorkspaceServer } from 'symbiote-workspace/server';

let { server, wss, graph, plugins, close } = await createWorkspaceServer({
  port: 3100,
  pluginsDir: './plugins',           // scan for .plugin.js files
  plugins: ['@symbiote/pack-ai'],    // npm packages
  handlersDir: './handlers',         // .handler.js files (engine compat)
  workflowFile: './project.workflow.json',
  verbose: true,
});
```

### CLI

```bash
npx symbiote-workspace serve --port 3100 --plugins-dir ./plugins
npx symbiote-workspace serve --plugins @symbiote/tunnel-cloudflare
npx symbiote-workspace validate workspace.config.json
npx symbiote-workspace plan "build me a video editor"
npx symbiote-workspace list-templates
```

## Workspace Config

```json
{
  "version": "0.1.0",
  "name": "My Workspace",
  "register": "tool",
  "theme": {
    "params": { "mode": "dark", "hue": 220 },
    "overrides": { "--sn-gap": "8px" }
  },
  "layout": {
    "type": "split",
    "direction": "horizontal",
    "ratio": [0.3, 0.7],
    "children": [
      { "type": "single", "component": "sn-tree-panel" },
      { "type": "single", "component": "sn-editor" }
    ]
  },
  "components": {
    "catalog": ["sn-tree-panel"],
    "custom": [{ "tagName": "sn-editor", "code": "..." }]
  }
}
```

### Register Values

| Register | Max Panels | Min Ratio | Use Case |
|----------|-----------|-----------|----------|
| `tool` | 12 | 0.1 | Dense professional UI (IDE, studio) |
| `brand` | 6 | 0.2 | Marketing, landing pages |
| `presentation` | 4 | 0.25 | Slides, demos, showcases |

## Portability Rules

Workspace configs are **portable JSON** — shareable like ComfyUI projects:

- ❌ No auth tokens, API keys, secrets
- ❌ No server URLs or endpoints
- ❌ No user identity or session data
- ✅ Theme params, layout trees, component references
- ✅ Host-agnostic: any compliant host assembles from config

## Templates

Built-in workspace templates for quick start:

```javascript
import { listTemplates, getTemplate } from 'symbiote-workspace/constructor';

listTemplates(); // ['chat', 'editor', 'graph', 'dashboard']

let template = getTemplate('chat');
console.log(template.config); // Full workspace config
```

## Related Packages

- [`symbiote-ui`](https://github.com/RND-PRO/symbiote-ui) - Web Components, provider catalogs, layout metadata, and WebMCP descriptors.
- [`symbiote-engine`](https://github.com/RND-PRO/symbiote-engine) - runtime execution, CLI commands, server helpers, persistence, and handlers.
- [`symbiote-node`](https://github.com/RND-PRO/symbiote-node) - terminal migration facade for older imports.

## License

MIT
