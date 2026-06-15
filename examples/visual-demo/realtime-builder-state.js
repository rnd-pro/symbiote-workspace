import { validateWorkspaceConfig } from '../../schema/index.js';
import { exportConfig } from '../../sharing/index.js';

function panelType(title, component, icon, options = {}) {
  return {
    title,
    icon,
    component,
    ...(options.behavior ? { behavior: options.behavior } : {}),
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.slots ? { slots: options.slots } : {}),
    ...(options.menuActions ? { menuActions: options.menuActions } : {}),
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

function basePanelTypes() {
  return {
    'agent-chat': panelType('Agent Chat', 'sn-agent-chat-panel', 'forum', {
      behavior: { importance: 100, minInlineSize: 320, collapse: 'never' },
      slots: [{ id: 'transcript', role: 'content', required: true }],
    }),
    'service-blueprint': panelType('Service Blueprint', 'sn-service-blueprint-panel', 'account_tree', {
      behavior: { importance: 90, minInlineSize: 360, collapse: 'auto' },
      slots: [{ id: 'entities', role: 'content', required: true }],
    }),
    'layout-builder': panelType(
      'Layout Builder Surface',
      'sn-layout-builder-surface',
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
    'widget-registry': panelType('Widget Registry', 'sn-widget-registry-panel', 'widgets', {
      behavior: { importance: 64, minInlineSize: 280, collapse: 'auto' },
      slots: [{ id: 'widget-cards', role: 'content' }],
    }),
    'bindings-inspector': panelType('Bindings Inspector', 'sn-bindings-inspector-panel', 'hub', {
      behavior: { importance: 72, minInlineSize: 300, collapse: 'auto' },
      slots: [{ id: 'bindings', role: 'content', required: true }],
    }),
    'adaptive-rules': panelType('Adaptive Rules', 'sn-adaptive-rules-panel', 'collapse_content', {
      behavior: { importance: 58, minInlineSize: 280, collapse: 'auto' },
    }),
    'validation-checklist': panelType('Validation Checklist', 'sn-validation-checklist-panel', 'task_alt', {
      behavior: { importance: 76, minInlineSize: 280, collapse: 'auto' },
    }),
    'theme-editor': panelType('Theme Editor', 'sn-theme-editor-widget', 'palette', {
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
  return {
    version: '0.3.0',
    name,
    register: 'agent-workspace',
    intent: {
      brief: 'AI agent tool that creates a service UI from a guided questionnaire.',
      targetRegister: 'agent-workspace',
      audience: ['service builders', 'AI agent operators'],
      constraints: ['mock data only', 'host neutral workspace config', 'default Symbiote UI theme cascade'],
      requiredCapabilities: [
        'chat-questionnaire',
        'service-blueprint',
        'dynamic-layout-builder',
        'widget-registry',
        'theme-editor',
        'validation-state',
      ],
    },
    theme: {
      recipe: 'agent-console',
      params: { mode: 'light', hue: 218, chroma: 44, brightness: 96, contrast: 66 },
      relations: { surfaceStep: 1.08, radiusScale: 0.82 },
      overrides: { '--sn-workspace-gap': '12px' },
      subtrees: [
        {
          selector: '.symbiote-workspace__panel[data-panel-type="theme-editor"]',
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
    0.24,
    panel('agent-chat', { importance: 100, collapse: 'never' }),
    split(
      'horizontal',
      0.5,
      split(
        'vertical',
        0.54,
        panel('layout-builder', { importance: 92 }),
        panel('adaptive-rules', { importance: 58 })
      ),
      split(
        'vertical',
        0.46,
        panel('theme-editor', { importance: 82, collapse: 'manual' }),
        panel('validation-checklist', { importance: 78 })
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
              'sn-service-blueprint-panel',
              'service-entities',
              'output',
              'state.service.entities'
            ),
            binding(
              'widget-registry',
              'sn-widget-registry-panel',
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
              'sn-agent-chat-panel',
              'questionnaire',
              'object',
              'state.agent.questionnaire',
              'session'
            ),
            stateField(
              'service-blueprint',
              'sn-service-blueprint-panel',
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
              'default-light'
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
            binding('agent-chat', 'sn-agent-chat-panel', 'answers', 'output', 'state.agent.answers'),
            binding(
              'layout-builder',
              'sn-layout-builder-surface',
              'layout-tree',
              'two-way',
              'layout'
            ),
            binding(
              'bindings-inspector',
              'sn-bindings-inspector-panel',
              'binding-list',
              'input',
              'data.bindings'
            ),
            binding('theme-editor', 'sn-theme-editor-widget', 'cascade-theme', 'two-way', 'theme'),
          ],
        },
        state: {
          fields: [
            stateField(
              'layout-builder',
              'sn-layout-builder-surface',
              'layout-tree',
              'object',
              'state.workspace.layout',
              'workspace'
            ),
            stateField(
              'theme-editor',
              'sn-theme-editor-widget',
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
              'default-light'
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
            binding('agent-chat', 'sn-agent-chat-panel', 'answers', 'output', 'state.agent.answers'),
            binding(
              'service-blueprint',
              'sn-service-blueprint-panel',
              'service-entities',
              'two-way',
              'state.service.entities'
            ),
            binding(
              'layout-builder',
              'sn-layout-builder-surface',
              'layout-tree',
              'two-way',
              'layout'
            ),
            binding(
              'adaptive-rules',
              'sn-adaptive-rules-panel',
              'collapse-priorities',
              'input',
              'construction.plan.adaptivePriorities'
            ),
            binding(
              'validation-checklist',
              'sn-validation-checklist-panel',
              'validation-reports',
              'input',
              'validation.reports'
            ),
            binding('theme-editor', 'sn-theme-editor-widget', 'cascade-theme', 'two-way', 'theme'),
          ],
        },
        state: {
          fields: [
            stateField(
              'agent-chat',
              'sn-agent-chat-panel',
              'answers',
              'object',
              'state.agent.answers',
              'session'
            ),
            stateField(
              'layout-builder',
              'sn-layout-builder-surface',
              'layout-tree',
              'object',
              'state.workspace.layout',
              'workspace'
            ),
            stateField(
              'adaptive-rules',
              'sn-adaptive-rules-panel',
              'collapse-rules',
              'object',
              'state.workspace.adaptive',
              'workspace'
            ),
            stateField(
              'theme-editor',
              'sn-theme-editor-widget',
              'theme-state',
              'object',
              'state.workspace.theme',
              'workspace'
            ),
            stateField(
              'validation-checklist',
              'sn-validation-checklist-panel',
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

export function buildRealtimeChatStateDemo() {
  let stages = createStages();
  for (let stage of stages) validateStage(stage);
  return {
    schemaVersion: '0.1.0',
    name: 'Realtime Chat-State UI Builder',
    description: 'Mock chat and questionnaire state drives workspace UI assembly.',
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
  };
}
