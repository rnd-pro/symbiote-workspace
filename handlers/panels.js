/**
 * Panels handler — panel type registration and management.
 * @module symbiote-workspace/handlers/panels
 */

/**
 * Deep clone a config.
 * @param {Object} config
 * @returns {Object}
 */
function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

/**
 * Register a panel type in the workspace config.
 * @param {Object} config
 * @param {string} name - Panel type name (used in layout nodes as panelType)
 * @param {import('../schema/workspace-schema.js').PanelTypeConfig} panelConfig
 * @returns {{ config: Object, status: string, next_step: string, hint: string }}
 */
export function registerPanelType(config, name, panelConfig) {
  if (!name || typeof name !== 'string') {
    return { config, status: 'error', next_step: 'register_panel_type', hint: 'Panel type name is required.' };
  }
  if (!panelConfig?.title || !panelConfig?.component) {
    return { config, status: 'error', next_step: 'register_panel_type', hint: 'Panel type requires title and component fields.' };
  }

  let next = cloneConfig(config);
  if (!next.panelTypes) next.panelTypes = {};

  next.panelTypes[name] = {
    title: panelConfig.title,
    icon: panelConfig.icon || 'dashboard',
    component: panelConfig.component,
    ...(panelConfig.behavior ? { behavior: panelConfig.behavior } : {}),
    ...(panelConfig.menuActions?.length ? { menuActions: panelConfig.menuActions } : {}),
  };

  // Auto-add to components catalog
  if (!next.components) next.components = { catalog: [] };
  if (!next.components.catalog) next.components.catalog = [];
  if (!next.components.catalog.includes(panelConfig.component)) {
    next.components.catalog.push(panelConfig.component);
  }

  return {
    config: next,
    status: 'ok',
    next_step: 'add_menu_action',
    hint: `Panel type "${name}" registered with component <${panelConfig.component}>. Add menu actions if needed.`,
  };
}

/**
 * Update an existing panel type.
 * @param {Object} config
 * @param {string} name
 * @param {Partial<import('../schema/workspace-schema.js').PanelTypeConfig>} updates
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function updatePanelType(config, name, updates) {
  if (!config.panelTypes?.[name]) {
    return { config, status: 'error', hint: `Panel type "${name}" not found.` };
  }

  let next = cloneConfig(config);
  next.panelTypes[name] = { ...next.panelTypes[name], ...updates };

  return {
    config: next,
    status: 'ok',
    hint: `Panel type "${name}" updated.`,
  };
}

/**
 * Unregister a panel type.
 * @param {Object} config
 * @param {string} name
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function unregisterPanelType(config, name) {
  if (!config.panelTypes?.[name]) {
    return { config, status: 'error', hint: `Panel type "${name}" not found.` };
  }

  let next = cloneConfig(config);
  delete next.panelTypes[name];

  return {
    config: next,
    status: 'ok',
    hint: `Panel type "${name}" unregistered. Ensure no layout nodes reference it.`,
  };
}

/**
 * List all registered panel types.
 * @param {Object} config
 * @returns {{ panelTypes: Object, count: number }}
 */
export function listPanelTypes(config) {
  let types = config.panelTypes || {};
  return {
    panelTypes: types,
    count: Object.keys(types).length,
  };
}
