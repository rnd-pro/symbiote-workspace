# Visual Demo

Run the packaged visual demo from the repository root:

```bash
npm run demo:visual
```

The script builds a `video-studio` workspace through the public runtime flow,
strictly exports and re-imports the config, writes preview artifacts, starts a
small static server, and prints the local URL.

For CI or package smoke checks, generate the preview files without starting a
server:

```bash
node examples/visual-demo/preview.js --write-only --output-dir tmp/visual-demo-preview
```

Run the realtime chat-state builder demo:

```bash
npm run demo:realtime-builder
```

The realtime builder demo uses mock chat and questionnaire state. Press Play to
step through the canonical 9-question construction protocol: workspace name,
target register, layout topology, module selection, execution model, required
host services, theme mode, theme hue, and verification scope. The visible flow
keeps execution model, host service, package readiness, and runtime import-map
evidence available in the generated UI.

The generated workspace preview is mounted through the Symbiote UI
`panel-layout` runtime instead of the portable fallback cards. The demo shell
uses only a compact header for controls; the rest of the viewport belongs to
the generated layout. Registered panel tags are thin module hosts whose visible
content is built from Symbiote UI elements such as `chat-workspace`,
`cascade-theme-editor`, `sn-card`, `sn-description-list`, `sn-badge`,
`sn-button`, and `sn-segmented-control`.

The demo server prefers the canonical developer checkout at
`../symbiote-dev-plane/repos/symbiote-ui` when it is present, then falls back to
installed packages. It also serves the matching `symbiote-engine` and
`@symbiotejs/symbiote` dependencies required by those browser components. The
default Symbiote UI cascade theme is applied before the workspace mounts.

Use the Wide, Tablet, and Mobile controls to preview the generated adaptive
layout contract. The preview exposes visible, docked, collapsed, and protected
panels for each viewport scenario while keeping the theme editor requirement
visible in the contract. The demo shell also exposes stable adaptive and theme
runtime state for responsive mode, breakpoint, theme mode, and theme editor
status.

The generated `demo.contract.json` includes the play stages, required widgets,
acceptance matrix, build stream timeline, chat-state timeline, questionnaire
decision trace, adaptive viewport scenarios, current functionality evidence,
execution evidence, package evidence, and construction trace. The construction
trace records canonical questionnaire IDs, required module capability coverage,
adaptive/theme evidence, verification reports, strict export/import evidence,
and browser import-map evidence so the staged transformation is inspectable
without reading the browser DOM.

For opt-in browser evidence, run the real-browser smoke. It starts the demo
server, launches a Chrome-compatible browser through the DevTools Protocol, and
asserts that the mounted workspace DOM has no preview error:

```bash
npm run test:visual-demo-browser
```

To verify the realtime builder Play flow specifically:

```bash
npm run test:visual-demo-browser -- --demo realtime-builder
```

Set `SYMBIOTE_BROWSER_BIN` or pass `--browser` when Chrome is not installed in
the standard macOS application locations.

When Chrome/CDP is not available, run the same proof through Playwright:

```bash
npx playwright install webkit
SYMBIOTE_BROWSER_DRIVER=playwright SYMBIOTE_PLAYWRIGHT_BROWSER=webkit \
  npm run test:visual-demo-browser -- --demo realtime-builder --timeout 70000
```

`SYMBIOTE_PLAYWRIGHT_BROWSER` and `--playwright-browser` accept `chromium`,
`firefox`, or `webkit`. Smoke output is removed after successful runs unless
`--keep-output` or `SYMBIOTE_BROWSER_SMOKE_KEEP=1` is set.

## Chat-first tool-driven demo

Run the chat-first builder demo:

```bash
npm run demo:chat-builder
```

This demo is questionnaire-driven: the system offers the choices, the agent
selects, and the system places panels from canonical templates — the agent does
not decide placement. It starts with a single chat that presents a
workspace-class menu — **Programming**, **Video**, **Automation**, or
**Customization**. Selecting a class drives the real construction protocol on one
session via `dispatch(...)`:
`construction_classify` → `construction_questions_build` (the questionnaire) →
`construction_question_answer` (the agent picks offered options) → `construction_plan`
→ `construction_construct` (the system materializes the layout from the canonical
template). The chat is then docked as a global panel on the **right at full
height** (`layout_behavior_set` `collapse: manual`, high importance — it never
auto-collapses on resize, but folds away via the panel-layout's standard collapse
control once the workspace is built), the workspace panels
sit on the left, and every panel carries full layout behavior — importance, min
inline/block sizes, collapse policy, overflow, responsive mode/breakpoint — with
relative `ratio` for sizing.

The workspace renders real Symbiote UI components from the chosen template through
the `panel-layout` runtime under the default Cascade theme: Programming uses
`source-editor` / `sn-tree-panel` / `sn-canvas-viewport`, Video uses
`sn-timeline-editor` / `node-canvas` / `inspector-panel` / `sn-canvas-viewport`,
and Automation uses `sn-data-table` / `sn-rich-text-editor` / `node-canvas` /
`sn-file-upload`. The chat stays a mock `chat-workspace`, seeded with the answered
questionnaire.

The choice is real and interactive. Each class offers two or three constructed
**variants** (different `module-selection` answers → different left panels),
surfaced as selectable chips alongside the answered questionnaire; picking one
re-mounts that workspace with no reload. A live **theme control** (mode, accent
hue, and the geometry register tool/product) re-applies the Cascade theme, so the
color, geometry, and motion scales are exercised live in the browser.

The constructed workspace is **portable**: a variant can be relaunched from its
exported portable JSON. `relaunchFromExport` imports the variant's `config_export`
artifact in-browser, tears the live `panel-layout` down, and mounts a fresh
container seeded solely from that JSON — proving "export → teardown → relaunch in a
fresh host = the same workspace" with the panel set, docked-right chat, and theme
token preserved.

**Customization** is the one place the agent free-creates — when the canonical
catalog cannot satisfy a requested capability. The class runs the real path:
`discover_components` shows the catalog, `construction_construct` with an uncovered
`requiredCapabilities` is genuinely rejected (`construction_capabilities_missing`),
a new module descriptor is hand-authored, `config_patch_validate` checks its
organic fit, and `config_patch_propose` previews the overlay — **preview only,
never applied, no live writes**. The header surfaces the gap → recipe → organic-fit
→ proposed-preview trace, and the free-created module renders beside the docked chat
(aliased to `sn-data-table` as a visible demo stand-in, since no real component
exists for it).

Generate the bundle without serving (CI/package smoke):

```bash
node examples/visual-demo/chat-builder.js --write-only --output-dir tmp/chat-builder-demo
```

The headless construction is asserted by `tests/chat-builder-demo.test.js`
(part of `npm test`): each class answers the offered questionnaire, the config
validates, and the chat is the right-hand child of the root split. For
real-browser evidence, run the opt-in WebKit smoke, which serves the bundle,
opens on the chat menu, builds each class, and asserts the chat is docked on the
right at full height with real components, that switching a variant changes the
rendered panels, that the theme control changes the live mode/color-scheme and
geometry register, and no console errors. It also asserts the post-build
presentation flow: after construction the demo reads the live panel/interface
context, generates a data-grounded timeline, plays WebMCP safe actions, exposes a
real replay control, and keeps the presentation strip non-overlapping with no
stuck loading or construction placeholders. The smoke captures a screenshot per
class:

```bash
npx playwright install webkit
npm run test:chat-builder-browser
```

Pass `--browser chromium|firefox|webkit` to select the engine.

### Server-side first paint (SSR)

The demo proves the SSR migration: at write time it server-renders the workspace
shell chrome via `symbiote-workspace/ssr` (`renderWorkspaceShell()`, built on
`@symbiotejs/symbiote/node/SSR.js`) and injects it into the served `index.html`,
so the page's first paint already contains the `<workspace-shell>` topbar and the
stage host before `app.js` runs. On the client the shell hydrates in place via
`isoMode` (it is reused, not re-rendered) and the workspace mounts into its host;
data-driven panels stay client-rendered to avoid double render. The WebKit smoke
asserts the shell is present in the raw HTML (pre-JS) and that exactly one
hydrated shell exists after load.

`renderWorkspaceShell()` is **build-time only and non-concurrent**: `SSR.init()`
patches Node process globals (`document`/`window`/`customElements`) via linkedom,
so it must run as an isolated one-shot during the bundle write and never in a live
request path. It is serialized (single-flight): concurrent calls share one
in-flight render rather than racing the shared globals, so the build can call it
freely without overlapping `init`/`destroy` cycles.

The class menu and variant chips are keyboard-operable: each is a `role=tablist`
whose tabs track state with `aria-selected` and a roving `tabindex` (one tab is
`tabindex="0"`, the rest `-1`); ArrowLeft/ArrowRight move selection and focus
(re-mounting that class/variant), and Home/End jump to the first/last. The live
theme control (mode, accent hue, geometry register) is keyboard-operable too —
its buttons and the hue range are focusable and respond to keys, the hue exposes
its current value, and focused controls show a visible `:focus-visible` outline.
