/**
 * Layout handler — BSP tree manipulation for workspace configs.
 * Pure functions wrapping LayoutTree operations on config objects.
 *
 * @module symbiote-workspace/handlers/layout
 */

let idCounter = 0;

/**
 * Generate a unique node ID (matching LayoutTree format).
 * @returns {string}
 */
function generateId() {
  return `node_${++idCounter}_${Date.now().toString(36)}`;
}

/**
 * Deep clone a config to avoid mutation.
 * @param {Object} config
 * @returns {Object}
 */
function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

/**
 * Create a panel node in workspace config format.
 * @param {string} panelType
 * @param {Object} [panelState]
 * @param {Object} [behavior]
 * @returns {import('../schema/workspace-schema.js').WorkspaceLayoutNode}
 */
export function createPanelNode(panelType, panelState = {}, behavior = undefined) {
  let node = { type: 'panel', panelType, panelState };
  if (behavior) node.behavior = behavior;
  return node;
}

/**
 * Create a split node in workspace config format.
 * @param {'horizontal' | 'vertical'} direction
 * @param {Object} first
 * @param {Object} second
 * @param {number} [ratio]
 * @param {Object} [behavior]
 * @returns {import('../schema/workspace-schema.js').WorkspaceLayoutNode}
 */
export function createSplitNode(direction, first, second, ratio = 0.5, behavior = undefined) {
  let node = { type: 'split', direction, ratio, first, second };
  if (behavior) node.behavior = behavior;
  return node;
}

/**
 * Find a node by panelType in a layout tree (first match).
 * @param {Object} root
 * @param {string} panelType
 * @returns {Object|null}
 */
function findByPanelType(root, panelType) {
  if (!root) return null;
  if (root.type === 'panel' && root.panelType === panelType) return root;
  if (root.type === 'split') {
    return findByPanelType(root.first, panelType) || findByPanelType(root.second, panelType);
  }
  return null;
}

/**
 * Find parent of a node matching predicate.
 * @param {Object} root
 * @param {Function} predicate
 * @returns {{ parent: Object, which: 'first' | 'second' } | null}
 */
function findParent(root, predicate) {
  if (!root || root.type !== 'split') return null;
  if (predicate(root.first)) return { parent: root, which: 'first' };
  if (predicate(root.second)) return { parent: root, which: 'second' };
  return findParent(root.first, predicate) || findParent(root.second, predicate);
}

/**
 * Set the layout tree for a config.
 * @param {Object} config
 * @param {Object} layoutTree
 * @param {string} [layoutId] - If provided, sets a named layout. Otherwise sets default layout.
 * @returns {{ config: Object, status: string, next_step: string, hint: string }}
 */
export function setLayout(config, layoutTree, layoutId) {
  let next = cloneConfig(config);
  if (layoutId) {
    if (!next.layouts) next.layouts = {};
    next.layouts[layoutId] = layoutTree;
  } else {
    next.layout = layoutTree;
  }
  return {
    config: next,
    status: 'ok',
    next_step: 'register_panel_types',
    hint: layoutId
      ? `Layout "${layoutId}" set. Register panel types for each panel in the layout.`
      : 'Default layout set. Register panel types for each panel in the layout.',
  };
}

/**
 * Add a panel by splitting an existing panel.
 * @param {Object} config
 * @param {string} existingPanelType - PanelType to split
 * @param {string} newPanelType - New panel type to add
 * @param {'horizontal' | 'vertical'} [direction]
 * @param {number} [ratio]
 * @param {string} [layoutId]
 * @returns {{ config: Object, status: string, next_step: string, hint: string }}
 */
export function addPanel(config, existingPanelType, newPanelType, direction = 'horizontal', ratio = 0.5, layoutId) {
  let next = cloneConfig(config);
  let root = layoutId ? next.layouts?.[layoutId] : next.layout;

  if (!root) {
    // No layout yet — create single panel
    let panel = createPanelNode(newPanelType);
    if (layoutId) {
      if (!next.layouts) next.layouts = {};
      next.layouts[layoutId] = panel;
    } else {
      next.layout = panel;
    }
    return {
      config: next,
      status: 'ok',
      next_step: 'add_panel',
      hint: `Created layout with panel "${newPanelType}". Add more panels or register panel types.`,
    };
  }

  let target = findByPanelType(root, existingPanelType);
  if (!target) {
    return {
      config,
      status: 'error',
      next_step: 'add_panel',
      hint: `Panel type "${existingPanelType}" not found in layout. Use describe_workspace to see current layout.`,
    };
  }

  let newPanel = createPanelNode(newPanelType);
  let splitNode = createSplitNode(direction, { ...target }, newPanel, ratio);

  // Replace target in tree
  let parentInfo = findParent(root, (n) => n === target || (n.type === 'panel' && n.panelType === existingPanelType));
  if (parentInfo) {
    parentInfo.parent[parentInfo.which] = splitNode;
  } else if (root === target || (root.type === 'panel' && root.panelType === existingPanelType)) {
    if (layoutId) {
      next.layouts[layoutId] = splitNode;
    } else {
      next.layout = splitNode;
    }
  }

  return {
    config: next,
    status: 'ok',
    next_step: 'register_panel_types',
    hint: `Panel "${newPanelType}" added ${direction}ly next to "${existingPanelType}" at ratio ${ratio}.`,
  };
}

/**
 * Remove a panel from the layout (join with sibling).
 * @param {Object} config
 * @param {string} panelType - PanelType to remove
 * @param {string} [layoutId]
 * @returns {{ config: Object, status: string, next_step: string, hint: string }}
 */
export function removePanel(config, panelType, layoutId) {
  let next = cloneConfig(config);
  let root = layoutId ? next.layouts?.[layoutId] : next.layout;

  if (!root) {
    return {
      config,
      status: 'error',
      next_step: 'describe_workspace',
      hint: 'No layout found.',
    };
  }

  if (root.type === 'panel' && root.panelType === panelType) {
    return {
      config,
      status: 'error',
      next_step: 'describe_workspace',
      hint: 'Cannot remove the only panel in layout.',
    };
  }

  let parentInfo = findParent(root, (n) => n.type === 'panel' && n.panelType === panelType);
  if (!parentInfo) {
    return {
      config,
      status: 'error',
      next_step: 'describe_workspace',
      hint: `Panel type "${panelType}" not found in layout.`,
    };
  }

  let survivor = parentInfo.which === 'first'
    ? parentInfo.parent.second
    : parentInfo.parent.first;

  // Replace parent split with survivor
  let grandparentInfo = findParent(root, (n) => n === parentInfo.parent);
  if (grandparentInfo) {
    grandparentInfo.parent[grandparentInfo.which] = survivor;
  } else {
    // Parent is root
    if (layoutId) {
      next.layouts[layoutId] = survivor;
    } else {
      next.layout = survivor;
    }
  }

  return {
    config: next,
    status: 'ok',
    next_step: 'describe_workspace',
    hint: `Panel "${panelType}" removed from layout.`,
  };
}

/**
 * Resize a split by changing ratio.
 * @param {Object} config
 * @param {string} firstPanelType - Panel type in the first slot of the target split
 * @param {number} ratio - New ratio (0.05 - 0.95)
 * @param {string} [layoutId]
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function resizePanel(config, firstPanelType, ratio, layoutId) {
  let next = cloneConfig(config);
  let root = layoutId ? next.layouts?.[layoutId] : next.layout;

  let parentInfo = findParent(root, (n) => n.type === 'panel' && n.panelType === firstPanelType);
  if (!parentInfo) {
    return { config, status: 'error', hint: `Panel "${firstPanelType}" not found in a split.` };
  }

  parentInfo.parent.ratio = Math.max(0.05, Math.min(0.95, ratio));

  return {
    config: next,
    status: 'ok',
    hint: `Split containing "${firstPanelType}" resized to ratio ${ratio}.`,
  };
}

/**
 * Update root layout behavior.
 * @param {Object} config
 * @param {Object} behavior
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function updateLayoutBehavior(config, behavior) {
  let next = cloneConfig(config);
  next.rootBehavior = { ...(next.rootBehavior || {}), ...behavior };
  return {
    config: next,
    status: 'ok',
    hint: 'Root layout behavior updated.',
  };
}
