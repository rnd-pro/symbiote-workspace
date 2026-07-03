/**
 * Actor-aware tool policy and grant matching.
 *
 * This module stays host-neutral: hosts inject the board/gate verdict and grant
 * store state, while the runtime applies one deterministic policy over the
 * dispatch registry. Grants and consent tokens suppress only the human confirm;
 * the board verdict is evaluated first for every dispatch.
 *
 * @module symbiote-workspace/runtime/tool-policy
 */

import { createHash } from 'node:crypto';

import { GRANT_EXPIRIES, PRINCIPAL_KINDS, VERDICTS } from '../schema/constants.js';
import { isMutating, TOOLS } from './dispatch.js';

export const TOOL_CONFIRM_POLICIES = Object.freeze([
  'auto',
  'confirm',
  'blocked',
  'pendingApproval',
  'rolledBack',
]);

const KNOWN_TOOLS = new Set(TOOLS.map((tool) => tool.name));
const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));
const DEFAULT_PRINCIPAL_IDS = Object.freeze({
  human: 'user',
  agent: 'agent',
  daemon: 'system',
});
const ACTOR_TO_KIND = Object.freeze({
  'user-direct': 'human',
  human: 'human',
  user: 'human',
  'agent-gated': 'agent',
  agent: 'agent',
  system: 'daemon',
  daemon: 'daemon',
});
const KIND_TO_ACTOR = Object.freeze({
  human: 'user-direct',
  agent: 'agent-gated',
  daemon: 'system',
});
const KIND_TO_LANE = Object.freeze({
  human: 'user',
  agent: 'agent',
  daemon: 'daemon',
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  if (!isObject(value) && !Array.isArray(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  let entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
  return `{${entries.join(',')}}`;
}

function fingerprintArgs(args = {}) {
  if (!isObject(args)) return args;
  let next = { ...args };
  delete next.consentToken;
  delete next.token;
  return next;
}

function defaultPrincipal(kind) {
  return { kind, id: DEFAULT_PRINCIPAL_IDS[kind] || kind };
}

function principalKindFromActor(actor) {
  if (isObject(actor) && PRINCIPAL_KINDS.includes(actor.kind)) return actor.kind;
  if (typeof actor === 'string' && ACTOR_TO_KIND[actor]) return ACTOR_TO_KIND[actor];
  return 'agent';
}

function normalizePrincipal(input = {}) {
  let source = isObject(input.principal) ? input.principal : input.actor;
  let kind = principalKindFromActor(source);
  let base = isObject(source) ? source : {};
  return {
    ...cloneJson(base),
    kind,
    id: hasText(base.id) ? base.id : DEFAULT_PRINCIPAL_IDS[kind],
  };
}

function normalizeActor(actor, principal) {
  if (typeof actor === 'string' && ACTOR_TO_KIND[actor]) return actor;
  return KIND_TO_ACTOR[principal.kind] || 'agent-gated';
}

function principalLane(principal) {
  return KIND_TO_LANE[principal.kind] || 'agent';
}

function principalsMatch(grantPrincipal, principal) {
  if (!isObject(grantPrincipal) || !isObject(principal)) return false;
  if (grantPrincipal.kind !== principal.kind) return false;
  if (hasText(grantPrincipal.id) && hasText(principal.id)) return grantPrincipal.id === principal.id;
  return true;
}

function trimWildcard(scope) {
  if (scope === '*') return scope;
  if (scope.endsWith('.*')) return scope.slice(0, -2);
  if (scope.endsWith('/*')) return scope.slice(0, -2);
  return scope;
}

function pathHasPrefix(path, prefix) {
  return (
    path === prefix ||
    path.startsWith(`${prefix}.`) ||
    path.startsWith(`${prefix}[`) ||
    path.startsWith(`${prefix}/`) ||
    path.startsWith(`${prefix}:`)
  );
}

function scopeCoversPath(scope, path) {
  if (!hasText(scope) || !hasText(path)) return false;
  if (scope === '*') return true;
  let prefix = trimWildcard(scope);
  return pathHasPrefix(path, prefix);
}

function pathsOverlap(left, right) {
  if (!hasText(left) || !hasText(right)) return false;
  return scopeCoversPath(left, right) || scopeCoversPath(right, left);
}

function scopesCoverFootprint(scopes, footprint) {
  if (!Array.isArray(scopes) || scopes.length === 0) return false;
  if (!Array.isArray(footprint) || footprint.length === 0) return false;
  return footprint.every((path) => scopes.some((scope) => scopeCoversPath(scope, path)));
}

function kindMatches(kinds, toolName) {
  if (!Array.isArray(kinds)) return false;
  return kinds.includes('*') || kinds.includes(toolName);
}

function isGrantExpired(grant, options = {}) {
  if (grant.revoked === true) return true;
  if (grant.expiresAt !== undefined) {
    let expiresAt = Date.parse(grant.expiresAt);
    let now = options.now instanceof Date ? options.now.getTime() : Date.now();
    if (Number.isFinite(expiresAt) && expiresAt <= now) return true;
  }
  if (grant.expiry === 'task' && hasText(options.taskId) && grant.taskId !== options.taskId) {
    return true;
  }
  return false;
}

function verdictFrom(value) {
  if (value === undefined || value === null) return { status: 'accepted' };
  if (typeof value === 'string') return { status: value };
  if (!isObject(value)) return { status: value === false ? 'blocked' : 'accepted' };
  if (value.accepted === false) return { ...value, status: 'blocked' };
  if (value.accepted === true && value.status === undefined && value.verdict === undefined) {
    return { ...value, status: 'accepted' };
  }
  return {
    ...value,
    status: value.status || value.verdict || value.action || 'accepted',
  };
}

function normalizeVerdict(value) {
  let verdict = verdictFrom(value);
  let status = verdict.status === 'allow' ? 'accepted' : verdict.status;
  if (!VERDICTS.includes(status)) status = 'blocked';
  return {
    status,
    verdictId: hasText(verdict.verdictId) ? verdict.verdictId : hasText(verdict.id) ? verdict.id : `verdict:${status}`,
    reason: hasText(verdict.reason) ? verdict.reason : undefined,
    raw: cloneJson(value),
  };
}

function intentPrefix(toolName, lane) {
  if (toolName === 'navigate') return `navigate.${lane}`;
  if (toolName === 'execution.submit' || toolName === 'execution_submit') {
    return `execution.submit.${lane}`;
  }
  return `command.invoke.${lane}`;
}

/**
 * Normalize a scope/footprint input into path strings.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeFootprint(value) {
  if (typeof value === 'string') return hasText(value) ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  let result = [];
  for (let item of value) {
    if (hasText(item)) result.push(item.trim());
  }
  return [...new Set(result)];
}

/**
 * Stable command fingerprint used by consent tokens.
 *
 * @param {string} toolName
 * @param {Object} [input]
 * @returns {string}
 */
export function commandFingerprintFor(toolName, input = {}) {
  let hash = createHash('sha256');
  hash.update(stableJson({
    toolName,
    args: fingerprintArgs(input.args || {}),
    footprint: normalizeFootprint(input.footprint),
    baseRevision: input.baseRevision,
  }));
  return `sha256-${hash.digest('hex')}`;
}

/**
 * Build the per-principal intent id stem consumed by host gates.
 *
 * @param {string} toolName
 * @param {{kind: string, id?: string}} principal
 * @param {string} [suffix]
 * @returns {string}
 */
export function buildIntentId(toolName, principal, suffix = toolName) {
  return `${intentPrefix(toolName, principalLane(principal))}:${suffix}`;
}

/**
 * Whether a tool mutates state per the dispatch registry.
 *
 * Unknown tool names are treated as non-mutating here; the policy default for
 * unknown tools is decided in toolConfirmPolicy/evaluateToolIntent.
 *
 * @param {string} toolName
 * @returns {boolean}
 */
export function isMutatingTool(toolName) {
  return isMutating(toolName);
}

/**
 * Validate the host/session grant shape accepted by the policy seam.
 *
 * @param {unknown} grant
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateGrantRecord(grant) {
  let errors = [];
  if (!isObject(grant)) return { ok: false, errors: ['grant must be an object.'] };
  if (!hasText(grant.id)) errors.push('grant.id is required.');
  if (!isObject(grant.principal) || !PRINCIPAL_KINDS.includes(grant.principal.kind)) {
    errors.push(`grant.principal.kind must be one of ${PRINCIPAL_KINDS.join('|')}.`);
  }
  if (!Array.isArray(grant.scope) || normalizeFootprint(grant.scope).length === 0) {
    errors.push('grant.scope must be a non-empty string array.');
  }
  if (!Array.isArray(grant.kinds) || grant.kinds.some((kind) => !hasText(kind)) || grant.kinds.length === 0) {
    errors.push('grant.kinds must be a non-empty string array.');
  }
  if (!GRANT_EXPIRIES.includes(grant.expiry)) {
    errors.push(`grant.expiry must be one of ${GRANT_EXPIRIES.join('|')}.`);
  }
  if (grant.expiry === 'task' && !hasText(grant.taskId)) {
    errors.push("grant.expiry:'task' requires taskId.");
  }
  if (!isObject(grant.mintedBy) || !hasText(grant.mintedBy.kind)) {
    errors.push('grant.mintedBy.kind is required.');
  } else {
    if (!hasText(grant.mintedBy.verdictId)) errors.push('grant.mintedBy.verdictId is required.');
    if (!hasText(grant.mintedBy.confirmId)) errors.push('grant.mintedBy.confirmId is required.');
  }
  if (!hasText(grant.mintedAt)) errors.push('grant.mintedAt is required.');
  return { ok: errors.length === 0, errors };
}

/**
 * Validate a consent token carried by a confirmed command.
 *
 * @param {unknown} token
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateConsentToken(token) {
  let errors = [];
  if (!isObject(token)) return { ok: false, errors: ['consent token must be an object.'] };
  if (!hasText(token.confirmId)) errors.push('token.confirmId is required.');
  if (!hasText(token.commandFingerprint) || !token.commandFingerprint.startsWith('sha256-')) {
    errors.push('token.commandFingerprint must be a sha256 string.');
  }
  if (!Number.isInteger(token.baseRevision)) errors.push('token.baseRevision must be an integer.');
  if (normalizeFootprint(token.footprint).length === 0) errors.push('token.footprint must be non-empty.');
  if (!hasText(token.originContext)) errors.push('token.originContext is required.');
  if (!hasText(token.verdictId)) errors.push('token.verdictId is required.');
  return { ok: errors.length === 0, errors };
}

/**
 * Match one grant against a principal, tool, and write footprint.
 *
 * @param {unknown} grant
 * @param {Object} input
 * @returns {{ok: boolean, reason?: string, grant?: object}}
 */
export function grantMatches(grant, input = {}) {
  let validation = validateGrantRecord(grant);
  if (!validation.ok) return { ok: false, reason: 'invalid-grant' };
  let principal = normalizePrincipal(input);
  let footprint = normalizeFootprint(input.footprint || input.scope);
  if (!principalsMatch(grant.principal, principal)) return { ok: false, reason: 'principal-mismatch' };
  if (!kindMatches(grant.kinds, input.toolName)) return { ok: false, reason: 'kind-mismatch' };
  if (!scopesCoverFootprint(normalizeFootprint(grant.scope), footprint)) {
    return { ok: false, reason: 'scope-mismatch' };
  }
  if (isGrantExpired(grant, input)) return { ok: false, reason: 'expired' };
  return { ok: true, grant };
}

/**
 * Find the first matching grant.
 *
 * @param {unknown[]} grants
 * @param {Object} input
 * @returns {{ok: boolean, grant?: object, reason?: string}}
 */
export function findMatchingGrant(grants, input = {}) {
  if (!Array.isArray(grants)) return { ok: false, reason: 'no-grants' };
  for (let grant of grants) {
    let match = grantMatches(grant, input);
    if (match.ok) return match;
  }
  return { ok: false, reason: 'no-matching-grant' };
}

/**
 * Check whether a consent token authorizes this command.
 *
 * @param {unknown} token
 * @param {Object} input
 * @returns {{ok: boolean, reason?: string, blocked?: boolean, rebased?: boolean}}
 */
export function consentTokenMatches(token, input = {}) {
  let validation = validateConsentToken(token);
  if (!validation.ok) return { ok: false, reason: 'invalid-token' };
  let footprint = normalizeFootprint(input.footprint || input.scope);
  let tokenFootprint = normalizeFootprint(token.footprint);
  if (!scopesCoverFootprint(tokenFootprint, footprint)) {
    return { ok: false, reason: 'consent-footprint-exceeded', blocked: true };
  }
  if (hasText(input.commandFingerprint) && input.commandFingerprint !== token.commandFingerprint) {
    return { ok: false, reason: 'command-fingerprint-mismatch' };
  }
  if (Number.isInteger(input.baseRevision) && input.baseRevision !== token.baseRevision) {
    if (input.allowRebase !== true) return { ok: false, reason: 'baseRevision-mismatch' };
    let changedPaths = normalizeFootprint(input.changedPathsSinceBase || input.concurrentChangedPaths);
    let overlapped = changedPaths.some((path) => tokenFootprint.some((scope) => pathsOverlap(scope, path)));
    if (overlapped) return { ok: false, reason: 'consent-concurrent-overlap' };
    return { ok: true, rebased: true };
  }
  return { ok: true };
}

/**
 * Mint a host-side grant from an approved footprint.
 *
 * @param {Object} input
 * @returns {Object}
 */
export function mintGrant(input = {}) {
  let scope = normalizeFootprint(input.scope || input.footprint);
  let grant = {
    id: input.id,
    principal: normalizePrincipal(input),
    scope,
    kinds: Array.isArray(input.kinds) ? [...input.kinds] : [],
    expiry: input.expiry || 'task',
    taskId: input.taskId,
    mintedBy: cloneJson(input.mintedBy),
    mintedAt: input.mintedAt || new Date().toISOString(),
  };
  let validation = validateGrantRecord(grant);
  if (!validation.ok) throw new Error(`Invalid grant: ${validation.errors.join('; ')}`);
  return grant;
}

/**
 * Mint a consent token after an accepted gate verdict and human confirm.
 *
 * @param {Object} input
 * @returns {Object}
 */
export function mintConsentToken(input = {}) {
  let token = {
    confirmId: input.confirmId,
    commandFingerprint: input.commandFingerprint,
    baseRevision: input.baseRevision,
    footprint: normalizeFootprint(input.footprint),
    originContext: input.originContext,
    verdictId: input.verdictId,
  };
  let validation = validateConsentToken(token);
  if (!validation.ok) throw new Error(`Invalid consent token: ${validation.errors.join('; ')}`);
  return token;
}

/**
 * Evaluate a dispatch intent against board verdict, token, grants, actor lane,
 * and mutation state.
 *
 * @param {string} toolName
 * @param {Object} [options]
 * @returns {Object}
 */
export function evaluateToolIntent(toolName, options = {}) {
  let principal = normalizePrincipal(options);
  let actor = normalizeActor(options.actor, principal);
  let known = typeof toolName === 'string' && KNOWN_TOOLS.has(toolName);
  let mutates = known ? isMutatingTool(toolName) : true;
  let footprint = normalizeFootprint(options.footprint || options.scope);
  let baseRevision = options.baseRevision;
  let commandFingerprint = options.commandFingerprint || commandFingerprintFor(toolName, {
    args: options.args,
    footprint,
    baseRevision,
  });
  let intentId = options.intentId || buildIntentId(toolName, principal, toolName || 'unknown');
  let boardVerdict = normalizeVerdict(options.verdict || options.gateVerdict || options.boardVerdict);
  let common = {
    toolName,
    tool: known ? TOOL_BY_NAME.get(toolName) : undefined,
    known,
    mutates,
    actor,
    principal,
    intentId,
    footprint,
    baseRevision,
    commandFingerprint,
    verdict: boardVerdict,
    verdictId: boardVerdict.verdictId,
    grant: null,
    token: null,
    tokenMatch: null,
    grantInvalidated: false,
  };

  if (boardVerdict.status !== 'accepted') {
    return {
      ...common,
      policy: boardVerdict.status,
      needsConfirm: false,
      reason: boardVerdict.reason || `board-${boardVerdict.status}`,
      grantInvalidated: boardVerdict.status === 'blocked' || boardVerdict.status === 'rolledBack',
    };
  }

  if (!known) {
    return { ...common, policy: 'confirm', needsConfirm: true, reason: 'unknown-tool' };
  }
  if (!mutates) {
    return { ...common, policy: 'auto', needsConfirm: false, reason: 'read-only' };
  }
  if (principal.kind !== 'agent') {
    return { ...common, policy: 'auto', needsConfirm: false, reason: `${principalLane(principal)}-direct` };
  }

  if (options.consentToken) {
    let tokenMatch = consentTokenMatches(options.consentToken, {
      footprint,
      baseRevision,
      commandFingerprint,
      allowRebase: options.allowRebase,
      changedPathsSinceBase: options.changedPathsSinceBase,
      concurrentChangedPaths: options.concurrentChangedPaths,
    });
    if (tokenMatch.ok) {
      return {
        ...common,
        policy: 'auto',
        needsConfirm: false,
        reason: tokenMatch.rebased ? 'consent-token-rebased' : 'consent-token',
        token: options.consentToken,
        tokenMatch,
      };
    }
    if (tokenMatch.blocked) {
      return {
        ...common,
        policy: 'blocked',
        needsConfirm: false,
        reason: tokenMatch.reason,
        token: options.consentToken,
        tokenMatch,
      };
    }
    common.tokenMatch = tokenMatch;
  }

  let grantMatch = findMatchingGrant(options.grants, {
    toolName,
    actor,
    principal,
    footprint,
    taskId: options.taskId,
    now: options.now,
  });
  if (grantMatch.ok) {
    return {
      ...common,
      policy: 'auto',
      needsConfirm: false,
      reason: 'grant-covered',
      grant: grantMatch.grant,
    };
  }

  return {
    ...common,
    policy: 'confirm',
    needsConfirm: true,
    reason: common.tokenMatch ? common.tokenMatch.reason : 'agent-mutating',
  };
}

/**
 * Derive the simple confirm policy for a tool.
 *
 * - Unknown tools default to confirm (fail safe).
 * - Board blocked/pending/rolledBack verdicts return their verdict status.
 * - Mutating agent-lane tools confirm unless a valid grant/token covers them.
 *
 * @param {string} toolName
 * @param {Object} [options]
 * @returns {'auto'|'confirm'|'blocked'|'pendingApproval'|'rolledBack'}
 */
export function toolConfirmPolicy(toolName, options = {}) {
  return evaluateToolIntent(toolName, options).policy;
}

/**
 * Whether a tool needs an explicit confirm before the host may run it.
 *
 * @param {string} toolName
 * @param {Object} [options]
 * @returns {boolean}
 */
export function needsConfirm(toolName, options = {}) {
  return evaluateToolIntent(toolName, options).needsConfirm;
}
