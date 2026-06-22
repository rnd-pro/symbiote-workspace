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

Unlike the realtime builder, this demo authors no layout config. It constructs
the workspace by issuing real `dispatch(...)` tools on a single session —
`classify_workspace`, `scaffold_from_scratch`, `register_panel_type`,
`set_layout`, `set_behavior`, `add_panel`, `mount_widget`, `add_group`,
`add_section`, `bridge_event`, `check_guardrails`, `validate_config`, and
`export_config`. A chat panel is registered, made the whole workspace, and
pinned (`collapse: never`); every other region — preview, inspector, graph, and
logs — is then split in **around** the chat by an `add_panel` call. The browser
bundle replays those tool calls one stage at a time through the public
`symbiote-workspace/browser` `mountWorkspace` entry, so the layout assembles
around the chat with no page reload.

The panels render real Symbiote UI components seeded with mock content: the chat
is a mock `chat-workspace` (transcript, status board, composer), and the regions
around it use `code-block` (preview), `inspector-panel` (inspector),
`canvas-graph` (graph), and `sn-event-feed` (logs), mounted through the
`panel-layout` runtime under the default Cascade theme.

Generate the bundle without serving (CI/package smoke):

```bash
node examples/visual-demo/chat-builder.js --write-only --output-dir tmp/chat-builder-demo
```

The headless construction is asserted by `tests/chat-builder-demo.test.js`
(part of `npm test`). For real-browser evidence, run the opt-in WebKit smoke,
which serves the bundle, walks every stage, and asserts the chat persists as the
center, the layout grows around it, and the page has no console errors:

```bash
npx playwright install webkit
npm run test:chat-builder-browser
```

Pass `--browser chromium|firefox|webkit` to select the engine.
