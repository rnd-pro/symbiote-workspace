# Getting Started and Preview

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

From a checked-out repository, all registered tools are available as CLI
commands through the local entrypoint:

```bash
# Scaffold
node cli.js scaffold chat --name "My Chat"
node cli.js scaffold-from-scratch --name "Blank WS"
node cli.js list-templates

# Stateful mode (--config auto-saves on mutations)
node cli.js scaffold dashboard --config ws.json
node cli.js classify-workspace "agent review workspace"
node cli.js plan-workspace "agent review workspace" --name "Review Desk"
node cli.js propose-workspace-patch --config ws.json --overlay '{"theme":{"params":{"mode":"dark","hue":220}}}'
node cli.js validate-workspace-patch --config ws.json --overlay '{"register":"editor"}'
node cli.js apply-workspace-patch --config ws.json --overlay '{"name":"Review Desk"}'
node cli.js export-workspace --config ws.json
node cli.js add-group --config ws.json --id analytics --name Analytics
node cli.js add-section --config ws.json --groupId analytics --id overview --label Overview
node cli.js register-panel-type --config ws.json --name chart --title Chart --component sn-chart
node cli.js set-layout --config ws.json --layoutTree '{"type":"split","direction":"horizontal","ratio":0.3,"first":{"type":"panel","panelType":"sidebar"},"second":{"type":"panel","panelType":"chart"}}'

# Discovery (auto-detects symbiote-ui)
node cli.js discover
node cli.js find-component --tagName sn-data-table
node cli.js list-component-tags
node cli.js list-categories

# Validation
node cli.js validate workspace.json
node cli.js describe workspace.json
node cli.js preview workspace.json --output-dir .workspace-preview

# Server
node cli.js serve --port 3100 --plugins-dir ./plugins

# MCP mode
node cli.js mcp
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
    'symbiote-ui/ui': './mock-symbiote-ui.js',
    'symbiote-engine': './mock-symbiote-engine.js',
    'symbiote-engine/contracts': './mock-symbiote-engine-contracts.js',
  },
});
```

The generated `app.js` and `workspace.config.json` use the same portable config
sanitizer as export/import flows, so host/session fields and local paths are not
copied into preview runtime state.

When `imports` is omitted, preview defaults to local workspace paths and the
returned `hint` serves the repository root so `symbiote-workspace/browser`,
`symbiote-ui/ui`, `symbiote-engine`, and `symbiote-engine/contracts` can
resolve from the generated import map.

The generated runtime imports `applyCascadeTheme` from
`symbiote-ui/ui`, passes it as `themeAdapter` to
`mountWorkspace()`, verifies import-map support before loading bare modules,
renders loader warnings with `data-preview-warning`, and reports import-map,
module-load, and mount failures separately. Runtime errors include the original
error message instead of a broad fallback.

### Visual Demo Process

The packaged visual demo runs the same portable construction path that agents
use: classify intent, create a construction handoff, plan and construct the
workspace, validate it, strictly export/import the config, write preview files,
and serve the generated browser preview. The browser fallback renderer
materializes the portable layout as styled split panels when no host runtime
controller is supplied.

```bash
npm run demo:visual
```

For CI or package smoke checks, write the preview artifacts without starting a
server:

```bash
node examples/visual-demo/preview.js --write-only --output-dir tmp/visual-demo-preview
```

Run the realtime builder demo locally:

```bash
npm run demo:realtime-builder
```

Use the opt-in browser smoke when a release gate needs real render evidence:

```bash
npm run test:visual-demo-browser
```

It launches the visual demo server and a Chrome-compatible browser, then checks
that the preview mounts without `[data-preview-error]` and renders the expected
workspace and panel DOM. The default driver uses Chrome DevTools Protocol.
For environments where local Chrome/CDP is unavailable, use the Playwright
driver after installing a Playwright browser:

```bash
npx playwright install webkit
SYMBIOTE_BROWSER_DRIVER=playwright SYMBIOTE_PLAYWRIGHT_BROWSER=webkit \
  npm run test:visual-demo-browser -- --demo realtime-builder --timeout 70000
```

`SYMBIOTE_PLAYWRIGHT_BROWSER` and `--playwright-browser` accept `chromium`,
`firefox`, or `webkit`. Smoke output is temporary by default; pass
`--keep-output` or set `SYMBIOTE_BROWSER_SMOKE_KEEP=1` when retaining generated
proof artifacts for inspection.
