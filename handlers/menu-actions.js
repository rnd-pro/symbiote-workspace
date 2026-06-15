/**
 * Menu actions handler — panel dropdown menu CRUD.
 * @module symbiote-workspace/handlers/menu-actions
 */

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

/**
 * Add a menu action to a panel type.
 * @param {Object} config
 * @param {string} panelType - Panel type name
 * @param {import('../schema/workspace-schema.js').MenuAction} action
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function addMenuAction(config, panelType, action) {
  if (!config.panelTypes?.[panelType]) {
    return { config, status: 'error', hint: `Panel type "${panelType}" not found. Register it first.` };
  }
  if (!action?.id || !action?.label) {
    return { config, status: 'error', hint: 'Menu action requires id and label fields.' };
  }

  let next = cloneConfig(config);
  let pt = next.panelTypes[panelType];
  if (!pt.menuActions) pt.menuActions = [];

  if (pt.menuActions.some((a) => a.id === action.id)) {
    return { config, status: 'error', hint: `Action "${action.id}" already exists in "${panelType}".` };
  }

  pt.menuActions.push({
    id: action.id,
    label: action.label,
    ...(action.icon ? { icon: action.icon } : {}),
    ...(action.group ? { group: action.group } : {}),
    ...(action.groupLabel ? { groupLabel: action.groupLabel } : {}),
    ...(action.active !== undefined ? { active: action.active } : {}),
    ...(action.command ? { command: action.command } : {}),
    ...(action.event ? { event: action.event } : {}),
    ...(action.method ? { method: action.method } : {}),
    ...(action.binding ? { binding: action.binding } : {}),
  });

  return {
    config: next,
    status: 'ok',
    hint: `Action "${action.label}" added to panel type "${panelType}".`,
  };
}

/**
 * Remove a menu action from a panel type.
 * @param {Object} config
 * @param {string} panelType
 * @param {string} actionId
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function removeMenuAction(config, panelType, actionId) {
  if (!config.panelTypes?.[panelType]?.menuActions?.some((a) => a.id === actionId)) {
    return { config, status: 'error', hint: `Action "${actionId}" not found in "${panelType}".` };
  }

  let next = cloneConfig(config);
  next.panelTypes[panelType].menuActions = next.panelTypes[panelType].menuActions.filter((a) => a.id !== actionId);

  return {
    config: next,
    status: 'ok',
    hint: `Action "${actionId}" removed from "${panelType}".`,
  };
}

/**
 * Toggle a menu action's active state.
 * @param {Object} config
 * @param {string} panelType
 * @param {string} actionId
 * @param {boolean} [active]
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function toggleMenuAction(config, panelType, actionId, active) {
  let actions = config.panelTypes?.[panelType]?.menuActions;
  let action = actions?.find((a) => a.id === actionId);
  if (!action) {
    return { config, status: 'error', hint: `Action "${actionId}" not found in "${panelType}".` };
  }

  let next = cloneConfig(config);
  let targetAction = next.panelTypes[panelType].menuActions.find((a) => a.id === actionId);
  targetAction.active = active !== undefined ? active : !targetAction.active;

  return {
    config: next,
    status: 'ok',
    hint: `Action "${actionId}" in "${panelType}" set to active=${targetAction.active}.`,
  };
}

/**
 * List menu actions for a panel type.
 * @param {Object} config
 * @param {string} panelType
 * @returns {{ actions: import('../schema/workspace-schema.js').MenuAction[], count: number }}
 */
export function listMenuActions(config, panelType) {
  let actions = config.panelTypes?.[panelType]?.menuActions || [];
  return { actions, count: actions.length };
}
