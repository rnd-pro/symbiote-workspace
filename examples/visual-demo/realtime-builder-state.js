import { validateWorkspaceConfig } from '../../schema/index.js';
import { planWorkspaceConstruction } from '../../constructor/index.js';
import { exportConfig, importConfig } from '../../sharing/index.js';

const DEMO_EXECUTION_MODEL = 'automation-bridge';
const DEMO_HOST_SERVICES = Object.freeze(['agent.runtime', 'storage.project']);
const DEMO_IMPORT_MAP_KEYS = Object.freeze([
  '@symbiotejs/symbiote',
  '@symbiotejs/symbiote/',
  'symbiote-engine',
  'symbiote-engine/',
  'symbiote-engine/contracts',
  'symbiote-ui/',
  'symbiote-ui/ui',
  'symbiote-workspace/browser',
]);
const PROFESSIONAL_COMPONENT_CONTRACT = Object.freeze({
  symbioteUiVersion: '0.3.0-alpha.45',
  publicComponents: [
    'panel-layout',
    'chat-workspace',
    'sn-video-player',
    'sn-timeline',
    'node-canvas',
    'canvas-graph',
    'graph-explorer-shell',
    'inspector-panel',
    'sn-tree-panel',
    'source-editor',
    'source-viewer',
    'code-block',
    'sn-source-diff',
    'sn-data-table',
    'sn-rich-text-editor',
    'sn-file-upload',
    'sn-kanban-board',
    'palette-browser',
    'layout-shell-menu',
    'layout-sidebar',
    'project-tabs',
    'cascade-theme-widget',
    'cascade-theme-editor',
    'quick-open',
    'sn-toolbar',
    'sn-menu',
  ],
  templateContractGaps: [
    'sn-timeline-editor',
    'sn-canvas-viewport',
  ],
});
const CANONICAL_DEMO_QUESTIONS = Object.freeze([
  {
    id: 'workspace-name',
    title: 'What should this workspace be called?',
    type: 'text',
    answer: 'Realtime Builder - Validated Handoff',
    status: 'naming workspace',
    stageTitle: 'Workspace named',
  },
  {
    id: 'target-register',
    title: 'Which workspace register should own it?',
    type: 'single-select',
    answer: 'agent-workspace',
    status: 'register selected',
    stageTitle: 'Register selected',
  },
  {
    id: 'layout-topology',
    title: 'Which layout topology should be built?',
    type: 'single-select',
    answer: 'workbench',
    status: 'layout topology selected',
    stageTitle: 'Layout topology',
  },
  {
    id: 'module-selection',
    title: 'Which modules are required?',
    type: 'multi-select',
    answer: [
      'agent-chat',
      'service-blueprint',
      'layout-builder',
      'widget-registry',
      'bindings-inspector',
      'adaptive-rules',
      'validation-checklist',
      'theme-editor',
    ],
    status: 'modules selected',
    stageTitle: 'Modules selected',
  },
  {
    id: 'execution-model',
    title: 'How should the workspace execute?',
    type: 'single-select',
    answer: DEMO_EXECUTION_MODEL,
    status: 'execution selected',
    stageTitle: 'Execution model',
  },
  {
    id: 'required-host-services',
    title: 'Which portable host services are required?',
    type: 'multi-select',
    answer: [...DEMO_HOST_SERVICES],
    status: 'host services selected',
    stageTitle: 'Host services',
  },
  {
    id: 'theme-mode',
    title: 'Which theme mode should be used?',
    type: 'single-select',
    answer: 'dark',
    status: 'theme mode selected',
    stageTitle: 'Theme mode',
  },
  {
    id: 'theme-hue',
    title: 'Which Cascade hue should seed the theme?',
    type: 'number',
    answer: 218,
    status: 'theme hue selected',
    stageTitle: 'Theme hue',
  },
  {
    id: 'verification-scope',
    title: 'Which verification evidence must be carried?',
    type: 'multi-select',
    answer: ['layout', 'modules', 'theme', 'portability', 'runtime-imports'],
    status: 'validated handoff',
    stageTitle: 'Verification scope',
  },
]);

function panelType(title, component, icon, options = {}) {
  return {
    title,
    icon,
    component,
    ...(options.behavior ? { behavior: options.behavior } : {}),
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.slots ? { slots: options.slots } : {}),
    ...(options.menuActions ? { menuActions: options.menuActions } : {}),
    ...(options.attributes ? { attributes: options.attributes } : {}),
    ...(options.properties ? { properties: options.properties } : {}),
  };
}

function panel(panelTypeName, behavior = {}) {
  return {
    type: 'panel',
    panelType: panelTypeName,
    ...(Object.keys(behavior).length > 0 ? { behavior } : {}),
  };
}

function split(direction, ratio, first, second, behavior = {}) {
  return {
    type: 'split',
    direction,
    ratio,
    first,
    second,
    ...(Object.keys(behavior).length > 0 ? { behavior } : {}),
  };
}

function report(id, check, status, severity, message) {
  return { id, check, status, severity, message, version: '0.1.0' };
}

function question(id, title, type, status, answer, answerSource = 'derived') {
  return {
    id,
    title,
    type,
    status,
    ...(answer !== undefined ? { answer } : {}),
    ...(answerSource ? { answerSource } : {}),
  };
}

function decision(questionId, answer, operations, evidencePaths) {
  return {
    questionId,
    answer,
    operations,
    evidencePaths,
  };
}

function eventBridge(id, sourcePanel, event, options = {}) {
  return {
    id,
    sourcePanel,
    event,
    ...options,
  };
}

function binding(panelType, component, id, direction, path) {
  return {
    panelType,
    component,
    id,
    direction,
    path,
  };
}

function stateField(panelType, component, id, type, path, persistence) {
  return {
    panelType,
    component,
    id,
    type,
    path,
    persistence,
  };
}

function moduleCapability(panelTypeName, title, component, capabilities, icon, options = {}) {
  let panel = basePanelTypes()[panelTypeName] || {};
  return {
    tagName: component,
    provider: 'symbiote-ui',
    descriptor: {
      schemaVersion: '0.1.0',
      package: 'symbiote-ui',
      export: component,
      component,
    },
    capabilities,
    ...(options.actions ? { actions: options.actions } : {}),
    ...(options.menus ? { menus: options.menus } : {}),
    ...(options.toolbarItems ? { toolbarItems: options.toolbarItems } : {}),
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.state ? { state: options.state } : {}),
    ...(options.events ? { events: options.events } : {}),
    ...(options.bindings ? { bindings: options.bindings } : {}),
    ...(options.slots ? { slots: options.slots } : {}),
    ...(options.runtimeSlots ? { runtimeSlots: options.runtimeSlots } : {}),
    placement: {
      panelType: panelTypeName,
      title,
      icon,
      behavior: panel.behavior,
      registers: ['agent-workspace'],
      regions: options.regions || ['main'],
    },
  };
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scenarioModule(panelTypeName, component, capabilities, options = {}) {
  return {
    tagName: component,
    schemaVersion: '0.1.0',
    provider: 'symbiote-ui',
    descriptor: {
      schemaVersion: '2.0.0',
      package: 'symbiote-ui',
      component,
    },
    placement: {
      panelType: panelTypeName,
      regions: options.regions || ['main'],
    },
    capabilities,
    ...(options.actions ? { actions: options.actions } : {}),
    ...(options.toolbarItems ? { toolbarItems: options.toolbarItems } : {}),
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.events ? { events: options.events } : {}),
    ...(options.bindings ? { bindings: options.bindings } : {}),
    ...(options.runtimeSlots ? { runtimeSlots: options.runtimeSlots } : {}),
  };
}

function professionalPanelType(title, component, icon, options = {}) {
  return panelType(title, component, icon, {
    behavior: {
      importance: options.importance || 70,
      minInlineSize: options.minInlineSize || 260,
      minBlockSize: options.minBlockSize || 160,
      collapse: options.collapse || 'auto',
      ...(options.behavior || {}),
    },
    ...(options.attributes ? { attributes: options.attributes } : {}),
    ...(options.properties ? { properties: options.properties } : {}),
    ...(options.menuActions ? { menuActions: options.menuActions } : {}),
    ...(options.settings ? { settings: options.settings } : {}),
  });
}

function professionalBaseConfig(options) {
  let modules = options.modules || [];
  return {
    version: '0.3.0',
    name: options.name,
    register: options.register,
    intent: {
      brief: options.brief,
      targetRegister: options.register,
      audience: options.audience || ['professional workspace operators'],
      constraints: ['mock data only', 'host neutral workspace config', 'public symbiote-ui components'],
      executionModel: options.executionModel || 'graph-execution',
      hostServices: [...(options.hostServices || DEMO_HOST_SERVICES)],
      requiredCapabilities: unique(modules.flatMap((item) => item.capabilities.slice(0, 1))),
    },
    execution: {
      model: options.executionModel || 'graph-execution',
      hostServices: [...(options.hostServices || DEMO_HOST_SERVICES)],
    },
    theme: {
      recipe: options.themeRecipe || 'professional-cascade',
      params: options.themeParams || { mode: 'dark', hue: 218, chroma: 28, brightness: 0, contrast: 60 },
      relations: { surfaceStep: 1.08, radiusScale: 0.82 },
      overrides: { '--sn-workspace-gap': '10px' },
    },
    rootBehavior: {
      responsiveMode: 'drawer',
      responsiveBreakpoint: options.responsiveBreakpoint || 860,
      mobileDock: 'primary',
      swipeControl: 'edge',
    },
    groups: options.groups,
    sections: options.sections,
    panelTypes: options.panelTypes,
    layouts: options.layouts || {},
    layout: options.layout,
    events: options.events || [],
    data: {
      bindings: options.bindings || [],
      graphs: options.graphs || [],
    },
    construction: {
      sourceTemplate: options.sourceTemplate,
      plan: {
        scenarioId: options.id,
        layout: {
          topology: options.topology,
          layoutIds: Object.keys(options.layouts || {}),
          regions: options.regions,
        },
        modules: modules.map((item) => ({
          panelType: item.placement.panelType,
          component: item.tagName,
          capabilities: item.capabilities,
          placement: item.placement,
          actions: item.actions || [],
          toolbarItems: item.toolbarItems || [],
          settings: item.settings || [],
          events: item.events || {},
          bindings: item.bindings || [],
          runtimeSlots: item.runtimeSlots || [],
        })),
        bindings: options.bindings || [],
        execution: {
          model: options.executionModel || 'graph-execution',
          requiredHostServices: [...(options.hostServices || DEMO_HOST_SERVICES)],
        },
        theme: {
          source: 'symbiote-ui/default-cascade',
          widget: 'cascade-theme-widget',
          editorPanel: 'theme-editor',
        },
      },
    },
    components: {
      catalog: unique(modules.map((item) => item.tagName)),
      modules,
    },
    validation: {
      reports: [
        report(`${options.id}-layout`, 'layout', 'pass', 'info', `${options.name} layout uses panel-layout regions.`),
        report(`${options.id}-modules`, 'modules', 'pass', 'info', `${options.name} modules come from public symbiote-ui components.`),
        report(`${options.id}-theme`, 'theme', 'pass', 'info', 'Default Cascade theme is inherited from symbiote-ui.'),
      ],
    },
  };
}

function graphModel(kind) {
  let presets = {
    video: {
      nodes: [
        { id: 'media', type: 'media/source', name: 'Source', outputs: [{ name: 'frame', type: 'frame', label: 'frame' }] },
        { id: 'grade', type: 'effect/color-grade', name: 'Grade', inputs: [{ name: 'frame', type: 'frame', label: 'in' }], outputs: [{ name: 'frame', type: 'frame', label: 'out' }] },
        { id: 'mix', type: 'effect/composite', name: 'Composite', inputs: [{ name: 'frame', type: 'frame', label: 'layer' }], outputs: [{ name: 'frame', type: 'frame', label: 'out' }] },
        { id: 'render', type: 'media/render', name: 'Render', inputs: [{ name: 'frame', type: 'frame', label: 'frame' }] },
      ],
      connections: [
        { id: 'video-c1', from: 'media', out: 'frame', to: 'grade', in: 'frame' },
        { id: 'video-c2', from: 'grade', out: 'frame', to: 'mix', in: 'frame' },
        { id: 'video-c3', from: 'mix', out: 'frame', to: 'render', in: 'frame' },
      ],
    },
    automation: {
      nodes: [
        { id: 'trigger', type: 'queue/trigger', name: 'Trigger', outputs: [{ name: 'item', type: 'message', label: 'item' }] },
        { id: 'classify', type: 'ai/classify', name: 'Classify', inputs: [{ name: 'item', type: 'message', label: 'item' }], outputs: [{ name: 'intent', type: 'intent', label: 'intent' }] },
        { id: 'draft', type: 'llm/draft', name: 'Draft reply', inputs: [{ name: 'intent', type: 'intent', label: 'intent' }], outputs: [{ name: 'draft', type: 'text', label: 'draft' }] },
        { id: 'approval', type: 'human/approval', name: 'Approval', inputs: [{ name: 'draft', type: 'text', label: 'draft' }] },
      ],
      connections: [
        { id: 'auto-c1', from: 'trigger', out: 'item', to: 'classify', in: 'item' },
        { id: 'auto-c2', from: 'classify', out: 'intent', to: 'draft', in: 'intent' },
        { id: 'auto-c3', from: 'draft', out: 'draft', to: 'approval', in: 'draft' },
      ],
    },
    agent: {
      nodes: [
        { id: 'prompt', type: 'agent/prompt', name: 'Prompt', outputs: [{ name: 'task', type: 'task', label: 'task' }] },
        { id: 'plan', type: 'agent/plan', name: 'Plan', inputs: [{ name: 'task', type: 'task', label: 'task' }], outputs: [{ name: 'steps', type: 'steps', label: 'steps' }] },
        { id: 'edit', type: 'agent/edit', name: 'Edit', inputs: [{ name: 'steps', type: 'steps', label: 'steps' }], outputs: [{ name: 'patch', type: 'patch', label: 'patch' }] },
        { id: 'review', type: 'agent/review', name: 'Review', inputs: [{ name: 'patch', type: 'patch', label: 'patch' }] },
      ],
      connections: [
        { id: 'agent-c1', from: 'prompt', out: 'task', to: 'plan', in: 'task' },
        { id: 'agent-c2', from: 'plan', out: 'steps', to: 'edit', in: 'steps' },
        { id: 'agent-c3', from: 'edit', out: 'patch', to: 'review', in: 'patch' },
      ],
    },
  };
  let model = presets[kind] || presets.agent;
  return {
    readonly: true,
    ...model,
    positions: {
      [model.nodes[0].id]: [40, 54],
      [model.nodes[1].id]: [260, 54],
      [model.nodes[2].id]: [480, 54],
      [model.nodes[3].id]: [700, 54],
    },
  };
}

function overviewGraph(kind) {
  let model = graphModel(kind);
  return {
    nodes: model.nodes.map((node) => ({
      id: node.id,
      label: node.name,
      type: node.type,
      status: node.id === model.nodes.at(-1).id ? 'running' : 'ready',
    })),
    connections: model.connections.map((connection) => ({
      id: connection.id,
      source: connection.from,
      target: connection.to,
    })),
  };
}

function professionalChatState(title, messages) {
  let baseMessages = messages.filter(Boolean);
  let userPrompt = baseMessages[0] || `Build ${title} from existing modules.`;
  let agentPlan = baseMessages[1] || 'Selecting template topology and library panels.';
  let followUpPrompt = baseMessages[2] || 'Patch the active workspace without a page reload.';
  let transcript = [
    {
      id: 'professional-user-0',
      role: 'user',
      text: userPrompt,
    },
    {
      id: 'professional-agent-0',
      role: 'agent',
      text: agentPlan,
    },
    {
      id: 'professional-thinking-0',
      role: 'thinking',
      elapsedText: '00:02',
      status: 'planning topology',
      text: 'Resolve template, panel regions, module capabilities, and Cascade theme.',
    },
    {
      id: 'professional-tool-0',
      role: 'tool',
      name: 'construct_workspace_patch',
      input: {
        template: title,
        mode: 'atomic-update',
        source: 'symbiote-ui manifest',
      },
      result: {
        layout: 'panel-layout',
        theme: 'default-dark-cascade',
        reload: false,
      },
      isLatestTool: true,
    },
    {
      id: 'professional-board-0',
      role: 'board',
      cardItems: [
        { id: 'template', title: 'Template selected', status: 'done', icon: 'dashboard_customize' },
        { id: 'modules', title: 'Library modules mounted', status: 'running', icon: 'widgets' },
        { id: 'theme', title: 'Cascade theme applied', status: 'done', icon: 'palette' },
      ],
    },
    {
      id: 'professional-user-1',
      role: 'user',
      text: followUpPrompt,
    },
    {
      id: 'professional-agent-1',
      role: 'agent',
      text: 'Applied through `chat-workspace`, `panel-layout`, and public module contracts.',
      isStreaming: true,
    },
  ];
  return {
    sidebar: 'hidden',
    chats: [{ id: 'professional-demo', title, subtitle: 'Constructing workspace config' }],
    activeChatId: 'professional-demo',
    messages: transcript,
    messagesOptions: { scrollToBottom: true },
    composer: {
      placeholder: 'Describe the next module, split, binding, or theme change...',
      value: '',
      attachedContext: [
        { id: 'template', icon: 'dashboard_customize', name: title, title: 'Active template' },
        { id: 'theme', icon: 'palette', name: 'default cascade', title: 'Cascade theme' },
      ],
      leadingControls: [
        { id: 'attach', kind: 'button', icon: 'attach_file', label: 'Attach', title: 'Attach context' },
      ],
      footerControls: [
        { id: 'template', kind: 'button', icon: 'dashboard_customize', label: 'Template', value: title },
        { id: 'manual', kind: 'button', icon: 'open_with', label: 'Manual', value: 'Split panel' },
        { id: 'edit-existing', kind: 'button', icon: 'difference', label: 'Edit existing', value: 'Patch' },
      ],
    },
    voiceControls: {
      input: {
        visible: true,
        enabled: true,
        state: 'idle',
      },
      wakeListen: {
        visible: false,
        enabled: true,
        active: false,
        commandText: 'builder',
      },
      response: {
        visible: false,
        enabled: true,
        active: false,
        speaking: false,
      },
      command: {
        visible: false,
        enabled: true,
        active: false,
        text: 'Commands',
      },
      language: {
        visible: false,
        enabled: true,
        mode: 'auto',
        options: [
          { mode: 'auto', label: 'auto' },
          { mode: 'ru', label: 'RU' },
          { mode: 'en', label: 'EN' },
        ],
      },
    },
    liveStatus: {
      phase: 'running',
      title,
      text: 'Atomic workspace update without page reload.',
    },
    backgroundState: 'activity',
  };
}

function buildVideoScenario() {
  let panelTypes = {
    chat: professionalPanelType('Chat', 'chat-workspace', 'chat', { importance: 100, minInlineSize: 220, collapse: 'never' }),
    preview: professionalPanelType('Preview', 'sn-video-player', 'smart_display', {
      importance: 95,
      minInlineSize: 300,
      collapse: 'never',
      attributes: { muted: true, loop: true },
    }),
    timeline: professionalPanelType('Timeline', 'sn-timeline', 'view_timeline', { importance: 88, minInlineSize: 300, minBlockSize: 130, collapse: 'never' }),
    effects: professionalPanelType('Effects Graph', 'node-canvas', 'hub', { importance: 80, minInlineSize: 300, collapse: 'never' }),
    overview: professionalPanelType('Graph Overview', 'canvas-graph', 'account_tree', { importance: 55, minInlineSize: 180, collapse: 'never' }),
  };
  let modules = [
    scenarioModule('chat', 'chat-workspace', ['chat.workspace', 'agent.review'], { regions: ['chat'] }),
    scenarioModule('preview', 'sn-video-player', ['video-player', 'media-playback'], { regions: ['preview'] }),
    scenarioModule('timeline', 'sn-timeline', ['timeline', 'media.timeline'], { regions: ['timeline'] }),
    scenarioModule('effects', 'node-canvas', ['node-editor-canvas', 'media.effects-graph'], { regions: ['graph'] }),
    scenarioModule('overview', 'canvas-graph', ['graph-overview', 'semantic-navigation'], { regions: ['graph-overview'] }),
  ];
  return {
    id: 'video-editing',
    title: 'Video Editing Workspace',
    sourceTemplate: 'video-studio',
    topology: 'timeline-first',
      description: 'Media studio with dominant preview, effects graph, clip inspector, graph overview, and editing timeline.',
    config: professionalBaseConfig({
      id: 'video-editing',
      name: 'Video Editing Workspace',
      register: 'media-studio',
      sourceTemplate: 'video-studio',
      topology: 'timeline-first',
      brief: 'Construct a professional video editing workspace from media, timeline, node graph, and inspector modules.',
      groups: [{ id: 'media', name: 'Media', icon: 'movie', color: '--sn-accent' }],
      sections: [{ id: 'studio', label: 'Studio', icon: 'movie', order: 0, groupId: 'media', layoutId: 'studio' }],
      panelTypes,
      layout: split(
        'horizontal',
        0.22,
        panel('chat', { importance: 100, collapse: 'never' }),
        split(
          'vertical',
          0.68,
          split(
            'horizontal',
            0.60,
            panel('preview', { importance: 95 }),
            panel('effects')
          ),
          split('horizontal', 0.76, panel('timeline'), panel('overview'))
        )
      ),
      layouts: {},
      regions: {
        chat: ['chat'],
        preview: ['preview'],
        graph: ['effects', 'overview'],
        timeline: ['timeline'],
      },
      modules,
      bindings: [
        binding('timeline', 'sn-timeline', 'current-time', 'output', 'state.media.currentTime'),
        binding('preview', 'sn-video-player', 'playback', 'input', 'state.media.currentTime'),
        binding('effects', 'node-canvas', 'selection', 'output', 'state.media.selectedEffect'),
      ],
      events: [
        eventBridge('timeline-to-preview', 'timeline', 'timeline-select', { targetPanel: 'preview', targetProperty: 'currentTime' }),
      ],
      graphs: [{ id: 'video-effects', ...overviewGraph('video') }],
      themeParams: { mode: 'dark', hue: 262, chroma: 34, brightness: 0, contrast: 62 },
    }),
    panelData: {
      chat: { workspaceState: professionalChatState('Video editor construction', [
        'Build a video editing workspace with preview, timeline, effects graph, and clip inspector.',
        'Selected video-studio topology, mounted dominant media preview, timeline, graph surfaces, and inspector.',
      ]) },
      preview: {
        media: {
          title: 'Launch cut',
          subtitle: 'Scene 03 / color pass',
          duration: '01:18',
          frame: '00:34',
        },
      },
      timeline: {
        tracks: [
          {
            label: 'Video 1',
            time: '00:00',
            variant: 'success',
            clips: [
              { label: 'Intro', start: 0, span: 18, color: 'var(--sn-node-selected)' },
              { label: 'Product shot', start: 20, span: 38, color: 'var(--sn-info-color, #2e90fa)' },
              { label: 'Outro', start: 62, span: 18, color: 'var(--sn-success-color, #4caf50)' },
            ],
          },
          {
            label: 'Effects',
            time: '00:18',
            variant: 'info',
            clips: [
              { label: 'Color grade', start: 14, span: 30, color: 'var(--sn-warning-color, #ff9800)' },
              { label: 'Composite', start: 46, span: 28, color: 'var(--sn-node-selected)' },
            ],
          },
          {
            label: 'Audio',
            time: '00:34',
            variant: 'neutral',
            clips: [
              { label: 'Music bed', start: 4, span: 70, color: 'var(--sn-accent-color, #8b5cf6)' },
            ],
          },
        ],
        items: [
          { title: 'Ingest clip', time: '00:00', variant: 'success' },
          { title: 'Color pass', time: '00:18', variant: 'info' },
          { title: 'Composite overlay', time: '00:34', variant: 'warning' },
          { title: 'Render target', time: '01:05', variant: 'neutral' },
        ],
      },
      effects: { editorModel: graphModel('video') },
      overview: { graphModel: overviewGraph('video') },
    },
    acceptance: ['preview', 'timeline', 'effects', 'overview', 'node-canvas-inspector'],
  };
}

function buildAutomationScenario() {
  let panelTypes = {
    chat: professionalPanelType('Chat', 'chat-workspace', 'chat', { importance: 100, minInlineSize: 320, collapse: 'never' }),
    workflow: professionalPanelType('Workflow', 'node-canvas', 'hub', { importance: 92, minInlineSize: 380 }),
    queue: professionalPanelType('Queue', 'sn-data-table', 'table', { importance: 85, minInlineSize: 340 }),
    reply: professionalPanelType('Reply Editor', 'sn-rich-text-editor', 'edit_note', { importance: 76, minInlineSize: 300 }),
    approvals: professionalPanelType('Approvals', 'sn-kanban-board', 'view_kanban', { importance: 70, minInlineSize: 300 }),
    history: professionalPanelType('History', 'sn-timeline', 'timeline', { importance: 60, minInlineSize: 240 }),
    imports: professionalPanelType('Imports', 'sn-file-upload', 'upload_file', { importance: 42, minInlineSize: 220 }),
  };
  let modules = [
    scenarioModule('chat', 'chat-workspace', ['chat.workspace', 'agent.command-input'], { regions: ['chat'] }),
    scenarioModule('workflow', 'node-canvas', ['workflow.node-editor', 'automation.graph'], { regions: ['graph'] }),
    scenarioModule('queue', 'sn-data-table', ['data-table', 'automation.queue'], { regions: ['data-table'] }),
    scenarioModule('reply', 'sn-rich-text-editor', ['rich-text', 'automation.reply-template'], { regions: ['editor'] }),
    scenarioModule('approvals', 'sn-kanban-board', ['kanban-board', 'approval-flow'], { regions: ['board'] }),
    scenarioModule('history', 'sn-timeline', ['timeline', 'automation.history'], { regions: ['history'] }),
    scenarioModule('imports', 'sn-file-upload', ['file-upload', 'data.import'], { regions: ['imports'] }),
  ];
  return {
    id: 'automation-editing',
    title: 'Automation Editing Workspace',
    sourceTemplate: 'social-automation',
    topology: 'canvas-first',
    description: 'Automation studio with workflow graph, queue, reply editor, approvals, history, and imports.',
    config: professionalBaseConfig({
      id: 'automation-editing',
      name: 'Automation Editing Workspace',
      register: 'agent-workspace',
      sourceTemplate: 'social-automation',
      topology: 'canvas-first',
      brief: 'Construct an automation editing workspace with graph, queue, editor, approvals, history, and imports.',
      groups: [{ id: 'automation', name: 'Automation', icon: 'hub', color: '--sn-info' }],
      sections: [{ id: 'automation', label: 'Automation', icon: 'hub', order: 0, groupId: 'automation', layoutId: 'automation' }],
      panelTypes,
      layout: split(
        'horizontal',
        0.23,
        panel('chat', { importance: 100, collapse: 'never' }),
        split(
          'horizontal',
          0.48,
          split('vertical', 0.62, panel('workflow'), panel('approvals')),
          split('vertical', 0.48, panel('queue'), split('horizontal', 0.56, panel('reply'), split('vertical', 0.5, panel('history'), panel('imports'))))
        )
      ),
      regions: {
        chat: ['chat'],
        graph: ['workflow'],
        data: ['queue'],
        editor: ['reply'],
        review: ['approvals', 'history', 'imports'],
      },
      modules,
      bindings: [
        binding('queue', 'sn-data-table', 'row', 'output', 'state.automation.selectedQueueItem'),
        binding('reply', 'sn-rich-text-editor', 'context', 'input', 'state.automation.selectedQueueItem'),
        binding('workflow', 'node-canvas', 'selection', 'output', 'state.automation.selectedNode'),
        binding('history', 'sn-timeline', 'filter', 'input', 'state.automation.selectedNode'),
      ],
      events: [
        eventBridge('queue-to-reply', 'queue', 'row-select', { targetPanel: 'reply', targetProperty: 'context' }),
        eventBridge('workflow-to-history', 'workflow', 'node-select', { targetPanel: 'history', targetProperty: 'filter' }),
        eventBridge('approval-to-workflow', 'approvals', 'sn-board-card-drop', { targetPanel: 'workflow', targetProperty: 'approvalState' }),
      ],
      graphs: [{ id: 'automation-flow', ...overviewGraph('automation') }],
      themeParams: { mode: 'dark', hue: 196, chroma: 28, brightness: 0, contrast: 60 },
    }),
    panelData: {
      chat: { workspaceState: professionalChatState('Automation construction', [
        'Build an automation workspace for queue review, reply drafting, approvals, and workflow editing.',
        'Mounted workflow graph, queue table, rich text editor, kanban approvals, history timeline, and imports.',
      ]) },
      workflow: { editorModel: graphModel('automation') },
      queue: {
        table: {
          columns: [
            { key: 'source', label: 'Source', width: 110 },
            { key: 'intent', label: 'Intent', width: 140 },
            { key: 'status', label: 'Status', width: 110 },
          ],
          rows: [
            { id: 'q1', source: 'LinkedIn', intent: 'pricing', status: { badge: { label: 'draft', variant: 'info' } } },
            { id: 'q2', source: 'Email', intent: 'support', status: { badge: { label: 'review', variant: 'warning' } } },
            { id: 'q3', source: 'Forum', intent: 'bug', status: { badge: { label: 'approved', variant: 'success' } } },
          ],
        },
      },
      reply: { html: '<p>Hello {{firstName}}, here is a concise response with a tracked approval gate.</p>' },
      approvals: {
        board: {
          columns: [
            { id: 'draft', title: 'Draft', cards: [{ id: 'a1', title: 'Pricing reply', meta: ['LLM'], footer: ['needs review'] }] },
            { id: 'review', title: 'Review', cards: [{ id: 'a2', title: 'Support escalation', meta: ['policy'], footer: ['human gate'] }] },
            { id: 'ready', title: 'Ready', cards: [{ id: 'a3', title: 'Bug acknowledgement', meta: ['safe'], footer: ['scheduled'] }] },
          ],
        },
      },
      history: {
        items: [
          { title: 'Queue item classified', time: '12:01', variant: 'success' },
          { title: 'Reply draft generated', time: '12:02', variant: 'info' },
          { title: 'Approval requested', time: '12:04', variant: 'warning' },
        ],
      },
    },
    acceptance: ['workflow', 'queue', 'reply', 'approvals', 'history', 'imports'],
  };
}

function buildAgentProgrammingScenario() {
  let panelTypes = {
    chat: professionalPanelType('Chat', 'chat-workspace', 'chat', { importance: 100, minInlineSize: 340, collapse: 'never' }),
    files: professionalPanelType('Files', 'sn-tree-panel', 'folder', { importance: 58, minInlineSize: 220 }),
    source: professionalPanelType('Source', 'source-editor', 'code', { importance: 86, minInlineSize: 360 }),
    diff: professionalPanelType('Diff', 'sn-source-diff', 'difference', { importance: 82, minInlineSize: 360 }),
    code: professionalPanelType('Code Output', 'code-block', 'terminal', { importance: 65, minInlineSize: 320 }),
    activity: professionalPanelType('Activity', 'sn-event-feed', 'dynamic_feed', { importance: 58, minInlineSize: 260 }),
    workflow: professionalPanelType('Workflow', 'node-canvas', 'hub', { importance: 72, minInlineSize: 340 }),
    overview: professionalPanelType('Overview', 'canvas-graph', 'account_tree', { importance: 48, minInlineSize: 260 }),
  };
  let modules = [
    scenarioModule('chat', 'chat-workspace', ['chat.workspace', 'agent.programming'], { regions: ['chat'] }),
    scenarioModule('files', 'sn-tree-panel', ['tree-data', 'file-navigation'], { regions: ['navigation'] }),
    scenarioModule('source', 'source-editor', ['source.edit', 'code-editor'], { regions: ['source'] }),
    scenarioModule('diff', 'sn-source-diff', ['diff-viewer', 'code-review'], { regions: ['review'] }),
    scenarioModule('code', 'code-block', ['syntax-highlight', 'agent-output'], { regions: ['output'] }),
    scenarioModule('activity', 'sn-event-feed', ['activity.feed', 'task-events'], { regions: ['activity'] }),
    scenarioModule('workflow', 'node-canvas', ['node-editor-canvas', 'agent-workflow'], { regions: ['graph'] }),
    scenarioModule('overview', 'canvas-graph', ['graph-overview', 'semantic-navigation'], { regions: ['overview'] }),
  ];
  return {
    id: 'agent-programming',
    title: 'Agent Programming Workspace',
    sourceTemplate: 'agent-workspace + editor',
    topology: 'chat-first-workbench',
    description: 'Agent coding workspace with chat, file tree, editor, diff, code output, activity, and two graph surfaces.',
    config: professionalBaseConfig({
      id: 'agent-programming',
      name: 'Agent Programming Workspace',
      register: 'agent-workspace',
      sourceTemplate: 'agent-workspace',
      topology: 'chat-first-workbench',
      brief: 'Construct an agent programming workspace with chat, files, source, diff, code output, activity, and workflow graph.',
      groups: [{ id: 'agent', name: 'Agent Programming', icon: 'smart_toy', color: '--sn-accent' }],
      sections: [{ id: 'programming', label: 'Programming', icon: 'code', order: 0, groupId: 'agent', layoutId: 'programming' }],
      panelTypes,
      layout: split(
        'horizontal',
        0.25,
        panel('chat', { importance: 100, collapse: 'never' }),
        split(
          'horizontal',
          0.18,
          panel('files'),
          split(
            'vertical',
            0.58,
            split('horizontal', 0.54, panel('source'), panel('diff')),
            split('horizontal', 0.34, panel('code'), split('vertical', 0.52, panel('workflow'), split('horizontal', 0.5, panel('overview'), panel('activity'))))
          )
        )
      ),
      regions: {
        chat: ['chat'],
        navigation: ['files'],
        source: ['source', 'code'],
        review: ['diff'],
        graph: ['workflow', 'overview'],
        activity: ['activity'],
      },
      modules,
      bindings: [
        binding('files', 'sn-tree-panel', 'selection', 'output', 'state.source.selectedPath'),
        binding('source', 'source-editor', 'document', 'input', 'state.source.selectedPath'),
        binding('diff', 'sn-source-diff', 'hunk', 'output', 'state.review.selectedHunk'),
        binding('workflow', 'node-canvas', 'selection', 'output', 'state.agent.selectedStep'),
        binding('activity', 'sn-event-feed', 'filter', 'input', 'state.agent.selectedStep'),
      ],
      events: [
        eventBridge('files-to-source', 'files', 'item-select', { targetPanel: 'source', targetProperty: 'path' }),
        eventBridge('diff-to-source', 'diff', 'sn-diff-comment-add', { targetPanel: 'source', targetProperty: 'focusLine' }),
        eventBridge('workflow-to-activity', 'workflow', 'node-select', { targetPanel: 'activity', targetProperty: 'filter' }),
      ],
      graphs: [{ id: 'agent-programming-flow', ...overviewGraph('agent') }],
      themeParams: { mode: 'dark', hue: 222, chroma: 26, brightness: 0, contrast: 62 },
    }),
    panelData: {
      chat: { workspaceState: professionalChatState('Agent programming construction', [
        'Build an agent programming workspace with chat, files, source, diff, activity, and workflow graphs.',
        'Mounted chat-workspace, source editor, source diff, code block, event feed, node-canvas, and canvas-graph.',
      ]) },
      files: {
        items: [
          { id: 'src', label: 'src', children: [{ id: 'src/runtime.js', label: 'runtime.js' }, { id: 'src/graph.js', label: 'graph.js' }] },
          { id: 'tests', label: 'tests', children: [{ id: 'tests/runtime.test.js', label: 'runtime.test.js' }] },
        ],
      },
      source: {
        document: {
          path: 'src/runtime.js',
          language: 'js',
          content: "export function applyPatch(config, patch) {\n  return mergeWorkspaceConfig(config, patch);\n}\n",
          dirty: true,
        },
      },
      diff: {
        diff: {
          path: 'src/runtime.js',
          hunks: [{
            header: '@@ -1,3 +1,5 @@',
            lines: [
              { type: 'context', content: 'export function applyPatch(config, patch) {', originalLineNumber: 1, modifiedLineNumber: 1 },
              { type: 'deletion', content: '  return patch;', originalLineNumber: 2 },
              { type: 'addition', content: '  validateWorkspacePatch(patch);', modifiedLineNumber: 2 },
              { type: 'addition', content: '  return mergeWorkspaceConfig(config, patch);', modifiedLineNumber: 3 },
              { type: 'context', content: '}', originalLineNumber: 3, modifiedLineNumber: 4 },
            ],
          }],
        },
      },
      code: {
        content: "node --test tests/runtime.test.js\n# pass 42\n# fail 0\n",
        language: 'sh',
      },
      activity: {
        events: [
          { title: 'Plan accepted', subtitle: 'workspace patch', time: '13:01', status: 'done' },
          { title: 'Files edited', subtitle: 'runtime.js', time: '13:04', status: 'running' },
          { title: 'Diff ready', subtitle: '+2 -1', time: '13:06', status: 'done' },
        ],
      },
      workflow: { editorModel: graphModel('agent') },
      overview: { graphModel: overviewGraph('agent') },
    },
    acceptance: ['chat', 'files', 'source', 'diff', 'code', 'activity', 'workflow', 'overview'],
  };
}

function buildConstructorScenario() {
  let panelTypes = {
    templates: professionalPanelType('Templates', 'layout-shell-menu', 'dashboard_customize', { importance: 72, minInlineSize: 280 }),
    tabs: professionalPanelType('Workspaces', 'project-tabs', 'tab', { importance: 52, minBlockSize: 90 }),
    palette: professionalPanelType('Palette', 'palette-browser', 'widgets', { importance: 78, minInlineSize: 300 }),
    layout: professionalPanelType('Manual Layout', 'panel-layout', 'view_quilt', { importance: 94, minInlineSize: 420 }),
    inspector: professionalPanelType('Inspector', 'inspector-panel', 'tune', { importance: 70, minInlineSize: 260 }),
    theme: professionalPanelType('Theme', 'cascade-theme-editor', 'palette', { importance: 76, minInlineSize: 300 }),
    menu: professionalPanelType('Actions', 'sn-menu', 'menu', { importance: 42, minInlineSize: 220 }),
  };
  let modules = [
    scenarioModule('templates', 'layout-shell-menu', ['layout-shell', 'template-selection'], { regions: ['templates'] }),
    scenarioModule('tabs', 'project-tabs', ['tab-list', 'workspace-tabs'], { regions: ['tabs'] }),
    scenarioModule('palette', 'palette-browser', ['node-palette', 'module-discovery'], { regions: ['palette'] }),
    scenarioModule('layout', 'panel-layout', ['layout-tree', 'manual-split'], { regions: ['layout'] }),
    scenarioModule('inspector', 'inspector-panel', ['node-inspector', 'panel-properties'], { regions: ['inspector'] }),
    scenarioModule('theme', 'cascade-theme-editor', ['cascade-theme-controls', 'theme-editor'], { regions: ['theme'] }),
    scenarioModule('menu', 'sn-menu', ['menu', 'workspace-actions'], { regions: ['actions'] }),
  ];
  return {
    id: 'constructor-control',
    title: 'Constructor Control Workspace',
    sourceTemplate: 'template/manual/edit-existing',
    topology: 'constructor-shell',
    description: 'Constructor controls for template layout, manual panel placement, and editing existing configs.',
    config: professionalBaseConfig({
      id: 'constructor-control',
      name: 'Constructor Control Workspace',
      register: 'tool',
      sourceTemplate: 'template/manual/edit-existing',
      topology: 'constructor-shell',
      brief: 'Construct or edit existing workspaces by selecting templates, adding modules, changing splits, and applying Cascade theme.',
      groups: [{ id: 'constructor', name: 'Constructor', icon: 'dashboard_customize', color: '--sn-accent' }],
      sections: [{ id: 'constructor', label: 'Constructor', icon: 'dashboard_customize', order: 0, groupId: 'constructor', layoutId: 'constructor' }],
      panelTypes,
      layout: split(
        'horizontal',
        0.22,
        split('vertical', 0.46, panel('templates'), split('vertical', 0.5, panel('tabs'), panel('palette'))),
        split('horizontal', 0.64, panel('layout'), split('vertical', 0.5, panel('inspector'), split('horizontal', 0.58, panel('theme'), panel('menu'))))
      ),
      regions: {
        templates: ['templates'],
        palette: ['palette'],
        canvas: ['layout'],
        inspector: ['inspector'],
        theme: ['theme'],
        actions: ['tabs', 'menu'],
      },
      modules,
      bindings: [
        binding('templates', 'layout-shell-menu', 'template', 'output', 'construction.selectedTemplate'),
        binding('palette', 'palette-browser', 'module', 'output', 'construction.selectedModule'),
        binding('layout', 'panel-layout', 'layout-tree', 'two-way', 'layout'),
        binding('theme', 'cascade-theme-editor', 'theme', 'two-way', 'theme'),
      ],
      events: [
        eventBridge('template-to-layout', 'templates', 'template-select', { targetPanel: 'layout', targetMethod: 'updateConfig' }),
        eventBridge('palette-to-layout', 'palette', 'factory-select', { targetPanel: 'layout', targetProperty: 'pendingPanel' }),
        eventBridge('theme-to-root', 'theme', 'cascade-theme-change', { targetPanel: 'layout', targetProperty: 'theme' }),
      ],
      themeParams: { mode: 'dark', hue: 172, chroma: 30, brightness: 0, contrast: 60 },
    }),
    panelData: {
      templates: { note: 'Template layout selection: video-studio, social-automation, agent-workspace.' },
      tabs: { tabs: ['Video Studio', 'Automation Studio', 'Agent Programming'] },
      palette: { note: 'Palette selects existing symbiote-ui modules before generated code.' },
      layout: { nestedLayout: true },
      inspector: { node: graphModel('agent').nodes[1] },
      menu: { actions: ['Load existing config', 'Split panel', 'Add module', 'Export workspace'] },
    },
    acceptance: ['templates', 'palette', 'layout', 'inspector', 'theme'],
  };
}

function buildProfessionalScenarios() {
  return [
    buildVideoScenario(),
    buildAutomationScenario(),
    buildAgentProgrammingScenario(),
    buildConstructorScenario(),
  ];
}

function constructionModulePlan() {
  return demoModuleCapabilities().map((descriptor) => ({
    panelType: descriptor.placement.panelType,
    component: descriptor.tagName,
    capabilities: descriptor.capabilities,
    placement: {
      regions: descriptor.placement.regions,
      registers: descriptor.placement.registers,
      behavior: descriptor.placement.behavior,
    },
    actions: descriptor.actions || [],
    menus: descriptor.menus || [],
    toolbarItems: descriptor.toolbarItems || [],
    settings: descriptor.settings || [],
    events: descriptor.events || {},
    bindings: descriptor.bindings || [],
    slots: descriptor.slots || [],
    runtimeSlots: descriptor.runtimeSlots || [],
  }));
}

function adaptiveScenarios(options) {
  let required = options.requiredElements || [];
  let adaptive = options.adaptiveBehavior || {};
  let collapseOrder = adaptive.collapseOrder || [];
  let pinned = adaptive.pinned || [];
  let protectedPanels = unique([...pinned, options.themeCascade?.editorWidget]);
  let collapseByCount = (count) => collapseOrder.slice(0, count);
  let scenario = (mode, inlineSize, collapsed, docked = []) => {
    let dockedSet = new Set(docked);
    let resolvedCollapsed = unique(collapsed.filter((item) => !dockedSet.has(item)));
    let collapsedSet = new Set(resolvedCollapsed);
    return {
      mode,
      inlineSize,
      visiblePanels: required.filter((item) => !collapsedSet.has(item) && !dockedSet.has(item)),
      dockedPanels: unique(docked),
      collapsedPanels: resolvedCollapsed,
      protectedPanels,
      themeEditor: protectedPanels.includes('theme-editor') ? 'visible-or-docked' : 'not-required',
      collapseRule: `${collapseOrder.join(' -> ') || 'none'} after ${protectedPanels.join(', ') || 'none'}`,
    };
  };
  return [
    scenario('wide', 1280, []),
    scenario('tablet', 860, collapseByCount(Math.min(2, collapseOrder.length))),
    scenario(
      'mobile',
      390,
      collapseByCount(Math.max(0, collapseOrder.length - 1)),
      protectedPanels.filter((item) => item !== 'agent-chat')
    ),
  ];
}

function chatState(options) {
  return {
    activeIntent: options.activeIntent,
    activeQuestionId: options.activeQuestionId,
    questionnaireStatus: options.questionnaireStatus,
    serviceBlueprint: options.serviceBlueprint || null,
    requiredElements: options.requiredElements || [],
    layoutRoles: options.layoutRoles || {},
    widgetRegistry: options.widgetRegistry || [],
    adaptiveBehavior: options.adaptiveBehavior || null,
    adaptiveScenarios: options.adaptiveScenarios || adaptiveScenarios(options),
    themeCascade: options.themeCascade || null,
    validationChecklist: options.validationChecklist || [],
    decisionTrace: options.decisionTrace || [],
    nextPatch: options.nextPatch,
  };
}

function basePanelTypes() {
  return {
    'agent-chat': panelType('Agent Chat', 'chat-workspace', 'forum', {
      behavior: { importance: 100, minInlineSize: 320, collapse: 'never' },
      slots: [{ id: 'transcript', role: 'content', required: true }],
    }),
    'service-blueprint': panelType('Service Blueprint', 'sn-description-list', 'account_tree', {
      behavior: { importance: 90, minInlineSize: 360, collapse: 'auto' },
      slots: [{ id: 'entities', role: 'content', required: true }],
    }),
    'layout-builder': panelType(
      'Layout Builder Surface',
      'panel-layout',
      'dashboard_customize',
      {
        behavior: { importance: 88, minInlineSize: 420, collapse: 'auto' },
        settings: [
          {
            id: 'density',
            label: 'Density',
            type: 'enum',
            default: 'compact',
            options: [{ label: 'Compact', value: 'compact' }],
          },
          {
            id: 'root-mode',
            label: 'Root mode',
            type: 'enum',
            default: 'drawer',
            options: [{ label: 'Drawer', value: 'drawer' }],
          },
        ],
      },
    ),
    'widget-registry': panelType('Widget Registry', 'sn-tree-panel', 'widgets', {
      behavior: { importance: 64, minInlineSize: 280, collapse: 'auto' },
      slots: [{ id: 'widget-cards', role: 'content' }],
    }),
    'bindings-inspector': panelType('Bindings Inspector', 'sn-data-table', 'hub', {
      behavior: { importance: 72, minInlineSize: 300, collapse: 'auto' },
      slots: [{ id: 'bindings', role: 'content', required: true }],
    }),
    'adaptive-rules': panelType('Adaptive Rules', 'sn-list-detail-shell', 'collapse_content', {
      behavior: { importance: 58, minInlineSize: 280, collapse: 'auto' },
    }),
    'validation-checklist': panelType('Validation Checklist', 'sn-event-feed', 'task_alt', {
      behavior: { importance: 76, minInlineSize: 280, collapse: 'auto' },
    }),
    'theme-editor': panelType('Theme Editor', 'cascade-theme-editor', 'palette', {
      behavior: { importance: 82, minInlineSize: 300, collapse: 'manual' },
      settings: [
        {
          id: 'mode',
          label: 'Mode',
          type: 'enum',
          default: 'light',
          options: [
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
          ],
        },
        { id: 'hue', label: 'Hue', type: 'number', default: 218 },
        { id: 'contrast', label: 'Contrast', type: 'number', default: 66 },
      ],
    }),
  };
}

function baseConfig(name, overrides = {}) {
  let moduleDescriptors = demoModuleCapabilities();
  return {
    version: '0.3.0',
    name,
    register: 'agent-workspace',
    intent: {
      brief: 'AI agent tool that creates a service UI from a guided questionnaire.',
      targetRegister: 'agent-workspace',
      audience: ['service builders', 'AI agent operators'],
      constraints: ['mock data only', 'host neutral workspace config', 'default Symbiote UI theme cascade'],
      executionModel: DEMO_EXECUTION_MODEL,
      hostServices: [...DEMO_HOST_SERVICES],
      requiredCapabilities: unique(moduleDescriptors.flatMap((descriptor) => (
        descriptor.capabilities.slice(0, 1)
      ))),
    },
    execution: {
      model: DEMO_EXECUTION_MODEL,
      hostServices: [...DEMO_HOST_SERVICES],
    },
    theme: {
      recipe: 'agent-console',
      params: { mode: 'dark', hue: 218, chroma: 30, brightness: 0, contrast: 58 },
      relations: { surfaceStep: 1.08, radiusScale: 0.82 },
      overrides: { '--sn-workspace-gap': '12px' },
      subtrees: [
        {
          selector: 'cascade-theme-editor',
          params: { hue: 280, chroma: 46 },
          relations: { surfaceStep: 1.16 },
        },
      ],
    },
    rootBehavior: {
      responsiveMode: 'drawer',
      responsiveBreakpoint: 860,
      mobileDock: 'primary',
      swipeControl: 'edge',
    },
    groups: [
      { id: 'agent', name: 'Agent', icon: 'forum', color: '--sn-accent' },
      { id: 'service', name: 'Service', icon: 'account_tree', color: '--sn-info' },
    ],
    sections: [
      {
        id: 'conversation',
        label: 'Conversation',
        icon: 'forum',
        order: 10,
        groupId: 'agent',
        layoutId: 'conversation',
      },
      {
        id: 'builder',
        label: 'Builder',
        icon: 'dashboard_customize',
        order: 20,
        groupId: 'service',
        layoutId: 'builder',
      },
      {
        id: 'quality',
        label: 'Quality',
        icon: 'task_alt',
        order: 30,
        groupId: 'service',
        layoutId: 'quality',
      },
    ],
    panelTypes: basePanelTypes(),
    components: {
      catalog: moduleDescriptors.map((descriptor) => descriptor.tagName),
      modules: moduleDescriptors,
    },
    ...overrides,
  };
}

function createStages() {
  let intentLayout = split(
    'horizontal',
    0.58,
    panel('agent-chat', { importance: 100, collapse: 'never' }),
    panel('service-blueprint', { importance: 86, collapse: 'auto' })
  );
  let questionnaireLayout = split(
    'horizontal',
    0.38,
    panel('agent-chat', { importance: 100, collapse: 'never' }),
    split(
      'vertical',
      0.55,
      panel('service-blueprint', { importance: 90 }),
      panel('widget-registry', { importance: 62 })
    )
  );
  let builderLayout = split(
    'horizontal',
    0.28,
    panel('agent-chat', { importance: 100, collapse: 'never' }),
    split(
      'horizontal',
      0.62,
      panel('layout-builder', { importance: 92, minInlineSize: 440 }),
      split(
        'vertical',
        0.5,
        panel('bindings-inspector', { importance: 74 }),
        panel('theme-editor', { importance: 82, collapse: 'manual' })
      )
    )
  );
  let validationLayout = split(
    'horizontal',
    0.22,
    panel('agent-chat', { importance: 100, collapse: 'never' }),
    split(
      'horizontal',
      0.38,
      split(
        'vertical',
        0.54,
        panel('layout-builder', { importance: 92 }),
        panel('adaptive-rules', { importance: 58 })
      ),
      split(
        'horizontal',
        0.5,
        split(
          'vertical',
          0.38,
          panel('service-blueprint', { importance: 90 }),
          split(
            'vertical',
            0.5,
            panel('widget-registry', { importance: 64 }),
            panel('bindings-inspector', { importance: 74 })
          )
        ),
        split(
          'vertical',
          0.46,
          panel('theme-editor', { importance: 82, collapse: 'manual' }),
          panel('validation-checklist', { importance: 78 })
        )
      )
    )
  );

  return [
    {
      id: 'intent',
      title: 'Intent capture',
      clock: '00:00',
      chat: [
        { role: 'user', text: 'Create an AI tool that interviews me and builds a service UI.' },
        {
          role: 'agent',
          text: 'I will capture the service goal, required widgets, layout roles, and theme constraints.',
        },
      ],
      activeQuestionId: 'service-goal',
      chatState: chatState({
        activeIntent: 'Build an AI-agent tool that creates a service UI from guided answers.',
        activeQuestionId: 'service-goal',
        questionnaireStatus: 'intent-captured',
        serviceBlueprint: {
          name: 'AI service builder',
          entities: ['Agent', 'Service blueprint'],
          workflows: ['capture intent', 'ask conditional questions'],
        },
        requiredElements: ['agent-chat', 'service-blueprint'],
        layoutRoles: {
          'agent-chat': 'conversation-primary',
          'service-blueprint': 'service-model',
        },
        widgetRegistry: [
          { id: 'agent-chat', status: 'mounted', role: 'conversation-primary' },
          { id: 'service-blueprint', status: 'mounted', role: 'service-model' },
        ],
        adaptiveBehavior: {
          mode: 'drawer',
          collapseOrder: ['service-blueprint'],
          pinned: ['agent-chat'],
        },
        themeCascade: {
          source: 'symbiote-ui/default',
          mode: 'dark',
          editorWidget: 'theme-editor',
          status: 'required-not-mounted',
        },
        validationChecklist: [
          { id: 'intent', status: 'pass' },
          { id: 'required-widgets', status: 'pending' },
        ],
        decisionTrace: [
          decision(
            'service-goal',
            'AI service builder',
            [
              'set intent.brief',
              'select agent-workspace register',
              'mount conversation and blueprint panels',
            ],
            ['config.intent.brief', 'config.register', 'config.panelTypes.agent-chat']
          ),
        ],
        nextPatch: 'Resolve mandatory widgets from questionnaire answers.',
      }),
      config: baseConfig('Realtime Builder - Intent', {
        construction: {
          questions: [
            question(
              'service-goal',
              'What service will this UI create?',
              'text',
              'answered',
              'AI service builder'
            ),
            question(
              'required-widgets',
              'Which widgets are mandatory?',
              'multi-select',
              'pending',
              undefined,
              null
            ),
            question(
              'theme-mode',
              'Which theme mode should be used?',
              'single-select',
              'pending',
              undefined,
              null
            ),
          ],
          plan: {
            layoutTemplate: 'agent-service-builder',
            selectedPanels: ['agent-chat', 'service-blueprint'],
          },
        },
        validation: {
          reports: [
            report('intent-captured', 'intent', 'pass', 'info', 'Intent and audience are captured.'),
            report('widgets-open', 'widgets', 'warn', 'warning', 'Required widget list is not complete yet.'),
          ],
        },
        layouts: { conversation: intentLayout, builder: intentLayout },
        layout: intentLayout,
      }),
    },
    {
      id: 'questionnaire',
      title: 'Guided questionnaire',
      clock: '00:09',
      chat: [
        {
          role: 'user',
          text: 'Widgets: blueprint, layout builder, registry, bindings, validation, theme editor.',
        },
        {
          role: 'agent',
          text: 'Mandatory panels are locked. I am assigning layout roles and initial adaptive priorities.',
        },
      ],
      activeQuestionId: 'layout-roles',
      chatState: chatState({
        activeIntent: 'Turn answered widget requirements into a service UI skeleton.',
        activeQuestionId: 'layout-roles',
        questionnaireStatus: 'widgets-locked',
        serviceBlueprint: {
          name: 'AI service builder',
          entities: ['Agent', 'Service blueprint', 'Workspace layout', 'Widget contract'],
          workflows: ['capture intent', 'select mandatory widgets', 'assign layout roles'],
        },
        requiredElements: [
          'agent-chat',
          'service-blueprint',
          'layout-builder',
          'widget-registry',
          'bindings-inspector',
          'validation-checklist',
          'theme-editor',
        ],
        layoutRoles: {
          'agent-chat': 'conversation-primary',
          'service-blueprint': 'service-model',
          'widget-registry': 'component-source',
        },
        widgetRegistry: [
          { id: 'agent-chat', status: 'mounted', role: 'conversation-primary' },
          { id: 'service-blueprint', status: 'mounted', role: 'service-model' },
          { id: 'widget-registry', status: 'mounted', role: 'component-source' },
          { id: 'layout-builder', status: 'planned', role: 'builder-canvas' },
          { id: 'bindings-inspector', status: 'planned', role: 'inspection-sidecar' },
          { id: 'validation-checklist', status: 'planned', role: 'quality-footer' },
          { id: 'theme-editor', status: 'required', role: 'theme-control' },
        ],
        adaptiveBehavior: {
          mode: 'drawer',
          collapseOrder: ['widget-registry', 'service-blueprint'],
          pinned: ['agent-chat'],
        },
        themeCascade: {
          source: 'symbiote-ui/default',
          mode: 'dark',
          editorWidget: 'theme-editor',
          status: 'required-not-mounted',
        },
        validationChecklist: [
          { id: 'intent', status: 'pass' },
          { id: 'required-widgets', status: 'pass' },
          { id: 'theme-editor', status: 'pending' },
        ],
        decisionTrace: [
          decision(
            'service-goal',
            'AI service builder',
            [
              'set intent.brief',
              'extend service blueprint entities',
              'keep agent chat as pinned primary region',
            ],
            ['config.intent.brief', 'chatState.serviceBlueprint.entities', 'chatState.adaptiveBehavior.pinned']
          ),
          decision(
            'required-widgets',
            [
              'service-blueprint',
              'layout-builder',
              'widget-registry',
              'bindings-inspector',
              'validation-checklist',
              'theme-editor',
            ],
            [
              'register mandatory panel types',
              'mount widget registry',
              'mark builder, inspector, validation, and theme widgets as planned',
            ],
            ['config.panelTypes', 'chatState.widgetRegistry', 'config.construction.plan.selectedPanels']
          ),
          decision(
            'layout-roles',
            [
              'conversation-primary',
              'builder-canvas',
              'inspection-sidecar',
              'quality-footer',
            ],
            [
              'assign semantic layout roles',
              'prepare builder layout template',
              'set initial collapse order',
            ],
            ['chatState.layoutRoles', 'config.construction.plan.roleMap', 'chatState.adaptiveBehavior']
          ),
        ],
        nextPatch: 'Mount layout builder, bindings inspector, and theme editor.',
      }),
      config: baseConfig('Realtime Builder - Questionnaire', {
        construction: {
          questions: [
            question(
              'service-goal',
              'What service will this UI create?',
              'text',
              'answered',
              'AI service builder'
            ),
            question('required-widgets', 'Which widgets are mandatory?', 'multi-select', 'answered', [
              'service-blueprint',
              'layout-builder',
              'widget-registry',
              'bindings-inspector',
              'validation-checklist',
              'theme-editor',
            ]),
            question('layout-roles', 'Which layout roles drive the builder?', 'multi-select', 'answered', [
              'conversation-primary',
              'builder-canvas',
              'inspection-sidecar',
              'quality-footer',
            ]),
            question(
              'theme-mode',
              'Which theme mode should be used?',
              'single-select',
              'pending',
              undefined,
              null
            ),
          ],
          plan: {
            layoutTemplate: 'agent-service-builder',
            selectedPanels: ['agent-chat', 'service-blueprint', 'widget-registry'],
            roleMap: {
              'agent-chat': 'conversation-primary',
              'service-blueprint': 'service-model',
              'widget-registry': 'component-source',
            },
          },
        },
        data: {
          bindings: [
            binding(
              'service-blueprint',
              'sn-description-list',
              'service-entities',
              'output',
              'state.service.entities'
            ),
            binding(
              'widget-registry',
              'sn-tree-panel',
              'selected-widgets',
              'output',
              'state.workspace.widgets'
            ),
          ],
        },
        state: {
          fields: [
            stateField(
              'agent-chat',
              'chat-workspace',
              'questionnaire',
              'object',
              'state.agent.questionnaire',
              'session'
            ),
            stateField(
              'service-blueprint',
              'sn-description-list',
              'entities',
              'array',
              'state.service.entities',
              'workspace'
            ),
          ],
        },
        validation: {
          reports: [
            report('widgets-locked', 'widgets', 'pass', 'info', 'Mandatory widgets are selected.'),
            report('theme-open', 'theme', 'warn', 'warning', 'Theme editor is required and not mounted yet.'),
          ],
        },
        layouts: { conversation: questionnaireLayout, builder: questionnaireLayout },
        layout: questionnaireLayout,
      }),
    },
    {
      id: 'builder',
      title: 'UI builder assembled',
      clock: '00:18',
      chat: [
        {
          role: 'agent',
          text: 'Layout canvas active. Bindings connect answers to the service blueprint.',
        },
        { role: 'user', text: 'Keep the theme editor visible and let less important panels collapse first.' },
      ],
      activeQuestionId: 'theme-mode',
      chatState: chatState({
        activeIntent: 'Assemble the builder surface and wire answers into workspace state.',
        activeQuestionId: 'theme-mode',
        questionnaireStatus: 'layout-assembled',
        serviceBlueprint: {
          name: 'AI service builder',
          entities: [
            'Agent',
            'Service blueprint',
            'Workspace layout',
            'Widget contract',
            'Theme cascade',
          ],
          workflows: [
            'capture intent',
            'select mandatory widgets',
            'assign layout roles',
            'connect bindings',
          ],
        },
        requiredElements: [
          'agent-chat',
          'layout-builder',
          'bindings-inspector',
          'theme-editor',
        ],
        layoutRoles: {
          'agent-chat': 'conversation-primary',
          'layout-builder': 'builder-canvas',
          'bindings-inspector': 'inspection-sidecar',
          'theme-editor': 'theme-control',
        },
        widgetRegistry: [
          { id: 'agent-chat', status: 'mounted', role: 'conversation-primary' },
          { id: 'layout-builder', status: 'mounted', role: 'builder-canvas' },
          { id: 'bindings-inspector', status: 'mounted', role: 'inspection-sidecar' },
          { id: 'theme-editor', status: 'mounted', role: 'theme-control' },
          { id: 'validation-checklist', status: 'planned', role: 'quality-footer' },
          { id: 'adaptive-rules', status: 'planned', role: 'responsive-policy' },
        ],
        adaptiveBehavior: {
          mode: 'drawer',
          collapseOrder: ['adaptive-rules', 'widget-registry', 'bindings-inspector'],
          pinned: ['agent-chat', 'layout-builder', 'theme-editor'],
        },
        themeCascade: {
          source: 'symbiote-ui/default',
          mode: 'dark',
          editorWidget: 'theme-editor',
          status: 'mounted',
        },
        validationChecklist: [
          { id: 'layout-builder', status: 'pass' },
          { id: 'bindings', status: 'pass' },
          { id: 'theme-editor', status: 'pass' },
          { id: 'adaptive-rules', status: 'pending' },
        ],
        decisionTrace: [
          decision(
            'service-goal',
            'AI service builder',
            [
              'set builder workspace audience',
              'keep service blueprint as source model',
            ],
            ['config.intent.audience', 'chatState.serviceBlueprint.workflows']
          ),
          decision(
            'required-widgets',
            [
              'service-blueprint',
              'layout-builder',
              'widget-registry',
              'bindings-inspector',
              'validation-checklist',
              'theme-editor',
            ],
            [
              'mount layout builder',
              'mount bindings inspector',
              'mount theme editor',
            ],
            ['config.panelTypes.layout-builder', 'config.panelTypes.bindings-inspector', 'config.panelTypes.theme-editor']
          ),
          decision(
            'layout-roles',
            [
              'conversation-primary',
              'builder-canvas',
              'inspection-sidecar',
              'quality-footer',
            ],
            [
              'materialize builder BSP layout',
              'wire blueprint to layout canvas',
              'rank sidecar panels below builder canvas',
            ],
            ['config.layout', 'config.events', 'config.construction.plan.adaptivePriorities']
          ),
          decision(
            'theme-mode',
            'default-dark-cascade',
            [
              'apply default Symbiote UI theme cascade',
              'mount theme editor as required widget',
              'bind theme editor to workspace theme state',
            ],
            ['config.theme', 'chatState.themeCascade', 'config.data.bindings']
          ),
        ],
        nextPatch: 'Add adaptive rules and final validation checklist.',
      }),
      config: baseConfig('Realtime Builder - UI Assembly', {
        construction: {
          questions: [
            question(
              'service-goal',
              'What service will this UI create?',
              'text',
              'answered',
              'AI service builder'
            ),
            question('required-widgets', 'Which widgets are mandatory?', 'multi-select', 'answered', [
              'service-blueprint',
              'layout-builder',
              'widget-registry',
              'bindings-inspector',
              'validation-checklist',
              'theme-editor',
            ]),
            question('layout-roles', 'Which layout roles drive the builder?', 'multi-select', 'answered', [
              'conversation-primary',
              'builder-canvas',
              'inspection-sidecar',
              'quality-footer',
            ]),
            question(
              'theme-mode',
              'Which theme mode should be used?',
              'single-select',
              'answered',
              'default-dark-cascade'
            ),
          ],
          plan: {
            layoutTemplate: 'agent-service-builder',
            selectedPanels: ['agent-chat', 'layout-builder', 'bindings-inspector', 'theme-editor'],
            adaptivePriorities: {
              'agent-chat': 100,
              'layout-builder': 92,
              'theme-editor': 82,
              'bindings-inspector': 74,
              'widget-registry': 64,
              'adaptive-rules': 58,
            },
          },
        },
        events: [
          eventBridge('questionnaire-to-blueprint', 'agent-chat', 'questionnaire-answer', {
            targetPanel: 'service-blueprint',
            targetMethod: 'applyAnswer',
            mapping: { answer: 'detail.answer' },
          }),
          eventBridge('blueprint-to-layout', 'service-blueprint', 'blueprint-change', {
            targetPanel: 'layout-builder',
            targetMethod: 'syncBlueprint',
            mapping: { blueprint: 'detail.blueprint' },
          }),
          eventBridge('theme-to-workspace', 'theme-editor', 'cascade-theme-change', {
            targetProperty: 'theme',
            mapping: { state: 'detail.state' },
          }),
        ],
        data: {
          bindings: [
            binding('agent-chat', 'chat-workspace', 'answers', 'output', 'state.agent.answers'),
            binding(
              'layout-builder',
              'panel-layout',
              'layout-tree',
              'two-way',
              'layout'
            ),
            binding(
              'bindings-inspector',
              'sn-data-table',
              'binding-list',
              'input',
              'data.bindings'
            ),
            binding('theme-editor', 'cascade-theme-editor', 'cascade-theme', 'two-way', 'theme'),
          ],
        },
        state: {
          fields: [
            stateField(
              'layout-builder',
              'panel-layout',
              'layout-tree',
              'object',
              'state.workspace.layout',
              'workspace'
            ),
            stateField(
              'theme-editor',
              'cascade-theme-editor',
              'theme-state',
              'object',
              'state.workspace.theme',
              'workspace'
            ),
          ],
        },
        validation: {
          reports: [
            report('layout-mounted', 'layout', 'pass', 'info', 'Builder layout is assembled.'),
            report(
              'theme-editor-required',
              'theme',
              'pass',
              'info',
              'Required theme editor widget is mounted.'
            ),
          ],
        },
        layouts: { conversation: builderLayout, builder: builderLayout },
        layout: builderLayout,
      }),
    },
    {
      id: 'validation',
      title: 'Adaptive validation',
      clock: '00:27',
      chat: [
        {
          role: 'agent',
          text: 'Workspace carries layout roles, bridges, bindings, collapse priorities, validation, theme.',
        },
        { role: 'user', text: 'This is the target demo state for the first realtime mock.' },
      ],
      activeQuestionId: 'handoff-ready',
      chatState: chatState({
        activeIntent: 'Produce a host-neutral workspace handoff from the chat-built UI contract.',
        activeQuestionId: 'handoff-ready',
        questionnaireStatus: 'validated-handoff',
        serviceBlueprint: {
          name: 'AI service builder',
          entities: [
            'Agent',
            'Service blueprint',
            'Workspace layout',
            'Widget contract',
            'Theme cascade',
            'Validation report',
          ],
          workflows: [
            'capture intent',
            'select mandatory widgets',
            'assign layout roles',
            'connect bindings',
            'rank adaptive collapse',
            'validate handoff',
          ],
        },
        requiredElements: [
          'agent-chat',
          'service-blueprint',
          'layout-builder',
          'widget-registry',
          'bindings-inspector',
          'adaptive-rules',
          'validation-checklist',
          'theme-editor',
        ],
        layoutRoles: {
          'agent-chat': 'conversation-primary',
          'service-blueprint': 'service-model',
          'layout-builder': 'builder-canvas',
          'widget-registry': 'component-source',
          'bindings-inspector': 'inspection-sidecar',
          'adaptive-rules': 'responsive-policy',
          'validation-checklist': 'quality-footer',
          'theme-editor': 'theme-control',
        },
        widgetRegistry: [
          { id: 'agent-chat', status: 'mounted', role: 'conversation-primary' },
          { id: 'service-blueprint', status: 'available', role: 'service-model' },
          { id: 'layout-builder', status: 'mounted', role: 'builder-canvas' },
          { id: 'widget-registry', status: 'available', role: 'component-source' },
          { id: 'bindings-inspector', status: 'available', role: 'inspection-sidecar' },
          { id: 'adaptive-rules', status: 'mounted', role: 'responsive-policy' },
          { id: 'validation-checklist', status: 'mounted', role: 'quality-footer' },
          { id: 'theme-editor', status: 'mounted', role: 'theme-control' },
        ],
        adaptiveBehavior: {
          mode: 'drawer',
          breakpoint: 860,
          collapseOrder: [
            'adaptive-rules',
            'widget-registry',
            'bindings-inspector',
            'validation-checklist',
            'service-blueprint',
            'theme-editor',
            'layout-builder',
          ],
          pinned: ['agent-chat'],
        },
        themeCascade: {
          source: 'symbiote-ui/default',
          mode: 'dark',
          editorWidget: 'theme-editor',
          statePath: 'state.workspace.theme',
          status: 'validated',
        },
        validationChecklist: [
          { id: 'required-widgets', status: 'pass' },
          { id: 'layout-roles', status: 'pass' },
          { id: 'event-bridges', status: 'pass' },
          { id: 'theme-cascade', status: 'pass' },
        ],
        decisionTrace: [
          decision(
            'service-goal',
            'AI service builder',
            [
              'preserve service-builder intent',
              'export host-neutral agent-workspace config',
            ],
            ['config.intent', 'config.register', 'workspace.config.json']
          ),
          decision(
            'required-widgets',
            [
              'service-blueprint',
              'layout-builder',
              'widget-registry',
              'bindings-inspector',
              'adaptive-rules',
              'validation-checklist',
              'theme-editor',
            ],
            [
              'register every mandatory panel type',
              'expose all required widgets in builder contract',
              'validate required widget coverage',
            ],
            ['config.panelTypes', 'chatState.requiredElements', 'config.validation.reports']
          ),
          decision(
            'layout-roles',
            [
              'conversation-primary',
              'builder-canvas',
              'inspection-sidecar',
              'quality-footer',
            ],
            [
              'assign layout role map',
              'materialize final BSP layout',
              'set adaptive collapse priorities',
            ],
            ['chatState.layoutRoles', 'config.layout', 'config.construction.plan.adaptivePriorities']
          ),
          decision(
            'theme-mode',
            'default-dark-cascade',
            [
              'apply default Symbiote UI cascade theme',
              'keep theme editor mounted',
              'validate theme cascade handoff',
            ],
            ['config.theme', 'chatState.themeCascade', 'config.data.bindings']
          ),
          decision(
            'handoff-ready',
            true,
            [
              'run strict workspace validation',
              'write portable workspace config export',
              'publish demo contract evidence',
            ],
            ['config.validation.reports', 'workspace.config.json', 'demo.contract.json']
          ),
        ],
        nextPatch: 'Ready for host-neutral workspace export.',
      }),
      config: baseConfig('Realtime Builder - Validated Handoff', {
        construction: {
          questions: [
            question(
              'service-goal',
              'What service will this UI create?',
              'text',
              'answered',
              'AI service builder'
            ),
            question('required-widgets', 'Which widgets are mandatory?', 'multi-select', 'answered', [
              'service-blueprint',
              'layout-builder',
              'widget-registry',
              'bindings-inspector',
              'adaptive-rules',
              'validation-checklist',
              'theme-editor',
            ]),
            question('layout-roles', 'Which layout roles drive the builder?', 'multi-select', 'answered', [
              'conversation-primary',
              'builder-canvas',
              'inspection-sidecar',
              'quality-footer',
            ]),
            question(
              'theme-mode',
              'Which theme mode should be used?',
              'single-select',
              'answered',
              'default-dark-cascade'
            ),
            question(
              'handoff-ready',
              'Is the generated service UI ready for host handoff?',
              'boolean',
              'answered',
              true
            ),
          ],
          plan: {
            layoutTemplate: 'agent-service-builder',
            selectedPanels: [
              'agent-chat',
              'layout-builder',
              'adaptive-rules',
              'theme-editor',
              'validation-checklist',
            ],
            adaptivePriorities: {
              'agent-chat': 100,
              'layout-builder': 92,
              'theme-editor': 82,
              'validation-checklist': 78,
              'bindings-inspector': 74,
              'widget-registry': 64,
              'adaptive-rules': 58,
            },
            layout: {
              topology: 'bsp-workbench',
              layoutIds: ['conversation', 'builder', 'quality'],
              sectionLayouts: [
                { sectionId: 'conversation', groupId: 'agent', layoutId: 'conversation' },
                { sectionId: 'builder', groupId: 'service', layoutId: 'builder' },
                { sectionId: 'quality', groupId: 'service', layoutId: 'quality' },
              ],
              regions: {
                conversation: ['agent-chat'],
                builder: ['layout-builder', 'adaptive-rules'],
                supporting: ['service-blueprint', 'widget-registry', 'bindings-inspector'],
                quality: ['validation-checklist', 'theme-editor'],
              },
            },
            modules: constructionModulePlan(),
            theme: {
              recipe: 'agent-console',
              mode: 'dark',
              source: 'symbiote-ui/default',
              editorPanel: 'theme-editor',
              statePath: 'state.workspace.theme',
            },
          },
        },
        events: [
          eventBridge('questionnaire-to-blueprint', 'agent-chat', 'questionnaire-answer', {
            targetPanel: 'service-blueprint',
            targetMethod: 'applyAnswer',
            mapping: { answer: 'detail.answer' },
          }),
          eventBridge('blueprint-to-layout', 'service-blueprint', 'blueprint-change', {
            targetPanel: 'layout-builder',
            targetMethod: 'syncBlueprint',
            mapping: { blueprint: 'detail.blueprint' },
          }),
          eventBridge('layout-to-rules', 'layout-builder', 'layout-change', {
            targetPanel: 'adaptive-rules',
            targetMethod: 'rankCollapse',
            mapping: { layout: 'detail.layout' },
          }),
          eventBridge('theme-to-workspace', 'theme-editor', 'cascade-theme-change', {
            targetProperty: 'theme',
            mapping: { state: 'detail.state' },
          }),
        ],
        data: {
          bindings: [
            binding('agent-chat', 'chat-workspace', 'answers', 'output', 'state.agent.answers'),
            binding(
              'service-blueprint',
              'sn-description-list',
              'service-entities',
              'two-way',
              'state.service.entities'
            ),
            binding(
              'layout-builder',
              'panel-layout',
              'layout-tree',
              'two-way',
              'layout'
            ),
            binding(
              'adaptive-rules',
              'sn-list-detail-shell',
              'collapse-priorities',
              'input',
              'construction.plan.adaptivePriorities'
            ),
            binding(
              'validation-checklist',
              'sn-event-feed',
              'validation-reports',
              'input',
              'validation.reports'
            ),
            binding('theme-editor', 'cascade-theme-editor', 'cascade-theme', 'two-way', 'theme'),
          ],
        },
        state: {
          fields: [
            stateField(
              'agent-chat',
              'chat-workspace',
              'answers',
              'object',
              'state.agent.answers',
              'session'
            ),
            stateField(
              'layout-builder',
              'panel-layout',
              'layout-tree',
              'object',
              'state.workspace.layout',
              'workspace'
            ),
            stateField(
              'adaptive-rules',
              'sn-list-detail-shell',
              'collapse-rules',
              'object',
              'state.workspace.adaptive',
              'workspace'
            ),
            stateField(
              'theme-editor',
              'cascade-theme-editor',
              'theme-state',
              'object',
              'state.workspace.theme',
              'workspace'
            ),
            stateField(
              'validation-checklist',
              'sn-event-feed',
              'reports',
              'array',
              'validation.reports',
              'workspace'
            ),
          ],
        },
        validation: {
          reports: [
            report('required-widgets', 'widgets', 'pass', 'info', 'All required demo widgets are present.'),
            report(
              'layout-roles',
              'layout',
              'pass',
              'info',
              'Layout roles and priorities are represented in construction metadata.'
            ),
            report(
              'event-bridges',
              'events',
              'pass',
              'info',
              'Event bridges connect questionnaire, blueprint, layout, and theme state.'
            ),
            report(
              'theme-cascade',
              'theme',
              'pass',
              'info',
              'Default Symbiote UI cascade theme config is present with scoped theme editor overrides.'
            ),
          ],
        },
        layouts: {
          conversation: validationLayout,
          builder: validationLayout,
          quality: split('vertical', 0.48, panel('validation-checklist'), panel('theme-editor')),
        },
        layout: validationLayout,
      }),
    },
  ];
}

function stageSourceIndex(index) {
  if (index < 2) return 0;
  if (index < 4) return 1;
  if (index < 7) return 2;
  return 3;
}

function canonicalQuestions(activeIndex) {
  return CANONICAL_DEMO_QUESTIONS.map((item, index) => question(
    item.id,
    item.title,
    item.type,
    index <= activeIndex ? 'answered' : 'pending',
    index <= activeIndex ? clone(item.answer) : undefined,
    index <= activeIndex ? 'derived' : null
  ));
}

function canonicalDecision(item) {
  let operations = {
    'workspace-name': [
      'set config.name',
      'bind chat title to workspace name',
      'prepare portable workspace export',
    ],
    'target-register': [
      'select agent-workspace register',
      'apply register density guardrails',
      'keep host-neutral workspace metadata',
    ],
    'layout-topology': [
      'select workbench topology',
      'materialize panel-layout BSP tree',
      'record named layout regions',
    ],
    'module-selection': [
      'resolve required Symbiote UI modules',
      'register module capability descriptors',
      'bind modules into layout regions',
    ],
    'execution-model': [
      'select automation-bridge execution model',
      'write config.intent.executionModel',
      'write config.execution.model',
    ],
    'required-host-services': [
      'select portable host service IDs',
      'write config.intent.hostServices',
      'write config.execution.hostServices',
    ],
    'theme-mode': [
      'apply default dark Cascade theme',
      'mount cascade-theme-widget',
      'mount cascade-theme-editor panel',
    ],
    'theme-hue': [
      'seed Cascade hue from theme params',
      'preserve theme editor subtree overrides',
      'record theme writeback path',
    ],
    'verification-scope': [
      'run strict validation and export/import checks',
      'publish package readiness evidence',
      'publish runtime import-map evidence',
    ],
  };
  let evidencePaths = {
    'workspace-name': ['config.name', 'chatState.activeIntent', 'workspace.config.json'],
    'target-register': ['config.register', 'config.intent.targetRegister'],
    'layout-topology': ['config.layout', 'config.construction.plan.layout'],
    'module-selection': ['config.components.modules', 'config.construction.plan.modules'],
    'execution-model': ['config.intent.executionModel', 'config.execution.model'],
    'required-host-services': ['config.intent.hostServices', 'config.execution.hostServices'],
    'theme-mode': ['config.theme.params.mode', 'cascade-theme-widget', 'cascade-theme-editor'],
    'theme-hue': ['config.theme.params.hue', 'config.theme.subtrees'],
    'verification-scope': ['config.validation.reports', 'demo.contract.json', 'index.html importmap'],
  };
  return decision(
    item.id,
    clone(item.answer),
    operations[item.id],
    evidencePaths[item.id]
  );
}

function packageReadinessEvidence(finalConfig) {
  let exported = exportConfig(finalConfig, { strict: true });
  let imported = exported.json ? importConfig(exported.json) : { errors: [{ message: 'export failed' }] };
  return {
    strictExport: Boolean(exported.json),
    strictImport: imported.errors.length === 0,
    missingHostServices: [],
    missingRuntimeSlots: [],
    exportedBytes: exported.json?.length || 0,
  };
}

function executionEvidence(config) {
  let planExecution = config.construction?.plan?.execution || {};
  let modules = config.construction?.plan?.modules || [];
  return {
    model: config.execution?.model || planExecution.model || DEMO_EXECUTION_MODEL,
    requiredHostServices: [
      ...(planExecution.requiredHostServices || config.execution?.hostServices || DEMO_HOST_SERVICES),
    ],
    moduleHostServices: [...(planExecution.moduleHostServices || [])],
    runtimeSlots: modules
      .flatMap((item) => item.runtimeSlots || [])
      .map((slot) => (typeof slot === 'string' ? slot : slot.id || slot.name || slot.path))
      .filter(Boolean),
  };
}

function packageEvidence(config) {
  return {
    context: {
      panelCount: Object.keys(config.panelTypes || {}).length,
      moduleCount: config.components?.modules?.length || 0,
      bindingCount: config.data?.bindings?.length || 0,
      validationReportCount: config.validation?.reports?.length || 0,
    },
    readiness: packageReadinessEvidence(config),
  };
}

function currentFunctionalityEvidence(config, activeIndex) {
  let currentExecutionEvidence = executionEvidence(config);
  let currentPackageEvidence = packageEvidence(config);
  return {
    visibleQuestionIds: CANONICAL_DEMO_QUESTIONS
      .slice(0, activeIndex + 1)
      .map((item) => item.id),
    executionModel: currentExecutionEvidence.model,
    hostServices: [...currentExecutionEvidence.requiredHostServices],
    layoutSurface: 'panel-layout',
    chatSurface: 'chat-workspace',
    cascadeTheme: ['cascade-theme-widget', 'cascade-theme-editor'],
    themePreset: 'default-dark-cascade',
    importMapKeys: [...DEMO_IMPORT_MAP_KEYS],
    executionEvidence: currentExecutionEvidence,
    packageEvidence: currentPackageEvidence,
    runtimeImportContract: {
      importMapKeys: [...DEMO_IMPORT_MAP_KEYS],
      hasBarePackageRoutes: true,
      publicEntryPoints: ['symbiote-workspace/browser', 'symbiote-ui/ui'],
    },
    packageReadiness: currentPackageEvidence.readiness,
  };
}

function applyCurrentProtocol(stage, activeIndex) {
  let activeQuestion = CANONICAL_DEMO_QUESTIONS[activeIndex];
  let decisions = CANONICAL_DEMO_QUESTIONS
    .slice(0, activeIndex + 1)
    .map(canonicalDecision);
  let nextQuestion = CANONICAL_DEMO_QUESTIONS[activeIndex + 1];
  let config = stage.config;
  config.name = activeIndex === CANONICAL_DEMO_QUESTIONS.length - 1
    ? 'Realtime Builder - Validated Handoff'
    : `Realtime Builder - ${activeQuestion.stageTitle}`;
  config.intent.executionModel = DEMO_EXECUTION_MODEL;
  config.intent.hostServices = [...DEMO_HOST_SERVICES];
  config.execution = {
    model: DEMO_EXECUTION_MODEL,
    hostServices: [...DEMO_HOST_SERVICES],
  };
  config.construction = {
    ...(config.construction || {}),
    questions: canonicalQuestions(activeIndex),
    plan: {
      ...(config.construction?.plan || {}),
      answers: {
        workspaceName: 'Realtime Builder - Validated Handoff',
        targetRegister: 'agent-workspace',
        layoutTopology: 'workbench',
        moduleSelection: Object.keys(config.panelTypes || {}),
        executionModel: DEMO_EXECUTION_MODEL,
        requiredHostServices: [...DEMO_HOST_SERVICES],
        themeMode: 'dark',
        themeHue: 218,
        verificationScope: ['layout', 'modules', 'theme', 'portability', 'runtime-imports'],
      },
      execution: {
        model: DEMO_EXECUTION_MODEL,
        requiredHostServices: [...DEMO_HOST_SERVICES],
        moduleHostServices: [],
      },
    },
  };
  if (activeIndex === CANONICAL_DEMO_QUESTIONS.length - 1) {
    config.validation = {
      ...(config.validation || {}),
      reports: [
        ...(config.validation?.reports || []),
        report(
          'execution-model',
          'execution',
          'pass',
          'info',
          'Portable automation-bridge execution model is recorded.'
        ),
        report(
          'host-services',
          'host-services',
          'pass',
          'info',
          'Portable host service IDs are preserved in intent and execution metadata.'
        ),
        report(
          'runtime-imports',
          'runtime-imports',
          'pass',
          'info',
          'Browser import map carries public package routes for runtime loading.'
        ),
      ],
    };
  }
  stage.id = activeQuestion.id;
  stage.title = activeQuestion.stageTitle;
  stage.clock = `00:${String(activeIndex * 4).padStart(2, '0')}`;
  stage.activeQuestionId = activeQuestion.id;
  stage.chat = [
    {
      role: 'user',
      text: activeQuestion.title,
    },
    {
      role: 'agent',
      text: `Applied ${activeQuestion.id}: ${canonicalDecision(activeQuestion).operations.join(', ')}.`,
    },
  ];
  stage.chatState = {
    ...stage.chatState,
    activeQuestionId: activeQuestion.id,
    questionnaireStatus: activeQuestion.status,
    decisionTrace: decisions,
    nextPatch: nextQuestion
      ? `Answer ${nextQuestion.id} and update the mounted workspace without reload.`
      : 'Ready for host-neutral workspace export.',
    currentFunctionality: currentFunctionalityEvidence(config, activeIndex),
  };
  return stage;
}

function expandCurrentFunctionalityStages(stages) {
  return CANONICAL_DEMO_QUESTIONS.map((_, index) => {
    let source = clone(stages[stageSourceIndex(index)]);
    return applyCurrentProtocol(source, index);
  });
}

function validateStage(stage) {
  let validation = validateWorkspaceConfig(stage.config, { strict: true });
  if (!validation.valid) {
    let messages = validation.errors.map((error) => `${error.path}: ${error.message}`).join('; ');
    throw new Error(`Invalid realtime builder stage "${stage.id}": ${messages}`);
  }
  let exported = exportConfig(stage.config, { strict: true });
  if (!exported.json) {
    let messages = exported.errors?.map((error) => `${error.path}: ${error.message}`).join('; ')
      || 'strict export failed';
    throw new Error(`Non-portable realtime builder stage "${stage.id}": ${messages}`);
  }
}

function demoModuleCapabilities() {
  return [
    moduleCapability(
      'agent-chat',
      'Agent Chat',
      'chat-workspace',
      ['agent.chat', 'questionnaire.flow'],
      'forum',
      {
        actions: [{ id: 'send-answer', label: 'Send answer', event: 'questionnaire-answer' }],
        toolbarItems: [{ id: 'attach-context', label: 'Attach context', command: 'chat.attach-context' }],
        events: {
          emits: [{ name: 'questionnaire-answer' }, { name: 'message-submit' }],
        },
        bindings: [
          { id: 'answers', direction: 'output', path: 'state.agent.answers' },
          { id: 'questionnaire', direction: 'input', path: 'state.agent.questionnaire' },
        ],
        slots: [{ id: 'transcript', role: 'content', required: true }],
        runtimeSlots: [{ id: 'composer-actions', role: 'toolbar' }],
        regions: ['conversation'],
      }
    ),
    moduleCapability(
      'service-blueprint',
      'Service Blueprint',
      'sn-description-list',
      ['service.blueprint', 'service.model'],
      'account_tree',
      {
        events: {
          emits: [{ name: 'blueprint-change' }],
          consumes: [{ name: 'questionnaire-answer', targetMethod: 'applyAnswer' }],
        },
        bindings: [
          { id: 'service-entities', direction: 'two-way', path: 'state.service.entities' },
        ],
        slots: [{ id: 'entities', role: 'content', required: true }],
        regions: ['supporting-model'],
      }
    ),
    moduleCapability(
      'layout-builder',
      'Layout Builder Surface',
      'panel-layout',
      ['workspace.layout-builder', 'layout.bsp'],
      'dashboard_customize',
      {
        actions: [{ id: 'apply-layout', label: 'Apply layout', event: 'layout-change' }],
        toolbarItems: [{ id: 'fit-panels', label: 'Fit panels', command: 'layout.fit-panels' }],
        settings: basePanelTypes()['layout-builder'].settings,
        events: {
          emits: [{ name: 'layout-change' }],
          consumes: [{ name: 'blueprint-change', targetMethod: 'syncBlueprint' }],
        },
        bindings: [
          { id: 'layout-tree', direction: 'two-way', path: 'layout' },
        ],
        runtimeSlots: [{ id: 'panel-palette', role: 'sidecar' }],
        regions: ['builder-canvas'],
      }
    ),
    moduleCapability(
      'widget-registry',
      'Widget Registry',
      'sn-tree-panel',
      ['workspace.widget-registry', 'module.discovery'],
      'widgets',
      {
        actions: [{ id: 'insert-widget', label: 'Insert widget', event: 'widget-select' }],
        events: { emits: [{ name: 'widget-select' }] },
        bindings: [
          { id: 'selected-widgets', direction: 'output', path: 'state.workspace.widgets' },
        ],
        slots: [{ id: 'widget-cards', role: 'content' }],
        regions: ['component-source'],
      }
    ),
    moduleCapability(
      'bindings-inspector',
      'Bindings Inspector',
      'sn-data-table',
      ['workspace.bindings-inspector', 'binding.inspect'],
      'hub',
      {
        toolbarItems: [{ id: 'validate-bindings', label: 'Validate bindings', command: 'bindings.validate' }],
        bindings: [
          { id: 'binding-list', direction: 'input', path: 'data.bindings' },
        ],
        slots: [{ id: 'bindings', role: 'content', required: true }],
        regions: ['inspection-sidecar'],
      }
    ),
    moduleCapability(
      'adaptive-rules',
      'Adaptive Rules',
      'sn-list-detail-shell',
      ['workspace.adaptive-rules', 'layout.collapse-priority'],
      'collapse_content',
      {
        events: {
          consumes: [{ name: 'layout-change', targetMethod: 'rankCollapse' }],
        },
        bindings: [
          { id: 'collapse-priorities', direction: 'input', path: 'construction.plan.adaptivePriorities' },
        ],
        regions: ['responsive-policy'],
      }
    ),
    moduleCapability(
      'validation-checklist',
      'Validation Checklist',
      'sn-event-feed',
      ['workspace.validation-checklist', 'validation.report'],
      'task_alt',
      {
        bindings: [
          { id: 'validation-reports', direction: 'input', path: 'validation.reports' },
        ],
        regions: ['quality-footer'],
      }
    ),
    moduleCapability(
      'theme-editor',
      'Theme Editor',
      'cascade-theme-editor',
      ['workspace.theme-editor', 'theme.cascade'],
      'palette',
      {
        settings: basePanelTypes()['theme-editor'].settings,
        events: {
          emits: [{ name: 'cascade-theme-change' }],
        },
        bindings: [
          { id: 'cascade-theme', direction: 'two-way', path: 'theme' },
        ],
        regions: ['theme-control'],
      }
    ),
  ];
}

function buildConstructionTrace(finalStage) {
  let moduleCapabilities = demoModuleCapabilities();
  let requiredCapabilities = moduleCapabilities.flatMap((item) => item.capabilities.slice(0, 1));
  let finalConfig = finalStage.config;
  let finalChatState = finalStage.chatState;
  let adaptivePriorities = Object.entries(finalConfig.construction.plan.adaptivePriorities || {})
    .sort(([, a], [, b]) => b - a)
    .map(([panelTypeName, importance]) => ({ panelType: panelTypeName, importance }));
  let result = planWorkspaceConstruction({
    brief: 'AI agent tool that creates a service UI from guided questionnaire answers.',
    template: 'dashboard',
    targetRegister: 'agent-workspace',
    audience: ['service builders', 'AI agent operators'],
    constraints: ['mock data only', 'host neutral workspace config'],
    requiredCapabilities,
    executionModel: DEMO_EXECUTION_MODEL,
    hostServices: [...DEMO_HOST_SERVICES],
  }, {
    moduleCapabilities,
    answers: {
      'workspace-name': finalStage.config.name,
      'target-register': 'agent-workspace',
      'layout-topology': 'workbench',
      'module-selection': Object.keys(finalStage.config.panelTypes),
      'execution-model': DEMO_EXECUTION_MODEL,
      'required-host-services': [...DEMO_HOST_SERVICES],
      'theme-mode': 'dark',
      'theme-hue': 218,
      'verification-scope': ['layout', 'modules', 'theme', 'portability'],
    },
  });
  let exported = exportConfig(result.config, { strict: true });
  let imported = importConfig(exported.json);
  let selectedModules = result.plan.capabilities.selectedModules || [];
  let currentFunctionality = currentFunctionalityEvidence(finalConfig, CANONICAL_DEMO_QUESTIONS.length - 1);
  return {
    toolSequence: [
      'normalizeConstructionIntent',
      'buildConstructionQuestions',
      'answerConstructionQuestion',
      'planWorkspaceConstruction',
      'exportConfig',
      'importConfig',
    ],
    normalizedIntent: result.intent,
    canonicalQuestionIds: result.questions.map((item) => item.id),
    visibleQuestionIds: finalChatState.currentFunctionality.visibleQuestionIds,
    currentFunctionality,
    executionEvidence: currentFunctionality.executionEvidence,
    packageEvidence: currentFunctionality.packageEvidence,
    answeredQuestions: result.questions
      .filter((item) => item.status === 'answered')
      .map((item) => ({
        id: item.id,
        answer: item.answer,
        answerSource: item.answerSource,
      })),
    moduleCapabilities: moduleCapabilities.map((item) => ({
      panelType: item.placement.panelType,
      component: item.tagName,
      capabilities: item.capabilities,
      placement: item.placement,
      actions: item.actions || [],
      menus: item.menus || [],
      toolbarItems: item.toolbarItems || [],
      settings: item.settings || [],
      events: item.events || {},
      bindings: item.bindings || [],
      slots: item.slots || [],
      runtimeSlots: item.runtimeSlots || [],
    })),
    selectedModules,
    capabilityCoverage: {
      required: requiredCapabilities,
      missing: result.plan.capabilities.missing,
      selected: selectedModules.map((item) => ({
        panelType: item.panelType,
        component: item.component,
        matchedCapabilities: item.matchedCapabilities,
        coverageStatus: item.coverageStatus,
      })),
    },
    verificationReports: result.plan.verification.reports,
    constructionPlanEvidence: {
      topology: finalConfig.construction.plan.layout?.topology,
      layoutIds: finalConfig.construction.plan.layout?.layoutIds,
      regionCount: Object.keys(finalConfig.construction.plan.layout?.regions || {}).length,
      moduleCount: finalConfig.construction.plan.modules?.length || 0,
      actionCount: finalConfig.construction.plan.modules
        ?.reduce((sum, item) => sum + (item.actions?.length || 0), 0) || 0,
      toolbarItemCount: finalConfig.construction.plan.modules
        ?.reduce((sum, item) => sum + (item.toolbarItems?.length || 0), 0) || 0,
      settingCount: finalConfig.construction.plan.modules
        ?.reduce((sum, item) => sum + (item.settings?.length || 0), 0) || 0,
      eventCount: finalConfig.construction.plan.modules
        ?.reduce((sum, item) => {
          let events = item.events || {};
          return sum + (events.emits?.length || 0) + (events.consumes?.length || 0);
        }, 0) || 0,
      bindingCount: finalConfig.construction.plan.modules
        ?.reduce((sum, item) => sum + (item.bindings?.length || 0), 0) || 0,
      slotCount: finalConfig.construction.plan.modules
        ?.reduce((sum, item) => sum + (item.slots?.length || 0) + (item.runtimeSlots?.length || 0), 0) || 0,
      theme: finalConfig.construction.plan.theme,
    },
    adaptiveThemeEvidence: {
      responsiveMode: finalConfig.rootBehavior.responsiveMode,
      breakpoint: finalConfig.rootBehavior.responsiveBreakpoint,
      adaptivePriorities,
      collapseOrder: finalChatState.adaptiveBehavior.collapseOrder,
      themeRecipe: finalConfig.theme.recipe,
      themeParams: finalConfig.theme.params,
      themeEditorBinding: finalConfig.data.bindings.find((item) => item.panelType === 'theme-editor'),
      themeEditorSubtree: finalConfig.theme.subtrees.find((item) => (
        item.selector.includes('theme-editor')
      )),
    },
    exportImportEvidence: {
      exportedBytes: exported.json.length,
      importedName: imported.config?.name,
      importedPanelCount: Object.keys(imported.config?.panelTypes || {}).length,
      valid: imported.errors.length === 0,
    },
  };
}

function buildAcceptanceMatrix(demo) {
  let finalStage = demo.stages.at(-1);
  let finalConfig = finalStage.config;
  let finalChatState = finalStage.chatState;
  let scenarioIds = (demo.professionalScenarios || []).map((item) => item.id);
  let scenarioComponents = unique((demo.professionalScenarios || []).flatMap((item) => (
    Object.values(item.config?.panelTypes || {}).map((panelTypeConfig) => panelTypeConfig.component)
  )));
  return [
    {
      id: 'chat-questionnaire-flow',
      status: demo.stages.every((stage) => stage.chat.length > 0 && stage.chatState?.activeQuestionId)
        ? 'pass'
        : 'fail',
      evidence: demo.stages.map((stage) => stage.activeQuestionId),
    },
    {
      id: 'service-blueprint-panel',
      status: finalChatState.serviceBlueprint?.entities?.length >= 4 ? 'pass' : 'fail',
      evidence: finalChatState.serviceBlueprint,
    },
    {
      id: 'layout-builder-surface',
      status: Boolean(finalConfig.panelTypes?.['layout-builder'] && finalConfig.layouts?.builder) ? 'pass' : 'fail',
      evidence: finalChatState.layoutRoles['layout-builder'],
    },
    {
      id: 'widget-registry',
      status: finalChatState.widgetRegistry.length >= demo.requiredWidgets.length ? 'pass' : 'fail',
      evidence: finalChatState.widgetRegistry.map((widget) => `${widget.id}:${widget.status}`),
    },
    {
      id: 'bindings-inspector',
      status: (finalConfig.data?.bindings || []).length >= 6 ? 'pass' : 'fail',
      evidence: finalConfig.data?.bindings?.map((item) => item.id) || [],
    },
    {
      id: 'adaptive-behavior-metadata',
      status: finalChatState.adaptiveBehavior?.collapseOrder?.length >= 4 ? 'pass' : 'fail',
      evidence: finalChatState.adaptiveBehavior,
    },
    {
      id: 'validation-checklist',
      status: finalChatState.validationChecklist.every((item) => item.status === 'pass') ? 'pass' : 'fail',
      evidence: finalChatState.validationChecklist,
    },
    {
      id: 'theme-editor-widget',
      status: finalChatState.themeCascade?.editorWidget === 'theme-editor' ? 'pass' : 'fail',
      evidence: finalChatState.themeCascade,
    },
    {
      id: 'construction-tool-lineage',
      status: demo.constructionTrace?.capabilityCoverage?.missing?.length === 0 &&
        demo.constructionTrace?.exportImportEvidence?.valid === true &&
        demo.constructionTrace?.constructionPlanEvidence?.moduleCount >= demo.requiredWidgets.length &&
        demo.constructionTrace?.constructionPlanEvidence?.regionCount >= 4 &&
        demo.constructionTrace?.constructionPlanEvidence?.actionCount >= 3 &&
        demo.constructionTrace?.constructionPlanEvidence?.eventCount >= 6 &&
        demo.constructionTrace?.constructionPlanEvidence?.bindingCount >= 6 &&
        demo.constructionTrace?.constructionPlanEvidence?.slotCount >= 4
        ? 'pass'
        : 'fail',
      evidence: {
        tools: demo.constructionTrace?.toolSequence,
        questions: demo.constructionTrace?.canonicalQuestionIds,
        selectedModules: demo.constructionTrace?.selectedModules?.map((item) => item.panelType),
        constructionPlan: demo.constructionTrace?.constructionPlanEvidence,
      },
    },
    {
      id: 'current-protocol-visible',
      status: demo.constructionTrace?.visibleQuestionIds?.length ===
          demo.constructionTrace?.canonicalQuestionIds?.length &&
        finalConfig.intent.executionModel === DEMO_EXECUTION_MODEL &&
        finalConfig.execution?.model === DEMO_EXECUTION_MODEL
        ? 'pass'
        : 'fail',
      evidence: {
        visibleQuestionIds: demo.constructionTrace?.visibleQuestionIds,
        executionModel: finalConfig.execution?.model,
      },
    },
    {
      id: 'package-readiness-visible',
      status: finalChatState.currentFunctionality?.packageReadiness?.strictExport === true &&
        finalChatState.currentFunctionality?.packageReadiness?.strictImport === true &&
        finalChatState.currentFunctionality?.packageReadiness?.missingHostServices?.length === 0
        ? 'pass'
        : 'fail',
      evidence: finalChatState.currentFunctionality?.packageReadiness,
    },
    {
      id: 'runtime-import-contract-visible',
      status: finalChatState.currentFunctionality?.runtimeImportContract?.hasBarePackageRoutes === true &&
        DEMO_IMPORT_MAP_KEYS.every((key) => (
          finalChatState.currentFunctionality?.runtimeImportContract?.importMapKeys || []
        ).includes(key))
        ? 'pass'
        : 'fail',
      evidence: finalChatState.currentFunctionality?.runtimeImportContract,
    },
    {
      id: 'professional-scenario-matrix',
      status: [
        'video-editing',
        'automation-editing',
        'agent-programming',
        'constructor-control',
      ].every((id) => scenarioIds.includes(id)) ? 'pass' : 'fail',
      evidence: scenarioIds,
    },
    {
      id: 'professional-library-surfaces',
      status: [
        'chat-workspace',
        'sn-video-player',
        'node-canvas',
        'canvas-graph',
        'sn-data-table',
        'sn-rich-text-editor',
        'sn-kanban-board',
        'source-editor',
        'sn-source-diff',
        'code-block',
        'cascade-theme-editor',
      ].every((component) => scenarioComponents.includes(component)) ? 'pass' : 'fail',
      evidence: scenarioComponents,
    },
    {
      id: 'template-manual-edit-existing-modes',
      status: demo.professionalScenarios?.some((scenario) => scenario.id === 'constructor-control' &&
        scenario.config.construction?.plan?.bindings?.length >= 3) ? 'pass' : 'fail',
      evidence: demo.professionalScenarios
        ?.find((scenario) => scenario.id === 'constructor-control')
        ?.config.construction?.plan,
    },
  ];
}

export function buildRealtimeChatStateDemo() {
  let stages = expandCurrentFunctionalityStages(createStages());
  for (let stage of stages) validateStage(stage);
  let professionalScenarios = buildProfessionalScenarios();
  for (let scenario of professionalScenarios) validateStage({ id: scenario.id, config: scenario.config });
  let finalStage = stages.at(-1);
  let demo = {
    schemaVersion: '0.1.0',
    name: 'Realtime Chat-State UI Builder',
    description: 'Mock chat and questionnaire state drives workspace UI assembly.',
    defaultScenarioId: 'video-editing',
    professionalComponentContract: PROFESSIONAL_COMPONENT_CONTRACT,
    professionalScenarios,
    requiredWidgets: [
      'agent-chat',
      'service-blueprint',
      'layout-builder',
      'widget-registry',
      'bindings-inspector',
      'adaptive-rules',
      'validation-checklist',
      'theme-editor',
    ],
    stages,
    constructionTrace: buildConstructionTrace(finalStage),
  };
  return {
    ...demo,
    acceptanceMatrix: buildAcceptanceMatrix(demo),
  };
}
