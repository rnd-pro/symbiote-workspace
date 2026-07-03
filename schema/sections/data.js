import {
  PORTABLE_ID_PATTERN,
  CAPABILITY_ID_PATTERN,
  COLLECTION_ITEM_KINDS,
  ASSET_KINDS,
  RESOURCE_OPERATIONS,
  I18N_STRATEGIES,
  CONTENT_INLINE_ENTRY_MAX_BYTES,
  CONTENT_SECTION_INLINE_MAX_BYTES,
  FRAGMENT_SLOTS,
  RUN_STATUSES,
  TRIGGER_KINDS,
  PRINCIPAL_KINDS,
} from '../constants.js';
import { isUrlShaped } from '../value-classes.js';
import {
  validateRecordSchema,
  validateRecordValue,
  isRecordSchema,
} from '../record-schema.js';

export const DATA_SECTION_ID = 'data';

/** Reserved CRUD engine-pack socket-type names so vendors converge (D3). */
export const RESOURCE_CRUD_SOCKET_TYPES = Object.freeze([
  'filter',
  'sort',
  'cursor',
  'record',
  'recordList',
]);

/** Only pagination mode landing now (D3); constant exported for consumers. */
export const RESOURCE_PAGINATION_MODES = Object.freeze(['cursor']);

export const RESOURCE_SORT_DIRECTIONS = Object.freeze(['asc', 'desc']);

const SRI_INTEGRITY_PATTERN = /^(?:sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/;
const ASSET_KIND_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/;
const BCP47_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;
const L10N_BANNED_KEYS = Object.freeze(['msg', '$loc', '$i18n']);

/**
 * Document ENVELOPE (R4). Collections own a validated metadata envelope; the
 * body stays kind-specific. `enabled` is the server-plane desired-state home.
 */
export const DOCUMENT_ENVELOPE_SCHEMA = Object.freeze({
  id: 'DOCUMENT_ENVELOPE',
  required: Object.freeze(['id', 'name', 'tags', 'revision']),
  properties: Object.freeze({
    id: 'runtime-minted document id',
    name: 'display name',
    tags: 'string[] labels',
    enabled: 'boolean desired-state (server-plane activation)',
    folder: 'optional organizational path id',
    revision: 'monotonic per-document revision',
  }),
});

/**
 * Per-document undo entry (D1.4). Session-tier state — never part of the
 * document body, never exported, never revisioned config.
 */
export const DOCUMENT_HISTORY_ENTRY_SCHEMA = Object.freeze({
  id: 'DOCUMENT_HISTORY_ENTRY',
  required: Object.freeze(['ops', 'inverseOps', 'actor', 'at']),
  properties: Object.freeze({
    ops: 'JSON-Pointer ops (schema/config-path.js grammar)',
    inverseOps: 'inverse ops for undo',
    actor: '{ principal: { kind } } authorship',
    at: 'epoch milliseconds',
    label: 'optional human label',
    coalesceKey: 'optional gesture coalescing key',
  }),
  principalKinds: PRINCIPAL_KINDS,
});

/**
 * Execution record (D7). Durable projection of the engine's execution log —
 * host-side runtime data, never portable config. Exported for the server
 * plane, inspection UI, and narration.
 */
export const EXECUTION_RECORD_SCHEMA = Object.freeze({
  id: 'EXECUTION_RECORD',
  required: Object.freeze(['runId', 'graphId', 'status', 'startedAt']),
  properties: Object.freeze({
    runId: 'runtime-minted run id',
    graphId: 'source graph id',
    doc: 'doc:<collection>:<id> linkage',
    status: 'run status',
    startedAt: 'epoch milliseconds',
    endedAt: 'epoch milliseconds',
    timing: '{ totalMs }',
    nodes: 'per-node { nodeId, status, timeMs, cached, skipped, io }',
    actor: '{ principal: { kind }, trigger }',
    replay: '{ cacheMode, inputsRef }',
  }),
  statuses: RUN_STATUSES,
  triggers: TRIGGER_KINDS,
  principalKinds: PRINCIPAL_KINDS,
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pushError(errors, path, code, message) {
  errors.push({ path, code, message, severity: 'error' });
}

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
}

function validatePortableId(id, path, errors, seen, label) {
  if (typeof id !== 'string' || !id.trim()) {
    pushError(errors, path, 'data.id', `${label} requires a non-empty portable id.`);
    return false;
  }
  if (!PORTABLE_ID_PATTERN.test(id)) {
    pushError(errors, path, 'data.id', `${label} id "${id}" must be a portable identifier, not a URL or path.`);
    return false;
  }
  if (seen) {
    if (seen.has(id)) {
      pushError(errors, path, 'data.id.duplicate', `Duplicate ${label} id "${id}".`);
      return false;
    }
    seen.add(id);
  }
  return true;
}

function collectDeclaredHostServices(config) {
  let declared = new Set();
  let hostServices = config?.requires?.hostServices;
  if (!isObject(hostServices)) return declared;
  for (let key of ['required', 'optional']) {
    if (Array.isArray(hostServices[key])) {
      for (let id of hostServices[key]) if (typeof id === 'string') declared.add(id);
    }
  }
  return declared;
}

function createL10nValidator(i18nContext) {
  return function validateL10n(value, path, errors, options = {}) {
    if (typeof value === 'string') {
      if (options.catalogValue) {
        pushError(errors, path, 'data.l10n.form', 'Catalog message values must use the object form { default, locales? }.');
      }
      return;
    }
    if (!isObject(value)) {
      pushError(errors, path, 'data.l10n.type', 'Localizable string must be a string or object.');
      return;
    }
    for (let banned of L10N_BANNED_KEYS) {
      if (Object.prototype.hasOwnProperty.call(value, banned)) {
        pushError(errors, path, 'data.l10n.form', `Localizable string uses "${banned}"; the one supported catalog form is { "$t": <key> }.`);
        return;
      }
    }
    if (Object.prototype.hasOwnProperty.call(value, '$t')) {
      if (options.catalogValue) {
        pushError(errors, path, 'data.l10n.form', 'Catalog message values may not recurse through { "$t" }.');
        return;
      }
      if (typeof value.$t !== 'string' || !value.$t.trim()) {
        pushError(errors, path, 'data.l10n.catalog', 'Catalog reference { "$t" } must name a message key.');
        return;
      }
      if (!i18nContext.present || !i18nContext.messages.has(value.$t)) {
        pushError(errors, path, 'data.l10n.catalog', `Catalog key "${value.$t}" is not declared in i18n.messages.`);
      }
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(value, 'default') || typeof value.default !== 'string') {
      pushError(errors, path, 'data.l10n.form', 'Localizable string object requires a string "default".');
      return;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'locales')) {
      if (!i18nContext.present) {
        pushError(errors, `${path}.locales`, 'data.l10n.locales', 'Locale variants require a top-level i18n block.');
        return;
      }
      if (!isObject(value.locales)) {
        pushError(errors, `${path}.locales`, 'data.l10n.locales', 'Localizable string "locales" must be an object.');
        return;
      }
      for (let tag of Object.keys(value.locales)) {
        if (!BCP47_PATTERN.test(tag)) {
          pushError(errors, `${path}.locales.${tag}`, 'data.l10n.locales', `Locale tag "${tag}" is not a BCP-47 tag.`);
        } else if (!i18nContext.locales.has(tag)) {
          pushError(errors, `${path}.locales.${tag}`, 'data.l10n.locales', `Locale "${tag}" is not declared in i18n.locales.`);
        }
        if (typeof value.locales[tag] !== 'string') {
          pushError(errors, `${path}.locales.${tag}`, 'data.l10n.locales', `Locale "${tag}" value must be a string.`);
        }
      }
    }
  };
}

function buildI18nContext(config) {
  let i18n = config?.i18n;
  let context = { present: isObject(i18n), locales: new Set(), messages: new Set() };
  if (!context.present) return context;
  if (Array.isArray(i18n.locales)) {
    for (let tag of i18n.locales) if (typeof tag === 'string') context.locales.add(tag);
  }
  if (isObject(i18n.messages)) {
    for (let key of Object.keys(i18n.messages)) context.messages.add(key);
  }
  return context;
}

function validateI18n(config, errors, i18nContext, l10n) {
  let i18n = config.i18n;
  if (i18n === undefined) return;
  if (!isObject(i18n)) {
    pushError(errors, 'i18n', 'data.i18n', 'i18n must be an object.');
    return;
  }
  if (!Array.isArray(i18n.locales) || i18n.locales.length === 0) {
    pushError(errors, 'i18n.locales', 'data.i18n.locales', 'i18n.locales must be a non-empty array.');
  } else {
    for (let i = 0; i < i18n.locales.length; i++) {
      if (typeof i18n.locales[i] !== 'string' || !BCP47_PATTERN.test(i18n.locales[i])) {
        pushError(errors, `i18n.locales[${i}]`, 'data.i18n.locales', `Locale "${i18n.locales[i]}" is not a BCP-47 tag.`);
      }
    }
  }
  if (i18n.defaultLocale !== undefined && !i18nContext.locales.has(i18n.defaultLocale)) {
    pushError(errors, 'i18n.defaultLocale', 'data.i18n.defaultLocale', 'i18n.defaultLocale must be one of i18n.locales.');
  }
  if (i18n.strategy !== undefined && !I18N_STRATEGIES.includes(i18n.strategy)) {
    pushError(errors, 'i18n.strategy', 'data.i18n.strategy', `i18n.strategy must be one of: ${I18N_STRATEGIES.join(', ')}.`);
  }
  if (i18n.messages !== undefined) {
    if (!isObject(i18n.messages)) {
      pushError(errors, 'i18n.messages', 'data.i18n.messages', 'i18n.messages must be an object.');
    } else {
      for (let key of Object.keys(i18n.messages)) {
        l10n(i18n.messages[key], `i18n.messages.${key}`, errors, { catalogValue: true });
      }
    }
  }
}

function validateCollections(collections, errors, declaredServices, l10n) {
  if (collections === undefined) return;
  if (!Array.isArray(collections)) {
    pushError(errors, 'data.collections', 'data.collections', 'data.collections must be an array.');
    return;
  }
  let ids = new Set();
  for (let i = 0; i < collections.length; i++) {
    let collection = collections[i];
    let path = `data.collections[${i}]`;
    if (!isObject(collection)) {
      pushError(errors, path, 'data.collections', 'Collection entry must be an object.');
      continue;
    }
    validatePortableId(collection.id, `${path}.id`, errors, ids, 'Collection');
    if (collection.title !== undefined) l10n(collection.title, `${path}.title`, errors);

    let itemSchema = collection.itemSchema;
    if (!isObject(itemSchema)) {
      pushError(errors, `${path}.itemSchema`, 'data.collections.itemSchema', 'Collection requires an itemSchema object.');
    } else if (!COLLECTION_ITEM_KINDS.includes(itemSchema.kind)) {
      pushError(errors, `${path}.itemSchema.kind`, 'data.collections.kind', `itemSchema.kind must be one of: ${COLLECTION_ITEM_KINDS.join(', ')}.`);
    } else if (itemSchema.kind === 'custom') {
      if (isRecordSchema(itemSchema.schema)) {
        validateRecordSchema(itemSchema.schema, `${path}.itemSchema.schema`, errors, { l10n });
      } else if (typeof itemSchema.schemaRef !== 'string' || !itemSchema.schemaRef.trim()) {
        pushError(errors, `${path}.itemSchema`, 'data.collections.custom', 'A custom collection requires a record schema or a schemaRef.');
      }
    }

    if (typeof collection.persistence !== 'string' || !CAPABILITY_ID_PATTERN.test(collection.persistence)) {
      pushError(errors, `${path}.persistence`, 'data.collections.persistence', 'Collection persistence must be a dotted host-capability id.');
    } else if (!declaredServices.has(collection.persistence)) {
      pushError(errors, `${path}.persistence`, 'data.collections.persistence', `Persistence capability "${collection.persistence}" is not declared in requires.hostServices.`);
    }

    if (collection.readOnly !== undefined && typeof collection.readOnly !== 'boolean') {
      pushError(errors, `${path}.readOnly`, 'data.collections.readOnly', 'Collection readOnly must be a boolean.');
    }
    validateHistory(collection.history, `${path}.history`, errors);
  }
}

function validateHistory(history, path, errors) {
  if (history === undefined) return;
  if (!isObject(history)) {
    pushError(errors, path, 'data.collections.history', 'Collection history must be an object.');
    return;
  }
  if (history.depth !== undefined && (!Number.isInteger(history.depth) || history.depth <= 0)) {
    pushError(errors, `${path}.depth`, 'data.collections.history', 'history.depth must be a positive integer.');
  }
  if (history.coalesceWindowMs !== undefined && (!Number.isInteger(history.coalesceWindowMs) || history.coalesceWindowMs < 0)) {
    pushError(errors, `${path}.coalesceWindowMs`, 'data.collections.history', 'history.coalesceWindowMs must be a non-negative integer.');
  }
}

function validateResources(resources, errors, declaredServices, l10n) {
  if (resources === undefined) return;
  if (!Array.isArray(resources)) {
    pushError(errors, 'data.resources', 'data.resources', 'data.resources must be an array.');
    return;
  }
  let ids = new Set();
  for (let i = 0; i < resources.length; i++) {
    let resource = resources[i];
    let path = `data.resources[${i}]`;
    if (!isObject(resource)) {
      pushError(errors, path, 'data.resources', 'Resource entry must be an object.');
      continue;
    }
    validatePortableId(resource.id, `${path}.id`, errors, ids, 'Resource');

    let fields = new Set();
    let entity = resource.entity;
    if (!isObject(entity)) {
      pushError(errors, `${path}.entity`, 'data.resources.entity', 'Resource requires an entity object.');
    } else if (isRecordSchema(entity.schema)) {
      fields = validateRecordSchema(entity.schema, `${path}.entity.schema`, errors, { l10n });
    } else if (typeof entity.schemaRef !== 'string' || !entity.schemaRef.trim()) {
      pushError(errors, `${path}.entity`, 'data.resources.entity', 'Resource entity requires a record schema or a schemaRef.');
    }

    validateResourceCollection(resource.collection, `${path}.collection`, errors, fields);

    if (resource.operations !== undefined) {
      if (!Array.isArray(resource.operations)) {
        pushError(errors, `${path}.operations`, 'data.resources.operations', 'Resource operations must be an array.');
      } else {
        for (let j = 0; j < resource.operations.length; j++) {
          if (!RESOURCE_OPERATIONS.includes(resource.operations[j])) {
            pushError(errors, `${path}.operations[${j}]`, 'data.resources.operations', `Unknown resource operation "${resource.operations[j]}".`);
          }
        }
      }
    }

    if (typeof resource.hostCapability !== 'string' || !CAPABILITY_ID_PATTERN.test(resource.hostCapability)) {
      pushError(errors, `${path}.hostCapability`, 'data.resources.hostCapability', 'Resource hostCapability must be a dotted host-capability id.');
    } else if (!declaredServices.has(resource.hostCapability)) {
      pushError(errors, `${path}.hostCapability`, 'data.resources.hostCapability', `Resource capability "${resource.hostCapability}" is not declared in requires.hostServices.`);
    }

    if (resource.requires !== undefined && (typeof resource.requires !== 'string' || !CAPABILITY_ID_PATTERN.test(resource.requires))) {
      pushError(errors, `${path}.requires`, 'data.resources.requires', 'Resource requires must be a dotted capability id (R7).');
    }
  }
}

function validateResourceCollection(collection, path, errors, fields) {
  if (collection === undefined) return;
  if (!isObject(collection)) {
    pushError(errors, path, 'data.resources.collection', 'Resource collection must be an object.');
    return;
  }
  if (collection.pagination !== undefined && !RESOURCE_PAGINATION_MODES.includes(collection.pagination)) {
    pushError(errors, `${path}.pagination`, 'data.resources.collection', `Resource pagination must be one of: ${RESOURCE_PAGINATION_MODES.join(', ')}.`);
  }
  for (let key of ['filterable', 'sortable']) {
    if (collection[key] === undefined) continue;
    if (!Array.isArray(collection[key])) {
      pushError(errors, `${path}.${key}`, 'data.resources.collection', `Resource ${key} must be an array.`);
      continue;
    }
    for (let j = 0; j < collection[key].length; j++) {
      if (!fields.has(collection[key][j])) {
        pushError(errors, `${path}.${key}[${j}]`, 'data.resources.collection', `Resource ${key} names undeclared field "${collection[key][j]}".`);
      }
    }
  }
  if (collection.defaultSort !== undefined) {
    if (!isObject(collection.defaultSort)) {
      pushError(errors, `${path}.defaultSort`, 'data.resources.collection', 'Resource defaultSort must be an object.');
    } else {
      if (!fields.has(collection.defaultSort.field)) {
        pushError(errors, `${path}.defaultSort.field`, 'data.resources.collection', `Resource defaultSort names undeclared field "${collection.defaultSort.field}".`);
      }
      if (collection.defaultSort.dir !== undefined && !RESOURCE_SORT_DIRECTIONS.includes(collection.defaultSort.dir)) {
        pushError(errors, `${path}.defaultSort.dir`, 'data.resources.collection', 'Resource defaultSort.dir must be "asc" or "desc".');
      }
    }
  }
  if (collection.pageSizeMax !== undefined && (!Number.isInteger(collection.pageSizeMax) || collection.pageSizeMax <= 0)) {
    pushError(errors, `${path}.pageSizeMax`, 'data.resources.collection', 'Resource pageSizeMax must be a positive integer.');
  }
}

function validateAssets(assets, errors) {
  if (assets === undefined || (isObject(assets) && '$fragment' in assets)) return;
  if (!Array.isArray(assets)) {
    pushError(errors, 'assets', 'data.assets', 'assets must be an array.');
    return;
  }
  let ids = new Set();
  for (let i = 0; i < assets.length; i++) {
    let asset = assets[i];
    let path = `assets[${i}]`;
    if (!isObject(asset)) {
      pushError(errors, path, 'data.assets', 'Asset entry must be an object.');
      continue;
    }
    validatePortableId(asset.id, `${path}.id`, errors, ids, 'Asset');
    if (typeof asset.kind !== 'string' || !ASSET_KIND_PATTERN.test(asset.kind)) {
      pushError(errors, `${path}.kind`, 'data.assets.kind', `Asset kind "${asset.kind}" must be a dotted-taxonomy string (core: ${ASSET_KINDS.join(', ')}).`);
    }
    if (typeof asset.integrity !== 'string' || !SRI_INTEGRITY_PATTERN.test(asset.integrity)) {
      pushError(errors, `${path}.integrity`, 'data.assets.integrity', 'Asset integrity must be a sha256-/sha384-/sha512- SRI string.');
    }
    if (!Number.isInteger(asset.sizeBytes) || asset.sizeBytes <= 0) {
      pushError(errors, `${path}.sizeBytes`, 'data.assets.sizeBytes', 'Asset sizeBytes must be a positive integer.');
    }
    validateAssetSource(asset.source, `${path}.source`, errors);
  }
}

function validateAssetSource(source, path, errors) {
  if (!isObject(source)) {
    pushError(errors, path, 'data.assets.source', 'Asset source must be an object.');
    return;
  }
  for (let value of Object.values(source)) {
    if (isUrlShaped(value)) {
      pushError(errors, path, 'data.assets.source', 'Asset source may not contain a URL; use registry coordinates or pack-relative paths.');
      return;
    }
  }
  if (source.kind === 'registry') {
    if (typeof source.ref !== 'string' || !source.ref.trim()) {
      pushError(errors, `${path}.ref`, 'data.assets.source', 'Registry asset source requires a "ref" coordinate.');
    }
  } else if (source.kind === 'pack') {
    if (typeof source.pack !== 'string' || !source.pack.trim()) {
      pushError(errors, `${path}.pack`, 'data.assets.source', 'Pack asset source requires a "pack" id.');
    }
    if (typeof source.path !== 'string' || !source.path.trim()) {
      pushError(errors, `${path}.path`, 'data.assets.source', 'Pack asset source requires a pack-relative "path".');
    }
  } else {
    pushError(errors, `${path}.kind`, 'data.assets.source', 'Asset source.kind must be "registry" or "pack".');
  }
}

function validateContent(content, errors, l10n) {
  if (content === undefined) return;
  if (!isObject(content)) {
    pushError(errors, 'content', 'data.content', 'content must be an object.');
    return;
  }
  let collections = content.collections;
  if (collections === undefined) return;
  if (!Array.isArray(collections)) {
    pushError(errors, 'content.collections', 'data.content', 'content.collections must be an array.');
    return;
  }

  let sectionBytes = 0;
  let ids = new Set();
  for (let i = 0; i < collections.length; i++) {
    let collection = collections[i];
    let path = `content.collections[${i}]`;
    if (!isObject(collection)) {
      pushError(errors, path, 'data.content', 'Content collection must be an object.');
      continue;
    }
    validatePortableId(collection.id, `${path}.id`, errors, ids, 'Content collection');

    let fieldById = new Map();
    if (isObject(collection.schema) && '$fragment' in collection.schema) {
      // schema externalized via $fragment — resolved before validation.
    } else if (isRecordSchema(collection.schema)) {
      validateRecordSchema(collection.schema, `${path}.schema`, errors, { l10n });
      for (let field of collection.schema.fields) {
        if (isObject(field) && typeof field.id === 'string') fieldById.set(field.id, field);
      }
    } else if (typeof collection.schemaRef !== 'string' || !collection.schemaRef.trim()) {
      pushError(errors, `${path}.schema`, 'data.content.schema', 'Content collection requires a record schema or a schemaRef.');
    }

    sectionBytes += validateContentEntries(collection.entries, `${path}.entries`, errors, fieldById, l10n);
  }

  if (sectionBytes > CONTENT_SECTION_INLINE_MAX_BYTES) {
    pushError(errors, 'content.collections', 'data.content.size', `Inline content exceeds ${CONTENT_SECTION_INLINE_MAX_BYTES} bytes; externalize entries via $fragment.`);
  }
}

function validateContentEntries(entries, path, errors, fieldById, l10n) {
  if (entries === undefined || (isObject(entries) && '$fragment' in entries)) return 0;
  if (!Array.isArray(entries)) {
    pushError(errors, path, 'data.content.entries', 'Content entries must be an array.');
    return 0;
  }
  let bytes = 0;
  let entryIds = new Set();
  for (let i = 0; i < entries.length; i++) {
    let entry = entries[i];
    let entryPath = `${path}[${i}]`;
    if (!isObject(entry)) {
      pushError(errors, entryPath, 'data.content.entries', 'Content entry must be an object.');
      continue;
    }
    validatePortableId(entry.id, `${entryPath}.id`, errors, entryIds, 'Content entry');

    let entryBytes = byteLength(entry);
    bytes += entryBytes;
    if (entryBytes > CONTENT_INLINE_ENTRY_MAX_BYTES) {
      pushError(errors, entryPath, 'data.content.size', `Content entry exceeds ${CONTENT_INLINE_ENTRY_MAX_BYTES} bytes; externalize via $fragment.`);
    }

    for (let key of Object.keys(entry)) {
      if (key === 'id') continue;
      let field = fieldById.get(key);
      if (!field) {
        pushError(errors, `${entryPath}.${key}`, 'data.content.entries', `Content entry has no schema field "${key}".`);
        continue;
      }
      validateRecordValue(entry[key], field, `${entryPath}.${key}`, errors, { l10n });
    }
  }
  return bytes;
}

function slotTemplateToRegExp(template) {
  let source = template
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/<id>/g, '[^.]+')
    .replace(/\\\[\\\*\\\]/g, '\\[\\d+\\]');
  return new RegExp(`^${source}$`);
}

const FRAGMENT_SLOT_PATTERNS = FRAGMENT_SLOTS.map(slotTemplateToRegExp);

function isFragmentSlot(path) {
  return FRAGMENT_SLOT_PATTERNS.some((pattern) => pattern.test(path));
}

function validateFragmentRef(ref, path, errors, insideFragment) {
  if (insideFragment) {
    pushError(errors, path, 'data.fragment.nested', 'Nested $fragment is forbidden (fragments resolve at depth 1).');
    return;
  }
  if (!isFragmentSlot(path)) {
    pushError(errors, path, 'data.fragment.slot', `$fragment is not permitted at "${path}"; allowed slots: ${FRAGMENT_SLOTS.join(', ')}.`);
  }
}

function validateFragmentBody(ref, path, errors) {
  if (!isObject(ref)) {
    pushError(errors, path, 'data.fragment.ref', '$fragment must be an object.');
    return;
  }
  if (typeof ref.integrity !== 'string' || !SRI_INTEGRITY_PATTERN.test(ref.integrity)) {
    pushError(errors, `${path}.integrity`, 'data.fragment.integrity', '$fragment requires a mandatory SRI integrity string.');
  }
  let hasPack = typeof ref.pack === 'string' && typeof ref.path === 'string';
  let hasRegistry = typeof ref.ref === 'string';
  if (!hasPack && !hasRegistry) {
    pushError(errors, path, 'data.fragment.ref', '$fragment must carry { pack, path } or { ref }.');
  }
}

function walkFragments(node, path, insideFragment, errors) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walkFragments(node[i], `${path}[${i}]`, insideFragment, errors);
    }
    return;
  }
  if (!isObject(node)) return;

  if (Object.prototype.hasOwnProperty.call(node, '$fragment')) {
    validateFragmentRef(node.$fragment, path, errors, insideFragment);
    validateFragmentBody(node.$fragment, `${path}.$fragment`, errors);
    walkFragments(node.$fragment, `${path}.$fragment`, true, errors);
    return;
  }

  for (let key of Object.keys(node)) {
    walkFragments(node[key], path ? `${path}.${key}` : key, insideFragment, errors);
  }
}

/**
 * Import-boundary check (R1): an engine-graph document body may carry
 * `ui.positions` (revisioned artwork) but a `ui.viewport` (zoom/pan) key is
 * sidecar-only and rejected at import. Documents live outside portable config,
 * so this runs at the import seam, not in the config shape pass.
 *
 * @param {unknown} body
 * @param {string} [path]
 * @returns {Array<{ path: string, code: string, message: string, severity: string }>}
 */
export function validateEngineGraphImportBody(body, path = 'body') {
  let errors = [];
  if (isObject(body) && isObject(body.ui) && Object.prototype.hasOwnProperty.call(body.ui, 'viewport')) {
    pushError(errors, `${path}.ui.viewport`, 'data.collections.body', 'Engine-graph document bodies must not carry ui.viewport; zoom/pan is presentation-sidecar-only (R1).');
  }
  return errors;
}

function pushId(target, seen, id) {
  if (typeof id === 'string' && id.trim() && !seen.has(id)) {
    seen.add(id);
    target.push(id);
  }
}

/**
 * Reference providers the DATA tier declares: `doc:<collection>`,
 * `resource:<id>`, `asset:<id>`, `content:<collection>`, and
 * `content:<collection>:<entry>`.
 */
function dataRefProviders(config) {
  let providers = [];
  let seen = new Set();
  for (let collection of asArray(config?.data?.collections)) {
    if (isObject(collection)) pushId(providers, seen, prefixed('doc:', collection.id));
  }
  for (let resource of asArray(config?.data?.resources)) {
    if (isObject(resource)) pushId(providers, seen, prefixed('resource:', resource.id));
  }
  for (let asset of asArray(config?.assets)) {
    if (isObject(asset)) pushId(providers, seen, prefixed('asset:', asset.id));
  }
  for (let collection of asArray(config?.content?.collections)) {
    if (!isObject(collection) || typeof collection.id !== 'string') continue;
    pushId(providers, seen, `content:${collection.id}`);
    for (let entry of asArray(collection.entries)) {
      if (isObject(entry) && typeof entry.id === 'string') {
        pushId(providers, seen, `content:${collection.id}:${entry.id}`);
      }
    }
  }
  return providers;
}

/**
 * Reference consumers the DATA tier declares: `asset:`/`content:` refs carried
 * by content entry values. Resolution is the validator core's referential pass
 * (broken ref = ERROR). The `#path` fragment is stripped for provider matching.
 */
function dataRefConsumers(config) {
  let consumers = [];
  for (let ci = 0; ci < asArray(config?.content?.collections).length; ci++) {
    let collection = config.content.collections[ci];
    if (!isObject(collection)) continue;
    let fieldById = new Map();
    if (isRecordSchema(collection.schema)) {
      for (let field of collection.schema.fields) {
        if (isObject(field) && typeof field.id === 'string') fieldById.set(field.id, field);
      }
    }
    for (let ei = 0; ei < asArray(collection.entries).length; ei++) {
      let entry = collection.entries[ei];
      if (!isObject(entry)) continue;
      let base = `content.collections[${ci}].entries[${ei}]`;
      for (let key of Object.keys(entry)) {
        let field = fieldById.get(key);
        if (!field) continue;
        let refs = [];
        validateRecordValue(entry[key], field, `${base}.${key}`, [], {
          onRef: (kind, ref, refPath) => refs.push({ ref, refPath }),
        });
        for (let { ref, refPath } of refs) {
          consumers.push({
            id: ref.split('#')[0],
            path: refPath,
            code: 'data.ref.unresolved',
            message: `Reference "${ref}" does not resolve to a declared provider.`,
          });
        }
      }
    }
  }
  return consumers;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function prefixed(prefix, id) {
  return typeof id === 'string' ? `${prefix}${id}` : null;
}

/**
 * DATA section validator (shape pass). Returns an array of issues consumed by
 * the validator core. The tier is optional: a config with no data/assets/
 * content/i18n keys validates clean.
 *
 * @param {object} config
 * @returns {Array}
 */
function validateData(config) {
  let errors = [];
  if (!isObject(config)) return errors;

  let i18nContext = buildI18nContext(config);
  let l10n = createL10nValidator(i18nContext);
  let declaredServices = collectDeclaredHostServices(config);

  validateI18n(config, errors, i18nContext, l10n);
  validateCollections(config?.data?.collections, errors, declaredServices, l10n);
  validateResources(config?.data?.resources, errors, declaredServices, l10n);
  validateAssets(config?.assets, errors);
  validateContent(config?.content, errors, l10n);
  walkFragments(config, '', false, errors);

  return errors;
}

/**
 * The DATA section registration. Register into the S1.0 validator core via
 * `registerSection`. Owns documents, assets, resources, content, i18n, and the
 * `$fragment` slot/integrity/nesting checks.
 *
 * @type {import('../../validation/core.js').ValidationSection}
 */
export const dataSection = Object.freeze({
  id: DATA_SECTION_ID,
  validate: validateData,
  refProviders: dataRefProviders,
  refConsumers: dataRefConsumers,
});

export default dataSection;
