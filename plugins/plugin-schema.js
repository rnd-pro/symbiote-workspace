/**
 * Plugin manifest schema (spec §5) — the `contributes.*` surface.
 *
 * A plugin is a namespaced package that contributes modules, panels, views,
 * hooks, theme profiles, engine packs, narration, and whole-config templates.
 * Every contribution id is namespaced under the manifest `name`; contributions
 * are referenced, never copy-merged.
 *
 * One validator, one code path: `validatePluginDefinition` validates each
 * contribution with the SAME section validators the config validator uses
 * (module descriptors via `validateModuleCapabilityDescriptor`, templates via
 * `validateWorkspaceConfig`, sibling sections through the S1.0 registry) and adds
 * namespace enforcement on top.
 *
 * @module symbiote-workspace/plugins/plugin-schema
 */

import {
  validateModuleCapabilityDescriptor,
} from '../schema/module-capability.js';
import {
  validateIdLifecycle,
  splitModuleId,
} from '../schema/sections/modules.js';
import { TRIGGER_KINDS } from '../schema/constants.js';
import { SEMVER_PATTERN } from '../schema/value-classes.js';
import { validateWorkspaceConfig, getRegisteredSections } from '../validation/core.js';

const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/;
const TEMPLATE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SEMVER_RANGE_PATTERN = /^(\^|~|>=|<=|>|<|=)?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/;
// Handler triggers narrow the full TRIGGER_KINDS set to the ingress/schedule pair.
const PACK_TRIGGER_KINDS = Object.freeze(TRIGGER_KINDS.filter((kind) => kind === 'ingress' || kind === 'schedule'));

// contributes kinds whose shape is owned by another section; validated through
// the S1.0 registry when that section is registered.
const DELEGATED_CONTRIBUTIONS = Object.freeze({
  views: 'structure',
  panels: 'structure',
  hooks: 'behavior',
  themeProfiles: 'theme',
});

const CONTRIBUTION_KINDS = Object.freeze([
  'modules', 'panels', 'views', 'hooks', 'themeProfiles', 'packs', 'narration', 'templates',
]);

export const PLUGIN_SCHEMA = Object.freeze({
  type: 'object',
  required: ['name', 'version'],
  properties: {
    name: { type: 'string', description: 'Unique plugin namespace (also the contribution id namespace).' },
    version: { type: 'string', description: 'Semver version.' },
    namespace: { type: 'string', description: 'Contribution namespace; must equal name when present.' },
    description: { type: 'string' },
    contributes: {
      type: 'object',
      description: 'Namespaced contribution surface. Contributions are referenced, not copy-merged.',
      properties: {
        modules: { type: 'array', description: 'Full §2.3 capability contracts, ids namespaced.' },
        panels: { type: 'object', description: 'Panel placements keyed by namespaced panel id.' },
        views: { type: 'array', description: 'View fragments; shape = config views[].' },
        hooks: { type: 'array', description: 'Hook records; contentHash derived at publish.' },
        themeProfiles: { type: 'array', description: 'Namespaced theme profiles.' },
        packs: { type: 'array', description: 'Engine pack defs: socketTypes + handler driver manifests.' },
        narration: { type: 'object', description: 'Enrichment records for this plugin\'s own modules.' },
        templates: { type: 'array', description: 'Whole-config templates, validated by the config validator.' },
      },
    },
    hostServices: { type: 'object', properties: { required: { type: 'array' }, optional: { type: 'array' } } },
    idLifecycle: { type: 'object', properties: { renames: { type: 'object' }, removed: { type: 'object' } } },
    listing: { type: 'object', description: 'Registry listing backreference (excluded from pack integrity).' },
  },
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function pushError(errors, path, message) {
  errors.push({ path, message });
}

function isSemverRange(value) {
  return typeof value === 'string' && (SEMVER_PATTERN.test(value) || SEMVER_RANGE_PATTERN.test(value));
}

function sectionValidator(sectionId) {
  let section = getRegisteredSections().find((entry) => entry.id === sectionId);
  return section && typeof section.validate === 'function' ? section.validate : null;
}

/**
 * Validates a plugin manifest against the §5 contract.
 *
 * @param {any} plugin - Plugin manifest to validate
 * @returns {{ valid: boolean, errors: Array<{ path: string, message: string }> }}
 */
export function validatePluginDefinition(plugin) {
  let errors = [];

  if (!isObject(plugin)) {
    errors.push({ path: '', message: 'Plugin manifest must be a non-null object.' });
    return { valid: false, errors };
  }

  if (!hasText(plugin.name)) {
    pushError(errors, 'name', 'Plugin name is required and must be a non-empty string.');
  } else if (!NAMESPACE_PATTERN.test(plugin.name)) {
    pushError(errors, 'name', `Plugin name "${plugin.name}" must be a valid namespace grammar.`);
  }

  if (!hasText(plugin.version)) {
    pushError(errors, 'version', 'Plugin version is required and must be a non-empty string.');
  } else if (!isSemverRange(plugin.version)) {
    pushError(errors, 'version', `Plugin version "${plugin.version}" must be a valid semver version.`);
  }

  let namespace = hasText(plugin.namespace) ? plugin.namespace : plugin.name;
  if (plugin.namespace !== undefined && plugin.namespace !== plugin.name) {
    pushError(errors, 'namespace', 'Plugin namespace must equal name.');
  }

  rejectLegacyTopLevel(plugin, errors);

  let contributionIds = new Set();
  if (plugin.contributes !== undefined) {
    if (!isObject(plugin.contributes)) {
      pushError(errors, 'contributes', 'contributes must be an object.');
    } else {
      validateContributes(plugin.contributes, namespace, contributionIds, errors);
    }
  }

  if (plugin.hostServices !== undefined && !isObject(plugin.hostServices)) {
    pushError(errors, 'hostServices', 'hostServices must be an object with { required, optional } arrays.');
  }

  if (plugin.idLifecycle !== undefined) {
    let lifecycleErrors = [];
    validateIdLifecycle(plugin.idLifecycle, contributionIds, 'idLifecycle', lifecycleErrors);
    for (let error of lifecycleErrors) errors.push({ path: error.path, message: error.message });
  }

  return { valid: errors.length === 0, errors };
}

function rejectLegacyTopLevel(plugin, errors) {
  if (plugin.handlers !== undefined) {
    pushError(errors, 'handlers', 'Flat top-level handlers are removed; declare engine packs under contributes.packs.');
  }
  if (plugin.components !== undefined) {
    pushError(errors, 'components', 'Flat top-level components are removed; declare modules under contributes.modules.');
  }
  if (plugin.workspace !== undefined) {
    pushError(errors, 'workspace', 'Top-level workspace is removed; whole-config templates move to contributes.templates.');
  }
  if (plugin.category !== undefined) {
    pushError(errors, 'category', 'PLUGIN_CATEGORIES is removed; a plugin\'s role is derivable from its contributes keys.');
  }
}

function validateContributes(contributes, namespace, contributionIds, errors) {
  for (let key of Object.keys(contributes)) {
    if (!CONTRIBUTION_KINDS.includes(key)) {
      pushError(errors, `contributes.${key}`, `Unknown contributes key "${key}".`);
    }
  }

  if (contributes.modules !== undefined) validateContributedModules(contributes.modules, namespace, contributionIds, errors);
  if (contributes.packs !== undefined) validateContributedPacks(contributes.packs, namespace, contributionIds, errors);
  if (contributes.templates !== undefined) validateContributedTemplates(contributes.templates, errors);
  if (contributes.panels !== undefined) validateContributedPanels(contributes.panels, namespace, contributionIds, errors);

  for (let key of ['views', 'hooks', 'themeProfiles']) {
    if (contributes[key] !== undefined) {
      validateContributedList(contributes[key], key, namespace, contributionIds, errors);
    }
  }

  if (contributes.narration !== undefined && !isObject(contributes.narration)) {
    pushError(errors, 'contributes.narration', 'contributes.narration must be an object.');
  }
}

function registerContributionId(id, namespace, path, contributionIds, errors) {
  if (!hasText(id)) {
    pushError(errors, path, 'Contribution requires a namespaced id.');
    return;
  }
  let parts = splitModuleId(id);
  if (!parts || parts.namespace !== namespace) {
    pushError(errors, path, `Contribution id "${id}" must be namespaced under "${namespace}".`);
  }
  if (contributionIds.has(id)) {
    pushError(errors, path, `Duplicate contribution id "${id}".`);
  }
  contributionIds.add(id);
}

function validateContributedModules(modules, namespace, contributionIds, errors) {
  if (!Array.isArray(modules)) {
    pushError(errors, 'contributes.modules', 'contributes.modules must be an array.');
    return;
  }
  for (let i = 0; i < modules.length; i++) {
    let entry = modules[i];
    let path = `contributes.modules[${i}]`;
    if (!isObject(entry)) {
      pushError(errors, path, 'Contributed module must be an object.');
      continue;
    }
    registerContributionId(entry.id, namespace, `${path}.id`, contributionIds, errors);
    let descriptorErrors = [];
    validateModuleCapabilityDescriptor(entry, path, descriptorErrors, { moduleId: entry.id });
    for (let error of descriptorErrors) errors.push({ path: error.path, message: error.message });
  }
}

function validateContributedPanels(panels, namespace, contributionIds, errors) {
  if (!isObject(panels)) {
    pushError(errors, 'contributes.panels', 'contributes.panels must be an object keyed by panel id.');
    return;
  }
  let delegate = sectionValidator(DELEGATED_CONTRIBUTIONS.panels);
  for (let id of Object.keys(panels)) {
    registerContributionId(id, namespace, `contributes.panels.${id}`, contributionIds, errors);
  }
  if (delegate) delegateSection(delegate, { panels }, 'panels', errors);
}

function validateContributedList(list, key, namespace, contributionIds, errors) {
  if (!Array.isArray(list)) {
    pushError(errors, `contributes.${key}`, `contributes.${key} must be an array.`);
    return;
  }
  for (let i = 0; i < list.length; i++) {
    let entry = list[i];
    let path = `contributes.${key}[${i}]`;
    if (!isObject(entry)) {
      pushError(errors, path, `Contributed ${key} entry must be an object.`);
      continue;
    }
    registerContributionId(entry.id, namespace, `${path}.id`, contributionIds, errors);
  }
  let sectionId = DELEGATED_CONTRIBUTIONS[key];
  let delegate = sectionId ? sectionValidator(sectionId) : null;
  if (delegate) delegateSection(delegate, { [key]: list }, key, errors);
}

/**
 * Runs a registered section validator over a synthetic config fragment and keeps
 * only the errors scoped to the delegated key, so unrelated "missing section"
 * noise from the fragment does not leak into the manifest report.
 */
function delegateSection(validate, fragment, key, errors) {
  let returned;
  try {
    returned = validate(fragment, { sectionId: key, error() {}, warning() {}, issue() {}, suggest() {} });
  } catch {
    return;
  }
  let issues = Array.isArray(returned) ? returned : (returned && Array.isArray(returned.errors) ? returned.errors : []);
  for (let issue of issues) {
    if (typeof issue?.path === 'string' && issue.path.startsWith(key)) {
      errors.push({ path: `contributes.${issue.path}`, message: issue.message });
    }
  }
}

function validateContributedPacks(packs, namespace, contributionIds, errors) {
  if (!Array.isArray(packs)) {
    pushError(errors, 'contributes.packs', 'contributes.packs must be an array.');
    return;
  }
  for (let i = 0; i < packs.length; i++) {
    let pack = packs[i];
    let path = `contributes.packs[${i}]`;
    if (!isObject(pack)) {
      pushError(errors, path, 'Contributed pack must be an object.');
      continue;
    }
    registerContributionId(pack.id, namespace, `${path}.id`, contributionIds, errors);
    if (pack.handlers !== undefined) validatePackHandlers(pack.handlers, `${path}.handlers`, errors);
  }
}

function validatePackHandlers(handlers, path, errors) {
  if (!Array.isArray(handlers)) {
    pushError(errors, path, `${path} must be an array.`);
    return;
  }
  for (let i = 0; i < handlers.length; i++) {
    let handler = handlers[i];
    let itemPath = `${path}[${i}]`;
    if (!isObject(handler)) {
      pushError(errors, itemPath, 'Handler manifest must be an object.');
      continue;
    }
    if (!hasText(handler.type)) {
      pushError(errors, `${itemPath}.type`, 'Handler manifest requires a type.');
    }
    if (handler.trigger !== undefined) {
      if (!isObject(handler.trigger) || !PACK_TRIGGER_KINDS.includes(handler.trigger.kind)) {
        pushError(errors, `${itemPath}.trigger`, `Handler trigger.kind must be one of: ${PACK_TRIGGER_KINDS.join(', ')}.`);
      }
    }
    if (handler.ui !== undefined && !isObject(handler.ui)) {
      pushError(errors, `${itemPath}.ui`, 'Handler ui must be an object { configComponent?, autoForm? }.');
    }
    if (handler.credentialType !== undefined && !hasText(handler.credentialType)) {
      pushError(errors, `${itemPath}.credentialType`, 'Handler credentialType must be a non-empty string.');
    }
    if (handler.hostServices !== undefined && !isObject(handler.hostServices)) {
      pushError(errors, `${itemPath}.hostServices`, 'Handler hostServices must be an object { required, optional }.');
    }
  }
}

function validateContributedTemplates(templates, errors) {
  if (!Array.isArray(templates)) {
    pushError(errors, 'contributes.templates', 'contributes.templates must be an array.');
    return;
  }
  for (let i = 0; i < templates.length; i++) {
    validatePluginWorkspaceTemplate(templates[i], `contributes.templates[${i}]`, errors);
  }
}

/**
 * Validates a whole-config workspace template contribution. The config is
 * validated by the ONE config validator (`validateWorkspaceConfig`).
 *
 * @param {any} template
 * @param {string} path
 * @param {Array<{path:string, message:string}>} errors
 */
export function validatePluginWorkspaceTemplate(template, path, errors) {
  if (!isObject(template)) {
    pushError(errors, path, 'Workspace template entry must be an object.');
    return;
  }

  if (!hasText(template.name)) {
    pushError(errors, `${path}.name`, 'Workspace template requires a name.');
  } else if (!TEMPLATE_NAME_PATTERN.test(template.name)) {
    pushError(errors, `${path}.name`, `Workspace template name "${template.name}" must be a portable identifier.`);
  }

  if (template.description !== undefined && typeof template.description !== 'string') {
    pushError(errors, `${path}.description`, 'Workspace template description must be a string.');
  }

  let validation = validateWorkspaceConfig(template.config);
  for (let error of validation.errors) {
    errors.push({
      path: error.path ? `${path}.config.${error.path}` : `${path}.config`,
      message: error.message,
    });
  }
}
