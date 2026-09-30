// Composition descriptor — the contract that replaces a renderer seam.
//
// A renderer answers "how do I draw this". A descriptor answers the whole
// lifecycle question: how a URL becomes an instance, what state that instance
// owns, which resources it may acquire, how it is restored, and how it is
// updated. A composition that can only render is not a composition, and any
// product-specific behaviour that leaks into the shell shows up as a special
// case there — which is how a closed list of one product's surfaces appears in
// a supposedly universal library.
//
// Three things this deliberately does not allow:
//   - Functions inside the JSON. A definition references a registered
//     implementation; a config never carries code.
//   - A global service locator. `context` grants exactly the state slots and
//     acquisitions the descriptor declared, nothing more.
//   - Silent degradation. A missing required dependency is an addressable
//     `blocked` state that keeps its restoration descriptor, not an empty tab.

import { PORTABLE_ID_PATTERN } from './constants.js';
import { EPHEMERAL_AXES, OWNERSHIP_AXES } from './ownership.js';

export const COMPOSITION_CLOSE_DECISIONS = Object.freeze({
  allow: 'allow',
  needsDecision: 'needs-decision',
  blocked: 'blocked',
});

export const COMPOSITION_ROUTE_RESULTS = Object.freeze({
  match: 'match',
  noMatch: 'no-match',
  invalid: 'invalid',
});

export const COMPOSITION_STATE_SLOT_KINDS = Object.freeze([
  'persistent',
  'session',
  'view-local',
  'cache',
  'ephemeral',
]);

// Slots are owned, so a slot must name the axis that owns it. A slot that
// cannot say who owns it is the same defect as a state with no owner.
/**
 * The ownership axis a slot kind implies. A descriptor may name its owner
 * explicitly to override this, but the default lives here so products do not
 * have to repeat the mapping — a duplicated mapping is a mapping that drifts.
 */
const SLOT_OWNERS = Object.freeze({
  persistent: 'documentRef',
  session: 'windowSessionId',
  'view-local': 'viewInstanceId',
  cache: 'workspaceId',
  ephemeral: 'mountId',
});

/**
 * The axis that owns a slot: the explicit one if declared, otherwise the one its
 * kind implies.
 */
export function resolveSlotOwner(slot) {
  if (!slot || typeof slot !== 'object') return null;
  if (typeof slot.owner === 'string' && slot.owner) return slot.owner;
  return SLOT_OWNERS[slot.kind] ?? null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFunction(value) {
  return typeof value === 'function';
}

function normalizeId(value, label) {
  let text = typeof value === 'string' ? value.trim() : '';
  if (!PORTABLE_ID_PATTERN.test(text)) {
    throw new TypeError(`${label} must be a portable id, received "${text}".`);
  }
  return text;
}

/**
 * Validates a composition descriptor's shape. Returns problems rather than
 * throwing, so a host can register several and surface all of them at once.
 */
export function validateCompositionDefinition(definition) {
  let errors = [];
  let add = (path, message) => errors.push({ path, message });

  if (!isPlainObject(definition)) {
    return { valid: false, errors: [{ path: '', message: 'Composition definition must be an object.' }] };
  }

  try {
    normalizeId(definition.id, 'id');
  } catch (err) {
    add('id', err.message);
  }
  if (typeof definition.version !== 'string' || !definition.version.trim()) {
    add('version', 'version is required.');
  }

  if (!isPlainObject(definition.route)) {
    add('route', 'route must declare parseRoute and serializeRoute.');
  } else {
    if (!isFunction(definition.route.parseRoute)) add('route.parseRoute', 'parseRoute must be a function.');
    if (!isFunction(definition.route.serializeRoute)) add('route.serializeRoute', 'serializeRoute must be a function.');
  }

  for (let side of ['required', 'optional']) {
    let list = definition.dependencies?.[side];
    if (list !== undefined && !Array.isArray(list)) {
      add(`dependencies.${side}`, `dependencies.${side} must be an array when present.`);
    }
  }

  if (isPlainObject(definition.state) && Array.isArray(definition.state.slots)) {
    for (let [index, slot] of definition.state.slots.entries()) {
      if (!isPlainObject(slot)) {
        add(`state.slots[${index}]`, 'each state slot must be an object.');
        continue;
      }
      let kind = slot.kind;
      if (!COMPOSITION_STATE_SLOT_KINDS.includes(kind)) {
        add(`state.slots[${index}].kind`, `unknown slot kind "${kind}".`);
        continue;
      }
      let owner = resolveSlotOwner(slot);
      if (!OWNERSHIP_AXES.includes(owner)) {
        add(`state.slots[${index}].owner`, `slot owner "${owner}" is not a declared ownership axis.`);
      }
      if (EPHEMERAL_AXES.includes(owner) && kind === 'persistent') {
        add(`state.slots[${index}].owner`, 'a persistent slot cannot be owned by an ephemeral axis.');
      }
    }
  }

  if (!isPlainObject(definition.lifecycle)) {
    add('lifecycle', 'lifecycle must declare prepare, mount, beforeClose, and dispose.');
  } else {
    for (let hook of ['prepare', 'mount', 'beforeClose', 'dispose']) {
      if (!isFunction(definition.lifecycle[hook])) add(`lifecycle.${hook}`, `${hook} must be a function.`);
    }
  }

  if (!isPlainObject(definition.restoration)) {
    add('restoration', 'restoration must declare version, serialize, migrate, and restore.');
  } else {
    for (let hook of ['serialize', 'migrate', 'restore']) {
      if (!isFunction(definition.restoration[hook])) add(`restoration.${hook}`, `${hook} must be a function.`);
    }
    let version = definition.restoration.version;
    let versionPresent = typeof version === 'string' ? version.trim().length > 0 : Number.isInteger(version);
    if (!versionPresent) add('restoration.version', 'restoration.version is required.');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Normalises what a route parser returns so callers never branch on shape.
 * A parser that throws is treated as an invalid route, not a crash: a malformed
 * URL from a user must not take the shell down.
 */
export function normalizeRouteResult(result) {
  if (result && typeof result === 'object' && result.status) {
    let status = result.status;
    if (status === COMPOSITION_ROUTE_RESULTS.match) {
      return { status, target: result.target ?? null };
    }
    if (status === COMPOSITION_ROUTE_RESULTS.invalid) {
      return { status, reason: result.reason || 'route is not valid for this composition' };
    }
    if (status === COMPOSITION_ROUTE_RESULTS.noMatch) return { status };
    return { status: COMPOSITION_ROUTE_RESULTS.invalid, reason: `unknown route status "${status}"` };
  }
  return { status: COMPOSITION_ROUTE_RESULTS.invalid, reason: 'parseRoute must return a route result' };
}

/**
 * Checks the route contract's central invariant: serializing a matched target and
 * parsing it again must yield the same target. A route that is not idempotent
 * cannot be used for restoration, because a saved session would not reopen.
 */
export function assertRouteRoundTrip(definition, target) {
  let url = definition.route.serializeRoute(target);
  if (typeof url !== 'string' || !url.trim()) {
    return { ok: false, reason: 'serializeRoute must return a canonical URL string.' };
  }
  let parsed = normalizeRouteResult(definition.route.parseRoute(url));
  if (parsed.status !== COMPOSITION_ROUTE_RESULTS.match) {
    return { ok: false, reason: `parseRoute did not match its own serialized URL: ${parsed.reason || parsed.status}` };
  }
  if (JSON.stringify(parsed.target) !== JSON.stringify(target)) {
    return { ok: false, reason: 'parseRoute(serializeRoute(target)) did not return the same target.' };
  }
  return { ok: true, url };
}

/**
 * Runs `beforeClose` and normalises the decision. The UI shows a decision to
 * the user; the product decides what it means. A descriptor may not skip the
 * step, but it also may not invent a fourth outcome.
 */
export async function askCloseDecision(definition, context = {}) {
  let decision = await definition.lifecycle.beforeClose(context);
  let value = typeof decision === 'string' ? decision : decision?.decision;
  if (value === COMPOSITION_CLOSE_DECISIONS.allow) return { decision: value };
  if (value === COMPOSITION_CLOSE_DECISIONS.needsDecision) {
    return { decision: value, prompt: decision?.prompt || 'This workspace has unsaved work.' };
  }
  if (value === COMPOSITION_CLOSE_DECISIONS.blocked) {
    return { decision: value, reason: decision?.reason || 'A running operation prevents closing.' };
  }
  return {
    decision: COMPOSITION_CLOSE_DECISIONS.needsDecision,
    prompt: 'beforeClose returned an unknown decision; treated as needing a decision.',
  };
}

/**
 * Disposes exactly once, and always. A user cleanup that throws must not strand
 * the resources the runtime is already accounting for, so the failure is
 * reported and the remaining releases still run.
 */
export async function disposeOnce(state) {
  if (state.disposed) return { ok: true, alreadyDisposed: true };
  state.disposed = true;
  let failures = [];
  let userCleanup = null;
  if (isFunction(state.instance?.dispose)) {
    try {
      userCleanup = await state.instance.dispose();
    } catch (err) {
      failures.push({ source: 'instance.dispose', message: err?.message || String(err) });
    }
  }
  for (let release of state.releases ?? []) {
    try {
      await release();
    } catch (err) {
      failures.push({ source: 'release', message: err?.message || String(err) });
    }
  }
  return { ok: failures.length === 0, failures, userCleanup };
}
