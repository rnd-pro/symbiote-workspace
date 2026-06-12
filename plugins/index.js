/**
 * symbiote-workspace/plugins — Plugin system entry point.
 *
 * Re-exports plugin schema, validation, and registry APIs.
 * Isomorphic: works in both browser and Node.
 *
 * @module symbiote-workspace/plugins
 */

export {
  PLUGIN_SCHEMA,
  PLUGIN_CATEGORIES,
  validatePluginDefinition,
} from './plugin-schema.js';

export {
  registerPlugin,
  activatePlugin,
  unregisterPlugin,
  listPlugins,
  getPlugin,
  getPluginStatus,
  clearPlugins,
  validatePlugin,
} from './plugin-registry.js';

export {
  collectPluginModuleCapabilities,
  listPluginModuleCapabilities,
  collectPluginWorkspaceTemplates,
  listPluginWorkspaceTemplates,
} from './plugin-capabilities.js';
