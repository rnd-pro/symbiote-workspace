import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseHTML } from 'linkedom';

import { mountWorkspace } from '../browser.js';
import { createMemoryDocumentPersistence } from '../runtime/documents.js';

// Atomicity is not advisory. An adapter that cannot compare-and-set cannot
// honour a commit that reports what it did, so a host may declare that it needs
// nothing from the library but may not claim support it does not have.

const CONFIG = {
  version: '1.0.0',
  name: 'atomic-probe',
  requires: { hostServices: { required: [] } },
  panels: {},
  layout: { type: 'stack', children: [] },
};

function container() {
  let { document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  return { document, element: document.getElementById('root') };
}

describe('mandatory atomic persistence', () => {
  it('refuses an adapter that cannot compare-and-set', () => {
    let { document, element } = container();
    let lying = { capabilities: { atomicCommit: true } }; // claims it, lacks compareAndSet

    let thrown = null;
    try {
      mountWorkspace(CONFIG, element, { document, persistence: lying });
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown, 'a capability claimed without the method must be refused');
    assert.equal(thrown.code, 'workspace_atomic_persistence_required');
    assert.equal(thrown.recoverable, true, 'the host can fix this and retry');
    assert.match(thrown.message, /compareAndSet/);
  });

  it('refuses an adapter that says nothing about atomicity at all', () => {
    let { document, element } = container();
    assert.throws(
      () => mountWorkspace(CONFIG, element, { document, persistence: {} }),
      (err) => err.code === 'workspace_atomic_persistence_required',
    );
  });

  it('accepts an adapter that can actually compare-and-set', () => {
    let { document, element } = container();
    let handle = mountWorkspace(CONFIG, element, {
      document,
      persistence: createMemoryDocumentPersistence(),
      runtimeController: { mountWorkspace: () => ({ destroy() {} }) },
    });

    assert.equal(typeof handle.updateConfig, 'function');
  });

  it('lets a host that persists nothing say so explicitly', () => {
    let { document, element } = container();
    // Opting out is possible, but only by declaring that nothing is persisted —
    // silence never opts a host out on its own.
    let handle = mountWorkspace(CONFIG, element, {
      document,
      persistence: {},
      requireAtomicPersistence: false,
      runtimeController: { mountWorkspace: () => ({ destroy() {} }) },
    });

    assert.equal(typeof handle.updateConfig, 'function');
  });

  it('does not require a persistence adapter at all when none is given', () => {
    let { document, element } = container();
    let handle = mountWorkspace(CONFIG, element, {
      document,
      runtimeController: { mountWorkspace: () => ({ destroy() {} }) },
    });

    assert.equal(typeof handle.updateConfig, 'function');
  });
});
