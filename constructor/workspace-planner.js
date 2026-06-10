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
