import {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_REGISTER_VALUES,
} from '../schema/workspace-schema.js';

/**
 * @typedef {Object} WorkspaceTemplate
 * @property {string} name - Template identifier
 * @property {string} description - What this workspace does
 * @property {import('../schema/workspace-schema.js').WorkspaceConfig} config
 */

/** @type {Object<string, WorkspaceTemplate>} */
let WORKSPACE_TEMPLATES = {
  chat: {
    name: 'chat',
    description: 'Chat workspace with sidebar and message area.',
    config: {
      version: WORKSPACE_SCHEMA_VERSION,
      name: 'Chat Workspace',
      register: 'tool',
      groups: [
        { id: 'chat', name: 'Chat', icon: 'chat' },
      ],
      sections: [
        { id: 'messages', label: 'Messages', icon: 'chat', order: 0, groupId: 'chat' },
      ],
      panelTypes: {
        conversations: {
          title: 'Conversations',
          icon: 'forum',
          component: 'sn-tree-panel',
          behavior: { importance: 30, minInlineSize: 200 },
        },
        transcript: {
          title: 'Messages',
          icon: 'chat',
          component: 'chat-transcript',
          behavior: { importance: 80 },
        },
        composer: {
          title: 'Composer',
          icon: 'edit',
          component: 'chat-composer',
          behavior: { importance: 90, minBlockSize: 80 },
        },
      },
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.25,
        first: { type: 'panel', panelType: 'conversations' },
        second: {
          type: 'split',
          direction: 'vertical',
          ratio: 0.75,
          first: { type: 'panel', panelType: 'transcript' },
          second: { type: 'panel', panelType: 'composer' },
        },
      },
      components: {
        catalog: ['sn-tree-panel', 'chat-transcript', 'chat-composer'],
      },
    },
  },

  editor: {
    name: 'editor',
    description: 'Code editor workspace with file tree, source view, and preview.',
    config: {
      version: WORKSPACE_SCHEMA_VERSION,
      name: 'Editor Workspace',
      register: 'tool',
      groups: [
        { id: 'editor', name: 'Editor', icon: 'code' },
      ],
      sections: [
        { id: 'source', label: 'Source', icon: 'code', order: 0, groupId: 'editor' },
      ],
      panelTypes: {
        files: {
          title: 'Files',
          icon: 'folder',
          component: 'sn-tree-panel',
          behavior: { importance: 30, minInlineSize: 180 },
        },
        source: {
          title: 'Source',
          icon: 'code',
          component: 'source-editor',
          behavior: { importance: 90 },
        },
        preview: {
          title: 'Preview',
          icon: 'preview',
          component: 'sn-canvas-viewport',
          behavior: { importance: 50, minInlineSize: 280 },
        },
      },
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.2,
        first: { type: 'panel', panelType: 'files' },
        second: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.6,
          first: { type: 'panel', panelType: 'source' },
          second: { type: 'panel', panelType: 'preview' },
        },
      },
      components: {
        catalog: ['sn-tree-panel', 'source-editor', 'sn-canvas-viewport'],
      },
    },
  },

  graph: {
    name: 'graph',
    description: 'Node graph workspace with canvas, inspector, and toolbar.',
    config: {
      version: WORKSPACE_SCHEMA_VERSION,
      name: 'Graph Workspace',
      register: 'tool',
      groups: [
        { id: 'graph', name: 'Graph', icon: 'hub' },
      ],
      sections: [
        { id: 'canvas', label: 'Canvas', icon: 'hub', order: 0, groupId: 'graph' },
      ],
      panelTypes: {
        canvas: {
          title: 'Canvas',
          icon: 'hub',
          component: 'node-canvas',
          behavior: { importance: 90 },
          menuActions: [
            { id: 'zoom-fit', label: 'Fit to View', icon: 'fit_screen' },
            { id: 'snap-grid', label: 'Snap to Grid', icon: 'grid_on', active: true },
          ],
        },
        inspector: {
          title: 'Inspector',
          icon: 'tune',
          component: 'inspector-panel',
          behavior: { importance: 40, minInlineSize: 240 },
        },
      },
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.7,
        first: { type: 'panel', panelType: 'canvas' },
        second: { type: 'panel', panelType: 'inspector' },
      },
      components: {
        catalog: ['node-canvas', 'inspector-panel'],
      },
    },
  },

  dashboard: {
    name: 'dashboard',
    description: 'Dashboard workspace with a grid of panels.',
    config: {
      version: WORKSPACE_SCHEMA_VERSION,
      name: 'Dashboard Workspace',
      register: 'presentation',
      groups: [
        { id: 'dashboard', name: 'Dashboard', icon: 'dashboard' },
      ],
      sections: [
        { id: 'overview', label: 'Overview', icon: 'dashboard', order: 0, groupId: 'dashboard' },
      ],
      panelTypes: {
        'panel-1': { title: 'Panel 1', icon: 'analytics', component: 'sn-card' },
        'panel-2': { title: 'Panel 2', icon: 'insights', component: 'sn-card' },
        'panel-3': { title: 'Panel 3', icon: 'monitoring', component: 'sn-card' },
        'panel-4': { title: 'Panel 4', icon: 'bar_chart', component: 'sn-card' },
      },
      layout: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          first: { type: 'panel', panelType: 'panel-1' },
          second: { type: 'panel', panelType: 'panel-2' },
        },
        second: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          first: { type: 'panel', panelType: 'panel-3' },
          second: { type: 'panel', panelType: 'panel-4' },
        },
      },
      rootBehavior: {
        responsiveMode: 'stack',
        responsiveBreakpoint: 768,
      },
      components: {
        catalog: ['sn-card'],
      },
    },
  },

  'video-studio': {
    name: 'video-studio',
    description: 'Video editing studio with viewport, timeline, node graph, and inspector.',
    config: {
      version: WORKSPACE_SCHEMA_VERSION,
      name: 'Video Studio',
      register: 'tool',
      theme: {
        params: { mode: 'dark', hue: 218, chroma: 30 },
      },
      groups: [
        { id: 'video-editor', name: 'Video Editor', icon: 'movie', color: 'var(--sn-tab-accent-5)' },
      ],
      sections: [
        { id: 'studio', label: 'Studio', icon: 'movie', order: 0, groupId: 'video-editor', layoutId: 'studio' },
        { id: 'preview', label: 'Preview', icon: 'smart_display', order: 100, groupId: 'video-editor', layoutId: 'preview' },
        { id: 'effects', label: 'Effects', icon: 'auto_awesome', order: 200, groupId: 'video-editor', layoutId: 'effects' },
      ],
      panelTypes: {
        viewport: {
          title: 'Viewport',
          icon: 'smart_display',
          component: 'sn-canvas-viewport',
          behavior: { importance: 90, minInlineSize: 320, minBlockSize: 200 },
        },
        timeline: {
          title: 'Timeline',
          icon: 'view_timeline',
          component: 'sn-timeline-editor',
          behavior: { importance: 80, minBlockSize: 120, collapse: 'auto' },
        },
        'node-graph': {
          title: 'Node Graph',
          icon: 'hub',
          component: 'node-canvas',
          behavior: { importance: 50, minInlineSize: 300 },
          menuActions: [
            { id: 'zoom-fit', label: 'Fit to View', icon: 'fit_screen' },
          ],
        },
        inspector: {
          title: 'Properties',
          icon: 'tune',
          component: 'inspector-panel',
          behavior: { importance: 30, minInlineSize: 200 },
        },
      },
      layouts: {
        studio: {
          type: 'split',
          direction: 'vertical',
          ratio: 0.6,
          first: {
            type: 'split',
            direction: 'horizontal',
            ratio: 0.45,
            first: { type: 'panel', panelType: 'viewport' },
            second: {
              type: 'split',
              direction: 'horizontal',
              ratio: 0.65,
              first: { type: 'panel', panelType: 'node-graph' },
              second: { type: 'panel', panelType: 'inspector' },
            },
          },
          second: { type: 'panel', panelType: 'timeline' },
        },
        preview: {
          type: 'split',
          direction: 'vertical',
          ratio: 0.7,
          first: { type: 'panel', panelType: 'viewport' },
          second: { type: 'panel', panelType: 'timeline' },
        },
        effects: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.6,
          first: { type: 'panel', panelType: 'node-graph' },
          second: { type: 'panel', panelType: 'inspector' },
        },
      },
      layout: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.6,
        first: { type: 'panel', panelType: 'viewport' },
        second: { type: 'panel', panelType: 'timeline' },
      },
      events: [
        { id: 'timeline-to-viewport', sourcePanel: 'timeline', event: 'frame-change', targetPanel: 'viewport', targetMethod: 'setFrame' },
        { id: 'timeline-playback', sourcePanel: 'timeline', event: 'playback-state', targetPanel: 'viewport', targetProperty: 'playing' },
      ],
      rootBehavior: {
        responsiveMode: 'drawer',
        responsiveBreakpoint: 720,
        swipeControl: 'edge',
      },
      components: {
        catalog: ['sn-canvas-viewport', 'node-canvas', 'inspector-panel', 'sn-timeline-editor'],
      },
      engine: {
        packs: ['video-pack'],
      },
    },
  },
};

/** @type {Map<string, string[]>} */
let KEYWORD_MAP = new Map([
  ['chat', ['chat', 'message', 'conversation', 'messenger', 'dialog']],
  ['editor', ['editor', 'code', 'source', 'ide', 'edit', 'file']],
  ['graph', ['graph', 'node', 'canvas', 'visual', 'flow', 'pipeline', 'diagram']],
  ['dashboard', ['dashboard', 'grid', 'panel', 'overview', 'monitor', 'analytics']],
  ['video-studio', ['video', 'timeline', 'viewport', 'animation', 'render', 'studio', 'nle', 'film', 'clip']],
]);

let TEMPLATE_TOPOLOGIES = Object.freeze({
  chat: 'conversation-split',
  editor: 'workbench',
  graph: 'focus-canvas',
  dashboard: 'grid',
  'video-studio': 'studio',
});

let TOPOLOGY_OPTIONS = Object.freeze([
  'conversation-split',
  'workbench',
  'focus-canvas',
  'grid',
  'studio',
]);

let VERIFICATION_TARGETS = Object.freeze(['layout', 'modules', 'theme', 'portability']);

let REGISTER_THEME_DEFAULTS = Object.freeze({
  tool: { hue: 210, chroma: 18 },
  admin: { hue: 205, chroma: 16 },
  editor: { hue: 224, chroma: 18 },
  'agent-workspace': { hue: 218, chroma: 20 },
  'media-studio': { hue: 270, chroma: 30 },
  brand: { hue: 172, chroma: 32 },
  presentation: { hue: 244, chroma: 24 },
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function uniqueSortedStrings(values, fieldName) {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    throw new Error(`Construction intent field "${fieldName}" must be an array of strings.`);
  }
  let normalized = values.map((value) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Construction intent field "${fieldName}" must contain non-empty strings.`);
    }
    return value.trim();
  });
  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

function assertRegister(register, fieldName = 'register') {
  if (!WORKSPACE_REGISTER_VALUES.includes(register)) {
    throw new Error(`Invalid ${fieldName} "${register}". Allowed: ${WORKSPACE_REGISTER_VALUES.join(', ')}`);
  }
  return register;
}

function resolveTemplateName(template, brief) {
  if (template !== undefined) {
    if (typeof template !== 'string' || !template.trim()) {
      throw new Error('Construction intent field "template" must be a non-empty string.');
    }
    if (!WORKSPACE_TEMPLATES[template]) {
      throw new Error(`Unknown template "${template}". Supported: ${listTemplates().join(', ')}`);
    }
    return template;
  }
  return matchTemplate(brief) || 'dashboard';
}

function normalizePreferredTheme(theme) {
  if (theme === undefined || theme === null) return null;
  if (!isObject(theme)) {
    throw new Error('Construction intent field "preferredTheme" must be a plain object.');
  }

  let result = {};
  for (let key of ['mode', 'recipe']) {
    if (theme[key] !== undefined) {
      if (typeof theme[key] !== 'string' || !theme[key].trim()) {
        throw new Error(`Construction intent field "preferredTheme.${key}" must be a string.`);
      }
      result[key] = theme[key].trim();
    }
  }
  for (let key of ['hue', 'chroma', 'density', 'contrast', 'motion', 'radius', 'type']) {
    if (theme[key] !== undefined) {
      if (typeof theme[key] !== 'number' || !Number.isFinite(theme[key])) {
        throw new Error(`Construction intent field "preferredTheme.${key}" must be a finite number.`);
      }
      result[key] = theme[key];
    }
  }
  return Object.keys(result).length ? result : null;
}

function makeOption(value) {
  return { value, label: value };
}

function templateConfig(templateName) {
  return WORKSPACE_TEMPLATES[templateName].config;
}

function moduleOptions(config) {
  return Object.entries(config.panelTypes || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([panelType, panel]) => ({
      value: panelType,
      label: panel.title,
      component: panel.component,
    }));
}

function themeDefaults(config, register, preferredTheme = null) {
  let defaults = REGISTER_THEME_DEFAULTS[register] || REGISTER_THEME_DEFAULTS.tool;
  return {
    mode: preferredTheme?.mode || config.theme?.params?.mode || 'light',
    hue: preferredTheme?.hue ?? config.theme?.params?.hue ?? defaults.hue,
    chroma: preferredTheme?.chroma ?? config.theme?.params?.chroma ?? defaults.chroma,
    recipe: preferredTheme?.recipe || config.theme?.recipe || 'agent-console',
  };
}

function buildQuestionDefinitions(intent, options = {}) {
  let config = templateConfig(intent.template);
  let modules = moduleOptions(config);
  let theme = themeDefaults(config, intent.targetRegister, intent.preferredTheme);

  return [
    {
      id: 'workspace-name',
      title: 'Workspace name',
      group: 'identity',
      type: 'text',
      default: options.name || config.name,
      required: true,
    },
    {
      id: 'target-register',
      title: 'Target register',
      group: 'identity',
      type: 'single-select',
      options: WORKSPACE_REGISTER_VALUES.map(makeOption),
      default: intent.targetRegister,
      required: true,
    },
    {
      id: 'layout-topology',
      title: 'Layout topology',
      group: 'layout',
      type: 'single-select',
      options: TOPOLOGY_OPTIONS.map(makeOption),
      default: TEMPLATE_TOPOLOGIES[intent.template] || 'grid',
      required: true,
    },
    {
      id: 'module-selection',
      title: 'Module selection',
      group: 'modules',
      type: 'multi-select',
      options: modules,
      default: modules.map((option) => option.value),
      required: true,
    },
    {
      id: 'theme-mode',
      title: 'Theme mode',
      group: 'theme',
      type: 'single-select',
      options: ['light', 'dark', 'custom'].map(makeOption),
      default: theme.mode,
      required: true,
    },
    {
      id: 'theme-hue',
      title: 'Theme hue',
      group: 'theme',
      type: 'number',
      default: theme.hue,
      required: true,
      dependsOn: [{ questionId: 'theme-mode', equals: 'custom' }],
    },
    {
      id: 'verification-scope',
      title: 'Verification scope',
      group: 'verification',
      type: 'multi-select',
      options: VERIFICATION_TARGETS.map(makeOption),
      default: [...VERIFICATION_TARGETS],
      required: true,
    },
  ];
}

function validateAnswer(question, answer) {
  if (question.type === 'text') {
    if (typeof answer !== 'string' || !answer.trim()) {
      throw new Error(`Question "${question.id}" requires a non-empty string answer.`);
    }
    return answer.trim();
  }
  if (question.type === 'number') {
    if (typeof answer !== 'number' || !Number.isFinite(answer)) {
      throw new Error(`Question "${question.id}" requires a finite number answer.`);
    }
    return answer;
  }
  if (question.type === 'boolean') {
    if (typeof answer !== 'boolean') {
      throw new Error(`Question "${question.id}" requires a boolean answer.`);
    }
    return answer;
  }
  if (question.type === 'single-select') {
    if (typeof answer !== 'string' || !answer.trim()) {
      throw new Error(`Question "${question.id}" requires a string answer.`);
    }
    let values = new Set((question.options || []).map((option) => option.value));
    if (values.size > 0 && !values.has(answer)) {
      throw new Error(`Question "${question.id}" does not accept "${answer}".`);
    }
    return answer;
  }
  if (question.type === 'multi-select') {
    if (!Array.isArray(answer)) {
      throw new Error(`Question "${question.id}" requires an array answer.`);
    }
    let result = [];
    let seen = new Set();
    for (let value of answer) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Question "${question.id}" must contain non-empty strings.`);
      }
      let normalized = value.trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(normalized);
      }
    }
    let values = new Set((question.options || []).map((option) => option.value));
    for (let value of result) {
      if (values.size > 0 && !values.has(value)) {
        throw new Error(`Question "${question.id}" does not accept "${value}".`);
      }
    }
    return result;
  }
  throw new Error(`Question "${question.id}" has unsupported type "${question.type}".`);
}

function dependencySkipReason(question, answers) {
  for (let dependency of question.dependsOn || []) {
    let actual = answers.get(dependency.questionId);
    if (dependency.equals !== undefined && actual !== dependency.equals) {
      return `Skipped because ${dependency.questionId} must equal "${dependency.equals}" and is "${actual}".`;
    }
    if (dependency.notEquals !== undefined && actual === dependency.notEquals) {
      return `Skipped because ${dependency.questionId} must not equal "${dependency.notEquals}".`;
    }
    if (dependency.oneOf !== undefined && !dependency.oneOf.includes(actual)) {
      return `Skipped because ${dependency.questionId} must be one of ${dependency.oneOf.join(', ')}.`;
    }
  }
  return null;
}

function evaluateQuestions(questions) {
  let answers = new Map();
  let result = [];
  for (let source of questions) {
    let question = { ...source };
    let skip = dependencySkipReason(question, answers);
    if (skip) {
      delete question.answer;
      delete question.answerSource;
      question.status = 'skipped';
      question.skippedReason = skip;
      result.push(question);
      continue;
    }

    let answer = question.answer;
    let answerSource = question.answerSource;
    if (answer === undefined && question.default !== undefined) {
      answer = deepClone(question.default);
      answerSource = 'default';
    }
    if (answer !== undefined) {
      question.answer = validateAnswer(question, answer);
      question.answerSource = answerSource || 'default';
      question.status = 'answered';
      answers.set(question.id, deepClone(question.answer));
      delete question.skippedReason;
    } else {
      delete question.answer;
      delete question.answerSource;
      delete question.skippedReason;
      question.status = 'pending';
    }
    result.push(question);
  }
  return result;
}

function answerMap(questions) {
  return new Map(questions.map((question) => [question.id, question.answer]));
}

function applyAnswers(questions, answers = {}) {
  let result = questions;
  for (let question of result) {
    if (Object.prototype.hasOwnProperty.call(answers, question.id)) {
      result = answerConstructionQuestion(result, question.id, answers[question.id]);
    }
  }
  return result;
}

function layoutIds(config) {
  let ids = Object.keys(config.layouts || {}).sort((a, b) => a.localeCompare(b));
  if (ids.length > 0) return ids;
  return config.layout ? ['layout'] : [];
}

function defaultLayoutId(config) {
  let section = (config.sections || []).find((item) => item.layoutId);
  return section?.layoutId || layoutIds(config)[0] || null;
}

function sectionLayoutPlan(config) {
  return (config.sections || [])
    .map((section) => ({
      sectionId: section.id,
      groupId: section.groupId || null,
      layoutId: section.layoutId || 'layout',
    }))
    .sort((a, b) => a.sectionId.localeCompare(b.sectionId));
}

function modulePlan(config, selectedModules) {
  let selected = new Set(selectedModules);
  return Object.entries(config.panelTypes || {})
    .filter(([panelType]) => selected.has(panelType))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([panelType, panel]) => ({
      panelType,
      title: panel.title,
      component: panel.component,
      icon: panel.icon || null,
    }));
}

function verificationPlan(scope) {
  return scope.map((type) => {
    if (type === 'layout') return { id: 'layout-root', type, path: 'layout' };
    if (type === 'modules') return { id: 'module-catalog', type, path: 'panelTypes' };
    if (type === 'theme') return { id: 'theme-root', type, path: 'theme' };
    return { id: 'portability-check', type, checks: ['no-auth', 'no-host-endpoints', 'no-local-paths'] };
  });
}

/**
 * @param {string|Object} intent
 * @param {Object} [options]
 * @returns {Object}
 */
export function normalizeConstructionIntent(intent, options = {}) {
  let input = typeof intent === 'string' ? { brief: intent } : intent;
  if (!isObject(input)) {
    throw new Error('Construction intent must be a string or a plain object.');
  }
  let brief = typeof input.brief === 'string' ? input.brief.trim() : '';
  if (!brief) {
    throw new Error('Construction intent requires a non-empty "brief" field.');
  }
  let template = resolveTemplateName(input.template, brief);
  let config = templateConfig(template);
  let targetRegister = options.register || input.targetRegister || input.register || config.register || 'tool';

  return {
    brief,
    template,
    targetRegister: assertRegister(targetRegister, 'targetRegister'),
    audience: uniqueSortedStrings(input.audience, 'audience'),
    constraints: uniqueSortedStrings(input.constraints, 'constraints'),
    requiredCapabilities: uniqueSortedStrings(input.requiredCapabilities, 'requiredCapabilities'),
    preferredTheme: normalizePreferredTheme(input.preferredTheme || options.theme),
  };
}

/**
 * @param {string|Object} intent
 * @param {Object} [options]
 * @returns {Array}
 */
export function buildConstructionQuestions(intent, options = {}) {
  return evaluateQuestions(buildQuestionDefinitions(normalizeConstructionIntent(intent, options), options));
}

/**
 * @param {Array} questions
 * @param {string} questionId
 * @param {*} answer
 * @returns {Array}
 */
export function answerConstructionQuestion(questions, questionId, answer) {
  if (!Array.isArray(questions)) {
    throw new Error('Construction questions must be an array.');
  }
  let next = questions.map((question) => ({ ...question, answer: deepClone(question.answer) }));
  let target = next.find((question) => question.id === questionId);
  if (!target) {
    throw new Error(`Unknown construction question "${questionId}".`);
  }
  target.answer = deepClone(answer);
  target.answerSource = 'user';
  target.status = 'answered';
  delete target.skippedReason;
  return evaluateQuestions(next);
}

/**
 * @param {string|Object} intent
 * @param {Object} [options]
 * @returns {{ intent: Object, questions: Array, plan: Object, config: Object }}
 */
export function planWorkspaceConstruction(intent, options = {}) {
  let normalized = normalizeConstructionIntent(intent, options);
  let config = deepClone(templateConfig(normalized.template));
  let questions = applyAnswers(buildConstructionQuestions(normalized, options), options.answers || {});
  let answers = answerMap(questions);
  let workspaceName = answers.get('workspace-name') || config.name;
  let register = assertRegister(answers.get('target-register') || normalized.targetRegister);
  let topology = answers.get('layout-topology') || TEMPLATE_TOPOLOGIES[normalized.template] || 'grid';
  let modules = answers.get('module-selection') || [];
  let mode = answers.get('theme-mode') || themeDefaults(config, register, normalized.preferredTheme).mode;
  let defaults = themeDefaults(config, register, normalized.preferredTheme);
  let hue = mode === 'custom' ? (answers.get('theme-hue') ?? defaults.hue) : defaults.hue;
  let verificationScope = answers.get('verification-scope') || [];

  let plan = {
    name: workspaceName,
    template: normalized.template,
    register,
    target: {
      register,
      audience: deepClone(normalized.audience),
      constraints: deepClone(normalized.constraints),
      requiredCapabilities: deepClone(normalized.requiredCapabilities),
    },
    answers: {
      workspaceName,
      layoutTopology: topology,
      moduleSelection: deepClone(modules),
      themeMode: mode,
      themeHue: mode === 'custom' ? hue : null,
      verificationScope: deepClone(verificationScope),
    },
    layout: {
      topology,
      defaultLayoutId: defaultLayoutId(config),
      layoutIds: layoutIds(config),
      sectionLayouts: sectionLayoutPlan(config),
    },
    modules: modulePlan(config, modules),
    theme: {
      recipe: {
        mode,
        hue,
        chroma: defaults.chroma,
        name: defaults.recipe,
      },
      relations: deepClone(config.theme?.relations) || {},
      overrides: deepClone(config.theme?.overrides) || {},
    },
    verification: {
      targets: verificationPlan(verificationScope),
    },
  };

  config.name = workspaceName;
  config.register = register;
  config.intent = {
    brief: normalized.brief,
    template: normalized.template,
    targetRegister: register,
    audience: deepClone(normalized.audience),
    constraints: deepClone(normalized.constraints),
    requiredCapabilities: deepClone(normalized.requiredCapabilities),
    preferredTheme: deepClone(normalized.preferredTheme),
  };
  config.construction = { questions, plan };
  config.theme = {
    ...(deepClone(config.theme) || {}),
    recipe: defaults.recipe,
    params: {
      ...(deepClone(config.theme?.params) || {}),
      mode: mode === 'custom' ? (config.theme?.params?.mode || 'light') : mode,
      hue,
      chroma: defaults.chroma,
    },
  };

  return {
    intent: deepClone(config.intent),
    questions: deepClone(questions),
    plan,
    config,
  };
}

/**
 * @param {import('../schema/workspace-schema.js').WorkspaceConfig} config
 * @returns {Object|null}
 */
export function extractConstructionPlan(config) {
  return isObject(config?.construction?.plan) ? config.construction.plan : null;
}

/**
 * @param {string} intent - User intent text
 * @returns {string|null} - Matched template name or null
 */
export function matchTemplate(intent) {
  if (typeof intent !== 'string' || !intent.trim()) return null;
  let lower = intent.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;

  for (let [templateName, keywords] of KEYWORD_MAP) {
    let score = 0;
    for (let keyword of keywords) {
      if (matchesKeyword(lower, keyword)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = templateName;
    }
  }
  return bestMatch;
}

function matchesKeyword(text, keyword) {
  if (keyword.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${keyword}([^a-z0-9]|$)`, 'i').test(text);
  }
  return text.includes(keyword);
}

/**
 * @param {string} intent - User intent text
 * @param {Object} [options]
 * @param {string} [options.name] - Override workspace name
 * @param {string} [options.register] - Override register
 * @param {Object} [options.theme] - Theme overrides
 * @returns {import('../schema/workspace-schema.js').WorkspaceConfig}
 */
export function planWorkspace(intent, options = {}) {
  return planWorkspaceConstruction(intent, options).config;
}

/**
 * @returns {string[]}
 */
export function listTemplates() {
  return Object.keys(WORKSPACE_TEMPLATES);
}

/**
 * @param {string} name
 * @returns {WorkspaceTemplate|null}
 */
export function getTemplate(name) {
  return WORKSPACE_TEMPLATES[name] || null;
}
