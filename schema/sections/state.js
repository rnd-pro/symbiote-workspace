import {
  RUNTIME_ID_PATTERN,
  STATE_PERSISTENCE_TIERS,
  STATE_RESERVED_NAMESPACES,
  STRUCTURAL_ID_PATTERN,
} from '../constants.js';
import {
  FIELD_ID_PATTERN,
  RECORD_FIELD_TYPES,
  validateRecordSchema,
  validateRecordValue,
} from '../record-schema.js';

export const STATE_SECTION_ID = 'state';

const STATE_PREFIX = 'state:';
const STATE_SCOPES = Object.freeze(['workspace', 'view']);
const COMPUTED_KIND = 'computed';
const DURABLE_STATE_TIERS = Object.freeze(['session', 'workspace']);
const ROUTE_TOPICS = Object.freeze(['view', 'params', 'query', 'mount', 'denied', 'data']);
const SESSION_TOPICS = Object.freeze([
  'openViews',
  'activeView',
  'presentation',
  'nav',
  'tasks',
  'parked',
  'docPresentation',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function pushError(errors, path, code, message) {
  errors.push({ path, code, message, severity: 'error' });
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isStateAddress(value) {
  return typeof value === 'string' && value.startsWith(STATE_PREFIX);
}

function isStateFieldId(value) {
  return typeof value === 'string'
    && value.split('.').every((segment) => STRUCTURAL_ID_PATTERN.test(segment));
}

function fieldPathSegments(value) {
  return typeof value === 'string' ? value.split('.').filter(Boolean) : [];
}

function statePathFromAddress(value) {
  return isStateAddress(value) ? value.slice(STATE_PREFIX.length) : value;
}

function stateAddressFromPath(value) {
  return isStateAddress(value) ? value : `${STATE_PREFIX}${value}`;
}

function mapRecordIssuePath(issue, fieldPath) {
  return issue.path.replace(/^state\.fields\[0\]/, fieldPath);
}

function validateWithRecordGrammar(field, path, errors) {
  let grammarErrors = [];
  validateRecordSchema({ fields: [{ ...field, id: 'field' }] }, 'state', grammarErrors);
  for (let issue of grammarErrors) {
    errors.push({ ...issue, path: mapRecordIssuePath(issue, path) });
  }
}

function validateDefault(field, path, errors) {
  if (!Object.hasOwn(field, 'default')) return;
  let defaultErrors = [];
  validateRecordValue(field.default, field, `${path}.default`, defaultErrors);
  for (let issue of defaultErrors) {
    errors.push({
      ...issue,
      path: `${path}.default`,
      code: 'state.field.default',
      message: `Default for state field "${field.id}" does not match its record-schema type.`,
    });
  }
}

function validateFieldId(field, path, errors, declarations) {
  if (!hasText(field.id)) {
    pushError(errors, `${path}.id`, 'state.field.id', 'State field requires a non-empty dotted id.');
    return false;
  }
  if (!isStateFieldId(field.id)) {
    pushError(
      errors,
      `${path}.id`,
      'state.field.id',
      `State field id "${field.id}" must be a dotted path of structural-id atoms.`,
    );
    return false;
  }
  let [namespace] = field.id.split('.');
  if (STATE_RESERVED_NAMESPACES.includes(namespace)) {
    pushError(
      errors,
      `${path}.id`,
      'state.field.reserved_namespace',
      `State field "${field.id}" may not declare the reserved "${namespace}" namespace.`,
    );
    return false;
  }
  if (declarations.has(field.id)) {
    pushError(errors, `${path}.id`, 'state.field.duplicate', `Duplicate state field id "${field.id}".`);
    return false;
  }
  declarations.set(field.id, { field, path });
  return true;
}

function validatePrefixCollisions(declarations, errors) {
  let ids = [...declarations.keys()].sort();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!ids[j].startsWith(`${ids[i]}.`)) continue;
      pushError(
        errors,
        `${declarations.get(ids[j]).path}.id`,
        'state.field.prefix_collision',
        `State field "${ids[j]}" is nested under declared field "${ids[i]}"; declare only one owner path.`,
      );
    }
  }
}

function validatePersistence(field, path, errors) {
  if (!STATE_PERSISTENCE_TIERS.includes(field.persistence)) {
    pushError(
      errors,
      `${path}.persistence`,
      'state.field.persistence',
      `State persistence must be one of: ${STATE_PERSISTENCE_TIERS.join(', ')}.`,
    );
  }
}

function validateScope(field, path, errors) {
  if (field.scope !== undefined && !STATE_SCOPES.includes(field.scope)) {
    pushError(errors, `${path}.scope`, 'state.field.scope', 'State field scope must be "workspace" or "view".');
  }
}

function validateComputed(field, path, errors, declarations) {
  if (field.kind === undefined) return;
  if (field.kind !== COMPUTED_KIND) {
    pushError(errors, `${path}.kind`, 'state.field.kind', 'State field kind must be "computed" when present.');
    return;
  }
  if (DURABLE_STATE_TIERS.includes(field.persistence)) {
    pushError(
      errors,
      `${path}.persistence`,
      'state.computed.persistence',
      'Computed state fields may not use session or workspace persistence.',
    );
  }
  if (!Array.isArray(field.deps)) {
    pushError(errors, `${path}.deps`, 'state.computed.deps', 'Computed state fields require deps[].');
  } else {
    for (let i = 0; i < field.deps.length; i++) {
      let dep = field.deps[i];
      if (!hasText(dep) || !declarations.has(dep)) {
        pushError(
          errors,
          `${path}.deps[${i}]`,
          'state.computed.deps',
          `Computed dependency "${dep}" does not resolve to a declared state field id.`,
        );
      }
    }
  }
  if (!hasText(field['fn-ref'])) {
    pushError(errors, `${path}.fn-ref`, 'state.computed.fn_ref', 'Computed state fields require a non-empty fn-ref.');
  }
}

function validateStateFields(config, errors) {
  let state = config?.state;
  let declarations = new Map();
  if (state === undefined) return declarations;
  if (!isObject(state)) {
    pushError(errors, 'state', 'state.section.type', 'state must be an object.');
    return declarations;
  }
  if (!Array.isArray(state.fields)) {
    pushError(errors, 'state.fields', 'state.fields.type', 'state.fields must be an array.');
    return declarations;
  }

  for (let i = 0; i < state.fields.length; i++) {
    let field = state.fields[i];
    let path = `state.fields[${i}]`;
    if (!isObject(field)) {
      pushError(errors, path, 'state.field.type', 'State field entry must be an object.');
      continue;
    }
    validateFieldId(field, path, errors, declarations);
    validateWithRecordGrammar(field, path, errors);
    validatePersistence(field, path, errors);
    validateScope(field, path, errors);
    validateDefault(field, path, errors);
  }

  validatePrefixCollisions(declarations, errors);

  for (let [id, entry] of declarations) {
    validateComputed(entry.field, entry.path, errors, declarations);
    if (!RECORD_FIELD_TYPES.includes(entry.field.type)) {
      declarations.delete(id);
    }
  }

  return declarations;
}

function findDeclaredField(path, declarations) {
  let ids = [...declarations.keys()].sort((a, b) => b.length - a.length);
  for (let id of ids) {
    if (path === id) {
      return { entry: declarations.get(id), rest: [] };
    }
    if (path.startsWith(`${id}.`)) {
      return { entry: declarations.get(id), rest: path.slice(id.length + 1).split('.') };
    }
  }
  return null;
}

function nestedRecordField(field, segment) {
  if (!Array.isArray(field?.fields)) return null;
  return field.fields.find((candidate) => isObject(candidate) && candidate.id === segment) || null;
}

function resolveDescriptorRest(field, rest) {
  if (rest.length === 0) return { ok: true, descriptor: field };
  if (field.type === 'record') {
    let [segment, ...tail] = rest;
    if (!FIELD_ID_PATTERN.test(segment)) {
      return { ok: false, reason: 'undeclared' };
    }
    let nested = nestedRecordField(field, segment);
    if (!nested) return { ok: false, reason: 'undeclared' };
    return resolveDescriptorRest(nested, tail);
  }
  if (field.type === 'list') {
    if (!isObject(field.items)) return { ok: true, descriptor: field };
    if (field.items.type === 'record') {
      let [segment, ...tail] = rest;
      if (!FIELD_ID_PATTERN.test(segment)) {
        return { ok: false, reason: 'undeclared' };
      }
      let nested = nestedRecordField(field.items, segment);
      if (!nested) return { ok: false, reason: 'undeclared' };
      return resolveDescriptorRest(nested, tail);
    }
    return { ok: true, descriptor: field.items };
  }
  return { ok: false, reason: 'scalar_path' };
}

function validateRuntimeSegment(segment) {
  return RUNTIME_ID_PATTERN.test(segment);
}

function validateRecordPathTail(segments) {
  return segments.every((segment) => FIELD_ID_PATTERN.test(segment) || validateRuntimeSegment(segment));
}

function resolveRoutePath(segments) {
  if (segments.length < 2 || !ROUTE_TOPICS.includes(segments[1])) {
    return { ok: false, reason: 'reserved' };
  }
  let topic = segments[1];
  if (topic === 'view') return { ok: segments.length === 2, reason: 'reserved' };
  if (['params', 'query', 'mount'].includes(topic)) {
    return {
      ok: segments.length >= 3 && validateRuntimeSegment(segments[2]) && validateRecordPathTail(segments.slice(3)),
      reason: 'reserved',
    };
  }
  if (topic === 'denied') {
    return { ok: segments.length >= 2 && validateRecordPathTail(segments.slice(2)), reason: 'reserved' };
  }
  if (topic === 'data') {
    return {
      ok: segments.length >= 3 && validateRuntimeSegment(segments[2]) && validateRecordPathTail(segments.slice(3)),
      reason: 'reserved',
    };
  }
  return { ok: false, reason: 'reserved' };
}

function resolveSessionPath(segments) {
  if (segments.length < 2 || !SESSION_TOPICS.includes(segments[1])) {
    return { ok: false, reason: 'reserved' };
  }
  let topic = segments[1];
  if (['openViews', 'activeView', 'tasks', 'parked'].includes(topic)) {
    return { ok: segments.length >= 2 && validateRecordPathTail(segments.slice(2)), reason: 'reserved' };
  }
  if (topic === 'nav') {
    return { ok: segments[2] === 'sidebar' && validateRecordPathTail(segments.slice(3)), reason: 'reserved' };
  }
  if (topic === 'presentation') {
    return {
      ok: segments[2] === 'geometry'
        && segments.length >= 5
        && STRUCTURAL_ID_PATTERN.test(segments[3])
        && STRUCTURAL_ID_PATTERN.test(segments[4])
        && validateRecordPathTail(segments.slice(5)),
      reason: 'reserved',
    };
  }
  if (topic === 'docPresentation') {
    return {
      ok: segments.length >= 4
        && STRUCTURAL_ID_PATTERN.test(segments[2])
        && validateRuntimeSegment(segments[3])
        && validateRecordPathTail(segments.slice(4)),
      reason: 'reserved',
    };
  }
  return { ok: false, reason: 'reserved' };
}

function resolveReservedPath(path) {
  let segments = fieldPathSegments(path);
  if (segments[0] === 'route') return resolveRoutePath(segments);
  if (segments[0] === 'session') return resolveSessionPath(segments);
  return null;
}

function resolveStatePathFromRegistry(path, declarations) {
  if (!hasText(path) || path.includes('#') || path.includes('..')) {
    return { ok: false, reason: 'malformed', path };
  }
  let reserved = resolveReservedPath(path);
  if (reserved) return { ...reserved, path, reserved: true };

  let match = findDeclaredField(path, declarations);
  if (!match) return { ok: false, reason: 'undeclared', path };

  let nested = resolveDescriptorRest(match.entry.field, match.rest);
  if (!nested.ok) return { ...nested, path, matchedField: match.entry.field };
  return {
    ok: true,
    path,
    matchedField: match.entry.field,
    matchedPath: match.entry.field.id,
    descriptor: nested.descriptor,
  };
}

export function createStateFieldRegistry(config) {
  let errors = [];
  return {
    fields: validateStateFields(config, errors),
    errors,
  };
}

export function resolveStatePath(config, refOrPath) {
  let { fields } = createStateFieldRegistry(config);
  return resolveStatePathFromRegistry(statePathFromAddress(refOrPath), fields);
}

export function getStatePersistenceTier(config, refOrPath) {
  let resolved = resolveStatePath(config, refOrPath);
  if (!resolved.ok || !resolved.matchedField) return null;
  return resolved.matchedField.persistence;
}

export function isSessionDocPresentationStatePath(refOrPath) {
  let path = statePathFromAddress(refOrPath);
  return path === 'session.docPresentation' || path.startsWith('session.docPresentation.');
}

function collectStateReferences(value, path, refs, seen = new Set()) {
  if (typeof value === 'string') {
    if (isStateAddress(value)) refs.push({ ref: value, path });
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectStateReferences(value[i], `${path}[${i}]`, refs, seen);
    }
    return;
  }
  for (let key of Object.keys(value)) {
    collectStateReferences(value[key], path ? `${path}.${key}` : key, refs, seen);
  }
}

function reportStateReference(ref, path, declarations, errors) {
  let statePath = statePathFromAddress(ref);
  let resolved = resolveStatePathFromRegistry(statePath, declarations);
  if (resolved.ok) return;
  if (resolved.reason === 'scalar_path') {
    pushError(errors, path, 'state.ref.scalar_path', `State reference "${ref}" extends scalar field "${resolved.matchedField.id}".`);
  } else if (resolved.reason === 'reserved') {
    pushError(errors, path, 'state.ref.reserved', `State reference "${ref}" does not match the reserved namespace contract.`);
  } else if (resolved.reason === 'malformed') {
    pushError(errors, path, 'state.ref.malformed', `State reference "${ref}" is not a valid state: path.`);
  } else {
    pushError(errors, path, 'state.ref.undeclared', `State reference "${ref}" does not resolve to state.fields[].`);
  }
}

function isReservedWriteBanned(ref) {
  if (!isStateAddress(ref)) return false;
  let path = statePathFromAddress(ref);
  if (path === 'route' || path.startsWith('route.')) return true;
  if (path === 'session' || path.startsWith('session.')) {
    return !isSessionDocPresentationStatePath(path);
  }
  return false;
}

function reportReservedWrite(ref, path, errors) {
  if (!isReservedWriteBanned(ref)) return;
  pushError(
    errors,
    path,
    'state.reserved.write',
    `Writes to reserved state namespace "${ref}" are forbidden; only state:session.docPresentation.* is writable.`,
  );
}

function validateReservedWrites(config, errors) {
  for (let i = 0; i < asArray(config?.wires).length; i++) {
    let wire = config.wires[i];
    if (!isObject(wire)) continue;
    reportReservedWrite(wire.to, `wires[${i}].to`, errors);
    if (wire.mode === 'two-way') reportReservedWrite(wire.from, `wires[${i}].from`, errors);
  }
  for (let i = 0; i < asArray(config?.commands).length; i++) {
    let command = config.commands[i];
    if (!isObject(command?.target) || command.target.kind !== 'wire') continue;
    reportReservedWrite(command.target.to, `commands[${i}].target.to`, errors);
  }
}

function hasKeyField(listField) {
  let items = listField?.items;
  return isObject(items)
    && items.type === 'record'
    && Array.isArray(items.fields)
    && items.fields.some((field) => isObject(field) && field.id === 'key');
}

function walkObjects(value, path, visit, seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) walkObjects(value[i], `${path}[${i}]`, visit, seen);
    return;
  }
  visit(value, path);
  for (let key of Object.keys(value)) {
    walkObjects(value[key], path ? `${path}.${key}` : key, visit, seen);
  }
}

function validateStackBindings(config, declarations, errors) {
  walkObjects(config, '', (node, path) => {
    if (isStateAddress(node.itemsBinding)) {
      let resolved = resolveStatePathFromRegistry(statePathFromAddress(node.itemsBinding), declarations);
      if (resolved.ok && resolved.descriptor?.type !== 'list') {
        pushError(errors, `${path}.itemsBinding`, 'state.binding.items_type', 'itemsBinding must target a list state field.');
      } else if (resolved.ok && !hasKeyField(resolved.descriptor)) {
        pushError(errors, `${path}.itemsBinding`, 'state.binding.items_key', 'itemsBinding list item record must declare a key field.');
      }
    }
    if (isStateAddress(node.activeBinding)) {
      let resolved = resolveStatePathFromRegistry(statePathFromAddress(node.activeBinding), declarations);
      if (resolved.ok && resolved.descriptor?.type !== 'string') {
        pushError(errors, `${path}.activeBinding`, 'state.binding.active_type', 'activeBinding must target a string state field.');
      }
    }
  });
}

export function validate(config) {
  let errors = [];
  if (!isObject(config)) return errors;

  let declarations = validateStateFields(config, errors);
  let refs = [];
  collectStateReferences(config, '', refs);
  for (let { ref, path } of refs) reportStateReference(ref, path, declarations, errors);
  validateReservedWrites(config, errors);
  validateStackBindings(config, declarations, errors);

  return errors;
}

export function refProviders(config) {
  let { fields } = createStateFieldRegistry(config);
  let providers = [];
  let seen = new Set();
  let push = (id, path) => {
    if (seen.has(id)) return;
    seen.add(id);
    providers.push({ id, path });
  };

  for (let [id, { path }] of fields) {
    push(stateAddressFromPath(id), `${path}.id`);
  }

  let refs = [];
  collectStateReferences(config, '', refs);
  for (let { ref, path } of refs) {
    let resolved = resolveStatePathFromRegistry(statePathFromAddress(ref), fields);
    if (resolved.ok) push(ref, path);
  }

  return providers;
}

export function refConsumers() {
  return [];
}

export const stateSection = Object.freeze({
  id: STATE_SECTION_ID,
  validate,
  refProviders,
  refConsumers,
});

export default stateSection;
