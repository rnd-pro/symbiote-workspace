export const WORKSPACE_SCHEMA_VERSION = '0.2.0';

export const WORKSPACE_REGISTER_VALUES = Object.freeze(['tool', 'brand', 'presentation']);

/**
 * Collapse policy for panels.
 * - 'auto': system collapses/restores based on available space
 * - 'manual': user toggles, no auto-collapse
 * - 'never': panel cannot be collapsed
 */
export const COLLAPSE_POLICIES = Object.freeze(['auto', 'manual', 'never']);

/**
 * Overflow policy when collapse is disabled.
 * - 'collapse': fall back to auto-collapse (default)
 * - 'scroll-inline': horizontal scroll
 * - 'scroll-block': vertical scroll
 * - 'scroll': both axes
 */
export const OVERFLOW_POLICIES = Object.freeze(['collapse', 'scroll-inline', 'scroll-block', 'scroll']);

/**
 * Responsive mode for root layout.
 * - 'preserve': keep BSP layout at all sizes
 * - 'stack': stack panels vertically below breakpoint
 * - 'scroll-inline': horizontal scroll below breakpoint
 * - 'drawer': mobile drawer navigation
 * - 'swipe': swipe between panels
 */
export const RESPONSIVE_MODES = Object.freeze(['preserve', 'stack', 'scroll-inline', 'drawer', 'swipe']);

/**
 * Mobile drawer dock preference.
 */
export const MOBILE_DOCKS = Object.freeze(['auto', 'primary', 'start', 'end']);

/**
 * Mobile swipe handle placement.
 */
export const SWIPE_CONTROLS = Object.freeze(['edge', 'island', 'none']);

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
      description: 'UX register: tool (dense professional), brand (marketing), presentation (slides/demo).',
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
      },
    },
    data: {
      type: 'object',
      description: 'Data sources, bindings, and initial state.',
    },
    engine: {
      type: 'object',
      description: 'Optional symbiote-engine graph and handler configs.',
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
 * @typedef {Object} WorkspaceConfig
 * @property {string} version - Schema version
 * @property {string} name - Workspace name
 * @property {string} [register] - UX register
 * @property {WorkspaceThemeConfig} [theme] - Theme config
 * @property {GroupConfig[]} [groups] - Project groups (tabs)
 * @property {SectionConfig[]} [sections] - Sidebar sections
 * @property {Object<string, PanelTypeConfig>} [panelTypes] - Panel type definitions
 * @property {Object<string, WorkspaceLayoutNode>} [layouts] - Named layout trees
 * @property {WorkspaceLayoutNode} [layout] - Default layout tree
 * @property {LayoutBehavior} [rootBehavior] - Root layout behavior
 * @property {EventBridge[]} [events] - Inter-panel event bridges
 * @property {Object} [components] - Component references
 * @property {Object} [data] - Data bindings
 * @property {Object} [engine] - Engine config
 */
