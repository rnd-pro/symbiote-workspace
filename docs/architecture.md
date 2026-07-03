# Architecture and Entry Points

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Dispatch                   │
│       85 registered tools, 1 registry       │
│             runtime/dispatch.js             │
├──────────────────┬──────────────────────────┤
│   CLI (argv)     │      MCP (JSON-RPC)      │
│   cli.js         │      mcp/index.js        │
│   thin proxy     │      thin proxy          │
├──────────────────┴──────────────────────────┤
│  runtime/tools/*       handlers/*           │
│  constructor/*         catalog/*            │
│  schema/*              validation/*         │
│  loader/*              plugins/*            │
│  sharing/*             server/*    ssr/*    │
└─────────────────────────────────────────────┘
```

CLI and MCP share the same dispatch layer: every registry tool is available
through MCP and through the kebab-case CLI command generated from the tool name.
No business logic lives in `cli.js` or `mcp/index.js`.

## Entry Points

| Entry Point | Env | Purpose |
|------------|-----|---------|
| `symbiote-workspace` | Node | Schema, loader, constructor, catalog, sharing, validation, plugins, runtime |
| `symbiote-workspace/runtime` | Node | Dispatch, session, tool registry |
| `symbiote-workspace/browser` | Browser | DOM mounting + browser-safe isomorphic APIs |
| `symbiote-workspace/catalog` | Node | Catalog entries, sources, ranking, fingerprints, registry adapters, and proof |
| `symbiote-workspace/loader` | Node | Workspace config loading and theme extraction helpers |
| `symbiote-workspace/constructor` | Node | Construction planning, templates, questions, handoff consumption |
| `symbiote-workspace/sharing` | Node | Package export/import, host contracts, construction context projection |
| `symbiote-workspace/validation` | Node | Design guardrails and construction patch validation |
| `symbiote-workspace/plugins` | Isomorphic | Plugin schema, validation, registry |
| `symbiote-workspace/handlers` | Node | Config mutation and discovery handler functions |
| `symbiote-workspace/server` | Node | Workspace server + plugin loader |
| `symbiote-workspace/mcp` | Node | MCP stdio transport entrypoint |
| `symbiote-workspace/ssr` | Node | Optional build-time workspace shell rendering |
| `symbiote-workspace/schema` | Node | Schema definitions, validators |
| `symbiote-workspace/schema/*` | Node | Direct schema module imports for validators and schema constants |
| `symbiote-workspace/package.json` | Node | Package metadata for consumer tooling |
