import { WORKSPACE_SCHEMA_VERSION } from '../schema/workspace-schema.js';

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
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: [0.25, 0.75],
        children: [
          {
            type: 'single',
            component: 'sn-tree-panel',
            label: 'Conversations',
          },
          {
            type: 'stack',
            children: [
              { type: 'single', component: 'sn-chat-transcript', label: 'Messages' },
              { type: 'single', component: 'sn-chat-composer', label: 'Composer' },
            ],
          },
        ],
      },
      components: {
        catalog: ['sn-tree-panel', 'sn-chat-transcript', 'sn-chat-composer'],
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
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: [0.2, 0.5, 0.3],
        children: [
          {
            type: 'single',
            component: 'sn-tree-panel',
            label: 'Files',
          },
          {
            type: 'single',
            component: 'sn-source-editor',
            label: 'Source',
          },
          {
            type: 'single',
            component: 'sn-output-preview',
            label: 'Preview',
          },
        ],
      },
      components: {
        catalog: ['sn-tree-panel', 'sn-source-editor', 'sn-output-preview'],
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
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: [0.7, 0.3],
        children: [
          {
            type: 'stack',
            children: [
              { type: 'single', component: 'sn-toolbar', label: 'Toolbar' },
              { type: 'single', component: 'sn-graph-canvas', label: 'Canvas' },
            ],
          },
          {
            type: 'single',
            component: 'sn-inspector-panel',
            label: 'Inspector',
          },
        ],
      },
      components: {
        catalog: ['sn-toolbar', 'sn-graph-canvas', 'sn-inspector-panel'],
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
      layout: {
        type: 'split',
        direction: 'vertical',
        ratio: [0.5, 0.5],
        children: [
          {
            type: 'split',
            direction: 'horizontal',
            ratio: [0.5, 0.5],
            children: [
              { type: 'single', component: 'sn-panel', label: 'Panel 1' },
              { type: 'single', component: 'sn-panel', label: 'Panel 2' },
            ],
          },
          {
            type: 'split',
            direction: 'horizontal',
            ratio: [0.5, 0.5],
            children: [
              { type: 'single', component: 'sn-panel', label: 'Panel 3' },
              { type: 'single', component: 'sn-panel', label: 'Panel 4' },
            ],
          },
        ],
      },
      components: {
        catalog: ['sn-panel'],
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
]);

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
      if (lower.includes(keyword)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = templateName;
    }
  }
  return bestMatch;
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
  let templateName = matchTemplate(intent);
  let template = templateName ? WORKSPACE_TEMPLATES[templateName] : WORKSPACE_TEMPLATES.dashboard;
  let config = structuredClone(template.config);

  if (options.name) config.name = options.name;
  if (options.register) config.register = options.register;
  if (options.theme) config.theme = { ...config.theme, ...options.theme };

  return config;
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
