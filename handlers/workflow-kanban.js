/**
 * Workflow kanban handler - mounts a portable kanban board module into a workspace config.
 * @module symbiote-workspace/handlers/workflow-kanban
 */

import {
  COLLAPSE_POLICIES,
  MOBILE_DOCKS,
  OVERFLOW_POLICIES,
  RESPONSIVE_MODES,
  SWIPE_CONTROLS,
} from '../schema/workspace-schema.js';

const KANBAN_COMPONENT = 'sn-kanban-board';
const KANBAN_EVENTS = Object.freeze([
  'sn-board-card-select',
  'sn-board-card-action',
  'sn-board-card-drop',
]);
const PORTABLE_ID_RE = /^[a-z][a-z0-9]*(?:[./:_-][a-z0-9]+)*$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneConfig(config) {
  return cloneJson(config);
}

function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPortableId(value) {
  return typeof value === 'string' && PORTABLE_ID_RE.test(value);
}

function ensureJsonSerializable(value, label) {
  let jsonError = findNonJsonValue(value, label);
  if (jsonError) {
    let err = new Error(jsonError);
    err.code = 'workflow_kanban_json_invalid';
    throw err;
  }
  try {
    return cloneJson(value);
  } catch (error) {
    let err = new Error(`${label} must be plain JSON: ${error.message}`);
    err.code = 'workflow_kanban_json_invalid';
    throw err;
  }
}

function findNonJsonValue(value, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? null : `${path} must not contain non-finite numbers.`;
  }
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    return `${path} must contain only JSON values.`;
  }
  if (Array.isArray(value)) {
    for (let [index, item] of value.entries()) {
      let error = findNonJsonValue(item, `${path}[${index}]`);
      if (error) return error;
    }
    return null;
  }
  if (!isObject(value)) return `${path} must contain only plain JSON objects.`;
  for (let [key, item] of Object.entries(value)) {
    let error = findNonJsonValue(item, `${path}.${key}`);
    if (error) return error;
  }
  return null;
}

function validateBoard(board) {
  if (!isObject(board)) {
    return 'Workflow kanban board must be a plain object.';
  }
  if (!isPortableId(board.id)) {
    return 'Workflow kanban board.id must be a portable identifier.';
  }
  if (board.title !== undefined && (typeof board.title !== 'string' || !board.title.trim())) {
    return 'Workflow kanban board.title must be a non-empty string when provided.';
  }
  if (!Array.isArray(board.columns) || board.columns.length === 0) {
    return 'Workflow kanban board.columns must be a non-empty array.';
  }
  for (let [index, column] of board.columns.entries()) {
    if (!isObject(column)) return `Workflow kanban board.columns[${index}] must be an object.`;
    if (!isPortableId(column.id)) {
      return `Workflow kanban board.columns[${index}].id must be a portable identifier.`;
    }
    if (typeof column.title !== 'string' || !column.title.trim()) {
      return `Workflow kanban board.columns[${index}].title must be a non-empty string.`;
    }
    let cardError = validateCards(column.cards, `Workflow kanban board.columns[${index}].cards`);
    if (cardError) return cardError;
  }
  let cardError = validateCards(board.cards, 'Workflow kanban board.cards');
  if (cardError) return cardError;
  return null;
}

function validateCards(cards, label) {
  if (cards === undefined) return null;
  if (!Array.isArray(cards)) return `${label} must be an array when provided.`;
  for (let [index, card] of cards.entries()) {
    if (!isObject(card)) return `${label}[${index}] must be an object.`;
    if (!isPortableId(card.id)) return `${label}[${index}].id must be a portable identifier.`;
    if (typeof card.title !== 'string' || !card.title.trim()) {
      return `${label}[${index}].title must be a non-empty string.`;
    }
  }
  return null;
}

function uniquePush(list, value) {
  if (!list.includes(value)) list.push(value);
}

function upsertByKey(list, item, keyFn) {
  let key = keyFn(item);
  let index = list.findIndex((entry) => keyFn(entry) === key);
  if (index >= 0) {
    list[index] = item;
  } else {
    list.push(item);
  }
}

function errorResult(config, hint) {
  return { config, status: 'error', hint };
}

function mergePortableIds(left = [], right = []) {
  return [...new Set([...left, ...right])].sort();
}

function validateFiniteRange(value, path, { min = -Infinity, max = Infinity } = {}) {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    let range = min !== -Infinity && max !== Infinity
      ? ` between ${min} and ${max}`
      : ` greater than or equal to ${min}`;
    return `${path} must be a finite number${range}.`;
  }
  return null;
}

function validateOneOf(value, path, values) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !values.includes(value)) {
    return `${path} must be one of: ${values.join(', ')}.`;
  }
  return null;
}

function validateBehavior(behavior, label) {
  let validators = [
    validateFiniteRange(behavior.importance, `${label}.importance`, { min: 0, max: 100 }),
    validateFiniteRange(behavior.minInlineSize, `${label}.minInlineSize`, { min: 0 }),
    validateFiniteRange(behavior.minBlockSize, `${label}.minBlockSize`, { min: 0 }),
    validateFiniteRange(behavior.responsiveBreakpoint, `${label}.responsiveBreakpoint`, { min: 0 }),
    validateOneOf(behavior.collapse, `${label}.collapse`, COLLAPSE_POLICIES),
    validateOneOf(behavior.overflow, `${label}.overflow`, OVERFLOW_POLICIES),
    validateOneOf(behavior.responsiveMode, `${label}.responsiveMode`, RESPONSIVE_MODES),
    validateOneOf(behavior.mobileDock, `${label}.mobileDock`, MOBILE_DOCKS),
    validateOneOf(behavior.swipeControl, `${label}.swipeControl`, SWIPE_CONTROLS),
  ];
  return validators.find(Boolean) || null;
}

function workflowKanbanModule(icon, behavior, requiredHostServices) {
  return {
    tagName: KANBAN_COMPONENT,
    schemaVersion: '0.1.0',
    provider: 'symbiote-ui',
    descriptor: {
      schemaVersion: '2.0.0',
      package: 'symbiote-ui',
      component: KANBAN_COMPONENT,
    },
    capabilities: ['workflow.kanban', 'kanban-board', 'workflow.move-intent'],
    placement: {
      title: 'Workflow Kanban',
      icon,
      behavior,
      regions: ['workflow', 'board'],
    },
    events: {
      emits: [
        { name: 'sn-board-card-select', description: 'A workflow card was selected.' },
        { name: 'sn-board-card-action', description: 'A workflow card action was requested.' },
        { name: 'sn-board-card-drop', description: 'A workflow card move was requested.' },
      ],
    },
    state: [
      {
        id: 'board',
        type: 'object',
        persistence: 'workspace',
        schema: { type: 'object' },
      },
    ],
    ...(requiredHostServices?.length ? { requiredHostServices } : {}),
  };
}

function mergeKanbanModule(existing, incoming) {
  if (!existing) return incoming;
  let requiredHostServices = mergePortableIds(
    existing.requiredHostServices,
    incoming.requiredHostServices,
  );
  let custom = { ...existing };
  for (let key of [
    'provider',
    'descriptor',
    'capabilities',
    'placement',
    'events',
    'state',
    'requiredHostServices',
  ]) {
    delete custom[key];
  }
  return {
    ...custom,
    ...incoming,
    ...(requiredHostServices.length ? { requiredHostServices } : {}),
  };
}

function workflowKanbanBindings(panelType) {
  return [
    {
      panelType,
      component: KANBAN_COMPONENT,
      id: 'board',
      direction: 'input',
      path: `state.${panelType}.board`,
      schema: { type: 'object' },
    },
    {
      panelType,
      component: KANBAN_COMPONENT,
      id: 'selected-card',
      direction: 'output',
      path: `state.${panelType}.selectedCard`,
      schema: { type: 'object' },
    },
    {
      panelType,
      component: KANBAN_COMPONENT,
      id: 'move-intent',
      direction: 'output',
      path: `state.${panelType}.moveIntent`,
      schema: { type: 'object' },
    },
  ];
}

function workflowKanbanEvents(panelType, eventTarget = {}) {
  return KANBAN_EVENTS.map((event) => {
    let isDrop = event === 'sn-board-card-drop';
    return {
      id: `workflow-kanban-${panelType}-${event.replace(/^sn-board-card-/, '')}`,
      sourcePanel: panelType,
      event,
      ...(isDrop && eventTarget.panelType ? { targetPanel: eventTarget.panelType } : {}),
      ...(isDrop && eventTarget.targetMethod ? { targetMethod: eventTarget.targetMethod } : {}),
      ...(isDrop && eventTarget.targetProperty ? { targetProperty: eventTarget.targetProperty } : {}),
      ...(isDrop && eventTarget.mapping ? { mapping: eventTarget.mapping } : {}),
    };
  });
}

/**
 * Register or update a workflow kanban board panel.
 *
 * @param {Object} config
 * @param {Object} args
 * @param {string} args.panelType
 * @param {Object} args.board
 * @param {string} [args.title]
 * @param {string} [args.icon]
 * @param {Object} [args.behavior]
 * @param {string} [args.layoutId]
 * @param {boolean} [args.setDefaultLayout]
 * @param {Object} [args.group]
 * @param {Object} [args.section]
 * @param {Object} [args.eventTarget]
 * @param {string[]} [args.requiredHostServices]
 * @returns {Object}
 */
export function workflowKanban(config, args = {}) {
  let panelType = args.panelType;
  if (!isPortableId(panelType)) {
    return errorResult(config, 'workflow_kanban requires panelType as a portable identifier.');
  }

  let boardError = validateBoard(args.board);
  if (boardError) {
    return errorResult(config, boardError);
  }

  if (args.layoutId !== undefined && !isPortableId(args.layoutId)) {
    return errorResult(config, 'workflow_kanban layoutId must be a portable identifier when provided.');
  }
  if (args.title !== undefined && (typeof args.title !== 'string' || !args.title.trim())) {
    return errorResult(config, 'workflow_kanban title must be a non-empty string when provided.');
  }
  if (args.icon !== undefined && (typeof args.icon !== 'string' || !args.icon.trim())) {
    return errorResult(config, 'workflow_kanban icon must be a non-empty string when provided.');
  }
  if (args.behavior !== undefined && !isObject(args.behavior)) {
    return errorResult(config, 'workflow_kanban behavior must be a plain object when provided.');
  }
  if (args.behavior !== undefined) {
    let behaviorError = validateBehavior(args.behavior, 'workflow_kanban behavior');
    if (behaviorError) return errorResult(config, behaviorError);
  }
  if (args.eventTarget !== undefined && !isObject(args.eventTarget)) {
    return errorResult(config, 'workflow_kanban eventTarget must be a plain object when provided.');
  }
  if (args.eventTarget?.panelType !== undefined && !isPortableId(args.eventTarget.panelType)) {
    return errorResult(
      config,
      'workflow_kanban eventTarget.panelType must be a portable identifier when provided.',
    );
  }
  if (
    args.eventTarget?.targetMethod !== undefined &&
    (typeof args.eventTarget.targetMethod !== 'string' || !args.eventTarget.targetMethod.trim())
  ) {
    return errorResult(
      config,
      'workflow_kanban eventTarget.targetMethod must be a non-empty string when provided.',
    );
  }
  if (
    args.eventTarget?.targetProperty !== undefined &&
    (typeof args.eventTarget.targetProperty !== 'string' || !args.eventTarget.targetProperty.trim())
  ) {
    return errorResult(
      config,
      'workflow_kanban eventTarget.targetProperty must be a non-empty string when provided.',
    );
  }
  if (args.eventTarget?.mapping !== undefined && !isObject(args.eventTarget.mapping)) {
    return errorResult(
      config,
      'workflow_kanban eventTarget.mapping must be a plain object when provided.',
    );
  }
  if (args.requiredHostServices !== undefined && !Array.isArray(args.requiredHostServices)) {
    return errorResult(config, 'workflow_kanban requiredHostServices must be an array when provided.');
  }
  if (args.requiredHostServices?.some((service) => !isPortableId(service))) {
    return errorResult(
      config,
      'workflow_kanban requiredHostServices entries must be portable identifiers.',
    );
  }

  let board;
  let behavior;
  let eventTarget;
  let requiredHostServices;
  try {
    board = ensureJsonSerializable(args.board, 'Workflow kanban board');
    behavior = args.behavior
      ? ensureJsonSerializable(args.behavior, 'Workflow kanban behavior')
      : { importance: 70, minInlineSize: 300 };
    eventTarget = args.eventTarget
      ? ensureJsonSerializable(args.eventTarget, 'Workflow kanban eventTarget')
      : {};
    requiredHostServices = args.requiredHostServices
      ? ensureJsonSerializable(args.requiredHostServices, 'Workflow kanban requiredHostServices')
      : undefined;
  } catch (error) {
    return errorResult(config, error.message);
  }

  let next = cloneConfig(config);
  let title = args.title || board.title || 'Workflow Kanban';
  let icon = args.icon || 'view_kanban';
  let boardPath = `state.${panelType}.board`;
  let module = workflowKanbanModule(icon, behavior, requiredHostServices);

  next.panelTypes ||= {};
  next.panelTypes[panelType] = {
    title,
    icon,
    component: KANBAN_COMPONENT,
    behavior,
  };

  next.components ||= {};
  next.components.catalog ||= [];
  uniquePush(next.components.catalog, KANBAN_COMPONENT);
  next.components.modules ||= [];
  let existingModule = next.components.modules.find((entry) => entry.tagName === KANBAN_COMPONENT);
  module = mergeKanbanModule(existingModule, module);
  upsertByKey(
    next.components.modules,
    module,
    (entry) => entry.tagName,
  );

  next.state ||= {};
  next.state.fields ||= [];
  upsertByKey(next.state.fields, {
    panelType,
    component: KANBAN_COMPONENT,
    id: 'board',
    type: 'object',
    path: boardPath,
    default: board,
    persistence: 'workspace',
    schema: { type: 'object' },
  }, (entry) => `${entry.panelType}:${entry.component}:${entry.id}`);

  next.data ||= {};
  next.data.bindings ||= [];
  for (let binding of workflowKanbanBindings(panelType)) {
    upsertByKey(next.data.bindings, binding, (entry) => `${entry.panelType}:${entry.component}:${entry.id}`);
  }

  next.events ||= [];
  for (let event of workflowKanbanEvents(panelType, eventTarget)) {
    upsertByKey(next.events, event, (entry) => entry.id);
  }

  if (args.layoutId) {
    next.layouts ||= {};
    next.layouts[args.layoutId] = { type: 'panel', panelType };
  }
  if (args.setDefaultLayout === true) {
    next.layout = { type: 'panel', panelType };
  }

  if (args.group) {
    if (!isPortableId(args.group.id) || typeof args.group.name !== 'string' || !args.group.name.trim()) {
      return errorResult(config, 'workflow_kanban group requires portable id and non-empty name.');
    }
    if (args.group.icon !== undefined && (typeof args.group.icon !== 'string' || !args.group.icon.trim())) {
      return errorResult(config, 'workflow_kanban group.icon must be a non-empty string when provided.');
    }
    if (args.group.color !== undefined && typeof args.group.color !== 'string') {
      return errorResult(config, 'workflow_kanban group.color must be a string when provided.');
    }
    next.groups ||= [];
    upsertByKey(next.groups, {
      id: args.group.id,
      name: args.group.name,
      icon: args.group.icon || 'view_kanban',
      ...(args.group.color ? { color: args.group.color } : {}),
    }, (entry) => entry.id);
  }

  if (args.section) {
    if (
      !isPortableId(args.section.id) ||
      typeof args.section.label !== 'string' ||
      !args.section.label.trim()
    ) {
      return errorResult(config, 'workflow_kanban section requires portable id and non-empty label.');
    }
    if (args.section.groupId !== undefined && !isPortableId(args.section.groupId)) {
      return errorResult(
        config,
        'workflow_kanban section.groupId must be a portable identifier when provided.',
      );
    }
    if (
      args.section.icon !== undefined &&
      (typeof args.section.icon !== 'string' || !args.section.icon.trim())
    ) {
      return errorResult(config, 'workflow_kanban section.icon must be a non-empty string when provided.');
    }
    if (args.section.order !== undefined && !Number.isFinite(args.section.order)) {
      return errorResult(config, 'workflow_kanban section.order must be a finite number when provided.');
    }
    next.sections ||= [];
    upsertByKey(next.sections, {
      id: args.section.id,
      label: args.section.label,
      icon: args.section.icon || 'view_kanban',
      ...(args.section.groupId ? { groupId: args.section.groupId } : {}),
      ...(args.section.order !== undefined ? { order: args.section.order } : {}),
      ...(args.layoutId ? { layoutId: args.layoutId } : {}),
    }, (entry) => entry.id);
  }

  return {
    status: 'ok',
    config: next,
    panelType,
    component: KANBAN_COMPONENT,
    boardPath,
    events: [...KANBAN_EVENTS],
    hint: `Workflow kanban "${panelType}" registered.`,
  };
}
