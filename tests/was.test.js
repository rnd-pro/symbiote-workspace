import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDynamicStackInstanceId,
  encodeWasCustomIdent,
  parseWasAddress,
  parseWasEndpoint,
  parseWhenExpression,
  parseWorkspaceAddress,
  parseWorkspaceEndpoint,
  serializeWorkspaceAddress,
  serializeWorkspaceEndpoint,
  validateEndpointPair,
} from '../schema/was.js';

describe('workspace address space', () => {
  it('parses and serializes place address classes', () => {
    let addresses = [
      'view:records',
      'panel:records:kpi-main',
      'stack:records:main-stack',
      'stack:root',
      'node:main-graph:n1',
      'socket:main-graph:n1:out-image',
      'element:toolbar-save',
    ];
    for (let text of addresses) {
      let parsed = parseWorkspaceAddress(text);
      assert.equal(parsed.kind, 'place');
      assert.equal(serializeWorkspaceAddress(parsed), text);
    }
  });

  it('parses and serializes value and subject address classes', () => {
    let addresses = [
      'state:workbench.open-files',
      'rt:workspace:execution:queue',
      'doc:work-orders:DOC_42#status.history[0]',
      'asset:hero-video',
      'content:testimonials:t1#quote',
      'action:refresh',
      'event:wire-ready',
      'binding:selected-row',
      'route:enter:records',
      'route:exit:records',
      'resource:orders',
    ];
    for (let text of addresses) {
      let parsed = parseWorkspaceAddress(text);
      assert.equal(serializeWorkspaceAddress(parsed), text);
    }
    assert.equal(parseWorkspaceAddress('resource:orders').kind, 'reserved');
  });

  it('enforces fragment semantics by address class', () => {
    assert.throws(
      () => parseWorkspaceAddress('state:route.data.workOrder#status'),
      /state addresses do not take fragments/,
    );
    assert.equal(
      parseWorkspaceAddress('doc:work-orders:DOC_42#status').path,
      'status',
    );
    assert.throws(
      () => parseWorkspaceEndpoint('state:foo#event:change'),
      /state addresses do not take fragments/,
    );
    assert.throws(
      () => parseWorkspaceEndpoint('panel:records:kpi-main'),
      /requires a surface fragment/,
    );
  });

  it('parses endpoint surfaces and direction legality metadata', () => {
    let event = parseWorkspaceEndpoint('panel:records:kpi-main#event:ready', { position: 'from' });
    assert.equal(event.surface.direction, 'source');
    let binding = parseWorkspaceEndpoint('panel:records:kpi-main#binding:selected', { position: 'to' });
    assert.equal(binding.surface.direction, 'bidirectional');
    let state = parseWorkspaceEndpoint('state:records.selected', { position: 'to' });
    assert.equal(state.direction, 'bidirectional');
    let doc = parseWorkspaceEndpoint('doc:work-orders:DOC_42#status', { position: 'from' });
    assert.equal(doc.direction, 'bidirectional');

    assert.throws(
      () => parseWorkspaceEndpoint('panel:records:kpi-main#event:ready', { position: 'to' }),
      /source-only/,
    );
    assert.throws(
      () => parseWorkspaceEndpoint('panel:records:kpi-main#method:focus', { position: 'from' }),
      /target-only/,
    );
    assert.equal(serializeWorkspaceEndpoint(event), 'panel:records:kpi-main#event:ready');
  });

  it('supports wildcard from endpoints and templated to endpoints', () => {
    let from = parseWorkspaceEndpoint('node:main-graph:*#out:image', { position: 'from' });
    let to = parseWorkspaceEndpoint('panel:gallery:preview-{nodeId}#property:src', {
      position: 'to',
    });
    let result = validateEndpointPair(from, to);
    assert.deepEqual(result.captures, ['nodeId']);
    assert.deepEqual(result.templates, ['nodeId']);

    assert.throws(
      () => validateEndpointPair(
        'node:main-graph:*#out:image',
        'panel:gallery:preview-{socketId}#property:src',
      ),
      /not bound/,
    );
    assert.throws(
      () => parseWorkspaceEndpoint('panel:records:kpi[0]#event:ready', { position: 'from' }),
      /reserved character/,
    );
    assert.throws(
      () => parseWorkspaceEndpoint('panel:records:*#event:ready', { position: 'to' }),
      /reserved character/,
    );
  });

  it('encodes WAS and module ids into CSS custom identifiers', () => {
    assert.equal(
      encodeWasCustomIdent('panel:records:kpi-main'),
      'sn-panel--records--kpi-main',
    );
    assert.equal(
      encodeWasCustomIdent('acme.video:sequence-editor'),
      'sn-acme--video--sequence-editor',
    );
    assert.throws(
      () => encodeWasCustomIdent('panel:bad--id:x'),
      /cannot contain "--"/,
    );

    let samples = [
      'panel:records:kpi-main',
      'panel:records:kpi-side',
      'panel:orders:kpi-main',
      'acme.video:sequence-editor',
      'acme.ops:sequence-editor',
    ];
    let encoded = new Set(samples.map((item) => encodeWasCustomIdent(item)));
    assert.equal(encoded.size, samples.length);
  });

  it('parses focused when expressions and rejects combinators', () => {
    let when = parseWhenExpression('panel:main:records:focused');
    assert.equal(when.pseudo, 'focused');
    assert.equal(when.address.className, 'panel');
    assert.throws(
      () => parseWhenExpression('panel:main:records:focused && state:ready'),
      /one WAS address/,
    );
    assert.throws(
      () => parseWhenExpression('panel:main:records'),
      /focused pseudo-target/,
    );
  });

  it('creates dynamic stack instance ids from stack ids and runtime keys', () => {
    assert.equal(createDynamicStackInstanceId('editors', 'RUN_01'), 'editors-RUN_01');
    assert.throws(() => createDynamicStackInstanceId('editors', 'bad-key'), /item key/);
  });

  it('keeps legacy parse aliases available inside the new module only', () => {
    assert.equal(parseWasAddress('view:records').className, 'view');
    assert.equal(parseWasEndpoint('state:records.selected').kind, 'value');
  });
});
