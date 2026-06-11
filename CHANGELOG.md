# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- **Construction protocol** — `intent`, `construction.questions`,
  `construction.plan`, `patches`, `validation.reports`, `runtime`, `exports`,
  and `design` are now accepted workspace config fields.
- **6 construction workflow tools** — unified CLI/MCP dispatch now exposes
  `classify_workspace`, `plan_workspace`, `propose_workspace_patch`,
  `validate_workspace_patch`, `apply_workspace_patch`, and `export_workspace`
  for agent-guided construction before mutation.
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
- **Segmented browser preview** — `start_preview` now generates an import map,
  passes `symbiote-ui.applyCascadeTheme` into `mountWorkspace()`, renders loader
  warnings, and preserves separate module-load and mount error messages.
- **Theme relations** — workspace config now carries future-compatible
  `theme.relations` and subtree relations alongside params and token overrides.

### Changed

- **Unified dispatch surface** — CLI and MCP now expose 57 tools from the same
  `runtime/dispatch.js` registry.
- **Browser entrypoint boundary** — `symbiote-workspace/browser` now exports
  browser-safe APIs without statically pulling Node-only runtime dispatch code.
- **Export/import portability** — portable exports preserve construction
  metadata, validation reports, and theme relations while stripping host/local
  fields; imports reject host/local-only payloads.

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
