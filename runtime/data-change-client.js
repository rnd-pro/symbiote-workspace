/**
 * Browser-side data-change subscription client.
 *
 * Connects to the engine WebSocket bridge and invokes a callback whenever a
 * data-change notification arrives. Domain-agnostic: callers filter by an
 * opaque channel string and receive the opaque change payload.
 *
 * The transport defaults to the global WebSocket but can be injected for tests
 * or alternative environments via `options.WebSocket`.
 *
 * @module symbiote-workspace/runtime/data-change-client
 */

import { DATA_CHANGE_MESSAGE_TYPE, isDataChangeMessage } from './data-change.js';

function parseMessage(raw) {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

/**
 * Subscribe to data-change notifications over a WebSocket.
 *
 * @param {string|object} target - WebSocket URL string, or a pre-connected
 *   socket-like object exposing addEventListener/removeEventListener.
 * @param {(change: { channel: string, type: string|null, payload: * }, message: object) => void} onMessage
 *   Called for each matching data-change notification.
 * @param {Object} [options]
 * @param {string|string[]} [options.channel] - Restrict to one or more channels.
 *   When omitted, all channels are delivered.
 * @param {new (url: string) => object} [options.WebSocket] - WebSocket constructor
 *   override (defaults to globalThis.WebSocket).
 * @returns {{ close: () => void, socket: object }} A handle; `close()` detaches
 *   the listener and closes the socket when this client opened it.
 */
export function subscribeDataChange(target, onMessage, options = {}) {
  if (typeof onMessage !== 'function') {
    throw new Error('subscribeDataChange requires an onMessage callback.');
  }

  let channels = options.channel == null
    ? null
    : new Set(Array.isArray(options.channel) ? options.channel : [options.channel]);

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

  function handleEvent(event) {
    let message = parseMessage(event?.data);
    if (!isDataChangeMessage(message)) return;
    if (message.type !== DATA_CHANGE_MESSAGE_TYPE) return;
    if (channels && !channels.has(message.payload.channel)) return;
    onMessage(message.payload, message);
  }

  socket.addEventListener('message', handleEvent);

  return {
    socket,
    close() {
      socket.removeEventListener('message', handleEvent);
      if (ownsSocket && typeof socket.close === 'function') socket.close();
    },
  };
}
