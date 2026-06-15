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
node examples/visual-demo/preview.mjs --write-only --output-dir tmp/visual-demo-preview
```

Run the realtime chat-state builder demo:

```bash
npm run demo:realtime-builder
```

The realtime builder demo uses mock chat and questionnaire state. Press Play to
step from intent capture into service blueprint, dynamic layout assembly,
widget registration, bindings, adaptive collapse priorities, validation state,
and the required theme editor widget.

Use the Wide, Tablet, and Mobile controls to preview the generated adaptive
layout contract. The preview exposes visible, docked, collapsed, and protected
panels for each viewport scenario while keeping the theme editor requirement
visible in the contract. The demo shell also exposes stable adaptive and theme
runtime state for responsive mode, breakpoint, theme mode, and theme editor
status.

The generated `demo.contract.json` includes the play stages, required widgets,
acceptance matrix, build stream timeline, chat-state timeline, questionnaire
decision trace, adaptive viewport scenarios, and construction trace. The
construction trace records canonical questionnaire IDs, required module
capability coverage, adaptive/theme evidence, verification reports, and strict
export/import evidence so the staged transformation is inspectable without
reading the browser DOM.

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
