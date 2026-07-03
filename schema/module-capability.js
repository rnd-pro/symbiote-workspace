/**
 * Module capability descriptor — the single component contract (spec §2.3).
 *
 * One descriptor shape serves all three module sources (package, plugin,
 * inline), which is what makes inline free-created components first-class
 * catalog/wire citizens. Every declared row (action/setting/state/event/
 * binding/slot/runtimeSlot/stream) is a WAS endpoint surface.
 *
 * Deleted from the legacy shape: inline `engine:{graphId,nodeId}` refs on rows
 * (instance-level engine refs are illegal in descriptors, §2.4), the event-bridge
 * dialect (`targetMethod`/`targetProperty`/`mapping`), the runtime `active` flag,
 * and the flat `requiredHostServices` array (now `hostServices {required,optional}`).
 *
 * @module symbiote-workspace/schema/module-capability
 */

import {
  MODULE_ID_PATTERN,
  STATE_PERSISTENCE_TIERS,
  AGENT_WEBMCP_CAPABILITY,
} from './constants.js';

export const MODULE_CAPABILITY_SCHEMA_VERSION = '0.2.0';

export const MODULE_CAPABILITY_DESCRIPTOR_SCHEMA = Object.freeze({
  type: 'object',
  schemaVersion: MODULE_CAPABILITY_SCHEMA_VERSION,
  required: Object.freeze(['tagName']),
  properties: Object.freeze({
    tagName: Object.freeze({ type: 'string' }),
    title: Object.freeze({ oneOf: Object.freeze([{ type: 'string' }, { type: 'object' }]) }),
    description: Object.freeze({ oneOf: Object.freeze([{ type: 'string' }, { type: 'object' }]) }),
    provider: Object.freeze({ type: 'string' }),
    capabilities: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) }),
    actions: Object.freeze({ type: 'array' }),
    settings: Object.freeze({ type: 'array' }),
    state: Object.freeze({ type: 'array' }),
    events: Object.freeze({ type: 'array' }),
    bindings: Object.freeze({ type: 'array' }),
    slots: Object.freeze({ type: 'array' }),
    runtimeSlots: Object.freeze({ type: 'array' }),
    streams: Object.freeze({ type: 'array' }),
    hostServices: Object.freeze({ type: 'object' }),
    lifecycle: Object.freeze({ type: 'object' }),
    webmcp: Object.freeze({ type: 'object' }),
    placement: Object.freeze({ type: 'object' }),
  }),
});

const PORTABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[./:_-][a-z0-9]+)*$/;
const CUSTOM_ELEMENT_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

const ACTION_DOES_KINDS = Object.freeze(['emit', 'method', 'wire', 'command']);
const SETTING_TYPES = Object.freeze(['string', 'number', 'boolean', 'enum', 'object', 'array', 'color', 'token', 'json']);
const STATE_TYPES = SETTING_TYPES;
const BINDING_DIRECTIONS = Object.freeze(['input', 'output', 'two-way']);
const STREAM_DIRECTIONS = Object.freeze(['source', 'sink']);
const STREAM_ENCODINGS = Object.freeze(['json', 'text', 'binary']);
const READINESS_MODES = Object.freeze(['auto', 'declared']);
const GRAPH_OWNERSHIP_POLICIES = Object.freeze(['user-direct', 'agent-gated']);
// Descriptor state rows may only persist in the ephemeral or runtime tiers.
const DESCRIPTOR_STATE_TIERS = Object.freeze(
  STATE_PERSISTENCE_TIERS.filter((tier) => tier === 'ephemeral' || tier === 'runtime'),
);

// Row-level keys deleted from the legacy contract; their presence is an ERROR.
const DELETED_ROW_KEYS = Object.freeze(['engine']);
const DELETED_EVENT_KEYS = Object.freeze(['targetMethod', 'targetProperty', 'mapping']);
const DELETED_ACTION_KEYS = Object.freeze(['engine', 'active', 'command', 'event', 'method', 'binding']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pushError(errors, path, message, options) {
  let error = { path, message };
  if (options.severity !== false) error.severity = 'error';
  errors.push(error);
}

/**
 * Localizable string: a bare string or an `{$loc}`/`{$t}` reference. The i18n
 * section owns resolution; here it is only shape-accepted.
 */
function validateLocalizableString(value, path, errors, options, { required = false } = {}) {
  if (value === undefined) {
    if (required) pushError(errors, path, `${path} is required.`, options);
    return;
  }
  if (typeof value === 'string') {
    if (required && !value.trim()) pushError(errors, path, `${path} must be a non-empty string.`, options);
    return;
  }
  if (isObject(value) && (typeof value.$loc === 'string' || typeof value.$t === 'string')) return;
  pushError(errors, path, `${path} must be a string or a { $loc } / { $t } localizable reference.`, options);
}

function validatePortableId(value, path, errors, options) {
  if (typeof value !== 'string' || !value.trim()) {
    pushError(errors, path, 'Value must be a non-empty string.', options);
    return;
  }
  if (!PORTABLE_ID_PATTERN.test(value)) {
    pushError(errors, path, `Value "${value}" must be a portable identifier, not a URL, path, or display label.`, options);
  }
}

function validatePortablePackageReference(value, path, errors, options) {
  if (typeof value !== 'string' || !value.trim()) {
    pushError(errors, path, 'Value must be a non-empty package or registry identifier.', options);
    return;
  }

  let trimmed = value.trim();
  let scopedPackage = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
  let barePackage = /^[a-z0-9][a-z0-9._-]*$/;
  let hasPathOrProtocol = /^(?:[a-z][a-z0-9+.-]*:|\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/])/.test(trimmed) ||
    trimmed.includes('\\') ||
    (trimmed.includes('/') && !scopedPackage.test(trimmed));

  if (/\s/.test(trimmed) || hasPathOrProtocol || (!barePackage.test(trimmed) && !scopedPackage.test(trimmed))) {
    pushError(errors, path, `Value "${value}" must be a portable package or registry identifier, not a URL or path.`, options);
  }
}

function validatePortableStringArray(value, path, errors, options = {}) {
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`, options);
    return;
  }
  let seen = new Set();
  for (let i = 0; i < value.length; i++) {
    let itemPath = `${path}[${i}]`;
    validatePortableId(value[i], itemPath, errors, options);
    if (typeof value[i] === 'string') {
      if (seen.has(value[i])) {
        pushError(errors, itemPath, `Duplicate portable identifier "${value[i]}".`, options);
      }
      seen.add(value[i]);
    }
  }
}

function rejectDeletedKeys(value, keys, path, errors, options) {
  for (let key of keys) {
    if (isObject(value) && Object.prototype.hasOwnProperty.call(value, key)) {
      pushError(errors, `${path}.${key}`, `"${key}" is not part of the module capability contract; this vocabulary was removed.`, options);
    }
  }
}

function isJsonSerializable(value, seen = new Set()) {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return false;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    let valid = value.every((item) => isJsonSerializable(item, seen));
    seen.delete(value);
    return valid;
  }
  if (!isObject(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  if (seen.has(value)) return false;
  seen.add(value);
  let valid = Object.values(value).every((item) => isJsonSerializable(item, seen));
  seen.delete(value);
  return valid;
}

function validateDoes(does, path, errors, options) {
  if (!isObject(does)) {
    pushError(errors, path, 'Action requires a single `does` dispatch union.', options);
    return;
  }
  if (!ACTION_DOES_KINDS.includes(does.kind)) {
    pushError(errors, `${path}.kind`, `Action does.kind must be one of: ${ACTION_DOES_KINDS.join(', ')}.`, options);
    return;
  }
  switch (does.kind) {
    case 'emit':
      if (typeof does.event !== 'string' || !does.event.trim()) {
        pushError(errors, `${path}.event`, "does.kind:'emit' requires a non-empty event name.", options);
      }
      break;
    case 'method':
      if (typeof does.method !== 'string' || !does.method.trim()) {
        pushError(errors, `${path}.method`, "does.kind:'method' requires a non-empty method name.", options);
      }
      break;
    case 'wire':
      if (typeof does.to !== 'string' || !does.to.trim()) {
        pushError(errors, `${path}.to`, "does.kind:'wire' requires a `to` endpoint.", options);
      }
      break;
    case 'command':
      if (typeof does.command !== 'string' || !does.command.trim()) {
        pushError(errors, `${path}.command`, "does.kind:'command' requires a command id.", options);
      }
      if (does.scope !== 'host') {
        pushError(errors, `${path}.scope`, "does.kind:'command' requires scope:'host'.", options);
      }
      break;
    default:
      break;
  }
}

function validateActionList(value, path, errors, options) {
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`, options);
    return;
  }
  let ids = new Set();
  for (let i = 0; i < value.length; i++) {
    let action = value[i];
    let itemPath = `${path}[${i}]`;
    if (!isObject(action)) {
      pushError(errors, itemPath, 'Action entry must be an object.', options);
      continue;
    }
    validatePortableId(action.id, `${itemPath}.id`, errors, options);
    if (action.id && ids.has(action.id)) {
      pushError(errors, `${itemPath}.id`, `Duplicate action ID "${action.id}".`, options);
    }
    if (action.id) ids.add(action.id);
    validateLocalizableString(action.label, `${itemPath}.label`, errors, options, { required: true });
    rejectDeletedKeys(action, DELETED_ACTION_KEYS, itemPath, errors, options);
    validateDoes(action.does, `${itemPath}.does`, errors, options);
    if (action.mutates !== undefined && typeof action.mutates !== 'boolean') {
      pushError(errors, `${itemPath}.mutates`, 'Action mutates must be a boolean.', options);
    }
  }
}

function validateSettings(value, path, errors, options) {
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`, options);
    return;
  }
  let ids = new Set();
  for (let i = 0; i < value.length; i++) {
    let setting = value[i];
    let itemPath = `${path}[${i}]`;
    if (!isObject(setting)) {
      pushError(errors, itemPath, 'Setting entry must be an object.', options);
      continue;
    }
    validatePortableId(setting.id, `${itemPath}.id`, errors, options);
    if (setting.id && ids.has(setting.id)) {
      pushError(errors, `${itemPath}.id`, `Duplicate setting ID "${setting.id}".`, options);
    }
    if (setting.id) ids.add(setting.id);
    validateLocalizableString(setting.label, `${itemPath}.label`, errors, options, { required: true });
    if (!SETTING_TYPES.includes(setting.type)) {
      pushError(errors, `${itemPath}.type`, `Invalid setting type "${setting.type}".`, options);
    }
    rejectDeletedKeys(setting, DELETED_ROW_KEYS, itemPath, errors, options);
  }
}

function validateStateFields(value, path, errors, options) {
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`, options);
    return;
  }
  let ids = new Set();
  for (let i = 0; i < value.length; i++) {
    let field = value[i];
    let itemPath = `${path}[${i}]`;
    if (!isObject(field)) {
      pushError(errors, itemPath, 'State field entry must be an object.', options);
      continue;
    }
    validatePortableId(field.id, `${itemPath}.id`, errors, options);
    if (field.id && ids.has(field.id)) {
      pushError(errors, `${itemPath}.id`, `Duplicate state field ID "${field.id}".`, options);
    }
    if (field.id) ids.add(field.id);
    if (!STATE_TYPES.includes(field.type)) {
      pushError(errors, `${itemPath}.type`, `Invalid state field type "${field.type}".`, options);
    }
    if (field.path !== undefined && (typeof field.path !== 'string' || !field.path.trim())) {
      pushError(errors, `${itemPath}.path`, 'State field path must be a non-empty string.', options);
    }
    if (field.schema !== undefined && !isObject(field.schema)) {
      pushError(errors, `${itemPath}.schema`, 'State field schema must be an object.', options);
    }
    if (Object.prototype.hasOwnProperty.call(field, 'default') && !isJsonSerializable(field.default)) {
      pushError(errors, `${itemPath}.default`, 'State field default must be JSON-serializable.', options);
    }
    if (field.persistence !== undefined && !DESCRIPTOR_STATE_TIERS.includes(field.persistence)) {
      pushError(errors, `${itemPath}.persistence`, `State field persistence must be one of: ${DESCRIPTOR_STATE_TIERS.join(', ')}.`, options);
    }
    rejectDeletedKeys(field, DELETED_ROW_KEYS, itemPath, errors, options);
  }
}

function validateEvents(value, path, errors, options) {
  if (!isObject(value)) {
    pushError(errors, path, `${path} must be an object.`, options);
    return;
  }
  for (let key of ['emits', 'consumes']) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key])) {
      pushError(errors, `${path}.${key}`, `${path}.${key} must be an array.`, options);
      continue;
    }
    for (let i = 0; i < value[key].length; i++) {
      let event = value[key][i];
      let itemPath = `${path}.${key}[${i}]`;
      if (!isObject(event)) {
        pushError(errors, itemPath, 'Event entry must be an object.', options);
        continue;
      }
      if (typeof event.name !== 'string' || !event.name.trim()) {
        pushError(errors, `${itemPath}.name`, 'Event requires a non-empty name.', options);
      }
      if (event.detailSchema !== undefined && !isObject(event.detailSchema)) {
        pushError(errors, `${itemPath}.detailSchema`, 'Event detailSchema must be an object.', options);
      }
      rejectDeletedKeys(event, DELETED_EVENT_KEYS, itemPath, errors, options);
      rejectDeletedKeys(event, DELETED_ROW_KEYS, itemPath, errors, options);
    }
  }
}

function validateBindings(value, path, errors, options) {
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`, options);
    return;
  }
  let ids = new Set();
  for (let i = 0; i < value.length; i++) {
    let binding = value[i];
    let itemPath = `${path}[${i}]`;
    if (!isObject(binding)) {
      pushError(errors, itemPath, 'Binding entry must be an object.', options);
      continue;
    }
    validatePortableId(binding.id, `${itemPath}.id`, errors, options);
    if (binding.id && ids.has(binding.id)) {
      pushError(errors, `${itemPath}.id`, `Duplicate binding ID "${binding.id}".`, options);
    }
    if (binding.id) ids.add(binding.id);
    if (!BINDING_DIRECTIONS.includes(binding.direction)) {
      pushError(errors, `${itemPath}.direction`, `Invalid binding direction "${binding.direction}".`, options);
    }
    if (binding.schema !== undefined && !isObject(binding.schema)) {
      pushError(errors, `${itemPath}.schema`, 'Binding schema must be an object.', options);
    }
    rejectDeletedKeys(binding, DELETED_ROW_KEYS, itemPath, errors, options);
  }
}

function validateSlots(value, path, errors, options) {
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`, options);
    return;
  }
  let ids = new Set();
  for (let i = 0; i < value.length; i++) {
    let slot = value[i];
    let itemPath = `${path}[${i}]`;
    if (!isObject(slot)) {
      pushError(errors, itemPath, 'Slot entry must be an object.', options);
      continue;
    }
    validatePortableId(slot.id, `${itemPath}.id`, errors, options);
    if (slot.id && ids.has(slot.id)) {
      pushError(errors, `${itemPath}.id`, `Duplicate slot ID "${slot.id}".`, options);
    }
    if (slot.id) ids.add(slot.id);
    if (slot.accepts !== undefined) validatePortableStringArray(slot.accepts, `${itemPath}.accepts`, errors, options);
    if (slot.required !== undefined && typeof slot.required !== 'boolean') {
      pushError(errors, `${itemPath}.required`, 'Slot required must be a boolean.', options);
    }
  }
}

function validateStreams(value, path, errors, options) {
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`, options);
    return;
  }
  let ids = new Set();
  for (let i = 0; i < value.length; i++) {
    let stream = value[i];
    let itemPath = `${path}[${i}]`;
    if (!isObject(stream)) {
      pushError(errors, itemPath, 'Stream entry must be an object.', options);
      continue;
    }
    validatePortableId(stream.id, `${itemPath}.id`, errors, options);
    if (stream.id && ids.has(stream.id)) {
      pushError(errors, `${itemPath}.id`, `Duplicate stream ID "${stream.id}".`, options);
    }
    if (stream.id) ids.add(stream.id);
    if (!STREAM_DIRECTIONS.includes(stream.direction)) {
      pushError(errors, `${itemPath}.direction`, `Stream direction must be one of: ${STREAM_DIRECTIONS.join(', ')}.`, options);
    }
    if (!STREAM_ENCODINGS.includes(stream.encoding)) {
      pushError(errors, `${itemPath}.encoding`, `Stream encoding must be one of: ${STREAM_ENCODINGS.join(', ')}.`, options);
    }
  }
}

function validateGraphOwnership(value, path, errors, options) {
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`, options);
    return;
  }
  for (let i = 0; i < value.length; i++) {
    let entry = value[i];
    let itemPath = `${path}[${i}]`;
    if (!isObject(entry)) {
      pushError(errors, itemPath, 'graphOwnership entry must be an object.', options);
      continue;
    }
    let hasGraph = entry.graph !== undefined;
    let hasNodeType = entry.nodeType !== undefined;
    if (hasGraph === hasNodeType) {
      pushError(errors, itemPath, 'graphOwnership entry requires exactly one of `graph` or `nodeType`.', options);
    } else if (hasGraph) {
      validatePortableId(entry.graph, `${itemPath}.graph`, errors, options);
    } else {
      validatePortableId(entry.nodeType, `${itemPath}.nodeType`, errors, options);
    }
    if (!GRAPH_OWNERSHIP_POLICIES.includes(entry.policy)) {
      pushError(errors, `${itemPath}.policy`, `graphOwnership policy must be one of: ${GRAPH_OWNERSHIP_POLICIES.join(', ')}.`, options);
    }
  }
}

/**
 * Engine endpoints inside descriptors are TYPE-LEVEL only (`nodeType`); the
 * instance-level `{graphId,nodeId}` form is legal only in config wires (§2.4).
 */
function validateTypeLevelEngineRef(value, path, errors, options) {
  if (!isObject(value)) {
    pushError(errors, path, `${path} must be an object.`, options);
    return;
  }
  if (value.graphId !== undefined || value.nodeId !== undefined) {
    pushError(errors, path, 'Descriptors may only carry type-level engine references (`nodeType`); instance-level `{graphId,nodeId}` is illegal here.', options);
    return;
  }
  validatePortableId(value.nodeType, `${path}.nodeType`, errors, options);
  for (let field of ['param', 'input', 'output', 'pack']) {
    if (value[field] !== undefined) validatePortableId(value[field], `${path}.${field}`, errors, options);
  }
}

function validateWireEndpoint(endpoint, path, errors, options) {
  if (typeof endpoint === 'string') {
    if (!endpoint.startsWith('#')) {
      pushError(errors, path, 'A module-side wire endpoint must be a bare `#surface` fragment.', options);
    }
    return;
  }
  if (isObject(endpoint) && endpoint.engine !== undefined) {
    validateTypeLevelEngineRef(endpoint.engine, `${path}.engine`, errors, options);
    return;
  }
  pushError(errors, path, 'Wire endpoint must be a `#surface` fragment or a { engine: { nodeType } } type-level reference.', options);
}

function validateSuggests(value, path, errors, options) {
  if (!isObject(value)) {
    pushError(errors, path, `${path} must be an object.`, options);
    return;
  }
  if (value.wires === undefined) return;
  if (!Array.isArray(value.wires)) {
    pushError(errors, `${path}.wires`, `${path}.wires must be an array.`, options);
    return;
  }
  for (let i = 0; i < value.wires.length; i++) {
    let wire = value.wires[i];
    let itemPath = `${path}.wires[${i}]`;
    if (!isObject(wire)) {
      pushError(errors, itemPath, 'suggests.wires entry must be an object.', options);
      continue;
    }
    if (wire.from === undefined) pushError(errors, `${itemPath}.from`, 'suggests.wires entry requires a `from` endpoint.', options);
    else validateWireEndpoint(wire.from, `${itemPath}.from`, errors, options);
    if (wire.to === undefined) pushError(errors, `${itemPath}.to`, 'suggests.wires entry requires a `to` endpoint.', options);
    else validateWireEndpoint(wire.to, `${itemPath}.to`, errors, options);
  }
}

function validateHostServices(value, path, errors, options) {
  if (!isObject(value)) {
    pushError(errors, path, `${path} must be an object with { required, optional } arrays.`, options);
    return;
  }
  if (value.required !== undefined) validatePortableStringArray(value.required, `${path}.required`, errors, options);
  if (value.optional !== undefined) validatePortableStringArray(value.optional, `${path}.optional`, errors, options);
}

function hostServicesInclude(hostServices, capabilityId) {
  if (!isObject(hostServices)) return false;
  let required = Array.isArray(hostServices.required) ? hostServices.required : [];
  let optional = Array.isArray(hostServices.optional) ? hostServices.optional : [];
  return required.includes(capabilityId) || optional.includes(capabilityId);
}

/**
 * Encodes a module id into a CSS/tool custom-ident token per the WAS rule
 * (`:` and `.` collapse to `--`).
 *
 * @param {string} moduleId
 * @returns {string}
 */
export function encodeModuleIdent(moduleId) {
  return String(moduleId).replace(/[:.]/g, '--');
}

/**
 * webmcp.tools — declared tool names derive from the namespaced module id, never
 * the tagName (R-UI24). Declaring tools requires `agent.webmcp` in the module's
 * hostServices (R-F4).
 */
function validateWebmcp(value, path, descriptor, options, errors, moduleId) {
  if (!isObject(value)) {
    pushError(errors, path, `${path} must be an object.`, options);
    return;
  }
  if (value.tools === undefined) return;
  if (!Array.isArray(value.tools)) {
    pushError(errors, `${path}.tools`, `${path}.tools must be an array.`, options);
    return;
  }
  if (value.tools.length > 0 && !hostServicesInclude(descriptor.hostServices, AGENT_WEBMCP_CAPABILITY)) {
    pushError(errors, `${path}.tools`, `Declaring webmcp.tools requires "${AGENT_WEBMCP_CAPABILITY}" in the module hostServices.`, options);
  }
  let prefix = moduleId ? encodeModuleIdent(moduleId) : null;
  let tagPrefix = typeof descriptor.tagName === 'string' ? descriptor.tagName : null;
  let names = new Set();
  for (let i = 0; i < value.tools.length; i++) {
    let tool = value.tools[i];
    let itemPath = `${path}.tools[${i}]`;
    if (!isObject(tool)) {
      pushError(errors, itemPath, 'webmcp tool entry must be an object.', options);
      continue;
    }
    if (typeof tool.name !== 'string' || !tool.name.trim()) {
      pushError(errors, `${itemPath}.name`, 'webmcp tool requires a non-empty name.', options);
      continue;
    }
    if (names.has(tool.name)) {
      pushError(errors, `${itemPath}.name`, `Duplicate webmcp tool name "${tool.name}".`, options);
    }
    names.add(tool.name);
    if (prefix && tool.name !== prefix && !tool.name.startsWith(`${prefix}_`)) {
      pushError(errors, `${itemPath}.name`, `webmcp tool name "${tool.name}" must derive from the module id (expected prefix "${prefix}").`, options);
    } else if (!prefix && tagPrefix && (tool.name === tagPrefix || tool.name.startsWith(`${tagPrefix}_`) || tool.name.startsWith(`${tagPrefix}-`))) {
      pushError(errors, `${itemPath}.name`, 'webmcp tool name must derive from the namespaced module id, never the tagName.', options);
    }
  }
}

function validatePlacement(value, path, errors, options) {
  if (!isObject(value)) {
    pushError(errors, path, 'placement must be an object.', options);
    return;
  }
  validateLocalizableString(value.title, `${path}.title`, errors, options);
  if (value.icon !== undefined) validatePortableId(value.icon, `${path}.icon`, errors, options);
  if (value.behavior !== undefined && !isObject(value.behavior)) {
    pushError(errors, `${path}.behavior`, 'placement.behavior must be an object.', options);
  }
  if (value.regions !== undefined) validatePortableStringArray(value.regions, `${path}.regions`, errors, options);
  if (value.registers !== undefined) validatePortableStringArray(value.registers, `${path}.registers`, errors, options);
}

function validateLifecycle(value, path, errors, options) {
  if (!isObject(value)) {
    pushError(errors, path, `${path} must be an object.`, options);
    return;
  }
  if (value.readiness !== undefined && !READINESS_MODES.includes(value.readiness)) {
    pushError(errors, `${path}.readiness`, `lifecycle.readiness must be one of: ${READINESS_MODES.join(', ')}.`, options);
  }
}

/**
 * Validates a module capability descriptor (spec §2.3). One contract for all
 * three module sources.
 *
 * @param {any} descriptor
 * @param {string} path
 * @param {Array} errors
 * @param {{ severity?: boolean, moduleId?: string }} [options]
 */
export function validateModuleCapabilityDescriptor(descriptor, path, errors, options = {}) {
  let moduleId = options.moduleId;
  if (!isObject(descriptor)) {
    pushError(errors, path, 'Module capability descriptor must be an object.', options);
    return;
  }

  if (typeof descriptor.tagName !== 'string' || !descriptor.tagName.trim()) {
    pushError(errors, `${path}.tagName`, 'Module capability descriptor requires a tagName.', options);
  } else if (!CUSTOM_ELEMENT_PATTERN.test(descriptor.tagName)) {
    pushError(errors, `${path}.tagName`, `Component tag "${descriptor.tagName}" must be a valid custom element name.`, options);
  }

  // Flat requiredHostServices is deleted in favour of hostServices{required,optional}.
  if (descriptor.requiredHostServices !== undefined) {
    pushError(errors, `${path}.requiredHostServices`, 'Flat `requiredHostServices` is removed; use `hostServices { required, optional }`.', options);
  }

  validateLocalizableString(descriptor.title, `${path}.title`, errors, options);
  validateLocalizableString(descriptor.description, `${path}.description`, errors, options);

  if (descriptor.provider !== undefined) validatePortablePackageReference(descriptor.provider, `${path}.provider`, errors, options);
  if (descriptor.capabilities !== undefined) validatePortableStringArray(descriptor.capabilities, `${path}.capabilities`, errors, options);
  if (descriptor.themeParts !== undefined) validatePortableStringArray(descriptor.themeParts, `${path}.themeParts`, errors, options);

  if (descriptor.actions !== undefined) validateActionList(descriptor.actions, `${path}.actions`, errors, options);
  if (descriptor.settings !== undefined) validateSettings(descriptor.settings, `${path}.settings`, errors, options);
  if (descriptor.state !== undefined) validateStateFields(descriptor.state, `${path}.state`, errors, options);
  if (descriptor.events !== undefined) validateEvents(descriptor.events, `${path}.events`, errors, options);
  if (descriptor.bindings !== undefined) validateBindings(descriptor.bindings, `${path}.bindings`, errors, options);
  if (descriptor.slots !== undefined) validateSlots(descriptor.slots, `${path}.slots`, errors, options);
  if (descriptor.runtimeSlots !== undefined) validateSlots(descriptor.runtimeSlots, `${path}.runtimeSlots`, errors, options);
  if (descriptor.streams !== undefined) validateStreams(descriptor.streams, `${path}.streams`, errors, options);
  if (descriptor.graphOwnership !== undefined) validateGraphOwnership(descriptor.graphOwnership, `${path}.graphOwnership`, errors, options);
  if (descriptor.suggests !== undefined) validateSuggests(descriptor.suggests, `${path}.suggests`, errors, options);
  if (descriptor.hostServices !== undefined) validateHostServices(descriptor.hostServices, `${path}.hostServices`, errors, options);
  if (descriptor.lifecycle !== undefined) validateLifecycle(descriptor.lifecycle, `${path}.lifecycle`, errors, options);
  if (descriptor.webmcp !== undefined) validateWebmcp(descriptor.webmcp, `${path}.webmcp`, descriptor, options, errors, moduleId);
  if (descriptor.placement !== undefined) validatePlacement(descriptor.placement, `${path}.placement`, errors, options);
}

export {
  validatePortableStringArray,
  validatePortableId,
  validatePortablePackageReference,
  hostServicesInclude,
  MODULE_ID_PATTERN,
};
