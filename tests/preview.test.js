import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startPreview } from '../handlers/preview.js';
import { WORKSPACE_SCHEMA_VERSION } from '../schema/index.js';
import {
  BROWSER_ENGINE_CONTRACTS_IMPORT,
  BROWSER_ENGINE_IMPORT,
  BROWSER_THEME_IMPORT,
} from '../sharing/browser-contract.js';

let PREVIEW_CONFIG = {
  version: WORKSPACE_SCHEMA_VERSION,
  name: 'Preview Contract',
  theme: {
    params: { hue: 220 },
  },
};

let FULL_PREVIEW_IMPORTS = {
  'symbiote-workspace/browser': './mock-workspace-browser.js',
  [BROWSER_THEME_IMPORT]: './mock-symbiote-theme.js',
  [BROWSER_ENGINE_IMPORT]: './mock-symbiote-engine.js',
  [BROWSER_ENGINE_CONTRACTS_IMPORT]: './mock-symbiote-engine-contracts.js',
  'symbiote-engine/': './mock-symbiote-engine/',
};

function fixtureHomePath(...parts) {
  return ['', 'Users', ...parts].join('/');
}

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
        imports: FULL_PREVIEW_IMPORTS,
      });

      let html = await readFile(join(dir, 'index.html'), 'utf8');
      let importMapIndex = html.indexOf('<script type="importmap">');
      let moduleScriptIndex = html.indexOf('<script type="module" src="./app.js">');

      assert.equal(result.status, 'ok');
      assert.ok(importMapIndex > -1);
      assert.ok(moduleScriptIndex > -1);
      assert.ok(importMapIndex < moduleScriptIndex);
      assert.match(html, /"symbiote-workspace\/browser": "\.\/mock-workspace-browser\.js"/);
      assert.match(html, /"symbiote-ui\/ui": "\.\/mock-symbiote-theme\.js"/);
      assert.match(html, /"symbiote-engine": "\.\/mock-symbiote-engine\.js"/);
      assert.match(html, /"symbiote-engine\/contracts": "\.\/mock-symbiote-engine-contracts\.js"/);
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
        [BROWSER_THEME_IMPORT]: './node_modules/symbiote-ui/ui/index.js',
        [BROWSER_ENGINE_IMPORT]: './node_modules/symbiote-engine/index.js',
        [BROWSER_ENGINE_CONTRACTS_IMPORT]: './node_modules/symbiote-engine/contracts/index.js',
        'symbiote-engine/': './node_modules/symbiote-engine/',
      });
      assert.match(html, /"symbiote-workspace\/browser": "\.\/browser\.js"/);
      assert.match(html, /"symbiote-ui\/ui": "\.\/node_modules\/symbiote-ui\/ui\/index\.js"/);
      assert.match(html, /"symbiote-engine\/contracts": "\.\/node_modules\/symbiote-engine\/contracts\/index\.js"/);
    });
  });

  it('writes portable preview config without host or local state', async () => {
    await withPreviewDir(async (dir) => {
      let localCwd = fixtureHomePath('example', 'private-workspace');
      let result = await startPreview({
        ...PREVIEW_CONFIG,
        previewUrl: 'http://localhost:3456',
        host: { sessionId: 'local-session' },
        runtime: {
          cwd: localCwd,
        },
      }, {
        outputDir: dir,
        imports: FULL_PREVIEW_IMPORTS,
      });

      let configJson = await readFile(join(dir, 'workspace.config.json'), 'utf8');
      let app = await readFile(join(dir, 'app.js'), 'utf8');
      let writtenConfig = JSON.parse(configJson);

      assert.equal(result.status, 'ok');
      assert.equal(writtenConfig.name, PREVIEW_CONFIG.name);
      assert.equal(writtenConfig.previewUrl, undefined);
      assert.equal(writtenConfig.host, undefined);
      assert.deepEqual(writtenConfig.runtime, {});
      assert.equal(configJson.includes('localhost'), false);
      assert.equal(configJson.includes('local-session'), false);
      assert.equal(configJson.includes(localCwd), false);
      assert.equal(app.includes('localhost'), false);
      assert.equal(app.includes('local-session'), false);
      assert.equal(app.includes(localCwd), false);
    });
  });

  it('generates a runtime that passes the symbiote-ui cascade theme adapter', async () => {
    await withPreviewDir(async (dir) => {
      await startPreview(PREVIEW_CONFIG, {
        outputDir: dir,
        imports: FULL_PREVIEW_IMPORTS,
      });

      let app = await readFile(join(dir, 'app.js'), 'utf8');

      assert.match(app, /import\('symbiote-workspace\/browser'\)/);
      assert.match(app, /import\('symbiote-ui\/ui'\)/);
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
        imports: FULL_PREVIEW_IMPORTS,
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
        imports: FULL_PREVIEW_IMPORTS,
      });

      let contract = JSON.parse(await readFile(join(dir, 'preview.contract.json'), 'utf8'));

      assert.equal(result.contract.browser.entrypoint, 'symbiote-workspace/browser');
      assert.equal(result.contract.browser.importMap.required, true);
      assert.equal(result.contract.browser.importMap.scriptType, 'importmap');
      assert.deepEqual(result.contract.browser.requiredImports, [
        'symbiote-workspace/browser',
        BROWSER_THEME_IMPORT,
        BROWSER_ENGINE_IMPORT,
        BROWSER_ENGINE_CONTRACTS_IMPORT,
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
      assert.ok(missing.errors.some((error) => error.path === `imports.${BROWSER_THEME_IMPORT}`));
      assert.equal(await exists(join(dir, 'index.html')), false);
      assert.equal(await exists(join(dir, 'app.js')), false);
      assert.equal(await exists(join(dir, 'preview.contract.json')), false);

      let invalid = await startPreview(PREVIEW_CONFIG, {
        outputDir: dir,
        imports: {
          'symbiote-workspace/browser': './mock-workspace-browser.js',
          [BROWSER_THEME_IMPORT]: BROWSER_THEME_IMPORT,
          [BROWSER_ENGINE_IMPORT]: './mock-symbiote-engine.js',
          [BROWSER_ENGINE_CONTRACTS_IMPORT]: './mock-symbiote-engine-contracts.js',
          'symbiote-engine/': './mock-symbiote-engine/',
        },
      });

      assert.equal(invalid.status, 'error');
      assert.ok(invalid.errors.some((error) => error.path === `imports.${BROWSER_THEME_IMPORT}`));
    });
  });

  it('generates a runtime that renders loader warnings from mounted previews', async () => {
    await withPreviewDir(async (dir) => {
      await startPreview(PREVIEW_CONFIG, {
        outputDir: dir,
        imports: FULL_PREVIEW_IMPORTS,
      });

      let app = await readFile(join(dir, 'app.js'), 'utf8');

      assert.match(app, /loaderResult\?\.warnings/);
      assert.match(app, /data-preview-warnings/);
      assert.match(app, /data-preview-warning/);
    });
  });
});
