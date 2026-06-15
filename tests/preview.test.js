import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
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

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
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

  it('writes a valid default import map for local preview paths', async () => {
    await withPreviewDir(async (dir) => {
      let result = await startPreview(PREVIEW_CONFIG, {
        outputDir: dir,
        serveRoot: dir,
      });

      let html = await readFile(join(dir, 'index.html'), 'utf8');

      assert.equal(result.status, 'ok');
      assert.deepEqual(result.contract.importMap.imports, {
        'symbiote-workspace/browser': './browser.js',
        'symbiote-ui': './node_modules/symbiote-ui/index.js',
      });
      assert.match(html, /"symbiote-workspace\/browser": "\.\/browser\.js"/);
      assert.match(html, /"symbiote-ui": "\.\/node_modules\/symbiote-ui\/index\.js"/);
    });
  });

  it('writes portable preview config without host or local state', async () => {
    await withPreviewDir(async (dir) => {
      let result = await startPreview({
        ...PREVIEW_CONFIG,
        previewUrl: 'http://localhost:3456',
        host: { sessionId: 'local-session' },
        runtime: {
          cwd: '/Users/example/private-workspace',
        },
      }, {
        outputDir: dir,
        imports: {
          'symbiote-workspace/browser': './mock-workspace-browser.js',
          'symbiote-ui': './mock-symbiote-ui.js',
        },
      });

      let configJson = await readFile(join(dir, 'workspace.config.json'), 'utf8');
      let app = await readFile(join(dir, 'app.js'), 'utf8');
      let writtenConfig = JSON.parse(configJson);

      assert.equal(result.status, 'ok');
      assert.equal(writtenConfig.name, PREVIEW_CONFIG.name);
      assert.equal(writtenConfig.previewUrl, undefined);
      assert.equal(writtenConfig.host, undefined);
      assert.deepEqual(writtenConfig.runtime, {});
      assert.doesNotMatch(configJson, /localhost|local-session|\/Users\/example/);
      assert.doesNotMatch(app, /localhost|local-session|\/Users\/example/);
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
      assert.match(app, /HTMLScriptElement\.supports\?\.\('importmap'\)/);
      assert.match(app, /Import maps are not supported/);
      assert.match(app, /error\?\.message/);
      assert.match(app, /throw error/);
    });
  });

  it('writes a preview contract with required import-map capabilities', async () => {
    await withPreviewDir(async (dir) => {
      let result = await startPreview(PREVIEW_CONFIG, {
        outputDir: dir,
        imports: {
          'symbiote-workspace/browser': './mock-workspace-browser.js',
          'symbiote-ui': './mock-symbiote-ui.js',
        },
      });

      let contract = JSON.parse(await readFile(join(dir, 'preview.contract.json'), 'utf8'));

      assert.equal(result.contract.browser.entrypoint, 'symbiote-workspace/browser');
      assert.equal(result.contract.browser.importMap.required, true);
      assert.equal(result.contract.browser.importMap.scriptType, 'importmap');
      assert.deepEqual(result.contract.browser.requiredImports, [
        'symbiote-workspace/browser',
        'symbiote-ui',
      ]);
      assert.deepEqual(contract.browser.errorSurfaces, [
        'import-map-support',
        'module-load',
        'workspace-mount',
        'loader-warnings',
      ]);
    });
  });

  it('rejects incomplete or invalid preview import maps before writing runtime files', async () => {
    await withPreviewDir(async (dir) => {
      let missing = await startPreview(PREVIEW_CONFIG, {
        outputDir: dir,
        imports: {
          'symbiote-workspace/browser': './mock-workspace-browser.js',
        },
      });

      assert.equal(missing.status, 'error');
      assert.ok(missing.errors.some((error) => error.path === 'imports.symbiote-ui'));
      assert.equal(await exists(join(dir, 'index.html')), false);
      assert.equal(await exists(join(dir, 'app.js')), false);
      assert.equal(await exists(join(dir, 'preview.contract.json')), false);

      let invalid = await startPreview(PREVIEW_CONFIG, {
        outputDir: dir,
        imports: {
          'symbiote-workspace/browser': './mock-workspace-browser.js',
          'symbiote-ui': 'symbiote-ui',
        },
      });

      assert.equal(invalid.status, 'error');
      assert.ok(invalid.errors.some((error) => error.path === 'imports.symbiote-ui'));
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
