# Architecture and Entry Points

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Dispatch                   │
│          registered tools, 1 registry       │
│             runtime/dispatch.js             │
├──────────────────┬──────────────────────────┤
│   CLI (argv)     │      MCP (JSON-RPC)      │
│   cli.js         │      mcp/index.js        │
│   thin proxy     │      thin proxy          │
├──────────────────┴──────────────────────────┤
│  handlers/* (13 modules)  constructor/*     │
│  schema/*  validation/*   loader/*          │
│  plugins/*  sharing/*     server/*          │
└─────────────────────────────────────────────┘
```

CLI and MCP share the same dispatch layer — every tool available via MCP is also available via CLI, and vice versa. No code duplication.

## Entry Points

| Entry Point | Env | Purpose |
|------------|-----|---------|
| `symbiote-workspace` | Node | Schema, loader, constructor, sharing, validation, plugins, runtime |
| `symbiote-workspace/runtime` | Node | Dispatch, session, tool registry |
| `symbiote-workspace/browser` | Browser | DOM mounting + browser-safe isomorphic APIs |
| `symbiote-workspace/loader` | Node | Workspace config loading and theme extraction helpers |
| `symbiote-workspace/constructor` | Node | Construction planning, templates, questions, handoff consumption |
| `symbiote-workspace/sharing` | Node | Package export/import, host contracts, construction context projection |
| `symbiote-workspace/validation` | Node | Design guardrails and construction patch validation |
| `symbiote-workspace/plugins` | Isomorphic | Plugin schema, validation, registry |
| `symbiote-workspace/handlers` | Node | Config mutation and discovery handler functions |
| `symbiote-workspace/server` | Node | Workspace server + plugin loader |
| `symbiote-workspace/mcp` | Node | MCP stdio transport entrypoint |
| `symbiote-workspace/schema` | Node | Schema definitions, validators |
| `symbiote-workspace/schema/*` | Node | Direct schema module imports for validators and schema constants |
| `symbiote-workspace/package.json` | Node | Package metadata for consumer tooling |
