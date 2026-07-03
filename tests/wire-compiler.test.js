import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WIRE_OBSERVATION_CONTEXT,
  applyWireMap,
  compileWire,
  compileWires,
  createRtProducerThrottle,
  installCompiledWires,
} from '../runtime/wire-compiler.js';
import { createRegistryObserver } from '../runtime/registry-observer.js';

class TestCtx {
  constructor(store = {}) {
    this.store = { ...store };
    this.subs = new Map();
  }

  has(prop) {
    return Object.hasOwn(this.store, prop);
  }

  read(prop) {
    return this.store[prop];
  }

  add(prop, value) {
    this.store[prop] = value;
    this.emit(prop, value);
  }

  pub(prop, value) {
    this.store[prop] = value;
    this.emit(prop, value);
  }

  sub(prop, callback) {
    if (!this.subs.has(prop)) this.subs.set(prop, new Set());
    this.subs.get(prop).add(callback);
    return {
      remove: () => this.subs.get(prop)?.delete(callback),
    };
  }

  emit(prop, value = this.store[prop]) {
    for (let callback of this.subs.get(prop) || []) callback(value);
  }
}

const microtask = () => new Promise((resolve) => queueMicrotask(resolve));

describe('compileWire', () => {
  it('compiles place and value endpoints to deterministic PubSub tokens', () => {
    let wire = compileWire({
      id: 'w-select',
      from: 'panel:main:records#event:row-select',
      to: 'state:selection.current',
      map: { 'detail.row': 'row' },
    });

    assert.equal(wire.from.ctxUid, 'panel:main:records');
    assert.equal(wire.from.prop, 'event:row-select');
    assert.equal(wire.to.ctxUid, 'state');
    assert.equal(wire.to.prop, 'selection.current');
    assert.equal(wire.subscriptions.length, 1);
    assert.deepEqual(wire.subscriptions[0].map, { 'detail.row': 'row' });
  });

  it('compiles two-way wires to two subscriptions with an inverted map', () => {
    let compiled = compileWire({
      id: 'w-draft',
      mode: 'two-way',
      from: 'panel:main:composer#binding:draft',
      to: 'state:chat.draft',
      map: { text: 'value' },
    });

    assert.equal(compiled.subscriptions.length, 2);
    assert.equal(compiled.subscriptions[0].direction, 'forward');
    assert.equal(compiled.subscriptions[1].direction, 'reverse');
    assert.deepEqual(compiled.subscriptions[1].map, { value: 'text' });
  });

  it('rejects direction violations and non-bijective two-way maps', () => {
    assert.throws(
      () => compileWire({ id: 'w', from: 'panel:a:b#method:m', to: 'state:x.y' }),
      /target-only/,
    );
    assert.throws(
      () => compileWire({
        id: 'w',
        mode: 'two-way',
        from: 'panel:a:b#binding:v',
        to: 'state:x.y',
        map: { a: 'value', b: 'value' },
      }),
      /not bijective/,
    );
  });

  it('rejects map source paths not declared by a source payload schema', () => {
    assert.throws(
      () => compileWire(
        {
          id: 'w',
          from: 'panel:a:b#event:x',
          to: 'state:x.y',
          map: { missing: 'value' },
        },
        0,
        { payloadSchemas: { w: ['detail.row'] } },
      ),
      /not declared/,
    );
  });

  it('rejects rt sources targeting durable document or workspace-tier state', () => {
    assert.throws(
      () => compileWires({
        wires: [{ id: 'w-doc', from: 'rt:workspace:execution:queue', to: 'doc:notes:n1' }],
      }),
      /durable doc/,
    );
    assert.throws(
      () => compileWires({
        state: { fields: [{ id: 'saved.tick', persistence: 'workspace' }] },
        wires: [{ id: 'w-state', from: 'rt:workspace:execution:queue', to: 'state:saved.tick' }],
      }),
      /workspace-tier state/,
    );
    assert.doesNotThrow(() => compileWires({
      state: { fields: [{ id: 'live.tick', persistence: 'runtime' }] },
      wires: [{ id: 'w-state', from: 'rt:workspace:execution:queue', to: 'state:live.tick' }],
    }));
  });

  it('compiles wildcard sources to the registry-observer selector index', () => {
    let compiled = compileWires([
      {
        id: 'w-prev',
        from: 'node:main-graph:*#out:image',
        to: 'panel:gallery:preview-{nodeId}#property:src',
      },
    ]);

    assert.equal(compiled.subscriptions.length, 0);
    assert.equal(compiled.wildcardSubscriptions.length, 1);
    assert.deepEqual(compiled.wildcardSubscriptions[0].match('node:main-graph:n1'), { nodeId: 'n1' });
    assert.equal(compiled.wildcardSubscriptions[0].match('node:other:n1'), null);
  });
});

describe('wire runtime installation', () => {
  it('delivers fan-out in wires[] order and applies pure pick/rename maps', async () => {
    let source = new TestCtx({ 'event:row-select': null });
    let first = new TestCtx({ 'property:selection': null });
    let second = new TestCtx({ 'property:selection': null });
    let calls = [];
    first.sub('property:selection', () => calls.push('first'));
    second.sub('property:selection', () => calls.push('second'));

    let observer = createRegistryObserver();
    observer.registerCtx('panel:main:records', source);
    observer.registerCtx('panel:main:first', first);
    observer.registerCtx('panel:main:second', second);

    let handle = installCompiledWires(compileWires([
      {
        id: 'w-first',
        from: 'panel:main:records#event:row-select',
        to: 'panel:main:first#property:selection',
        map: { 'detail.row': 'row' },
      },
      {
        id: 'w-second',
        from: 'panel:main:records#event:row-select',
        to: 'panel:main:second#property:selection',
        map: { 'detail.row': 'row' },
      },
    ]), { registryObserver: observer });

    source.pub('event:row-select', { detail: { row: 'r-1' } });

    assert.deepEqual(first.read('property:selection'), { row: 'r-1' });
    assert.deepEqual(second.read('property:selection'), { row: 'r-1' });
    assert.deepEqual(calls, ['first', 'second']);

    await microtask();
    assert.equal(observer.get(WIRE_OBSERVATION_CONTEXT)['event:w-first'].wireId, 'w-first');
    assert.equal(observer.get(WIRE_OBSERVATION_CONTEXT)['binding:w-second'].wireId, 'w-second');
    handle.close();
  });

  it('guards two-way echo by value equality', async () => {
    let source = new TestCtx({ 'binding:draft': { text: 'old' } });
    let state = new TestCtx({ 'chat.draft': { value: 'old' } });
    let sourceWrites = 0;
    let stateWrites = 0;
    source.sub('binding:draft', () => { sourceWrites += 1; });
    state.sub('chat.draft', () => { stateWrites += 1; });

    let observer = createRegistryObserver();
    observer.registerCtx('panel:main:composer', source);
    observer.registerCtx('state', state);

    let handle = installCompiledWires(compileWires([
      {
        id: 'w-draft',
        mode: 'two-way',
        from: 'panel:main:composer#binding:draft',
        to: 'state:chat.draft',
        map: { text: 'value' },
      },
    ]), { registryObserver: observer });

    source.pub('binding:draft', { text: 'hello' });
    await microtask();

    assert.deepEqual(state.read('chat.draft'), { value: 'hello' });
    assert.equal(sourceWrites, 1);
    assert.equal(stateWrites, 1);
    assert.equal(handle.disabled.has('w-draft'), false);
    handle.close();
  });

  it('materializes and tears down wildcard bindings through the observer seam', () => {
    let observer = createRegistryObserver();
    let preview = new TestCtx({ 'property:src': null });
    observer.registerCtx('panel:gallery:preview-n1', preview);

    let handle = installCompiledWires(compileWires([
      {
        id: 'w-prev',
        from: 'node:main-graph:*#out:image',
        to: 'panel:gallery:preview-{nodeId}#property:src',
      },
    ]), { registryObserver: observer });

    let node = new TestCtx({ 'out:image': null });
    observer.registerCtx('node:main-graph:n1', node);
    node.pub('out:image', 'img-1');
    assert.equal(preview.read('property:src'), 'img-1');

    observer.deleteCtx('node:main-graph:n1');
    node.pub('out:image', 'img-2');
    assert.equal(preview.read('property:src'), 'img-1');
    handle.close();
  });

  it('detects a revisited wire in one dispatch and emits hook-activity telemetry', async () => {
    let a = new TestCtx({ 'binding:value': { x: 0 } });
    let b = new TestCtx({ 'binding:value': { y: 0 } });
    let telemetry = [];
    let observer = createRegistryObserver();
    observer.registerCtx('panel:main:a', a);
    observer.registerCtx('panel:main:b', b);

    let handle = installCompiledWires(compileWires([
      {
        id: 'w-a-b',
        from: 'panel:main:a#binding:value',
        to: 'panel:main:b#binding:value',
        map: { x: 'y' },
      },
      {
        id: 'w-b-a',
        from: 'panel:main:b#binding:value',
        to: 'panel:main:a#binding:value',
        map: { y: 'z' },
      },
    ]), { registryObserver: observer, telemetry });

    a.pub('binding:value', { x: 1 });
    await microtask();
    await microtask();

    assert.equal(handle.disabled.has('w-a-b'), true);
    assert.equal(handle.errors.length, 1);
    assert.match(handle.errors[0].message, /revisited within one dispatch/);
    assert.deepEqual(telemetry, [{
      type: 'hook-activity',
      action: 'wire-disabled',
      reason: 'cycle',
      wireId: 'w-a-b',
      direction: 'forward',
    }]);
    handle.close();
  });
});

describe('helpers', () => {
  it('applies maps without mutating the source payload', () => {
    let payload = { detail: { row: { id: 'r1' } }, untouched: true };
    let mapped = applyWireMap(payload, { 'detail.row': 'selection.row' });
    assert.deepEqual(mapped, { selection: { row: { id: 'r1' } } });
    assert.deepEqual(payload, { detail: { row: { id: 'r1' } }, untouched: true });
  });

  it('wraps rt producers with an options-bag throttle', () => {
    let now = 0;
    let delayed = [];
    let calls = [];
    let throttled = createRtProducerThrottle((value) => calls.push(value), {
      minIntervalMs: 10,
      now: () => now,
      schedule: (fn, delay) => {
        delayed.push({ fn, delay });
        return {};
      },
    });

    throttled('a');
    throttled('b');
    throttled('c');

    assert.deepEqual(calls, ['a']);
    assert.equal(delayed.length, 1);
    assert.equal(delayed[0].delay, 10);
    now = 10;
    delayed[0].fn();
    assert.deepEqual(calls, ['a', 'c']);
  });
});
