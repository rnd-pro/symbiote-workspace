/**
 * Unified dispatch for symbiote-workspace.
 *
 * Single source of truth for all tool definitions and dispatch logic.
 * Both MCP and CLI call dispatch() with the same tool names and args.
 *
 * @module symbiote-workspace/runtime/dispatch
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WORKSPACE_REGISTER_VALUES } from '../schema/workspace-schema.js';

/**
 * @typedef {Object} ToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {Object} inputSchema
 * @property {boolean} [mutates] - Whether this tool modifies config
 * @property {boolean} [writesFiles] - Whether this tool writes outside session state
 */

function toJsonString(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function parseJsonInput(value) {
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function compactObject(value) {
  let result = {};
  for (let [key, child] of Object.entries(value)) {
    if (child !== undefined) result[key] = child;
  }
  return result;
}

const WORKSPACE_CONSTRUCTION_HANDOFF_TYPE = 'workspace-construction-handoff';
const WORKSPACE_PATCH_INPUT_ANY_OF = Object.freeze([
  { required: ['overlay'] },
  { required: ['patch'] },
]);

const CONSTRUCTION_HANDOFF_SCHEMA_PROPERTIES = {
  _type: {
    type: 'string',
    enum: [WORKSPACE_CONSTRUCTION_HANDOFF_TYPE],
    description: 'Construction handoff sentinel returned by create_workspace_construction_handoff.',
  },
  valid: { type: 'boolean', description: 'Whether the source construction context is structurally valid.' },
  ready: { type: 'boolean', description: 'Whether the handoff can be constructed without readiness gaps.' },
  requirements: { type: 'object', description: 'Package or package-collection capability requirements.' },
  missing: { type: 'object', description: 'Missing package capabilities grouped by kind.' },
  source: { type: 'object', description: 'Primary package source metadata.' },
  sources: { type: 'array', items: { type: 'object' }, description: 'Package source metadata list.' },
  summary: { type: 'object', description: 'Package construction context summary.' },
  compatibility: { type: 'object', description: 'Package compatibility diagnostics.' },
  warnings: { type: 'array', items: { type: 'object' }, description: 'Non-blocking handoff diagnostics.' },
  errors: { type: 'array', items: { type: 'object' }, description: 'Blocking handoff diagnostics.' },
};

function packageContextFromHandoff(args) {
  if (!isConstructionHandoffArgs(args)) return undefined;
  let context = isObject(args.options?.packageContext)
    ? cloneJson(args.options.packageContext)
    : {};
  for (let field of [
    'valid',
    'ready',
    'requirements',
    'missing',
    'source',
    'sources',
    'summary',
    'compatibility',
    'warnings',
    'errors',
    'readiness',
  ]) {
    if (args[field] !== undefined) context[field] = cloneJson(args[field]);
  }
  return compactObject(context);
}

/** @type {ToolDefinition[]} */
export const TOOLS = [
  // ── Discovery ──
  {
    name: 'describe_workspace',
    description: 'Describe the current workspace configuration. Returns groups, sections, layouts, panelTypes, menuActions, behaviors, and events.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'discover_components',
    description: 'Scan symbiote-ui library to discover available components.',
    inputSchema: {
      type: 'object',
      properties: {
        uiPath: { type: 'string', description: 'Absolute path to symbiote-ui root directory.' },
      },
      required: ['uiPath'],
    },
  },
  {
    name: 'find_component',
    description: 'Find a specific component by tag name in symbiote-ui.',
    inputSchema: {
      type: 'object',
      properties: {
        uiPath: { type: 'string', description: 'Path to symbiote-ui root.' },
        tagName: { type: 'string', description: 'Custom element tag name to find.' },
      },
      required: ['uiPath', 'tagName'],
    },
  },
  {
    name: 'list_component_tags',
    description: 'List all available component tag names from symbiote-ui.',
    inputSchema: {
      type: 'object',
      properties: {
        uiPath: { type: 'string', description: 'Path to symbiote-ui root.' },
      },
      required: ['uiPath'],
    },
  },
  {
    name: 'list_categories',
    description: 'List component categories with counts from symbiote-ui.',
    inputSchema: {
      type: 'object',
      properties: {
        uiPath: { type: 'string', description: 'Path to symbiote-ui root.' },
      },
      required: ['uiPath'],
    },
  },
  {
    name: 'list_used_components',
    description: 'List components used in the current workspace config.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Scaffold ──
  {
    name: 'list_templates',
    description: 'List available workspace templates.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceTemplates: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  {
    name: 'scaffold_workspace',
    description: 'Create a workspace from a template or intent text.',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Template name or intent text.' },
        name: { type: 'string', description: 'Workspace name override.' },
        register: { type: 'string', enum: WORKSPACE_REGISTER_VALUES },
      },
    },
    mutates: true,
  },
  {
    name: 'scaffold_from_scratch',
    description: 'Create a blank workspace config from scratch.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workspace name.' },
        register: { type: 'string', enum: WORKSPACE_REGISTER_VALUES },
      },
    },
    mutates: true,
  },
  {
    name: 'classify_workspace',
    description: 'Classify workspace intent and return the normalized intent, questionnaire, and next planning action.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { type: 'string', description: 'Workspace brief or intent text.' },
        workspaceTemplates: { type: 'array', items: { type: 'object' } },
      },
      required: ['intent'],
    },
  },
  {
    name: 'build_construction_questions',
    description: 'Build deterministic construction questions for an intent without planning or mutating the session.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { description: 'Workspace brief string or construction intent object.' },
        template: { type: 'string', description: 'Explicit template override.' },
        register: { type: 'string', enum: WORKSPACE_REGISTER_VALUES },
        targetRegister: { type: 'string', enum: WORKSPACE_REGISTER_VALUES },
        audience: { type: 'array', items: { type: 'string' } },
        constraints: { type: 'array', items: { type: 'string' } },
        requiredCapabilities: { type: 'array', items: { type: 'string' } },
        preferredTheme: { type: 'object' },
        options: { type: 'object', description: 'Constructor options for question generation.' },
        moduleCapabilities: { type: 'array', items: { type: 'object' } },
        workspaceTemplates: { type: 'array', items: { type: 'object' } },
      },
      required: ['intent'],
    },
  },
  {
    name: 'answer_construction_question',
    description: 'Apply one construction answer and return the re-evaluated questionnaire without mutating the session.',
    inputSchema: {
      type: 'object',
      properties: {
        questions: { type: 'array', items: { type: 'object' } },
        questionId: { type: 'string', description: 'Construction question ID to answer.' },
        answer: { description: 'Answer value for the selected question.' },
      },
      required: ['questions', 'questionId', 'answer'],
    },
  },
  {
    name: 'plan_workspace',
    description: 'Generate construction diagnostics, questions, plan, readiness summary, and config without mutating the session.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { description: 'Workspace brief string or construction intent object.' },
        template: { type: 'string', description: 'Explicit template override.' },
        name: { type: 'string', description: 'Workspace name override.' },
        register: { type: 'string', enum: WORKSPACE_REGISTER_VALUES },
        targetRegister: { type: 'string', enum: WORKSPACE_REGISTER_VALUES },
        audience: { type: 'array', items: { type: 'string' } },
        constraints: { type: 'array', items: { type: 'string' } },
        requiredCapabilities: { type: 'array', items: { type: 'string' } },
        preferredTheme: { type: 'object' },
        options: { type: 'object', description: 'Constructor options, such as handoff.options.' },
        ...CONSTRUCTION_HANDOFF_SCHEMA_PROPERTIES,
        moduleCapabilities: { type: 'array', items: { type: 'object' } },
        workspaceTemplates: { type: 'array', items: { type: 'object' } },
        answers: { type: 'object', description: 'Question answers keyed by question ID.' },
      },
      required: ['intent'],
    },
  },
  {
    name: 'construct_workspace',
    description: 'Generate a construction plan and store the executable config; rejects missing required capabilities and not-ready construction handoffs with structured readiness diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { description: 'Workspace brief string or construction intent object.' },
        template: { type: 'string', description: 'Explicit template override.' },
        name: { type: 'string', description: 'Workspace name override.' },
        register: { type: 'string', enum: WORKSPACE_REGISTER_VALUES },
        targetRegister: { type: 'string', enum: WORKSPACE_REGISTER_VALUES },
        audience: { type: 'array', items: { type: 'string' } },
        constraints: { type: 'array', items: { type: 'string' } },
        requiredCapabilities: { type: 'array', items: { type: 'string' } },
        preferredTheme: { type: 'object' },
        options: { type: 'object', description: 'Constructor options, such as handoff.options.' },
        ...CONSTRUCTION_HANDOFF_SCHEMA_PROPERTIES,
        moduleCapabilities: { type: 'array', items: { type: 'object' } },
        workspaceTemplates: { type: 'array', items: { type: 'object' } },
        answers: { type: 'object', description: 'Question answers keyed by question ID.' },
      },
      required: ['intent'],
    },
    mutates: true,
  },
  {
    name: 'propose_workspace_patch',
    description: 'Preview a workspace overlay or construction patch without mutating the active session.',
    inputSchema: {
      type: 'object',
      properties: {
        overlay: { type: 'object', description: 'Partial config overlay.' },
        patch: { type: 'object', description: 'Structured construction patch.' },
      },
      anyOf: WORKSPACE_PATCH_INPUT_ANY_OF,
    },
  },
  {
    name: 'validate_workspace_patch',
    description: 'Validate a workspace overlay or construction patch before applying it.',
    inputSchema: {
      type: 'object',
      properties: {
        overlay: { type: 'object', description: 'Partial config overlay.' },
        patch: { type: 'object', description: 'Structured construction patch.' },
      },
      anyOf: WORKSPACE_PATCH_INPUT_ANY_OF,
    },
  },
  {
    name: 'apply_workspace_patch',
    description: 'Validate and apply a workspace overlay or construction patch to the active session.',
    inputSchema: {
      type: 'object',
      properties: {
        overlay: { type: 'object', description: 'Partial config overlay.' },
        patch: { type: 'object', description: 'Structured construction patch.' },
      },
      anyOf: WORKSPACE_PATCH_INPUT_ANY_OF,
    },
    mutates: true,
  },
  {
    name: 'export_workspace',
    description: 'Export the active workspace through the construction workflow alias.',
    inputSchema: {
      type: 'object',
      properties: { strict: { type: 'boolean', description: 'Reject on validation warnings.' } },
    },
  },

  // ── Groups ──
  {
    name: 'add_group',
    description: 'Add a project group (tab) to the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' }, name: { type: 'string' },
        icon: { type: 'string' }, color: { type: 'string' },
      },
      required: ['id', 'name'],
    },
    mutates: true,
  },
  {
    name: 'remove_group',
    description: 'Remove a project group and its sections.',
    inputSchema: {
      type: 'object',
      properties: { groupId: { type: 'string' } },
      required: ['groupId'],
    },
    mutates: true,
  },
  {
    name: 'update_group',
    description: 'Update group properties.',
    inputSchema: {
      type: 'object',
      properties: { groupId: { type: 'string' }, updates: { type: 'object' } },
      required: ['groupId', 'updates'],
    },
    mutates: true,
  },
  {
    name: 'reorder_groups',
    description: 'Reorder groups by providing ordered IDs.',
    inputSchema: {
      type: 'object',
      properties: { orderedIds: { type: 'array', items: { type: 'string' } } },
      required: ['orderedIds'],
    },
    mutates: true,
  },
  {
    name: 'list_groups',
    description: 'List all project groups.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Sections ──
  {
    name: 'add_section',
    description: 'Add a sidebar section to a group.',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: { type: 'string' }, id: { type: 'string' },
        label: { type: 'string' }, icon: { type: 'string' },
        order: { type: 'number' }, layoutId: { type: 'string' },
      },
      required: ['groupId', 'id', 'label'],
    },
    mutates: true,
  },
  {
    name: 'remove_section',
    description: 'Remove a sidebar section.',
    inputSchema: {
      type: 'object',
      properties: { sectionId: { type: 'string' } },
      required: ['sectionId'],
    },
    mutates: true,
  },
  {
    name: 'update_section',
    description: 'Update section properties.',
    inputSchema: {
      type: 'object',
      properties: { sectionId: { type: 'string' }, updates: { type: 'object' } },
      required: ['sectionId', 'updates'],
    },
    mutates: true,
  },
  {
    name: 'reorder_sections',
    description: 'Reorder sections within a group.',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: { type: 'string' },
        orderedIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['groupId', 'orderedIds'],
    },
    mutates: true,
  },
  {
    name: 'list_sections',
    description: 'List sections, optionally filtered by group.',
    inputSchema: {
      type: 'object',
      properties: { groupId: { type: 'string' } },
    },
  },

  // ── Layout ──
  {
    name: 'set_layout',
    description: 'Set a BSP layout tree for the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        layoutTree: { type: 'object', description: 'BSP layout tree with panel/split nodes.' },
        layoutId: { type: 'string', description: 'Named layout ID (optional).' },
      },
      required: ['layoutTree'],
    },
    mutates: true,
  },
  {
    name: 'add_panel',
    description: 'Add a panel by splitting an existing one.',
    inputSchema: {
      type: 'object',
      properties: {
        existingPanelType: { type: 'string' }, newPanelType: { type: 'string' },
        direction: { type: 'string', enum: ['horizontal', 'vertical'] },
        ratio: { type: 'number' }, layoutId: { type: 'string' },
      },
      required: ['existingPanelType', 'newPanelType'],
    },
    mutates: true,
  },
  {
    name: 'remove_panel',
    description: 'Remove a panel from the layout.',
    inputSchema: {
      type: 'object',
      properties: { panelType: { type: 'string' }, layoutId: { type: 'string' } },
      required: ['panelType'],
    },
    mutates: true,
  },
  {
    name: 'resize_panel',
    description: 'Resize a split containing a panel.',
    inputSchema: {
      type: 'object',
      properties: {
        firstPanelType: { type: 'string' }, ratio: { type: 'number' },
        layoutId: { type: 'string' },
      },
      required: ['firstPanelType', 'ratio'],
    },
    mutates: true,
  },
  {
    name: 'update_layout_behavior',
    description: 'Update root layout behavior (responsive mode, breakpoints).',
    inputSchema: {
      type: 'object',
      properties: { behavior: { type: 'object' } },
      required: ['behavior'],
    },
    mutates: true,
  },

  // ── Panel Types ──
  {
    name: 'register_panel_type',
    description: 'Register a panel type with title, icon, component, behavior.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' }, title: { type: 'string' },
        icon: { type: 'string' }, component: { type: 'string' },
        behavior: { type: 'object' }, menuActions: { type: 'array', items: { type: 'object' } },
      },
      required: ['name', 'title', 'component'],
    },
    mutates: true,
  },
  {
    name: 'update_panel_type',
    description: 'Update an existing panel type.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, updates: { type: 'object' } },
      required: ['name', 'updates'],
    },
    mutates: true,
  },
  {
    name: 'unregister_panel_type',
    description: 'Remove a panel type from the registry.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    mutates: true,
  },
  {
    name: 'list_panel_types',
    description: 'List all registered panel types.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Menu Actions ──
  {
    name: 'add_menu_action',
    description: 'Add a dropdown menu action to a panel type.',
    inputSchema: {
      type: 'object',
      properties: {
        panelType: { type: 'string' }, id: { type: 'string' },
        label: { type: 'string' }, icon: { type: 'string' },
        group: { type: 'string' }, groupLabel: { type: 'string' },
        active: { type: 'boolean' },
        command: { type: 'string' }, event: { type: 'string' },
        method: { type: 'string' }, binding: { type: 'string' },
      },
      required: ['panelType', 'id', 'label'],
    },
    mutates: true,
  },
  {
    name: 'remove_menu_action',
    description: 'Remove a menu action from a panel type.',
    inputSchema: {
      type: 'object',
      properties: { panelType: { type: 'string' }, actionId: { type: 'string' } },
      required: ['panelType', 'actionId'],
    },
    mutates: true,
  },
  {
    name: 'toggle_menu_action',
    description: 'Toggle active state of a menu action.',
    inputSchema: {
      type: 'object',
      properties: {
        panelType: { type: 'string' }, actionId: { type: 'string' },
        active: { type: 'boolean' },
      },
      required: ['panelType', 'actionId', 'active'],
    },
    mutates: true,
  },
  {
    name: 'list_menu_actions',
    description: 'List menu actions for a panel type.',
    inputSchema: {
      type: 'object',
      properties: { panelType: { type: 'string' } },
      required: ['panelType'],
    },
  },

  // ── Behaviors ──
  {
    name: 'set_behavior',
    description: 'Set responsive behavior for a panel type or root layout.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '"root" or panel type name.' },
        behavior: { type: 'object' },
      },
      required: ['target', 'behavior'],
    },
    mutates: true,
  },
  {
    name: 'get_behavior',
    description: 'Get current behavior for a panel type or root.',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string' } },
      required: ['target'],
    },
  },
  {
    name: 'update_behavior',
    description: 'Merge updates into existing behavior.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' }, updates: { type: 'object' },
      },
      required: ['target', 'updates'],
    },
    mutates: true,
  },

  // ── Widgets ──
  {
    name: 'mount_widget',
    description: 'Mount a component into a panel type.',
    inputSchema: {
      type: 'object',
      properties: { panelType: { type: 'string' }, componentTag: { type: 'string' } },
      required: ['panelType', 'componentTag'],
    },
    mutates: true,
  },
  {
    name: 'unmount_widget',
    description: 'Unmount component from a panel type (set to empty state).',
    inputSchema: {
      type: 'object',
      properties: { panelType: { type: 'string' } },
      required: ['panelType'],
    },
    mutates: true,
  },
  {
    name: 'swap_widget',
    description: 'Swap the component in a panel type.',
    inputSchema: {
      type: 'object',
      properties: { panelType: { type: 'string' }, newComponentTag: { type: 'string' } },
      required: ['panelType', 'newComponentTag'],
    },
    mutates: true,
  },

  // ── Events ──
  {
    name: 'bridge_event',
    description: 'Create an event bridge between panels.',
    inputSchema: {
      type: 'object',
      properties: {
        sourcePanel: { type: 'string' }, targetPanel: { type: 'string' },
        event: { type: 'string' }, targetMethod: { type: 'string' },
        targetProperty: { type: 'string' }, mapping: { type: 'object' },
      },
      required: ['sourcePanel', 'event'],
    },
    mutates: true,
  },
  {
    name: 'unbridge_event',
    description: 'Remove an event bridge by ID.',
    inputSchema: {
      type: 'object',
      properties: { eventId: { type: 'string' } },
      required: ['eventId'],
    },
    mutates: true,
  },
  {
    name: 'list_bridges',
    description: 'List all event bridges in the workspace.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Workflow Modules ──
  {
    name: 'workflow_kanban',
    description: 'Register a portable workflow kanban board panel backed by symbiote-ui sn-kanban-board.',
    inputSchema: {
      type: 'object',
      properties: {
        panelType: { type: 'string', description: 'Portable panel type ID for the kanban board.' },
        board: {
          type: 'object',
          description: 'Plain JSON kanban board model with id, title, columns, and optional cards.',
        },
        title: { type: 'string', description: 'Panel title override.' },
        icon: { type: 'string', description: 'Material Symbols icon name.' },
        behavior: { type: 'object', description: 'Panel responsive behavior.' },
        layoutId: {
          type: 'string',
          description: 'Optional named layout to create or replace with this board panel.',
        },
        setDefaultLayout: { type: 'boolean', description: 'Replace the root layout with this board panel.' },
        group: { type: 'object', description: 'Optional project group to upsert for the workflow board.' },
        section: {
          type: 'object',
          description: 'Optional sidebar section to upsert for the workflow board.',
        },
        eventTarget: { type: 'object', description: 'Optional target for sn-board-card-drop move intents.' },
        requiredHostServices: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional portable host services required by this workflow board.',
        },
      },
      required: ['panelType', 'board'],
    },
    mutates: true,
  },

  // ── Preview ──
  {
    name: 'start_preview',
    description: 'Generate preview files from current workspace config.',
    inputSchema: {
      type: 'object',
      properties: {
        outputDir: { type: 'string' },
        port: { type: 'number' },
        imports: { type: 'object' },
        serveRoot: { type: 'string' },
      },
    },
    writesFiles: true,
  },

  // ── Validate ──
  {
    name: 'validate_config',
    description: 'Validate the current workspace config.',
    inputSchema: {
      type: 'object',
      properties: { strict: { type: 'boolean' } },
    },
  },

  // ── File I/O ──
  {
    name: 'save_config',
    description: 'Save workspace config to a JSON file.',
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string' } },
      required: ['filePath'],
    },
    mutates: true,
    writesFiles: true,
  },
  {
    name: 'load_config',
    description: 'Load a portable workspace config from a JSON file.',
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string' } },
      required: ['filePath'],
    },
    mutates: true,
  },

  // ── Workspace Package ──
  {
    name: 'export_workspace_package',
    description: 'Export the workspace as a portable package with config, manifest, and host contract.',
    inputSchema: {
      type: 'object',
      properties: {
        manifest: { type: 'object', description: 'Package manifest with id, name, version, tags, permissions, support, and dependencies.' },
        strict: { type: 'boolean', description: 'Reject on validation warnings.' },
      },
    },
  },
  {
    name: 'import_workspace_package',
    description: 'Import a portable workspace package JSON and restore the session config.',
    inputSchema: {
      type: 'object',
      properties: {
        json: { type: 'string', description: 'JSON string of the workspace package.' },
      },
      required: ['json'],
    },
    mutates: true,
  },
  {
    name: 'validate_workspace_package',
    description: 'Validate a workspace package object or JSON string without mutating session state.',
    inputSchema: {
      type: 'object',
      properties: {
        package: { type: 'object', description: 'Workspace package object to validate.' },
        json: { type: 'string', description: 'JSON string of the workspace package to validate.' },
      },
      anyOf: [
        { required: ['package'] },
        { required: ['json'] },
      ],
    },
  },
  {
    name: 'inspect_workspace_package',
    description: 'Inspect a workspace package object or JSON string for validity, readiness, and host-neutral capability requirements.',
    inputSchema: {
      type: 'object',
      properties: {
        package: { type: 'object', description: 'Workspace package object to inspect.' },
        json: { type: 'string', description: 'JSON string of the workspace package to inspect.' },
        available: {
          type: 'object',
          description: 'Host-neutral available capabilities map.',
          properties: {
            components: { type: 'array', items: { type: 'string' } },
            plugins: { type: 'array', items: { type: 'string' } },
            packages: { type: 'array', items: { type: 'string' } },
            hostServices: { type: 'array', items: { type: 'string' } },
            runtimeSlots: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      anyOf: [
        { required: ['package'] },
        { required: ['json'] },
      ],
    },
  },

  {
    name: 'create_workspace_package_construction_context',
    description: 'Create a construction context from a workspace package for guided workspace assembly.',
    inputSchema: {
      type: 'object',
      properties: {
        package: { type: 'object', description: 'Workspace package object.' },
        json: { type: 'string', description: 'JSON string of the workspace package.' },
        available: {
          type: 'object',
          description: 'Host-neutral available capabilities map.',
          properties: {
            components: { type: 'array', items: { type: 'string' } },
            plugins: { type: 'array', items: { type: 'string' } },
            packages: { type: 'array', items: { type: 'string' } },
            hostServices: { type: 'array', items: { type: 'string' } },
            runtimeSlots: { type: 'array', items: { type: 'string' } },
          },
        },
        templateName: { type: 'string', description: 'External template name override.' },
      },
      anyOf: [
        { required: ['package'] },
        { required: ['json'] },
      ],
    },
  },
  {
    name: 'create_workspace_packages_construction_context',
    description: 'Create a construction context from multiple workspace packages for guided workspace assembly.',
    inputSchema: {
      type: 'object',
      properties: {
        packages: {
          type: 'array',
          description: 'Workspace package entries: [{ package, json, templateName }].',
          items: {
            type: 'object',
            properties: {
              package: { type: 'object', description: 'Workspace package object.' },
              json: { type: 'string', description: 'JSON string of the workspace package.' },
              templateName: { type: 'string', description: 'External template name override.' },
            },
          },
        },
        available: {
          type: 'object',
          description: 'Host-neutral available capabilities map.',
          properties: {
            components: { type: 'array', items: { type: 'string' } },
            plugins: { type: 'array', items: { type: 'string' } },
            packages: { type: 'array', items: { type: 'string' } },
            hostServices: { type: 'array', items: { type: 'string' } },
            runtimeSlots: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      required: ['packages'],
    },
  },
  {
    name: 'create_workspace_construction_handoff',
    description: 'Create a workspace construction handoff from a package construction context and intent for guided workspace assembly.',
    inputSchema: {
      type: 'object',
      properties: {
        context: {
          type: 'object',
          description: 'Package construction context object from create_workspace_package_construction_context or create_workspace_packages_construction_context.',
        },
        intent: {
          anyOf: [
            { type: 'string' },
            { type: 'object' },
          ],
          description: 'Construction intent (string or object) to enrich with package-required capabilities.',
        },
      },
      required: ['context'],
    },
  },
  {
    name: 'collect_plugin_module_capabilities',
    description: 'Collect portable module capability descriptors from plugin definitions without activating plugins.',
    inputSchema: {
      type: 'object',
      properties: {
        plugins: {
          description: 'Plugin definition object or array of plugin definitions.',
          anyOf: [
            { type: 'object' },
            { type: 'array', items: { type: 'object' } },
          ],
        },
      },
      required: ['plugins'],
    },
  },
  {
    name: 'collect_plugin_workspace_templates',
    description: 'Collect portable workspace templates from plugin definitions without activating plugins.',
    inputSchema: {
      type: 'object',
      properties: {
        plugins: {
          description: 'Plugin definition object or array of plugin definitions.',
          anyOf: [
            { type: 'object' },
            { type: 'array', items: { type: 'object' } },
          ],
        },
      },
      required: ['plugins'],
    },
  },

  // ── Sharing ──
  {
    name: 'export_config',
    description: 'Export workspace config as portable JSON (strips auth/server data).',
    inputSchema: {
      type: 'object',
      properties: { strict: { type: 'boolean', description: 'Reject on validation warnings.' } },
    },
  },
  {
    name: 'import_config',
    description: 'Import workspace config from portable JSON string.',
    inputSchema: {
      type: 'object',
      properties: { json: { type: 'string', description: 'JSON string of workspace config.' } },
      required: ['json'],
    },
    mutates: true,
  },
  {
    name: 'diff_configs',
    description: 'Compare two workspace configs and return differences.',
    inputSchema: {
      type: 'object',
      properties: {
        otherJson: { type: 'string', description: 'JSON string of config to compare against current.' },
      },
      required: ['otherJson'],
    },
  },
  {
    name: 'merge_configs',
    description: 'Merge partial config overlay onto current workspace config.',
    inputSchema: {
      type: 'object',
      properties: {
        overlay: { type: 'object', description: 'Partial config to merge (theme, components, etc.).' },
      },
      required: ['overlay'],
    },
    mutates: true,
  },

  // ── Guardrails ──
  {
    name: 'check_guardrails',
    description: 'Check design guardrails (panel limits, ratio constraints, register density).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/** @type {Map<string, ToolDefinition>} */
const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * Check if a tool mutates config (for auto-save logic).
 * @param {string} toolName
 * @returns {boolean}
 */
export function isMutating(toolName) {
  return TOOL_MAP.get(toolName)?.mutates === true;
}

const CURRENT_CONFIG_TOOLS = new Set([
  'describe_workspace',
  'list_used_components',
  'propose_workspace_patch',
  'validate_workspace_patch',
  'apply_workspace_patch',
  'export_workspace',
  'add_group',
  'remove_group',
  'update_group',
  'reorder_groups',
  'list_groups',
  'add_section',
  'remove_section',
  'update_section',
  'reorder_sections',
  'list_sections',
  'set_layout',
  'add_panel',
  'remove_panel',
  'resize_panel',
  'update_layout_behavior',
  'register_panel_type',
  'update_panel_type',
  'unregister_panel_type',
  'list_panel_types',
  'add_menu_action',
  'remove_menu_action',
  'toggle_menu_action',
  'list_menu_actions',
  'set_behavior',
  'get_behavior',
  'update_behavior',
  'mount_widget',
  'unmount_widget',
  'swap_widget',
  'bridge_event',
  'unbridge_event',
  'list_bridges',
  'workflow_kanban',
  'start_preview',
  'validate_config',
  'save_config',
  'export_workspace_package',
  'export_config',
  'diff_configs',
  'merge_configs',
  'check_guardrails',
]);

function missingConfigResult(toolName) {
  return {
    status: 'error',
    tool: toolName,
    code: 'workspace_config_missing',
    hint: [
      'No active workspace config.',
      'Create or load one first with scaffold_workspace, scaffold_from_scratch,',
      'construct_workspace, load_config, import_config, or import_workspace_package.',
    ].join(' '),
  };
}

/**
 * Validate tool args against inputSchema required fields.
 * @param {string} toolName
 * @param {Object} args
 * @returns {{ valid: boolean, missing?: string[] }}
 */
function validateArgs(toolName, args) {
  let tool = TOOL_MAP.get(toolName);
  if (!tool) return { valid: true }; // unknown tool handled by dispatch default case
  let input = args || {};

  let required = tool.inputSchema?.required;
  let missing = (required || []).filter((key) => input[key] === undefined || input[key] === null);
  if (missing.length > 0) {
    return { valid: false, missing };
  }

  let alternatives = (tool.inputSchema?.anyOf || [])
    .map((schema) => schema?.required)
    .filter((items) => Array.isArray(items) && items.length > 0);
  if (alternatives.length > 0) {
    let matched = alternatives.some((items) => items.every((key) => {
      return input[key] !== undefined && input[key] !== null;
    }));
    if (!matched) {
      return {
        valid: false,
        missing: [alternatives.map((items) => items.join(', ')).join(' or ')],
      };
    }
  }

  return { valid: true };
}

/**
 * Lazy handler import cache.
 * @type {Object|null}
 */
let _handlers = null;
let _constructor = null;

async function getHandlers() {
  if (!_handlers) _handlers = await import('../handlers/index.js');
  return _handlers;
}

async function getConstructor() {
  if (!_constructor) _constructor = await import('../constructor/index.js');
  return _constructor;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function constructionIntentFromArgs(args) {
  let intent = args.intent;
  if (typeof intent !== 'string' && !isObject(intent)) return intent;

  let result = typeof intent === 'string' ? { brief: intent } : { ...intent };
  for (let field of [
    'template',
    'targetRegister',
    'audience',
    'constraints',
    'requiredCapabilities',
    'preferredTheme',
  ]) {
    if (args[field] !== undefined && result[field] === undefined) result[field] = args[field];
  }
  if (args.register !== undefined && result.targetRegister === undefined) {
    result.targetRegister = args.register;
  }
  return result;
}

function constructionOptionsFromArgs(args, intent) {
  if (args.options !== undefined && !isObject(args.options)) {
    throw new Error('Construction options must be a plain object when provided.');
  }

  let options = args.options ? { ...args.options } : {};
  let optionRegister = options.register;
  delete options.register;

  if (args.targetRegister !== undefined) {
    options.register = args.targetRegister;
  } else if (args.register !== undefined && !intent?.targetRegister) {
    options.register = args.register;
  } else if (optionRegister !== undefined && !intent?.targetRegister) {
    options.register = optionRegister;
  }

  for (let field of ['name', 'answers', 'moduleCapabilities', 'workspaceTemplates', 'theme']) {
    if (args[field] !== undefined) options[field] = args[field];
  }
  let packageContext = packageContextFromHandoff(args);
  if (packageContext !== undefined) options.packageContext = packageContext;

  return options;
}

function isConstructionHandoffArgs(args) {
  return isObject(args)
    && (isObject(args.intent) || typeof args.intent === 'string')
    && isObject(args.options)
    && (
      args._type === WORKSPACE_CONSTRUCTION_HANDOFF_TYPE
      || args.valid !== undefined
      || args.ready !== undefined
      || Array.isArray(args.errors)
      || Array.isArray(args.warnings)
      || args.source !== undefined
      || args.sources !== undefined
      || isObject(args.options.packageContext)
    );
}

function flatMissingCapabilities(missing) {
  if (!isObject(missing)) return [];
  return Object.values(missing)
    .filter(Array.isArray)
    .flat();
}

const MISSING_RECOVERY_ACTIONS = {
  components: 'register-component',
  plugins: 'install-plugin',
  packages: 'import-package',
  hostServices: 'provide-host-service',
  runtimeSlots: 'provide-runtime-slot',
};

function missingRecoverySteps(missing) {
  if (!isObject(missing)) return [];
  let steps = [];
  for (let [kind, items] of Object.entries(missing)) {
    if (!Array.isArray(items)) continue;
    let action = MISSING_RECOVERY_ACTIONS[kind] || 'provide-capability';
    for (let item of items) {
      steps.push({ kind, item, action });
    }
  }
  return steps;
}

function constructionReadinessFromPackageContext(context = {}, overrides = {}) {
  let warnings = Array.isArray(context.warnings) ? context.warnings : [];
  let errors = Array.isArray(context.errors) ? context.errors : [];
  let missing = flatMissingCapabilities(context.missing);
  let recovery = missingRecoverySteps(context.missing);
  let errorCount = errors.length;
  let ready = context.valid === true && context.ready === true && missing.length === 0 && errorCount === 0;

  return compactObject({
    ready,
    valid: context.valid === true,
    status: ready ? 'ready' : (errorCount > 0 ? 'blocked' : 'warning'),
    missingCount: missing.length,
    warningCount: warnings.length,
    errorCount,
    missing: cloneJson(context.missing),
    recovery: recovery.length > 0 ? recovery : undefined,
    warnings: cloneJson(warnings),
    errors: cloneJson(errors),
    source: cloneJson(context.source),
    sources: cloneJson(context.sources),
    ...overrides,
  });
}

function constructionReadinessFromHandoff(args, overrides = {}) {
  return constructionReadinessFromPackageContext(packageContextFromHandoff(args) || {}, overrides);
}

function moduleCapabilityAlternatives(capabilities, capability) {
  let byCapability = Array.isArray(capabilities.byCapability) ? capabilities.byCapability : [];
  let match = byCapability.find((item) => item?.capability === capability);
  let alternatives = Array.isArray(match?.alternatives) ? match.alternatives : [];
  return alternatives.length > 0 ? cloneJson(alternatives) : undefined;
}

function constructionReadinessFromPlan(plan, overrides = {}) {
  let capabilities = plan?.capabilities || {};
  let missing = Array.isArray(capabilities.missing) ? capabilities.missing : [];
  return compactObject({
    ready: missing.length === 0,
    valid: true,
    status: missing.length > 0 ? 'blocked' : 'ready',
    nextAction: missing.length > 0 ? 'provide-module-capabilities' : 'construct',
    missingCount: missing.length,
    warningCount: 0,
    errorCount: 0,
    missing: missing.length > 0 ? { moduleCapabilities: cloneJson(missing) } : undefined,
    recovery: missing.length > 0
      ? missing.map((item) => compactObject({
        kind: 'moduleCapabilities',
        item,
        action: 'provide-module-capability',
        alternatives: moduleCapabilityAlternatives(capabilities, item),
      }))
      : undefined,
    requiredCapabilities: cloneJson(capabilities.required),
    matchedCapabilities: cloneJson(capabilities.matched),
    ...overrides,
  });
}

function topLevelConstructionReadiness(plan) {
  let packageReadiness = cloneJson(plan?.readiness?.package);
  let capabilityReadiness = constructionReadinessFromPlan(plan);
  if (!packageReadiness) return capabilityReadiness.ready ? undefined : capabilityReadiness;
  if (!packageReadiness.ready) {
    let context = plan?.packageContext;
    return context ? constructionReadinessFromPackageContext(context, packageReadiness) : packageReadiness;
  }
  if (capabilityReadiness.ready) return packageReadiness;
  return capabilityReadiness;
}

function assertUsableConstructionHandoff(args, { requireReady = false } = {}) {
  if (!isConstructionHandoffArgs(args)) return;
  let context = packageContextFromHandoff(args) || {};
  let errors = Array.isArray(context.errors) ? context.errors : [];
  let warnings = Array.isArray(context.warnings) ? context.warnings : [];
  let missing = flatMissingCapabilities(context.missing);
  if (context.valid === false || errors.length > 0) {
    let detail = errors
      .map((error) => error?.message || error?.path)
      .filter(Boolean)
      .join('; ');
    let err = new Error(`Construction handoff is invalid${detail ? `: ${detail}` : '.'}`);
    err.code = 'construction_handoff_invalid';
    err.nextAction = 'fix-package-context';
    err.readiness = constructionReadinessFromHandoff(args, {
      ready: false,
      status: 'blocked',
    });
    throw err;
  }
  if (requireReady && (context.ready !== true || missing.length > 0 || warnings.length > 0)) {
    let detail = [
      ...missing,
      ...warnings.map((warning) => warning?.message || warning?.path).filter(Boolean),
    ].join('; ');
    let err = new Error(`Construction handoff is not ready${detail ? `: ${detail}` : '.'}`);
    err.code = 'construction_handoff_not_ready';
    err.nextAction = 'review-package-readiness';
    err.readiness = constructionReadinessFromHandoff(args, {
      ready: false,
      status: 'warning',
      errorCount: 0,
    });
    throw err;
  }
}

function assertConstructiblePlan(result) {
  let missing = result?.plan?.capabilities?.missing;
  if (!Array.isArray(missing) || missing.length === 0) return;
  let err = new Error(`Construction plan is missing required capabilities: ${missing.join(', ')}.`);
  err.code = 'construction_capabilities_missing';
  err.nextAction = 'provide-module-capabilities';
  err.readiness = constructionReadinessFromPlan(result.plan, { ready: false });
  err.plan = result.plan;
  throw err;
}

function constructionError(toolName, err) {
  return compactObject({
    status: 'error',
    tool: toolName,
    hint: err.message,
    code: err.code,
    nextAction: err.nextAction,
    readiness: cloneJson(err.readiness),
    plan: cloneJson(err.plan),
  });
}

/**
 * Dispatch a tool call.
 *
 * @param {string} toolName - Tool name (snake_case)
 * @param {Object} args - Tool arguments
 * @param {import('./session.js').Session} session - Workspace session
 * @returns {Promise<Object>} Result object
 */
export async function dispatch(toolName, args, session) {
  if (!TOOLS.some((tool) => tool.name === toolName)) {
    return { status: 'error', hint: `Unknown tool: ${toolName}` };
  }

  // Input validation
  let validation = validateArgs(toolName, args);
  if (!validation.valid) {
    return {
      status: 'error',
      tool: toolName,
      hint: `Missing required arguments: ${validation.missing.join(', ')}`,
    };
  }

  if (toolName === 'classify_workspace') {
    let c = await getConstructor();
    try {
      let constructionIntent = constructionIntentFromArgs(args);
      let options = constructionOptionsFromArgs(args, constructionIntent);
      let normalized = c.normalizeConstructionIntent(constructionIntent, options);
      let templateMatch = c.matchTemplate(normalized.brief, options);
      return {
        status: 'ok',
        templateName: normalized.template,
        fallback: !templateMatch && !constructionIntent?.template,
        intent: normalized,
        questions: c.buildConstructionQuestions(normalized, options),
        readiness: {
          ready: true,
          valid: true,
          status: 'ready',
          nextAction: 'plan-workspace',
        },
        nextAction: 'plan-workspace',
      };
    } catch (err) {
      return constructionError(toolName, err);
    }
  }

  if (toolName === 'build_construction_questions') {
    let c = await getConstructor();
    try {
      let constructionIntent = constructionIntentFromArgs(args);
      let options = constructionOptionsFromArgs(args, constructionIntent);
      let intent = c.normalizeConstructionIntent(constructionIntent, options);
      return {
        status: 'ok',
        intent,
        templateName: intent.template,
        questions: c.buildConstructionQuestions(intent, options),
        readiness: {
          ready: true,
          valid: true,
          status: 'ready',
          nextAction: 'plan-workspace',
        },
        nextAction: 'plan-workspace',
      };
    } catch (err) {
      return constructionError(toolName, err);
    }
  }

  if (toolName === 'answer_construction_question') {
    let c = await getConstructor();
    try {
      let questions = c.answerConstructionQuestion(args.questions, args.questionId, args.answer);
      return {
        status: 'ok',
        questions,
        answeredQuestionId: args.questionId,
        readiness: {
          ready: true,
          valid: true,
          status: 'ready',
          nextAction: 'plan-workspace',
        },
        nextAction: 'plan-workspace',
      };
    } catch (err) {
      return constructionError(toolName, err);
    }
  }

  if (toolName === 'plan_workspace') {
    let c = await getConstructor();
    let result;
    try {
      assertUsableConstructionHandoff(args);
      let constructionIntent = constructionIntentFromArgs(args);
      result = c.planWorkspaceConstruction(
        constructionIntent,
        constructionOptionsFromArgs(args, constructionIntent),
      );
    } catch (err) {
      return constructionError(toolName, err);
    }
    return compactObject({
      status: 'ok',
      templateName: result.intent.template,
      intent: result.intent,
      questions: result.questions,
      plan: result.plan,
      readiness: topLevelConstructionReadiness(result.plan),
      verification: cloneJson(result.plan.verification),
      config: result.config,
    });
  }

  if (toolName === 'construct_workspace') {
    let c = await getConstructor();
    let result;
    try {
      assertUsableConstructionHandoff(args, { requireReady: true });
      let constructionIntent = constructionIntentFromArgs(args);
      result = c.planWorkspaceConstruction(
        constructionIntent,
        constructionOptionsFromArgs(args, constructionIntent),
      );
      assertConstructiblePlan(result);
    } catch (err) {
      return constructionError(toolName, err);
    }
    session.config = result.config;
    return compactObject({
      status: 'ok',
      templateName: result.intent.template,
      intent: result.intent,
      questions: result.questions,
      plan: result.plan,
      readiness: topLevelConstructionReadiness(result.plan),
      verification: cloneJson(result.plan.verification),
      config: result.config,
      hint: `Workspace "${result.config.name}" constructed from "${result.intent.template}".`,
    });
  }

  if (toolName === 'load_config') {
    let filePath = resolve(args.filePath);
    let json;
    try {
      json = await readFile(filePath, 'utf-8');
    } catch (err) {
      return {
        status: 'error',
        tool: toolName,
        filePath,
        code: 'workspace_config_read_failed',
        errors: [{ path: 'filePath', message: `Cannot read config file: ${err.message}`, severity: 'error' }],
        hint: `Load failed: cannot read ${filePath}.`,
      };
    }
    let { importConfig } = await import('../sharing/index.js');
    let result = importConfig(json);
    if (!result.config) {
      return {
        status: 'error',
        tool: toolName,
        filePath,
        errors: result.errors,
        code: 'workspace_config_invalid',
        hint: 'Load failed: file does not contain a portable workspace config.',
      };
    }
    session.config = result.config;
    session.configFilePath = filePath;
    return { status: 'ok', filePath, config: session.config, hint: `Config loaded from ${filePath}.` };
  }

  if (toolName === 'validate_workspace_package') {
    let { validateWorkspacePackage } = await import('../sharing/index.js');
    let input;
    try {
      input = args.package || parseJsonInput(args.json);
    } catch (err) {
      return {
        status: 'error',
        tool: toolName,
        valid: false,
        errors: [{ path: '', message: `Invalid JSON: ${err.message}`, severity: 'error' }],
        code: 'workspace_package_invalid',
        nextAction: 'fix-workspace-package',
        hint: 'Workspace package has validation errors.',
      };
    }
    if (!input) {
      return { status: 'error', tool: toolName, hint: 'Missing required arguments: package or json' };
    }
    let result = validateWorkspacePackage(input);
    return compactObject({
      status: result.valid ? 'ok' : 'error',
      tool: result.valid ? undefined : toolName,
      valid: result.valid,
      errors: result.errors,
      code: result.valid ? undefined : 'workspace_package_invalid',
      nextAction: result.valid ? undefined : 'fix-workspace-package',
      hint: result.valid ? 'Workspace package is valid.' : 'Workspace package has validation errors.',
    });
  }

  if (toolName === 'inspect_workspace_package') {
    let input = args.package || args.json;
    if (!input) {
      return { status: 'error', tool: toolName, hint: 'Missing required arguments: package or json' };
    }
    let { inspectWorkspacePackage } = await import('../sharing/index.js');
    let raw = args.available === undefined
      ? inspectWorkspacePackage(input)
      : inspectWorkspacePackage(input, { available: args.available });
    return {
      status: 'ok',
      valid: raw.valid,
      ready: raw.ready,
      summary: raw.summary,
      compatibility: raw.compatibility,
      requirements: raw.requirements,
      missing: raw.missing,
      readiness: raw.readiness,
      nextAction: raw.readiness?.nextAction,
      warnings: raw.warnings,
      errors: raw.errors,
    };
  }

  if (toolName === 'create_workspace_package_construction_context') {
    let input = args.package || args.json;
    if (!input) {
      return { status: 'error', tool: toolName, hint: 'Missing required arguments: package or json' };
    }
    let { createWorkspacePackageConstructionContext } = await import('../sharing/index.js');
    let options = {};
    if (args.available !== undefined) options.available = args.available;
    if (args.templateName !== undefined) options.templateName = args.templateName;
    let result = createWorkspacePackageConstructionContext(input, options);
    return {
      status: 'ok',
      valid: result.valid,
      ready: result.ready,
      workspaceTemplates: result.workspaceTemplates,
      moduleCapabilities: result.moduleCapabilities,
      requiredCapabilities: result.requiredCapabilities,
      requirements: result.requirements,
      missing: result.missing,
      readiness: result.readiness,
      nextAction: result.readiness?.nextAction,
      source: result.source,
      summary: result.summary,
      compatibility: result.compatibility,
      warnings: result.warnings,
      errors: result.errors,
    };
  }

  if (toolName === 'create_workspace_packages_construction_context') {
    let { createWorkspacePackagesConstructionContext } = await import('../sharing/index.js');
    let input = { packages: args.packages };
    if (args.available !== undefined) input.available = args.available;
    let result = createWorkspacePackagesConstructionContext(input);
    return {
      status: 'ok',
      valid: result.valid,
      ready: result.ready,
      workspaceTemplates: result.workspaceTemplates,
      moduleCapabilities: result.moduleCapabilities,
      requiredCapabilities: result.requiredCapabilities,
      requirements: result.requirements,
      missing: result.missing,
      readiness: result.readiness,
      nextAction: result.readiness?.nextAction,
      source: result.source,
      sources: result.sources,
      summary: result.summary,
      compatibility: result.compatibility,
      packageResults: result.packageResults,
      conflicts: result.conflicts,
      warnings: result.warnings,
      errors: result.errors,
    };
  }

  if (toolName === 'create_workspace_construction_handoff') {
    if (!args.context) {
      return { status: 'error', tool: toolName, hint: 'Missing required arguments: context' };
    }
    let { createWorkspaceConstructionHandoff } = await import('../sharing/index.js');
    let raw;
    try {
      raw = createWorkspaceConstructionHandoff(args.context, args.intent);
    } catch (err) {
      if (err.code !== 'construction_handoff_intent_invalid') throw err;
      return constructionError(toolName, err);
    }
    return {
      status: 'ok',
      _type: WORKSPACE_CONSTRUCTION_HANDOFF_TYPE,
      intent: raw.intent,
      options: raw.options,
      valid: raw.valid,
      ready: raw.ready,
      requirements: raw.requirements,
      missing: raw.missing,
      readiness: raw.readiness,
      nextAction: raw.readiness?.nextAction,
      source: raw.source,
      sources: raw.sources,
      summary: raw.summary,
      compatibility: raw.compatibility,
      warnings: raw.warnings,
      errors: raw.errors,
    };
  }

  if (toolName === 'collect_plugin_module_capabilities') {
    let { collectPluginModuleCapabilities } = await import('../plugins/index.js');
    let result = collectPluginModuleCapabilities(args.plugins);
    return {
      status: result.ok ? 'ok' : 'error',
      ok: result.ok,
      moduleCapabilities: result.moduleCapabilities,
      errors: result.errors,
    };
  }

  if (toolName === 'collect_plugin_workspace_templates') {
    let { collectPluginWorkspaceTemplates } = await import('../plugins/index.js');
    let result = collectPluginWorkspaceTemplates(args.plugins);
    return {
      status: result.ok ? 'ok' : 'error',
      ok: result.ok,
      templates: result.templates,
      errors: result.errors,
    };
  }

  if (CURRENT_CONFIG_TOOLS.has(toolName) && !session.config) {
    return missingConfigResult(toolName);
  }

  let h = await getHandlers();
  let config = session.config;

  try {
  switch (toolName) {
    // ── Discovery ──
    case 'describe_workspace':
      return h.describeWorkspace(config);

    case 'discover_components':
      return h.discoverComponents(args.uiPath);

    case 'find_component': {
      let found = await h.findComponent(args.uiPath, args.tagName);
      if (!found) return { status: 'not_found', hint: `Component <${args.tagName}> not found.` };
      return { component: found, status: 'ok' };
    }

    case 'list_component_tags': {
      let tags = await h.listComponentTags(args.uiPath);
      return { tags, count: tags.length };
    }

    case 'list_categories': {
      let cats = await h.listCategories(args.uiPath);
      return { categories: cats, count: Object.keys(cats).length };
    }

    case 'list_used_components':
      return h.listUsedComponents(config);

    // ── Scaffold ──
    case 'list_templates': {
      let c = await getConstructor();
      let templates = c.listTemplates({
        workspaceTemplates: args.workspaceTemplates,
      });
      return { templates, count: templates.length };
    }

    case 'scaffold_workspace': {
      let c = await getConstructor();
      let result = c.planWorkspace(args.template || '', {
        name: args.name,
        register: args.register,
      });
      session.config = result;
      return { config: result, status: 'ok', hint: `Workspace "${result.name}" created.` };
    }

    case 'scaffold_from_scratch': {
      let result = h.scaffoldFromScratch({ name: args.name, register: args.register });
      session.config = result;
      return { config: result, status: 'ok', hint: `Blank workspace "${result.name}" created.` };
    }

    case 'propose_workspace_patch': {
      let patch = args.patch || args.overlay;
      if (!patch) return { status: 'error', tool: toolName, hint: 'Missing required arguments: overlay or patch' };
      let { proposeWorkspacePatch } = await import('../validation/index.js');
      let result = await proposeWorkspacePatch(config, args.patch || { overlay: args.overlay });
      return {
        ...result,
        status: result.accepted ? 'ok' : 'invalid',
      };
    }

    case 'validate_workspace_patch': {
      let patch = args.patch || args.overlay;
      if (!patch) return { status: 'error', tool: toolName, hint: 'Missing required arguments: overlay or patch' };
      let { validateWorkspacePatch } = await import('../validation/index.js');
      let result = await validateWorkspacePatch(config, args.patch || { overlay: args.overlay });
      return {
        ...result,
        valid: result.accepted,
        status: result.accepted ? 'ok' : 'invalid',
      };
    }

    case 'apply_workspace_patch': {
      let patch = args.patch || args.overlay;
      if (!patch) return { status: 'error', tool: toolName, hint: 'Missing required arguments: overlay or patch' };
      let { applyWorkspacePatch } = await import('../validation/index.js');
      let result = await applyWorkspacePatch(config, args.patch || { overlay: args.overlay });
      if (!result.config) {
        return {
          ...result,
          status: 'error',
          hint: 'Patch rejected: workspace validation failed.',
        };
      }
      session.config = result.config;
      return {
        ...result,
        status: 'ok',
        hint: 'Workspace patch applied.',
      };
    }

    // ── Groups ──
    case 'add_group':
      return applyMutation(session, h.addGroup(config, args));

    case 'remove_group':
      return applyMutation(session, h.removeGroup(config, args.groupId));

    case 'update_group':
      return applyMutation(session, h.updateGroup(config, args.groupId, args.updates));

    case 'reorder_groups':
      return applyMutation(session, h.reorderGroups(config, args.orderedIds));

    case 'list_groups':
      return h.listGroups(config);

    // ── Sections ──
    case 'add_section':
      return applyMutation(session, h.addSection(config, args.groupId, args));

    case 'remove_section':
      return applyMutation(session, h.removeSection(config, args.sectionId));

    case 'update_section':
      return applyMutation(session, h.updateSection(config, args.sectionId, args.updates));

    case 'reorder_sections':
      return applyMutation(session, h.reorderSections(config, args.groupId, args.orderedIds));

    case 'list_sections':
      return h.listSections(config, args.groupId);

    // ── Layout ──
    case 'set_layout':
      return applyMutation(session, h.setLayout(config, args.layoutTree, args.layoutId));

    case 'add_panel':
      return applyMutation(session, h.addPanel(config, args.existingPanelType, args.newPanelType, args.direction, args.ratio, args.layoutId));

    case 'remove_panel':
      return applyMutation(session, h.removePanel(config, args.panelType, args.layoutId));

    case 'resize_panel':
      return applyMutation(session, h.resizePanel(config, args.firstPanelType, args.ratio, args.layoutId));

    case 'update_layout_behavior':
      return applyMutation(session, h.updateLayoutBehavior(config, args.behavior));

    // ── Panel Types ──
    case 'register_panel_type':
      return applyMutation(session, h.registerPanelType(config, args.name, {
        title: args.title, icon: args.icon, component: args.component,
        behavior: args.behavior, menuActions: args.menuActions,
      }));

    case 'update_panel_type':
      return applyMutation(session, h.updatePanelType(config, args.name, args.updates));

    case 'unregister_panel_type':
      return applyMutation(session, h.unregisterPanelType(config, args.name));

    case 'list_panel_types':
      return h.listPanelTypes(config);

    // ── Menu Actions ──
    case 'add_menu_action':
      return applyMutation(session, h.addMenuAction(config, args.panelType, {
        id: args.id, label: args.label, icon: args.icon,
        group: args.group, groupLabel: args.groupLabel, active: args.active,
        command: args.command, event: args.event,
        method: args.method, binding: args.binding,
      }));

    case 'remove_menu_action':
      return applyMutation(session, h.removeMenuAction(config, args.panelType, args.actionId));

    case 'toggle_menu_action':
      return applyMutation(session, h.toggleMenuAction(config, args.panelType, args.actionId, args.active));

    case 'list_menu_actions':
      return h.listMenuActions(config, args.panelType);

    // ── Behaviors ──
    case 'set_behavior':
      return applyMutation(session, h.setBehavior(config, args.target, args.behavior));

    case 'get_behavior':
      return h.getBehavior(config, args.target);

    case 'update_behavior':
      return applyMutation(session, h.updateBehavior(config, args.target, args.updates));

    // ── Widgets ──
    case 'mount_widget':
      return applyMutation(session, h.mountWidget(config, args.panelType, args.componentTag));

    case 'unmount_widget':
      return applyMutation(session, h.unmountWidget(config, args.panelType));

    case 'swap_widget':
      return applyMutation(session, h.swapWidget(config, args.panelType, args.newComponentTag));

    // ── Events ──
    case 'bridge_event':
      return applyMutation(session, h.bridgeEvent(config, args));

    case 'unbridge_event':
      return applyMutation(session, h.unbridgeEvent(config, args.eventId));

    case 'list_bridges':
      return h.listBridges(config);

    // ── Workflow Modules ──
    case 'workflow_kanban':
      return applyMutation(session, h.workflowKanban(config, args));

    // ── Preview ──
    case 'start_preview':
      return h.startPreview(config, args);

    // ── Validate ──
    case 'validate_config': {
      let { validateWorkspaceConfig } = await import('../validation/core.js');
      return validateWorkspaceConfig(config, { strict: args.strict });
    }

    // ── File I/O ──
    case 'save_config': {
      let filePath = resolve(args.filePath);
      await writeFile(filePath, JSON.stringify(config, null, 2));
      session.configFilePath = filePath;
      return { status: 'ok', filePath, hint: `Config saved to ${filePath}.` };
    }

    // ── Workspace Package ──
    case 'export_workspace_package': {
      let { exportWorkspacePackage } = await import('../sharing/index.js');
      let result = exportWorkspacePackage(config, args.manifest || {}, { strict: args.strict });
      if (!result.json) {
        return { status: 'error', errors: result.errors, hint: 'Workspace package export failed: validation errors.' };
      }
      return { status: 'ok', json: result.json, package: result.package, hint: 'Workspace exported as portable package.' };
    }

    case 'import_workspace_package': {
      let { importWorkspacePackage } = await import('../sharing/index.js');
      let result = importWorkspacePackage(toJsonString(args.json));
      if (!result.config) {
        return { status: 'error', errors: result.errors, hint: 'Workspace package import failed: invalid package.' };
      }
      session.config = result.config;
      return { status: 'ok', config: result.config, package: result.package, hint: `Imported workspace package "${result.config.name}".` };
    }

    // ── Sharing ──
    case 'export_config': {
      let { exportConfig } = await import('../sharing/index.js');
      let result = exportConfig(config, { strict: args.strict });
      if (!result.json) {
        return { status: 'error', errors: result.errors, hint: 'Export failed: config has validation errors.' };
      }
      return { status: 'ok', json: result.json, hint: 'Config exported as portable JSON.' };
    }

    case 'export_workspace': {
      let { exportConfig } = await import('../sharing/index.js');
      let result = exportConfig(config, { strict: args.strict });
      if (!result.json) {
        return { status: 'error', errors: result.errors, hint: 'Export failed: config has validation errors.' };
      }
      return { status: 'ok', json: result.json, hint: 'Workspace exported as portable JSON.' };
    }

    case 'import_config': {
      let { importConfig } = await import('../sharing/index.js');
      let result = importConfig(args.json);
      if (!result.config) {
        return { status: 'error', errors: result.errors, hint: 'Import failed: invalid config.' };
      }
      session.config = result.config;
      return { status: 'ok', config: result.config, hint: `Imported workspace "${result.config.name}".` };
    }

    case 'diff_configs': {
      let { diffConfigs } = await import('../sharing/index.js');
      let other = JSON.parse(args.otherJson);
      let diffs = diffConfigs(config, other);
      return { changes: diffs, count: diffs.length, hint: `${diffs.length} difference(s) found.` };
    }

    case 'merge_configs': {
      let { mergeConfigs } = await import('../sharing/index.js');
      let merged = mergeConfigs(config, args.overlay);
      session.config = merged;
      return { status: 'ok', config: merged, hint: 'Overlay merged into workspace config.' };
    }

    // ── Guardrails ──
    case 'check_guardrails': {
      let { checkDesignGuardrails } = await import('../validation/index.js');
      return checkDesignGuardrails(config);
    }

    default:
      return { status: 'error', hint: `Unknown tool: ${toolName}` };
  }
  } catch (err) {
    return {
      status: 'error',
      tool: toolName,
      hint: err.message || String(err),
    };
  }
}

/**
 * Apply a mutation result to the session.
 * Handlers return { config, status, hint, ... } — update session.config if present.
 * @param {import('./session.js').Session} session
 * @param {Object} result
 * @returns {Object}
 */
function applyMutation(session, result) {
  if (result.config) {
    session.config = result.config;
  }
  return result;
}
