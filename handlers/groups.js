/**
 * Groups handler — project groups (tabs) CRUD.
 * @module symbiote-workspace/handlers/groups
 */

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

/**
 * Add a project group (tab).
 * @param {Object} config
 * @param {import('../schema/workspace-schema.js').GroupConfig} group
 * @returns {{ config: Object, status: string, next_step: string, hint: string }}
 */
export function addGroup(config, group) {
  if (!group?.id || !group?.name) {
    return { config, status: 'error', next_step: 'add_group', hint: 'Group requires id and name fields.' };
  }

  let next = cloneConfig(config);
  if (!next.groups) next.groups = [];

  if (next.groups.some((g) => g.id === group.id)) {
    return { config, status: 'error', next_step: 'add_group', hint: `Group "${group.id}" already exists.` };
  }

  next.groups.push({
    id: group.id,
    name: group.name,
    icon: group.icon || 'folder',
    ...(group.color ? { color: group.color } : {}),
    ...(group.closeable !== undefined ? { closeable: group.closeable } : {}),
    ...(group.sidebarLabel ? { sidebarLabel: group.sidebarLabel } : {}),
    ...(group.sidebarIcon ? { sidebarIcon: group.sidebarIcon } : {}),
  });

  return {
    config: next,
    status: 'ok',
    next_step: 'add_section',
    hint: `Group "${group.name}" added. Add sections to this group next.`,
  };
}

/**
 * Remove a project group and its sections.
 * @param {Object} config
 * @param {string} groupId
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function removeGroup(config, groupId) {
  if (!config.groups?.some((g) => g.id === groupId)) {
    return { config, status: 'error', hint: `Group "${groupId}" not found.` };
  }

  let next = cloneConfig(config);
  next.groups = next.groups.filter((g) => g.id !== groupId);

  // Remove associated sections and their layouts
  if (next.sections) {
    let removedSections = next.sections.filter((s) => s.groupId === groupId);
    for (let section of removedSections) {
      if (section.layoutId && next.layouts?.[section.layoutId]) {
        delete next.layouts[section.layoutId];
      }
    }
    next.sections = next.sections.filter((s) => s.groupId !== groupId);
  }

  return {
    config: next,
    status: 'ok',
    hint: `Group "${groupId}" and its sections removed.`,
  };
}

/**
 * Update group properties.
 * @param {Object} config
 * @param {string} groupId
 * @param {Partial<import('../schema/workspace-schema.js').GroupConfig>} updates
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function updateGroup(config, groupId, updates) {
  let idx = config.groups?.findIndex((g) => g.id === groupId);
  if (idx === undefined || idx < 0) {
    return { config, status: 'error', hint: `Group "${groupId}" not found.` };
  }

  let next = cloneConfig(config);
  next.groups[idx] = { ...next.groups[idx], ...updates };

  return {
    config: next,
    status: 'ok',
    hint: `Group "${groupId}" updated.`,
  };
}

/**
 * Reorder groups.
 * @param {Object} config
 * @param {string[]} orderedIds
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function reorderGroups(config, orderedIds) {
  let next = cloneConfig(config);
  if (!next.groups?.length) {
    return { config, status: 'error', hint: 'No groups defined.' };
  }

  let groupMap = new Map(next.groups.map((g) => [g.id, g]));
  let reordered = [];
  for (let id of orderedIds) {
    let group = groupMap.get(id);
    if (group) {
      reordered.push(group);
      groupMap.delete(id);
    }
  }
  // Append any remaining groups not in orderedIds
  for (let group of groupMap.values()) {
    reordered.push(group);
  }
  next.groups = reordered;

  return {
    config: next,
    status: 'ok',
    hint: 'Groups reordered.',
  };
}

/**
 * List all groups.
 * @param {Object} config
 * @returns {{ groups: import('../schema/workspace-schema.js').GroupConfig[], count: number }}
 */
export function listGroups(config) {
  let groups = config.groups || [];
  return { groups, count: groups.length };
}
