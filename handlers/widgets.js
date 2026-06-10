/**
 * Widgets handler — component mounting in panels.
 * @module symbiote-workspace/handlers/widgets
 */

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

/**
 * Find a panel node by panelType in a layout tree.
 * @param {Object} node
 * @param {string} panelType
 * @returns {Object|null}
 */
function findPanel(node, panelType) {
  if (!node) return null;
  if (node.type === 'panel' && node.panelType === panelType) return node;
  if (node.type === 'split') {
    return findPanel(node.first, panelType) || findPanel(node.second, panelType);
  }
  return null;
}

/**
 * Mount a component into a panel by updating its panelType's component.
 * @param {Object} config
 * @param {string} panelType - Panel type to mount into
 * @param {string} componentTag - Custom element tag name
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function mountWidget(config, panelType, componentTag) {
  if (!panelType || !componentTag) {
    return { config, status: 'error', hint: 'Both panelType and componentTag are required.' };
  }

  let next = cloneConfig(config);
  if (!next.panelTypes) next.panelTypes = {};

  if (next.panelTypes[panelType]) {
    next.panelTypes[panelType].component = componentTag;
  } else {
    // Auto-register minimal panelType
    next.panelTypes[panelType] = {
      title: panelType,
      icon: 'dashboard',
      component: componentTag,
    };
  }

  // Auto-add to catalog
  if (!next.components) next.components = { catalog: [] };
  if (!next.components.catalog) next.components.catalog = [];
  if (!next.components.catalog.includes(componentTag)) {
    next.components.catalog.push(componentTag);
  }

  return {
    config: next,
    status: 'ok',
    hint: `Component <${componentTag}> mounted in panel type "${panelType}".`,
  };
}

/**
 * Unmount component from a panel type (set to empty placeholder).
 * @param {Object} config
 * @param {string} panelType
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function unmountWidget(config, panelType) {
  if (!config.panelTypes?.[panelType]) {
    return { config, status: 'error', hint: `Panel type "${panelType}" not found.` };
  }

  let next = cloneConfig(config);
  next.panelTypes[panelType].component = 'sn-empty-state';

  return {
    config: next,
    status: 'ok',
    hint: `Panel type "${panelType}" unmounted. Set to empty state.`,
  };
}

/**
 * Swap component in a panel type.
 * @param {Object} config
 * @param {string} panelType
 * @param {string} newComponentTag
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function swapWidget(config, panelType, newComponentTag) {
  if (!config.panelTypes?.[panelType]) {
    return { config, status: 'error', hint: `Panel type "${panelType}" not found.` };
  }

  let next = cloneConfig(config);
  let oldComponent = next.panelTypes[panelType].component;
  next.panelTypes[panelType].component = newComponentTag;

  // Auto-add to catalog
  if (!next.components) next.components = { catalog: [] };
  if (!next.components.catalog) next.components.catalog = [];
  if (!next.components.catalog.includes(newComponentTag)) {
    next.components.catalog.push(newComponentTag);
  }

  return {
    config: next,
    status: 'ok',
    hint: `Swapped <${oldComponent}> → <${newComponentTag}> in panel type "${panelType}".`,
  };
}
