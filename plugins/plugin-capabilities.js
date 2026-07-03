/**
 * Plugin capability collection utilities.
 *
 * @module symbiote-workspace/plugins/plugin-capabilities
 */

import {
  validatePluginDefinition,
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

function prefixPluginPath(pluginPath, errorPath) {
  return errorPath ? `${pluginPath}.${errorPath}` : pluginPath;
}

function validatePluginManifest(plugin, pluginPath, errors) {
  let result = validatePluginDefinition(plugin);
  if (result.valid) return true;

  for (let error of result.errors) {
    errors.push({
      path: prefixPluginPath(pluginPath, error.path),
      message: error.message,
    });
  }

  return false;
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
  let moduleIds = new Map();
  let tagNames = new Map();

  for (let i = 0; i < pluginList.length; i++) {
    let plugin = pluginList[i];
    let pluginPath = `plugins[${i}]`;
    if (!validatePluginManifest(plugin, pluginPath, errors)) continue;

    let modules = plugin.contributes?.modules || [];
    for (let j = 0; j < modules.length; j++) {
      let component = modules[j];
      let modulePath = `${pluginPath}.contributes.modules[${j}]`;

      let descriptorErrors = [];
      validateModuleCapabilityDescriptor(
        component,
        modulePath,
        descriptorErrors,
        { severity: false, moduleId: component.id },
      );
      for (let error of descriptorErrors) errors.push(error);
      if (descriptorErrors.length) continue;

      let idPath = `${modulePath}.id`;
      if (moduleIds.has(component.id)) {
        errors.push({
          path: idPath,
          message: `Duplicate module contribution "${component.id}" also declared at ${moduleIds.get(component.id)}.`,
        });
        continue;
      }

      let tagPath = `${modulePath}.tagName`;
      if (tagNames.has(component.tagName)) {
        errors.push({
          path: tagPath,
          message: `Duplicate component tag "${component.tagName}" also declared at ${tagNames.get(component.tagName)}.`,
        });
        continue;
      }

      moduleIds.set(component.id, idPath);
      tagNames.set(component.tagName, tagPath);
      moduleCapabilities.push(deepClone(component));
    }
  }

  if (errors.length) {
    return { ok: false, moduleCapabilities: [], errors };
  }

  moduleCapabilities.sort((a, b) => a.id.localeCompare(b.id));
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
    if (!validatePluginManifest(plugin, pluginPath, errors)) continue;

    let entries = plugin.contributes?.templates || [];
    for (let j = 0; j < entries.length; j++) {
      let path = `${pluginPath}.contributes.templates[${j}]`;
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
