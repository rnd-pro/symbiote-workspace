/**
 * Discovery dispatch-tool family.
 * @module symbiote-workspace/runtime/tools/discovery-tools
 */

import { describeWorkspace, listUsedComponents } from '../../handlers/describe.js';
import {
  discoverComponents,
  findComponent,
  listCategories,
  listComponentTags,
} from '../../handlers/discover.js';
import { defineToolFamily } from './registry.js';

export const discoveryTools = [
  {
    name: 'workspace_describe',
    description: 'Describe the current workspace configuration.',
    inputSchema: { type: 'object', properties: {} },
    requiresConfig: true,
  },
  {
    name: 'component_discover',
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
    name: 'component_find',
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
    name: 'component_tags_list',
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
    name: 'component_categories_list',
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
    name: 'component_usage_list',
    description: 'List components used in the current workspace config.',
    inputSchema: { type: 'object', properties: {} },
    requiresConfig: true,
  },
];

function workspaceDescribe(_args, { config }) {
  return describeWorkspace(config);
}

function componentDiscover(args) {
  return discoverComponents(args.uiPath);
}

async function componentFind(args) {
  let found = await findComponent(args.uiPath, args.tagName);
  if (!found) return { status: 'not_found', hint: `Component <${args.tagName}> not found.` };
  return { component: found, status: 'ok' };
}

async function componentTagsList(args) {
  let tags = await listComponentTags(args.uiPath);
  return { tags, count: tags.length };
}

async function componentCategoriesList(args) {
  let categories = await listCategories(args.uiPath);
  return { categories, count: Object.keys(categories).length };
}

function componentUsageList(_args, { config }) {
  return listUsedComponents(config);
}

const handlers = {
  workspace_describe: workspaceDescribe,
  component_discover: componentDiscover,
  component_find: componentFind,
  component_tags_list: componentTagsList,
  component_categories_list: componentCategoriesList,
  component_usage_list: componentUsageList,
};

export const discoveryToolFamily = defineToolFamily('discovery', discoveryTools, handlers);
