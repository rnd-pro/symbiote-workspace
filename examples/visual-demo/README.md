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

For opt-in browser evidence, run the real-browser smoke. It starts the demo
server, launches a Chrome-compatible browser through the DevTools Protocol, and
asserts that the mounted workspace DOM has no preview error:

```bash
npm run test:visual-demo-browser
```

Set `SYMBIOTE_BROWSER_BIN` or pass `--browser` when Chrome is not installed in
the standard macOS application locations.
