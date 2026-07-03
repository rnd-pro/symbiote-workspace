/**
 * Record field ids are authored object-property identifiers (e.g. `body`,
 * `createdAt`), distinct from portable resource ids: they name keys inside a
 * record/entry, so camelCase and underscores are legal.
 */
export const FIELD_ID_PATTERN = Object.freeze(/^[A-Za-z][A-Za-z0-9_]*$/);

/**
 * The ONE record-schema field vocabulary. Every typed record in a workspace
 * config — custom `data.collections[]`, `data.resources[]` entity schemas,
 * `content.collections[]` schemas, and (from S1.8) `state.fields[]` — is
 * described with this single grammar. No second field vocabulary exists.
 *
 * Scalars: string, number, boolean, enum, datetime, richtext, asset, ref,
 * l10n-string. Composites (R13): list (homogeneous sequence) and record
 * (nested field set), so the NLE/custom document kinds reuse this grammar
 * instead of minting a third serializer.
 */
export const RECORD_SCALAR_FIELD_TYPES = Object.freeze([
  'string',
  'number',
  'boolean',
  'enum',
  'datetime',
  'richtext',
  'asset',
  'ref',
  'l10n-string',
]);

export const RECORD_COMPOSITE_FIELD_TYPES = Object.freeze(['list', 'record']);

export const RECORD_FIELD_TYPES = Object.freeze([
  ...RECORD_SCALAR_FIELD_TYPES,
  ...RECORD_COMPOSITE_FIELD_TYPES,
]);

const FIELD_TYPE_SET = new Set(RECORD_FIELD_TYPES);

const ASSET_REF_PATTERN = /^asset:([a-z][a-z0-9]*(?:[./_-][a-z0-9]+)*)$/;
const CONTENT_REF_PATTERN = /^content:[a-z][a-z0-9]*(?:[./_-][a-z0-9]+)*(?::[a-z][a-z0-9]*(?:[./_-][a-z0-9]+)*)?(?:#.+)?$/;
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pushError(errors, path, code, message) {
  errors.push({ path, code, message, severity: 'error' });
}

function validateFieldId(id, path, errors, seen) {
  if (typeof id !== 'string' || !id.trim()) {
    pushError(errors, path, 'record.field.id', 'Record field requires a non-empty id.');
    return;
  }
  if (!FIELD_ID_PATTERN.test(id)) {
    pushError(errors, path, 'record.field.id', `Record field id "${id}" must be an identifier ([A-Za-z][A-Za-z0-9_]*).`);
    return;
  }
  if (seen.has(id)) {
    pushError(errors, path, 'record.field.duplicate', `Duplicate record field id "${id}".`);
    return;
  }
  seen.add(id);
}

/**
 * Validates a single field descriptor (type + type-specific keys). Reused for
 * top-level fields (requireId), `list.items` element descriptors (no id), and
 * nested `record.fields` (requireId).
 *
 * @param {unknown} field
 * @param {string} path
 * @param {Array} errors
 * @param {{ requireId?: boolean, l10n?: Function }} [options]
 */
function validateFieldDescriptor(field, path, errors, options = {}) {
  if (!isObject(field)) {
    pushError(errors, path, 'record.field.type', 'Record field descriptor must be an object.');
    return;
  }

  if (options.requireId === false) {
    if (Object.prototype.hasOwnProperty.call(field, 'id')) {
      pushError(errors, `${path}.id`, 'record.field.id', 'List element descriptors do not carry an id.');
    }
  }

  if (typeof field.type !== 'string' || !FIELD_TYPE_SET.has(field.type)) {
    pushError(errors, `${path}.type`, 'record.field.type', `Unknown record field type "${field.type}".`);
    return;
  }

  if (field.label !== undefined && typeof options.l10n === 'function') {
    options.l10n(field.label, `${path}.label`, errors);
  }

  switch (field.type) {
    case 'enum':
      validateEnumValues(field.values, `${path}.values`, errors);
      break;
    case 'list':
      if (field.items === undefined) {
        pushError(errors, `${path}.items`, 'record.field.list', 'A list field requires an items element descriptor.');
      } else {
        validateFieldDescriptor(field.items, `${path}.items`, errors, { ...options, requireId: false });
      }
      break;
    case 'record':
      validateRecordSchema(field, `${path}`, errors, options);
      break;
    default:
      break;
  }
}

function validateEnumValues(values, path, errors) {
  if (!Array.isArray(values) || values.length === 0) {
    pushError(errors, path, 'record.field.enum', 'An enum field requires a non-empty values array.');
    return;
  }
  let seen = new Set();
  for (let i = 0; i < values.length; i++) {
    let value = values[i];
    if (typeof value !== 'string' || !value.trim()) {
      pushError(errors, `${path}[${i}]`, 'record.field.enum', 'Enum values must be non-empty strings.');
      continue;
    }
    if (seen.has(value)) {
      pushError(errors, `${path}[${i}]`, 'record.field.enum', `Duplicate enum value "${value}".`);
    }
    seen.add(value);
  }
}

/**
 * True when the value is a well-formed record schema `{ fields: [...] }`.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRecordSchema(value) {
  return isObject(value) && Array.isArray(value.fields);
}

/**
 * Validates a record schema descriptor `{ fields: [ { id, type, ... } ] }`.
 * Shared by collections (custom kind), resources (entity.schema), content
 * schemas, and state.fields (S1.8). Errors are pushed as
 * `{ path, code, message, severity }` issues.
 *
 * @param {unknown} schema
 * @param {string} path
 * @param {Array} errors
 * @param {{ l10n?: Function }} [options]
 * @returns {Set<string>} declared field ids
 */
export function validateRecordSchema(schema, path, errors, options = {}) {
  let ids = new Set();
  if (!isObject(schema)) {
    pushError(errors, path, 'record.schema', 'Record schema must be an object.');
    return ids;
  }
  if (!Array.isArray(schema.fields)) {
    pushError(errors, `${path}.fields`, 'record.schema', 'Record schema requires a fields array.');
    return ids;
  }
  for (let i = 0; i < schema.fields.length; i++) {
    let field = schema.fields[i];
    let fieldPath = `${path}.fields[${i}]`;
    if (isObject(field)) validateFieldId(field.id, `${fieldPath}.id`, errors, ids);
    validateFieldDescriptor(field, fieldPath, errors, { ...options, requireId: true });
  }
  return ids;
}

/**
 * Validates a runtime value against a single field descriptor. Used for
 * `content.collections[].entries[]` values. `options.onRef(kind, ref, path)`
 * collects `asset:`/`content:` references for the referential pass;
 * `options.l10n(value, path, errors)` validates l10n-string values.
 *
 * @param {unknown} value
 * @param {object} field
 * @param {string} path
 * @param {Array} errors
 * @param {{ onRef?: Function, l10n?: Function }} [options]
 */
export function validateRecordValue(value, field, path, errors, options = {}) {
  if (!isObject(field) || typeof field.type !== 'string') return;

  switch (field.type) {
    case 'string':
    case 'richtext':
      if (typeof value !== 'string') {
        pushError(errors, path, 'record.value.type', `Field "${field.id}" expects a ${field.type} value.`);
      }
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        pushError(errors, path, 'record.value.type', `Field "${field.id}" expects a finite number.`);
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        pushError(errors, path, 'record.value.type', `Field "${field.id}" expects a boolean.`);
      }
      break;
    case 'datetime':
      if (typeof value !== 'string' || !ISO_DATETIME_PATTERN.test(value)) {
        pushError(errors, path, 'record.value.type', `Field "${field.id}" expects an ISO-8601 datetime string.`);
      }
      break;
    case 'enum':
      if (!Array.isArray(field.values) || !field.values.includes(value)) {
        pushError(errors, path, 'record.value.enum', `Field "${field.id}" value is not one of its enum values.`);
      }
      break;
    case 'asset':
      if (typeof value !== 'string' || !ASSET_REF_PATTERN.test(value)) {
        pushError(errors, path, 'record.value.asset', `Field "${field.id}" expects an "asset:<id>" reference.`);
      } else if (typeof options.onRef === 'function') {
        options.onRef('asset', value, path);
      }
      break;
    case 'ref':
      if (typeof value !== 'string' || !value.trim()) {
        pushError(errors, path, 'record.value.ref', `Field "${field.id}" expects a reference string.`);
      } else if (CONTENT_REF_PATTERN.test(value)) {
        if (typeof options.onRef === 'function') options.onRef('content', value, path);
      } else if (value.startsWith('content:')) {
        pushError(errors, path, 'record.value.ref', `Field "${field.id}" carries a malformed content: reference.`);
      }
      break;
    case 'l10n-string':
      if (typeof options.l10n === 'function') {
        options.l10n(value, path, errors);
      } else if (typeof value !== 'string' && !isObject(value)) {
        pushError(errors, path, 'record.value.type', `Field "${field.id}" expects a localizable string.`);
      }
      break;
    case 'list':
      if (!Array.isArray(value)) {
        pushError(errors, path, 'record.value.type', `Field "${field.id}" expects a list.`);
      } else if (isObject(field.items)) {
        for (let i = 0; i < value.length; i++) {
          validateRecordValue(value[i], field.items, `${path}[${i}]`, errors, options);
        }
      }
      break;
    case 'record':
      if (!isObject(value)) {
        pushError(errors, path, 'record.value.type', `Field "${field.id}" expects a nested record object.`);
      } else if (Array.isArray(field.fields)) {
        for (let nested of field.fields) {
          if (!isObject(nested) || typeof nested.id !== 'string') continue;
          if (Object.prototype.hasOwnProperty.call(value, nested.id)) {
            validateRecordValue(value[nested.id], nested, `${path}.${nested.id}`, errors, options);
          }
        }
      }
      break;
    default:
      break;
  }
}
