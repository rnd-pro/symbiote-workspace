// Ownership and identity for workspace state.
//
// Every piece of state and every executable resource belongs to an explicitly
// identified owner. An owner is never a DOM node, a renderer name, or the tab
// that happens to be focused, because none of those survive reload, remount, or
// a second window.
//
// The axes below are deliberately separate. A single long composite key is the
// failure mode this module exists to prevent: it forces unrelated lifetimes
// into one identifier, so a short-lived mount ends up naming long-lived state.
//
// Lifetimes, shortest to longest:
//   mountId          always ephemeral; changes on every remount
//   viewInstanceId   one instance of a composition; a second open is a new id
//   windowSessionId  one window's presentation session; survives that window's
//                    reload, and a new window gets a new id
//   documentRef      the shared content behind one or more views
//   workspaceId      a configured workspace, stable while it is persisted
//   compositionId    the type of composition, e.g. `sar.board`
//   scopeId          the data space; the host decides what a scope means
//   principalRef     who is acting; a user is one kind of principal, and
//                    delegation is attribution rather than a further axis

import { PORTABLE_ID_PATTERN } from './constants.js';

const SCOPE_ID_PATTERN = /^[a-z][a-z0-9._:-]*$/;
const REF_PATTERN = /^[^:]+(?::[^:]+)*$/;

// The axes the foundation depends on, as names. Consumers look an axis up by
// name, so the list is keyed by the axis itself rather than by a role alias.
export const OWNERSHIP_AXES = Object.freeze([
  'scopeId',
  'compositionId',
  'workspaceId',
  'documentRef',
  'viewInstanceId',
  'windowSessionId',
  'mountId',
  'principalRef',
]);

// An axis is ephemeral when its owner does not survive a remount. Consumers use
// this to decide what may be persisted and what must be re-acquired.
export const EPHEMERAL_AXES = Object.freeze(['mountId']);

function normalizeAxis(value, pattern, label) {
  let text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required.`);
  if (!pattern.test(text)) {
    throw new TypeError(`${label} "${text}" does not match ${pattern}.`);
  }
  return text;
}

export function normalizeScopeId(value) {
  return normalizeAxis(value, SCOPE_ID_PATTERN, 'scopeId');
}

export function normalizeCompositionId(value) {
  return normalizeAxis(value, PORTABLE_ID_PATTERN, 'compositionId');
}

export function normalizeWorkspaceId(value) {
  return normalizeAxis(value, PORTABLE_ID_PATTERN, 'workspaceId');
}

export function normalizeViewInstanceId(value) {
  return normalizeAxis(value, PORTABLE_ID_PATTERN, 'viewInstanceId');
}

export function normalizeWindowSessionId(value) {
  return normalizeAxis(value, PORTABLE_ID_PATTERN, 'windowSessionId');
}

export function normalizeMountId(value) {
  return normalizeAxis(value, PORTABLE_ID_PATTERN, 'mountId');
}

/**
 * A document reference is a workspace address, not a bare id: it already names
 * the collection it belongs to, so a document is addressable without knowing
 * which workspace opened it.
 */
export function normalizeDocumentRef(value) {
  return normalizeAxis(value, REF_PATTERN, 'documentRef');
}

/**
 * A principal is a stable triple, not a user id. Delegation carries `actor` and
 * `onBehalfOf` as attribution and authority; neither changes the identity of the
 * state being addressed.
 */
export function normalizePrincipalRef(value) {
  let principal = value && typeof value === 'object' ? value : {};
  let issuer = normalizeAxis(principal.issuer, PORTABLE_ID_PATTERN, 'principalRef.issuer');
  let kind = normalizeAxis(principal.kind, PORTABLE_ID_PATTERN, 'principalRef.kind');
  let id = normalizeAxis(principal.id, PORTABLE_ID_PATTERN, 'principalRef.id');
  return { issuer, kind, id };
}

function encodePrincipal(principalRef) {
  return `${principalRef.issuer}~${principalRef.kind}~${principalRef.id}`;
}

function decodePrincipal(text) {
  let [issuer, kind, id] = String(text).split('~');
  if (!issuer || !kind || !id) throw new TypeError(`principalRef "${text}" is malformed.`);
  return { issuer, kind, id };
}

/**
 * Document state is owned by the scope, not by the view that displays it. Two
 * views of one document share this address and therefore share content, while
 * each keeps its own view-local state (see `viewLocalAddress`).
 */
export function documentAddress(scopeId, documentRef) {
  return `own:document:${normalizeScopeId(scopeId)}/${normalizeDocumentRef(documentRef)}`;
}

/**
 * Workspace configuration is owned by the scope alone: it must survive the
 * window being closed, so it carries no window or principal axis.
 */
export function workspaceAddress(scopeId, workspaceId) {
  return `own:workspace:${normalizeScopeId(scopeId)}/${normalizeWorkspaceId(workspaceId)}`;
}

export function personalAddress(scopeId, principalRef) {
  return `own:personal:${normalizeScopeId(scopeId)}/${encodePrincipal(normalizePrincipalRef(principalRef))}`;
}

/**
 * Presentation state belongs to one window session of one principal. This is
 * the axis that stops two windows from overwriting each other's layout: they
 * share `documentAddress` but never share this address.
 */
export function windowSessionAddress(scopeId, principalRef, windowSessionId) {
  let principal = normalizePrincipalRef(principalRef);
  return `own:window:${normalizeScopeId(scopeId)}/${encodePrincipal(principal)}/${normalizeWindowSessionId(windowSessionId)}`;
}

/**
 * Selection, scroll, and inspector state are owned by a view instance inside a
 * window session. The module instance is part of the address so two modules in
 * one view cannot collide, and the whole address is ephemeral with its window.
 */
export function viewLocalAddress(windowSessionId, viewInstanceId, moduleInstanceId) {
  return `own:view:${normalizeWindowSessionId(windowSessionId)}/${normalizeViewInstanceId(viewInstanceId)}/${normalizeModuleInstanceId(moduleInstanceId)}`;
}

export function normalizeModuleInstanceId(value) {
  return normalizeAxis(value, PORTABLE_ID_PATTERN, 'moduleInstanceId');
}

const ADDRESS_PATTERN = /^own:(document|workspace|personal|window|view):(.+)$/;

/**
 * Round-trips an ownership address back into its parts. `parseAddress` followed
 * by the matching builder returns the original string, which is the invariant
 * the contract suite asserts.
 */
export function parseAddress(address) {
  let match = ADDRESS_PATTERN.exec(String(address || '').trim());
  if (!match) throw new TypeError(`Ownership address "${address}" is malformed.`);

  let kind = match[1];
  let rest = match[2];

  if (kind === 'document') {
    let [scopeId, documentRef] = splitOnce(rest, '/');
    return { kind, scopeId: normalizeScopeId(scopeId), documentRef: normalizeDocumentRef(documentRef) };
  }

  if (kind === 'workspace') {
    let [scopeId, workspaceId] = splitOnce(rest, '/');
    return { kind, scopeId: normalizeScopeId(scopeId), workspaceId: normalizeWorkspaceId(workspaceId) };
  }

  if (kind === 'personal') {
    let [scopeId, principal] = splitOnce(rest, '/');
    return { kind, scopeId: normalizeScopeId(scopeId), principalRef: decodePrincipal(principal) };
  }

  if (kind === 'window') {
    let [scopeId, principal, windowSessionId] = splitExact(rest, '/', 3);
    return {
      kind,
      scopeId: normalizeScopeId(scopeId),
      principalRef: decodePrincipal(principal),
      windowSessionId: normalizeWindowSessionId(windowSessionId),
    };
  }

  let [windowSessionId, viewInstanceId, moduleInstanceId] = splitExact(rest, '/', 3);
  return {
    kind: 'view',
    windowSessionId: normalizeWindowSessionId(windowSessionId),
    viewInstanceId: normalizeViewInstanceId(viewInstanceId),
    moduleInstanceId: normalizeModuleInstanceId(moduleInstanceId),
  };
}

function splitOnce(value, separator) {
  return splitExact(value, separator, 2);
}

// Every segment is already normalised before it is joined, so no segment can
// itself contain the separator and an exact split is safe. A count mismatch is
// a malformed address rather than a value to guess at.
function splitExact(value, separator, count) {
  let parts = String(value).split(separator);
  if (parts.length !== count) {
    throw new TypeError(
      `Address segment "${value}" must have ${count} ${separator}-separated parts, found ${parts.length}.`,
    );
  }
  return parts;
}

/**
 * Reports whether an address belongs to a given scope. Used by the host to
 * refuse a write that crosses a scope boundary instead of silently accepting it.
 */
export function addressBelongsToScope(address, scopeId) {
  try {
    return parseAddress(address).scopeId === normalizeScopeId(scopeId);
  } catch {
    return false;
  }
}
