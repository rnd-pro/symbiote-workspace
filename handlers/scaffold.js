/**
 * Scaffold handler — creates workspace configs from templates or scratch.
 * @module symbiote-workspace/handlers/scaffold
 */

import { WORKSPACE_SCHEMA_VERSION } from '../schema/workspace-schema.js';

/**
 * Create a workspace config from a template.
 * @param {string} templateName
 * @param {Object} [options]
 * @param {string} [options.name]
 * @param {string} [options.register]
 * @returns {{ config: import('../schema/workspace-schema.js').WorkspaceConfig, status: string, next_step: string, hint: string }}
 */
export function scaffoldWorkspace(templateName, options = {}) {
  let { planWorkspace, matchTemplate, getTemplate } = /** @type {any} */ ({});
  try {
    // Dynamic import at call time to avoid circular deps
    let mod = require('../constructor/workspace-planner.js');
    planWorkspace = mod.planWorkspace;
    matchTemplate = mod.matchTemplate;
    getTemplate = mod.getTemplate;
  } catch {
    return {
      config: scaffoldFromScratch(options),
      status: 'ok',
      next_step: 'add_groups',
      hint: 'Template system not available. Created blank workspace. Add groups and sections next.',
    };
  }

  let config = planWorkspace(templateName, options);
  config.version = WORKSPACE_SCHEMA_VERSION;

  return {
    config,
    status: 'ok',
    next_step: 'register_panel_types',
    hint: `Workspace "${config.name}" scaffolded from template. Register panel types next.`,
  };
}

/**
 * Create a blank workspace config from scratch.
 * @param {Object} [options]
 * @param {string} [options.name]
 * @param {string} [options.register]
 * @returns {import('../schema/workspace-schema.js').WorkspaceConfig}
 */
export function scaffoldFromScratch(options = {}) {
  return {
    version: WORKSPACE_SCHEMA_VERSION,
    name: options.name || 'New Workspace',
    register: options.register || 'tool',
    groups: [],
    sections: [],
    panelTypes: {},
    layouts: {},
    layout: { type: 'panel', panelType: 'default' },
    events: [],
    components: { catalog: [] },
  };
}
