/**
 * data:change subscription client.
 *
 * Consumes the Phase 1 origin envelope over a WebSocket-like message source.
 *
 * @module symbiote-workspace/runtime/data-change-client
 */

import { DATA_CHANGE_MESSAGE_TYPE, isDataChangeMessage } from './data-change.js';

function parseMessage(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeChannels(channel) {
  if (channel == null) return null;
  return new Set(Array.isArray(channel) ? channel : [channel]);
}

/**
 * Subscribe to data-change notifications over a WebSocket-like target.
 *
 * @param {string|object} target
 * @param {(payload: object, message: object) => void} onMessage
 * @param {Object} [options]
 * @param {string|string[]} [options.channel]
 * @param {new (url: string) => object} [options.WebSocket]
 * @returns {{ close: Function, socket: object }}
 */
export function subscribeDataChange(target, onMessage, options = {}) {
  if (typeof onMessage !== 'function') {
    throw new Error('subscribeDataChange requires an onMessage callback.');
  }

  let channels = normalizeChannels(options.channel);
  let ownsSocket = typeof target === 'string';
  let socket = target;

  if (ownsSocket) {
    let SocketCtor = options.WebSocket || globalThis.WebSocket;
    if (typeof SocketCtor !== 'function') {
      throw new Error('subscribeDataChange requires a WebSocket implementation.');
    }
    socket = new SocketCtor(target);
  }

  if (!socket || typeof socket.addEventListener !== 'function') {
    throw new Error('subscribeDataChange target must be a URL string or an event-emitting socket.');
  }

  let handleEvent = (event) => {
    let message = parseMessage(event?.data);
    if (!isDataChangeMessage(message)) return;
    if (message.type !== DATA_CHANGE_MESSAGE_TYPE) return;
    if (channels && !channels.has(message.payload.channel)) return;
    onMessage(message.payload, message);
  };

  socket.addEventListener('message', handleEvent);

  return {
    socket,
    close() {
      socket.removeEventListener('message', handleEvent);
      if (ownsSocket && typeof socket.close === 'function') socket.close();
    },
  };
}
