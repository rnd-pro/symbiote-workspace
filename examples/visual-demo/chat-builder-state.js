/**
 * Chat-first construction driver.
 *
 * Builds a workspace layout AROUND a persistent chat panel using only the real
 * `dispatch(tool, args, session)` construction tools — no hand-authored layout
 * config. Every region around the chat is added by an actual tool call, so the
 * resulting config is proof that the public tool surface can drive chat-first
 * construction end to end.
 *
 * The returned step log is the source of truth for the live browser replay:
 * each entry is one real tool call plus the resulting hint and a small digest
 * of the config after that call.
 *
 * @module examples/visual-demo/chat-builder-state
 */

import { createSession, dispatch } from '../../runtime/index.js';

/** Panel-type name for the persistent chat region. */
export const CHAT_PANEL = 'chat';
/** symbiote-ui component tag mounted into the chat region. */
export const CHAT_COMPONENT = 'chat-workspace';

/**
 * Ordered construction recipe. Each entry is a single real tool call.
 * The chat panel is registered, made the whole layout, and pinned first; every
 * other region is then split in around it with `add_panel`.
 * @type {Array<{title: string, tool: string, args?: Object, expect?: 'mutation'|'valid'|'info'|'export'}>}
 */
const RECIPE = [
  {
    title: 'Classify the intent',
    tool: 'classify_workspace',
    args: { intent: 'A chat-first agent console that builds preview, inspector, graph and log panels around the conversation in real time.' },
    expect: 'info',
  },
  {
    title: 'Start an empty tool workspace',
    tool: 'scaffold_from_scratch',
    args: { name: 'Chat-First Console', register: 'tool' },
    expect: 'mutation',
  },
  {
    title: 'Register the chat panel type',
    tool: 'register_panel_type',
    args: { name: CHAT_PANEL, title: 'Chat', icon: 'chat', component: CHAT_COMPONENT },
    expect: 'mutation',
  },
  {
    title: 'Make the chat the whole workspace',
    tool: 'set_layout',
    args: { layoutTree: { type: 'panel', panelType: CHAT_PANEL, panelState: {} } },
    expect: 'mutation',
  },
  {
    title: 'Pin the chat as the persistent center',
    tool: 'set_behavior',
    args: { target: CHAT_PANEL, behavior: { collapse: 'never', importance: 100, minInlineSize: 360 } },
    expect: 'mutation',
  },
  {
    title: 'Register the preview panel type',
    tool: 'register_panel_type',
    args: { name: 'preview', title: 'Preview', icon: 'preview', component: 'workspace-preview' },
    expect: 'mutation',
  },
  {
    title: 'Add the preview to the right of the chat',
    tool: 'add_panel',
    args: { existingPanelType: CHAT_PANEL, newPanelType: 'preview', direction: 'horizontal', ratio: 0.58 },
    expect: 'mutation',
  },
  {
    title: 'Register the inspector panel type',
    tool: 'register_panel_type',
    args: { name: 'inspector', title: 'Inspector', icon: 'tune', component: 'workspace-inspector' },
    expect: 'mutation',
  },
  {
    title: 'Split an inspector under the preview',
    tool: 'add_panel',
    args: { existingPanelType: 'preview', newPanelType: 'inspector', direction: 'vertical', ratio: 0.62 },
    expect: 'mutation',
  },
  {
    title: 'Register the graph panel type',
    tool: 'register_panel_type',
    args: { name: 'graph', title: 'Graph', icon: 'graph', component: 'workspace-graph' },
    expect: 'mutation',
  },
  {
    title: 'Add a graph under the chat',
    tool: 'add_panel',
    args: { existingPanelType: CHAT_PANEL, newPanelType: 'graph', direction: 'vertical', ratio: 0.7 },
    expect: 'mutation',
  },
  {
    title: 'Register the logs panel type',
    tool: 'register_panel_type',
    args: { name: 'logs', title: 'Logs', icon: 'terminal', component: 'workspace-logs' },
    expect: 'mutation',
  },
  {
    title: 'Mount the log stream component',
    tool: 'mount_widget',
    args: { panelType: 'logs', componentTag: 'workspace-logs' },
    expect: 'mutation',
  },
  {
    title: 'Dock the logs under the inspector',
    tool: 'add_panel',
    args: { existingPanelType: 'inspector', newPanelType: 'logs', direction: 'vertical', ratio: 0.66 },
    expect: 'mutation',
  },
  {
    title: 'Add a console work-mode group',
    tool: 'add_group',
    args: { id: 'console', name: 'Console', icon: 'workspaces' },
    expect: 'mutation',
  },
  {
    title: 'Add the workspace section to the group',
    tool: 'add_section',
    args: { groupId: 'console', id: 'workspace', label: 'Workspace', icon: 'dashboard' },
    expect: 'mutation',
  },
  {
    title: 'Bridge chat intent to the preview',
    tool: 'bridge_event',
    args: { sourcePanel: CHAT_PANEL, event: 'intent', targetPanel: 'preview', targetMethod: 'render' },
    expect: 'mutation',
  },
  {
    title: 'Bridge chat plans to the graph',
    tool: 'bridge_event',
    args: { sourcePanel: CHAT_PANEL, event: 'plan', targetPanel: 'graph', targetMethod: 'setGraph' },
    expect: 'mutation',
  },
  {
    title: 'Bridge graph selection to the inspector',
    tool: 'bridge_event',
    args: { sourcePanel: 'graph', event: 'select', targetPanel: 'inspector', targetProperty: 'selection' },
    expect: 'mutation',
  },
  {
    title: 'Check design guardrails',
    tool: 'check_guardrails',
    expect: 'info',
  },
  {
    title: 'Validate the constructed config',
    tool: 'validate_config',
    args: { strict: true },
    expect: 'valid',
  },
  {
    title: 'Export a portable workspace config',
    tool: 'export_config',
    args: { strict: true },
    expect: 'export',
  },
];

/**
 * Summarize a config into a small digest for the step log / browser replay.
 * @param {Object|null} config
 * @returns {{panelTypes: string[], panels: string[], bridges: number, groups: number, pinnedChat: boolean}}
 */
function digestConfig(config) {
  if (!config) return { panelTypes: [], panels: [], bridges: 0, groups: 0, pinnedChat: false };
  let panels = [];
  let walk = (node) => {
    if (!node) return;
    if (node.type === 'panel') panels.push(node.panelType);
    else if (node.type === 'split') { walk(node.first); walk(node.second); }
  };
  walk(config.layout);
  return {
    panelTypes: Object.keys(config.panelTypes || {}),
    panels,
    bridges: (config.events || []).length,
    groups: (config.groups || []).length,
    pinnedChat: config.panelTypes?.[CHAT_PANEL]?.behavior?.collapse === 'never',
  };
}

/**
 * Run one recipe step as a real dispatch call and record it.
 * @param {import('../../runtime/session.js').Session} session
 * @param {Array} steps
 * @param {{title: string, tool: string, args?: Object, expect?: string}} step
 * @param {number} index
 */
async function runStep(session, steps, step, index) {
  let result = await dispatch(step.tool, step.args || {}, session);
  let status = result?.status;

  if (step.expect === 'mutation' && status !== 'ok') {
    throw new Error(`Step ${index} (${step.tool}) failed: ${result?.hint || JSON.stringify(result)}`);
  }
  if (step.expect === 'valid' && result?.valid !== true) {
    throw new Error(`Step ${index} (validate_config) reported invalid: ${JSON.stringify(result?.errors || result)}`);
  }
  if (step.expect === 'export' && !result?.json) {
    throw new Error(`Step ${index} (export_config) produced no portable JSON: ${result?.hint || JSON.stringify(result)}`);
  }

  steps.push({
    index,
    title: step.title,
    tool: step.tool,
    args: step.args || {},
    status: status ?? (result?.valid === true ? 'valid' : 'info'),
    hint: result?.hint || null,
    digest: digestConfig(session.config),
  });
  return result;
}

/**
 * Build a chat-first workspace by driving the real dispatch tool surface.
 *
 * @returns {Promise<{config: Object, steps: Array, exportJson: string, classification: Object|null, roundTripName: string}>}
 */
export async function buildChatFirstWorkspace() {
  let session = createSession();
  let steps = [];
  let stages = [];
  let classification = null;
  let exportJson = '';
  let lastSignature = '';

  for (let i = 0; i < RECIPE.length; i++) {
    let result = await runStep(session, steps, RECIPE[i], i);
    if (RECIPE[i].tool === 'classify_workspace') classification = result?.classification ?? result ?? null;
    if (RECIPE[i].tool === 'export_config') exportJson = result.json;

    // Capture a replay stage whenever the visible workspace shape changes, so the
    // browser can mount the construction progressively, one real tool call at a time.
    if (session.config) {
      let digest = digestConfig(session.config);
      let signature = JSON.stringify([digest.panels, digest.pinnedChat]);
      if (signature !== lastSignature) {
        lastSignature = signature;
        stages.push({
          index: i,
          title: RECIPE[i].title,
          tool: RECIPE[i].tool,
          hint: result?.hint || null,
          digest,
          config: JSON.parse(JSON.stringify(session.config)),
        });
      }
    }
  }

  // Prove portability: re-import the exported config into a fresh session.
  let relaunch = createSession();
  let imported = await dispatch('import_config', { json: exportJson }, relaunch);
  if (imported?.status !== 'ok' || !relaunch.config) {
    throw new Error(`Portable relaunch failed: ${imported?.hint || JSON.stringify(imported)}`);
  }

  return {
    config: session.config,
    steps,
    stages,
    exportJson,
    classification,
    roundTripName: relaunch.config.name,
  };
}
