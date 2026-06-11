/**
 * Plugin Schema — contract definition for symbiote-workspace plugins.
 *
 * A plugin is a package that registers handlers (engine), components (UI),
 * and/or workspace extensions (templates, config schemas) into the platform.
 *
 * Existing engine packs (`.handler.js` files) are a subset of this format —
 * a pack is a plugin with `handlers` only.
 *
 * @module symbiote-workspace/plugins/plugin-schema
 */

import {
  MODULE_CAPABILITY_DESCRIPTOR_SCHEMA,
  validateModuleCapabilityDescriptor,
  validatePortableStringArray,
} from '../schema/module-capability.js';

export const PLUGIN_CATEGORIES = Object.freeze([
  'handler',
  'provider',
  'component',
  'theme',
  'integration',
]);

/**
 * @typedef {Object} PluginHandler
 * @property {string} type - Handler type identifier (e.g. 'ai/tts', 'tunnel/start')
 * @property {string} [category] - Handler category (defaults to type prefix before '/')
 * @property {string} [icon] - Material icon name
 * @property {Object} [driver] - Driver definition: inputs, outputs, params
 * @property {Object} [lifecycle] - Lifecycle hooks: validate, cacheKey, execute, postProcess
 */

/**
 * @typedef {Object} PluginWorkspace
 * @property {Object} [configSchema] - JSON Schema for plugin-specific parameters
 * @property {Array<import('../schema/workspace-schema.js').WorkspaceConfig>} [templates] - Additional workspace templates
 */

/**
 * @typedef {Object} PluginDefinition
 * @property {string} name - Unique plugin name (e.g. '@symbiote/tunnel-cloudflare')
 * @property {string} version - Semver version string
 * @property {string} [description] - Human-readable description
 * @property {string} [category] - Plugin category from PLUGIN_CATEGORIES
 * @property {PluginHandler[]} [handlers] - Engine handler definitions
 * @property {(string|import('../schema/workspace-schema.js').ModuleCapabilityDescriptor)[]} [components] - UI component tags or descriptors
 * @property {string[]} [capabilities] - Plugin-level portable capability tags
 * @property {string[]} [requiredHostServices] - Portable host service IDs
 * @property {PluginWorkspace} [workspace] - Workspace integration config
 * @property {function} [activate] - Called when plugin is loaded, receives context
 * @property {function} [deactivate] - Called when plugin is unloaded
 */

export const PLUGIN_SCHEMA = Object.freeze({
  type: 'object',
  required: ['name', 'version'],
  properties: {
    name: {
      type: 'string',
      description: 'Unique plugin identifier.',
    },
    version: {
      type: 'string',
      description: 'Semver version.',
    },
    description: {
      type: 'string',
    },
    category: {
      type: 'string',
      enum: PLUGIN_CATEGORIES,
      description: 'Plugin category for grouping and discovery.',
    },
    handlers: {
      type: 'array',
      description: 'Engine handler definitions. Registered via symbiote-engine Registry.',
      items: {
        type: 'object',
        required: ['type'],
        properties: {
          type: { type: 'string' },
          category: { type: 'string' },
          icon: { type: 'string' },
          driver: { type: 'object' },
          lifecycle: { type: 'object' },
        },
      },
    },
    components: {
      type: 'array',
      description: 'UI component tag names or module capability descriptors provided by this plugin.',
      items: {
        oneOf: [
          { type: 'string' },
          MODULE_CAPABILITY_DESCRIPTOR_SCHEMA,
        ],
      },
    },
    capabilities: {
      type: 'array',
      description: 'Portable plugin capability tags.',
      items: { type: 'string' },
    },
    requiredHostServices: {
      type: 'array',
      description: 'Portable host service IDs required by this plugin; never credentials or endpoints.',
      items: { type: 'string' },
    },
    workspace: {
      type: 'object',
      description: 'Workspace integration: config schema and templates.',
      properties: {
        configSchema: { type: 'object' },
        templates: { type: 'array' },
      },
    },
    activate: {
      description: 'Lifecycle hook called when plugin loads. Receives { server?, graph?, registry? }.',
    },
    deactivate: {
      description: 'Lifecycle hook called when plugin unloads.',
    },
  },
});

/**
 * Validate a plugin definition against the schema.
 *
 * @param {any} plugin - Plugin object to validate
 * @returns {{ valid: boolean, errors: Array<{ path: string, message: string }> }}
 */
export function validatePluginDefinition(plugin) {
  let errors = [];

  if (!plugin || typeof plugin !== 'object') {
    errors.push({ path: '', message: 'Plugin must be a non-null object.' });
    return { valid: false, errors };
  }

  if (typeof plugin.name !== 'string' || !plugin.name.trim()) {
    errors.push({ path: 'name', message: 'Plugin name is required and must be a non-empty string.' });
  }

  if (typeof plugin.version !== 'string' || !plugin.version.trim()) {
    errors.push({ path: 'version', message: 'Plugin version is required and must be a non-empty string.' });
  }

  if (plugin.category !== undefined && !PLUGIN_CATEGORIES.includes(plugin.category)) {
    errors.push({
      path: 'category',
      message: `Invalid category "${plugin.category}". Must be one of: ${PLUGIN_CATEGORIES.join(', ')}.`,
    });
  }

  if (plugin.handlers !== undefined) {
    if (!Array.isArray(plugin.handlers)) {
      errors.push({ path: 'handlers', message: 'handlers must be an array.' });
    } else {
      for (let i = 0; i < plugin.handlers.length; i++) {
        let handler = plugin.handlers[i];
        if (!handler || typeof handler !== 'object') {
          errors.push({ path: `handlers[${i}]`, message: 'Handler must be an object.' });
        } else if (typeof handler.type !== 'string' || !handler.type.trim()) {
          errors.push({ path: `handlers[${i}].type`, message: 'Handler type is required.' });
        }
      }
    }
  }

  if (plugin.capabilities !== undefined) {
    validatePortableStringArray(plugin.capabilities, 'capabilities', errors, { severity: false });
  }

  if (plugin.requiredHostServices !== undefined) {
    validatePortableStringArray(plugin.requiredHostServices, 'requiredHostServices', errors, { severity: false });
  }

  if (plugin.components !== undefined) {
    if (!Array.isArray(plugin.components)) {
      errors.push({ path: 'components', message: 'components must be an array of strings or module descriptors.' });
    } else {
      for (let i = 0; i < plugin.components.length; i++) {
        let component = plugin.components[i];
        if (typeof component === 'string') continue;
        if (component && typeof component === 'object') {
          validateModuleCapabilityDescriptor(component, `components[${i}]`, errors, { severity: false });
        } else {
          errors.push({ path: `components[${i}]`, message: 'Component entry must be a string or module descriptor.' });
        }
      }
    }
  }

  if (plugin.workspace !== undefined && (typeof plugin.workspace !== 'object' || plugin.workspace === null)) {
    errors.push({ path: 'workspace', message: 'workspace must be an object.' });
  }

  if (plugin.activate !== undefined && typeof plugin.activate !== 'function') {
    errors.push({ path: 'activate', message: 'activate must be a function.' });
  }

  if (plugin.deactivate !== undefined && typeof plugin.deactivate !== 'function') {
    errors.push({ path: 'deactivate', message: 'deactivate must be a function.' });
  }

  return { valid: errors.length === 0, errors };
}
