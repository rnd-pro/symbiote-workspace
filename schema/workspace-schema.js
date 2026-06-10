export const WORKSPACE_SCHEMA_VERSION = '0.1.0';

export const WORKSPACE_REGISTER_VALUES = Object.freeze(['tool', 'brand', 'presentation']);

export const WORKSPACE_CONFIG_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Symbiote Workspace Config',
  description: 'Portable workspace configuration for agent-driven UI assembly.',
  type: 'object',
  required: ['version', 'name'],
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
        overrides: {
          type: 'object',
          description: 'Token overrides applied on top of generated cascade: { "--sn-token-name": "value" }.',
        },
        subtrees: {
          type: 'array',
          description: 'Per-subtree theme scoping: [{ selector, params, overrides }].',
          items: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
              params: { type: 'object' },
              overrides: { type: 'object' },
            },
            required: ['selector'],
          },
        },
      },
    },
    layout: {
      type: 'object',
      description: 'Panel tree describing workspace structure: splits, tabs, sidebars.',
      properties: {
        type: {
          type: 'string',
          enum: ['split', 'tabs', 'sidebar', 'stack', 'single'],
          description: 'Layout node type.',
        },
        direction: {
          type: 'string',
          enum: ['horizontal', 'vertical'],
        },
        ratio: {
          type: 'array',
          items: { type: 'number' },
          description: 'Split ratios for children.',
        },
        children: {
          type: 'array',
          items: { $ref: '#/properties/layout' },
        },
        component: {
          type: 'string',
          description: 'Component tag name for leaf nodes.',
        },
        props: {
          type: 'object',
          description: 'Component props for leaf nodes.',
        },
        label: {
          type: 'string',
          description: 'Tab or panel label.',
        },
      },
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
 * @property {Object} [overrides] - Token overrides
 * @property {Array} [subtrees] - Per-subtree scoping
 */

/**
 * @typedef {Object} WorkspaceLayoutNode
 * @property {string} [type] - Layout node type
 * @property {string} [direction] - Split direction
 * @property {number[]} [ratio] - Split ratios
 * @property {WorkspaceLayoutNode[]} [children] - Child nodes
 * @property {string} [component] - Component tag for leaf
 * @property {Object} [props] - Component props for leaf
 * @property {string} [label] - Tab/panel label
 */

/**
 * @typedef {Object} WorkspaceConfig
 * @property {string} version - Schema version
 * @property {string} name - Workspace name
 * @property {string} [register] - UX register
 * @property {WorkspaceThemeConfig} [theme] - Theme config
 * @property {WorkspaceLayoutNode} [layout] - Layout tree
 * @property {Object} [components] - Component references
 * @property {Object} [data] - Data bindings
 * @property {Object} [engine] - Engine config
 */
