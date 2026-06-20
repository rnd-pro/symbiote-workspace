# Plugins, Portability, and Templates

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
Descriptor provider references are validated with the same portability rules as
workspace module descriptors, so plugin packs cannot introduce URL, file, or
local path provider metadata through component declarations.
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
node cli.js list-templates
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
Not-ready package readiness includes missing capability groups, recovery steps,
diagnostics, and package source metadata at that top level so orchestrators can
route follow-up work without parsing nested plan internals.
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
node cli.js plan-workspace '{"_type":"workspace-construction-handoff","valid":true,"ready":true,"intent":{"brief":"Build a review queue workspace","template":"dashboard"},"options":{"workspaceTemplates":[],"moduleCapabilities":[]}}'
```

The manifest rejects host, identity, and marketplace state:

- **host/identity keys**: `token`, `secret`, `session`, `user`, `credential`,
  `endpoint`, `password`, `profile`, `organization`, `tenant`, `billing`,
  `subscription`
- **marketplace keys**: `price`, `seller`, `marketplace`, `licenseKey`,
  `licenseServer`, `purchase`, `rating`, `payout`, `listing`
- **non-portable values**: local file URIs, home-directory or temporary
  absolute paths, HTTP/WS URLs in dependency and asset fields
