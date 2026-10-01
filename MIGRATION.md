# Migrating to 2.0

2.0 closes two wildcard entry points and makes two behaviours refuse instead of
degrade. Both are visible at load or at first use, not at install, so this page
exists to make them visible earlier.

Everything below was measured against the published `1.2.3` and against
`2.0.0-alpha.1`, not from memory.

## Check your project first

```bash
node node_modules/symbiote-workspace/scripts/report-blocked-imports.mjs <your-project>
```

It walks a checkout, reports every `symbiote-workspace` specifier that would now
fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`, names the export key it would need,
and exits non-zero so it can gate a build. It separates browser import-map
*prefix* mappings, which do not go through `exports` at all — see below.

## What changed in the package's entry points

`./schema/*` and `./runtime/*` are gone. Ten explicit deep entries replace them,
and one of those (`./runtime/presentation.js`) was not declared before.

| Removed | Added |
|---|---|
| `./schema/*` | `./schema/canonical-json.js` |
| `./runtime/*` | `./schema/composition-descriptor.js` |
| | `./schema/constants.js` |
| | `./schema/module-capability.js` |
| | `./schema/workspace-schema.js` |
| | `./runtime/composition-commit-point.js` |
| | `./runtime/composition-registry.js` |
| | `./runtime/portable-value.js` |
| | `./runtime/presentation.js` |
| | `./runtime/workspace-state.js` |

Under the two wildcards, `1.2.3` reached **89** `.js` files under `schema/` and
`runtime/`. Seven of those are still reachable through a declared entry; the
other **82** are not:

| Directory | Files no longer reachable |
|---|---|
| `runtime/presentation/` | 28 |
| `runtime/` | 25 |
| `runtime/tools/` | 13 |
| `schema/sections/` | 9 |
| `schema/` | 6 |
| `runtime/media-evidence/` | 1 |

Where to send them:

- **A symbol the runtime barrel exports** — import it from the package root
  (`symbiote-workspace`) or from `symbiote-workspace/runtime`. The root re-exports
  the runtime's public surface.
- **A presentation symbol** — import from `symbiote-workspace/runtime/presentation.js`,
  which is declared and aggregates the presentation modules. The individual leaf
  modules are not declared.
- **Something genuinely internal** — it had no public path in 2.0. Either it
  belongs behind the surface you actually need, or the library needs an entry
  for it; say which, and it can be added deliberately rather than by wildcard.

The root and browser entrypoints now differ by exactly six browser-only names
(`mountWorkspace`, `applyWorkspaceTheme`, `collectWorkspaceInterfaceContext`,
`subscribeDataChange`, `playWorkspacePresentationTimeline`,
`prepareWorkspacePresentation`), which are DOM-bound by contract.
`tests/browser-entrypoint.test.js` states that difference and must be updated if
you add a deliberate one.

### Browser import maps do not enforce `exports`

An import map such as

```json
{ "imports": { "symbiote-workspace/": "/node_modules/symbiote-workspace/" } }
```

hands the browser the whole package directory. Node refuses an undeclared path;
the browser loads it happily. So a prefix mapping silently re-opens the surface
2.0 closed, and a path that fails in your Node tests will work in the browser —
until the next release removes the file. Replace a prefix with the exact paths
you import. The reporting script lists the prefix mappings it finds for this
reason.

## Behaviour changes

### An update the runtime cannot apply is refused, not remounted

1.x fell back to destroying the mount and building a new one when the runtime
offered no update method. That silently discarded everything living only in the
old instance. In 2.0 the attempt is refused with `workspace_update_refused`,
before anything is destroyed, and the runtime must implement the update method.

If you have an operation that used to "just work" by remounting, it now needs a
real update path. `assessUpdateReadiness` and `updateRefusedError` are exported
from the runtime barrel:

```js
import { assessUpdateReadiness, updateRefusedError } from 'symbiote-workspace/runtime';
```

They report what a host is missing before an update is attempted. Note that the
file they live in, `runtime/update-readiness.js`, is deliberately **not** a
declared export — the barrel is the entry, not the file.

### `strictUpdates` is gone

The option was removed rather than deprecated: refusing an update is now the only
behaviour, so a flag that turned refusal on is redundant and a flag that turned it
off would reinstate the silent remount.

## Host adapter contract

### Atomicity is mandatory

`mountWorkspace` refuses any persistence adapter that cannot compare-and-set:

```
Error: mountWorkspace requires a persistence adapter that can compare-and-set.
       An adapter that cannot compare-and-set would let a commit report a write
       that did not happen. Pass requireAtomicPersistence: false only if nothing
       is persisted.
  code: 'workspace_atomic_persistence_required'
```

This applies to an adapter that *declares* `capabilities.atomicCommit === true`
without implementing the method as well — a declaration that lies is worse than
one that admits it cannot.

An adapter qualifies only when both hold:

```js
capabilities: { atomicCommit: true }
compareAndSet(key, { expectedRevision, value, receiptKey, receipt }) { /* … */ }
```

`compareAndSet` is the whole write path. It must decide and store in one
step, and answer one of:

- `{ status: 'conflict', reason: 'revision', currentRevision, current }` — the
  record moved on; nothing was written.
- `{ status: 'conflict', reason: 'receipt-present', … }` — this `receiptKey` was
  already written, so this is a retry of a commit whose response was lost.
  Returning the recorded result is what keeps a retry from applying twice.
- `{ status: 'committed', revision, currentRevision }`.

It must contain no `await` between reading the current revision and writing.
Nothing else in the process can interleave there, so the multi-process guarantee
is the adapter's to provide by delegating that same step to its storage engine.

`tests/document-atomic-conformance.test.js` is a **suite a host runs against its
own adapter**, not a test of the built-in one. Passing it in this repository says
the library's own memory adapter is correct; it says nothing about yours.

`requireAtomicPersistence: false` is for a host that persists nothing. It is not
a way to keep a non-atomic adapter.

## Peer dependencies are unchanged

`@symbiotejs/symbiote@3.8.0-webmcp.2`, `linkedom@^0.18.12` (both optional),
`symbiote-engine >=0.3.0-alpha.13` and `symbiote-ui >=0.3.0-alpha.71` are the same
in 1.2.3 and 2.0.0-alpha.1, as is `engines.node >=18`.

A consumer pinned to an older `symbiote-ui` will see `pnpm peers check` report an
unmet peer once this package is a declared dependency. That is the correct signal:
the library's peer range is a contract, not an advisory.
