import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPluginsFromDir, activateAllPlugins } from '../server/plugin-loader.js';
import { createWorkspaceServer } from '../server/index.js';
import { createIngressPlugin } from '../server/ingress.js';
import { createJobRuntime } from '../server/jobs.js';
import { createTriggerReconcilerPlugin } from '../server/triggers.js';
import { clearPlugins, listPlugins, getPlugin, registerPlugin } from '../plugins/index.js';
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
      contributes: {
        packs: [{
          id: 'test-dir-plugin:echo',
          handlers: [{ type: 'test/echo', driver: { inputs: [], outputs: [] } }],
        }],
      },
    };`;

    await writeFile(join(FIXTURES_DIR, 'echo.plugin.js'), pluginCode);

    let results = await loadPluginsFromDir(FIXTURES_DIR);
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'test-dir-plugin');
    assert.equal(results[0].status, 'registered');

    let plugin = getPlugin('test-dir-plugin');
    assert.ok(plugin);
    assert.equal(plugin.version, '1.0.0');
    assert.equal(plugin.contributes.packs[0].handlers.length, 1);
  });

  it('registers plugin handlers through the public engine package entrypoint', async () => {
    let pluginCode = `export default {
      name: 'engine-registry-plugin',
      version: '1.0.0',
      contributes: {
        packs: [{
          id: 'engine-registry-plugin:registry',
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
        }],
      },
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

function serverConfig() {
  return {
    name: 'server-plane',
    server: {
      endpoints: [{
        id: 'graph-webhook',
        kind: 'webhook',
        auth: 'public',
        binding: { graph: 'main', node: 'ingress-a' },
      }],
    },
    engine: {
      graphs: [{
        id: 'main',
        nodes: [{
          id: 'ingress-a',
          type: 'webhook-trigger',
          trigger: { kind: 'ingress' },
        }],
      }],
    },
  };
}

describe('server-plane plugin composition', () => {
  beforeEach(() => {
    clearPlugins();
  });

  it('activates ingress and trigger runtimes through the existing plugin lifecycle context', async () => {
    let config = serverConfig();
    let serverPlane = {};
    let hostCalls = [];
    let executionRuntime = createJobRuntime({ config, autoStart: false });
    let ingressHost = {
      async register(record) {
        hostCalls.push(['register', record.registrationId]);
        return { transportId: `transport:${record.registrationId}` };
      },
      async unregister(record) {
        hostCalls.push(['unregister', record.registrationId]);
      },
    };

    registerPlugin(createIngressPlugin({ config, mintToken: () => 'tok' }));
    registerPlugin(createTriggerReconcilerPlugin({ config, ingressHost }));

    let results = await activateAllPlugins({
      config,
      serverPlane,
      executionRuntime,
    });

    assert.deepEqual(results.map((result) => result.ok), [true, true]);
    assert.equal(listPlugins().filter((plugin) => plugin.status === 'active').length, 2);
    assert.ok(serverPlane.ingress);
    assert.ok(serverPlane.triggers);
    assert.equal(hostCalls[0][0], 'register');

    let registration = [...serverPlane.ingress.registrations.values()][0];
    let response = await serverPlane.ingress.route({
      method: 'POST',
      path: registration.path,
      body: { event: 'created' },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(typeof response.body.runId, 'string');

    let attached = await executionRuntime.attach({ runId: response.body.runId });
    assert.equal(attached.record.actor.actor, 'system');
    assert.deepEqual(attached.record.actor.principal, { kind: 'daemon', id: 'graph-webhook' });

    await serverPlane.triggers.deactivate();
    assert.equal(hostCalls.at(-1)[0], 'unregister');
  });
});
