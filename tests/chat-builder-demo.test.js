/**
 * Chat-first tool-driven demo — construction proof.
 *
 * Verifies that the chat-builder demo constructs a workspace AROUND a persistent
 * chat panel using only real dispatch tools, that the chat stays pinned as the
 * center while regions are added around it, and that the result is a valid,
 * portable, relaunchable config.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildChatFirstWorkspace, CHAT_PANEL } from '../examples/visual-demo/chat-builder-state.js';
import { TOOLS, dispatch, createSession } from '../runtime/index.js';
import { validateWorkspaceConfig } from '../schema/index.js';

function layoutPanels(node, acc = []) {
  if (!node) return acc;
  if (node.type === 'panel') acc.push(node.panelType);
  else if (node.type === 'split') { layoutPanels(node.first, acc); layoutPanels(node.second, acc); }
  return acc;
}

test('chat-builder drives construction only through real dispatch tools', async () => {
  let { steps } = await buildChatFirstWorkspace();
  let toolNames = new Set(TOOLS.map((t) => t.name));
  for (let step of steps) {
    assert.ok(toolNames.has(step.tool), `step ${step.index} uses unknown tool "${step.tool}"`);
  }
  // The chat-building granular tools must actually be exercised, not bypassed.
  let used = new Set(steps.map((s) => s.tool));
  for (let required of ['register_panel_type', 'set_layout', 'set_behavior', 'add_panel', 'bridge_event', 'export_config']) {
    assert.ok(used.has(required), `expected the demo to call ${required}`);
  }
});

test('layout is assembled progressively around the chat', async () => {
  let { steps } = await buildChatFirstWorkspace();

  // Right after set_layout the chat is the entire workspace.
  let afterSetLayout = steps.find((s) => s.tool === 'set_layout');
  assert.deepEqual(afterSetLayout.digest.panels, [CHAT_PANEL]);

  // Each add_panel grows the panel count without ever dropping the chat.
  let addPanelSteps = steps.filter((s) => s.tool === 'add_panel');
  assert.ok(addPanelSteps.length >= 3, 'expected several add_panel calls');
  for (let step of addPanelSteps) {
    assert.ok(step.digest.panels.includes(CHAT_PANEL), 'chat must remain in the layout after every add_panel');
  }

  // Final layout has the chat plus the regions built around it.
  let final = steps.at(-1).digest;
  assert.ok(final.panels.includes(CHAT_PANEL));
  for (let region of ['preview', 'inspector', 'graph', 'logs']) {
    assert.ok(final.panels.includes(region), `final layout should include the ${region} region`);
  }
  assert.ok(final.panels.length >= 5);
});

test('chat stays pinned as the persistent center', async () => {
  let { config } = await buildChatFirstWorkspace();
  assert.equal(config.panelTypes[CHAT_PANEL].behavior.collapse, 'never');
  assert.equal(config.panelTypes[CHAT_PANEL].behavior.importance, 100);
  assert.ok(layoutPanels(config.layout).includes(CHAT_PANEL));
});

test('constructed config is valid and event bridges are wired', async () => {
  let { config } = await buildChatFirstWorkspace();
  let validation = validateWorkspaceConfig(config, { strict: true });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.equal(config.events.length, 3);
  assert.ok(config.events.every((b) => b.sourcePanel && b.event));
});

test('exported config is portable and relaunches into an equivalent workspace', async () => {
  let { exportJson, config, roundTripName } = await buildChatFirstWorkspace();
  assert.equal(roundTripName, 'Chat-First Console');

  let relaunch = createSession();
  let imported = await dispatch('import_config', { json: exportJson }, relaunch);
  assert.equal(imported.status, 'ok');
  assert.deepEqual(
    Object.keys(relaunch.config.panelTypes).sort(),
    Object.keys(config.panelTypes).sort(),
  );
  assert.deepEqual(layoutPanels(relaunch.config.layout).sort(), layoutPanels(config.layout).sort());
});
