/**
 * Events handler — inter-panel event bridge configuration.
 * @module symbiote-workspace/handlers/events
 */

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

/**
 * Derive next bridge counter from existing events in config.
 * @param {Object} config
 * @returns {number}
 */
function nextBridgeId(config) {
  let max = 0;
  if (Array.isArray(config.events)) {
    for (let e of config.events) {
      let m = e.id?.match(/^bridge_(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return max + 1;
}

/**
 * Create an event bridge between panels.
 * @param {Object} config
 * @param {import('../schema/workspace-schema.js').EventBridge} bridge
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function bridgeEvent(config, bridge) {
  if (!bridge?.sourcePanel || !bridge?.event) {
    return { config, status: 'error', hint: 'Event bridge requires sourcePanel and event fields.' };
  }

  let next = cloneConfig(config);
  if (!next.events) next.events = [];

  let id = bridge.id || `bridge_${nextBridgeId(next)}`;

  next.events.push({
    id,
    sourcePanel: bridge.sourcePanel,
    event: bridge.event,
    ...(bridge.targetPanel ? { targetPanel: bridge.targetPanel } : {}),
    ...(bridge.targetMethod ? { targetMethod: bridge.targetMethod } : {}),
    ...(bridge.targetProperty ? { targetProperty: bridge.targetProperty } : {}),
    ...(bridge.mapping ? { mapping: bridge.mapping } : {}),
  });

  return {
    config: next,
    status: 'ok',
    hint: `Event bridge "${id}" created: ${bridge.sourcePanel}.${bridge.event} → ${bridge.targetPanel || '(broadcast)'}.`,
  };
}

/**
 * Remove an event bridge.
 * @param {Object} config
 * @param {string} bridgeId
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function unbridgeEvent(config, bridgeId) {
  if (!config.events?.some((e) => e.id === bridgeId)) {
    return { config, status: 'error', hint: `Event bridge "${bridgeId}" not found.` };
  }

  let next = cloneConfig(config);
  next.events = next.events.filter((e) => e.id !== bridgeId);

  return {
    config: next,
    status: 'ok',
    hint: `Event bridge "${bridgeId}" removed.`,
  };
}

/**
 * List all event bridges.
 * @param {Object} config
 * @returns {{ bridges: import('../schema/workspace-schema.js').EventBridge[], count: number }}
 */
export function listBridges(config) {
  let bridges = config.events || [];
  return { bridges, count: bridges.length };
}
