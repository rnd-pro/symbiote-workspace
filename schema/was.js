import {
  CAPABILITY_ID_PATTERN,
  PORTABLE_ID_PATTERN,
  RESERVED_ID_CHARACTERS,
  RT_PREFIX,
  RUNTIME_ID_PATTERN,
  STRUCTURAL_ID_PATTERN,
} from './constants.js';

const SURFACE_DIRECTIONS = Object.freeze({
  event: 'source',
  out: 'source',
  stream: 'source',
  method: 'target',
  in: 'target',
  param: 'target',
  property: 'target',
  binding: 'bidirectional',
});

const PLACE_CLASSES = new Set(['view', 'panel', 'stack', 'node', 'socket', 'element']);
const VALUE_CLASSES = new Set(['state', 'rt', 'doc', 'asset', 'content']);
const SUBJECT_CLASSES = new Set(['action', 'event', 'binding', 'route']);
const VARIABLE_BY_CLASS = Object.freeze({
  view: ['viewId'],
  panel: ['viewId', 'instanceId'],
  stack: ['viewId', 'stackId'],
  node: ['graphId', 'nodeId'],
  socket: ['graphId', 'nodeId', 'socketId'],
});

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function assertNoReservedCharacters(value, label) {
  for (let char of RESERVED_ID_CHARACTERS) {
    if (String(value).includes(char)) {
      throw new Error(`${label} "${value}" cannot contain reserved character "${char}".`);
    }
  }
}

function assertPattern(value, pattern, label) {
  assertString(value, label);
  assertNoReservedCharacters(value, label);
  if (!pattern.test(value)) {
    throw new Error(`${label} "${value}" does not match the workspace address grammar.`);
  }
}

function splitClass(input) {
  let index = input.indexOf(':');
  if (index === -1) {
    throw new Error(`Workspace address "${input}" must start with an address class.`);
  }
  let className = input.slice(0, index);
  let rest = input.slice(index + 1);
  assertString(className, 'Address class');
  assertString(rest, `Address body for ${className}`);
  return { className, rest };
}

function splitFragment(input) {
  let index = input.indexOf('#');
  if (index === -1) return { base: input, fragment: null };
  if (input.indexOf('#', index + 1) !== -1) {
    throw new Error(`Workspace address "${input}" cannot contain more than one fragment.`);
  }
  return {
    base: input.slice(0, index),
    fragment: input.slice(index + 1),
  };
}

function validateStructuralSegment(value, label, options = {}) {
  if (options.allowWildcard && value === '*') return;
  if (options.allowTemplate && /{[A-Za-z][A-Za-z0-9]*}/.test(value)) {
    return validateTemplateSegment(value, label);
  }
  assertPattern(value, STRUCTURAL_ID_PATTERN, label);
}

function validatePortableSegment(value, label, options = {}) {
  if (options.allowWildcard && value === '*') return;
  if (options.allowTemplate && /{[A-Za-z][A-Za-z0-9]*}/.test(value)) {
    return validateTemplateSegment(value, label);
  }
  assertPattern(value, PORTABLE_ID_PATTERN, label);
}

function validateRuntimeSegment(value, label, options = {}) {
  if (options.allowWildcard && value === '*') return;
  if (options.allowTemplate && /{[A-Za-z][A-Za-z0-9]*}/.test(value)) {
    return validateTemplateSegment(value, label);
  }
  assertPattern(value, RUNTIME_ID_PATTERN, label);
}

function validateTemplateSegment(value, label) {
  assertString(value, label);
  for (let char of ['*', '[', ']']) {
    if (value.includes(char)) {
      throw new Error(`${label} "${value}" cannot contain reserved character "${char}".`);
    }
  }
  let stripped = value.replace(/{[A-Za-z][A-Za-z0-9]*}/g, 'x');
  if (!/^[A-Za-z0-9_-]+$/.test(stripped)) {
    throw new Error(`${label} "${value}" is not a valid template segment.`);
  }
}

function validateFieldPath(value, label) {
  assertString(value, label);
  assertNoReservedCharacters(value, label);
  let segments = value.split('.');
  for (let segment of segments) {
    assertPattern(segment, STRUCTURAL_ID_PATTERN, `${label} segment`);
  }
}

function parseRouteSubject(rest) {
  let parts = rest.split(':');
  if (parts.length !== 2 || !['enter', 'exit'].includes(parts[0])) {
    throw new Error('route subjects must use route:enter:<viewId> or route:exit:<viewId>.');
  }
  validateStructuralSegment(parts[1], 'Route view id');
  return { action: parts[0], viewId: parts[1] };
}

function parseSurface(fragment) {
  if (!fragment) throw new Error('Place endpoint requires a surface fragment.');
  let { className, rest } = splitClass(fragment);
  if (!Object.hasOwn(SURFACE_DIRECTIONS, className)) {
    throw new Error(`Unknown endpoint surface "${className}".`);
  }
  validatePortableSegment(rest, `${className} surface id`);
  return {
    kind: className,
    id: rest,
    direction: SURFACE_DIRECTIONS[className],
  };
}

function directionForValueAddress(className) {
  if (className === 'rt') return 'source';
  return 'bidirectional';
}

function validateEndpointPosition(endpoint, position) {
  if (!position || position === 'either') return;
  let direction = endpoint.surface?.direction || endpoint.direction;
  if (position === 'from' && direction === 'target') {
    throw new Error(`Endpoint "${endpoint.raw}" is target-only and cannot be used as from.`);
  }
  if (position === 'to' && direction === 'source') {
    throw new Error(`Endpoint "${endpoint.raw}" is source-only and cannot be used as to.`);
  }
}

function parsePlaceAddress(className, rest, options) {
  let parts = rest.split(':');
  if (className === 'view') {
    if (parts.length !== 1) throw new Error('view addresses use view:<viewId>.');
    validateStructuralSegment(parts[0], 'View id', options);
    return { viewId: parts[0] };
  }
  if (className === 'panel') {
    if (parts.length !== 2) throw new Error('panel addresses use panel:<viewId>:<instanceId>.');
    validateStructuralSegment(parts[0], 'Panel view id', options);
    validateStructuralSegment(parts[1], 'Panel instance id', options);
    return { viewId: parts[0], instanceId: parts[1] };
  }
  if (className === 'stack') {
    if (rest === 'root') return { root: true };
    if (parts.length !== 2) throw new Error('stack addresses use stack:root or stack:<viewId>:<stackId>.');
    validateStructuralSegment(parts[0], 'Stack view id', options);
    validateStructuralSegment(parts[1], 'Stack id', options);
    return { viewId: parts[0], stackId: parts[1] };
  }
  if (className === 'node') {
    if (parts.length !== 2) throw new Error('node addresses use node:<graphId>:<nodeId>.');
    validateStructuralSegment(parts[0], 'Graph id', options);
    validatePortableSegment(parts[1], 'Node id', options);
    return { graphId: parts[0], nodeId: parts[1] };
  }
  if (className === 'socket') {
    if (parts.length !== 3) {
      throw new Error('socket addresses use socket:<graphId>:<nodeId>:<socketId>.');
    }
    validateStructuralSegment(parts[0], 'Socket graph id', options);
    validatePortableSegment(parts[1], 'Socket node id', options);
    validatePortableSegment(parts[2], 'Socket id', options);
    return { graphId: parts[0], nodeId: parts[1], socketId: parts[2] };
  }
  if (className === 'element') {
    validatePortableSegment(rest, 'Element target', options);
    return { target: rest };
  }
  throw new Error(`Unsupported place address class "${className}".`);
}

function parseValueAddress(className, rest, fragment) {
  if (className === 'state') {
    if (fragment) throw new Error('state addresses do not take fragments.');
    validateFieldPath(rest, 'State field path');
    return { fieldPath: rest };
  }
  if (className === 'rt') {
    if (fragment) throw new Error('rt addresses do not take fragments.');
    assertString(rest, 'Realtime channel id');
    if (!rest.startsWith('workspace:') && !CAPABILITY_ID_PATTERN.test(rest)) {
      throw new Error(`Realtime channel "${rest}" must be a platform or dotted channel id.`);
    }
    return { channelId: rest, topic: `${RT_PREFIX}${rest}` };
  }
  if (className === 'doc') {
    let parts = rest.split(':');
    if (parts.length !== 2) throw new Error('doc addresses use doc:<collectionId>:<docId>[#path].');
    validatePortableSegment(parts[0], 'Document collection id');
    validateRuntimeSegment(parts[1], 'Document id');
    return { collectionId: parts[0], docId: parts[1], path: fragment };
  }
  if (className === 'asset') {
    if (fragment) throw new Error('asset addresses do not take fragments.');
    validatePortableSegment(rest, 'Asset id');
    return { assetId: rest };
  }
  if (className === 'content') {
    let parts = rest.split(':');
    if (parts.length !== 2) {
      throw new Error('content addresses use content:<collectionId>:<entryId>[#field].');
    }
    validatePortableSegment(parts[0], 'Content collection id');
    validatePortableSegment(parts[1], 'Content entry id');
    return { collectionId: parts[0], entryId: parts[1], field: fragment };
  }
  throw new Error(`Unsupported value address class "${className}".`);
}

function extractVariables(value) {
  let variables = new Set();
  for (let match of String(value).matchAll(/{([A-Za-z][A-Za-z0-9]*)}/g)) {
    variables.add(match[1]);
  }
  return variables;
}

function captureVariablesForAddress(address) {
  let names = VARIABLE_BY_CLASS[address.className] || [];
  let values = names.map((name) => address[name]);
  let captures = new Set();
  for (let i = 0; i < values.length; i++) {
    if (values[i] === '*') captures.add(names[i]);
  }
  return captures;
}

/**
 * @param {string} input
 * @param {Object} [options]
 * @param {boolean} [options.allowWildcard]
 * @param {boolean} [options.allowTemplate]
 * @returns {Object}
 */
export function parseWorkspaceAddress(input, options = {}) {
  assertString(input, 'Workspace address');
  let { base, fragment } = splitFragment(input);
  let { className, rest } = splitClass(base);

  if (PLACE_CLASSES.has(className)) {
    if (fragment) throw new Error(`${className} addresses take endpoint surfaces, not paths.`);
    return {
      raw: input,
      className,
      kind: 'place',
      ...parsePlaceAddress(className, rest, options),
    };
  }
  if (VALUE_CLASSES.has(className)) {
    return {
      raw: input,
      className,
      kind: 'value',
      ...parseValueAddress(className, rest, fragment),
    };
  }
  if (SUBJECT_CLASSES.has(className)) {
    if (fragment) throw new Error(`${className} subjects do not take fragments.`);
    let payload = className === 'route'
      ? parseRouteSubject(rest)
      : (validatePortableSegment(rest, `${className} subject id`), { id: rest });
    return { raw: input, className, kind: 'subject', ...payload };
  }
  if (className === 'resource') {
    assertNoReservedCharacters(rest, 'Reserved resource address');
    return { raw: input, className, kind: 'reserved', id: rest };
  }
  throw new Error(`Unknown workspace address class "${className}".`);
}

/**
 * @param {Object} address
 * @returns {string}
 */
export function serializeWorkspaceAddress(address) {
  if (address.className === 'view') return `view:${address.viewId}`;
  if (address.className === 'panel') return `panel:${address.viewId}:${address.instanceId}`;
  if (address.className === 'stack') {
    return address.root ? 'stack:root' : `stack:${address.viewId}:${address.stackId}`;
  }
  if (address.className === 'node') return `node:${address.graphId}:${address.nodeId}`;
  if (address.className === 'socket') {
    return `socket:${address.graphId}:${address.nodeId}:${address.socketId}`;
  }
  if (address.className === 'element') return `element:${address.target}`;
  if (address.className === 'state') return `state:${address.fieldPath}`;
  if (address.className === 'rt') return `rt:${address.channelId}`;
  if (address.className === 'doc') {
    return `doc:${address.collectionId}:${address.docId}${address.path ? `#${address.path}` : ''}`;
  }
  if (address.className === 'asset') return `asset:${address.assetId}`;
  if (address.className === 'content') {
    return `content:${address.collectionId}:${address.entryId}${address.field ? `#${address.field}` : ''}`;
  }
  if (['action', 'event', 'binding'].includes(address.className)) {
    return `${address.className}:${address.id}`;
  }
  if (address.className === 'route') return `route:${address.action}:${address.viewId}`;
  if (address.className === 'resource') return `resource:${address.id}`;
  throw new Error(`Cannot serialize unknown workspace address class "${address.className}".`);
}

/**
 * @param {string} input
 * @param {Object} [options]
 * @param {'from'|'to'|'either'} [options.position]
 * @returns {Object}
 */
export function parseWorkspaceEndpoint(input, options = {}) {
  assertString(input, 'Workspace endpoint');
  let { base, fragment } = splitFragment(input);
  let { className } = splitClass(base);
  let position = options.position || 'either';
  let addressOptions = {
    allowWildcard: position === 'from',
    allowTemplate: position === 'to',
  };

  if (PLACE_CLASSES.has(className)) {
    let address = parseWorkspaceAddress(base, addressOptions);
    let endpoint = {
      raw: input,
      kind: 'place',
      address,
      surface: parseSurface(fragment),
    };
    validateEndpointPosition(endpoint, position);
    return endpoint;
  }
  if (VALUE_CLASSES.has(className)) {
    let address = parseWorkspaceAddress(input);
    let endpoint = {
      raw: input,
      kind: 'value',
      address,
      direction: directionForValueAddress(className),
    };
    validateEndpointPosition(endpoint, position);
    return endpoint;
  }
  throw new Error(`"${input}" is not a place or value endpoint.`);
}

/**
 * @param {Object} endpoint
 * @returns {string}
 */
export function serializeWorkspaceEndpoint(endpoint) {
  let address = serializeWorkspaceAddress(endpoint.address);
  if (!endpoint.surface) return address;
  return `${address}#${endpoint.surface.kind}:${endpoint.surface.id}`;
}

/**
 * @param {Object|string} fromEndpoint
 * @param {Object|string} toEndpoint
 * @returns {{captures: string[], templates: string[]}}
 */
export function validateEndpointPair(fromEndpoint, toEndpoint) {
  let from = typeof fromEndpoint === 'string'
    ? parseWorkspaceEndpoint(fromEndpoint, { position: 'from' })
    : fromEndpoint;
  let to = typeof toEndpoint === 'string'
    ? parseWorkspaceEndpoint(toEndpoint, { position: 'to' })
    : toEndpoint;
  let captures = captureVariablesForAddress(from.address);
  let templates = extractVariables(serializeWorkspaceEndpoint(to));
  for (let template of templates) {
    if (!captures.has(template)) {
      throw new Error(`Template variable "${template}" is not bound by the from endpoint.`);
    }
  }
  return { captures: [...captures], templates: [...templates] };
}

/**
 * @param {string} value
 * @param {Object} [options]
 * @param {string} [options.prefix]
 * @returns {string}
 */
export function encodeWasCustomIdent(value, options = {}) {
  assertString(value, 'WAS custom ident source');
  if (value.includes('--')) {
    throw new Error(`WAS custom ident source "${value}" cannot contain "--".`);
  }
  assertNoReservedCharacters(value, 'WAS custom ident source');
  let prefix = options.prefix || 'sn';
  return `${prefix}-${value.replaceAll(':', '--').replaceAll('.', '--')}`;
}

/**
 * @param {string} expression
 * @returns {{address: Object, pseudo: 'focused'}}
 */
export function parseWhenExpression(expression) {
  assertString(expression, 'When expression');
  if (/\s|[&|!()]/.test(expression)) {
    throw new Error('When expression v1 accepts one WAS address with optional :focused only.');
  }
  if (!expression.endsWith(':focused')) {
    throw new Error('When expression v1 must end with the focused pseudo-target.');
  }
  let addressText = expression.slice(0, -':focused'.length);
  return {
    address: parseWorkspaceAddress(addressText),
    pseudo: 'focused',
  };
}

/**
 * @param {string} stackId
 * @param {string} itemKey
 * @returns {string}
 */
export function createDynamicStackInstanceId(stackId, itemKey) {
  assertPattern(stackId, STRUCTURAL_ID_PATTERN, 'Stack id');
  assertPattern(itemKey, RUNTIME_ID_PATTERN, 'Dynamic stack item key');
  return `${stackId}-${itemKey}`;
}

export const parseWasAddress = parseWorkspaceAddress;
export const parseWasEndpoint = parseWorkspaceEndpoint;
