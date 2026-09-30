import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EPHEMERAL_AXES,
  OWNERSHIP_AXES,
  addressBelongsToScope,
  documentAddress,
  parseAddress,
  personalAddress,
  viewLocalAddress,
  windowSessionAddress,
  workspaceAddress,
} from '../schema/ownership.js';

// Contract suite for ownership identity. Step 1 of the foundation: the meaning
// of identity and ownership is fixed here even where implementation arrives
// gradually, because every later guarantee — atomic writes, lifecycle, update
// without state loss — is derived from it.

const SCOPE = 'acme';
const PRINCIPAL = { issuer: 'rnd-pro', kind: 'human', id: 'u-1' };
const OTHER_PRINCIPAL = { issuer: 'rnd-pro', kind: 'service', id: 'svc-9' };

describe('ownership identity axes', () => {
  it('names every axis the foundation depends on', () => {
    for (let axis of [
      'scopeId',
      'compositionId',
      'workspaceId',
      'documentRef',
      'viewInstanceId',
      'windowSessionId',
      'mountId',
      'principalRef',
    ]) {
      assert.ok(
        OWNERSHIP_AXES.includes(axis),
        `${axis} must be a declared ownership axis, got ${JSON.stringify(OWNERSHIP_AXES)}`,
      );
    }
  });

  it('marks the mount axis ephemeral and nothing else', () => {
    assert.deepEqual([...EPHEMERAL_AXES], ['mountId']);
  });
});

describe('ownership addresses', () => {
  it('gives two views of one document the same document address', () => {
    let first = documentAddress(SCOPE, 'doc:notes:n1');
    let second = documentAddress(SCOPE, 'doc:notes:n1');
    assert.equal(first, second, 'document content is owned by the scope, not by the view');
  });

  it('keeps view-local state separate per window, per view, and per module', () => {
    let base = viewLocalAddress('w-1', 'v-1', 'm-1');
    assert.notEqual(base, viewLocalAddress('w-2', 'v-1', 'm-1'), 'a second window must not overwrite the first');
    assert.notEqual(base, viewLocalAddress('w-1', 'v-2', 'm-1'), 'a second view must not overwrite the first');
    assert.notEqual(base, viewLocalAddress('w-1', 'v-1', 'm-2'), 'two modules in one view must not collide');
  });

  it('separates presentation state per window session while sharing document content', () => {
    let shared = documentAddress(SCOPE, 'doc:notes:n1');
    let firstWindow = windowSessionAddress(SCOPE, PRINCIPAL, 'w-1');
    let secondWindow = windowSessionAddress(SCOPE, PRINCIPAL, 'w-2');
    let otherPrincipal = windowSessionAddress(SCOPE, OTHER_PRINCIPAL, 'w-1');

    assert.equal(shared, documentAddress(SCOPE, 'doc:notes:n1'));
    assert.notEqual(firstWindow, secondWindow, 'two windows of one user need distinct presentation owners');
    assert.notEqual(firstWindow, otherPrincipal, 'two principals must not share presentation state');
  });

  it('round-trips every address kind through parseAddress', () => {
    let addresses = [
      documentAddress(SCOPE, 'doc:notes:n1'),
      workspaceAddress(SCOPE, 'board-42'),
      personalAddress(SCOPE, PRINCIPAL),
      windowSessionAddress(SCOPE, PRINCIPAL, 'w-1'),
      viewLocalAddress('w-1', 'v-1', 'm-1'),
    ];

    for (let address of addresses) {
      let parsed = parseAddress(address);
      let rebuilt = buildAgain(parsed);
      assert.equal(rebuilt, address, `${address} must round-trip unchanged`);
    }
  });

  it('rejects an address that crosses a scope boundary instead of accepting it', () => {
    let address = documentAddress('acme', 'doc:notes:n1');
    assert.equal(addressBelongsToScope(address, 'acme'), true);
    assert.equal(addressBelongsToScope(address, 'other-tenant'), false);
  });

  it('refuses to build an address from a missing axis rather than defaulting it', () => {
    assert.throws(() => documentAddress('', 'doc:notes:n1'), /scopeId/);
    assert.throws(() => documentAddress(SCOPE, ''), /documentRef/);
    assert.throws(() => windowSessionAddress(SCOPE, PRINCIPAL, ''), /windowSessionId/);
    assert.throws(() => personalAddress(SCOPE, { issuer: 'rnd-pro' }), /principalRef/);
  });
});

function buildAgain(parsed) {
  if (parsed.kind === 'document') return documentAddress(parsed.scopeId, parsed.documentRef);
  if (parsed.kind === 'workspace') return workspaceAddress(parsed.scopeId, parsed.workspaceId);
  if (parsed.kind === 'personal') return personalAddress(parsed.scopeId, parsed.principalRef);
  if (parsed.kind === 'window') {
    return windowSessionAddress(parsed.scopeId, parsed.principalRef, parsed.windowSessionId);
  }
  return viewLocalAddress(parsed.windowSessionId, parsed.viewInstanceId, parsed.moduleInstanceId);
}
