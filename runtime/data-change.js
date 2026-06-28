/**
 * Data-change channel convention (pull → push).
 *
 * A neutral, generic mechanism for pushing "something changed" notifications
 * over the existing engine WebSocket bridge so clients can refresh instead of
 * polling. Domain-agnostic: a channel is an opaque string and the payload is
 * opaque to this layer.
 *
 * This module owns the wire envelope (isomorphic, testable without a socket)
 * and a thin server-side broadcast wrapper over an existing `broadcast(msg)`
 * function (such as the one returned by symbiote-engine's createServer). The
 * browser-side subscribe client lives in `symbiote-workspace/browser`.
 *
 * @module symbiote-workspace/runtime/data-change
 */

/** Wire message type used for all data-change notifications. */
export const DATA_CHANGE_MESSAGE_TYPE = 'data:change';

/**
 * Build the wire envelope for a data-change notification.
 *
 * The shape matches the engine WS protocol's `{ type, payload }` convention so
 * it can flow through the existing broadcast bridge unchanged.
 *
 * @param {string} channel - Opaque channel identifier (e.g. 'board:default').
 * @param {Object} [change]
 * @param {string} [change.type] - Opaque sub-type describing the change.
 * @param {*} [change.payload] - Opaque change payload.
 * @returns {{ type: string, payload: { channel: string, type: string|null, payload: * } }}
 */
export function buildDataChangeMessage(channel, change = {}) {
  if (typeof channel !== 'string' || channel.length === 0) {
    throw new Error('buildDataChangeMessage requires a non-empty channel string.');
  }
  return {
    type: DATA_CHANGE_MESSAGE_TYPE,
    payload: {
      channel,
      type: typeof change.type === 'string' ? change.type : null,
      payload: change.payload,
    },
  };
}

/**
 * Whether a value is a data-change wire message.
 *
 * @param {*} message
 * @returns {boolean}
 */
export function isDataChangeMessage(message) {
  return (
    message !== null &&
    typeof message === 'object' &&
    message.type === DATA_CHANGE_MESSAGE_TYPE &&
    message.payload !== null &&
    typeof message.payload === 'object' &&
    typeof message.payload.channel === 'string'
  );
}

/**
 * Broadcast a data-change notification through an existing broadcast function.
 *
 * The `broadcast` argument is any `(message) => void` sink — typically the
 * `broadcast` returned by symbiote-engine's createServer, which serializes and
 * fans the message out to every connected WebSocket client.
 *
 * @param {(message: object) => void} broadcast - Existing broadcast sink.
 * @param {string} channel - Opaque channel identifier.
 * @param {Object} [change]
 * @param {string} [change.type] - Opaque sub-type describing the change.
 * @param {*} [change.payload] - Opaque change payload.
 * @returns {{ type: string, payload: { channel: string, type: string|null, payload: * } }} The sent message.
 */
export function broadcastDataChange(broadcast, channel, change = {}) {
  if (typeof broadcast !== 'function') {
    throw new Error('broadcastDataChange requires a broadcast function.');
  }
  let message = buildDataChangeMessage(channel, change);
  broadcast(message);
  return message;
}
