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

function rightRotate(value, shift) {
  return (value >>> shift) | (value << (32 - shift));
}

const SHA256_K = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8Bytes(text) {
  if (typeof TextEncoder === 'function') return [...new TextEncoder().encode(text)];
  let encoded = unescape(encodeURIComponent(text));
  return [...encoded].map((char) => char.charCodeAt(0));
}

function base64Bytes(bytes) {
  let alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    let a = bytes[index];
    let b = bytes[index + 1];
    let c = bytes[index + 2];
    output += alphabet[a >> 2];
    output += alphabet[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    output += b === undefined ? '=' : alphabet[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    output += c === undefined ? '=' : alphabet[c & 0x3f];
  }
  return output;
}

function sha256Base64(text) {
  let bytes = utf8Bytes(text);
  let bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  let high = Math.floor(bitLength / 0x100000000);
  let low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);

  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  let words = new Array(64);

  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    for (let index = 0; index < 16; index++) {
      let offset = chunk + index * 4;
      words[index] = (
        (bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 64; index++) {
      let s0 = rightRotate(words[index - 15], 7) ^ rightRotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      let s1 = rightRotate(words[index - 2], 17) ^ rightRotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index++) {
      let s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      let ch = (e & f) ^ (~e & g);
      let temp1 = (h + s1 + ch + SHA256_K[index] + words[index]) >>> 0;
      let s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      let maj = (a & b) ^ (a & c) ^ (b & c);
      let temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  let digest = [];
  for (let word of hash) {
    digest.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  }
  return base64Bytes(digest);
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
  return `sha256-${sha256Base64(canonicalize(value))}`;
}

export const INTEGRITY_PATTERN = Object.freeze(/^sha256-[A-Za-z0-9+/]+={0,2}$/);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isIntegrityString(value) {
  return typeof value === 'string' && INTEGRITY_PATTERN.test(value);
}
