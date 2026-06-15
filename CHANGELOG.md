# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- **Construction questionnaire tools** — `classify_workspace` now returns the
  normalized intent, initial questionnaire, readiness, and next action, while
  `build_construction_questions` and `answer_construction_question` expose the
  questionnaire step directly through dispatch, CLI, and MCP without planning
  or mutating session state.
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
  missing items plus compact `readiness.nextAction` diagnostics. Accepts an
  optional host-neutral `options.available` inventory for capability gap
  detection without marketplace or install semantics. Exposed as
  `inspect_workspace_package` in the unified dispatch registry, CLI, and MCP
  surface.
- **Package construction context helper** —
  `createWorkspacePackageConstructionContext(input, options)` projects valid
  workspace packages into constructor-ready `workspaceTemplates`,
  `moduleCapabilities`, required capability tags, source metadata, and compact
  readiness diagnostics without installing packages, activating plugins, or
  applying marketplace semantics.
- **Package intent preparation helper** —
  `prepareConstructionIntentWithPackageContext(intent, context)` is now part of
  the root, sharing, and browser entrypoints so hosts can inspect the cloned
  constructor intent with package-required capabilities merged before creating a
  handoff.
- **Constructor capability diagnostics** — construction plans now include
  `capabilities.byCapability` with selected coverage and ranked unselected
  module alternatives for unmet required capabilities.
- **Module capability schema exports** — module capability schema constants and
  validator helpers are now available from the schema, root, browser, and
  plugins entrypoints so consumers can validate plugin-provided descriptors
  without reaching into private files.
- **Module action shell materialization** — generated constructor panel types
  now expose descriptor actions, toolbar items, and menu items through
  `panelTypes.*.menuActions`, preserving authored menu actions on existing
  panel types while carrying command/event metadata for host shells.
- **Module event and binding materialization** — selected constructor module
  descriptors now expose emitted events as top-level broadcast bridges and
  copy selected binding declarations into `data.bindings` for portable
  host/runtime handoff.
- **Module engine handoff metadata** — workspace configs now define and
  validate portable `engine.packs[]`, `engine.graphs[]`, and
  `engine.bindings[]`; selected descriptor actions, settings, events, and
  bindings can materialize engine binding metadata without importing or
  executing `symbiote-engine`. Validation now checks binding node IDs when
  they target authored graph JSON, while preserving external host-provided
  graph references.
- **Module state field contract** — workspace configs now define and validate
  portable top-level `state.fields[]` records. Selected descriptor `state[]`
  declarations materialize into executable config state fields, and optional
  state engine metadata materializes into `engine.bindings[]` with
  `surface: "state"`.
- **Scoped theme construction contract** — `validateWorkspaceConfig()` now
  validates cascade theme `params`, `relations`, token `overrides`, and scoped
  `subtrees[]`; construction plans carry subtree theme layers alongside root
  theme metadata for portable host mounting.
- **Construction verification reports** — `planWorkspaceConstruction()` now
  records verification reports under `plan.verification.reports` and mirrors
  them to `config.validation.reports`, composing existing portability, design
  guardrail, module capability, and package/host readiness checks.
- **Module setting materialization** — generated constructor panel types and
  selected existing panel types now expose descriptor settings through
  `panelTypes.*.settings` while preserving authored panel settings.
- **Data binding contract validation** — workspace schema and
  `validateWorkspaceConfig()` now define and validate portable
  `data.bindings[]` records with panel, component, binding ID, direction, path,
  and value schema metadata.
- **Package readiness propagation** — package construction handoffs now carry
  `options.packageContext`, and construction plans preserve it as
  `plan.packageContext` plus `config.construction.packageContext` so agents can
  see source, readiness, missing capabilities, and warnings after planning.
- **Construction handoff readiness contract** —
  `create_workspace_construction_handoff` now mirrors package `readiness` and
  `nextAction` at the top level across dispatch, CLI, and MCP responses.
- **Package-derived handoff construction parity** — dispatch and MCP tests now
  cover real exported packages flowing through construction context, handoff,
  `plan_workspace`, `construct_workspace`, and exported config output while
  preserving package-provided templates and module descriptors.
- **Package readiness summary** — construction plans now include
  `plan.readiness.package` with validity, readiness, source count,
  missing/warning/error counts, and a next-action hint for package-driven
  workspace assembly.
- **CLI construction handoff ingestion** — `plan-workspace` and
  `construct-workspace` now accept a full `{ intent, options }` construction
  handoff object as a single positional JSON argument, matching dispatch and
  MCP behavior.
- **Construction handoff sentinel and ready gate** —
  `create_workspace_construction_handoff` now returns
  `_type: "workspace-construction-handoff"` and `construct_workspace` rejects
  `ready: false` handoffs while `plan_workspace` still returns diagnostics.
- **Ready-gate diagnostics** — not-ready construction handoff errors now include
  `code`, `nextAction`, and a structured `readiness` payload for agent recovery.
- **Stale handoff ready gate** — `construct_workspace` now rejects older
  handoff payloads that omit `ready` but still carry missing capabilities or
  warning diagnostics.
- **Package validation transport errors** — invalid
  `validate_workspace_package` results now include `status: "error"`, `code`,
  and `nextAction` while preserving `valid: false` and validation `errors`, so
  CLI and MCP transports can signal failure consistently. The validation tool
  now also accepts package JSON strings through the same `json` input used by
  related package inspection and construction-context tools.
- **Invalid handoff diagnostics** — invalid construction handoff errors now
  include `code`, `nextAction`, and a blocked `readiness` payload so agents can
  route recovery to package-context fixes instead of readiness review.
- **Invalid helper intent diagnostics** —
  `create_workspace_construction_handoff` now returns
  `code: "construction_handoff_intent_invalid"` and
  `nextAction: "fix-construction-intent"` across dispatch, CLI, and MCP when
  helper intent inputs are malformed.
- **Top-level construction readiness** — successful `plan_workspace` and
  `construct_workspace` responses expose the highest-priority recovery summary
  as top-level `readiness`: package readiness for package gaps, or required
  module capability readiness when a ready package still leaves unmatched
  capabilities.
- **Construction readiness hardening** — package readiness is no longer marked
  ready when missing requirements, warnings, or errors are still present, and
  `plan_workspace` now exposes blocked top-level readiness for missing required
  module capabilities when no package context owns the recovery route.
- **Selected-module materialization cleanup** — construction now removes
  unselected generated external panel types from executable `config.panelTypes`
  and normalizes section layout references after module selection prunes named
  layouts. It also prunes existing event bridges, data bindings, state fields,
  and engine bindings that reference unselected panels.
- **Top-level construction verification** — successful `plan_workspace` and
  `construct_workspace` dispatch, CLI, and MCP responses now expose
  `verification` as a top-level mirror of `plan.verification`.
- **Validation report shape** — `validation.reports` and
  `construction.plan.verification.reports` now reject malformed report entries,
  and package readiness verification reports use the same `pass | warn |
  blocked` status contract as other construction reports.
- **Missing-capability recovery hints** — readiness diagnostics now include
  deterministic `recovery` steps for missing package capabilities so agents can
  choose component, plugin, package, host-service, or runtime-slot remediation.
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
  Exposed as `create_workspace_construction_handoff` in dispatch/MCP and
  `create-workspace-construction-handoff` in the CLI.
- **Plugin metadata dispatch tools** —
  `collect_plugin_module_capabilities` and
  `collect_plugin_workspace_templates` expose existing plugin metadata
  collectors through dispatch, CLI, and MCP without activating plugins or
  initializing workspace session state.
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
  warnings, writes sanitized portable config into preview runtime files, and
  preserves separate import-map, module-load, and mount error messages.
- **Host integration contract** — `createHostIntegrationContract()` describes
  chat construction tools, browser import-map requirements, derived
  engine-backed persistence services, module host services, and portable
  runtime slots for a portable workspace config.
- **Package-derived relaunch preservation** — constructing from package-derived
  templates now preserves source validation reports alongside newly generated
  construction verification reports.
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

- **Unified dispatch surface** — CLI and MCP now expose 66 tools from the same
  `runtime/dispatch.js` registry.
- **CLI help source** — CLI tool-command help is now generated from the
  unified `TOOLS` registry descriptions, with CLI-only aliases documented from
  the command alias map.
- **Package consumer verification** — packed-consumer tests now assert the
  actual npm pack file list before install, including exported entrypoints and
  exclusion of tests, team memory, cache, temp, and tarball artifacts.
- **Construction handoff dispatch** — `plan_workspace` and
  `construct_workspace` now accept the full `{ intent, options }` handoff
  object returned by `create_workspace_construction_handoff`; CLI
  `plan-workspace` and `construct-workspace` also accept constructor
  `--options`.
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

- **Export/import portability aliases** — strict export/import checks now
  reject normalized host/local field aliases such as `server_url`,
  `workspace_root`, `file_path`, and `apiEndpoint`, while preserving portable
  module binding `path` fields.
- **Test artifact hygiene** — package-consumer tests now isolate npm cache
  inside ignored per-test `tmp` directories, and CLI/dispatch file I/O tests
  no longer write scratch JSON files at the repository root.
- **Construction handoff validation** — `plan_workspace` and
  `construct_workspace` now reject invalid diagnostic handoff envelopes before
  planning, preserving session state and returning structured dispatch errors
  through both direct dispatch and MCP.
- **Package public surface metadata** — package metadata now marks executable
  CLI and MCP entrypoints as side-effectful while keeping library modules
  tree-shakeable; packed-consumer coverage verifies the handlers subpath and
  side-effect metadata, and README entrypoint docs now list all public subpath
  exports.
- **Workspace package validation** — `validateWorkspacePackage()` now returns
  structured `host.contract` errors when the contract is missing and compares
  equivalent host contracts independently of object key order.
- **MCP tool metadata** — `tools/list` now exposes `annotations.readOnlyHint`
  while keeping internal `mutates` and file-writing flags private.
- **CLI help** — removed the misleading global `--json` output flag from help;
  package commands keep their command-specific `--json <string>` input option.
- **Planning error surface** — `plan_workspace` now returns structured
  dispatch errors for invalid constructor input instead of leaking planner
  exceptions to CLI/MCP callers.
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
- **Layout readers** — use the current BSP format (`panel`/`split` with `first`/`second`) without `children[]` compatibility traversal.
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
