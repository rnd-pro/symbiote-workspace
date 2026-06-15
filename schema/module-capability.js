export const MODULE_CAPABILITY_SCHEMA_VERSION = '0.1.0';

const PORTABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[./:_-][a-z0-9]+)*$/;
const CUSTOM_ELEMENT_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

function stringProperty(description) {
  return { type: 'string', description };
}

const MODULE_ENGINE_REFERENCE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['graphId', 'nodeId'],
  properties: {
    graphId: stringProperty('Portable engine graph identifier.'),
    nodeId: stringProperty('Portable engine node identifier.'),
    input: stringProperty('Optional engine node input socket.'),
    output: stringProperty('Optional engine node output socket.'),
    param: stringProperty('Optional engine node parameter name.'),
    pack: stringProperty('Optional required engine pack identifier.'),
  },
});

const MODULE_ACTION_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id', 'label'],
  properties: {
    id: stringProperty('Portable action identifier.'),
    label: stringProperty('Human-readable action label.'),
    icon: stringProperty('Material Symbols icon name.'),
    command: stringProperty('Portable command identifier handled by the host or module.'),
    event: stringProperty('DOM event emitted when the action is invoked.'),
    method: stringProperty('Component method to call when invoked.'),
    binding: stringProperty('Data binding identifier affected by the action.'),
    engine: MODULE_ENGINE_REFERENCE_SCHEMA,
  },
});

const MODULE_SETTING_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id', 'label', 'type'],
  properties: {
    id: stringProperty('Portable setting identifier.'),
    label: stringProperty('Human-readable setting label.'),
    type: {
      type: 'string',
      enum: ['string', 'number', 'boolean', 'enum', 'object', 'array', 'color', 'token', 'json'],
    },
    default: {},
    options: { type: 'array', items: { type: 'object' } },
    binding: stringProperty('Data binding identifier updated by this setting.'),
    engine: MODULE_ENGINE_REFERENCE_SCHEMA,
  },
});

const MODULE_STATE_FIELD_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id', 'type'],
  properties: {
    id: stringProperty('Portable state field identifier.'),
    type: {
      type: 'string',
      enum: ['string', 'number', 'boolean', 'enum', 'object', 'array', 'color', 'token', 'json'],
    },
    default: {},
    path: stringProperty('Portable workspace state path.'),
    schema: { type: 'object' },
    persistence: { type: 'string', enum: ['session', 'workspace', 'ephemeral'] },
    engine: MODULE_ENGINE_REFERENCE_SCHEMA,
  },
});

const MODULE_EVENT_SCHEMA = Object.freeze({
  type: 'object',
  required: ['name'],
  properties: {
    name: stringProperty('DOM event name.'),
    detailSchema: { type: 'object' },
    description: stringProperty('Event description.'),
    engine: MODULE_ENGINE_REFERENCE_SCHEMA,
  },
});

const MODULE_BINDING_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id', 'direction'],
  properties: {
    id: stringProperty('Portable binding identifier.'),
    direction: { type: 'string', enum: ['input', 'output', 'two-way'] },
    path: stringProperty('Config or state path for the binding.'),
    schema: { type: 'object' },
    engine: MODULE_ENGINE_REFERENCE_SCHEMA,
  },
});

const MODULE_SLOT_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id'],
  properties: {
    id: stringProperty('Portable slot identifier.'),
    role: stringProperty('Slot role in the module.'),
    accepts: { type: 'array', items: { type: 'string' } },
    required: { type: 'boolean' },
  },
});

const MODULE_PLACEMENT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    panelType: stringProperty('Portable panel type identifier for generated workspace panels.'),
    title: stringProperty('Panel title for generated workspace panels.'),
    icon: stringProperty('Material Symbols icon name for generated workspace panels.'),
    behavior: { type: 'object' },
    regions: { type: 'array', items: { type: 'string' } },
    registers: { type: 'array', items: { type: 'string' } },
  },
});

export const MODULE_CAPABILITY_DESCRIPTOR_SCHEMA = Object.freeze({
  type: 'object',
  required: ['tagName'],
  properties: {
    tagName: stringProperty('Custom element tag name owned by the module.'),
    schemaVersion: stringProperty('Module capability descriptor schema version.'),
    provider: stringProperty('Provider package or registry identifier.'),
    descriptor: {
      type: 'object',
      description: 'Reference to the provider descriptor without embedding host-local paths or endpoints.',
      properties: {
        schemaVersion: stringProperty('Provider descriptor schema version.'),
        package: stringProperty('Provider package name.'),
        export: stringProperty('Provider export name.'),
        component: stringProperty('Provider component identifier.'),
      },
    },
    capabilities: {
      type: 'array',
      items: { type: 'string' },
      description: 'Portable capability tags used by the constructor.',
    },
    actions: { type: 'array', items: MODULE_ACTION_SCHEMA },
    menus: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'label'],
        properties: {
          id: stringProperty('Portable menu identifier.'),
          label: stringProperty('Human-readable menu label.'),
          items: { type: 'array', items: MODULE_ACTION_SCHEMA },
        },
      },
    },
    toolbarItems: { type: 'array', items: MODULE_ACTION_SCHEMA },
    settings: { type: 'array', items: MODULE_SETTING_SCHEMA },
    state: { type: 'array', items: MODULE_STATE_FIELD_SCHEMA },
    events: {
      type: 'object',
      properties: {
        emits: { type: 'array', items: MODULE_EVENT_SCHEMA },
        consumes: { type: 'array', items: MODULE_EVENT_SCHEMA },
      },
    },
    bindings: { type: 'array', items: MODULE_BINDING_SCHEMA },
    slots: { type: 'array', items: MODULE_SLOT_SCHEMA },
    runtimeSlots: { type: 'array', items: MODULE_SLOT_SCHEMA },
    requiredHostServices: {
      type: 'array',
      items: { type: 'string' },
      description: 'Portable service IDs the host must provide; never credentials or endpoints.',
    },
    placement: {
      ...MODULE_PLACEMENT_SCHEMA,
      description: 'Constructor placement hints such as regions, registers, and panel roles.',
    },
  },
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pushError(errors, path, message, options) {
  let error = { path, message };
  if (options.severity !== false) error.severity = 'error';
  errors.push(error);
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
    if (typeof action.label !== 'string' || !action.label.trim()) {
      pushError(errors, `${itemPath}.label`, 'Action requires a non-empty label.', options);
    }
    if (action.id && ids.has(action.id)) {
      pushError(errors, `${itemPath}.id`, `Duplicate action ID "${action.id}".`, options);
    }
    if (action.id) ids.add(action.id);
    if (action.engine !== undefined) {
      validateEngineReference(action.engine, `${itemPath}.engine`, errors, options);
    }
  }
}

function validateSettings(value, path, errors, options) {
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`, options);
    return;
  }
  let types = new Set(MODULE_SETTING_SCHEMA.properties.type.enum);
  for (let i = 0; i < value.length; i++) {
    let setting = value[i];
    let itemPath = `${path}[${i}]`;
    if (!isObject(setting)) {
      pushError(errors, itemPath, 'Setting entry must be an object.', options);
      continue;
    }
    validatePortableId(setting.id, `${itemPath}.id`, errors, options);
    if (typeof setting.label !== 'string' || !setting.label.trim()) {
      pushError(errors, `${itemPath}.label`, 'Setting requires a non-empty label.', options);
    }
    if (!types.has(setting.type)) {
      pushError(errors, `${itemPath}.type`, `Invalid setting type "${setting.type}".`, options);
    }
    if (setting.engine !== undefined) {
      validateEngineReference(setting.engine, `${itemPath}.engine`, errors, options);
    }
  }
}

function validateStateFields(value, path, errors, options) {
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`, options);
    return;
  }
  let types = new Set(MODULE_STATE_FIELD_SCHEMA.properties.type.enum);
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
    if (!types.has(field.type)) {
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
    if (field.persistence !== undefined && !MODULE_STATE_FIELD_SCHEMA.properties.persistence.enum.includes(field.persistence)) {
      pushError(errors, `${itemPath}.persistence`, 'State field persistence must be session, workspace, or ephemeral.', options);
    }
    if (field.engine !== undefined) {
      validateEngineReference(field.engine, `${itemPath}.engine`, errors, options);
    }
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
      } else {
        if (typeof event.name !== 'string' || !event.name.trim()) {
          pushError(errors, `${itemPath}.name`, 'Event requires a non-empty name.', options);
        }
        if (event.engine !== undefined) {
          validateEngineReference(event.engine, `${itemPath}.engine`, errors, options);
        }
      }
    }
  }
}

function validateBindings(value, path, errors, options) {
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`, options);
    return;
  }
  let directions = new Set(MODULE_BINDING_SCHEMA.properties.direction.enum);
  for (let i = 0; i < value.length; i++) {
    let binding = value[i];
    let itemPath = `${path}[${i}]`;
    if (!isObject(binding)) {
      pushError(errors, itemPath, 'Binding entry must be an object.', options);
      continue;
    }
    validatePortableId(binding.id, `${itemPath}.id`, errors, options);
    if (!directions.has(binding.direction)) {
      pushError(errors, `${itemPath}.direction`, `Invalid binding direction "${binding.direction}".`, options);
    }
    if (binding.engine !== undefined) {
      validateEngineReference(binding.engine, `${itemPath}.engine`, errors, options);
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

function validateEngineReference(value, path, errors, options) {
  if (!isObject(value)) {
    pushError(errors, path, `${path} must be an object.`, options);
    return;
  }
  validatePortableId(value.graphId, `${path}.graphId`, errors, options);
  validatePortableId(value.nodeId, `${path}.nodeId`, errors, options);
  for (let field of ['input', 'output', 'param', 'pack']) {
    if (value[field] !== undefined) {
      validatePortableId(value[field], `${path}.${field}`, errors, options);
    }
  }
}

function validateSlots(value, path, errors, options) {
  if (!Array.isArray(value)) {
    pushError(errors, path, `${path} must be an array.`, options);
    return;
  }
  for (let i = 0; i < value.length; i++) {
    let slot = value[i];
    let itemPath = `${path}[${i}]`;
    if (!isObject(slot)) {
      pushError(errors, itemPath, 'Slot entry must be an object.', options);
      continue;
    }
    validatePortableId(slot.id, `${itemPath}.id`, errors, options);
    if (slot.accepts !== undefined) validatePortableStringArray(slot.accepts, `${itemPath}.accepts`, errors, options);
  }
}

function validatePlacement(value, path, errors, options) {
  if (!isObject(value)) {
    pushError(errors, path, 'placement must be an object.', options);
    return;
  }

  if (value.panelType !== undefined) {
    validatePortableId(value.panelType, `${path}.panelType`, errors, options);
  }
  if (value.title !== undefined && (typeof value.title !== 'string' || !value.title.trim())) {
    pushError(errors, `${path}.title`, 'placement.title must be a non-empty string.', options);
  }
  if (value.icon !== undefined) {
    validatePortableId(value.icon, `${path}.icon`, errors, options);
  }
  if (value.behavior !== undefined && !isObject(value.behavior)) {
    pushError(errors, `${path}.behavior`, 'placement.behavior must be an object.', options);
  }
  if (value.regions !== undefined) {
    validatePortableStringArray(value.regions, `${path}.regions`, errors, options);
  }
  if (value.registers !== undefined) {
    validatePortableStringArray(value.registers, `${path}.registers`, errors, options);
  }
}

/**
 * @param {any} descriptor
 * @param {string} path
 * @param {Array} errors
 * @param {{ severity?: boolean }} [options]
 */
export function validateModuleCapabilityDescriptor(descriptor, path, errors, options = {}) {
  if (!isObject(descriptor)) {
    pushError(errors, path, 'Module capability descriptor must be an object.', options);
    return;
  }

  if (typeof descriptor.tagName !== 'string' || !descriptor.tagName.trim()) {
    pushError(errors, `${path}.tagName`, 'Module capability descriptor requires a tagName.', options);
  } else if (!CUSTOM_ELEMENT_PATTERN.test(descriptor.tagName)) {
    pushError(errors, `${path}.tagName`, `Component tag "${descriptor.tagName}" must be a valid custom element name.`, options);
  }

  if (descriptor.schemaVersion !== undefined && typeof descriptor.schemaVersion !== 'string') {
    pushError(errors, `${path}.schemaVersion`, 'schemaVersion must be a string.', options);
  }
  if (descriptor.provider !== undefined && typeof descriptor.provider !== 'string') {
    pushError(errors, `${path}.provider`, 'provider must be a string.', options);
  }
  if (descriptor.descriptor !== undefined && !isObject(descriptor.descriptor)) {
    pushError(errors, `${path}.descriptor`, 'descriptor must be an object.', options);
  }

  if (descriptor.capabilities !== undefined) {
    validatePortableStringArray(descriptor.capabilities, `${path}.capabilities`, errors, options);
  }
  if (descriptor.requiredHostServices !== undefined) {
    validatePortableStringArray(descriptor.requiredHostServices, `${path}.requiredHostServices`, errors, options);
  }
  if (descriptor.actions !== undefined) validateActionList(descriptor.actions, `${path}.actions`, errors, options);
  if (descriptor.toolbarItems !== undefined) validateActionList(descriptor.toolbarItems, `${path}.toolbarItems`, errors, options);
  if (descriptor.menus !== undefined) {
    if (!Array.isArray(descriptor.menus)) {
      pushError(errors, `${path}.menus`, 'menus must be an array.', options);
    } else {
      for (let i = 0; i < descriptor.menus.length; i++) {
        let menu = descriptor.menus[i];
        let itemPath = `${path}.menus[${i}]`;
        if (!isObject(menu)) {
          pushError(errors, itemPath, 'Menu entry must be an object.', options);
          continue;
        }
        validatePortableId(menu.id, `${itemPath}.id`, errors, options);
        if (typeof menu.label !== 'string' || !menu.label.trim()) {
          pushError(errors, `${itemPath}.label`, 'Menu requires a non-empty label.', options);
        }
        if (menu.items !== undefined) validateActionList(menu.items, `${itemPath}.items`, errors, options);
      }
    }
  }
  if (descriptor.settings !== undefined) validateSettings(descriptor.settings, `${path}.settings`, errors, options);
  if (descriptor.state !== undefined) validateStateFields(descriptor.state, `${path}.state`, errors, options);
  if (descriptor.events !== undefined) validateEvents(descriptor.events, `${path}.events`, errors, options);
  if (descriptor.bindings !== undefined) validateBindings(descriptor.bindings, `${path}.bindings`, errors, options);
  if (descriptor.slots !== undefined) validateSlots(descriptor.slots, `${path}.slots`, errors, options);
  if (descriptor.runtimeSlots !== undefined) validateSlots(descriptor.runtimeSlots, `${path}.runtimeSlots`, errors, options);
  if (descriptor.placement !== undefined) {
    validatePlacement(descriptor.placement, `${path}.placement`, errors, options);
  }
}

export { validatePortableStringArray };
