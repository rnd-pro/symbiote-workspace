import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DATA_CHANGE_MESSAGE_TYPE,
  buildDataChangeMessage,
  isDataChangeChannel,
  isDataChangeMessage,
  validateDataChangeEnvelope,
  broadcastDataChange,
} from '../runtime/data-change.js';
import { subscribeDataChange } from '../runtime/data-change-client.js';
import { broadcastDataChange as fromServer } from '../server/index.js';
import { subscribeDataChange as fromBrowser } from '../browser.js';

const origin = Object.freeze({
  principal: { kind: 'agent', id: 'agent-1' },
  actor: 'agent-gated',
  reason: 'tool:update',
  sessionId: 'session-1',
});

class FakeSocket {
  constructor() {
    this.listeners = new Map();
    this.closed = false;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }

  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }

  close() {
    this.closed = true;
  }

  emit(type, event) {
    for (let fn of this.listeners.get(type) || []) fn(event);
  }

  deliver(message) {
    this.emit('message', { data: JSON.stringify(message) });
  }
}

describe('data-change origin envelope', () => {
  it('builds the target channel/revision/changedPaths/origin payload', () => {
    let msg = buildDataChangeMessage('workspace:config', {
      revision: 7,
      baseRevision: 6,
      changedPaths: ['modules[0].id', 'wires[0]'],
      origin,
    });

    assert.equal(msg.type, DATA_CHANGE_MESSAGE_TYPE);
    assert.deepEqual(msg.payload, {
      channel: 'workspace:config',
      revision: 7,
      baseRevision: 6,
      changedPaths: ['modules[0].id', 'wires[0]'],
      origin,
    });
  });

  it('accepts workspace, document, and reserved rt registry channels', () => {
    assert.equal(isDataChangeChannel('workspace:config'), true);
    assert.equal(isDataChangeChannel('workspace:state'), true);
    assert.equal(isDataChangeChannel('doc:notes:doc_1'), true);
    assert.equal(isDataChangeChannel('rt:workspace:capabilities'), true);
    assert.equal(isDataChangeChannel('rt:workspace:registry:updates'), true);
  });

  it('rejects attribution-less or legacy opaque payloads', () => {
    assert.throws(
      () => buildDataChangeMessage('workspace:config', { revision: 1, changedPaths: ['x'] }),
      /origin is mandatory/,
    );
    assert.equal(isDataChangeMessage({ type: 'data:change', payload: { channel: 'workspace:config', type: 'tool', payload: {} } }), false);
  });

  it('rejects channels outside the target vocabulary', () => {
    assert.throws(
      () => buildDataChangeMessage('board:default', { revision: 1, changedPaths: ['x'], origin }),
      /channel must be/,
    );
    assert.equal(isDataChangeChannel('rt:workspace:execution:queue'), false);
  });

  it('validates optional baseRevision and origin actor/principal', () => {
    let ok = validateDataChangeEnvelope({
      channel: 'workspace:state',
      revision: 3,
      baseRevision: 2,
      changedPaths: ['route.current'],
      origin: { principal: { kind: 'human', id: 'u-1' }, actor: 'user-direct', reason: 'click', sessionId: 's-1' },
    });
    assert.equal(ok.ok, true);

    let bad = validateDataChangeEnvelope({
      channel: 'workspace:state',
      revision: 3,
      baseRevision: '2',
      changedPaths: ['route.current'],
      origin: { principal: { kind: 'robot', id: 'u-1' }, actor: 'user-direct', reason: 'click', sessionId: 's-1' },
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((error) => error.path === 'baseRevision'));
    assert.ok(bad.errors.some((error) => error.path === 'origin.principal.kind'));
  });
});

describe('broadcastDataChange', () => {
  it('sends the message through the provided broadcast sink', () => {
    let sent = [];
    let msg = broadcastDataChange((m) => sent.push(m), 'doc:notes:n1', {
      revision: 9,
      changedPaths: ['title'],
      origin,
    });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], msg);
    assert.equal(sent[0].payload.channel, 'doc:notes:n1');
  });

  it('requires a broadcast function', () => {
    assert.throws(() => broadcastDataChange(null, 'workspace:config'), /broadcast function/);
  });

  it('is re-exported from the server entrypoint', () => {
    assert.equal(fromServer, broadcastDataChange);
  });
});

describe('subscribeDataChange', () => {
  it('delivers valid matching origin envelopes to onMessage', () => {
    let socket = new FakeSocket();
    let received = [];
    let handle = subscribeDataChange(socket, (payload) => received.push(payload));

    socket.deliver(buildDataChangeMessage('workspace:config', {
      revision: 1,
      changedPaths: ['name'],
      origin,
    }));
    socket.deliver({ type: 'graph:update', payload: {} });
    socket.deliver({ type: 'data:change', payload: { channel: 'workspace:config', type: 'legacy' } });

    assert.equal(received.length, 1);
    assert.equal(received[0].channel, 'workspace:config');
    assert.deepEqual(received[0].changedPaths, ['name']);
    handle.close();
  });

  it('filters by channel when options.channel is set', () => {
    let socket = new FakeSocket();
    let received = [];
    subscribeDataChange(socket, (payload) => received.push(payload.channel), { channel: 'workspace:state' });

    socket.deliver(buildDataChangeMessage('workspace:config', { revision: 1, changedPaths: ['x'], origin }));
    socket.deliver(buildDataChangeMessage('workspace:state', { revision: 2, changedPaths: ['y'], origin }));

    assert.deepEqual(received, ['workspace:state']);
  });

  it('accepts an array of channels', () => {
    let socket = new FakeSocket();
    let received = [];
    subscribeDataChange(socket, (payload) => received.push(payload.channel), {
      channel: ['workspace:config', 'rt:workspace:registry:updates'],
    });

    socket.deliver(buildDataChangeMessage('workspace:config', { revision: 1, changedPaths: ['x'], origin }));
    socket.deliver(buildDataChangeMessage('rt:workspace:registry:updates', { revision: 2, changedPaths: ['ctx'], origin }));
    socket.deliver(buildDataChangeMessage('workspace:state', { revision: 3, changedPaths: ['route'], origin }));

    assert.deepEqual(received, ['workspace:config', 'rt:workspace:registry:updates']);
  });

  it('opens its own socket from a URL via injected WebSocket', () => {
    let opened = [];
    class CtorSocket extends FakeSocket {
      constructor(url) {
        super();
        this.url = url;
        opened.push(this);
      }
    }
    let received = [];
    let handle = subscribeDataChange('ws://localhost:3100', (payload) => received.push(payload), {
      WebSocket: CtorSocket,
    });
    assert.equal(opened.length, 1);
    assert.equal(opened[0].url, 'ws://localhost:3100');

    opened[0].deliver(buildDataChangeMessage('workspace:config', { revision: 1, changedPaths: ['x'], origin }));
    assert.equal(received.length, 1);

    handle.close();
    assert.equal(opened[0].closed, true);
  });

  it('does not close a caller-provided socket on close()', () => {
    let socket = new FakeSocket();
    let handle = subscribeDataChange(socket, () => {});
    handle.close();
    assert.equal(socket.closed, false);
    assert.equal(socket.listeners.get('message').size, 0);
  });

  it('ignores malformed messages and requires an onMessage callback', () => {
    let socket = new FakeSocket();
    let received = [];
    subscribeDataChange(socket, (payload) => received.push(payload));
    socket.emit('message', { data: 'not json {' });
    assert.equal(received.length, 0);
    assert.throws(() => subscribeDataChange(new FakeSocket(), null), /onMessage callback/);
  });

  it('is re-exported from the browser entrypoint', () => {
    assert.equal(fromBrowser, subscribeDataChange);
  });
});
