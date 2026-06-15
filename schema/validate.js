import {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_REGISTER_VALUES,
  COLLAPSE_POLICIES,
  OVERFLOW_POLICIES,
  RESPONSIVE_MODES,
  MOBILE_DOCKS,
  SWIPE_CONTROLS,
  DATA_BINDING_DIRECTIONS,
} from './workspace-schema.js';
import { validateModuleCapabilityDescriptor } from './module-capability.js';

let PANEL_SETTING_TYPES = new Set(['string', 'number', 'boolean', 'enum', 'object', 'array', 'color', 'token', 'json']);
let STATE_FIELD_TYPES = new Set(['string', 'number', 'boolean', 'enum', 'object', 'array', 'color', 'token', 'json']);
let STATE_FIELD_PERSISTENCE = new Set(['session', 'workspace', 'ephemeral']);
let ENGINE_BINDING_SURFACES = new Set(['action', 'setting', 'state', 'event', 'binding']);
let ENGINE_NODE_CACHE_MODES = new Set(['auto', 'freeze', 'force']);

/** @type {Set<string>} */
let BLOCKED_CONFIG_PATTERNS = new Set([
  'token',
  'apikey',
  'api_key',
  'secret',
  'password',
  'cookie',
  'session',
  'authorization',
  'auth',
  'credential',
]);

/** @type {Set<string>} */
let BLOCKED_VALUE_PATTERNS = new Set([
  'http://',
  'https://',
  'ws://',
  'wss://',
  'localhost',
  '127.0.0.1',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

let PORTABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[./:_-][a-z0-9]+)*$/;
let CUSTOM_ELEMENT_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

function collectKeys(obj, prefix = '', result = []) {
  if (!isObject(obj)) return result;
  for (let key of Object.keys(obj)) {
    let fullKey = prefix ? `${prefix}.${key}` : key;
    result.push(fullKey);
    collectKeys(obj[key], fullKey, result);
  }
  return result;
}

function collectStringValues(obj, result = []) {
  if (typeof obj === 'string') {
    result.push(obj);
    return result;
  }
  if (Array.isArray(obj)) {
    for (let item of obj) collectStringValues(item, result);
    return result;
  }
  if (isObject(obj)) {
    for (let value of Object.values(obj)) collectStringValues(value, result);
  }
  return result;
}

/**
 * @typedef {Object} ValidationError
 * @property {string} path - JSON path to the problematic field
 * @property {string} message - Description of the error
 * @property {string} severity - 'error' | 'warning'
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the config passed validation
 * @property {ValidationError[]} errors
 * @property {ValidationError[]} warnings
 */

/**
 * @param {import('./workspace-schema.js').WorkspaceConfig} config
 * @param {Object} [options]
 * @param {boolean} [options.strict] - Reject unknown top-level keys
 * @returns {ValidationResult}
 */
export function validateWorkspaceConfig(config, options = {}) {
  let errors = [];
  let warnings = [];

  if (!isObject(config)) {
    errors.push({ path: '', message: 'Config must be a plain object.', severity: 'error' });
    return { valid: false, errors, warnings };
  }

  if (!config.version) {
    errors.push({ path: 'version', message: 'Missing required field: version.', severity: 'error' });
  } else if (typeof config.version !== 'string') {
    errors.push({ path: 'version', message: 'Field "version" must be a string.', severity: 'error' });
  }

  if (!config.name) {
    errors.push({ path: 'name', message: 'Missing required field: name.', severity: 'error' });
  } else if (typeof config.name !== 'string') {
    errors.push({ path: 'name', message: 'Field "name" must be a string.', severity: 'error' });
  }

  if (config.register !== undefined) {
    if (!WORKSPACE_REGISTER_VALUES.includes(config.register)) {
      errors.push({
        path: 'register',
        message: `Invalid register value: "${config.register}". Allowed: ${WORKSPACE_REGISTER_VALUES.join(', ')}.`,
        severity: 'error',
      });
    }
  }

  if (config.intent !== undefined) {
    validateIntent(config.intent, 'intent', errors, warnings);
  }

  if (config.construction !== undefined) {
    validateConstruction(config.construction, errors, warnings);
  }

  if (config.patches !== undefined) {
    validatePatches(config.patches, errors, warnings);
  }

  if (config.validation !== undefined) {
    validateValidationReports(config.validation, errors, warnings);
  }

  if (config.runtime !== undefined && !isObject(config.runtime)) {
    errors.push({ path: 'runtime', message: 'Field "runtime" must be an object.', severity: 'error' });
  }

  if (config.exports !== undefined && !isObject(config.exports)) {
    errors.push({ path: 'exports', message: 'Field "exports" must be an object.', severity: 'error' });
  }

  if (config.design !== undefined && !isObject(config.design)) {
    errors.push({ path: 'design', message: 'Field "design" must be an object.', severity: 'error' });
  }

  if (config.theme !== undefined && !isObject(config.theme)) {
    errors.push({ path: 'theme', message: 'Field "theme" must be an object.', severity: 'error' });
  }

  if (config.layout !== undefined && !isObject(config.layout)) {
    errors.push({ path: 'layout', message: 'Field "layout" must be an object.', severity: 'error' });
  }

  if (config.layout && isObject(config.layout)) {
    validateLayoutNode(config.layout, 'layout', errors, warnings);
  }

  // Validate named layouts
  if (config.layouts !== undefined) {
    if (!isObject(config.layouts)) {
      errors.push({ path: 'layouts', message: 'Field "layouts" must be an object.', severity: 'error' });
    } else {
      for (let [layoutId, layoutNode] of Object.entries(config.layouts)) {
        validateLayoutNode(layoutNode, `layouts.${layoutId}`, errors, warnings);
      }
    }
  }

  // Validate groups
  if (config.groups !== undefined) {
    if (!Array.isArray(config.groups)) {
      errors.push({ path: 'groups', message: 'Field "groups" must be an array.', severity: 'error' });
    } else {
      validateGroups(config.groups, errors, warnings);
    }
  }

  // Validate sections
  if (config.sections !== undefined) {
    if (!Array.isArray(config.sections)) {
      errors.push({ path: 'sections', message: 'Field "sections" must be an array.', severity: 'error' });
    } else {
      let groupIds = new Set((config.groups || []).map((g) => g.id));
      validateSections(config.sections, groupIds, errors, warnings);
    }
  }

  // Validate panelTypes
  if (config.panelTypes !== undefined) {
    if (!isObject(config.panelTypes)) {
      errors.push({ path: 'panelTypes', message: 'Field "panelTypes" must be an object.', severity: 'error' });
    } else {
      validatePanelTypes(config.panelTypes, errors, warnings);
    }
  }

  // Validate events
  if (config.events !== undefined) {
    if (!Array.isArray(config.events)) {
      errors.push({ path: 'events', message: 'Field "events" must be an array.', severity: 'error' });
    } else {
      validateEvents(config.events, errors, warnings);
    }
  }

  if (config.data !== undefined) {
    if (!isObject(config.data)) {
      errors.push({ path: 'data', message: 'Field "data" must be an object.', severity: 'error' });
    } else {
      validateData(config.data, errors);
    }
  }

  if (config.state !== undefined) {
    if (!isObject(config.state)) {
      errors.push({ path: 'state', message: 'Field "state" must be an object.', severity: 'error' });
    } else {
      validateState(config.state, errors);
    }
  }

  if (config.engine !== undefined) {
    if (!isObject(config.engine)) {
      errors.push({ path: 'engine', message: 'Field "engine" must be an object.', severity: 'error' });
    } else {
      validateEngine(config.engine, errors);
    }
  }

  // Validate rootBehavior
  if (config.rootBehavior !== undefined) {
    validateBehavior(config.rootBehavior, 'rootBehavior', errors, warnings);
  }

  // Cross-reference: layout panelTypes → panelTypes definitions
  if (config.panelTypes && config.layout) {
    crossReferenceLayout(config.layout, config.panelTypes, 'layout', errors, warnings);
  }

  if (config.components !== undefined) {
    if (!isObject(config.components)) {
      errors.push({ path: 'components', message: 'Field "components" must be an object.', severity: 'error' });
    } else {
      validateComponents(config.components, errors, warnings);
    }
  }

  if (options.strict) {
    let knownKeys = new Set([
      'version', 'name', 'register', 'intent', 'construction', 'patches',
      'validation', 'runtime', 'exports', 'design', 'theme', 'layout', 'layouts',
      'components', 'data', 'state', 'engine', 'groups', 'sections', 'panelTypes',
      'events', 'rootBehavior',
    ]);
    for (let key of Object.keys(config)) {
      if (!knownKeys.has(key)) {
        errors.push({
          path: key,
          message: `Unknown top-level key: "${key}".`,
          severity: 'error',
        });
      }
    }
  }

  checkPortability(config, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

let LAYOUT_TYPES = new Set(['panel', 'split']);
let QUESTION_TYPES = new Set(['text', 'single-select', 'multi-select', 'number', 'boolean']);
let QUESTION_STATUSES = new Set(['answered', 'pending', 'skipped']);
let QUESTION_ANSWER_SOURCES = new Set(['default', 'user', 'derived']);

function validateIntent(intent, path, errors, warnings) {
  if (!isObject(intent)) {
    errors.push({ path, message: 'Intent must be an object.', severity: 'error' });
    return;
  }
  if (!intent.brief || typeof intent.brief !== 'string') {
    errors.push({ path: `${path}.brief`, message: 'Intent requires a non-empty "brief" string.', severity: 'error' });
  }
  if (intent.targetRegister !== undefined && !WORKSPACE_REGISTER_VALUES.includes(intent.targetRegister)) {
    errors.push({
      path: `${path}.targetRegister`,
      message: `Invalid targetRegister value: "${intent.targetRegister}". Allowed: ${WORKSPACE_REGISTER_VALUES.join(', ')}.`,
      severity: 'error',
    });
  }
  for (let field of ['audience', 'constraints', 'requiredCapabilities']) {
    if (intent[field] !== undefined) validateStringArray(intent[field], `${path}.${field}`, errors);
  }
}

function validateStringArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push({ path, message: `${path} must be an array.`, severity: 'error' });
    return;
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string' || !value[i].trim()) {
      errors.push({ path: `${path}[${i}]`, message: `${path} entries must be non-empty strings.`, severity: 'error' });
    }
  }
}

function validateConstruction(construction, errors, warnings) {
  if (!isObject(construction)) {
    errors.push({ path: 'construction', message: 'Field "construction" must be an object.', severity: 'error' });
    return;
  }
  if (construction.intent !== undefined) {
    validateIntent(construction.intent, 'construction.intent', errors, warnings);
  }
  if (construction.questions !== undefined) {
    if (!Array.isArray(construction.questions)) {
      errors.push({ path: 'construction.questions', message: 'construction.questions must be an array.', severity: 'error' });
    } else {
      validateConstructionQuestions(construction.questions, errors, warnings);
    }
  }
  if (construction.plan !== undefined && !isObject(construction.plan)) {
    errors.push({ path: 'construction.plan', message: 'construction.plan must be an object.', severity: 'error' });
  }
}

function validateConstructionQuestions(questions, errors, warnings) {
  let ids = new Set();
  for (let i = 0; i < questions.length; i++) {
    let question = questions[i];
    let path = `construction.questions[${i}]`;
    if (!isObject(question)) {
      errors.push({ path, message: 'Construction question must be an object.', severity: 'error' });
      continue;
    }
    if (!question.id || typeof question.id !== 'string') {
      errors.push({ path: `${path}.id`, message: 'Construction question requires an "id" string.', severity: 'error' });
    } else if (ids.has(question.id)) {
      errors.push({ path: `${path}.id`, message: `Duplicate construction question ID: "${question.id}".`, severity: 'error' });
    } else {
      ids.add(question.id);
    }
    if (!question.title || typeof question.title !== 'string') {
      errors.push({ path: `${path}.title`, message: 'Construction question requires a "title" string.', severity: 'error' });
    }
    if (!QUESTION_TYPES.has(question.type)) {
      errors.push({ path: `${path}.type`, message: `Invalid construction question type: "${question.type}".`, severity: 'error' });
    }
    if (!QUESTION_STATUSES.has(question.status)) {
      errors.push({ path: `${path}.status`, message: `Invalid construction question status: "${question.status}".`, severity: 'error' });
    }
    if (question.answerSource !== undefined && !QUESTION_ANSWER_SOURCES.has(question.answerSource)) {
      errors.push({ path: `${path}.answerSource`, message: `Invalid answerSource: "${question.answerSource}".`, severity: 'error' });
    }
    if (question.status === 'skipped' && !question.skippedReason) {
      errors.push({ path: `${path}.skippedReason`, message: 'Skipped construction questions require skippedReason.', severity: 'error' });
    }
    if (question.dependsOn !== undefined && !Array.isArray(question.dependsOn)) {
      errors.push({ path: `${path}.dependsOn`, message: 'dependsOn must be an array.', severity: 'error' });
    }
  }
}

function validatePatches(patches, errors, warnings) {
  if (!Array.isArray(patches)) {
    errors.push({ path: 'patches', message: 'Field "patches" must be an array.', severity: 'error' });
    return;
  }
  for (let i = 0; i < patches.length; i++) {
    if (!isObject(patches[i])) {
      errors.push({ path: `patches[${i}]`, message: 'Patch entries must be objects.', severity: 'error' });
    }
  }
}

function validateValidationReports(validation, errors, warnings) {
  if (!isObject(validation)) {
    errors.push({ path: 'validation', message: 'Field "validation" must be an object.', severity: 'error' });
    return;
  }
  if (validation.reports !== undefined && !Array.isArray(validation.reports)) {
    errors.push({ path: 'validation.reports', message: 'validation.reports must be an array.', severity: 'error' });
  }
}

function validateLayoutNode(node, path, errors, warnings) {
  if (!isObject(node)) return;

  if (Object.hasOwn(node, 'children')) {
    errors.push({
      path: `${path}.children`,
      message: 'Layout nodes do not support children[]. Use BSP first/second nodes.',
      severity: 'error',
    });
  }

  if (!node.type) {
    errors.push({
      path: `${path}.type`,
      message: 'Layout node requires a "type" field.',
      severity: 'error',
    });
    return;
  }

  if (!LAYOUT_TYPES.has(node.type)) {
    warnings.push({
      path: `${path}.type`,
      message: `Unknown layout type: "${node.type}". Expected: panel or split.`,
      severity: 'warning',
    });
  }

  if (node.type === 'panel') {
    if (!node.panelType || typeof node.panelType !== 'string') {
      warnings.push({
        path: `${path}.panelType`,
        message: 'Panel node should have a "panelType" string.',
        severity: 'warning',
      });
    }
  }

  if (node.type === 'split') {
    if (!node.direction || !['horizontal', 'vertical'].includes(node.direction)) {
      errors.push({
        path: `${path}.direction`,
        message: 'Split node requires direction: "horizontal" or "vertical".',
        severity: 'error',
      });
    }

    if (node.ratio !== undefined) {
      if (typeof node.ratio !== 'number' || node.ratio < 0.05 || node.ratio > 0.95) {
        errors.push({
          path: `${path}.ratio`,
          message: 'Split ratio must be a number between 0.05 and 0.95.',
          severity: 'error',
        });
      }
    }

    if (!node.first) {
      errors.push({
        path: `${path}.first`,
        message: 'Split node requires a "first" child.',
        severity: 'error',
      });
    } else {
      validateLayoutNode(node.first, `${path}.first`, errors, warnings);
    }

    if (!node.second) {
      errors.push({
        path: `${path}.second`,
        message: 'Split node requires a "second" child.',
        severity: 'error',
      });
    } else {
      validateLayoutNode(node.second, `${path}.second`, errors, warnings);
    }
  }

  if (node.behavior) {
    validateBehavior(node.behavior, `${path}.behavior`, errors, warnings);
  }
}

function validateBehavior(behavior, path, errors, warnings) {
  if (!isObject(behavior)) {
    errors.push({ path, message: 'Behavior must be an object.', severity: 'error' });
    return;
  }
  if (behavior.collapse && !COLLAPSE_POLICIES.includes(behavior.collapse)) {
    errors.push({ path: `${path}.collapse`, message: `Invalid collapse: "${behavior.collapse}". Valid: ${COLLAPSE_POLICIES.join(', ')}`, severity: 'error' });
  }
  if (behavior.overflow && !OVERFLOW_POLICIES.includes(behavior.overflow)) {
    errors.push({ path: `${path}.overflow`, message: `Invalid overflow: "${behavior.overflow}". Valid: ${OVERFLOW_POLICIES.join(', ')}`, severity: 'error' });
  }
  if (behavior.responsiveMode && !RESPONSIVE_MODES.includes(behavior.responsiveMode)) {
    errors.push({ path: `${path}.responsiveMode`, message: `Invalid responsiveMode: "${behavior.responsiveMode}". Valid: ${RESPONSIVE_MODES.join(', ')}`, severity: 'error' });
  }
  if (behavior.mobileDock && !MOBILE_DOCKS.includes(behavior.mobileDock)) {
    errors.push({ path: `${path}.mobileDock`, message: `Invalid mobileDock: "${behavior.mobileDock}". Valid: ${MOBILE_DOCKS.join(', ')}`, severity: 'error' });
  }
  if (behavior.swipeControl && !SWIPE_CONTROLS.includes(behavior.swipeControl)) {
    errors.push({ path: `${path}.swipeControl`, message: `Invalid swipeControl: "${behavior.swipeControl}". Valid: ${SWIPE_CONTROLS.join(', ')}`, severity: 'error' });
  }
}

function validateGroups(groups, errors, warnings) {
  let ids = new Set();
  for (let i = 0; i < groups.length; i++) {
    let g = groups[i];
    let path = `groups[${i}]`;
    if (!g.id) errors.push({ path: `${path}.id`, message: 'Group requires an "id".', severity: 'error' });
    if (!g.name) errors.push({ path: `${path}.name`, message: 'Group requires a "name".', severity: 'error' });
    if (g.id && ids.has(g.id)) {
      errors.push({ path: `${path}.id`, message: `Duplicate group ID: "${g.id}".`, severity: 'error' });
    }
    if (g.id) ids.add(g.id);
  }
}

function validateSections(sections, groupIds, errors, warnings) {
  let ids = new Set();
  for (let i = 0; i < sections.length; i++) {
    let s = sections[i];
    let path = `sections[${i}]`;
    if (!s.id) errors.push({ path: `${path}.id`, message: 'Section requires an "id".', severity: 'error' });
    if (!s.label) errors.push({ path: `${path}.label`, message: 'Section requires a "label".', severity: 'error' });
    if (s.id && ids.has(s.id)) {
      errors.push({ path: `${path}.id`, message: `Duplicate section ID: "${s.id}".`, severity: 'error' });
    }
    if (s.id) ids.add(s.id);
    if (s.groupId && groupIds.size > 0 && !groupIds.has(s.groupId)) {
      warnings.push({ path: `${path}.groupId`, message: `Section references unknown group: "${s.groupId}".`, severity: 'warning' });
    }
  }
}

function validatePanelTypes(panelTypes, errors, warnings) {
  for (let [name, pt] of Object.entries(panelTypes)) {
    let path = `panelTypes.${name}`;
    if (!pt.title) errors.push({ path: `${path}.title`, message: 'PanelType requires a "title".', severity: 'error' });
    if (!pt.component) errors.push({ path: `${path}.component`, message: 'PanelType requires a "component".', severity: 'error' });
    if (pt.component && !/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(pt.component)) {
      warnings.push({ path: `${path}.component`, message: `Component tag "${pt.component}" should be a valid custom element name (lowercase with hyphens).`, severity: 'warning' });
    }
    if (pt.behavior) {
      validateBehavior(pt.behavior, `${path}.behavior`, errors, warnings);
    }
    if (pt.menuActions) {
      if (!Array.isArray(pt.menuActions)) {
        errors.push({ path: `${path}.menuActions`, message: 'menuActions must be an array.', severity: 'error' });
      } else {
        let actionIds = new Set();
        for (let j = 0; j < pt.menuActions.length; j++) {
          let action = pt.menuActions[j];
          if (!action.id) errors.push({ path: `${path}.menuActions[${j}].id`, message: 'Menu action requires an "id".', severity: 'error' });
          if (!action.label) errors.push({ path: `${path}.menuActions[${j}].label`, message: 'Menu action requires a "label".', severity: 'error' });
          if (action.id && actionIds.has(action.id)) {
            errors.push({ path: `${path}.menuActions[${j}].id`, message: `Duplicate action ID: "${action.id}".`, severity: 'error' });
          }
          if (action.id) actionIds.add(action.id);
        }
      }
    }
    if (pt.settings) {
      validatePanelSettings(pt.settings, `${path}.settings`, errors);
    }
  }
}

function validatePanelSettings(settings, path, errors) {
  if (!Array.isArray(settings)) {
    errors.push({ path, message: 'settings must be an array.', severity: 'error' });
    return;
  }

  let settingIds = new Set();
  for (let i = 0; i < settings.length; i++) {
    let setting = settings[i];
    let itemPath = `${path}[${i}]`;
    if (!isObject(setting)) {
      errors.push({ path: itemPath, message: 'Panel setting entry must be an object.', severity: 'error' });
      continue;
    }

    validatePortableIdField(setting.id, `${itemPath}.id`, 'Panel setting requires a portable "id".', errors);
    if (setting.id && settingIds.has(setting.id)) {
      errors.push({ path: `${itemPath}.id`, message: `Duplicate setting ID: "${setting.id}".`, severity: 'error' });
    }
    if (setting.id) settingIds.add(setting.id);

    if (!setting.label) errors.push({ path: `${itemPath}.label`, message: 'Panel setting requires a "label".', severity: 'error' });
    if (!setting.type) {
      errors.push({ path: `${itemPath}.type`, message: 'Panel setting requires a "type".', severity: 'error' });
    } else if (!PANEL_SETTING_TYPES.has(setting.type)) {
      errors.push({ path: `${itemPath}.type`, message: `Unknown panel setting type: "${setting.type}".`, severity: 'error' });
    }
    if (setting.options !== undefined && !Array.isArray(setting.options)) {
      errors.push({ path: `${itemPath}.options`, message: 'Panel setting options must be an array.', severity: 'error' });
    }
    if (setting.binding !== undefined) {
      validatePortableIdField(setting.binding, `${itemPath}.binding`, 'Panel setting binding must be portable.', errors);
    }
  }
}

function validateEvents(events, errors, warnings) {
  let ids = new Set();
  for (let i = 0; i < events.length; i++) {
    let ev = events[i];
    let path = `events[${i}]`;
    if (!ev.sourcePanel) errors.push({ path: `${path}.sourcePanel`, message: 'Event bridge requires a "sourcePanel".', severity: 'error' });
    if (!ev.event) errors.push({ path: `${path}.event`, message: 'Event bridge requires an "event".', severity: 'error' });
    if (ev.id) {
      if (ids.has(ev.id)) {
        errors.push({ path: `${path}.id`, message: `Duplicate event bridge ID: "${ev.id}".`, severity: 'error' });
      }
      ids.add(ev.id);
    }
  }
}

function validateData(data, errors) {
  if (data.bindings === undefined) return;
  if (!Array.isArray(data.bindings)) {
    errors.push({ path: 'data.bindings', message: 'data.bindings must be an array.', severity: 'error' });
    return;
  }

  let bindingKeys = new Set();
  for (let i = 0; i < data.bindings.length; i++) {
    let binding = data.bindings[i];
    let path = `data.bindings[${i}]`;
    if (!isObject(binding)) {
      errors.push({ path, message: 'Data binding entry must be an object.', severity: 'error' });
      continue;
    }

    validatePortableIdField(binding.panelType, `${path}.panelType`, 'Data binding requires a portable "panelType".', errors);
    validateCustomElementField(binding.component, `${path}.component`, errors);
    validatePortableIdField(binding.id, `${path}.id`, 'Data binding requires a portable "id".', errors);

    if (typeof binding.direction !== 'string' || !DATA_BINDING_DIRECTIONS.includes(binding.direction)) {
      errors.push({
        path: `${path}.direction`,
        message: `Data binding direction must be one of: ${DATA_BINDING_DIRECTIONS.join(', ')}.`,
        severity: 'error',
      });
    }

    if (binding.path !== undefined) {
      if (typeof binding.path !== 'string' || !binding.path.trim()) {
        errors.push({ path: `${path}.path`, message: 'Data binding path must be a non-empty string.', severity: 'error' });
      } else if (isNonPortableDataPath(binding.path)) {
        errors.push({ path: `${path}.path`, message: 'Data binding path must be a portable config or state path, not a URL or local filesystem path.', severity: 'error' });
      }
    }

    if (binding.schema !== undefined && !isObject(binding.schema)) {
      errors.push({ path: `${path}.schema`, message: 'Data binding schema must be an object.', severity: 'error' });
    }

    if (binding.panelType && binding.id) {
      let key = `${binding.panelType}:${binding.id}`;
      if (bindingKeys.has(key)) {
        errors.push({ path: `${path}.id`, message: `Duplicate data binding for panel/id: "${key}".`, severity: 'error' });
      }
      bindingKeys.add(key);
    }
  }
}

function validateState(state, errors) {
  if (state.fields === undefined) return;
  if (!Array.isArray(state.fields)) {
    errors.push({ path: 'state.fields', message: 'state.fields must be an array.', severity: 'error' });
    return;
  }

  let fieldKeys = new Set();
  for (let i = 0; i < state.fields.length; i++) {
    let field = state.fields[i];
    let path = `state.fields[${i}]`;
    if (!isObject(field)) {
      errors.push({ path, message: 'State field entry must be an object.', severity: 'error' });
      continue;
    }

    validatePortableIdField(field.panelType, `${path}.panelType`, 'State field requires a portable "panelType".', errors);
    validateCustomElementField(field.component, `${path}.component`, errors);
    validatePortableIdField(field.id, `${path}.id`, 'State field requires a portable "id".', errors);

    if (typeof field.type !== 'string' || !STATE_FIELD_TYPES.has(field.type)) {
      errors.push({ path: `${path}.type`, message: 'State field type must be string, number, boolean, enum, object, array, color, token, or json.', severity: 'error' });
    }

    if (field.path !== undefined) {
      if (typeof field.path !== 'string' || !field.path.trim()) {
        errors.push({ path: `${path}.path`, message: 'State field path must be a non-empty string.', severity: 'error' });
      } else if (isNonPortableDataPath(field.path)) {
        errors.push({ path: `${path}.path`, message: 'State field path must be a portable state path, not a URL or local filesystem path.', severity: 'error' });
      }
    }

    if (field.schema !== undefined && !isObject(field.schema)) {
      errors.push({ path: `${path}.schema`, message: 'State field schema must be an object.', severity: 'error' });
    }

    if (field.persistence !== undefined && !STATE_FIELD_PERSISTENCE.has(field.persistence)) {
      errors.push({ path: `${path}.persistence`, message: 'State field persistence must be session, workspace, or ephemeral.', severity: 'error' });
    }

    if (field.default !== undefined && !isJsonSerializable(field.default)) {
      errors.push({ path: `${path}.default`, message: 'State field default must be JSON-serializable.', severity: 'error' });
    }

    if (field.panelType && field.id) {
      let key = `${field.panelType}:${field.id}`;
      if (fieldKeys.has(key)) {
        errors.push({ path: `${path}.id`, message: `Duplicate state field for panel/id: "${key}".`, severity: 'error' });
      }
      fieldKeys.add(key);
    }
  }
}

function validateEngine(engine, errors) {
  let graphIndex = null;
  if (engine.packs !== undefined) {
    validateEnginePacks(engine.packs, errors);
  }
  if (engine.graphs !== undefined) {
    graphIndex = validateEngineGraphs(engine.graphs, errors);
  }
  if (engine.bindings !== undefined) {
    validateEngineBindings(engine.bindings, errors, graphIndex);
  }
}

function validateEnginePacks(packs, errors) {
  if (!Array.isArray(packs)) {
    errors.push({ path: 'engine.packs', message: 'engine.packs must be an array.', severity: 'error' });
    return;
  }
  let ids = new Set();
  for (let i = 0; i < packs.length; i++) {
    let path = `engine.packs[${i}]`;
    validatePortableIdField(packs[i], path, 'Engine pack must be a portable identifier.', errors);
    if (typeof packs[i] === 'string') {
      if (ids.has(packs[i])) {
        errors.push({ path, message: `Duplicate engine pack "${packs[i]}".`, severity: 'error' });
      }
      ids.add(packs[i]);
    }
  }
}

function validateEngineGraphs(graphs, errors) {
  if (!Array.isArray(graphs)) {
    errors.push({ path: 'engine.graphs', message: 'engine.graphs must be an array.', severity: 'error' });
    return null;
  }
  let ids = new Set();
  let graphIndex = new Map();
  for (let i = 0; i < graphs.length; i++) {
    let graph = graphs[i];
    let path = `engine.graphs[${i}]`;
    if (!isObject(graph)) {
      errors.push({ path, message: 'Engine graph entry must be an object.', severity: 'error' });
      continue;
    }
    validatePortableIdField(graph.id, `${path}.id`, 'Engine graph requires a portable "id".', errors);
    if (graph.id && ids.has(graph.id)) {
      errors.push({ path: `${path}.id`, message: `Duplicate engine graph ID: "${graph.id}".`, severity: 'error' });
    }
    if (graph.id) ids.add(graph.id);
    if (typeof graph.id === 'string' && PORTABLE_ID_PATTERN.test(graph.id) && !graphIndex.has(graph.id)) {
      graphIndex.set(graph.id, {
        nodeIds: Array.isArray(graph.nodes)
          ? new Set(graph.nodes.filter((node) => isObject(node) && typeof node.id === 'string').map((node) => node.id))
          : null,
      });
    }
    if (graph.name !== undefined && (typeof graph.name !== 'string' || !graph.name.trim())) {
      errors.push({ path: `${path}.name`, message: 'Engine graph name must be a non-empty string.', severity: 'error' });
    }
    if (graph.execution !== undefined && !isObject(graph.execution)) {
      errors.push({ path: `${path}.execution`, message: 'Engine graph execution metadata must be an object.', severity: 'error' });
    }
    if (graph.ui !== undefined && !isObject(graph.ui)) {
      errors.push({ path: `${path}.ui`, message: 'Engine graph UI metadata must be an object.', severity: 'error' });
    }
    if (graph.nodes !== undefined) validateEngineGraphNodes(graph.nodes, `${path}.nodes`, errors);
    if (graph.connections !== undefined) validateEngineGraphConnections(graph.connections, `${path}.connections`, errors);
  }
  return graphIndex;
}

function validateEngineGraphNodes(nodes, path, errors) {
  if (!Array.isArray(nodes)) {
    errors.push({ path, message: `${path} must be an array.`, severity: 'error' });
    return;
  }
  let ids = new Set();
  for (let i = 0; i < nodes.length; i++) {
    let node = nodes[i];
    let itemPath = `${path}[${i}]`;
    if (!isObject(node)) {
      errors.push({ path: itemPath, message: 'Engine graph node must be an object.', severity: 'error' });
      continue;
    }
    validatePortableIdField(node.id, `${itemPath}.id`, 'Engine graph node requires a portable "id".', errors);
    validatePortableIdField(node.type, `${itemPath}.type`, 'Engine graph node requires a portable "type".', errors);
    if (node.id && ids.has(node.id)) {
      errors.push({ path: `${itemPath}.id`, message: `Duplicate engine graph node ID: "${node.id}".`, severity: 'error' });
    }
    if (node.id) ids.add(node.id);
    if (node.name !== undefined && (typeof node.name !== 'string' || !node.name.trim())) {
      errors.push({ path: `${itemPath}.name`, message: 'Engine graph node name must be a non-empty string.', severity: 'error' });
    }
    if (node.params !== undefined && !isObject(node.params)) {
      errors.push({ path: `${itemPath}.params`, message: 'Engine graph node params must be an object.', severity: 'error' });
    }
    if (node.cacheMode !== undefined && !ENGINE_NODE_CACHE_MODES.has(node.cacheMode)) {
      errors.push({ path: `${itemPath}.cacheMode`, message: 'Engine graph node cacheMode must be auto, freeze, or force.', severity: 'error' });
    }
  }
}

function validateEngineGraphConnections(connections, path, errors) {
  if (!Array.isArray(connections)) {
    errors.push({ path, message: `${path} must be an array.`, severity: 'error' });
    return;
  }
  for (let i = 0; i < connections.length; i++) {
    let connection = connections[i];
    let itemPath = `${path}[${i}]`;
    if (!isObject(connection)) {
      errors.push({ path: itemPath, message: 'Engine graph connection must be an object.', severity: 'error' });
      continue;
    }
    for (let field of ['from', 'out', 'to', 'in']) {
      if (typeof connection[field] !== 'string' || !connection[field].trim()) {
        errors.push({ path: `${itemPath}.${field}`, message: `Engine graph connection requires a non-empty "${field}" string.`, severity: 'error' });
      }
    }
    for (let field of ['type', 'label']) {
      if (connection[field] !== undefined && (typeof connection[field] !== 'string' || !connection[field].trim())) {
        errors.push({ path: `${itemPath}.${field}`, message: `Engine graph connection "${field}" must be a non-empty string.`, severity: 'error' });
      }
    }
  }
}

function validateEngineBindings(bindings, errors, graphIndex = null) {
  if (!Array.isArray(bindings)) {
    errors.push({ path: 'engine.bindings', message: 'engine.bindings must be an array.', severity: 'error' });
    return;
  }
  let ids = new Set();
  for (let i = 0; i < bindings.length; i++) {
    let binding = bindings[i];
    let path = `engine.bindings[${i}]`;
    if (!isObject(binding)) {
      errors.push({ path, message: 'Engine binding entry must be an object.', severity: 'error' });
      continue;
    }
    validatePortableIdField(binding.id, `${path}.id`, 'Engine binding requires a portable "id".', errors);
    validatePortableIdField(binding.panelType, `${path}.panelType`, 'Engine binding requires a portable "panelType".', errors);
    validatePortableIdField(binding.sourceId, `${path}.sourceId`, 'Engine binding requires a portable "sourceId".', errors);
    validatePortableIdField(binding.graphId, `${path}.graphId`, 'Engine binding requires a portable "graphId".', errors);
    validatePortableIdField(binding.nodeId, `${path}.nodeId`, 'Engine binding requires a portable "nodeId".', errors);
    if (binding.component !== undefined) validateCustomElementField(binding.component, `${path}.component`, errors);
    if (typeof binding.surface !== 'string' || !ENGINE_BINDING_SURFACES.has(binding.surface)) {
      errors.push({ path: `${path}.surface`, message: 'Engine binding surface must be action, setting, state, event, or binding.', severity: 'error' });
    }
    for (let field of ['input', 'output', 'param', 'pack']) {
      if (binding[field] !== undefined) {
        validatePortableIdField(binding[field], `${path}.${field}`, `Engine binding "${field}" must be portable.`, errors);
      }
    }
    if (binding.id && ids.has(binding.id)) {
      errors.push({ path: `${path}.id`, message: `Duplicate engine binding ID: "${binding.id}".`, severity: 'error' });
    }
    if (binding.id) ids.add(binding.id);
    validateEngineBindingGraphReference(binding, path, graphIndex, errors);
  }
}

function validateEngineBindingGraphReference(binding, path, graphIndex, errors) {
  if (!graphIndex || graphIndex.size === 0 || typeof binding.graphId !== 'string') return;
  let graph = graphIndex.get(binding.graphId);
  if (!graph) return;
  if (!graph.nodeIds || typeof binding.nodeId !== 'string') return;
  if (!graph.nodeIds.has(binding.nodeId)) {
    errors.push({ path: `${path}.nodeId`, message: `Engine binding references undeclared node "${binding.nodeId}" in graph "${binding.graphId}".`, severity: 'error' });
  }
}

function validatePortableIdField(value, path, message, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push({ path, message, severity: 'error' });
    return;
  }
  if (!PORTABLE_ID_PATTERN.test(value)) {
    errors.push({ path, message: `Value "${value}" must be a portable identifier, not a URL, path, or display label.`, severity: 'error' });
  }
}

function validateCustomElementField(value, path, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push({ path, message: 'Data binding requires a "component" custom element tag name.', severity: 'error' });
    return;
  }
  if (!CUSTOM_ELEMENT_PATTERN.test(value)) {
    errors.push({ path, message: `Component tag "${value}" must be a valid custom element name.`, severity: 'error' });
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

function isNonPortableDataPath(value) {
  let lower = value.toLowerCase();
  if (BLOCKED_VALUE_PATTERNS.has(lower)) return true;
  if ([...BLOCKED_VALUE_PATTERNS].some((pattern) => lower.startsWith(pattern))) return true;
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value);
}

function validateComponents(components, errors, warnings) {
  if (components.catalog !== undefined) {
    validateStringArray(components.catalog, 'components.catalog', errors);
  }

  if (components.custom !== undefined) {
    if (!Array.isArray(components.custom)) {
      errors.push({ path: 'components.custom', message: 'components.custom must be an array.', severity: 'error' });
    } else {
      let customTags = new Set();
      for (let i = 0; i < components.custom.length; i++) {
        let item = components.custom[i];
        let path = `components.custom[${i}]`;
        if (!isObject(item)) {
          errors.push({ path, message: 'Custom component entry must be an object.', severity: 'error' });
          continue;
        }
        if (!item.tagName || typeof item.tagName !== 'string') {
          errors.push({ path: `${path}.tagName`, message: 'Custom component requires a tagName.', severity: 'error' });
        } else if (customTags.has(item.tagName)) {
          errors.push({ path: `${path}.tagName`, message: `Duplicate custom component tag: "${item.tagName}".`, severity: 'error' });
        } else {
          customTags.add(item.tagName);
        }
      }
    }
  }

  if (components.modules !== undefined) {
    if (!Array.isArray(components.modules)) {
      errors.push({ path: 'components.modules', message: 'components.modules must be an array.', severity: 'error' });
    } else {
      let moduleTags = new Set();
      for (let i = 0; i < components.modules.length; i++) {
        let descriptor = components.modules[i];
        let path = `components.modules[${i}]`;
        validateModuleCapabilityDescriptor(descriptor, path, errors);
        if (descriptor?.tagName && moduleTags.has(descriptor.tagName)) {
          errors.push({ path: `${path}.tagName`, message: `Duplicate module descriptor tag: "${descriptor.tagName}".`, severity: 'error' });
        }
        if (descriptor?.tagName) moduleTags.add(descriptor.tagName);
      }
    }
  }
}

function crossReferenceLayout(node, panelTypes, path, errors, warnings) {
  if (!isObject(node)) return;
  if (node.type === 'panel' && node.panelType) {
    if (!panelTypes[node.panelType] && node.panelType !== 'default') {
      warnings.push({
        path: `${path}.panelType`,
        message: `Panel references unregistered type: "${node.panelType}". Register it via panelTypes.`,
        severity: 'warning',
      });
    }
  }
  if (node.type === 'split') {
    if (node.first) crossReferenceLayout(node.first, panelTypes, `${path}.first`, errors, warnings);
    if (node.second) crossReferenceLayout(node.second, panelTypes, `${path}.second`, errors, warnings);
  }
}

function checkPortability(config, errors, warnings) {
  let keys = collectKeys(config);
  for (let key of keys) {
    let lowerKey = key.split('.').pop().toLowerCase();
    for (let blocked of BLOCKED_CONFIG_PATTERNS) {
      if (lowerKey === blocked || lowerKey.includes(blocked)) {
        warnings.push({
          path: key,
          message: `Potentially non-portable key "${key}": workspace configs must not contain auth, secrets, or server-specific data.`,
          severity: 'warning',
        });
      }
    }
  }

  let values = collectStringValues(config);
  for (let value of values) {
    let lower = value.toLowerCase();
    for (let pattern of BLOCKED_VALUE_PATTERNS) {
      if (lower.startsWith(pattern) || lower.includes(pattern)) {
        warnings.push({
          path: '(value)',
          message: `Potentially non-portable value "${value.slice(0, 60)}": workspace configs must not contain server URLs or endpoints.`,
          severity: 'warning',
        });
        break;
      }
    }
  }
}

/**
 * @param {string} version
 * @returns {boolean}
 */
export function isCompatibleVersion(version) {
  if (typeof version !== 'string') return false;
  let [major] = version.split('.');
  let [schemaMajor] = WORKSPACE_SCHEMA_VERSION.split('.');
  return major === schemaMajor;
}
