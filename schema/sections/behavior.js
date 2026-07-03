import {
  HOOK_CLASSES,
  HOOK_ACTION_KINDS,
  POLICY_MODES,
  GRANT_EXPIRIES,
  PRINCIPAL_KINDS,
  DEPLOYMENT_RECORD_STATUSES,
  NON_STRUCTURAL_PATH_PREFIXES,
  PORTABLE_ID_PATTERN,
  CATALOG_FINGERPRINT_PATTERN,
} from '../constants.js';
import { parseWorkspaceAddress } from '../was.js';
import { isGrantObject, isUrlShaped } from '../value-classes.js';

/**
 * BEHAVIOR & POLICY section (spec Section 6). Owns hooks[], provenance + narration
 * freshness, exports.shareKit, and the grant/consent/deployment record contracts.
 * The section registers into the S1.0 validator core as
 * `{ id, validate, refProviders, refConsumers }`; grants are rejected anywhere in
 * portable config through the S1.0 value classes (no forked grant detector).
 */

/**
 * Non-guard hook scheduling precedence (B1 / C7). Guard-class hooks are evaluated
 * synchronously (sequentially awaited, C3) BEFORE the gated action and are not part
 * of this order; every other class schedules after the triggering action resolves in
 * this precedence, then priority desc, then id lexicographic — a deterministic order
 * the governor consumes.
 */
export const HOOK_CLASS_PRECEDENCE = Object.freeze([
  'validate',
  'anomaly',
  'assist',
  'automate',
  'teach',
]);

/** Action kinds whose outcome can mutate config/documents (monotonic policy rule, B1). */
export const MUTATING_HOOK_ACTION_KINDS = Object.freeze(['propose-safe-action', 'invoke']);

/** Action kinds whose output is suggestion-only — the only kinds allowed `concurrent:true` (B4). */
export const SUGGESTION_ONLY_HOOK_ACTION_KINDS = Object.freeze(['annotate', 'suggest', 'ask-agent']);

/** WAS subject classes a hook trigger may address (B1; event:/binding: operands are wire ids, L1 ruling 5). */
export const HOOK_TRIGGER_SUBJECT_CLASSES = Object.freeze([
  'binding',
  'action',
  'event',
  'route',
  'state',
  'doc',
]);

export const HOOK_VISIBILITIES = Object.freeze(['chat', 'indicator', 'log']);
export const HOOK_DISMISSAL_SCOPES = Object.freeze(['subject', 'hook']);

/** decisions[].status vocabulary (B2). A dangling subject is only legal when status ≠ active. */
export const DECISION_STATUSES = Object.freeze(['active', 'superseded', 'orphaned']);

/** timelines[].source vocabulary (B2 staleness-repair on degraded hosts). */
export const TIMELINE_SOURCES = Object.freeze(['local', 'workspaceRef']);

/** provenance.lineage source ancestry kinds (L1 ruling 7). */
export const LINEAGE_SOURCE_KINDS = Object.freeze([
  'workspace-package',
  'plugin-template',
  'registry-listing',
]);

/** At most one modal confirm surface exists globally (C8). */
export const MAX_CONCURRENT_MODALS = 1;

/** agentChannel.invoke REQUIRES these fields at runtime (R-F2 / B4 arbitration). */
export const AGENT_CHANNEL_INVOKE_REQUIRED_FIELDS = Object.freeze(['contextId', 'signal']);

/** Fields an `applied` deployment record must carry (B7). */
export const DEPLOYMENT_APPLIED_REQUIRED_FIELDS = Object.freeze([
  'manifestHash',
  'configFingerprint',
  'packHashes',
  'shellVersion',
  'verdictId',
  'principal',
  'appliedAt',
]);

/** originContext discriminator for a consent token (B4). */
const CONSENT_ORIGIN_PATTERN = /^(?:construction|deployment|hook:[a-z][a-z0-9]*(?:[./:_-][a-z0-9]+)*)$/;

const ENTRY_PATH_PATTERN = /^\$entry\.[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPortableId(value) {
  return typeof value === 'string' && PORTABLE_ID_PATTERN.test(value);
}

function isIntegrity(value) {
  return typeof value === 'string' && CATALOG_FINGERPRINT_PATTERN.test(value);
}

function isInteger(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * A localizable-string slot is either a catalog reference `{ $t: <key> }` or an inline
 * `{ default, locales? }` record (L1 ruling 11). Plain strings are not accepted.
 *
 * @returns {boolean}
 */
function isLocalizableString(value) {
  if (!isObject(value)) return false;
  if (typeof value.$t === 'string') return value.$t.trim().length > 0;
  if (typeof value.default === 'string') {
    return value.locales === undefined || isObject(value.locales);
  }
  return false;
}

/**
 * Parses a WAS subject and returns its address, or null when it is not grammar-valid.
 *
 * @param {unknown} value
 * @returns {{ className: string }|null}
 */
function parseSubject(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return parseWorkspaceAddress(value);
  } catch {
    return null;
  }
}

/**
 * Walks every object node of the config and reports any grant object, wherever it sits.
 * Grants are session/host tier state and must NEVER travel in portable config (B4).
 * Detection reuses the S1.0 `isGrantObject` value class — no forked grant shape.
 */
function reportEmbeddedGrants(config, ctx) {
  let seen = new Set();
  let walk = (value, path) => {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) walk(value[i], `${path}[${i}]`);
      return;
    }
    if (!isObject(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (isGrantObject(value)) {
      ctx.error(
        path,
        'behavior.grant.embedded',
        'A grant object is session/host tier state and must not appear in portable config.',
      );
      return;
    }
    for (let key of Object.keys(value)) {
      walk(value[key], path ? `${path}.${key}` : key);
    }
  };
  walk(config, '');
}

function validateLocalizable(value, path, code, ctx) {
  if (!isLocalizableString(value)) {
    ctx.error(path, code, 'Value must be a localizable string ({$t} or {default, locales?}).');
    return false;
  }
  return true;
}

function validateHookTrigger(hook, path, ctx) {
  let trigger = hook.trigger;
  if (!isObject(trigger)) {
    ctx.error(`${path}.trigger`, 'behavior.hook.trigger.required', 'Hook requires a trigger object.');
    return null;
  }
  let subject = parseSubject(trigger.subject);
  if (!subject) {
    ctx.error(
      `${path}.trigger.subject`,
      'behavior.hook.subject.malformed',
      'Hook trigger.subject must parse as a WAS subject-class address.',
    );
    return null;
  }
  if (!HOOK_TRIGGER_SUBJECT_CLASSES.includes(subject.className)) {
    ctx.error(
      `${path}.trigger.subject`,
      'behavior.hook.subject.class',
      `Hook trigger.subject class "${subject.className}" is not one of ${HOOK_TRIGGER_SUBJECT_CLASSES.join('|')}.`,
    );
    return null;
  }
  if (trigger.once !== undefined && typeof trigger.once !== 'boolean') {
    ctx.error(`${path}.trigger.once`, 'behavior.hook.trigger.once', 'trigger.once must be a boolean.');
  }
  return subject;
}

function collectContextAllow(hook, path, ctx) {
  let context = hook.context;
  let allow = new Set();
  if (context === undefined) return allow;
  if (!isObject(context)) {
    ctx.error(`${path}.context`, 'behavior.hook.context.type', 'Hook context must be an object.');
    return allow;
  }
  if (context.allow !== undefined) {
    if (!Array.isArray(context.allow)) {
      ctx.error(`${path}.context.allow`, 'behavior.hook.context.allow.type', 'context.allow must be an array.');
    } else {
      context.allow.forEach((entry, index) => {
        if (typeof entry !== 'string' || !ENTRY_PATH_PATTERN.test(entry)) {
          ctx.error(
            `${path}.context.allow[${index}]`,
            'behavior.hook.context.allow.entry',
            'context.allow entries must be $entry. paths.',
          );
          return;
        }
        allow.add(entry);
      });
    }
  }
  if (context.maxBytes !== undefined && !isInteger(context.maxBytes)) {
    ctx.error(`${path}.context.maxBytes`, 'behavior.hook.context.maxBytes', 'context.maxBytes must be an integer.');
  }
  return allow;
}

function validateHookDismissal(hook, allow, path, ctx) {
  let dismissal = hook.dismissal;
  if (dismissal === undefined) return;
  if (!isObject(dismissal)) {
    ctx.error(`${path}.dismissal`, 'behavior.hook.dismissal.type', 'Hook dismissal must be an object.');
    return;
  }
  let scope = dismissal.scope === undefined ? 'hook' : dismissal.scope;
  if (!HOOK_DISMISSAL_SCOPES.includes(scope)) {
    ctx.error(
      `${path}.dismissal.scope`,
      'behavior.hook.dismissal.scope',
      `dismissal.scope must be one of ${HOOK_DISMISSAL_SCOPES.join('|')}.`,
    );
    return;
  }
  if (scope !== 'subject') return;
  if (typeof dismissal.subjectKey !== 'string' || !ENTRY_PATH_PATTERN.test(dismissal.subjectKey)) {
    ctx.error(
      `${path}.dismissal.subjectKey`,
      'behavior.hook.dismissal.subjectKey',
      'Subject-scoped dismissal requires a $entry. subjectKey.',
    );
    return;
  }
  if (!allow.has(dismissal.subjectKey)) {
    ctx.error(
      `${path}.dismissal.subjectKey`,
      'behavior.hook.dismissal.uncollected',
      'dismissal.subjectKey must be present in context.allow.',
    );
  }
}

function hostServiceIds(config) {
  let services = config?.requires?.hostServices;
  let ids = new Set();
  if (Array.isArray(services)) {
    for (let id of services) if (typeof id === 'string') ids.add(id);
    return ids;
  }
  if (isObject(services)) {
    for (let bucket of [services.required, services.optional]) {
      if (Array.isArray(bucket)) for (let id of bucket) if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

function validateHookAction(hook, config, allow, path, ctx) {
  let action = hook.action;
  if (!isObject(action)) {
    ctx.error(`${path}.action`, 'behavior.hook.action.required', 'Hook requires an action object.');
    return;
  }
  if (!HOOK_ACTION_KINDS.includes(action.kind)) {
    ctx.error(
      `${path}.action.kind`,
      'behavior.hook.action.kind',
      `Hook action.kind must be one of ${HOOK_ACTION_KINDS.join('|')}.`,
    );
    return;
  }
  if (action.kind === 'ask-agent' && !isInteger(hook.context?.maxBytes)) {
    ctx.error(`${path}.context.maxBytes`, 'behavior.hook.askAgent.maxBytes', 'ask-agent actions require context.maxBytes.');
  }
  if (action.kind === 'invoke') validateInvokeAction(action, config, allow, path, ctx);
}

function validateInvokeAction(action, config, allow, path, ctx) {
  let target = action.target;
  if (!isObject(target)) {
    ctx.error(`${path}.action.target`, 'behavior.hook.invoke.target', 'invoke actions require a target.');
    return;
  }
  if (typeof target.hostService === 'string') {
    if (!hostServiceIds(config).has(target.hostService)) {
      ctx.error(
        `${path}.action.target.hostService`,
        'behavior.hook.invoke.hostService',
        `invoke target host service "${target.hostService}" must appear in requires.hostServices.`,
      );
    }
  } else if (typeof target.engine !== 'string') {
    ctx.error(
      `${path}.action.target`,
      'behavior.hook.invoke.target.kind',
      'invoke target must declare a hostService or engine.',
    );
  }
  if (action.args !== undefined) {
    if (!isObject(action.args)) {
      ctx.error(`${path}.action.args`, 'behavior.hook.invoke.args.type', 'invoke args must be an object.');
    } else {
      for (let [name, value] of Object.entries(action.args)) {
        if (typeof value === 'string' && value.startsWith('$')) {
          if (!allow.has(value)) {
            ctx.error(
              `${path}.action.args.${name}`,
              'behavior.hook.invoke.args.source',
              `invoke arg "${name}" references "${value}", which is not in context.allow.`,
            );
          }
        }
      }
    }
  }
}

function validateHookPolicy(hook, path, ctx) {
  let policy = hook.policy;
  let mode;
  if (policy !== undefined) {
    if (!isObject(policy) || !POLICY_MODES.includes(policy.mode)) {
      ctx.error(`${path}.policy.mode`, 'behavior.hook.policy.mode', `policy.mode must be one of ${POLICY_MODES.join('|')}.`);
    } else {
      mode = policy.mode;
    }
  }
  let kind = isObject(hook.action) ? hook.action.kind : undefined;
  if (mode === 'silent' && kind === 'ask-agent') {
    ctx.error(`${path}.policy.mode`, 'behavior.hook.askAgent.silent', 'ask-agent actions can never run silent.');
  }
  // Monotonic rule: `auto` is only reachable for non-mutating outcomes. A grant could
  // widen this, but grants never travel in portable config, so an `auto` mutating-capable
  // action is unconditionally rejected at validate.
  if (mode === 'auto' && MUTATING_HOOK_ACTION_KINDS.includes(kind)) {
    ctx.error(
      `${path}.policy.mode`,
      'behavior.hook.policy.monotonic',
      `policy.mode:'auto' is not allowed on the mutating-capable action kind "${kind}" without grant coverage.`,
    );
  }
}

function validateHook(hook, index, config, ctx, ids) {
  let path = `hooks[${index}]`;
  if (!isObject(hook)) {
    ctx.error(path, 'behavior.hook.type', 'Each hook must be an object.');
    return;
  }
  if (!isPortableId(hook.id)) {
    ctx.error(`${path}.id`, 'behavior.hook.id', 'Hook id must be a portable id.');
  } else if (ids.has(hook.id)) {
    ctx.error(`${path}.id`, 'behavior.hook.id.duplicate', `Duplicate hook id "${hook.id}".`);
  } else {
    ids.add(hook.id);
  }
  if (!HOOK_CLASSES.includes(hook.class)) {
    ctx.error(`${path}.class`, 'behavior.hook.class', `Hook class must be one of ${HOOK_CLASSES.join('|')}.`);
  }
  if (hook.title !== undefined) validateLocalizable(hook.title, `${path}.title`, 'behavior.hook.title', ctx);
  if (hook.visibility !== undefined && !HOOK_VISIBILITIES.includes(hook.visibility)) {
    ctx.error(`${path}.visibility`, 'behavior.hook.visibility', `Hook visibility must be one of ${HOOK_VISIBILITIES.join('|')}.`);
  }
  if (hook.priority !== undefined && !isInteger(hook.priority)) {
    ctx.error(`${path}.priority`, 'behavior.hook.priority', 'Hook priority must be an integer.');
  }

  validateHookTrigger(hook, path, ctx);
  let allow = collectContextAllow(hook, path, ctx);
  validateHookDismissal(hook, allow, path, ctx);
  validateHookAction(hook, config, allow, path, ctx);
  validateHookPolicy(hook, path, ctx);

  let kind = isObject(hook.action) ? hook.action.kind : undefined;
  if (hook.class === 'teach' && hook.trigger?.once !== true) {
    ctx.error(`${path}.trigger.once`, 'behavior.hook.teach.once', "class:'teach' hooks require trigger.once:true.");
  }
  if (hook.concurrent === true && !SUGGESTION_ONLY_HOOK_ACTION_KINDS.includes(kind)) {
    ctx.error(
      `${path}.concurrent`,
      'behavior.hook.concurrent',
      "concurrent:true is only legal for suggestion-only action kinds (annotate|suggest|ask-agent).",
    );
  } else if (hook.concurrent !== undefined && typeof hook.concurrent !== 'boolean') {
    ctx.error(`${path}.concurrent`, 'behavior.hook.concurrent.type', 'concurrent must be a boolean.');
  }
}

function validateHooks(config, ctx) {
  if (config.hooks === undefined) return;
  if (!Array.isArray(config.hooks)) {
    ctx.error('hooks', 'behavior.hooks.type', 'hooks must be an array.');
    return;
  }
  let ids = new Set();
  config.hooks.forEach((hook, index) => validateHook(hook, index, config, ctx, ids));
}

function validateLineage(lineage, path, ctx) {
  if (!isObject(lineage)) {
    ctx.error(path, 'behavior.lineage.type', 'provenance.lineage must be an object.');
    return;
  }
  let extra = Object.keys(lineage).filter((key) => key !== 'source' && key !== 'baseRevision');
  if (extra.length > 0) {
    ctx.error(path, 'behavior.lineage.unknown', `provenance.lineage carries no timestamps/identity: unexpected ${extra.join(', ')}.`);
  }
  if (!isInteger(lineage.baseRevision)) {
    ctx.error(`${path}.baseRevision`, 'behavior.lineage.baseRevision', 'lineage.baseRevision must be an integer.');
  }
  let source = lineage.source;
  if (!isObject(source)) {
    ctx.error(`${path}.source`, 'behavior.lineage.source', 'lineage.source must be an object.');
    return;
  }
  let sourceExtra = Object.keys(source).filter((key) => !['kind', 'id', 'version', 'integrity'].includes(key));
  if (sourceExtra.length > 0) {
    ctx.error(`${path}.source`, 'behavior.lineage.source.unknown', `lineage.source carries no timestamps/URLs/identity: unexpected ${sourceExtra.join(', ')}.`);
  }
  if (!LINEAGE_SOURCE_KINDS.includes(source.kind)) {
    ctx.error(`${path}.source.kind`, 'behavior.lineage.source.kind', `lineage.source.kind must be one of ${LINEAGE_SOURCE_KINDS.join('|')}.`);
  }
  if (!isPortableId(source.id) || isUrlShaped(source.id)) {
    ctx.error(`${path}.source.id`, 'behavior.lineage.source.id', 'lineage.source.id must be a portable id (never a URL).');
  }
  if (typeof source.version !== 'string' || isUrlShaped(source.version)) {
    ctx.error(`${path}.source.version`, 'behavior.lineage.source.version', 'lineage.source.version must be a version string.');
  }
  if (!isIntegrity(source.integrity)) {
    ctx.error(`${path}.source.integrity`, 'behavior.lineage.source.integrity', 'lineage.source.integrity must be a sha256 integrity string.');
  }
}

function validateProvenance(config, ctx) {
  let provenance = config.provenance;
  if (provenance === undefined) return;
  if (!isObject(provenance)) {
    ctx.error('provenance', 'behavior.provenance.type', 'provenance must be an object.');
    return;
  }
  let known = new Set(['brief', 'register', 'template', 'revision', 'decisions', 'lineage']);
  for (let key of Object.keys(provenance)) {
    if (!known.has(key)) {
      ctx.error(`provenance.${key}`, 'behavior.provenance.unknown', `Unknown provenance field "${key}" (intent/construction/patches/validation logs are session tier).`);
    }
  }
  if (provenance.revision !== undefined && !isInteger(provenance.revision)) {
    ctx.error('provenance.revision', 'behavior.provenance.revision', 'provenance.revision must be an integer.');
  }
  if (provenance.lineage !== undefined) validateLineage(provenance.lineage, 'provenance.lineage', ctx);
  if (provenance.decisions !== undefined) {
    if (!Array.isArray(provenance.decisions)) {
      ctx.error('provenance.decisions', 'behavior.decisions.type', 'provenance.decisions must be an array.');
    } else {
      provenance.decisions.forEach((decision, index) => validateDecision(decision, index, ctx));
    }
  }
}

function validateDecision(decision, index, ctx) {
  let path = `provenance.decisions[${index}]`;
  if (!isObject(decision)) {
    ctx.error(path, 'behavior.decision.type', 'Each decision must be an object.');
    return;
  }
  if (!isPortableId(decision.id)) {
    ctx.error(`${path}.id`, 'behavior.decision.id', 'decision.id must be a portable id.');
  }
  if (!parseSubject(decision.subject)) {
    ctx.error(`${path}.subject`, 'behavior.decision.subject.malformed', 'decision.subject must parse as a WAS address.');
  }
  if (!DECISION_STATUSES.includes(decision.status)) {
    ctx.error(`${path}.status`, 'behavior.decision.status', `decision.status must be one of ${DECISION_STATUSES.join('|')}.`);
  }
  if (decision.title !== undefined) validateLocalizable(decision.title, `${path}.title`, 'behavior.decision.title', ctx);
  if (decision.revision !== undefined && !isInteger(decision.revision)) {
    ctx.error(`${path}.revision`, 'behavior.decision.revision', 'decision.revision must be an integer.');
  }
  if (decision.supersededBy !== undefined && !isPortableId(decision.supersededBy)) {
    ctx.error(`${path}.supersededBy`, 'behavior.decision.supersededBy', 'decision.supersededBy must be a portable decision id.');
  }
}

function validateNarration(config, ctx) {
  let narration = config.narration;
  if (narration === undefined) return;
  if (!isObject(narration)) {
    ctx.error('narration', 'behavior.narration.type', 'narration must be an object.');
    return;
  }
  if (Object.hasOwn(narration, 'locales')) {
    // Deleted island (L1 ruling 6): locale variants ride top-level i18n.locales.
    ctx.error('narration.locales', 'behavior.narration.locales.deleted', 'narration.locales is deleted — locale variants ride i18n.locales.');
  }
  validateNarrationRecords(narration.timelines, 'narration.timelines', ctx, true);
  validateNarrationRecords(narration.enrichment, 'narration.enrichment', ctx, false);
}

function validateNarrationRecords(records, path, ctx, isTimeline) {
  if (records === undefined) return;
  if (!Array.isArray(records)) {
    ctx.error(path, 'behavior.narration.records.type', `${path} must be an array.`);
    return;
  }
  records.forEach((record, index) => {
    let recordPath = `${path}[${index}]`;
    if (!isObject(record)) {
      ctx.error(recordPath, 'behavior.narration.record.type', 'Narration record must be an object.');
      return;
    }
    // Every narration record is stamped with the config revision it was built at, so the
    // freshness classifier can compare it against later structural revisions (B2, R19).
    if (record.revision !== undefined && !isInteger(record.revision)) {
      ctx.error(`${recordPath}.revision`, 'behavior.narration.record.revision', 'Narration record.revision must be an integer.');
    }
    if (isTimeline && !TIMELINE_SOURCES.includes(record.source)) {
      ctx.error(`${recordPath}.source`, 'behavior.timeline.source', `timelines[].source must be one of ${TIMELINE_SOURCES.join('|')}.`);
    }
  });
}

function validateShareKit(config, ctx) {
  let exportsBlock = config.exports;
  if (exportsBlock === undefined) return;
  if (!isObject(exportsBlock)) {
    ctx.error('exports', 'behavior.exports.type', 'exports must be an object.');
    return;
  }
  let shareKit = exportsBlock.shareKit;
  if (shareKit === undefined) return;
  if (!isObject(shareKit)) {
    ctx.error('exports.shareKit', 'behavior.shareKit.type', 'exports.shareKit must be an object.');
    return;
  }
  if (shareKit.workspaceRef !== undefined) validateWorkspaceRef(shareKit.workspaceRef, ctx);
  if (shareKit.listing !== undefined) validateListing(shareKit.listing, ctx);
}

function validateWorkspaceRef(ref, ctx) {
  if (!isObject(ref)) {
    ctx.error('exports.shareKit.workspaceRef', 'behavior.workspaceRef.type', 'workspaceRef must be an object.');
    return;
  }
  if (typeof ref.ref === 'string' && isUrlShaped(ref.ref)) {
    ctx.error('exports.shareKit.workspaceRef.ref', 'behavior.workspaceRef.url', 'workspaceRef.ref is a registry/package ref, never a raw URL.');
  }
  if (ref.integrity !== undefined && !isIntegrity(ref.integrity)) {
    ctx.error('exports.shareKit.workspaceRef.integrity', 'behavior.workspaceRef.integrity', 'workspaceRef.integrity must be a sha256 integrity string.');
  }
}

function validateListing(listing, ctx) {
  let path = 'exports.shareKit.listing';
  if (!isObject(listing)) {
    ctx.error(path, 'behavior.listing.type', 'shareKit.listing must be an object.');
    return;
  }
  for (let field of ['registry', 'listingId', 'version', 'publishedAt', 'integrity']) {
    let value = listing[field];
    if (value === undefined || value === null || value === '') {
      ctx.error(`${path}.${field}`, 'behavior.listing.incomplete', `shareKit.listing requires "${field}".`);
    } else if (typeof value === 'string' && isUrlShaped(value)) {
      ctx.error(`${path}.${field}`, 'behavior.listing.url', `shareKit.listing.${field} must not be URL-shaped.`);
    }
  }
  if (listing.integrity !== undefined && !isIntegrity(listing.integrity)) {
    ctx.error(`${path}.integrity`, 'behavior.listing.integrity', 'shareKit.listing.integrity must be a sha256 integrity string.');
  }
}

/**
 * Shape-pass validator for the BEHAVIOR section. Receives the whole config and the
 * S1.0 section context (`ctx.error(path, code, message, options?)`).
 */
function validate(config, ctx) {
  if (!isObject(config)) return;
  validateHooks(config, ctx);
  validateProvenance(config, ctx);
  validateNarration(config, ctx);
  validateShareKit(config, ctx);
  reportEmbeddedGrants(config, ctx);
}

/**
 * Every hook id is a referenceable provider so guard consumers (routes/guards) resolve
 * a `hook:<id>` target against a real hook at integration.
 */
function refProviders(config) {
  if (!Array.isArray(config?.hooks)) return [];
  let providers = [];
  config.hooks.forEach((hook, index) => {
    if (isObject(hook) && isPortableId(hook.id)) {
      providers.push({ id: `hook:${hook.id}`, path: `hooks[${index}].id` });
    }
  });
  return providers;
}

/**
 * Hook trigger subjects and active decision subjects are WAS references that must resolve
 * against the assembled registry. Grammar is enforced in the shape pass; existence is
 * resolved here by canonical WAS-string identity. Decision history (status ≠ active) may
 * dangle, so those consumers are optional with a suggestedPatch flipping active→orphaned.
 */
function refConsumers(config) {
  let consumers = [];
  if (Array.isArray(config?.hooks)) {
    config.hooks.forEach((hook, index) => {
      let subject = parseSubject(hook?.trigger?.subject);
      if (subject) {
        consumers.push({
          id: subject.raw,
          path: `hooks[${index}].trigger.subject`,
          code: 'behavior.hook.subject.unresolved',
          message: `Hook trigger subject "${subject.raw}" does not resolve to a registered target.`,
        });
      }
    });
  }
  let decisions = config?.provenance?.decisions;
  if (Array.isArray(decisions)) {
    decisions.forEach((decision, index) => {
      let subject = parseSubject(decision?.subject);
      if (!subject) return;
      let active = decision.status === 'active';
      consumers.push({
        id: subject.raw,
        path: `provenance.decisions[${index}].subject`,
        optional: !active,
        code: 'behavior.decision.subject.dangling',
        message: `Active decision subject "${subject.raw}" is dangling; flip status to orphaned.`,
        suggestedPatches: active
          ? [{ op: 'replace', path: `/provenance/decisions/${index}/status`, value: 'orphaned' }]
          : undefined,
      });
    });
  }
  return consumers;
}

export const behaviorSection = Object.freeze({
  id: 'behavior',
  validate,
  refProviders,
  refConsumers,
});

/**
 * Non-guard hook schedule comparator (B1 / C7): class precedence, then priority desc,
 * then id lexicographic. Guard-class hooks preempt and are ordered separately.
 *
 * @param {{class: string, priority?: number, id: string}} a
 * @param {{class: string, priority?: number, id: string}} b
 * @returns {number}
 */
export function compareHookSchedule(a, b) {
  let classDelta = HOOK_CLASS_PRECEDENCE.indexOf(a.class) - HOOK_CLASS_PRECEDENCE.indexOf(b.class);
  if (classDelta !== 0) return classDelta;
  let priorityDelta = (b.priority || 0) - (a.priority || 0);
  if (priorityDelta !== 0) return priorityDelta;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * A path is structural for freshness when it does NOT sit under a narration/provenance/
 * listing prefix (B2 freshness classifier). The classifier reads only the exported
 * `NON_STRUCTURAL_PATH_PREFIXES` — never a local list.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isStructuralChangePath(path) {
  if (typeof path !== 'string') return false;
  return !NON_STRUCTURAL_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

function makeResult(errors) {
  return { ok: errors.length === 0, errors };
}

/**
 * Validates a grant record (host/session tier). Grants never travel in portable config
 * (see the section validator) — this contract validates the store-side shape.
 *
 * @param {unknown} grant
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateGrantRecord(grant) {
  let errors = [];
  if (!isObject(grant)) return makeResult(['grant must be an object.']);
  if (!isPortableId(grant.id)) errors.push('grant.id must be a portable id.');
  if (!isObject(grant.principal) || !PRINCIPAL_KINDS.includes(grant.principal.kind)) {
    errors.push(`grant.principal.kind must be one of ${PRINCIPAL_KINDS.join('|')}.`);
  }
  if (!Array.isArray(grant.scope) || grant.scope.length === 0) errors.push('grant.scope must be a non-empty array.');
  if (!Array.isArray(grant.kinds) || grant.kinds.length === 0) errors.push('grant.kinds must be a non-empty array.');
  if (!GRANT_EXPIRIES.includes(grant.expiry)) errors.push(`grant.expiry must be one of ${GRANT_EXPIRIES.join('|')}.`);
  if (grant.expiry === 'task' && typeof grant.taskId !== 'string') errors.push("grant.expiry:'task' requires a taskId.");
  if (!isObject(grant.mintedBy)) errors.push('grant.mintedBy must be an object.');
  if (typeof grant.mintedAt !== 'string' || grant.mintedAt.trim() === '') errors.push('grant.mintedAt must be a timestamp string.');
  return makeResult(errors);
}

/**
 * Validates a consent token (B4). One token authorizes the same-trace fan-out of a
 * confirmed command within its footprint.
 *
 * @param {unknown} token
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateConsentToken(token) {
  let errors = [];
  if (!isObject(token)) return makeResult(['consent token must be an object.']);
  if (typeof token.confirmId !== 'string' || token.confirmId.trim() === '') errors.push('token.confirmId is required.');
  if (!isIntegrity(token.commandFingerprint)) errors.push('token.commandFingerprint must be a sha256 integrity string.');
  if (!isInteger(token.baseRevision)) errors.push('token.baseRevision must be an integer.');
  if (!Array.isArray(token.footprint) || token.footprint.length === 0) errors.push('token.footprint must be a non-empty array.');
  if (typeof token.originContext !== 'string' || !CONSENT_ORIGIN_PATTERN.test(token.originContext)) {
    errors.push("token.originContext must be 'construction', 'deployment', or 'hook:<id>'.");
  }
  if (typeof token.verdictId !== 'string' || token.verdictId.trim() === '') errors.push('token.verdictId is required.');
  return makeResult(errors);
}

/**
 * Validates one deployment record (B7). `applied` records must carry the full durable
 * tuple; `expedited:true` implies `reviewRequired:true`. The rolledBack-successor rule
 * is a cross-record check — see {@link validateDeploymentRecords}.
 *
 * @param {unknown} record
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateDeploymentRecord(record) {
  let errors = [];
  if (!isObject(record)) return makeResult(['deployment record must be an object.']);
  if (typeof record.recordId !== 'string' || record.recordId.trim() === '') errors.push('record.recordId is required.');
  if (!DEPLOYMENT_RECORD_STATUSES.includes(record.status)) {
    errors.push(`record.status must be one of ${DEPLOYMENT_RECORD_STATUSES.join('|')}.`);
  }
  if (record.status === 'applied') {
    for (let field of DEPLOYMENT_APPLIED_REQUIRED_FIELDS) {
      if (record[field] === undefined || record[field] === null || record[field] === '') {
        errors.push(`applied deployment record requires "${field}".`);
      }
    }
  }
  if (record.expedited === true && record.reviewRequired !== true) {
    errors.push('expedited:true implies reviewRequired:true.');
  }
  return makeResult(errors);
}

/**
 * Validates a deployment-record set. Each record is field-validated, and every
 * `rolledBack` record must have a successor record pinning it via previousRecordId.
 *
 * @param {unknown[]} records
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateDeploymentRecords(records) {
  let errors = [];
  if (!Array.isArray(records)) return makeResult(['deployment records must be an array.']);
  let successors = new Set();
  for (let record of records) {
    if (isObject(record) && typeof record.previousRecordId === 'string') successors.add(record.previousRecordId);
  }
  records.forEach((record, index) => {
    let result = validateDeploymentRecord(record);
    for (let message of result.errors) errors.push(`records[${index}]: ${message}`);
    if (isObject(record) && record.status === 'rolledBack' && !successors.has(record.recordId)) {
      errors.push(`records[${index}]: rolledBack record "${record.recordId}" has no successor record.`);
    }
  });
  return makeResult(errors);
}

export default behaviorSection;
