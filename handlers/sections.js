/**
 * Sections handler — sidebar sections CRUD.
 * @module symbiote-workspace/handlers/sections
 */

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

/**
 * Add a sidebar section.
 * @param {Object} config
 * @param {string} groupId - Parent group ID
 * @param {import('../schema/workspace-schema.js').SectionConfig} section
 * @returns {{ config: Object, status: string, next_step: string, hint: string }}
 */
export function addSection(config, groupId, section) {
  if (!section?.id || !section?.label) {
    return { config, status: 'error', next_step: 'add_section', hint: 'Section requires id and label fields.' };
  }

  let next = cloneConfig(config);
  if (!next.sections) next.sections = [];

  // Check for duplicate ID
  if (next.sections.some((s) => s.id === section.id)) {
    return { config, status: 'error', next_step: 'add_section', hint: `Section "${section.id}" already exists.` };
  }

  next.sections.push({
    id: section.id,
    label: section.label,
    icon: section.icon || 'dashboard',
    order: section.order ?? (next.sections.length * 100),
    groupId,
    ...(section.layoutId ? { layoutId: section.layoutId } : {}),
  });

  return {
    config: next,
    status: 'ok',
    next_step: 'set_layout',
    hint: `Section "${section.label}" added to group "${groupId}". Define its layout next.`,
  };
}

/**
 * Remove a sidebar section.
 * @param {Object} config
 * @param {string} sectionId
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function removeSection(config, sectionId) {
  if (!config.sections?.some((s) => s.id === sectionId)) {
    return { config, status: 'error', hint: `Section "${sectionId}" not found.` };
  }

  let next = cloneConfig(config);
  next.sections = next.sections.filter((s) => s.id !== sectionId);

  // Remove associated layout if named
  let section = config.sections.find((s) => s.id === sectionId);
  if (section?.layoutId && next.layouts?.[section.layoutId]) {
    delete next.layouts[section.layoutId];
  }

  return {
    config: next,
    status: 'ok',
    hint: `Section "${sectionId}" removed.`,
  };
}

/**
 * Update section properties.
 * @param {Object} config
 * @param {string} sectionId
 * @param {Partial<import('../schema/workspace-schema.js').SectionConfig>} updates
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function updateSection(config, sectionId, updates) {
  let idx = config.sections?.findIndex((s) => s.id === sectionId);
  if (idx === undefined || idx < 0) {
    return { config, status: 'error', hint: `Section "${sectionId}" not found.` };
  }

  let next = cloneConfig(config);
  next.sections[idx] = { ...next.sections[idx], ...updates };

  return {
    config: next,
    status: 'ok',
    hint: `Section "${sectionId}" updated.`,
  };
}

/**
 * Reorder sections within a group.
 * @param {Object} config
 * @param {string} groupId
 * @param {string[]} orderedIds
 * @returns {{ config: Object, status: string, hint: string }}
 */
export function reorderSections(config, groupId, orderedIds) {
  let next = cloneConfig(config);
  if (!next.sections) return { config, status: 'error', hint: 'No sections defined.' };

  for (let i = 0; i < orderedIds.length; i++) {
    let section = next.sections.find((s) => s.id === orderedIds[i] && s.groupId === groupId);
    if (section) {
      section.order = i * 100;
    }
  }

  return {
    config: next,
    status: 'ok',
    hint: `Sections in group "${groupId}" reordered.`,
  };
}

/**
 * List sections for a group.
 * @param {Object} config
 * @param {string} [groupId]
 * @returns {{ sections: import('../schema/workspace-schema.js').SectionConfig[], count: number }}
 */
export function listSections(config, groupId) {
  let sections = config.sections || [];
  if (groupId) {
    sections = sections.filter((s) => s.groupId === groupId);
  }
  sections.sort((a, b) => (a.order || 0) - (b.order || 0));
  return { sections, count: sections.length };
}
