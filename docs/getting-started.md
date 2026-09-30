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

let construction = planWorkspaceConstruction('build me a chat workspace', {
  name: 'My Chat',
  register: 'tool',
});
let { config } = construction;

let validation = validateWorkspaceConfig(config);
if (!validation.valid) {
  throw new Error(validation.errors.map((error) => error.message).join('; '));
}

let guardrails = checkDesignGuardrails(config);
if (!guardrails.pass) {
  throw new Error(guardrails.issues.map((issue) => issue.message).join('; '));
}

let proposal = await proposeWorkspacePatch(config, {
  overlay: { theme: { params: { mode: 'dark', hue: 220 } } },
});
if (proposal.accepted) {
  config = (await applyWorkspacePatch(config, proposal.overlay)).config;
}

let { json } = exportConfig(config, { strict: true });
let contract = createHostIntegrationContract(config);

console.log(json);
console.log(contract.contract.browser.requiredImports);
```

### Unified Dispatch

```javascript
import { dispatch, createSession, TOOLS } from 'symbiote-workspace/runtime';

let session = createSession();

let planned = await dispatch('construction_plan', {
  intent: 'chat workspace',
  name: 'My Chat',
}, session);

let imported = await dispatch('config_import', {
  json: JSON.stringify(planned.config),
  baseRevision: session.revision,
}, session);

let patched = await dispatch('config_patch_apply', {
  overlay: { theme: { params: { mode: 'dark', hue: 220 } } },
  baseRevision: imported.revision,
}, session);

let result = await dispatch('config_validate', {}, session);
console.log(result.valid);
console.log(patched.revision);
console.log(TOOLS.length);
```

Mutating dispatch tools require `baseRevision`. Use the revision returned by
the previous mutating result, or `session.revision` before the first mutation.

## CLI

From a checked-out repository, registry tools are available as kebab-case CLI
commands. For example, the `construction_plan` tool is
`construction-plan`, and `config_patch_apply` is `config-patch-apply`.

```bash
# Construction
node cli.js construction-template-list
node cli.js construction-classify "agent review workspace"
node cli.js construction-plan "agent review workspace" --name "Review Desk"
node cli.js construction-scaffold-blank --config ws.json --base-revision 0 --name "Blank Workspace"

# Stateful config flow
node cli.js config-validate ws.json
node cli.js config-export --config ws.json --strict
node cli.js config-patch-propose --config ws.json --overlay '{"theme":{"params":{"mode":"dark","hue":220}}}'
node cli.js config-patch-validate --config ws.json --overlay '{"name":"Review Desk"}'
node cli.js config-patch-apply --config ws.json --base-revision 1 --overlay '{"name":"Review Desk"}'

# Structure helpers
node cli.js module-register --config ws.json --base-revision 2 --name records --title Records --component sn-data-table
node cli.js layout-behavior-update --config ws.json --base-revision 3 --target root --updates '{"responsiveMode":"drawer"}'
node cli.js module-workflow-kanban --config ws.json --base-revision 4 --panel-type approvals --board '{"id":"release-flow","columns":[{"id":"todo","title":"Todo","cards":[]}]}'

# Discovery and catalog
node cli.js component-discover
node cli.js component-find --tag-name sn-data-table
node cli.js component-tags-list
node cli.js catalog-search --query table
node cli.js catalog-describe --ids '["symbiote-ui:data-table"]' --depth summary

# Media evidence and virtual sequence (read-only)
node cli.js media-sequence-validate --sequence '{...}'
node cli.js media-sequence-project --sequence '{...}' --tick 900
node cli.js media-sequence-invalidate --sequence '{...}' --changed-layers '["overlay"]'
node cli.js media-evidence-validate --manifest '{...}'

# Preview, server, and MCP mode
node cli.js preview-start ws.json --output-dir .workspace-preview
node cli.js serve --port 3100 --plugins-dir ./plugins
node cli.js mcp
```

`serve` and `mcp` are special commands. All other tool commands are generated
from the live registry.

## Tool Families

The runtime registry currently exposes 89 tools through CLI and MCP:

| Family | Tools |
|--------|-------|
| Discovery | `workspace_describe`, `component_discover`, `component_find`, `component_tags_list`, `component_categories_list`, `component_usage_list` |
| Construction | `construction_template_list`, `construction_scaffold`, `construction_scaffold_blank`, `construction_classify`, `construction_questions_build`, `construction_question_answer`, `construction_plan`, `construction_construct` |
| Structure | `layout_set`, `panel_add`, `panel_remove`, `panel_resize`, `module_register`, `module_update`, `module_unregister`, `module_list`, `layout_behavior_set`, `layout_behavior_get`, `layout_behavior_update`, `panel_component_mount`, `panel_component_unmount`, `panel_component_swap`, `module_workflow_kanban` |
| Config | `config_patch_propose`, `config_patch_validate`, `config_patch_apply`, `preview_start`, `config_validate`, `config_save`, `config_load`, `config_export`, `config_import`, `config_diff`, `config_merge`, `config_guardrails_check` |
| Package | `pack_export`, `pack_import`, `pack_validate`, `pack_inspect`, `pack_context_create`, `pack_contexts_create`, `pack_handoff_create`, `pack_plugin_modules_collect`, `pack_plugin_templates_collect` |
| Route | `navigate`, `resolve_route` |
| Document | `collection.list`, `collection.query`, `collection.create`, `collection.delete`, `document.load`, `document.commit`, `document.patches`, `document.delete`, `document.snapshot`, `document.presentation.save`, `document.presentation.load` |
| Session | `workspace.session.load`, `workspace.session.commit`, `workspace.session.snapshot.save`, `workspace.session.snapshot.load`, `workspace.session.snapshot.list`, `layout_promote_geometry`, `session.layout.undo` |
| Hook | `hook_add`, `hook_update`, `hook_remove`, `hook_list`, `preview_hook_matches` |
| Grant | `grant_list`, `grant_revoke` |
| Execution | `execution_submit`, `execution_cancel`, `execution_reorder`, `execution_attach`, `execution_list` |
| Catalog | `catalog_search`, `catalog_describe`, `catalog_proof` |
| Media | `media_sequence_validate`, `media_sequence_project`, `media_sequence_invalidate`, `media_evidence_validate` |

## Browser Preview

`preview_start` writes `index.html`, `app.js`, `workspace.config.json`, and
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

When `imports` is omitted, preview defaults to local package specifiers and the
returned `hint` identifies the serve root for `symbiote-workspace/browser`,
`symbiote-ui/ui`, `symbiote-engine`, and `symbiote-engine/contracts`.

The generated runtime imports `applyCascadeTheme` and
`applyCascadeGeometryRegister` from `symbiote-ui/ui`, passes them as
`themeAdapter` to `mountWorkspace()`, verifies import-map support before loading
bare modules, renders loader warnings with `data-preview-warning`, and reports
import-map, module-load, and mount failures separately.

## Visual Demo Process

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
workspace and panel DOM. The default driver uses Chrome DevTools Protocol. For
environments where local Chrome/CDP is unavailable, use the Playwright driver
after installing a Playwright browser:

```bash
npx playwright install webkit
SYMBIOTE_BROWSER_DRIVER=playwright SYMBIOTE_PLAYWRIGHT_BROWSER=webkit \
  npm run test:visual-demo-browser -- --demo realtime-builder --timeout 70000
```

`SYMBIOTE_PLAYWRIGHT_BROWSER` and `--playwright-browser` accept `chromium`,
`firefox`, or `webkit`. Smoke output is temporary by default; pass
`--keep-output` or set `SYMBIOTE_BROWSER_SMOKE_KEEP=1` when retaining generated
proof artifacts for inspection.
