# AGENTS.md — symbiote-workspace

## Project Identity

- **Layer**: orchestration (between symbiote-ui primitives and host products)
- **Dependency direction**: workspace → ui + engine. Never reverse.
- **Independence**: usable standalone by any open-source consumer

## Code Quality

This project follows the team-wide code quality rules from `.agent-portal`:

- `skills/code/code-style.md` — let-by-default, arrow functions, 2-space indent
- `skills/code/error-handling.md` — throw on invalid input, no silent failures
- `skills/architecture/jsda-principles.md` — ESM, no build step, platform-native
- `skills/architecture/ecosystem-boundaries.md` — layer separation

## Testing

```bash
npm test    # node --test tests/*.test.js
```

All tests must pass before commit. No Jest, Mocha, or Vitest.

## Boundary Rules

- BLOCK: importing symbiote-ui browser components in Node-safe entrypoints
- BLOCK: importing symbiote-engine internals — use handler contracts
- BLOCK: importing host product code (Agent Portal, etc.)
- BLOCK: auth, user identity, or server URLs in workspace configs
- REQUIRE: workspace config = portable JSON, host-agnostic
- REQUIRE: each module testable without browser or server
- REQUIRE: schema versioned and backward-compatible

## Tier Separation

- `index.js` — Node-safe (isomorphic). No DOM, no `document`, no `window`.
- `browser.js` — Browser-only. May use DOM, CustomElements, etc.
- All `/schema`, `/loader`, `/constructor`, `/sharing`, `/validation` — Node-safe.
