# symbiote-workspace

Agent-driven workspace orchestration: **intent → plan → build → serialize → share**.

Portable workspace configs over [symbiote-ui](https://github.com/RND-PRO/symbiote-ui) primitives.

## Install

```bash
npm install symbiote-workspace
```

## Architecture

```
symbiote-workspace (orchestration)
├── depends on: symbiote-ui (primitives)
├── optionally: symbiote-engine (persistence)
└── consumed by: Agent Portal, any chat host, standalone apps
```

### Modules

| Module | Entry point | Responsibility |
|--------|------------|---------------|
| **Schema** | `symbiote-workspace/schema` | Config JSON Schema, validation, versioning |
| **Loader** | `symbiote-workspace/loader` | Config → component resolution, theme extraction |
| **Constructor** | `symbiote-workspace/constructor` | Intent → workspace plan, template matching |
| **Sharing** | `symbiote-workspace/sharing` | Export, import, diff, merge configs |
| **Validation** | `symbiote-workspace/validation` | Design guardrails, register density checks |

### Entry Points

- `symbiote-workspace` — Node-safe root: all isomorphic APIs
- `symbiote-workspace/browser` — Browser-only: DOM mounting + all isomorphic APIs
- `symbiote-workspace/schema` — Schema definitions and validators only

## Quick Start

```javascript
import {
  planWorkspace,
  validateWorkspaceConfig,
  exportConfig,
  checkDesignGuardrails,
} from 'symbiote-workspace';

// 1. Plan from intent
let config = planWorkspace('build me a chat workspace', {
  name: 'My Chat',
  register: 'tool',
});

// 2. Validate
let validation = validateWorkspaceConfig(config);
console.log(validation.valid); // true

// 3. Check design guardrails
let guardrails = checkDesignGuardrails(config);
console.log(guardrails.pass); // true

// 4. Export for sharing
let { json } = exportConfig(config);
console.log(json); // portable JSON, no auth/server data
```

## Workspace Config

```json
{
  "version": "0.1.0",
  "name": "My Workspace",
  "register": "tool",
  "theme": {
    "params": { "mode": "dark", "hue": 220 },
    "overrides": { "--sn-gap": "8px" }
  },
  "layout": {
    "type": "split",
    "direction": "horizontal",
    "ratio": [0.3, 0.7],
    "children": [
      { "type": "single", "component": "sn-tree-panel" },
      { "type": "single", "component": "sn-editor" }
    ]
  },
  "components": {
    "catalog": ["sn-tree-panel"],
    "custom": [{ "tagName": "sn-editor", "code": "..." }]
  }
}
```

### Register Values

| Register | Max Panels | Min Ratio | Use Case |
|----------|-----------|-----------|----------|
| `tool` | 12 | 0.1 | Dense professional UI (IDE, studio) |
| `brand` | 6 | 0.2 | Marketing, landing pages |
| `presentation` | 4 | 0.25 | Slides, demos, showcases |

## Portability Rules

Workspace configs are **portable JSON** — shareable like ComfyUI projects:

- ❌ No auth tokens, API keys, secrets
- ❌ No server URLs or endpoints
- ❌ No user identity or session data
- ✅ Theme params, layout trees, component references
- ✅ Host-agnostic: any compliant host assembles from config

## Templates

Built-in workspace templates for quick start:

```javascript
import { listTemplates, getTemplate } from 'symbiote-workspace/constructor';

listTemplates(); // ['chat', 'editor', 'graph', 'dashboard']

let template = getTemplate('chat');
console.log(template.config); // Full workspace config
```

## License

MIT
