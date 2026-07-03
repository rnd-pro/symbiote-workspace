/**
 * MODULES section (spec Section 2): `modules[]` (the single component contract),
 * `requires{}` (the one dependency section), and the reusable validators for the
 * plugin manifest `contributes.*` surface (`idLifecycle`, hook-verdict carrier).
 *
 * Registers into the S1.0 validator core via the
 * `{ id, validate, refProviders, refConsumers }` section contract. The same
 * descriptor and lifecycle validators are consumed by `plugins/plugin-schema.js`
 * so config `modules[]` and manifest `contributes.modules` share one code path.
 *
 * @module symbiote-workspace/schema/sections/modules
 */

import { SEMVER_PATTERN } from '../value-classes.js';
import { MODULE_ID_PATTERN } from '../constants.js';
import { computeIntegrity } from '../canonical-json.js';
import {
  validateModuleCapabilityDescriptor,
  validatePortableId,
  hostServicesInclude,
} from '../module-capability.js';

const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/;
const SEMVER_RANGE_PATTERN = /^(\^|~|>=|<=|>|<|=)?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/;
const RESERVED_LOCAL_NAMESPACE = 'local';
const MODULE_SOURCE_KINDS = Object.freeze(['package', 'plugin', 'inline']);
const CONFIG_VERDICT_VALUES = Object.freeze(['accepted', 'blocked']);
const INTEGRITY_PATTERN = /^sha256-[A-Za-z0-9+/]+={0,2}$/;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function pushError(errors, path, code, message, extra = {}) {
  errors.push({ path, code, message, severity: 'error', ...extra });
}

function isSemverRange(value) {
  return typeof value === 'string' && (SEMVER_PATTERN.test(value) || SEMVER_RANGE_PATTERN.test(value));
}

function isIntegrity(value) {
  return typeof value === 'string' && INTEGRITY_PATTERN.test(value);
}

/**
 * Splits a module id into namespace and localName. Module ids carry exactly one
 * `:`; the namespace may contain `.`, the localName may not.
 *
 * @param {string} moduleId
 * @returns {{ namespace: string, localName: string }|null}
 */
export function splitModuleId(moduleId) {
  if (typeof moduleId !== 'string') return null;
  let colon = moduleId.indexOf(':');
  if (colon < 0) return null;
  return { namespace: moduleId.slice(0, colon), localName: moduleId.slice(colon + 1) };
}

function sourceAuthority(source) {
  if (!isObject(source)) return null;
  switch (source.kind) {
    case 'package':
      return hasText(source.package) ? source.package : null;
    case 'plugin':
      return hasText(source.plugin) ? source.plugin : null;
    case 'inline':
      return RESERVED_LOCAL_NAMESPACE;
    default:
      return null;
  }
}

function validateModuleSource(entry, path, errors) {
  let source = entry.source;
  if (!isObject(source)) {
    pushError(errors, `${path}.source`, 'modules.source.required', 'Module entry requires a `source` object.');
    return;
  }
  if (!MODULE_SOURCE_KINDS.includes(source.kind)) {
    pushError(errors, `${path}.source.kind`, 'modules.source.kind', `Module source.kind must be one of: ${MODULE_SOURCE_KINDS.join(', ')}.`);
    return;
  }

  let hasEmbeddedDescriptor = entry.tagName !== undefined
    || entry.actions !== undefined || entry.settings !== undefined || entry.state !== undefined
    || entry.events !== undefined || entry.bindings !== undefined || entry.slots !== undefined
    || entry.runtimeSlots !== undefined || entry.streams !== undefined || entry.capabilities !== undefined
    || entry.hostServices !== undefined || entry.webmcp !== undefined || entry.graphOwnership !== undefined
    || entry.suggests !== undefined || entry.lifecycle !== undefined || entry.placement !== undefined;

  if (source.kind === 'package') {
    validatePortableId(source.package, `${path}.source.package`, errors, {});
    if (hasEmbeddedDescriptor) validateModuleCapabilityDescriptor(entry, path, errors, { moduleId: entry.id });
  } else if (source.kind === 'plugin') {
    validatePortableId(source.plugin, `${path}.source.plugin`, errors, {});
    // Referenced-not-copied: a plugin module descriptor is resolved at load, never embedded.
    if (hasEmbeddedDescriptor) {
      pushError(errors, `${path}.source`, 'modules.source.plugin_embedded', "kind:'plugin' modules are referenced from the plugin's contributes.modules, never embedded in config.");
    }
  } else if (source.kind === 'inline') {
    validateInlineSource(source, `${path}.source`, errors);
    validateModuleCapabilityDescriptor(entry, path, errors, { moduleId: entry.id });
  }
}

function validateInlineSource(source, path, errors) {
  if (!hasText(source.code)) {
    pushError(errors, `${path}.code`, 'modules.inline.code', "kind:'inline' requires non-empty `code`.");
  }
  if (!isIntegrity(source.integrity)) {
    pushError(errors, `${path}.integrity`, 'modules.inline.integrity', "kind:'inline' requires an `integrity` string (sha256-<base64>).");
  } else if (hasText(source.code)) {
    let payload = { code: source.code };
    if (source.template !== undefined) payload.template = source.template;
    if (source.styles !== undefined) payload.styles = source.styles;
    let expected = computeIntegrity(payload);
    if (expected !== source.integrity) {
      pushError(errors, `${path}.integrity`, 'modules.inline.integrity_mismatch', 'Inline integrity does not match the canonical hash of { code, template, styles }.');
    }
  }

  let review = source.review;
  if (!isObject(review) || review.verdict !== 'accepted') {
    let verdict = isObject(review) ? review.verdict : undefined;
    if (verdict !== undefined && !CONFIG_VERDICT_VALUES.includes(verdict)) {
      pushError(errors, `${path}.review.verdict`, 'modules.inline.verdict_value', "Inline review.verdict may only serialize as 'accepted' or 'blocked'.");
    } else {
      pushError(errors, `${path}.review.verdict`, 'modules.inline.unreviewed', "Inline module requires review.verdict:'accepted' to import.");
    }
  }
}

function validateModuleEntry(entry, index, errors, ctx) {
  let path = `modules[${index}]`;
  if (!isObject(entry)) {
    pushError(errors, path, 'modules.entry', 'Module entry must be an object.');
    return;
  }

  if (!hasText(entry.id)) {
    pushError(errors, `${path}.id`, 'modules.id.required', 'Module entry requires an `id`.');
  } else {
    if (!MODULE_ID_PATTERN.test(entry.id)) {
      pushError(errors, `${path}.id`, 'modules.id.grammar', `Module id "${entry.id}" must be "namespace:localName".`);
    }
    if (ctx.ids.has(entry.id)) {
      pushError(errors, `${path}.id`, 'modules.id.duplicate', `Duplicate module id "${entry.id}".`);
    }
    ctx.ids.add(entry.id);

    let parts = splitModuleId(entry.id);
    let authority = sourceAuthority(entry.source);
    if (parts && authority !== null && parts.namespace !== authority) {
      pushError(errors, `${path}.id`, 'modules.namespace.authority', `Module namespace "${parts.namespace}" must equal the source authority "${authority}".`);
    }
    if (parts && parts.namespace === RESERVED_LOCAL_NAMESPACE && isObject(entry.source) && entry.source.kind !== 'inline') {
      pushError(errors, `${path}.id`, 'modules.namespace.reserved_local', "The `local` namespace is reserved for inline modules.");
    }
  }

  validateModuleSource(entry, path, errors);

  if (entry.tagName !== undefined) {
    if (ctx.tagNames.has(entry.tagName)) {
      pushError(errors, `${path}.tagName`, 'modules.tagName.duplicate', `Duplicate tagName preference "${entry.tagName}".`);
    }
    ctx.tagNames.add(entry.tagName);
  }

  // Referenced dependencies must be declared in requires (§3).
  if (isObject(entry.source)) {
    if (entry.source.kind === 'plugin' && hasText(entry.source.plugin)) {
      ctx.referencedPlugins.add(entry.source.plugin);
      if (!ctx.declaredPlugins.has(entry.source.plugin)) {
        pushError(errors, `${path}.source.plugin`, 'modules.requires.plugin_missing', `Module source plugin "${entry.source.plugin}" is not declared in requires.plugins.`);
      }
    }
    if (entry.source.kind === 'package' && hasText(entry.source.package)) {
      if (!ctx.declaredPackages.has(entry.source.package)) {
        pushError(errors, `${path}.source.package`, 'modules.requires.package_missing', `Module source package "${entry.source.package}" is not declared in requires.packages.`);
      }
    }
  }

  collectModuleHostServices(entry, ctx);
}

function collectModuleHostServices(entry, ctx) {
  let hostServices = entry.hostServices;
  if (!isObject(hostServices)) return;
  for (let key of ['required', 'optional']) {
    if (!Array.isArray(hostServices[key])) continue;
    for (let id of hostServices[key]) {
      if (typeof id === 'string') ctx.declaredHostServices.add(id);
    }
  }
}

/**
 * Validates the `idLifecycle.renames` map (spec §6.1). Keys map old id → current
 * id, cumulative across versions. Values MUST exist in current contributes; keys
 * MUST NOT; a key may never appear as another entry's value (chains are
 * pre-flattened by publish).
 *
 * @param {any} idLifecycle
 * @param {Set<string>} currentIds - ids present in the current contributes surface
 * @param {string} path
 * @param {Array} errors
 */
export function validateIdLifecycle(idLifecycle, currentIds, path, errors) {
  if (idLifecycle === undefined) return;
  if (!isObject(idLifecycle)) {
    pushError(errors, path, 'idLifecycle.type', 'idLifecycle must be an object.');
    return;
  }

  let renames = idLifecycle.renames;
  if (renames !== undefined) {
    if (!isObject(renames)) {
      pushError(errors, `${path}.renames`, 'idLifecycle.renames.type', 'idLifecycle.renames must be an object map.');
    } else {
      let values = new Set(Object.values(renames).filter((v) => typeof v === 'string'));
      for (let [oldId, newId] of Object.entries(renames)) {
        let entryPath = `${path}.renames.${oldId}`;
        if (typeof newId !== 'string' || !newId.trim()) {
          pushError(errors, entryPath, 'idLifecycle.renames.value', 'idLifecycle.renames value must be a non-empty id.');
          continue;
        }
        if (currentIds.has(oldId)) {
          pushError(errors, entryPath, 'idLifecycle.renames.key_present', `Renamed-away id "${oldId}" must not still exist in current contributes.`);
        }
        if (!currentIds.has(newId)) {
          pushError(errors, entryPath, 'idLifecycle.renames.value_absent', `Rename target "${newId}" must exist in current contributes.`);
        }
        if (values.has(oldId)) {
          pushError(errors, entryPath, 'idLifecycle.renames.chain', `Rename key "${oldId}" also appears as a rename target; chains must be pre-flattened.`);
        }
      }
    }
  }

  let removed = idLifecycle.removed;
  if (removed !== undefined && !isObject(removed)) {
    pushError(errors, `${path}.removed`, 'idLifecycle.removed.type', 'idLifecycle.removed must be an object map.');
  }
}

/**
 * Validates a per-item review-verdict map (spec §4). Config only ever serializes
 * `accepted|blocked`. When `declaredIds` is supplied, an id present in the
 * contributes surface but absent from the verdict map is an "unreviewed" ERROR.
 *
 * @param {any} verdicts
 * @param {string} path
 * @param {Array} errors
 * @param {{ declaredIds?: Set<string>, itemNoun?: string }} [options]
 */
export function validateVerdictMap(verdicts, path, errors, options = {}) {
  if (verdicts === undefined) return;
  if (!isObject(verdicts)) {
    pushError(errors, path, 'verdict.map.type', `${path} must be an object map.`);
    return;
  }
  let noun = options.itemNoun || 'item';
  for (let [id, verdict] of Object.entries(verdicts)) {
    if (!CONFIG_VERDICT_VALUES.includes(verdict)) {
      pushError(errors, `${path}.${id}`, 'verdict.value', `${noun} verdict for "${id}" must be 'accepted' or 'blocked'.`);
    }
  }
  if (options.declaredIds) {
    for (let id of options.declaredIds) {
      if (!Object.prototype.hasOwnProperty.call(verdicts, id)) {
        pushError(errors, path, 'verdict.unreviewed', `Unreviewed ${noun} "${id}" has no verdict; review is required.`);
      }
    }
  }
}

function validateRequires(requires, errors, ctx) {
  if (requires === undefined) return;
  if (!isObject(requires)) {
    pushError(errors, 'requires', 'requires.type', 'requires must be an object.');
    return;
  }

  if (requires.packages !== undefined) validateRequirePackages(requires.packages, errors, ctx);
  if (requires.plugins !== undefined) validateRequirePlugins(requires.plugins, errors, ctx);
  if (requires.packs !== undefined) validateRequirePacks(requires.packs, errors);

  if (requires.hostServices !== undefined && !isObject(requires.hostServices)) {
    pushError(errors, 'requires.hostServices', 'requires.hostServices.type', 'requires.hostServices must be an object with { required, optional } arrays.');
  }
  if (requires.execution !== undefined && !hasText(requires.execution)) {
    pushError(errors, 'requires.execution', 'requires.execution.type', 'requires.execution must be a non-empty string hint.');
  }
}

function validateRequirePackages(packages, errors, ctx) {
  if (!Array.isArray(packages)) {
    pushError(errors, 'requires.packages', 'requires.packages.type', 'requires.packages must be an array.');
    return;
  }
  for (let i = 0; i < packages.length; i++) {
    let entry = packages[i];
    let path = `requires.packages[${i}]`;
    if (!isObject(entry)) {
      pushError(errors, path, 'requires.package.entry', 'Package requirement must be an object.');
      continue;
    }
    validatePortableId(entry.id, `${path}.id`, errors, {});
    if (hasText(entry.id)) ctx.declaredPackages.add(entry.id);
    if (!isSemverRange(entry.version)) {
      pushError(errors, `${path}.version`, 'requires.package.version', `Package "${entry.id}" version "${entry.version}" is not a valid semver range or exact version.`);
    }
  }
}

function validateRequirePlugins(plugins, errors, ctx) {
  if (!Array.isArray(plugins)) {
    pushError(errors, 'requires.plugins', 'requires.plugins.type', 'requires.plugins must be an array.');
    return;
  }
  for (let i = 0; i < plugins.length; i++) {
    let entry = plugins[i];
    let path = `requires.plugins[${i}]`;
    if (!isObject(entry)) {
      pushError(errors, path, 'requires.plugin.entry', 'Plugin requirement must be an object.');
      continue;
    }
    if (!hasText(entry.id) || !NAMESPACE_PATTERN.test(entry.id)) {
      pushError(errors, `${path}.id`, 'requires.plugin.id', `Plugin requirement id "${entry.id}" must be a valid namespace.`);
    } else {
      ctx.declaredPlugins.add(entry.id);
      ctx.plugins.push({ index: i, entry });
    }
    if (!isSemverRange(entry.version)) {
      pushError(errors, `${path}.version`, 'requires.plugin.version', `Plugin "${entry.id}" version "${entry.version}" is not a valid semver range or exact version.`);
    }
    if (!isIntegrity(entry.integrity)) {
      pushError(errors, `${path}.integrity`, 'requires.plugin.integrity', `Plugin "${entry.id}" requires a mandatory integrity string (sha256-<base64>).`);
    }
    if (entry.reviewedDigest !== undefined && !isIntegrity(entry.reviewedDigest)) {
      pushError(errors, `${path}.reviewedDigest`, 'requires.plugin.reviewedDigest', 'reviewedDigest must be an integrity string (sha256-<base64>).');
    }
    validateVerdictMap(entry.hooks, `${path}.hooks`, errors, { itemNoun: 'hook' });
  }
}

function validateRequirePacks(packs, errors) {
  if (!Array.isArray(packs)) {
    pushError(errors, 'requires.packs', 'requires.packs.type', 'requires.packs must be an array.');
    return;
  }
  for (let i = 0; i < packs.length; i++) {
    let entry = packs[i];
    let path = `requires.packs[${i}]`;
    if (!isObject(entry)) {
      pushError(errors, path, 'requires.pack.entry', 'Pack requirement must be an object.');
      continue;
    }
    validatePortableId(entry.id, `${path}.id`, errors, {});
    if (!isSemverRange(entry.version)) {
      pushError(errors, `${path}.version`, 'requires.pack.version', `Pack "${entry.id}" version "${entry.version}" is not a valid semver range or exact version.`);
    }
    if (!isIntegrity(entry.integrity)) {
      pushError(errors, `${path}.integrity`, 'requires.pack.integrity', `Pack "${entry.id}" requires a mandatory integrity string (sha256-<base64>).`);
    }
  }
}

function validateHostServicesAggregate(requires, ctx, errors) {
  if (!isObject(requires) || !isObject(requires.hostServices)) return;
  let aggregate = new Set();
  for (let key of ['required', 'optional']) {
    if (Array.isArray(requires.hostServices[key])) {
      for (let id of requires.hostServices[key]) {
        if (typeof id === 'string') aggregate.add(id);
      }
    }
  }
  for (let id of ctx.declaredHostServices) {
    if (!aggregate.has(id)) {
      pushError(errors, 'requires.hostServices', 'requires.hostServices.drift', `Aggregate requires.hostServices is missing "${id}" declared by a module; it must equal the union of module/plugin declarations.`);
    }
  }
}

function validateDeadDependencies(ctx, errors) {
  for (let { index, entry } of ctx.plugins) {
    let referenced = ctx.referencedPlugins.has(entry.id);
    let handlersOnly = entry.role === 'handlers-only';
    if (!referenced && !handlersOnly) {
      pushError(errors, `requires.plugins[${index}]`, 'requires.plugin.dead', `Plugin "${entry.id}" is declared but never referenced (no module, document-plane, or contributes-only use) and is not marked role:'handlers-only'.`);
    }
  }
}

function rejectDeletedConfigKeys(config, errors) {
  if (config.components !== undefined) {
    pushError(errors, 'components', 'modules.deleted.components', 'components.{catalog,custom,modules} is removed; declare modules in modules[].');
  }
  if (isObject(config.engine) && config.engine.packs !== undefined) {
    pushError(errors, 'engine.packs', 'modules.deleted.engine_packs', 'engine.packs is removed; declare packs in requires.packs.');
  }
  if (isObject(config.execution) && config.execution.hostServices !== undefined) {
    pushError(errors, 'execution.hostServices', 'modules.deleted.execution_hostServices', 'execution.hostServices is removed; declare host services in requires.hostServices.');
  }
  if (isObject(config.intent) && config.intent.hostServices !== undefined) {
    pushError(errors, 'intent.hostServices', 'modules.deleted.intent_hostServices', 'intent.hostServices is removed; declare host services in requires.hostServices.');
  }
}

/**
 * Validates the modules[] + requires{} planes of a workspace config.
 *
 * @param {any} config
 * @returns {Array<{path:string, code:string, message:string, severity:'error'}>}
 */
export function validateModulesConfig(config) {
  let errors = [];
  if (!isObject(config)) return errors;

  let ctx = {
    ids: new Set(),
    tagNames: new Set(),
    declaredPlugins: new Set(),
    declaredPackages: new Set(),
    referencedPlugins: new Set(),
    declaredHostServices: new Set(),
    plugins: [],
  };

  // Requires is read first so module source references can be checked against it.
  validateRequires(config.requires, errors, ctx);

  if (config.modules !== undefined) {
    if (!Array.isArray(config.modules)) {
      pushError(errors, 'modules', 'modules.type', 'modules must be an array.');
    } else {
      for (let i = 0; i < config.modules.length; i++) {
        validateModuleEntry(config.modules[i], i, errors, ctx);
      }
    }
  }

  validateHostServicesAggregate(config.requires, ctx, errors);
  validateDeadDependencies(ctx, errors);
  rejectDeletedConfigKeys(config, errors);

  return errors;
}

function collectModuleProviders(config) {
  if (!isObject(config) || !Array.isArray(config.modules)) return [];
  let providers = [];
  let seen = new Set();
  for (let i = 0; i < config.modules.length; i++) {
    let entry = config.modules[i];
    if (!isObject(entry) || !hasText(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    providers.push({ id: `module:${entry.id}`, path: `modules[${i}].id` });
  }
  return providers;
}

/**
 * The registerable MODULES section for the S1.0 validator core.
 *
 * @type {import('../../validation/core.js').ValidationSection}
 */
export const modulesSection = Object.freeze({
  id: 'modules',
  validate(config) {
    return validateModulesConfig(config);
  },
  refProviders: collectModuleProviders,
  refConsumers: () => [],
});

export default modulesSection;

export { hostServicesInclude };
