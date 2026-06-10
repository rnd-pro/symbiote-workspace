import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLUGIN_SCHEMA,
  PLUGIN_CATEGORIES,
  validatePluginDefinition,
  registerPlugin,
  activatePlugin,
  unregisterPlugin,
  listPlugins,
  getPlugin,
  getPluginStatus,
  clearPlugins,
  validatePlugin,
} from '../plugins/index.js';

describe('PLUGIN_SCHEMA', () => {
  it('exports a frozen schema object with required fields', () => {
    assert.ok(PLUGIN_SCHEMA);
    assert.equal(PLUGIN_SCHEMA.type, 'object');
    assert.deepEqual(PLUGIN_SCHEMA.required, ['name', 'version']);
    assert.ok(Object.isFrozen(PLUGIN_SCHEMA));
  });
});

describe('PLUGIN_CATEGORIES', () => {
  it('exports frozen categories array', () => {
    assert.ok(Array.isArray(PLUGIN_CATEGORIES));
    assert.ok(PLUGIN_CATEGORIES.includes('handler'));
    assert.ok(PLUGIN_CATEGORIES.includes('provider'));
    assert.ok(PLUGIN_CATEGORIES.includes('component'));
    assert.ok(PLUGIN_CATEGORIES.includes('theme'));
    assert.ok(PLUGIN_CATEGORIES.includes('integration'));
    assert.ok(Object.isFrozen(PLUGIN_CATEGORIES));
  });
});

describe('validatePluginDefinition', () => {
  it('accepts a minimal valid plugin', () => {
    let result = validatePluginDefinition({ name: 'test-plugin', version: '1.0.0' });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects null', () => {
    let result = validatePluginDefinition(null);
    assert.equal(result.valid, false);
  });

  it('rejects missing name', () => {
    let result = validatePluginDefinition({ version: '1.0.0' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === 'name'));
  });

  it('rejects missing version', () => {
    let result = validatePluginDefinition({ name: 'test' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === 'version'));
  });

  it('rejects invalid category', () => {
    let result = validatePluginDefinition({ name: 'test', version: '1.0.0', category: 'invalid' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === 'category'));
  });

  it('accepts valid category', () => {
    let result = validatePluginDefinition({ name: 'test', version: '1.0.0', category: 'handler' });
    assert.equal(result.valid, true);
  });

  it('validates handlers array', () => {
    let result = validatePluginDefinition({
      name: 'test',
      version: '1.0.0',
      handlers: [{ type: 'ai/tts' }],
    });
    assert.equal(result.valid, true);
  });

  it('rejects handler without type', () => {
    let result = validatePluginDefinition({
      name: 'test',
      version: '1.0.0',
      handlers: [{ category: 'ai' }],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path.includes('handlers')));
  });

  it('rejects non-array handlers', () => {
    let result = validatePluginDefinition({
      name: 'test',
      version: '1.0.0',
      handlers: 'invalid',
    });
    assert.equal(result.valid, false);
  });

  it('validates components array', () => {
    let result = validatePluginDefinition({
      name: 'test',
      version: '1.0.0',
      components: ['sn-my-widget'],
    });
    assert.equal(result.valid, true);
  });

  it('rejects non-string component entries', () => {
    let result = validatePluginDefinition({
      name: 'test',
      version: '1.0.0',
      components: [123],
    });
    assert.equal(result.valid, false);
  });

  it('rejects non-function activate', () => {
    let result = validatePluginDefinition({
      name: 'test',
      version: '1.0.0',
      activate: 'not-a-function',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === 'activate'));
  });

  it('accepts function activate and deactivate', () => {
    let result = validatePluginDefinition({
      name: 'test',
      version: '1.0.0',
      activate: () => {},
      deactivate: () => {},
    });
    assert.equal(result.valid, true);
  });

  it('validates a full plugin definition', () => {
    let result = validatePluginDefinition({
      name: '@symbiote/tunnel-cloudflare',
      version: '0.1.0',
      description: 'Cloudflare tunnel integration',
      category: 'provider',
      handlers: [
        { type: 'tunnel/start', driver: { inputs: [], outputs: [] } },
        { type: 'tunnel/stop', driver: { inputs: [], outputs: [] } },
      ],
      components: ['sn-tunnel-settings'],
      workspace: {
        configSchema: { subdomain: { type: 'string' } },
      },
      activate: () => {},
      deactivate: () => {},
    });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });
});

describe('Plugin Registry', () => {
  beforeEach(() => {
    clearPlugins();
  });

  it('registers a valid plugin', () => {
    let result = registerPlugin({ name: 'test-plugin', version: '1.0.0' });
    assert.equal(result.ok, true);
  });

  it('rejects an invalid plugin', () => {
    let result = registerPlugin({ name: '', version: '' });
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  });

  it('lists registered plugins', () => {
    registerPlugin({ name: 'a', version: '1.0.0', category: 'handler' });
    registerPlugin({ name: 'b', version: '2.0.0', category: 'provider' });
    let list = listPlugins();
    assert.equal(list.length, 2);
    assert.equal(list[0].name, 'a');
    assert.equal(list[0].status, 'pending');
    assert.equal(list[1].name, 'b');
  });

  it('gets a registered plugin by name', () => {
    registerPlugin({ name: 'my-plugin', version: '3.0.0' });
    let plugin = getPlugin('my-plugin');
    assert.ok(plugin);
    assert.equal(plugin.name, 'my-plugin');
    assert.equal(plugin.version, '3.0.0');
  });

  it('returns null for non-existent plugin', () => {
    assert.equal(getPlugin('nonexistent'), null);
  });

  it('returns status for registered plugin', () => {
    registerPlugin({ name: 'test', version: '1.0.0' });
    assert.equal(getPluginStatus('test'), 'pending');
  });

  it('returns null status for non-existent plugin', () => {
    assert.equal(getPluginStatus('nonexistent'), null);
  });

  it('clears all plugins', () => {
    registerPlugin({ name: 'a', version: '1.0.0' });
    registerPlugin({ name: 'b', version: '1.0.0' });
    clearPlugins();
    assert.equal(listPlugins().length, 0);
  });

  it('replaces plugin with same name', () => {
    registerPlugin({ name: 'test', version: '1.0.0' });
    registerPlugin({ name: 'test', version: '2.0.0' });
    let list = listPlugins();
    assert.equal(list.length, 1);
    assert.equal(getPlugin('test').version, '2.0.0');
  });
});

describe('Plugin Lifecycle', () => {
  beforeEach(() => {
    clearPlugins();
  });

  it('activates a plugin successfully', async () => {
    let activated = false;
    registerPlugin({
      name: 'lifecycle-test',
      version: '1.0.0',
      activate: () => { activated = true; },
    });

    let result = await activatePlugin('lifecycle-test');
    assert.equal(result.ok, true);
    assert.equal(activated, true);
    assert.equal(getPluginStatus('lifecycle-test'), 'active');
  });

  it('passes context to activate', async () => {
    let receivedContext;
    registerPlugin({
      name: 'ctx-test',
      version: '1.0.0',
      activate: (ctx) => { receivedContext = ctx; },
    });

    let ctx = { server: 'mock', graph: 'mock' };
    await activatePlugin('ctx-test', ctx);
    assert.deepEqual(receivedContext, ctx);
  });

  it('handles activate error gracefully', async () => {
    registerPlugin({
      name: 'error-test',
      version: '1.0.0',
      activate: () => { throw new Error('activate failed'); },
    });

    let result = await activatePlugin('error-test');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'activate failed');
    assert.equal(getPluginStatus('error-test'), 'error');
  });

  it('does not re-activate already active plugin', async () => {
    let count = 0;
    registerPlugin({
      name: 'double-test',
      version: '1.0.0',
      activate: () => { count++; },
    });

    await activatePlugin('double-test');
    await activatePlugin('double-test');
    assert.equal(count, 1);
  });

  it('returns error for non-registered plugin activation', async () => {
    let result = await activatePlugin('nonexistent');
    assert.equal(result.ok, false);
  });

  it('unregisters a plugin and calls deactivate', async () => {
    let deactivated = false;
    registerPlugin({
      name: 'unreg-test',
      version: '1.0.0',
      activate: () => {},
      deactivate: () => { deactivated = true; },
    });

    await activatePlugin('unreg-test');
    let result = await unregisterPlugin('unreg-test');
    assert.equal(result.ok, true);
    assert.equal(deactivated, true);
    assert.equal(getPlugin('unreg-test'), null);
  });

  it('unregisters a pending plugin without calling deactivate', async () => {
    let deactivated = false;
    registerPlugin({
      name: 'pending-unreg',
      version: '1.0.0',
      deactivate: () => { deactivated = true; },
    });

    await unregisterPlugin('pending-unreg');
    assert.equal(deactivated, false);
  });

  it('returns error when unregistering non-existent plugin', async () => {
    let result = await unregisterPlugin('ghost');
    assert.equal(result.ok, false);
  });

  it('handles async activate', async () => {
    let order = [];
    registerPlugin({
      name: 'async-test',
      version: '1.0.0',
      activate: async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push('activated');
      },
    });

    await activatePlugin('async-test');
    order.push('done');
    assert.deepEqual(order, ['activated', 'done']);
  });
});

describe('validatePlugin (re-export)', () => {
  it('is the same function as validatePluginDefinition', () => {
    assert.equal(validatePlugin, validatePluginDefinition);
  });
});
