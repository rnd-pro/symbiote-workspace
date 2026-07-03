import {
  registerSection,
  clearRegisteredSections,
  getRegisteredSections,
  validateWorkspaceConfig,
  isCompatibleVersion,
} from '../validation/core.js';
import { WORKSPACE_SCHEMA_VERSION } from './value-classes.js';

export {
  WORKSPACE_SCHEMA_VERSION,
  validateWorkspaceConfig,
  isCompatibleVersion,
};

/**
 * Target-schema section modules. Each W1 slice (structure, modules, wiring, data,
 * routes, behavior, server, state) exports a section registration
 * `{ id, validate, refProviders, refConsumers }` and is appended here. The keystone
 * ships with zero sections: the validator core is pluggable and validates the empty
 * envelope cleanly, so section slices can be added without changing the core.
 *
 * @type {ReadonlyArray<import('../validation/core.js').ValidationSection>}
 */
export const WORKSPACE_SECTION_MODULES = Object.freeze([]);

/**
 * Registers every known section module into the validator core, replacing any
 * previously registered set. Returns the assembled schema descriptor.
 *
 * @returns {{ version: string, sections: string[] }}
 */
export function assembleWorkspaceSchema() {
  clearRegisteredSections();
  for (let section of WORKSPACE_SECTION_MODULES) {
    registerSection(section);
  }
  return getWorkspaceSchema();
}

/**
 * Returns the assembled schema descriptor for the currently registered sections.
 *
 * @returns {{ version: string, sections: string[] }}
 */
export function getWorkspaceSchema() {
  return {
    version: WORKSPACE_SCHEMA_VERSION,
    sections: getRegisteredSections().map((section) => section.id),
  };
}

/**
 * @typedef {Object} WorkspaceConfig
 * @property {string} version - Target schema version of the workspace config.
 * @property {string} name - Human-readable workspace name.
 */
