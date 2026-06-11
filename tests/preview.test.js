import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startPreview } from '../handlers/preview.js';

let PREVIEW_CONFIG = {
  version: '0.3.0',
  name: 'Preview Contract',
  theme: {
    params: { hue: 220 },
  },
};

async function withPreviewDir(run) {
  let dir = await mkdtemp(join(tmpdir(), 'symbiote-workspace-preview-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('startPreview', () => {
  it('writes an import map before the module script for browser bare imports', async () => {
    await withPreviewDir(async (dir) => {
      let result = await startPreview(PREVIEW_CONFIG, {
        outputDir: dir,
        port: 3999,
        imports: {
          'symbiote-workspace/browser': './mock-workspace-browser.js',
          'symbiote-ui': './mock-symbiote-ui.js',
        },
      });

      let html = await readFile(join(dir, 'index.html'), 'utf8');
      let importMapIndex = html.indexOf('<script type="importmap">');
      let moduleScriptIndex = html.indexOf('<script type="module" src="./app.js">');

      assert.equal(result.status, 'ok');
      assert.ok(importMapIndex > -1);
      assert.ok(moduleScriptIndex > -1);
      assert.ok(importMapIndex < moduleScriptIndex);
      assert.match(html, /"symbiote-workspace\/browser": "\.\/mock-workspace-browser\.js"/);
      assert.match(html, /"symbiote-ui": "\.\/mock-symbiote-ui\.js"/);
    });
  });

  it('generates a runtime that passes the symbiote-ui cascade theme adapter', async () => {
    await withPreviewDir(async (dir) => {
      await startPreview(PREVIEW_CONFIG, {
        outputDir: dir,
        imports: {
          'symbiote-workspace/browser': './mock-workspace-browser.js',
          'symbiote-ui': './mock-symbiote-ui.js',
        },
      });

      let app = await readFile(join(dir, 'app.js'), 'utf8');

      assert.match(app, /import\('symbiote-workspace\/browser'\)/);
      assert.match(app, /import\('symbiote-ui'\)/);
      assert.match(app, /themeAdapter: \{ applyCascadeTheme \}/);
      assert.match(app, /mountWorkspace\(config, document\.body,/);
      assert.doesNotMatch(app, /browser not available/);
      assert.doesNotMatch(app, /Ensure symbiote-workspace is installed/);
    });
  });

  it('generates a runtime that distinguishes module load errors from mount errors', async () => {
    await withPreviewDir(async (dir) => {
      await startPreview(PREVIEW_CONFIG, {
        outputDir: dir,
        imports: {
          'symbiote-workspace/browser': './mock-workspace-browser.js',
          'symbiote-ui': './mock-symbiote-ui.js',
        },
      });

      let app = await readFile(join(dir, 'app.js'), 'utf8');

      assert.match(app, /Failed to load preview modules/);
      assert.match(app, /Failed to mount workspace/);
      assert.match(app, /error\?\.message/);
      assert.match(app, /throw error/);
    });
  });

  it('generates a runtime that renders loader warnings from mounted previews', async () => {
    await withPreviewDir(async (dir) => {
      await startPreview(PREVIEW_CONFIG, {
        outputDir: dir,
        imports: {
          'symbiote-workspace/browser': './mock-workspace-browser.js',
          'symbiote-ui': './mock-symbiote-ui.js',
        },
      });

      let app = await readFile(join(dir, 'app.js'), 'utf8');

      assert.match(app, /loaderResult\?\.warnings/);
      assert.match(app, /data-preview-warnings/);
      assert.match(app, /data-preview-warning/);
    });
  });
});
