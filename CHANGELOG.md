# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- **Workspace package format** — `exportWorkspacePackage(config, manifest)`,
  `importWorkspacePackage(json)`, and `validateWorkspacePackage(packageObject)`
  wrap portable workspace configs with manifest metadata, host integration
  contracts, dependency lists, and asset references for distribution and
  discovery. Manifest validation rejects host identity keys (token, secret,
  session, user, credential), marketplace state (price, seller, license key or
  server, purchase), and non-portable values (URLs, absolute paths) in
  dependency and asset fields.
- **Package inspection helper** — `inspectWorkspacePackage(input, options)`
  inspects a workspace package object or JSON string and returns `valid`,
  `ready`, structured summary, compatibility, dependency requirements, and
  missing items. Accepts an optional host-neutral `options.available` inventory
  for capability gap detection without marketplace or install semantics.
  Exposed as `inspect_workspace_package` in the unified dispatch registry, CLI,
  and MCP surface.
- **Package construction context helper** —
  `createWorkspacePackageConstructionContext(input, options)` projects valid
  workspace packages into constructor-ready `workspaceTemplates`,
  `moduleCapabilities`, required capability tags, and source metadata without
  installing packages, activating plugins, or applying marketplace semantics.
- **Package collection construction context helper** —
  `createWorkspacePackagesConstructionContext({ packages, available })`
  aggregates package objects and JSON entries into one constructor-ready context
  with duplicate template/module conflict detection. Exposed as
  `create_workspace_packages_construction_context` in dispatch/MCP and
  `create-workspace-packages-construction-context` in the CLI.
- **Package construction handoff helper** —
  `createWorkspaceConstructionHandoff(context, intent)` converts package
  construction contexts into the `{ intent, options }` pair consumed by
  `planWorkspaceConstruction()`, including required capability handoff.
- **Construction protocol** — `intent`, `construction.questions`,
  `construction.plan`, `patches`, `validation.reports`, `runtime`, `exports`,
  and `design` are now accepted workspace config fields.
- **7 construction workflow tools** — unified CLI/MCP dispatch now exposes
  `classify_workspace`, `plan_workspace`, `propose_workspace_patch`,
  `validate_workspace_patch`, `apply_workspace_patch`, `construct_workspace`,
  and `export_workspace` for agent-guided construction and mutation.
- **Patch validation bridge** — workspace patch validation can use the
  Node-safe `symbiote-ui/rules/design-policy.js` bridge for theme/design
  diagnostics, hard blocks, soft warnings, and suggested patches.
- **Expanded design registers** — `admin`, `editor`, `agent-workspace`, and
  `media-studio` join the existing `tool`, `brand`, and `presentation`
  registers, with density guardrails for each register.
- **Browser theme mounting** — `mountWorkspace()` now validates config, creates
  a workspace wrapper, applies root and subtree theme layers, and writes
  `cascade-theme-change` params, relations, and overrides back into workspace
  config.
- **Segmented browser preview** — `start_preview` now validates import maps,
  writes `preview.contract.json`, checks browser import-map support, passes
  `symbiote-ui.applyCascadeTheme` into `mountWorkspace()`, renders loader
  warnings, and preserves separate import-map, module-load, and mount error
  messages.
- **Host integration contract** — `createHostIntegrationContract()` describes
  chat construction tools, browser import-map requirements, derived
  engine-backed persistence services, module host services, and portable
  runtime slots for a portable workspace config.
- **Theme relations** — workspace config now carries future-compatible
  `theme.relations` and subtree relations alongside params and token overrides.
- **Package consumer verification** — `npm run test:package-consumer` now packs
  `symbiote-workspace` and the installed `symbiote-ui` substitute into a
  temporary consumer, then verifies public entrypoints, CLI, construction,
  export, host contract, and MCP stdio behavior without npm publication.
- **External module materialization** — construction `moduleCapabilities` can
  now create missing panel types from placement metadata, place selected
  generated panels into BSP layout, validate executable placement metadata, and
  round-trip through CLI and MCP construction flows.
- **Plugin capability collection** — `collectPluginModuleCapabilities()` and
  `listPluginModuleCapabilities()` expose plugin-provided module descriptors
  as portable constructor inputs through the plugins, root, and browser
  entrypoints.
- **Plugin workspace template collection** —
  `collectPluginWorkspaceTemplates()` and `listPluginWorkspaceTemplates()`
  expose validated `plugin.workspace.templates` entries for plugin-provided
  workspace template catalogs.
- **External workspace template construction** — constructor APIs and unified
  dispatch can accept plugin-neutral `workspaceTemplates` inputs, validate them
  as strict portable workspace configs, classify by template metadata, and
  construct configs through `plan_workspace`, `construct_workspace`, and CLI
  `--workspace-templates` without importing plugin registry code.
- **Collaboration room template verification** — tests now cover portable
  command chat, team room, and voice/video room plugin templates through
  strict export/import/relaunch, host integration contracts, and packed
  consumer construction without npm publication.

### Changed

- **Unified dispatch surface** — CLI and MCP now expose 63 tools from the same
  `runtime/dispatch.js` registry.
- **Browser entrypoint boundary** — `symbiote-workspace/browser` now exports
  browser-safe APIs without statically pulling Node-only runtime dispatch code.
- **Export/import portability** — portable exports preserve construction
  metadata, validation reports, and theme relations while stripping host/local
  fields by default; strict exports now reject host-only state before
  sanitizing so relaunch flows cannot hide local paths, sessions, endpoints, or
  user identity. Imports and file loads reject host/local-only payloads,
  generic server URLs, and user identity fields.
- **CLI config loading** — stateful `--config` file loads now use the same
  strict portable import path as `load_config` before CLI tools run.

### Fixed

- **Workspace package validation** — `validateWorkspacePackage()` now returns
  structured `host.contract` errors when the contract is missing and compares
  equivalent host contracts independently of object key order.
- **MCP tool metadata** — `tools/list` now exposes `annotations.readOnlyHint`
  while keeping internal `mutates` and file-writing flags private.
- **Construction module validation** — direct `moduleCapabilities` constructor
  inputs now use the shared module descriptor validator and reject duplicate
  direct descriptors before materialization.
- **MCP test timing** — MCP protocol tests now wait for expected JSON-RPC
  responses instead of relying on short fixed timers.

## [0.3.0-alpha.2] - 2026-06-10

### Added

- **Unified Dispatch Layer** (`runtime/dispatch.js`) — single source of truth for all 50 tool definitions and dispatch logic. Both CLI and MCP call the same `dispatch(toolName, args, session)` function.
- **Stateful Session** (`runtime/session.js`) — in-memory config session with `load()`, `save()`, `ensure()` lifecycle.
- **Input Validation** — dispatch validates required arguments before calling handlers. Returns `{ status: 'error', hint: 'Missing required arguments: ...' }` for invalid calls.
- **CLI `--config` flag** — stateful CLI mode. Loads config from file, dispatches tool, auto-saves on mutations.
- **22 new MCP/CLI tools** — full handler coverage (28 → 50 tools):
  - `reorder_groups`, `reorder_sections`
  - `update_panel_type`, `toggle_menu_action`
  - `get_behavior`, `update_behavior`
  - `mount_widget`, `unmount_widget`, `swap_widget`
  - `bridge_event`, `unbridge_event`, `list_bridges`
  - `update_layout_behavior`
  - `validate_config`, `save_config`, `load_config`
  - `scaffold_from_scratch`
  - `export_config`, `import_config`, `diff_configs`, `merge_configs`
  - `check_guardrails`
- **MCP Protocol Tests** (`tests/mcp.test.js`) — 6 tests covering JSON-RPC handshake, tools/list, tools/call, session persistence, error handling.
- **Discovery Caching** — 30s TTL cache for `findComponent`, `listComponentTags`, `listCategories` to avoid redundant FS scans.
- **`runtime` entry point** (`symbiote-workspace/runtime`) — exports `dispatch`, `TOOLS`, `isMutating`, `createSession`.

### Changed

- **MCP Server** — reduced from 671 to 136 lines (−80%). Now a pure JSON-RPC transport layer delegating to `runtime/dispatch.js`.
- **CLI** — rewritten as thin proxy to dispatch. All 50 tools available via kebab-case commands.
- **`describeLayout()`** — updated for BSP format (`panel`/`split` with `first`/`second`) with legacy `children[]` fallback.
- **`listUsedComponents()`** — now collects from layout tree + `panelTypes` + `components.catalog`. Returns `{ components, count }`.
- **`bridgeEvent()`** — config-derived ID generation instead of global counter (works across stateless CLI invocations).
- **`findComponent()`** — returns `{ status: 'not_found' }` for unknown tags instead of bare `null`.
- **`listCategories()`** — returns `{ categories, count }` wrapper for consistency.
- **Preview handler** — fixed `mountWorkspace` import (was `materializeWorkspace`).
- **README** — rewritten with unified architecture, 50-tool reference, BSP layout examples.

### Fixed

- Bridge ID collision in CLI stateless mode (global counter → config-derived).
- MCP `serverInfo.version` synced with `package.json`.

## [0.2.0] - 2026-06-09

### Added

- Plugin system (schema, registry, lifecycle)
- Config portability (export, import, diff, merge)
- Design guardrails (register density, panel limits)
- Server mode with plugin loader
- Component discovery (filesystem introspection)
- Event bridge system

## [0.1.0] - 2026-06-08

### Added

- Initial release
- Schema + validation
- BSP layout engine
- Template-based scaffolding
- CLI (scaffold, validate, serve, plan)
- MCP server (28 tools)
