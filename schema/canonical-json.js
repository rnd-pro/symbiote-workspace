/**
 * Canonical JSON serialization and integrity hashing.
 *
 * RFC 8785 (JSON Canonicalization Scheme) style canonicalization: object keys
 * sorted by UTF-16 code unit, no insignificant whitespace, ECMAScript number
 * serialization. The byte-level grammar is frozen here because published
 * integrity strings must stay verifiable across hosts and versions.
 *
 * First consumers ship in this redesign: inline-module `integrity`, `requires`
 * integrity verification, and `reviewedDigest` + per-hook contentHash. There is
 * exactly one hash implementation in the workspace and it is this one.
 *
 * @module symbiote-workspace/schema/canonical-json
 */

import { createHash } from 'node:crypto';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  let proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serializeNumber(value) {
  if (!Number.isFinite(value)) {
    throw new TypeError('Cannot canonicalize a non-finite number.');
  }
  // ECMAScript Number-to-String is the RFC 8785 reference algorithm; normalize
  // the negative-zero edge to the canonical "0".
  if (Object.is(value, -0)) return '0';
  return String(value);
}

function serializeValue(value) {
  if (value === null) return 'null';

  if (typeof value === 'object' && typeof value.toJSON === 'function') {
    return serializeValue(value.toJSON());
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return serializeNumber(value);
    case 'string':
      // JSON.stringify emits RFC 8785-compatible string escapes (control chars
      // as lowercase \uXXXX, short forms for \b\f\n\r\t, only " and \ escaped).
      return JSON.stringify(value);
    case 'bigint':
      throw new TypeError('Cannot canonicalize a BigInt value.');
    case 'object':
      if (Array.isArray(value)) return serializeArray(value);
      if (isPlainObject(value)) return serializeObject(value);
      throw new TypeError('Cannot canonicalize a non-plain object.');
    default:
      // undefined, function, symbol — not part of the JSON data model.
      throw new TypeError(`Cannot canonicalize a value of type ${typeof value}.`);
  }
}

function serializeArray(value) {
  let parts = value.map((item) => (item === undefined ? 'null' : serializeValue(item)));
  return `[${parts.join(',')}]`;
}

function serializeObject(value) {
  let keys = Object.keys(value)
    .filter((key) => value[key] !== undefined && typeof value[key] !== 'function' && typeof value[key] !== 'symbol')
    .sort();
  let parts = keys.map((key) => `${JSON.stringify(key)}:${serializeValue(value[key])}`);
  return `{${parts.join(',')}}`;
}

/**
 * Produces the canonical serialization of a JSON value: sorted object keys, no
 * insignificant whitespace, ECMAScript number formatting. Independent of source
 * key order, so two structurally equal values always canonicalize identically.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  if (value === undefined) {
    throw new TypeError('Cannot canonicalize undefined.');
  }
  return serializeValue(value);
}

/**
 * Computes the integrity digest of a JSON value as `sha256-<base64>` over its
 * canonical serialization.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function computeIntegrity(value) {
  let digest = createHash('sha256').update(canonicalize(value), 'utf8').digest('base64');
  return `sha256-${digest}`;
}

export const INTEGRITY_PATTERN = Object.freeze(/^sha256-[A-Za-z0-9+/]+={0,2}$/);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isIntegrityString(value) {
  return typeof value === 'string' && INTEGRITY_PATTERN.test(value);
}
