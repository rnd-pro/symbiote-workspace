import { MODULE_CAPABILITY_DESCRIPTOR_SCHEMA } from './module-capability.js';
import {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_REGISTER_VALUES,
  EXECUTION_MODELS,
  HOST_SERVICE_CATEGORIES,
  COLLAPSE_POLICIES,
  OVERFLOW_POLICIES,
  RESPONSIVE_MODES,
  MOBILE_DOCKS,
  SWIPE_CONTROLS,
  DATA_BINDING_DIRECTIONS,
  PANEL_SETTING_TYPES,
  STATE_FIELD_TYPES,
  STATE_FIELD_PERSISTENCE,
  ENGINE_BINDING_SURFACES,
  ENGINE_NODE_CACHE_MODES,
  VALIDATION_REPORT_STATUSES,
  VALIDATION_REPORT_SEVERITIES,
} from './value-classes.js';

export {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_REGISTER_VALUES,
  EXECUTION_MODELS,
  HOST_SERVICE_CATEGORIES,
  COLLAPSE_POLICIES,
  OVERFLOW_POLICIES,
  RESPONSIVE_MODES,
  MOBILE_DOCKS,
  SWIPE_CONTROLS,
  DATA_BINDING_DIRECTIONS,
  PANEL_SETTING_TYPES,
  STATE_FIELD_TYPES,
  STATE_FIELD_PERSISTENCE,
  ENGINE_BINDING_SURFACES,
  ENGINE_NODE_CACHE_MODES,
  VALIDATION_REPORT_STATUSES,
  VALIDATION_REPORT_SEVERITIES,
};

/** LayoutBehavior sub-schema (matches LayoutTree.js LayoutBehavior typedef) */
const LAYOUT_BEHAVIOR_SCHEMA = Object.freeze({
  type: 'object',
  description: 'Panel responsive behavior. All fields optional; missing values inherit from parent or default.',
  properties: {
    importance: {
      type: 'number',
      minimum: 0,
      maximum: 100,
      default: 50,
      description: 'Higher values resist auto-collapse. 0 = collapses first, 100 = collapses last.',
    },
    minInlineSize: {
      type: 'number',
      minimum: 0,
      default: 220,
      description: 'Minimum inline (horizontal) size in px before auto-collapse triggers.',
    },
    minBlockSize: {
      type: 'number',
      minimum: 0,
      default: 160,
      description: 'Minimum block (vertical) size in px before auto-collapse triggers.',
    },
    collapse: {
      type: 'string',
      enum: COLLAPSE_POLICIES,
      default: 'auto',
      description: 'Auto-collapse policy for this panel.',
    },
    overflow: {
      type: 'string',
      enum: OVERFLOW_POLICIES,
      default: 'collapse',
      description: 'Overflow fallback when collapse is disabled.',
    },
    responsiveMode: {
      type: 'string',
      enum: RESPONSIVE_MODES,
      default: 'preserve',
      description: 'Root responsive behavior below breakpoint.',
    },
    responsiveBreakpoint: {
      type: 'number',
      minimum: 0,
      default: 720,
      description: 'Inline size (px) where responsiveMode activates.',
    },
    mobileDock: {
      type: 'string',
      enum: MOBILE_DOCKS,
      default: 'auto',
      description: 'Mobile drawer dock placement preference.',
    },
    swipeControl: {
      type: 'string',
      enum: SWIPE_CONTROLS,
      default: 'edge',
      description: 'Mobile swipe handle placement.',
    },
  },
});

/** Menu action descriptor for panel header dropdown */
const MENU_ACTION_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id', 'label'],
  properties: {
    id: { type: 'string', description: 'Unique action ID within the panel type.' },
    label: { type: 'string', description: 'Displayed label.' },
    icon: { type: 'string', description: 'Material Symbols icon name.' },
    group: { type: 'string', description: 'Grouping key for action submenu.' },
    groupLabel: { type: 'string', description: 'Label for the action group.' },
    active: { type: 'boolean', default: false, description: 'Whether the action is currently active/checked.' },
    command: { type: 'string', description: 'Portable command identifier handled by the host or module.' },
    event: { type: 'string', description: 'DOM event emitted when the action is invoked.' },
    method: { type: 'string', description: 'Component method to call when invoked.' },
    binding: { type: 'string', description: 'Data binding identifier affected by the action.' },
  },
});

/** Panel setting schema */
const PANEL_SETTING_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id', 'label', 'type'],
  properties: {
    id: { type: 'string', description: 'Portable setting identifier.' },
    label: { type: 'string', description: 'Displayed setting label.' },
    type: {
      type: 'string',
      enum: PANEL_SETTING_TYPES,
      description: 'Portable setting value type.',
    },
    default: { description: 'Default setting value.' },
    options: { type: 'array', items: { type: 'object' }, description: 'Enum option records.' },
    binding: { type: 'string', description: 'Data binding identifier updated by this setting.' },
  },
});

/** Panel slot schema */
const PANEL_SLOT_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', description: 'Portable panel slot identifier.' },
    role: { type: 'string', description: 'Slot role in the panel component.' },
    accepts: { type: 'array', items: { type: 'string' }, description: 'Accepted component tag names or capability IDs.' },
    required: { type: 'boolean', description: 'Whether the host should treat this slot as required.' },
  },
});

/** Panel type registration schema */
const PANEL_TYPE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['title', 'component'],
  properties: {
    title: { type: 'string', description: 'Default panel title.' },
    icon: { type: 'string', description: 'Material Symbols icon name.' },
    component: { type: 'string', description: 'Custom element tag name to mount in panel.' },
    behavior: LAYOUT_BEHAVIOR_SCHEMA,
    menuActions: {
      type: 'array',
      items: MENU_ACTION_SCHEMA,
      description: 'Panel header dropdown menu actions.',
    },
    settings: {
      type: 'array',
      items: PANEL_SETTING_SCHEMA,
      description: 'Panel setting declarations exposed to host shells.',
    },
    slots: {
      type: 'array',
      items: PANEL_SLOT_SCHEMA,
      description: 'Portable child-slot declarations exposed to host shells.',
    },
  },
});

/** Project group (tab) schema */
const GROUP_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: { type: 'string', description: 'Unique group identifier.' },
    name: { type: 'string', description: 'Display name on the tab.' },
    icon: { type: 'string', description: 'Material Symbols icon name.' },
    color: { type: 'string', description: 'CSS color value or --sn-* token reference.' },
    closeable: { type: 'boolean', default: false, description: 'Whether the tab can be closed.' },
    sidebarLabel: { type: 'string', description: 'Optional override label for sidebar.' },
    sidebarIcon: { type: 'string', description: 'Optional override icon for sidebar.' },
  },
});

/** Sidebar section schema */
const SECTION_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id', 'label'],
  properties: {
    id: { type: 'string', description: 'Unique section identifier.' },
    label: { type: 'string', description: 'Section label in sidebar.' },
    icon: { type: 'string', description: 'Material Symbols icon name.' },
    order: { type: 'number', default: 100, description: 'Sort order (lower = higher).' },
    groupId: { type: 'string', description: 'Parent group ID this section belongs to.' },
    layoutId: { type: 'string', description: 'Reference to a named layout in layouts{} map.' },
  },
});

/** Event bridge schema */
const EVENT_BRIDGE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['sourcePanel', 'event'],
  properties: {
    id: { type: 'string', description: 'Unique bridge identifier.' },
    sourcePanel: { type: 'string', description: 'Source panelType emitting the event.' },
    targetPanel: { type: 'string', description: 'Target panelType receiving the event.' },
    event: { type: 'string', description: 'DOM event name to listen for.' },
    targetMethod: { type: 'string', description: 'Method to call on target component.' },
    targetProperty: { type: 'string', description: 'Property to set on target component.' },
    mapping: { type: 'object', description: 'e.detail field → target param mapping.' },
  },
});

const DATA_BINDING_SCHEMA = Object.freeze({
  type: 'object',
  required: ['panelType', 'component', 'id', 'direction'],
  properties: {
    panelType: { type: 'string', description: 'Panel type that owns the binding.' },
    component: { type: 'string', description: 'Custom element tag name that declares the binding.' },
    id: { type: 'string', description: 'Portable binding identifier from the module descriptor.' },
    direction: { type: 'string', enum: DATA_BINDING_DIRECTIONS },
    path: { type: 'string', description: 'Portable config or state path for the binding.' },
    schema: { type: 'object', description: 'Optional value schema for the binding payload.' },
  },
});

const STATE_FIELD_SCHEMA = Object.freeze({
  type: 'object',
  required: ['panelType', 'component', 'id', 'type'],
  properties: {
    panelType: { type: 'string', description: 'Panel type that owns the state field.' },
    component: { type: 'string', description: 'Custom element tag name that declares the state field.' },
    id: { type: 'string', description: 'Portable state field identifier from the module descriptor.' },
    type: {
      type: 'string',
      enum: STATE_FIELD_TYPES,
    },
    default: { description: 'Portable JSON-serializable default state value.' },
    path: { type: 'string', description: 'Portable workspace state path.' },
    schema: { type: 'object', description: 'Optional value schema for the state field.' },
    persistence: { type: 'string', enum: STATE_FIELD_PERSISTENCE },
  },
});

const STATE_CONFIG_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    fields: {
      type: 'array',
      description: 'Portable module state field declarations selected for host/runtime handoff.',
      items: STATE_FIELD_SCHEMA,
    },
  },
});

const ENGINE_GRAPH_NODE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id', 'type'],
  properties: {
    id: { type: 'string', description: 'Portable node identifier inside the engine graph.' },
    type: { type: 'string', description: 'Portable symbiote-engine node type identifier.' },
    name: { type: 'string', description: 'Optional display name.' },
    params: { type: 'object', description: 'Serializable node parameter defaults.' },
    cacheMode: { type: 'string', enum: ENGINE_NODE_CACHE_MODES },
  },
});

const ENGINE_GRAPH_CONNECTION_SCHEMA = Object.freeze({
  type: 'object',
  required: ['from', 'out', 'to', 'in'],
  properties: {
    from: { type: 'string', description: 'Source node identifier.' },
    out: { type: 'string', description: 'Source output socket.' },
    to: { type: 'string', description: 'Target node identifier.' },
    in: { type: 'string', description: 'Target input socket.' },
    type: { type: 'string', description: 'Optional connection type.' },
    label: { type: 'string', description: 'Optional connection label.' },
  },
});

const ENGINE_GRAPH_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', description: 'Portable engine graph identifier.' },
    name: { type: 'string', description: 'Optional graph label.' },
    execution: { type: 'object', description: 'Serializable engine execution metadata.' },
    nodes: { type: 'array', items: ENGINE_GRAPH_NODE_SCHEMA },
    connections: { type: 'array', items: ENGINE_GRAPH_CONNECTION_SCHEMA },
    ui: { type: 'object', description: 'Serializable graph UI metadata.' },
  },
});

const ENGINE_BINDING_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id', 'panelType', 'surface', 'sourceId', 'graphId', 'nodeId'],
  properties: {
    id: { type: 'string', description: 'Portable workspace engine binding identifier.' },
    panelType: { type: 'string', description: 'Panel type that owns the source surface.' },
    component: { type: 'string', description: 'Custom element tag name that declares the source surface.' },
    surface: { type: 'string', enum: ENGINE_BINDING_SURFACES },
    sourceId: { type: 'string', description: 'Source action, setting, state field, event, or data binding identifier.' },
    graphId: { type: 'string', description: 'Target engine graph identifier.' },
    nodeId: { type: 'string', description: 'Target engine node identifier.' },
    input: { type: 'string', description: 'Optional target input socket.' },
    output: { type: 'string', description: 'Optional target output socket.' },
    param: { type: 'string', description: 'Optional target parameter.' },
    pack: { type: 'string', description: 'Optional required engine pack identifier.' },
  },
});

const ENGINE_CONFIG_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    packs: {
      type: 'array',
      description: 'Portable symbiote-engine pack identifiers required by this workspace.',
      items: { type: 'string' },
    },
    graphs: {
      type: 'array',
      description: 'Portable symbiote-engine graph JSON records.',
      items: ENGINE_GRAPH_SCHEMA,
    },
    bindings: {
      type: 'array',
      description: 'Portable bindings from workspace module surfaces to engine graph nodes.',
      items: ENGINE_BINDING_SCHEMA,
    },
  },
});

const INTENT_SCHEMA = Object.freeze({
  type: 'object',
  required: ['brief'],
  properties: {
    brief: { type: 'string', description: 'User or agent workspace brief.' },
    template: { type: 'string', description: 'Matched workspace template.' },
    targetRegister: { type: 'string', enum: WORKSPACE_REGISTER_VALUES },
    audience: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },
    requiredCapabilities: { type: 'array', items: { type: 'string' } },
    executionModel: { type: 'string', enum: EXECUTION_MODELS },
    hostServices: { type: 'array', items: { type: 'string' } },
    preferredTheme: { type: 'object' },
  },
});

const CONSTRUCTION_QUESTION_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id', 'title', 'type', 'status'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    group: { type: 'string' },
    type: { type: 'string', enum: ['text', 'single-select', 'multi-select', 'number', 'boolean'] },
    prompt: { type: 'string' },
    options: { type: 'array', items: { type: 'object' } },
    default: {},
    answer: {},
    answerSource: { type: 'string', enum: ['default', 'user', 'derived'] },
    status: { type: 'string', enum: ['answered', 'pending', 'skipped'] },
    skippedReason: { type: 'string' },
    dependsOn: { type: 'array', items: { type: 'object' } },
    required: { type: 'boolean' },
  },
});

const CONSTRUCTION_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: CONSTRUCTION_QUESTION_SCHEMA,
      description: 'Structured questionnaire used to construct this workspace.',
    },
    plan: {
      type: 'object',
      description: 'Normalized construction plan generated from intent and answers.',
    },
  },
});

const PATCH_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    id: { type: 'string' },
    surface: { type: 'string' },
    status: { type: 'string' },
    overlay: { type: 'object' },
    operations: { type: 'array', items: { type: 'object' } },
    report: { type: 'object' },
  },
});

const VALIDATION_REPORT_SCHEMA = Object.freeze({
  type: 'object',
  required: ['id', 'check', 'status', 'severity', 'message'],
  properties: {
    id: { type: 'string' },
    check: { type: 'string' },
    version: { type: 'string' },
    status: { type: 'string', enum: VALIDATION_REPORT_STATUSES },
    severity: { type: 'string', enum: VALIDATION_REPORT_SEVERITIES },
    message: { type: 'string' },
    diagnostics: { type: 'array', items: { type: 'object' } },
    suggestedPatches: { type: 'array', items: { type: 'object' } },
  },
});

/**
 * Layout node schema — BSP tree format matching LayoutTree.js.
 *
 * Two node types:
 * - panel: leaf node with panelType reference
 * - split: binary split with first/second children and ratio
 */
const LAYOUT_NODE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['type'],
  properties: {
    type: {
      type: 'string',
      enum: ['panel', 'split'],
      description: 'Node type: panel (leaf) or split (branch).',
    },
    // Panel-specific
    panelType: {
      type: 'string',
      description: 'Panel type reference (for type=panel).',
    },
    panelState: {
      type: 'object',
      description: 'Initial panel state (for type=panel).',
    },
    // Split-specific
    direction: {
      type: 'string',
      enum: ['horizontal', 'vertical'],
      description: 'Split direction (for type=split).',
    },
    ratio: {
      type: 'number',
      minimum: 0.05,
      maximum: 0.95,
      default: 0.5,
      description: 'Split ratio — size of first child (for type=split).',
    },
    first: {
      $ref: '#/$defs/layoutNode',
      description: 'First child node (for type=split).',
    },
    second: {
      $ref: '#/$defs/layoutNode',
      description: 'Second child node (for type=split).',
    },
    // Shared
    behavior: LAYOUT_BEHAVIOR_SCHEMA,
  },
});

export const WORKSPACE_CONFIG_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Symbiote Workspace Config',
  description: 'Portable workspace configuration for agent-driven UI assembly.',
  type: 'object',
  required: ['version', 'name'],
  $defs: {
    layoutNode: LAYOUT_NODE_SCHEMA,
    layoutBehavior: LAYOUT_BEHAVIOR_SCHEMA,
    menuAction: MENU_ACTION_SCHEMA,
    panelType: PANEL_TYPE_SCHEMA,
    group: GROUP_SCHEMA,
    section: SECTION_SCHEMA,
    eventBridge: EVENT_BRIDGE_SCHEMA,
    intent: INTENT_SCHEMA,
    constructionQuestion: CONSTRUCTION_QUESTION_SCHEMA,
    construction: CONSTRUCTION_SCHEMA,
    patch: PATCH_SCHEMA,
    validationReport: VALIDATION_REPORT_SCHEMA,
    moduleCapability: MODULE_CAPABILITY_DESCRIPTOR_SCHEMA,
  },
  properties: {
    version: {
      type: 'string',
      description: 'Schema version of the workspace config.',
    },
    name: {
      type: 'string',
      description: 'Human-readable workspace name.',
    },
    register: {
      type: 'string',
      enum: WORKSPACE_REGISTER_VALUES,
      default: 'tool',
      description: 'UX register for density and design-policy rules.',
    },
    intent: {
      ...INTENT_SCHEMA,
      description: 'Normalized agent/user construction intent.',
    },
    construction: {
      ...CONSTRUCTION_SCHEMA,
      description: 'Questionnaire and normalized plan state for agent construction.',
    },
    patches: {
      type: 'array',
      items: PATCH_SCHEMA,
      description: 'Proposed or applied construction patches.',
    },
    validation: {
      type: 'object',
      properties: {
        reports: {
          type: 'array',
          items: VALIDATION_REPORT_SCHEMA,
        },
      },
      description: 'Machine-readable validation reports produced during construction.',
    },
    runtime: {
      type: 'object',
      properties: {
        mount: { type: 'object' },
      },
      description: 'Runtime mounting metadata that remains portable across hosts.',
    },
    execution: {
      type: 'object',
      properties: {
        model: { type: 'string', enum: EXECUTION_MODELS },
        hostServices: {
          type: 'array',
          items: { type: 'string' },
          description: 'Portable host service IDs required by the constructed workspace.',
        },
      },
      description: 'Portable execution model metadata selected during construction.',
    },
    exports: {
      type: 'object',
      description: 'Portable export metadata and package descriptors.',
    },
    design: {
      type: 'object',
      description: 'Design policy context consumed by symbiote-ui rules.',
    },
    theme: {
      type: 'object',
      description: 'Cascade theme parameters and optional token overrides.',
      properties: {
        params: {
          type: 'object',
          description: 'Parameters for createCascadeTheme(): mode, hue, chroma, brightness, contrast, etc.',
        },
        relations: {
          type: 'object',
          description: 'Relative cascade formula modifiers applied by compatible theme adapters.',
        },
        overrides: {
          type: 'object',
          description: 'Token overrides applied on top of generated cascade: { "--sn-token-name": "value" }.',
        },
        subtrees: {
          type: 'array',
          description: 'Per-subtree theme scoping: [{ selector, params, relations, overrides }].',
          items: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
              params: { type: 'object' },
              relations: { type: 'object' },
              overrides: { type: 'object' },
            },
            required: ['selector'],
          },
        },
      },
    },
    groups: {
      type: 'array',
      items: GROUP_SCHEMA,
      description: 'Project groups (tabs). Each group can have its own sections.',
    },
    sections: {
      type: 'array',
      items: SECTION_SCHEMA,
      description: 'Sidebar sections. Each section references a groupId and a layout.',
    },
    panelTypes: {
      type: 'object',
      additionalProperties: PANEL_TYPE_SCHEMA,
      description: 'Panel type definitions. Keys are panel type names, values are panel configs.',
    },
    layouts: {
      type: 'object',
      additionalProperties: LAYOUT_NODE_SCHEMA,
      description: 'Named layout trees. Sections reference layouts by key.',
    },
    layout: {
      $ref: '#/$defs/layoutNode',
      description: 'Default/root layout tree (for simple single-layout workspaces).',
    },
    rootBehavior: LAYOUT_BEHAVIOR_SCHEMA,
    events: {
      type: 'array',
      items: EVENT_BRIDGE_SCHEMA,
      description: 'Inter-panel event bridges for synchronizing components.',
    },
    components: {
      type: 'object',
      properties: {
        catalog: {
          type: 'array',
          items: { type: 'string' },
          description: 'Component tag names from symbiote-ui catalog.',
        },
        custom: {
          type: 'array',
          description: 'Agent-created components: [{ tagName, code, template, styles }].',
          items: {
            type: 'object',
            properties: {
              tagName: { type: 'string' },
              code: { type: 'string' },
              template: { type: 'string' },
              styles: { type: 'string' },
            },
            required: ['tagName'],
          },
        },
        modules: {
          type: 'array',
          description: 'Module capability descriptors for catalog or custom components.',
          items: MODULE_CAPABILITY_DESCRIPTOR_SCHEMA,
        },
      },
    },
    data: {
      type: 'object',
      description: 'Data sources and portable data binding declarations.',
      properties: {
        bindings: {
          type: 'array',
          description: 'Portable module binding declarations selected for host/runtime handoff.',
          items: DATA_BINDING_SCHEMA,
        },
      },
    },
    state: {
      ...STATE_CONFIG_SCHEMA,
      description: 'Portable module state field declarations and defaults.',
    },
    engine: {
      ...ENGINE_CONFIG_SCHEMA,
      description: 'Optional portable symbiote-engine packs, graphs, and workspace bindings.',
    },
  },
  additionalProperties: false,
});

/**
 * @typedef {Object} WorkspaceThemeConfig
 * @property {Object} [params] - Cascade theme parameters
 * @property {Object} [relations] - Relative theme formula modifiers
 * @property {Object} [overrides] - Token overrides
 * @property {Array} [subtrees] - Per-subtree scoping
 */

/**
 * @typedef {Object} WorkspaceLayoutNode
 * @property {'panel' | 'split'} type - Node type
 * @property {string} [panelType] - Panel type name (for type=panel)
 * @property {Object} [panelState] - Panel state (for type=panel)
 * @property {'horizontal' | 'vertical'} [direction] - Split direction (for type=split)
 * @property {number} [ratio] - Split ratio 0-1 (for type=split)
 * @property {WorkspaceLayoutNode} [first] - First child (for type=split)
 * @property {WorkspaceLayoutNode} [second] - Second child (for type=split)
 * @property {import('./workspace-schema.js').LayoutBehavior} [behavior] - Responsive behavior
 */

/**
 * @typedef {Object} LayoutBehavior
 * @property {number} [importance]
 * @property {number} [minInlineSize]
 * @property {number} [minBlockSize]
 * @property {'auto' | 'manual' | 'never'} [collapse]
 * @property {'collapse' | 'scroll-inline' | 'scroll-block' | 'scroll'} [overflow]
 * @property {'preserve' | 'stack' | 'scroll-inline' | 'drawer' | 'swipe'} [responsiveMode]
 * @property {number} [responsiveBreakpoint]
 * @property {'auto' | 'primary' | 'start' | 'end'} [mobileDock]
 * @property {'edge' | 'island' | 'none'} [swipeControl]
 */

/**
 * @typedef {Object} MenuAction
 * @property {string} id
 * @property {string} label
 * @property {string} [icon]
 * @property {string} [group]
 * @property {string} [groupLabel]
 * @property {boolean} [active]
 * @property {string} [command]
 * @property {string} [event]
 * @property {string} [method]
 * @property {string} [binding]
 */

/**
 * @typedef {Object} PanelTypeConfig
 * @property {string} title
 * @property {string} [icon]
 * @property {string} component
 * @property {LayoutBehavior} [behavior]
 * @property {MenuAction[]} [menuActions]
 */

/**
 * @typedef {Object} ModuleCapabilityDescriptor
 * @property {string} tagName
 * @property {string} [schemaVersion]
 * @property {string} [provider]
 * @property {Object} [descriptor]
 * @property {string[]} [capabilities]
 * @property {Object[]} [actions]
 * @property {Object[]} [menus]
 * @property {Object[]} [toolbarItems]
 * @property {Object[]} [settings]
 * @property {Object} [events]
 * @property {Object[]} [bindings]
 * @property {Object[]} [slots]
 * @property {Object[]} [runtimeSlots]
 * @property {string[]} [requiredHostServices]
 * @property {Object} [placement]
 */

/**
 * @typedef {Object} GroupConfig
 * @property {string} id
 * @property {string} name
 * @property {string} [icon]
 * @property {string} [color]
 * @property {boolean} [closeable]
 * @property {string} [sidebarLabel]
 * @property {string} [sidebarIcon]
 */

/**
 * @typedef {Object} SectionConfig
 * @property {string} id
 * @property {string} label
 * @property {string} [icon]
 * @property {number} [order]
 * @property {string} [groupId]
 * @property {string} [layoutId]
 */

/**
 * @typedef {Object} EventBridge
 * @property {string} [id]
 * @property {string} sourcePanel
 * @property {string} [targetPanel]
 * @property {string} event
 * @property {string} [targetMethod]
 * @property {string} [targetProperty]
 * @property {Object} [mapping]
 */

/**
 * @typedef {Object} DataBinding
 * @property {string} panelType
 * @property {string} component
 * @property {string} id
 * @property {'input'|'output'|'two-way'} direction
 * @property {string} [path]
 * @property {Object} [schema]
 */

/**
 * @typedef {Object} StateField
 * @property {string} panelType
 * @property {string} component
 * @property {string} id
 * @property {'string'|'number'|'boolean'|'enum'|'object'|'array'|'color'|'token'|'json'} type
 * @property {*} [default]
 * @property {string} [path]
 * @property {Object} [schema]
 * @property {'session'|'workspace'|'ephemeral'} [persistence]
 */

/**
 * @typedef {Object} WorkspaceConfig
 * @property {string} version - Schema version
 * @property {string} name - Workspace name
 * @property {string} [register] - UX register
 * @property {Object} [intent] - Construction intent
 * @property {Object} [construction] - Construction questionnaire and plan
 * @property {Object[]} [patches] - Proposed or applied construction patches
 * @property {Object} [validation] - Validation reports
 * @property {Object} [runtime] - Runtime mount metadata
 * @property {Object} [execution] - Portable execution model and host-service metadata
 * @property {Object} [exports] - Portable export metadata
 * @property {Object} [design] - Design policy context
 * @property {WorkspaceThemeConfig} [theme] - Theme config
 * @property {GroupConfig[]} [groups] - Project groups (tabs)
 * @property {SectionConfig[]} [sections] - Sidebar sections
 * @property {Object<string, PanelTypeConfig>} [panelTypes] - Panel type definitions
 * @property {Object<string, WorkspaceLayoutNode>} [layouts] - Named layout trees
 * @property {WorkspaceLayoutNode} [layout] - Default layout tree
 * @property {LayoutBehavior} [rootBehavior] - Root layout behavior
 * @property {EventBridge[]} [events] - Inter-panel event bridges
 * @property {Object} [components] - Component references
 * @property {{ bindings?: DataBinding[] }} [data] - Data bindings
 * @property {{ fields?: StateField[] }} [state] - Portable state field declarations
 * @property {Object} [engine] - Engine config
 */
