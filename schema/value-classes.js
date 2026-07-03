export const WORKSPACE_SCHEMA_VERSION = '1.0.0';

export const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Portability value classes. Every string slot in a workspace config resolves to
 * exactly one class by its schema location, and portability rules are applied per
 * class rather than by scanning every value with the same substring heuristic.
 *
 * - id: portable identifiers and references (URLs and host-absolute paths are errors)
 * - text: human-facing display strings (free-form, never portability-scanned)
 * - path: pack-relative filesystem paths (relative segments allowed; URLs are errors)
 * - pattern: route patterns and canonical route strings (exempt from path scanning)
 * - code: inline module code, templates, styles (authored source that travels with config)
 */
export const VALUE_CLASSES = Object.freeze(['id', 'text', 'path', 'pattern', 'code']);

const TEXT_SLOTS = Object.freeze(new Set([
  'label',
  'title',
  'name',
  'description',
  'brief',
  'message',
  'summary',
  'subtitle',
  'heading',
  'placeholder',
  'prompt',
  'groupLabel',
  'sidebarLabel',
  'reason',
]));

const CODE_SLOTS = Object.freeze(new Set(['code', 'template', 'styles']));

const PATTERN_SLOTS = Object.freeze(new Set(['pattern', 'canonical']));

const URL_SHAPED = /^(?:file|https?|wss?):\/\//i;

const ABSOLUTE_HOST_PATH = /^(?:\/(?:Users|home|tmp|var\/folders|private\/var\/folders)\/|[a-z]:[\\/])/i;

const GRANT_EXPIRIES = Object.freeze(new Set(['task', 'session', 'install']));

function lastSegment(path) {
  let normalized = String(path ?? '').replace(/\[\d+\]/g, '');
  let segments = normalized.split('.').filter(Boolean);
  return {
    normalized,
    last: segments.length > 0 ? segments[segments.length - 1] : '',
  };
}

/**
 * Resolves the value class for a config path (schema location).
 *
 * @param {string} path - dotted config path, e.g. "routes[0].pattern"
 * @returns {'id'|'text'|'path'|'pattern'|'code'}
 */
export function classifyValueSlot(path) {
  let { normalized, last } = lastSegment(path);
  if (PATTERN_SLOTS.has(last)) return 'pattern';
  if (normalized.endsWith('source.path')) return 'path';
  if (CODE_SLOTS.has(last)) return 'code';
  if (TEXT_SLOTS.has(last)) return 'text';
  return 'id';
}

export function isUrlShaped(value) {
  return typeof value === 'string' && URL_SHAPED.test(value);
}

export function isAbsoluteHostPath(value) {
  return typeof value === 'string' && ABSOLUTE_HOST_PATH.test(value);
}

/**
 * Detects a grant object. Grants are session/host tier state and must never appear
 * in portable config (spec B4: a grant object in portable config is an ERROR).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isGrantObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (
    Array.isArray(value.scope)
    && Array.isArray(value.kinds)
    && typeof value.expiry === 'string'
    && GRANT_EXPIRIES.has(value.expiry)
    && Boolean(value.principal)
    && typeof value.principal === 'object'
  );
}

/**
 * Returns a non-portability reason for a string value at a given schema location,
 * or null when the value is portable for its class.
 *
 * @param {{ path: string, value: unknown }} slot
 * @returns {string|null}
 */
export function nonPortableStringReason({ path, value }) {
  if (typeof value !== 'string') return null;
  switch (classifyValueSlot(path)) {
    case 'pattern':
    case 'code':
    case 'text':
      return null;
    case 'path':
      return isUrlShaped(value) ? 'url-in-path' : null;
    default:
      if (isUrlShaped(value)) return 'url';
      if (isAbsoluteHostPath(value)) return 'host-path';
      return null;
  }
}
