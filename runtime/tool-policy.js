/**
 * Confirm-policy primitive for tool dispatch.
 *
 * A host that lets an agent call dispatch tools should auto-approve read-only
 * tools and require an explicit confirm before mutating ones. This module
 * derives that policy from the dispatch TOOLS registry — the `mutates` flag is
 * the single source of truth, so the policy is never duplicated here.
 *
 * This is the gate primitive only. The actual interception/await loop that
 * pauses an agent and waits for a confirm decision needs a live agent and is
 * out of scope; the construction chat is currently a read-only mock.
 *
 * @module symbiote-workspace/runtime/tool-policy
 */

import { isMutating, TOOLS } from './dispatch.js';

const KNOWN_TOOLS = new Set(TOOLS.map((tool) => tool.name));

function isKnownTool(toolName) {
  return typeof toolName === 'string' && KNOWN_TOOLS.has(toolName);
}

/** @typedef {'confirm'|'auto'} ToolConfirmPolicy */

/**
 * Whether a tool mutates state per the dispatch registry.
 *
 * Unknown tool names are treated as non-mutating here; the policy default for
 * unknown tools is decided in {@link toolConfirmPolicy}.
 *
 * @param {string} toolName
 * @returns {boolean}
 */
export function isMutatingTool(toolName) {
  return isMutating(toolName);
}

/**
 * Derive the confirm policy for a tool.
 *
 * - Mutating tools require an explicit confirm before running.
 * - Read-only tools are auto-approved.
 * - Unknown tools default to `confirm` (fail safe).
 *
 * @param {string} toolName
 * @returns {ToolConfirmPolicy}
 */
export function toolConfirmPolicy(toolName) {
  if (!isKnownTool(toolName)) return 'confirm';
  return isMutatingTool(toolName) ? 'confirm' : 'auto';
}

/**
 * Whether a tool needs an explicit confirm before the host may run it.
 *
 * Alias of `toolConfirmPolicy(toolName) === 'confirm'`.
 *
 * @param {string} toolName
 * @returns {boolean}
 */
export function needsConfirm(toolName) {
  return toolConfirmPolicy(toolName) === 'confirm';
}
