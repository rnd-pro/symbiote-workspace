[![npm version](https://img.shields.io/npm/v/symbiote-workspace)](https://www.npmjs.com/package/symbiote-workspace) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org) [![ESM](https://img.shields.io/badge/ESM-only-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)

# symbiote-workspace

**symbiote-workspace turns chat intent into portable, executable Symbiote
workspaces. Fast.**

Build professional agent workspaces from plain JSON configs: layout shells,
panels, modules, actions, events, data bindings, Cascade themes, plugin
metadata, runtime slots, host requirements, and browser assembly. The package
gives agents a direct path from user intent to a relaunchable workspace without
forking a product app, hardcoding a host, or generating one-off UI code first.

![Realtime Symbiote workspace builder demo](./docs/assets/realtime-builder-demo.png)

## Why symbiote-workspace?

- **One artifact for the whole workspace** — layout, modules, theme, bindings,
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
  actions, menus, toolbars, settings, events, slots, engine bindings, and data
  bindings into executable workspace surfaces.
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

### Unified Agent Tooling

- **69 tools over CLI/MCP** — one `runtime/dispatch.js` registry drives CLI commands,
  MCP JSON-RPC, tests, and package-consumer verification.
- **Workflow kanban tool** — `workflow_kanban` registers portable workflow-board
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
let planned = await dispatch('plan_workspace', {
  intent: 'video editing studio for agentic media review',
  name: 'Launch Cut',
}, session);

await dispatch('import_config', {
  json: JSON.stringify(planned.config),
}, session);

let result = await dispatch('validate_config', {}, session);
console.log(result.valid);
```

## CLI

```sh
node cli.js classify-workspace "agent review workspace"
node cli.js plan-workspace "agent review workspace" --name "Review Desk"
node cli.js validate workspace.json
node cli.js mcp
```

All CLI and MCP tools route through the same dispatch registry. The full tool
list and aliases live in [Getting Started and Preview](./docs/getting-started.md)
and [Host Contracts and Construction Protocol](./docs/host-contracts.md).

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
  CLI aliases, generated browser previews, and visual demo commands.
- [Host Contracts and Construction Protocol](./docs/host-contracts.md) — strict
  export/import, MCP tools, workspace config, construction planning, and theme
  mounting.
- [Plugins, Portability, and Templates](./docs/plugins-and-templates.md) —
  plugin format, module capabilities, portability rules, templates, and
  workspace packages.

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
