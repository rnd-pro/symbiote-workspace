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

function moduleDescriptor(tagName, capabilities, options = {}) {
  return {
    tagName,
    schemaVersion: '0.1.0',
    provider: 'symbiote-ui',
    descriptor: {
      schemaVersion: '2.0.0',
      package: 'symbiote-ui',
      component: tagName,
    },
    capabilities,
    ...options,
  };
}

const MODULES = Object.freeze({
  tree: moduleDescriptor('sn-tree-panel', ['navigation.tree', 'data.hierarchy'], {
    events: { emits: [{ name: 'item-select' }] },
    bindings: [{ id: 'items', direction: 'input', path: 'data.tree' }],
  }),
  chatTranscript: moduleDescriptor('chat-transcript', ['chat.transcript', 'agent.messages'], {
    events: { emits: [{ name: 'message-select' }] },
    bindings: [{ id: 'messages', direction: 'input', path: 'data.messages' }],
  }),
  chatComposer: moduleDescriptor('chat-composer', ['chat.compose', 'agent.command-input'], {
    actions: [{ id: 'send', label: 'Send', event: 'message-submit' }],
    events: { emits: [{ name: 'message-submit' }] },
    bindings: [{ id: 'draft', direction: 'two-way', path: 'data.draft' }],
    requiredHostServices: ['agent.runtime'],
  }),
  chatWorkspace: moduleDescriptor('chat-workspace', ['chat.workspace', 'agent.review'], {
    runtimeSlots: [{ id: 'agent-runtime', role: 'provider', required: true }],
    requiredHostServices: ['agent.runtime', 'storage.project'],
  }),
  sourceEditor: moduleDescriptor('source-editor', ['source.edit', 'editor.code'], {
    actions: [{ id: 'save', label: 'Save', command: 'source.save' }],
    events: { emits: [{ name: 'source-change' }] },
    bindings: [{ id: 'source', direction: 'two-way', path: 'data.source' }],
  }),
  sourceDiff: moduleDescriptor('sn-source-diff', ['source.diff', 'review.compare'], {
    bindings: [{ id: 'diff', direction: 'input', path: 'data.diff' }],
  }),
  viewport: moduleDescriptor('sn-canvas-viewport', ['canvas.preview', 'media.viewport'], {
    actions: [{ id: 'reset-view', label: 'Reset View', command: 'viewport.reset' }],
    bindings: [{ id: 'frame', direction: 'input', path: 'data.frame' }],
  }),
  nodeCanvas: moduleDescriptor('node-canvas', ['graph.canvas', 'workflow.node-editor'], {
    actions: [{ id: 'zoom-fit', label: 'Fit to View', command: 'canvas.zoom-fit' }],
    events: { emits: [{ name: 'node-select' }], consumes: [{ name: 'graph-update' }] },
    bindings: [{ id: 'graph', direction: 'two-way', path: 'data.graph' }],
    runtimeSlots: [{ id: 'graph-runtime', role: 'provider' }],
  }),
  inspector: moduleDescriptor('inspector-panel', ['inspector.properties', 'settings.panel'], {
    settings: [{ id: 'selection', label: 'Selection', type: 'object' }],
    bindings: [{ id: 'selection', direction: 'input', path: 'data.selection' }],
  }),
  card: moduleDescriptor('sn-card', ['dashboard.card', 'surface.summary']),
  metric: moduleDescriptor('sn-metric', ['admin.metric', 'dashboard.metric'], {
    bindings: [{ id: 'value', direction: 'input', path: 'data.metric' }],
  }),
  dataTable: moduleDescriptor('sn-data-table', ['data.table', 'admin.records', 'admin.bulk-actions'], {
    actions: [{ id: 'refresh', label: 'Refresh', command: 'data.refresh' }],
    toolbarItems: [{ id: 'filter', label: 'Filter', command: 'filter.open' }],
    events: { emits: [{ name: 'row-select' }] },
    bindings: [{ id: 'rows', direction: 'input', path: 'data.rows' }],
    requiredHostServices: ['storage.project'],
  }),
  chart: moduleDescriptor('sn-chart', ['data.chart', 'dashboard.analytics'], {
    bindings: [{ id: 'series', direction: 'input', path: 'data.series' }],
  }),
  eventFeed: moduleDescriptor('sn-event-feed', ['activity.feed', 'audit.events'], {
    events: { emits: [{ name: 'event-select' }] },
    bindings: [{ id: 'events', direction: 'input', path: 'data.events' }],
  }),
  timeline: moduleDescriptor('sn-timeline', ['timeline.events', 'automation.history'], {
    events: { emits: [{ name: 'timeline-select' }] },
    bindings: [{ id: 'items', direction: 'input', path: 'data.timeline' }],
  }),
  timelineEditor: moduleDescriptor('sn-timeline-editor', ['media.timeline', 'timeline.edit'], {
    events: { emits: [{ name: 'frame-change' }, { name: 'playback-state' }] },
    bindings: [{ id: 'clips', direction: 'two-way', path: 'data.clips' }],
  }),
  richTextEditor: moduleDescriptor('sn-rich-text-editor', ['content.rich-text', 'automation.reply-template'], {
    actions: [{ id: 'insert-variable', label: 'Insert Variable', command: 'template.variable' }],
    bindings: [{ id: 'content', direction: 'two-way', path: 'data.content' }],
  }),
  fileUpload: moduleDescriptor('sn-file-upload', ['input.file', 'data.import'], {
    events: { emits: [{ name: 'file-select' }] },
    requiredHostServices: ['storage.project'],
  }),
});

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
        modules: [MODULES.tree, MODULES.chatTranscript, MODULES.chatComposer],
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
        modules: [MODULES.tree, MODULES.sourceEditor, MODULES.viewport],
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
        modules: [MODULES.nodeCanvas, MODULES.inspector],
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
        modules: [MODULES.card],
      },
    },
  },

  admin: {
    name: 'admin',
    description: 'Admin console workspace with metrics, records, analytics, and audit activity.',
    config: {
      version: WORKSPACE_SCHEMA_VERSION,
      name: 'Admin Console',
      register: 'admin',
      groups: [
        { id: 'operations', name: 'Operations', icon: 'admin_panel_settings' },
      ],
      sections: [
        { id: 'overview', label: 'Overview', icon: 'dashboard', order: 0, groupId: 'operations' },
        { id: 'records', label: 'Records', icon: 'table', order: 100, groupId: 'operations', layoutId: 'records' },
      ],
      panelTypes: {
        metric: {
          title: 'Metric',
          icon: 'monitoring',
          component: 'sn-metric',
          behavior: { importance: 65, minInlineSize: 180 },
        },
        records: {
          title: 'Records',
          icon: 'table',
          component: 'sn-data-table',
          behavior: { importance: 90, minInlineSize: 360 },
          menuActions: [
            { id: 'refresh', label: 'Refresh', icon: 'refresh' },
            { id: 'export', label: 'Export', icon: 'download' },
          ],
        },
        analytics: {
          title: 'Analytics',
          icon: 'bar_chart',
          component: 'sn-chart',
          behavior: { importance: 70, minInlineSize: 300 },
        },
        audit: {
          title: 'Activity',
          icon: 'history',
          component: 'sn-event-feed',
          behavior: { importance: 45, minInlineSize: 260 },
        },
      },
      layouts: {
        records: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.7,
          first: { type: 'panel', panelType: 'records' },
          second: { type: 'panel', panelType: 'audit' },
        },
      },
      layout: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.35,
        first: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.35,
          first: { type: 'panel', panelType: 'metric' },
          second: { type: 'panel', panelType: 'analytics' },
        },
        second: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.72,
          first: { type: 'panel', panelType: 'records' },
          second: { type: 'panel', panelType: 'audit' },
        },
      },
      rootBehavior: {
        responsiveMode: 'drawer',
        responsiveBreakpoint: 820,
      },
      components: {
        catalog: ['sn-metric', 'sn-data-table', 'sn-chart', 'sn-event-feed'],
        modules: [MODULES.metric, MODULES.dataTable, MODULES.chart, MODULES.eventFeed],
      },
    },
  },

  'agent-workspace': {
    name: 'agent-workspace',
    description: 'Agent review workspace with chat, task activity, source diff, and workflow graph.',
    config: {
      version: WORKSPACE_SCHEMA_VERSION,
      name: 'Agent Workspace',
      register: 'agent-workspace',
      groups: [
        { id: 'agent', name: 'Agent', icon: 'smart_toy' },
      ],
      sections: [
        { id: 'review', label: 'Review', icon: 'fact_check', order: 0, groupId: 'agent' },
        { id: 'workflow', label: 'Workflow', icon: 'hub', order: 100, groupId: 'agent', layoutId: 'workflow' },
      ],
      panelTypes: {
        chat: {
          title: 'Chat',
          icon: 'chat',
          component: 'chat-workspace',
          behavior: { importance: 90, minInlineSize: 360 },
        },
        activity: {
          title: 'Activity',
          icon: 'dynamic_feed',
          component: 'sn-event-feed',
          behavior: { importance: 55, minInlineSize: 260 },
        },
        diff: {
          title: 'Changes',
          icon: 'difference',
          component: 'sn-source-diff',
          behavior: { importance: 75, minInlineSize: 320 },
        },
        graph: {
          title: 'Workflow',
          icon: 'hub',
          component: 'node-canvas',
          behavior: { importance: 65, minInlineSize: 300 },
        },
      },
      layouts: {
        workflow: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.65,
          first: { type: 'panel', panelType: 'graph' },
          second: { type: 'panel', panelType: 'activity' },
        },
      },
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.38,
        first: { type: 'panel', panelType: 'chat' },
        second: {
          type: 'split',
          direction: 'vertical',
          ratio: 0.55,
          first: { type: 'panel', panelType: 'diff' },
          second: { type: 'panel', panelType: 'activity' },
        },
      },
      events: [
        { id: 'activity-to-diff', sourcePanel: 'activity', event: 'event-select', targetPanel: 'diff', targetProperty: 'selection' },
        { id: 'graph-to-activity', sourcePanel: 'graph', event: 'node-select', targetPanel: 'activity', targetProperty: 'filter' },
      ],
      rootBehavior: {
        responsiveMode: 'drawer',
        responsiveBreakpoint: 780,
      },
      components: {
        catalog: ['chat-workspace', 'sn-event-feed', 'sn-source-diff', 'node-canvas'],
        modules: [MODULES.chatWorkspace, MODULES.eventFeed, MODULES.sourceDiff, MODULES.nodeCanvas],
      },
    },
  },

  'social-automation': {
    name: 'social-automation',
    description: 'Social automation workspace with queue review, reply drafting, workflow graph, and history.',
    config: {
      version: WORKSPACE_SCHEMA_VERSION,
      name: 'Social Automation',
      register: 'agent-workspace',
      groups: [
        { id: 'automation', name: 'Automation', icon: 'forum' },
      ],
      sections: [
        { id: 'queue', label: 'Queue', icon: 'inbox', order: 0, groupId: 'automation' },
        { id: 'workflow', label: 'Workflow', icon: 'hub', order: 100, groupId: 'automation', layoutId: 'workflow' },
      ],
      panelTypes: {
        queue: {
          title: 'Queue',
          icon: 'table',
          component: 'sn-data-table',
          behavior: { importance: 85, minInlineSize: 320 },
          menuActions: [
            { id: 'approve', label: 'Approve', icon: 'check' },
            { id: 'hold', label: 'Hold', icon: 'pause' },
          ],
        },
        reply: {
          title: 'Reply Draft',
          icon: 'edit_note',
          component: 'sn-rich-text-editor',
          behavior: { importance: 80, minInlineSize: 320 },
        },
        workflow: {
          title: 'Automation Flow',
          icon: 'hub',
          component: 'node-canvas',
          behavior: { importance: 65, minInlineSize: 300 },
        },
        history: {
          title: 'History',
          icon: 'timeline',
          component: 'sn-timeline',
          behavior: { importance: 45, minInlineSize: 260 },
        },
        imports: {
          title: 'Imports',
          icon: 'upload_file',
          component: 'sn-file-upload',
          behavior: { importance: 35, minInlineSize: 220 },
        },
      },
      layouts: {
        workflow: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.7,
          first: { type: 'panel', panelType: 'workflow' },
          second: {
            type: 'split',
            direction: 'vertical',
            ratio: 0.55,
            first: { type: 'panel', panelType: 'history' },
            second: { type: 'panel', panelType: 'imports' },
          },
        },
      },
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.42,
        first: { type: 'panel', panelType: 'queue' },
        second: {
          type: 'split',
          direction: 'vertical',
          ratio: 0.62,
          first: { type: 'panel', panelType: 'reply' },
          second: { type: 'panel', panelType: 'history' },
        },
      },
      events: [
        { id: 'queue-to-reply', sourcePanel: 'queue', event: 'row-select', targetPanel: 'reply', targetProperty: 'context' },
        { id: 'workflow-to-history', sourcePanel: 'workflow', event: 'node-select', targetPanel: 'history', targetProperty: 'filter' },
      ],
      rootBehavior: {
        responsiveMode: 'drawer',
        responsiveBreakpoint: 780,
      },
      components: {
        catalog: ['sn-data-table', 'sn-rich-text-editor', 'node-canvas', 'sn-timeline', 'sn-file-upload'],
        modules: [MODULES.dataTable, MODULES.richTextEditor, MODULES.nodeCanvas, MODULES.timeline, MODULES.fileUpload],
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
        modules: [MODULES.viewport, MODULES.nodeCanvas, MODULES.inspector, MODULES.timelineEditor],
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
  ['admin', ['admin', 'operations', 'records', 'table', 'audit', 'console']],
  ['agent-workspace', ['agent', 'review', 'task', 'handoff', 'evaluation', 'control room']],
  ['social-automation', ['social', 'reply', 'replies', 'automation', 'approval', 'queue']],
  ['dashboard', ['dashboard', 'grid', 'panel', 'overview', 'monitor', 'analytics']],
  ['video-studio', ['video', 'timeline', 'viewport', 'animation', 'render', 'studio', 'nle', 'film', 'clip']],
]);

let TEMPLATE_TOPOLOGIES = Object.freeze({
  chat: 'conversation-split',
  editor: 'workbench',
  graph: 'focus-canvas',
  dashboard: 'grid',
  admin: 'admin-console',
  'agent-workspace': 'agent-review',
  'social-automation': 'automation-desk',
  'video-studio': 'studio',
});

let TOPOLOGY_OPTIONS = Object.freeze([
  'conversation-split',
  'workbench',
  'focus-canvas',
  'grid',
  'admin-console',
  'agent-review',
  'automation-desk',
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

function withModuleCapabilities(config, moduleCapabilities) {
  let next = deepClone(config);
  if (moduleCapabilities === undefined) return next;
  if (!Array.isArray(moduleCapabilities)) {
    throw new Error('moduleCapabilities must be an array when provided.');
  }

  next.components ||= {};
  let existing = Array.isArray(next.components.modules) ? next.components.modules : [];
  let byTagName = new Map();
  for (let descriptor of [...existing, ...moduleCapabilities]) {
    if (!isObject(descriptor)) {
      throw new Error('moduleCapabilities entries must be objects.');
    }
    if (typeof descriptor.tagName !== 'string' || !descriptor.tagName.trim()) {
      throw new Error('moduleCapabilities entries require a tagName.');
    }
    byTagName.set(descriptor.tagName, deepClone(descriptor));
  }
  next.components.modules = [...byTagName.values()].sort((a, b) => a.tagName.localeCompare(b.tagName));

  let catalog = new Set(next.components.catalog || []);
  for (let descriptor of next.components.modules) catalog.add(descriptor.tagName);
  next.components.catalog = [...catalog].sort((a, b) => a.localeCompare(b));

  return next;
}

function moduleDescriptorMap(config) {
  let descriptors = new Map();
  for (let descriptor of config.components?.modules || []) {
    if (isObject(descriptor) && typeof descriptor.tagName === 'string') {
      descriptors.set(descriptor.tagName, descriptor);
    }
  }
  return descriptors;
}

function applyDescriptorPlanFields(target, descriptor) {
  if (!descriptor) return target;
  target.capabilities = deepClone(descriptor.capabilities || []);
  target.requiredHostServices = deepClone(descriptor.requiredHostServices || []);
  for (let field of [
    'actions',
    'menus',
    'toolbarItems',
    'settings',
    'events',
    'bindings',
    'slots',
    'runtimeSlots',
    'placement',
  ]) {
    if (descriptor[field] !== undefined) target[field] = deepClone(descriptor[field]);
  }
  return target;
}

function moduleOptions(config) {
  let descriptors = moduleDescriptorMap(config);
  return Object.entries(config.panelTypes || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([panelType, panel]) => applyDescriptorPlanFields({
      value: panelType,
      label: panel.title,
      component: panel.component,
    }, descriptors.get(panel.component)));
}

function matchingCapabilities(module, requiredCapabilities) {
  if (!requiredCapabilities.length) return [];
  let capabilities = new Set(module.capabilities || []);
  return requiredCapabilities.filter((capability) => capabilities.has(capability));
}

function defaultModuleSelection(modules, requiredCapabilities) {
  if (!requiredCapabilities.length) return modules.map((module) => module.value);

  let remaining = new Set(requiredCapabilities);
  let selected = new Set();
  let ranked = modules
    .map((module) => ({
      module,
      matches: matchingCapabilities(module, requiredCapabilities),
    }))
    .filter((entry) => entry.matches.length > 0)
    .sort((a, b) => {
      if (a.matches.length !== b.matches.length) return b.matches.length - a.matches.length;
      return a.module.value.localeCompare(b.module.value);
    });

  for (let entry of ranked) {
    if (!entry.matches.some((capability) => remaining.has(capability))) continue;
    selected.add(entry.module.value);
    for (let capability of entry.matches) remaining.delete(capability);
  }

  return modules
    .filter((module) => selected.has(module.value))
    .map((module) => module.value);
}

function moduleSelectionReason(matchedCapabilities, requiredCapabilities, selectionSource) {
  if (selectionSource === 'user') return 'user';
  if (matchedCapabilities.length > 0) return 'required-capability';
  if (requiredCapabilities.length > 0) return 'selected-without-required-capability';
  return 'template-default';
}

function capabilityCoverage(requiredCapabilities, modules) {
  let matched = new Set();
  let byModule = [];

  for (let module of modules) {
    let matchedCapabilities = matchingCapabilities(module, requiredCapabilities);
    if (!matchedCapabilities.length) continue;
    for (let capability of matchedCapabilities) matched.add(capability);
    byModule.push({
      panelType: module.panelType,
      component: module.component,
      matchedCapabilities,
    });
  }

  return {
    required: deepClone(requiredCapabilities),
    matched: requiredCapabilities.filter((capability) => matched.has(capability)),
    missing: requiredCapabilities.filter((capability) => !matched.has(capability)),
    byModule,
  };
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
  let config = withModuleCapabilities(templateConfig(intent.template), options.moduleCapabilities);
  let modules = moduleOptions(config);
  let theme = themeDefaults(config, intent.targetRegister, intent.preferredTheme);
  let moduleSelection = defaultModuleSelection(modules, intent.requiredCapabilities);

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
      default: moduleSelection,
      answerSource: intent.requiredCapabilities.length ? 'derived' : undefined,
      requiredCapabilities: deepClone(intent.requiredCapabilities),
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
      answerSource = question.answerSource || 'default';
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

function modulePlan(config, selectedModules, requiredCapabilities = [], selectionSource = 'default') {
  let selected = new Set(selectedModules);
  let descriptors = moduleDescriptorMap(config);
  return Object.entries(config.panelTypes || {})
    .filter(([panelType]) => selected.has(panelType))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([panelType, panel]) => {
      let module = applyDescriptorPlanFields({
        panelType,
        title: panel.title,
        component: panel.component,
        icon: panel.icon || null,
      }, descriptors.get(panel.component));
      module.matchedCapabilities = matchingCapabilities(module, requiredCapabilities);
      module.selectionReason = moduleSelectionReason(
        module.matchedCapabilities,
        requiredCapabilities,
        selectionSource,
      );
      return module;
    });
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
  let config = withModuleCapabilities(templateConfig(normalized.template), options.moduleCapabilities);
  let questions = applyAnswers(buildConstructionQuestions(normalized, options), options.answers || {});
  let answers = answerMap(questions);
  let workspaceName = answers.get('workspace-name') || config.name;
  let register = assertRegister(answers.get('target-register') || normalized.targetRegister);
  let topology = answers.get('layout-topology') || TEMPLATE_TOPOLOGIES[normalized.template] || 'grid';
  let modules = answers.get('module-selection') || [];
  let moduleSelectionQuestion = questions.find((question) => question.id === 'module-selection');
  let moduleSelectionSource = moduleSelectionQuestion?.answerSource || 'default';
  let mode = answers.get('theme-mode') || themeDefaults(config, register, normalized.preferredTheme).mode;
  let defaults = themeDefaults(config, register, normalized.preferredTheme);
  let hue = mode === 'custom' ? (answers.get('theme-hue') ?? defaults.hue) : defaults.hue;
  let verificationScope = answers.get('verification-scope') || [];
  let plannedModules = modulePlan(
    config,
    modules,
    normalized.requiredCapabilities,
    moduleSelectionSource,
  );

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
      moduleSelectionSource,
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
    modules: plannedModules,
    capabilities: capabilityCoverage(normalized.requiredCapabilities, plannedModules),
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
  let template = WORKSPACE_TEMPLATES[name];
  return template ? deepClone(template) : null;
}
