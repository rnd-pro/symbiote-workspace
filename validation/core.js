import {
  SEMVER_PATTERN,
  WORKSPACE_SCHEMA_VERSION,
} from '../schema/value-classes.js';

const registeredSections = new Map();
const WARNING_CODES = new Set([
  'structure.nav.dead_group',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeSeverity(issue) {
  if (issue.severity === 'warning' && WARNING_CODES.has(issue.code)) return 'warning';
  return 'error';
}

function normalizeIssue(issue, fallback = {}) {
  let code = hasText(issue?.code) ? issue.code : fallback.code || 'validation.error';
  let severity = normalizeSeverity({ ...issue, code });
  return {
    path: typeof issue?.path === 'string' ? issue.path : fallback.path || '',
    code,
    message: hasText(issue?.message) ? issue.message : fallback.message || 'Validation failed.',
    severity,
  };
}

function pushIssue(target, issue, suggestedPatches) {
  let normalized = normalizeIssue(issue);
  if (normalized.severity === 'warning') {
    target.warnings.push(normalized);
  } else {
    target.errors.push(normalized);
  }
  if (Array.isArray(issue?.suggestedPatches)) {
    suggestedPatches.push(...issue.suggestedPatches);
  }
}

function collectReturnedIssues(returned, target, suggestedPatches) {
  if (!returned) return;
  if (Array.isArray(returned)) {
    for (let issue of returned) pushIssue(target, issue, suggestedPatches);
    return;
  }
  if (!isObject(returned)) return;
  for (let issue of returned.errors || []) pushIssue(target, { ...issue, severity: 'error' }, suggestedPatches);
  for (let issue of returned.warnings || []) pushIssue(target, { ...issue, severity: 'warning' }, suggestedPatches);
  if (Array.isArray(returned.suggestedPatches)) suggestedPatches.push(...returned.suggestedPatches);
}

function createSectionContext(sectionId, target, suggestedPatches) {
  return {
    sectionId,
    error(path, code, message, options = {}) {
      pushIssue(target, { path, code, message, severity: 'error', ...options }, suggestedPatches);
    },
    warning(path, code, message, options = {}) {
      pushIssue(target, { path, code, message, severity: 'warning', ...options }, suggestedPatches);
    },
    issue(issue) {
      pushIssue(target, issue, suggestedPatches);
    },
    suggest(patch) {
      if (isObject(patch)) suggestedPatches.push(patch);
    },
  };
}

function normalizeRefHooks(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeRef(entry, sectionId, role, index, target, suggestedPatches) {
  if (typeof entry === 'string' && entry.trim()) {
    return { id: entry, path: '', sectionId };
  }
  if (isObject(entry) && typeof entry.id === 'string' && entry.id.trim()) {
    return {
      id: entry.id,
      path: typeof entry.path === 'string' ? entry.path : '',
      sectionId,
      optional: entry.optional === true,
      message: entry.message,
      code: entry.code,
      suggestedPatches: Array.isArray(entry.suggestedPatches) ? entry.suggestedPatches : undefined,
    };
  }
  pushIssue(target, {
    path: '',
    code: `references.invalid_${role}`,
    message: `Section "${sectionId}" returned an invalid ${role} reference at index ${index}.`,
    severity: 'error',
  }, suggestedPatches);
  return null;
}

function collectRefs(section, kind, config, target, suggestedPatches) {
  let refs = [];
  let hooks = normalizeRefHooks(section[kind]);
  for (let hook of hooks) {
    let returned;
    try {
      returned = typeof hook === 'function' ? hook(config) : hook;
    } catch (err) {
      pushIssue(target, {
        path: '',
        code: `section.${kind}.exception`,
        message: `Section "${section.id}" ${kind} failed: ${err.message}`,
        severity: 'error',
      }, suggestedPatches);
      continue;
    }
    let entries = Array.isArray(returned) ? returned : returned ? [returned] : [];
    for (let i = 0; i < entries.length; i++) {
      let ref = normalizeRef(entries[i], section.id, kind, i, target, suggestedPatches);
      if (ref) refs.push(ref);
    }
  }
  return refs;
}

function runShapePasses(config, target, suggestedPatches) {
  for (let section of registeredSections.values()) {
    if (typeof section.validate !== 'function') continue;
    let context = createSectionContext(section.id, target, suggestedPatches);
    try {
      collectReturnedIssues(section.validate(config, context), target, suggestedPatches);
    } catch (err) {
      pushIssue(target, {
        path: '',
        code: 'section.validate.exception',
        message: `Section "${section.id}" validator failed: ${err.message}`,
        severity: 'error',
      }, suggestedPatches);
    }
  }
}

function runReferentialPass(config, target, suggestedPatches) {
  let providers = new Map();
  let consumers = [];

  for (let section of registeredSections.values()) {
    for (let provider of collectRefs(section, 'refProviders', config, target, suggestedPatches)) {
      if (providers.has(provider.id)) {
        pushIssue(target, {
          path: provider.path,
          code: 'references.duplicate_provider',
          message: `Reference provider "${provider.id}" is declared more than once.`,
          severity: 'error',
        }, suggestedPatches);
        continue;
      }
      providers.set(provider.id, provider);
    }
    consumers.push(...collectRefs(section, 'refConsumers', config, target, suggestedPatches));
  }

  for (let consumer of consumers) {
    if (consumer.optional || providers.has(consumer.id)) continue;
    pushIssue(target, {
      path: consumer.path,
      code: consumer.code || 'references.unresolved',
      message: consumer.message || `Reference "${consumer.id}" does not resolve to a registered provider.`,
      severity: 'error',
      suggestedPatches: consumer.suggestedPatches,
    }, suggestedPatches);
  }
}

function versionParts(version) {
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) return null;
  let [major, minor] = version.split('.');
  return { major: Number(major), minor: Number(minor) };
}

function createReport(errors, warnings, suggestedPatches) {
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    suggestedPatches,
  };
}

/**
 * @typedef {Object} ValidationSection
 * @property {string} id - Unique section identifier.
 * @property {Function} [validate] - Shape-pass validator: (config, context) => issues.
 * @property {Function|Function[]|Array} [refProviders] - Reference addresses/ids this section provides.
 * @property {Function|Function[]|Array} [refConsumers] - Reference addresses/ids this section consumes.
 */

/**
 * Registers one target-schema validation section.
 *
 * @param {ValidationSection} section
 * @returns {Function} unregister callback
 */
export function registerSection(section) {
  if (!isObject(section)) throw new Error('registerSection expects a section object.');
  if (!hasText(section.id)) throw new Error('registerSection requires a non-empty section id.');
  if (registeredSections.has(section.id)) {
    throw new Error(`Validation section "${section.id}" is already registered.`);
  }
  if (section.validate !== undefined && typeof section.validate !== 'function') {
    throw new Error(`Validation section "${section.id}" validate must be a function.`);
  }
  registeredSections.set(section.id, {
    id: section.id,
    validate: section.validate,
    refProviders: section.refProviders,
    refConsumers: section.refConsumers,
  });
  return () => {
    registeredSections.delete(section.id);
  };
}

export function clearRegisteredSections() {
  registeredSections.clear();
}

export function getRegisteredSections() {
  return Object.freeze([...registeredSections.values()].map((section) => Object.freeze({ ...section })));
}

/**
 * @param {unknown} config
 * @returns {boolean}
 */
export function isCompatibleVersion(version) {
  let candidate = versionParts(version);
  let reader = versionParts(WORKSPACE_SCHEMA_VERSION);
  if (!candidate || !reader) return false;
  return candidate.major === reader.major && candidate.minor <= reader.minor;
}

/**
 * @param {unknown} config
 * @returns {{ok: boolean, errors: Array, warnings: Array, suggestedPatches: Array}}
 */
export function validateWorkspaceConfig(config) {
  let target = { errors: [], warnings: [] };
  let suggestedPatches = [];

  if (!isObject(config)) {
    pushIssue(target, {
      path: '',
      code: 'config.type',
      message: 'Workspace config must be a plain object.',
      severity: 'error',
    }, suggestedPatches);
    return createReport(target.errors, target.warnings, suggestedPatches);
  }

  if (!hasText(config.version)) {
    pushIssue(target, {
      path: 'version',
      code: 'version.required',
      message: 'Workspace config requires a non-empty version string.',
      severity: 'error',
    }, suggestedPatches);
  } else if (!SEMVER_PATTERN.test(config.version)) {
    pushIssue(target, {
      path: 'version',
      code: 'version.semver',
      message: `Workspace schema version "${config.version}" must be a semver string.`,
      severity: 'error',
    }, suggestedPatches);
  } else if (!isCompatibleVersion(config.version)) {
    pushIssue(target, {
      path: 'version',
      code: 'version.incompatible',
      message: `Workspace schema version "${config.version}" is not compatible with reader ${WORKSPACE_SCHEMA_VERSION}.`,
      severity: 'error',
    }, suggestedPatches);
  }

  runShapePasses(config, target, suggestedPatches);
  runReferentialPass(config, target, suggestedPatches);

  return createReport(target.errors, target.warnings, suggestedPatches);
}
