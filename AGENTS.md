# AGENTS.md — symbiote-workspace

## Project Identity

- **Layer**: orchestration (between symbiote-ui primitives and host products)
- **Dependency direction**: workspace → ui + engine. Never reverse.
- **Independence**: usable standalone by any open-source consumer
- **Version**: 0.3.0-alpha.2

## Architecture

Unified dispatch layer: `runtime/dispatch.js` is the single entry point for all
69 tools. Both CLI (`cli.js`) and MCP (`mcp/index.js`) are thin proxies —
they parse input and call `dispatch(toolName, args, session)`.

## Code Quality

This project follows the team-wide code quality rules from `.agent-portal`:

- `skills/code/code-style.md` — let-by-default, arrow functions, 2-space indent
- `skills/code/error-handling.md` — throw on invalid input, no silent failures
- `skills/architecture/jsda-principles.md` — ESM, no build step, platform-native
- `skills/architecture/ecosystem-boundaries.md` — layer separation

Project-specific rules documented in:
- `.agent-portal/workspace/symbiote-workspace/code-quality-rules.md`

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
- REQUIRE: every handler has a TOOLS entry and dispatch case

## Tier Separation

- `index.js` — Node-safe (isomorphic). No DOM, no `document`, no `window`.
- `browser.js` — Browser-only. May use DOM, CustomElements, etc.
- `cli.js` — CLI entry. Thin proxy to dispatch. No business logic.
- `mcp/index.js` — MCP JSON-RPC transport. No business logic.
- All `/schema`, `/loader`, `/constructor`, `/sharing`, `/validation` — Node-safe.
- `/runtime` — Node-safe. Dispatch, session, tool registry.
- `/handlers` — Node-safe. Pure config mutation functions.
- `/plugins`, `/server` — Node-safe. Optional server mode.

## Adding a New Tool

1. Create handler function in appropriate `handlers/*.js` file
2. Export from `handlers/index.js` barrel
3. Add tool definition to `TOOLS` array in `runtime/dispatch.js`
4. Add dispatch case in `dispatch()` function
5. Ensure the `TOOLS` description is suitable for generated CLI/MCP help
6. Add test in `tests/dispatch.test.js`
7. Update CHANGELOG.md
