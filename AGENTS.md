# AGENTS.md — symbiote-workspace

## Project Identity

- **Layer**: orchestration (between symbiote-ui primitives and host products)
- **Dependency direction**: workspace → ui + engine. Never reverse.
- **Independence**: usable standalone by any open-source consumer
- **Version**: 1.1.0

## Architecture

Unified dispatch layer: `runtime/dispatch.js` is the single entry point for all
85 tools. Both CLI (`cli.js`) and MCP (`mcp/index.js`) are thin proxies:
they parse input and call `dispatch(toolName, args, session)`.
Tool metadata and handlers live in `runtime/tools/*` families.

## Code Quality

Follow the repository's existing style:

- ESM, no build step, platform-native APIs
- let-by-default local declarations and 2-space indent
- throw or return structured errors on invalid input; do not silently ignore it
- keep layers separated and public surfaces host-agnostic

## Testing

```bash
npm test    # node --test tests/*.test.js
```

All tests must pass before commit. No Jest, Mocha, or Vitest.
Use Node.js built-in test runner (`node:test`).

## Boundary Rules

- BLOCK: importing symbiote-ui browser components in Node-safe entrypoints
- BLOCK: importing symbiote-engine internals — use handler contracts
- BLOCK: importing host product code (Agent Portal, etc.)
- BLOCK: auth, user identity, or server URLs in workspace configs
- BLOCK: business logic in cli.js or mcp/index.js
- REQUIRE: workspace config = portable JSON, host-agnostic
- REQUIRE: each module testable without browser or server
- REQUIRE: schema versioned and backward-compatible
- REQUIRE: every dispatch handler has a tool definition in its `runtime/tools/*`
  family and a focused test

## Tier Separation

- `index.js` — Node-safe (isomorphic). No DOM, no `document`, no `window`.
- `browser.js` — Browser-only. May use DOM, CustomElements, etc.
- `cli.js` — CLI entry. Thin proxy to dispatch. No business logic.
- `mcp/index.js` — MCP JSON-RPC transport. No business logic.
- All `/schema`, `/loader`, `/constructor`, `/sharing`, `/validation` — Node-safe.
- `/runtime` — Node-safe. Dispatch, session, tool registry.
- `/runtime/tools` — Node-safe dispatch tool families and handler adapters.
- `/handlers` — Node-safe config mutation functions used by the tool families.
- `/catalog` — Node-safe catalog entries, sources, ranking, fingerprints, and proof.
- `/plugins`, `/server` — Node-safe. Optional server mode.
- `/ssr` — Optional build-time shell rendering.

## Adding a New Tool

1. Create handler function in appropriate `handlers/*.js` file
2. Export from `handlers/index.js` barrel
3. Add or update the corresponding `runtime/tools/*-tools.js` family
4. Ensure the tool description is suitable for generated CLI/MCP help
5. Add focused dispatch and handler coverage in the standard `tests/*.test.js`
6. Update CHANGELOG.md
