import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DATA_CHANGE_MESSAGE_TYPE,
  buildDataChangeMessage,
  isDataChangeMessage,
  broadcastDataChange,
} from '../runtime/data-change.js';
import { subscribeDataChange } from '../runtime/data-change-client.js';
import { broadcastDataChange as fromServer } from '../server/index.js';
import { subscribeDataChange as fromBrowser } from '../browser.js';

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

describe('data-change message envelope', () => {
  it('builds the { type, payload } wire shape', () => {
    let msg = buildDataChangeMessage('board:default', { type: 'status', payload: { id: 7 } });
    assert.equal(msg.type, DATA_CHANGE_MESSAGE_TYPE);
    assert.equal(msg.payload.channel, 'board:default');
    assert.equal(msg.payload.type, 'status');
    assert.deepEqual(msg.payload.payload, { id: 7 });
  });

  it('defaults change.type to null and omits payload gracefully', () => {
    let msg = buildDataChangeMessage('c1');
    assert.equal(msg.payload.type, null);
    assert.equal(msg.payload.payload, undefined);
  });

  it('rejects an empty channel', () => {
    assert.throws(() => buildDataChangeMessage(''), /non-empty channel/);
  });

  it('isDataChangeMessage recognizes its own envelope', () => {
    assert.equal(isDataChangeMessage(buildDataChangeMessage('c')), true);
    assert.equal(isDataChangeMessage({ type: 'graph:update', payload: {} }), false);
    assert.equal(isDataChangeMessage(null), false);
  });
});

describe('broadcastDataChange', () => {
  it('sends the message through the provided broadcast sink', () => {
    let sent = [];
    let msg = broadcastDataChange((m) => sent.push(m), 'board:default', {
      type: 'status',
      payload: { wonum: 'ignored-by-this-layer' },
    });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], msg);
    assert.equal(sent[0].payload.channel, 'board:default');
  });

  it('requires a broadcast function', () => {
    assert.throws(() => broadcastDataChange(null, 'c'), /broadcast function/);
  });

  it('is re-exported from the server entrypoint', () => {
    assert.equal(fromServer, broadcastDataChange);
  });
});

describe('subscribeDataChange', () => {
  it('delivers matching data-change notifications to onMessage', () => {
    let socket = new FakeSocket();
    let received = [];
    let handle = subscribeDataChange(socket, (change) => received.push(change));

    socket.deliver(buildDataChangeMessage('board:default', { type: 'status', payload: { id: 1 } }));
    socket.deliver({ type: 'graph:update', payload: {} });

    assert.equal(received.length, 1);
    assert.equal(received[0].channel, 'board:default');
    assert.equal(received[0].type, 'status');
    handle.close();
  });

  it('filters by channel when options.channel is set', () => {
    let socket = new FakeSocket();
    let received = [];
    subscribeDataChange(socket, (c) => received.push(c), { channel: 'board:a' });

    socket.deliver(buildDataChangeMessage('board:a', { payload: 1 }));
    socket.deliver(buildDataChangeMessage('board:b', { payload: 2 }));

    assert.equal(received.length, 1);
    assert.equal(received[0].channel, 'board:a');
  });

  it('accepts an array of channels', () => {
    let socket = new FakeSocket();
    let received = [];
    subscribeDataChange(socket, (c) => received.push(c.channel), { channel: ['a', 'b'] });

    socket.deliver(buildDataChangeMessage('a', {}));
    socket.deliver(buildDataChangeMessage('b', {}));
    socket.deliver(buildDataChangeMessage('c', {}));

    assert.deepEqual(received, ['a', 'b']);
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
    let handle = subscribeDataChange('ws://localhost:3100', (c) => received.push(c), {
      WebSocket: CtorSocket,
    });
    assert.equal(opened.length, 1);
    assert.equal(opened[0].url, 'ws://localhost:3100');

    opened[0].deliver(buildDataChangeMessage('x', {}));
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

  it('ignores malformed (non-JSON) messages', () => {
    let socket = new FakeSocket();
    let received = [];
    subscribeDataChange(socket, (c) => received.push(c));
    socket.emit('message', { data: 'not json {' });
    assert.equal(received.length, 0);
  });

  it('requires an onMessage callback', () => {
    assert.throws(() => subscribeDataChange(new FakeSocket(), null), /onMessage callback/);
  });

  it('is re-exported from the browser entrypoint', () => {
    assert.equal(fromBrowser, subscribeDataChange);
  });
});
