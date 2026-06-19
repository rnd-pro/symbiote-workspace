import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPluginsFromDir } from '../server/plugin-loader.js';
import { createWorkspaceServer } from '../server/index.js';
import { clearPlugins, listPlugins, getPlugin } from '../plugins/index.js';
import { clearRegistry, getNodeType } from 'symbiote-engine';

let __dirname = dirname(fileURLToPath(import.meta.url));
let FIXTURES_DIR = join(__dirname, '_test_plugins_fixtures');

describe('Server: Plugin Loader (from directory)', () => {
  beforeEach(async () => {
    clearPlugins();
    clearRegistry();
    await rm(FIXTURES_DIR, { recursive: true, force: true });
    await mkdir(FIXTURES_DIR, { recursive: true });
  });

  it('loads a valid .plugin.js file', async () => {
    let pluginCode = `export default {
      name: 'test-dir-plugin',
      version: '1.0.0',
      category: 'handler',
      handlers: [{ type: 'test/echo', driver: { inputs: [], outputs: [] } }],
    };`;

    await writeFile(join(FIXTURES_DIR, 'echo.plugin.js'), pluginCode);

    let results = await loadPluginsFromDir(FIXTURES_DIR);
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'test-dir-plugin');
    assert.equal(results[0].status, 'registered');

    let plugin = getPlugin('test-dir-plugin');
    assert.ok(plugin);
    assert.equal(plugin.version, '1.0.0');
    assert.equal(plugin.handlers.length, 1);
  });

  it('registers plugin handlers through the public engine package entrypoint', async () => {
    let pluginCode = `export default {
      name: 'engine-registry-plugin',
      version: '1.0.0',
      category: 'handler',
      handlers: [{
        type: 'test/registry-handler',
        category: 'test',
        icon: 'science',
        driver: {
          description: 'Test handler registered through the public engine API',
          inputs: [],
          outputs: [],
        },
      }],
    };`;

    await writeFile(join(FIXTURES_DIR, 'registry.plugin.js'), pluginCode);

    let results = await loadPluginsFromDir(FIXTURES_DIR);

    assert.equal(results[0].status, 'registered');
    let nodeType = getNodeType('test/registry-handler');
    assert.equal(nodeType?.type, 'test/registry-handler');
    assert.equal(nodeType?.category, 'test');
    assert.equal(nodeType?.icon, 'science');
  });

  it('reports error for invalid plugin file', async () => {
    let pluginCode = `export default {
      version: '1.0.0',
    };`;

    await writeFile(join(FIXTURES_DIR, 'bad.plugin.js'), pluginCode);

    let results = await loadPluginsFromDir(FIXTURES_DIR);
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'error');
  });

  it('loads multiple plugins from directory', async () => {
    let plugin1 = `export default { name: 'plugin-a', version: '1.0.0' };`;
    let plugin2 = `export default { name: 'plugin-b', version: '2.0.0' };`;

    await writeFile(join(FIXTURES_DIR, 'a.plugin.js'), plugin1);
    await writeFile(join(FIXTURES_DIR, 'b.plugin.js'), plugin2);

    let results = await loadPluginsFromDir(FIXTURES_DIR);
    assert.equal(results.length, 2);
    assert.equal(listPlugins().length, 2);
  });

  it('ignores non-.plugin.js files', async () => {
    await writeFile(join(FIXTURES_DIR, 'readme.txt'), 'hello');
    await writeFile(join(FIXTURES_DIR, 'util.js'), 'export default {};');
    let pluginCode = `export default { name: 'only-one', version: '1.0.0' };`;
    await writeFile(join(FIXTURES_DIR, 'valid.plugin.js'), pluginCode);

    let results = await loadPluginsFromDir(FIXTURES_DIR);
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'only-one');
  });

  it('handles empty directory gracefully', async () => {
    let results = await loadPluginsFromDir(FIXTURES_DIR);
    assert.equal(results.length, 0);
  });

  it('handles non-existent directory gracefully', async () => {
    let results = await loadPluginsFromDir(join(FIXTURES_DIR, 'nope'));
    assert.equal(results.length, 0);
  });

  it('loads plugins from nested subdirectory', async () => {
    let subDir = join(FIXTURES_DIR, 'sub');
    await mkdir(subDir, { recursive: true });
    let pluginCode = `export default { name: 'nested-plugin', version: '0.1.0' };`;
    await writeFile(join(subDir, 'nested.plugin.js'), pluginCode);

    let results = await loadPluginsFromDir(FIXTURES_DIR);
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'nested-plugin');
  });

  // Cleanup
  it('cleanup test fixtures', async () => {
    await rm(FIXTURES_DIR, { recursive: true, force: true });
  });
});

describe('Server: workspace server startup', () => {
  beforeEach(async () => {
    clearPlugins();
    clearRegistry();
  });

  it('starts and closes server mode with engine peer runtime dependencies', async () => {
    let handle = await createWorkspaceServer({ port: 0, watchFiles: false });
    try {
      assert.ok(handle.server);
      assert.ok(handle.wss);
      assert.ok(handle.graph);
      assert.deepEqual(handle.plugins, []);
    } finally {
      await handle.close();
    }
  });
});
