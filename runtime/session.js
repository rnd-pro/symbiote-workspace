/**
 * Stateful workspace session.
 *
 * Carries in-memory config plus the revision/principal context dispatch needs
 * for actor-tagged mutation results.
 *
 * @module symbiote-workspace/runtime/session
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { importConfig } from '../sharing/index.js';

/**
 * @typedef {Object} Session
 * @property {import('../schema/workspace-schema.js').WorkspaceConfig|null} config
 * @property {string|null} configFilePath
 * @property {number} revision
 * @property {{kind: string, id: string}} principal
 * @property {string} actor
 * @property {string} sessionId
 * @property {function(string): Promise<void>} load
 * @property {function(string=): Promise<void>} save
 * @property {function(): import('../schema/workspace-schema.js').WorkspaceConfig} ensure
 * @property {function(Object): {revision: number, origin: Object}} commitMutation
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

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * Create a new workspace session.
 *
 * @param {Object} [options]
 * @param {import('../schema/workspace-schema.js').WorkspaceConfig} [options.config]
 * @param {string} [options.configFilePath]
 * @param {number} [options.revision]
 * @param {{kind: string, id: string}} [options.principal]
 * @param {string} [options.actor]
 * @param {string} [options.sessionId]
 * @returns {Session}
 */
export function createSession(options = {}) {
  let session = {
    config: options.config || null,
    configFilePath: options.configFilePath || null,
    revision: Number.isInteger(options.revision) ? options.revision : 0,
    principal: options.principal || { kind: 'agent', id: 'dispatch' },
    actor: options.actor || 'agent-gated',
    sessionId: options.sessionId || randomUUID(),

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
      session.revision = 0;
    },

    async save(filePath) {
      let target = filePath || session.configFilePath;
      if (!target) throw new Error('No file path specified for save. Use --config or provide a path.');
      let absPath = resolve(target);
      await writeFile(absPath, JSON.stringify(session.config, null, 2));
      session.configFilePath = absPath;
    },

    ensure() {
      if (!session.config) session.config = blankConfig();
      return session.config;
    },

    commitMutation({ toolName, actor, baseRevision, reason } = {}) {
      session.revision += 1;
      return {
        revision: session.revision,
        origin: {
          principal: cloneJson(session.principal),
          actor: actor || session.actor,
          reason: reason || (toolName ? `tool:${toolName}` : 'tool'),
          sessionId: session.sessionId,
          baseRevision,
        },
      };
    },
  };

  return session;
}
