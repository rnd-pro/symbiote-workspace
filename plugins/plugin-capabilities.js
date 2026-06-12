/**
 * Plugin capability collection utilities.
 *
 * @module symbiote-workspace/plugins/plugin-capabilities
 */

import { validatePluginDefinition } from './plugin-schema.js';
import { getPlugin, listPlugins } from './plugin-registry.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizePluginInput(plugins, errors) {
  if (Array.isArray(plugins)) return plugins;
  if (isObject(plugins)) return [plugins];
  errors.push({
    path: 'plugins',
    message: 'plugins must be a plugin definition or an array of plugin definitions.',
  });
  return [];
}

function prefixValidationError(index, error) {
  return {
    ...error,
    path: error.path ? `plugins[${index}].${error.path}` : `plugins[${index}]`,
  };
}

function matchesStatus(entry, status) {
  if (status === undefined) return true;
  if (Array.isArray(status)) return status.includes(entry.status);
  return entry.status === status;
}

/**
 * @param {import('./plugin-schema.js').PluginDefinition|import('./plugin-schema.js').PluginDefinition[]} plugins
 * @returns {{ ok: boolean, moduleCapabilities: Array, errors: Array<{ path: string, message: string }> }}
 */
export function collectPluginModuleCapabilities(plugins) {
  let errors = [];
  let pluginList = normalizePluginInput(plugins, errors);
  let moduleCapabilities = [];
  let tagNames = new Map();

  for (let i = 0; i < pluginList.length; i++) {
    let plugin = pluginList[i];
    let validation = validatePluginDefinition(plugin);
    if (!validation.valid) {
      errors.push(...validation.errors.map((error) => prefixValidationError(i, error)));
      continue;
    }

    for (let j = 0; j < (plugin.components || []).length; j++) {
      let component = plugin.components[j];
      if (typeof component === 'string') continue;

      let path = `plugins[${i}].components[${j}].tagName`;
      if (tagNames.has(component.tagName)) {
        errors.push({
          path,
          message: `Duplicate component tag "${component.tagName}" also declared at ${tagNames.get(component.tagName)}.`,
        });
        continue;
      }

      tagNames.set(component.tagName, path);
      moduleCapabilities.push(deepClone(component));
    }
  }

  if (errors.length) {
    return { ok: false, moduleCapabilities: [], errors };
  }

  moduleCapabilities.sort((a, b) => a.tagName.localeCompare(b.tagName));
  return { ok: true, moduleCapabilities, errors };
}

/**
 * @param {{ status?: string|string[] }} [options]
 * @returns {{ ok: boolean, moduleCapabilities: Array, errors: Array<{ path: string, message: string }> }}
 */
export function listPluginModuleCapabilities(options = {}) {
  if (!isObject(options)) {
    return {
      ok: false,
      moduleCapabilities: [],
      errors: [{ path: 'options', message: 'options must be an object when provided.' }],
    };
  }

  let plugins = [];
  for (let entry of listPlugins()) {
    if (!matchesStatus(entry, options.status)) continue;
    let plugin = getPlugin(entry.name);
    if (plugin) plugins.push(plugin);
  }

  return collectPluginModuleCapabilities(plugins);
}
