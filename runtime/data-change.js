/**
 * data:change origin envelope.
 *
 * The runtime broadcasts only the Phase 1 target payload:
 * { channel, revision, baseRevision?, changedPaths[], origin }.
 *
 * @module symbiote-workspace/runtime/data-change
 */

import {
  RT_WORKSPACE_CAPABILITIES,
  RT_WORKSPACE_REGISTRY_UPDATES,
  WORKSPACE_CONFIG_CHANNEL,
  WORKSPACE_STATE_CHANNEL,
} from '../schema/constants.js';
import { parseWorkspaceAddress } from '../schema/was.js';
import { validateDataChangePayload as validateWiringDataChangePayload } from '../schema/sections/wiring.js';

/** Wire message type used for all data-change notifications. */
export const DATA_CHANGE_MESSAGE_TYPE = 'data:change';

export const DATA_CHANGE_DURABLE_CHANNELS = Object.freeze([
  WORKSPACE_CONFIG_CHANNEL,
  WORKSPACE_STATE_CHANNEL,
]);

export const DATA_CHANGE_RT_CHANNELS = Object.freeze([
  RT_WORKSPACE_CAPABILITIES,
  RT_WORKSPACE_REGISTRY_UPDATES,
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.length > 0;
}

function isDocumentChannel(channel) {
  try {
    let address = parseWorkspaceAddress(channel);
    return address.className === 'doc' && !address.path;
  } catch {
    return false;
  }
}

/**
 * Whether a data:change channel is in the Phase 1 target vocabulary.
 *
 * @param {unknown} channel
 * @returns {boolean}
 */
export function isDataChangeChannel(channel) {
  if (!hasText(channel)) return false;
  return (
    DATA_CHANGE_DURABLE_CHANNELS.includes(channel) ||
    DATA_CHANGE_RT_CHANNELS.includes(channel) ||
    isDocumentChannel(channel)
  );
}

/**
 * Validate a data:change payload including its channel.
 *
 * @param {unknown} payload
 * @returns {{ ok: boolean, errors: Array<{ path: string, message: string }> }}
 */
export function validateDataChangeEnvelope(payload) {
  let errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: [{ path: '', message: 'data:change payload must be an object.' }] };
  }
  if (!isDataChangeChannel(payload.channel)) {
    errors.push({ path: 'channel', message: 'channel must be workspace:config, workspace:state, doc:<collection>:<docId>, rt:workspace:capabilities, or rt:workspace:registry:updates.' });
  }
  let payloadResult = validateWiringDataChangePayload(payload);
  errors.push(...payloadResult.errors);
  return { ok: errors.length === 0, errors };
}

function assertValidPayload(payload) {
  let result = validateDataChangeEnvelope(payload);
  if (result.ok) return;
  let details = result.errors
    .map((error) => error.path ? `${error.path}: ${error.message}` : error.message)
    .join('; ');
  throw new Error(`Invalid data:change payload. ${details}`);
}

/**
 * Build the wire envelope for a data-change notification.
 *
 * @param {string} channel
 * @param {Object} change
 * @param {number} change.revision
 * @param {number} [change.baseRevision]
 * @param {string[]} change.changedPaths
 * @param {Object} change.origin
 * @returns {{ type: string, payload: object }}
 */
export function buildDataChangeMessage(channel, change = {}) {
  let payload = {
    channel,
    revision: change.revision,
    changedPaths: Array.isArray(change.changedPaths) ? [...change.changedPaths] : change.changedPaths,
    origin: change.origin,
  };
  if (change.baseRevision !== undefined) payload.baseRevision = change.baseRevision;

  assertValidPayload(payload);

  return {
    type: DATA_CHANGE_MESSAGE_TYPE,
    payload,
  };
}

/**
 * Whether a value is a valid data-change wire message.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
export function isDataChangeMessage(message) {
  return (
    isObject(message) &&
    message.type === DATA_CHANGE_MESSAGE_TYPE &&
    validateDataChangeEnvelope(message.payload).ok
  );
}

/**
 * Broadcast a data-change notification through an existing broadcast function.
 *
 * @param {(message: object) => void} broadcast
 * @param {string} channel
 * @param {Object} change
 * @returns {{ type: string, payload: object }}
 */
export function broadcastDataChange(broadcast, channel, change = {}) {
  if (typeof broadcast !== 'function') {
    throw new Error('broadcastDataChange requires a broadcast function.');
  }
  let message = buildDataChangeMessage(channel, change);
  broadcast(message);
  return message;
}
