/**
 * Plugin capability collection utilities.
 *
 * @module symbiote-workspace/plugins/plugin-capabilities
 */

import {
  validatePluginWorkspaceTemplate,
} from './plugin-schema.js';
import { getPlugin, listPlugins } from './plugin-registry.js';
import { validateModuleCapabilityDescriptor } from '../schema/module-capability.js';

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

function validatePluginIdentity(plugin, path, errors) {
  if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin)) {
    errors.push({ path, message: 'Plugin must be a non-null object.' });
    return false;
  }

  let before = errors.length;
  if (typeof plugin.name !== 'string' || !plugin.name.trim()) {
    errors.push({
      path: `${path}.name`,
      message: 'Plugin name is required and must be a non-empty string.',
    });
  }

  if (typeof plugin.version !== 'string' || !plugin.version.trim()) {
    errors.push({
      path: `${path}.version`,
      message: 'Plugin version is required and must be a non-empty string.',
    });
  }

  return errors.length === before;
}

function validatePluginComponents(plugin, index, errors) {
  let components = plugin.components || [];
  if (plugin.components !== undefined && !Array.isArray(plugin.components)) {
    errors.push({
      path: `plugins[${index}].components`,
      message: 'components must be an array of strings or module descriptors.',
    });
    return [];
  }

  for (let j = 0; j < components.length; j++) {
    let component = components[j];
    if (typeof component === 'string') continue;
    if (component && typeof component === 'object' && !Array.isArray(component)) {
      validateModuleCapabilityDescriptor(
        component,
        `plugins[${index}].components[${j}]`,
        errors,
        { severity: false },
      );
    } else {
      errors.push({
        path: `plugins[${index}].components[${j}]`,
        message: 'Component entry must be a string or module descriptor.',
      });
    }
  }

  return components;
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
    let pluginPath = `plugins[${i}]`;
    if (!validatePluginIdentity(plugin, pluginPath, errors)) continue;

    let before = errors.length;
    let components = validatePluginComponents(plugin, i, errors);
    if (errors.length !== before) {
      continue;
    }

    for (let j = 0; j < components.length; j++) {
      let component = components[j];
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

/**
 * @param {import('./plugin-schema.js').PluginDefinition|import('./plugin-schema.js').PluginDefinition[]} plugins
 * @returns {{ ok: boolean, templates: Array, errors: Array<{ path: string, message: string }> }}
 */
export function collectPluginWorkspaceTemplates(plugins) {
  let errors = [];
  let pluginList = normalizePluginInput(plugins, errors);
  let templates = [];
  let names = new Map();

  for (let i = 0; i < pluginList.length; i++) {
    let plugin = pluginList[i];
    let pluginPath = `plugins[${i}]`;
    if (!validatePluginIdentity(plugin, pluginPath, errors)) continue;

    if (plugin.workspace !== undefined && !isObject(plugin.workspace)) {
      errors.push({
        path: `${pluginPath}.workspace`,
        message: 'workspace must be an object.',
      });
      continue;
    }

    let entries = plugin.workspace?.templates || [];
    if (!Array.isArray(entries)) {
      errors.push({
        path: `plugins[${i}].workspace.templates`,
        message: 'workspace.templates must be an array when provided.',
      });
      continue;
    }

    for (let j = 0; j < entries.length; j++) {
      let path = `plugins[${i}].workspace.templates[${j}]`;
      let before = errors.length;
      let template = entries[j];
      validatePluginWorkspaceTemplate(template, path, errors);
      if (errors.length !== before) continue;

      if (names.has(template.name)) {
        errors.push({
          path: `${path}.name`,
          message: `Duplicate workspace template "${template.name}" also declared at ${names.get(template.name)}.`,
        });
        continue;
      }

      names.set(template.name, `${path}.name`);
      templates.push(deepClone({
        name: template.name,
        ...(template.description !== undefined ? { description: template.description } : {}),
        source: {
          plugin: plugin.name,
          version: plugin.version,
        },
        config: template.config,
      }));
    }
  }

  if (errors.length) {
    return { ok: false, templates: [], errors };
  }

  templates.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, templates, errors };
}

/**
 * @param {{ status?: string|string[] }} [options]
 * @returns {{ ok: boolean, templates: Array, errors: Array<{ path: string, message: string }> }}
 */
export function listPluginWorkspaceTemplates(options = {}) {
  if (!isObject(options)) {
    return {
      ok: false,
      templates: [],
      errors: [{ path: 'options', message: 'options must be an object when provided.' }],
    };
  }

  let plugins = [];
  for (let entry of listPlugins()) {
    if (!matchesStatus(entry, options.status)) continue;
    let plugin = getPlugin(entry.name);
    if (plugin) plugins.push(plugin);
  }

  return collectPluginWorkspaceTemplates(plugins);
}
