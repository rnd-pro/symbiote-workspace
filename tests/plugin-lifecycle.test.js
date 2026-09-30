import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  activatePlugin,
  clearPlugins,
  registerPlugin,
  unregisterPlugin,
} from '../plugins/plugin-registry.js';

// Reproduces the lifecycle defect in `activatePlugin`: the `status === 'active'`
// guard is checked before the awaited `definition.activate(context)`, and the
// status is only stamped afterwards. Two concurrent activations therefore both
// pass the guard and the plugin's `activate` runs twice, with both callers
// reporting success. A double activation typically opens resources twice and
// registers listeners twice, and neither caller can tell it happened.

function minimalPlugin(name, hooks = {}) {
  return {
    name,
    version: '1.0.0',
    ...hooks,
  };
}

describe('plugin activation lifecycle', () => {
  it('activates a plugin once under concurrent activation', async () => {
    clearPlugins();
    let activateCalls = 0;
    let registered = registerPlugin(
      minimalPlugin('probe', {
        activate: async () => {
          activateCalls += 1;
          // Yield so a second caller can interleave between the status guard
          // and the status stamp.
          await new Promise((resolve) => setTimeout(resolve, 5));
        },
      }),
    );
    assert.equal(registered.ok, true);

    let results = await Promise.all([
      activatePlugin('probe'),
      activatePlugin('probe'),
    ]);

    assert.equal(
      activateCalls,
      1,
      'concurrent activation must run the plugin activate hook exactly once',
    );
    for (let result of results) {
      assert.equal(result.ok, true, 'both callers observe a successful activation');
    }
    clearPlugins();
  });

  it('deactivates the previous plugin when the same name is registered again', async () => {
    clearPlugins();
    let events = [];
    registerPlugin(
      minimalPlugin('reused', {
        activate: async () => events.push('activate:first'),
        deactivate: async () => events.push('deactivate:first'),
      }),
    );
    await activatePlugin('reused');

    let replaced = registerPlugin(
      minimalPlugin('reused', {
        activate: async () => events.push('activate:second'),
        deactivate: async () => events.push('deactivate:second'),
      }),
    );
    assert.equal(replaced.ok, true);
    assert.equal(replaced.replaced, true, 'the registry must report that it replaced an entry');
    // registerPlugin is synchronous while deactivate is not, so the release is
    // handed back rather than fired and forgotten.
    if (replaced.released) await replaced.released;

    assert.ok(
      events.includes('deactivate:first'),
      'registering over an active plugin must release the plugin it replaces',
    );
    clearPlugins();
  });

  it('deactivates a plugin that is unregistered while active', async () => {
    clearPlugins();
    let events = [];
    registerPlugin(
      minimalPlugin('dropped', {
        activate: async () => events.push('activate'),
        deactivate: async () => events.push('deactivate'),
      }),
    );
    await activatePlugin('dropped');

    await unregisterPlugin('dropped');

    assert.ok(
      events.includes('deactivate'),
      'unregistering an active plugin must run its deactivate hook',
    );
    clearPlugins();
  });
});
