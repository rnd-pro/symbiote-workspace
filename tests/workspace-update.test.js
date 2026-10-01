import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseHTML } from 'linkedom';

import { mountWorkspace } from '../browser.js';

// There is one update behaviour now: a runtime that cannot update in place gets
// a refusal, not a remount. These tests drive the real browser entry point,
// because a contract only exercised against a stub is a contract nobody checked.

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

function mountWith(runtime) {
  let { document, element } = fakeElement();
  let handle = mountWorkspace(CONFIG, element, { document, runtimeController: runtime });
  return { handle, document, element };
}

describe('workspace updates', () => {
  it('refuses an update the runtime cannot apply, and keeps the mount alive', () => {
    let mounts = 0;
    let { handle } = mountWith({
      mountWorkspace() {
        mounts += 1;
        return { destroy() {} };
      },
    });

    let thrown = null;
    try {
      handle.updateConfig({ ...CONFIG, name: 'renamed' }, { baseRevision: 0 });
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown, 'a runtime with no update method must be refused, not remounted');
    assert.equal(thrown.code, 'workspace_update_refused');
    assert.match(thrown.message, /remounting would lose state/);
    assert.equal(mounts, 1, 'a refused update must not mount a replacement');
  });

  it('does not destroy the old mount when it refuses', () => {
    // The failure this prevents is losing state that lived only in the old mount.
    // Refusing is only worth anything if the old mount survives the refusal.
    let destroys = 0;
    let { handle } = mountWith({
      mountWorkspace() {
        return {
          destroy() {
            destroys += 1;
          },
        };
      },
    });

    try {
      handle.updateConfig({ ...CONFIG, name: 'renamed' }, { baseRevision: 0 });
    } catch {
      // the refusal is the assertion, not the throw
    }

    assert.equal(destroys, 0, 'refusing must not destroy what it refuses to replace');
  });

  it('updates in place when the runtime really updates', () => {
    let updates = 0;
    let mounts = 0;
    let { handle } = mountWith({
      mountWorkspace() {
        mounts += 1;
        return {
          updateConfig() {
            updates += 1;
          },
          destroy() {},
        };
      },
    });

    handle.updateConfig({ ...CONFIG, name: 'renamed' }, { baseRevision: 0 });

    assert.equal(updates, 1, 'a real update is used, not a remount');
    assert.equal(mounts, 1);
  });

  it('no longer offers strictUpdates, because refusing is no longer opt-in', () => {
    let { handle } = mountWith({
      mountWorkspace() {
        return { destroy() {} };
      },
    });

    assert.equal(handle.strictUpdates, undefined);
    assert.equal(
      handle.lastUpdatePath,
      undefined,
      'a refused update reports nothing that suggests a fallback still exists',
    );
  });
});
