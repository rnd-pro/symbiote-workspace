import {
  registerSection,
  clearRegisteredSections,
  getRegisteredSections,
  validateWorkspaceConfig,
  isCompatibleVersion,
} from '../validation/core.js';
import { WORKSPACE_SCHEMA_VERSION } from './value-classes.js';
import {
  COLLAPSE_POLICIES,
  MOBILE_DOCKS,
  OVERFLOW_POLICIES,
  RESPONSIVE_MODES,
  SWIPE_CONTROLS,
} from './constants.js';
import { structureSection } from './sections/structure.js';
import { modulesSection } from './sections/modules.js';
import { wiringSection } from './sections/wiring.js';
import { dataSection } from './sections/data.js';
import { routesSection } from './sections/routes.js';
import { behaviorSection } from './sections/behavior.js';
import { serverSection } from './sections/server.js';
import { stateSection } from './sections/state.js';

export {
  WORKSPACE_SCHEMA_VERSION,
  validateWorkspaceConfig,
  isCompatibleVersion,
};

export const WORKSPACE_REGISTER_VALUES = Object.freeze([
  'tool',
  'admin',
  'editor',
  'agent-workspace',
  'media-studio',
  'brand',
  'presentation',
]);

export const EXECUTION_MODELS = Object.freeze([
  'ui-only',
  'graph-execution',
  'server-session',
  'remote-provider',
  'mobile-executor',
  'automation-bridge',
]);

export const HOST_SERVICE_CATEGORIES = Object.freeze([
  'agent.runtime',
  'ai.provider',
  'clipboard',
  'file.system',
  'media.realtime',
  'network.fetch',
  'notifications',
  'presence.session',
  'selection',
  'storage.archive',
  'storage.project',
]);

export const DATA_BINDING_DIRECTIONS = Object.freeze(['input', 'output', 'two-way']);

const VALIDATION_REPORT_SCHEMA = Object.freeze({
  type: 'object',
  required: Object.freeze(['id', 'check', 'status', 'severity', 'message']),
  properties: Object.freeze({
    id: Object.freeze({ type: 'string' }),
    check: Object.freeze({ type: 'string' }),
    status: Object.freeze({ type: 'string', enum: Object.freeze(['pass', 'warn', 'blocked']) }),
    severity: Object.freeze({ type: 'string', enum: Object.freeze(['info', 'warning', 'error']) }),
    message: Object.freeze({ type: 'string' }),
  }),
});

/**
 * Target-schema section modules. Each W1 slice (structure, modules, wiring, data,
 * routes, behavior, server, state) exports a section registration
 * `{ id, validate, refProviders, refConsumers }` and is appended here. The keystone
 * ships the registry seam; CG-INT-1 wires all W1 sections here.
 *
 * @type {ReadonlyArray<import('../validation/core.js').ValidationSection>}
 */
export const WORKSPACE_SECTION_MODULES = Object.freeze([
  structureSection,
  modulesSection,
  wiringSection,
  dataSection,
  routesSection,
  behaviorSection,
  serverSection,
  stateSection,
]);

export const WORKSPACE_CONFIG_SCHEMA = Object.freeze({
  type: 'object',
  schemaVersion: WORKSPACE_SCHEMA_VERSION,
  description: 'Target symbiote-workspace config schema descriptor. Strict validation is performed by validateWorkspaceConfig().',
  properties: Object.freeze({
    version: Object.freeze({ type: 'string' }),
    name: Object.freeze({ type: 'string' }),
    register: Object.freeze({ type: 'string' }),
    views: Object.freeze({ type: 'array' }),
    layouts: Object.freeze({ type: 'object' }),
    panels: Object.freeze({ type: 'object' }),
    modules: Object.freeze({ type: 'array' }),
    requires: Object.freeze({ type: 'object' }),
    wires: Object.freeze({ type: 'array' }),
    data: Object.freeze({ type: 'object' }),
    state: Object.freeze({ type: 'object' }),
    routes: Object.freeze({ type: 'array' }),
    redirects: Object.freeze({ type: 'array' }),
    behavior: Object.freeze({ type: 'object' }),
    server: Object.freeze({ type: 'object' }),
    validation: Object.freeze({ type: 'object' }),
  }),
  $defs: Object.freeze({
    validationReport: VALIDATION_REPORT_SCHEMA,
  }),
});

export {
  COLLAPSE_POLICIES,
  MOBILE_DOCKS,
  OVERFLOW_POLICIES,
  RESPONSIVE_MODES,
  SWIPE_CONTROLS,
};

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
