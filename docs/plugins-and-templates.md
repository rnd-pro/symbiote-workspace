# Plugins, Portability, and Templates

## Plugin System

Plugins are namespaced manifests that contribute modules, panel/view fragments,
hooks, theme profiles, engine packs, narration metadata, and whole-config
templates. Current manifests use the `contributes.*` surface. Flat top-level
manifest keys (`handlers`, `components`, `workspace`, and `category`) are
rejected by `validatePluginDefinition()`.

### Plugin Format

```javascript
// acme-video.plugin.js
export default {
  name: 'acme.video',
  version: '1.0.0',
  description: 'Video review workspace contributions.',

  contributes: {
    modules: [
      {
        id: 'acme.video:preview',
        tagName: 'acme-video-preview',
        title: 'Preview',
        provider: 'acme.video',
        capabilities: ['media.preview'],
        actions: [
          {
            id: 'play',
            label: 'Play',
            does: { kind: 'emit', event: 'play' }
          }
        ],
        hostServices: {
          required: ['storage.project'],
          optional: []
        },
        lifecycle: { readiness: 'auto' }
      }
    ],

    packs: [
      {
        id: 'acme.video:media',
        handlers: [
          {
            type: 'video/webhook',
            trigger: { kind: 'ingress' },
            ui: { autoForm: true },
            credentialType: 'api-key',
            hostServices: { required: ['network.fetch'], optional: [] }
          }
        ]
      }
    ],

    templates: [
      {
        name: 'video-review',
        description: 'Video review desk.',
        config: {
          version: '1.0.0',
          name: 'Video Review'
        }
      }
    ]
  },

  hostServices: {
    required: ['storage.project'],
    optional: []
  },

  idLifecycle: {
    renames: {
      'acme.video:timeline': 'acme.video:preview'
    }
  }
};
```

Contribution ids are namespaced under the manifest `name`, for example
`acme.video:preview`. Rename targets in `idLifecycle.renames` must point to
current contribution ids; renamed-away ids must not still exist.

### Plugin API

```javascript
import {
  MODULE_CAPABILITY_DESCRIPTOR_SCHEMA,
  MODULE_CAPABILITY_SCHEMA_VERSION,
  PLUGIN_SCHEMA,
  validatePluginDefinition,
  validatePluginWorkspaceTemplate,
  validateModuleCapabilityDescriptor,
  validatePortableStringArray,
  registerPlugin,
  activatePlugin,
  unregisterPlugin,
  listPlugins,
  validatePlugin,
} from 'symbiote-workspace/plugins';

let validation = validatePluginDefinition(plugin);
if (!validation.valid) {
  throw new Error(JSON.stringify(validation.errors));
}

let module = plugin.contributes.modules[0];
let descriptorErrors = [];
validateModuleCapabilityDescriptor(module, 'contributes.modules[0]', descriptorErrors, {
  moduleId: module.id
});

validatePortableStringArray(['analysis.sentiment'], 'capabilities', []);
validatePluginWorkspaceTemplate(plugin.contributes.templates[0], 'contributes.templates[0]', []);

registerPlugin(plugin);
await activatePlugin('acme.video', { server, graph });
console.log(listPlugins());
console.log(MODULE_CAPABILITY_SCHEMA_VERSION);
console.log(PLUGIN_SCHEMA.properties.contributes);
console.log(MODULE_CAPABILITY_DESCRIPTOR_SCHEMA.required);

unregisterPlugin('acme.video');
```

The same module capability schema helpers are exported from
`symbiote-workspace/schema`, the root entrypoint, the browser entrypoint, and
`symbiote-workspace/plugins`.

## Portability Rules

Workspace configs are portable JSON:

- No auth tokens, API keys, or secrets
- No server URLs or endpoints
- No user identity or session data
- Theme params, layout trees, module references, and wires are portable
- Any compliant host assembles from config plus explicit host contracts

Provider references must be portable package or registry identifiers such as
`symbiote-ui` or `@acme/workspace-pack`; URLs, file references, home-directory
paths, and temporary paths are rejected before descriptor data reaches
construction or package handoff surfaces.

## Templates

Built-in workspace templates are available through constructor APIs and
dispatch:

```bash
node cli.js construction-template-list
```

```javascript
import { listTemplates, getTemplate } from 'symbiote-workspace/constructor';

listTemplates();

let template = getTemplate('chat');
console.log(template.config);
```

External templates are plain data. A plugin template is a `{ name,
description?, config }` entry under `contributes.templates`, and the config is
validated by the same workspace config validator.

```javascript
import { planWorkspaceConstruction } from 'symbiote-workspace/constructor';

let { config } = planWorkspaceConstruction({
  brief: 'build a team room',
  template: 'team-ai-room'
}, {
  workspaceTemplates: [
    {
      name: 'team-ai-room',
      description: 'Team command room.',
      config: { version: '1.0.0', name: 'Team AI Room' }
    }
  ]
});
```

CLI construction commands accept the same input with
`--workspace-templates <json-array>`.

## Workspace Package

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
(id, version, tags, permissions, dependencies, assets), and returns a validated
package object with JSON output.

`importWorkspacePackage(json)` parses a workspace package JSON string,
validates it against the package schema, and returns both the parsed package
and its workspace config.

`validateWorkspacePackage(packageObject)` validates a workspace package object
in isolation, checking package kind, schema version, workspace config validity,
manifest portability, and host contract integrity.

`inspectWorkspacePackage(input, options)` inspects a workspace package object
or JSON string without requiring a full host. Pass an optional
`options.available` host-neutral inventory (`components`, `plugins`,
`packages`, `hostServices`, `runtimeSlots`) to detect missing capabilities.

`createWorkspacePackageConstructionContext(input, options)` projects a valid
workspace package into constructor-ready data without installing or activating
anything. It returns external `workspaceTemplates`, package
`moduleCapabilities`, explicit `requiredCapabilities`, package requirements,
readiness gaps, and source metadata.

`createWorkspacePackagesConstructionContext({ packages, available })`
aggregates multiple package entries (`{ package, templateName }` or
`{ json, templateName }`) into one constructor-ready context.

`prepareConstructionIntentWithPackageContext(intent, context)` returns a cloned
constructor intent with package-required capabilities merged and sorted into
`requiredCapabilities`.

`createWorkspaceConstructionHandoff(context, intent)` converts a package
construction context into a handoff envelope with
`_type: "workspace-construction-handoff"` plus the `{ intent, options }` shape
consumed by `planWorkspaceConstruction(handoff.intent, handoff.options)`.

```javascript
let context = createWorkspacePackageConstructionContext(packageJson, {
  templateName: 'review-package'
});

let handoff = createWorkspaceConstructionHandoff(context, {
  brief: 'Build a review queue workspace',
  template: 'dashboard'
});

let { config, plan } = planWorkspaceConstruction(handoff.intent, handoff.options);
```

The dispatch/MCP tools accept the same handoff object directly:

```javascript
let planned = await dispatch('construction_plan', handoff, session);
let constructed = await dispatch('construction_construct', {
  ...handoff,
  baseRevision: session.revision
}, session);
```

The CLI accepts the same handoff object as a single positional JSON argument,
or constructor options with `--options <json-object>` when agents pass only the
handoff options through shell arguments:

```bash
node cli.js construction-plan '{"_type":"workspace-construction-handoff","valid":true,"ready":true,"intent":{"brief":"Build a review queue workspace","template":"dashboard"},"options":{"workspaceTemplates":[],"moduleCapabilities":[]}}'
```

Package dispatch tools use the `pack_*` family:

- `pack_export`
- `pack_import`
- `pack_validate`
- `pack_inspect`
- `pack_context_create`
- `pack_contexts_create`
- `pack_handoff_create`
- `pack_plugin_modules_collect`
- `pack_plugin_templates_collect`

## Catalog And Inline Creation

Catalog entries are module-id references with deterministic ranking and
fingerprinting. `catalog_search` and `catalog_describe` inspect installed,
registry, engine, and scratch sources. `catalog_proof` creates a proof for a
performed gap search before inline free creation.

The manifest and package surfaces keep catalog data host-neutral. Registry
listings can expose summaries for search, contracts for placement review, and
full records for inspection. Placement of an `installed:false` entry routes to
installation first.

## Manifest Rejections

The manifest and package validators reject host, identity, marketplace, and
non-portable state:

- host/identity keys: `token`, `secret`, `session`, `user`, `credential`,
  `endpoint`, `password`, `profile`, `organization`, `tenant`, `billing`,
  `subscription`
- marketplace keys: `price`, `seller`, `marketplace`, `licenseKey`,
  `licenseServer`, `purchase`, `rating`, `payout`, `listing`
- non-portable values: local file URIs, home-directory or temporary absolute
  paths, HTTP/WS URLs in dependency and asset fields
