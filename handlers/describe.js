/**
 * describe handler — reads workspace config and returns full structure.
 * Used by agents to understand current state before editing.
 *
 * @module symbiote-workspace/handlers/describe
 */

/**
 * Describe the current workspace configuration.
 *
 * Returns a structured representation of the workspace including
 * groups, sections, layouts, panelTypes, menuActions, and behaviors.
 *
 * @param {import('../schema/workspace-schema.js').WorkspaceConfig} config
 * @returns {{ name: string, version: string, groups: Array, panelTypes: Array, theme: Object, components: Object }}
 */
export function describeWorkspace(config) {
  if (!config) {
    return { error: 'No workspace config provided' };
  }

  let result = {
    name: config.name || '(unnamed)',
    version: config.version || '0.1.0',
    register: config.register || 'tool',
    theme: config.theme || null,
    components: config.components || { catalog: [] },
    layout: describeLayout(config.layout),
    groups: config.groups || [],
    sections: config.sections || [],
    panelTypes: config.panelTypes || {},
    events: config.events || [],
    rootBehavior: config.rootBehavior || null,
  };

  // Named layouts
  if (config.layouts && Object.keys(config.layouts).length > 0) {
    result.layouts = {};
    for (let [id, layout] of Object.entries(config.layouts)) {
      result.layouts[id] = describeLayout(layout);
    }
  }

  // Engine packs
  if (config.engine) {
    result.engine = config.engine;
  }

  return result;
}

/**
 * Recursively describe a layout node.
 * @param {Object} node
 * @param {number} [depth=0]
 * @returns {Object}
 */
function describeLayout(node, depth = 0) {
  if (!node) return null;

  if (node.type === 'panel') {
    return {
      type: 'panel',
      panelType: node.panelType || null,
      depth,
    };
  }

  if (node.type === 'split') {
    let result = {
      type: 'split',
      direction: node.direction,
      ratio: node.ratio,
      depth,
      behavior: node.behavior || null,
    };
    // BSP format
    if (node.first || node.second) {
      result.first = describeLayout(node.first, depth + 1);
      result.second = describeLayout(node.second, depth + 1);
    }
    // Legacy children[] fallback
    if (Array.isArray(node.children)) {
      result.children = node.children.map((child) => describeLayout(child, depth + 1));
    }
    return result;
  }

  // Legacy 'single' type fallback
  if (node.type === 'single') {
    return {
      type: 'panel',
      component: node.component,
      panelType: node.panelType || null,
      depth,
    };
  }

  return { type: 'unknown', raw: node };
}

/**
 * List all components used in a workspace config.
 * @param {import('../schema/workspace-schema.js').WorkspaceConfig} config
 * @returns {{ components: string[], count: number }}
 */
export function listUsedComponents(config) {
  let components = new Set();

  // From layout tree
  collectLayoutComponents(config?.layout, components);

  // From panelTypes
  if (config?.panelTypes) {
    for (let pt of Object.values(config.panelTypes)) {
      if (pt.component) components.add(pt.component);
    }
  }

  // From catalog
  if (Array.isArray(config?.components?.catalog)) {
    for (let tag of config.components.catalog) {
      components.add(tag);
    }
  }

  let sorted = [...components].sort();
  return { components: sorted, count: sorted.length };
}

/**
 * @param {Object} node
 * @param {Set<string>} components
 */
function collectLayoutComponents(node, components) {
  if (!node) return;
  if (node.component) components.add(node.component);
  // BSP format
  if (node.first) collectLayoutComponents(node.first, components);
  if (node.second) collectLayoutComponents(node.second, components);
  // Legacy children[]
  if (Array.isArray(node.children)) {
    for (let child of node.children) {
      collectLayoutComponents(child, components);
    }
  }
}

