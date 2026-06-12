/**
 * Plugin Loader — loads plugins from directories and npm packages.
 *
 * Two loading modes:
 * 1. Directory scan: finds *.plugin.js files, imports and validates them
 * 2. Package import: dynamic import() of npm package names
 *
 * Loaded plugins are registered in the plugin registry and their handlers
 * are registered in the symbiote-engine Registry (if engine is available).
 *
 * @module symbiote-workspace/server/plugin-loader
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  registerPlugin,
  activatePlugin,
  validatePluginDefinition,
} from '../plugins/index.js';

/**
 * Try to import symbiote-engine public registry API.
 * Returns null if engine is not installed (optional peer dependency).
 *
 * @returns {Promise<{ registerNodeType: function } | null>}
 */
async function tryLoadEngineRegistry() {
  try {
    let mod = await import('symbiote-engine');
    return mod;
  } catch {
    return null;
  }
}

/**
 * Register a plugin's handlers in the engine Registry.
 *
 * @param {import('../plugins/plugin-schema.js').PluginDefinition} plugin
 * @param {{ registerNodeType: function }} registry
 */
function registerHandlers(plugin, registry) {
  if (!plugin.handlers?.length) return;

  for (let handler of plugin.handlers) {
    let nodeDef = {
      type: handler.type,
      category: handler.category || handler.type.split('/')[0],
      icon: handler.icon,
      driver: handler.driver || {},
    };

    if (handler.lifecycle) {
      nodeDef.lifecycle = handler.lifecycle;
    }
    if (handler.process) {
      nodeDef.process = handler.process;
    }

    registry.registerNodeType(nodeDef);
  }
}

/**
 * Recursively find all .plugin.js files in a directory.
 *
 * @param {string} dir - Directory to scan
 * @returns {Promise<string[]>} Absolute file paths
 */
async function findPluginFiles(dir) {
  let results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (let entry of entries) {
    let fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      let nested = await findPluginFiles(fullPath);
      results.push(...nested);
    } else if (entry.name.endsWith('.plugin.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Load a single plugin file.
 *
 * @param {string} filePath - Absolute path to .plugin.js file
 * @returns {Promise<import('../plugins/plugin-schema.js').PluginDefinition>}
 */
async function importPluginFile(filePath) {
  let fileUrl = pathToFileURL(filePath).href;
  let url = `${fileUrl}?t=${Date.now()}`;
  let mod = await import(url);
  return mod.default;
}

/**
 * Load all plugins from a directory.
 * Scans for *.plugin.js files, validates, and registers each one.
 *
 * @param {string} dir - Directory to scan
 * @param {Object} [options]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<Array<{ name: string, status: string, error?: string }>>}
 */
export async function loadPluginsFromDir(dir, options = {}) {
  let { verbose = false } = options;
  let log = verbose ? console.log.bind(console) : () => {};
  let results = [];

  let files = await findPluginFiles(dir);
  let engineRegistry = await tryLoadEngineRegistry();

  for (let file of files) {
    try {
      let plugin = await importPluginFile(file);
      let validation = validatePluginDefinition(plugin);

      if (!validation.valid) {
        let errMsg = validation.errors.map((e) => e.message).join('; ');
        log(`🔴 [plugin-loader] Invalid plugin ${file}: ${errMsg}`);
        results.push({ name: file, status: 'error', error: errMsg });
        continue;
      }

      // Register handlers in engine (if available)
      if (engineRegistry) {
        registerHandlers(plugin, engineRegistry);
      }

      // Register in workspace plugin registry
      registerPlugin(plugin);
      log(`🔌 [plugin-loader] Loaded: ${plugin.name}@${plugin.version} from ${file}`);
      results.push({ name: plugin.name, status: 'registered' });
    } catch (err) {
      log(`🔴 [plugin-loader] Failed to load ${file}: ${err.message}`);
      results.push({ name: file, status: 'error', error: err.message });
    }
  }

  return results;
}

/**
 * Load plugins from npm package names.
 * Performs dynamic import() on each package name.
 *
 * @param {string[]} packageNames - Array of npm package names
 * @param {Object} [options]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<Array<{ name: string, status: string, error?: string }>>}
 */
export async function loadPluginsFromPackages(packageNames, options = {}) {
  let { verbose = false } = options;
  let log = verbose ? console.log.bind(console) : () => {};
  let results = [];

  let engineRegistry = await tryLoadEngineRegistry();

  for (let pkgName of packageNames) {
    try {
      let mod = await import(pkgName);
      let plugin = mod.default;

      let validation = validatePluginDefinition(plugin);
      if (!validation.valid) {
        let errMsg = validation.errors.map((e) => e.message).join('; ');
        log(`🔴 [plugin-loader] Invalid plugin package ${pkgName}: ${errMsg}`);
        results.push({ name: pkgName, status: 'error', error: errMsg });
        continue;
      }

      if (engineRegistry) {
        registerHandlers(plugin, engineRegistry);
      }

      registerPlugin(plugin);
      log(`🔌 [plugin-loader] Loaded: ${plugin.name}@${plugin.version} from ${pkgName}`);
      results.push({ name: plugin.name, status: 'registered' });
    } catch (err) {
      log(`🔴 [plugin-loader] Failed to load package ${pkgName}: ${err.message}`);
      results.push({ name: pkgName, status: 'error', error: err.message });
    }
  }

  return results;
}

/**
 * Activate all registered plugins that are in 'pending' status.
 *
 * @param {Object} [context] - Context passed to each plugin's activate()
 * @returns {Promise<Array<{ name: string, ok: boolean, error?: string }>>}
 */
export async function activateAllPlugins(context = {}) {
  let { listPlugins } = await import('../plugins/index.js');
  let all = listPlugins();
  let results = [];

  for (let entry of all) {
    if (entry.status === 'pending') {
      let result = await activatePlugin(entry.name, context);
      results.push({ name: entry.name, ...result });
    }
  }

  return results;
}
