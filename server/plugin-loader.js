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
  getPlugin,
  validatePluginDefinition,
} from '../plugins/index.js';
import { createIngressPlugin } from './ingress.js';
import { createTriggerReconcilerPlugin } from './triggers.js';

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
 * Register a plugin's contributed pack handlers in the engine Registry.
 *
 * @param {import('../plugins/plugin-schema.js').PluginDefinition} plugin
 * @param {{ registerNodeType: function }} registry
 */
function registerHandlers(plugin, registry) {
  let packs = plugin.contributes?.packs;
  if (!Array.isArray(packs)) return;

  for (let pack of packs) {
    for (let handler of pack.handlers || []) {
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
}

function hasGraphTrigger(config, kinds) {
  let graphs = Array.isArray(config?.engine?.graphs) ? config.engine.graphs : [];
  return graphs.some((graph) => {
    let nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    return nodes.some((node) => kinds.has(node?.trigger?.kind));
  });
}

function needsServerPlaneBuiltIns(config) {
  let endpoints = Array.isArray(config?.server?.endpoints) ? config.server.endpoints : [];
  if (endpoints.length > 0) return true;
  return hasGraphTrigger(config, new Set(['ingress', 'schedule']));
}

function registerPluginIfAbsent(plugin) {
  if (getPlugin(plugin.name)) return { name: plugin.name, status: 'already_registered' };
  let result = registerPlugin(plugin);
  if (!result.ok) {
    return {
      name: plugin.name,
      status: 'error',
      error: result.errors?.map((entry) => entry.message).join('; ') || 'Invalid built-in plugin.',
    };
  }
  return { name: plugin.name, status: 'registered' };
}

/**
 * Register host-neutral server-plane built-ins when a config declares server
 * endpoints or graph trigger nodes.
 *
 * @param {Object} [options]
 * @param {Object} [options.config]
 * @param {boolean} [options.enabled=true]
 * @param {boolean} [options.force=false]
 * @param {Object} [options.ingress]
 * @param {Object} [options.triggers]
 * @returns {Array<{ name: string, status: string, error?: string }>}
 */
export function registerBuiltInServerPlugins(options = {}) {
  if (options.enabled === false) return [];
  let config = options.config || {};
  if (options.force !== true && !needsServerPlaneBuiltIns(config)) return [];

  return [
    registerPluginIfAbsent(createIngressPlugin({ ...(options.ingress || {}), config })),
    registerPluginIfAbsent(createTriggerReconcilerPlugin({ ...(options.triggers || {}), config })),
  ];
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

/**
 * Activate a specific set of registered plugins.
 *
 * @param {string[]} names
 * @param {Object} [context]
 * @returns {Promise<Array<{ name: string, ok: boolean, error?: string }>>}
 */
export async function activatePlugins(names, context = {}) {
  let results = [];
  for (let name of names) {
    let result = await activatePlugin(name, context);
    results.push({ name, ...result });
  }
  return results;
}
