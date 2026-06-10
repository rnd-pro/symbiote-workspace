/**
 * Plugin Registry — in-memory registry for loaded plugins.
 *
 * Isomorphic: works in both browser and Node environments.
 * Server mode uses this to track loaded plugins.
 * Browser mode can use this for client-side plugin discovery.
 *
 * @module symbiote-workspace/plugins/plugin-registry
 */

import { validatePluginDefinition } from './plugin-schema.js';

/**
 * @typedef {'pending' | 'active' | 'error' | 'deactivated'} PluginStatus
 */

/**
 * @typedef {Object} PluginEntry
 * @property {import('./plugin-schema.js').PluginDefinition} definition
 * @property {PluginStatus} status
 * @property {string} [error] - Error message if status is 'error'
 * @property {number} registeredAt - Timestamp when registered
 */

/** @type {Map<string, PluginEntry>} */
let plugins = new Map();

/**
 * Register a plugin in the registry.
 * Validates the plugin definition before registration.
 * If a plugin with the same name is already registered, it will be replaced
 * (previous plugin's deactivate() is NOT called — use unregisterPlugin first).
 *
 * @param {import('./plugin-schema.js').PluginDefinition} plugin
 * @returns {{ ok: boolean, errors?: Array<{ path: string, message: string }> }}
 */
export function registerPlugin(plugin) {
  let validation = validatePluginDefinition(plugin);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  plugins.set(plugin.name, {
    definition: plugin,
    status: 'pending',
    registeredAt: Date.now(),
  });

  return { ok: true };
}

/**
 * Activate a registered plugin.
 * Calls the plugin's activate() hook if present.
 *
 * @param {string} name - Plugin name
 * @param {Object} [context] - Context passed to activate(): { server?, graph?, registry? }
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function activatePlugin(name, context = {}) {
  let entry = plugins.get(name);
  if (!entry) {
    return { ok: false, error: `Plugin "${name}" is not registered.` };
  }

  if (entry.status === 'active') {
    return { ok: true };
  }

  try {
    if (typeof entry.definition.activate === 'function') {
      await entry.definition.activate(context);
    }
    entry.status = 'active';
    return { ok: true };
  } catch (err) {
    entry.status = 'error';
    entry.error = err.message;
    return { ok: false, error: err.message };
  }
}

/**
 * Unregister a plugin. Calls deactivate() if the plugin is active.
 *
 * @param {string} name - Plugin name
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function unregisterPlugin(name) {
  let entry = plugins.get(name);
  if (!entry) {
    return { ok: false, error: `Plugin "${name}" is not registered.` };
  }

  if (entry.status === 'active' && typeof entry.definition.deactivate === 'function') {
    try {
      await entry.definition.deactivate();
    } catch (err) {
      // Log but don't block unregistration
      console.warn(`[symbiote-workspace] Plugin "${name}" deactivate error: ${err.message}`);
    }
  }

  plugins.delete(name);
  return { ok: true };
}

/**
 * List all registered plugins.
 *
 * @returns {Array<{ name: string, version: string, category?: string, status: PluginStatus, error?: string }>}
 */
export function listPlugins() {
  let result = [];
  for (let [name, entry] of plugins) {
    result.push({
      name,
      version: entry.definition.version,
      category: entry.definition.category,
      status: entry.status,
      ...(entry.error ? { error: entry.error } : {}),
    });
  }
  return result;
}

/**
 * Get a registered plugin by name.
 *
 * @param {string} name
 * @returns {import('./plugin-schema.js').PluginDefinition | null}
 */
export function getPlugin(name) {
  let entry = plugins.get(name);
  return entry ? entry.definition : null;
}

/**
 * Get the status of a registered plugin.
 *
 * @param {string} name
 * @returns {PluginStatus | null}
 */
export function getPluginStatus(name) {
  let entry = plugins.get(name);
  return entry ? entry.status : null;
}

/**
 * Clear all plugins from the registry.
 * Does NOT call deactivate() — use unregisterPlugin() for graceful cleanup.
 * Intended for testing.
 */
export function clearPlugins() {
  plugins.clear();
}

/**
 * Validate a plugin definition without registering it.
 *
 * @param {any} plugin
 * @returns {{ valid: boolean, errors: Array<{ path: string, message: string }> }}
 */
export { validatePluginDefinition as validatePlugin } from './plugin-schema.js';
