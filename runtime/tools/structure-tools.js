/**
 * Structure dispatch-tool family.
 * @module symbiote-workspace/runtime/tools/structure-tools
 */

import {
  addPanel,
  removePanel,
  resizePanel,
  setLayout,
} from '../../handlers/layout.js';
import {
  listPanelTypes,
  registerPanelType,
  unregisterPanelType,
  updatePanelType,
} from '../../handlers/panels.js';
import {
  getBehavior,
  setBehavior,
  updateBehavior,
} from '../../handlers/behaviors.js';
import {
  mountWidget,
  swapWidget,
  unmountWidget,
} from '../../handlers/widgets.js';
import { workflowKanban } from '../../handlers/workflow-kanban.js';
import { defineToolFamily } from './registry.js';

export const structureTools = [
  {
    name: 'layout_set',
    description: 'Set a BSP layout tree for the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        layoutTree: { type: 'object', description: 'BSP layout tree with panel/split nodes.' },
        layoutId: { type: 'string', description: 'Named layout ID.' },
      },
      required: ['layoutTree'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'panel_add',
    description: 'Add a panel by splitting an existing one.',
    inputSchema: {
      type: 'object',
      properties: {
        existingPanelType: { type: 'string' },
        newPanelType: { type: 'string' },
        direction: { type: 'string', enum: ['horizontal', 'vertical'] },
        ratio: { type: 'number' },
        layoutId: { type: 'string' },
      },
      required: ['existingPanelType', 'newPanelType'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'panel_remove',
    description: 'Remove a panel from the layout.',
    inputSchema: {
      type: 'object',
      properties: { panelType: { type: 'string' }, layoutId: { type: 'string' } },
      required: ['panelType'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'panel_resize',
    description: 'Resize a split containing a panel.',
    inputSchema: {
      type: 'object',
      properties: {
        firstPanelType: { type: 'string' },
        ratio: { type: 'number' },
        layoutId: { type: 'string' },
      },
      required: ['firstPanelType', 'ratio'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'module_register',
    description: 'Register a workspace module with title, icon, component, and behavior.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        title: { type: 'string' },
        icon: { type: 'string' },
        component: { type: 'string' },
        behavior: { type: 'object' },
        actions: { type: 'array', items: { type: 'object' } },
      },
      required: ['name', 'title', 'component'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'module_update',
    description: 'Update an existing workspace module.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, updates: { type: 'object' } },
      required: ['name', 'updates'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'module_unregister',
    description: 'Remove a workspace module from the registry.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'module_list',
    description: 'List all registered workspace modules.',
    inputSchema: { type: 'object', properties: {} },
    requiresConfig: true,
  },
  {
    name: 'layout_behavior_set',
    description: 'Set responsive behavior for root layout or a module.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '"root" or module name.' },
        behavior: { type: 'object' },
      },
      required: ['target', 'behavior'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'layout_behavior_get',
    description: 'Get current behavior for root layout or a module.',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string' } },
      required: ['target'],
    },
    requiresConfig: true,
  },
  {
    name: 'layout_behavior_update',
    description: 'Merge behavior updates into root layout or a module.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '"root" or module name.' },
        updates: { type: 'object' },
        behavior: { type: 'object', description: 'Root behavior update shorthand.' },
      },
      required: ['target'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'panel_component_mount',
    description: 'Mount a component into a panel type.',
    inputSchema: {
      type: 'object',
      properties: { panelType: { type: 'string' }, componentTag: { type: 'string' } },
      required: ['panelType', 'componentTag'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'panel_component_unmount',
    description: 'Unmount component from a panel type.',
    inputSchema: {
      type: 'object',
      properties: { panelType: { type: 'string' } },
      required: ['panelType'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'panel_component_swap',
    description: 'Swap the component in a panel type.',
    inputSchema: {
      type: 'object',
      properties: { panelType: { type: 'string' }, newComponentTag: { type: 'string' } },
      required: ['panelType', 'newComponentTag'],
    },
    mutates: true,
    requiresConfig: true,
  },
  {
    name: 'module_workflow_kanban',
    description: 'Register a portable workflow kanban board panel backed by symbiote-ui.',
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
        layoutId: { type: 'string', description: 'Optional named layout to create or replace.' },
        setDefaultLayout: { type: 'boolean', description: 'Replace the root layout with this board panel.' },
        group: { type: 'object', description: 'Optional project group to upsert for the workflow board.' },
        section: { type: 'object', description: 'Optional sidebar section to upsert for the workflow board.' },
        eventTarget: { type: 'object', description: 'Optional drop-event target bridge fields.' },
        requiredHostServices: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional portable host services required by this workflow board.',
        },
      },
      required: ['panelType', 'board'],
    },
    mutates: true,
    requiresConfig: true,
  },
];

function layoutSet(args, { config }) {
  return setLayout(config, args.layoutTree, args.layoutId);
}

function panelAdd(args, { config }) {
  return addPanel(config, args.existingPanelType, args.newPanelType, args.direction, args.ratio, args.layoutId);
}

function panelRemove(args, { config }) {
  return removePanel(config, args.panelType, args.layoutId);
}

function panelResize(args, { config }) {
  return resizePanel(config, args.firstPanelType, args.ratio, args.layoutId);
}

function moduleRegister(args, { config }) {
  return registerPanelType(config, args.name, {
    title: args.title,
    icon: args.icon,
    component: args.component,
    behavior: args.behavior,
    menuActions: args.actions,
  });
}

function moduleUpdate(args, { config }) {
  return updatePanelType(config, args.name, args.updates);
}

function moduleUnregister(args, { config }) {
  return unregisterPanelType(config, args.name);
}

function moduleList(_args, { config }) {
  return listPanelTypes(config);
}

function layoutBehaviorSet(args, { config }) {
  return setBehavior(config, args.target, args.behavior);
}

function layoutBehaviorGet(args, { config }) {
  return getBehavior(config, args.target);
}

function layoutBehaviorUpdate(args, { config }) {
  return updateBehavior(config, args.target, args.updates || args.behavior || {});
}

function panelComponentMount(args, { config }) {
  return mountWidget(config, args.panelType, args.componentTag);
}

function panelComponentUnmount(args, { config }) {
  return unmountWidget(config, args.panelType);
}

function panelComponentSwap(args, { config }) {
  return swapWidget(config, args.panelType, args.newComponentTag);
}

function moduleWorkflowKanban(args, { config }) {
  return workflowKanban(config, args);
}

const handlers = {
  layout_set: layoutSet,
  panel_add: panelAdd,
  panel_remove: panelRemove,
  panel_resize: panelResize,
  module_register: moduleRegister,
  module_update: moduleUpdate,
  module_unregister: moduleUnregister,
  module_list: moduleList,
  layout_behavior_set: layoutBehaviorSet,
  layout_behavior_get: layoutBehaviorGet,
  layout_behavior_update: layoutBehaviorUpdate,
  panel_component_mount: panelComponentMount,
  panel_component_unmount: panelComponentUnmount,
  panel_component_swap: panelComponentSwap,
  module_workflow_kanban: moduleWorkflowKanban,
};

export const structureToolFamily = defineToolFamily('structure', structureTools, handlers);
