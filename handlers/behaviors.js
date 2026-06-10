/**
 * Behaviors handler — layout behavior management.
 * @module symbiote-workspace/handlers/behaviors
 */

import {
  COLLAPSE_POLICIES,
  OVERFLOW_POLICIES,
  RESPONSIVE_MODES,
  MOBILE_DOCKS,
  SWIPE_CONTROLS,
} from '../schema/workspace-schema.js';

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

/**
 * Validate behavior enum values.
 * @param {Object} behavior
 * @returns {string[]} - Array of error messages (empty if valid)
 */
function validateBehaviorEnums(behavior) {
  let errors = [];
  if (behavior.collapse && !COLLAPSE_POLICIES.includes(behavior.collapse)) {
    errors.push(`Invalid collapse policy "${behavior.collapse}". Valid: ${COLLAPSE_POLICIES.join(', ')}`);
  }
  if (behavior.overflow && !OVERFLOW_POLICIES.includes(behavior.overflow)) {
    errors.push(`Invalid overflow policy "${behavior.overflow}". Valid: ${OVERFLOW_POLICIES.join(', ')}`);
  }
  if (behavior.responsiveMode && !RESPONSIVE_MODES.includes(behavior.responsiveMode)) {
    errors.push(`Invalid responsiveMode "${behavior.responsiveMode}". Valid: ${RESPONSIVE_MODES.join(', ')}`);
  }
  if (behavior.mobileDock && !MOBILE_DOCKS.includes(behavior.mobileDock)) {
    errors.push(`Invalid mobileDock "${behavior.mobileDock}". Valid: ${MOBILE_DOCKS.join(', ')}`);
  }
  if (behavior.swipeControl && !SWIPE_CONTROLS.includes(behavior.swipeControl)) {
    errors.push(`Invalid swipeControl "${behavior.swipeControl}". Valid: ${SWIPE_CONTROLS.join(', ')}`);
  }
  return errors;
}

/**
 * Set behavior on a panel type or root.
 * @param {Object} config
 * @param {string} target - 'root' or a panelType name
 * @param {import('../schema/workspace-schema.js').LayoutBehavior} behavior
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function setBehavior(config, target, behavior) {
  let errors = validateBehaviorEnums(behavior);
  if (errors.length) {
    return { config, status: 'error', hint: errors.join('; ') };
  }

  let next = cloneConfig(config);

  if (target === 'root') {
    next.rootBehavior = behavior;
    return {
      config: next,
      status: 'ok',
      hint: 'Root layout behavior set.',
    };
  }

  if (!next.panelTypes?.[target]) {
    return { config, status: 'error', hint: `Panel type "${target}" not found.` };
  }

  next.panelTypes[target].behavior = behavior;
  return {
    config: next,
    status: 'ok',
    hint: `Behavior set for panel type "${target}".`,
  };
}

/**
 * Get behavior for a panel type or root.
 * @param {Object} config
 * @param {string} target
 * @returns {{ behavior: import('../schema/workspace-schema.js').LayoutBehavior | null }}
 */
export function getBehavior(config, target) {
  if (target === 'root') {
    return { behavior: config.rootBehavior || null };
  }
  return { behavior: config.panelTypes?.[target]?.behavior || null };
}

/**
 * Partially update behavior (merge).
 * @param {Object} config
 * @param {string} target
 * @param {Partial<import('../schema/workspace-schema.js').LayoutBehavior>} partialUpdate
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function updateBehavior(config, target, partialUpdate) {
  let errors = validateBehaviorEnums(partialUpdate);
  if (errors.length) {
    return { config, status: 'error', hint: errors.join('; ') };
  }

  let next = cloneConfig(config);

  if (target === 'root') {
    next.rootBehavior = { ...(next.rootBehavior || {}), ...partialUpdate };
    return { config: next, status: 'ok', hint: 'Root behavior updated.' };
  }

  if (!next.panelTypes?.[target]) {
    return { config, status: 'error', hint: `Panel type "${target}" not found.` };
  }

  next.panelTypes[target].behavior = { ...(next.panelTypes[target].behavior || {}), ...partialUpdate };
  return {
    config: next,
    status: 'ok',
    hint: `Behavior for "${target}" updated.`,
  };
}
