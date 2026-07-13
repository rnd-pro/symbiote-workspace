/**
 * Portable-value scanning shared by the workspace's exact-version evidence and
 * journey contracts.
 *
 * A portable value is JSON-compatible, carries only finite numbers, and never
 * embeds host-bound or private material: absolute local paths, URLs, credential
 * query strings, bearer tokens, or private object keys. This is the single
 * implementation of that scan; contracts parameterize the allowed route field
 * and the private-key pattern rather than duplicating the regexes.
 *
 * @module symbiote-workspace/runtime/portable-value
 */

export const PORTABLE_SECRET_KEY_PATTERN = Object.freeze(
  /(?:token|secret|password|credential|api[-_]?key|samplePath|sessionId)/i,
);

const ABSOLUTE_PATH_PATTERN = /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|\/[A-Za-z0-9._-]+(?:\/|$))/;
const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\//i;
const CREDENTIAL_QUERY_PATTERN = /[#?&](?:token|access_token|auth|api_key|key|secret)=/i;
const BEARER_PATTERN = /\bBearer\s+\S+/i;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function scan(value, path, allowPathAt, exemptKeys, secretKeyPattern) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`${path} must be finite`);
    return value;
  }
  if (typeof value === 'string') {
    let text = value.trim();
    if (!allowPathAt(path) && ABSOLUTE_PATH_PATTERN.test(text)) {
      throw new TypeError(`${path} must not contain an absolute local path`);
    }
    if (URL_PATTERN.test(text)) throw new TypeError(`${path} must not contain a URL`);
    if (CREDENTIAL_QUERY_PATTERN.test(text) || BEARER_PATTERN.test(text)) {
      throw new TypeError(`${path} must not contain credentials`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => scan(item, `${path}[${index}]`, allowPathAt, exemptKeys, secretKeyPattern));
  }
  if (isObject(value)) {
    let result = {};
    for (let [key, child] of Object.entries(value)) {
      if (!exemptKeys.has(key) && secretKeyPattern.test(key)) {
        throw new TypeError(`${path}.${key} is private and not portable`);
      }
      result[key] = scan(child, `${path}.${key}`, allowPathAt, exemptKeys, secretKeyPattern);
    }
    return result;
  }
  throw new TypeError(`${path} must be JSON-compatible`);
}

/**
 * Recursively asserts that a value is portable, returning it unchanged.
 *
 * @param {unknown} value
 * @param {string} path — diagnostic path prefix for thrown errors.
 * @param {object} [options]
 * @param {(path: string) => boolean} [options.allowPathAt] — predicate marking
 *   exact paths whose string value may look like a route path.
 * @param {Set<string>} [options.exemptKeys] — object keys exempt from the
 *   private-key scan (e.g. semantic `versionToken` fields).
 * @param {RegExp} [options.secretKeyPattern] — private-key detector; defaults to
 *   {@link PORTABLE_SECRET_KEY_PATTERN}.
 * @returns {unknown}
 */
export function assertPortableValue(value, path, options = {}) {
  let allowPathAt = typeof options.allowPathAt === 'function' ? options.allowPathAt : () => false;
  let exemptKeys = options.exemptKeys instanceof Set ? options.exemptKeys : new Set();
  let secretKeyPattern = options.secretKeyPattern || PORTABLE_SECRET_KEY_PATTERN;
  return scan(value, path, allowPathAt, exemptKeys, secretKeyPattern);
}

/**
 * Asserts a path-only route: leading slash, no URL scheme, search, or hash.
 *
 * @param {unknown} value
 * @param {string} path — diagnostic path prefix for thrown errors.
 * @returns {string}
 */
export function assertPortableRoutePath(value, path) {
  let route = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!route) throw new TypeError(`${path} is required`);
  if (!route.startsWith('/') || route.includes('?') || route.includes('#') || route.includes('://')) {
    throw new TypeError(`${path} must be a path without URL search or hash`);
  }
  return route;
}
