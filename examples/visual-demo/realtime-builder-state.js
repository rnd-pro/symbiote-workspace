import { validateWorkspaceConfig } from '../../schema/index.js';
import { planWorkspaceConstruction } from '../../constructor/index.js';
import { exportConfig, importConfig } from '../../sharing/index.js';

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
      requiredCapabilities: unique(moduleDescriptors.flatMap((descriptor) => (
        descriptor.capabilities.slice(0, 1)
      ))),
    },
    theme: {
      recipe: 'agent-console',
      params: { mode: 'dark', hue: 218, chroma: 30, brightness: 0, contrast: 58 },
      relations: { surfaceStep: 1.08, radiusScale: 0.82 },
      overrides: { '--sn-workspace-gap': '12px' },
      subtrees: [
        {
          selector: 'sn-theme-editor-widget',
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

function demoModuleCapabilities() {
  return [
    moduleCapability(
      'agent-chat',
      'Agent Chat',
      'sn-agent-chat-panel',
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
      'sn-service-blueprint-panel',
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
      'sn-layout-builder-surface',
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
      'sn-widget-registry-panel',
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
      'sn-bindings-inspector-panel',
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
      'sn-adaptive-rules-panel',
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
      'sn-validation-checklist-panel',
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
      'sn-theme-editor-widget',
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
    executionModel: 'automation-bridge',
  }, {
    moduleCapabilities,
    answers: {
      'workspace-name': finalStage.config.name,
      'target-register': 'agent-workspace',
      'layout-topology': 'workbench',
      'module-selection': Object.keys(finalStage.config.panelTypes),
      'execution-model': 'automation-bridge',
      'theme-mode': 'dark',
      'verification-scope': ['layout', 'modules', 'theme', 'portability'],
    },
  });
  let exported = exportConfig(result.config, { strict: true });
  let imported = importConfig(exported.json);
  let selectedModules = result.plan.capabilities.selectedModules || [];
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
  ];
}

export function buildRealtimeChatStateDemo() {
  let stages = createStages();
  for (let stage of stages) validateStage(stage);
  let finalStage = stages.at(-1);
  let demo = {
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
    constructionTrace: buildConstructionTrace(finalStage),
  };
  return {
    ...demo,
    acceptanceMatrix: buildAcceptanceMatrix(demo),
  };
}
