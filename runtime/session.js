/**
 * Stateful workspace session.
 *
 * Manages in-memory workspace config with load/save to file.
 * Shared between MCP (in-memory) and CLI (--config file).
 *
 * @module symbiote-workspace/runtime/session
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { importConfig } from '../sharing/index.js';

/**
 * @typedef {Object} Session
 * @property {import('../schema/workspace-schema.js').WorkspaceConfig|null} config
 * @property {string|null} configFilePath
 * @property {function(string): Promise<void>} load
 * @property {function(string=): Promise<void>} save
 * @property {function(): import('../schema/workspace-schema.js').WorkspaceConfig} ensure
 */

/**
 * Create a blank workspace config.
 * @returns {import('../schema/workspace-schema.js').WorkspaceConfig}
 */
function blankConfig() {
  return {
    version: '0.2.0',
    name: 'New Workspace',
    register: 'tool',
    groups: [],
    sections: [],
    panelTypes: {},
    layouts: {},
    layout: { type: 'panel', panelType: 'default' },
    events: [],
    components: { catalog: [] },
  };
}

/**
 * Create a new workspace session.
 *
 * @param {Object} [options]
 * @param {import('../schema/workspace-schema.js').WorkspaceConfig} [options.config] - Initial config
 * @param {string} [options.configFilePath] - Path to config file
 * @returns {Session}
 */
export function createSession(options = {}) {
  let session = {
    config: options.config || null,
    configFilePath: options.configFilePath || null,

    /**
     * Load config from a JSON file.
     * @param {string} filePath
     */
    async load(filePath) {
      let absPath = resolve(filePath);
      let json = await readFile(absPath, 'utf-8');
      let result = importConfig(json);
      if (!result.config) {
        let details = result.errors
          .map((error) => error.path ? `${error.path}: ${error.message}` : error.message)
          .join('; ');
        throw new Error(`Load failed: file does not contain a portable workspace config. ${details}`);
      }
      session.config = result.config;
      session.configFilePath = absPath;
    },

    /**
     * Save config to a JSON file.
     * @param {string} [filePath] - Override path (defaults to loaded path)
     */
    async save(filePath) {
      let absPath = resolve(filePath || session.configFilePath);
      if (!absPath) {
        throw new Error('No file path specified for save. Use --config or provide a path.');
      }
      await writeFile(absPath, JSON.stringify(session.config, null, 2));
      session.configFilePath = absPath;
    },

    /**
     * Ensure a config exists (create blank if null).
     * @returns {import('../schema/workspace-schema.js').WorkspaceConfig}
     */
    ensure() {
      if (!session.config) {
        session.config = blankConfig();
      }
      return session.config;
    },
  };

  return session;
}
