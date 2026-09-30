import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseHTML } from 'linkedom';

import { mountWorkspace } from '../browser.js';

// Strict mode is only worth having if it actually refuses. These tests drive the
// real browser entry point, because a contract that is only exercised against a
// stub is a contract nobody has checked.

// `updateConfig` takes its base revision from the caller and nothing in the
// signature says so; omitting it fails deep inside the state commit with a message
// about WorkspaceState rather than about the update contract.
const CONFIG = {
  version: '1.0.0',
  name: 'strictness-probe',
  requires: { hostServices: { required: [] } },
  panels: {},
  layout: { type: 'stack', children: [] },
};

// A real DOM, because the browser entry point is a browser entry point. A stub
// would let a contract pass that a real caller could never satisfy.
function fakeElement() {
  let { document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  return { document, element: document.getElementById('root'), window: document.defaultView };
}

describe('strict updates', () => {
  it('remounts by default, preserving the behaviour the 1.x line published', () => {
    let mounts = 0;
    let { document, element } = fakeElement();
    let handle = mountWorkspace(CONFIG, element, {
      document,
      runtimeController: {
        mountWorkspace() {
          mounts += 1;
          return { destroy() {} };
        },
      },
    });

    assert.equal(typeof handle.updateConfig, 'function');
    assert.doesNotThrow(() => handle.updateConfig({ ...CONFIG, name: 'renamed' }, { baseRevision: 0 }));
    assert.equal(mounts, 2, 'the default path still destroys and remounts');
  });

  it('refuses instead of remounting when strictUpdates is on', () => {
    let mounts = 0;
    let { document, element } = fakeElement();
    let handle = mountWorkspace(CONFIG, element, {
      document,
      strictUpdates: true,
      runtimeController: {
        mountWorkspace() {
          mounts += 1;
          return { destroy() {} };
        },
      },
    });

    assert.equal(mounts, 1, 'the initial mount happens once');
    let thrown = null;
    try {
      handle.updateConfig({ ...CONFIG, name: 'renamed' }, { baseRevision: 0 });
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown, 'strict mode must refuse rather than silently remount');
    assert.equal(thrown.code, 'workspace_update_refused');
    assert.equal(mounts, 1, 'a refused update must not mount a replacement');
  });

  it('still updates in place under strict mode when the runtime really updates', () => {
    let updates = 0;
    let mounts = 0;
    let { document, element } = fakeElement();
    let handle = mountWorkspace(CONFIG, element, {
      document,
      strictUpdates: true,
      runtimeController: {
        mountWorkspace() {
          mounts += 1;
          return {
            updateConfig() { updates += 1; },
            destroy() {},
          };
        },
      },
    });

    handle.updateConfig({ ...CONFIG, name: 'renamed' }, { baseRevision: 0 });

    assert.equal(updates, 1, 'a real update is used, not a remount');
    assert.equal(mounts, 1);
  });
});
